import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Widget from "./Widget";

const { api, eventsApi, appWindow } = vi.hoisted(() => ({
  api: {
    getCalendarOccurrences: vi.fn(),
    getCanvasDeadlines: vi.fn(),
    getSjtuCourseOccurrences: vi.fn(),
    getWidgetStatus: vi.fn(),
    hideWidget: vi.fn(),
    setWidgetAlwaysOnTop: vi.fn(),
    showMainWindow: vi.fn(),
  },
  eventsApi: { emitTo: vi.fn(), listen: vi.fn() },
  appWindow: { startResizeDragging: vi.fn() },
}));

vi.mock("./lib/backend", () => api);
vi.mock("@tauri-apps/api/event", () => eventsApi);
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => appWindow }));

const course = {
  occurrenceId: "meeting-1", courseId: "course-1", termId: "term-1", sourceSystem: "undergraduate",
  title: "高等数学", teacher: "张老师", location: "东上院 101", startUtc: new Date().toISOString(),
  endUtc: new Date(Date.now() + 60 * 60 * 1000).toISOString(), timezone: "Asia/Shanghai",
  color: "#34785c", weekNumber: 3, weekday: 3, startSection: 1, endSection: 2, meetingId: "meeting-1", note: "",
};
const deadline = {
  instanceUrl: "https://oc.sjtu.edu.cn", userId: "user-1", courseId: "course-1", assignmentId: "assignment-1",
  courseName: "程序设计", title: "实验报告", description: "", dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  lockAt: null, htmlUrl: "https://oc.sjtu.edu.cn/courses/1/assignments/1", workflowState: "published",
  submittedAt: null, grade: null, localCompleted: false,
};
const personalEvent = {
  occurrenceId: "event-1", eventId: "event-1", title: "读书会", description: "", location: "图书馆",
  category: "event", startUtc: new Date().toISOString(), endUtc: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  timezone: "Asia/Shanghai", allDay: false, color: "#34785c", originalStartLocal: null,
};

describe("calendar widget", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    localStorage.clear();
    api.getCalendarOccurrences.mockReset().mockResolvedValue([]);
    api.getCanvasDeadlines.mockReset().mockResolvedValue([]);
    api.getSjtuCourseOccurrences.mockReset().mockResolvedValue([]);
    api.getWidgetStatus.mockReset().mockResolvedValue({
      canvasLastSuccessAt: "2026-10-21T01:00:00Z", sjtuLastSuccessAt: "2026-10-21T00:00:00Z", alwaysOnTop: false,
    });
    api.hideWidget.mockReset().mockResolvedValue(undefined);
    api.setWidgetAlwaysOnTop.mockReset().mockResolvedValue(undefined);
    api.showMainWindow.mockReset().mockResolvedValue(undefined);
    eventsApi.emitTo.mockReset().mockResolvedValue(undefined);
    eventsApi.listen.mockReset().mockResolvedValue(() => {});
  });

  it("shows cached courses and opens their details in the main window", async () => {
    const user = userEvent.setup();
    api.getSjtuCourseOccurrences.mockResolvedValue([course]);
    render(<Widget />);
    await user.click(await screen.findByRole("button", { name: /高等数学/ }));
    expect(eventsApi.emitTo).toHaveBeenCalledWith("main", "widget-open-course", course);
    expect(api.showMainWindow).toHaveBeenCalled();
    expect(await screen.findByText(/Canvas/)).toBeInTheDocument();
  });

  it("wakes the hidden main application from the widget", async () => {
    const user = userEvent.setup();
    render(<Widget />);
    await user.click(screen.getByRole("button", { name: "打开主程序" }));
    expect(api.showMainWindow).toHaveBeenCalledOnce();
  });

  it("reloads changed data and follows main-window timezone changes, then releases listeners", async () => {
    const handlers = new Map<string, (event: { payload: string }) => void>();
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    eventsApi.listen.mockImplementation((name: string, handler: (event: { payload: string }) => void) => {
      handlers.set(name, handler);
      const stop = vi.fn(); stops.push(stop); return Promise.resolve(stop);
    });
    const { unmount } = render(<Widget />);
    await waitFor(() => expect(api.getCalendarOccurrences).toHaveBeenCalledTimes(1));
    api.getCalendarOccurrences.mockResolvedValue([personalEvent]);
    await act(async () => handlers.get("calendar-data-changed")!({ payload: "" }));
    expect(await screen.findByRole("button", { name: /读书会/ })).toBeInTheDocument();
    await act(async () => handlers.get("calendar-timezone-changed")!({ payload: "America/New_York" }));
    await waitFor(() => expect(api.getCalendarOccurrences).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), "America/New_York"));
    unmount();
    stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
  });

  it("shows upcoming Canvas deadlines and routes them to the main-window detail", async () => {
    const user = userEvent.setup();
    api.getCanvasDeadlines.mockResolvedValue([deadline]);
    render(<Widget />);
    await user.click(await screen.findByRole("button", { name: /实验报告/ }));
    expect(eventsApi.emitTo).toHaveBeenCalledWith("main", "widget-open-canvas-deadline", deadline);
    expect(api.showMainWindow).toHaveBeenCalled();
  });

  it("ignores an older pending cache read after a newer change arrives", async () => {
    let notify: (() => void) | undefined;
    eventsApi.listen.mockImplementation((name: string, handler: () => void) => {
      if (name === "calendar-data-changed") notify = handler;
      return Promise.resolve(() => {});
    });
    let resolveOld: (items: typeof personalEvent[]) => void = () => {};
    api.getCalendarOccurrences.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    render(<Widget />);
    await waitFor(() => expect(api.getCalendarOccurrences).toHaveBeenCalledTimes(1));
    api.getCalendarOccurrences.mockResolvedValue([{ ...personalEvent, title: "最新日程" }]);
    await act(async () => notify!());
    expect(await screen.findByRole("button", { name: /最新日程/ })).toBeInTheDocument();
    await act(async () => resolveOld([{ ...personalEvent, title: "旧日程" }]));
    expect(screen.queryByRole("button", { name: /旧日程/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /最新日程/ })).toBeInTheDocument();
  });

  it("routes a personal event to its main-window detail", async () => {
    const user = userEvent.setup();
    api.getCalendarOccurrences.mockResolvedValue([personalEvent]);
    render(<Widget />);
    await user.click(await screen.findByRole("button", { name: /读书会/ }));
    expect(eventsApi.emitTo).toHaveBeenCalledWith("main", "widget-open-event", personalEvent);
    expect(api.showMainWindow).toHaveBeenCalled();
  });
});

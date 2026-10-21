import { cleanup, render, screen } from "@testing-library/react";
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
  eventsApi: { emitTo: vi.fn() },
  appWindow: { startResizeDragging: vi.fn() },
}));

vi.mock("./lib/backend", () => api);
vi.mock("@tauri-apps/api/event", () => ({ emitTo: eventsApi.emitTo }));
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

  it("shows upcoming Canvas deadlines and routes them to the main-window detail", async () => {
    const user = userEvent.setup();
    api.getCanvasDeadlines.mockResolvedValue([deadline]);
    render(<Widget />);
    await user.click(await screen.findByRole("button", { name: /实验报告/ }));
    expect(eventsApi.emitTo).toHaveBeenCalledWith("main", "widget-open-canvas-deadline", deadline);
    expect(api.showMainWindow).toHaveBeenCalled();
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

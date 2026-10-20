import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("calendar window", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
    invoke.mockImplementation((command: string) => {
      if (command === "get_backend_status") return Promise.resolve({ database: "sqlite", schemaVersion: 5 });
      if (command === "get_canvas_deadlines") return Promise.resolve([]);
      if (command === "get_canvas_connection_status") return Promise.resolve({ configured: false, instanceUrl: null });
      if (command === "get_sjtu_course_occurrences") return Promise.resolve([]);
      if (command === "get_sjtu_connection_status") return Promise.resolve({ undergraduateConfigured: false, graduateConfigured: false });
      if (command === "get_calendar_occurrences" || command === "list_personal_events") return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });

  it("loads the selected week from the Rust calendar query", async () => {
    render(<App />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_calendar_occurrences", expect.objectContaining({ displayTimezone: "Asia/Shanghai" })));
    expect(await screen.findByRole("region", { name: "周日历" })).toBeInTheDocument();
    expect(await screen.findByText("本地 SQLite · v5")).toBeInTheDocument();
  });

  it("opens an editor and persists a new local event through Tauri", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getAllByRole("button", { name: /新建日程/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: "新建日程" });
    await user.type(screen.getByLabelText("标题"), "项目讨论");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("create_personal_event", expect.objectContaining({
      event: expect.objectContaining({ title: "项目讨论", timezone: "Asia/Shanghai", rrule: null }),
    })));
    expect(dialog).not.toBeInTheDocument();
  });

  it("switches to month view and changes the displayed timezone", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "月" }));
    expect(screen.getByRole("region", { name: "月日历" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /设置/ }));
    await user.selectOptions(screen.getByLabelText("显示时区"), "Asia/Tokyo");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_calendar_occurrences", expect.objectContaining({ displayTimezone: "Asia/Tokyo" })));
  });

  it("keeps concurrent events visible in separate columns", async () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "2026";
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    const instant = (time: string) => new Date(`${date}T${time}+08:00`).toISOString();
    invoke.mockImplementation((command: string) => {
      if (command === "get_backend_status") return Promise.resolve({ database: "sqlite", schemaVersion: 5 });
      if (command === "get_canvas_deadlines") return Promise.resolve([]);
      if (command === "get_canvas_connection_status") return Promise.resolve({ configured: false, instanceUrl: null });
      if (command === "get_sjtu_course_occurrences") return Promise.resolve([]);
      if (command === "get_sjtu_connection_status") return Promise.resolve({ undergraduateConfigured: false, graduateConfigured: false });
      if (command === "list_personal_events") return Promise.resolve([]);
      if (command === "get_calendar_occurrences") return Promise.resolve([
        { occurrenceId: "a", eventId: "a", originalStartLocal: `${date}T10:00:00`, title: "Overlap A", description: "", location: "", category: "event", startUtc: instant("10:00:00"), endUtc: instant("11:00:00"), timezone: "Asia/Shanghai", displayTimezone: "Asia/Shanghai", allDay: false, color: "#34785c" },
        { occurrenceId: "b", eventId: "b", originalStartLocal: `${date}T10:30:00`, title: "Overlap B", description: "", location: "", category: "event", startUtc: instant("10:30:00"), endUtc: instant("11:30:00"), timezone: "Asia/Shanghai", displayTimezone: "Asia/Shanghai", allDay: false, color: "#a4513d" },
      ]);
      return Promise.resolve(null);
    });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelectorAll(".event-block")).toHaveLength(2));
    const [first, second] = Array.from(container.querySelectorAll<HTMLElement>(".event-block"));
    expect(first.style.left).not.toBe(second.style.left);
  });

  it("sends a typed Canvas token to the secure backend command only", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "⚙设置" }));
    await user.type(screen.getByLabelText("个人访问令牌"), "fixture-token-not-a-real-credential");
    await user.click(screen.getByRole("button", { name: "安全保存令牌" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_canvas_credentials", expect.objectContaining({
      instanceUrl: "https://oc.sjtu.edu.cn", token: "fixture-token-not-a-real-credential",
    })));
    expect(localStorage.getItem("canvas-token")).toBeNull();
  });

  it("opens the selected SJTU sign-in flow without collecting credentials in the UI", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "⚙设置" }));
    await user.click(screen.getByRole("button", { name: "打开交大登录窗口" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("start_sjtu_login", { sourceSystem: "undergraduate" }));
    expect(screen.queryByLabelText(/密码|Cookie|Token/)).not.toBeInTheDocument();
  });

  it("previews an ICS course file with an explicit term mapping", async () => {
    const user = userEvent.setup();
    invoke.mockImplementation((command: string) => {
      if (command === "get_backend_status") return Promise.resolve({ database: "sqlite", schemaVersion: 5 });
      if (command === "get_canvas_deadlines") return Promise.resolve([]);
      if (command === "get_canvas_connection_status") return Promise.resolve({ configured: false, instanceUrl: null });
      if (command === "get_sjtu_course_occurrences") return Promise.resolve([]);
      if (command === "get_sjtu_connection_status") return Promise.resolve({ undergraduateConfigured: false, graduateConfigured: false });
      if (command === "get_calendar_occurrences" || command === "list_personal_events") return Promise.resolve([]);
      if (command === "preview_ics_import") return Promise.resolve({ sourceName: "courses.ics", eventCount: 2, preview: [{ title: "高等数学", startLocal: "2026-09-07T08:00:00", endLocal: "2026-09-07T08:45:00", location: "A101" }] });
      return Promise.resolve(null);
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "⚙设置" }));
    const file = new File(["BEGIN:VCALENDAR\nEND:VCALENDAR"], "courses.ics", { type: "text/calendar" });
    await user.upload(screen.getByLabelText("ICS 文件"), file);
    await user.type(screen.getByLabelText("映射到学期首周周一"), "2026-09-07");
    await user.click(screen.getByRole("button", { name: "预览导入" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("preview_ics_import", expect.objectContaining({ sourceName: "courses.ics", firstMonday: "2026-09-07", weekCount: 16 })));
    expect(await screen.findByText("courses.ics · 2 个日程")).toBeInTheDocument();
  });
});

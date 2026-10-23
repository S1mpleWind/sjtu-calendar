import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { suggestSjtuTermMetadata } from "./App";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})), emitTo: vi.fn() }));

describe("calendar window", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
    invoke.mockImplementation((command: string) => {
      if (command === "get_backend_status") return Promise.resolve({ database: "sqlite", schemaVersion: 6 });
      if (command === "get_canvas_deadlines") return Promise.resolve([]);
      if (command === "get_canvas_connection_status") return Promise.resolve({ configured: false, instanceUrl: null });
      if (command === "get_sjtu_course_occurrences") return Promise.resolve([]);
      if (command === "get_sjtu_connection_status") return Promise.resolve({ undergraduateConfigured: false, graduateConfigured: false });
      if (command === "get_calendar_occurrences" || command === "list_personal_events") return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });

  it("loads the selected week from the Rust calendar query", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_calendar_occurrences", expect.objectContaining({ displayTimezone: "Asia/Shanghai" })));
    expect(await screen.findByRole("region", { name: "周日历" })).toBeInTheDocument();
    expect(await screen.findByText("本地 SQLite · v6")).toBeInTheDocument();
    expect(container.querySelectorAll(".canvas-strip-day > strong")).toHaveLength(0);
    expect(container.querySelectorAll(".week-head .day-heading")).toHaveLength(7);
  });

  it("uses the labeled calendar control to sync Canvas assignments", async () => {
    const user = userEvent.setup();
    invoke.mockImplementation((command: string) => {
      if (command === "get_backend_status") return Promise.resolve({ database: "sqlite", schemaVersion: 6 });
      if (command === "get_canvas_deadlines") return Promise.resolve([]);
      if (command === "get_canvas_connection_status") return Promise.resolve({ configured: true, instanceUrl: "https://oc.sjtu.edu.cn" });
      if (command === "sync_canvas") return Promise.resolve({ state: "succeeded", courseCount: 1, assignmentCount: 2, failedCourses: [], syncedAt: "2026-10-20T00:00:00Z" });
      if (command === "get_sjtu_course_occurrences") return Promise.resolve([]);
      if (command === "get_sjtu_connection_status") return Promise.resolve({ undergraduateConfigured: false, graduateConfigured: false });
      if (command === "get_calendar_occurrences" || command === "list_personal_events") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "刷新 Canvas 作业" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync_canvas"));
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

  it("opens a quick event editor at the clicked free time slot", async () => {
    const { container } = render(<App />);
    await screen.findByRole("region", { name: "周日历" });
    const slot = container.querySelector(".time-column");
    expect(slot).not.toBeNull();
    fireEvent.click(slot!, { clientY: 32 });
    expect((await screen.findByLabelText("开始") as HTMLInputElement).value).toMatch(/T07:30$/);
    expect((screen.getByLabelText("结束") as HTMLInputElement).value).toMatch(/T08:30$/);
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
      if (command === "get_backend_status") return Promise.resolve({ database: "sqlite", schemaVersion: 6 });
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
      if (command === "get_backend_status") return Promise.resolve({ database: "sqlite", schemaVersion: 6 });
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

  it("restores a selected backup only after explicit user confirmation", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const backup = '{"format":"edu.sjtu.schedule.sqlite-backup.v1"}';
    invoke.mockImplementation((command: string) => {
      if (command === "get_backend_status") return Promise.resolve({ database: "sqlite", schemaVersion: 6 });
      if (command === "get_canvas_deadlines") return Promise.resolve([]);
      if (command === "get_canvas_connection_status") return Promise.resolve({ configured: false, instanceUrl: null });
      if (command === "get_sjtu_course_occurrences") return Promise.resolve([]);
      if (command === "get_sjtu_connection_status") return Promise.resolve({ undergraduateConfigured: false, graduateConfigured: false });
      if (command === "get_calendar_occurrences" || command === "list_personal_events") return Promise.resolve([]);
      if (command === "restore_data_backup") return Promise.resolve(6);
      return Promise.resolve(null);
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "⚙设置" }));
    await user.upload(screen.getByLabelText("从备份恢复"), new File([backup], "backup.json", { type: "application/json" }));
    await user.click(screen.getByRole("button", { name: "验证并恢复备份" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("restore_data_backup", { backupJson: backup }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(await screen.findByText("恢复完成（数据库 v6）。外部账户凭据未包含在备份中。")).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("opens the new-event editor with Ctrl+N", async () => {
    render(<App />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_backend_status"));
    await userEvent.keyboard("{Control>}n{/Control}");
    expect(await screen.findByRole("dialog", { name: "新建日程" })).toBeInTheDocument();
  });

  it("suggests only official verified SJTU term dates", () => {
    expect(suggestSjtuTermMetadata("2026", "1")).toEqual({ firstMonday: "2026-09-14", weekCount: 18 });
    expect(suggestSjtuTermMetadata("2025", "2")).toEqual({ firstMonday: "2026-03-02", weekCount: 18 });
    expect(suggestSjtuTermMetadata("2030", "1")).toBeNull();
  });

  it("saves a note to one dated course occurrence and displays its star", async () => {
    const user = userEvent.setup();
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "2026";
    const day = `${part("year")}-${part("month")}-${part("day")}`;
    const item = {
      occurrenceId: "course-week-one", meetingId: "meeting-test", courseId: "course-test", termId: "term-test", sourceSystem: "undergraduate",
      title: "单节备注测试课", teacher: "教师", location: "教室", startUtc: new Date(`${day}T10:00:00+08:00`).toISOString(), endUtc: new Date(`${day}T10:45:00+08:00`).toISOString(),
      timezone: "Asia/Shanghai", color: "#9b9bff", weekNumber: 1, weekday: 1, startSection: 1, endSection: 1, note: "",
    };
    invoke.mockImplementation((command: string) => {
      if (command === "get_backend_status") return Promise.resolve({ database: "sqlite", schemaVersion: 6 });
      if (command === "get_canvas_deadlines") return Promise.resolve([]);
      if (command === "get_canvas_connection_status") return Promise.resolve({ configured: false, instanceUrl: null });
      if (command === "get_sjtu_course_occurrences") return Promise.resolve([{ ...item }]);
      if (command === "set_sjtu_occurrence_note") { item.note = "带讲义"; return Promise.resolve(null); }
      if (command === "get_sjtu_connection_status") return Promise.resolve({ undergraduateConfigured: false, graduateConfigured: false });
      if (command === "get_calendar_occurrences" || command === "list_personal_events") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /单节备注测试课/ }));
    await user.type(screen.getByRole("textbox", { name: "本次课的备注" }), "带讲义");
    await user.click(screen.getByRole("button", { name: "保存备注" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_sjtu_occurrence_note", { meetingId: "meeting-test", weekNumber: 1, note: "带讲义" }));
    expect(await screen.findByLabelText("含备注")).toBeInTheDocument();
  });

  function recurringFixture() {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const prior = new Date(day + "T00:00:00Z"); prior.setUTCDate(prior.getUTCDate() - 14);
    const base = prior.toISOString().slice(0, 10);
    const event = { id: "repeat-a", title: "Series audit", description: "", location: "", category: "event", startLocal: base + "T09:00:00", endLocal: base + "T10:00:00", timezone: "Asia/Shanghai", allDay: false, rrule: "FREQ=WEEKLY;COUNT=5", color: "#34785c" };
    const occurrence = { ...event, eventId: event.id, occurrenceId: "repeat-date", originalStartLocal: day + "T09:00:00", startUtc: day + "T01:00:00Z", endUtc: day + "T02:00:00Z", displayTimezone: "Asia/Shanghai" };
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((command: string, args: unknown) => {
      if (command === "get_calendar_occurrences") return Promise.resolve([occurrence]);
      if (command === "get_personal_event" || command === "update_personal_event") return Promise.resolve(event);
      return original(command, args);
    });
    return { event, occurrence };
  }

  it("edits the original series without changing its anchor or dropping its end condition", async () => {
    const { event } = recurringFixture();
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("button", { name: /Series audit/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "编辑范围" }), "series");
    expect(screen.getByLabelText("开始")).toHaveValue(event.startLocal.slice(0,16));
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "Renamed series");
    await user.click(screen.getByRole("button", { name: "保存整个系列" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("update_personal_event", { id: event.id, event: expect.objectContaining({ title: "Renamed series", startLocal: event.startLocal, endLocal: event.endLocal, rrule: event.rrule }) }));
  });

  it("defaults to editing one recurrence and leaves the series untouched", async () => {
    const { event, occurrence } = recurringFixture();
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("button", { name: /Series audit/ }));
    expect(screen.getByRole("combobox", { name: "编辑范围" })).toHaveValue("single");
    await user.click(screen.getByRole("button", { name: "保存此项" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_recurrence_exception", expect.objectContaining({ eventId: event.id, originalStartLocal: occurrence.originalStartLocal, kind: "override", overrideValue: expect.objectContaining({ startLocal: occurrence.originalStartLocal }) })));
    expect(invoke.mock.calls.some(([command]) => command === "update_personal_event")).toBe(false);
  });

  it("shows overnight events on both days in week and month views", async () => {
    const { occurrence } = recurringFixture();
    const monday = new Date(occurrence.originalStartLocal.slice(0,10) + "T00:00:00Z");
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const tuesday = new Date(monday); tuesday.setUTCDate(tuesday.getUTCDate() + 1);
    const overnight = { ...occurrence, title: "Overnight", startUtc: monday.toISOString().slice(0,10) + "T14:00:00Z", endUtc: tuesday.toISOString().slice(0,10) + "T02:00:00Z" };
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((command: string, args: unknown) => command === "get_calendar_occurrences" ? Promise.resolve([overnight]) : original(command, args));
    const user = userEvent.setup(); const { container } = render(<App />);
    await waitFor(() => expect(container.querySelectorAll(".event-block")).toHaveLength(2));
    const blocks = container.querySelectorAll<HTMLElement>(".event-block");
    expect(blocks[0].style.height).toBe("128px");
    expect(blocks[1].style.top).toBe("0px");
    expect(blocks[1].style.height).toBe("192px");
    await user.click(screen.getByRole("button", { name: "月" }));
    await waitFor(() => expect(container.querySelectorAll(".month-event")).toHaveLength(2));
  });
});

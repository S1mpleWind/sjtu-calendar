import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  createPersonalEvent, deletePersonalEvent, getBackendStatus, getCalendarOccurrences, getCanvasConnectionStatus, getCanvasDeadlines, setCanvasAssignmentCompleted, saveCanvasCredentials, clearCanvasCredentials, testCanvasConnection, syncCanvas,
  getSjtuConnectionStatus, getSjtuCourseOccurrences, setSjtuOccurrenceNote, startSjtuLogin, finishSjtuLogin, clearSjtuLogin, syncSjtu,
  exportDataBackup, restoreDataBackup,
  getPersonalEvent, listPersonalEvents, setPersonalEventCompleted, setRecurrenceException, updatePersonalEvent,
  type BackendStatus, type CalendarOccurrence, type EventDraft, type PersonalEvent, type CanvasConnectionStatus, type CanvasDeadline, type SjtuConnectionStatus, type SjtuCourseOccurrence,
  type RecurrenceOverride,
} from "./lib/backend";
import { emitTo, listen } from "@tauri-apps/api/event";
import { toggleWidget } from "./lib/backend";
import "./App.css";
import { dayMinutes, groupByDay } from "./lib/calendar-days";
import { useCalendarUpdates } from "./lib/calendar-updates";
import DdlOverview from "./DdlOverview";
import { buildOverviewItems, type OverviewItem } from "./lib/ddl-overview";
import { canvasCompleted, canvasRemotelyCompleted, canvasSubmissionLabel } from "./lib/canvas-status";

type View = "week" | "month" | "overview";
type EditorState = { event?: PersonalEvent; occurrence?: CalendarOccurrence; date: string; startTime?: string; includeInOverview?: boolean };
const ZONES = ["Asia/Shanghai", "Asia/Tokyo", "America/New_York", "Europe/London", "UTC"];
const FIRST_HOUR = 7;
const LAST_HOUR = 23;
const HOUR_HEIGHT = 64;

function addDays(key: string, amount: number) {
  const value = new Date(`${key}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
function mondayOf(key: string) {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay();
  return addDays(key, -((day + 6) % 7));
}
function monthStart(key: string) { return `${key.slice(0, 7)}-01`; }
function monthEnd(key: string) {
  const value = new Date(`${monthStart(key)}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  value.setUTCDate(0);
  return value.toISOString().slice(0, 10);
}
function shiftMonth(key: string, amount: number) {
  const currentDay = Number(key.slice(-2));
  const value = new Date(`${monthStart(key)}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + amount + 1);
  value.setUTCDate(0);
  const lastDay = value.getUTCDate();
  value.setUTCDate(Math.min(currentDay, lastDay));
  return value.toISOString().slice(0, 10);
}
function dateInZone(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function todayInZone(timezone: string) { return dateInZone(new Date(), timezone); }
function gridStart(key: string) { return mondayOf(monthStart(key)); }
function displayMonth(key: string, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: timezone }).format(new Date(`${key.slice(0, 7)}-15T12:00:00Z`));
}
function displayDate(key: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("zh-CN", { ...options, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
}
function weekday(key: string) { return new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`)); }
function timeLabel(item: CalendarOccurrence, timezone: string) {
  if (item.allDay) return "全天";
  const format: Intl.DateTimeFormatOptions = { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  const start = new Intl.DateTimeFormat("zh-CN", format).format(new Date(item.startUtc));
  const end = new Intl.DateTimeFormat("zh-CN", format).format(new Date(item.endUtc));
  return `${start}–${end}`;
}
export function suggestSjtuTermMetadata(year: string, term: "1" | "2" | "3") {
  const verified: Record<string, { firstMonday: string; weekCount: number }> = {
    "2026-1": { firstMonday: "2026-09-14", weekCount: 18 },
    "2025-1": { firstMonday: "2025-09-15", weekCount: 18 },
    "2025-2": { firstMonday: "2026-03-02", weekCount: 18 },
    "2024-3": { firstMonday: "2025-06-23", weekCount: 4 },
  };
  return verified[`${year}-${term}`] ?? null;
}
function localNow(timezone: string, date: string) {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const part = (type: string) => now.find((entry) => entry.type === type)?.value ?? "00";
  const key = `${part("year")}-${part("month")}-${part("day")}`;
  return key === date ? `${part("hour")}:${part("minute")}` : "09:00";
}
function localValue(value: string) { return value.length === 16 ? `${value}:00` : value; }
function emptyDraft(date: string, timezone: string, startTime = localNow(timezone, date)): EventDraft {
  const [hour, minute] = startTime.split(":").map(Number);
  const endTotal = hour * 60 + minute + 60;
  const endDate = endTotal >= 24 * 60 ? addDays(date, 1) : date;
  const end = `${String(Math.floor(endTotal % (24 * 60) / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
  return { title: "", description: "", location: "", category: "event", startLocal: `${date}T${startTime}:00`, endLocal: `${endDate}T${end}:00`, timezone, allDay: false, rrule: null, color: "#4f46e5", includeInOverview: false };
}
function localDateTime(utc: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(utc));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}
function layoutOverlaps<T extends { occurrenceId: string; startUtc: string; endUtc: string }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  const layout = new Map<string, { column: number; columns: number }>();
  let cluster: T[] = [];
  let clusterEnd = -Infinity;
  const placeCluster = () => {
    const slots: T[][] = [];
    for (const item of cluster) {
      const start = Date.parse(item.startUtc);
      const end = Date.parse(item.endUtc);
      let column = slots.findIndex((slot) => slot.every((other) => Date.parse(other.endUtc) <= start || Date.parse(other.startUtc) >= end));
      if (column < 0) column = slots.length;
      (slots[column] ??= []).push(item);
      layout.set(item.occurrenceId, { column, columns: 0 });
    }
    for (const item of cluster) layout.get(item.occurrenceId)!.columns = slots.length;
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const item of sorted) {
    const start = Date.parse(item.startUtc);
    if (cluster.length && start >= clusterEnd) placeCluster();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, Date.parse(item.endUtc));
  }
  if (cluster.length) placeCluster();
  return layout;
}

function App() {
  const [timezone, setTimezone] = useState(() => localStorage.getItem("calendar-timezone") || "Asia/Shanghai");
  const [view, setView] = useState<View>("week");
  const [selectedDate, setSelectedDate] = useState(() => todayInZone(localStorage.getItem("calendar-timezone") || "Asia/Shanghai"));
  const [miniMonth, setMiniMonth] = useState(selectedDate);
  const [occurrences, setOccurrences] = useState<CalendarOccurrence[]>([]);
  const [events, setEvents] = useState<PersonalEvent[]>([]);
  const [canvasDeadlines, setCanvasDeadlines] = useState<CanvasDeadline[]>([]);
  const [canvasStatus, setCanvasStatus] = useState<CanvasConnectionStatus>({ configured: false, instanceUrl: null, accountVerified: false });
  const [canvasNotice, setCanvasNotice] = useState("");
  const [sjtuOccurrences, setSjtuOccurrences] = useState<SjtuCourseOccurrence[]>([]);
  const [sjtuStatus, setSjtuStatus] = useState<SjtuConnectionStatus>({ undergraduateConfigured: false, graduateConfigured: false });
  const [sjtuNotice, setSjtuNotice] = useState("");
  const [selectedCourse, setSelectedCourse] = useState<SjtuCourseOccurrence | null>(null);
  const [selectedCanvasDeadline, setSelectedCanvasDeadline] = useState<CanvasDeadline | null>(null);
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [eventWorking, setEventWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<"calendar" | "settings">("calendar");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [overviewWorking, setOverviewWorking] = useState(false);
  const refreshSequence = useRef(0);

  useEffect(() => {
    localStorage.setItem("calendar-timezone", timezone);
    void Promise.resolve(emitTo("widget", "calendar-timezone-changed", timezone)).catch(() => {});
  }, [timezone]);
  useEffect(() => {
    let active = true;
    const unlisten: Array<() => void> = [];
    void listen<SjtuCourseOccurrence>("widget-open-course", ({ payload }) => {
      const date = dateInZone(new Date(payload.startUtc), timezone);
      setPage("calendar"); setView("week"); setSelectedDate(date); setMiniMonth(date); setSelectedCourse(payload);
    }).then((stop) => { if (active) unlisten.push(stop); else stop(); });
    void listen<CalendarOccurrence>("widget-open-event", async ({ payload }) => {
      const date = dateInZone(new Date(payload.startUtc), timezone);
      setPage("calendar"); setView("week"); setSelectedDate(date); setMiniMonth(date);
      try {
        const event = await getPersonalEvent(payload.eventId);
        if (event && active) setEditor({ event, occurrence: payload, date });
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "无法读取日程详情"); }
    }).then((stop) => { if (active) unlisten.push(stop); else stop(); });
    void listen<CanvasDeadline>("widget-open-canvas-deadline", ({ payload }) => {
      const date = dateInZone(new Date(payload.dueAt), timezone);
      setPage("calendar"); setView("week"); setSelectedDate(date); setMiniMonth(date); setSelectedCanvasDeadline(payload);
    }).then((stop) => { if (active) unlisten.push(stop); else stop(); });
    return () => { active = false; unlisten.forEach((stop) => stop()); };
  }, [timezone]);
  const range = useMemo(() => {
    if (view === "week") {
      const from = mondayOf(selectedDate);
      return { from, to: addDays(from, 6) };
    }
    if (view === "overview") return { from: monthStart(selectedDate), to: monthEnd(selectedDate) };
    const from = gridStart(selectedDate);
    return { from, to: addDays(from, 41) };
  }, [selectedDate, view]);
  const days = useMemo(() => Array.from({ length: Math.round((Date.parse(range.to + "T00:00:00Z") - Date.parse(range.from + "T00:00:00Z")) / 86400000) + 1 }, (_, index) => addDays(range.from, index)), [range.from, range.to]);
  const overviewItems = useMemo(() => buildOverviewItems(occurrences, canvasDeadlines, timezone), [occurrences, canvasDeadlines, timezone]);
  const grouped = useMemo(() => groupByDay(occurrences, days, timezone), [occurrences, days, timezone]);
  const canvasByDay = useMemo(() => {
    const result = new Map<string, CanvasDeadline[]>();
    for (const item of canvasDeadlines) {
      const date = dateInZone(new Date(item.dueAt), timezone);
      result.set(date, [...(result.get(date) ?? []), item]);
    }
    return result;
  }, [canvasDeadlines, timezone]);
  const coursesByDay = useMemo(() => {
    const result = new Map<string, SjtuCourseOccurrence[]>();
    for (const item of sjtuOccurrences) {
      const date = dateInZone(new Date(item.startUtc), timezone);
      result.set(date, [...(result.get(date) ?? []), item]);
    }
    return result;
  }, [sjtuOccurrences, timezone]);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError(null);
    try {
      const [items, saved, backend, cachedDeadlines, connection, courseItems, academicStatus] = await Promise.all([
        getCalendarOccurrences(range.from, range.to, timezone), listPersonalEvents(), getBackendStatus(),
        getCanvasDeadlines(range.from, range.to, timezone), getCanvasConnectionStatus(),
        getSjtuCourseOccurrences(range.from, range.to, timezone), getSjtuConnectionStatus(),
      ]);
      if (sequence !== refreshSequence.current) return;
      setOccurrences(items);
      setEvents(saved);
      setStatus(backend);
      setCanvasDeadlines(cachedDeadlines);
      setCanvasStatus(connection);
      setSjtuOccurrences(courseItems);
      setSjtuStatus(academicStatus);
    } catch (reason) {
      if (sequence === refreshSequence.current) setError(reason instanceof Error ? reason.message : "读取本地日程失败，请检查应用数据库状态。");
    } finally { if (sequence === refreshSequence.current) setBusy(false); }
  }, [range.from, range.to, timezone]);
  useCalendarUpdates(refresh);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  function navigate(offset: number) {
    const date = view === "week" ? addDays(selectedDate, offset * 7) : shiftMonth(selectedDate, offset);
    setSelectedDate(date);
    setMiniMonth(date);
  }
  function openNew(date = selectedDate, startTime?: string) { setEditor({ date, startTime, includeInOverview: view === "overview" }); }
  async function openItem(item: CalendarOccurrence) {
    try {
      const event = await getPersonalEvent(item.eventId);
      if (event) setEditor({ event, occurrence: item, date: dateInZone(new Date(item.startUtc), timezone) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法读取日程详情"); }
  }
  async function saveItem(draft: EventDraft, scope: "series" | "single") {
    if (!editor) return;
    setEventWorking(true);
    setError(null);
    try {
      if (editor.occurrence && editor.event?.rrule && scope === "single") {
        const singleDraft = { ...draft };
        const override: RecurrenceOverride = {
          title: singleDraft.title, description: singleDraft.description, location: singleDraft.location,
          category: singleDraft.category, startLocal: singleDraft.startLocal, endLocal: singleDraft.endLocal,
          timezone: singleDraft.timezone, allDay: singleDraft.allDay, color: singleDraft.color,
          includeInOverview: singleDraft.includeInOverview,
        };
        await setRecurrenceException(editor.event.id, editor.occurrence.originalStartLocal, "override", override);
      } else if (editor.event) await updatePersonalEvent(editor.event.id, draft);
      else await createPersonalEvent(draft);
      setEditor(null);
      await refresh();
    } finally { setEventWorking(false); }
  }
  async function removeItem(scope: "series" | "single") {
    if (!editor?.event) return;
    setEventWorking(true);
    setError(null);
    try {
      if (editor.occurrence && editor.event.rrule && scope === "single") {
        await setRecurrenceException(editor.event.id, editor.occurrence.originalStartLocal, "cancelled");
      } else await deletePersonalEvent(editor.event.id);
      setEditor(null);
      await refresh();
    } finally { setEventWorking(false); }
  }

  async function markCanvasDeadline(item: CanvasDeadline, completed: boolean) {
    try {
      await setCanvasAssignmentCompleted(item.courseId, item.assignmentId, completed);
      setCanvasDeadlines((current) => current.map((entry) => entry.courseId === item.courseId && entry.assignmentId === item.assignmentId ? { ...entry, localCompleted: completed } : entry));
    } catch (reason) { setCanvasNotice(reason instanceof Error ? reason.message : "无法更新本地完成标记"); }
  }
  async function completeOverviewItem(item: OverviewItem, completed: boolean) {
    setOverviewWorking(true);
    setError(null);
    try {
      if (item.source === "canvas") await setCanvasAssignmentCompleted(item.value.courseId, item.value.assignmentId, completed);
      else await setPersonalEventCompleted(item.value.eventId, item.value.originalStartLocal, completed);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "无法更新 DDL 完成状态"); }
    finally { setOverviewWorking(false); }
  }
  function openOverviewItem(item: OverviewItem) {
    if (item.source === "canvas") setSelectedCanvasDeadline(item.value);
    else void openItem(item.value);
  }
  async function connectCanvas(instance: string, token: string) {
    await saveCanvasCredentials(instance, token);
    setCanvasStatus(await getCanvasConnectionStatus());
    setCanvasNotice("凭据已安全保存。请测试连接以验证 Canvas 账户。");
    await refresh();
  }
  async function runCanvasTest() {
    const profile = await testCanvasConnection();
    setCanvasNotice(`已连接：${profile.name || profile.userId}（${profile.instanceUrl}）`);
    await refresh();
  }
  async function runCanvasSync() {
    const result = await syncCanvas();
    setCanvasNotice(`同步${result.state === "succeeded" ? "完成" : "部分完成"}：${result.courseCount} 门课程，${result.assignmentCount} 项作业${result.failedCourses.length ? `；${result.failedCourses.length} 门课程失败` : ""}`);
    await refresh();
  }
  async function refreshCanvasAssignments() {
    if (!canvasStatus.configured) {
      setCanvasNotice("请先连接 Canvas，然后即可从日历顶部刷新作业。");
      setPage("settings");
      return;
    }
    setBusy(true);
    setError(null);
    try { await runCanvasSync(); }
    catch (reason) { setError(reason instanceof Error ? `Canvas 刷新失败：${reason.message}` : "Canvas 刷新失败"); }
    finally { setBusy(false); }
  }
  async function disconnectCanvas() {
    await clearCanvasCredentials();
    setCanvasStatus({ configured: false, instanceUrl: null, accountVerified: false });
    setCanvasNotice("已从 Windows Credential Manager 移除 Canvas 凭据。");
    setCanvasDeadlines([]);
  }
  async function openSjtuLogin(source: "undergraduate" | "graduate") {
    await startSjtuLogin(source);
    setSjtuNotice("教务登录窗口已打开。请在其中完成交大统一身份认证，然后回到这里点击“保存登录会话”。");
  }
  async function finishSjtuLoginFlow(source: "undergraduate" | "graduate") {
    await finishSjtuLogin(source);
    setSjtuStatus(await getSjtuConnectionStatus());
    setSjtuNotice("登录会话已安全保存。请选择学期信息并刷新课表以验证真实教务响应。");
  }
  async function disconnectSjtu(source: "undergraduate" | "graduate") {
    await clearSjtuLogin(source);
    setSjtuStatus(await getSjtuConnectionStatus());
    setSjtuNotice("已从 Windows Credential Manager 移除教务登录会话。离线课表缓存保留。");
  }
  async function refreshSjtu(source: "undergraduate" | "graduate", year: string, term: "1" | "2" | "3", firstMonday: string, weeks: number) {
    const result = await syncSjtu(source, year, term, firstMonday, weeks);
    setSjtuNotice(`${result.state === "succeeded" ? "课表刷新完成" : "课表部分刷新"}：${result.courseCount} 门课程、${result.meetingCount} 个上课时段${result.skippedRows ? `，跳过 ${result.skippedRows} 条未识别课程` : ""}`);
    await refresh();
  }

  async function saveCourseOccurrenceNote(course: SjtuCourseOccurrence, note: string) {
    await setSjtuOccurrenceNote(course.meetingId, course.weekNumber, note);
    await refresh();
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault(); setPage("calendar"); setEditor({ date: selectedDate, includeInOverview: view === "overview" });
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const offset = event.key === "ArrowLeft" ? -1 : 1;
        const date = view === "week" ? addDays(selectedDate, offset * 7) : shiftMonth(selectedDate, offset);
        setPage("calendar"); setSelectedDate(date); setMiniMonth(date);
      } else if (event.key === "1") {
        event.preventDefault(); setView("week"); setPage("calendar");
      } else if (event.key === "2") {
        event.preventDefault(); setView("month"); setPage("calendar");
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [selectedDate, view]);

  const miniDays = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(gridStart(miniMonth), index)), [miniMonth]);
  const selectedMonth = selectedDate.slice(5, 7);
  const today = todayInZone(timezone);

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">S</span><div><strong>SJTU Schedule</strong><small>个人日历</small></div></div>
      <nav className="side-nav" aria-label="主导航">
        <button className={page === "calendar" && view !== "overview" ? "side-link active" : "side-link"} onClick={() => { setPage("calendar"); if (view === "overview") setView("week"); }} type="button"><span>▦</span>日历</button>
        <button className={page === "calendar" && view === "overview" ? "side-link active" : "side-link"} onClick={() => { const currentDate = todayInZone(timezone); setSelectedDate(currentDate); setMiniMonth(currentDate); setPage("calendar"); setView("overview"); }} type="button"><span aria-hidden="true">◉</span>DDL 总览</button>
        <button className={page === "settings" ? "side-link active" : "side-link"} onClick={() => setPage("settings")} type="button"><span>⚙</span>设置</button>
      </nav>
      <section className="mini-calendar" aria-label="迷你日历">
        <div className="mini-heading"><strong>{displayMonth(miniMonth, timezone)}</strong><div>
          <button aria-label="上个月" onClick={() => setMiniMonth(addDays(monthStart(miniMonth), -1))} type="button">‹</button>
          <button aria-label="下个月" onClick={() => setMiniMonth(addDays(monthEnd(miniMonth), 1))} type="button">›</button>
        </div></div>
        <div className="mini-grid mini-weekdays">{"一二三四五六日".split("").map((day) => <span key={day}>{day}</span>)}</div>
        <div className="mini-grid">{miniDays.map((day) => <button key={day} type="button" className={`mini-day ${day.slice(5, 7) !== miniMonth.slice(5, 7) ? "outside" : ""} ${day === selectedDate ? "selected" : ""} ${day === today ? "today" : ""}`} onClick={() => { setSelectedDate(day); setMiniMonth(day); }}>{Number(day.slice(-2))}</button>)}</div>
      </section>
      <div className="side-section-title">日程来源</div>
      <div className="source-row"><span className="source-dot local" />个人日程 <span className="source-count">{events.length}</span></div>
      <div className="source-row"><span className="source-dot canvas" />Canvas <span className="source-state">{canvasStatus.configured ? `${canvasDeadlines.length} 项缓存` : "待连接"}</span></div>
      <div className="source-row"><span className="source-dot sjtu" />SJTU 教务 <span className="source-state">{sjtuOccurrences.length ? `${sjtuOccurrences.length} 节缓存` : sjtuStatus.undergraduateConfigured || sjtuStatus.graduateConfigured ? "已登录" : "待登录"}</span></div>
      <button className="sidebar-add" onClick={() => openNew()} type="button">＋ 新建日程</button>
      <div className="sidebar-footer"><span className="online-dot" />{status ? `本地 SQLite · v${status.schemaVersion}` : "本地数据"}</div>
    </aside>

    <section className="main-area">
      <header className="topbar">
        <div className="heading"><p className="eyebrow">{page === "calendar" ? "你的安排，一目了然" : "本地偏好设置"}</p><h1>{page === "calendar" ? view === "overview" ? "DDL 总览" : "日历" : "设置"}</h1></div>
        {page === "calendar" ? <>
          <div className={`date-nav ${view === "overview" ? "overview-date-nav" : ""}`}><button aria-label={view === "overview" ? "DDL 上个月" : "上一个时间段"} title={view === "overview" ? "上个月" : undefined} onClick={() => navigate(-1)} type="button">{view === "overview" ? "‹ 上月" : "‹"}</button><button className="today-button" onClick={() => { const currentDate = todayInZone(timezone); setSelectedDate(currentDate); setMiniMonth(currentDate); }} type="button">{view === "overview" ? "本月" : "今天"}</button><button aria-label={view === "overview" ? "DDL 下个月" : "下一个时间段"} title={view === "overview" ? "下个月" : undefined} onClick={() => navigate(1)} type="button">{view === "overview" ? "下月 ›" : "›"}</button><strong>{displayMonth(selectedDate, timezone)}</strong></div>
          <div className="view-switch" role="group" aria-label="日历视图"><button className={view === "week" ? "selected" : ""} onClick={() => setView("week")} type="button">周</button><button className={view === "month" ? "selected" : ""} onClick={() => setView("month")} type="button">月</button></div>
          <button className="widget-open-button" onClick={() => void toggleWidget().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "无法打开 Widget"))} type="button">▣ Widget</button>
          <button className="new-button" onClick={() => openNew()} type="button"><span>＋</span>新建日程</button>
        </> : <div className="topbar-spacer" />}
      </header>

      {page === "settings" ? <><Settings timezone={timezone} onTimezoneChange={setTimezone} /><CanvasSettings canvasStatus={canvasStatus} notice={canvasNotice} onConnect={connectCanvas} onTest={runCanvasTest} onSync={runCanvasSync} onDisconnect={disconnectCanvas} /><SjtuSettings status={sjtuStatus} notice={sjtuNotice} onStart={openSjtuLogin} onFinish={finishSjtuLoginFlow} onDisconnect={disconnectSjtu} onSync={refreshSjtu} /><BackupSettings onRestored={refresh} /></> : <>
        <section className="calendar-toolbar"><div><h2>{view === "week" ? `${displayDate(range.from)} – ${displayDate(range.to)}` : displayMonth(selectedDate, timezone)}</h2><p>{view === "overview" ? "点击日期查看清单 · 本地日程勾选纳入总览 · 每次重复独立完成" : "单击周视图空白时段快捷新建 · Ctrl+N 新建 · Ctrl+←/→ 切换日期 · Ctrl+1/2 周/月视图"}</p></div><button className="refresh-button" aria-label="刷新 Canvas 作业" title={canvasStatus.configured ? "从 Canvas 获取最新作业" : "连接 Canvas 后可刷新作业"} onClick={() => void refreshCanvasAssignments()} disabled={busy} type="button"><span aria-hidden="true">↻</span>刷新 Canvas 作业</button></section>
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => void refresh()} type="button">重试</button></div>}
        {view === "overview" ? <DdlOverview days={days} selectedDate={selectedDate} today={today} timezone={timezone} items={overviewItems} working={overviewWorking || busy} onSelectDate={setSelectedDate} onToggle={completeOverviewItem} onOpen={openOverviewItem} /> : view === "week" ? <WeekView days={days} grouped={grouped} coursesByDay={coursesByDay} selectedDate={selectedDate} today={today} timezone={timezone} onOpenCourse={setSelectedCourse} onSelectDate={setSelectedDate} onOpen={openItem} onNew={openNew} /> : <MonthView days={days} grouped={grouped} coursesByDay={coursesByDay} selectedDate={selectedDate} today={today} selectedMonth={selectedMonth} onSelectDate={setSelectedDate} onOpenCourse={setSelectedCourse} onOpen={openItem} onNew={openNew} />}
        {view !== "overview" && <CanvasDeadlineStrip days={days} deadlines={canvasByDay} timezone={timezone} onComplete={markCanvasDeadline} />}
        <footer className="calendar-footer"><span><i className="online-dot" />数据保存在此设备</span><span>{busy ? "正在读取本地日程…" : `${occurrences.length} 个日程实例`}</span></footer>
      </>}
    </section>
    {editor && <EventEditor key={`${editor.event?.id ?? "new"}-${editor.occurrence?.occurrenceId ?? editor.date}`} editor={editor} timezone={timezone} busy={eventWorking} onClose={() => setEditor(null)} onSave={saveItem} onDelete={removeItem} />}
    {selectedCourse && <CourseDetails course={selectedCourse} onSaveNote={saveCourseOccurrenceNote} onClose={() => setSelectedCourse(null)} />}
    {selectedCanvasDeadline && <CanvasAssignmentDetails deadline={selectedCanvasDeadline} timezone={timezone} onClose={() => setSelectedCanvasDeadline(null)} />}
  </main>;
}

function Settings({ timezone, onTimezoneChange }: { timezone: string; onTimezoneChange: (zone: string) => void }) {
  return <section className="settings-panel"><div className="settings-title"><div className="settings-icon">◷</div><div><h2>日历显示</h2><p>调整个人日程的显示方式。</p></div></div><label className="setting-row"><span><strong>显示时区</strong><small>事件按此时区分组，重复日程仍遵循创建时的时区。</small></span><select aria-label="显示时区" value={timezone} onChange={(event) => onTimezoneChange(event.target.value)}>{ZONES.map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label><div className="settings-note"><span className="online-dot" />显示时区保存在此设备；外部账户凭据由 Windows Credential Manager 管理。</div></section>;
}

function CanvasSettings({ canvasStatus, notice, onConnect, onTest, onSync, onDisconnect }: {
  canvasStatus: CanvasConnectionStatus; notice: string; onConnect: (instance: string, token: string) => Promise<void>;
  onTest: () => Promise<void>; onSync: () => Promise<void>; onDisconnect: () => Promise<void>;
}) {
  const [instance, setInstance] = useState(canvasStatus.instanceUrl ?? "https://oc.sjtu.edu.cn");
  const [token, setToken] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  async function run(action: () => Promise<void>) {
    setWorking(true); setProblem("");
    try { await action(); } catch (reason) { setProblem(reason instanceof Error ? reason.message : "Canvas 操作失败"); }
    finally { setWorking(false); }
  }
  return <section className="settings-panel canvas-settings"><div className="settings-title"><div className="settings-icon">C</div><div><h2>Canvas 同步</h2><p>读取课程与作业截止时间 · {canvasStatus.configured ? "已配置" : "未连接"}</p></div></div>
    <label className="form-field"><span>Canvas 实例</span><select value={instance} onChange={(event) => setInstance(event.target.value)}><option value="https://oc.sjtu.edu.cn">上海交通大学 Canvas</option><option value="https://jicanvas.com">交我算 Canvas</option></select></label>
    <label className="form-field"><span>个人访问令牌</span><input type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={canvasStatus.configured ? "已保存；输入新令牌可替换" : "在 Canvas 账户设置中生成令牌"} /></label>
    <p className="settings-help">令牌保存在 Windows Credential Manager，不会写入日历数据库或日志。请在 Canvas 账户设置中自行生成。</p>
    {canvasStatus.configured && !canvasStatus.accountVerified && <p className="settings-feedback">请先测试连接或立即同步以确认当前账户，确认前暂不显示历史账户的作业缓存。</p>}
    <div className="settings-actions"><button className="save-button" disabled={working || !token.trim()} onClick={() => void run(async () => { await onConnect(instance, token); setToken(""); })} type="button">安全保存令牌</button><button className="cancel-button" disabled={working || !canvasStatus.configured} onClick={() => void run(onTest)} type="button">测试连接</button><button className="cancel-button" disabled={working || !canvasStatus.configured} onClick={() => void run(onSync)} type="button">立即同步</button><button className="delete-button" disabled={working || !canvasStatus.configured} onClick={() => void run(onDisconnect)} type="button">断开连接</button></div>
    {problem && <div className="error-banner" role="alert">{problem}</div>}{notice && <p className="settings-feedback" role="status">{notice}</p>}
  </section>;
}

function SjtuSettings({ status, notice, onStart, onFinish, onDisconnect, onSync }: {
  status: SjtuConnectionStatus; notice: string;
  onStart: (source: "undergraduate" | "graduate") => Promise<void>;
  onFinish: (source: "undergraduate" | "graduate") => Promise<void>;
  onDisconnect: (source: "undergraduate" | "graduate") => Promise<void>;
  onSync: (source: "undergraduate" | "graduate", year: string, term: "1" | "2" | "3", startDate: string, weeks: number) => Promise<void>;
}) {
  const [source, setSource] = useState<"undergraduate" | "graduate">("undergraduate");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [term, setTerm] = useState<"1" | "2" | "3">("1");
  const initialSuggestion = suggestSjtuTermMetadata(String(new Date().getFullYear()), "1");
  const [startDate, setStartDate] = useState(initialSuggestion?.firstMonday ?? "");
  const [weekCount, setWeekCount] = useState(initialSuggestion?.weekCount ?? 16);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  const configured = source === "undergraduate" ? status.undergraduateConfigured : status.graduateConfigured;
  const suggestion = suggestSjtuTermMetadata(year, term);
  async function run(action: () => Promise<void>) {
    setWorking(true); setProblem("");
    try { await action(); } catch (reason) { setProblem(reason instanceof Error ? reason.message : "教务操作失败"); }
    finally { setWorking(false); }
  }
  return <section className="settings-panel sjtu-settings"><div className="settings-title"><div className="settings-icon">SJ</div><div><h2>SJTU 教务课表</h2><p>登录由你在独立的交大页面中完成；会话保存在 Windows Credential Manager。</p></div><span className={`connection-pill ${configured ? "connected" : ""}`}>{configured ? "已保存会话" : "未登录"}</span></div>
    <label className="form-field"><span>教务系统</span><select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="undergraduate">本科生教务</option><option value="graduate">研究生教务</option></select></label>
    <div className="settings-actions"><button className="cancel-button" disabled={working} onClick={() => void run(() => onStart(source))} type="button">打开交大登录窗口</button><button className="cancel-button" disabled={working} onClick={() => void run(() => onFinish(source))} type="button">保存登录会话</button><button className="delete-button" disabled={working || !configured} onClick={() => void run(() => onDisconnect(source))} type="button">断开教务</button></div>
    <div className="form-two sjtu-term-fields"><label className="form-field"><span>学年起始年份</span><input inputMode="numeric" value={year} onChange={(event) => { const next = event.target.value; setYear(next); const nextSuggestion = suggestSjtuTermMetadata(next, term); setStartDate(nextSuggestion?.firstMonday ?? ""); if (nextSuggestion) setWeekCount(nextSuggestion.weekCount); }} /></label><label className="form-field"><span>学期</span><select value={term} onChange={(event) => { const next = event.target.value as typeof term; setTerm(next); const nextSuggestion = suggestSjtuTermMetadata(year, next); setStartDate(nextSuggestion?.firstMonday ?? ""); if (nextSuggestion) setWeekCount(nextSuggestion.weekCount); }}>{/* options */}<option value="1">秋季（学年第一学期）</option><option value="2">春季（学年第二学期）</option><option value="3">夏季（学年第三学期）</option></select></label></div>
    <div className="form-two sjtu-term-fields"><label className="form-field"><span>第 1 教学周的周一</span><input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label className="form-field"><span>教学周数（1–24）</span><input type="number" min={1} max={24} value={weekCount} onChange={(event) => setWeekCount(Number(event.target.value))} /></label></div>
    <p className="settings-help">{suggestion ? `已根据上海交大教务处公告预填第 1 周周一和 ${suggestion.weekCount} 周；如你的校区或培养方案不同，可在同步前修改。` : "该学期暂无已核实的校历日期；请选择教务处公布的第 1 周周一。"} 课程时间按交大节次表映射。</p>
    <button className="save-button" disabled={working || !configured || !startDate || !year.trim()} onClick={() => void run(() => onSync(source, year, term, startDate, weekCount))} type="button">刷新课表</button>
    {problem && <div className="error-banner" role="alert">{problem}</div>}{notice && <p className="settings-feedback" role="status">{notice}</p>}
  </section>;
}

function BackupSettings({ onRestored }: { onRestored: () => Promise<void> }) {
  const [backupJson, setBackupJson] = useState("");
  const [fileName, setFileName] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  async function exportBackup() {
    setWorking(true); setProblem(""); setMessage("");
    try {
      const savedPath = await exportDataBackup();
      if (savedPath) setMessage(`备份已保存到：${savedPath}`);
    } catch (reason) { setProblem(reason instanceof Error ? reason.message : "导出备份失败"); }
    finally { setWorking(false); }
  }
  async function restoreBackup() {
    if (!backupJson || !window.confirm("恢复将替换本机日历、教务和 Canvas 缓存。应用会先保留当前数据库副本；恢复后需要重新测试外部账户连接。继续恢复吗？")) return;
    setWorking(true); setProblem(""); setMessage("");
    try {
      const version = await restoreDataBackup(backupJson);
      setBackupJson(""); setFileName("");
      await onRestored();
      setMessage(`恢复完成（数据库 v${version}）。外部账户凭据未包含在备份中。`);
    } catch (reason) { setProblem(reason instanceof Error ? reason.message : "恢复备份失败"); }
    finally { setWorking(false); }
  }
  return <section className="settings-panel backup-settings"><div className="settings-title"><div className="settings-icon">DB</div><div><h2>数据备份与恢复</h2><p>备份本地日程和同步缓存；Credential Manager 中的外部账户凭据不包含在内。</p></div></div>
    <div className="settings-actions"><button className="save-button" disabled={working} onClick={() => void exportBackup()} type="button">导出数据库备份</button></div>
    <p className="settings-help">选择备份的保存位置，默认打开 Downloads（下载）文件夹。</p>
    <label className="form-field"><span>从备份恢复</span><input type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; setFileName(file?.name ?? ""); setProblem(""); setMessage(""); void file?.text().then(setBackupJson).catch(() => setProblem("无法读取备份文件")); }} /></label>
    {fileName && <p className="settings-help">已选择：{fileName}</p>}
    <button className="cancel-button" disabled={working || !backupJson} onClick={() => void restoreBackup()} type="button">验证并恢复备份</button>
    {problem && <div className="error-banner" role="alert">{problem}</div>}{message && <p className="settings-feedback" role="status">{message}</p>}
  </section>;
}

function CourseDetails({ course, onClose, onSaveNote }: { course: SjtuCourseOccurrence; onClose: () => void; onSaveNote: (course: SjtuCourseOccurrence, note: string) => Promise<void> }) {
  const [note, setNote] = useState(course.note);
  const [savingNote, setSavingNote] = useState(false);
  const [noteMessage, setNoteMessage] = useState("");
  const timeFormat: Intl.DateTimeFormatOptions = { timeZone: course.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  async function saveNote() {
    setSavingNote(true); setNoteMessage("");
    try { await onSaveNote(course, note); setNoteMessage(note.trim() ? "备注已保存" : "备注已移除"); }
    catch { setNoteMessage("保存失败，请重试"); }
    finally { setSavingNote(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="event-modal course-details" role="dialog" aria-modal="true" aria-labelledby="course-details-title"><header className="modal-header"><div><p className="eyebrow">{course.sourceSystem === "undergraduate" ? "本科教务" : "研究生教务"} · 第 {course.weekNumber} 周</p><h2 id="course-details-title">{course.title}</h2></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></header><div className="form-scroll"><p><strong>时间：</strong>{new Intl.DateTimeFormat("zh-CN", { ...timeFormat, weekday: "long", month: "long", day: "numeric" }).format(new Date(course.startUtc))} · {new Intl.DateTimeFormat("zh-CN", timeFormat).format(new Date(course.startUtc))}–{new Intl.DateTimeFormat("zh-CN", timeFormat).format(new Date(course.endUtc))}</p><p><strong>地点：</strong>{course.location || "未提供"}</p><p><strong>教师：</strong>{course.teacher || "未提供"}</p><p><strong>节次：</strong>第 {course.startSection}–{course.endSection} 节</p><label className="form-field course-note-field"><span>本次课的备注</span><textarea aria-label="本次课的备注" maxLength={2000} rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：带实验报告、去办公室答疑" /></label>{noteMessage && <p role="status" className="settings-feedback">{noteMessage}</p>}</div><footer className="modal-actions"><button className="cancel-button" type="button" onClick={onClose}>关闭</button><button className="save-button" type="button" disabled={savingNote} onClick={() => void saveNote()}>{savingNote ? "保存中…" : "保存备注"}</button></footer></section></div>;
}

function CanvasAssignmentDetails({ deadline, timezone, onClose }: { deadline: CanvasDeadline; timezone: string; onClose: () => void }) {
  const due = new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, dateStyle: "full", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(deadline.dueAt));
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="event-modal course-details" role="dialog" aria-modal="true" aria-labelledby="canvas-details-title"><header className="modal-header"><div><p className="eyebrow">Canvas 作业</p><h2 id="canvas-details-title">{deadline.title}</h2></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></header><div className="form-scroll"><p><strong>课程：</strong>{deadline.courseName}</p><p><strong>截止：</strong>{due}</p><p><strong>提交状态：</strong>{canvasSubmissionLabel(deadline)}</p>{deadline.description && <p className="canvas-detail-description">{deadline.description}</p>}<p><strong>Canvas 链接：</strong><a href={deadline.htmlUrl} target="_blank" rel="noreferrer">{deadline.htmlUrl}</a></p></div><footer className="modal-actions"><button className="cancel-button" type="button" onClick={onClose}>关闭</button></footer></section></div>;
}

function intervalLabel(startUtc: string, endUtc: string, timezone: string) {
  const format: Intl.DateTimeFormatOptions = { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  return `${new Intl.DateTimeFormat("zh-CN", format).format(new Date(startUtc))}–${new Intl.DateTimeFormat("zh-CN", format).format(new Date(endUtc))}`;
}

function CanvasDeadlineStrip({ days, deadlines, timezone, onComplete }: { days: string[]; deadlines: Map<string, CanvasDeadline[]>; timezone: string; onComplete: (item: CanvasDeadline, completed: boolean) => void }) {
  return <section className="canvas-strip" aria-label="Canvas 截止事项">{days.map((day) => <div className="canvas-strip-day" key={day}>{(deadlines.get(day) ?? []).map((item) => <div className={`canvas-deadline ${canvasCompleted(item) ? "completed" : ""}`} key={`${item.courseId}-${item.assignmentId}`}><label><input type="checkbox" aria-label={`标记 ${item.title} 完成`} checked={canvasCompleted(item)} disabled={canvasRemotelyCompleted(item)} title={canvasSubmissionLabel(item)} onChange={(event) => onComplete(item, event.target.checked)} /><a href={item.htmlUrl} target="_blank" rel="noreferrer" title={item.courseName}>{item.title}</a></label><small>{canvasSubmissionLabel(item)} · {item.courseName} · {new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(item.dueAt))}</small></div>)}</div>)}</section>;
}

function WeekView({ days, grouped, coursesByDay, selectedDate, today, timezone, onOpenCourse, onSelectDate, onOpen, onNew }: {
  days: string[]; grouped: Map<string, CalendarOccurrence[]>; coursesByDay: Map<string, SjtuCourseOccurrence[]>; selectedDate: string; today: string; timezone: string;
  onOpenCourse: (item: SjtuCourseOccurrence) => void; onSelectDate: (date: string) => void; onOpen: (item: CalendarOccurrence) => void; onNew: (date: string, startTime?: string) => void;
}) {
  function quickAddFromTimeSlot(event: ReactMouseEvent<HTMLDivElement>, day: string) {
    const target = event.target as Element;
    if (target.closest("button")) return;
    if (target !== event.currentTarget && !target.classList.contains("hour-line")) return;
    const elapsed = Math.max(0, Math.min((LAST_HOUR - FIRST_HOUR + 1) * 60 - 1,
      Math.floor((event.clientY - event.currentTarget.getBoundingClientRect().top) / HOUR_HEIGHT * 60)));
    const quarterHour = Math.min((LAST_HOUR - FIRST_HOUR + 1) * 60 - 15, Math.round(elapsed / 15) * 15);
    const totalMinutes = FIRST_HOUR * 60 + quarterHour;
    onNew(day, `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`);
  }
  return <section className="week-view" aria-label="周日历">
    <div className="week-head"><div className="time-gutter" />{days.map((day) => <button key={day} className={`day-heading ${day === selectedDate ? "focus" : ""} ${day === today ? "is-today" : ""}`} onClick={() => onSelectDate(day)} type="button"><span>{weekday(day)}</span><strong>{Number(day.slice(-2))}</strong><small>{(grouped.get(day) ?? []).length ? "有日程" : ""}</small></button>)}</div>
    <div className="week-scroll"><div className="time-grid"><div className="time-gutter">{Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => <span style={{ top: `${i * HOUR_HEIGHT - 8}px` }} key={i}>{String(FIRST_HOUR + i).padStart(2, "0")}:00</span>)}</div>{days.map((day) => {
      const timed = [...(grouped.get(day) ?? []).filter((item) => item.category !== "deadline" && !item.allDay), ...(coursesByDay.get(day) ?? [])];
      const overlapLayout = layoutOverlaps(timed);
      return <div className="time-column" key={day} onClick={(event) => quickAddFromTimeSlot(event, day)} title="单击空白时段快速添加日程">{Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => <span className="hour-line" style={{ top: `${i * HOUR_HEIGHT}px` }} key={i} />)}{timed.map((item) => {
        const segment = dayMinutes(item, day, timezone);
        const start = Math.max(FIRST_HOUR * 60, segment.start);
        const end = Math.min((LAST_HOUR + 1) * 60, segment.end);
        if (end <= start) return null;
        const top = (start / 60 - FIRST_HOUR) * HOUR_HEIGHT;
        const height = Math.min(Math.max(27, (end - start) / 60 * HOUR_HEIGHT), ((LAST_HOUR + 1) * 60 - start) / 60 * HOUR_HEIGHT);
        const position = overlapLayout.get(item.occurrenceId) ?? { column: 0, columns: 1 };
        const isCourse = "courseId" in item;
        const hasNote = "courseId" in item && item.note.length > 0;
        return <button className={`event-block ${isCourse ? "course-block" : ""}`} style={{ top: `${Math.max(0, top)}px`, height: `${height}px`, left: `calc(${position.column * 100 / position.columns}% + 3px)`, right: `calc(${(position.columns - position.column - 1) * 100 / position.columns}% + 3px)`, borderLeftColor: item.color }} key={item.occurrenceId} onClick={() => isCourse ? onOpenCourse(item) : onOpen(item)} type="button">{hasNote && <span className="course-note-star" aria-label="含备注">★</span>}<strong>{item.title}</strong><span>{isCourse ? intervalLabel(item.startUtc, item.endUtc, timezone) : timeLabel(item, timezone)}</span>{height > 54 && item.location && <small>{item.location}</small>}{isCourse && height > 74 && item.teacher && <small>{item.teacher}</small>}</button>;
      })}</div>;
    })}</div></div>
    <div className="deadline-row"><div className="deadline-label">全天 / DDL</div>{days.map((day) => { const items = (grouped.get(day) ?? []).filter((item) => item.category === "deadline" || item.allDay); return <div className="deadline-cell" key={day} onDoubleClick={() => onNew(day)}>{items.length ? items.map((item) => <button key={item.occurrenceId} className={`deadline-chip ${item.category === "deadline" ? "deadline" : "all-day"}`} onClick={() => onOpen(item)} type="button"><span>{item.category === "deadline" ? "◆" : "●"}</span>{item.title}</button>) : <button className="add-inline" onClick={() => onNew(day)} aria-label={`${day} 新建日程`} type="button">＋</button>}</div>; })}</div>
  </section>;
}

function MonthView({ days, grouped, coursesByDay, selectedDate, today, selectedMonth, onSelectDate, onOpenCourse, onOpen, onNew }: {
  days: string[]; grouped: Map<string, CalendarOccurrence[]>; coursesByDay: Map<string, SjtuCourseOccurrence[]>; selectedDate: string; today: string; selectedMonth: string;
  onSelectDate: (date: string) => void; onOpenCourse: (item: SjtuCourseOccurrence) => void; onOpen: (item: CalendarOccurrence) => void; onNew: (date: string) => void;
}) {
  return <section className="month-view" aria-label="月日历"><div className="month-weekdays">{"一二三四五六日".split("").map((day) => <span key={day}>{day}</span>)}</div><div className="month-grid">{days.map((day) => {
    const items = grouped.get(day) ?? [];
    const courses = coursesByDay.get(day) ?? [];
    const visibleLocal = items.slice(0, 3);
    const visibleCourses = courses.slice(0, Math.max(0, 3 - visibleLocal.length));
    return <div role="button" tabIndex={0} className={`month-cell ${day.slice(5, 7) !== selectedMonth ? "outside" : ""} ${day === selectedDate ? "chosen" : ""} ${day === today ? "is-today" : ""}`} key={day} onClick={() => onSelectDate(day)} onDoubleClick={() => onNew(day)} onKeyDown={(event) => { if (event.key === "Enter") onSelectDate(day); }}><span className="month-date">{Number(day.slice(-2))}</span>{visibleLocal.map((item) => <button key={item.occurrenceId} className={`month-event ${item.category === "deadline" ? "deadline" : ""}`} style={{ borderLeftColor: item.color }} onClick={(event) => { event.stopPropagation(); onOpen(item); }} type="button">{item.title}</button>)}{visibleCourses.map((item) => <button key={item.occurrenceId} className="month-event course-month-event" style={{ borderLeftColor: item.color }} onClick={(event) => { event.stopPropagation(); onOpenCourse(item); }} type="button">{item.note && <span className="month-course-star" aria-label="含备注">★</span>}{item.title}</button>)}{items.length + courses.length > 3 && <small className="more-events">+{items.length + courses.length - 3} 项</small>}</div>;
  })}</div></section>;
}

type EventEditorProps = {
  editor: EditorState; timezone: string; busy: boolean; onClose: () => void;
  onSave: (draft: EventDraft, scope: "series" | "single") => Promise<void>;
  onDelete: (scope: "series" | "single") => Promise<void>;
};

function EventEditor(props: EventEditorProps) {
  const [scope, setScope] = useState<"single" | "series">(props.editor.event?.rrule && props.editor.occurrence ? "single" : "series");
  return <EventEditorForm key={scope} {...props} scope={scope} onScopeChange={setScope} />;
}

function EventEditorForm({ editor, timezone, busy: backendBusy, onClose, onSave, onDelete, scope, onScopeChange }: EventEditorProps & { scope: "single" | "series"; onScopeChange: (scope: "single" | "series") => void }) {
  const initial = scope === "single" && editor.event && editor.occurrence ? {
    ...editor.event,
    title: editor.occurrence.title,
    description: editor.occurrence.description,
    location: editor.occurrence.location,
    category: editor.occurrence.category,
    startLocal: localDateTime(editor.occurrence.startUtc, editor.occurrence.timezone),
    endLocal: localDateTime(editor.occurrence.endUtc, editor.occurrence.timezone),
    timezone: editor.occurrence.timezone,
    allDay: editor.occurrence.allDay,
    color: editor.occurrence.color,
    includeInOverview: editor.occurrence.includeInOverview,
  } : editor.event ?? { ...emptyDraft(editor.date, timezone, editor.startTime), includeInOverview: editor.includeInOverview ?? false };
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [location, setLocation] = useState(initial.location);
  const [category, setCategory] = useState<EventDraft["category"]>(initial.category);
  const [start, setStart] = useState(initial.startLocal.slice(0, 16));
  const [end, setEnd] = useState(initial.endLocal.slice(0, 16));
  const [eventZone, setEventZone] = useState(initial.timezone);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [includeInOverview, setIncludeInOverview] = useState(initial.includeInOverview ?? initial.category === "deadline");
  const [repeat, setRepeat] = useState(initial.rrule ?? "");
  const [color, setColor] = useState(initial.color);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const recurringOccurrence = !!editor.occurrence && !!editor.event?.rrule;
  const draft: EventDraft = {
    title, description, location, category, startLocal: localValue(start), endLocal: localValue(end), timezone: eventZone,
    allDay, rrule: repeat || null, color, includeInOverview,
  };
  function changeStart(value: string) {
    if (value && end && value >= end) {
      const duration = Math.max(60_000, Date.parse(end + "Z") - Date.parse(start + "Z")) || 3_600_000;
      const nextEnd = new Date(Date.parse(value + "Z") + duration);
      if (Number.isFinite(nextEnd.getTime())) setEnd(nextEnd.toISOString().slice(0, 16));
    }
    setStart(value); setSubmitError("");
  }
  async function run(action: () => Promise<void>) {
    if (submitLock.current) return;
    submitLock.current = true; setSubmitting(true); setSubmitError("");
    try { await action(); }
    catch (reason) { setSubmitError(reason instanceof Error ? reason.message : String(reason)); }
    finally { submitLock.current = false; setSubmitting(false); }
  }
  function submit(event: FormEvent, scope: "series" | "single") {
    event.preventDefault();
    if (!title.trim()) { setSubmitError("请输入日程标题"); return; }
    if (!start || !end || end <= start) { setSubmitError("结束时间必须晚于开始时间，请检查日期和时间。"); return; }
    void run(() => onSave({ ...draft, title: title.trim() }, scope));
  }
  const busy = backendBusy || submitting;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}><form className="event-modal" role="dialog" aria-modal="true" aria-labelledby="event-modal-title" onSubmit={(event) => submit(event, scope)}>
    <header className="modal-header"><div><p className="eyebrow">{editor.event ? "编辑本地日程" : "添加到个人日历"}</p><h2 id="event-modal-title">{editor.event ? "日程详情" : "新建日程"}</h2></div><button type="button" disabled={busy} aria-label="关闭" onClick={onClose}>×</button></header>
    <div className="form-scroll">{recurringOccurrence && <label className="form-field"><span>编辑范围（切换后重新载入对应日程）</span><select aria-label="编辑范围" value={scope} disabled={busy} onChange={(event) => onScopeChange(event.target.value as "single" | "series")}><option value="single">仅本次</option><option value="series">整个系列</option></select></label>}<label className="form-field"><span>标题</span><input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：项目讨论" /></label>
      <div className="form-two"><label className="form-field"><span>类型</span><select value={category} onChange={(event) => { const value = event.target.value as EventDraft["category"]; setCategory(value); if (value === "deadline") setIncludeInOverview(true); }}><option value="event">日程</option><option value="deadline">截止事项</option></select></label><label className="form-field"><span>重复</span><select value={repeat} disabled={recurringOccurrence && scope === "single"} onChange={(event) => setRepeat(event.target.value)}><option value="">不重复</option><option value="FREQ=DAILY">每天</option><option value="FREQ=WEEKLY">每周</option><option value="FREQ=WEEKLY;INTERVAL=2">每两周</option>{repeat && !["FREQ=DAILY", "FREQ=WEEKLY", "FREQ=WEEKLY;INTERVAL=2"].includes(repeat) && <option value={repeat}>自定义规则（保留）</option>}</select></label></div>
      <div className="form-two"><label className="form-field"><span>开始</span><input required type="datetime-local" value={start} onChange={(event) => changeStart(event.target.value)} /></label><label className="form-field"><span>结束</span><input required type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>
      <div className="form-two"><label className="form-field"><span>时区</span><select value={eventZone} onChange={(event) => setEventZone(event.target.value)}>{ZONES.map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label><label className="form-field color-field"><span>颜色</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label></div>
      <label className="check-field"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />全天事件</label>
      <label className="check-field"><input type="checkbox" checked={includeInOverview} onChange={(event) => setIncludeInOverview(event.target.checked)} />纳入 DDL 总览（按开始日期统计）</label>
      <label className="form-field"><span>地点</span><input maxLength={200} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="添加地点" /></label>
      <label className="form-field"><span>备注</span><textarea rows={3} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="添加说明" /></label>
      {submitError && <div className="error-banner" role="alert">{submitError}</div>}
    </div>
    <footer className="modal-actions"><div>{editor.event && <button className="delete-button" disabled={busy} onClick={() => void run(() => onDelete(scope))} type="button">{recurringOccurrence ? scope === "single" ? "仅删除此项" : "删除整个系列" : "删除日程"}</button>}</div><div><button className="cancel-button" disabled={busy} onClick={onClose} type="button">取消</button><button className="save-button" disabled={busy} type="submit">{busy ? "处理中…" : recurringOccurrence ? scope === "single" ? "保存此项" : "保存整个系列" : "保存"}</button></div></footer>
  </form></div>;
}

export default App;

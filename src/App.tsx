import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  createPersonalEvent, deletePersonalEvent, getBackendStatus, getCalendarOccurrences, getCanvasConnectionStatus, getCanvasDeadlines, setCanvasAssignmentCompleted, saveCanvasCredentials, clearCanvasCredentials, testCanvasConnection, syncCanvas,
  getPersonalEvent, listPersonalEvents, setRecurrenceException, updatePersonalEvent,
  type BackendStatus, type CalendarOccurrence, type EventDraft, type PersonalEvent, type CanvasConnectionStatus, type CanvasDeadline,
  type RecurrenceOverride,
} from "./lib/backend";
import "./App.css";

type View = "week" | "month";
type EditorState = { event?: PersonalEvent; occurrence?: CalendarOccurrence; date: string };
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
function clock(utc: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(utc));
  return { hour: Number(parts.find((part) => part.type === "hour")?.value), minute: Number(parts.find((part) => part.type === "minute")?.value) };
}
function timeLabel(item: CalendarOccurrence, timezone: string) {
  if (item.allDay) return "全天";
  const format: Intl.DateTimeFormatOptions = { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  const start = new Intl.DateTimeFormat("zh-CN", format).format(new Date(item.startUtc));
  const end = new Intl.DateTimeFormat("zh-CN", format).format(new Date(item.endUtc));
  return `${start}–${end}`;
}
function localNow(timezone: string, date: string) {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const part = (type: string) => now.find((entry) => entry.type === type)?.value ?? "00";
  const key = `${part("year")}-${part("month")}-${part("day")}`;
  return key === date ? `${part("hour")}:${part("minute")}` : "09:00";
}
function localValue(value: string) { return value.length === 16 ? `${value}:00` : value; }
function emptyDraft(date: string, timezone: string): EventDraft {
  const time = localNow(timezone, date);
  const [hour, minute] = time.split(":").map(Number);
  const end = `${String((hour + 1) % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { title: "", description: "", location: "", category: "event", startLocal: `${date}T${time}:00`, endLocal: `${hour === 23 ? addDays(date, 1) : date}T${end}:00`, timezone, allDay: false, rrule: null, color: "#4f46e5" };
}
function repeatLabel(rule: string | null) {
  if (!rule) return "不重复";
  if (/FREQ=DAILY/.test(rule)) return "每天";
  if (/INTERVAL=2/.test(rule)) return "每两周";
  return "每周";
}
function localDateTime(utc: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(utc));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}
function layoutOverlaps(items: CalendarOccurrence[]) {
  const sorted = [...items].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  const layout = new Map<string, { column: number; columns: number }>();
  let cluster: CalendarOccurrence[] = [];
  let clusterEnd = -Infinity;
  const placeCluster = () => {
    const slots: CalendarOccurrence[][] = [];
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
  const [canvasStatus, setCanvasStatus] = useState<CanvasConnectionStatus>({ configured: false, instanceUrl: null });
  const [canvasNotice, setCanvasNotice] = useState("");
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<"calendar" | "settings">("calendar");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const refreshSequence = useRef(0);

  useEffect(() => { localStorage.setItem("calendar-timezone", timezone); }, [timezone]);
  const range = useMemo(() => {
    if (view === "week") {
      const from = mondayOf(selectedDate);
      return { from, to: addDays(from, 6) };
    }
    const from = gridStart(selectedDate);
    return { from, to: addDays(from, 41) };
  }, [selectedDate, view]);
  const days = useMemo(() => Array.from({ length: view === "week" ? 7 : 42 }, (_, index) => addDays(range.from, index)), [range.from, view]);
  const grouped = useMemo(() => {
    const result = new Map<string, CalendarOccurrence[]>();
    for (const item of occurrences) {
      const date = dateInZone(new Date(item.startUtc), timezone);
      result.set(date, [...(result.get(date) ?? []), item]);
    }
    return result;
  }, [occurrences, timezone]);
  const canvasByDay = useMemo(() => {
    const result = new Map<string, CanvasDeadline[]>();
    for (const item of canvasDeadlines) {
      const date = dateInZone(new Date(item.dueAt), timezone);
      result.set(date, [...(result.get(date) ?? []), item]);
    }
    return result;
  }, [canvasDeadlines, timezone]);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError(null);
    try {
      const [items, saved, backend, cachedDeadlines, connection] = await Promise.all([
        getCalendarOccurrences(range.from, range.to, timezone), listPersonalEvents(), getBackendStatus(),
        getCanvasDeadlines(range.from, range.to, timezone), getCanvasConnectionStatus(),
      ]);
      if (sequence !== refreshSequence.current) return;
      setOccurrences(items);
      setEvents(saved);
      setStatus(backend);
      setCanvasDeadlines(cachedDeadlines);
      setCanvasStatus(connection);
    } catch (reason) {
      if (sequence === refreshSequence.current) setError(reason instanceof Error ? reason.message : "读取本地日程失败，请检查应用数据库状态。");
    } finally { if (sequence === refreshSequence.current) setBusy(false); }
  }, [range.from, range.to, timezone]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  function navigate(offset: number) {
    const date = view === "week" ? addDays(selectedDate, offset * 7) : shiftMonth(selectedDate, offset);
    setSelectedDate(date);
    setMiniMonth(date);
  }
  function openNew(date = selectedDate) { setEditor({ date }); }
  async function openItem(item: CalendarOccurrence) {
    try {
      const event = await getPersonalEvent(item.eventId);
      if (event) setEditor({ event, occurrence: item, date: dateInZone(new Date(item.startUtc), timezone) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法读取日程详情"); }
  }
  async function saveItem(draft: EventDraft, scope: "series" | "single") {
    if (!editor) return;
    setBusy(true);
    setError(null);
    try {
      if (editor.occurrence && editor.event?.rrule && scope === "single") {
        const singleDraft = { ...draft };
        const override: RecurrenceOverride = {
          title: singleDraft.title, description: singleDraft.description, location: singleDraft.location,
          category: singleDraft.category, startLocal: singleDraft.startLocal, endLocal: singleDraft.endLocal,
          timezone: singleDraft.timezone, allDay: singleDraft.allDay, color: singleDraft.color,
        };
        await setRecurrenceException(editor.event.id, editor.occurrence.originalStartLocal, "override", override);
      } else if (editor.event) await updatePersonalEvent(editor.event.id, draft);
      else await createPersonalEvent(draft);
      setEditor(null);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请检查日程信息。"); }
    finally { setBusy(false); }
  }
  async function removeItem(scope: "series" | "single") {
    if (!editor?.event) return;
    setBusy(true);
    setError(null);
    try {
      if (editor.occurrence && editor.event.rrule && scope === "single") {
        await setRecurrenceException(editor.event.id, editor.occurrence.originalStartLocal, "cancelled");
      } else await deletePersonalEvent(editor.event.id);
      setEditor(null);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); }
    finally { setBusy(false); }
  }

  async function markCanvasDeadline(item: CanvasDeadline, completed: boolean) {
    try {
      await setCanvasAssignmentCompleted(item.courseId, item.assignmentId, completed);
      setCanvasDeadlines((current) => current.map((entry) => entry.courseId === item.courseId && entry.assignmentId === item.assignmentId ? { ...entry, localCompleted: completed } : entry));
    } catch (reason) { setCanvasNotice(reason instanceof Error ? reason.message : "无法更新本地完成标记"); }
  }
  async function connectCanvas(instance: string, token: string) {
    await saveCanvasCredentials(instance, token);
    setCanvasStatus(await getCanvasConnectionStatus());
    setCanvasNotice("凭据已安全保存。请测试连接以验证 Canvas 账户。");
  }
  async function runCanvasTest() {
    const profile = await testCanvasConnection();
    setCanvasNotice(`已连接：${profile.name || profile.userId}（${profile.instanceUrl}）`);
  }
  async function runCanvasSync() {
    const result = await syncCanvas();
    setCanvasNotice(`同步${result.state === "succeeded" ? "完成" : "部分完成"}：${result.courseCount} 门课程，${result.assignmentCount} 项作业${result.failedCourses.length ? `；${result.failedCourses.length} 门课程失败` : ""}`);
    await refresh();
  }
  async function disconnectCanvas() {
    await clearCanvasCredentials();
    setCanvasStatus({ configured: false, instanceUrl: null });
    setCanvasNotice("已从 Windows Credential Manager 移除 Canvas 凭据。");
    setCanvasDeadlines([]);
  }

  const miniDays = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(gridStart(miniMonth), index)), [miniMonth]);
  const selectedMonth = selectedDate.slice(5, 7);
  const today = todayInZone(timezone);

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">S</span><div><strong>SJTU Schedule</strong><small>个人日历</small></div></div>
      <nav className="side-nav" aria-label="主导航">
        <button className={page === "calendar" ? "side-link active" : "side-link"} onClick={() => setPage("calendar")} type="button"><span>▦</span>日历</button>
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
      <div className="source-row muted"><span className="source-dot sjtu" />SJTU 教务 <span className="source-state">待连接</span></div>
      <button className="sidebar-add" onClick={() => openNew()} type="button">＋ 新建日程</button>
      <div className="sidebar-footer"><span className="online-dot" />{status ? `本地 SQLite · v${status.schemaVersion}` : "本地数据"}</div>
    </aside>

    <section className="main-area">
      <header className="topbar">
        <div className="heading"><p className="eyebrow">{page === "calendar" ? "你的安排，一目了然" : "本地偏好设置"}</p><h1>{page === "calendar" ? "日历" : "设置"}</h1></div>
        {page === "calendar" ? <>
          <div className="date-nav"><button aria-label="上一个时间段" onClick={() => navigate(-1)} type="button">‹</button><button className="today-button" onClick={() => { setSelectedDate(today); setMiniMonth(today); }} type="button">今天</button><button aria-label="下一个时间段" onClick={() => navigate(1)} type="button">›</button><strong>{displayMonth(selectedDate, timezone)}</strong></div>
          <div className="view-switch" role="group" aria-label="日历视图"><button className={view === "week" ? "selected" : ""} onClick={() => setView("week")} type="button">周</button><button className={view === "month" ? "selected" : ""} onClick={() => setView("month")} type="button">月</button></div>
          <button className="new-button" onClick={() => openNew()} type="button"><span>＋</span>新建日程</button>
        </> : <div className="topbar-spacer" />}
      </header>

      {page === "settings" ? <><Settings timezone={timezone} onTimezoneChange={setTimezone} /><CanvasSettings canvasStatus={canvasStatus} notice={canvasNotice} onConnect={connectCanvas} onTest={runCanvasTest} onSync={runCanvasSync} onDisconnect={disconnectCanvas} /></> : <>
        <section className="calendar-toolbar"><div><h2>{view === "week" ? `${displayDate(range.from)} – ${displayDate(range.to)}` : displayMonth(selectedDate, timezone)}</h2><p>{view === "week" ? "每周一开始 · 全天与截止事项单独显示" : "选择日期查看和管理日程"}</p></div><button className="refresh-button" aria-label="刷新日历" onClick={() => void refresh()} disabled={busy} type="button">↻</button></section>
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => void refresh()} type="button">重试</button></div>}
        {view === "week" ? <WeekView days={days} grouped={grouped} selectedDate={selectedDate} today={today} timezone={timezone} onSelectDate={setSelectedDate} onOpen={openItem} onNew={openNew} /> : <MonthView days={days} grouped={grouped} selectedDate={selectedDate} today={today} selectedMonth={selectedMonth} onSelectDate={setSelectedDate} onOpen={openItem} onNew={openNew} />}
        <CanvasDeadlineStrip days={days} deadlines={canvasByDay} timezone={timezone} onComplete={markCanvasDeadline} />
        <footer className="calendar-footer"><span><i className="online-dot" />数据保存在此设备</span><span>{busy ? "正在读取本地日程…" : `${occurrences.length} 个日程实例`}</span></footer>
      </>}
    </section>
    {editor && <EventEditor key={`${editor.event?.id ?? "new"}-${editor.occurrence?.occurrenceId ?? editor.date}`} editor={editor} timezone={timezone} busy={busy} onClose={() => setEditor(null)} onSave={saveItem} onDelete={removeItem} />}
  </main>;
}

function Settings({ timezone, onTimezoneChange }: { timezone: string; onTimezoneChange: (zone: string) => void }) {
  return <section className="settings-panel"><div className="settings-title"><div className="settings-icon">◷</div><div><h2>日历显示</h2><p>调整个人日程的显示方式。</p></div></div><label className="setting-row"><span><strong>显示时区</strong><small>事件按此时区分组，重复日程仍遵循创建时的时区。</small></span><select aria-label="显示时区" value={timezone} onChange={(event) => onTimezoneChange(event.target.value)}>{ZONES.map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label><div className="settings-note"><span className="online-dot" />仅保存在此设备。Canvas 和教务连接将在后续阶段设置。</div></section>;
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
    <div className="settings-actions"><button className="save-button" disabled={working || !token.trim()} onClick={() => void run(async () => { await onConnect(instance, token); setToken(""); })} type="button">安全保存令牌</button><button className="cancel-button" disabled={working || !canvasStatus.configured} onClick={() => void run(onTest)} type="button">测试连接</button><button className="cancel-button" disabled={working || !canvasStatus.configured} onClick={() => void run(onSync)} type="button">立即同步</button><button className="delete-button" disabled={working || !canvasStatus.configured} onClick={() => void run(onDisconnect)} type="button">断开连接</button></div>
    {problem && <div className="error-banner" role="alert">{problem}</div>}{notice && <p className="settings-feedback" role="status">{notice}</p>}
  </section>;
}

function CanvasDeadlineStrip({ days, deadlines, timezone, onComplete }: { days: string[]; deadlines: Map<string, CanvasDeadline[]>; timezone: string; onComplete: (item: CanvasDeadline, completed: boolean) => void }) {
  return <section className="canvas-strip" aria-label="Canvas 截止事项">{days.map((day) => <div className="canvas-strip-day" key={day}><strong>{weekday(day)} {Number(day.slice(-2))}</strong>{(deadlines.get(day) ?? []).map((item) => <div className={`canvas-deadline ${item.localCompleted ? "completed" : ""}`} key={`${item.courseId}-${item.assignmentId}`}><label><input type="checkbox" aria-label={`标记 ${item.title} 完成`} checked={item.localCompleted} onChange={(event) => onComplete(item, event.target.checked)} /><a href={item.htmlUrl} target="_blank" rel="noreferrer" title={item.courseName}>{item.title}</a></label><small>{item.courseName} · {new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(item.dueAt))}</small></div>)}</div>)}</section>;
}

function WeekView({ days, grouped, selectedDate, today, timezone, onSelectDate, onOpen, onNew }: {
  days: string[]; grouped: Map<string, CalendarOccurrence[]>; selectedDate: string; today: string; timezone: string;
  onSelectDate: (date: string) => void; onOpen: (item: CalendarOccurrence) => void; onNew: (date: string) => void;
}) {
  return <section className="week-view" aria-label="周日历">
    <div className="week-head"><div className="time-gutter" />{days.map((day) => <button key={day} className={`day-heading ${day === selectedDate ? "focus" : ""} ${day === today ? "is-today" : ""}`} onClick={() => onSelectDate(day)} type="button"><span>{weekday(day)}</span><strong>{Number(day.slice(-2))}</strong><small>{(grouped.get(day) ?? []).length ? "有日程" : ""}</small></button>)}</div>
    <div className="week-scroll"><div className="time-grid"><div className="time-gutter">{Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => <span style={{ top: `${i * HOUR_HEIGHT - 8}px` }} key={i}>{String(FIRST_HOUR + i).padStart(2, "0")}:00</span>)}</div>{days.map((day) => {
      const timed = (grouped.get(day) ?? []).filter((item) => item.category !== "deadline" && !item.allDay);
      const overlapLayout = layoutOverlaps(timed);
      return <div className="time-column" key={day} onDoubleClick={() => onNew(day)}>{Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => <span className="hour-line" style={{ top: `${i * HOUR_HEIGHT}px` }} key={i} />)}{timed.map((item) => {
        const start = clock(item.startUtc, timezone); const end = clock(item.endUtc, timezone);
        const top = (start.hour + start.minute / 60 - FIRST_HOUR) * HOUR_HEIGHT;
        let hours = (end.hour * 60 + end.minute - start.hour * 60 - start.minute) / 60;
        if (hours <= 0) hours += 24;
        const height = Math.max(27, Math.min(HOUR_HEIGHT * (LAST_HOUR - FIRST_HOUR) - top, hours * HOUR_HEIGHT));
        const position = overlapLayout.get(item.occurrenceId) ?? { column: 0, columns: 1 };
        return <button className="event-block" style={{ top: `${Math.max(0, top)}px`, height: `${height}px`, left: `calc(${position.column * 100 / position.columns}% + 3px)`, right: `calc(${(position.columns - position.column - 1) * 100 / position.columns}% + 3px)`, borderLeftColor: item.color }} key={item.occurrenceId} onClick={() => onOpen(item)} type="button"><strong>{item.title}</strong><span>{timeLabel(item, timezone)}</span>{height > 54 && item.location && <small>{item.location}</small>}</button>;
      })}</div>;
    })}</div></div>
    <div className="deadline-row"><div className="deadline-label">全天 / DDL</div>{days.map((day) => { const items = (grouped.get(day) ?? []).filter((item) => item.category === "deadline" || item.allDay); return <div className="deadline-cell" key={day} onDoubleClick={() => onNew(day)}>{items.length ? items.map((item) => <button key={item.occurrenceId} className={`deadline-chip ${item.category === "deadline" ? "deadline" : "all-day"}`} onClick={() => onOpen(item)} type="button"><span>{item.category === "deadline" ? "◆" : "●"}</span>{item.title}</button>) : <button className="add-inline" onClick={() => onNew(day)} aria-label={`${day} 新建日程`} type="button">＋</button>}</div>; })}</div>
  </section>;
}

function MonthView({ days, grouped, selectedDate, today, selectedMonth, onSelectDate, onOpen, onNew }: {
  days: string[]; grouped: Map<string, CalendarOccurrence[]>; selectedDate: string; today: string; selectedMonth: string;
  onSelectDate: (date: string) => void; onOpen: (item: CalendarOccurrence) => void; onNew: (date: string) => void;
}) {
  return <section className="month-view" aria-label="月日历"><div className="month-weekdays">{"一二三四五六日".split("").map((day) => <span key={day}>{day}</span>)}</div><div className="month-grid">{days.map((day) => {
    const items = grouped.get(day) ?? [];
    return <div role="button" tabIndex={0} className={`month-cell ${day.slice(5, 7) !== selectedMonth ? "outside" : ""} ${day === selectedDate ? "chosen" : ""} ${day === today ? "is-today" : ""}`} key={day} onClick={() => onSelectDate(day)} onDoubleClick={() => onNew(day)} onKeyDown={(event) => { if (event.key === "Enter") onSelectDate(day); }}><span className="month-date">{Number(day.slice(-2))}</span>{items.slice(0, 3).map((item) => <button key={item.occurrenceId} className={`month-event ${item.category === "deadline" ? "deadline" : ""}`} style={{ borderLeftColor: item.color }} onClick={(event) => { event.stopPropagation(); onOpen(item); }} type="button">{item.title}</button>)}{items.length > 3 && <small className="more-events">+{items.length - 3} 项</small>}</div>;
  })}</div></section>;
}

function EventEditor({ editor, timezone, busy, onClose, onSave, onDelete }: {
  editor: EditorState; timezone: string; busy: boolean; onClose: () => void;
  onSave: (draft: EventDraft, scope: "series" | "single") => Promise<void>;
  onDelete: (scope: "series" | "single") => Promise<void>;
}) {
  const initial = editor.event && editor.occurrence ? {
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
  } : editor.event ?? emptyDraft(editor.date, timezone);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [location, setLocation] = useState(initial.location);
  const [category, setCategory] = useState<EventDraft["category"]>(initial.category);
  const [start, setStart] = useState(initial.startLocal.slice(0, 16));
  const [end, setEnd] = useState(initial.endLocal.slice(0, 16));
  const [eventZone, setEventZone] = useState(initial.timezone);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [repeat, setRepeat] = useState(repeatLabel(initial.rrule));
  const [color, setColor] = useState(initial.color);
  const recurringOccurrence = !!editor.occurrence && !!editor.event?.rrule;
  const draft: EventDraft = {
    title, description, location, category, startLocal: localValue(start), endLocal: localValue(end), timezone: eventZone,
    allDay, rrule: repeat === "每天" ? "FREQ=DAILY" : repeat === "每周" ? "FREQ=WEEKLY" : repeat === "每两周" ? "FREQ=WEEKLY;INTERVAL=2" : null, color,
  };
  function submit(event: FormEvent, scope: "series" | "single") { event.preventDefault(); void onSave(draft, scope); }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="event-modal" role="dialog" aria-modal="true" aria-labelledby="event-modal-title" onSubmit={(event) => submit(event, "series")}>
    <header className="modal-header"><div><p className="eyebrow">{editor.event ? "编辑本地日程" : "添加到个人日历"}</p><h2 id="event-modal-title">{editor.event ? "日程详情" : "新建日程"}</h2></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
    <div className="form-scroll"><label className="form-field"><span>标题</span><input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：项目讨论" /></label>
      <div className="form-two"><label className="form-field"><span>类型</span><select value={category} onChange={(event) => setCategory(event.target.value as EventDraft["category"])}><option value="event">日程</option><option value="deadline">截止事项</option></select></label><label className="form-field"><span>重复</span><select value={repeat} onChange={(event) => setRepeat(event.target.value)}><option>不重复</option><option>每天</option><option>每周</option><option>每两周</option></select></label></div>
      <div className="form-two"><label className="form-field"><span>开始</span><input required type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label><label className="form-field"><span>结束</span><input required type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>
      <div className="form-two"><label className="form-field"><span>时区</span><select value={eventZone} onChange={(event) => setEventZone(event.target.value)}>{ZONES.map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label><label className="form-field color-field"><span>颜色</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label></div>
      <label className="check-field"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />全天事件</label>
      <label className="form-field"><span>地点</span><input maxLength={200} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="添加地点" /></label>
      <label className="form-field"><span>备注</span><textarea rows={3} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="添加说明" /></label>
    </div>
    <footer className="modal-actions"><div>{editor.event && <button className="delete-button" disabled={busy} onClick={() => void onDelete("series")} type="button">删除日程</button>}</div><div><button className="cancel-button" onClick={onClose} type="button">取消</button>{recurringOccurrence ? <><button className="save-button secondary-save" disabled={busy} onClick={(event) => submit(event, "single")} type="button">保存此项</button><button className="save-button" disabled={busy} type="submit">保存整个系列</button></> : <button className="save-button" disabled={busy} type="submit">保存</button>}</div></footer>
    {recurringOccurrence && <div className="occurrence-actions"><span>属于「{editor.event?.title}」系列</span><button type="button" onClick={() => void onDelete("single")} disabled={busy}>仅删除此项</button></div>}
  </form></div>;
}

export default App;

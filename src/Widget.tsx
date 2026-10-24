import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  getCalendarOccurrences, getCanvasDeadlines, getSjtuCourseOccurrences, getWidgetStatus,
  hideWidget, setWidgetAlwaysOnTop, showMainWindow,
  type CalendarOccurrence, type CanvasDeadline, type SjtuCourseOccurrence, type WidgetStatus,
} from "./lib/backend";
import "./widget.css";
import { occursOnDay } from "./lib/calendar-days";
import { useCalendarUpdates } from "./lib/calendar-updates";
import { canvasCompleted } from "./lib/canvas-status";

function addDays(date: string, amount: number) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dateInZone(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", month: "long", day: "numeric", weekday: "long" }).format(new Date(value + "T12:00:00Z"));
}

function relativeDue(value: string, today: string, timezone: string) {
  const date = dateInZone(new Date(value), timezone);
  const time = formatTime(value, timezone);
  return date === today ? "今天 " + time : date === addDays(today, 1) ? "明天 " + time : date.slice(5).replace("-", "/") + " " + time;
}

type TodayItem =
  | { kind: "course"; startUtc: string; value: SjtuCourseOccurrence }
  | { kind: "event"; startUtc: string; value: CalendarOccurrence };
type DeadlineItem =
  | { kind: "canvas"; dueAt: string; value: CanvasDeadline }
  | { kind: "local"; dueAt: string; value: CalendarOccurrence };

export default function Widget() {
  const [timezone, setTimezone] = useState(() => localStorage.getItem("calendar-timezone") || "Asia/Shanghai");
  const refreshSequence = useRef(0);
  const [now, setNow] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarOccurrence[]>([]);
  const [courses, setCourses] = useState<SjtuCourseOccurrence[]>([]);
  const [canvasDeadlines, setCanvasDeadlines] = useState<CanvasDeadline[]>([]);
  const [status, setStatus] = useState<WidgetStatus>({ canvasLastSuccessAt: null, sjtuLastSuccessAt: null, alwaysOnTop: false });
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const today = dateInZone(now, timezone);
  const through = addDays(today, 7);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoading(true);
    setError("");
    try {
      const [nextEvents, nextDeadlines, nextCourses, nextStatus] = await Promise.all([
        getCalendarOccurrences(today, through, timezone),
        getCanvasDeadlines(today, through, timezone),
        getSjtuCourseOccurrences(today, through, timezone),
        getWidgetStatus(),
      ]);
      if (sequence !== refreshSequence.current) return;
      setEvents(nextEvents);
      setCanvasDeadlines(nextDeadlines);
      setCourses(nextCourses);
      setStatus(nextStatus);
      setLoadedAt(new Date());
    } catch (reason) {
      if (sequence === refreshSequence.current) setError(reason instanceof Error ? reason.message : "读取本机日程缓存失败");
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [through, timezone, today]);
  useCalendarUpdates(refresh);
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    const update = (zone: string) => {
      try { new Intl.DateTimeFormat("en", { timeZone: zone }); if (active) setTimezone(zone); } catch { /* Ignore malformed external preferences. */ }
    };
    const read = () => update(localStorage.getItem("calendar-timezone") || "Asia/Shanghai");
    void listen<string>("calendar-timezone-changed", ({ payload }) => update(payload)).then((unlisten) => { if (active) stop = unlisten; else unlisten(); }).catch(() => {});
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    return () => { active = false; stop?.(); window.removeEventListener("storage", read); window.removeEventListener("focus", read); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const todayItems = useMemo<TodayItem[]>(() => [
    ...events.filter((item) => item.category === "event" && occursOnDay(item, today, timezone))
      .map((value) => ({ kind: "event" as const, startUtc: value.startUtc, value })),
    ...courses.filter((item) => dateInZone(new Date(item.startUtc), timezone) === today)
      .map((value) => ({ kind: "course" as const, startUtc: value.startUtc, value })),
  ].sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc)), [courses, events, today, timezone]);

  const upcomingDeadlines = useMemo<DeadlineItem[]>(() => [
    ...events.filter((item) => item.category === "deadline")
      .map((value) => ({ kind: "local" as const, dueAt: value.startUtc, value })),
    ...canvasDeadlines.filter((item) => !canvasCompleted(item))
      .map((value) => ({ kind: "canvas" as const, dueAt: value.dueAt, value })),
  ].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)).slice(0, 6), [canvasDeadlines, events]);

  async function openCourse(course: SjtuCourseOccurrence) {
    await emitTo("main", "widget-open-course", course);
    await showMainWindow();
  }
  async function openEvent(event: CalendarOccurrence) {
    await emitTo("main", "widget-open-event", event);
    await showMainWindow();
  }
  async function openCanvasDeadline(deadline: CanvasDeadline) {
    await emitTo("main", "widget-open-canvas-deadline", deadline);
    await showMainWindow();
  }
  async function toggleAlwaysOnTop() {
    const enabled = !status.alwaysOnTop;
    await setWidgetAlwaysOnTop(enabled);
    setStatus((current) => ({ ...current, alwaysOnTop: enabled }));
  }

  return <main className="widget-shell">
    <header className="widget-header" data-tauri-drag-region="deep">
      <div className="widget-brand" data-tauri-drag-region="deep"><span className="widget-mark" data-tauri-drag-region="deep">S</span><div data-tauri-drag-region="deep"><strong data-tauri-drag-region="deep">SJTU Schedule</strong><small data-tauri-drag-region="deep">今日安排</small></div></div>
      <div className="widget-controls">
        <button type="button" className={status.alwaysOnTop ? "widget-icon-button active" : "widget-icon-button"} aria-label="切换置顶" aria-pressed={status.alwaysOnTop} title={status.alwaysOnTop ? "取消置顶" : "置顶 Widget"} onClick={() => void toggleAlwaysOnTop().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "无法切换置顶"))} data-tauri-drag-region="false">⌖</button>
        <button type="button" className="widget-icon-button widget-main-button" aria-label="打开主程序" title="打开主程序" onClick={() => void showMainWindow()} data-tauri-drag-region="false">↗ <span>主程序</span></button>
        <button type="button" className="widget-icon-button" aria-label="隐藏 Widget" title="隐藏 Widget" onClick={() => void hideWidget()} data-tauri-drag-region="false">×</button>
      </div>
    </header>
    <section className="widget-date">
      <div><p>{formatDateLabel(today)}</p><strong>{new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)}</strong></div>
      <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="刷新本地缓存" title="重新读取本机缓存">↻</button>
    </section>
    {error && <div className="widget-error" role="alert">{error}<button type="button" onClick={() => void refresh()}>重试</button></div>}
    <div className="widget-content">
      <section className="widget-section">
        <div className="widget-section-heading"><h2>今天</h2><span>{todayItems.length} 项</span></div>
        {todayItems.length ? <div className="widget-list">{todayItems.map((item) => item.kind === "course"
          ? <button type="button" className="widget-item" key={item.value.occurrenceId} onClick={() => void openCourse(item.value)}>
            <i className="widget-item-dot course" /><span className="widget-item-time">{formatTime(item.startUtc, timezone)}</span><span className="widget-item-main"><strong>{item.value.title}</strong><small>{item.value.location || "课程"}{item.value.note ? " · ★" : ""}</small></span>
          </button>
          : <button type="button" className="widget-item" key={item.value.occurrenceId} onClick={() => void openEvent(item.value)}>
            <i className="widget-item-dot event" /><span className="widget-item-time">{formatTime(item.startUtc, timezone)}</span><span className="widget-item-main"><strong>{item.value.title}</strong><small>{item.value.location || "个人日程"}</small></span>
          </button>)}</div> : <p className="widget-empty">{loading ? "正在读取本地缓存…" : "今天还没有安排"}</p>}
      </section>
      <section className="widget-section">
        <div className="widget-section-heading"><h2>近 7 天 DDL</h2><span>{upcomingDeadlines.length} 项</span></div>
        {upcomingDeadlines.length ? <div className="widget-deadlines">{upcomingDeadlines.map((item) => item.kind === "canvas"
          ? <button type="button" className="widget-deadline" key={item.value.instanceUrl + "-" + item.value.courseId + "-" + item.value.assignmentId} onClick={() => void openCanvasDeadline(item.value)}>
            <span className="widget-deadline-icon canvas">C</span><span className="widget-deadline-main"><strong>{item.value.title}</strong><small>{item.value.courseName}</small></span><time>{relativeDue(item.dueAt, today, timezone)}</time>
          </button>
          : <button type="button" className="widget-deadline" key={item.value.occurrenceId} onClick={() => void openEvent(item.value)}>
            <span className="widget-deadline-icon local">◆</span><span className="widget-deadline-main"><strong>{item.value.title}</strong><small>个人截止事项</small></span><time>{relativeDue(item.dueAt, today, timezone)}</time>
          </button>)}</div> : <p className="widget-empty">{loading ? "正在读取…" : "近期没有截止事项"}</p>}
      </section>
    </div>
    <footer className="widget-footer">
      <span>{loadedAt ? "缓存读取 " + formatTime(loadedAt.toISOString(), timezone) : "本地离线缓存"}</span>
      <span>Canvas {status.canvasLastSuccessAt ? formatTime(status.canvasLastSuccessAt, timezone) : "—"} · 教务 {status.sjtuLastSuccessAt ? formatTime(status.sjtuLastSuccessAt, timezone) : "—"}</span>
    </footer>
    <div className="widget-resize-grip" aria-hidden="true" onMouseDown={(event) => {
      if (event.button === 0) void getCurrentWebviewWindow().startResizeDragging("SouthEast");
    }} />
  </main>;
}

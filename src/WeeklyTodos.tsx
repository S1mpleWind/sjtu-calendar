import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type TextareaHTMLAttributes } from "react";
import { createWeeklyTodo, listWeeklyTodos, updateWeeklyTodo, type WeeklyTodo, type WeeklyTodoList, type WeeklyTodoPatch } from "./lib/backend";
import { useCalendarUpdates } from "./lib/calendar-updates";
import "./weekly-todos.css";

function weekEnd(start: string) {
  const value = new Date(start + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + 6);
  return value.toISOString().slice(0, 10);
}

type SaveItem = (item: WeeklyTodoPatch, background?: boolean) => Promise<boolean>;

function fitTextarea(element: HTMLTextAreaElement) {
  if (!element.clientWidth) return;
  element.style.height = "0px";
  const border = element.offsetHeight - element.clientHeight;
  element.style.height = `${element.scrollHeight + border}px`;
}

function AutoHeightTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const element = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (element.current) fitTextarea(element.current); }, [props.value]);
  useEffect(() => {
    const textarea = element.current;
    if (!textarea) return;
    let previousWidth = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth !== previousWidth) {
        previousWidth = textarea.clientWidth;
        fitTextarea(textarea);
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, []);
  return <textarea {...props} rows={1} ref={element} />;
}

function TodoRow({ item, working, onSave }: { item: WeeklyTodo; working: boolean; onSave: SaveItem }) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [details, setDetails] = useState(item.details);
  const [message, setMessage] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const clickTimer = useRef<number | undefined>(undefined);
  const beforeClick = useRef(false);
  const titleSaveLock = useRef(false);
  const cancelledTitle = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const draftDetails = useRef(item.details);
  const savedDetails = useRef(item.details);
  const detailsSave = useRef(onSave);
  useEffect(() => { detailsSave.current = onSave; }, [onSave]);
  const persistDetails = useCallback(async (value: string) => {
    if (value === savedDetails.current) return;
    const saved = await detailsSave.current({ id: item.id, details: value }, true);
    if (saved) { savedDetails.current = value; setMessage(""); }
    else setMessage("自动保存失败，内容已保留；继续编辑或移开焦点可重试。");
  }, [item.id]);
  useEffect(() => () => {
    window.clearTimeout(saveTimer.current);
    if (draftDetails.current !== savedDetails.current) void detailsSave.current({ id: item.id, details: draftDetails.current }, true);
  }, [item.id]);
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  function clickTitle(clicks: number) {
    if (clicks > 1) return;
    beforeClick.current = expanded;
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => setExpanded((value) => !value), 250);
  }
  function editTitle() {
    window.clearTimeout(clickTimer.current);
    setExpanded(beforeClick.current);
    cancelledTitle.current = false;
    setTitle(item.title); setEditingTitle(true); setMessage("");
  }
  async function saveTitle() {
    if (cancelledTitle.current || titleSaveLock.current) return;
    const next = title.trim();
    if (!next) { setMessage("标题不能为空"); return; }
    if (next === item.title) { setEditingTitle(false); return; }
    titleSaveLock.current = true;
    try {
      if (await onSave({ id: item.id, title: next })) { setEditingTitle(false); setMessage(""); }
      else setMessage("标题保存失败，请重试。");
    } finally { titleSaveLock.current = false; }
  }
  return <li className={`weekly-todo ${item.completed ? "is-complete" : ""}`}>
    <div className="weekly-todo-line">
      <input type="checkbox" checked={item.completed} disabled={working} aria-label={`完成每周任务 ${item.title}`} onChange={(event) => void onSave({ id: item.id, completed: event.target.checked })} />
      {editingTitle ? <input className="weekly-inline-title" aria-label={`修改 ${item.title} 的标题`} maxLength={200} autoFocus value={title} disabled={working} onFocus={(event) => event.target.select()} onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") { event.preventDefault(); void saveTitle(); }
        if (event.key === "Escape") { cancelledTitle.current = true; setEditingTitle(false); setMessage(""); }
      }} /> : <button className="weekly-todo-toggle" type="button" aria-expanded={expanded} title="单击展开详情，双击修改标题" onClick={(event) => clickTitle(event.detail)} onDoubleClick={editTitle} onKeyDown={(event) => { if (event.key === "F2") { event.preventDefault(); beforeClick.current = expanded; editTitle(); } }}><span>{item.title}</span><span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></button>}
    </div>
    {item.carriedFromWeek && <p className="weekly-carried">从 {item.carriedFromWeek} 那周延续</p>}
    {!expanded && item.details && <p className="weekly-details-preview">{item.details}</p>}
    {expanded && <div className="weekly-editor">
      <AutoHeightTextarea aria-label={`${item.title}的详细内容`} maxLength={10000} value={details} onChange={(event) => {
        const value = event.target.value; draftDetails.current = value; setDetails(value); setMessage("");
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void persistDetails(value), 600);
      }} onBlur={() => { window.clearTimeout(saveTimer.current); void persistDetails(draftDetails.current); }} />
    </div>}
    {message && <p className="weekly-item-message" role="status">{message}</p>}
  </li>;
}

function AddTodo({ working, onAdd, onCancel }: { working: boolean; onAdd: (title: string, details: string) => Promise<boolean>; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (await onAdd(title.trim(), details)) onCancel();
    else setError("添加失败，内容已保留，请重试。");
  }
  return <form className="weekly-editor weekly-add-form" onSubmit={(event) => void submit(event)} onKeyDown={(event) => { if (event.key === "Escape" && !working) onCancel(); }}>
    <input autoFocus required maxLength={200} aria-label="每周任务标题" value={title} disabled={working} onChange={(event) => setTitle(event.target.value)} />
    <details><summary>详细内容（可选）</summary><AutoHeightTextarea aria-label="新任务详细内容" maxLength={10000} value={details} disabled={working} onChange={(event) => setDetails(event.target.value)} /></details>
    <div className="weekly-editor-actions"><button type="submit" disabled={working || !title.trim()}>添加</button></div>
    {error && <p className="weekly-form-error" role="alert">{error}</p>}
  </form>;
}

export default function WeeklyTodos({ timezone }: { timezone: string }) {
  const [data, setData] = useState<WeeklyTodoList | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addingWeek, setAddingWeek] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const readToken = useRef<symbol | null>(null);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const foregroundWrites = useRef(0);
  const refresh = useCallback(async () => {
    const token = Symbol(); readToken.current = token;
    try {
      const rows = await listWeeklyTodos(timezone);
      if (readToken.current === token) { setData(rows); setError(""); }
    } catch (reason) {
      if (readToken.current === token) setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [timezone]);
  useCalendarUpdates(refresh);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); readToken.current = null; };
  }, [refresh]);

  function perform(action: () => Promise<void>, background = false): Promise<boolean> {
    if (!background) { foregroundWrites.current++; setWorking(true); }
    const result = writeQueue.current.then(async () => {
      try { await action(); await refresh(); return true; }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
      finally { if (!background && --foregroundWrites.current === 0) setWorking(false); }
    });
    writeQueue.current = result.then(() => undefined);
    return result;
  }

  return <section className="weekly-todos-page" aria-label="每周 Todo">
    <div className="weekly-intro"><p>未完成任务每周自动延续。单击标题展开详情，双击修改标题。</p><span>{timezone}</span></div>
    {error && <div className="error-banner" role="alert">{error}<button type="button" onClick={() => void refresh()}>重试</button></div>}
    {!data && !error && <p role="status">正在读取每周 Todo…</p>}
    {data?.weeks.map((week) => {
      const current = week.weekStart === data.currentWeek;
      const open = expanded[week.weekStart] ?? current;
      const done = week.items.filter((item) => item.completed).length;
      return <section className={`weekly-card ${current ? "is-current" : ""}`} key={week.weekStart} aria-label={`${week.weekStart} 这一周的 Todo`}>
        <header className="weekly-card-header"><button className="weekly-week-toggle" type="button" aria-expanded={open} onClick={() => setExpanded((values) => ({ ...values, [week.weekStart]: !open }))}>
          <span aria-hidden="true" className="weekly-chevron">{open ? "⌄" : "›"}</span><span className="weekly-week-label"><strong>{week.weekStart} — {weekEnd(week.weekStart)}</strong><small>已完成 {done} / {week.items.length}</small></span>{current && <span className="weekly-current-badge">本周</span>}
        </button><button className="weekly-plus" type="button" aria-label={`${week.weekStart} 添加 Todo`} title="添加任务" disabled={working} onClick={() => { setExpanded((values) => ({ ...values, [week.weekStart]: true })); setAddingWeek((value) => value === week.weekStart ? null : week.weekStart); }}>＋</button></header>
        {open && <div className="weekly-card-body">
          {!current && <p className="weekly-history-hint">历史周的修改只影响该周，已延续的任务保持独立。</p>}
          {week.items.length ? <ul className="weekly-todo-list">{week.items.map((item) => <TodoRow key={item.id} item={item} working={working} onSave={(next, background) => perform(() => updateWeeklyTodo(timezone, next), background)} />)}</ul> : addingWeek !== week.weekStart && <p className="weekly-empty">这周还没有任务，点击右上角 ＋ 添加。</p>}
          {addingWeek === week.weekStart && <AddTodo key={week.weekStart} working={working} onAdd={(title, details) => perform(() => createWeeklyTodo(timezone, week.weekStart, title, details))} onCancel={() => setAddingWeek(null)} />}
        </div>}
      </section>;
    })}
  </section>;
}

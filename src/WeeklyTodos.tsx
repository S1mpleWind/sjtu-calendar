import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createWeeklyTodo, listWeeklyTodos, updateWeeklyTodo, type WeeklyTodo, type WeeklyTodoList } from "./lib/backend";
import { useCalendarUpdates } from "./lib/calendar-updates";
import "./weekly-todos.css";

function weekEnd(start: string) {
  const value = new Date(start + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + 6);
  return value.toISOString().slice(0, 10);
}

type SaveItem = (item: WeeklyTodo) => Promise<boolean>;

function TodoRow({ item, working, onSave }: { item: WeeklyTodo; working: boolean; onSave: SaveItem }) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [details, setDetails] = useState(item.details);
  const [message, setMessage] = useState("");
  const changed = title !== item.title || details !== item.details;
  function toggle() {
    if (!expanded) { setTitle(item.title); setDetails(item.details); setMessage(""); }
    setExpanded(!expanded);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage("");
    const saved = await onSave({ ...item, title: title.trim(), details });
    if (saved) { setTitle(title.trim()); setMessage("已保存"); }
    else setMessage("保存失败，内容已保留，请重试。");
  }
  return <li className={`weekly-todo ${item.completed ? "is-complete" : ""}`}>
    <div className="weekly-todo-line">
      <input type="checkbox" checked={item.completed} disabled={working} aria-label={`完成每周任务 ${item.title}`} onChange={(event) => void onSave({ ...item, completed: event.target.checked })} />
      <button className="weekly-todo-toggle" type="button" aria-expanded={expanded} onClick={toggle}><span>{item.title}</span><span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></button>
    </div>
    {item.carriedFromWeek && <p className="weekly-carried">从 {item.carriedFromWeek} 那周延续</p>}
    {!expanded && item.details && <p className="weekly-details-preview">{item.details}</p>}
    {expanded && <form className="weekly-editor" onSubmit={(event) => void submit(event)}>
      <label>任务标题<input aria-label={`${item.title}的标题`} maxLength={200} required value={title} disabled={working} onChange={(event) => { setTitle(event.target.value); setMessage(""); }} /></label>
      <label>详细内容<textarea aria-label={`${item.title}的详细内容`} rows={5} maxLength={10000} value={details} disabled={working} placeholder="填写步骤、备注或相关链接" onChange={(event) => { setDetails(event.target.value); setMessage(""); }} /></label>
      <div className="weekly-editor-actions"><button type="submit" disabled={working || !title.trim() || !changed}>保存</button><button className="secondary" type="button" disabled={working} onClick={() => { setTitle(item.title); setDetails(item.details); setExpanded(false); }}>取消</button><span role="status">{message || (changed ? "有未保存的修改" : "")}</span></div>
    </form>}
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
  return <form className="weekly-editor weekly-add-form" onSubmit={(event) => void submit(event)}>
    <label>任务标题<input autoFocus required maxLength={200} aria-label="每周任务标题" placeholder="输入 Todo" value={title} disabled={working} onChange={(event) => setTitle(event.target.value)} /></label>
    <details><summary>详细内容（可选）</summary><textarea aria-label="新任务详细内容" rows={4} maxLength={10000} value={details} disabled={working} onChange={(event) => setDetails(event.target.value)} /></details>
    <div className="weekly-editor-actions"><button type="submit" disabled={working || !title.trim()}>添加</button><button className="secondary" type="button" disabled={working} onClick={onCancel}>取消</button></div>
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
  const writeLock = useRef(false);
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

  async function perform(action: () => Promise<void>) {
    if (writeLock.current) return false;
    writeLock.current = true; setWorking(true); setError("");
    try { await action(); await refresh(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { writeLock.current = false; setWorking(false); }
  }

  return <section className="weekly-todos-page" aria-label="每周 Todo">
    <div className="weekly-intro"><p>每周一开始新的一周，自动延续上周未完成的任务。点击任务可展开编辑详细内容。</p><span>{timezone}</span></div>
    {error && <div className="error-banner" role="alert">{error}<button type="button" onClick={() => void refresh()}>重试</button></div>}
    {!data && !error && <p role="status">正在读取每周 Todo…</p>}
    {data?.weeks.map((week) => {
      const current = week.weekStart === data.currentWeek;
      const open = expanded[week.weekStart] ?? current;
      const done = week.items.filter((item) => item.completed).length;
      return <section className={`weekly-card ${current ? "is-current" : ""}`} key={week.weekStart} aria-label={`${week.weekStart} 这一周的 Todo`}>
        <header className="weekly-card-header"><button className="weekly-week-toggle" type="button" aria-expanded={open} onClick={() => setExpanded((values) => ({ ...values, [week.weekStart]: !open }))}>
          <span aria-hidden="true" className="weekly-chevron">{open ? "⌄" : "›"}</span><span className="weekly-week-label"><strong>{week.weekStart} — {weekEnd(week.weekStart)}</strong><small>已完成 {done} / {week.items.length}</small></span>{current && <span className="weekly-current-badge">本周</span>}
        </button><button className="weekly-plus" type="button" aria-label={`${week.weekStart} 添加 Todo`} title="添加任务" disabled={working} onClick={() => { setExpanded((values) => ({ ...values, [week.weekStart]: true })); setAddingWeek(week.weekStart); }}>＋</button></header>
        {open && <div className="weekly-card-body">
          {!current && <p className="weekly-history-hint">历史周的修改只影响该周，已延续的任务保持独立。</p>}
          {addingWeek === week.weekStart && <AddTodo key={week.weekStart} working={working} onAdd={(title, details) => perform(() => createWeeklyTodo(timezone, week.weekStart, title, details))} onCancel={() => setAddingWeek(null)} />}
          {week.items.length ? <ul className="weekly-todo-list">{week.items.map((item) => <TodoRow key={item.id} item={item} working={working} onSave={(next) => perform(() => updateWeeklyTodo(timezone, next))} />)}</ul> : addingWeek !== week.weekStart && <p className="weekly-empty">这周还没有任务，点击右上角 ＋ 添加。</p>}
        </div>}
      </section>;
    })}
  </section>;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { createLongTermItem, listLongTermItems, setLongTermItemArchived, updateLongTermItemNote, type LongTermItem } from "./lib/backend";
import { useCalendarUpdates } from "./lib/calendar-updates";

export default function LongTermChecklist() {
  const [items, setItems] = useState<LongTermItem[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [editingNote, setEditingNote] = useState<{ id: string; note: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef<symbol | null>(null);

  const refresh = useCallback(async () => {
    const request = Symbol();
    sequence.current = request;
    try {
      const rows = await listLongTermItems();
      if (request === sequence.current) { setItems(rows); setError(""); }
    } catch (reason) {
      if (request === sequence.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, []);
  useCalendarUpdates(refresh);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => { window.clearTimeout(timer); sequence.current = null; };
  }, [refresh]);

  async function save(action: () => Promise<void>) {
    if (working) return;
    setWorking(true); setError("");
    try { await action(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setWorking(false); }
  }

  const archivedCount = items.filter((item) => item.archivedAt !== null).length;
  const visible = items.filter((item) => (item.archivedAt !== null) === showArchived);
  return <section className="overview-details long-term-checklist" aria-label="长期清单">
    <header className="long-term-header"><div><h3>{showArchived ? "已归档" : "长期清单"}</h3></div><button className="long-term-archive" type="button" aria-label={showArchived ? "返回长期清单" : "查看归档"} aria-pressed={showArchived} onClick={() => setShowArchived((value) => !value)}>{showArchived ? "返回清单" : `归档 (${archivedCount})`}</button></header>
    {!showArchived && <form className="long-term-add" onSubmit={(event) => { event.preventDefault(); const value = title.trim(); if (value) void save(async () => { await createLongTermItem(value, note); setTitle(""); setNote(""); }); }}>
      <input aria-label="新增长期事项" placeholder="添加一个长期事项…" maxLength={200} value={title} disabled={working} onChange={(event) => setTitle(event.target.value)} />
      <button type="submit" disabled={working || !title.trim()}>添加</button>
      <details><summary>添加备注（可选）</summary><textarea aria-label="新增长期事项的备注" rows={3} maxLength={4000} disabled={working} value={note} onChange={(event) => setNote(event.target.value)} /></details>
    </form>}
    {error && <div className="long-term-error" role="alert">{error}<button type="button" disabled={working} onClick={() => void refresh()}>重试</button></div>}
    {loading ? <p className="long-term-empty" role="status">正在读取清单…</p> : visible.length ? <ul className="long-term-items">{visible.map((item) => <li key={item.id} className={showArchived ? "done" : ""}>
      <input type="checkbox" aria-label={`${showArchived ? "恢复" : "完成"}长期事项 ${item.title}`} checked={item.archivedAt !== null} disabled={working} onChange={(event) => void save(() => setLongTermItemArchived(item.id, event.target.checked))} />
      <div><span className="overview-item-title">{item.title}</span>{item.archivedAt && <small className="long-term-archive-date">归档于 {new Date(item.archivedAt).toLocaleDateString("zh-CN")}</small>}
        {editingNote?.id === item.id ? <div className="long-term-note-editor"><textarea aria-label={`${item.title}的备注`} rows={4} maxLength={4000} value={editingNote.note} disabled={working} onChange={(event) => setEditingNote({ id: item.id, note: event.target.value })} /><div><button type="button" disabled={working} onClick={() => void save(async () => { await updateLongTermItemNote(item.id, editingNote.note); setEditingNote(null); })}>保存备注</button><button type="button" disabled={working} onClick={() => setEditingNote(null)}>取消</button></div></div> : <>{item.note && <p className="long-term-note">{item.note}</p>}<button className="long-term-edit-note" type="button" disabled={working} onClick={() => setEditingNote({ id: item.id, note: item.note ?? "" })}>{item.note ? "编辑备注" : "添加备注"}</button></>}
      </div>
    </li>)}</ul> : <p className="long-term-empty">{showArchived ? "还没有归档事项" : "暂无长期事项，添加后勾选即可归档。"}</p>}
    {showArchived && visible.length > 0 && <p className="long-term-hint">取消勾选可恢复到长期清单。</p>}
  </section>;
}

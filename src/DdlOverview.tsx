import { useMemo } from "react";
import { overviewDayState, type OverviewItem } from "./lib/ddl-overview";
import "./ddl-overview.css";

const labels = { empty: "没有 DDL", pending: "有未完成 DDL", complete: "DDL 全部完成" };

export default function DdlOverview({ days, selectedDate, today, timezone, items, working, onSelectDate, onToggle, onOpen }: {
  days: string[]; selectedDate: string; today: string; timezone: string; items: OverviewItem[]; working: boolean;
  onSelectDate: (date: string) => void; onToggle: (item: OverviewItem, completed: boolean) => Promise<void>; onOpen: (item: OverviewItem) => void;
}) {
  const byDay = useMemo(() => new Map(days.map((day) => [day, items.filter((item) => item.date === day)])), [days, items]);
  const visibleItems = [...byDay.values()].flat();
  const completedCount = visibleItems.filter((item) => item.completed).length;
  const selectedItems = byDay.get(selectedDate) ?? [];
  const offset = (new Date(days[0] + "T12:00:00Z").getUTCDay() + 6) % 7;
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long", timeZone: "UTC" }).format(new Date(selectedDate + "T12:00:00Z"));
  return <section className="ddl-overview" aria-label="DDL 月度总览">
    <div className="overview-month">
      <header className="overview-summary"><div><p className="eyebrow">DEADLINE OVERVIEW</p><h2>这个月的 DDL</h2><p>已完成 {completedCount} / {visibleItems.length} 项 · 按 {timezone} 归类</p></div><span className="overview-progress">{visibleItems.length ? Math.round(completedCount / visibleItems.length * 100) : 0}<small>%</small></span></header>
      <div className="overview-legend"><span><i className="pending" />有未完成</span><span><i className="complete" />全部完成</span><span><i className="empty" />没有 DDL</span></div>
      <div className="overview-grid" aria-label="月份日期">
        {"一二三四五六日".split("").map((day) => <span className="overview-weekday" key={day}>{day}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} aria-hidden="true" />)}
        {days.map((day) => {
          const dayItems = byDay.get(day) ?? [];
          const state = overviewDayState(dayItems);
          return <button className={`overview-date ${state} ${day === selectedDate ? "selected" : ""}`} key={day} aria-label={`${day} ${labels[state]}，${dayItems.length} 项`} aria-pressed={day === selectedDate} aria-current={day === today ? "date" : undefined} onClick={() => onSelectDate(day)} type="button"><span className="overview-circle">{Number(day.slice(-2))}</span><small>{dayItems.length ? `${dayItems.length} 项` : "—"}</small></button>;
        })}
      </div>
    </div>
    <aside className="overview-details" aria-label="当天 DDL 清单"><header><p className="eyebrow">每日清单</p><h3>{dateLabel}</h3><p>{labels[overviewDayState(selectedItems)]}</p></header>
      {selectedItems.length ? <ul>{selectedItems.map((item) => <li key={item.key} className={item.completed ? "done" : ""}>
        <input type="checkbox" aria-label={`完成 ${item.title}`} checked={item.completed} disabled={working || item.remoteCompleted} onChange={(event) => void onToggle(item, event.target.checked)} />
        <div><button className="overview-item-title" type="button" onClick={() => onOpen(item)}>{item.title}</button><p><span className={`overview-source ${item.source}`}>{item.source === "canvas" ? "Canvas" : "个人"}</span>{item.subtitle}</p><small>{item.remoteCompleted ? "Canvas 已提交 / 已评分" : new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(item.dueAt))}</small></div>
      </li>)}</ul> : <div className="overview-empty"><span>○</span><p>这天没有 DDL</p><small>在日程编辑器中勾选「纳入 DDL 总览」，就会显示在这里。</small></div>}
    </aside>
  </section>;
}

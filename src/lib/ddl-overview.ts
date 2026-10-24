import type { CalendarOccurrence, CanvasDeadline } from "./backend";
import { dateInTimezone } from "./calendar-days";
import { canvasCompleted, canvasRemotelyCompleted } from "./canvas-status";

type OverviewBase = { key: string; date: string; title: string; subtitle: string; dueAt: string; completed: boolean; remoteCompleted: boolean };
export type OverviewItem = OverviewBase & (
  | { source: "local"; value: CalendarOccurrence }
  | { source: "canvas"; value: CanvasDeadline }
);

export function buildOverviewItems(local: CalendarOccurrence[], canvas: CanvasDeadline[], timezone: string): OverviewItem[] {
  return [
    ...local.filter((item) => item.includeInOverview).map((value): OverviewItem => ({
      source: "local", value, key: `local:${value.occurrenceId}`, title: value.title,
      subtitle: "个人日程", dueAt: value.startUtc, date: dateInTimezone(new Date(value.startUtc), timezone),
      completed: !!value.overviewCompleted, remoteCompleted: false,
    })),
    ...canvas.map((value): OverviewItem => ({
      source: "canvas", value, key: `canvas:${value.instanceUrl}:${value.userId}:${value.courseId}:${value.assignmentId}`,
      title: value.title, subtitle: value.courseName, dueAt: value.dueAt,
      date: dateInTimezone(new Date(value.dueAt), timezone),
      completed: canvasCompleted(value), remoteCompleted: canvasRemotelyCompleted(value),
    })),
  ].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.title.localeCompare(b.title));
}

export function overviewDayState(items: OverviewItem[]) {
  return !items.length ? "empty" : items.some((item) => !item.completed) ? "pending" : "complete";
}

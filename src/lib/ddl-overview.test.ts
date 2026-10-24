import { describe, expect, it } from "vitest";
import type { CalendarOccurrence, CanvasDeadline } from "./backend";
import { buildOverviewItems, overviewDayState } from "./ddl-overview";

export function localDdl(patch: Partial<CalendarOccurrence> = {}): CalendarOccurrence {
  return { occurrenceId: "event@2026-10-24", eventId: "event", originalStartLocal: "2026-10-24T09:00:00", title: "写报告", description: "", location: "", category: "event", startUtc: "2026-10-24T01:00:00Z", endUtc: "2026-10-24T02:00:00Z", timezone: "Asia/Shanghai", displayTimezone: "Asia/Shanghai", allDay: false, color: "#34785c", includeInOverview: true, overviewCompleted: false, ...patch };
}
export function canvasDdl(patch: Partial<CanvasDeadline> = {}): CanvasDeadline {
  return { instanceUrl: "https://oc.sjtu.edu.cn", userId: "42", courseId: "7", assignmentId: "9", courseName: "程序设计", title: "实验作业", description: "", dueAt: "2026-10-24T15:59:00Z", lockAt: null, htmlUrl: "https://oc.sjtu.edu.cn/courses/7/assignments/9", workflowState: "unsubmitted", submittedAt: null, grade: null, localCompleted: false, ...patch };
}

describe("DDL overview states", () => {
  it("uses gray for no items, red for any incomplete item, and yellow only when all are complete", () => {
    expect(overviewDayState([])).toBe("empty");
    let items = buildOverviewItems([localDdl()], [canvasDdl({ localCompleted: true })], "Asia/Shanghai");
    expect(items).toHaveLength(2);
    expect(overviewDayState(items)).toBe("pending");
    items = buildOverviewItems([localDdl({ overviewCompleted: true })], [canvasDdl({ localCompleted: true })], "Asia/Shanghai");
    expect(overviewDayState(items)).toBe("complete");
  });
  it("only includes opted-in local events and counts remote submitted/graded work as complete", () => {
    const items = buildOverviewItems([localDdl({ includeInOverview: false })], [canvasDdl({ workflowState: "graded" }), canvasDdl({ assignmentId: "10", submittedAt: "2026-10-23T12:00:00Z" })], "Asia/Shanghai");
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.remoteCompleted)).toBe(true);
    expect(overviewDayState(items)).toBe("complete");
  });
  it("uses the display timezone and keeps recurring instance completion independent", () => {
    const items = buildOverviewItems([
      localDdl({ overviewCompleted: true, startUtc: "2026-10-31T16:00:00Z" }),
      localDdl({ occurrenceId: "event@next", startUtc: "2026-11-07T16:00:00Z" }),
    ], [], "Asia/Shanghai");
    expect(items.map((item) => [item.date, item.completed])).toEqual([["2026-11-01", true], ["2026-11-08", false]]);
    expect(buildOverviewItems([localDdl({ startUtc: "2026-10-31T16:00:00Z" })], [], "UTC")[0].date).toBe("2026-10-31");
  });
});

import { describe, expect, it } from "vitest";
import { dayMinutes, groupByDay } from "./calendar-days";

describe("calendar day segments", () => {
  const days = ["2026-10-19", "2026-10-20", "2026-10-21"];
  it("includes an overnight event on both days and clips each day independently", () => {
    const item = { startUtc: "2026-10-19T14:00:00Z", endUtc: "2026-10-20T02:00:00Z" };
    const grouped = groupByDay([item], days, "Asia/Shanghai");
    expect(grouped.get(days[0])).toEqual([item]);
    expect(grouped.get(days[1])).toEqual([item]);
    expect(grouped.get(days[2])).toEqual([]);
    expect(dayMinutes(item, days[0], "Asia/Shanghai")).toEqual({ start: 1320, end: 1440 });
    expect(dayMinutes(item, days[1], "Asia/Shanghai")).toEqual({ start: 0, end: 600 });
  });
  it("uses exclusive midnight ends for multi-day events and keeps deadlines on their due day", () => {
    const allDay = { startUtc: "2026-10-18T16:00:00Z", endUtc: "2026-10-20T16:00:00Z" };
    const grouped = groupByDay([allDay], days, "Asia/Shanghai");
    expect([...grouped.values()].map((items) => items.length)).toEqual([1, 1, 0]);
    const ddl = { ...allDay, category: "deadline" };
    expect([...groupByDay([ddl], days, "Asia/Shanghai").values()].map((items) => items.length)).toEqual([1, 0, 0]);
  });
  it("groups by the selected timezone across a DST change", () => {
    const item = { startUtc: "2026-11-01T03:00:00Z", endUtc: "2026-11-01T15:00:00Z" };
    const grouped = groupByDay([item], ["2026-10-31", "2026-11-01"], "America/New_York");
    expect([...grouped.values()].map((items) => items.length)).toEqual([1, 1]);
    expect(dayMinutes(item, "2026-11-01", "America/New_York")).toEqual({ start: 0, end: 600 });
  });
});

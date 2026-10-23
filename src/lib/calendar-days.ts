export function dateInTimezone(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

type Interval = { startUtc: string; endUtc: string; category?: string };

export function occursOnDay(item: Interval, day: string, timezone: string) {
  const startDay = dateInTimezone(new Date(item.startUtc), timezone);
  if (item.category === "deadline") return day === startDay;
  // End is exclusive: an event ending at midnight does not occupy the next day.
  const lastDay = dateInTimezone(new Date(Date.parse(item.endUtc) - 1), timezone);
  return startDay <= day && day <= lastDay;
}

export function groupByDay<T extends Interval>(items: T[], days: string[], timezone: string) {
  return new Map(days.map((day) => [day, items.filter((item) => occursOnDay(item, day, timezone))]));
}

export function dayMinutes(item: Interval, day: string, timezone: string) {
  const minute = (value: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
    return Number(parts.find((part) => part.type === "hour")?.value) * 60 + Number(parts.find((part) => part.type === "minute")?.value);
  };
  return {
    start: dateInTimezone(new Date(item.startUtc), timezone) < day ? 0 : minute(item.startUtc),
    end: dateInTimezone(new Date(item.endUtc), timezone) > day ? 1440 : minute(item.endUtc),
  };
}

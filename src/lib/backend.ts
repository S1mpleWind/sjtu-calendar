import { invoke } from "@tauri-apps/api/core";

export interface BackendStatus {
  database: "sqlite";
  schemaVersion: number;
}

export interface EventDraft {
  title: string;
  description: string;
  location: string;
  category: "event" | "deadline";
  startLocal: string;
  endLocal: string;
  timezone: string;
  allDay: boolean;
  rrule: string | null;
  color: string;
}

export interface PersonalEvent extends EventDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecurrenceOverride {
  title?: string | null;
  description?: string | null;
  location?: string | null;
  category?: "event" | "deadline" | null;
  startLocal?: string | null;
  endLocal?: string | null;
  timezone?: string | null;
  allDay?: boolean | null;
  color?: string | null;
}

export interface CalendarOccurrence {
  occurrenceId: string;
  eventId: string;
  originalStartLocal: string;
  title: string;
  description: string;
  location: string;
  category: "event" | "deadline";
  startUtc: string;
  endUtc: string;
  timezone: string;
  displayTimezone: string;
  allDay: boolean;
  color: string;
}

export function getBackendStatus(): Promise<BackendStatus> {
  return invoke<BackendStatus>("get_backend_status");
}

export const createPersonalEvent = (event: EventDraft) =>
  invoke<PersonalEvent>("create_personal_event", { event });

export const updatePersonalEvent = (id: string, event: EventDraft) =>
  invoke<PersonalEvent>("update_personal_event", { id, event });

export const deletePersonalEvent = (id: string) =>
  invoke<void>("delete_personal_event", { id });

export const getPersonalEvent = (id: string) =>
  invoke<PersonalEvent | null>("get_personal_event", { id });

export const listPersonalEvents = () =>
  invoke<PersonalEvent[]>("list_personal_events");

export const setRecurrenceException = (
  eventId: string,
  originalStartLocal: string,
  kind: "cancelled" | "override",
  overrideValue?: RecurrenceOverride,
) =>
  invoke<void>("set_recurrence_exception", {
    eventId,
    originalStartLocal,
    kind,
    overrideValue: overrideValue ?? null,
  });

export const getCalendarOccurrences = (
  fromDate: string,
  toDate: string,
  displayTimezone: string,
) =>
  invoke<CalendarOccurrence[]>("get_calendar_occurrences", {
    fromDate,
    toDate,
    displayTimezone,
  });

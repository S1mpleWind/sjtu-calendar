import { invoke } from "@tauri-apps/api/core";

export interface BackendStatus {
  database: "sqlite";
  schemaVersion: number;
}

export interface CanvasConnectionStatus { configured: boolean; instanceUrl: string | null }
export interface CanvasProfile { userId: string; name: string; instanceUrl: string }
export interface CanvasSyncResult { state: string; courseCount: number; assignmentCount: number; failedCourses: string[]; syncedAt: string }
export interface CanvasDeadline {
  instanceUrl: string; userId: string; courseId: string; assignmentId: string; courseName: string;
  title: string; description: string; dueAt: string; lockAt: string | null; htmlUrl: string;
  workflowState: string | null; submittedAt: string | null; grade: string | null; localCompleted: boolean;
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

export const saveCanvasCredentials = (instanceUrl: string, token: string) =>
  invoke<void>("save_canvas_credentials", { instanceUrl, token });
export const clearCanvasCredentials = () => invoke<void>("clear_canvas_credentials");
export const getCanvasConnectionStatus = () => invoke<CanvasConnectionStatus>("get_canvas_connection_status");
export const testCanvasConnection = () => invoke<CanvasProfile>("test_canvas_connection");
export const syncCanvas = () => invoke<CanvasSyncResult>("sync_canvas");
export const getCanvasDeadlines = (fromDate: string, toDate: string, displayTimezone: string) =>
  invoke<CanvasDeadline[]>("get_canvas_deadlines", { fromDate, toDate, displayTimezone });
export const setCanvasAssignmentCompleted = (courseId: string, assignmentId: string, completed: boolean) =>
  invoke<void>("set_canvas_assignment_completed", { courseId, assignmentId, completed });

import { invoke } from "@tauri-apps/api/core";

export interface BackendStatus {
  database: "sqlite";
  schemaVersion: number;
}
export interface WidgetStatus { canvasLastSuccessAt: string | null; sjtuLastSuccessAt: string | null; alwaysOnTop: boolean }

export interface CanvasConnectionStatus { configured: boolean; instanceUrl: string | null; accountVerified: boolean }
export interface CanvasProfile { userId: string; name: string; instanceUrl: string }
export interface CanvasSyncResult { state: string; courseCount: number; assignmentCount: number; failedCourses: string[]; syncedAt: string }
export interface CanvasDeadline {
  instanceUrl: string; userId: string; courseId: string; assignmentId: string; courseName: string;
  title: string; description: string; dueAt: string; lockAt: string | null; htmlUrl: string;
  workflowState: string | null; submittedAt: string | null; grade: string | null; localCompleted: boolean;
}
export interface SjtuConnectionStatus { undergraduateConfigured: boolean; graduateConfigured: boolean }
export interface SjtuSyncResult { sourceSystem: string; state: string; courseCount: number; meetingCount: number; skippedRows: number; syncedAt: string }
export interface SjtuCourseOccurrence {
  occurrenceId: string; courseId: string; termId: string; sourceSystem: string; title: string;
  teacher: string; location: string; startUtc: string; endUtc: string; timezone: string;
  color: string; weekNumber: number; weekday: number; startSection: number; endSection: number;
  meetingId: string; note: string;
}

export interface IcsPreview {
  sourceName: string;
  eventCount: number;
  preview: Array<{ title: string; startLocal: string; endLocal: string; location: string }>;
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
  includeInOverview: boolean;
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
  includeInOverview?: boolean | null;
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
  includeInOverview: boolean;
  overviewCompleted: boolean;
}

export function getBackendStatus(): Promise<BackendStatus> {
  return invoke<BackendStatus>("get_backend_status");
}

export const getWidgetStatus = () => invoke<WidgetStatus>("get_widget_status");
export const toggleWidget = () => invoke<void>("toggle_widget");
export const showMainWindow = () => invoke<void>("show_main_window");
export const hideWidget = () => invoke<void>("hide_widget");
export const setWidgetAlwaysOnTop = (enabled: boolean) =>
  invoke<void>("set_widget_always_on_top", { enabled });

export const exportDataBackup = () => invoke<string>("export_data_backup");
export const restoreDataBackup = (backupJson: string) =>
  invoke<number>("restore_data_backup", { backupJson });

export const createPersonalEvent = (event: EventDraft) =>
  invoke<PersonalEvent>("create_personal_event", { event });

export const updatePersonalEvent = (id: string, event: EventDraft) =>
  invoke<PersonalEvent>("update_personal_event", { id, event });

export const deletePersonalEvent = (id: string) =>
  invoke<void>("delete_personal_event", { id });

export const setPersonalEventCompleted = (eventId: string, originalStartLocal: string, completed: boolean) =>
  invoke<void>("set_personal_event_completed", { eventId, originalStartLocal, completed });

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

export const getSjtuConnectionStatus = () => invoke<SjtuConnectionStatus>("get_sjtu_connection_status");
export const startSjtuLogin = (sourceSystem: "undergraduate" | "graduate") =>
  invoke<void>("start_sjtu_login", { sourceSystem });
export const finishSjtuLogin = (sourceSystem: "undergraduate" | "graduate") =>
  invoke<void>("finish_sjtu_login", { sourceSystem });
export const clearSjtuLogin = (sourceSystem: "undergraduate" | "graduate") =>
  invoke<void>("clear_sjtu_login", { sourceSystem });
export const syncSjtu = (sourceSystem: "undergraduate" | "graduate", academicYear: string, termCode: "1" | "2" | "3", startDate: string, weekCount: number) =>
  invoke<SjtuSyncResult>("sync_sjtu", { sourceSystem, academicYear, termCode, startDate, weekCount });
export const getSjtuCourseOccurrences = (fromDate: string, toDate: string, displayTimezone: string) =>
  invoke<SjtuCourseOccurrence[]>("get_sjtu_course_occurrences", { fromDate, toDate, displayTimezone });
export const setSjtuOccurrenceNote = (meetingId: string, weekNumber: number, note: string) =>
  invoke<void>("set_sjtu_occurrence_note", { meetingId, weekNumber, note });
export const previewIcsImport = (content: string, sourceName: string, firstMonday: string, weekCount: number) =>
  invoke<IcsPreview>("preview_ics_import", { content, sourceName, firstMonday, weekCount });
export const applyIcsImport = (content: string, sourceName: string, firstMonday: string, weekCount: number, replaceSource: boolean) =>
  invoke<number>("apply_ics_import", { content, sourceName, firstMonday, weekCount, replaceSource });

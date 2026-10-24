# 数据模型（Phase 0 基线）

Phase 0 仅创建 `app_settings(key, value_json, updated_at)` 并以 `schema_migrations(version, applied_at)` 管理升级。初始设置保存 `Asia/Shanghai` 时区默认值，JSON 内容作为值而非 SQL 文本格式保存。

后续迁移将增加独立的学期、课程、课程 meeting、作业、个人事件、重复例外、数据源和同步运行表。课程、Canvas 作业与用户日程保持分实体存储，再由 Rust 查询层投影为 `CalendarOccurrence`。Token/Cookie 不属于业务表。

## Phase 1: personal events (schema v2)

`personal_events` stores user-owned events and deadlines. Start/end values are local wall-clock strings (`YYYY-MM-DDTHH:MM:SS`) paired with an IANA timezone. `rrule` stores an RFC 5545 recurrence rule body; an empty value means a single event. Deletion is a soft delete.

`recurrence_exceptions` uses `(event_id, original_start_local)` as the unique recurrence identity. A cancelled occurrence has no override JSON. An overridden occurrence stores a validated event snapshot, so moving or renaming one date does not change its series. Calendar queries project matching records as UTC instants and include the requested display timezone.

Rust owns validation, RRULE expansion, exception application and SQLite access. Event creation rejects invalid IANA zones, nonexistent local start/end times, unsupported categories, empty titles, invalid colors and reversed or overlong ranges. Ambiguous local times select the earlier offset. A generated recurrence in a DST gap is skipped.

## Phase 3: Canvas cache (schema v3)

`canvas_courses` and `canvas_assignments` are keyed by instance, Canvas user and remote object identifiers. Assignment rows keep the remote submission state, deadline, course/title/description and last sync time alongside `local_completed`, which is user-owned and retained across remote upserts. `canvas_sync_state` records sync status and counts. Credentials are excluded from all SQLite tables: only non-secret instance/account settings are in `app_settings`; the token is in Windows Credential Manager. Cached Canvas assignments are read-only remote records apart from the local completion flag.

The account selection additionally stores `canvas.active_user_id` (a verified remote identity) and `canvas.credential_revision` (a random, non-secret configuration revision) in `app_settings`. Neither is a token. Credential replacement clears the selected user; stale requests cannot write data when their revision no longer matches. Restore clears the selection because a backup does not carry its matching Credential Manager secret. No schema migration or cache deletion is needed.

## Phase 4: SJTU course cache (schema v4)

`academic_terms` stores the source-specific academic year/term, manually supplied first teaching-week Monday, week count and `Asia/Shanghai` timezone. `sjtu_courses` uses `(term_id, source_system, external_id)` as its natural unique key. `course_meetings` separates multiple weekdays/sections/weeks/rooms for a course; week numbers are explicit JSON arrays, and stable IDs make sync repeatable. `sjtu_sync_state` records complete or partial applies. Credentials are not stored in SQLite.

Schema v6 adds `course_occurrence_notes`, keyed by meeting and teaching week. A note belongs to one dated class occurrence and survives schedule refreshes; clearing the note deletes only that occurrence's row.

## Legacy import metadata (schema v5)

`personal_events.import_source` and `import_key` retain legacy import provenance and its partial unique index. ICS import was removed in v1.1.0; these columns and migration v5 remain so existing databases, imported personal events and backups continue to work. Database backup exports a checkpointed SQLite image in a versioned JSON envelope; restore validates SHA-256 and SQLite integrity before migration and file replacement. Credential Manager entries are outside the database.

## DDL overview (schema v7)

`personal_events.include_in_overview` is an explicit opt-in for any local event. Existing local `deadline` rows are opted in once during migration; ordinary events and imported course events default to false. Recurrence overrides can change opt-in for one occurrence, while legacy override JSON inherits the migrated parent value.

`personal_event_completion(event_id, original_start_local, completed, updated_at)` stores independent completion for each local occurrence. A moved recurring override keeps its original identity; moving a non-recurring event relocates its completion key in the event-update transaction. Cancelled/deleted and opted-out occurrences do not contribute to the overview. Both settings and completion rows are included in database backups.

The overview groups local opted-in occurrences by their start date and Canvas assignments by `due_at`, using the selected display timezone. Empty days are gray, any incomplete item makes a day red, and all complete items make it yellow. Canvas completion combines the existing local completion mark with remote submission state; its remote metadata is not modified.

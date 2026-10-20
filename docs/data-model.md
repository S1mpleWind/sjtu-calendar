# 数据模型（Phase 0 基线）

Phase 0 仅创建 `app_settings(key, value_json, updated_at)` 并以 `schema_migrations(version, applied_at)` 管理升级。初始设置保存 `Asia/Shanghai` 时区默认值，JSON 内容作为值而非 SQL 文本格式保存。

后续迁移将增加独立的学期、课程、课程 meeting、作业、个人事件、重复例外、数据源和同步运行表。课程、Canvas 作业与用户日程保持分实体存储，再由 Rust 查询层投影为 `CalendarOccurrence`。Token/Cookie 不属于业务表。

## Phase 1: personal events (schema v2)

`personal_events` stores user-owned events and deadlines. Start/end values are local wall-clock strings (`YYYY-MM-DDTHH:MM:SS`) paired with an IANA timezone. `rrule` stores an RFC 5545 recurrence rule body; an empty value means a single event. Deletion is a soft delete.

`recurrence_exceptions` uses `(event_id, original_start_local)` as the unique recurrence identity. A cancelled occurrence has no override JSON. An overridden occurrence stores a validated event snapshot, so moving or renaming one date does not change its series. Calendar queries project matching records as UTC instants and include the requested display timezone.

Rust owns validation, RRULE expansion, exception application and SQLite access. Event creation rejects invalid IANA zones, nonexistent local start/end times, unsupported categories, empty titles, invalid colors and reversed or overlong ranges. Ambiguous local times select the earlier offset. A generated recurrence in a DST gap is skipped.

## Phase 3: Canvas cache (schema v3)

`canvas_courses` and `canvas_assignments` are keyed by instance, Canvas user and remote object identifiers. Assignment rows keep the remote submission state, deadline, course/title/description and last sync time alongside `local_completed`, which is user-owned and retained across remote upserts. `canvas_sync_state` records sync status and counts. Credentials are excluded from all SQLite tables: only the selected instance origin is in `app_settings`; the token is in Windows Credential Manager. Cached Canvas assignments are read-only remote records apart from the local completion flag.

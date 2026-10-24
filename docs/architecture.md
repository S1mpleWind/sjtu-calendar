# 架构（Phase 0 基线）

- 桌面壳：Tauri 2，Windows 普通可调整大小窗口。
- 前端：React + TypeScript + Vite；所有后端命令通过 `src/lib/backend.ts` 封装。
- 后端：Rust Tauri commands；`rusqlite` 独占 SQLite 访问，前端不直接访问数据库。
- 持久化：SQLite 文件位于 Tauri `app_data_dir`，Rust 启动时启用 WAL 与外键并应用版本化 SQL migration。
- WebView CSP 限定为本地资源与 Tauri IPC；没有外链字体、脚本或暂不需要的 opener 插件权限。
- 外部数据源：尚未接入。后续各自实现 Canvas 与 SJTU provider，远端错误不得清除已缓存数据。

当前只有 `get_backend_status` 跨层调用，用于检查数据库可读并返回 schema 版本。Phase 0 的健康检查不能代表日程 CRUD 或外部同步已完成。

## Phase 1 update

The Rust backend now exposes typed personal-event CRUD, recurrence-exception and date-range occurrence commands. The date-range query projects stored local wall-clock recurrence into UTC instants while retaining event and display timezone metadata. React calls these commands through `src/lib/backend.ts`; the calendar interface is scheduled for Phase 2.

## Phase 2 update

The main window now renders local query results in week/month layouts and supports event creation, editing, removal, one-occurrence exceptions, timezone selection, refresh and error states. Canvas/SJTU source indicators remain disconnected until their sync phases.

## Phase 3 update — Canvas

`src-tauri/src/canvas.rs` owns the Canvas HTTP client, token access through Windows Credential Manager, paginated API reads, SQLite cache updates and local completion flags. Canvas credentials and cache never enter browser storage. Startup calendar queries read the last synchronized user cache without network access. Partial course failures preserve existing cache rows; a fully successful sync archives rows no longer returned. See `docs/integration-canvas.md` for endpoint and security details.

## Phase 4 update — SJTU and ICS

`src-tauri/src/sjtu.rs` separates undergraduate and graduate HTTP adapters from their row parsers. Each maps into explicit course and meeting values, then applies one SQLite transaction; complete syncs archive stale meetings, while partial parses and request errors preserve the last cache. The authenticated WebView is isolated from the main window, and its cookies are read only in the Rust backend, saved in Windows Credential Manager, and removed from the temporary WebView when the login window closes. The saved-session flag is not an authentication claim; only a real schedule request can validate it. Source audit and the user's live verification steps are in `docs/integration-sjtu.md`.

When live account verification is unavailable, `src-tauri/src/ics.rs` provides a deliberately labeled import path. It previews and maps common single and weekly VEVENTs to a selected academic term, then stores their expanded instances as local personal events. Migration v5 tracks source filename and event identity for idempotency and replacement. It never records an imported file as an SJTU sync result.

SJTU term suggestions are bundled only for terms whose first teaching Monday was verified from official SJTU notices; users can correct the date before sync. One-off class notes are stored by meeting and teaching week (schema v6), so they do not spill into other repetitions.

## Phase 5 update — release readiness

`src-tauri/src/backup.rs` exports a versioned JSON envelope containing a checkpointed SQLite file, Base64 payload and SHA-256 checksum. Restore validates envelope/version/checksum and SQLite integrity, migrates a temporary database before replacing the live file, and keeps a pre-restore copy. Credential Manager secrets are outside SQLite and do not enter backups. The calendar exposes keyboard shortcuts for create, date navigation and view selection. User steps are in `docs/operations.md`.

## Desktop Widget (`feat/desktop-widget`)

The optional frameless Widget is a separate Tauri window that reads calendar, SJTU, and Canvas data through the same Rust/SQLite commands as the main window. It does not perform a second sync or use demo data. On launch, the compact Widget is visible while the main window stays hidden in the tray; the Widget's “主程序” control opens the main window. Window bounds are persisted with Tauri's window-state plugin without restoring visibility, and always-on-top is opt-in and stored in app data. A system tray menu opens the main window, toggles the Widget, or exits the application. Clicking an item routes to its detail in the main window. Closing either app window hides it so the tray remains available.

## Calendar consistency fixes (2026-10-23)

Successful backend writes broadcast `calendar-data-changed`; both windows reload their cache on that event and on focus. The main window also broadcasts display-timezone changes to the Widget. Request sequence guards prevent older reads from replacing newer results.

Recurrence editing explicitly selects single or series scope before editing. Series scope loads the original event and retains its full RRULE. Range queries also inspect overridden identities whose original occurrence lies outside the requested dates. Day grouping spans every overlapping date with exclusive end boundaries, retaining the original occurrence identity for edits.

Canvas caches are selected by an explicitly verified user ID, rather than the most recent sync timestamp. Replacing credentials invalidates that selection and rotates a revision; in-flight tests/syncs must match the revision before binding an account or applying data. Backup restore invalidates that binding because credentials are outside the database.

## Monthly DDL overview (2026-10-24)

The main window exposes a monthly overview through the sidebar. `DdlOverview.tsx` renders date circles and the selected day's actionable list; `lib/ddl-overview.ts` derives date/status values from real local-calendar and Canvas-cache queries. The monthly query covers the actual first through last day, including timezone conversion. It does not trigger network sync on navigation.

Local completion commands validate the original occurrence, opt-in flag and cancellation state before persisting. Successful changes broadcast the existing cache-change event. Canvas uses its existing account-scoped completion command, and remotely submitted/graded items remain checked. No demo records are inserted into the application.

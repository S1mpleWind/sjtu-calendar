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

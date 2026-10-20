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

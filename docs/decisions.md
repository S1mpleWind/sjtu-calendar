# 工程决策

## 0001 — 用 Rust `rusqlite` 管理 SQLite

- 状态：已采用（Phase 0）。
- 决策：SQLite 连接、迁移和后续查询均由 Rust 负责；React 只经类型化 Tauri command 请求数据。
- 原因：满足单一持久化层要求，避免通过 Tauri SQL 插件把数据库查询暴露给 UI 组件；`rusqlite` 的同步连接适用于当前单窗口本地应用，Phase 1 再评估连接所有权与事务策略。
- 迁移：SQL 文件有序编号，通过 `schema_migrations` 版本表重复应用时跳过已完成迁移。

## 0002 — Phase 0 使用 Tauri 官方 React/TypeScript 脚手架

- 状态：已采用。
- 原因：该脚手架提供与已安装稳定 Tauri 2 CLI 对应的 Vite/Tauri 配置，锁定生成时解析出的 npm 与 Rust 依赖，并减少手工拼接配置。

## 0003 — 启用受限 CSP 并移除未使用的 opener 插件

- 状态：已采用（Phase 0）。
- 原因：桌面壳只访问本地 UI 和 Tauri IPC；阶段 0 不打开外部链接。遵循 Tauri 官方 CSP 建议，未使用的 opener 能力暂不授予。

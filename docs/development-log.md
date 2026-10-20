# 开发日志

## Phase 0 — `chore/bootstrap`

- 日期：2026-10-20（Asia/Singapore）
- 工具链：`Get-ComputerInfo` 报告 Windows 10 Pro build 26200；Git 2.42.0.windows.2；Node v22.20.0；npm 10.9.3；pnpm 10.12.1；Rust 1.98.1；Cargo 1.98.1；VS 2022 Build Tools 17.14.37628.2；Windows SDK 10.0.26100.0；WebView2 Runtime 155.0.4283.62。
- 参考仓库：Course-Block `b0ead20ae854a7cb5432b23f23138be908d5565c`；Canvas-Helper `780001ecb7e0e74d9af44847dbbee1f80f890c94`。
- 实现：Tauri 2.12.4 + React 19.3.1/TypeScript 6.0.3/Vite 8.3.4 根工程；Rust `rusqlite` 0.38.0 数据库初始化与 version 1 migration；`get_backend_status` command；Vitest 5.0.5/Testing Library 与 ESLint 10.13.0 基础配置；限制本地资源/IPC 的 CSP；源码审计和项目文档初版。
- 验证：`pnpm install --frozen-lockfile` 成功；`pnpm lint` 成功；`pnpm test` 1 个测试成功；`pnpm build` 成功；`src-tauri` 下 `cargo fmt --check` 与 `cargo test` 成功（1 个 SQLite migration 测试）；`pnpm tauri dev` 在 CSP 收紧前打开实际 Windows 窗口并由 UI command 读出 SQLite schema version 1。CSP 收紧后再次编译并运行成功，桌面检查被物理 Escape 键中断，没有再次点击 invoke。首次 Cargo 构建时间约 5m22s。Rust linker 输出一条生成 import library 的 warning，不影响测试。
- 外部账户：未登录、未访问真实账户；`SOURCE_INSPECTED`。
- 安全：SQLite migration 不含 Token/Cookie；参考仓库未提交。
- Git：首个工程提交 `b7e00c4a44b737fa9e3ee03a0e0b35de5aeafa25`；工作目录原先 `main` 无任何提交/ref，因此先以该提交建立本地 `main`，再由最终日志提交 fast-forward 更新；不推送远端。
- 未验证项：认证和外部 API live 行为、CSP 收紧后的 invoke 点击、窗口缩放手工检查、安装包（Phase 5）。

## Phase 1 - `feat/calendar-core`

- Date: 2026-10-20 (Asia/Singapore).
- Implementation: schema v2 event and recurrence-exception tables; Rust validation and CRUD; RFC 5545 recurrence expansion with stable single-occurrence cancellation/override; timezone-aware `CalendarOccurrence` projection; TypeScript Tauri command wrappers.
- Verification: `cargo fmt --check` and `cargo test` passed (6 tests); `pnpm lint`, `pnpm test` (1 test), and `pnpm build` passed. A first query-window assertion expected a November 11 occurrence in a range ending November 5; the test range was corrected to November 12, after which all tests passed.
- External authentication/API status: not applicable to the local event layer. No mock data or credentials were used.
- Security: personal event data only; no Token/Cookie storage. SQLite keeps user-owned records in Rust-managed app data.
- Windows desktop dev launch (`pnpm tauri dev`) started successfully and generated the app executable; interactive event editing/rendering remains Phase 2.
- Implementation commit: `21d36cbf4248d9d2594eae05c7ea2f038cad1c27`.

## Phase 2 - `feat/calendar-ui`

- Date: 2026-10-20 (Asia/Singapore).
- Implementation: main-window week and month views, mini-calendar date selection, previous/next/today navigation, per-day DDL/all-day strip, event cards with overlap columns, local event create/edit/delete drawer, series and single-occurrence actions, timezone setting persisted locally, refresh/error states. All calendar content comes from the Rust SQLite commands; Canvas and SJTU remain explicitly disconnected.
- Verification: `pnpm lint`, `pnpm test` (4 UI tests), `pnpm build`, `cargo fmt --check`, and `cargo test` (6 tests) passed. `pnpm tauri dev` compiled and launched the Windows executable.
- Manual review: interactive window resize, live CRUD through the native WebView, and high-DPI layout were not manually checked in this run.
- API status: local Rust commands only; no external API or authentication was used.
- Git implementation commit: `4df3d828be436d1de01e49c86929ac3ae77413a0`.

## Phase 3 - `feat/canvas-sync`

- Date: 2026-10-20 (Asia/Singapore).
- Implementation: schema v3 Canvas course/assignment/sync cache; allowlisted Canvas HTTPS client with bounded pagination, no redirects, user verification, active course and assignment reads; user-entered tokens stored in Windows Credential Manager; offline cache query; partial sync retention and successful full-sync archival; local-only completion flags; Settings connect/test/sync/disconnect actions and calendar deadline display.
- API basis: audited helper commit `780001ecb7e0e74d9af44847dbbee1f80f890c94` and official Canvas users, courses and assignments API docs. Runtime origins restricted to `oc.sjtu.edu.cn` and `jicanvas.com` verified by that source.
- Verification: `cargo fmt --check`, `cargo test` (10 passed), `pnpm lint`, `pnpm test` (5 passed), and `pnpm build` passed. Rust tests used a local HTTP fixture for Bearer auth and Link pagination; other cache tests used isolated temporary SQLite files. No fixture feeds the app at runtime.
- Credentials/live API: no account token used. The Settings panel now allows the user to enter their own token directly into the app; no credential should be sent via chat. Live account test and Windows Credential Manager UI acceptance remain unverified.
- Known limits: section-specific `all_dates`/override projections are not implemented; deadline placement uses `due_at`. Native-window review remains outstanding.
- Git implementation commit: `c702ba8bdb0427bad6aa595187220ffc0187e608`.

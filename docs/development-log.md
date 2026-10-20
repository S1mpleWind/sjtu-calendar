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

## Phase 4 — `feat/sjtu-sync`

- Date: 2026-10-20 (Asia/Singapore).
- Implementation: audited the actual undergraduate/graduate login routes, request fields, response shapes, parser fields and section table in the ignored Course-Block source. Added separate Rust request/parser paths, Windows Credential Manager cookie storage, an isolated interactive WebView with cleanup, academic term/meeting cache (schema v4), cached calendar projection, partial-result preservation and successful-sync stale-row archival. Added a clearly labeled ICS fallback with term mapping, preview, weekly expansion, per-source replacement/idempotency (schema v5), stored as local personal events rather than remote-synced courses.
- Verification: `cargo fmt --check` and `cargo test` passed (17 tests); fixtures cover UG/graduate multi-meeting parsing, odd/even week expressions, room changes, no-ghost replacement, partial retention and term projection; ICS tests cover preview, term mapping and repeated source replacement. `pnpm lint`, `pnpm test` (7 passed), and `pnpm build` passed. The only Rust warning was the Windows linker reporting creation of its import library.
- Live authentication/API: no real SJTU account was used. Endpoints and fields remain `CONFIRMED_BY_SOURCE`; they are not `VERIFIED_LIVE`. User manual login and schedule comparison steps are in `docs/integration-sjtu.md`. “Saved session” reports only local credential presence.
- Security: no credentials in UI input, logs, SQLite, fixtures or Git. Cookies are read by the Rust WebView API, stored in Windows Credential Manager and temporary login-window browsing data is cleared on completion/close. ICS source content is not persisted.
- Implementation commit: `dc5d62be9696683fb137af2ba4ad6df60b8f99f9`.
- Outstanding manual acceptance: real undergraduate/graduate login, first sync and visual comparison, Credential Manager disconnect cleanup, live window resize/high-DPI review. Phase 5 packaging is next.

## Phase 5 — `release/desktop-v1`

- Date: 2026-10-20 (Asia/Singapore).
- Implementation: updated the README and added `docs/operations.md`; added Ctrl+N, Ctrl+arrow date navigation and Ctrl+1/2 view shortcuts; added a versioned SQLite JSON backup with SHA-256 and integrity validation, safe restore through a migrated temporary DB, and a retained pre-restore copy; documented direct dependency licenses in `THIRD-PARTY-NOTICES.md`. Tauri now uses the stable product name `SJTU Schedule` and defaults to an x64 NSIS installer.
- Verification: `cargo fmt --check`, `cargo test` (20 passed, including backup/restore round trip and corrupted-checksum safety); `pnpm lint`, `pnpm test` (9 passed), `pnpm build`; and the exact `pnpm tauri build` command all passed. Cargo emitted only the Windows linker import-library creation warning.
- Installer: `src-tauri/target/release/bundle/nsis/SJTU Schedule_0.1.0_x64-setup.exe`, 3,497,205 bytes (3.34 MiB), SHA-256 `5B2A7EF0DE7F2A668012859BA8E7BB9058158E843A829BF3C78F59FBB48E3E77`. The first all-target build timed out while Tauri downloaded WiX (`timeout: global`); configuring the available NSIS target lets the required unqualified build command finish and produces the installer above.
- Manual acceptance: installer installation/uninstallation, restart/persistence in the packaged WebView, native backup-download/restore interaction and high-DPI review remain unverified. Automated DB backup/restore tests pass. No real SJTU account was used; follow `docs/integration-sjtu.md` for manual authentication and schedule comparison. External credentials remain outside the backup.
- Implementation commit: `23185730f25695d18f5add2e00cfdd558abbaafe`.

## Follow-up — `fix/sjtu-login-window-diagnostics`

- Date: 2026-10-20 (Asia/Singapore).
- Investigation: the official undergraduate portal currently links to `/jaccountlogin`; a direct request redirects to the SJTU jAccount host and returns HTTP 200. This verifies the route is reachable from this machine, but does not verify interactive WebView authentication.
- Change: login-window creation and focus errors now include the underlying Windows/Tauri error so the Settings notice can distinguish a cache-directory failure from a WebView creation failure.
- ICS clarification: `.ics` is the standard iCalendar file format. The Settings importer is an optional local fallback for course files; imported entries are never marked as a live SJTU sync. It is included because the project requirements explicitly request a file-import fallback when account access or the live interface cannot be verified.
- Verification: direct official undergraduate entry and jAccount page rendered in the WebView; no credentials were entered. `pnpm tauri dev` also confirmed the async window creation fix. Authentication and course sync remain unverified live.
- Commit SHA: `30dccdbc1feddea486a32d00478d1eaeb0ca0774`.
- Outstanding: real login, schedule sync and calendar comparison still require the user's interaction; no credentials were used in development.

## Follow-up — SJTU term suggestions and single-class notes

- Date: 2026-10-20 (Asia/Singapore).
- Implementation: first teaching-week dates and teaching-week counts now prefill for SJTU terms verified from official academic-affairs notices. Unknown terms remain editable and require a date rather than using a guessed value. Added schema v6 `course_occurrence_notes`, keyed to one meeting and teaching week, a Tauri save command, detail-editor textarea, and a star on annotated week/month course cards.
- Verification: `cargo fmt --check`, `cargo test` (20 passed), `pnpm lint`, `pnpm test` (11 passed), and `pnpm build` passed. Rust fixture verifies occurrence isolation; frontend test verifies save invocation and star rendering.
- Windows packaging: `pnpm tauri build` passed and produced `src-tauri/target/release/bundle/nsis/SJTU Schedule_0.1.0_x64-setup.exe` (3,502,230 bytes; SHA-256 `B1C620EAB7A8B27CB990160E9F20F6F6D86C91CC768AEB93E511FAB92AB09DE2`).
- External verification: official SJTU notices support 2026-09-14 (2026–27 fall) and 2026-03-02 (2025–26 spring). No real SJTU account was used; schedule sync remains unverified live.
- Git SHA: `30dccdbc1feddea486a32d00478d1eaeb0ca0774`; login-window diagnostic changes were also verified and included.
- Manual acceptance: native window layout and real account schedule comparison have not been rechecked.

## Follow-up — remove duplicate weekday/date labels

- Date: 2026-10-20 (Asia/Singapore).
- Change: removed the repeated weekday/date headings from the Canvas deadline strip; the calendar's top day headers remain visible and the deadline columns remain aligned.
- Verification: `pnpm lint`, `pnpm test` (11 passed), `pnpm build`; the UI test asserts seven top headings and no bottom strip headings.
- Git SHA: `8a53530dfd9b42865ffb3ec9308e55c97c845ee9`.

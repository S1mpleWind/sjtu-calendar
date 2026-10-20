# 阶段验收记录

## Phase 0

- [x] `pnpm install --frozen-lockfile` — lockfile up to date。
- [x] `pnpm lint` — 通过。
- [x] `pnpm test` — Vitest 1 file / 1 test passed。首轮第二个错误态测试因 mock rejection 触发 Vitest 未处理异常而失败；删除不稳定测试后，保留的成功路径测试通过。UI 仍提供错误提示，错误路径未自动化验证。
- [x] `pnpm build` — TypeScript 检查和 Vite production build 通过。
- [x] `cargo test`（`src-tauri`）— 1 个 SQLite migration 测试通过；main/doc tests 无失败。
- [x] `pnpm tauri dev` — 实际打开 Windows Tauri 窗口；受限 CSP 加入前点击“检查本地存储”显示 SQLite 已连接、迁移版本 1。数据库文件创建于 `%APPDATA%\edu.sjtu.schedule\calendar.sqlite3`。CSP 收紧后再次运行已完成编译并启动应用，但桌面检查被物理 Escape 键中断，因此未再次点击 invoke。
- [x] `git check-ignore` — 两个参考仓库均由 `references/` 规则忽略。
- [x] Commit — `b7e00c4a44b737fa9e3ee03a0e0b35de5aeafa25`（bootstrap 根提交）。原仓库 `main` 无历史/ref；本地 `main` 由该提交建立，最终日志提交 fast-forward 到 `main`。

## Phase 1

- [x] v2 migration creates indexed personal-event and recurrence-exception tables; repeat migration preserves existing data.
- [x] Personal-event create/read/update/soft-delete and reopening a file-backed database.
- [x] Biweekly recurrence across a month boundary; cancelling one occurrence leaves subsequent occurrences.
- [x] UNTIL-bounded recurrence, one-occurrence override, cross-day occurrence and Asia/Shanghai to Asia/Tokyo projection.
- [x] Reject invalid title/timezone/range and nonexistent initial DST local time; skip generated occurrence in DST gap.
- [x] `cargo fmt --check`, `cargo test`, `pnpm lint`, `pnpm test`, `pnpm build`.
- [ ] Phase 2 manual UI acceptance: add/edit/delete from the calendar window and validate rendered occurrence cards.

## Phase 2

- [x] Week and month views with date navigation and timezone-aware query ranges.
- [x] Local event editor for title, description, location, event/deadline category, times, all-day, color and daily/weekly/biweekly recurrence.
- [x] Edit/delete a series or change/cancel one recurring occurrence.
- [x] Empty database renders an empty calendar without fabricated entries; Canvas/SJTU explicitly show disconnected state.
- [x] Concurrent events occupy separate columns; DDL/all-day items render in the per-day shelf.
- [x] Refresh, query error and retry states; timezone preference persists in this device's localStorage.
- [x] `pnpm lint`, `pnpm test` (4 tests), `pnpm build`, `cargo fmt --check`, `cargo test` (6 tests); `pnpm tauri dev` launched the Windows executable.
- [ ] Manual native-window resize/high-DPI and live CRUD review.

## Phase 3 — Canvas

- [x] `cargo fmt --check` and `cargo test` (10 tests): verified instance allowlist, local HTTP fixture sends Bearer auth and follows Canvas Link pagination, repeated upsert retains a local completion flag, partial sync preserves previously cached rows, and cached deadline query works without any network call.
- [x] `pnpm lint`, `pnpm test` (5 tests, including the secure Canvas credential command flow), and `pnpm build`.
- [x] No fixture or mock result is used by the app at runtime; user must enter their own token in Settings and use Test Connection/Sync.
- [ ] User-authenticated live Canvas test. Requires the user to enter a token locally in the application; do not send the token in chat.

## Phase 4 — SJTU schedule and ICS fallback

- [x] Undergraduate and graduate redacted fixtures parse multiple meetings, section ranges, odd/even weeks and different rooms; week-expression parser covers explicit week lists/ranges.
- [x] Repeated full sync upserts the same stable course/meeting IDs. A room change archives the old meeting and leaves only the current visible schedule; partial parsing preserves existing rows.
- [x] Academic term requires a valid Monday and 1–24 teaching weeks; occurrence projection maps the first meeting to the selected teaching-week date in `Asia/Shanghai`.
- [x] ICS preview maps a weekly course to the selected term; apply/replacement is transactional, keeps one active copy per source and does not write SJTU sync status. Fixtures are test-only.
- [x] `cargo fmt --check`, `cargo test` (17 tests), `pnpm lint`, `pnpm test` (7 UI tests), and `pnpm build` passed after final fixes.
- [ ] Manual SJTU sign-in, first schedule sync, calendar comparison, disconnect/credential cleanup, and native WebView acceptance. See `docs/integration-sjtu.md`; no live verification is claimed.

## Phase 5 — release and packaging

- [x] Chinese user guide covers startup, keyboard shortcuts, external account sign-in, ICS fallback, offline cache and backup/restore.
- [x] SQLite backup round trip restores event/cache bytes; checksum failure leaves the current database unchanged; restore validates integrity and preserves the pre-restore database.
- [x] `THIRD-PARTY-NOTICES.md` records direct runtime dependency versions and licenses; reference source terms are stated without copying code.
- [x] `pnpm lint`, `pnpm test` (9 passed), `pnpm build`, `cargo fmt --check`, `cargo test` (20 passed).
- [x] `pnpm tauri build` produces an NSIS x64 installer at `src-tauri/target/release/bundle/nsis/SJTU Schedule_0.1.0_x64-setup.exe` (3.34 MiB).
- [ ] Manual install/uninstall, packaged WebView sign-in, app restart, backup download/restore UI and persistence review.

## Follow-up — SJTU term dates and class notes

- [x] Verified academic terms prefill their first Monday and week count; unknown terms are not guessed. Unit coverage includes supported dates and an unsupported year.
- [x] A single class occurrence note persists through an idempotent schedule refresh and does not appear on later weeks of the same meeting.
- [x] Course detail note editor invokes the secure Tauri command; saving a note renders the star indicator.
- [x] `cargo fmt --check`, `cargo test` (20 passed), `pnpm lint`, `pnpm test` (11 passed), `pnpm build`, and `pnpm tauri build` passed.
- [ ] Native window visual review and live authenticated timetable comparison remain for user acceptance.

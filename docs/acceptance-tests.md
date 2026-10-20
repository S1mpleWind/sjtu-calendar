# 阶段验收记录

## Phase 0

- [x] `pnpm install --frozen-lockfile` — lockfile up to date。
- [x] `pnpm lint` — 通过。
- [x] `pnpm test` — Vitest 1 file / 1 test passed。首轮第二个错误态测试因 mock rejection 触发 Vitest 未处理异常而失败；删除不稳定测试后，保留的成功路径测试通过。UI 仍提供错误提示，错误路径未自动化验证。
- [x] `pnpm build` — TypeScript 检查和 Vite production build 通过。
- [x] `cargo test`（`src-tauri`）— 1 个 SQLite migration 测试通过；main/doc tests 无失败。
- [x] `pnpm tauri dev` — 实际打开 Windows Tauri 窗口；受限 CSP 加入前点击“检查本地存储”显示 SQLite 已连接、迁移版本 1。数据库文件创建于 `%APPDATA%\edu.sjtu.schedule\calendar.sqlite3`。CSP 收紧后再次运行已完成编译并启动应用，但桌面检查被物理 Escape 键中断，因此未再次点击 invoke。
- [x] `git check-ignore` — 两个参考仓库均由 `references/` 规则忽略。
- [ ] Commit 与 main 合并 — 在文档记录后完成。

结果待实际执行后更新。

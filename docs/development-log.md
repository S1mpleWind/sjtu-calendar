# 开发日志

## Phase 0 — `chore/bootstrap`

- 日期：2026-10-20（Asia/Singapore）
- 工具链：Windows 10 Pro build 26200；Git 2.42.0.windows.2；Node v22.20.0；npm 10.9.3；pnpm 10.12.1；Rust 1.98.1；Cargo 1.98.1；VS 2022 Build Tools 17.14.37628.2；Windows SDK 10.0.26100.0；WebView2 Runtime 155.0.4283.62。
- 参考仓库：Course-Block `b0ead20ae854a7cb5432b23f23138be908d5565c`；Canvas-Helper `780001ecb7e0e74d9af44847dbbee1f80f890c94`。
- 实现：Tauri 2.12.4 + React 19.3.1/TypeScript 6.0.3/Vite 8.3.4 根工程；Rust `rusqlite` 0.38.0 数据库初始化与 version 1 migration；`get_backend_status` command；Vitest 5.0.5/Testing Library 与 ESLint 10.13.0 基础配置；限制本地资源/IPC 的 CSP；源码审计和项目文档初版。
- 验证：`pnpm install --frozen-lockfile` 成功；`pnpm lint` 成功；`pnpm test` 1 个测试成功；`pnpm build` 成功；`src-tauri` 下 `cargo fmt --check` 与 `cargo test` 成功（1 个 SQLite migration 测试）；`pnpm tauri dev` 在 CSP 收紧前打开实际 Windows 窗口并由 UI command 读出 SQLite schema version 1。CSP 收紧后再次编译并运行成功，桌面检查被物理 Escape 键中断，没有再次点击 invoke。首次 Cargo 构建时间约 5m22s。Rust linker 输出一条生成 import library 的 warning，不影响测试。
- 外部账户：未登录、未访问真实账户；`SOURCE_INSPECTED`。
- 安全：SQLite migration 不含 Token/Cookie；参考仓库未提交。
- Git：首个工程提交 `b7e00c4a44b737fa9e3ee03a0e0b35de5aeafa25`；工作目录原先 `main` 无任何提交/ref，因此先以该提交建立本地 `main`，再由最终日志提交 fast-forward 更新；不推送远端。
- 未验证项：认证和外部 API live 行为、CSP 收紧后的 invoke 点击、窗口缩放手工检查、安装包（Phase 5）。

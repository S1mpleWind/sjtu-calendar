# SJTU Schedule

SJTU Schedule 是一款本地优先的 Windows 日程应用，计划整合 SJTU 教务课表、Canvas 作业 DDL 和个人日程。当前 Phase 0 已完成桌面工程骨架；本地日程与真实账户同步功能会在后续阶段实现。当前界面明确显示数据源尚未连接，不会将演示信息标为真实同步结果。

## Windows 开发环境

- Windows 10/11 x64
- Node.js 22 LTS 或当前受支持版本，pnpm 10
- Rust stable，目标 `x86_64-pc-windows-msvc`
- Visual Studio 2022 Build Tools，安装“使用 C++ 的桌面开发”和 Windows 10/11 SDK
- Microsoft Edge WebView2 Runtime

本项目已在 `Get-ComputerInfo` 报告为 Windows 10 Pro、build `26200` 的机器上初始化；Node `v22.20.0`、pnpm `10.12.1`、Rust `1.98.1`、Visual Studio Build Tools `17.14.37628.2`、Windows SDK `10.0.26100.0` 和 WebView2 Runtime `155.0.4283.62`。若终端找不到 `cl.exe`，从 Visual Studio 的 x64 Native Tools 命令提示符运行项目命令。

## 初始化和启动

```powershell
corepack enable
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` 会先启动 Vite，再打开真实 Tauri 桌面窗口。桌面端启动时在用户应用数据目录创建 `calendar.sqlite3`，并以 Rust `rusqlite` 执行带版本号的迁移。网页预览不能替代桌面端的数据库验证。

## 检查

```powershell
pnpm lint
pnpm test
pnpm build
Push-Location src-tauri
cargo test
Pop-Location
```

数据库默认位置由 Tauri `app_data_dir` 决定；不会放在仓库中。`src-tauri/migrations/` 保存迁移 SQL。

## 数据源和安全

Canvas 和教务连接尚未实现。后续连接将要求用户在应用中自行完成认证。不要把密码、SSO Cookie 或 Canvas Token 发到聊天、提交到 Git 或写入普通配置/SQLite。Token 应由 Rust 后端使用 Windows 安全凭据存储；认证未经过真实账户端到端验证前，不会报告同步成功。

参考仓库在 `references/` 中仅用于源码审计，并由 `.gitignore` 排除，不纳入本项目提交。SJTU-Course-Block 当前检出的仓库没有发现许可证文件，因此本项目只记录观察结果，不复制其代码。

## 当前限制

- Phase 0 只有本地数据库初始化与健康检查命令；CRUD、日历视图、Canvas 和教务同步尚未实现。
- 首次运行 `pnpm tauri dev` 需要联网下载锁定的依赖；运行后的桌面壳和数据库不依赖外部账户。
- Windows 安装包会在 Phase 5 配置和验证。

详细进度见 [`docs/development-log.md`](docs/development-log.md) 和 [`docs/known-limitations.md`](docs/known-limitations.md)。

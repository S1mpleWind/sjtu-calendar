# 将此任务交给本地 Coding Agent

## 推荐操作

1. 在 Windows 新建一个干净目录 `sjtu-schedule`，把本文件包中的 `AGENT_MASTER_PROMPT.md` 与 `AGENTS.md` 放入根目录。不要放入现有重要 Git 仓库。
2. 以该目录为工作区打开 Cursor / Claude Code / Codex 等本地 Coding Agent。
3. 对 Agent 发送：

> 请完整读取 `AGENT_MASTER_PROMPT.md` 与 `AGENTS.md`，把它们作为工程执行规范。现在从 Phase 0 开始，使用我的本地终端实际克隆两个参考仓库、审计核心代码、初始化并实现项目。严格按阶段验收和 Git 分支执行。不要停在写设计文档；尽可能直接执行到 Phase 5。真实校园登录需要我操作时，明确提示我做什么，其他独立工作继续推进。先不要开发 Widget。

4. Agent 执行前请确保本机装有 Git、Node.js LTS、Rust MSVC 工具链、Visual Studio C++ Build Tools + Windows SDK、WebView2 Runtime。Agent 应自行检查版本，不应假定全部已安装。
5. 如果只想先拉下两个参考项目，在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\bootstrap_references.ps1
```

`bootstrap_references.ps1` 只下载参考仓库并加入 `.gitignore`，不运行第三方代码，也不创建业务应用。

## Git 与 Widget

首版主窗口完成后，先验收 `main`；再交给 Agent：

> 现在根据 `AGENT_MASTER_PROMPT.md` Phase 6，从当前稳定的 `main` 新建 `feat/desktop-widget`，实现复用同一份日程数据库的独立桌面 Widget。不要改变主窗口已经通过的交互和同步行为；Widget 不是 Windows 原生 Widgets Board。

## 隐私提醒

Canvas Token、SSO 密码或 Cookie 只在你自己设备的认证 UI 输入，不要粘贴到 Agent 聊天和 Git 提交里。

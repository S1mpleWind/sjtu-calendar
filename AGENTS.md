# AGENTS.md — SJTU Schedule 项目代理约束

执行前先完整阅读 `AGENT_MASTER_PROMPT.md`。该文件是本项目的权威任务清单。

工作原则：
- 开发实际可运行的 Tauri 2 + React + TypeScript + Rust + SQLite Windows 应用，不只写方案。
- `references/` 中的 SJTU-Course-Block 和 SJTU-Canvas-Helper 是只读外部参考，必须保持被 Git ignore。
- 每次实现前查阅当前真实代码和官方文档；不能编造教务端点、Canvas 接口或登录成功状态。
- 登录由用户本人进行；Token/Cookie 不写入日志、SQLite 明文或 Git。
- 业务逻辑首先可测试：课程教学周、重复事件单次例外、Canvas 分页、幂等同步、离线缓存。
- 核心窗口稳定后再从 main 创建 `feat/desktop-widget`。
- 每阶段执行 lint/test/build，并在 `docs/development-log.md` 记录结论、Git SHA 和未验证事项。
- 不自动推送/强推/删除用户远端；未经用户明确授权不做破坏性 Git 操作。

优先查看：`docs/reference-analysis.md`、`docs/architecture.md`、`docs/data-model.md`、`docs/known-limitations.md`。

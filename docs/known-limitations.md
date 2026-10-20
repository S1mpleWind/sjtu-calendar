# 已知限制

- Phase 0 仅有 Tauri 桌面壳、健康检查、SQLite 初始化和一条基础迁移；尚无个人日程 CRUD、日历周/月视图、Canvas 或教务同步。
- 当前没有真实账户 Token/Cookie，因此所有外部请求均为未验证；界面明确显示待配置，没有 mock 成功数据。
- SJTU-Course-Block 检出版本未找到许可证文件，不能直接复制其代码。
- 错误态的前端自动化测试当前未覆盖；已在 UI 中显示桌面服务异常提示。
- 受限 CSP 配置后，桌面窗口重新启动成功，但用户中断了桌面检查，因此尚未再次人工点击验证 IPC。初始 CSP 下的 invoke 已通过真实窗口验证。
- 尚未手工验证窗口缩放行为；窗口已配置 1200×800 初始大小及 900×600 最小尺寸。
- 安装包计划留到 Phase 5。

- Phase 1 provides persistent data and Tauri commands, but the calendar UI/editor has not yet been connected; that is Phase 2 work.
- Recurrence rules are validated and expanded by the Rust `rrule` crate. Unsupported or malformed RFC 5545 content is rejected; user-facing recurrence controls and preview are not available yet.
- Ambiguous local times choose the earlier offset. Nonexistent initial event times are rejected, and generated recurrence starts in a DST gap are skipped.

- Phase 2's calendar UI is connected to real local Rust/SQLite commands, but native-window resize/high-DPI appearance and CRUD in the live WebView have not been manually reviewed. Automated React interaction tests cover creation invocation, view switching, timezone changes and overlapping-event layout.

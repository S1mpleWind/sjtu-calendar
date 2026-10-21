# 已知限制

## Current after Phase 4

- SJTU endpoints and response fields are `CONFIRMED_BY_SOURCE` only. No real SJTU account or live response has been verified. Follow the steps in `docs/integration-sjtu.md` before describing the connection as live-validated.
- Saved SJTU cookies are read from an isolated login WebView and stored in Windows Credential Manager. The connection badge means only “session saved”; undergraduate session acceptance is checked by attempting the schedule request.
- SJTU course payloads do not include academic term start dates. First-week dates are auto-filled only for terms verified from official notices and remain editable; other terms still need a date entered by the user.
- ICS import is a fallback for standard one-off and weekly course VEVENTs. BYDAY/multiple weekday recurrence, EXDATE/RDATE, VTIMEZONE-only definitions and complex recurrence rules are rejected or unsupported; no previewed import is applied until the user chooses Apply.
- Manual native-window login, Credential Manager cleanup, real SJTU schedule comparison, WebView resize/high-DPI review and Windows installer testing remain outstanding.
- Phase 5 generated the NSIS x64 installer. Manual install/uninstall, packaged WebView, and persistence review are outstanding; backup/export and the operations guide are implemented.
- Desktop Widget implementation is under review on `feat/desktop-widget`; native move/resize, persisted window bounds, tray interactions, packaged startup and multi-monitor behavior still need manual Windows acceptance before merge or release.
- Installer launch/uninstall and restore interaction in a packaged WebView have not yet been manually exercised; automated backup/restore tests use temporary SQLite databases.

- Historical Phase 0 started with a Tauri desktop shell and a single migration; later phase notes below document the completed additions.
- No external SJTU credentials were used for automated tests; all fixtures are test-only, not runtime schedule data.
- SJTU-Course-Block 检出版本未找到许可证文件，不能直接复制其代码。
- 错误态的前端自动化测试当前未覆盖；已在 UI 中显示桌面服务异常提示。
- 受限 CSP 配置后，桌面窗口重新启动成功，但用户中断了桌面检查，因此尚未再次人工点击验证 IPC。初始 CSP 下的 invoke 已通过真实窗口验证。
- 尚未手工验证窗口缩放行为；窗口已配置 1200×800 初始大小及 900×600 最小尺寸。
- 安装包计划留到 Phase 5。

- Phase 1 provides persistent data and Tauri commands, but the calendar UI/editor has not yet been connected; that is Phase 2 work.
- Recurrence rules are validated and expanded by the Rust `rrule` crate. Unsupported or malformed RFC 5545 content is rejected; user-facing recurrence controls and preview are not available yet.
- Ambiguous local times choose the earlier offset. Nonexistent initial event times are rejected, and generated recurrence starts in a DST gap are skipped.

- Phase 2's calendar UI is connected to real local Rust/SQLite commands, but native-window resize/high-DPI appearance and CRUD in the live WebView have not been manually reviewed. Automated React interaction tests cover creation invocation, view switching, timezone changes and overlapping-event layout.

- Phase 3 Canvas API behavior is covered with a local HTTP fixture; no real account/token has been used. A user must configure a personal token locally and verify the instance with Test Connection before syncing live records.
- Canvas support is limited to the two origins verified in the inspected helper source: `https://oc.sjtu.edu.cn` and `https://jicanvas.com`. Only assignment `due_at` values are currently shown; section-specific `all_dates`/override details are requested but not independently projected.
- Canvas user-facing configuration and cached weekly/monthly deadline rendering have automated build coverage, but the native WebView and Windows Credential Manager interaction still need a manual acceptance pass on this machine.

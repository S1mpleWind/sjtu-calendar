# 参考源码审计

审计日期：2026-10-20。两个浅克隆都只读；本项目没有从其复制代码。

## 仓库与许可

| 仓库 | Commit | Remote | 许可证检查 |
|---|---|---|---|
| SJTU-Course-Block | `b0ead20ae854a7cb5432b23f23138be908d5565c` | `https://github.com/Labyrinth0419/SJTU-Course-Block.git` | 仓库根目录和文件名搜索未找到 LICENSE/COPYING；不得假定可移植。 |
| SJTU-Canvas-Helper | `780001ecb7e0e74d9af44847dbbee1f80f890c94` | `https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper.git` | 根目录 `LICENSE` 声明 MIT，版权为 Zihong Lin (2025)。当前未复用其代码。 |

## SJTU-Course-Block

### 已验证事实

- 登录入口位于 `course_block/lib/ui/login/login_selection_screen.dart`：本科 WebView 初始地址是 `https://i.sjtu.edu.cn/jaccountlogin`；研究生入口指向 `yjs.sjtu.edu.cn` 的课表页。`webview_login_screen.dart` 将 `jaccount:` scheme 交由系统外部应用处理，并在登录前清空 WebView Cookie。
- `course_block/lib/ui/login/webview_login_screen.dart` 在本科页面导航到 `index_initMenu.html`、`main.html` 或 `xskbcx_cxXskbcxIndex.html` 且 Cookie 非空时保存会话；这只是页面/Cookie 检查，并未在此分支验证课表请求。研究生分支会用 Cookie 请求当前学期与课程查询，再检查 JSON `code == 0` 和 `datas.xsjxrwcx.rows`。`LoginSessionStorage` (`core/services/login_session.dart`) 将 Cookie 存入 SharedPreferences 明文。该认证方案不可照搬到本应用。
- `core/services/course_service.dart` 的 `fetchUndergraduateCourses` 使用 POST `https://i.sjtu.edu.cn/kbcx/xskbcx_cxXsKb.html`，表单参数 `xnm` 和 `xqm`；term `1/2/3` 映射为 `3/12/16`。来源另带 `Cookie`、User-Agent 和 Referer。成功响应读取 `kbList`。已见课程字段包括 `kch`/`kch_id`、`kcmc`、`xm`、`cdmc`、`xqj`、`jcs`、`zcd`、`xkbz`。
- 同一文件的 `fetchGraduateCourses` POST `https://yjs.sjtu.edu.cn/gsapp/sys/wdkbapp/modules/xskcb/xsjxrwcx.do`，发送 `XNXQDM`、`XH`、`pageNumber=1`、`pageSize=200`，关闭重定向并使用 Cookie/Origin/Referer。解析响应要求 `code == 0`、`datas.xsjxrwcx.rows`。
- `core/services/graduate_course_parser.dart` 的 `GraduateCourseParser.parseRows` 从 `KCMC/KCMCYW`、`RKJS/JSXM`、`BJDM/BJMC/KCDM`、`PKDD/PKDD_DISPLAY/XQDM_DISPLAY` 和 `PKSJDD/PKSJ` 提取课程、教师、班级、地点与排课段；通过 `WeekUtils` 处理周次表达式。解析器会记录未识别的排课行。
- `core/utils/time_slots.dart` 给出 14 节时间：第一节 08:00–08:45，之后含中午和晚间节次，最后一节结束于 21:40。不可将节次号误当固定小时数。
- `core/services/course_transfer_manager.dart` 包含 ICS 导入/导出，导入主体位于 `importCoursesIcs`，解析 `VEVENT`；已有测试 `course_block/test/course_occurrence_ics_test.dart`、`calendar_idempotency_test.dart`、`course_sync_preservation_test.dart` 可用于了解边界。该实现不能证明 ICS 导入覆盖教务自动同步。

### 未确认假设与局限

- 本科登录成功判定较弱：页面 URL 命中且 Cookie 非空；账号身份、Cookie 有效期、校园网/VPN 约束未由该代码证明。
- 本科请求字段从当前实现可见，但响应样例、学期起止日来源、调课/课程变更表示仍需真实脱敏响应验证。
- 研究生请求固定首 200 条；自动分页能力在被审代码中未确认。解析失败的周次或节次不能静默丢弃。
- WebView Cookie 的持久化方式是普通应用偏好，不适用于本项目的凭据安全要求。

### 迁移建议

- 仅将真实端点、字段名与节次映射视为 `SOURCE_INSPECTED` 事实；通过脱敏 fixture 锁定解析行为，再实现 Rust provider 与 parser 分层。
- 认证必须重新设计为用户交互与 Windows Credential Manager/keyring；不能从其他浏览器提取机密或用 URL 命中伪造成功状态。
- `Course` 需拆分为课程身份和多个 `course_meetings`，用明确周号集合表达单双周/指定周；不能以课程名称去重。
- ICS 是可验证的导入后备路径，应标记为导入来源而非“已从教务同步”。

## SJTU-Canvas-Helper

### 已验证事实

- Canvas 请求客户端位于 `src-tauri/src/client/common.rs` 与 `client/basic.rs`，由 Rust `reqwest` 后端发送请求并添加 `Authorization: Bearer {token}`。基础 Host 常量在 `client/constants.rs`：本部 `https://oc.sjtu.edu.cn`，交大密西根 `https://jicanvas.com`。`app/basic.rs::get_base_url` 根据 `AccountType` 选择 Host。
- `Client::list_courses` 请求 `/api/v1/courses?include[]=teachers&include[]=term`，再过滤受限课程。`list_course_assignments` 请求 `/api/v1/courses/{course_id}/assignments?include[]=submission&include[]=overrides&include[]=all_dates&include[]=score_statistics`。
- `Client::list_items_with_page` 使用 `page` 与 `per_page=100`；`list_items` 逐页增加 page，直到收到空数组。该代码没有使用响应 `Link: rel=next`。
- `model/mod.rs::Assignment` 区分 `due_at`、`lock_at`、`html_url`、`workflow_state`、`submission`、`overrides` 与 `all_dates`；`Submission` 包含 `submitted_at`、`grade`、`late` 和 workflow state。适配逐日 DDL 时应保留 due 和 lock 两个时间语义。
- `App::save_config` (`src-tauri/src/app/basic.rs`) 将完整 `AppConfig` 序列化写入配置文件；`model/mod.rs::AppConfig` 含 `token: String`。这不是操作系统安全凭据存储，禁止直接复用。
- 后端 Tauri commands 在 `src-tauri/src/main.rs`，前端通过 `@tauri-apps/api/core` 的 `invoke` 调用；前端封装包括 `src/lib/config.ts`。项目还包含视频、文件、下载、提交及 LLM 等能力，超出本项目所需范围。
- 仓库根 `LICENSE` 为 MIT。Canvas API 路径与数据结构是参考项目源码中的请求，不等于对所有 Canvas 站点/账户做了 live 验证。

### 未确认假设与局限

- 当前审计没有用户 Token，也没有发起真实账户认证；Host、API 与分页行为仅为 `SOURCE_INSPECTED`。
- 自定义账号/站点覆盖面及当前学校租户对各资源权限的差异需要账户级验证。
- 页码查询和直到空页的终止策略与 Link header 分页并不相同；本项目应使用经验证的分页方式并设页数上限，避免无限请求。

### 迁移建议

- 仅实现 Rust 后端最小读取集合：连接检查、课程列表、作业列表及必要的个人提交状态；把 Host allowlist、重定向校验、超时、分页上限、部分失败和幂等 upsert 放入可测试 adapter。
- Token 只进入 Windows 凭据库；日志、SQLite、前端 localStorage 和错误文本不能包含凭据。
- 保留远端提交状态与本地手工完成标记两列；`due_at = null` 作业进入无日期列表。

## 外部文档

- [Tauri 2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/) 要求 C++ Build Tools 的 Desktop development with C++、WebView2 和 MSVC Rust target。当前机器已核实这些组件可用。
- [Tauri 2 project creation](https://v2.tauri.app/start/create-project/) 支持 React/TypeScript 与 pnpm；[Tauri SQL migrations](https://v2.tauri.app/plugin/sql/) 文档确认可由 Rust 注册迁移。本项目选择 Rust `rusqlite`，让数据库访问不暴露给前端组件，并由 Rust 初始化器运行迁移。
- [Tauri 2 CSP guidance](https://v2.tauri.app/security/csp/) 指出 CSP 仅在配置时启用，并建议尽量限制允许的来源。因此当前桌面壳设置了只允许本地资源和 Tauri IPC 的 CSP。

# SJTU Schedule：Windows 桌面日程软件——Coding Agent 执行任务书

> **角色**：你是负责交付可运行软件的资深全栈工程 Agent，不是只负责设计的顾问。
>
> **工作环境**：用户的本地 Windows 11 开发机，终端优先 PowerShell 7（Windows PowerShell 5.1 也应尽量兼容）。工作目录由用户在终端打开的目录确定。
>
> **任务**：创建一款本地优先的 Windows 桌面日程应用，整合 SJTU 教务系统课表、Canvas 作业 DDL 和用户自定义事件。先交付稳定的普通桌面窗口版本，后续在独立 Git 分支增加桌面 Widget。
>
> **工作方式**：先实际检查环境和参考项目，随后逐阶段编写、运行、测试和修复代码。除必须由用户本人执行的认证、输入 Token 或安全授权外，不要反复征求确认。不能把 mock 数据、空函数或“界面看起来正常”当作完成。

---

## A. 不可违背的执行规则

1. **真正执行**：你可以直接操作当前工作目录、安装项目依赖、创建文件、运行本地构建和测试。发现错误要修复并重试。每阶段结束给出已实现功能、验证命令和结果、文件变更与 Commit SHA。不能只输出一份下一步计划。
2. **先读源码再编码**：必须先克隆并研究下面两个开源仓库，形成 `docs/reference-analysis.md`，记录真正找到的文件路径、类/函数名、请求路径、数据结构、适用范围与局限。不要根据 README 自行编造具体函数/端点。
3. **两个参考仓库只读**：放在主工程 `references/`，默认不修改、不构建、不提交进入主仓库；仅作源码研究。如果确实复用代码，确认 LICENSE 和版权要求，在 `THIRD_PARTY_NOTICES.md` 标注来源、文件、许可证，勿直接复制大段无关代码。
4. **Git 分阶段**：仓库使用 `main` 存稳定版本，每个阶段创建 feature 分支，验证通过再合并到 `main`，分支开发期间保持工作树可解释且提交清晰。**不要自动 push / force-push / 删除用户既有仓库或分支**。若当前目录已有用户文件，先检测并避免覆盖。
5. **安全优先**：严禁收集/打印/写日志保存教务密码、SSO Cookie、Canvas Token 等凭据；不得将其存为 SQLite 明文、配置文件、localStorage、Git 历史或截图。使用操作系统凭据存储（Windows Credential Manager / 合适的 Keyring 集成）保存 Token；教务登录走可供用户交互的受支持认证流程，不绕过验证码、多因素认证或安全控制。
6. **外部系统依赖真实**：必须允许离线、网络失败、认证过期。用户尚未输入真实凭据时，开发可使用 fixture 或 mock adapter 测试，但 UI 必须明显标注为演示模式；绝不能报告“已完成真实教务同步”或“已从 Canvas 拉取”直到端到端验证。
7. **时间、学期、重复规则是核心逻辑**：不要只做视觉日历。课程单双周、跨月、排课变更、重复事件单次取消、DDL 时区、同步去重，都须落入明确的类型、持久化和测试。
8. **Windows 桌面优先**：V1 是普通可调整大小窗口。`feat/desktop-widget` 是后续单独任务，不应在 V1 混入拖动到桌面、置底、透明点击穿透等复杂原生窗口功能。Widget 是自定义悬浮/桌面窗口，**不等于 Windows 11 原生 Widgets Board 集成**。
9. **不要假设新版本 API**：先读取当前安装的 Node/Rust/Tauri 及依赖文档，根据实际可用版本选择 API；锁定 package lockfile 与 Rust 依赖版本。若实现与规范冲突，在 `docs/decisions.md` 说明修改原因。
10. **完成定义**：界面有真实存储和交互、错误状态可见、测试通过、可在 Windows 运行、README 含部署命令。未验证之处清楚写入 `docs/known-limitations.md`。

## B. 产品目标与非目标

### B1. 产品目标

产品名称（暂定）：`SJTU Schedule`。

应用必须支持：
- 周课表：周一至周日列，时间轴，课程卡片正确显示起止时间、名称、教室、授课教师；根据学期起始日期/教学周规则切换周次；周末显示可开关。
- 每天**独立 DDL 区域**：在每个日历日/周视图日期列的下方展示 Canvas 作业截止信息（不要把全部 23:59 作业塞在 23:00 的时间轴底部）；可看到标题、对应课程、截止时间、完成状态，点击打开详情/Canvas 原文。
- 自定义事件：添加、修改、删除；包括标题、描述、地点、开始/结束时间、全天事件、类别/颜色、重复规则、结束条件、例外日期；可以创建本地 DDL。
- Canvas：配置一个或多个受支持的 Canvas 实例（本部/密院实际地址须由配置与参考代码确认），通过用户 Token 验证，手动点击“刷新 Canvas”获得最新作业及提交状态；支持独立错误和最后成功同步时间。
- SJTU 教务：调用交互式身份认证，获取学期课程信息；兼容单/双周、指定周、地点/节次；点击“刷新课表”更新。若接口不可用，提供明示的 ICS/JSON 导入兜底能力，且不得声称自动同步成功。
- 断网与持久化：重启、断网后仍可显示最后同步课程/作业和用户事件；刷新不能丢失用户本地操作。
- 设置：主题、默认视图、显示时间范围、周末开关、学期选择、Canvas 连接、教务连接、数据源显隐及同步状态。

### B2. 不做的事情

首版不要求云同步、多设备账号、Canvas 作业提交/批改、成绩分析、学校服务端部署、Windows 原生 Widgets Board、移动客户端、多人协作。自动后台刷新和 Windows 系统通知可以作为 V1.1 增强，但不要阻塞 V1.0 交付。

## C. Phase 0：初始化、本地环境检查、参考项目审计（必须最先完成）

### C1. 初始化

1. 运行 `git --version`、`node --version`、`corepack --version`（或检查 pnpm）、`rustc --version`、`cargo --version`；检测 Visual Studio C++ Build Tools / Windows SDK / WebView2 运行时的可用性。缺少前置条件时，精确给出安装链接与检查命令，能够继续的任务先继续。
2. 如果不是 Git 仓库，在当前工作目录创建主仓库并命名主分支 `main`；如果已经是 Git 仓库，保护现有配置与历史。生成 `.gitignore`：`references/`、`node_modules/`、`src-tauri/target/`、`dist/`、`.env*`（保留安全的 `.env.example`）、日志、备份、私有凭据、测试截图临时文件等。`references/` 必须先加入 ignore，再 clone。
3. 如两个参考项目不存在，执行：

```powershell
New-Item -ItemType Directory -Force references | Out-Null
git clone --depth 1 https://github.com/Labyrinth0419/SJTU-Course-Block.git references/SJTU-Course-Block
git clone --depth 1 https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper.git references/SJTU-Canvas-Helper
```

如已存在则检查其 Git Remote，不做 `git reset --hard`。记录两仓库的 Commit SHA、License 情况到 `docs/reference-analysis.md`。若网络不可用，输出确切错误，继续本地 UI/数据库阶段，不要伪称仓库已拉下。

### C2. 源码审计任务——CourseBlock

针对 `references/SJTU-Course-Block/course_block/lib/`，用代码搜索实际定位：
- 本科/研究生登录入口、登录 WebView/浏览器策略、Cookie 生命周期、SSO 跳转流程；认证成功如何判断；是否存在校园网/VPN 限制。
- EAS 课程数据网络请求：真实 Host、Path、HTTP 方法、必要 Header、学期参数、响应的 JSON/HTML 解析器；不得硬编码“猜测地址”。
- 课程数据结构：学期起点、星期、节次、每天节次数与实际时间对照、教务周号、单双周、指定周、课程合班、授课教师、教室、调课场景。
- 可复用解析测试 fixture，脱敏后放入 `tests/fixtures/sjtu/`。若协议或示例响应是敏感数据，不复制原始 Cookie 与姓名/学号。
- ICS/JSON/CSV 导入导出模块如何组织；优先从中复用稳定、可合法移植的解析思路。

输出 `docs/reference-analysis.md` 中的“已验证事实 / 未确认假设 / 迁移建议 / 潜在失效点”。

### C3. 源码审计任务——Canvas Helper

针对 `references/SJTU-Canvas-Helper/src` 和 `src-tauri`，实际定位：
- Canvas Host 配置、Token 校验、保存方式、请求代理位置、HTTP API 客户端。
- 课程列表与作业列表的实际 API、分页、作业详情/提交状态、Canvas 不同站点兼容方式。
- DDL 日历使用的数据源（Assignment、Calendar Events 或 Planner）、字段映射、日期覆盖；参考本项目需求选择最小调用集合，不要直接移植下载/批改/LLM 等功能。
- Tauri 前后端调用层、错误处理、状态管理方式，确定是否存在容易复用的模式。
- LICENSE、协议及源文件来源。

审计完成后先输出简短检查报告，**然后继续开发**，不要把审计当作终点。

## D. 目标技术架构

基线选型：**Tauri 2 + Rust + React + TypeScript + Vite + Tailwind CSS + shadcn/ui + SQLite**。前端状态选择 TanStack Query（服务端/数据库查询缓存）+ Zustand（仅短期 UI 状态）；时间处理前端使用 `date-fns` 或等价维护中的库，重复规则使用 `rrule` 或等价可靠库；Rust 负责数据库、HTTP、同步及安全凭据。

要求：
- 前端不能直接携带 Token 调 Canvas API；由 Tauri Rust 后端统一构建请求，避免 CORS/泄露。
- Rust 对外暴露少量**类型明确的 Tauri Command**；所有 Commands 输入参数做校验。
- SQLite 通过 Rust `sqlx` 或 `rusqlite`（择一并记录原因），开启 WAL、外键约束、迁移管理；不要前后端各写一套数据持久化。
- 网络层使用带 timeout 的 HTTP Client，支持取消、非 2xx 错误、分页限制、对站点/重定向进行校验；不启用无条件忽略 TLS 证书。
- 所有查询以一个 `CalendarOccurrence` 视图模型输出给 UI，**数据库层保持课程、作业、自定义事件各自的实体结构**。课程不是每周复制的一堆孤立本地事件。
- 内部统一使用 UTC 时间戳存绝对时刻；课程与个人重复事件存 IANA 时区及当地 wall-clock（墙上时间）规则。SJTU 课程默认 `Asia/Shanghai`，不得直接拿开发机器的 `Asia/Tokyo` 当课程时区。用户界面默认展示所选时区，并允许配置。

### D1. 建议目录树（可据实际工具链小幅调整）

```text
sjtu-schedule/
├── AGENTS.md                       # Agent 执行原则、阶段及验收入口
├── README.md                       # 用户安装/运行/数据同步说明
├── THIRD_PARTY_NOTICES.md
├── package.json
├── pnpm-lock.yaml
├── src/
│   ├── app/                        # App 启动、路由、根布局
│   ├── pages/                      # Calendar / Deadlines / Settings
│   ├── components/
│   │   ├── calendar/               # WeekGrid、DayColumn、CourseCard、DdlStrip
│   │   ├── event-editor/           # 编辑抽屉、重复规则配置
│   │   └── common/
│   ├── features/
│   │   ├── events/                 # 本地日程 CRUD
│   │   ├── recurrence/             # RRULE 编辑与出现实例预览
│   │   ├── canvas/                 # Canvas UI、连接状态
│   │   ├── sjtu/                   # 教务 UI、登录/导入状态
│   │   └── sync/                   # 刷新状态与错误展示
│   ├── lib/                        # invoke 封装、日期格式、类型
│   ├── store/                      # Zustand UI 状态
│   └── test/
├── src-tauri/
│   ├── capabilities/               # 最小权限配置
│   ├── migrations/                 # SQL schema 迁移
│   ├── src/
│   │   ├── commands/               # Tauri Commands
│   │   ├── db/                     # 连接池、repo、事务
│   │   ├── domain/                 # 领域实体、错误类型
│   │   ├── calendar/               # 日期范围与课程实例投影
│   │   ├── sync/                   # 同步协调器、事务提交
│   │   ├── providers/
│   │   │   ├── canvas/             # API client、mapper、auth
│   │   │   └── sjtu/               # auth、client、parser、mapper
│   │   ├── secrets/                # OS Credential Manager
│   │   └── lib.rs
│   └── tests/
├── tests/fixtures/                 # 脱敏 JSON、HTML、课程样例
├── docs/
│   ├── reference-analysis.md
│   ├── architecture.md
│   ├── data-model.md
│   ├── integration-canvas.md
│   ├── integration-sjtu.md
│   ├── acceptance-tests.md
│   ├── decisions.md
│   ├── known-limitations.md
│   └── development-log.md
├── scripts/                         # PowerShell 开发和检查脚本
└── references/                      # gitignored，只读参考源码
    ├── SJTU-Course-Block/
    └── SJTU-Canvas-Helper/
```

## E. 数据库与领域模型——必须实现持久化，不允许只存在内存

### E1. 实体及约束

实现迁移脚本（可拆多张表，不要求下述伪模式逐字使用），包含：

1. `data_sources`：`id`、`kind (canvas/sjtu)`、`name`、`base_url`、`account_ref`、`enabled`、`last_success_at`、`last_error_code`、`last_error_message`、`created_at`。Token 和 Cookie **不得**存此表。
2. `academic_terms`：`id`、`source_id`、`external_id`、`name`、`start_date`、`end_date`、`week_count`、`timezone`、`is_active`。用户能检查/手工修正不可靠的学期日期。
3. `courses`：`id`、`source_id`、`term_id`、`external_id`、`name`、`teacher`、`default_location`、`color`、`remote_updated_at`、`archived_at`；唯一键 `(source_id, term_id, external_id)`，若远端无可靠 id，设计稳定的规范化课程标识并写明局限。
4. `course_meetings`：`id`、`course_id`、`weekday (1..7)`、`start_local_time`、`end_local_time`、`timezone`、`week_rule_json`（明确周号集合或单双周展开结果）、`location`、`teacher`、`note`。同一课程可有多个不同时间段/地点；不能用课程名去重。
5. `assignments`：`id`、`source_id`、`external_course_id`、`external_assignment_id`、`title`、`description_summary`、`due_at_utc NULL`、`lock_at_utc NULL`、`html_url`、`workflow_state`、`remote_submission_state`、`manual_completed NULL`、`remote_updated_at`、`last_seen_sync_id`、`archived_at`；唯一键 `(source_id, external_course_id, external_assignment_id)`。`manual_completed` 与 Canvas 提交状态分开，且刷新不得覆盖。
6. `personal_events`：`id`、`title`、`description`、`location`、`category (event/deadline)`、`start_local`、`end_local`、`timezone`、`all_day`、`rrule NULL`、`color`、`created_at`、`updated_at`、`deleted_at`。个人事件可以有截止事件类型（本地 DDL），但绝不混淆 Canvas ID。
7. `recurrence_exceptions`：`id`、`event_id`、`original_occurrence_local`、`kind (cancel/override)`、`override_json`、唯一键 `(event_id, original_occurrence_local)`。支持只编辑/删除单次或全系列；为“本次及以后”扩展预留结构，第一版没有实现时 UI 不可假装支持。
8. `sync_runs`：`id`、`source_id`、`started_at`、`finished_at`、`status (running/succeeded/partial/failed)`、`fetched_count`、`inserted_count`、`updated_count`、`archived_count`、`error_code`、`error_message`。
9. `app_settings`：`key`、`value_json`，必须给出 schema 校验和合理默认值。

迁移必须可重复应用、有版本号，数据库 schema 有相应测试。不要通过删 DB 来解决迁移失败。

### E2. 前后端共同日历视图（契约示例）

```ts
type CalendarSource = "sjtu" | "canvas" | "local";
type CalendarKind = "course" | "event" | "deadline";

interface CalendarOccurrence {
  occurrenceId: string; // 同一来源+实体+具体一次出现的稳定 key
  entityId: string;     // 后端内部 ID
  sourceId?: string;
  source: CalendarSource;
  kind: CalendarKind;
  title: string;
  date: string;         // YYYY-MM-DD，展示时区对应的日历日期
  startAt?: string;     // ISO 8601 with offset, timed item
  endAt?: string;
  allDay: boolean;
  courseName?: string;
  location?: string;
  description?: string;
  color?: string;
  url?: string;
  status?: "upcoming" | "overdue" | "completed" | "submitted" | "unknown";
  isRecurring: boolean;
  isReadOnly: boolean;  // 远端课程/Canvas 元数据默认只读
}
```

**说明**：Canvas Assignment 的 `due_at` 是截止时刻、`lock_at` 是锁定时刻，两者不能混用。`due_at = null` 的作业显示在“无截止日期”列表，不得随意放在今天。课程由 `course_meetings + academic_terms` 投影成该周实际出现的课程；自定义重复事件由 RRULE 在请求日期范围内展开，不要把无限重复规则写成无限数量数据库行。

### E3. 应用接口（先实现类型契约，然后逐一落地）

前端所有业务 API 调用统一封装在 `src/lib/backend.ts`，禁止组件各自直接 `invoke` 字符串命令。建议命令：

```ts
getCalendarOccurrences({startDate, endDate, timezone, filters})
getAcademicTerms()
getDataSources()
createPersonalEvent(payload)
updatePersonalEvent({id, payload, scope, occurrenceKey?})
deletePersonalEvent({id, scope, occurrenceKey?})
getUndatedAssignments()
setAssignmentManualCompleted({assignmentId, completed})
connectCanvas({baseUrl, token})
testCanvasConnection({sourceId})
disconnectCanvas({sourceId, preserveCache})
syncCanvas({sourceId})
startSjtuLogin({targetSystem})
finishSjtuLogin(/* 按已验证的安全认证机制 */)
syncSjtu({sourceId, termId?})
importSjtuSchedule({format, filePath, termInfo?})
getSyncStatus({sourceId?})
getAppSettings()
updateAppSettings(patch)
```

`scope` 使用明确的 `"single" | "series"`；若支持 `"following"`，必须有对应实现和测试。接口必须返回明确数据类型、错误类型，并与自动生成或手工维护的 TS 类型保持一致。优先在 Rust 定义 schema 并同步生成类型以降低漂移风险。

错误码至少包括：`NETWORK_ERROR`、`UNAUTHORIZED`、`SESSION_EXPIRED`、`RATE_LIMITED`、`PARSE_FAILED`、`INVALID_CONFIG`、`REMOTE_UNAVAILABLE`、`SYNC_PARTIAL`、`DB_ERROR`、`UNSUPPORTED_AUTH_FLOW`。错误消息要面向用户，日志中有可定位的非敏感上下文。

## F. 桌面 UI / UX 详细要求

### F1. 窗口和导航

- 普通 Win11 桌面窗口，初始大小约 `1200 × 800`，最小约 `900 × 600`；支持最大化、缩放、恢复。具体尺寸在实际 UI 测试中调整。
- 顶部：产品名、今天、上/下一周、日期范围、周视图/月视图切换、`+ 新建`、`全部刷新`、设置入口。
- 左侧可收起侧栏：迷你月份日期选择器、来源过滤（教务、Canvas、个人）、本学期切换、最近一次同步状态。
- 主区域默认周视图：周一至周日列；支持周末隐藏（五列模式）、纵向 8:00–22:00 时间轴（可配置）、今日高亮、同时间段重叠课程并列或压缩而非覆盖。
- **每个日期列底部独立 DDL 卡片区**：按照截止时间排序，至少显示 2 项，超出显示 `+N`；点击卡片打开右侧详情抽屉。DDL 区域允许独立滚动或可展开，不能因某一天 DDL 多而拉乱全部时间轴。
- 月视图：每天显示课程/事件摘要与 DDL 数量，点击进入当天详情，不要求把所有课程完整挤进一个月历单元格。
- 右侧详情：标题、时间、地点、来源标签、描述、远端链接；仅本地事件可编辑；Canvas 作业可标记“本地已完成”，并与远端“已提交”区分。
- 设置：数据源连接、课程学期、时区、起始周、周末显示、主题、同步记录、数据管理。

### F2. 自定义事件交互

新建/编辑 Drawer 或 Dialog 字段：
- 标题（必填，去空格非空）、事件/DDL 类型、开始结束日期时间、全天、时区、地点、描述、颜色。
- 重复选择：不重复、每天、每周、每两周、每月、自定义。自定义至少支持 `interval`、每周星期选择、`COUNT` 或 `UNTIL`；不能既无截止又在 UI 无限生成；无截止可存规则，但范围查询必须限定展开区间与最大实例数。
- 编辑一个重复实例时询问：“仅本次 / 整个系列”（如尚未支持“本次及之后”，暂不显示）；取消一次实例必须保留系列。
- 校验：结束时间不得早于开始时间；跨天允许，只要真正结束晚于开始；日期选择器与本地时区转换一致；删除需要可撤销或二次确认。
- 支持键盘 Enter 保存、Esc 退出、空白状态、新数据立即可见、编辑后位置正确更新。

### F3. 同步交互

- 手动“全部刷新”并行启动可独立完成的数据源，单个来源失败不应影响其他来源成功；每个来源刷新按钮在运行时禁用并显示 spinner、持续时间和成功/失败结果。
- 展示“最后成功同步：YYYY-MM-DD HH:mm”“课程数/作业数”“连接状态”；失败时保留旧数据并提示本次失败原因。
- 首次打开无账号时不要显示伪造真实课程；提供“体验示例数据”显式开关，默认关闭。
- 离线状态、权限不足、Token 过期、无作业、学期空数据要呈现不同信息。
- UI 支持中英文文本/长课程名、缩放比例 100%/125%/150%，深浅色主题；避免 Windows 默认字体中文回退导致截断。

## G. 业务规则：教学周和重复事件

- **教学周**：以每学期独立配置的第一教学周星期一为起点，计算 `teachingWeek = floor(daysBetween(mondayOfTermWeek1, mondayOfDate)/7)+1`；**不要使用 ISO 自然周的单双号**代替教务周号。跨学期周次从 1 重新开始。
- 课程排课必须基于教务数据得到的实际周号集合；解析到 `1-16周单周` 应是 `{1,3,5,...,15}`，双周同理，允许非连续 `{1,2,4,10}`。
- 节次→具体时间必须来源于配置或真实教务时间表，不得把“第 1 节”凭空解释成 08:00。如果参考代码存在固定节次时间表，验证并保存相应设置。
- 不假定节假日自动停课；除非远端提供调课/停课事实，否则按原规则展示，并允许手工例外/本地注释。
- 自定义重复事件要按 `timezone + local wall-clock` 展开并转成带 offset 的具体实例。针对跨 DST 时区编写测试；SJTU 默认 Asia/Shanghai 不意味着全球时区都没有 DST。
- 结束时间跨日的事件，周视图可按天片段渲染，但逻辑上保持同一个 occurrence ID；没有 DDL 的日期仍有空状态。
- Canvas 截止时间按实际绝对时刻转展示时区再分组。如果用户电脑设在日本，Canvas 的北京时间 23:59 不应因时区转换错误被放在错误日期；设置界面应让用户理解展示时区选择。

## H. Canvas Provider 的详细实现规格

### H1. 认证/请求

1. Canvas Host 必须由用户选择或输入，参考仓库可能支持多个实例；只允许 `https://`、校验合法 hostname、移除不必要路径、阻止任意非受信站点重定向自动携带 Authorization Header。不要硬编码唯一域名。
2. 使用用户提供的 Personal Access Token（PAT）；通过 Rust 后端请求 Canvas API 完成校验，把 Token 存 Windows 安全凭据存储。UI 不回显完整 Token，仅可删除/替换。
3. 优先调用官方 REST API：`GET /api/v1/users/self/profile`（若实际部署不可用则使用文档认可的等价验证接口）、`GET /api/v1/courses`、`GET /api/v1/courses/:course_id/assignments?include[]=submission`。`override_assignment_dates` 默认有效，但仍需对实际有效时间与权限差异作测试。
4. 所有列表正确处理 `Link` Header 的 `rel="next"` 直到结束，不猜测总页数；设请求超时、最大页数/条数防御、重试退避（仅适用于幂等 GET；429 尊重 Retry-After）、取消与明显错误消息。
5. 区分 API 响应状态：401/403（凭据/权限）、404（接口/资源）、429（限流）、5xx（远端故障）、格式不符（解析失败）。HTTP 200 空列表不等于已拉取所有可见课程，需显示账户/课程范围信息。

### H2. 同步内容和字段

- 同步用户可见课程及关联 Assignment；不只抓“未来 7 天”，避免下周之后的 DDL 丢失，也允许历史课程是否纳入配置。
- 持久化 Canvas `course_id`、`assignment_id`、`name`、`due_at`、`lock_at`、`html_url`、`workflow_state`、当前用户 submission 状态、远端 `updated_at`、可选的说明摘要；`description` HTML 未经消毒不得直接渲染，默认以纯文本摘要展示。
- 如 assignment `due_at` 为 `null`，归入“无截止日期”，不展示假日期。对于不同学生/组别截止日期覆盖，优先使用 Canvas 返回给当前登录用户的有效时间，若无法确认则保留原始数据并在文档标注限制。
- `submission.workflow_state`（如 `submitted`/`graded` 等）与用户手工完成标记严格分离；刷新绝不能将本地“已完成”重置。
- 作业链接打开前校验可信 https URL，使用系统浏览器或合适的外部链接 API，避免在拥有 Tauri IPC 权限的内部 WebView 直接运行远端页面脚本。

### H3. 增量更新/幂等性

- `syncCanvas()` 要有明确的“抓取→解析验证→事务应用→更新同步记录”流程。
- `(source_id, course_id, assignment_id)` 唯一，重复刷新不能产生重复事项。远端标题/时间变化时更新同一条记录，并更新日历投影。
- **只有当整次全量范围抓取成功且所有页已获取，才能把确知消失的记录标记 archived**；分页中断/某门课获取失败时状态是 partial/failed，不要误删任何已缓存作业。
- 刷新中止/进程异常应保留最后一次完整缓存。离线后重新打开仍可显示旧课程与作业。
- 不能每次刷新都覆盖用户的个人事件、颜色、备注或本地完成状态。

## I. SJTU 教务 Provider 的详细实现规格

这部分**先根据 `references/SJTU-Course-Block` 的真实代码完成调查，再写 Provider**。不得在本任务书里把未核实 URL 当作固定事实。

### I1. 登录与获取课程

1. 在 `docs/integration-sjtu.md` 列出经过源码定位的本科/研究生入口、认证流程、请求参数和响应样例（脱敏）。区别 `CONFIRMED_BY_SOURCE` 与 `VERIFIED_LIVE` 两种状态。
2. 首选交互式授权：用户在受支持的 WebView/系统浏览器窗口自行登录，Agent 不得要求用户给你明文账号密码；验证是否允许正确获取已认证 session。对于 WebView 与浏览器隔离问题，遵循学校认证要求，不通过复制用户浏览器机密来绕过策略。
3. 若有验证码、MFA、CAS 跳转或域名策略阻断，提示用户操作；不能做自动绕过、伪造登录、不可验证的“免密登录”。
4. 在已登录会话内请求当前学期、可选历史学期课程；保留真实课程/教学班标识。课程节次、周次、地点、教师、学期配置转成领域结构。
5. 刷新失败时保留旧课表并报告错误。退出/断开账号必须清除安全凭据/会话，是否保留本地课表缓存由用户选择。

### I2. 适配器可替换性

在 Rust 后端定义 `SjtuScheduleProvider` 抽象（trait 或等价）和适配器层：

```text
login_interactively() -> AuthResult
list_terms(session) -> Term[]
fetch_schedule(session, term) -> RawSchedule
parse_schedule(raw, term_config) -> Course[] + Meeting[]
```

把网络请求与 JSON/HTML 解析分离；离线 fixtures 能直接测试 parser。参考仓库未来 API 失效时，可以只替换 provider，不需要重写 UI/数据库。确保本科学籍与研究生学籍的具体差异不会被强行忽略。

### I3. 安全、可用的 fallback

如果真实教务登录需要学校网络环境、当前机器没有账号、接口已变化、或需要用户交互无法自动验证，则：
- 仍完成页面、Provider 接口、解析器测试、sync 状态机；把验证缺口写入 `docs/known-limitations.md`。
- 实现本地 `ICS` 导入（能识别常规日程信息），若课程项目提供可校验的专属 `JSON` 格式，也实现导入并加 fixtures。
- 文件导入需要显示预览、学期映射、重复导入去重与可选替换同一导入来源，不能把 imported course 标为“已从教务成功同步”。
- 不采用抓屏 OCR 作为默认方案。

## J. 同步协调器与一致性

- 各来源各自状态：`idle → authenticating? → fetching → validating → applying → succeeded / partial / failed`。
- 提供分数据源刷新和“全部刷新”；全部刷新不需要分布式事务，但每个来源内部必须保证一次提交的原子性。
- 同源重复点击不得出现重入并发写；可合并重复请求或禁用按钮，支持超时取消。
- UI 在首次响应前展示缓存，成功后刷新 TanStack Query；不频繁闪烁整个周视图。
- 记录成功/失败、抓取数量、变更数量、错误码；日志不包含访问 Token、Cookie、完整私人作业正文、SSO 回调中可能包含的敏感参数。
- 稳定 ID 规则必须包含 provider 与账户/实例维度；不同 Canvas 实例的 `assignment_id=123` 不得冲突。
- 不用以标题或开始时间作为远端主键；同名课程、同名作业可并存。

## K. 逐阶段的真实开发计划（每个阶段都要执行）

### Phase 0 — 审计与工程骨架（分支 `chore/bootstrap`）

**动作**：克隆并研究参考项目；初始化 Tauri + React + TS；建基础目录、格式化与 lint、Vitest、Rust test、最小跨层 invoke、SQLite 迁移框架；创建初始 README、AGENTS.md 和分析文档。

**验收**：Windows 上 `pnpm install`、`pnpm tauri dev` 可打开真实 Tauri 窗口；`pnpm lint`、`pnpm test`、`cargo test` 可正常执行；Git 不跟踪 `references/`。记录工具版本与参考仓库 SHA。完成后提交并合并 main。

### Phase 1 — 本地日程数据层（分支 `feat/calendar-core`）

**动作**：迁移建立数据表；实现 personal event CRUD、RRULE 与 exceptions、日期范围查询与 `CalendarOccurrence` 映射；示例数据仅在测试或显式演示模式使用。

**验收**：新增、编辑、删除、仅删除某次、整个重复系列、重启后数据保留；跨月、单双周、时区、跨天单元测试通过；数据库迁移升级测试。提交并合并 main。

### Phase 2 — 桌面日历 UI（分支 `feat/calendar-ui`）

**动作**：周视图/月视图、左侧栏、时间轴、每天下方 DDL 栏、编辑 Drawer、详情、空状态、设置、颜色、过滤、主题。使用真实本地查询 API；尚未连接的数据源以空状态呈现。

**验收**：窗口大小变化后布局正常；同时段两门课不完全覆盖；日期切换正确；刷新页面/关闭重开保留本地事件；可添加每天/每周/每两周事件、取消单次发生。提交并合并 main。

### Phase 3 — Canvas 实际接入（分支 `feat/canvas-sync`）

**动作**：Token 安全存储、Host 配置、测试连接、课程与全部相关作业分页获取、映射、幂等 upsert、状态显示、单独刷新、提交/完成状态区分。添加 Mock HTTP server/fixtures 覆盖 API 错误。

**验收**：无 Token 时呈现引导；可用 Token 能请求真实账户（若用户已配置）；fixture 测试两页以上数据、401、429、部分失败、due_at=null、截止日期变更、重复刷新不重复、本地完成状态不丢；无真实凭据时必须如实记录“未做 live 验证”。提交并合并 main。

### Phase 4 — SJTU 课表实际接入（分支 `feat/sjtu-sync`）

**动作**：课程解析、学期/周次、时间表、登录状态、交互式教务登录、刷新；需要时 ICS/JSON 导入 fallback。

**验收**：脱敏样例解析正确；课程多个 meeting、单/双周、特殊周、换教室等情况有测试；同课程刷新幂等且移动时间/地点不生成幽灵记录；实际登录依赖用户时明确列出手动验证步骤，不造假。提交并合并 main。

### Phase 5 — 稳定版整理与打包（分支 `release/desktop-v1`）

**动作**：完善设置/错误处理、迁移、离线、中文 UI、快捷键、日志隐私、数据导入备份、操作文档、第三方声明；配置 Tauri Windows MSI 或 NSIS 打包。

**验收**：`pnpm tauri build` 产生 Windows 可安装产物，明确实际路径；安装/卸载、重开、数据持久化经过手动验证或说明未验证项目；测试全部通过；打 `v0.1.0` 或预发布标签仅在用户本地仓库，不自动推送远端。合并 main。

### Phase 6 — 桌面 Widget（**仅当前面稳定后**，创建 `feat/desktop-widget`）

**动作**：基于 main 新建分支；添加第二个 frameless Tauri 窗口 `widget`，复用相同 SQLite 后端与日程查询类型；显示今天课程、近期 DDL、时间和刷新入口；支持从主窗口切换打开/关闭。

**Widget 具体要求**：
- 无边框、简洁、可拖动、可调整大小；默认尺寸约 `360 × 480`，支持桌面定位与位置记忆。
- 始终置顶应作为**可选项**，不要默认遮挡全部桌面；可设置点击穿透但必须留出“恢复交互”的安全路径；禁止把窗口搞到无法关闭、无法移动。
- 可以隐藏任务栏图标，提供系统托盘菜单“打开主窗口 / 显示或隐藏 Widget / 退出”。
- Widget 与主窗口读同一 DB，增删改同步更新；关闭 Widget 不退出主应用（除非用户在设置里明确启用退出策略）。
- 点击课程/DDL 能调用主窗口相应详情；断网时显示缓存与最后同步时间。
- 不宣称与 Windows 11 原生 Widgets Board 集成。若以后需要真正嵌入桌面壁纸层/WorkerW，这应是独立研究型任务，必须先验证 Windows 版本兼容性。

**Widget 验收**：双窗口正常存在；托盘打开/关闭有效；Widget 位置持久化；不会失去鼠标/键盘控制；应用重启后可恢复设置；性能和主窗口不明显退化。验证通过再请求用户决定是否合并 main（该功能属于独立分支的增强，而非 V1 交付阻塞项）。

## L. 必须编写的自动化测试（最小集合）

### L1. 日历和重复事件

- 2026-10-19 至 2026-10-25 的周范围计算（周一开始）；年末/年初跨周。
- 学期第一周跨自然月、第一周与第 16 周对应课程是否显示；单周和双周根据教学周计算。
- 每周二、四重复；每两周重复；COUNT 与 UNTIL；删除第 3 次 occurrence 但第 4 次仍存在；仅编辑某次不污染系列。
- 全天/跨天/跨展示时区的事件；`Asia/Shanghai` 和 `Asia/Tokyo` 日期分组；必要时用 DST 时区测 wall-clock 行为。
- 本地事件操作后重启数据库仍一致，`getCalendarOccurrences` 正确排序。

### L2. Canvas

- Mock API 两页数据解析 Link next；同名不同 ID；不同来源同 assignment ID。
- 401/403/429/500、超时、部分课程失败，不得误删既有缓存。
- 同一作业连续同步 3 次不出现重复；作业截止日由 10 月 20 日改为 10 月 21 日时旧位置消失新位置出现。
- `due_at=null`、已提交、已评分、未提交；远端状态和本地手工完成并存。
- Token 不出现在数据库 dump / debug 日志 / 错误提示中（通过测试或人工检查）。

### L3. 教务

- HTML 与 JSON 样例（若参考源码支持）解析；教师/地点缺失、课程名含中文与符号、单双周、指定周集合、同课程多个排课时段。
- 课表全量成功后删除/取消某个 meeting 的正确归档；解析失败/认证过期保留最后缓存。
- 手工导入相同文件两次不重复；不同学期相同课程可共存。

### L4. UI / 打包

- 对接 Tauri 的 Command 类型检查；Vitest 组件交互/逻辑测试；至少手动验证周/月切换、来源过滤、离线页面、无 DDL 状态、编辑保存与取消。
- `pnpm lint`、`pnpm test`、`pnpm build`、`cargo test`、`pnpm tauri build` 必须有实际执行输出或清晰注明环境不足；禁止写“应该通过”。

## M. 交付文件、执行汇报模板和完成标准

必须生成：
- `README.md`：Windows 开发工具链、初始化、启动、运行测试、打包、配置 Canvas、教务登录/导入、安全说明、常见错误。
- `AGENTS.md`：本项目持续开发时的 agent 约束和阶段完成要求。
- `docs/reference-analysis.md`：两个参考项目的真实文件级审计和 SHA。
- `docs/architecture.md` 与 `docs/data-model.md`：系统架构、表结构、事件投影和时区规则。
- `docs/integration-canvas.md` 与 `docs/integration-sjtu.md`：真实 API/登录方式、支持能力、失败策略。
- `docs/acceptance-tests.md`：测试用例、执行记录、剩余风险。
- `docs/development-log.md`：每阶段时间、分支、Commit SHA、具体实现和验收结论。
- `docs/known-limitations.md`：所有尚未验证的外部行为、依赖用户操作和 Widget 的非原生边界。
- `THIRD_PARTY_NOTICES.md`：复用源码的许可证信息。

每阶段 Agent 最终汇报使用下面格式：

```text
阶段：Phase N / branch-name
参考源码：已阅读的关键文件 + SHA（只在 Phase 0 或涉及参考更新时列）
实现：具体功能 / 文件
验证：运行的命令、结果、失败及修复
真实 API 状态：Mock verified / Source inspected / Live verified（准确描述）
安全检查：Token/Cookie 是否可能泄露
Git：Commit SHA、是否合并 main、工作树状态
风险：不能完成的内容及原因
下一阶段：将直接继续执行的工作
```

**最终验收条件**：无需网络仍能打开应用并看到个人事件与已缓存数据；用户能创建、编辑、删除重复事件；Canvas 作业在真实授权或 fixture 测试下可同步到逐日 DDL 区域；教务课表可以经已验证适配器或明确标明的导入后显示；点击刷新幂等且不会清空本地内容；可构建 Windows 安装包；Widget 作为独立分支开发。

## N. 现在立刻执行的指令

1. 检查当前工作目录和开发环境，不要覆盖既有文件。
2. 创建 Git 基础结构与 `.gitignore`，克隆两份参考仓库到 `references/`，记录 SHA。
3. 真实搜索并阅读与教务登录/课表解析、Canvas 作业/Token/Tauri 有关的核心代码，完成 `docs/reference-analysis.md`，必须附真实代码路径。
4. 初始化 Tauri 2 + React + TS 工程、最小 SQLite 迁移、`AGENTS.md`、项目 README，使 `pnpm tauri dev` 能在 Windows 打开窗口。
5. 执行 Phase 0 验收并 Commit。继续按 Phase 1–5 顺序开发；每阶段如遇依赖用户登录的环节，记录并保留可测试 adapter，不要停掉其他独立工作。
6. **先不要做 Widget**。普通窗口稳定并通过打包后，再创建 `feat/desktop-widget`；Widget 阶段只在主版稳定后启动。

**最终要求：交付实际可以在用户 Windows 本地启动和构建的项目，而不只是计划、漂亮静态页面或未经验证的自动同步宣称。**

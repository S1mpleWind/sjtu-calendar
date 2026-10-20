# SJTU 教务课表接入

审计日期：2026-10-20。本文中的 URL、字段和请求参数来自被忽略的只读参考仓库 `SJTU-Course-Block`，状态均为 `CONFIRMED_BY_SOURCE`，不是交大官方 API 文档，也没有经过真实账户 `VERIFIED_LIVE`。

## 登录与会话安全

- 本科入口：`https://i.sjtu.edu.cn/jaccountlogin`。参考实现通过页面导航状态及 Cookie 是否存在推断登录完成。
- 研究生入口：参考实现使用 `https://yjs.sjtu.edu.cn/gsapp/sys/wdkbapp/*default/index.do?THEME=indigo&EMAP_LANG=zh#/xskcb`，并进一步请求课程数据验证 `code == 0`。
- 本应用打开独立 Tauri WebView；用户本人完成交大统一身份认证。回到设置页后点击“保存登录会话”，应用读取目标站点 Cookie、清理登录 WebView 浏览数据，再将会话放入 Windows Credential Manager。前端、SQLite、日志均不接收 Cookie。点击关闭也会清理 WebView 数据。
- “已保存会话”只表示本机 Credential Manager 有保存值，不代表学校已接受该会话。同步请求被拒绝时需重新登录。不能把账号密码、Cookie 或验证码发给 Agent。

## 源码定位的读取请求

本科：`course_block/lib/core/services/course_service.dart::fetchUndergraduateCourses` 使用 POST `https://i.sjtu.edu.cn/kbcx/xskbcx_cxXsKb.html`，表单 `xnm`（学年）和 `xqm`（1/2/3 学期映射至 3/12/16），响应从 `kbList` 读取。已观察的字段包括 `kch`/`kch_id`、`kcmc`、`xm`、`cdmc`、`xqj`、`jcs`、`zcd`、`xkbz`。

研究生：`course_block/lib/core/services/course_service.dart::fetchGraduateCourses` 使用 POST `https://yjs.sjtu.edu.cn/gsapp/sys/wdkbapp/modules/xskcb/xsjxrwcx.do`，查询参数包含时间戳，表单 `XNXQDM`、空 `XH`、`pageNumber=1`、`pageSize=200`；预期响应路径为 `datas.xsjxrwcx.rows` 且 `code == 0`。被审代码没有确认超过 200 条时的分页行为。

脱敏 fixture 仅包含结构示例和虚构课程标识，供单元测试调用 parser；应用运行时不会读取 fixture，也不会用它显示同步成功。课程字段和周次解析由 `src-tauri/src/sjtu.rs` 与请求函数分离；两个学籍系统分别映射到统一 meeting 结构。参考仓库中观察到的节次时间为第一节 08:00–08:45，后续按节次表映射，最后一节结束于 21:40。

## 学期和缓存

教务响应不提供经验证的首教学周日期。同步前用户必须填写学年、学期、第 1 周周一和教学周数；首周日期必须为周一。课程时区固定为 `Asia/Shanghai`。本科 `zcd` 与研究生 `PKSJDD/PKSJ` 的周次、单双周表达式被解析为显式周号集合；无法识别的行会让同步状态成为 partial，并保留以前缓存。

同一学期课程按学籍系统和教务课程标识幂等更新。一次完整、可解析的结果会在一个 SQLite 事务中应用并归档已消失的课程 meeting；部分解析保留旧 meeting，网络、认证或响应错误不触碰课程缓存。日历查询只从本地缓存展开教学周，因此应用离线启动仍可显示上次保存的课表。断开教务会清除凭据，不删除缓存。

## 首次账户验证步骤

1. 在应用“设置 → SJTU 教务课表”选择本科或研究生，点击“打开交大登录窗口”。
2. 在窗口内自行完成统一身份认证及学校要求的 MFA/验证码；不要将认证秘密粘贴到应用或聊天。
3. 回到主窗口点击“保存登录会话”。这只保存会话，不声称账号已验证。
4. 填写教务页面对应学期的学年、学期、第 1 教学周周一和教学周数，点击“刷新课表”。
5. 确认课程数量、周次、时间和地点与教务页面一致；若返回重新登录、网络策略阻断或字段无法解析，记录错误并保留旧缓存，不把它记为成功。
6. 点击“断开教务”清除 Credential Manager 会话；本地已同步课表会继续保留供离线查看。

## 验证状态

- `CONFIRMED_BY_SOURCE`：入口、请求 URL、表单字段、响应路径候选、节次映射和解析字段在 `SJTU-Course-Block` commit `b0ead20ae854a7cb5432b23f23138be908d5565c` 中定位。
- `VERIFIED_LIVE`：尚无真实账户、学校网络及脱敏真实响应验证。请按上方步骤由用户本人操作后再更新此状态。
- 设置页提供 ICS 课程导入，先映射学期首周周一和教学周数、预览，再作为本地个人日程应用；可按文件名来源替换或去重。它不会写入 SJTU 成功同步状态。
- ICS 兜底当前支持单次日程和每周重复（含 `INTERVAL`、`COUNT`、`UNTIL`），并明确拒绝额外/例外重复日期及复杂 `BYDAY` 等规则。文件最大 2 MiB、500 个 VEVENT、每次最多展开 1200 项；导入后逐项保存以便替换来源。

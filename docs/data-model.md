# 数据模型（Phase 0 基线）

Phase 0 仅创建 `app_settings(key, value_json, updated_at)` 并以 `schema_migrations(version, applied_at)` 管理升级。初始设置保存 `Asia/Shanghai` 时区默认值，JSON 内容作为值而非 SQL 文本格式保存。

后续迁移将增加独立的学期、课程、课程 meeting、作业、个人事件、重复例外、数据源和同步运行表。课程、Canvas 作业与用户日程保持分实体存储，再由 Rust 查询层投影为 `CalendarOccurrence`。Token/Cookie 不属于业务表。

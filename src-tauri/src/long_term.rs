use rusqlite::{Connection, params};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LongTermItem {
    id: String,
    title: String,
    created_at: String,
    archived_at: Option<String>,
}

pub fn list(path: &Path) -> Result<Vec<LongTermItem>, String> {
    let connection = Connection::open(path).map_err(db_error)?;
    let mut statement = connection.prepare(
        "SELECT id,title,created_at,archived_at FROM long_term_items ORDER BY (archived_at IS NOT NULL),CASE WHEN archived_at IS NULL THEN created_at END,archived_at DESC,id",
    ).map_err(db_error)?;
    statement
        .query_map([], |row| {
            Ok(LongTermItem {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                archived_at: row.get(3)?,
            })
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)
}

pub fn create(path: &Path, title: &str) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err("请输入 1–200 字的清单内容".into());
    }
    Connection::open(path)
        .map_err(db_error)?
        .execute(
            "INSERT INTO long_term_items(id,title,created_at) VALUES(?1,?2,?3)",
            params![
                uuid::Uuid::new_v4().to_string(),
                title,
                chrono::Utc::now().to_rfc3339()
            ],
        )
        .map_err(db_error)?;
    Ok(())
}

pub fn set_archived(path: &Path, id: &str, archived: bool) -> Result<(), String> {
    let archived_at = archived.then(|| chrono::Utc::now().to_rfc3339());
    let changed = Connection::open(path).map_err(db_error)?.execute(
        "UPDATE long_term_items SET archived_at=?1 WHERE id=?2 AND (archived_at IS NOT NULL) != ?3",
        params![archived_at, id, archived],
    ).map_err(db_error)?;
    if changed == 0 {
        let exists: bool = Connection::open(path)
            .map_err(db_error)?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM long_term_items WHERE id=?1)",
                [id],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        if !exists {
            return Err("该清单项目已不存在，请刷新后重试".into());
        }
    }
    Ok(())
}

fn db_error(error: rusqlite::Error) -> String {
    format!("长期清单数据库错误：{error}")
}

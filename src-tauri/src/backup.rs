use base64::{Engine as _, engine::general_purpose::STANDARD};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const FORMAT: &str = "edu.sjtu.schedule.sqlite-backup.v1";
const MAX_DATABASE_BYTES: usize = 64 * 1024 * 1024;
const LATEST_SCHEMA: i64 = 6;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupEnvelope {
    format: String,
    schema_version: i64,
    created_at: String,
    sha256: String,
    database_base64: String,
}

pub fn export(path: &Path) -> Result<String, String> {
    let connection = Connection::open(path).map_err(db_error)?;
    connection
        .execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(db_error)?;
    drop(connection);
    let bytes = fs::read(path).map_err(|_| "无法读取本地日历数据库".to_string())?;
    if bytes.len() > MAX_DATABASE_BYTES {
        return Err("数据库超过 64 MiB，暂不支持通过应用导出".into());
    }
    let schema_version = read_schema_version(path)?;
    let envelope = BackupEnvelope {
        format: FORMAT.into(),
        schema_version,
        created_at: chrono::Utc::now().to_rfc3339(),
        sha256: format!("{:x}", Sha256::digest(&bytes)),
        database_base64: STANDARD.encode(bytes),
    };
    serde_json::to_string(&envelope).map_err(|_| "无法编码数据库备份".into())
}

pub fn restore(path: &Path, serialized: &str) -> Result<i64, String> {
    if serialized.len() > (MAX_DATABASE_BYTES * 4 / 3) + 1024 * 1024 {
        return Err("备份文件超过大小限制".into());
    }
    let envelope: BackupEnvelope =
        serde_json::from_str(serialized).map_err(|_| "备份文件格式无效".to_string())?;
    if envelope.format != FORMAT {
        return Err("备份文件不是 SJTU Schedule 导出的格式".into());
    }
    if envelope.schema_version < 1 || envelope.schema_version > LATEST_SCHEMA {
        return Err("备份数据库版本不受当前应用支持".into());
    }
    let bytes = STANDARD
        .decode(envelope.database_base64)
        .map_err(|_| "备份数据库内容无效".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_DATABASE_BYTES {
        return Err("备份数据库大小无效".into());
    }
    let checksum = format!("{:x}", Sha256::digest(&bytes));
    if checksum != envelope.sha256 {
        return Err("备份校验失败，文件内容可能已损坏".into());
    }

    let temporary = sibling_path(path, "restore-tmp")?;
    let previous = sibling_path(path, &format!("pre-restore-{}", Uuid::new_v4()))?;
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|_| "无法清理上次未完成的恢复临时文件".to_string())?;
    }
    fs::write(&temporary, bytes).map_err(|_| "无法写入恢复临时数据库".to_string())?;
    let candidate = validate_database(&temporary);
    let restored_schema = match candidate {
        Ok(version) => version,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
    };

    if path.exists() {
        let connection = Connection::open(path).map_err(db_error)?;
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(db_error)?;
        drop(connection);
        fs::rename(path, &previous).map_err(|_| "无法为恢复操作保留原数据库".to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if previous.exists() {
            let _ = fs::rename(&previous, path);
        }
        return Err(format!("无法切换到恢复后的数据库：{error}"));
    }
    remove_sidecar(path, "-wal");
    remove_sidecar(path, "-shm");
    Ok(restored_schema)
}

fn validate_database(path: &Path) -> Result<i64, String> {
    let connection =
        Connection::open(path).map_err(|_| "备份不是有效的 SQLite 数据库".to_string())?;
    let migration_table: bool = connection
        .query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations')", [], |row| row.get(0))
        .map_err(db_error)?;
    if !migration_table {
        return Err("备份中没有 SJTU Schedule 数据库迁移表".into());
    }
    let source_version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version),0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if source_version < 1 || source_version > LATEST_SCHEMA {
        return Err("备份数据库版本不受当前应用支持".into());
    }
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(db_error)?;
    if integrity != "ok" {
        return Err("备份数据库完整性检查失败".into());
    }
    drop(connection);
    crate::db::initialize_database(path).map_err(|_| "无法将备份迁移到当前数据库版本".to_string())
}

fn read_schema_version(path: &Path) -> Result<i64, String> {
    Connection::open(path)
        .map_err(db_error)?
        .query_row(
            "SELECT COALESCE(MAX(version),0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(db_error)
}

fn sibling_path(path: &Path, suffix: &str) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or("数据库路径无效")?;
    let stem = path.file_stem().ok_or("数据库路径无效")?.to_string_lossy();
    let extension = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    Ok(parent.join(format!("{stem}.{suffix}{extension}")))
}

fn remove_sidecar(path: &Path, suffix: &str) {
    let sidecar = PathBuf::from(format!("{}{suffix}", path.display()));
    let _ = fs::remove_file(sidecar);
}

fn db_error(error: rusqlite::Error) -> String {
    format!("本地数据库错误：{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn exports_and_restores_sqlite_data_without_credentials() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("calendar.sqlite3");
        crate::db::initialize_database(&path).unwrap();
        let connection = Connection::open(&path).unwrap();
        connection.execute("INSERT INTO personal_events(id,title,start_local,end_local,timezone,created_at,updated_at) VALUES('event-1','Backed up','2026-10-20T09:00:00','2026-10-20T10:00:00','Asia/Shanghai','now','now')", []).unwrap();
        drop(connection);
        let envelope = export(&path).unwrap();
        Connection::open(&path)
            .unwrap()
            .execute("DELETE FROM personal_events", [])
            .unwrap();
        assert_eq!(restore(&path, &envelope).unwrap(), LATEST_SCHEMA);
        let title: String = Connection::open(&path)
            .unwrap()
            .query_row(
                "SELECT title FROM personal_events WHERE id='event-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "Backed up");
    }

    #[test]
    fn rejects_a_backup_with_a_bad_checksum_without_touching_current_database() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("calendar.sqlite3");
        crate::db::initialize_database(&path).unwrap();
        let mut envelope: BackupEnvelope = serde_json::from_str(&export(&path).unwrap()).unwrap();
        envelope.sha256 = "bad".into();
        let before = fs::read(&path).unwrap();
        assert!(restore(&path, &serde_json::to_string(&envelope).unwrap()).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
    }
}

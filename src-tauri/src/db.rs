use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");

pub fn initialize_database(path: &Path) -> rusqlite::Result<i64> {
    let mut connection = Connection::open(path)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    apply_migrations(&mut connection)
}

fn apply_migrations(connection: &mut Connection) -> rusqlite::Result<i64> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );",
    )?;

    let initial_applied = connection
        .query_row(
            "SELECT version FROM schema_migrations WHERE version = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some();

    if !initial_applied {
        let transaction = connection.transaction()?;
        transaction.execute_batch(INITIAL_MIGRATION)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version) VALUES (?1)",
            params![1],
        )?;
        transaction.commit()?;
    }

    connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )
}

#[cfg(test)]
mod tests {
    use super::apply_migrations;
    use rusqlite::Connection;

    #[test]
    fn initial_migration_is_repeatable_and_sets_default_timezone() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");

        assert_eq!(
            apply_migrations(&mut connection).expect("apply initial migration"),
            1
        );
        assert_eq!(apply_migrations(&mut connection).expect("apply again"), 1);

        let timezone: String = connection
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = 'timezone'",
                [],
                |row| row.get(0),
            )
            .expect("read default timezone");
        assert_eq!(timezone, "\"Asia/Shanghai\"");

        let settings_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM app_settings", [], |row| row.get(0))
            .expect("count settings");
        assert_eq!(
            settings_count, 1,
            "rerunning a migration must not duplicate data"
        );
    }
}

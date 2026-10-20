use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");
const PERSONAL_EVENTS_MIGRATION: &str = include_str!("../migrations/0002_personal_events.sql");
const CANVAS_CACHE_MIGRATION: &str = include_str!("../migrations/0003_canvas_cache.sql");
const SJTU_SCHEDULE_MIGRATION: &str = include_str!("../migrations/0004_sjtu_schedule.sql");
const ICS_IMPORT_MIGRATION: &str = include_str!("../migrations/0005_ics_import.sql");

pub fn initialize_database(path: &Path) -> rusqlite::Result<i64> {
    let mut connection = Connection::open(path)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    apply_migrations(&mut connection)
}

pub(super) fn apply_migrations(connection: &mut Connection) -> rusqlite::Result<i64> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );",
    )?;

    for (version, sql) in [
        (1, INITIAL_MIGRATION),
        (2, PERSONAL_EVENTS_MIGRATION),
        (3, CANVAS_CACHE_MIGRATION),
        (4, SJTU_SCHEDULE_MIGRATION),
        (5, ICS_IMPORT_MIGRATION),
    ] {
        let applied = connection
            .query_row(
                "SELECT version FROM schema_migrations WHERE version = ?1",
                params![version],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some();

        if !applied {
            let transaction = connection.transaction()?;
            transaction.execute_batch(sql)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version) VALUES (?1)",
                params![version],
            )?;
            transaction.commit()?;
        }
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
    fn migrations_upgrade_to_v5_once_and_preserve_default_timezone() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");

        assert_eq!(
            apply_migrations(&mut connection).expect("apply initial migration"),
            5
        );
        assert_eq!(apply_migrations(&mut connection).expect("apply again"), 5);

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
        let migration_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("count migrations");
        assert_eq!(migration_count, 5);
        connection
            .query_row("SELECT COUNT(*) FROM recurrence_exceptions", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("v2 recurrence exceptions table exists");
        connection
            .query_row("SELECT COUNT(*) FROM canvas_assignments", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("v3 canvas cache table exists");
        connection
            .query_row("SELECT COUNT(*) FROM course_meetings", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("v4 course meetings table exists");
    }
}

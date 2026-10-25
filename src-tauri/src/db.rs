use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;

pub const LATEST_SCHEMA: i64 = 9;

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");
const PERSONAL_EVENTS_MIGRATION: &str = include_str!("../migrations/0002_personal_events.sql");
const CANVAS_CACHE_MIGRATION: &str = include_str!("../migrations/0003_canvas_cache.sql");
const SJTU_SCHEDULE_MIGRATION: &str = include_str!("../migrations/0004_sjtu_schedule.sql");
const ICS_IMPORT_MIGRATION: &str = include_str!("../migrations/0005_ics_import.sql");
const SJTU_OCCURRENCE_NOTES_MIGRATION: &str =
    include_str!("../migrations/0006_sjtu_occurrence_notes.sql");
const DDL_OVERVIEW_MIGRATION: &str = include_str!("../migrations/0007_ddl_overview.sql");
const LONG_TERM_MIGRATION: &str = include_str!("../migrations/0008_long_term_items.sql");
const LONG_TERM_NOTES_MIGRATION: &str = include_str!("../migrations/0009_long_term_notes.sql");

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
        (6, SJTU_OCCURRENCE_NOTES_MIGRATION),
        (7, DDL_OVERVIEW_MIGRATION),
        (8, LONG_TERM_MIGRATION),
        (9, LONG_TERM_NOTES_MIGRATION),
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
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migrations_upgrade_to_latest_once_and_preserve_default_timezone() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");

        assert_eq!(
            apply_migrations(&mut connection).expect("apply initial migration"),
            LATEST_SCHEMA
        );
        assert_eq!(
            apply_migrations(&mut connection).expect("apply again"),
            LATEST_SCHEMA
        );

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
        assert_eq!(migration_count, LATEST_SCHEMA);
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
        connection
            .query_row("SELECT COUNT(*) FROM course_occurrence_notes", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("v6 occurrence notes table exists");
    }

    #[test]
    fn v6_upgrade_preserves_events_and_includes_existing_local_deadlines_once() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT 'fixture');").unwrap();
        for (version, sql) in [
            (1, INITIAL_MIGRATION),
            (2, PERSONAL_EVENTS_MIGRATION),
            (3, CANVAS_CACHE_MIGRATION),
            (4, SJTU_SCHEDULE_MIGRATION),
            (5, ICS_IMPORT_MIGRATION),
            (6, SJTU_OCCURRENCE_NOTES_MIGRATION),
        ] {
            connection.execute_batch(sql).unwrap();
            connection
                .execute(
                    "INSERT INTO schema_migrations(version) VALUES(?1)",
                    [version],
                )
                .unwrap();
        }
        for (id, category) in [("old-event", "event"), ("old-ddl", "deadline")] {
            connection.execute("INSERT INTO personal_events(id,title,category,start_local,end_local,timezone,created_at,updated_at) VALUES(?1,'Old',?2,'2026-10-24T09:00:00','2026-10-24T10:00:00','Asia/Shanghai','fixture','fixture')", [id, category]).unwrap();
        }
        assert_eq!(apply_migrations(&mut connection).unwrap(), LATEST_SCHEMA);
        let included: i64 = connection
            .query_row(
                "SELECT include_in_overview FROM personal_events WHERE id='old-ddl'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(included, 1);
        connection
            .execute(
                "UPDATE personal_events SET include_in_overview=0 WHERE id='old-ddl'",
                [],
            )
            .unwrap();
        apply_migrations(&mut connection).unwrap();
        let (count, included): (i64, i64) = connection
            .query_row(
                "SELECT COUNT(*),SUM(include_in_overview) FROM personal_events",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((count, included), (2, 0));
    }
}

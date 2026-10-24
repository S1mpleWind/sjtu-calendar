use chrono::{DateTime, Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashSet},
    path::Path,
    str::FromStr,
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EventDraft {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub location: String,
    #[serde(default = "default_category")]
    pub category: String,
    /// Local wall-clock time in `timezone`, formatted `YYYY-MM-DDTHH:MM:SS`.
    pub start_local: String,
    /// Local wall-clock time in `timezone`, formatted `YYYY-MM-DDTHH:MM:SS`.
    pub end_local: String,
    pub timezone: String,
    #[serde(default)]
    pub all_day: bool,
    /// RFC 5545 rule contents, for example `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO`.
    #[serde(default)]
    pub rrule: Option<String>,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub include_in_overview: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersonalEvent {
    pub id: String,
    #[serde(flatten)]
    pub draft: EventDraft,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOccurrence {
    pub occurrence_id: String,
    pub event_id: String,
    pub original_start_local: String,
    pub title: String,
    pub description: String,
    pub location: String,
    pub category: String,
    pub start_utc: String,
    pub end_utc: String,
    pub timezone: String,
    pub display_timezone: String,
    pub all_day: bool,
    pub color: String,
    pub include_in_overview: bool,
    pub overview_completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceOverride {
    pub title: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub category: Option<String>,
    pub start_local: Option<String>,
    pub end_local: Option<String>,
    pub timezone: Option<String>,
    pub all_day: Option<bool>,
    pub color: Option<String>,
    pub include_in_overview: Option<bool>,
}

fn default_category() -> String {
    "event".into()
}
fn default_color() -> String {
    "#4f46e5".into()
}
fn now() -> String {
    Utc::now().to_rfc3339()
}

fn open_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(db_error)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(db_error)?;
    Ok(connection)
}

fn parse_local(value: &str) -> Result<NaiveDateTime, String> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S")
        .map_err(|_| format!("Invalid local datetime '{value}'; expected YYYY-MM-DDTHH:MM:SS"))
}

fn parse_timezone(value: &str) -> Result<Tz, String> {
    Tz::from_str(value).map_err(|_| format!("Unknown IANA timezone '{value}'"))
}

fn resolve_local(tz: Tz, local: NaiveDateTime) -> Result<DateTime<Tz>, String> {
    match tz.from_local_datetime(&local) {
        LocalResult::Single(value) => Ok(value),
        LocalResult::Ambiguous(first, second) => Ok(first.min(second)),
        LocalResult::None => Err(format!("Local time {local} does not exist in {tz}")),
    }
}

// RFC 5545 skips a generated start that falls into a daylight-saving gap.
fn resolve_recurrence_start(tz: Tz, local: NaiveDateTime) -> Option<DateTime<Tz>> {
    match tz.from_local_datetime(&local) {
        LocalResult::Single(value) => Some(value),
        LocalResult::Ambiguous(first, second) => Some(first.min(second)),
        LocalResult::None => None,
    }
}

fn validate(draft: &EventDraft) -> Result<(NaiveDateTime, NaiveDateTime), String> {
    if draft.title.trim().is_empty() {
        return Err("Event title cannot be empty".into());
    }
    if !matches!(draft.category.as_str(), "event" | "deadline") {
        return Err("Category must be 'event' or 'deadline'".into());
    }
    if draft.color.len() != 7
        || !draft.color.starts_with('#')
        || !draft.color[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Color must be a #RRGGBB value".into());
    }
    let start = parse_local(&draft.start_local)?;
    let end = parse_local(&draft.end_local)?;
    if end <= start {
        return Err("Event end must be after its start".into());
    }
    if end - start > Duration::days(366) {
        return Err("An event cannot span more than 366 days".into());
    }
    let tz = parse_timezone(&draft.timezone)?;
    resolve_local(tz, start)?;
    resolve_local(tz, end)?;
    if let Some(rule) = &draft.rrule {
        let normalized = rule.trim().strip_prefix("RRULE:").unwrap_or(rule.trim());
        let text = format!(
            "DTSTART:{}Z\nRRULE:{normalized}",
            start.format("%Y%m%dT%H%M%S")
        );
        rrule::RRuleSet::from_str(&text)
            .map_err(|error| format!("Invalid recurrence rule: {error}"))?;
    }
    Ok((start, end))
}

fn draft_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PersonalEvent> {
    Ok(PersonalEvent {
        id: row.get(0)?,
        draft: EventDraft {
            title: row.get(1)?,
            description: row.get(2)?,
            location: row.get(3)?,
            category: row.get(4)?,
            start_local: row.get(5)?,
            end_local: row.get(6)?,
            timezone: row.get(7)?,
            all_day: row.get(8)?,
            rrule: row.get(9)?,
            color: row.get(10)?,
            include_in_overview: row.get(13)?,
        },
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

const EVENT_COLUMNS: &str = "id,title,description,location,category,start_local,end_local,timezone,all_day,rrule,color,created_at,updated_at,include_in_overview";

pub fn create_event(path: &Path, draft: EventDraft) -> Result<PersonalEvent, String> {
    let connection = open_database(path)?;
    create_event_on(&connection, draft)
}

pub fn create_event_on(
    connection: &Connection,
    draft: EventDraft,
) -> Result<PersonalEvent, String> {
    validate(&draft)?;
    let id = Uuid::new_v4().to_string();
    let timestamp = now();
    connection.execute(
        "INSERT INTO personal_events (id,title,description,location,category,start_local,end_local,timezone,all_day,rrule,color,created_at,updated_at,include_in_overview) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12,?13)",
        params![id, draft.title.trim(), draft.description, draft.location, draft.category, draft.start_local, draft.end_local, draft.timezone, draft.all_day, draft.rrule, draft.color, timestamp, draft.include_in_overview],
    ).map_err(db_error)?;
    get_event_on(connection, &id)?.ok_or_else(|| "Created event could not be read back".into())
}

pub fn update_event(path: &Path, id: &str, draft: EventDraft) -> Result<PersonalEvent, String> {
    let mut connection = open_database(path)?;
    validate(&draft)?;
    let previous = get_event_on(&connection, id)?.ok_or("Event was not found")?;
    let transaction = connection.transaction().map_err(db_error)?;
    let changed = transaction.execute(
        "UPDATE personal_events SET title=?2,description=?3,location=?4,category=?5,start_local=?6,end_local=?7,timezone=?8,all_day=?9,rrule=?10,color=?11,updated_at=?12,include_in_overview=?13 WHERE id=?1 AND deleted_at IS NULL",
        params![id, draft.title.trim(), draft.description, draft.location, draft.category, draft.start_local, draft.end_local, draft.timezone, draft.all_day, draft.rrule, draft.color, now(), draft.include_in_overview],
    ).map_err(db_error)?;
    if changed == 0 {
        return Err("Event was not found".into());
    }
    if previous.draft.rrule.is_none()
        && draft.rrule.is_none()
        && previous.draft.start_local != draft.start_local
    {
        transaction.execute("UPDATE personal_event_completion SET original_start_local=?3 WHERE event_id=?1 AND original_start_local=?2", params![id, previous.draft.start_local, draft.start_local]).map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)?;
    get_event_on(&connection, id)?.ok_or_else(|| "Updated event could not be read back".into())
}

pub fn delete_event(path: &Path, id: &str) -> Result<(), String> {
    let connection = open_database(path)?;
    let changed = connection.execute("UPDATE personal_events SET deleted_at=?2,updated_at=?2 WHERE id=?1 AND deleted_at IS NULL", params![id, now()]).map_err(db_error)?;
    if changed == 0 {
        return Err("Event was not found".into());
    }
    Ok(())
}

pub fn get_event(path: &Path, id: &str) -> Result<Option<PersonalEvent>, String> {
    let connection = open_database(path)?;
    get_event_on(&connection, id)
}

fn get_event_on(connection: &Connection, id: &str) -> Result<Option<PersonalEvent>, String> {
    connection
        .query_row(
            &format!(
                "SELECT {EVENT_COLUMNS} FROM personal_events WHERE id=?1 AND deleted_at IS NULL"
            ),
            [id],
            draft_from_row,
        )
        .optional()
        .map_err(db_error)
}

pub fn list_events(path: &Path) -> Result<Vec<PersonalEvent>, String> {
    let connection = open_database(path)?;
    let mut statement = connection.prepare(&format!("SELECT {EVENT_COLUMNS} FROM personal_events WHERE deleted_at IS NULL ORDER BY start_local,title")).map_err(db_error)?;
    let rows = statement.query_map([], draft_from_row).map_err(db_error)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
}

pub fn set_exception(
    path: &Path,
    event_id: &str,
    original_start_local: String,
    kind: String,
    override_value: Option<RecurrenceOverride>,
) -> Result<(), String> {
    let connection = open_database(path)?;
    set_exception_on(
        &connection,
        event_id,
        original_start_local,
        kind,
        override_value,
    )
}

fn set_exception_on(
    connection: &Connection,
    event_id: &str,
    original: String,
    kind: String,
    override_value: Option<RecurrenceOverride>,
) -> Result<(), String> {
    let original_dt = parse_local(&original)?;
    let event =
        get_event_on(connection, event_id)?.ok_or_else(|| "Event was not found".to_string())?;
    if event.draft.rrule.is_none() {
        return Err("Single-occurrence exceptions require a recurring event".into());
    }
    let override_json =
        match (kind.as_str(), override_value) {
            ("cancelled", None) => None,
            ("override", Some(value)) => {
                let mut draft = event.draft.clone();
                let (base_start, base_end) = validate(&draft)?;
                draft.start_local = original_dt.format("%Y-%m-%dT%H:%M:%S").to_string();
                draft.end_local = (original_dt + (base_end - base_start))
                    .format("%Y-%m-%dT%H:%M:%S")
                    .to_string();
                if let Some(v) = value.title {
                    draft.title = v;
                }
                if let Some(v) = value.description {
                    draft.description = v;
                }
                if let Some(v) = value.location {
                    draft.location = v;
                }
                if let Some(v) = value.category {
                    draft.category = v;
                }
                if let Some(v) = value.start_local {
                    draft.start_local = v;
                }
                if let Some(v) = value.end_local {
                    draft.end_local = v;
                }
                if let Some(v) = value.timezone {
                    draft.timezone = v;
                }
                if let Some(v) = value.all_day {
                    draft.all_day = v;
                }
                if let Some(v) = value.color {
                    draft.color = v;
                }
                if let Some(v) = value.include_in_overview {
                    draft.include_in_overview = v;
                }
                draft.rrule = None;
                validate(&draft)?;
                Some(serde_json::to_string(&draft).map_err(|error| error.to_string())?)
            }
            _ => return Err(
                "Exception must be cancelled without override data or override with event fields"
                    .into(),
            ),
        };
    if !recurrence_contains(&event, original_dt)? {
        return Err("Exception date is not an occurrence in this series".into());
    }
    connection.execute(
        "INSERT INTO recurrence_exceptions (id,event_id,original_start_local,kind,override_json,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(event_id,original_start_local) DO UPDATE SET kind=excluded.kind,override_json=excluded.override_json,updated_at=excluded.updated_at",
        params![Uuid::new_v4().to_string(), event_id, original, kind, override_json, now()],
    ).map_err(db_error)?;
    Ok(())
}

fn recurrence_contains(event: &PersonalEvent, original_dt: NaiveDateTime) -> Result<bool, String> {
    let start = parse_local(&event.draft.start_local)?;
    let rule = event
        .draft
        .rrule
        .as_deref()
        .ok_or("Event is not recurring")?;
    let rule = rule.trim().strip_prefix("RRULE:").unwrap_or(rule.trim());
    let recurrence = rrule::RRuleSet::from_str(&format!(
        "DTSTART:{}Z\nRRULE:{rule}",
        start.format("%Y%m%dT%H%M%S")
    ))
    .map_err(|error| format!("Invalid recurrence rule: {error}"))?;
    let lower = (original_dt - Duration::seconds(1))
        .and_utc()
        .with_timezone(&rrule::Tz::UTC);
    let upper = (original_dt + Duration::seconds(1))
        .and_utc()
        .with_timezone(&rrule::Tz::UTC);
    Ok(recurrence
        .after(lower)
        .before(upper)
        .all(2)
        .dates
        .iter()
        .any(|date| date.naive_utc() == original_dt))
}

#[derive(Deserialize)]
struct ExceptionRow {
    kind: String,
    override_json: Option<String>,
}

fn localize_occurrence(
    event: &PersonalEvent,
    original_start: NaiveDateTime,
    display_tz: Tz,
    exception: Option<ExceptionRow>,
) -> Result<Option<CalendarOccurrence>, String> {
    let (event_start, event_end) = validate(&event.draft)?;
    let duration = event_end - event_start;
    let event_tz: Tz = event
        .draft
        .timezone
        .parse()
        .map_err(|_| "Unknown event timezone".to_string())?;
    let mut draft = event.draft.clone();
    let is_override = exception
        .as_ref()
        .is_some_and(|value| value.kind == "override");
    if let Some(exception) = exception {
        match exception.kind.as_str() {
            "cancelled" => return Ok(None),
            "override" => {
                let raw: serde_json::Value = serde_json::from_str(
                    exception
                        .override_json
                        .as_deref()
                        .ok_or("Missing exception override")?,
                )
                .map_err(|error| error.to_string())?;
                let mut override_draft: EventDraft =
                    serde_json::from_value(raw.clone()).map_err(|error| error.to_string())?;
                if raw.get("includeInOverview").is_none() {
                    override_draft.include_in_overview = event.draft.include_in_overview;
                }
                draft = override_draft;
            }
            _ => return Err("Invalid recurrence exception".into()),
        }
    }
    let (start_dt, end_dt) = if is_override {
        let (resolved_start, resolved_end) = validate(&draft)?;
        let event_tz: Tz = draft
            .timezone
            .parse()
            .map_err(|_| "Unknown event timezone".to_string())?;
        (
            resolve_local(event_tz, resolved_start)?,
            resolve_local(event_tz, resolved_end)?,
        )
    } else {
        let Some(start) = resolve_recurrence_start(event_tz, original_start) else {
            return Ok(None);
        };
        (start, start + duration)
    };
    Ok(Some(CalendarOccurrence {
        occurrence_id: format!(
            "{}@{}",
            event.id,
            original_start.format("%Y-%m-%dT%H:%M:%S")
        ),
        event_id: event.id.clone(),
        original_start_local: original_start.format("%Y-%m-%dT%H:%M:%S").to_string(),
        title: draft.title,
        description: draft.description,
        location: draft.location,
        category: draft.category,
        start_utc: start_dt.with_timezone(&Utc).to_rfc3339(),
        end_utc: end_dt.with_timezone(&Utc).to_rfc3339(),
        timezone: draft.timezone,
        display_timezone: display_tz.to_string(),
        all_day: draft.all_day,
        color: draft.color,
        include_in_overview: draft.include_in_overview,
        overview_completed: false,
    }))
}

pub fn calendar_occurrences(
    path: &Path,
    from_date: &str,
    to_date: &str,
    display_timezone: &str,
) -> Result<Vec<CalendarOccurrence>, String> {
    let connection = open_database(path)?;
    calendar_occurrences_on(&connection, from_date, to_date, display_timezone)
}

pub fn calendar_occurrences_on(
    connection: &Connection,
    from_date: &str,
    to_date: &str,
    display_timezone: &str,
) -> Result<Vec<CalendarOccurrence>, String> {
    let from = NaiveDate::parse_from_str(from_date, "%Y-%m-%d")
        .map_err(|_| "Invalid fromDate; expected YYYY-MM-DD".to_string())?;
    let to = NaiveDate::parse_from_str(to_date, "%Y-%m-%d")
        .map_err(|_| "Invalid toDate; expected YYYY-MM-DD".to_string())?;
    if to < from || to - from > Duration::days(400) {
        return Err("Date range must be ordered and no longer than 401 days".into());
    }
    let display_tz = parse_timezone(display_timezone)?;
    let range_start = resolve_local(display_tz, from.and_time(NaiveTime::MIN))?.with_timezone(&Utc);
    let range_end = resolve_local(
        display_tz,
        (to + Duration::days(1)).and_time(NaiveTime::MIN),
    )?
    .with_timezone(&Utc);
    let mut events_stmt = connection.prepare(&format!("SELECT {EVENT_COLUMNS} FROM personal_events WHERE deleted_at IS NULL ORDER BY start_local,title")).map_err(db_error)?;
    let events = events_stmt
        .query_map([], draft_from_row)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    let mut output = Vec::new();
    for event in events {
        let tz = parse_timezone(&event.draft.timezone)?;
        let (base_start, base_end) = validate(&event.draft)?;
        let duration = base_end - base_start;
        let local_from = (range_start.with_timezone(&tz).naive_local() - duration).max(base_start);
        let local_to = range_end.with_timezone(&tz).naive_local();
        let starts: Vec<NaiveDateTime> = if let Some(rule) = &event.draft.rrule {
            let rule = rule.trim().strip_prefix("RRULE:").unwrap_or(rule.trim());
            let text = format!(
                "DTSTART:{}Z\nRRULE:{rule}",
                base_start.format("%Y%m%dT%H%M%S")
            );
            let recurrence = rrule::RRuleSet::from_str(&text)
                .map_err(|error| format!("Stored recurrence rule is invalid: {error}"))?;
            let local_from = (local_from - Duration::seconds(1))
                .and_utc()
                .with_timezone(&rrule::Tz::UTC);
            let local_to = local_to.and_utc().with_timezone(&rrule::Tz::UTC);
            recurrence
                .after(local_from)
                .before(local_to)
                .all(65535)
                .dates
                .into_iter()
                .map(|dt| dt.naive_utc())
                .collect()
        } else {
            vec![base_start]
        };
        let mut starts: BTreeSet<_> = starts.into_iter().collect();
        // An override can move into this range from an original date outside it.
        // Include those identities, then apply the same final UTC overlap filter.
        if event.draft.rrule.is_some() {
            let mut moved_stmt = connection.prepare("SELECT original_start_local FROM recurrence_exceptions WHERE event_id=?1 AND kind='override'").map_err(db_error)?;
            let moved = moved_stmt
                .query_map([&event.id], |row| row.get::<_, String>(0))
                .map_err(db_error)?;
            for original in moved {
                let original = parse_local(&original.map_err(db_error)?)?;
                if !starts.contains(&original) && recurrence_contains(&event, original)? {
                    starts.insert(original);
                }
            }
        }
        let mut exception_stmt = connection.prepare("SELECT kind,override_json FROM recurrence_exceptions WHERE event_id=?1 AND original_start_local=?2").map_err(db_error)?;
        let mut completion_stmt = connection.prepare("SELECT original_start_local FROM personal_event_completion WHERE event_id=?1 AND completed=1").map_err(db_error)?;
        let completed: HashSet<String> = completion_stmt
            .query_map([&event.id], |row| row.get(0))
            .map_err(db_error)?
            .collect::<rusqlite::Result<_>>()
            .map_err(db_error)?;
        for occurrence_start in starts {
            let original = occurrence_start.format("%Y-%m-%dT%H:%M:%S").to_string();
            let exception = exception_stmt
                .query_row(params![event.id, original], |row| {
                    Ok(ExceptionRow {
                        kind: row.get(0)?,
                        override_json: row.get(1)?,
                    })
                })
                .optional()
                .map_err(db_error)?;
            if let Some(mut occurrence) =
                localize_occurrence(&event, occurrence_start, display_tz, exception)?
            {
                let start_utc = DateTime::parse_from_rfc3339(&occurrence.start_utc)
                    .map_err(|error| error.to_string())?
                    .with_timezone(&Utc);
                let end_utc = DateTime::parse_from_rfc3339(&occurrence.end_utc)
                    .map_err(|error| error.to_string())?
                    .with_timezone(&Utc);
                if start_utc < range_end && end_utc > range_start {
                    occurrence.overview_completed = completed.contains(&original);
                    output.push(occurrence);
                }
            }
        }
    }
    output.sort_by(|a, b| a.start_utc.cmp(&b.start_utc).then(a.title.cmp(&b.title)));
    Ok(output)
}

pub fn set_completion(
    path: &Path,
    event_id: &str,
    original: &str,
    completed: bool,
) -> Result<(), String> {
    let connection = open_database(path)?;
    let original_dt = parse_local(original)?;
    let event = get_event_on(&connection, event_id)?.ok_or("日程不存在或已删除")?;
    let valid = if event.draft.rrule.is_some() {
        recurrence_contains(&event, original_dt)?
    } else {
        original_dt == parse_local(&event.draft.start_local)?
    };
    if !valid {
        return Err("这一天不属于该日程".into());
    }
    let exception = connection.query_row("SELECT kind,override_json FROM recurrence_exceptions WHERE event_id=?1 AND original_start_local=?2", params![event_id, original], |row| Ok(ExceptionRow { kind: row.get(0)?, override_json: row.get(1)? })).optional().map_err(db_error)?;
    let occurrence = localize_occurrence(
        &event,
        original_dt,
        parse_timezone(&event.draft.timezone)?,
        exception,
    )?
    .ok_or("这次日程已取消")?;
    if !occurrence.include_in_overview {
        return Err("请先将此日程纳入 DDL 总览".into());
    }
    connection.execute("INSERT INTO personal_event_completion(event_id,original_start_local,completed,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(event_id,original_start_local) DO UPDATE SET completed=excluded.completed,updated_at=excluded.updated_at", params![event_id, original, completed, now()]).map_err(db_error)?;
    Ok(())
}

fn db_error(error: rusqlite::Error) -> String {
    format!("Local database error: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        connection
    }
    fn event(start: &str, end: &str, rule: Option<&str>) -> EventDraft {
        EventDraft {
            title: "Review".into(),
            description: "notes".into(),
            location: "Room 1".into(),
            category: "event".into(),
            start_local: start.into(),
            end_local: end.into(),
            timezone: "Asia/Shanghai".into(),
            all_day: false,
            rrule: rule.map(str::to_string),
            color: "#123ABC".into(),
            include_in_overview: false,
        }
    }

    #[test]
    fn crud_and_database_reopen_keep_local_events() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let path = temp.path();
        crate::db::initialize_database(path).unwrap();
        let created = create_event(
            path,
            event("2026-10-30T23:30:00", "2026-10-31T01:00:00", None),
        )
        .unwrap();
        assert_eq!(
            get_event(path, &created.id).unwrap().unwrap().draft.title,
            "Review"
        );
        let mut updated = created.draft.clone();
        updated.title = "Updated".into();
        update_event(path, &created.id, updated).unwrap();
        drop(Connection::open(path).unwrap());
        assert_eq!(list_events(path).unwrap()[0].draft.title, "Updated");
        delete_event(path, &created.id).unwrap();
        assert!(list_events(path).unwrap().is_empty());
    }

    #[test]
    fn biweekly_rule_crosses_month_and_cancellation_is_single_occurrence() {
        let connection = database();
        let created = create_event_on(
            &connection,
            event(
                "2026-10-19T09:00:00",
                "2026-10-19T10:00:00",
                Some("FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=MO"),
            ),
        )
        .unwrap();
        set_exception_on(
            &connection,
            &created.id,
            "2026-11-02T09:00:00".into(),
            "cancelled".into(),
            None,
        )
        .unwrap();
        assert!(
            set_exception_on(
                &connection,
                &created.id,
                "2026-11-09T09:00:00".into(),
                "cancelled".into(),
                None,
            )
            .is_err()
        );
        let results =
            calendar_occurrences_on(&connection, "2026-10-01", "2026-12-01", "Asia/Shanghai")
                .unwrap();
        assert_eq!(
            results
                .iter()
                .map(|item| item.original_start_local.as_str())
                .collect::<Vec<_>>(),
            vec![
                "2026-10-19T09:00:00",
                "2026-11-16T09:00:00",
                "2026-11-30T09:00:00"
            ]
        );
    }

    #[test]
    fn count_until_override_and_timezone_projection_work() {
        let connection = database();
        let created = create_event_on(
            &connection,
            event(
                "2026-10-28T23:30:00",
                "2026-10-29T00:30:00",
                Some("FREQ=WEEKLY;UNTIL=20261111T233000Z"),
            ),
        )
        .unwrap();
        let mut override_value = RecurrenceOverride {
            title: Some("Moved".into()),
            description: None,
            location: None,
            category: None,
            start_local: Some("2026-11-04T20:00:00".into()),
            end_local: Some("2026-11-04T21:00:00".into()),
            timezone: Some("Asia/Shanghai".into()),
            all_day: None,
            color: None,
            include_in_overview: None,
        };
        set_exception_on(
            &connection,
            &created.id,
            "2026-11-04T23:30:00".into(),
            "override".into(),
            Some(override_value.clone()),
        )
        .unwrap();
        override_value.title = Some("ok".into());
        let results =
            calendar_occurrences_on(&connection, "2026-10-29", "2026-11-12", "Asia/Tokyo").unwrap();
        assert_eq!(results.len(), 3);
        let moved = results.iter().find(|item| item.title == "Moved").unwrap();
        assert_eq!(moved.start_utc, "2026-11-04T12:00:00+00:00");
        assert_eq!(moved.display_timezone, "Asia/Tokyo");
        assert_eq!(results[0].original_start_local, "2026-10-28T23:30:00");
    }

    #[test]
    fn moved_occurrence_is_found_by_destination_range_without_duplicates() {
        let connection = database();
        let created = create_event_on(
            &connection,
            event(
                "2026-10-19T09:00:00",
                "2026-10-19T10:00:00",
                Some("FREQ=WEEKLY;COUNT=3"),
            ),
        )
        .unwrap();
        let change = serde_json::from_value(serde_json::json!({
            "startLocal": "2026-11-10T23:30:00", "endLocal": "2026-11-11T01:00:00"
        }))
        .unwrap();
        set_exception_on(
            &connection,
            &created.id,
            "2026-10-19T09:00:00".into(),
            "override".into(),
            Some(change),
        )
        .unwrap();
        assert!(
            calendar_occurrences_on(&connection, "2026-10-19", "2026-10-19", "Asia/Shanghai")
                .unwrap()
                .is_empty()
        );
        let destination =
            calendar_occurrences_on(&connection, "2026-11-09", "2026-11-15", "Asia/Shanghai")
                .unwrap();
        assert_eq!(destination.len(), 1);
        assert_eq!(destination[0].original_start_local, "2026-10-19T09:00:00");
        assert_eq!(
            calendar_occurrences_on(&connection, "2026-11-11", "2026-11-11", "Asia/Shanghai")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            calendar_occurrences_on(&connection, "2026-10-01", "2026-11-30", "Asia/Shanghai")
                .unwrap()
                .len(),
            3
        );
        set_exception_on(
            &connection,
            &created.id,
            "2026-10-19T09:00:00".into(),
            "cancelled".into(),
            None,
        )
        .unwrap();
        assert!(
            calendar_occurrences_on(&connection, "2026-11-09", "2026-11-15", "Asia/Shanghai")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn override_preserves_its_occurrence_date_and_can_move_back_to_series_start() {
        let connection = database();
        let created = create_event_on(
            &connection,
            event(
                "2026-10-19T09:00:00",
                "2026-10-19T10:00:00",
                Some("FREQ=WEEKLY;COUNT=3"),
            ),
        )
        .unwrap();
        let change = serde_json::from_value(serde_json::json!({"title":"Renamed once"})).unwrap();
        set_exception_on(
            &connection,
            &created.id,
            "2026-10-26T09:00:00".into(),
            "override".into(),
            Some(change),
        )
        .unwrap();
        let once =
            calendar_occurrences_on(&connection, "2026-10-26", "2026-10-26", "Asia/Shanghai")
                .unwrap();
        assert_eq!(once.len(), 1);
        assert_eq!(once[0].start_utc, "2026-10-26T01:00:00+00:00");
        let change = serde_json::from_value(serde_json::json!({"startLocal":"2026-10-19T09:00:00","endLocal":"2026-10-19T10:00:00"})).unwrap();
        set_exception_on(
            &connection,
            &created.id,
            "2026-10-26T09:00:00".into(),
            "override".into(),
            Some(change),
        )
        .unwrap();
        let moved =
            calendar_occurrences_on(&connection, "2026-10-19", "2026-10-19", "Asia/Shanghai")
                .unwrap();
        assert_eq!(moved.len(), 2);
        assert_ne!(moved[0].occurrence_id, moved[1].occurrence_id);
        assert!(
            calendar_occurrences_on(&connection, "2026-10-26", "2026-10-26", "Asia/Shanghai")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn overview_completion_is_persistent_per_occurrence_and_follows_a_move() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("calendar.sqlite3");
        crate::db::initialize_database(&path).unwrap();
        let mut draft = event(
            "2026-10-19T09:00:00",
            "2026-10-19T10:00:00",
            Some("FREQ=WEEKLY;COUNT=3"),
        );
        draft.include_in_overview = true;
        let saved = create_event(&path, draft).unwrap();
        set_completion(&path, &saved.id, "2026-10-26T09:00:00", true).unwrap();
        let items =
            calendar_occurrences(&path, "2026-10-01", "2026-11-30", "Asia/Shanghai").unwrap();
        assert_eq!(
            items
                .iter()
                .map(|item| item.overview_completed)
                .collect::<Vec<_>>(),
            [false, true, false]
        );
        assert!(items.iter().all(|item| item.include_in_overview));
        let change = serde_json::from_value(serde_json::json!({"startLocal":"2026-11-10T09:00:00","endLocal":"2026-11-10T10:00:00"})).unwrap();
        set_exception(
            &path,
            &saved.id,
            "2026-10-26T09:00:00".into(),
            "override".into(),
            Some(change),
        )
        .unwrap();
        let moved =
            calendar_occurrences(&path, "2026-11-10", "2026-11-10", "Asia/Shanghai").unwrap();
        assert_eq!(moved.len(), 1);
        assert!(moved[0].overview_completed);
        set_completion(&path, &saved.id, "2026-10-26T09:00:00", false).unwrap();
        assert!(
            !calendar_occurrences(&path, "2026-11-10", "2026-11-10", "Asia/Shanghai").unwrap()[0]
                .overview_completed
        );
        assert!(set_completion(&path, &saved.id, "2026-10-20T09:00:00", true).is_err());
        set_exception(
            &path,
            &saved.id,
            "2026-10-26T09:00:00".into(),
            "cancelled".into(),
            None,
        )
        .unwrap();
        assert!(set_completion(&path, &saved.id, "2026-10-26T09:00:00", true).is_err());
    }

    #[test]
    fn moving_a_completed_non_recurring_event_keeps_its_completion() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("calendar.sqlite3");
        crate::db::initialize_database(&path).unwrap();
        let mut draft = event("2026-10-19T09:00:00", "2026-10-19T10:00:00", None);
        draft.include_in_overview = true;
        let saved = create_event(&path, draft.clone()).unwrap();
        set_completion(&path, &saved.id, "2026-10-19T09:00:00", true).unwrap();
        draft.start_local = "2026-10-20T09:00:00".into();
        draft.end_local = "2026-10-20T10:00:00".into();
        update_event(&path, &saved.id, draft).unwrap();
        let items =
            calendar_occurrences(&path, "2026-10-19", "2026-10-20", "Asia/Shanghai").unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].overview_completed);
        assert_eq!(items[0].original_start_local, "2026-10-20T09:00:00");
    }

    #[test]
    fn overview_opt_in_can_apply_to_one_occurrence_only() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("calendar.sqlite3");
        crate::db::initialize_database(&path).unwrap();
        let saved = create_event(
            &path,
            event(
                "2026-10-19T09:00:00",
                "2026-10-19T10:00:00",
                Some("FREQ=WEEKLY;COUNT=2"),
            ),
        )
        .unwrap();
        assert!(set_completion(&path, &saved.id, "2026-10-19T09:00:00", true).is_err());
        let change = serde_json::from_value(serde_json::json!({"includeInOverview":true})).unwrap();
        set_exception(
            &path,
            &saved.id,
            "2026-10-19T09:00:00".into(),
            "override".into(),
            Some(change),
        )
        .unwrap();
        set_completion(&path, &saved.id, "2026-10-19T09:00:00", true).unwrap();
        let items =
            calendar_occurrences(&path, "2026-10-01", "2026-10-31", "Asia/Shanghai").unwrap();
        assert!(items[0].include_in_overview && items[0].overview_completed);
        assert!(!items[1].include_in_overview && !items[1].overview_completed);
        // v6 exception snapshots have no opt-in field; inherit the migrated parent.
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "UPDATE personal_events SET include_in_overview=1 WHERE id=?1",
                [&saved.id],
            )
            .unwrap();
        connection.execute("UPDATE recurrence_exceptions SET override_json=json_remove(override_json,'$.includeInOverview') WHERE event_id=?1", [&saved.id]).unwrap();
        assert!(
            calendar_occurrences(&path, "2026-10-19", "2026-10-19", "Asia/Shanghai").unwrap()[0]
                .include_in_overview
        );
    }

    #[test]
    fn rejects_invalid_timezone_empty_title_and_nonexistent_dst_time() {
        let connection = database();
        assert!(
            create_event_on(
                &connection,
                event("2026-01-01T09:00:00", "2026-01-01T10:00:00", None)
            )
            .is_ok()
        );
        let mut invalid = event("2026-01-01T09:00:00", "2026-01-01T10:00:00", None);
        invalid.title = " ".into();
        assert!(create_event_on(&connection, invalid).is_err());
        let mut dst = event("2026-03-08T02:30:00", "2026-03-08T03:30:00", None);
        dst.timezone = "America/New_York".into();
        assert!(create_event_on(&connection, dst).is_err());
    }

    #[test]
    fn recurring_occurrence_in_dst_gap_is_skipped_without_failing_range_query() {
        let connection = database();
        let mut draft = event(
            "2026-03-07T02:30:00",
            "2026-03-07T03:00:00",
            Some("FREQ=DAILY;COUNT=3"),
        );
        draft.timezone = "America/New_York".into();
        create_event_on(&connection, draft).unwrap();
        let results =
            calendar_occurrences_on(&connection, "2026-03-07", "2026-03-09", "America/New_York")
                .unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].original_start_local, "2026-03-07T02:30:00");
        assert_eq!(results[1].original_start_local, "2026-03-09T02:30:00");
    }
}

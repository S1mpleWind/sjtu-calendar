use crate::events::{self, EventDraft};
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime};
use chrono_tz::Tz;
use rusqlite::{Connection, params};
use serde::Serialize;
use std::{collections::HashMap, path::Path, str::FromStr};
use uuid::Uuid;

const MAX_ICS_BYTES: usize = 2 * 1024 * 1024;
const MAX_EVENTS: usize = 500;
const MAX_OCCURRENCES: usize = 1200;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IcsPreview {
    pub source_name: String,
    pub event_count: usize,
    pub preview: Vec<IcsPreviewItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IcsPreviewItem {
    pub title: String,
    pub start_local: String,
    pub end_local: String,
    pub location: String,
}

#[derive(Debug, Clone)]
struct ImportedEvent {
    key: String,
    draft: EventDraft,
}

#[derive(Default)]
struct IcsEvent {
    props: HashMap<String, (HashMap<String, String>, String)>,
}

pub fn preview(
    content: &str,
    source_name: &str,
    first_monday: &str,
    week_count: u8,
) -> Result<IcsPreview, String> {
    let events = parse(content, source_name, first_monday, week_count)?;
    Ok(IcsPreview {
        source_name: clean_source_name(source_name)?,
        event_count: events.len(),
        preview: events
            .iter()
            .take(40)
            .map(|event| IcsPreviewItem {
                title: event.draft.title.clone(),
                start_local: event.draft.start_local.clone(),
                end_local: event.draft.end_local.clone(),
                location: event.draft.location.clone(),
            })
            .collect(),
    })
}

pub fn apply(
    path: &Path,
    content: &str,
    source_name: &str,
    first_monday: &str,
    week_count: u8,
    replace_source: bool,
) -> Result<usize, String> {
    let source = clean_source_name(source_name)?;
    let imported = parse(content, &source, first_monday, week_count)?;
    let mut connection = Connection::open(path).map_err(db_error)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(db_error)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let now = chrono::Utc::now().to_rfc3339();
    if replace_source {
        transaction
            .execute(
                "UPDATE personal_events SET deleted_at=?1,updated_at=?1 WHERE import_source=?2 AND deleted_at IS NULL",
                params![now, source],
            )
            .map_err(db_error)?;
    }
    let mut inserted = 0usize;
    for item in &imported {
        if !replace_source {
            let exists: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM personal_events WHERE import_source=?1 AND import_key=?2 AND deleted_at IS NULL)",
                    params![source, item.key],
                    |row| row.get(0),
                )
                .map_err(db_error)?;
            if exists {
                continue;
            }
        }
        let created = events::create_event_on(&transaction, item.draft.clone())?;
        transaction
            .execute(
                "UPDATE personal_events SET import_source=?2,import_key=?3 WHERE id=?1",
                params![created.id, source, item.key],
            )
            .map_err(db_error)?;
        inserted += 1;
    }
    transaction.commit().map_err(db_error)?;
    Ok(inserted)
}

fn parse(
    content: &str,
    source_name: &str,
    first_monday: &str,
    week_count: u8,
) -> Result<Vec<ImportedEvent>, String> {
    if content.len() > MAX_ICS_BYTES {
        return Err("ICS 文件超过 2 MiB 限制".into());
    }
    let monday = NaiveDate::parse_from_str(first_monday, "%Y-%m-%d")
        .map_err(|_| "请输入有效的学期首周周一".to_string())?;
    if monday.weekday().number_from_monday() != 1 || !(1..=24).contains(&week_count) {
        return Err("学期映射要求周一作为首周日期，教学周数为 1–24".into());
    }
    let end_date = monday + Duration::days(i64::from(week_count) * 7 - 1);
    let mut lines: Vec<String> = Vec::new();
    for line in content
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
    {
        if (line.starts_with(' ') || line.starts_with('\t')) && !lines.is_empty() {
            lines.last_mut().unwrap().push_str(line.trim_start());
        } else {
            lines.push(line.to_string());
        }
    }
    let mut events = Vec::new();
    let mut current: Option<IcsEvent> = None;
    let mut event_count = 0usize;
    for line in lines {
        if line.eq_ignore_ascii_case("BEGIN:VEVENT") {
            if current.is_some() {
                return Err("ICS 包含嵌套 VEVENT".into());
            }
            event_count += 1;
            if event_count > MAX_EVENTS {
                return Err("ICS 文件超过 500 个 VEVENT 限制".into());
            }
            current = Some(IcsEvent::default());
            continue;
        }
        if line.eq_ignore_ascii_case("END:VEVENT") {
            let event = current.take().ok_or("ICS VEVENT 结束标记不匹配")?;
            events.extend(expand_event(event, source_name, monday, end_date)?);
            if events.len() > MAX_OCCURRENCES {
                return Err("ICS 展开的日程超过 1200 项限制".into());
            }
            continue;
        }
        if let Some(event) = current.as_mut() {
            if let Some((key, params, value)) = parse_property(&line) {
                event.props.insert(key, (params, unescape_text(&value)));
            }
        }
    }
    if current.is_some() {
        return Err("ICS VEVENT 缺少结束标记".into());
    }
    if events.is_empty() {
        return Err("ICS 中没有映射到所选学期的课程日程".into());
    }
    Ok(events)
}

fn parse_property(line: &str) -> Option<(String, HashMap<String, String>, String)> {
    let (left, value) = line.split_once(':')?;
    let mut parts = left.split(';');
    let key = parts.next()?.to_ascii_uppercase();
    let params = parts
        .filter_map(|part| part.split_once('='))
        .map(|(key, value)| {
            (
                key.to_ascii_uppercase(),
                value.trim_matches('"').to_string(),
            )
        })
        .collect();
    Some((key, params, value.to_string()))
}

fn expand_event(
    event: IcsEvent,
    source: &str,
    monday: NaiveDate,
    end_date: NaiveDate,
) -> Result<Vec<ImportedEvent>, String> {
    if event.props.contains_key("EXDATE") || event.props.contains_key("RDATE") {
        return Err("ICS 包含额外重复日期/例外日期；为避免导入错误，请先展开或清理这些规则".into());
    }
    let get = |name: &str| {
        event
            .props
            .get(name)
            .map(|(_, value)| value.as_str())
            .unwrap_or("")
    };
    let uid = get("UID");
    if uid.is_empty() {
        return Err("ICS 中的课程缺少 UID".into());
    }
    let (start_params, start_text) = event.props.get("DTSTART").ok_or("ICS 课程缺少 DTSTART")?;
    let (end_params, end_text) = event.props.get("DTEND").ok_or("ICS 课程缺少 DTEND")?;
    let timezone = start_params
        .get("TZID")
        .or_else(|| end_params.get("TZID"))
        .map(String::as_str)
        .unwrap_or("Asia/Shanghai");
    let tz =
        Tz::from_str(timezone).map_err(|_| format!("ICS 使用了当前不支持的时区：{timezone}"))?;
    let start = parse_datetime(start_text, tz)?;
    let end = parse_datetime(end_text, tz)?;
    if end <= start {
        return Err("ICS 课程结束时间必须晚于开始时间".into());
    }
    let duration = end - start;
    let all_day = start_text.len() == 8 && end_text.len() == 8;
    let title = get("SUMMARY").trim();
    if title.is_empty() {
        return Err("ICS 课程缺少 SUMMARY 标题".into());
    }
    let location = get("LOCATION").to_string();
    let description = get("DESCRIPTION").to_string();
    let rrule = get("RRULE");
    let (interval, count, until) = parse_weekly_rule(rrule)?;
    let mut output = Vec::new();
    let mut occurrence_start = start;
    let mut occurrence_index = 0usize;
    loop {
        if count.is_some_and(|limit| occurrence_index >= limit) {
            break;
        }
        if until.is_some_and(|limit| occurrence_start.date() > limit) {
            break;
        }
        if occurrence_start.date() > end_date {
            break;
        }
        if occurrence_start.date() >= monday {
            let occurrence_end = occurrence_start + duration;
            let start_local = occurrence_start.format("%Y-%m-%dT%H:%M:%S").to_string();
            let end_local = occurrence_end.format("%Y-%m-%dT%H:%M:%S").to_string();
            let key = Uuid::new_v5(
                &Uuid::NAMESPACE_URL,
                format!("{source}|{uid}|{start_local}").as_bytes(),
            )
            .to_string();
            output.push(ImportedEvent {
                key,
                draft: EventDraft {
                    title: title.to_string(),
                    description: description.clone(),
                    location: location.clone(),
                    category: "event".into(),
                    start_local,
                    end_local,
                    timezone: timezone.to_string(),
                    all_day,
                    rrule: None,
                    color: "#4adbc8".into(),
                },
            });
        }
        occurrence_index += 1;
        if rrule.is_empty() {
            break;
        }
        occurrence_start += Duration::days(i64::from(interval) * 7);
        if occurrence_index > MAX_OCCURRENCES {
            return Err("ICS 重复规则展开过多".into());
        }
    }
    Ok(output)
}

fn parse_weekly_rule(rule: &str) -> Result<(u8, Option<usize>, Option<NaiveDate>), String> {
    if rule.is_empty() {
        return Ok((1, Some(1), None));
    }
    let mut values = HashMap::new();
    for part in rule.split(';') {
        if let Some((key, value)) = part.split_once('=') {
            values.insert(key.to_ascii_uppercase(), value.to_string());
        }
    }
    if values
        .keys()
        .any(|key| !matches!(key.as_str(), "FREQ" | "INTERVAL" | "COUNT" | "UNTIL"))
        || values.get("FREQ").map(String::as_str) != Some("WEEKLY")
    {
        return Err(
            "ICS 课程目前支持每周重复；请先在日历中导出每个上课时段，或移除不支持的 RRULE 选项"
                .into(),
        );
    }
    let interval = values
        .get("INTERVAL")
        .map(|value| value.parse::<u8>())
        .transpose()
        .map_err(|_| "ICS RRULE INTERVAL 无效")?
        .unwrap_or(1);
    if !(1..=4).contains(&interval) {
        return Err("ICS 每周重复间隔只支持 1–4 周".into());
    }
    let count = values
        .get("COUNT")
        .map(|value| value.parse::<usize>())
        .transpose()
        .map_err(|_| "ICS RRULE COUNT 无效")?;
    let until = values
        .get("UNTIL")
        .map(|value| {
            let date = value.get(..8).unwrap_or(value);
            NaiveDate::parse_from_str(date, "%Y%m%d").map_err(|_| "ICS RRULE UNTIL 日期无效")
        })
        .transpose()?;
    Ok((interval, count, until))
}

fn parse_datetime(value: &str, tz: Tz) -> Result<NaiveDateTime, String> {
    if value.ends_with('Z') {
        let utc = NaiveDateTime::parse_from_str(value.trim_end_matches('Z'), "%Y%m%dT%H%M%S")
            .map_err(|_| "ICS UTC 时间格式无效")?
            .and_utc();
        return Ok(utc.with_timezone(&tz).naive_local());
    }
    if value.len() == 8 {
        let date = NaiveDate::parse_from_str(value, "%Y%m%d").map_err(|_| "ICS 日期格式无效")?;
        return Ok(date.and_time(NaiveTime::MIN));
    }
    NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%S")
        .map_err(|_| "ICS 本地日期时间格式无效".into())
}

fn unescape_text(value: &str) -> String {
    value
        .replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

fn clean_source_name(value: &str) -> Result<String, String> {
    let name = value.rsplit(['/', '\\']).next().unwrap_or(value).trim();
    if name.is_empty() || name.len() > 200 {
        return Err("ICS 文件名无效".into());
    }
    Ok(name.to_string())
}

fn db_error(error: rusqlite::Error) -> String {
    format!("本地数据库错误：{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SAMPLE: &str = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:math-1\r\nDTSTART;TZID=Asia/Shanghai:20260907T080000\r\nDTEND;TZID=Asia/Shanghai:20260907T084500\r\nRRULE:FREQ=WEEKLY;COUNT=5\r\nSUMMARY:高等数学\r\nLOCATION:闵行 A101\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[test]
    fn previews_and_expands_term_mapped_weekly_ics_without_claiming_remote_sync() {
        let preview = preview(SAMPLE, "courses.ics", "2026-09-07", 16).unwrap();
        assert_eq!(preview.event_count, 5);
        assert_eq!(preview.preview[0].title, "高等数学");
        assert_eq!(preview.preview[4].start_local, "2026-10-05T08:00:00");
    }

    #[test]
    fn rejects_complex_recurrence_rules_instead_of_silently_dropping_days() {
        assert!(parse_weekly_rule("FREQ=WEEKLY;BYDAY=MO,WE").is_err());
        assert!(parse_weekly_rule("FREQ=DAILY;COUNT=8").is_err());
    }

    #[test]
    fn importing_same_source_twice_is_idempotent_and_replacement_removes_old_rows() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("calendar.sqlite3");
        crate::db::initialize_database(&path).unwrap();
        apply(&path, SAMPLE, "courses.ics", "2026-09-07", 16, true).unwrap();
        apply(&path, SAMPLE, "courses.ics", "2026-09-07", 16, true).unwrap();
        let connection = Connection::open(&path).unwrap();
        let (active, total): (i64, i64) = connection.query_row(
            "SELECT SUM(deleted_at IS NULL),COUNT(*) FROM personal_events WHERE import_source='courses.ics'", [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!((active, total), (5, 10));
    }
}

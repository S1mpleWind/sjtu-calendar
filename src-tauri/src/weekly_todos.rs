use chrono::{Datelike, Duration, NaiveDate, Utc};
use chrono_tz::Tz;
use rusqlite::{Connection, Transaction, TransactionBehavior, params};
use serde::Serialize;
use std::path::Path;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyTodo {
    id: String,
    title: String,
    details: String,
    completed: bool,
    carried_from_week: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoWeek {
    week_start: String,
    items: Vec<WeeklyTodo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyTodoList {
    current_week: String,
    weeks: Vec<TodoWeek>,
}

fn db_error(error: rusqlite::Error) -> String {
    format!("每周 Todo 数据库错误：{error}")
}

fn connect(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(db_error)?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(db_error)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(db_error)?;
    Ok(connection)
}

fn current_week(timezone: &str) -> Result<NaiveDate, String> {
    let zone: Tz = timezone.parse().map_err(|_| "显示时区无效".to_string())?;
    let today = Utc::now().with_timezone(&zone).date_naive();
    Ok(today - Duration::days(i64::from(today.weekday().num_days_from_monday())))
}

// Every created week is an immutable rollover boundary: copying runs only once.
// Later edits of historical items intentionally affect only that week's snapshot.
fn roll_forward(transaction: &Transaction<'_>, current: NaiveDate) -> Result<(), String> {
    let key = current.to_string();
    let last: Option<String> = transaction
        .query_row(
            "SELECT MAX(week_start) FROM weekly_todo_weeks WHERE week_start<=?1",
            [&key],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    let Some(last) = last else {
        transaction
            .execute(
                "INSERT INTO weekly_todo_weeks(week_start) VALUES(?1)",
                [&key],
            )
            .map_err(db_error)?;
        return Ok(());
    };
    let mut previous =
        NaiveDate::parse_from_str(&last, "%Y-%m-%d").map_err(|_| "历史周日期无效".to_string())?;
    let now = Utc::now().to_rfc3339();
    while previous < current {
        let next = previous + Duration::weeks(1);
        let inserted = transaction
            .execute(
                "INSERT OR IGNORE INTO weekly_todo_weeks(week_start) VALUES(?1)",
                [next.to_string()],
            )
            .map_err(db_error)?;
        if inserted > 0 {
            transaction.execute(
                "INSERT INTO weekly_todos(id,week_start,lineage_id,title,details,completed,carried_from_week,created_at,updated_at)
                 SELECT lower(hex(randomblob(16))),?1,lineage_id,title,details,0,?2,?3,?3
                 FROM weekly_todos WHERE week_start=?2 AND completed=0
                 ON CONFLICT(week_start,lineage_id) DO NOTHING",
                params![next.to_string(), previous.to_string(), now],
            ).map_err(db_error)?;
        }
        previous = next;
    }
    Ok(())
}

pub fn list(path: &Path, timezone: &str) -> Result<WeeklyTodoList, String> {
    let current = current_week(timezone)?;
    let mut connection = connect(path)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    roll_forward(&transaction, current)?;
    let mut weeks_query = transaction.prepare("SELECT week_start FROM weekly_todo_weeks WHERE week_start<=?1 ORDER BY week_start DESC").map_err(db_error)?;
    let week_keys = weeks_query
        .query_map([current.to_string()], |row| row.get::<_, String>(0))
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    drop(weeks_query);
    let mut weeks = Vec::new();
    for week_start in week_keys {
        let mut query = transaction.prepare("SELECT id,title,details,completed,carried_from_week FROM weekly_todos WHERE week_start=?1 ORDER BY completed DESC,created_at,id").map_err(db_error)?;
        let items = query
            .query_map([&week_start], |row| {
                Ok(WeeklyTodo {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    details: row.get(2)?,
                    completed: row.get(3)?,
                    carried_from_week: row.get(4)?,
                })
            })
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;
        weeks.push(TodoWeek { week_start, items });
    }
    transaction.commit().map_err(db_error)?;
    Ok(WeeklyTodoList {
        current_week: current.to_string(),
        weeks,
    })
}

fn validate(title: &str, details: &str) -> Result<(), String> {
    if title.trim().is_empty() || title.trim().chars().count() > 200 {
        return Err("任务标题需为 1–200 字".into());
    }
    if details.chars().count() > 10000 {
        return Err("任务详情不能超过 10000 字".into());
    }
    Ok(())
}

pub fn create(
    path: &Path,
    timezone: &str,
    week_start: &str,
    title: &str,
    details: &str,
) -> Result<(), String> {
    validate(title, details)?;
    let current = current_week(timezone)?;
    let week =
        NaiveDate::parse_from_str(week_start, "%Y-%m-%d").map_err(|_| "周日期无效".to_string())?;
    if week.to_string() != week_start
        || week.weekday().num_days_from_monday() != 0
        || week > current
    {
        return Err("请选择已有的本周或历史周".into());
    }
    let mut connection = connect(path)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    roll_forward(&transaction, current)?;
    let exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM weekly_todo_weeks WHERE week_start=?1)",
            [week_start],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if !exists {
        return Err("该周不存在，请刷新清单".into());
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    transaction.execute("INSERT INTO weekly_todos(id,week_start,lineage_id,title,details,created_at,updated_at) VALUES(?1,?2,?1,?3,?4,?5,?5)", params![id, week_start, title.trim(), details, now]).map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    Ok(())
}

pub fn update(
    path: &Path,
    timezone: &str,
    id: &str,
    title: Option<&str>,
    details: Option<&str>,
    completed: Option<bool>,
) -> Result<(), String> {
    validate(title.unwrap_or("未修改标题"), details.unwrap_or(""))?;
    let current = current_week(timezone)?;
    let mut connection = connect(path)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    roll_forward(&transaction, current)?;
    let changed = transaction.execute("UPDATE weekly_todos SET title=COALESCE(?1,title),details=COALESCE(?2,details),completed=COALESCE(?3,completed),updated_at=?4 WHERE id=?5 AND week_start<=?6", params![title.map(str::trim), details, completed, Utc::now().to_rfc3339(), id, current.to_string()]).map_err(db_error)?;
    if changed == 0 {
        return Err("该任务不存在，请刷新后重试".into());
    }
    transaction.commit().map_err(db_error)?;
    Ok(())
}

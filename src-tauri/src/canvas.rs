use chrono::{DateTime, Utc};
use keyring::Entry;
use reqwest::{Client, StatusCode, Url, header, redirect::Policy};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use std::{path::Path, str::FromStr, time::Duration};

const SERVICE: &str = "edu.sjtu.schedule.canvas";
const INSTANCE_SETTING: &str = "canvas.instance_url";
const USER_SETTING: &str = "canvas.active_user_id";
const REVISION_SETTING: &str = "canvas.credential_revision";
const PAGE_LIMIT: usize = 200;
const ITEM_LIMIT: usize = 20_000;
const COURSE_LIMIT: usize = 250;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasConnectionStatus {
    pub configured: bool,
    pub instance_url: Option<String>,
    pub account_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasProfile {
    pub user_id: String,
    pub name: String,
    pub instance_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasSyncResult {
    pub state: String,
    pub course_count: usize,
    pub assignment_count: usize,
    pub failed_courses: Vec<String>,
    pub synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDeadline {
    pub instance_url: String,
    pub user_id: String,
    pub course_id: String,
    pub assignment_id: String,
    pub course_name: String,
    pub title: String,
    pub description: String,
    pub due_at: String,
    pub lock_at: Option<String>,
    pub html_url: String,
    pub workflow_state: Option<String>,
    pub submitted_at: Option<String>,
    pub grade: Option<String>,
    pub local_completed: bool,
}

#[derive(Debug, Clone)]
struct CanvasClient {
    http: Client,
    base: Url,
}

#[derive(Debug, Deserialize)]
struct ProfileWire {
    id: String,
    #[serde(default)]
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CourseWire {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    course_code: String,
    #[serde(default)]
    term: Option<TermWire>,
    #[serde(default)]
    workflow_state: String,
}

#[derive(Debug, Clone, Deserialize)]
struct TermWire {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AssignmentWire {
    id: String,
    course_id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    due_at: Option<String>,
    #[serde(default)]
    lock_at: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    submission: Option<SubmissionWire>,
}

#[derive(Debug, Deserialize)]
struct SubmissionWire {
    #[serde(default)]
    workflow_state: Option<String>,
    #[serde(default)]
    submitted_at: Option<String>,
    #[serde(default)]
    grade: Option<String>,
}

impl CanvasClient {
    fn new(instance: &str) -> Result<Self, String> {
        let base = validate_instance(instance)?;
        let http = Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(8))
            .redirect(Policy::none())
            .build()
            .map_err(|_| "Could not initialize the secure Canvas HTTP client".to_string())?;
        Ok(Self { http, base })
    }

    #[cfg(test)]
    fn test_client(instance: &str) -> Self {
        Self {
            http: Client::builder()
                .timeout(Duration::from_secs(3))
                .redirect(Policy::none())
                .build()
                .unwrap(),
            base: Url::parse(instance).unwrap(),
        }
    }

    fn endpoint(&self, path: &str) -> Result<Url, String> {
        self.base
            .join(path)
            .map_err(|_| "Invalid Canvas API URL".to_string())
    }

    fn ensure_same_origin(&self, url: &Url) -> Result<(), String> {
        let secure_scheme = url.scheme() == "https";
        #[cfg(test)]
        let secure_scheme = secure_scheme || self.base.scheme() == "http";
        if !secure_scheme || url.origin() != self.base.origin() {
            return Err(
                "Canvas pagination link left the configured HTTPS instance; sync stopped".into(),
            );
        }
        Ok(())
    }

    async fn request(&self, url: Url, token: &str) -> Result<reqwest::Response, String> {
        self.ensure_same_origin(&url)?;
        let response = self
            .http
            .get(url)
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::ACCEPT, "application/json+canvas-string-ids")
            .send()
            .await
            .map_err(|_| "Canvas request failed due to a network or TLS error".to_string())?;
        if !response.status().is_success() {
            return Err(status_message(response.status()));
        }
        Ok(response)
    }

    async fn get_json<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        token: &str,
    ) -> Result<T, String> {
        let response = self.request(self.endpoint(path)?, token).await?;
        response
            .json()
            .await
            .map_err(|_| "Canvas returned an invalid JSON response".to_string())
    }

    async fn get_all<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        token: &str,
    ) -> Result<Vec<T>, String> {
        let mut url = self.endpoint(path)?;
        let mut items = Vec::new();
        for _page in 0..PAGE_LIMIT {
            let response = self.request(url.clone(), token).await?;
            let next = next_link(response.headers(), &self.base)?;
            let mut page_items: Vec<T> = response
                .json()
                .await
                .map_err(|_| "Canvas returned an invalid JSON page".to_string())?;
            if page_items.is_empty() {
                return Ok(items);
            }
            items.append(&mut page_items);
            if items.len() > ITEM_LIMIT {
                return Err("Canvas response exceeded the 20,000 item safety limit".into());
            }
            let Some(next_url) = next else {
                return Ok(items);
            };
            self.ensure_same_origin(&next_url)?;
            url = next_url;
        }
        Err("Canvas pagination exceeded the 200 page safety limit".into())
    }

    async fn verify(&self, token: &str) -> Result<CanvasProfile, String> {
        if token.trim().is_empty() {
            return Err("Canvas access token is empty".into());
        }
        let profile: ProfileWire = self.get_json("api/v1/users/self", token).await?;
        Ok(CanvasProfile {
            user_id: profile.id,
            name: profile.name,
            instance_url: self.base.as_str().trim_end_matches('/').to_string(),
        })
    }
}

fn status_message(status: StatusCode) -> String {
    match status {
        StatusCode::UNAUTHORIZED => {
            "Canvas rejected the access token (HTTP 401). Check the instance and token.".into()
        }
        StatusCode::FORBIDDEN => {
            "Canvas denied access (HTTP 403). The token or account lacks permission.".into()
        }
        StatusCode::TOO_MANY_REQUESTS => {
            "Canvas rate limited the request (HTTP 429). Wait briefly, then refresh again.".into()
        }
        _ => format!("Canvas returned HTTP {}.", status.as_u16()),
    }
}

fn validate_instance(value: &str) -> Result<Url, String> {
    let mut url =
        Url::parse(value.trim()).map_err(|_| "Choose a supported Canvas instance".to_string())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Canvas instance must be an HTTPS origin with no path or credentials".into());
    }
    match url.host_str() {
        Some("oc.sjtu.edu.cn") | Some("jicanvas.com") => {},
        _ => return Err("Only the two Canvas instances verified in the inspected reference source are supported".into()),
    }
    url.set_path("/");
    Ok(url)
}

fn next_link(headers: &header::HeaderMap, base: &Url) -> Result<Option<Url>, String> {
    let Some(value) = headers.get(header::LINK) else {
        return Ok(None);
    };
    let value = value
        .to_str()
        .map_err(|_| "Canvas returned an invalid Link header".to_string())?;
    for link in value.split(',') {
        let mut fields = link.trim().split(';');
        let target = fields.next().unwrap_or_default().trim();
        let is_next = fields.any(|field| {
            field
                .trim()
                .split('=')
                .nth(1)
                .is_some_and(|rel| rel.trim().trim_matches('"') == "next")
        });
        if is_next {
            let target = target
                .strip_prefix('<')
                .and_then(|part| part.strip_suffix('>'))
                .ok_or("Canvas returned a malformed next-page URL")?;
            return base
                .join(target)
                .map(Some)
                .map_err(|_| "Canvas returned a malformed next-page URL".into());
        }
    }
    Ok(None)
}

fn keyring_entry(instance: &str) -> Result<Entry, String> {
    let host = validate_instance(instance)?
        .host_str()
        .unwrap_or_default()
        .to_string();
    Entry::new(SERVICE, &host).map_err(|_| "Windows Credential Manager is unavailable".into())
}

pub fn connection_status(path: &Path) -> Result<CanvasConnectionStatus, String> {
    let instance_url = get_instance(path)?;
    let configured = if let Some(instance) = &instance_url {
        keyring_entry(instance)
            .and_then(|entry| {
                entry
                    .get_password()
                    .map(|_| ())
                    .map_err(|_| "No credential".into())
            })
            .is_ok()
    } else {
        false
    };
    Ok(CanvasConnectionStatus {
        configured,
        instance_url,
        account_verified: read_setting(&Connection::open(path).map_err(db_error)?, USER_SETTING)?
            .is_some(),
    })
}

fn get_instance(path: &Path) -> Result<Option<String>, String> {
    let connection = Connection::open(path).map_err(db_error)?;
    connection
        .query_row(
            "SELECT value_json FROM app_settings WHERE key=?1",
            [INSTANCE_SETTING],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(db_error)?
        .map(|json| {
            serde_json::from_str(&json)
                .map_err(|_| "Stored Canvas instance setting is invalid".into())
        })
        .transpose()
}

pub fn save_credentials(path: &Path, instance: &str, token: &str) -> Result<(), String> {
    let normalized = validate_instance(instance)?
        .as_str()
        .trim_end_matches('/')
        .to_string();
    if token.trim().is_empty() || token.len() > 4096 {
        return Err("Enter a valid Canvas access token".into());
    }
    let entry = keyring_entry(&normalized)?;
    entry
        .set_password(token.trim())
        .map_err(|_| "Could not save the token to Windows Credential Manager".to_string())?;
    let mut connection = Connection::open(path).map_err(db_error)?;
    let transaction = connection.transaction().map_err(db_error)?;
    write_setting(&transaction, INSTANCE_SETTING, &normalized)?;
    reset_account(&transaction)?;
    transaction.commit().map_err(db_error)?;
    Ok(())
}

pub fn clear_credentials(path: &Path) -> Result<(), String> {
    if let Some(instance) = get_instance(path)? {
        let entry = keyring_entry(&instance)?;
        match entry.get_password() {
            Ok(_) => entry.delete_credential().map_err(|_| {
                "Could not remove the Canvas token from Windows Credential Manager".to_string()
            })?,
            Err(_) => (),
        }
    }
    let mut connection = Connection::open(path).map_err(db_error)?;
    let transaction = connection.transaction().map_err(db_error)?;
    transaction
        .execute("DELETE FROM app_settings WHERE key=?1", [INSTANCE_SETTING])
        .map_err(db_error)?;
    reset_account(&transaction)?;
    transaction.commit().map_err(db_error)?;
    Ok(())
}

fn load_token(instance: &str) -> Result<String, String> {
    keyring_entry(instance)?
        .get_password()
        .map_err(|_| "No Canvas token is stored in Windows Credential Manager".into())
}

pub async fn test_connection(path: &Path) -> Result<CanvasProfile, String> {
    let instance = get_instance(path)?.ok_or("Configure a Canvas instance first")?;
    let revision = read_setting(&Connection::open(path).map_err(db_error)?, REVISION_SETTING)?
        .unwrap_or_default();
    let token = load_token(&instance)?;
    let profile = CanvasClient::new(&instance)?.verify(&token).await?;
    let mut connection = Connection::open(path).map_err(db_error)?;
    let transaction = connection.transaction().map_err(db_error)?;
    check_session(&transaction, &instance, &revision)?;
    write_setting(&transaction, USER_SETTING, &profile.user_id)?;
    transaction.commit().map_err(db_error)?;
    Ok(profile)
}

fn read_setting(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    let value: Option<String> = connection
        .query_row(
            "SELECT value_json FROM app_settings WHERE key=?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    value
        .map(|json| {
            serde_json::from_str(&json).map_err(|_| "Invalid Canvas account setting".to_string())
        })
        .transpose()
}

fn write_setting(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
    connection.execute("INSERT INTO app_settings(key,value_json) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", params![key, serde_json::to_string(value).map_err(|_| "Invalid Canvas setting".to_string())?]).map_err(db_error)?;
    Ok(())
}

fn reset_account(connection: &Connection) -> Result<(), String> {
    connection
        .execute("DELETE FROM app_settings WHERE key=?1", [USER_SETTING])
        .map_err(db_error)?;
    write_setting(
        connection,
        REVISION_SETTING,
        &uuid::Uuid::new_v4().to_string(),
    )
}

pub fn invalidate_cached_identity(path: &Path) -> Result<(), String> {
    let mut connection = Connection::open(path).map_err(db_error)?;
    let transaction = connection.transaction().map_err(db_error)?;
    reset_account(&transaction)?;
    transaction.commit().map_err(db_error)
}

fn check_session(connection: &Connection, instance: &str, revision: &str) -> Result<(), String> {
    if read_setting(connection, INSTANCE_SETTING)?.as_deref() != Some(instance)
        || read_setting(connection, REVISION_SETTING)?.unwrap_or_default() != revision
    {
        return Err("Canvas 账户配置已变更，请重新测试连接或同步".into());
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct AssignmentRow {
    course_id: String,
    assignment_id: String,
    course_name: String,
    name: String,
    description: String,
    due_at: Option<String>,
    lock_at: Option<String>,
    html_url: String,
    workflow_state: Option<String>,
    submitted_at: Option<String>,
    grade: Option<String>,
    remote_updated_at: Option<String>,
}

fn assignment_row(course: &CourseWire, assignment: AssignmentWire, base: &Url) -> AssignmentRow {
    let submission = assignment.submission;
    let html_url = assignment
        .html_url
        .and_then(|value| Url::parse(&value).ok())
        .filter(|url| url.origin() == base.origin() && url.scheme() == "https")
        .map(|url| url.to_string())
        .unwrap_or_else(|| {
            base.join(&format!(
                "courses/{}/assignments/{}",
                course.id, assignment.id
            ))
            .map(|url| url.to_string())
            .unwrap_or_default()
        });
    AssignmentRow {
        course_id: course.id.clone(),
        assignment_id: assignment.id,
        course_name: course.name.clone(),
        name: assignment.name,
        description: assignment.description.unwrap_or_default(),
        due_at: assignment.due_at,
        lock_at: assignment.lock_at,
        html_url,
        workflow_state: submission
            .as_ref()
            .and_then(|row| row.workflow_state.clone()),
        submitted_at: submission.as_ref().and_then(|row| row.submitted_at.clone()),
        grade: submission.and_then(|row| row.grade),
        remote_updated_at: assignment.updated_at,
    }
}

pub async fn sync(path: &Path) -> Result<CanvasSyncResult, String> {
    let instance = get_instance(path)?.ok_or("Configure a Canvas instance first")?;
    let revision = read_setting(&Connection::open(path).map_err(db_error)?, REVISION_SETTING)?
        .unwrap_or_default();
    let token = load_token(&instance)?;
    let client = CanvasClient::new(&instance)?;
    let profile = client.verify(&token).await?;
    let courses: Vec<CourseWire> = client.get_all("api/v1/courses?include%5B%5D=teachers&include%5B%5D=term&enrollment_state=active&per_page=100", &token).await?;
    if courses.len() > COURSE_LIMIT {
        return Err("Canvas returned more than 250 courses; sync was stopped safely".into());
    }
    let mut assignments = Vec::new();
    let mut failed_courses = Vec::new();
    for course in &courses {
        if !valid_canvas_id(&course.id) {
            failed_courses.push(course.name.clone());
            continue;
        }
        let path = format!(
            "api/v1/courses/{}/assignments?include%5B%5D=submission&include%5B%5D=overrides&include%5B%5D=all_dates&per_page=100",
            course.id
        );
        match client.get_all::<AssignmentWire>(&path, &token).await {
            Ok(items) => {
                for assignment in items {
                    if assignment.course_id != course.id || !valid_canvas_id(&assignment.id) {
                        failed_courses.push(course.name.clone());
                        continue;
                    }
                    assignments.push(assignment_row(course, assignment, &client.base));
                }
            }
            Err(_) => failed_courses.push(course.name.clone()),
        }
    }
    if assignments.len() > ITEM_LIMIT {
        return Err("Canvas returned more than 20,000 assignments; sync was stopped safely".into());
    }
    let sync_state = if failed_courses.is_empty() {
        "succeeded"
    } else {
        "partial"
    };
    apply_sync(
        path,
        &instance,
        &profile,
        &courses,
        &assignments,
        sync_state,
        &failed_courses,
        &revision,
    )
}

fn valid_canvas_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 32 && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn apply_sync(
    path: &Path,
    instance: &str,
    profile: &CanvasProfile,
    courses: &[CourseWire],
    assignments: &[AssignmentRow],
    state: &str,
    failed_courses: &[String],
    revision: &str,
) -> Result<CanvasSyncResult, String> {
    let mut connection = Connection::open(path).map_err(db_error)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(db_error)?;
    let transaction = connection.transaction().map_err(db_error)?;
    apply_sync_transaction(
        transaction,
        instance,
        profile,
        courses,
        assignments,
        state,
        failed_courses,
        revision,
    )
}

fn apply_sync_transaction(
    transaction: Transaction<'_>,
    instance: &str,
    profile: &CanvasProfile,
    courses: &[CourseWire],
    assignments: &[AssignmentRow],
    state: &str,
    failed_courses: &[String],
    revision: &str,
) -> Result<CanvasSyncResult, String> {
    check_session(&transaction, instance, revision)?;
    let synced_at = Utc::now().to_rfc3339();
    if state == "succeeded" {
        transaction
            .execute(
                "UPDATE canvas_courses SET archived=1 WHERE instance_url=?1 AND user_id=?2",
                params![instance, profile.user_id],
            )
            .map_err(db_error)?;
        transaction
            .execute(
                "UPDATE canvas_assignments SET archived=1 WHERE instance_url=?1 AND user_id=?2",
                params![instance, profile.user_id],
            )
            .map_err(db_error)?;
    }
    for course in courses {
        transaction.execute("INSERT INTO canvas_courses(instance_url,user_id,course_id,name,course_code,term_name,workflow_state,archived,synced_at) VALUES(?1,?2,?3,?4,?5,?6,?7,0,?8) ON CONFLICT(instance_url,user_id,course_id) DO UPDATE SET name=excluded.name,course_code=excluded.course_code,term_name=excluded.term_name,workflow_state=excluded.workflow_state,archived=0,synced_at=excluded.synced_at", params![instance, profile.user_id, course.id, course.name, course.course_code, course.term.as_ref().and_then(|term| term.name.clone()), course.workflow_state, synced_at]).map_err(db_error)?;
    }
    for assignment in assignments {
        transaction.execute("INSERT INTO canvas_assignments(instance_url,user_id,course_id,assignment_id,course_name,name,description,due_at,lock_at,html_url,workflow_state,submitted_at,remote_grade,remote_updated_at,local_completed,archived,synced_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,0,0,?15) ON CONFLICT(instance_url,user_id,course_id,assignment_id) DO UPDATE SET course_name=excluded.course_name,name=excluded.name,description=excluded.description,due_at=excluded.due_at,lock_at=excluded.lock_at,html_url=excluded.html_url,workflow_state=excluded.workflow_state,submitted_at=excluded.submitted_at,remote_grade=excluded.remote_grade,remote_updated_at=excluded.remote_updated_at,archived=0,synced_at=excluded.synced_at", params![instance, profile.user_id, assignment.course_id, assignment.assignment_id, assignment.course_name, assignment.name, assignment.description, assignment.due_at, assignment.lock_at, assignment.html_url, assignment.workflow_state, assignment.submitted_at, assignment.grade, assignment.remote_updated_at, synced_at]).map_err(db_error)?;
    }
    let error_summary = if failed_courses.is_empty() {
        None
    } else {
        Some(format!(
            "{} course assignment request(s) failed",
            failed_courses.len()
        ))
    };
    transaction.execute("INSERT INTO canvas_sync_state(instance_url,user_id,state,last_sync_at,last_success_at,course_count,assignment_count,error_summary) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(instance_url,user_id) DO UPDATE SET state=excluded.state,last_sync_at=excluded.last_sync_at,last_success_at=CASE WHEN excluded.state='succeeded' THEN excluded.last_sync_at ELSE canvas_sync_state.last_success_at END,course_count=excluded.course_count,assignment_count=excluded.assignment_count,error_summary=excluded.error_summary", params![instance, profile.user_id, state, synced_at, if state == "succeeded" { Some(synced_at.as_str()) } else { None }, courses.len() as i64, assignments.len() as i64, error_summary]).map_err(db_error)?;
    write_setting(&transaction, USER_SETTING, &profile.user_id)?;
    transaction.commit().map_err(db_error)?;
    Ok(CanvasSyncResult {
        state: state.to_string(),
        course_count: courses.len(),
        assignment_count: assignments.len(),
        failed_courses: failed_courses.to_vec(),
        synced_at,
    })
}

pub fn last_success(path: &Path) -> Result<Option<String>, String> {
    let Some(instance) = get_instance(path)? else {
        return Ok(None);
    };
    let connection = Connection::open(path).map_err(db_error)?;
    let Some(user_id) = read_setting(&connection, USER_SETTING)? else {
        return Ok(None);
    };
    Ok(connection
        .query_row(
            "SELECT last_success_at FROM canvas_sync_state WHERE instance_url=?1 AND user_id=?2",
            params![instance, user_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(db_error)?
        .flatten())
}

pub fn deadlines(
    path: &Path,
    from_date: &str,
    to_date: &str,
    display_timezone: &str,
) -> Result<Vec<CanvasDeadline>, String> {
    let Some(instance) = get_instance(path)? else {
        return Ok(Vec::new());
    };
    let connection = Connection::open(path).map_err(db_error)?;
    let user_id = read_setting(&connection, USER_SETTING)?;
    let Some(user_id) = user_id else {
        return Ok(Vec::new());
    };
    query_deadlines(
        path,
        &instance,
        &user_id,
        from_date,
        to_date,
        display_timezone,
    )
}

pub fn set_local_completed(
    path: &Path,
    course_id: &str,
    assignment_id: &str,
    completed: bool,
) -> Result<(), String> {
    let instance = get_instance(path)?.ok_or("Configure a Canvas instance first")?;
    let connection = Connection::open(path).map_err(db_error)?;
    let user_id = read_setting(&connection, USER_SETTING)?.ok_or("No Canvas cache is available")?;
    let changed = connection.execute("UPDATE canvas_assignments SET local_completed=?5 WHERE instance_url=?1 AND user_id=?2 AND course_id=?3 AND assignment_id=?4 AND archived=0", params![instance,user_id,course_id,assignment_id,completed]).map_err(db_error)?;
    if changed == 0 {
        return Err("Canvas assignment was not found in the local cache".into());
    }
    Ok(())
}

fn query_deadlines(
    path: &Path,
    instance: &str,
    user_id: &str,
    from_date: &str,
    to_date: &str,
    display_timezone: &str,
) -> Result<Vec<CanvasDeadline>, String> {
    let connection = Connection::open(path).map_err(db_error)?;
    let mut statement = connection.prepare("SELECT instance_url,user_id,course_id,assignment_id,course_name,name,description,due_at,lock_at,html_url,workflow_state,submitted_at,remote_grade,local_completed FROM canvas_assignments WHERE instance_url=?1 AND user_id=?2 AND archived=0 AND due_at IS NOT NULL ORDER BY due_at").map_err(db_error)?;
    let rows = statement
        .query_map(params![instance, user_id], |row| {
            Ok(CanvasDeadline {
                instance_url: row.get(0)?,
                user_id: row.get(1)?,
                course_id: row.get(2)?,
                assignment_id: row.get(3)?,
                course_name: row.get(4)?,
                title: row.get(5)?,
                description: row.get(6)?,
                due_at: row.get(7)?,
                lock_at: row.get(8)?,
                html_url: row.get(9)?,
                workflow_state: row.get(10)?,
                submitted_at: row.get(11)?,
                grade: row.get(12)?,
                local_completed: row.get(13)?,
            })
        })
        .map_err(db_error)?;
    let from = chrono::NaiveDate::parse_from_str(from_date, "%Y-%m-%d")
        .map_err(|_| "Invalid fromDate".to_string())?;
    let to = chrono::NaiveDate::parse_from_str(to_date, "%Y-%m-%d")
        .map_err(|_| "Invalid toDate".to_string())?;
    let timezone = chrono_tz::Tz::from_str(display_timezone)
        .map_err(|_| "Invalid display timezone".to_string())?;
    let mut deadlines = Vec::new();
    for row in rows {
        let deadline = row.map_err(db_error)?;
        let due = DateTime::parse_from_rfc3339(&deadline.due_at)
            .map_err(|_| "Canvas returned a deadline with an invalid timestamp".to_string())?;
        let local_date = due.with_timezone(&timezone).date_naive();
        if local_date >= from && local_date <= to {
            deadlines.push(deadline);
        }
    }
    Ok(deadlines)
}

fn db_error(error: rusqlite::Error) -> String {
    format!("Local database error: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    use tempfile::TempDir;

    #[test]
    fn validates_only_verified_https_instances() {
        assert!(validate_instance("https://oc.sjtu.edu.cn").is_ok());
        assert!(validate_instance("https://jicanvas.com/").is_ok());
        assert!(validate_instance("http://oc.sjtu.edu.cn").is_err());
        assert!(validate_instance("https://oc.sjtu.edu.cn.evil.invalid").is_err());
        assert!(validate_instance("https://oc.sjtu.edu.cn/path").is_err());
    }

    #[tokio::test]
    async fn follows_canvas_link_header_for_all_pages_and_sends_bearer_token() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            for (index, body) in [r#"[{"id":"1"}]"#, r#"[{"id":"2"}]"#].iter().enumerate() {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..length]).to_ascii_lowercase();
                assert!(request.contains("authorization: bearer test-token"));
                if index == 0 {
                    assert!(request.starts_with("get /api/v1/courses?page=1 "));
                } else {
                    assert!(request.starts_with("get /api/v1/courses?page=2 "));
                }
                let link = if index == 0 {
                    format!("Link: <http://{address}/api/v1/courses?page=2>; rel=\"next\"\r\n")
                } else {
                    String::new()
                };
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{link}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        let client = CanvasClient::test_client(&format!("http://{address}"));
        let rows: Vec<ProfileWire> = client
            .get_all("api/v1/courses?page=1", "test-token")
            .await
            .unwrap();
        server.join().unwrap();
        assert_eq!(
            rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            ["1", "2"]
        );
    }

    #[test]
    fn upsert_is_idempotent_preserves_local_completion_and_keeps_partial_cache() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("calendar.sqlite3");
        crate::db::initialize_database(&path).unwrap();
        let instance = "https://oc.sjtu.edu.cn";
        Connection::open(&path)
            .unwrap()
            .execute(
                "INSERT INTO app_settings(key,value_json) VALUES(?1,?2)",
                params![INSTANCE_SETTING, serde_json::to_string(instance).unwrap()],
            )
            .unwrap();
        let profile = CanvasProfile {
            user_id: "42".into(),
            name: "Test User".into(),
            instance_url: instance.into(),
        };
        let course = CourseWire {
            id: "7".into(),
            name: "Physics".into(),
            course_code: "PHYS".into(),
            term: Some(TermWire {
                name: Some("Fall".into()),
            }),
            workflow_state: "available".into(),
        };
        let assignment = |name: &str, due: &str, assignment_id: &str| AssignmentRow {
            course_id: "7".into(),
            assignment_id: assignment_id.into(),
            course_name: "Physics".into(),
            name: name.into(),
            description: String::new(),
            due_at: Some(due.into()),
            lock_at: None,
            html_url: "https://oc.sjtu.edu.cn/courses/7/assignments/9".into(),
            workflow_state: Some("unsubmitted".into()),
            submitted_at: None,
            grade: None,
            remote_updated_at: None,
        };
        apply_sync(
            &path,
            instance,
            &profile,
            &[course.clone()],
            &[
                assignment("Quiz", "2026-10-21T10:00:00Z", "9"),
                assignment("Old", "2026-10-22T10:00:00Z", "10"),
            ],
            "succeeded",
            &[],
            "",
        )
        .unwrap();
        set_local_completed(&path, "7", "9", true).unwrap();
        apply_sync(
            &path,
            instance,
            &profile,
            &[course],
            &[assignment("Quiz revised", "2026-10-23T10:00:00Z", "9")],
            "partial",
            &["Physics".into()],
            "",
        )
        .unwrap();
        let connection = Connection::open(&path).unwrap();
        let (count, name, due, completed, old_archived): (i64, String, String, bool, bool) = connection.query_row(
            "SELECT (SELECT COUNT(*) FROM canvas_assignments WHERE assignment_id='9'),name,due_at,local_completed,(SELECT archived FROM canvas_assignments WHERE assignment_id='10') FROM canvas_assignments WHERE assignment_id='9'", [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).unwrap();
        assert_eq!(
            (count, name.as_str(), due.as_str(), completed, old_archived),
            (1, "Quiz revised", "2026-10-23T10:00:00Z", true, false)
        );
    }

    #[test]
    fn cached_deadlines_are_available_without_network_credentials() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("calendar.sqlite3");
        crate::db::initialize_database(&path).unwrap();
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "INSERT INTO app_settings(key,value_json) VALUES(?1,?2)",
                params![
                    INSTANCE_SETTING,
                    serde_json::to_string("https://oc.sjtu.edu.cn").unwrap()
                ],
            )
            .unwrap();
        connection.execute("INSERT INTO canvas_sync_state(instance_url,user_id,state,last_sync_at,course_count,assignment_count) VALUES('https://oc.sjtu.edu.cn','42','succeeded','2026-10-20T00:00:00Z',1,1)", []).unwrap();
        connection.execute("INSERT INTO canvas_courses(instance_url,user_id,course_id,name,workflow_state,synced_at) VALUES('https://oc.sjtu.edu.cn','42','7','Physics','available','2026-10-20T00:00:00Z')", []).unwrap();
        connection.execute("INSERT INTO canvas_assignments(instance_url,user_id,course_id,assignment_id,course_name,name,due_at,synced_at) VALUES('https://oc.sjtu.edu.cn','42','7','9','Physics','Quiz','2026-10-21T10:00:00Z','2026-10-20T00:00:00Z')", []).unwrap();
        drop(connection);
        write_setting(&Connection::open(&path).unwrap(), USER_SETTING, "42").unwrap();
        let rows = deadlines(&path, "2026-10-21", "2026-10-21", "Asia/Shanghai").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Quiz");
        let connection = Connection::open(&path).unwrap();
        // Replacing credentials immediately hides the previous account's cache.
        reset_account(&connection).unwrap();
        assert!(
            deadlines(&path, "2026-10-21", "2026-10-21", "Asia/Shanghai")
                .unwrap()
                .is_empty()
        );
        assert!(set_local_completed(&path, "7", "9", true).is_err());
        // A request started before replacement cannot reactivate that account.
        let profile = CanvasProfile {
            user_id: "42".into(),
            name: "Old account".into(),
            instance_url: "https://oc.sjtu.edu.cn".into(),
        };
        assert!(
            apply_sync(
                &path,
                "https://oc.sjtu.edu.cn",
                &profile,
                &[],
                &[],
                "succeeded",
                &[],
                ""
            )
            .is_err()
        );
        // Explicit selection wins over last-sync timestamp, without a network call.
        connection.execute("INSERT INTO canvas_sync_state(instance_url,user_id,state,last_sync_at,course_count,assignment_count) VALUES('https://oc.sjtu.edu.cn','84','succeeded','2020-01-01T00:00:00Z',0,0)", []).unwrap();
        write_setting(&connection, USER_SETTING, "84").unwrap();
        assert!(
            deadlines(&path, "2026-10-21", "2026-10-21", "Asia/Shanghai")
                .unwrap()
                .is_empty()
        );
        write_setting(&connection, USER_SETTING, "42").unwrap();
        assert_eq!(
            deadlines(&path, "2026-10-21", "2026-10-21", "Asia/Shanghai")
                .unwrap()
                .len(),
            1
        );
    }
}

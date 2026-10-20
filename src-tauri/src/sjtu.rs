use chrono::{Datelike, NaiveDate, NaiveTime, TimeZone, Utc};
use keyring::Entry;
use regex::Regex;
use reqwest::{Client, StatusCode, Url, header};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeSet, path::Path, str::FromStr, time::Duration};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use uuid::Uuid;

const SERVICE: &str = "edu.sjtu.schedule.academic";
const UG_COOKIE_URL: &str = "https://i.sjtu.edu.cn/";
const GRAD_COOKIE_URL: &str = "https://yjs.sjtu.edu.cn/gsapp/";
const UG_COURSE_URL: &str = "https://i.sjtu.edu.cn/kbcx/xskbcx_cxXsKb.html";
const UG_REFERER: &str =
    "https://i.sjtu.edu.cn/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default";
const GRAD_COURSE_URL: &str = "https://yjs.sjtu.edu.cn/gsapp/sys/wdkbapp/modules/xskcb/xsjxrwcx.do";
const GRAD_REFERER: &str =
    "https://yjs.sjtu.edu.cn/gsapp/sys/wdkbapp/*default/index.do?THEME=indigo&EMAP_LANG=zh#/xskcb";
const PALETTE: [&str; 12] = [
    "#ff758f", "#9b9bff", "#4adbc8", "#ff9f46", "#a06cd5", "#ffb7b2", "#b5ead7", "#c7ceea",
    "#e2f0cb", "#ffdac1", "#ff9aa2", "#6eb5ff",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SjtuConnectionStatus {
    pub undergraduate_configured: bool,
    pub graduate_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SjtuSyncResult {
    pub source_system: String,
    pub state: String,
    pub course_count: usize,
    pub meeting_count: usize,
    pub skipped_rows: usize,
    pub synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SjtuCourseOccurrence {
    pub occurrence_id: String,
    pub meeting_id: String,
    pub course_id: String,
    pub term_id: String,
    pub source_system: String,
    pub title: String,
    pub teacher: String,
    pub location: String,
    pub start_utc: String,
    pub end_utc: String,
    pub timezone: String,
    pub color: String,
    pub week_number: i64,
    pub weekday: i64,
    pub start_section: i64,
    pub end_section: i64,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Meeting {
    weekday: u8,
    start_section: u8,
    end_section: u8,
    weeks: Vec<u8>,
    location: String,
    teacher: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Course {
    external_id: String,
    name: String,
    teacher: String,
    meetings: Vec<Meeting>,
}

#[derive(Debug, Clone)]
struct ParseResult {
    courses: Vec<Course>,
    skipped_rows: usize,
}

fn login_spec(
    system: &str,
) -> Result<(&'static str, &'static str, &'static str, &'static str), String> {
    match system {
        "undergraduate" => Ok((
            "ug",
            "https://i.sjtu.edu.cn/jaccountlogin",
            "本科教务登录",
            UG_COOKIE_URL,
        )),
        "graduate" => Ok((
            "grad",
            "https://yjs.sjtu.edu.cn/gsapp/sys/wdkbapp/*default/index.do?THEME=indigo&EMAP_LANG=zh#/xskcb",
            "研究生教务登录",
            GRAD_COOKIE_URL,
        )),
        _ => Err("请选择本科教务或研究生教务".into()),
    }
}

fn credential_entry(system: &str) -> Result<Entry, String> {
    let (account, _, _, _) = login_spec(system)?;
    Entry::new(SERVICE, account).map_err(|_| "Windows Credential Manager 不可用".to_string())
}

pub fn connection_status() -> SjtuConnectionStatus {
    let configured = |system| {
        credential_entry(system)
            .and_then(|entry| entry.get_password().map_err(|_| "No session".to_string()))
            .is_ok()
    };
    SjtuConnectionStatus {
        undergraduate_configured: configured("undergraduate"),
        graduate_configured: configured("graduate"),
    }
}

pub fn start_login(app: &AppHandle, system: &str) -> Result<(), String> {
    let (label, start_url, title, _) = login_spec(system)?;
    let label = format!("sjtu-login-{label}");
    if let Some(window) = app.get_webview_window(&label) {
        window
            .set_focus()
            .map_err(|error| format!("无法聚焦教务登录窗口：{error}"))?;
        return Ok(());
    }
    let url = Url::parse(start_url).map_err(|_| "教务登录地址配置无效".to_string())?;
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .incognito(true)
        .title(title)
        .inner_size(980.0, 720.0)
        .on_page_load(|_, _payload| {
            #[cfg(debug_assertions)]
            {
                let event = match _payload.event() {
                    tauri::webview::PageLoadEvent::Started => "started",
                    tauri::webview::PageLoadEvent::Finished => "finished",
                };
                let host = _payload.url().host_str().unwrap_or("unknown");
                eprintln!("SJTU login page {event}: {host}");
            }
        })
        .build()
        .map_err(|error| format!("无法打开教务登录窗口：{error}"))?;
    let cleanup_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let cleanup_window = cleanup_window.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = cleanup_window.clear_all_browsing_data();
                let _ = cleanup_window.destroy();
            });
        }
    });
    Ok(())
}

pub async fn finish_login(app: &AppHandle, system: &str) -> Result<(), String> {
    let (label, _, _, cookie_url) = login_spec(system)?;
    let label = format!("sjtu-login-{label}");
    let window = app
        .get_webview_window(&label)
        .ok_or("请先打开对应的教务登录窗口")?;
    let url = Url::parse(cookie_url).map_err(|_| "教务 Cookie 来源地址配置无效".to_string())?;
    let cookie_window = window.clone();
    let cookies = tauri::async_runtime::spawn_blocking(move || cookie_window.cookies_for_url(url))
        .await
        .map_err(|_| "读取教务登录状态失败".to_string())?
        .map_err(|_| "读取教务登录状态失败，请重试".to_string())?;
    let cookie_header = cookies
        .iter()
        .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
        .collect::<Vec<_>>()
        .join("; ");
    if cookie_header.trim().is_empty() {
        return Err("没有发现教务登录会话。请先在登录窗口完成交大统一身份认证。".into());
    }
    window
        .clear_all_browsing_data()
        .map_err(|_| "登录窗口的临时浏览数据无法清理，因此没有保存会话".to_string())?;
    let entry = credential_entry(system)?;
    entry
        .set_password(&cookie_header)
        .map_err(|_| "无法将登录会话安全保存到 Windows Credential Manager".to_string())?;
    let _ = window.destroy();
    Ok(())
}

pub fn clear_login(system: &str) -> Result<(), String> {
    let entry = credential_entry(system)?;
    if entry.get_password().is_ok() {
        entry
            .delete_credential()
            .map_err(|_| "无法从 Windows Credential Manager 移除教务会话".to_string())?;
    }
    Ok(())
}

fn load_cookie(system: &str) -> Result<String, String> {
    credential_entry(system)?
        .get_password()
        .map_err(|_| "请先在应用内完成教务登录".into())
}

fn make_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(45))
        .connect_timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化教务 HTTPS 客户端".into())
}

pub fn validate_term(
    system: &str,
    year: &str,
    term: &str,
    start_date: &str,
    week_count: u8,
) -> Result<String, String> {
    login_spec(system)?;
    let year_number: i32 = year
        .parse()
        .map_err(|_| "学年应填写四位数字，例如 2026".to_string())?;
    if !(2000..=2100).contains(&year_number)
        || !matches!(term, "1" | "2" | "3")
        || !(1..=24).contains(&week_count)
    {
        return Err("学年、学期或教学周数超出支持范围".into());
    }
    let monday = NaiveDate::parse_from_str(start_date, "%Y-%m-%d")
        .map_err(|_| "请输入有效的首周周一日期".to_string())?;
    if monday.weekday().number_from_monday() != 1 {
        return Err("首周日期必须是教学周的星期一".into());
    }
    Ok(format!("{system}-{year}-{term}"))
}

fn term_name(year: &str, term: &str) -> String {
    let suffix = match term {
        "1" => "秋季学期",
        "2" => "春季学期",
        _ => "夏季学期",
    };
    format!("{year}-{suffix}")
}

pub async fn sync(
    path: &Path,
    system: &str,
    year: &str,
    term: &str,
    start_date: &str,
    week_count: u8,
) -> Result<SjtuSyncResult, String> {
    let term_id = validate_term(system, year, term, start_date, week_count)?;
    let cookie = load_cookie(system)?;
    let client = make_client()?;
    let parsed = if system == "undergraduate" {
        fetch_undergraduate(&client, &cookie, year, term).await?
    } else {
        fetch_graduate(&client, &cookie, year, term).await?
    };
    if parsed.courses.is_empty() && parsed.skipped_rows == 0 {
        return Err("教务返回空课表；为避免误清除本地数据，本次没有应用同步结果".into());
    }
    let meeting_count = parsed
        .courses
        .iter()
        .map(|course| course.meetings.len())
        .sum::<usize>();
    let state = if parsed.skipped_rows > 0 {
        "partial"
    } else {
        "succeeded"
    };
    apply_sync(
        path,
        system,
        year,
        term,
        start_date,
        week_count,
        &term_id,
        &parsed,
        state,
        meeting_count,
    )
}

async fn fetch_undergraduate(
    client: &Client,
    cookie: &str,
    year: &str,
    term: &str,
) -> Result<ParseResult, String> {
    let xqm = match term {
        "1" => "3",
        "2" => "12",
        "3" => "16",
        _ => return Err("未知的本科教务学期".into()),
    };
    let response = client.post(UG_COURSE_URL).header(header::COOKIE, cookie).header(header::USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36").header(header::REFERER, UG_REFERER).form(&[("xnm", year), ("xqm", xqm)]).send().await.map_err(|_| "本科教务请求失败，请检查网络或重新登录".to_string())?;
    if response.status() == StatusCode::UNAUTHORIZED || response.status().is_redirection() {
        return Err("本科教务登录已失效，请重新登录".into());
    }
    if !response.status().is_success() {
        return Err(format!("本科教务返回 HTTP {}", response.status().as_u16()));
    }
    let body = response
        .bytes()
        .await
        .map_err(|_| "本科教务响应读取失败".to_string())?;
    if body.len() > 10 * 1024 * 1024 {
        return Err("本科教务响应超过安全大小限制".into());
    }
    let json: Value = serde_json::from_slice(&body)
        .map_err(|_| "本科教务返回的内容不是可识别的 JSON（可能需要重新登录）".to_string())?;
    let rows = json
        .get("kbList")
        .and_then(Value::as_array)
        .ok_or("本科教务响应缺少 kbList 课程列表")?;
    Ok(parse_undergraduate_rows(rows))
}

async fn fetch_graduate(
    client: &Client,
    cookie: &str,
    year: &str,
    term: &str,
) -> Result<ParseResult, String> {
    let year_number: i32 = year.parse().map_err(|_| "研究生学年无效".to_string())?;
    let xnxqdm = match term {
        "1" => format!("{year}09"),
        "2" => format!("{}02", year_number + 1),
        "3" => format!("{}06", year_number + 1),
        _ => return Err("未知的研究生教务学期".into()),
    };
    let url = format!("{GRAD_COURSE_URL}?_={}", Utc::now().timestamp_millis());
    let response = client.post(url).header(header::COOKIE, cookie).header(header::REFERER, GRAD_REFERER).header(header::ORIGIN, "https://yjs.sjtu.edu.cn").header(header::USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36").header(header::CONTENT_TYPE, "application/x-www-form-urlencoded").form(&[("XNXQDM", xnxqdm.as_str()), ("XH", ""), ("pageNumber", "1"), ("pageSize", "200")]).send().await.map_err(|_| "研究生教务请求失败，请检查网络或重新登录".to_string())?;
    if response.status() == StatusCode::UNAUTHORIZED || response.status().is_redirection() {
        return Err("研究生教务登录已失效，请重新登录".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "研究生教务返回 HTTP {}",
            response.status().as_u16()
        ));
    }
    let body = response
        .bytes()
        .await
        .map_err(|_| "研究生教务响应读取失败".to_string())?;
    if body.len() > 10 * 1024 * 1024 {
        return Err("研究生教务响应超过安全大小限制".into());
    }
    let json: Value = serde_json::from_slice(&body)
        .map_err(|_| "研究生教务返回的内容不是可识别的 JSON（可能需要重新登录）".to_string())?;
    let response_code = json.get("code").map(|value| {
        value
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| value.to_string())
    });
    if response_code.as_deref() != Some("0") {
        return Err("研究生教务没有确认登录状态，请重新登录后重试".into());
    }
    let rows = json
        .pointer("/datas/xsjxrwcx/rows")
        .and_then(Value::as_array)
        .ok_or("研究生教务响应缺少课程 rows")?;
    Ok(parse_graduate_rows(rows))
}

fn string_field(row: &Value, field: &str) -> String {
    row.get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            row.get(field)
                .and_then(Value::as_i64)
                .map(|value| value.to_string())
        })
        .unwrap_or_default()
}

fn parse_undergraduate_rows(rows: &[Value]) -> ParseResult {
    let mut courses: Vec<Course> = Vec::new();
    let mut skipped_rows = 0;
    for row in rows {
        let external_id = string_field(row, "kch_id");
        let external_id = if external_id.is_empty() {
            string_field(row, "kch")
        } else {
            external_id
        };
        let name = string_field(row, "kcmc");
        let teacher = string_field(row, "xm");
        let location = string_field(row, "cdmc");
        let weekday = string_field(row, "xqj")
            .parse::<u8>()
            .ok()
            .filter(|day| (1..=7).contains(day));
        let (start_section, end_section) = parse_section_range(&string_field(row, "jcs"));
        let weeks = parse_weeks(&string_field(row, "zcd"));
        let (Some(weekday), Some((start_section, end_section))) =
            (weekday, start_section.zip(end_section))
        else {
            skipped_rows += 1;
            continue;
        };
        if external_id.is_empty() || name.is_empty() || weeks.is_empty() {
            skipped_rows += 1;
            continue;
        }
        let course = ensure_course(&mut courses, &external_id, &name, &teacher);
        course.meetings.push(Meeting {
            weekday,
            start_section,
            end_section,
            weeks,
            location,
            teacher,
        });
    }
    deduplicate_meetings(&mut courses);
    ParseResult {
        courses,
        skipped_rows,
    }
}

fn parse_graduate_rows(rows: &[Value]) -> ParseResult {
    let mut courses: Vec<Course> = Vec::new();
    let mut skipped_rows = 0;
    let schedule_re = Regex::new(r"星期([一二三四五六日天])\s*\[(\d+)(?:-(\d+))?节\]").unwrap();
    for row in rows {
        let name = first_nonempty(&[string_field(row, "KCMC"), string_field(row, "KCMCYW")]);
        let teacher = first_nonempty(&[string_field(row, "RKJS"), string_field(row, "JSXM")]);
        let external_id = first_nonempty(&[
            string_field(row, "KCDM"),
            string_field(row, "BJDM"),
            name.clone(),
        ]);
        let schedule = first_nonempty(&[string_field(row, "PKSJDD"), string_field(row, "PKSJ")]);
        let default_location = first_nonempty(&[
            string_field(row, "PKDD"),
            string_field(row, "PKDD_DISPLAY"),
            string_field(row, "XQDM_DISPLAY"),
        ]);
        if name.is_empty() || external_id.is_empty() || schedule.is_empty() {
            skipped_rows += 1;
            continue;
        }
        let uses_zero_based = Regex::new(r"\[\s*0(?:-\d+)?节\]")
            .unwrap()
            .is_match(&schedule);
        let matches: Vec<_> = schedule_re.find_iter(&schedule).collect();
        if matches.is_empty() {
            skipped_rows += 1;
            continue;
        }
        let course = ensure_course(&mut courses, &external_id, &name, &teacher);
        for (index, found) in matches.iter().enumerate() {
            let captures = schedule_re.captures(found.as_str()).unwrap();
            let weekday = match captures.get(1).map(|value| value.as_str()) {
                Some("一") => 1,
                Some("二") => 2,
                Some("三") => 3,
                Some("四") => 4,
                Some("五") => 5,
                Some("六") => 6,
                Some("日" | "天") => 7,
                _ => {
                    skipped_rows += 1;
                    continue;
                }
            };
            let raw_start = captures
                .get(2)
                .and_then(|value| value.as_str().parse::<u8>().ok());
            let raw_end = captures
                .get(3)
                .and_then(|value| value.as_str().parse::<u8>().ok())
                .or(raw_start);
            let (Some(mut start), Some(mut end)) = (raw_start, raw_end) else {
                skipped_rows += 1;
                continue;
            };
            if uses_zero_based {
                start = start.saturating_add(1);
                end = end.saturating_add(1);
            }
            if start == 0 || end > 14 || end < start {
                skipped_rows += 1;
                continue;
            }
            let prefix = &schedule[..found.start()];
            let weeks_text = last_week_expression(prefix);
            let weeks = parse_weeks(weeks_text);
            if weeks.is_empty() {
                skipped_rows += 1;
                continue;
            }
            let location_end = matches
                .get(index + 1)
                .map(|next| next.start())
                .unwrap_or(schedule.len());
            let room_text = schedule[found.end()..location_end].trim_matches(|c: char| {
                c.is_whitespace() || matches!(c, ';' | '；' | ',' | '，' | '/')
            });
            let trailing_week_re = Regex::new(
                r"[;；,，]\s*[0-9,，、；;至~～\-单双周()（） ]+周(?:\s*[（(](?:单|双)[）)])?\s*$",
            )
            .unwrap();
            let room_text = trailing_week_re.replace(room_text, "");
            let leading_week_re =
                Regex::new(r"^[0-9,，、；;至~～\-单双周()（） ]+周(?:\s*[（(](?:单|双)[）)])?\s*")
                    .unwrap();
            let location = first_nonempty(&[
                leading_week_re
                    .replace(&room_text, "")
                    .trim_matches(|c: char| {
                        c.is_whitespace() || matches!(c, ';' | '；' | ',' | '，' | '/')
                    })
                    .to_string(),
                default_location.clone(),
            ]);
            course.meetings.push(Meeting {
                weekday,
                start_section: start,
                end_section: end,
                weeks,
                location,
                teacher: teacher.clone(),
            });
        }
    }
    deduplicate_meetings(&mut courses);
    ParseResult {
        courses,
        skipped_rows,
    }
}

fn first_nonempty(values: &[String]) -> String {
    values
        .iter()
        .find(|value| !value.is_empty())
        .cloned()
        .unwrap_or_default()
}
fn ensure_course<'a>(
    courses: &'a mut Vec<Course>,
    external_id: &str,
    name: &str,
    teacher: &str,
) -> &'a mut Course {
    if let Some(index) = courses
        .iter()
        .position(|course| course.external_id == external_id)
    {
        return &mut courses[index];
    }
    courses.push(Course {
        external_id: external_id.to_string(),
        name: name.to_string(),
        teacher: teacher.to_string(),
        meetings: Vec::new(),
    });
    courses.last_mut().unwrap()
}
fn deduplicate_meetings(courses: &mut [Course]) {
    for course in courses {
        let mut seen = BTreeSet::new();
        course.meetings.retain(|meeting| {
            seen.insert(format!(
                "{}|{}|{}|{:?}|{}|{}",
                meeting.weekday,
                meeting.start_section,
                meeting.end_section,
                meeting.weeks,
                meeting.location,
                meeting.teacher
            ))
        });
    }
}

fn parse_section_range(text: &str) -> (Option<u8>, Option<u8>) {
    let normalized: String = text
        .chars()
        .filter(|character| character.is_ascii_digit() || *character == '-')
        .collect();
    let mut parts = normalized.split('-');
    let start = parts
        .next()
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|value| (1..=14).contains(value));
    let end = parts
        .next()
        .and_then(|value| value.parse::<u8>().ok())
        .or(start)
        .filter(|value| (1..=14).contains(value));
    if end < start {
        return (None, None);
    }
    (start, end)
}

fn parse_weeks(text: &str) -> Vec<u8> {
    let normalized = text
        .replace('（', "(")
        .replace('）', ")")
        .replace('至', "-")
        .replace('～', "-")
        .replace('~', "-")
        .replace("单周", "(单)")
        .replace("双周", "(双)")
        .replace('周', "");
    let token_re = Regex::new(r"(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*(?:\((单|双)\))?").unwrap();
    let mut weeks = BTreeSet::new();
    for capture in token_re.captures_iter(&normalized) {
        let Some(start) = capture
            .get(1)
            .and_then(|value| value.as_str().parse::<u8>().ok())
        else {
            continue;
        };
        let end = capture
            .get(2)
            .and_then(|value| value.as_str().parse::<u8>().ok())
            .unwrap_or(start);
        if start == 0 || start > end || end > 24 {
            continue;
        }
        let parity = capture.get(3).map(|value| value.as_str());
        for week in start..=end {
            if parity == Some("单") && week % 2 == 0 || parity == Some("双") && week % 2 == 1 {
                continue;
            }
            weeks.insert(week);
        }
    }
    weeks.into_iter().collect()
}

fn last_week_expression(prefix: &str) -> &str {
    let segment = prefix.rsplit([';', '；']).next().unwrap_or(prefix);
    let week_re =
        Regex::new(r"[0-9,，、；;至~～\-单双周()（） ]+周(?:\s*[（(](?:单|双)[）)])?\s*$").unwrap();
    week_re
        .find(segment)
        .map(|matched| matched.as_str().trim())
        .unwrap_or("")
}

fn fingerprint(parts: &[&str]) -> String {
    parts.join("\u{1f}")
}
fn stable_id(key: &str) -> String {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, key.as_bytes()).to_string()
}
fn course_color(external_id: &str) -> &'static str {
    let hash = external_id.bytes().fold(2_166_136_261u32, |hash, byte| {
        (hash ^ byte as u32).wrapping_mul(16_777_619)
    });
    PALETTE[(hash as usize) % PALETTE.len()]
}

fn slot_time(section: u8, is_start: bool) -> Result<NaiveTime, String> {
    const STARTS: [&str; 14] = [
        "08:00", "08:55", "10:00", "10:55", "12:00", "12:55", "14:00", "14:55", "16:00", "16:55",
        "18:00", "18:55", "20:00", "20:55",
    ];
    const ENDS: [&str; 14] = [
        "08:45", "09:40", "10:45", "11:40", "12:45", "13:40", "14:45", "15:40", "16:45", "17:40",
        "18:45", "19:40", "20:45", "21:40",
    ];
    let value = if is_start {
        STARTS.get(section.saturating_sub(1) as usize)
    } else {
        ENDS.get(section.saturating_sub(1) as usize)
    }
    .ok_or("教务课表包含不支持的节次")?;
    NaiveTime::parse_from_str(value, "%H:%M").map_err(|_| "课表节次时间表无效".into())
}

fn apply_sync(
    path: &Path,
    system: &str,
    year: &str,
    term: &str,
    start_date: &str,
    week_count: u8,
    term_id: &str,
    parsed: &ParseResult,
    state: &str,
    meeting_count: usize,
) -> Result<SjtuSyncResult, String> {
    let mut connection = Connection::open(path).map_err(db_error)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(db_error)?;
    let transaction = connection.transaction().map_err(db_error)?;
    apply_sync_transaction(
        transaction,
        system,
        year,
        term,
        start_date,
        week_count,
        term_id,
        parsed,
        state,
        meeting_count,
    )
}

fn apply_sync_transaction(
    transaction: Transaction<'_>,
    system: &str,
    year: &str,
    term: &str,
    start_date: &str,
    week_count: u8,
    term_id: &str,
    parsed: &ParseResult,
    state: &str,
    meeting_count: usize,
) -> Result<SjtuSyncResult, String> {
    let now = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE academic_terms SET is_active=0 WHERE source_system=?1 AND id<>?2",
            params![system, term_id],
        )
        .map_err(db_error)?;
    transaction.execute("INSERT INTO academic_terms(id,source_system,academic_year,term_code,name,start_date,week_count,timezone,is_active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'Asia/Shanghai',1,?8,?8) ON CONFLICT(source_system,academic_year,term_code) DO UPDATE SET name=excluded.name,start_date=excluded.start_date,week_count=excluded.week_count,is_active=1,updated_at=excluded.updated_at", params![term_id,system,year,term,term_name(year,term),start_date,week_count as i64,now]).map_err(db_error)?;
    if state == "succeeded" {
        transaction
            .execute(
                "UPDATE sjtu_courses SET archived=1 WHERE term_id=?1 AND source_system=?2",
                params![term_id, system],
            )
            .map_err(db_error)?;
        transaction.execute("UPDATE course_meetings SET archived=1 WHERE course_id IN (SELECT id FROM sjtu_courses WHERE term_id=?1 AND source_system=?2)", params![term_id,system]).map_err(db_error)?;
    }
    for course in &parsed.courses {
        let course_id = stable_id(&format!(
            "sjtu-course|{term_id}|{system}|{}",
            course.external_id
        ));
        let color = course_color(&course.external_id);
        let course_fingerprint = fingerprint(&[&course.name, &course.teacher]);
        transaction.execute("INSERT INTO sjtu_courses(id,term_id,external_id,source_system,name,teacher,default_location,color,remote_fingerprint,archived,synced_at) VALUES(?1,?2,?3,?4,?5,?6,'',?7,?8,0,?9) ON CONFLICT(term_id,source_system,external_id) DO UPDATE SET name=excluded.name,teacher=excluded.teacher,color=excluded.color,remote_fingerprint=excluded.remote_fingerprint,archived=0,synced_at=excluded.synced_at", params![course_id,term_id,course.external_id,system,course.name,course.teacher,color,course_fingerprint,now]).map_err(db_error)?;
        let actual_course_id: String = transaction.query_row("SELECT id FROM sjtu_courses WHERE term_id=?1 AND source_system=?2 AND external_id=?3", params![term_id,system,course.external_id], |row| row.get(0)).map_err(db_error)?;
        for meeting in &course.meetings {
            let weeks_json = serde_json::to_string(&meeting.weeks)
                .map_err(|_| "无法编码课程周次".to_string())?;
            let start = slot_time(meeting.start_section, true)?
                .format("%H:%M")
                .to_string();
            let end = slot_time(meeting.end_section, false)?
                .format("%H:%M")
                .to_string();
            let meeting_key = format!(
                "{}|{}|{}|{}|{}",
                actual_course_id,
                meeting.weekday,
                meeting.start_section,
                meeting.end_section,
                fingerprint(&[&weeks_json, &meeting.location, &meeting.teacher])
            );
            let meeting_id = stable_id(&meeting_key);
            let meeting_fingerprint = fingerprint(&[&start, &end, &meeting.teacher]);
            transaction.execute("INSERT INTO course_meetings(id,course_id,weekday,start_section,end_section,start_local_time,end_local_time,timezone,week_numbers_json,location,teacher,note,remote_fingerprint,archived) VALUES(?1,?2,?3,?4,?5,?6,?7,'Asia/Shanghai',?8,?9,?10,'',?11,0) ON CONFLICT(id) DO UPDATE SET start_local_time=excluded.start_local_time,end_local_time=excluded.end_local_time,week_numbers_json=excluded.week_numbers_json,location=excluded.location,teacher=excluded.teacher,remote_fingerprint=excluded.remote_fingerprint,archived=0", params![meeting_id,actual_course_id,meeting.weekday as i64,meeting.start_section as i64,meeting.end_section as i64,start,end,weeks_json,meeting.location,meeting.teacher,meeting_fingerprint]).map_err(db_error)?;
        }
    }
    let error_summary = if parsed.skipped_rows == 0 {
        None
    } else {
        Some(format!(
            "{} course row(s) could not be parsed",
            parsed.skipped_rows
        ))
    };
    transaction.execute("INSERT INTO sjtu_sync_state(source_system,term_id,state,last_sync_at,last_success_at,course_count,meeting_count,error_summary) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(source_system,term_id) DO UPDATE SET state=excluded.state,last_sync_at=excluded.last_sync_at,last_success_at=CASE WHEN excluded.state='succeeded' THEN excluded.last_sync_at ELSE sjtu_sync_state.last_success_at END,course_count=excluded.course_count,meeting_count=excluded.meeting_count,error_summary=excluded.error_summary", params![system,term_id,state,now,if state == "succeeded" { Some(now.as_str()) } else { None },parsed.courses.len() as i64,meeting_count as i64,error_summary]).map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    Ok(SjtuSyncResult {
        source_system: system.to_string(),
        state: state.to_string(),
        course_count: parsed.courses.len(),
        meeting_count,
        skipped_rows: parsed.skipped_rows,
        synced_at: now,
    })
}

pub async fn course_occurrences(
    path: &Path,
    from_date: &str,
    to_date: &str,
    display_timezone: &str,
) -> Result<Vec<SjtuCourseOccurrence>, String> {
    let from =
        NaiveDate::parse_from_str(from_date, "%Y-%m-%d").map_err(|_| "开始日期无效".to_string())?;
    let to =
        NaiveDate::parse_from_str(to_date, "%Y-%m-%d").map_err(|_| "结束日期无效".to_string())?;
    if to < from || (to - from).num_days() > 370 {
        return Err("课表查询日期范围无效或超过一年".into());
    }
    let timezone =
        chrono_tz::Tz::from_str(display_timezone).map_err(|_| "显示时区无效".to_string())?;
    let connection = Connection::open(path).map_err(db_error)?;
    let mut statement = connection.prepare("SELECT c.id,t.id,t.source_system,c.name,c.teacher,c.color,t.start_date,t.week_count,m.weekday,m.start_section,m.end_section,m.start_local_time,m.end_local_time,m.timezone,m.week_numbers_json,m.location,m.id FROM course_meetings m JOIN sjtu_courses c ON c.id=m.course_id JOIN academic_terms t ON t.id=c.term_id WHERE c.archived=0 AND m.archived=0 AND t.is_active=1 ORDER BY t.start_date,m.weekday,m.start_section").map_err(db_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, String>(14)?,
                row.get::<_, String>(15)?,
                row.get::<_, String>(16)?,
            ))
        })
        .map_err(db_error)?;
    let mut results = Vec::new();
    for row in rows {
        let (
            course_id,
            term_id,
            source_system,
            title,
            teacher,
            color,
            start_date,
            week_count,
            weekday,
            start_section,
            end_section,
            start_time,
            end_time,
            term_zone,
            weeks_json,
            location,
            meeting_id,
        ) = row.map_err(db_error)?;
        let term_start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
            .map_err(|_| "已保存的学期首日无效".to_string())?;
        let weeks: Vec<u8> =
            serde_json::from_str(&weeks_json).map_err(|_| "课程周次缓存损坏".to_string())?;
        let zone =
            chrono_tz::Tz::from_str(&term_zone).map_err(|_| "课程时区缓存无效".to_string())?;
        for week in weeks.into_iter().filter(|week| *week as i64 <= week_count) {
            let date = term_start
                + chrono::Duration::weeks(week as i64 - 1)
                + chrono::Duration::days(weekday - 1);
            if date < from || date > to {
                continue;
            }
            let start_time = NaiveTime::parse_from_str(&start_time, "%H:%M")
                .map_err(|_| "课程开始节次无效".to_string())?;
            let end_time = NaiveTime::parse_from_str(&end_time, "%H:%M")
                .map_err(|_| "课程结束节次无效".to_string())?;
            let local_start = date.and_time(start_time);
            let local_end = date.and_time(end_time);
            let start = match zone.from_local_datetime(&local_start) {
                chrono::LocalResult::Single(value) => value,
                chrono::LocalResult::Ambiguous(first, _) => first,
                chrono::LocalResult::None => continue,
            };
            let end = match zone.from_local_datetime(&local_end) {
                chrono::LocalResult::Single(value) => value,
                chrono::LocalResult::Ambiguous(first, _) => first,
                chrono::LocalResult::None => continue,
            };
            let display_date = start.with_timezone(&timezone).date_naive();
            if display_date < from || display_date > to {
                continue;
            }
            results.push(SjtuCourseOccurrence {
                occurrence_id: format!("{course_id}:{week}:{weekday}:{start_section}"),
                meeting_id: meeting_id.clone(),
                course_id: course_id.clone(),
                term_id: term_id.clone(),
                source_system: source_system.clone(),
                title: title.clone(),
                teacher: teacher.clone(),
                location: location.clone(),
                start_utc: start.with_timezone(&Utc).to_rfc3339(),
                end_utc: end.with_timezone(&Utc).to_rfc3339(),
                timezone: term_zone.clone(),
                color: color.clone(),
                week_number: week as i64,
                weekday,
                start_section,
                end_section,
                note: connection.query_row(
                    "SELECT note FROM course_occurrence_notes WHERE meeting_id=?1 AND week_number=?2",
                    params![meeting_id, week as i64],
                    |note_row| note_row.get(0),
                ).optional().map_err(db_error)?.unwrap_or_default(),
            });
        }
    }
    results.sort_by(|a, b| a.start_utc.cmp(&b.start_utc));
    Ok(results)
}

pub fn set_occurrence_note(
    path: &Path,
    meeting_id: &str,
    week_number: i64,
    note: &str,
) -> Result<(), String> {
    let note = note.trim();
    if meeting_id.is_empty() || !(1..=24).contains(&week_number) || note.chars().count() > 2000 {
        return Err("课程备注无效（最多 2000 字）".into());
    }
    let mut connection = Connection::open(path).map_err(db_error)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM course_meetings WHERE id=?1 AND archived=0)",
            params![meeting_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if !exists {
        return Err("这节课已不存在或已归档".into());
    }
    if note.is_empty() {
        transaction
            .execute(
                "DELETE FROM course_occurrence_notes WHERE meeting_id=?1 AND week_number=?2",
                params![meeting_id, week_number],
            )
            .map_err(db_error)?;
    } else {
        let updated_at = Utc::now().to_rfc3339();
        transaction.execute("INSERT INTO course_occurrence_notes(meeting_id,week_number,note,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(meeting_id,week_number) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at", params![meeting_id, week_number, note, updated_at]).map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)
}

#[cfg(test)]
fn parse_fixture(system: &str, body: &str) -> Result<ParseResult, String> {
    let json: Value = serde_json::from_str(body).map_err(|_| "fixture json error".to_string())?;
    if system == "undergraduate" {
        Ok(parse_undergraduate_rows(
            json.get("kbList")
                .and_then(Value::as_array)
                .ok_or("kbList missing")?,
        ))
    } else {
        Ok(parse_graduate_rows(
            json.pointer("/datas/xsjxrwcx/rows")
                .and_then(Value::as_array)
                .ok_or("rows missing")?,
        ))
    }
}

fn db_error(error: rusqlite::Error) -> String {
    format!("本地数据库错误：{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const UG_FIXTURE: &str = include_str!("../../tests/fixtures/sjtu/undergraduate-schedule.json");
    const GRAD_FIXTURE: &str = include_str!("../../tests/fixtures/sjtu/graduate-schedule.json");

    #[test]
    fn parses_undergraduate_rows_and_explicit_odd_even_weeks() {
        let result = parse_fixture("undergraduate", UG_FIXTURE).unwrap();
        assert_eq!(result.skipped_rows, 0);
        assert_eq!(result.courses.len(), 1);
        assert_eq!(result.courses[0].meetings.len(), 2);
        assert_eq!(result.courses[0].meetings[0].weekday, 1);
        assert_eq!(
            result.courses[0].meetings[0].weeks,
            (1..=16).step_by(2).collect::<Vec<_>>()
        );
        assert_eq!(result.courses[0].meetings[1].weekday, 3);
        assert_eq!(
            result.courses[0].meetings[1].weeks,
            (2..=16).step_by(2).collect::<Vec<_>>()
        );
        assert_eq!(result.courses[0].meetings[0].location, "闵行校区 A101");
        assert_eq!(
            parse_weeks("3,5-7").into_iter().collect::<Vec<_>>(),
            [3, 5, 6, 7]
        );
    }

    #[test]
    fn parses_graduate_multi_meetings_and_room_changes() {
        let result = parse_fixture("graduate", GRAD_FIXTURE).unwrap();
        assert_eq!(result.skipped_rows, 0);
        assert_eq!(result.courses.len(), 1);
        assert_eq!(result.courses[0].meetings.len(), 2);
        let first = &result.courses[0].meetings[0];
        let second = &result.courses[0].meetings[1];
        assert_eq!(
            (first.weekday, first.start_section, first.end_section),
            (2, 1, 2)
        );
        assert_eq!(first.weeks, (1..=16).step_by(2).collect::<Vec<_>>());
        assert_eq!(first.location, "闵行校区教学楼A101");
        assert_eq!(
            (second.weekday, second.start_section, second.end_section),
            (4, 3, 4)
        );
        assert_eq!(second.weeks, (2..=16).step_by(2).collect::<Vec<_>>());
        assert_eq!(second.location, "闵行校区教学楼B202");
    }

    #[test]
    fn rejects_invalid_term_metadata_and_non_monday_week_one() {
        assert!(validate_term("undergraduate", "2026", "1", "2026-10-20", 16).is_err());
        assert!(validate_term("undergraduate", "2026", "4", "2026-10-19", 16).is_err());
        assert!(validate_term("undergraduate", "2026", "1", "2026-10-19", 25).is_err());
        assert_eq!(
            validate_term("undergraduate", "2026", "1", "2026-10-19", 16).unwrap(),
            "undergraduate-2026-1"
        );
    }

    #[tokio::test]
    async fn sync_upsert_is_idempotent_and_course_projection_uses_term_monday() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("calendar.sqlite3");
        crate::db::initialize_database(&path).unwrap();
        let mut parsed = parse_fixture("undergraduate", UG_FIXTURE).unwrap();
        let term_id = "undergraduate-2026-1";
        for _ in 0..2 {
            let meetings = parsed
                .courses
                .iter()
                .map(|course| course.meetings.len())
                .sum();
            apply_sync(
                &path,
                "undergraduate",
                "2026",
                "1",
                "2026-10-19",
                16,
                term_id,
                &parsed,
                "succeeded",
                meetings,
            )
            .unwrap();
        }
        let occurrences = course_occurrences(&path, "2026-10-19", "2026-11-01", "Asia/Shanghai")
            .await
            .unwrap();
        assert_eq!(occurrences.len(), 2);
        assert_eq!(occurrences[0].week_number, 1);
        assert_eq!(occurrences[0].start_utc, "2026-10-19T00:00:00+00:00");
        set_occurrence_note(
            &path,
            &occurrences[0].meeting_id,
            occurrences[0].week_number,
            "带实验报告",
        )
        .unwrap();
        apply_sync(
            &path,
            "undergraduate",
            "2026",
            "1",
            "2026-10-19",
            16,
            term_id,
            &parsed,
            "succeeded",
            2,
        )
        .unwrap();
        let annotated = course_occurrences(&path, "2026-10-19", "2026-10-25", "Asia/Shanghai")
            .await
            .unwrap();
        assert_eq!(
            annotated
                .iter()
                .find(|item| item.meeting_id == occurrences[0].meeting_id)
                .unwrap()
                .note,
            "带实验报告"
        );
        let following_week = course_occurrences(&path, "2026-10-26", "2026-11-01", "Asia/Shanghai")
            .await
            .unwrap();
        assert!(
            following_week.iter().all(|item| item.note.is_empty()),
            "one occurrence note must not leak to later weeks"
        );
        let connection = Connection::open(&path).unwrap();
        let (active_courses, active_meetings, all_meetings): (i64, i64, i64) = connection.query_row(
            "SELECT (SELECT COUNT(*) FROM sjtu_courses WHERE archived=0),(SELECT COUNT(*) FROM course_meetings WHERE archived=0),(SELECT COUNT(*) FROM course_meetings)", [],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
        ).unwrap();
        assert_eq!((active_courses, active_meetings, all_meetings), (1, 2, 2));

        parsed.courses[0].meetings[0].location = "更换教室 C303".into();
        apply_sync(
            &path,
            "undergraduate",
            "2026",
            "1",
            "2026-10-19",
            16,
            term_id,
            &parsed,
            "succeeded",
            2,
        )
        .unwrap();
        let active_meetings: i64 = Connection::open(&path)
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM course_meetings WHERE archived=0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            active_meetings, 2,
            "a changed room replaces the prior meeting instead of creating a visible ghost"
        );
    }

    #[test]
    fn partial_parse_does_not_archive_previously_cached_courses() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("calendar.sqlite3");
        crate::db::initialize_database(&path).unwrap();
        let parsed = parse_fixture("undergraduate", UG_FIXTURE).unwrap();
        apply_sync(
            &path,
            "undergraduate",
            "2026",
            "1",
            "2026-10-19",
            16,
            "undergraduate-2026-1",
            &parsed,
            "succeeded",
            2,
        )
        .unwrap();
        apply_sync(
            &path,
            "undergraduate",
            "2026",
            "1",
            "2026-10-19",
            16,
            "undergraduate-2026-1",
            &ParseResult {
                courses: Vec::new(),
                skipped_rows: 1,
            },
            "partial",
            0,
        )
        .unwrap();
        let archived: bool = Connection::open(&path)
            .unwrap()
            .query_row("SELECT archived FROM sjtu_courses LIMIT 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(!archived);
    }
}

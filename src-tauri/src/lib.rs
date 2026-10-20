mod canvas;
mod db;
mod events;
mod ics;
mod sjtu;

use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::{Manager, State};

struct AppState {
    database_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    database: &'static str,
    schema_version: i64,
}

#[tauri::command]
fn get_backend_status(state: State<'_, AppState>) -> Result<BackendStatus, String> {
    let schema_version = db::initialize_database(&state.database_path)
        .map_err(|error| format!("Local database is unavailable: {error}"))?;

    Ok(BackendStatus {
        database: "sqlite",
        schema_version,
    })
}

#[tauri::command]
fn create_personal_event(
    state: State<'_, AppState>,
    event: events::EventDraft,
) -> Result<events::PersonalEvent, String> {
    events::create_event(&state.database_path, event)
}

#[tauri::command]
fn update_personal_event(
    state: State<'_, AppState>,
    id: String,
    event: events::EventDraft,
) -> Result<events::PersonalEvent, String> {
    events::update_event(&state.database_path, &id, event)
}

#[tauri::command]
fn delete_personal_event(state: State<'_, AppState>, id: String) -> Result<(), String> {
    events::delete_event(&state.database_path, &id)
}

#[tauri::command]
fn get_personal_event(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<events::PersonalEvent>, String> {
    events::get_event(&state.database_path, &id)
}

#[tauri::command]
fn list_personal_events(state: State<'_, AppState>) -> Result<Vec<events::PersonalEvent>, String> {
    events::list_events(&state.database_path)
}

#[tauri::command]
fn set_recurrence_exception(
    state: State<'_, AppState>,
    event_id: String,
    original_start_local: String,
    kind: String,
    override_value: Option<events::RecurrenceOverride>,
) -> Result<(), String> {
    events::set_exception(
        &state.database_path,
        &event_id,
        original_start_local,
        kind,
        override_value,
    )
}

#[tauri::command]
fn get_calendar_occurrences(
    state: State<'_, AppState>,
    from_date: String,
    to_date: String,
    display_timezone: String,
) -> Result<Vec<events::CalendarOccurrence>, String> {
    events::calendar_occurrences(
        &state.database_path,
        &from_date,
        &to_date,
        &display_timezone,
    )
}

#[tauri::command]
fn preview_ics_import(
    content: String,
    source_name: String,
    first_monday: String,
    week_count: u8,
) -> Result<ics::IcsPreview, String> {
    ics::preview(&content, &source_name, &first_monday, week_count)
}

#[tauri::command]
fn apply_ics_import(
    state: State<'_, AppState>,
    content: String,
    source_name: String,
    first_monday: String,
    week_count: u8,
    replace_source: bool,
) -> Result<usize, String> {
    ics::apply(
        &state.database_path,
        &content,
        &source_name,
        &first_monday,
        week_count,
        replace_source,
    )
}

#[tauri::command]
fn save_canvas_credentials(
    state: State<'_, AppState>,
    instance_url: String,
    token: String,
) -> Result<(), String> {
    canvas::save_credentials(&state.database_path, &instance_url, &token)
}

#[tauri::command]
fn clear_canvas_credentials(state: State<'_, AppState>) -> Result<(), String> {
    canvas::clear_credentials(&state.database_path)
}

#[tauri::command]
fn get_canvas_connection_status(
    state: State<'_, AppState>,
) -> Result<canvas::CanvasConnectionStatus, String> {
    canvas::connection_status(&state.database_path)
}

#[tauri::command]
async fn test_canvas_connection(
    state: State<'_, AppState>,
) -> Result<canvas::CanvasProfile, String> {
    canvas::test_connection(&state.database_path).await
}

#[tauri::command]
async fn sync_canvas(state: State<'_, AppState>) -> Result<canvas::CanvasSyncResult, String> {
    canvas::sync(&state.database_path).await
}

#[tauri::command]
fn get_canvas_deadlines(
    state: State<'_, AppState>,
    from_date: String,
    to_date: String,
    display_timezone: String,
) -> Result<Vec<canvas::CanvasDeadline>, String> {
    canvas::deadlines(
        &state.database_path,
        &from_date,
        &to_date,
        &display_timezone,
    )
}

#[tauri::command]
fn set_canvas_assignment_completed(
    state: State<'_, AppState>,
    course_id: String,
    assignment_id: String,
    completed: bool,
) -> Result<(), String> {
    canvas::set_local_completed(&state.database_path, &course_id, &assignment_id, completed)
}

#[tauri::command]
fn get_sjtu_connection_status() -> sjtu::SjtuConnectionStatus {
    sjtu::connection_status()
}

#[tauri::command]
fn start_sjtu_login(app: tauri::AppHandle, source_system: String) -> Result<(), String> {
    sjtu::start_login(&app, &source_system)
}

#[tauri::command]
async fn finish_sjtu_login(app: tauri::AppHandle, source_system: String) -> Result<(), String> {
    sjtu::finish_login(&app, &source_system).await
}

#[tauri::command]
fn clear_sjtu_login(source_system: String) -> Result<(), String> {
    sjtu::clear_login(&source_system)
}

#[tauri::command]
async fn sync_sjtu(
    state: State<'_, AppState>,
    source_system: String,
    academic_year: String,
    term_code: String,
    start_date: String,
    week_count: u8,
) -> Result<sjtu::SjtuSyncResult, String> {
    sjtu::sync(
        &state.database_path,
        &source_system,
        &academic_year,
        &term_code,
        &start_date,
        week_count,
    )
    .await
}

#[tauri::command]
async fn get_sjtu_course_occurrences(
    state: State<'_, AppState>,
    from_date: String,
    to_date: String,
    display_timezone: String,
) -> Result<Vec<sjtu::SjtuCourseOccurrence>, String> {
    sjtu::course_occurrences(
        &state.database_path,
        &from_date,
        &to_date,
        &display_timezone,
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database_directory = app.path().app_data_dir()?;
            fs::create_dir_all(&database_directory)?;
            let database_path = database_directory.join("calendar.sqlite3");
            db::initialize_database(&database_path)?;
            app.manage(AppState { database_path });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            create_personal_event,
            update_personal_event,
            delete_personal_event,
            get_personal_event,
            list_personal_events,
            set_recurrence_exception,
            get_calendar_occurrences,
            preview_ics_import,
            apply_ics_import,
            save_canvas_credentials,
            clear_canvas_credentials,
            get_canvas_connection_status,
            test_canvas_connection,
            sync_canvas,
            get_canvas_deadlines,
            set_canvas_assignment_completed,
            get_sjtu_connection_status,
            start_sjtu_login,
            finish_sjtu_login,
            clear_sjtu_login,
            sync_sjtu,
            get_sjtu_course_occurrences
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SJTU Schedule");
}

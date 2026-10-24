mod backup;
mod canvas;
mod db;
mod events;
mod sjtu;
mod widget;

use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    database_path: PathBuf,
}

fn changed<T>(app: &tauri::AppHandle, result: Result<T, String>) -> Result<T, String> {
    if result.is_ok() {
        let _ = app.emit("calendar-data-changed", ());
    }
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WidgetStatus {
    canvas_last_success_at: Option<String>,
    sjtu_last_success_at: Option<String>,
    always_on_top: bool,
}

#[tauri::command]
fn get_widget_status(
    state: State<'_, AppState>,
    widget_state: State<'_, widget::WidgetState>,
) -> Result<WidgetStatus, String> {
    let connection = rusqlite::Connection::open(&state.database_path)
        .map_err(|error| format!("Local database is unavailable: {error}"))?;
    let canvas_last_success_at = canvas::last_success(&state.database_path)?;
    let sjtu_last_success_at = connection
        .query_row(
            "SELECT MAX(last_success_at) FROM sjtu_sync_state",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not read SJTU sync status: {error}"))?;

    Ok(WidgetStatus {
        canvas_last_success_at,
        sjtu_last_success_at,
        always_on_top: widget_state.always_on_top(),
    })
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
async fn export_data_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let database_path = state.database_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let downloads = app
            .path()
            .download_dir()
            .map_err(|_| "无法定位 Downloads 文件夹".to_string())?;
        let mut dialog = app
            .dialog()
            .file()
            .set_title("导出数据库备份")
            .set_directory(downloads)
            .set_file_name(format!(
                "sjtu-schedule-backup-{}.json",
                chrono::Local::now().format("%Y-%m-%d")
            ))
            .add_filter("JSON 备份", &["json"]);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(destination) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let destination = destination
            .into_path()
            .map_err(|_| "所选保存路径无效".to_string())?;
        if destination == database_path {
            return Err("备份不能覆盖正在使用的数据库".into());
        }
        let payload = backup::export(&database_path)?;
        fs::write(&destination, payload).map_err(|error| format!("无法保存备份：{error}"))?;
        Ok(Some(destination.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "导出备份任务未完成".to_string())?
}

#[tauri::command]
fn restore_data_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    backup_json: String,
) -> Result<i64, String> {
    changed(&app, backup::restore(&state.database_path, &backup_json))
}

#[tauri::command]
fn create_personal_event(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    event: events::EventDraft,
) -> Result<events::PersonalEvent, String> {
    changed(&app, events::create_event(&state.database_path, event))
}

#[tauri::command]
fn update_personal_event(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    event: events::EventDraft,
) -> Result<events::PersonalEvent, String> {
    changed(&app, events::update_event(&state.database_path, &id, event))
}

#[tauri::command]
fn delete_personal_event(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    changed(&app, events::delete_event(&state.database_path, &id))
}

#[tauri::command]
fn set_personal_event_completed(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    event_id: String,
    original_start_local: String,
    completed: bool,
) -> Result<(), String> {
    changed(
        &app,
        events::set_completion(
            &state.database_path,
            &event_id,
            &original_start_local,
            completed,
        ),
    )
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
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    event_id: String,
    original_start_local: String,
    kind: String,
    override_value: Option<events::RecurrenceOverride>,
) -> Result<(), String> {
    changed(
        &app,
        events::set_exception(
            &state.database_path,
            &event_id,
            original_start_local,
            kind,
            override_value,
        ),
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
fn save_canvas_credentials(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    instance_url: String,
    token: String,
) -> Result<(), String> {
    changed(
        &app,
        canvas::save_credentials(&state.database_path, &instance_url, &token),
    )
}

#[tauri::command]
fn clear_canvas_credentials(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    changed(&app, canvas::clear_credentials(&state.database_path))
}

#[tauri::command]
fn get_canvas_connection_status(
    state: State<'_, AppState>,
) -> Result<canvas::CanvasConnectionStatus, String> {
    canvas::connection_status(&state.database_path)
}

#[tauri::command]
async fn test_canvas_connection(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<canvas::CanvasProfile, String> {
    changed(&app, canvas::test_connection(&state.database_path).await)
}

#[tauri::command]
async fn sync_canvas(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<canvas::CanvasSyncResult, String> {
    changed(&app, canvas::sync(&state.database_path).await)
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
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    course_id: String,
    assignment_id: String,
    completed: bool,
) -> Result<(), String> {
    changed(
        &app,
        canvas::set_local_completed(&state.database_path, &course_id, &assignment_id, completed),
    )
}

#[tauri::command]
fn get_sjtu_connection_status() -> sjtu::SjtuConnectionStatus {
    sjtu::connection_status()
}

#[tauri::command]
async fn start_sjtu_login(app: tauri::AppHandle, source_system: String) -> Result<(), String> {
    sjtu::start_login(&app, &source_system)
}

#[tauri::command]
async fn finish_sjtu_login(app: tauri::AppHandle, source_system: String) -> Result<(), String> {
    changed(&app, sjtu::finish_login(&app, &source_system).await)
}

#[tauri::command]
fn clear_sjtu_login(app: tauri::AppHandle, source_system: String) -> Result<(), String> {
    changed(&app, sjtu::clear_login(&source_system))
}

#[tauri::command]
async fn sync_sjtu(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_system: String,
    academic_year: String,
    term_code: String,
    start_date: String,
    week_count: u8,
) -> Result<sjtu::SjtuSyncResult, String> {
    changed(
        &app,
        sjtu::sync(
            &state.database_path,
            &source_system,
            &academic_year,
            &term_code,
            &start_date,
            week_count,
        )
        .await,
    )
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

#[tauri::command]
fn set_sjtu_occurrence_note(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    meeting_id: String,
    week_number: i64,
    note: String,
) -> Result<(), String> {
    changed(
        &app,
        sjtu::set_occurrence_note(&state.database_path, &meeting_id, week_number, &note),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let database_directory = app.path().app_data_dir()?;
            fs::create_dir_all(&database_directory)?;
            let database_path = database_directory.join("calendar.sqlite3");
            db::initialize_database(&database_path)?;
            app.manage(AppState { database_path });
            let widget_settings_path = database_directory.join("widget-settings.json");
            app.manage(widget::WidgetState::new(widget_settings_path));
            if let Some(main_window) = app.get_webview_window("main") {
                widget::hide_on_close(&main_window);
            }
            widget::setup_widget_window(app.handle())?;
            widget::setup_tray(app.handle())?;
            Ok(())
        })
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::SIZE,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            export_data_backup,
            restore_data_backup,
            create_personal_event,
            update_personal_event,
            delete_personal_event,
            get_personal_event,
            list_personal_events,
            set_recurrence_exception,
            set_personal_event_completed,
            get_calendar_occurrences,
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
            get_sjtu_course_occurrences,
            set_sjtu_occurrence_note,
            get_widget_status,
            widget::toggle_widget,
            widget::show_main_window,
            widget::hide_widget,
            widget::set_widget_always_on_top
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SJTU Schedule");
}

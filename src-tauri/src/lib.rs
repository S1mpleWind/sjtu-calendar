mod db;
mod events;

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
            get_calendar_occurrences
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SJTU Schedule");
}

mod db;

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
        .invoke_handler(tauri::generate_handler![get_backend_status])
        .run(tauri::generate_context!())
        .expect("failed to run SJTU Schedule");
}

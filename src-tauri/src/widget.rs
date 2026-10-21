use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State, WebviewWindow, WebviewWindowBuilder};

const WIDGET_LABEL: &str = "widget";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedWidgetSettings {
    always_on_top: bool,
}

pub struct WidgetState {
    settings_path: PathBuf,
    saved: Mutex<SavedWidgetSettings>,
}

impl WidgetState {
    pub fn new(settings_path: PathBuf) -> Self {
        let saved = fs::read(&settings_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            settings_path,
            saved: Mutex::new(saved),
        }
    }

    pub fn always_on_top(&self) -> bool {
        self.saved
            .lock()
            .map(|settings| settings.always_on_top)
            .unwrap_or(false)
    }

    fn set_always_on_top(&self, enabled: bool) -> Result<(), String> {
        let mut saved = self
            .saved
            .lock()
            .map_err(|_| "Widget settings are temporarily unavailable".to_string())?;
        saved.always_on_top = enabled;
        let bytes = serde_json::to_vec_pretty(&*saved)
            .map_err(|error| format!("Could not serialize widget settings: {error}"))?;
        let temporary_path = self.settings_path.with_extension("json.tmp");
        fs::write(&temporary_path, bytes)
            .map_err(|error| format!("Could not save widget settings: {error}"))?;
        fs::rename(&temporary_path, &self.settings_path)
            .map_err(|error| format!("Could not apply widget settings: {error}"))
    }
}

pub fn setup_widget_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == WIDGET_LABEL)
        .ok_or_else(|| std::io::Error::other("Widget window is missing from tauri.conf.json"))?;
    let window = WebviewWindowBuilder::from_config(app, config)?.build()?;
    window.set_always_on_top(app.state::<WidgetState>().always_on_top())?;
    hide_on_close(&window);
    Ok(())
}

pub fn hide_on_close(window: &WebviewWindow) {
    let window_to_hide = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_to_hide.hide();
        }
    });
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_main = MenuItem::with_id(app, "open-main", "打开主窗口", true, None::<&str>)?;
    let toggle_widget =
        MenuItem::with_id(app, "toggle-widget", "显示/隐藏 Widget", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 SJTU Schedule", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_main, &toggle_widget, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| std::io::Error::other("Application icon is missing"))?;
    TrayIconBuilder::new()
        .tooltip("SJTU Schedule")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open-main" => {
                let _ = reveal_window(app, "main");
            }
            "toggle-widget" => {
                let _ = toggle_widget_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn reveal_window(app: &AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("Window '{label}' is unavailable"))?;
    if window.is_minimized().map_err(tauri_error)? {
        window.unminimize().map_err(tauri_error)?;
    }
    window.show().map_err(tauri_error)?;
    window.set_focus().map_err(tauri_error)
}

fn toggle_widget_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(WIDGET_LABEL)
        .ok_or_else(|| "Widget window is unavailable".to_string())?;
    if window.is_visible().map_err(tauri_error)? {
        window.hide().map_err(tauri_error)
    } else {
        reveal_window(app, WIDGET_LABEL)
    }
}

fn tauri_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
pub fn toggle_widget(app: AppHandle) -> Result<(), String> {
    toggle_widget_window(&app)
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    reveal_window(&app, "main")
}

#[tauri::command]
pub fn hide_widget(app: AppHandle) -> Result<(), String> {
    app.get_webview_window(WIDGET_LABEL)
        .ok_or_else(|| "Widget window is unavailable".to_string())?
        .hide()
        .map_err(tauri_error)
}

#[tauri::command]
pub fn set_widget_always_on_top(
    app: AppHandle,
    state: State<'_, WidgetState>,
    enabled: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window(WIDGET_LABEL)
        .ok_or_else(|| "Widget window is unavailable".to_string())?;
    window.set_always_on_top(enabled).map_err(tauri_error)?;
    state.set_always_on_top(enabled)
}

#[cfg(test)]
mod tests {
    use super::WidgetState;

    #[test]
    fn optional_always_on_top_preference_survives_restart() {
        let directory = tempfile::tempdir().expect("create temp dir");
        let path = directory.path().join("widget-settings.json");
        let state = WidgetState::new(path.clone());
        assert!(!state.always_on_top());
        state.set_always_on_top(true).expect("persist preference");
        assert!(WidgetState::new(path).always_on_top());
    }
}

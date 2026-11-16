mod cache;
mod commands;
mod prewarm;
mod thumb;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

/// 点关闭按钮时是否最小化到托盘（而不是退出）。由前端设置项控制。
pub static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // ---- 系统托盘 ----
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut builder = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("素材浏览器")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => {
                        CLOSE_TO_TRAY.store(false, Ordering::Relaxed);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            builder.build(app)?;

            // ---- 关闭按钮拦截至托盘 ----
            if let Some(win) = app.get_webview_window("main") {
                let w = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                            api.prevent_close();
                            let _ = w.hide();
                        }
                    }
                });
            }

            // ---- 命令行参数（拖文件夹到 exe 图标上）----
            let mut targets: Vec<String> = Vec::new();
            for a in std::env::args().skip(1) {
                if a.starts_with('-') {
                    continue;
                }
                if std::path::Path::new(&a).is_dir() {
                    targets.push(a);
                    continue;
                }
                // 快捷方式拖到程序图标上：解析成真实目录
                if let Some(real) = crate::commands::resolve_shortcut(a) {
                    if std::path::Path::new(&real).is_dir() {
                        targets.push(real);
                    }
                }
            }
            if targets.is_empty() {
                if let Ok(folder) = std::env::var("ASSET_INITIAL_FOLDER") {
                    targets.push(folder);
                }
            }
            if !targets.is_empty() {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(700));
                    for t in targets {
                        let _ = handle.emit("open-folder", t);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_dir,
            commands::list_recursive,
            commands::list_subdirs,
            commands::pick_folder,
            commands::pick_exe,
            commands::open_path,
            commands::reveal_in_explorer,
            commands::get_thumb,
            commands::cache_stats,
            commands::cache_set_limit,
            commands::cache_clear,
            commands::cache_set_dir,
            commands::prewarm_start,
            commands::prewarm_pause,
            commands::prewarm_resume,
            commands::prewarm_stop,
            commands::prewarm_status,
            commands::path_is_dir,
            commands::resolve_shortcut,
            commands::auto_watch_set,
            commands::auto_watch_get,
            commands::set_close_to_tray,
            commands::find_photoshop,
            commands::open_in_photoshop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

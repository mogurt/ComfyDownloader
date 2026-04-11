mod aria2;
mod commands;
mod db;
mod model_type;
mod url_parser;

use aria2::process::{find_available_port, resolve_aria2_path, Aria2Process};
use aria2::rpc::Aria2Rpc;
use commands::download::Aria2RpcState;
use db::migrations::get_migrations;
use log::{error, info};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager, RunEvent};
use tokio::sync::Mutex;

type Aria2ProcessState = Arc<Mutex<Option<Arc<Aria2Process>>>>;
type Aria2ShutdownState = Arc<AtomicBool>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:comfy_downloader.db", get_migrations())
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(Mutex::new(None::<Aria2Rpc>)) as Aria2RpcState)
        .manage(Arc::new(Mutex::new(None::<Arc<Aria2Process>>)) as Aria2ProcessState)
        .manage(Arc::new(AtomicBool::new(false)) as Aria2ShutdownState)
        .setup(|app| {
            let app_handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                if let Err(e) = setup_aria2(app_handle).await {
                    error!("Failed to set up aria2: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::download::parse_download_url,
            commands::download::suggest_type,
            commands::download::check_file_exists,
            commands::download::create_download,
            commands::download::pause_download,
            commands::download::resume_download,
            commands::download::cancel_download,
            commands::download::get_download_status,
            commands::download::get_active_downloads,
            commands::download::apply_aria2_runtime_settings,
            commands::download::is_aria2_ready,
            commands::settings::get_model_types,
            commands::settings::get_default_dir_mappings,
            commands::settings::list_subdirs,
            commands::settings::resolve_relative_subdir,
            commands::settings::open_directory,
            commands::comfyui::check_comfyui_status,
            commands::comfyui::verify_model_in_comfyui,
            commands::hf_search::search_hf_models,
            commands::hf_search::get_hf_model_files,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            tauri::async_runtime::block_on(async {
                let shutdown_state: tauri::State<'_, Aria2ShutdownState> = app_handle.state();
                shutdown_state.store(true, Ordering::SeqCst);

                let rpc_state: tauri::State<'_, Aria2RpcState> = app_handle.state();
                let rpc = {
                    let mut guard = rpc_state.lock().await;
                    let rpc = guard.as_ref().cloned();
                    *guard = None;
                    rpc
                };
                if let Some(rpc) = rpc {
                    let _ = rpc.shutdown().await;
                }

                let process_state: tauri::State<'_, Aria2ProcessState> = app_handle.state();
                let process = {
                    let mut guard = process_state.lock().await;
                    let process = guard.as_ref().cloned();
                    *guard = None;
                    process
                };
                if let Some(process) = process {
                    let _ = process.stop().await;
                }
            });
        }
    });
}

async fn setup_aria2(app_handle: tauri::AppHandle) -> Result<(), String> {
    let shutdown_state: tauri::State<'_, Aria2ShutdownState> = app_handle.state();
    shutdown_state.store(false, Ordering::SeqCst);

    let aria2_path = resolve_aria2_path(&app_handle)?;
    let port = find_available_port();
    let secret: String = uuid::Uuid::new_v4().to_string().replace("-", "");

    info!(
        "Setting up aria2: path={}, port={}", aria2_path.display(), port
    );

    let process = Arc::new(Aria2Process::new(aria2_path, port, secret.clone(), 3, 16, None));
    process.start(&app_handle).await?;

    let process_state: tauri::State<'_, Aria2ProcessState> = app_handle.state();
    {
        let mut guard = process_state.lock().await;
        *guard = Some(process.clone());
    }

    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

    let rpc = Aria2Rpc::new(port, secret);
    rpc.connect(app_handle.clone()).await?;

    let rpc_state: tauri::State<'_, Aria2RpcState> = app_handle.state();
    let mut guard = rpc_state.lock().await;
    *guard = Some(rpc);

    let _ = app_handle.emit("aria2://ready", serde_json::json!({ "port": port }));

    let app_for_monitor = app_handle.clone();
    let shutdown_for_monitor = shutdown_state.inner().clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
        loop {
            interval.tick().await;
            if shutdown_for_monitor.load(Ordering::SeqCst) {
                info!("aria2 monitor stopping because app is shutting down");
                break;
            }
            if let Err(e) = process.ensure_running(&app_for_monitor).await {
                error!("aria2 monitor error: {}", e);
                let _ = app_for_monitor.emit("aria2://error", serde_json::json!({ "error": e }));
                break;
            }
        }
    });

    info!("aria2 setup complete");
    Ok(())
}

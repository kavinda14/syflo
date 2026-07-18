use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

/// Holds the spawned backend `node server.js` process so we can kill it on app exit.
/// Wrapped in `Mutex<Option<...>>` because the child is taken out at shutdown.
struct BackendProcess(Mutex<Option<Child>>);

/// Spawns the bundled Node binary running the Syflo backend.
/// `data_dir` is exported as SYFLO_DATA_DIR so the backend stores the SQLite
/// database and uploaded files in a writable per-user location (the .app bundle
/// is read-only on macOS).
fn spawn_backend(
    node_path: &std::path::Path,
    server_path: &std::path::Path,
    data_dir: &std::path::Path,
) -> std::io::Result<Child> {
    let mut cmd = Command::new(node_path);
    cmd.arg(server_path)
        .env("SYFLO_DATA_DIR", data_dir)
        // Backend listens on this port — must match the frontend's expectations.
        .env("PORT", "3001")
        // Inherit stdio so backend logs appear in the Tauri console output.
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    cmd.spawn()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let resource_dir = app.path().resource_dir()?;
            let node_path = resource_dir.join("resources/node/node");
            let server_path = resource_dir.join("resources/backend/server.js");
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir).ok();

            log::info!("Spawning backend:");
            log::info!("  node:    {}", node_path.display());
            log::info!("  server:  {}", server_path.display());
            log::info!("  dataDir: {}", data_dir.display());

            // Only spawn the bundled backend when the resources actually exist.
            // In `cargo tauri dev` you typically keep running `npm start` in a
            // separate terminal — the resource paths don't exist there, so we
            // skip spawning to avoid a port conflict.
            if node_path.exists() && server_path.exists() {
                match spawn_backend(&node_path, &server_path, &data_dir) {
                    Ok(child) => {
                        let state = app.state::<BackendProcess>();
                        *state.0.lock().unwrap() = Some(child);
                        log::info!("Backend started.");
                    }
                    Err(e) => {
                        log::error!("Failed to spawn backend: {e}");
                    }
                }
            } else {
                log::info!(
                    "Bundled backend not found at {}. \
                     Assuming a dev backend is running separately on :3001.",
                    server_path.display()
                );
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Clean up the spawned backend so it doesn't linger after the
                // window closes. Without this, killing the app leaves an
                // orphaned `node` process holding port 3001.
                if let Some(state) = app_handle.try_state::<BackendProcess>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                        log::info!("Backend stopped.");
                    }
                }
            }
        });
}

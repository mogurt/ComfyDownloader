use log::{info, warn};
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub struct Aria2Process {
    child: Arc<Mutex<Option<Child>>>,
    port: u16,
    secret: String,
    restart_count: Arc<Mutex<u32>>,
    aria2_path: PathBuf,
    max_concurrent: u32,
    max_connections: u32,
    proxy: Option<String>,
}

impl Aria2Process {
    pub fn new(
        aria2_path: PathBuf,
        port: u16,
        secret: String,
        max_concurrent: u32,
        max_connections: u32,
        proxy: Option<String>,
    ) -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            port,
            secret,
            restart_count: Arc::new(Mutex::new(0)),
            aria2_path,
            max_concurrent,
            max_connections,
            proxy,
        }
    }

    pub async fn start(&self, app_handle: &AppHandle) -> Result<(), String> {
        let mut args = vec![
            "--enable-rpc".to_string(),
            format!("--rpc-listen-port={}", self.port),
            format!("--rpc-secret={}", self.secret),
            "--rpc-allow-origin-all=true".to_string(),
            "--auto-file-renaming=false".to_string(),
            "--allow-overwrite=false".to_string(),
            "--enable-color=false".to_string(),
            "--summary-interval=5".to_string(),
            "--console-log-level=notice".to_string(),
            format!("--max-concurrent-downloads={}", self.max_concurrent),
            format!("--max-connection-per-server={}", self.max_connections),
            "--continue=true".to_string(),
            "--split=16".to_string(),
            "--min-split-size=1M".to_string(),
            "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
        ];

        if let Some(ref proxy) = self.proxy {
            if !proxy.is_empty() {
                args.push(format!("--all-proxy={}", proxy));
            }
        }

        info!(
            "Starting aria2c at {}:{}",
            self.aria2_path.display(),
            self.port
        );

        let mut command = Command::new(&self.aria2_path);
        command
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start aria2c: {}", e))?;

        if let Some(stdout) = child.stdout.take() {
            spawn_aria2_output_reader(app_handle.clone(), stdout, "stdout");
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_aria2_output_reader(app_handle.clone(), stderr, "stderr");
        }

        let mut guard = self.child.lock().await;
        *guard = Some(child);

        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        info!("aria2c started on port {}", self.port);
        Ok(())
    }

    pub async fn stop(&self) -> Result<(), String> {
        let mut guard = self.child.lock().await;
        if let Some(ref mut child) = *guard {
            info!("Stopping aria2c process");
            let _ = child.kill().await;
            *guard = None;
        }
        Ok(())
    }

    pub async fn is_running(&self) -> bool {
        let mut guard = self.child.lock().await;
        if let Some(ref mut child) = *guard {
            match child.try_wait() {
                Ok(None) => true,
                _ => false,
            }
        } else {
            false
        }
    }

    pub async fn ensure_running(&self, app_handle: &AppHandle) -> Result<(), String> {
        if !self.is_running().await {
            let mut count = self.restart_count.lock().await;
            if *count >= 3 {
                return Err("aria2c has crashed too many times (3), giving up".to_string());
            }
            warn!("aria2c is not running, restarting (attempt {})", *count + 1);
            *count += 1;
            drop(count);
            self.start(app_handle).await?;
        }
        Ok(())
    }
}

fn spawn_aria2_output_reader<T>(app_handle: AppHandle, reader: T, stream: &'static str)
where
    T: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            // aria2 echoes request URIs, which may carry API tokens.
            let line = crate::safety::redact_text(line);
            let line = line.as_str();

            let lowered = line.to_ascii_lowercase();
            let level = if lowered.contains("error") {
                "error"
            } else if lowered.contains("warn") {
                "warn"
            } else {
                "info"
            };

            info!("aria2[{}] {}", stream, line);
            let _ = app_handle.emit(
                "aria2://log",
                serde_json::json!({
                    "level": level,
                    "stream": stream,
                    "message": line,
                }),
            );
        }
    });
}

pub fn find_available_port() -> u16 {
    portpicker::pick_unused_port().unwrap_or(6800)
}

pub fn resolve_aria2_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let sidecar_name = if cfg!(target_os = "windows") {
        format!(
            "aria2c-{}.exe",
            option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or("x86_64-pc-windows-msvc")
        )
    } else {
        format!(
            "aria2c-{}",
            option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or(std::env::consts::ARCH)
        )
    };

    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let exe_name = if cfg!(target_os = "windows") {
        "aria2c.exe"
    } else {
        "aria2c"
    };

    let resource_candidates = [
        resource_dir.join("binaries").join(&exe_name),
        resource_dir.join("binaries").join(&sidecar_name),
    ];
    for path in resource_candidates {
        if path.exists() {
            return Ok(path);
        }
    }

    if cfg!(dev) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let dev_candidates = [
            manifest_dir.join("binaries").join(&sidecar_name),
            manifest_dir.join("binaries").join(&exe_name),
        ];
        for path in dev_candidates {
            if path.exists() {
                let runtime_dir = std::env::temp_dir().join("comfy-downloader");
                fs::create_dir_all(&runtime_dir)
                    .map_err(|e| format!("Failed to create aria2 runtime dir: {}", e))?;

                cleanup_stale_runtime_binaries(&runtime_dir);

                let runtime_path = runtime_dir.join(format!(
                    "aria2c-runtime-{}{}",
                    std::process::id(),
                    if cfg!(target_os = "windows") {
                        ".exe"
                    } else {
                        ""
                    }
                ));

                fs::copy(&path, &runtime_path)
                    .map_err(|e| format!("Failed to prepare aria2 runtime binary: {}", e))?;

                return Ok(runtime_path);
            }
        }
    }

    Ok(PathBuf::from(exe_name))
}

fn cleanup_stale_runtime_binaries(runtime_dir: &std::path::Path) {
    let entries = match fs::read_dir(runtime_dir) {
        Ok(entries) => entries,
        Err(e) => {
            warn!(
                "Failed to read aria2 runtime dir {}: {}",
                runtime_dir.display(),
                e
            );
            return;
        }
    };

    let current_name = format!(
        "aria2c-runtime-{}{}",
        std::process::id(),
        if cfg!(target_os = "windows") {
            ".exe"
        } else {
            ""
        }
    );

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if !file_name.starts_with("aria2c-runtime-") || file_name == current_name {
            continue;
        }

        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", file_name])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }

        if let Err(e) = fs::remove_file(&path) {
            if e.kind() != ErrorKind::NotFound {
                warn!(
                    "Failed to remove stale aria2 runtime {}: {}",
                    path.display(),
                    e
                );
            }
        } else {
            info!("Removed stale aria2 runtime {}", path.display());
        }
    }
}

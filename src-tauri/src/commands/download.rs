use crate::aria2::rpc::Aria2Rpc;
use crate::model_type::rules::{suggest_model_type, UserRule};
use crate::safety::{redact_url, validate_filename};
use crate::url_parser;
use crate::url_parser::ParseResult;
use log::info;
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

pub type Aria2RpcState = Arc<Mutex<Option<Aria2Rpc>>>;

async fn get_rpc(rpc_state: &Aria2RpcState) -> Result<Aria2Rpc, String> {
    let guard = rpc_state.lock().await;
    guard
        .as_ref()
        .cloned()
        .ok_or_else(|| "aria2 RPC not connected".to_string())
}

#[tauri::command]
pub async fn is_aria2_ready(rpc_state: State<'_, Aria2RpcState>) -> Result<bool, String> {
    let guard = rpc_state.lock().await;
    Ok(guard.is_some())
}

#[tauri::command]
pub async fn parse_download_url(
    url: String,
    proxy: Option<String>,
    civitai_token: Option<String>,
    huggingface_token: Option<String>,
) -> Result<ParseResult, String> {
    url_parser::parse_url(
        &url,
        proxy.as_deref(),
        civitai_token.as_deref(),
        huggingface_token.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn suggest_type(
    filename: String,
    url: String,
    api_type: Option<String>,
    rules_json: String,
) -> Result<String, String> {
    let rules: Vec<UserRule> = serde_json::from_str(&rules_json).unwrap_or_default();
    Ok(suggest_model_type(
        &filename,
        &url,
        api_type.as_deref(),
        &rules,
    ))
}

#[tauri::command]
pub async fn check_file_exists(dir: String, filename: String) -> Result<bool, String> {
    validate_filename(&filename)?;
    let path = Path::new(&dir).join(&filename);
    Ok(path.exists())
}

/// Returns `filename` if it is free in `dir`, otherwise the first free
/// `stem (n).ext` variant (used by the "rename" duplicate strategy).
#[tauri::command]
pub async fn unique_filename(dir: String, filename: String) -> Result<String, String> {
    validate_filename(&filename)?;
    next_free_filename(Path::new(&dir), &filename)
}

fn next_free_filename(dir: &Path, filename: &str) -> Result<String, String> {
    // A leftover `.aria2` control file means aria2 would resume into that name.
    let is_free =
        |name: &str| !dir.join(name).exists() && !dir.join(format!("{}.aria2", name)).exists();
    if is_free(filename) {
        return Ok(filename.to_string());
    }

    let (stem, ext) = match filename.rfind('.') {
        Some(i) if i > 0 => (&filename[..i], &filename[i..]),
        _ => (filename, ""),
    };
    (1..1000)
        .map(|n| format!("{} ({}){}", stem, n, ext))
        .find(|candidate| is_free(candidate))
        .ok_or_else(|| format!("No free file name for {}", filename))
}

#[tauri::command]
pub async fn create_download(
    rpc_state: State<'_, Aria2RpcState>,
    url: String,
    dir: String,
    filename: String,
    headers: Option<Vec<String>>,
) -> Result<String, String> {
    validate_filename(&filename)?;
    let rpc = get_rpc(&rpc_state).await?;

    info!(
        "Creating download: {} -> {}/{}",
        redact_url(&url),
        dir,
        filename
    );

    let gid = rpc.add_uri(vec![url], &dir, &filename, headers).await?;

    info!("Download created with GID: {}", gid);
    Ok(gid)
}

#[tauri::command]
pub async fn pause_download(
    rpc_state: State<'_, Aria2RpcState>,
    gid: String,
) -> Result<String, String> {
    let rpc = get_rpc(&rpc_state).await?;
    rpc.pause(&gid).await
}

#[tauri::command]
pub async fn resume_download(
    rpc_state: State<'_, Aria2RpcState>,
    gid: String,
) -> Result<String, String> {
    let rpc = get_rpc(&rpc_state).await?;
    rpc.unpause(&gid).await
}

#[tauri::command]
pub async fn cancel_download(
    rpc_state: State<'_, Aria2RpcState>,
    gid: String,
) -> Result<String, String> {
    let rpc = get_rpc(&rpc_state).await?;
    rpc.remove(&gid).await
}

#[tauri::command]
pub async fn get_download_status(
    rpc_state: State<'_, Aria2RpcState>,
    gid: String,
) -> Result<serde_json::Value, String> {
    let rpc = get_rpc(&rpc_state).await?;
    let status = rpc.tell_status(&gid).await?;
    serde_json::to_value(status).map_err(|e| format!("Serialization error: {}", e))
}

#[tauri::command]
pub async fn get_active_downloads(
    rpc_state: State<'_, Aria2RpcState>,
) -> Result<Vec<serde_json::Value>, String> {
    let rpc = get_rpc(&rpc_state).await?;

    let all = rpc.poll_all().await?;

    all.into_iter()
        .map(|s| serde_json::to_value(s).map_err(|e| format!("Serialization error: {}", e)))
        .collect()
}

#[tauri::command]
pub async fn apply_aria2_runtime_settings(
    rpc_state: State<'_, Aria2RpcState>,
    max_concurrent: u32,
    max_connections: u32,
    proxy: Option<String>,
    speed_limit_kb: Option<u64>,
) -> Result<(), String> {
    let rpc = get_rpc(&rpc_state).await?;
    let options = serde_json::json!({
        "max-concurrent-downloads": max_concurrent.to_string(),
        "max-connection-per-server": max_connections.to_string(),
        "all-proxy": proxy.unwrap_or_default(),
        // 0 means unlimited for aria2 as well.
        "max-overall-download-limit": format!("{}K", speed_limit_kb.unwrap_or(0)),
    });

    rpc.change_global_option(options).await
}

#[cfg(test)]
mod tests {
    use super::next_free_filename;
    use std::fs;

    #[test]
    fn picks_next_free_numbered_name() {
        let dir = std::env::temp_dir().join(format!("cd-unique-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();

        assert_eq!(
            next_free_filename(&dir, "model.safetensors").unwrap(),
            "model.safetensors"
        );

        fs::write(dir.join("model.safetensors"), b"x").unwrap();
        assert_eq!(
            next_free_filename(&dir, "model.safetensors").unwrap(),
            "model (1).safetensors"
        );

        // A partial download (control file) also occupies the name.
        fs::write(dir.join("model (1).safetensors.aria2"), b"x").unwrap();
        assert_eq!(
            next_free_filename(&dir, "model.safetensors").unwrap(),
            "model (2).safetensors"
        );

        fs::write(dir.join("README"), b"x").unwrap();
        assert_eq!(next_free_filename(&dir, "README").unwrap(), "README (1)");

        fs::remove_dir_all(&dir).unwrap();
    }
}

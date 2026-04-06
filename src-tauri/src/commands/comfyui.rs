use log::info;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComfyUIStatus {
    pub online: bool,
    pub message: String,
}

#[tauri::command]
pub async fn check_comfyui_status(server_url: String) -> Result<ComfyUIStatus, String> {
    let url = format!("{}/system_stats", server_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            info!("ComfyUI is online at {}", server_url);
            Ok(ComfyUIStatus {
                online: true,
                message: "ComfyUI is running".to_string(),
            })
        }
        Ok(resp) => Ok(ComfyUIStatus {
            online: false,
            message: format!("ComfyUI returned status {}", resp.status()),
        }),
        Err(e) => Ok(ComfyUIStatus {
            online: false,
            message: format!("Cannot reach ComfyUI: {}", e),
        }),
    }
}

#[tauri::command]
pub async fn verify_model_in_comfyui(
    server_url: String,
    filename: String,
) -> Result<bool, String> {
    let url = format!("{}/object_info", server_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to reach ComfyUI: {}", e))?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(body.contains(&filename))
}

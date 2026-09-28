use log::info;
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
pub async fn verify_model_in_comfyui(server_url: String, filename: String) -> Result<bool, String> {
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
    if !resp.status().is_success() {
        return Err(format!("ComfyUI returned status {}", resp.status()));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse ComfyUI response: {}", e))?;

    Ok(lists_model(&body, &filename))
}

/// ComfyUI lists model files as plain strings inside node input specs, e.g.
/// `"ckpt_name": [["a.safetensors", "sdxl/b.safetensors"], {...}]`. Match whole
/// names (optionally inside a subfolder), never substrings.
fn lists_model(value: &Value, filename: &str) -> bool {
    match value {
        Value::String(s) => {
            s == filename
                || s.ends_with(&format!("/{}", filename))
                || s.ends_with(&format!("\\{}", filename))
        }
        Value::Array(items) => items.iter().any(|v| lists_model(v, filename)),
        Value::Object(map) => map.values().any(|v| lists_model(v, filename)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::lists_model;
    use serde_json::json;

    #[test]
    fn matches_whole_model_names_only() {
        let info = json!({
            "CheckpointLoaderSimple": {
                "input": { "required": {
                    "ckpt_name": [["xa.safetensors", "sdxl/b.safetensors", "win\\c.ckpt"], {}]
                }}
            }
        });
        assert!(lists_model(&info, "b.safetensors"));
        assert!(lists_model(&info, "c.ckpt"));
        assert!(lists_model(&info, "xa.safetensors"));
        assert!(!lists_model(&info, "a.safetensors"));
        assert!(!lists_model(&info, "missing.safetensors"));
    }
}

use crate::model_type::ModelType;
use log::info;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirMapping {
    pub model_type: String,
    pub directory: String,
}

#[tauri::command]
pub fn get_model_types() -> Vec<serde_json::Value> {
    ModelType::all_types()
        .into_iter()
        .map(|t| {
            serde_json::json!({
                "value": t.as_str(),
                "label": t.as_str(),
                "default_subdir": t.default_subdir(),
            })
        })
        .collect()
}

#[tauri::command]
pub fn get_default_dir_mappings(comfyui_root: String) -> Vec<DirMapping> {
    if comfyui_root.is_empty() {
        return vec![];
    }

    ModelType::all_types()
        .into_iter()
        .map(|t| {
            let dir = std::path::Path::new(&comfyui_root)
                .join(t.default_subdir())
                .to_string_lossy()
                .to_string();
            DirMapping {
                model_type: t.as_str().to_string(),
                directory: dir,
            }
        })
        .collect()
}

#[tauri::command]
pub fn open_directory(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    info!("Opening directory: {}", path);

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn list_subdirs(base_dir: String) -> Result<Vec<String>, String> {
    let path = std::path::Path::new(&base_dir);
    if !path.exists() || !path.is_dir() {
        return Ok(vec![]);
    }

    let mut dirs: Vec<String> = std::fs::read_dir(path)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            if entry.path().is_dir() {
                entry.file_name().to_str().map(|s| s.to_string())
            } else {
                None
            }
        })
        .collect();

    dirs.sort();
    Ok(dirs)
}

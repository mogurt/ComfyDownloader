use log::info;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;

const MODEL_EXTENSIONS: &[&str] = &[
    ".safetensors",
    ".ckpt",
    ".pt",
    ".pth",
    ".bin",
    ".onnx",
    ".gguf",
];

fn class_type_to_model_type(class_type: &str) -> Option<&'static str> {
    match class_type {
        "CheckpointLoaderSimple" | "CheckpointLoader" | "unCLIPCheckpointLoader" => {
            Some("checkpoint")
        }
        "LoraLoader" | "LoraLoaderModelOnly" => Some("lora"),
        "VAELoader" => Some("vae"),
        "ControlNetLoader" | "DiffControlNetLoader" => Some("controlnet"),
        "UpscaleModelLoader" => Some("upscale_model"),
        "CLIPLoader" | "DualCLIPLoader" | "TripleCLIPLoader" => Some("clip"),
        "UNETLoader" => Some("diffusion_model"),
        "StyleModelLoader" => Some("style_models"),
        "GLIGENLoader" => Some("gligen"),
        "CLIPVisionLoader" => Some("clip_vision"),
        "IPAdapterModelLoader" => Some("ipadapter"),
        _ => None,
    }
}

fn is_model_filename(s: &str) -> bool {
    let lower = s.to_lowercase();
    MODEL_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

fn extract_basename(filename: &str) -> &str {
    filename.rsplit(['/', '\\']).next().unwrap_or(filename)
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowModelRef {
    pub filename: String,
    pub model_type_hint: Option<String>,
    pub node_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParseWorkflowResult {
    pub models: Vec<WorkflowModelRef>,
    pub node_count: usize,
    pub format: String,
}

fn extract_models_api_format(root: &serde_json::Value) -> (Vec<WorkflowModelRef>, usize) {
    let mut models = Vec::new();
    let mut seen = HashSet::new();
    let mut node_count = 0;

    let obj = match root.as_object() {
        Some(o) => o,
        None => return (models, 0),
    };

    for (_key, node) in obj {
        let class_type = node
            .get("class_type")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if class_type.is_empty() {
            continue;
        }
        node_count += 1;

        let type_hint = class_type_to_model_type(class_type).map(|s| s.to_string());

        if let Some(inputs) = node.get("inputs").and_then(|v| v.as_object()) {
            for (_input_key, input_val) in inputs {
                if let Some(s) = input_val.as_str() {
                    if is_model_filename(s) {
                        let basename = extract_basename(s).to_string();
                        if seen.insert(basename.clone()) {
                            models.push(WorkflowModelRef {
                                filename: basename,
                                model_type_hint: type_hint.clone(),
                                node_type: Some(class_type.to_string()),
                            });
                        }
                    }
                }
            }
        }
    }

    (models, node_count)
}

fn extract_models_litegraph_format(root: &serde_json::Value) -> (Vec<WorkflowModelRef>, usize) {
    let mut models = Vec::new();
    let mut seen = HashSet::new();

    let nodes = match root.get("nodes").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return (models, 0),
    };

    let node_count = nodes.len();

    for node in nodes {
        let node_type = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let type_hint = class_type_to_model_type(node_type).map(|s| s.to_string());

        if let Some(widgets) = node.get("widgets_values").and_then(|v| v.as_array()) {
            for val in widgets {
                if let Some(s) = val.as_str() {
                    if is_model_filename(s) {
                        let basename = extract_basename(s).to_string();
                        if seen.insert(basename.clone()) {
                            models.push(WorkflowModelRef {
                                filename: basename,
                                model_type_hint: type_hint.clone(),
                                node_type: if node_type.is_empty() {
                                    None
                                } else {
                                    Some(node_type.to_string())
                                },
                            });
                        }
                    }
                }
            }
        }
    }

    (models, node_count)
}

fn detect_and_extract(root: &serde_json::Value) -> (Vec<WorkflowModelRef>, usize, String) {
    if root.get("nodes").is_some() && root.get("links").is_some() {
        let (models, count) = extract_models_litegraph_format(root);
        (models, count, "litegraph".to_string())
    } else {
        let obj = root.as_object();
        let looks_like_api = obj.is_some_and(|o| o.values().any(|v| v.get("class_type").is_some()));

        if looks_like_api {
            let (models, count) = extract_models_api_format(root);
            (models, count, "api".to_string())
        } else if let Some(prompt) = root.get("prompt") {
            let (models, count) = extract_models_api_format(prompt);
            (models, count, "api_wrapped".to_string())
        } else if let Some(workflow) = root.get("workflow") {
            let (models, count) = extract_models_litegraph_format(workflow);
            (models, count, "litegraph_wrapped".to_string())
        } else {
            let mut models = Vec::new();
            let mut seen = HashSet::new();
            collect_model_strings_recursive(root, &mut models, &mut seen);
            let count = root.as_object().map_or(0, |o| o.len());
            (models, count, "unknown".to_string())
        }
    }
}

fn collect_model_strings_recursive(
    val: &serde_json::Value,
    models: &mut Vec<WorkflowModelRef>,
    seen: &mut HashSet<String>,
) {
    match val {
        serde_json::Value::String(s) => {
            if is_model_filename(s) {
                let basename = extract_basename(s).to_string();
                if seen.insert(basename.clone()) {
                    models.push(WorkflowModelRef {
                        filename: basename,
                        model_type_hint: None,
                        node_type: None,
                    });
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_model_strings_recursive(v, models, seen);
            }
        }
        serde_json::Value::Object(obj) => {
            for (_, v) in obj {
                collect_model_strings_recursive(v, models, seen);
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub async fn parse_workflow_json(json_str: String) -> Result<ParseWorkflowResult, String> {
    let root: serde_json::Value =
        serde_json::from_str(&json_str).map_err(|e| format!("Invalid JSON: {}", e))?;

    let (models, node_count, format) = detect_and_extract(&root);

    info!(
        "Parsed workflow ({}): {} nodes, {} model refs",
        format,
        node_count,
        models.len()
    );

    Ok(ParseWorkflowResult {
        models,
        node_count,
        format,
    })
}

#[tauri::command]
pub async fn parse_workflow_file(file_path: String) -> Result<ParseWorkflowResult, String> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file {}: {}", file_path, e))?;

    let root: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid JSON: {}", e))?;

    let (models, node_count, format) = detect_and_extract(&root);

    info!(
        "Parsed workflow file {} ({}): {} nodes, {} model refs",
        file_path,
        format,
        node_count,
        models.len()
    );

    Ok(ParseWorkflowResult {
        models,
        node_count,
        format,
    })
}

// ── Check models local ──

#[derive(Debug, Clone, Serialize)]
pub struct ModelLocalStatus {
    pub filename: String,
    pub found: bool,
    pub found_path: Option<String>,
}

#[tauri::command]
pub async fn check_models_local(
    base_dir: String,
    filenames: Vec<String>,
) -> Result<Vec<ModelLocalStatus>, String> {
    let base = Path::new(&base_dir);
    if !base.is_dir() {
        return Err(format!("Directory not found: {}", base_dir));
    }

    info!("Checking {} models in {}", filenames.len(), base_dir);

    // Model trees can be large (and on network drives): keep the blocking walk
    // off the async runtime.
    let base_owned = base.to_path_buf();
    let index = tokio::task::spawn_blocking(move || {
        let mut index: HashMap<String, String> = HashMap::new();
        walk_files(&base_owned, &mut |path| {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                index
                    .entry(name.to_lowercase())
                    .or_insert_with(|| path.to_string_lossy().to_string());
            }
        });
        index
    })
    .await
    .map_err(|e| format!("Model scan failed: {}", e))?;

    let results: Vec<ModelLocalStatus> = filenames
        .iter()
        .map(|f| {
            let key = f.to_lowercase();
            match index.get(&key) {
                Some(path) => ModelLocalStatus {
                    filename: f.clone(),
                    found: true,
                    found_path: Some(path.clone()),
                },
                None => ModelLocalStatus {
                    filename: f.clone(),
                    found: false,
                    found_path: None,
                },
            }
        })
        .collect();

    let found_count = results.iter().filter(|r| r.found).count();
    info!("Local check: {}/{} found", found_count, results.len());

    Ok(results)
}

/// Deepest directory level scanned below the root.
const MAX_SCAN_DEPTH: usize = 16;

/// Calls `on_file` for every file below `root`. Symlinked / junctioned
/// directories are followed (common for ComfyUI model folders), but each real
/// directory is visited once, so link cycles cannot recurse forever.
fn walk_files(root: &Path, on_file: &mut dyn FnMut(&Path)) {
    let mut visited = HashSet::new();
    walk_dir(root, 0, &mut visited, on_file);
}

fn walk_dir(
    dir: &Path,
    depth: usize,
    visited: &mut HashSet<std::path::PathBuf>,
    on_file: &mut dyn FnMut(&Path),
) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }
    let real = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    if !visited.insert(real) {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            on_file(&path);
        } else if path.is_dir() {
            walk_dir(&path, depth + 1, visited, on_file);
        }
    }
}

// ── Scan workflow directory ──

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowFileInfo {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub modified: Option<String>,
}

#[tauri::command]
pub async fn scan_workflow_dir(comfyui_root: String) -> Result<Vec<WorkflowFileInfo>, String> {
    let root = Path::new(&comfyui_root);
    if !root.is_dir() {
        return Err(format!("ComfyUI root not found: {}", comfyui_root));
    }

    let candidate_dirs = [
        root.join("user").join("default").join("workflows"),
        root.join("user").join("workflows"),
        root.join("workflows"),
        root.join("output"),
    ];

    // `output/` can hold tens of thousands of files: scan off the async runtime.
    let mut results = tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        let mut seen_paths = HashSet::new();
        for dir in candidate_dirs.iter().filter(|d| d.is_dir()) {
            walk_files(dir, &mut |path| {
                collect_json_file(path, &mut results, &mut seen_paths)
            });
        }
        results
    })
    .await
    .map_err(|e| format!("Workflow scan failed: {}", e))?;

    results.sort_by(|a, b| b.modified.cmp(&a.modified));

    info!(
        "Scanned workflow dirs under {}: found {} JSON files",
        comfyui_root,
        results.len()
    );

    Ok(results)
}

fn collect_json_file(path: &Path, results: &mut Vec<WorkflowFileInfo>, seen: &mut HashSet<String>) {
    let is_json = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"));
    if !is_json {
        return;
    }
    let path_str = path.to_string_lossy().to_string();
    if !seen.insert(path_str.clone()) {
        return;
    }
    let meta = std::fs::metadata(path).ok();
    let size = meta.as_ref().map_or(0, |m| m.len());
    let modified = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs().to_string());
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    results.push(WorkflowFileInfo {
        path: path_str,
        filename,
        size,
        modified,
    });
}

#[cfg(test)]
mod tests {
    use super::{detect_and_extract, walk_files};

    fn temp_tree(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cd-walk-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("a").join("b")).unwrap();
        std::fs::write(dir.join("top.json"), b"{}").unwrap();
        std::fs::write(dir.join("a").join("b").join("deep.safetensors"), b"x").unwrap();
        dir
    }

    fn collect(root: &std::path::Path) -> Vec<String> {
        let mut names = Vec::new();
        walk_files(root, &mut |p| {
            names.push(p.file_name().unwrap().to_string_lossy().to_string())
        });
        names.sort();
        names
    }

    #[test]
    fn walks_nested_directories() {
        let dir = temp_tree("nested");
        assert_eq!(collect(&dir), vec!["deep.safetensors", "top.json"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_cycles_terminate() {
        let dir = temp_tree("cycle");
        // a/b/loop -> dir: without cycle detection this recurses forever.
        std::os::unix::fs::symlink(&dir, dir.join("a").join("b").join("loop")).unwrap();
        assert_eq!(collect(&dir), vec!["deep.safetensors", "top.json"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
    use serde_json::json;

    #[test]
    fn detects_api_workflow_models() {
        let workflow = json!({
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": "checkpoints/flux.safetensors"
                }
            },
            "2": {
                "class_type": "LoraLoader",
                "inputs": {
                    "lora_name": "loras/style.safetensors"
                }
            }
        });

        let (models, node_count, format) = detect_and_extract(&workflow);
        assert_eq!(format, "api");
        assert_eq!(node_count, 2);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].filename, "flux.safetensors");
        assert_eq!(models[1].filename, "style.safetensors");
    }

    #[test]
    fn detects_litegraph_workflow_models() {
        let workflow = json!({
            "nodes": [
                {
                    "type": "UNETLoader",
                    "widgets_values": ["models/unet/flux1-dev.safetensors"]
                }
            ],
            "links": []
        });

        let (models, node_count, format) = detect_and_extract(&workflow);
        assert_eq!(format, "litegraph");
        assert_eq!(node_count, 1);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].filename, "flux1-dev.safetensors");
        assert_eq!(
            models[0].model_type_hint.as_deref(),
            Some("diffusion_model")
        );
    }
}

use log::info;
use reqwest::header::AUTHORIZATION;
use serde::{Deserialize, Serialize};

/// Raw shape returned by GET /api/models (list) — kept private,
/// converted to the public `HfModelInfo` before sending to the frontend.
#[derive(Debug, Deserialize)]
struct RawHfModel {
    #[serde(default)]
    id: Option<String>,
    #[serde(rename = "modelId", default)]
    model_id: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    downloads: Option<u64>,
    #[serde(default)]
    likes: Option<u64>,
    #[serde(rename = "createdAt", default)]
    created_at: Option<String>,
    #[serde(rename = "lastModified", default)]
    last_modified: Option<String>,
    #[serde(rename = "pipeline_tag", default)]
    pipeline_tag: Option<String>,
    #[serde(default)]
    private: Option<bool>,
    #[serde(default)]
    library_name: Option<String>,
    #[serde(default)]
    siblings: Vec<RawHfFile>,
}

#[derive(Debug, Deserialize)]
struct RawHfFile {
    #[serde(default)]
    rfilename: Option<String>,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    lfs: Option<RawLfs>,
}

#[derive(Debug, Deserialize)]
struct RawLfs {
    #[serde(default)]
    size: Option<u64>,
}

impl RawHfModel {
    fn resolve_id(&self) -> String {
        self.model_id
            .clone()
            .or_else(|| self.id.clone())
            .unwrap_or_default()
    }

    fn resolve_author(&self) -> Option<String> {
        self.author.clone().or_else(|| {
            let id = self.resolve_id();
            id.split('/').next().map(|s| s.to_string())
        })
    }

    fn resolve_date(&self) -> Option<String> {
        self.last_modified
            .clone()
            .or_else(|| self.created_at.clone())
    }

    fn into_info(self) -> HfModelInfo {
        let model_id = self.resolve_id();
        let author = self.resolve_author();
        let last_modified = self.resolve_date();
        HfModelInfo {
            model_id,
            author,
            tags: self.tags,
            downloads: self.downloads.unwrap_or(0),
            likes: self.likes.unwrap_or(0),
            last_modified,
            pipeline_tag: self.pipeline_tag,
            private: self.private.unwrap_or(false),
            library_name: self.library_name,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HfModelInfo {
    pub model_id: String,
    pub author: Option<String>,
    pub tags: Vec<String>,
    pub downloads: u64,
    pub likes: u64,
    pub last_modified: Option<String>,
    pub pipeline_tag: Option<String>,
    pub private: bool,
    pub library_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HfSearchResponse {
    pub models: Vec<HfModelInfo>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct HfFilesResponse {
    pub model_id: String,
    pub files: Vec<HfFileEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HfFileEntry {
    pub filename: String,
    pub size: Option<u64>,
    pub download_url: String,
}

// ── Civitai types ──

#[derive(Debug, Clone, Serialize)]
pub struct CivitaiModelInfo {
    pub id: u64,
    pub name: String,
    pub model_type: String,
    pub creator: Option<String>,
    pub download_count: u64,
    pub thumbs_up_count: u64,
    pub tags: Vec<String>,
    pub nsfw: bool,
    pub thumbnail_url: Option<String>,
    pub model_versions: Vec<CivitaiVersionInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CivitaiVersionInfo {
    pub id: u64,
    pub name: String,
    pub base_model: Option<String>,
    pub files: Vec<CivitaiFileEntry>,
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CivitaiFileEntry {
    pub filename: String,
    pub size_kb: Option<f64>,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CivitaiSearchResponse {
    pub models: Vec<CivitaiModelInfo>,
    pub has_more: bool,
    /// Keyword searches only support cursor pagination (`page` is rejected).
    pub next_cursor: Option<String>,
}

fn parse_civitai_model(v: &serde_json::Value) -> Option<CivitaiModelInfo> {
    let id = v.get("id")?.as_u64()?;
    let name = v.get("name")?.as_str()?.to_string();
    let model_type = v
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("Unknown")
        .to_string();
    let creator = v
        .get("creator")
        .and_then(|c| c.get("username"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());
    let download_count = v
        .get("stats")
        .and_then(|s| s.get("downloadCount"))
        .and_then(|d| d.as_u64())
        .unwrap_or(0);
    let thumbs_up_count = v
        .get("stats")
        .and_then(|s| s.get("thumbsUpCount"))
        .and_then(|d| d.as_u64())
        .unwrap_or(0);
    let tags: Vec<String> = v
        .get("tags")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let nsfw = v.get("nsfw").and_then(|n| n.as_bool()).unwrap_or(false);

    let versions_raw = v.get("modelVersions").and_then(|mv| mv.as_array());

    let thumbnail_url = versions_raw.and_then(|vs| {
        vs.iter().find_map(|ver| {
            ver.get("images")
                .and_then(|imgs| imgs.as_array())
                .and_then(|imgs| {
                    imgs.iter().find_map(|img| {
                        img.get("url").and_then(|u| u.as_str()).map(|s| {
                            let url = s.to_string();
                            if url.contains("/original=true") {
                                url.replace("/original=true", "/width=200")
                            } else {
                                url
                            }
                        })
                    })
                })
        })
    });

    let model_versions: Vec<CivitaiVersionInfo> = versions_raw
        .map(|vs| vs.iter().filter_map(parse_civitai_version).collect())
        .unwrap_or_default();

    Some(CivitaiModelInfo {
        id,
        name,
        model_type,
        creator,
        download_count,
        thumbs_up_count,
        tags,
        nsfw,
        thumbnail_url,
        model_versions,
    })
}

fn parse_civitai_version(v: &serde_json::Value) -> Option<CivitaiVersionInfo> {
    let id = v.get("id")?.as_u64()?;
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("unknown")
        .to_string();
    let base_model = v
        .get("baseModel")
        .and_then(|b| b.as_str())
        .map(|s| s.to_string());
    let download_url = v
        .get("downloadUrl")
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());

    let files: Vec<CivitaiFileEntry> = v
        .get("files")
        .and_then(|f| f.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|file| {
                    let filename = file.get("name")?.as_str()?.to_string();
                    let size_kb = file.get("sizeKB").and_then(|s| s.as_f64());
                    let dl = file
                        .get("downloadUrl")
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string();
                    Some(CivitaiFileEntry {
                        filename,
                        size_kb,
                        download_url: dl,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Some(CivitaiVersionInfo {
        id,
        name,
        base_model,
        files,
        download_url,
    })
}

fn build_client(proxy: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder();
    if let Some(p) = proxy {
        if !p.is_empty() {
            let proxy_obj = reqwest::Proxy::all(p).map_err(|e| format!("Invalid proxy: {}", e))?;
            builder = builder.proxy(proxy_obj);
        }
    }
    builder
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))
}

const HF_API_BASE: &str = "https://huggingface.co/api";

// Arguments mirror the frontend invoke() payload 1:1; a params struct would
// change the IPC contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn search_hf_models(
    query: String,
    filter: Option<String>,
    sort: Option<String>,
    direction: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    proxy: Option<String>,
    token: Option<String>,
) -> Result<HfSearchResponse, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(HfSearchResponse {
            models: vec![],
            has_more: false,
        });
    }

    info!("Searching HF models: query={}", trimmed);

    let client = build_client(proxy.as_deref())?;
    let actual_limit = limit.unwrap_or(20).min(100);

    let mut request = client.get(format!("{}/models", HF_API_BASE)).query(&[
        ("search", trimmed.to_string()),
        ("limit", (actual_limit + 1).to_string()),
        ("sort", sort.unwrap_or_else(|| "downloads".to_string())),
        ("direction", direction.unwrap_or_else(|| "-1".to_string())),
    ]);

    if let Some(off) = offset {
        if off > 0 {
            request = request.query(&[("offset", off.to_string())]);
        }
    }

    if let Some(ref f) = filter {
        if !f.is_empty() {
            request = request.query(&[("filter", f.clone())]);
        }
    }

    if let Some(ref t) = token {
        if !t.is_empty() {
            request = request.header(AUTHORIZATION, format!("Bearer {}", t));
        }
    }

    let resp = request
        .send()
        .await
        .map_err(|e| format!("HF API request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HF API returned {}: {}", status, body));
    }

    let raw_items: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse HF API response: {}", e))?;

    let mut models: Vec<HfModelInfo> = raw_items
        .into_iter()
        .filter_map(|v| serde_json::from_value::<RawHfModel>(v).ok())
        .map(|r| r.into_info())
        .collect();

    let has_more = models.len() > actual_limit as usize;
    models.truncate(actual_limit as usize);

    info!("HF search returned {} models", models.len());

    Ok(HfSearchResponse { models, has_more })
}

#[tauri::command]
pub async fn get_hf_model_files(
    model_id: String,
    proxy: Option<String>,
    token: Option<String>,
) -> Result<HfFilesResponse, String> {
    if model_id.is_empty() {
        return Err("model_id is required".to_string());
    }

    info!("Fetching files for HF model: {}", model_id);

    let client = build_client(proxy.as_deref())?;

    // `blobs=true` is required for the API to include file sizes.
    let mut request = client
        .get(format!("{}/models/{}", HF_API_BASE, encode_path(&model_id)))
        .query(&[("blobs", "true")]);

    if let Some(ref t) = token {
        if !t.is_empty() {
            request = request.header(AUTHORIZATION, format!("Bearer {}", t));
        }
    }

    let resp = request
        .send()
        .await
        .map_err(|e| format!("HF API request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HF API returned {}: {}", status, body));
    }

    let detail: RawHfModel = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse HF model detail: {}", e))?;

    let files: Vec<HfFileEntry> = detail
        .siblings
        .into_iter()
        .filter_map(|f| {
            let filename = f.rfilename?;
            let size = f.lfs.and_then(|l| l.size).or(f.size);
            let download_url = format!(
                "https://huggingface.co/{}/resolve/main/{}",
                encode_path(&model_id),
                encode_path(&filename)
            );
            Some(HfFileEntry {
                filename,
                size,
                download_url,
            })
        })
        .collect();

    info!("Model {} has {} files", model_id, files.len());

    Ok(HfFilesResponse { model_id, files })
}

/// Percent-encodes each `/`-separated segment (repo ids and file paths may
/// contain spaces, `#`, `?` and other characters that break URLs).
fn encode_path(path: &str) -> String {
    path.split('/')
        .map(|seg| urlencoding::encode(seg).into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

// ── Civitai search command ──

const CIVITAI_API_BASE: &str = "https://civitai.com/api/v1";

// Arguments mirror the frontend invoke() payload 1:1; a params struct would
// change the IPC contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn search_civitai_models(
    query: String,
    types: Option<String>,
    sort: Option<String>,
    period: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
    proxy: Option<String>,
    civitai_token: Option<String>,
) -> Result<CivitaiSearchResponse, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(CivitaiSearchResponse {
            models: vec![],
            has_more: false,
            next_cursor: None,
        });
    }

    info!("Searching Civitai models: query={}", trimmed);

    let client = build_client(proxy.as_deref())?;
    let actual_limit = limit.unwrap_or(20).min(100);

    let mut params: Vec<(&str, String)> = vec![
        ("query", trimmed.to_string()),
        ("limit", actual_limit.to_string()),
        (
            "sort",
            sort.unwrap_or_else(|| "Most Downloaded".to_string()),
        ),
        ("period", period.unwrap_or_else(|| "AllTime".to_string())),
        ("nsfw", "false".to_string()),
    ];

    if let Some(ref t) = types {
        if !t.is_empty() {
            params.push(("types", t.clone()));
        }
    }

    if let Some(c) = cursor.filter(|c| !c.is_empty()) {
        params.push(("cursor", c));
    }

    let mut request = client
        .get(format!("{}/models", CIVITAI_API_BASE))
        .query(&params);

    if let Some(ref t) = civitai_token {
        if !t.is_empty() {
            request = request.header(AUTHORIZATION, format!("Bearer {}", t));
        }
    }

    let resp = request
        .send()
        .await
        .map_err(|e| format!("Civitai API request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Civitai API returned {}: {}", status, body));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Civitai API response: {}", e))?;

    let items = body
        .get("items")
        .and_then(|i| i.as_array())
        .cloned()
        .unwrap_or_default();

    let models: Vec<CivitaiModelInfo> = items.iter().filter_map(parse_civitai_model).collect();

    // The cursor may be a string or a number depending on the sort.
    let next_cursor = body
        .get("metadata")
        .and_then(|m| m.get("nextCursor"))
        .and_then(|c| match c {
            serde_json::Value::String(s) => Some(s.clone()),
            serde_json::Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .filter(|c| !c.is_empty());

    info!(
        "Civitai search returned {} models (more: {})",
        models.len(),
        next_cursor.is_some()
    );

    Ok(CivitaiSearchResponse {
        models,
        has_more: next_cursor.is_some(),
        next_cursor,
    })
}

#[cfg(test)]
mod tests {
    use super::encode_path;

    #[test]
    fn encodes_each_path_segment() {
        assert_eq!(encode_path("org/model"), "org/model");
        assert_eq!(
            encode_path("sub dir/my model#1.safetensors"),
            "sub%20dir/my%20model%231.safetensors"
        );
    }
}

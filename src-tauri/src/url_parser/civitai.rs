use super::ParseResult;
use log::info;
use regex::Regex;
use reqwest::header::{HeaderMap, AUTHORIZATION, CONTENT_DISPOSITION};
use serde_json::Value;

pub async fn parse(
    raw_url: &str,
    proxy: Option<&str>,
    token: Option<&str>,
) -> Result<ParseResult, String> {
    info!(
        "Parsing Civitai URL: {}",
        crate::safety::redact_url(raw_url)
    );

    let mut headers = HeaderMap::new();
    if let Some(t) = token {
        if !t.is_empty() {
            headers.insert(
                AUTHORIZATION,
                format!("Bearer {}", t)
                    .parse()
                    .map_err(|e| format!("Invalid token: {}", e))?,
            );
        }
    }

    let client = build_client(proxy, &headers)?;

    let mut version_id = extract_version_id(raw_url);
    // A model page without ?modelVersionId: use the model's latest version.
    if version_id.is_none() {
        if let Some(model_id) = extract_model_id(raw_url) {
            version_id = fetch_latest_version_id(&client, &model_id, token)
                .await
                .ok();
        }
    }
    // Model pages serve HTML; only /api/download/models/{version} is the file.
    let download_url = if raw_url.contains("/api/download/models/") {
        raw_url.to_string()
    } else if let Some(vid) = &version_id {
        format!("https://civitai.com/api/download/models/{}", vid)
    } else {
        return Err(
            "This Civitai link has no downloadable model version. Open the model page and copy \
             the Download link."
                .to_string(),
        );
    };

    let mut filename = String::new();
    let mut suggested_type = None;
    let mut file_size = None;
    let mut hash = None;

    if let Some(vid) = &version_id {
        if let Ok(metadata) = fetch_version_metadata(&client, vid, token).await {
            if let Some(t) = metadata
                .get("model")
                .and_then(|m| m.get("type"))
                .and_then(|t| t.as_str())
            {
                suggested_type = map_civitai_type(t);
            }

            if let Some(files) = metadata.get("files").and_then(|f| f.as_array()) {
                if let Some(primary) = files
                    .iter()
                    .find(|f| f.get("primary").and_then(|p| p.as_bool()).unwrap_or(false))
                    .or_else(|| files.first())
                {
                    if let Some(name) = primary.get("name").and_then(|n| n.as_str()) {
                        filename = name.to_string();
                    }
                    if let Some(size) = primary.get("sizeKB").and_then(|s| s.as_f64()) {
                        file_size = Some((size * 1024.0) as u64);
                    }
                    if let Some(hashes) = primary.get("hashes") {
                        if let Some(sha256) = hashes.get("SHA256").and_then(|h| h.as_str()) {
                            hash = Some(sha256.to_string());
                        }
                    }
                }
            }
        }
    }

    if filename.is_empty() {
        filename = fetch_filename_from_head(&client, &download_url, token).await?;
    }

    if suggested_type.is_none() {
        suggested_type = guess_type_from_filename(&filename);
    }

    Ok(ParseResult {
        download_url,
        filename,
        source: "civitai".to_string(),
        suggested_type,
        file_size,
        hash,
    })
}

fn extract_version_id(url: &str) -> Option<String> {
    let re = Regex::new(r"/api/download/models/(\d+)").ok()?;
    re.captures(url).map(|c| c[1].to_string()).or_else(|| {
        let re2 = Regex::new(r"modelVersionId=(\d+)").ok()?;
        re2.captures(url).map(|c| c[1].to_string())
    })
}

/// Model id from a model page link like `civitai.com/models/7808/easynegative`.
fn extract_model_id(url: &str) -> Option<String> {
    let re = Regex::new(r"civitai\.com/models/(\d+)").ok()?;
    re.captures(url).map(|c| c[1].to_string())
}

async fn fetch_latest_version_id(
    client: &reqwest::Client,
    model_id: &str,
    token: Option<&str>,
) -> Result<String, String> {
    let mut req = client.get(format!("https://civitai.com/api/v1/models/{}", model_id));
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        req = req.header(AUTHORIZATION, format!("Bearer {}", t));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Civitai model: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Civitai model returned {}", resp.status()));
    }
    let model: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Civitai model: {}", e))?;
    model
        .get("modelVersions")
        .and_then(|v| v.as_array())
        .and_then(|versions| versions.first())
        .and_then(|v| v.get("id"))
        .and_then(|id| id.as_u64())
        .map(|id| id.to_string())
        .ok_or_else(|| "Civitai model has no versions".to_string())
}

async fn fetch_version_metadata(
    client: &reqwest::Client,
    version_id: &str,
    token: Option<&str>,
) -> Result<Value, String> {
    let url = format!("https://civitai.com/api/v1/model-versions/{}", version_id);
    let mut req = client.get(&url);
    if let Some(t) = token {
        if !t.is_empty() {
            req = req.header(AUTHORIZATION, format!("Bearer {}", t));
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Civitai metadata: {}", e))?;
    // A 401/404 body is JSON too; don't mistake it for version metadata.
    if !resp.status().is_success() {
        return Err(format!("Civitai metadata returned {}", resp.status()));
    }
    resp.json::<Value>()
        .await
        .map_err(|e| format!("Failed to parse Civitai metadata: {}", e))
}

async fn fetch_filename_from_head(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
) -> Result<String, String> {
    let mut req = client.head(url);
    if let Some(t) = token {
        if !t.is_empty() {
            req = req.header(AUTHORIZATION, format!("Bearer {}", t));
        }
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("HEAD request failed: {}", e))?;

    if let Some(cd) = resp.headers().get(CONTENT_DISPOSITION) {
        if let Ok(cd_str) = cd.to_str() {
            if let Some(name) = extract_filename_from_content_disposition(cd_str) {
                return Ok(name);
            }
        }
    }

    let final_url = resp.url().to_string();
    Ok(url::Url::parse(&final_url)
        .ok()
        .and_then(|u| {
            u.path_segments()
                .and_then(|mut s| s.next_back().map(|l| l.to_string()))
        })
        .unwrap_or_else(|| "unknown_model".to_string()))
}

/// Prefers the RFC 5987 `filename*=charset'lang'percent-encoded` form (only it
/// is percent-decoded), then falls back to a plain or quoted `filename=`.
fn extract_filename_from_content_disposition(cd: &str) -> Option<String> {
    let extended = Regex::new(r#"(?i)filename\*\s*=\s*"?[\w-]*'[^']*'([^";]+)"?"#).ok()?;
    if let Some(c) = extended.captures(cd) {
        let raw = c[1].trim();
        return Some(
            urlencoding::decode(raw)
                .map(|s| s.into_owned())
                .unwrap_or_else(|_| raw.to_string()),
        );
    }

    let plain = Regex::new(r#"(?i)filename\s*=\s*(?:"([^"]+)"|([^;]+))"#).ok()?;
    plain.captures(cd).and_then(|c| {
        c.get(1)
            .or_else(|| c.get(2))
            .map(|m| m.as_str().trim().to_string())
            .filter(|s| !s.is_empty())
    })
}

fn map_civitai_type(civitai_type: &str) -> Option<String> {
    match civitai_type.to_lowercase().as_str() {
        "checkpoint" => Some("checkpoint".to_string()),
        "lora" | "loha" | "locon" => Some("lora".to_string()),
        "textualinversion" => Some("embedding".to_string()),
        "vae" => Some("vae".to_string()),
        "controlnet" => Some("controlnet".to_string()),
        "upscaler" => Some("upscale_model".to_string()),
        _ => None,
    }
}

fn guess_type_from_filename(filename: &str) -> Option<String> {
    let lower = filename.to_lowercase();
    if lower.contains("lora") || lower.contains("loha") || lower.contains("locon") {
        Some("lora".to_string())
    } else if lower.contains("vae") {
        Some("vae".to_string())
    } else if lower.contains("controlnet") || lower.contains("control_") {
        Some("controlnet".to_string())
    } else if lower.contains("upscale") || lower.contains("esrgan") || lower.contains("realesrgan")
    {
        Some("upscale_model".to_string())
    } else if lower.contains("ip-adapter") || lower.contains("ipadapter") {
        Some("ipadapter".to_string())
    } else if lower.contains("embed") || lower.ends_with(".pt") {
        Some("embedding".to_string())
    } else if lower.contains("clip") {
        Some("clip".to_string())
    } else if lower.contains("flux") || lower.contains("sd3") {
        Some("diffusion_model".to_string())
    } else if lower.ends_with(".safetensors") || lower.ends_with(".ckpt") {
        Some("checkpoint".to_string())
    } else {
        None
    }
}

fn build_client(proxy: Option<&str>, _headers: &HeaderMap) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::limited(10));

    if let Some(p) = proxy {
        if !p.is_empty() {
            let proxy_obj = reqwest::Proxy::all(p).map_err(|e| format!("Invalid proxy: {}", e))?;
            builder = builder.proxy(proxy_obj);
        }
    }

    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

#[cfg(test)]
mod tests {
    use super::{
        extract_filename_from_content_disposition, extract_model_id, extract_version_id,
        guess_type_from_filename, map_civitai_type,
    };

    #[test]
    fn extracts_model_id_from_model_pages_only() {
        assert_eq!(
            extract_model_id("https://civitai.com/models/7808/easynegative?modelVersionId=9208"),
            Some("7808".to_string())
        );
        assert_eq!(
            extract_model_id("https://civitai.com/api/download/models/9208"),
            None
        );
    }

    #[test]
    fn extracts_version_id_from_supported_urls() {
        assert_eq!(
            extract_version_id("https://civitai.com/api/download/models/12345"),
            Some("12345".to_string())
        );
        assert_eq!(
            extract_version_id("https://civitai.com/models/1/foo?modelVersionId=67890"),
            Some("67890".to_string())
        );
    }

    #[test]
    fn parses_content_disposition_filenames() {
        let filename = extract_filename_from_content_disposition(
            "attachment; filename*=UTF-8''flux%20model.safetensors",
        );
        assert_eq!(filename, Some("flux model.safetensors".to_string()));

        // Lower-case charset, and `filename*` wins over `filename`.
        assert_eq!(
            extract_filename_from_content_disposition(
                "attachment; filename=\"fallback.safetensors\"; filename*=utf-8''real%20name.safetensors"
            ),
            Some("real name.safetensors".to_string())
        );
        // Plain quoted names are taken literally, not percent-decoded.
        assert_eq!(
            extract_filename_from_content_disposition(
                "attachment; filename=\"100%25 real.safetensors\""
            ),
            Some("100%25 real.safetensors".to_string())
        );
        assert_eq!(
            extract_filename_from_content_disposition(
                "ATTACHMENT; FILENAME=easynegative.safetensors"
            ),
            Some("easynegative.safetensors".to_string())
        );
        assert_eq!(extract_filename_from_content_disposition("inline"), None);
    }

    #[test]
    fn maps_known_civitai_types() {
        assert_eq!(map_civitai_type("LoRA"), Some("lora".to_string()));
        assert_eq!(
            map_civitai_type("TextualInversion"),
            Some("embedding".to_string())
        );
        assert_eq!(map_civitai_type("unknown"), None);
    }

    #[test]
    fn guesses_types_from_filename_keywords() {
        assert_eq!(
            guess_type_from_filename("my-ip-adapter.safetensors"),
            Some("ipadapter".to_string())
        );
        assert_eq!(
            guess_type_from_filename("controlnet-xl.safetensors"),
            Some("controlnet".to_string())
        );
    }
}

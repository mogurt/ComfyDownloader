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

    let version_id = extract_version_id(raw_url);

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
        filename = fetch_filename_from_head(&client, raw_url, token).await?;
    }

    if suggested_type.is_none() {
        suggested_type = guess_type_from_filename(&filename);
    }

    Ok(ParseResult {
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
                .and_then(|s| s.last().map(|l| l.to_string()))
        })
        .unwrap_or_else(|| "unknown_model".to_string()))
}

fn extract_filename_from_content_disposition(cd: &str) -> Option<String> {
    let re = Regex::new(r#"filename\*?=(?:UTF-8''|"?)([^";]+)"?"#).ok()?;
    re.captures(cd).map(|c| {
        let name = c[1].to_string();
        urlencoding::decode(&name)
            .unwrap_or(name.clone().into())
            .to_string()
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
        extract_filename_from_content_disposition, extract_version_id, guess_type_from_filename,
        map_civitai_type,
    };

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

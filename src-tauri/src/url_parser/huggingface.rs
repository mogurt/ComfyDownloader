use super::ParseResult;
use log::info;
use url::Url;

pub async fn parse(raw_url: &str, proxy: Option<&str>) -> Result<ParseResult, String> {
    info!("Parsing HuggingFace URL: {}", raw_url);

    let url = Url::parse(raw_url).map_err(|e| format!("Invalid URL: {}", e))?;
    let path = url.path();

    let filename = extract_filename_from_path(path)
        .unwrap_or_else(|| extract_last_segment(path));

    let suggested_type = guess_type(&filename, path);

    let file_size = fetch_content_length(raw_url, proxy).await.ok();

    Ok(ParseResult {
        filename,
        source: "huggingface".to_string(),
        suggested_type,
        file_size,
        hash: None,
    })
}

fn extract_filename_from_path(path: &str) -> Option<String> {
    let patterns = ["/resolve/main/", "/resolve/", "/blob/main/"];
    for pattern in &patterns {
        if let Some(idx) = path.find(pattern) {
            let after = &path[idx + pattern.len()..];
            let filename = after.split('?').next().unwrap_or(after);
            if !filename.is_empty() {
                let decoded = urlencoding::decode(filename)
                    .unwrap_or(filename.into())
                    .to_string();
                return Some(decoded.rsplit('/').next().unwrap_or(&decoded).to_string());
            }
        }
    }
    None
}

fn extract_last_segment(path: &str) -> String {
    path.rsplit('/')
        .find(|s| !s.is_empty())
        .map(|s| urlencoding::decode(s).unwrap_or(s.into()).to_string())
        .unwrap_or_else(|| "unknown_model".to_string())
}

fn guess_type(filename: &str, path: &str) -> Option<String> {
    let lower = filename.to_lowercase();
    let path_lower = path.to_lowercase();
    let combined = format!("{} {}", lower, path_lower);

    if combined.contains("lora") || combined.contains("loha") {
        Some("lora".to_string())
    } else if combined.contains("vae") {
        Some("vae".to_string())
    } else if combined.contains("controlnet") || combined.contains("control_") {
        Some("controlnet".to_string())
    } else if combined.contains("upscale") || combined.contains("esrgan") {
        Some("upscale_model".to_string())
    } else if combined.contains("ip-adapter") || combined.contains("ipadapter") {
        Some("ipadapter".to_string())
    } else if combined.contains("text_encoder") || combined.contains("clip") {
        Some("clip".to_string())
    } else if combined.contains("embed") || lower.ends_with(".pt") {
        Some("embedding".to_string())
    } else if combined.contains("flux") || combined.contains("sd3") || combined.contains("unet") {
        Some("diffusion_model".to_string())
    } else if lower.ends_with(".safetensors") || lower.ends_with(".ckpt") || lower.ends_with(".bin") {
        Some("checkpoint".to_string())
    } else {
        None
    }
}

async fn fetch_content_length(url: &str, proxy: Option<&str>) -> Result<u64, String> {
    let mut builder = reqwest::Client::builder();
    if let Some(p) = proxy {
        if !p.is_empty() {
            let proxy_obj = reqwest::Proxy::all(p).map_err(|e| format!("Invalid proxy: {}", e))?;
            builder = builder.proxy(proxy_obj);
        }
    }
    let client = builder.build().map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client
        .head(url)
        .send()
        .await
        .map_err(|e| format!("HEAD request failed: {}", e))?;

    resp.headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or_else(|| "No content-length header".to_string())
}

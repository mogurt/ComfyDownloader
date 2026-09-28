use super::ParseResult;
use log::info;
use url::Url;

pub async fn parse(raw_url: &str, proxy: Option<&str>) -> Result<ParseResult, String> {
    info!(
        "Parsing generic URL: {}",
        crate::safety::redact_url(raw_url)
    );

    let url = Url::parse(raw_url).map_err(|e| format!("Invalid URL: {}", e))?;

    let filename = url
        .path_segments()
        .and_then(|s| s.last())
        .filter(|s| !s.is_empty() && s.contains('.'))
        .map(|s| urlencoding::decode(s).unwrap_or(s.into()).to_string())
        .unwrap_or_else(|| fetch_filename_fallback(raw_url));

    let suggested_type = guess_type(&filename);

    let file_size = fetch_content_length(raw_url, proxy).await.ok();

    Ok(ParseResult {
        filename,
        source: "generic".to_string(),
        suggested_type,
        file_size,
        hash: None,
    })
}

fn fetch_filename_fallback(_url: &str) -> String {
    "unknown_model.safetensors".to_string()
}

fn guess_type(filename: &str) -> Option<String> {
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
    } else if lower.contains("clip") {
        Some("clip".to_string())
    } else if lower.contains("embed") || lower.ends_with(".pt") {
        Some("embedding".to_string())
    } else if lower.contains("flux") || lower.contains("sd3") {
        Some("diffusion_model".to_string())
    } else if lower.ends_with(".safetensors")
        || lower.ends_with(".ckpt")
        || lower.ends_with(".gguf")
    {
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
    let client = builder
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

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

pub mod civitai;
pub mod generic;
pub mod huggingface;

use crate::safety::{host_matches, sanitize_filename};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResult {
    pub filename: String,
    pub source: String,
    pub suggested_type: Option<String>,
    pub file_size: Option<u64>,
    pub hash: Option<String>,
}

pub async fn parse_url(
    raw_url: &str,
    proxy: Option<&str>,
    civitai_token: Option<&str>,
    huggingface_token: Option<&str>,
) -> Result<ParseResult, String> {
    let url = Url::parse(raw_url).map_err(|e| format!("Invalid URL: {}", e))?;
    let host = url.host_str().unwrap_or("");

    let mut result = if host_matches(host, "civitai.com") {
        civitai::parse(raw_url, proxy, civitai_token).await
    } else if host_matches(host, "huggingface.co") || host_matches(host, "hf-mirror.com") {
        huggingface::parse(raw_url, proxy, huggingface_token).await
    } else {
        generic::parse(raw_url, proxy).await
    }?;

    // Filenames come from remote URLs / headers / metadata and must never
    // be able to point outside the target directory.
    result.filename =
        sanitize_filename(&result.filename).unwrap_or_else(|| "unknown_model".to_string());
    Ok(result)
}

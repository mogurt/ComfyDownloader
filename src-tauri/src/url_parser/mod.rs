pub mod civitai;
pub mod huggingface;
pub mod generic;

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

    if host.contains("civitai.com") {
        civitai::parse(raw_url, proxy, civitai_token).await
    } else if host.contains("huggingface.co") || host.contains("hf-mirror.com") {
        huggingface::parse(raw_url, proxy, huggingface_token).await
    } else {
        generic::parse(raw_url, proxy).await
    }
}

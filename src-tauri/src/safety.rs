//! Helpers for handling untrusted input: remote filenames, hosts, and URLs that
//! may carry credentials.

use url::Url;

const WINDOWS_RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

const SENSITIVE_QUERY_KEYS: [&str; 5] = ["token", "access_token", "api_key", "apikey", "key"];

/// Turns an untrusted (remote-supplied) name into a plain file name that cannot
/// escape the download directory. Returns `None` if nothing usable remains.
pub fn sanitize_filename(raw: &str) -> Option<String> {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw);

    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();

    // Windows silently strips trailing dots and spaces.
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();

    if cleaned.is_empty() || cleaned.chars().all(|c| c == '.' || c == '_') {
        return None;
    }

    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    if WINDOWS_RESERVED_NAMES.contains(&stem.as_str()) {
        return Some(format!("_{}", cleaned));
    }

    Some(cleaned)
}

/// Validates a file name coming from the frontend. Unlike [`sanitize_filename`]
/// this rejects instead of rewriting, so the stored name always matches the file on disk.
pub fn validate_filename(name: &str) -> Result<(), String> {
    match sanitize_filename(name) {
        Some(clean) if clean == name => Ok(()),
        _ => Err(format!("Invalid file name: {}", name)),
    }
}

/// True if `host` is `domain` itself or one of its subdomains.
pub fn host_matches(host: &str, domain: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == domain || host.ends_with(&format!(".{}", domain))
}

/// Masks credential-looking query parameters so a URL is safe to log.
pub fn redact_url(raw: &str) -> String {
    let Ok(mut url) = Url::parse(raw) else {
        return raw.to_string();
    };
    if url.query().is_none() {
        return raw.to_string();
    }

    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .map(|(k, v)| {
            let value = if SENSITIVE_QUERY_KEYS.contains(&k.to_ascii_lowercase().as_str()) {
                "***".to_string()
            } else {
                v.into_owned()
            };
            (k.into_owned(), value)
        })
        .collect();

    url.query_pairs_mut().clear().extend_pairs(pairs);
    url.to_string()
}

/// Redacts any URLs embedded in a free-form log line (e.g. aria2 output).
pub fn redact_text(text: &str) -> String {
    text.split(' ')
        .map(|part| {
            if part.contains("://") && part.contains('?') {
                let start = part.find("http").unwrap_or(0);
                format!("{}{}", &part[..start], redact_url(&part[start..]))
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_traversal_and_separators() {
        assert_eq!(
            sanitize_filename("../../Startup/a.bat").as_deref(),
            Some("a.bat")
        );
        assert_eq!(
            sanitize_filename("..\\..\\evil.dll").as_deref(),
            Some("evil.dll")
        );
        assert_eq!(
            sanitize_filename("C:\\Windows\\x.dll").as_deref(),
            Some("x.dll")
        );
        assert_eq!(sanitize_filename("/etc/passwd").as_deref(), Some("passwd"));
    }

    #[test]
    fn sanitize_rejects_empty_and_dot_names() {
        assert_eq!(sanitize_filename(""), None);
        assert_eq!(sanitize_filename(".."), None);
        assert_eq!(sanitize_filename("foo/.."), None);
        assert_eq!(sanitize_filename("dir/"), None);
    }

    #[test]
    fn sanitize_replaces_illegal_chars_and_reserved_names() {
        assert_eq!(
            sanitize_filename("a:b?c*.safetensors").as_deref(),
            Some("a_b_c_.safetensors")
        );
        assert_eq!(sanitize_filename("model. ").as_deref(), Some("model"));
        assert_eq!(sanitize_filename("con.txt").as_deref(), Some("_con.txt"));
        assert_eq!(
            sanitize_filename("my model.safetensors").as_deref(),
            Some("my model.safetensors")
        );
    }

    #[test]
    fn validate_only_accepts_clean_names() {
        assert!(validate_filename("flux1-dev.safetensors").is_ok());
        assert!(validate_filename("../x.safetensors").is_err());
        assert!(validate_filename("C:\\x.safetensors").is_err());
        assert!(validate_filename("").is_err());
    }

    #[test]
    fn host_matching_is_exact() {
        assert!(host_matches("civitai.com", "civitai.com"));
        assert!(host_matches("www.civitai.com", "civitai.com"));
        assert!(host_matches("CIVITAI.COM.", "civitai.com"));
        assert!(!host_matches("civitai.com.evil.net", "civitai.com"));
        assert!(!host_matches("evilcivitai.com", "civitai.com"));
    }

    #[test]
    fn redacts_tokens_in_urls_and_text() {
        let redacted =
            redact_url("https://civitai.com/api/download/models/1?type=Model&token=abc123");
        assert!(!redacted.contains("abc123"));
        assert!(redacted.contains("type=Model"));

        let line = redact_text("Download aborted. URI=https://civitai.com/x?token=secret done");
        assert!(!line.contains("secret"));
        assert!(line.starts_with("Download aborted. URI=https://civitai.com/x?token="));

        assert_eq!(
            redact_url("https://example.com/a.bin"),
            "https://example.com/a.bin"
        );
    }
}

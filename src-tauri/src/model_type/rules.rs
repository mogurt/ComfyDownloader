use super::ModelType;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRule {
    pub id: i64,
    pub rule_type: String,
    pub keyword: String,
    pub model_type: String,
    pub priority: i32,
    pub enabled: bool,
}

pub fn suggest_model_type(
    filename: &str,
    url: &str,
    api_type: Option<&str>,
    user_rules: &[UserRule],
) -> String {
    let mut sorted_rules: Vec<&UserRule> = user_rules.iter().filter(|r| r.enabled).collect();
    sorted_rules.sort_by(|a, b| b.priority.cmp(&a.priority));

    for rule in &sorted_rules {
        let haystack = match rule.rule_type.as_str() {
            "filename" => filename.to_lowercase(),
            "url" => url.to_lowercase(),
            _ => continue,
        };
        if haystack.contains(&rule.keyword.to_lowercase()) {
            return rule.model_type.clone();
        }
    }

    if let Some(t) = api_type {
        if ModelType::from_str(t).is_some() {
            return t.to_string();
        }
    }

    builtin_suggest(filename, url)
}

fn builtin_suggest(filename: &str, url: &str) -> String {
    let combined = format!("{} {}", filename, url).to_lowercase();

    let rules: Vec<(&[&str], &str)> = vec![
        (&["lora", "loha", "locon"], "lora"),
        (&["vae"], "vae"),
        (&["controlnet", "control_v11", "control_"], "controlnet"),
        (
            &["upscale", "esrgan", "realesrgan", "swinir"],
            "upscale_model",
        ),
        (&["ip-adapter", "ipadapter", "ip_adapter"], "ipadapter"),
        (&["text_encoder", "clip_l", "clip_g", "t5xxl"], "clip"),
        (&["embedding", "embed", "textual_inversion"], "embedding"),
        (&["flux", "sd3", "unet", "diffusion"], "diffusion_model"),
    ];

    for (keywords, model_type) in &rules {
        for kw in *keywords {
            if combined.contains(kw) {
                return model_type.to_string();
            }
        }
    }

    if filename.to_lowercase().ends_with(".pt") {
        return "embedding".to_string();
    }

    if filename.to_lowercase().ends_with(".safetensors")
        || filename.to_lowercase().ends_with(".ckpt")
        || filename.to_lowercase().ends_with(".gguf")
    {
        return "checkpoint".to_string();
    }

    "custom".to_string()
}

#[cfg(test)]
mod tests {
    use super::{builtin_suggest, suggest_model_type, UserRule};

    #[test]
    fn user_rules_take_priority_over_builtin_logic() {
        let rules = vec![UserRule {
            id: 1,
            rule_type: "filename".to_string(),
            keyword: "special".to_string(),
            model_type: "vae".to_string(),
            priority: 10,
            enabled: true,
        }];

        let guessed = suggest_model_type("my-special-model.safetensors", "", None, &rules);
        assert_eq!(guessed, "vae");
    }

    #[test]
    fn disabled_rules_are_ignored() {
        let rules = vec![UserRule {
            id: 1,
            rule_type: "filename".to_string(),
            keyword: "special".to_string(),
            model_type: "vae".to_string(),
            priority: 10,
            enabled: false,
        }];

        let guessed = suggest_model_type("my-special-model.safetensors", "", None, &rules);
        assert_eq!(guessed, "checkpoint");
    }

    #[test]
    fn api_type_is_used_when_valid() {
        let guessed = suggest_model_type("anything.bin", "", Some("controlnet"), &[]);
        assert_eq!(guessed, "controlnet");
    }

    #[test]
    fn builtin_suggest_handles_common_model_names() {
        assert_eq!(
            builtin_suggest("flux-unet.safetensors", ""),
            "diffusion_model"
        );
        assert_eq!(builtin_suggest("style-lora.safetensors", ""), "lora");
        assert_eq!(builtin_suggest("random-file.txt", ""), "custom");
    }
}

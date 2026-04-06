pub mod rules;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ModelType {
    Checkpoint,
    DiffusionModel,
    Lora,
    Vae,
    Embedding,
    Controlnet,
    UpscaleModel,
    Clip,
    Ipadapter,
    Custom,
}

impl ModelType {
    pub fn as_str(&self) -> &str {
        match self {
            ModelType::Checkpoint => "checkpoint",
            ModelType::DiffusionModel => "diffusion_model",
            ModelType::Lora => "lora",
            ModelType::Vae => "vae",
            ModelType::Embedding => "embedding",
            ModelType::Controlnet => "controlnet",
            ModelType::UpscaleModel => "upscale_model",
            ModelType::Clip => "clip",
            ModelType::Ipadapter => "ipadapter",
            ModelType::Custom => "custom",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "checkpoint" => Some(ModelType::Checkpoint),
            "diffusion_model" => Some(ModelType::DiffusionModel),
            "lora" => Some(ModelType::Lora),
            "vae" => Some(ModelType::Vae),
            "embedding" => Some(ModelType::Embedding),
            "controlnet" => Some(ModelType::Controlnet),
            "upscale_model" => Some(ModelType::UpscaleModel),
            "clip" => Some(ModelType::Clip),
            "ipadapter" => Some(ModelType::Ipadapter),
            "custom" => Some(ModelType::Custom),
            _ => None,
        }
    }

    pub fn all_types() -> Vec<ModelType> {
        vec![
            ModelType::Checkpoint,
            ModelType::DiffusionModel,
            ModelType::Lora,
            ModelType::Vae,
            ModelType::Embedding,
            ModelType::Controlnet,
            ModelType::UpscaleModel,
            ModelType::Clip,
            ModelType::Ipadapter,
            ModelType::Custom,
        ]
    }

    pub fn default_subdir(&self) -> &str {
        match self {
            ModelType::Checkpoint => "models/checkpoints",
            ModelType::DiffusionModel => "models/diffusion_models",
            ModelType::Lora => "models/loras",
            ModelType::Vae => "models/vae",
            ModelType::Embedding => "models/embeddings",
            ModelType::Controlnet => "models/controlnet",
            ModelType::UpscaleModel => "models/upscale_models",
            ModelType::Clip => "models/clip",
            ModelType::Ipadapter => "models/ipadapter",
            ModelType::Custom => "models/custom",
        }
    }
}

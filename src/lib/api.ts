import { invoke } from "@tauri-apps/api/core";
import type {
  ParseResult,
  ModelTypeInfo,
  DirMapping,
  Aria2Status,
} from "./types";

/**
 * Safely extract a path string from the dialog plugin return value.
 * tauri-plugin-dialog may return a plain string, an object with a `path`
 * property, or null depending on version and platform.
 */
export function extractPath(selected: unknown): string | null {
  if (selected == null) return null;
  if (typeof selected === "string") return selected;
  if (typeof selected === "object") {
    const obj = selected as Record<string, unknown>;
    if (typeof obj.path === "string") return obj.path;
    if (typeof obj.Path === "string") return obj.Path;
    if (typeof obj.url === "string") return obj.url;
    if (typeof obj.Url === "string") return obj.Url;
  }
  const str = String(selected);
  if (str && str !== "[object Object]") return str;
  console.warn("[ComfyDownloader] Unexpected dialog return value:", selected);
  return null;
}

export async function isAria2Ready(): Promise<boolean> {
  return invoke("is_aria2_ready");
}

export async function parseDownloadUrl(
  url: string,
  proxy?: string,
  civitaiToken?: string,
  huggingfaceToken?: string
): Promise<ParseResult> {
  return invoke("parse_download_url", {
    url,
    proxy: proxy || null,
    civitaiToken: civitaiToken || null,
    huggingfaceToken: huggingfaceToken || null,
  });
}

export async function suggestType(
  filename: string,
  url: string,
  apiType?: string,
  rulesJson?: string
): Promise<string> {
  return invoke("suggest_type", {
    filename,
    url,
    apiType: apiType || null,
    rulesJson: rulesJson || "[]",
  });
}

export async function checkFileExists(
  dir: string,
  filename: string
): Promise<boolean> {
  return invoke("check_file_exists", { dir, filename });
}

export async function createDownload(
  url: string,
  dir: string,
  filename: string,
  headers?: string[]
): Promise<string> {
  return invoke("create_download", {
    url,
    dir,
    filename,
    headers: headers || null,
  });
}

export async function pauseDownload(gid: string): Promise<string> {
  return invoke("pause_download", { gid });
}

export async function resumeDownload(gid: string): Promise<string> {
  return invoke("resume_download", { gid });
}

export async function cancelDownload(gid: string): Promise<string> {
  return invoke("cancel_download", { gid });
}

export async function getDownloadStatus(gid: string): Promise<Aria2Status> {
  return invoke("get_download_status", { gid });
}

export async function getActiveDownloads(): Promise<Aria2Status[]> {
  return invoke("get_active_downloads");
}

export async function applyAria2RuntimeSettings(
  maxConcurrent: number,
  maxConnections: number,
  proxy?: string
): Promise<void> {
  return invoke("apply_aria2_runtime_settings", {
    maxConcurrent,
    maxConnections,
    proxy: proxy ?? "",
  });
}

export async function getModelTypes(): Promise<ModelTypeInfo[]> {
  return invoke("get_model_types");
}

export async function getDefaultDirMappings(
  comfyuiRoot: string
): Promise<DirMapping[]> {
  return invoke("get_default_dir_mappings", { comfyuiRoot });
}

export async function checkComfyuiStatus(
  serverUrl: string
): Promise<{ online: boolean; message: string }> {
  return invoke("check_comfyui_status", { serverUrl });
}

export async function verifyModelInComfyui(
  serverUrl: string,
  filename: string
): Promise<boolean> {
  return invoke("verify_model_in_comfyui", { serverUrl, filename });
}

export async function listSubdirs(baseDir: string): Promise<string[]> {
  return invoke("list_subdirs", { baseDir });
}

export async function resolveRelativeSubdir(
  baseDir: string,
  relativeSubdir: string
): Promise<string> {
  return invoke("resolve_relative_subdir", { baseDir, relativeSubdir });
}

export async function openDirectory(path: string): Promise<void> {
  return invoke("open_directory", { path });
}

const TYPE_TO_DIRNAME: Record<string, string[]> = {
  checkpoint: ["checkpoints", "checkpoint", "ckpt"],
  diffusion_model: ["diffusion_models", "diffusion_model", "unet"],
  lora: ["loras", "lora", "loha", "locon"],
  vae: ["vae"],
  embedding: ["embeddings", "embedding", "textual_inversion"],
  controlnet: ["controlnet", "controlnets"],
  upscale_model: ["upscale_models", "upscale", "esrgan"],
  clip: ["clip", "text_encoders", "text_encoder"],
  ipadapter: ["ipadapter", "ip-adapter"],
};

export function matchSubdir(
  suggestedType: string | null,
  subdirs: string[]
): string | null {
  if (!suggestedType || subdirs.length === 0) return null;

  const candidates = TYPE_TO_DIRNAME[suggestedType] || [suggestedType];

  const exactDir = subdirs.find((d) => d.toLowerCase() === suggestedType.toLowerCase());
  if (exactDir) return exactDir;

  for (const candidate of candidates) {
    const found = subdirs.find((d) => d.toLowerCase() === candidate);
    if (found) return found;
  }

  return null;
}

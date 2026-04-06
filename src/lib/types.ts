export type ModelType =
  | "checkpoint"
  | "diffusion_model"
  | "lora"
  | "vae"
  | "embedding"
  | "controlnet"
  | "upscale_model"
  | "clip"
  | "ipadapter"
  | "custom";

export interface ParseResult {
  filename: string;
  source: string;
  suggested_type: string | null;
  file_size: number | null;
  hash: string | null;
}

export interface DownloadTask {
  id: number;
  gid: string;
  url: string;
  filename: string;
  source: string;
  model_type: string;
  target_dir: string;
  file_size: number | null;
  downloaded_size?: number | null;
  last_active_at?: string | null;
  runtime_phase?: RuntimeTaskPhase | null;
  allocation_progress?: number | null;
  status: TaskStatus;
  progress: number;
  speed: number;
  hash: string | null;
  error_msg: string | null;
  created_at: string;
  completed_at: string | null;
}

export type TaskStatus =
  | "pending"
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "skipped";

export type RuntimeTaskPhase = "allocating";

export type DisplayTaskStatus = TaskStatus | RuntimeTaskPhase;

export interface DirMapping {
  model_type: string;
  directory: string;
}

export interface ModelTypeInfo {
  value: string;
  label: string;
  default_subdir: string;
}

export interface AppSettings {
  comfyui_root: string;
  comfyui_server: string;
  model_base_dir: string;
  language: AppLanguage;
  theme: "light" | "dark" | "system";
  aria2_max_concurrent: string;
  aria2_max_connections: string;
  proxy: string;
  civitai_api_token: string;
  duplicate_strategy: string;
  download_speed_limit: string;
  auto_verify_comfyui: string;
}

export type AppLanguage = "en" | "zh";

export interface UserRule {
  id: number;
  rule_type: "filename" | "url";
  keyword: string;
  model_type: string;
  priority: number;
  enabled: boolean;
  created_at: string;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  taskId?: number | null;
  gid?: string | null;
}

export type TaskListFilter =
  | "all"
  | "active"
  | "queued"
  | "paused"
  | "failed"
  | "completed";

export interface TaskSummary {
  total: number;
  downloading: number;
  queued: number;
  paused: number;
  failed: number;
  completed: number;
}

export interface Aria2Status {
  gid: string;
  status: string;
  totalLength: string | null;
  completedLength: string | null;
  downloadSpeed: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  dir: string | null;
  files: Array<{
    path: string | null;
    length: string | null;
  }> | null;
}

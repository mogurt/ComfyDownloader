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
  huggingface_token: string;
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

// --- Hugging Face Search ---

export interface HfModelInfo {
  model_id: string;
  author: string | null;
  tags: string[];
  downloads: number;
  likes: number;
  last_modified: string | null;
  pipeline_tag: string | null;
  private: boolean;
  library_name: string | null;
}

export interface HfSearchResponse {
  models: HfModelInfo[];
  has_more: boolean;
}

export interface HfFileEntry {
  filename: string;
  size: number | null;
  download_url: string;
}

export interface HfFilesResponse {
  model_id: string;
  files: HfFileEntry[];
}

export interface HfSearchParams {
  query: string;
  filter?: string;
  sort?: string;
  direction?: string;
  limit?: number;
  offset?: number;
}

// --- Civitai Search ---

export interface CivitaiModelInfo {
  id: number;
  name: string;
  model_type: string;
  creator: string | null;
  download_count: number;
  thumbs_up_count: number;
  tags: string[];
  nsfw: boolean;
  thumbnail_url: string | null;
  model_versions: CivitaiVersionInfo[];
}

export interface CivitaiVersionInfo {
  id: number;
  name: string;
  base_model: string | null;
  files: CivitaiFileEntry[];
  download_url: string | null;
}

export interface CivitaiFileEntry {
  filename: string;
  size_kb: number | null;
  download_url: string;
}

export interface CivitaiSearchResponse {
  models: CivitaiModelInfo[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface CivitaiSearchParams {
  query: string;
  types?: string;
  sort?: string;
  period?: string;
  limit?: number;
  /** Cursor from the previous response; keyword searches can't use pages. */
  cursor?: string;
}

// --- Unified Search ---

export interface SearchResultItem {
  source: "huggingface" | "civitai";
  id: string;
  name: string;
  author: string | null;
  downloads: number;
  likes: number;
  tags: string[];
  model_type: string | null;
  last_modified: string | null;
  thumbnail_url: string | null;
  hf?: HfModelInfo;
  civitai?: CivitaiModelInfo;
}

// --- Workflow Parser ---

export interface WorkflowModelRef {
  filename: string;
  model_type_hint: string | null;
  node_type: string | null;
}

export interface ParseWorkflowResult {
  models: WorkflowModelRef[];
  node_count: number;
  format: string;
}

export interface ModelLocalStatus {
  filename: string;
  found: boolean;
  found_path: string | null;
}

export interface WorkflowFileInfo {
  path: string;
  filename: string;
  size: number;
  modified: string | null;
}

export interface WorkflowAnalysis {
  source_name: string;
  node_count: number;
  format: string;
  models: WorkflowModelRef[];
  local_status: ModelLocalStatus[];
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

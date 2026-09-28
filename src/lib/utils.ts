import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Joins path segments using the separator style already present in the base path. */
export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const segments = parts.filter(Boolean).map((p) => p.replace(/^[\/]+|[\/]+$/g, ""));
  return [base.replace(/[\/]+$/, ""), ...segments].join(sep);
}

/** The configured model base dir, or `<comfyui_root>/models` when unset. */
export function getModelBaseDir(settings: { model_base_dir: string; comfyui_root: string }): string {
  if (settings.model_base_dir) return settings.model_base_dir;
  return settings.comfyui_root ? joinPath(settings.comfyui_root, "models") : "";
}

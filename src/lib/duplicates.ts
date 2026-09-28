import * as api from "@/lib/api";

export type DuplicateResolution =
  | { action: "download"; filename: string; renamedFrom?: string }
  | { action: "skip" };

/**
 * Applies the duplicate-file strategy for a download target. "rename" picks the
 * next free `name (n).ext`; anything else (including the retired "overwrite")
 * skips existing files.
 */
export async function resolveDuplicate(
  dir: string,
  filename: string,
  strategy: string
): Promise<DuplicateResolution> {
  const exists = await api.checkFileExists(dir, filename);
  if (!exists) return { action: "download", filename };
  if (strategy === "rename") {
    return {
      action: "download",
      filename: await api.uniqueFilename(dir, filename),
      renamedFrom: filename,
    };
  }
  return { action: "skip" };
}

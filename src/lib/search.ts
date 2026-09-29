import type { SearchResultItem } from "@/lib/types";

export type SortOption = "downloads" | "likes" | "lastModified";

/**
 * Merges the per-source result lists (each already ordered by its API).
 * Downloads and likes are comparable across sources; Civitai results carry no
 * modification date, so for "newest" the two lists are interleaved instead.
 */
export function mergeResults(hf: SearchResultItem[], civitai: SearchResultItem[], sort: SortOption): SearchResultItem[] {
  if (sort === "downloads") return [...hf, ...civitai].sort((a, b) => b.downloads - a.downloads);
  if (sort === "likes") return [...hf, ...civitai].sort((a, b) => b.likes - a.likes);
  const merged: SearchResultItem[] = [];
  for (let i = 0; i < Math.max(hf.length, civitai.length); i++) {
    if (i < hf.length) merged.push(hf[i]);
    if (i < civitai.length) merged.push(civitai[i]);
  }
  return merged;
}

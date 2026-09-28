import { describe, expect, it } from "vitest";
import { mergeResults } from "./search";
import type { SearchResultItem } from "./types";

const item = (source: "huggingface" | "civitai", id: string, downloads: number, likes: number): SearchResultItem => ({
  source,
  id,
  name: id,
  author: null,
  downloads,
  likes,
  tags: [],
  model_type: null,
  last_modified: null,
  thumbnail_url: null,
});

const hf = [item("huggingface", "hf-a", 500, 1), item("huggingface", "hf-b", 100, 90)];
const civitai = [item("civitai", "cv-a", 300, 50), item("civitai", "cv-b", 50, 5)];
const ids = (items: SearchResultItem[]) => items.map((i) => i.id);

describe("mergeResults", () => {
  it("sorts by downloads", () => {
    expect(ids(mergeResults(hf, civitai, "downloads"))).toEqual(["hf-a", "cv-a", "hf-b", "cv-b"]);
  });

  it("sorts by likes instead of falling back to downloads", () => {
    expect(ids(mergeResults(hf, civitai, "likes"))).toEqual(["hf-b", "cv-a", "cv-b", "hf-a"]);
  });

  it("interleaves the per-source API order for 'newest'", () => {
    expect(ids(mergeResults(hf, civitai, "lastModified"))).toEqual(["hf-a", "cv-a", "hf-b", "cv-b"]);
    expect(ids(mergeResults(hf, [], "lastModified"))).toEqual(["hf-a", "hf-b"]);
  });

  it("does not mutate its inputs", () => {
    mergeResults(hf, civitai, "likes");
    expect(ids(hf)).toEqual(["hf-a", "hf-b"]);
  });
});

import { create } from "zustand";
import type {
  HfFileEntry,
  HfModelInfo,
  HfSearchParams,
  SearchResultItem,
  CivitaiSearchParams,
  CivitaiModelInfo,
  CivitaiVersionInfo,
} from "@/lib/types";
import * as api from "@/lib/api";
import { useSettingsStore } from "@/stores/settingsStore";

export type SortOption = "downloads" | "likes" | "lastModified";
export type SourceFilter = "all" | "huggingface" | "civitai";

interface SearchState {
  query: string;
  sort: SortOption;
  filter: string;
  sourceFilter: SourceFilter;
  results: SearchResultItem[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;

  hfHasMore: boolean;
  hfOffset: number;
  civitaiHasMore: boolean;
  civitaiCursor: string | null;

  expandedModelId: string | null;
  modelFiles: Record<string, HfFileEntry[]>;
  loadingFiles: string | null;
  selectedVersions: Record<string, number>;

  setQuery: (query: string) => void;
  setSort: (sort: SortOption) => void;
  setFilter: (filter: string) => void;
  setSourceFilter: (source: SourceFilter) => void;
  search: () => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => void;

  toggleModelFiles: (modelId: string) => Promise<void>;
  collapseFiles: () => void;
  selectVersion: (modelId: string, versionId: number) => void;
}

const PAGE_SIZE = 20;

function mapCivitaiToUnified(m: CivitaiModelInfo): SearchResultItem {
  return {
    source: "civitai",
    id: String(m.id),
    name: m.name,
    author: m.creator,
    downloads: m.download_count,
    likes: m.thumbs_up_count,
    tags: m.tags,
    model_type: m.model_type,
    last_modified: null,
    thumbnail_url: m.thumbnail_url,
    civitai: m,
  };
}

function civitaiVersionToFiles(ver: CivitaiVersionInfo): HfFileEntry[] {
  return ver.files.map((f) => ({
    filename: f.filename,
    size: f.size_kb != null ? Math.round(f.size_kb * 1024) : null,
    download_url: f.download_url,
  }));
}

function mapCivitaiSortOption(sort: SortOption): string {
  switch (sort) {
    case "downloads":
      return "Most Downloaded";
    case "likes":
      return "Highest Rated";
    case "lastModified":
      return "Newest";
    default:
      return "Most Downloaded";
  }
}

function mapFilterToCivitaiType(filter: string): string | undefined {
  const map: Record<string, string> = {
    lora: "LORA",
    checkpoint: "Checkpoint",
    vae: "VAE",
    embedding: "TextualInversion",
    controlnet: "Controlnet",
    upscale_model: "Upscaler",
  };
  return map[filter];
}

function mapHfToUnified(m: HfModelInfo): SearchResultItem {
  return {
    source: "huggingface",
    id: m.model_id,
    name: m.model_id,
    author: m.author,
    downloads: m.downloads,
    likes: m.likes,
    tags: m.tags,
    model_type: m.pipeline_tag,
    last_modified: m.last_modified,
    thumbnail_url: null,
    hf: m,
  };
}

/**
 * Merges the per-source result lists (each already ordered by its API).
 * Downloads and likes are comparable across sources; Civitai results carry no
 * modification date, so for "newest" the two lists are interleaved instead.
 */
function mergeResults(hf: SearchResultItem[], civitai: SearchResultItem[], sort: SortOption): SearchResultItem[] {
  if (sort === "downloads") return [...hf, ...civitai].sort((a, b) => b.downloads - a.downloads);
  if (sort === "likes") return [...hf, ...civitai].sort((a, b) => b.likes - a.likes);
  const merged: SearchResultItem[] = [];
  for (let i = 0; i < Math.max(hf.length, civitai.length); i++) {
    if (i < hf.length) merged.push(hf[i]);
    if (i < civitai.length) merged.push(civitai[i]);
  }
  return merged;
}

function describeFailures(failures: string[]): string | null {
  return failures.length > 0 ? failures.join("; ") : null;
}

// Incremented by every new search; responses from older searches are dropped.
let searchSeq = 0;

export const useSearchStore = create<SearchState>((set, get) => ({
  query: "",
  sort: "downloads",
  filter: "",
  sourceFilter: "all",
  results: [],
  loading: false,
  loadingMore: false,
  error: null,

  hfHasMore: false,
  hfOffset: 0,
  civitaiHasMore: false,
  civitaiCursor: null,

  expandedModelId: null,
  modelFiles: {},
  loadingFiles: null,
  selectedVersions: {},

  setQuery: (query) => set({ query }),
  setSort: (sort) => set({ sort }),
  setFilter: (filter) => set({ filter }),
  setSourceFilter: (source) => set({ sourceFilter: source }),

  search: async () => {
    const { query, sort, filter, sourceFilter } = get();
    if (!query.trim()) return;
    const seq = ++searchSeq;

    set({
      loading: true,
      error: null,
      hfOffset: 0,
      civitaiCursor: null,
      expandedModelId: null,
      selectedVersions: {},
    });

    const settings = useSettingsStore.getState().settings;
    const trimmed = query.trim();
    const queryHf = sourceFilter === "all" || sourceFilter === "huggingface";
    const queryCivitai = sourceFilter === "all" || sourceFilter === "civitai";

    const [hfResult, civitaiResult] = await Promise.allSettled([
      queryHf
        ? api.searchHfModels(
            { query: trimmed, sort, direction: "-1", limit: PAGE_SIZE, offset: 0, filter: filter || undefined },
            settings.proxy || undefined,
            settings.huggingface_token || undefined
          )
        : Promise.resolve(null),
      queryCivitai
        ? api.searchCivitaiModels(
            { query: trimmed, sort: mapCivitaiSortOption(sort), period: "AllTime", limit: PAGE_SIZE, types: mapFilterToCivitaiType(filter) },
            settings.proxy || undefined,
            settings.civitai_api_token || undefined
          )
        : Promise.resolve(null),
    ]);
    if (seq !== searchSeq) return;

    const failures: string[] = [];
    let hfItems: SearchResultItem[] = [];
    let civitaiItems: SearchResultItem[] = [];
    let hfHasMore = false;
    let civitaiHasMore = false;
    let civitaiCursor: string | null = null;

    if (hfResult.status === "fulfilled" && hfResult.value) {
      hfItems = hfResult.value.models.map(mapHfToUnified);
      hfHasMore = hfResult.value.has_more;
    } else if (hfResult.status === "rejected") {
      failures.push(`HuggingFace: ${String(hfResult.reason)}`);
    }

    if (civitaiResult.status === "fulfilled" && civitaiResult.value) {
      civitaiItems = civitaiResult.value.models.map(mapCivitaiToUnified);
      civitaiHasMore = civitaiResult.value.has_more;
      civitaiCursor = civitaiResult.value.next_cursor;
    } else if (civitaiResult.status === "rejected") {
      failures.push(`Civitai: ${String(civitaiResult.reason)}`);
    }

    set({
      results: mergeResults(hfItems, civitaiItems, sort),
      hfHasMore,
      hfOffset: hfItems.length,
      civitaiHasMore,
      civitaiCursor,
      loading: false,
      error: describeFailures(failures),
    });
  },

  loadMore: async () => {
    const {
      query,
      sort,
      filter,
      sourceFilter,
      hfOffset,
      hfHasMore,
      civitaiHasMore,
      civitaiCursor,
      loadingMore,
    } = get();
    const canLoadHf = hfHasMore && (sourceFilter === "all" || sourceFilter === "huggingface");
    const canLoadCivitai =
      civitaiHasMore && !!civitaiCursor && (sourceFilter === "all" || sourceFilter === "civitai");
    if ((!canLoadHf && !canLoadCivitai) || loadingMore) return;

    const seq = searchSeq;
    set({ loadingMore: true });

    const settings = useSettingsStore.getState().settings;
    const trimmed = query.trim();

    const [hfResult, civitaiResult] = await Promise.allSettled([
      canLoadHf
        ? api.searchHfModels(
            { query: trimmed, sort, direction: "-1", limit: PAGE_SIZE, offset: hfOffset, filter: filter || undefined } satisfies HfSearchParams,
            settings.proxy || undefined,
            settings.huggingface_token || undefined
          )
        : Promise.resolve(null),
      canLoadCivitai
        ? api.searchCivitaiModels(
            {
              query: trimmed,
              sort: mapCivitaiSortOption(sort),
              period: "AllTime",
              limit: PAGE_SIZE,
              cursor: civitaiCursor ?? undefined,
              types: mapFilterToCivitaiType(filter),
            } satisfies CivitaiSearchParams,
            settings.proxy || undefined,
            settings.civitai_api_token || undefined
          )
        : Promise.resolve(null),
    ]);
    // A new search started meanwhile: these pages belong to the old query.
    if (seq !== searchSeq) return;

    const failures: string[] = [];
    const updates: Partial<SearchState> = { loadingMore: false };
    let hfItems: SearchResultItem[] = [];
    let civitaiItems: SearchResultItem[] = [];

    if (hfResult.status === "fulfilled" && hfResult.value) {
      hfItems = hfResult.value.models.map(mapHfToUnified);
      updates.hfHasMore = hfResult.value.has_more;
      updates.hfOffset = hfOffset + hfItems.length;
    } else if (hfResult.status === "rejected") {
      failures.push(`HuggingFace: ${String(hfResult.reason)}`);
      updates.hfHasMore = false;
    }

    if (civitaiResult.status === "fulfilled" && civitaiResult.value) {
      civitaiItems = civitaiResult.value.models.map(mapCivitaiToUnified);
      updates.civitaiHasMore = civitaiResult.value.has_more;
      updates.civitaiCursor = civitaiResult.value.next_cursor;
    } else if (civitaiResult.status === "rejected") {
      failures.push(`Civitai: ${String(civitaiResult.reason)}`);
      updates.civitaiHasMore = false;
    }

    set((s) => ({
      ...updates,
      results: [...s.results, ...mergeResults(hfItems, civitaiItems, sort)],
      error: describeFailures(failures) ?? s.error,
    }));
  },

  reset: () =>
    set({
      query: "",
      sourceFilter: "all",
      results: [],
      hfHasMore: false,
      hfOffset: 0,
      civitaiHasMore: false,
      civitaiCursor: null,
      loading: false,
      loadingMore: false,
      error: null,
      expandedModelId: null,
      modelFiles: {},
      loadingFiles: null,
      selectedVersions: {},
    }),

  toggleModelFiles: async (modelId) => {
    const { expandedModelId, modelFiles, results } = get();

    if (expandedModelId === modelId) {
      set({ expandedModelId: null });
      return;
    }

    set({ expandedModelId: modelId });

    if (modelFiles[modelId]) return;

    const item = results.find((r) => r.id === modelId);
    if (!item) return;

    if (item.source === "civitai" && item.civitai) {
      const versions = item.civitai.model_versions;
      if (versions.length > 0) {
        const firstVer = versions[0];
        set((s) => ({
          modelFiles: {
            ...s.modelFiles,
            [modelId]: civitaiVersionToFiles(firstVer),
          },
          selectedVersions: {
            ...s.selectedVersions,
            [modelId]: firstVer.id,
          },
        }));
      } else {
        set((s) => ({
          modelFiles: { ...s.modelFiles, [modelId]: [] },
        }));
      }
      return;
    }

    set({ loadingFiles: modelId });
    try {
      const settings = useSettingsStore.getState().settings;
      const resp = await api.getHfModelFiles(
        modelId,
        settings.proxy || undefined,
        settings.huggingface_token || undefined
      );
      set((s) => ({
        modelFiles: { ...s.modelFiles, [modelId]: resp.files },
        loadingFiles: s.loadingFiles === modelId ? null : s.loadingFiles,
      }));
    } catch (e) {
      set((s) => ({
        loadingFiles: s.loadingFiles === modelId ? null : s.loadingFiles,
        error: `HuggingFace: ${String(e)}`,
      }));
    }
  },

  collapseFiles: () => set({ expandedModelId: null }),

  selectVersion: (modelId, versionId) => {
    const { results } = get();
    const item = results.find((r) => r.id === modelId);
    if (!item?.civitai) return;

    const ver = item.civitai.model_versions.find((v) => v.id === versionId);
    if (!ver) return;

    set((s) => ({
      selectedVersions: { ...s.selectedVersions, [modelId]: versionId },
      modelFiles: {
        ...s.modelFiles,
        [modelId]: civitaiVersionToFiles(ver),
      },
    }));
  },
}));

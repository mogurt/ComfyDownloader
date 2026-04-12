import { create } from "zustand";
import type {
  HfFileEntry,
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
  civitaiPage: number;

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
  civitaiPage: 1,

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

    set({
      loading: true,
      error: null,
      hfOffset: 0,
      civitaiPage: 1,
      expandedModelId: null,
      selectedVersions: {},
    });

    const settings = useSettingsStore.getState().settings;
    const trimmed = query.trim();
    const queryHf = sourceFilter === "all" || sourceFilter === "huggingface";
    const queryCivitai = sourceFilter === "all" || sourceFilter === "civitai";

    const promises: [
      Promise<{ status: "fulfilled"; value: Awaited<ReturnType<typeof api.searchHfModels>> } | { status: "rejected"; reason: unknown }>,
      Promise<{ status: "fulfilled"; value: Awaited<ReturnType<typeof api.searchCivitaiModels>> } | { status: "rejected"; reason: unknown }>,
    ] = [
      queryHf
        ? api.searchHfModels(
            { query: trimmed, sort, direction: "-1", limit: PAGE_SIZE, offset: 0, filter: filter || undefined },
            settings.proxy || undefined,
            settings.huggingface_token || undefined
          ).then((v) => ({ status: "fulfilled" as const, value: v }), (reason) => ({ status: "rejected" as const, reason }))
        : Promise.resolve({ status: "rejected" as const, reason: "skipped" }),
      queryCivitai
        ? api.searchCivitaiModels(
            { query: trimmed, sort: mapCivitaiSortOption(sort), period: "AllTime", limit: PAGE_SIZE, page: 1, types: mapFilterToCivitaiType(filter) },
            settings.proxy || undefined,
            settings.civitai_api_token || undefined
          ).then((v) => ({ status: "fulfilled" as const, value: v }), (reason) => ({ status: "rejected" as const, reason }))
        : Promise.resolve({ status: "rejected" as const, reason: "skipped" }),
    ];

    const [hfResult, civitaiResult] = await Promise.all(promises);

    const unified: SearchResultItem[] = [];
    let hfHasMore = false;
    let hfOffset = 0;
    let civitaiHasMore = false;

    if (hfResult.status === "fulfilled") {
      const hf = hfResult.value;
      for (const m of hf.models) {
        unified.push({
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
        });
      }
      hfHasMore = hf.has_more;
      hfOffset = hf.models.length;
    } else if (hfResult.reason !== "skipped") {
      console.warn("HF search failed:", hfResult.reason);
    }

    if (civitaiResult.status === "fulfilled") {
      const civ = civitaiResult.value;
      for (const m of civ.models) {
        unified.push(mapCivitaiToUnified(m));
      }
      civitaiHasMore = civ.has_more;
    } else if (civitaiResult.reason !== "skipped") {
      console.warn("Civitai search failed:", civitaiResult.reason);
    }

    unified.sort((a, b) => b.downloads - a.downloads);

    set({
      results: unified,
      hfHasMore,
      hfOffset,
      civitaiHasMore,
      civitaiPage: 2,
      loading: false,
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
      civitaiPage,
      loadingMore,
    } = get();
    const canLoadHf = hfHasMore && (sourceFilter === "all" || sourceFilter === "huggingface");
    const canLoadCivitai = civitaiHasMore && (sourceFilter === "all" || sourceFilter === "civitai");
    if ((!canLoadHf && !canLoadCivitai) || loadingMore) return;

    set({ loadingMore: true });

    const settings = useSettingsStore.getState().settings;
    const trimmed = query.trim();
    const promises: Promise<SearchResultItem[]>[] = [];

    if (canLoadHf) {
      const hfParams: HfSearchParams = {
        query: trimmed,
        sort,
        direction: "-1",
        limit: PAGE_SIZE,
        offset: hfOffset,
        filter: filter || undefined,
      };
      promises.push(
        api
          .searchHfModels(
            hfParams,
            settings.proxy || undefined,
            settings.huggingface_token || undefined
          )
          .then((resp) => {
            set({
              hfHasMore: resp.has_more,
              hfOffset: hfOffset + resp.models.length,
            });
            return resp.models.map(
              (m): SearchResultItem => ({
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
              })
            );
          })
          .catch((e) => {
            console.warn("HF loadMore failed:", e);
            set({ hfHasMore: false });
            return [];
          })
      );
    }

    if (canLoadCivitai) {
      const civitaiParams: CivitaiSearchParams = {
        query: trimmed,
        sort: mapCivitaiSortOption(sort),
        period: "AllTime",
        limit: PAGE_SIZE,
        page: civitaiPage,
        types: mapFilterToCivitaiType(filter),
      };
      promises.push(
        api
          .searchCivitaiModels(
            civitaiParams,
            settings.proxy || undefined,
            settings.civitai_api_token || undefined
          )
          .then((resp) => {
            set({
              civitaiHasMore: resp.has_more,
              civitaiPage: civitaiPage + 1,
            });
            return resp.models.map(mapCivitaiToUnified);
          })
          .catch((e) => {
            console.warn("Civitai loadMore failed:", e);
            set({ civitaiHasMore: false });
            return [];
          })
      );
    }

    try {
      const batches = await Promise.all(promises);
      const newItems = batches.flat();
      newItems.sort((a, b) => b.downloads - a.downloads);

      set((s) => ({
        results: [...s.results, ...newItems],
        loadingMore: false,
      }));
    } catch {
      set({ loadingMore: false });
    }
  },

  reset: () =>
    set({
      query: "",
      sourceFilter: "all",
      results: [],
      hfHasMore: false,
      hfOffset: 0,
      civitaiHasMore: false,
      civitaiPage: 1,
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
        loadingFiles: null,
      }));
    } catch (e) {
      set({ loadingFiles: null, error: String(e) });
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

import { create } from "zustand";
import type {
  HfModelInfo,
  HfFileEntry,
  HfSearchParams,
} from "@/lib/types";
import * as api from "@/lib/api";
import { useSettingsStore } from "@/stores/settingsStore";

export type HfSortOption = "downloads" | "likes" | "lastModified";

interface SearchState {
  query: string;
  sort: HfSortOption;
  filter: string;
  results: HfModelInfo[];
  hasMore: boolean;
  offset: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;

  expandedModelId: string | null;
  modelFiles: Record<string, HfFileEntry[]>;
  loadingFiles: string | null;

  setQuery: (query: string) => void;
  setSort: (sort: HfSortOption) => void;
  setFilter: (filter: string) => void;
  search: () => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => void;

  toggleModelFiles: (modelId: string) => Promise<void>;
  collapseFiles: () => void;
}

const PAGE_SIZE = 20;

export const useSearchStore = create<SearchState>((set, get) => ({
  query: "",
  sort: "downloads",
  filter: "",
  results: [],
  hasMore: false,
  offset: 0,
  loading: false,
  loadingMore: false,
  error: null,

  expandedModelId: null,
  modelFiles: {},
  loadingFiles: null,

  setQuery: (query) => set({ query }),
  setSort: (sort) => set({ sort }),
  setFilter: (filter) => set({ filter }),

  search: async () => {
    const { query, sort, filter } = get();
    if (!query.trim()) return;

    set({ loading: true, error: null, offset: 0, expandedModelId: null });

    try {
      const settings = useSettingsStore.getState().settings;
      const params: HfSearchParams = {
        query: query.trim(),
        sort,
        direction: "-1",
        limit: PAGE_SIZE,
        offset: 0,
        filter: filter || undefined,
      };
      const resp = await api.searchHfModels(
        params,
        settings.proxy || undefined,
        settings.huggingface_token || undefined
      );
      set({
        results: resp.models,
        hasMore: resp.has_more,
        offset: resp.models.length,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false, results: [] });
    }
  },

  loadMore: async () => {
    const { query, sort, filter, offset, hasMore, loadingMore } = get();
    if (!hasMore || loadingMore) return;

    set({ loadingMore: true });

    try {
      const settings = useSettingsStore.getState().settings;
      const params: HfSearchParams = {
        query: query.trim(),
        sort,
        direction: "-1",
        limit: PAGE_SIZE,
        offset,
        filter: filter || undefined,
      };
      const resp = await api.searchHfModels(
        params,
        settings.proxy || undefined,
        settings.huggingface_token || undefined
      );
      set((s) => ({
        results: [...s.results, ...resp.models],
        hasMore: resp.has_more,
        offset: s.offset + resp.models.length,
        loadingMore: false,
      }));
    } catch (e) {
      set({ error: String(e), loadingMore: false });
    }
  },

  reset: () =>
    set({
      query: "",
      results: [],
      hasMore: false,
      offset: 0,
      loading: false,
      loadingMore: false,
      error: null,
      expandedModelId: null,
      modelFiles: {},
      loadingFiles: null,
    }),

  toggleModelFiles: async (modelId) => {
    const { expandedModelId, modelFiles } = get();

    if (expandedModelId === modelId) {
      set({ expandedModelId: null });
      return;
    }

    set({ expandedModelId: modelId });

    if (modelFiles[modelId]) return;

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
}));

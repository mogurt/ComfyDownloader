import { create } from "zustand";
import type { AppSettings, DirMapping, UserRule } from "@/lib/types";
import Database from "@tauri-apps/plugin-sql";
import * as api from "@/lib/api";

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:comfy_downloader.db");
  }
  return db;
}

// Settings inputs are controlled components: state must update synchronously on
// every keystroke, while DB writes and aria2 syncs are debounced.
const WRITE_DEBOUNCE_MS = 300;
const ARIA2_SYNC_DEBOUNCE_MS = 800;
const ARIA2_KEYS = ["aria2_max_concurrent", "aria2_max_connections", "proxy", "download_speed_limit"];

const pendingWrites = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; waiters: Array<() => void> }
>();
let aria2SyncTimer: ReturnType<typeof setTimeout> | undefined;

interface SettingsState {
  settings: AppSettings;
  dirMappings: DirMapping[];
  rules: UserRule[];
  loaded: boolean;

  loadSettings: () => Promise<void>;
  updateSetting: (key: string, value: string) => Promise<void>;
  syncAria2Settings: () => Promise<void>;
  loadDirMappings: () => Promise<void>;
  saveDirMapping: (mapping: DirMapping) => Promise<void>;
  loadRules: () => Promise<void>;
  addRule: (rule: Omit<UserRule, "id" | "created_at">) => Promise<void>;
  updateRule: (rule: UserRule) => Promise<void>;
  deleteRule: (id: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {
    comfyui_root: "",
    comfyui_server: "http://127.0.0.1:8188",
    model_base_dir: "",
    language: "en",
    theme: "system",
    aria2_max_concurrent: "3",
    aria2_max_connections: "16",
    proxy: "",
    civitai_api_token: "",
    huggingface_token: "",
    duplicate_strategy: "skip",
    download_speed_limit: "0",
    auto_verify_comfyui: "false",
  },
  dirMappings: [],
  rules: [],
  loaded: false,

  loadSettings: async () => {
    const database = await getDb();
    const rows = await database.select<{ key: string; value: string }[]>(
      "SELECT key, value FROM settings"
    );
    const settings = { ...get().settings };
    for (const row of rows) {
      if (row.key in settings) {
        (settings as Record<string, string>)[row.key] = row.value;
      }
    }
    set({ settings, loaded: true });
  },

  updateSetting: (key: string, value: string) => {
    set({ settings: { ...get().settings, [key]: value } });

    if (ARIA2_KEYS.includes(key)) {
      clearTimeout(aria2SyncTimer);
      aria2SyncTimer = setTimeout(() => void get().syncAria2Settings(), ARIA2_SYNC_DEBOUNCE_MS);
    }

    // Resolves once the (debounced) value has been persisted.
    return new Promise<void>((resolve) => {
      const pending = pendingWrites.get(key);
      const waiters = pending ? pending.waiters : [];
      if (pending) clearTimeout(pending.timer);
      waiters.push(resolve);

      const timer = setTimeout(async () => {
        pendingWrites.delete(key);
        try {
          const latest = (get().settings as unknown as Record<string, string>)[key];
          const database = await getDb();
          await database.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)",
            [key, latest]
          );
        } catch (e) {
          console.error(`[Settings] Failed to save ${key}:`, e);
        } finally {
          waiters.forEach((done) => done());
        }
      }, WRITE_DEBOUNCE_MS);

      pendingWrites.set(key, { timer, waiters });
    });
  },

  syncAria2Settings: async () => {
    const settings = get().settings;
    const maxConcurrent = Number.parseInt(settings.aria2_max_concurrent, 10);
    const maxConnections = Number.parseInt(settings.aria2_max_connections, 10);

    if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) return;
    if (!Number.isFinite(maxConnections) || maxConnections < 1) return;
    const speedLimit = Number.parseInt(settings.download_speed_limit, 10);

    try {
      await api.applyAria2RuntimeSettings(
        maxConcurrent,
        maxConnections,
        settings.proxy.trim(),
        Number.isFinite(speedLimit) && speedLimit > 0 ? speedLimit : 0
      );
    } catch (e) {
      console.warn("[Settings] Failed to sync aria2 runtime settings:", e);
    }
  },

  loadDirMappings: async () => {
    const database = await getDb();
    const rows = await database.select<DirMapping[]>(
      "SELECT model_type, directory FROM dir_mappings"
    );
    set({ dirMappings: rows });
  },

  saveDirMapping: async (mapping: DirMapping) => {
    const database = await getDb();
    await database.execute(
      "INSERT OR REPLACE INTO dir_mappings (model_type, directory) VALUES ($1, $2)",
      [mapping.model_type, mapping.directory]
    );
    await get().loadDirMappings();
  },

  loadRules: async () => {
    const database = await getDb();
    const rows = await database.select<UserRule[]>(
      "SELECT id, rule_type, keyword, model_type, priority, enabled, created_at FROM rules ORDER BY priority DESC"
    );
    set({
      rules: rows.map((r) => ({ ...r, enabled: Boolean(r.enabled) })),
    });
  },

  addRule: async (rule) => {
    const database = await getDb();
    await database.execute(
      "INSERT INTO rules (rule_type, keyword, model_type, priority, enabled) VALUES ($1, $2, $3, $4, $5)",
      [rule.rule_type, rule.keyword, rule.model_type, rule.priority, rule.enabled ? 1 : 0]
    );
    await get().loadRules();
  },

  updateRule: async (rule) => {
    const database = await getDb();
    await database.execute(
      "UPDATE rules SET rule_type=$1, keyword=$2, model_type=$3, priority=$4, enabled=$5 WHERE id=$6",
      [rule.rule_type, rule.keyword, rule.model_type, rule.priority, rule.enabled ? 1 : 0, rule.id]
    );
    await get().loadRules();
  },

  deleteRule: async (id) => {
    const database = await getDb();
    await database.execute("DELETE FROM rules WHERE id=$1", [id]);
    await get().loadRules();
  },
}));

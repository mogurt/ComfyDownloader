import { create } from "zustand";
import type {
  Aria2Status,
  DownloadTask,
  LogEntry,
  TaskListFilter,
  TaskStatus,
  TaskSummary,
} from "@/lib/types";
import Database from "@tauri-apps/plugin-sql";
import * as api from "@/lib/api";
import { translate } from "@/lib/i18n";
import { useSettingsStore } from "@/stores/settingsStore";

let db: Database | null = null;

function matchesTaskFilter(task: DownloadTask, filter: TaskListFilter): boolean {
  switch (filter) {
    case "active":
      return task.status === "queued" || task.status === "downloading";
    case "queued":
      return task.status === "queued";
    case "paused":
      return task.status === "paused";
    case "failed":
      return task.status === "failed";
    case "completed":
      return task.status === "completed";
    default:
      return true;
  }
}

function extractGidFromMessage(message: string): string | null {
  const match = message.match(/\b([0-9a-f]{16})\b/i);
  return match?.[1] ?? null;
}

function matchesTaskGid(taskGid: string | null | undefined, reportedGid: string): boolean {
  if (!taskGid) return false;
  const normalizedTaskGid = taskGid.toLowerCase();
  const normalizedReportedGid = reportedGid.toLowerCase();
  return normalizedTaskGid === normalizedReportedGid || normalizedTaskGid.startsWith(normalizedReportedGid);
}

function hostMatches(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function isHuggingFaceUrl(url: string): boolean {
  return hostMatches(url, ["huggingface.co", "hf-mirror.com"]);
}

function isCivitaiUrl(url: string): boolean {
  return hostMatches(url, ["civitai.com"]);
}

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:comfy_downloader.db");
  }
  return db;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

interface TaskLogMeta {
  gid?: string | null;
  taskId?: number | null;
}

interface TaskState {
  tasks: DownloadTask[];
  logs: LogEntry[];
  aria2Ready: boolean;
  selectedTaskId: number | null;
  selectedTaskIds: number[];
  logIdCounter: number;

  setAria2Ready: (ready: boolean) => void;
  setSelectedTask: (id: number | null) => void;
  setSelectedTaskIds: (ids: number[]) => void;
  toggleTaskSelection: (id: number) => void;
  clearTaskSelection: () => void;
  toggleVisibleTasks: (ids: number[]) => void;
  isTaskSelected: (id: number) => boolean;
  addLog: (level: LogEntry["level"], message: string) => void;
  addTaskLog: (level: LogEntry["level"], message: string, meta?: TaskLogMeta) => void;
  clearLogs: () => void;
  getTaskLogs: (taskId: number, gid?: string) => LogEntry[];
  getTasksByFilter: (filter: TaskListFilter) => DownloadTask[];
  getTaskSummary: () => TaskSummary;

  loadTasks: () => Promise<void>;
  resetStaleTasks: () => Promise<void>;
  addTask: (task: Omit<DownloadTask, "id" | "created_at" | "completed_at">) => Promise<number | undefined>;
  updateTaskStatus: (id: number, status: TaskStatus, extra?: Partial<DownloadTask>) => Promise<void>;
  updateTaskByGid: (gid: string, updates: Partial<DownloadTask>) => void;
  setTaskAllocationProgress: (gid: string, progress: number) => void;
  deleteTask: (id: number) => Promise<void>;
  clearAllTasks: () => Promise<void>;

  startDownload: (task: DownloadTask) => Promise<void>;
  pauseTask: (task: DownloadTask) => Promise<void>;
  resumeTask: (task: DownloadTask) => Promise<void>;
  cancelTask: (task: DownloadTask) => Promise<void>;
  retryTask: (task: DownloadTask) => Promise<void>;
  retryFailedTasks: () => Promise<void>;
  clearCompletedTasks: () => Promise<void>;
  startSelectedTasks: (ids: number[]) => Promise<void>;
  pauseSelectedTasks: (ids: number[]) => Promise<void>;
  deleteSelectedTasks: (ids: number[]) => Promise<void>;

  handleGidStarted: (gid: string) => Promise<void>;
  handleGidComplete: (gid: string) => Promise<void>;
  handleGidError: (gid: string) => Promise<void>;
  handleGidPause: (gid: string) => Promise<void>;

  pollActiveDownloads: () => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  logs: [],
  aria2Ready: false,
  selectedTaskId: null,
  selectedTaskIds: [],
  logIdCounter: 0,

  setAria2Ready: (ready) => set({ aria2Ready: ready }),

  setSelectedTask: (id) => set({ selectedTaskId: id }),

  setSelectedTaskIds: (ids) => set({ selectedTaskIds: Array.from(new Set(ids)) }),

  toggleTaskSelection: (id) => set((s) => ({
    selectedTaskIds: s.selectedTaskIds.includes(id)
      ? s.selectedTaskIds.filter((taskId) => taskId !== id)
      : [...s.selectedTaskIds, id],
  })),

  clearTaskSelection: () => set({ selectedTaskIds: [] }),

  toggleVisibleTasks: (ids) => set((s) => {
    const allSelected = ids.length > 0 && ids.every((id) => s.selectedTaskIds.includes(id));
    return {
      selectedTaskIds: allSelected
        ? s.selectedTaskIds.filter((id) => !ids.includes(id))
        : Array.from(new Set([...s.selectedTaskIds, ...ids])),
    };
  }),

  isTaskSelected: (id) => get().selectedTaskIds.includes(id),

  addLog: (level, message) => {
    get().addTaskLog(level, message);
  },

  addTaskLog: (level, message, meta = {}) => {
    const id = get().logIdCounter + 1;
    const derivedGid = meta.gid ?? extractGidFromMessage(message);
    const derivedTaskId = meta.taskId
      ?? (derivedGid
        ? get().tasks.find((task) => task.gid === derivedGid)?.id ?? null
        : null);
    const entry: LogEntry = {
      id,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
      gid: derivedGid ?? null,
      taskId: derivedTaskId ?? null,
    };
    set((s) => ({
      logs: [...s.logs.slice(-200), entry],
      logIdCounter: id,
    }));
  },

  clearLogs: () => set({ logs: [] }),

  getTaskLogs: (taskId, gid) => {
    return get().logs.filter((log) => log.taskId === taskId || (!!gid && log.gid === gid));
  },

  getTasksByFilter: (filter) => {
    return get().tasks.filter((task) => matchesTaskFilter(task, filter));
  },

  getTaskSummary: () => {
    const tasks = get().tasks;
    return {
      total: tasks.length,
      downloading: tasks.filter((task) => task.status === "downloading").length,
      queued: tasks.filter((task) => task.status === "queued").length,
      paused: tasks.filter((task) => task.status === "paused").length,
      failed: tasks.filter((task) => task.status === "failed").length,
      completed: tasks.filter((task) => task.status === "completed").length,
    };
  },

  loadTasks: async () => {
    const database = await getDb();
    const rows = await database.select<DownloadTask[]>(
      "SELECT * FROM downloads ORDER BY created_at DESC"
    );
    set({
      tasks: rows.map((row) => ({
        downloaded_size: row.downloaded_size ?? 0,
        last_active_at: row.last_active_at ?? null,
        runtime_phase: null,
        allocation_progress: null,
        ...row,
      })),
    });
  },

  resetStaleTasks: async () => {
    const database = await getDb();
    await database.execute(
      "UPDATE downloads SET status='paused', speed=0 WHERE status IN ('downloading', 'queued')"
    );
  },

  addTask: async (task) => {
    const database = await getDb();
    const result = await database.execute(
      `INSERT INTO downloads (gid, url, filename, source, model_type, target_dir, file_size, status, progress, speed, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        task.gid,
        task.url,
        task.filename,
        task.source,
        task.model_type,
        task.target_dir,
        task.file_size,
        task.status,
        task.progress,
        task.speed,
        task.hash,
      ]
    );
    const id = Number(result.lastInsertId);
    const createdTask: DownloadTask = {
      id,
      created_at: new Date().toISOString(),
      completed_at: null,
      downloaded_size: task.downloaded_size ?? 0,
      last_active_at: task.last_active_at ?? null,
      runtime_phase: task.runtime_phase ?? null,
      allocation_progress: task.allocation_progress ?? null,
      ...task,
    };
    set((s) => ({ tasks: [createdTask, ...s.tasks] }));
    return id;
  },

  updateTaskStatus: async (id, status, extra = {}) => {
    const database = await getDb();
    let sql = "UPDATE downloads SET status=$1";
    const params: unknown[] = [status];
    let paramIdx = 2;

    if (extra.gid !== undefined) {
      sql += `, gid=$${paramIdx}`;
      params.push(extra.gid);
      paramIdx++;
    }
    if (extra.progress !== undefined) {
      sql += `, progress=$${paramIdx}`;
      params.push(extra.progress);
      paramIdx++;
    }
    if (extra.speed !== undefined) {
      sql += `, speed=$${paramIdx}`;
      params.push(extra.speed);
      paramIdx++;
    }
    if (extra.error_msg !== undefined) {
      sql += `, error_msg=$${paramIdx}`;
      params.push(extra.error_msg);
      paramIdx++;
    }
    if (status === "completed") {
      sql += `, completed_at=CURRENT_TIMESTAMP, progress=100`;
    }

    sql += ` WHERE id=$${paramIdx}`;
    params.push(id);

    await database.execute(sql, params);

    const runtimeReset =
      status === "pending"
      || status === "paused"
      || status === "completed"
      || status === "failed"
      || status === "skipped";

    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? {
            ...t,
            status,
            ...(runtimeReset && extra.runtime_phase === undefined
              ? { runtime_phase: null, allocation_progress: null }
              : {}),
            ...extra,
          }
          : t
      ),
    }));
  },

  updateTaskByGid: (gid, updates) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.gid === gid ? { ...t, ...updates } : t
      ),
    }));
  },

  setTaskAllocationProgress: (gid, progress) => {
    const clampedProgress = Math.min(100, Math.max(0, progress));
    set((s) => ({
      tasks: s.tasks.map((t) =>
        matchesTaskGid(t.gid, gid) && (t.status === "queued" || t.status === "downloading")
          ? {
            ...t,
            status: (t.downloaded_size ?? 0) > 0 ? t.status : "queued",
            speed: 0,
            runtime_phase: "allocating",
            allocation_progress: clampedProgress,
          }
          : t
      ),
    }));
  },

  deleteTask: async (id) => {
    const database = await getDb();
    await database.execute("DELETE FROM downloads WHERE id=$1", [id]);
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
      selectedTaskIds: s.selectedTaskIds.filter((taskId) => taskId !== id),
    }));
  },

  clearAllTasks: async () => {
    const database = await getDb();
    await database.execute("DELETE FROM downloads", []);
    set({ tasks: [], selectedTaskId: null, selectedTaskIds: [] });
  },

  startDownload: async (task) => {
    const store = get();
    try {
      const headers: string[] = [];
      const settings = useSettingsStore.getState().settings;
      let downloadUrl = task.url;
      if (isHuggingFaceUrl(task.url) && settings.huggingface_token.trim()) {
        headers.push(`Authorization: Bearer ${settings.huggingface_token.trim()}`);
      }
      if (isCivitaiUrl(task.url) && settings.civitai_api_token.trim()) {
        const token = settings.civitai_api_token.trim();
        const sep = downloadUrl.includes("?") ? "&" : "?";
        downloadUrl = `${downloadUrl}${sep}token=${encodeURIComponent(token)}`;
      }
      const gid = await api.createDownload(
        downloadUrl,
        task.target_dir,
        task.filename,
        headers.length > 0 ? headers : undefined
      );
      await store.updateTaskStatus(task.id, "queued", {
        gid,
        error_msg: null,
        speed: 0,
        runtime_phase: null,
        allocation_progress: null,
      });
      store.addTaskLog("info", translate("log.startedDownload", { filename: task.filename }), {
        taskId: task.id,
      });
    } catch (e) {
      await store.updateTaskStatus(task.id, "failed", {
        error_msg: String(e),
      });
      store.addTaskLog("error", translate("log.failedStart", {
        filename: task.filename,
        error: String(e),
      }), {
        taskId: task.id,
      });
    }
  },

  pauseTask: async (task) => {
    try {
      if (task.gid) await api.pauseDownload(task.gid);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("is not found")) {
        get().addTaskLog("error", translate("log.failedPause", {
          filename: task.filename,
          error: String(e),
        }), {
          taskId: task.id,
          gid: task.gid || null,
        });
      }
    }
    await get().updateTaskStatus(task.id, "paused", { speed: 0 });
    get().addTaskLog("info", translate("log.paused", { filename: task.filename }), {
      taskId: task.id,
      gid: task.gid || null,
    });
  },

  resumeTask: async (task) => {
    const current = get().tasks.find((t) => t.id === task.id);
    if (!current) return;
    if (current.status === "completed" || current.status === "skipped") return;

    const gid = current.gid || task.gid;
    try {
      if (gid) {
        await api.resumeDownload(gid);
        await get().updateTaskStatus(current.id, "downloading", { speed: 0 });
        get().addTaskLog("info", translate("log.resumed", { filename: current.filename }), {
          taskId: current.id,
          gid,
        });
      } else {
        await get().startDownload(current);
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes("is not found") || msg.includes("cannot be unpaused")) {
        get().addTaskLog("info", translate("log.redownloading", { filename: current.filename }), {
          taskId: current.id,
          gid,
        });
        await get().startDownload(current);
      } else {
        get().addTaskLog("error", translate("log.failedResume", {
          filename: current.filename,
          error: String(e),
        }), {
          taskId: current.id,
          gid,
        });
      }
    }
  },

  cancelTask: async (task) => {
    try {
      if (task.gid) await api.cancelDownload(task.gid);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("is not found")) {
        get().addTaskLog("error", translate("log.failedCancel", {
          filename: task.filename,
          error: String(e),
        }), {
          taskId: task.id,
          gid: task.gid || null,
        });
        return;
      }
    }
    await get().updateTaskStatus(task.id, "failed", {
      error_msg: translate("log.cancelledByUser"),
      speed: 0,
    });
    get().addTaskLog("info", translate("log.cancelled", { filename: task.filename }), {
      taskId: task.id,
      gid: task.gid || null,
    });
  },

  retryTask: async (task) => {
    const store = get();
    await store.updateTaskStatus(task.id, "pending", {
      error_msg: null,
      progress: 0,
      speed: 0,
      downloaded_size: 0,
      runtime_phase: null,
      allocation_progress: null,
    });
    const updatedTask = store.tasks.find((t) => t.id === task.id);
    if (updatedTask) {
      await store.startDownload({ ...updatedTask, status: "pending" });
    }
  },

  retryFailedTasks: async () => {
    const failedTasks = get().tasks.filter((task) => task.status === "failed");
    for (const task of failedTasks) {
      await get().retryTask(task);
    }
  },

  clearCompletedTasks: async () => {
    const database = await getDb();
    const completedIds = get().tasks
      .filter((task) => task.status === "completed")
      .map((task) => task.id);
    if (completedIds.length === 0) return;

    await Promise.all(
      completedIds.map((id) =>
        database.execute("DELETE FROM downloads WHERE id=$1", [id])
      )
    );

    set((s) => ({
      tasks: s.tasks.filter((task) => task.status !== "completed"),
      selectedTaskId: completedIds.includes(s.selectedTaskId ?? -1)
        ? null
        : s.selectedTaskId,
      selectedTaskIds: s.selectedTaskIds.filter((id) => !completedIds.includes(id)),
    }));
  },

  startSelectedTasks: async (ids) => {
    const tasks = get().tasks.filter((task) => ids.includes(task.id));
    for (const task of tasks) {
      if (task.status === "pending") {
        await get().startDownload(task);
      } else if (task.status === "paused") {
        await get().resumeTask(task);
      } else if (task.status === "failed") {
        await get().retryTask(task);
      }
    }
  },

  pauseSelectedTasks: async (ids) => {
    const tasks = get().tasks.filter(
      (task) => ids.includes(task.id) && (task.status === "queued" || task.status === "downloading")
    );
    for (const task of tasks) {
      await get().pauseTask(task);
    }
  },

  deleteSelectedTasks: async (ids) => {
    const tasks = get().tasks.filter((task) => ids.includes(task.id));
    for (const task of tasks) {
      if (task.status === "queued" || task.status === "downloading" || task.status === "paused") {
        await get().cancelTask(task);
      }
      await get().deleteTask(task.id);
    }
    set({ selectedTaskIds: [] });
  },

  handleGidStarted: async (gid) => {
    const task = get().tasks.find((t) => t.gid === gid);
    if (task && task.status !== "downloading") {
      await get().updateTaskStatus(task.id, "downloading");
      get().addTaskLog("info", translate("log.downloadStarted", { filename: task.filename }), {
        taskId: task.id,
        gid,
      });
    }
  },

  handleGidComplete: async (gid) => {
    const task = get().tasks.find((t) => t.gid === gid);
    if (task && task.status !== "completed") {
      await get().updateTaskStatus(task.id, "completed", {
        downloaded_size: task.file_size ?? task.downloaded_size ?? 0,
        speed: 0,
        runtime_phase: null,
        allocation_progress: null,
      });
      get().addTaskLog("info", translate("log.completed", { filename: task.filename }), {
        taskId: task.id,
        gid,
      });
    }
  },

  handleGidError: async (gid) => {
    const task = get().tasks.find((t) => t.gid === gid);
    if (task && task.status !== "failed") {
      try {
        const status = await api.getDownloadStatus(gid);
        const errMsg = String(status.errorMessage ?? translate("log.unknownError"));
        await get().updateTaskStatus(task.id, "failed", { error_msg: errMsg });
      } catch {
        await get().updateTaskStatus(task.id, "failed", { error_msg: translate("log.downloadFailed") });
      }
      get().addTaskLog("error", translate("log.failed", { filename: task.filename }), {
        taskId: task.id,
        gid,
      });
    }
  },

  handleGidPause: async (gid) => {
    const task = get().tasks.find((t) => t.gid === gid);
    if (task && (task.status === "downloading" || task.status === "queued")) {
      await get().updateTaskStatus(task.id, "paused", { speed: 0 });
      get().addTaskLog("info", translate("log.paused", { filename: task.filename }), {
        taskId: task.id,
        gid,
      });
    }
  },

  pollActiveDownloads: async () => {
    const { tasks } = get();
    const trackedTasks = tasks.filter(
      (t) => (t.status === "downloading" || t.status === "queued") && t.gid
    );
    if (trackedTasks.length === 0) return;

    try {
      let allDownloads: Aria2Status[];
      try {
        allDownloads = await withTimeout(
          api.getActiveDownloads(),
          10000,
          "get_active_downloads"
        );
      } catch (bulkError) {
        console.warn("[Poll] Bulk aria2 polling failed, falling back to per-task status:", String(bulkError));
        const fallbackStatuses: Aria2Status[] = [];
        for (const task of trackedTasks) {
          try {
            fallbackStatuses.push(
              await withTimeout(
                api.getDownloadStatus(task.gid),
                8000,
                `get_download_status ${task.gid}`
              )
            );
          } catch (fallbackError) {
            console.warn(`[Poll] Failed to fetch status for ${task.gid}:`, String(fallbackError));
          }
        }
        allDownloads = fallbackStatuses;
      }

      const statusMap = new Map<string, Aria2Status>();
      for (const status of allDownloads) {
        if (status.gid) statusMap.set(status.gid, status);
      }

      for (const task of trackedTasks) {
        const status = statusMap.get(task.gid);
        if (status) {
          const total = parseInt(String(status.totalLength ?? "0"), 10);
          const completed = parseInt(String(status.completedLength ?? "0"), 10);
          const speed = parseInt(String(status.downloadSpeed ?? "0"), 10);
          const progress = total > 0 ? (completed / total) * 100 : 0;
          const aria2Status = String(status.status ?? "");
          const isAllocating = task.runtime_phase === "allocating" && aria2Status === "active" && speed <= 0;
          const hasTransferStarted = speed > 0 || (completed > 0 && !isAllocating);
          const lastActiveAt = completed > (task.downloaded_size ?? 0) || speed > 0
            ? new Date().toISOString()
            : task.last_active_at ?? null;

          get().updateTaskByGid(task.gid, {
            progress,
            speed,
            downloaded_size: completed,
            file_size: total || task.file_size,
            last_active_at: lastActiveAt,
            ...(hasTransferStarted || aria2Status === "complete" || aria2Status === "error" || aria2Status === "paused"
              ? { runtime_phase: null, allocation_progress: null }
              : {}),
          });

          if (aria2Status === "active" && task.status !== "downloading" && (!task.runtime_phase || hasTransferStarted)) {
            await get().updateTaskStatus(task.id, "downloading");
          } else if (aria2Status === "waiting" && task.status !== "queued") {
            await get().updateTaskStatus(task.id, "queued", { speed: 0 });
          } else if (aria2Status === "complete") {
            await get().updateTaskStatus(task.id, "completed", {
              downloaded_size: total,
              speed: 0,
              last_active_at: new Date().toISOString(),
            });
          } else if (aria2Status === "error") {
            const errMsg = String(status.errorMessage ?? translate("log.unknownError"));
            await get().updateTaskStatus(task.id, "failed", { error_msg: errMsg });
            get().addTaskLog("error", translate("log.failedWithReason", {
              filename: task.filename,
              error: errMsg,
            }), {
              taskId: task.id,
              gid: task.gid,
            });
          } else if (aria2Status === "paused") {
            await get().updateTaskStatus(task.id, "paused", { speed: 0 });
          }
        }
      }
    } catch (e) {
      console.warn("[Poll] Failed to fetch active downloads:", String(e));
    }
  },
}));

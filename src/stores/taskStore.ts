import { create } from "zustand";
import type { Aria2Status, DownloadTask, LogEntry, TaskStatus } from "@/lib/types";
import Database from "@tauri-apps/plugin-sql";
import * as api from "@/lib/api";

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:comfy_downloader.db");
  }
  return db;
}

interface TaskState {
  tasks: DownloadTask[];
  logs: LogEntry[];
  aria2Ready: boolean;
  selectedTaskId: number | null;
  logIdCounter: number;

  setAria2Ready: (ready: boolean) => void;
  setSelectedTask: (id: number | null) => void;
  addLog: (level: LogEntry["level"], message: string) => void;
  clearLogs: () => void;

  loadTasks: () => Promise<void>;
  resetStaleTasks: () => Promise<void>;
  addTask: (task: Omit<DownloadTask, "id" | "created_at" | "completed_at">) => Promise<number | undefined>;
  updateTaskStatus: (id: number, status: TaskStatus, extra?: Partial<DownloadTask>) => Promise<void>;
  updateTaskByGid: (gid: string, updates: Partial<DownloadTask>) => void;
  deleteTask: (id: number) => Promise<void>;
  clearAllTasks: () => Promise<void>;

  startDownload: (task: DownloadTask) => Promise<void>;
  pauseTask: (task: DownloadTask) => Promise<void>;
  resumeTask: (task: DownloadTask) => Promise<void>;
  cancelTask: (task: DownloadTask) => Promise<void>;
  retryTask: (task: DownloadTask) => Promise<void>;

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
  logIdCounter: 0,

  setAria2Ready: (ready) => set({ aria2Ready: ready }),

  setSelectedTask: (id) => set({ selectedTaskId: id }),

  addLog: (level, message) => {
    const id = get().logIdCounter + 1;
    const entry: LogEntry = {
      id,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
    };
    set((s) => ({
      logs: [...s.logs.slice(-200), entry],
      logIdCounter: id,
    }));
  },

  clearLogs: () => set({ logs: [] }),

  loadTasks: async () => {
    const database = await getDb();
    const rows = await database.select<DownloadTask[]>(
      "SELECT * FROM downloads ORDER BY created_at DESC"
    );
    set({
      tasks: rows.map((row) => ({
        downloaded_size: row.downloaded_size ?? 0,
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

    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, status, ...extra } : t
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

  deleteTask: async (id) => {
    const database = await getDb();
    await database.execute("DELETE FROM downloads WHERE id=$1", [id]);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },

  clearAllTasks: async () => {
    const database = await getDb();
    await database.execute("DELETE FROM downloads", []);
    set({ tasks: [], selectedTaskId: null });
  },

  startDownload: async (task) => {
    const store = get();
    try {
      const headers: string[] = [];
      const gid = await api.createDownload(
        task.url,
        task.target_dir,
        task.filename,
        headers.length > 0 ? headers : undefined
      );
      await store.updateTaskStatus(task.id, "queued", {
        gid,
        error_msg: null,
        speed: 0,
      });
      store.addLog("info", `Started download: ${task.filename}`);
    } catch (e) {
      await store.updateTaskStatus(task.id, "failed", {
        error_msg: String(e),
      });
      store.addLog("error", `Failed to start ${task.filename}: ${e}`);
    }
  },

  pauseTask: async (task) => {
    try {
      if (task.gid) await api.pauseDownload(task.gid);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("is not found")) {
        get().addLog("error", `Failed to pause ${task.filename}: ${e}`);
      }
    }
    await get().updateTaskStatus(task.id, "paused", { speed: 0 });
    get().addLog("info", `Paused: ${task.filename}`);
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
        get().addLog("info", `Resumed: ${current.filename}`);
      } else {
        await get().startDownload(current);
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes("is not found") || msg.includes("cannot be unpaused")) {
        get().addLog("info", `Re-downloading: ${current.filename}`);
        await get().startDownload(current);
      } else {
        get().addLog("error", `Failed to resume ${current.filename}: ${e}`);
      }
    }
  },

  cancelTask: async (task) => {
    try {
      if (task.gid) await api.cancelDownload(task.gid);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("is not found")) {
        get().addLog("error", `Failed to cancel ${task.filename}: ${e}`);
        return;
      }
    }
    await get().updateTaskStatus(task.id, "failed", {
      error_msg: "Cancelled by user",
      speed: 0,
    });
    get().addLog("info", `Cancelled: ${task.filename}`);
  },

  retryTask: async (task) => {
    const store = get();
    await store.updateTaskStatus(task.id, "pending", {
      error_msg: null,
      progress: 0,
      speed: 0,
      downloaded_size: 0,
    });
    const updatedTask = store.tasks.find((t) => t.id === task.id);
    if (updatedTask) {
      await store.startDownload({ ...updatedTask, status: "pending" });
    }
  },

  handleGidStarted: async (gid) => {
    const task = get().tasks.find((t) => t.gid === gid);
    if (task && task.status !== "downloading") {
      await get().updateTaskStatus(task.id, "downloading");
    }
  },

  handleGidComplete: async (gid) => {
    const task = get().tasks.find((t) => t.gid === gid);
    if (task && task.status !== "completed") {
      await get().updateTaskStatus(task.id, "completed", {
        downloaded_size: task.file_size ?? task.downloaded_size ?? 0,
        speed: 0,
      });
      get().addLog("info", `Completed: ${task.filename}`);
    }
  },

  handleGidError: async (gid) => {
    const task = get().tasks.find((t) => t.gid === gid);
    if (task && task.status !== "failed") {
      try {
        const status = await api.getDownloadStatus(gid);
        const errMsg = String(status.errorMessage ?? "Unknown error");
        await get().updateTaskStatus(task.id, "failed", { error_msg: errMsg });
      } catch {
        await get().updateTaskStatus(task.id, "failed", { error_msg: "Download failed" });
      }
      get().addLog("error", `Failed: ${task.filename}`);
    }
  },

  handleGidPause: async (gid) => {
    const task = get().tasks.find((t) => t.gid === gid);
    if (task && (task.status === "downloading" || task.status === "queued")) {
      await get().updateTaskStatus(task.id, "paused", { speed: 0 });
    }
  },

  pollActiveDownloads: async () => {
    const { tasks } = get();
    const trackedTasks = tasks.filter(
      (t) => (t.status === "downloading" || t.status === "queued") && t.gid
    );
    if (trackedTasks.length === 0) return;

    try {
      const allDownloads = await api.getActiveDownloads();
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

          get().updateTaskByGid(task.gid, {
            progress,
            speed,
            downloaded_size: completed,
            file_size: total || task.file_size,
          });

          if (aria2Status === "active" && task.status !== "downloading") {
            await get().updateTaskStatus(task.id, "downloading");
          } else if (aria2Status === "waiting" && task.status !== "queued") {
            await get().updateTaskStatus(task.id, "queued", { speed: 0 });
          } else if (aria2Status === "complete") {
            await get().updateTaskStatus(task.id, "completed", {
              downloaded_size: total,
              speed: 0,
            });
            get().addLog("info", `Completed: ${task.filename}`);
          } else if (aria2Status === "error") {
            const errMsg = String(status.errorMessage ?? "Unknown error");
            await get().updateTaskStatus(task.id, "failed", { error_msg: errMsg });
            get().addLog("error", `Failed: ${task.filename} - ${errMsg}`);
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

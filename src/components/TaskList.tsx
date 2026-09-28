import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTaskStore } from "@/stores/taskStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  formatEta,
  formatSpeed,
  formatTransferred,
} from "@/lib/download-format";
import { useI18n } from "@/lib/i18n";
import type { TaskListFilter, TaskStatus } from "@/lib/types";
import { ask } from "@tauri-apps/plugin-dialog";
import TaskItem from "./TaskItem";
import {
  Clock3,
  Download,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { getTaskStatusMeta } from "@/lib/task-status";
import TaskContextMenu from "./TaskContextMenu";
import * as api from "@/lib/api";

export default function TaskList() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<TaskListFilter>("all");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    taskId: number;
  } | null>(null);
  const tasks = useTaskStore((s) => s.tasks);
  const getTasksByFilter = useTaskStore((s) => s.getTasksByFilter);
  const getTaskSummary = useTaskStore((s) => s.getTaskSummary);
  const clearAllTasks = useTaskStore((s) => s.clearAllTasks);
  const retryFailedTasks = useTaskStore((s) => s.retryFailedTasks);
  const clearCompletedTasks = useTaskStore((s) => s.clearCompletedTasks);
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const setSelectedTaskIds = useTaskStore((s) => s.setSelectedTaskIds);
  const toggleTaskSelection = useTaskStore((s) => s.toggleTaskSelection);
  const clearTaskSelection = useTaskStore((s) => s.clearTaskSelection);
  const toggleVisibleTasks = useTaskStore((s) => s.toggleVisibleTasks);
  const isTaskSelected = useTaskStore((s) => s.isTaskSelected);
  const startSelectedTasks = useTaskStore((s) => s.startSelectedTasks);
  const pauseSelectedTasks = useTaskStore((s) => s.pauseSelectedTasks);
  const deleteSelectedTasks = useTaskStore((s) => s.deleteSelectedTasks);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const retryTask = useTaskStore((s) => s.retryTask);
  const maxConcurrent = useSettingsStore((s) => s.settings.aria2_max_concurrent);

  const summary = getTaskSummary();
  const visibleTasks = useMemo(
    () => getTasksByFilter(filter),
    [filter, tasks, getTasksByFilter]
  );
  const activeTasks = tasks.filter(
    (task) => task.status === "queued" || task.status === "downloading"
  );
  const totalDownloaded = activeTasks.reduce(
    (sum, task) => sum + (task.downloaded_size ?? 0),
    0
  );
  const knownTotal = activeTasks.reduce((sum, task) => sum + (task.file_size ?? 0), 0);
  const totalSpeed = tasks
    .filter((task) => task.status === "downloading")
    .reduce((sum, task) => sum + task.speed, 0);
  const totalRemaining = activeTasks.reduce(
    (sum, task) => sum + Math.max(0, (task.file_size ?? 0) - (task.downloaded_size ?? 0)),
    0
  );
  const totalEta = totalSpeed > 0
    ? totalRemaining / totalSpeed
    : null;
  const selectedTasks = tasks.filter((task) => selectedTaskIds.includes(task.id));
  const startableCount = selectedTasks.filter((task) =>
    task.status === "pending" || task.status === "paused" || task.status === "failed"
  ).length;
  const pausableCount = selectedTasks.filter((task) =>
    task.status === "queued" || task.status === "downloading"
  ).length;
  const filterLabels: Record<TaskListFilter, string> = {
    all: t("taskList.filter.all"),
    active: t("taskList.filter.active"),
    queued: t("taskList.filter.queued"),
    paused: t("taskList.filter.paused"),
    failed: t("taskList.filter.failed"),
    completed: t("taskList.filter.completed"),
  };
  const contextTasks = useMemo(() => {
    if (!contextMenu) return [];
    const targetTask = tasks.find((task) => task.id === contextMenu.taskId);
    if (!targetTask) return [];
    if (selectedTaskIds.includes(targetTask.id) && selectedTaskIds.length > 1) {
      return tasks.filter((task) => selectedTaskIds.includes(task.id));
    }
    return [targetTask];
  }, [contextMenu, selectedTaskIds, tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Download className="h-12 w-12 opacity-20" />
        <p className="text-sm">{t("taskList.empty.title")}</p>
        <p className="text-xs">{t("taskList.empty.subtitle")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground">
              {t("taskList.summary.tasks", {
                count: summary.total,
                suffix: summary.total !== 1 ? "s" : "",
              })}
            </span>
            <span className="text-muted-foreground">
              {t("taskList.selection.selected", { count: selectedTaskIds.length })}
            </span>
            <span className="text-muted-foreground">
              {t("taskList.selection.visible", { count: visibleTasks.length })}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              disabled={visibleTasks.length === 0}
              onClick={() => toggleVisibleTasks(visibleTasks.map((task) => task.id))}
            >
              <Download className="h-3 w-3" />
              {visibleTasks.length > 0
                && visibleTasks.every((task) => selectedTaskIds.includes(task.id))
                ? t("taskList.selection.deselectVisible")
                : t("taskList.selection.selectVisible")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              disabled={selectedTaskIds.length === 0 || startableCount === 0}
              onClick={() => startSelectedTasks(selectedTaskIds)}
            >
              <Play className="h-3 w-3" />
              {t("taskList.selection.start")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              disabled={selectedTaskIds.length === 0 || pausableCount === 0}
              onClick={() => pauseSelectedTasks(selectedTaskIds)}
            >
              <Pause className="h-3 w-3" />
              {t("taskList.selection.pause")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
              disabled={selectedTaskIds.length === 0}
              onClick={async () => {
                const yes = await ask(
                  t("taskList.deleteSelectedConfirm", { count: selectedTaskIds.length }),
                  {
                    title: t("common.confirm"),
                    kind: "warning",
                  }
                );
                if (yes) {
                  await deleteSelectedTasks(selectedTaskIds);
                }
              }}
            >
              <Trash2 className="h-3 w-3" />
              {t("taskList.selection.delete")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              disabled={selectedTaskIds.length === 0}
              onClick={() => clearTaskSelection()}
            >
              <X className="h-3 w-3" />
              {t("taskList.selection.cancel")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              disabled={summary.failed === 0}
              onClick={() => retryFailedTasks()}
            >
              <RotateCcw className="h-3 w-3" />
              {t("taskList.actions.retryFailed")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
              disabled={summary.completed === 0}
              onClick={async () => {
                const yes = await ask(t("taskList.clearCompletedConfirm"), {
                  title: t("common.confirm"),
                  kind: "warning",
                });
                if (yes) clearCompletedTasks();
              }}
            >
              <Trash2 className="h-3 w-3" />
              {t("taskList.actions.clearCompleted")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
              onClick={async () => {
                const yes = await ask(t("taskList.clearAllConfirm"), {
                  title: t("common.confirm"),
                  kind: "warning",
                });
                if (yes) clearAllTasks();
              }}
            >
              <Trash2 className="h-3 w-3" />
              {t("taskList.actions.clearAll")}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterCard
            active={filter === "all"}
            icon={Download}
            label={t("taskList.filter.all")}
            countLabel={String(summary.total)}
            onClick={() => setFilter("all")}
          />
          <FilterCard
            active={filter === "active"}
            icon={Gauge}
            status="downloading"
            label={t("taskList.filter.active")}
            countLabel={t("taskList.summary.downloading", {
              current: summary.downloading,
              max: maxConcurrent || "3",
            })}
            onClick={() => setFilter("active")}
          />
          <FilterCard
            active={filter === "queued"}
            icon={Clock3}
            status="queued"
            label={t("taskList.filter.queued")}
            countLabel={String(summary.queued)}
            onClick={() => setFilter("queued")}
          />
          <FilterCard
            active={filter === "paused"}
            icon={Pause}
            status="paused"
            label={t("taskList.filter.paused")}
            countLabel={String(summary.paused)}
            onClick={() => setFilter("paused")}
          />
          <FilterCard
            active={filter === "failed"}
            icon={Trash2}
            status="failed"
            label={t("taskList.filter.failed")}
            countLabel={String(summary.failed)}
            onClick={() => setFilter("failed")}
          />
          <FilterCard
            active={filter === "completed"}
            icon={Play}
            status="completed"
            label={t("taskList.filter.completed")}
            countLabel={String(summary.completed)}
            onClick={() => setFilter("completed")}
          />
        </div>
        {activeTasks.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card/70 px-2 py-1 text-muted-foreground">
              <Download className="h-3.5 w-3.5" />
              {formatTransferred(totalDownloaded, knownTotal)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-downloading-border)] bg-[var(--status-downloading-bg)] px-2 py-1 text-[var(--status-downloading-fg)]">
              <Gauge className="h-3.5 w-3.5" />
              {formatSpeed(totalSpeed)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] px-2 py-1 text-[var(--status-completed-fg)]">
              <Clock3 className="h-3.5 w-3.5" />
              {t("common.eta")} {formatEta(totalEta)}
            </span>
          </div>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {visibleTasks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-muted-foreground">
            <p className="text-sm">
              {filter === "all"
                ? t("taskList.empty.title")
                : t("taskList.noTasksForFilter", {
                  filter: filterLabels[filter] ?? filter,
                })}
            </p>
            <p className="text-xs">{t("taskList.tryAnotherFilter")}</p>
          </div>
        ) : (
          <div className="divide-y">
            {visibleTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                selected={isTaskSelected(task.id)}
                onToggleSelected={() => toggleTaskSelection(task.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!selectedTaskIds.includes(task.id)) {
                    setSelectedTaskIds([task.id]);
                  }
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    taskId: task.id,
                  });
                }}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      <TaskContextMenu
        open={!!contextMenu}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        selectedCount={contextTasks.length}
        tasks={contextTasks}
        onClose={() => setContextMenu(null)}
        onAction={async (action) => {
          const taskIds = contextTasks.map((task) => task.id);
          const singleTask = contextTasks.length === 1 ? contextTasks[0] : null;
          if (taskIds.length === 0) return;

          switch (action) {
            case "start":
              await startSelectedTasks(taskIds);
              break;
            case "pause":
              await pauseSelectedTasks(taskIds);
              break;
            case "retry":
              for (const task of contextTasks.filter((item) => item.status === "failed")) {
                await retryTask(task);
              }
              break;
            case "cancel":
              for (const task of contextTasks.filter((item) =>
                item.status === "queued" || item.status === "downloading" || item.status === "paused"
              )) {
                await cancelTask(task);
              }
              break;
            case "delete": {
              const yes = await ask(
                t("taskList.deleteSelectedConfirm", { count: taskIds.length }),
                {
                  title: t("common.confirm"),
                  kind: "warning",
                }
              );
              if (yes) {
                await deleteSelectedTasks(taskIds);
              }
              break;
            }
            case "openDirectory":
              if (singleTask?.target_dir) {
                try {
                  await api.openDirectory(singleTask.target_dir);
                } catch (e) {
                  useTaskStore.getState().addLog("error", String(e));
                }
              }
              break;
            case "viewDetails":
              if (singleTask) {
                setSelectedTask(singleTask.id);
              }
              break;
          }
        }}
      />
    </div>
  );
}

function FilterCard({
  active,
  icon: Icon,
  status,
  label,
  countLabel,
  onClick,
}: {
  active: boolean;
  icon: typeof Download;
  status?: TaskStatus;
  label: string;
  countLabel: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const meta = status ? getTaskStatusMeta(t)[status] : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors",
        active
          ? meta
            ? meta.chipClass
            : "border-primary/40 bg-primary/10 text-primary"
          : "border-border/70 bg-card/60 hover:bg-muted/50"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      <span className={cn("text-muted-foreground", active && "text-current/80")}>
        {countLabel}
      </span>
    </button>
  );
}

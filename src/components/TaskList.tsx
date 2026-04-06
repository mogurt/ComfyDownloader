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
  CheckSquare,
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

export default function TaskList() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<TaskListFilter>("all");
  const tasks = useTaskStore((s) => s.tasks);
  const getTasksByFilter = useTaskStore((s) => s.getTasksByFilter);
  const getTaskSummary = useTaskStore((s) => s.getTaskSummary);
  const clearAllTasks = useTaskStore((s) => s.clearAllTasks);
  const retryFailedTasks = useTaskStore((s) => s.retryFailedTasks);
  const clearCompletedTasks = useTaskStore((s) => s.clearCompletedTasks);
  const selectionMode = useTaskStore((s) => s.selectionMode);
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds);
  const setSelectionMode = useTaskStore((s) => s.setSelectionMode);
  const toggleTaskSelection = useTaskStore((s) => s.toggleTaskSelection);
  const clearTaskSelection = useTaskStore((s) => s.clearTaskSelection);
  const toggleVisibleTasks = useTaskStore((s) => s.toggleVisibleTasks);
  const isTaskSelected = useTaskStore((s) => s.isTaskSelected);
  const startSelectedTasks = useTaskStore((s) => s.startSelectedTasks);
  const pauseSelectedTasks = useTaskStore((s) => s.pauseSelectedTasks);
  const deleteSelectedTasks = useTaskStore((s) => s.deleteSelectedTasks);
  const maxConcurrent = useSettingsStore((s) => s.settings.aria2_max_concurrent);

  const summary = getTaskSummary();
  const visibleTasks = useMemo(
    () => getTasksByFilter(filter),
    [filter, getTasksByFilter, tasks]
  );
  const activeTasks = tasks.filter(
    (task) => task.status === "queued" || task.status === "downloading"
  );
  const filterOptions: Array<{ value: TaskListFilter; label: string }> = [
    { value: "all", label: t("taskList.filter.all") },
    { value: "active", label: t("taskList.filter.active") },
    { value: "queued", label: t("taskList.filter.queued") },
    { value: "paused", label: t("taskList.filter.paused") },
    { value: "failed", label: t("taskList.filter.failed") },
    { value: "completed", label: t("taskList.filter.completed") },
  ];
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
  const selectedVisibleIds = visibleTasks
    .map((task) => task.id)
    .filter((id) => selectedTaskIds.includes(id));
  const selectedTasks = tasks.filter((task) => selectedTaskIds.includes(task.id));
  const startableCount = selectedTasks.filter((task) =>
    task.status === "pending" || task.status === "paused" || task.status === "failed"
  ).length;
  const pausableCount = selectedTasks.filter((task) =>
    task.status === "queued" || task.status === "downloading"
  ).length;

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
      <div className="space-y-2 border-b px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!selectionMode ? (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-muted-foreground">
                  {t("taskList.summary.tasks", {
                    count: summary.total,
                    suffix: summary.total !== 1 ? "s" : "",
                  })}
                </span>
                <StatusPill
                  t={t}
                  status="downloading"
                  label={t("taskList.summary.downloading", {
                    current: summary.downloading,
                    max: maxConcurrent || "3",
                  })}
                />
                <StatusPill t={t} status="queued" label={t("taskList.summary.queued", { count: summary.queued })} />
                <StatusPill t={t} status="paused" label={t("taskList.summary.paused", { count: summary.paused })} />
                <StatusPill t={t} status="failed" label={t("taskList.summary.failed", { count: summary.failed })} />
                <StatusPill t={t} status="completed" label={t("taskList.summary.completed", { count: summary.completed })} />
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-muted-foreground"
                  onClick={() => {
                    clearTaskSelection();
                    setSelectionMode(true);
                  }}
                >
                  <CheckSquare className="h-3 w-3" />
                  {t("taskList.actions.select")}
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
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{t("taskList.selection.selected", { count: selectedTaskIds.length })}</span>
                <span>{t("taskList.selection.visible", { count: selectedVisibleIds.length })}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-muted-foreground"
                  disabled={visibleTasks.length === 0}
                  onClick={() => toggleVisibleTasks(visibleTasks.map((task) => task.id))}
                >
                  <CheckSquare className="h-3 w-3" />
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
                  onClick={() => {
                    clearTaskSelection();
                    setSelectionMode(false);
                  }}
                >
                  <X className="h-3 w-3" />
                  {t("taskList.selection.cancel")}
                </Button>
              </div>
            </>
          )}
        </div>
        {!selectionMode && activeTasks.length > 0 && (
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
        <div className="flex flex-wrap items-center gap-1">
          {filterOptions.map((option) => (
            <Button
              key={option.value}
              variant={filter === option.value ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {visibleTasks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-muted-foreground">
            <p className="text-sm">
              {filter === "all"
                ? t("taskList.empty.title")
                : t("taskList.noTasksForFilter", {
                  filter: filterOptions.find((option) => option.value === filter)?.label ?? filter,
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
                selectionMode={selectionMode}
                selected={isTaskSelected(task.id)}
                onToggleSelected={() => toggleTaskSelection(task.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function StatusPill({
  t,
  status,
  label,
}: {
  t: (key: import("@/lib/i18n").TranslationKey, params?: Record<string, string | number>) => string;
  status: TaskStatus;
  label: string;
}) {
  const meta = getTaskStatusMeta(t)[status];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1",
        meta.chipClass
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

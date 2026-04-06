import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useTaskStore } from "@/stores/taskStore";
import * as api from "@/lib/api";
import type { DownloadTask } from "@/lib/types";
import {
  formatEta,
  formatSpeed,
  formatTransferred,
} from "@/lib/download-format";
import { useI18n } from "@/lib/i18n";
import {
  getDisplayTaskStatus,
  getTaskStatusMeta,
  getTaskVisualProgress,
} from "@/lib/task-status";

interface Props {
  task: DownloadTask;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
}

export default function TaskItem({
  task,
  selectionMode = false,
  selected = false,
  onToggleSelected,
}: Props) {
  const { t } = useI18n();
  const { pauseTask, resumeTask, cancelTask, retryTask, deleteTask, setSelectedTask } =
    useTaskStore();
  const displayStatus = getDisplayTaskStatus(task);
  const statusMeta = getTaskStatusMeta(t)[displayStatus];
  const StatusIcon = statusMeta.icon;
  const visualProgress = getTaskVisualProgress(task);
  const remainingBytes = Math.max(0, (task.file_size ?? 0) - (task.downloaded_size ?? 0));
  const eta = displayStatus === "downloading" && task.speed > 0 && task.file_size
    ? remainingBytes / task.speed
    : null;

  return (
    <div
      className={cn(
        "group flex items-center gap-3 border-b px-4 py-3 transition-colors hover:bg-muted/50 cursor-pointer",
        selectionMode && selected && "bg-primary/5"
      )}
      onClick={() => {
        if (selectionMode) {
          onToggleSelected?.();
          return;
        }
        setSelectedTask(task.id);
      }}
    >
      {selectionMode && (
        <label
          className="flex shrink-0 items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border accent-primary"
            checked={selected}
            onChange={() => onToggleSelected?.()}
          />
        </label>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusIcon className={cn("h-4 w-4 shrink-0", statusMeta.textClass)} />
          <span className="truncate text-sm font-medium">{task.filename}</span>
          <Badge
            variant="outline"
            className={cn("border text-xs shadow-none", statusMeta.chipClass)}
          >
            {statusMeta.label}
          </Badge>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{task.source}</span>
          <span>{task.model_type}</span>
          <span>{formatTransferred(task.downloaded_size, task.file_size)}</span>
          {displayStatus === "allocating" && (
            <span className={cn("font-medium", statusMeta.textClass)}>
              {t("taskItem.allocating", { progress: Math.round(visualProgress) })}
            </span>
          )}
          {displayStatus === "downloading" && (
            <span className={cn("font-medium", statusMeta.textClass)}>
              {formatSpeed(task.speed)}
              {eta != null ? ` · ETA ${formatEta(eta)}` : ""}
            </span>
          )}
        </div>
        {(task.status === "queued" ||
          task.status === "downloading" ||
          task.status === "paused") && (
          <Progress value={visualProgress} className="mt-2 h-1.5" />
        )}
        {task.error_msg && task.status === "failed" && (
          <p className="mt-1 truncate text-xs text-destructive">
            {task.error_msg}
          </p>
        )}
      </div>

      <div
        className={cn(
          "flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100",
          selectionMode && "pointer-events-none opacity-25 grayscale"
        )}
      >
        {(task.status === "downloading" || task.status === "queued") && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t("taskItem.pause")}
            onClick={(e) => {
              e.stopPropagation();
              pauseTask(task);
            }}
          >
            <Pause className="h-3.5 w-3.5" />
          </Button>
        )}
        {task.status === "paused" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t("taskItem.resume")}
            onClick={(e) => {
              e.stopPropagation();
              resumeTask(task);
            }}
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
        )}
        {task.status === "failed" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t("taskItem.retry")}
            onClick={(e) => {
              e.stopPropagation();
              retryTask(task);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        {(task.status === "queued" ||
          task.status === "downloading" ||
          task.status === "paused") && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t("taskItem.cancel")}
            onClick={(e) => {
              e.stopPropagation();
              cancelTask(task);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
        {task.target_dir && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t("taskItem.openDirectory")}
            onClick={(e) => {
              e.stopPropagation();
              api.openDirectory(task.target_dir).catch(console.error);
            }}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        )}
        {(task.status === "completed" ||
          task.status === "failed" ||
          task.status === "skipped") && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t("taskItem.deleteRecord")}
            onClick={(e) => {
              e.stopPropagation();
              deleteTask(task.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

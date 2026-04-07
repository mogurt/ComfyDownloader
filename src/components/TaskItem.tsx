import type { MouseEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useTaskStore } from "@/stores/taskStore";
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
  selected: boolean;
  onToggleSelected: () => void;
  onOpenDetails: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
}

export default function TaskItem({
  task,
  selected,
  onToggleSelected,
  onOpenDetails,
  onContextMenu,
}: Props) {
  const { t } = useI18n();
  const { setSelectedTask } = useTaskStore();
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
        selected && "bg-primary/5"
      )}
      onContextMenu={onContextMenu}
      onClick={() => {
        onToggleSelected();
      }}
      onDoubleClick={() => {
        setSelectedTask(task.id);
        onOpenDetails();
      }}
    >
      <label
        className="flex shrink-0 items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border accent-primary"
          checked={selected}
          onChange={onToggleSelected}
          aria-label={t("taskItem.selectTask")}
        />
      </label>
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
    </div>
  );
}

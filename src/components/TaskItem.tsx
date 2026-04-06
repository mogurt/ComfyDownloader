import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Pause, Play, RotateCcw, X, Trash2, FolderOpen } from "lucide-react";
import { useTaskStore } from "@/stores/taskStore";
import * as api from "@/lib/api";
import type { DownloadTask } from "@/lib/types";

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return "-";
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
  if (bytesPerSec < 1024 * 1024)
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatSize(bytes: number | null): string {
  if (!bytes || bytes === 0) return "-";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "outline",
  downloading: "default",
  paused: "secondary",
  completed: "default",
  failed: "destructive",
  skipped: "secondary",
};

const statusLabel: Record<string, string> = {
  pending: "Pending",
  downloading: "Downloading",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

interface Props {
  task: DownloadTask;
}

export default function TaskItem({ task }: Props) {
  const { pauseTask, resumeTask, cancelTask, retryTask, deleteTask, setSelectedTask } =
    useTaskStore();

  return (
    <div
      className="group flex items-center gap-3 border-b px-4 py-3 transition-colors hover:bg-muted/50 cursor-pointer"
      onClick={() => setSelectedTask(task.id)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{task.filename}</span>
          <Badge
            variant={statusVariant[task.status] || "outline"}
            className="text-xs"
          >
            {statusLabel[task.status] || task.status}
          </Badge>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{task.source}</span>
          <span>{task.model_type}</span>
          <span>{formatSize(task.file_size)}</span>
          {task.status === "downloading" && (
            <span className="text-primary font-medium">
              {formatSpeed(task.speed)}
            </span>
          )}
        </div>
        {(task.status === "downloading" || task.status === "paused") && (
          <Progress value={task.progress} className="mt-2 h-1.5" />
        )}
        {task.error_msg && task.status === "failed" && (
          <p className="mt-1 truncate text-xs text-destructive">
            {task.error_msg}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {task.status === "downloading" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Pause"
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
            title="Resume"
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
            title="Retry"
            onClick={(e) => {
              e.stopPropagation();
              retryTask(task);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        {(task.status === "downloading" || task.status === "paused") && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Cancel"
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
            title="Open download directory"
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
            title="Delete record"
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

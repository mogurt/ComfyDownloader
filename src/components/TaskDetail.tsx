import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FolderOpen } from "lucide-react";
import { useTaskStore } from "@/stores/taskStore";
import * as api from "@/lib/api";

function formatSize(bytes: number | null): string {
  if (!bytes || bytes === 0) return "-";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTransferred(downloaded: number | null | undefined, total: number | null): string {
  if (!downloaded && !total) return "-";
  if (total && total > 0) {
    return `${formatSize(downloaded ?? 0)} / ${formatSize(total)}`;
  }
  return formatSize(downloaded ?? 0);
}

export default function TaskDetail() {
  const { tasks, selectedTaskId, setSelectedTask } = useTaskStore();
  const task = tasks.find((t) => t.id === selectedTaskId);

  return (
    <Sheet open={!!task} onOpenChange={(open) => !open && setSelectedTask(null)}>
      <SheetContent className="flex w-[400px] flex-col sm:w-[450px] p-6">
        <SheetHeader className="shrink-0">
          <SheetTitle className="truncate pr-4">
            {task?.filename || "Task Details"}
          </SheetTitle>
        </SheetHeader>
        {task && (
          <ScrollArea className="mt-4 min-h-0 flex-1">
            <div className="space-y-4 pr-3">
              <DetailRow label="Status">
                <Badge
                  variant={
                    task.status === "completed"
                      ? "default"
                      : task.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {task.status}
                </Badge>
              </DetailRow>

              <DetailRow label="URL">
                <span className="break-all text-xs">{task.url}</span>
              </DetailRow>

              <Separator />

              <DetailRow label="Source">{task.source}</DetailRow>
              <DetailRow label="Model Type">{task.model_type}</DetailRow>
              <DetailRow label="Target Directory">
                <div className="flex items-center gap-1">
                  <span className="break-all text-xs">{task.target_dir}</span>
                  {task.target_dir && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      title="Open directory"
                      onClick={() => api.openDirectory(task.target_dir).catch(console.error)}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </DetailRow>
              <DetailRow label="File Size">{formatSize(task.file_size)}</DetailRow>
              <DetailRow label="Downloaded">
                {formatTransferred(task.downloaded_size, task.file_size)}
              </DetailRow>

              <Separator />

              <DetailRow label="Progress">
                {task.progress.toFixed(1)}%
              </DetailRow>
              <DetailRow label="GID">{task.gid || "-"}</DetailRow>
              <DetailRow label="Created">{task.created_at}</DetailRow>
              {task.completed_at && (
                <DetailRow label="Completed">{task.completed_at}</DetailRow>
              )}

              {task.error_msg && (
                <>
                  <Separator />
                  <DetailRow label="Error">
                    <span className="text-destructive text-xs">
                      {task.error_msg}
                    </span>
                  </DetailRow>
                </>
              )}

              {task.hash && (
                <>
                  <Separator />
                  <DetailRow label="SHA256">
                    <span className="break-all font-mono text-xs">
                      {task.hash}
                    </span>
                  </DetailRow>
                </>
              )}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

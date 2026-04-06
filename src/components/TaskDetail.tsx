import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FolderOpen, Link2, Logs, Timer, Zap } from "lucide-react";
import { useTaskStore } from "@/stores/taskStore";
import * as api from "@/lib/api";
import {
  formatEta,
  formatSize,
  formatSpeed,
  formatTransferred,
} from "@/lib/download-format";
import { useI18n } from "@/lib/i18n";
import { getTaskStatusMeta } from "@/lib/task-status";

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function TaskDetail() {
  const { t } = useI18n();
  const { tasks, selectedTaskId, setSelectedTask, getTaskLogs } = useTaskStore();
  const task = tasks.find((t) => t.id === selectedTaskId);
  const taskLogs = task ? getTaskLogs(task.id, task.gid).slice(-50) : [];
  const statusMeta = task ? getTaskStatusMeta(t)[task.status] : null;
  const remainingBytes = task
    ? Math.max(0, (task.file_size ?? 0) - (task.downloaded_size ?? 0))
    : null;
  const etaSeconds = task && task.speed > 0 && remainingBytes != null
    ? remainingBytes / task.speed
    : null;

  return (
    <Sheet open={!!task} onOpenChange={(open) => !open && setSelectedTask(null)}>
      <SheetContent className="flex w-[420px] flex-col border-l border-border/70 bg-card/96 p-0 backdrop-blur sm:w-[480px]">
        <SheetHeader className="shrink-0">
          <div className="border-b border-border/70 bg-background/60 px-6 py-5">
            <SheetTitle className="truncate pr-4 text-base">
              {task?.filename || t("taskDetail.title")}
            </SheetTitle>
            {task && statusMeta && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn("border text-xs shadow-none", statusMeta.chipClass)}
                >
                  <statusMeta.icon className="h-3.5 w-3.5" />
                  {statusMeta.label}
                </Badge>
                <StatChip icon={Zap} label={formatSpeed(task.speed)} />
                <StatChip icon={Timer} label={`${t("common.eta")} ${formatEta(etaSeconds)}`} />
              </div>
            )}
          </div>
        </SheetHeader>
        {task && (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 px-6 py-5">
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label={t("taskDetail.downloaded")} value={formatTransferred(task.downloaded_size, task.file_size)} />
                <MetricCard label={t("taskDetail.remaining")} value={formatSize(remainingBytes)} />
                <MetricCard label={t("taskDetail.progress")} value={`${task.progress.toFixed(1)}%`} />
                <MetricCard label={t("taskDetail.lastActive")} value={formatDateTime(task.last_active_at)} />
              </div>

              <SectionCard title={t("taskDetail.sourceDetails")} icon={Link2}>
                <DetailRow label={t("taskDetail.url")}>
                  <span className="break-all text-xs leading-5 text-muted-foreground">{task.url}</span>
                </DetailRow>
                <DetailRow label={t("taskDetail.source")}>{task.source}</DetailRow>
                <DetailRow label={t("taskDetail.modelType")}>{task.model_type}</DetailRow>
                <DetailRow label={t("taskDetail.targetDirectory")}>
                  <div className="flex items-start gap-2">
                    <span className="break-all text-xs leading-5 text-muted-foreground">{task.target_dir}</span>
                    {task.target_dir && (
                      <Button
                        variant="outline"
                        size="icon-sm"
                        className="shrink-0"
                        title={t("taskDetail.openDirectory")}
                        onClick={() => api.openDirectory(task.target_dir).catch(console.error)}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </DetailRow>
              </SectionCard>

              <SectionCard title={t("taskDetail.transferMetrics")} icon={Zap}>
                <DetailRow label={t("taskDetail.fileSize")}>{formatSize(task.file_size)}</DetailRow>
                <DetailRow label={t("taskDetail.currentSpeed")}>{formatSpeed(task.speed)}</DetailRow>
                <DetailRow label={t("common.eta")}>{formatEta(etaSeconds)}</DetailRow>
              </SectionCard>

              <SectionCard title={t("taskDetail.runtimeMetadata")} icon={Timer}>
                <DetailRow label={t("taskDetail.gid")}>{task.gid || t("common.none")}</DetailRow>
                <DetailRow label={t("taskDetail.created")}>{formatDateTime(task.created_at)}</DetailRow>
                {task.completed_at && (
                  <DetailRow label={t("taskDetail.completed")}>{formatDateTime(task.completed_at)}</DetailRow>
                )}
              </SectionCard>

              <SectionCard title={t("taskDetail.taskLogs")} icon={Logs}>
                <div className="rounded-xl border border-border/70 bg-background/60">
                  <ScrollArea className="h-44 px-3 py-3">
                    <div className="space-y-1.5 font-mono text-xs">
                      {taskLogs.length === 0 ? (
                        <span className="text-muted-foreground">{t("taskDetail.noTaskLogs")}</span>
                      ) : (
                        taskLogs.map((log) => (
                          <div key={log.id} className="flex gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/40">
                            <span className="shrink-0 text-muted-foreground">
                              {log.timestamp}
                            </span>
                            <span className={cn("shrink-0 font-medium", getLogLevelClass(log.level))}>
                              [{log.level}]
                            </span>
                            <span className="break-words leading-5">{log.message}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </SectionCard>

              {task.error_msg && (
                <SectionCard title={t("taskDetail.error")}>
                  <DetailRow label={t("common.message")}>
                    <span className="text-xs text-destructive">
                      {task.error_msg}
                    </span>
                  </DetailRow>
                </SectionCard>
              )}

              {task.hash && (
                <SectionCard title={t("taskDetail.integrity")}>
                  <DetailRow label="SHA256">
                    <span className="break-all font-mono text-xs">
                      {task.hash}
                    </span>
                  </DetailRow>
                </SectionCard>
              )}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

function getLogLevelClass(level: "info" | "warn" | "error") {
  if (level === "error") return "text-destructive";
  if (level === "warn") return "text-[var(--status-queued-fg)]";
  return "text-muted-foreground";
}

function StatChip({
  icon: Icon,
  label,
}: {
  icon: typeof Zap;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-1 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: typeof Link2;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {Icon ? <Icon className="h-4 w-4 text-primary" /> : null}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
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

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useTaskStore } from "@/stores/taskStore";
import { ChevronDown, ChevronUp, Logs, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

type LogLevelFilter = "important" | "all" | "error";
type LogTypeFilter = "all" | "app" | "aria2";

function getLogType(message: string): LogTypeFilter {
  return message.startsWith("[aria2 ") ? "aria2" : "app";
}

function getLogLevelClass(level: "info" | "warn" | "error") {
  if (level === "error") return "text-[var(--status-failed-fg)]";
  if (level === "warn") return "text-[var(--status-queued-fg)]";
  return "text-muted-foreground";
}

export default function LogPanel() {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>("important");
  const [typeFilter, setTypeFilter] = useState<LogTypeFilter>("all");
  const { logs, clearLogs } = useTaskStore();

  const recentLogs = logs
    .filter((log) => {
      if (levelFilter === "error") return log.level === "error";
      if (levelFilter === "important") return log.level === "warn" || log.level === "error";
      return true;
    })
    .filter((log) => typeFilter === "all" || getLogType(log.message) === typeFilter)
    .slice(-30);

  return (
    <div className="border-t border-border/70 bg-card/55 backdrop-blur">
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:bg-muted/40 cursor-pointer select-none",
          expanded ? "px-4 py-3" : "px-3 py-1.5"
        )}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded(!expanded); }}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-lg border border-border/70 bg-background/60 text-primary",
              expanded ? "p-1.5" : "p-1"
            )}
          >
            <Logs className={expanded ? "h-4 w-4" : "h-3.5 w-3.5"} />
          </span>
          {expanded ? (
            <div>
              <div className="text-sm font-semibold text-foreground">{t("logs.title")}</div>
              <div className="text-xs text-muted-foreground">
                {t("logs.entries", { count: logs.length })}
              </div>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-foreground">{t("logs.title")}</span>
              <span className="text-xs text-muted-foreground">
                {t("logs.entries", { count: logs.length })}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {expanded && (
            <Button
              variant="outline"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                clearLogs();
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </div>
      </div>
      {expanded && (
        <div className="space-y-3 px-4 pb-4">
          <div className="flex flex-wrap gap-3">
            <FilterGroup label={t("logs.level")}>
              <FilterChip active={levelFilter === "important"} onClick={() => setLevelFilter("important")}>
                {t("logs.filter.important")}
              </FilterChip>
              <FilterChip active={levelFilter === "all"} onClick={() => setLevelFilter("all")}>
                {t("logs.filter.allLevels")}
              </FilterChip>
              <FilterChip active={levelFilter === "error"} onClick={() => setLevelFilter("error")}>
                {t("logs.filter.errors")}
              </FilterChip>
            </FilterGroup>
            <FilterGroup label={t("logs.type")}>
              <FilterChip active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
                {t("logs.filter.allTypes")}
              </FilterChip>
              <FilterChip active={typeFilter === "app"} onClick={() => setTypeFilter("app")}>
                {t("logs.filter.app")}
              </FilterChip>
              <FilterChip active={typeFilter === "aria2"} onClick={() => setTypeFilter("aria2")}>
                {t("logs.filter.aria2")}
              </FilterChip>
            </FilterGroup>
          </div>
          <ScrollArea className="h-[132px] rounded-xl border border-border/70 bg-background/60 px-2 py-2">
            <div className="space-y-1 font-mono text-xs">
            {recentLogs.map((log) => (
              <div
                key={log.id}
                className="flex gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:border-border/60 hover:bg-muted/35"
              >
                <span className="shrink-0 text-muted-foreground">{log.timestamp}</span>
                <span
                  className={cn("shrink-0 font-medium", getLogLevelClass(log.level))}
                >
                  [{log.level}]
                </span>
                <span className="shrink-0 rounded-md border border-border/70 bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {getLogType(log.message) === "app" ? t("logs.filter.app") : t("logs.filter.aria2")}
                </span>
                <span className="break-words leading-5">{log.message}</span>
              </div>
            ))}
            {recentLogs.length === 0 && (
              <div className="px-2 py-6 text-center text-muted-foreground">
                {t("logs.emptyFiltered")}
              </div>
            )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn(
        "rounded-full border border-border/70 bg-background/60 px-2.5",
        active && "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

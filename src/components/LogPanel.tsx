import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useTaskStore } from "@/stores/taskStore";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LogPanel() {
  const [expanded, setExpanded] = useState(false);
  const { logs, clearLogs } = useTaskStore();

  const recentLogs = logs.slice(-50);

  return (
    <div className="border-t">
      <div
        role="button"
        tabIndex={0}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded(!expanded); }}
      >
        <span>Logs ({logs.length})</span>
        <div className="flex items-center gap-1">
          {expanded && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
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
            <ChevronUp className="h-4 w-4" />
          )}
        </div>
      </div>
      {expanded && (
        <ScrollArea className="h-[150px] px-4 pb-2">
          <div className="space-y-0.5 font-mono text-xs">
            {recentLogs.map((log) => (
              <div key={log.id} className="flex gap-2">
                <span className="text-muted-foreground">{log.timestamp}</span>
                <span
                  className={cn(
                    log.level === "error" && "text-destructive",
                    log.level === "warn" && "text-yellow-600",
                    log.level === "info" && "text-muted-foreground"
                  )}
                >
                  [{log.level}]
                </span>
                <span>{log.message}</span>
              </div>
            ))}
            {recentLogs.length === 0 && (
              <span className="text-muted-foreground">No logs yet</span>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

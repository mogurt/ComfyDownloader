import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useTaskStore } from "@/stores/taskStore";
import { ask } from "@tauri-apps/plugin-dialog";
import TaskItem from "./TaskItem";
import { Download, Trash2 } from "lucide-react";

export default function TaskList() {
  const tasks = useTaskStore((s) => s.tasks);
  const clearAllTasks = useTaskStore((s) => s.clearAllTasks);

  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Download className="h-12 w-12 opacity-20" />
        <p className="text-sm">No download tasks yet</p>
        <p className="text-xs">Paste a model URL above to get started</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-1.5">
        <span className="text-xs text-muted-foreground">
          {tasks.length} task{tasks.length !== 1 ? "s" : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
          onClick={async () => {
            const yes = await ask("Clear all download records?", {
              title: "Confirm",
              kind: "warning",
            });
            if (yes) clearAllTasks();
          }}
        >
          <Trash2 className="h-3 w-3" />
          Clear All
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

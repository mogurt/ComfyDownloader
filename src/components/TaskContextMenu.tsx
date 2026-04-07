"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
  Info,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { DownloadTask } from "@/lib/types";

type TaskContextMenuAction =
  | "start"
  | "pause"
  | "retry"
  | "cancel"
  | "delete"
  | "openDirectory"
  | "viewDetails";

type MenuActionItem = {
  key: TaskContextMenuAction;
  label: string;
  icon: typeof Play;
  destructive?: boolean;
  disabled?: boolean;
};

interface Props {
  open: boolean;
  x: number;
  y: number;
  selectedCount: number;
  tasks: DownloadTask[];
  onClose: () => void;
  onAction: (action: TaskContextMenuAction) => void;
}

export default function TaskContextMenu({
  open,
  x,
  y,
  selectedCount,
  tasks,
  onClose,
  onAction,
}: Props) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const singleTask = tasks.length === 1 ? tasks[0] : null;
  const labels = useMemo(() => {
    if (selectedCount > 1) {
      return {
        start: t("taskList.selection.start"),
        pause: t("taskList.selection.pause"),
        retry: t("taskList.actions.retryFailed"),
        delete: t("taskList.selection.delete"),
      };
    }

    return {
      start: t("taskItem.resume"),
      pause: t("taskItem.pause"),
      retry: t("taskItem.retry"),
      delete: t("taskItem.deleteRecord"),
    };
  }, [selectedCount, t]);

  const canStart = tasks.some((task) =>
    task.status === "pending" || task.status === "paused" || task.status === "failed"
  );
  const canPause = tasks.some((task) =>
    task.status === "queued" || task.status === "downloading"
  );
  const canRetry = tasks.some((task) => task.status === "failed");
  const canCancel = tasks.some((task) =>
    task.status === "queued" || task.status === "downloading" || task.status === "paused"
  );
  const canDelete = tasks.length > 0;
  const canOpenDirectory = tasks.length === 1 && !!singleTask?.target_dir;
  const canViewDetails = tasks.length === 1;

  const items: MenuActionItem[] = [
    { key: "start", label: labels.start, icon: Play, disabled: !canStart },
    { key: "pause", label: labels.pause, icon: Pause, disabled: !canPause },
    { key: "retry", label: labels.retry, icon: RotateCcw, disabled: !canRetry },
    { key: "cancel", label: t("taskItem.cancel"), icon: X, disabled: !canCancel },
    { key: "delete", label: labels.delete, icon: Trash2, destructive: true, disabled: !canDelete },
    { key: "openDirectory", label: t("taskItem.openDirectory"), icon: FolderOpen, disabled: !canOpenDirectory },
    { key: "viewDetails", label: t("taskItem.viewDetails"), icon: Info, disabled: !canViewDetails },
  ];

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onClose);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onClose);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-48 rounded-xl border border-border/70 bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
      style={{
        left: `min(${x}px, calc(100vw - 13rem))`,
        top: `min(${y}px, calc(100vh - 18rem))`,
      }}
    >
      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
        {selectedCount > 1
          ? t("taskContextMenu.selectedCount", { count: selectedCount })
          : singleTask?.filename ?? t("taskDetail.title")}
      </div>
      <div className="-mx-1 my-1 h-px bg-border" />
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                item.disabled
                  ? "cursor-not-allowed opacity-45"
                  : "hover:bg-accent hover:text-accent-foreground",
                item.destructive && !item.disabled && "text-destructive hover:bg-destructive/10 hover:text-destructive"
              )}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                onAction(item.key);
                onClose();
              }}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

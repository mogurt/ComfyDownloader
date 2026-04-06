import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  PauseCircle,
  Play,
  SkipForward,
} from "lucide-react";

import type { TaskStatus } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";

type StatusMeta = {
  label: string;
  icon: LucideIcon;
  textClass: string;
  chipClass: string;
};

const STATUS_LABEL_KEYS: Record<TaskStatus, TranslationKey> = {
  pending: "status.pending",
  queued: "status.queued",
  downloading: "status.downloading",
  paused: "status.paused",
  completed: "status.completed",
  failed: "status.failed",
  skipped: "status.skipped",
};

export function getTaskStatusMeta(
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): Record<TaskStatus, StatusMeta> {
  return {
    pending: {
      label: t(STATUS_LABEL_KEYS.pending),
      icon: CircleDashed,
      textClass: "text-[var(--status-pending-fg)]",
      chipClass:
        "border-[var(--status-pending-border)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]",
    },
    queued: {
      label: t(STATUS_LABEL_KEYS.queued),
      icon: Clock3,
      textClass: "text-[var(--status-queued-fg)]",
      chipClass:
        "border-[var(--status-queued-border)] bg-[var(--status-queued-bg)] text-[var(--status-queued-fg)]",
    },
    downloading: {
      label: t(STATUS_LABEL_KEYS.downloading),
      icon: Play,
      textClass: "text-[var(--status-downloading-fg)]",
      chipClass:
        "border-[var(--status-downloading-border)] bg-[var(--status-downloading-bg)] text-[var(--status-downloading-fg)]",
    },
    paused: {
      label: t(STATUS_LABEL_KEYS.paused),
      icon: PauseCircle,
      textClass: "text-[var(--status-paused-fg)]",
      chipClass:
        "border-[var(--status-paused-border)] bg-[var(--status-paused-bg)] text-[var(--status-paused-fg)]",
    },
    completed: {
      label: t(STATUS_LABEL_KEYS.completed),
      icon: CheckCircle2,
      textClass: "text-[var(--status-completed-fg)]",
      chipClass:
        "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-fg)]",
    },
    failed: {
      label: t(STATUS_LABEL_KEYS.failed),
      icon: AlertTriangle,
      textClass: "text-[var(--status-failed-fg)]",
      chipClass:
        "border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] text-[var(--status-failed-fg)]",
    },
    skipped: {
      label: t(STATUS_LABEL_KEYS.skipped),
      icon: SkipForward,
      textClass: "text-[var(--status-skipped-fg)]",
      chipClass:
        "border-[var(--status-skipped-border)] bg-[var(--status-skipped-bg)] text-[var(--status-skipped-fg)]",
    },
  };
}

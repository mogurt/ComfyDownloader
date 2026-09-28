export function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "-";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "-";
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
  if (bytesPerSec < 1024 * 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  }
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function formatTransferred(
  downloaded: number | null | undefined,
  total: number | null | undefined
): string {
  if (!downloaded && !total) return "-";
  if (total && total > 0) {
    return `${formatSize(downloaded ?? 0)} / ${formatSize(total)}`;
  }
  return formatSize(downloaded ?? 0);
}

/** Parses a stored timestamp; SQLite's CURRENT_TIMESTAMP is UTC without a zone marker. */
export function parseTimestamp(value: string): Date {
  // "YYYY-MM-DD HH:MM:SS" would otherwise be parsed as local time.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return new Date(normalized);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = parseTimestamp(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

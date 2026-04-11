import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Search as SearchIcon,
  Download,
  Heart,
  ChevronDown,
  ChevronUp,
  Loader2,
  FileBox,
  User,
  Clock,
  HardDrive,
  PackageSearch,
  FolderOpen,
} from "lucide-react";
import { useSearchStore, type HfSortOption } from "@/stores/searchStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTaskStore } from "@/stores/taskStore";
import * as api from "@/lib/api";
import { extractPath } from "@/lib/api";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n, translate } from "@/lib/i18n";
import type { HfModelInfo, HfFileEntry } from "@/lib/types";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

const MODEL_EXTENSIONS = new Set([
  ".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".onnx", ".gguf",
]);

function isModelFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  for (const ext of MODEL_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

const FILTER_OPTIONS = [
  { value: "", labelKey: "search.filter.all" as const },
  { value: "diffusers", labelKey: "search.filter.diffusers" as const },
  { value: "safetensors", labelKey: "search.filter.safetensors" as const },
  { value: "lora", labelKey: "search.filter.lora" as const },
  { value: "text-to-image", labelKey: "search.filter.textToImage" as const },
];

const SORT_OPTIONS: { value: HfSortOption; labelKey: `search.sort.${string}` }[] = [
  { value: "downloads", labelKey: "search.sort.downloads" },
  { value: "likes", labelKey: "search.sort.likes" },
  { value: "lastModified", labelKey: "search.sort.lastModified" },
];

interface PendingDownload {
  file: HfFileEntry;
  modelId: string;
  suggestedType: string;
  matchedSubdir: string | null;
  subdirs: string[];
}

export default function Search() {
  const { t } = useI18n();
  const {
    query, setQuery,
    sort, setSort,
    filter, setFilter,
    results, hasMore, loading, loadingMore, error,
    expandedModelId, modelFiles, loadingFiles,
    search, loadMore, toggleModelFiles,
  } = useSearchStore();

  const [pendingDownload, setPendingDownload] = useState<PendingDownload | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim()) {
      debounceRef.current = setTimeout(() => {
        useSearchStore.getState().search();
      }, 500);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      search();
    }
  };

  const handleSortChange = (value: string) => {
    setSort(value as HfSortOption);
    if (query.trim()) {
      setTimeout(() => useSearchStore.getState().search(), 0);
    }
  };

  const handleFilterChange = (value: string) => {
    setFilter(value === "__all__" ? "" : value);
    if (query.trim()) {
      setTimeout(() => useSearchStore.getState().search(), 0);
    }
  };

  const hasResults = results.length > 0;
  const showEmpty = !loading && !hasResults && !error && !query.trim();
  const showNoResults = !loading && !hasResults && !error && query.trim();

  return (
    <div className="flex h-full flex-col">
      {/* Search bar + filters */}
      <div className="space-y-3 border-b p-4">
        <div className="flex items-center gap-2">
          <Input
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1"
          />
          <Select value={sort} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey as any)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filter || "__all__"}
            onValueChange={handleFilterChange}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((opt) => (
                <SelectItem
                  key={opt.value || "__all__"}
                  value={opt.value || "__all__"}
                >
                  {t(opt.labelKey as any)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={search} disabled={loading || !query.trim()}>
            {loading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <SearchIcon className="mr-1 h-4 w-4" />
            )}
            {t("search.button")}
          </Button>
        </div>
      </div>

      {/* Results area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading && !hasResults && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span>{t("search.loading")}</span>
          </div>
        )}

        {error && (
          <div className="px-4 py-8 text-center text-sm text-destructive">
            {t("search.error", { error })}
          </div>
        )}

        {showEmpty && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
            <PackageSearch className="h-12 w-12 opacity-40" />
            <p className="text-base font-medium">{t("search.emptyTitle")}</p>
            <p className="text-sm">{t("search.emptyHint")}</p>
          </div>
        )}

        {showNoResults && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
            <SearchIcon className="h-10 w-10 opacity-40" />
            <p className="text-base font-medium">{t("search.noResults")}</p>
            <p className="text-sm">{t("search.noResultsHint")}</p>
          </div>
        )}

        {hasResults && (
          <div className="divide-y">
            {results.map((model) => (
              <ModelCard
                key={model.model_id}
                model={model}
                expanded={expandedModelId === model.model_id}
                files={modelFiles[model.model_id]}
                loadingFiles={loadingFiles === model.model_id}
                onToggle={() => toggleModelFiles(model.model_id)}
                onRequestDownload={setPendingDownload}
              />
            ))}
          </div>
        )}

        {hasMore && !loading && (
          <div className="flex justify-center py-4">
            <Button
              variant="outline"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  {t("search.loadingMore")}
                </>
              ) : (
                t("search.loadMore")
              )}
            </Button>
          </div>
        )}
      </div>

      <DownloadConfirmDialog
        pending={pendingDownload}
        onClose={() => setPendingDownload(null)}
      />
    </div>
  );
}

function ModelCard({
  model,
  expanded,
  files,
  loadingFiles,
  onToggle,
  onRequestDownload,
}: {
  model: HfModelInfo;
  expanded: boolean;
  files?: HfFileEntry[];
  loadingFiles: boolean;
  onToggle: () => void;
  onRequestDownload: (p: PendingDownload) => void;
}) {
  const { t } = useI18n();

  const modelFiles = files?.filter((f) => isModelFile(f.filename));
  const otherFiles = files?.filter((f) => !isModelFile(f.filename));

  return (
    <div className="group">
      <button
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">
              {model.model_id}
            </span>
            {model.private && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                Private
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {model.author && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {model.author}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Download className="h-3 w-3" />
              {formatNumber(model.downloads)}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3" />
              {formatNumber(model.likes)}
            </span>
            {model.last_modified && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(model.last_modified)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {model.pipeline_tag && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {model.pipeline_tag}
              </Badge>
            )}
            {model.library_name && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {model.library_name}
              </Badge>
            )}
            {model.tags
              .filter(
                (tag) =>
                  tag !== model.pipeline_tag &&
                  tag !== model.library_name &&
                  tag !== model.author &&
                  !tag.startsWith("license:") &&
                  !tag.startsWith("arxiv:") &&
                  !tag.startsWith("region:")
              )
              .slice(0, 5)
              .map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 text-muted-foreground"
                >
                  {tag}
                </Badge>
              ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1 shrink-0">
          <span className="text-xs text-muted-foreground">
            {expanded ? t("search.hideFiles") : t("search.viewFiles")}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t bg-muted/30 px-4 py-3">
          {loadingFiles && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("search.loading")}
            </div>
          )}

          {!loadingFiles && files && (
            <div className="space-y-2">
              {files.length > 0 && (
                <p className="text-xs text-muted-foreground mb-2">
                  {t("search.fileCount", { count: files.length })}
                </p>
              )}

              {modelFiles && modelFiles.length > 0 && (
                <div className="space-y-1">
                  {modelFiles.map((file) => (
                    <FileRow
                      key={file.filename}
                      file={file}
                      modelId={model.model_id}
                      onRequestDownload={onRequestDownload}
                    />
                  ))}
                </div>
              )}

              {otherFiles && otherFiles.length > 0 && modelFiles && modelFiles.length > 0 && (
                <OtherFilesSection files={otherFiles} modelId={model.model_id} onRequestDownload={onRequestDownload} />
              )}

              {(!modelFiles || modelFiles.length === 0) && otherFiles && (
                <div className="space-y-1">
                  {otherFiles.map((file) => (
                    <FileRow
                      key={file.filename}
                      file={file}
                      modelId={model.model_id}
                      onRequestDownload={onRequestDownload}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OtherFilesSection({
  files,
  modelId,
  onRequestDownload,
}: {
  files: HfFileEntry[];
  modelId: string;
  onRequestDownload: (p: PendingDownload) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (files.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
      >
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        {files.length} other files
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {files.map((file) => (
            <FileRow key={file.filename} file={file} modelId={modelId} onRequestDownload={onRequestDownload} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  modelId,
  onRequestDownload,
}: {
  file: HfFileEntry;
  modelId: string;
  onRequestDownload: (p: PendingDownload) => void;
}) {
  const { t } = useI18n();
  const [preparing, setPreparing] = useState(false);

  const settings = useSettingsStore((s) => s.settings);
  const rules = useSettingsStore((s) => s.rules);
  const addLog = useTaskStore((s) => s.addLog);

  const baseDir =
    settings.model_base_dir ||
    (settings.comfyui_root ? `${settings.comfyui_root}\\models` : "");

  const handleClick = useCallback(async () => {
    if (!baseDir) {
      addLog("error", translate("search.noBaseDir"));
      return;
    }

    setPreparing(true);
    try {
      const rulesJson = JSON.stringify(rules);
      const suggestedType = await api.suggestType(
        file.filename,
        file.download_url,
        undefined,
        rulesJson
      );
      const subdirs = await api.listSubdirs(baseDir);
      const matched = api.matchSubdir(suggestedType, subdirs);

      onRequestDownload({
        file,
        modelId,
        suggestedType,
        matchedSubdir: matched,
        subdirs,
      });
    } catch (e) {
      addLog("error", translate("search.downloadFailed", { error: String(e) }));
    } finally {
      setPreparing(false);
    }
  }, [file, modelId, baseDir, rules, addLog, onRequestDownload]);

  const isModel = isModelFile(file.filename);

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background/60 transition-colors">
      <FileBox className={`h-3.5 w-3.5 shrink-0 ${isModel ? "text-primary" : "text-muted-foreground"}`} />
      <span className={`flex-1 truncate ${isModel ? "font-medium" : "text-muted-foreground"}`}>
        {file.filename}
      </span>
      {file.size != null && (
        <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
          <HardDrive className="h-3 w-3" />
          {formatBytes(file.size)}
        </span>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs shrink-0"
        disabled={preparing || !baseDir}
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
      >
        {preparing ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <Download className="mr-1 h-3 w-3" />
        )}
        {t("search.download")}
      </Button>
    </div>
  );
}

// ── Download Confirmation Dialog ──

function DownloadConfirmDialog({
  pending,
  onClose,
}: {
  pending: PendingDownload | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [selectedSubdir, setSelectedSubdir] = useState("");
  const [subSubdirs, setSubSubdirs] = useState<string[]>([]);
  const [selectedSubSubdir, setSelectedSubSubdir] = useState("");
  const [manualDir, setManualDir] = useState("");
  const [downloading, setDownloading] = useState(false);

  const settings = useSettingsStore((s) => s.settings);
  const addTask = useTaskStore((s) => s.addTask);
  const startDownload = useTaskStore((s) => s.startDownload);
  const addLog = useTaskStore((s) => s.addLog);

  const baseDir =
    settings.model_base_dir ||
    (settings.comfyui_root ? `${settings.comfyui_root}\\models` : "");

  useEffect(() => {
    if (!pending) return;
    const initial = pending.matchedSubdir || "";
    setSelectedSubdir(initial);
    setSelectedSubSubdir("");
    setManualDir("");
    setSubSubdirs([]);

    if (initial && baseDir) {
      api.listSubdirs(`${baseDir}\\${initial}`)
        .then(setSubSubdirs)
        .catch(() => setSubSubdirs([]));
    }
  }, [pending, baseDir]);

  useEffect(() => {
    if (!selectedSubdir || selectedSubdir === "__manual__" || !baseDir) {
      setSubSubdirs([]);
      setSelectedSubSubdir("");
      return;
    }
    api.listSubdirs(`${baseDir}\\${selectedSubdir}`)
      .then(setSubSubdirs)
      .catch(() => setSubSubdirs([]));
  }, [selectedSubdir, baseDir]);

  if (!pending) return null;

  const isManual = selectedSubdir === "__manual__";
  const resolvedDir = isManual
    ? manualDir
    : selectedSubSubdir
      ? `${baseDir}\\${selectedSubdir}\\${selectedSubSubdir}`
      : selectedSubdir
        ? `${baseDir}\\${selectedSubdir}`
        : "";

  const handlePickDir = async () => {
    try {
      const selected = await open({ directory: true, title: t("search.selectTargetDir") });
      const dirPath = extractPath(selected);
      if (dirPath) {
        setSelectedSubdir("__manual__");
        setManualDir(dirPath);
      }
    } catch { /* cancelled */ }
  };

  const handleConfirm = async () => {
    if (!resolvedDir || !pending) return;

    setDownloading(true);
    try {
      const exists = await api.checkFileExists(resolvedDir, pending.file.filename);
      if (exists && settings.duplicate_strategy === "skip") {
        addLog("warn", translate("taskInput.log.fileExistsSkipping", { filename: pending.file.filename }));
        setDownloading(false);
        onClose();
        return;
      }

      const taskId = await addTask({
        gid: "",
        url: pending.file.download_url,
        filename: pending.file.filename,
        source: "huggingface",
        model_type: isManual ? "custom" : selectedSubdir || pending.suggestedType,
        target_dir: resolvedDir,
        file_size: pending.file.size ?? null,
        status: "pending",
        progress: 0,
        speed: 0,
        hash: null,
        error_msg: null,
      });

      if (taskId != null) {
        const tasks = useTaskStore.getState().tasks;
        const task = tasks.find((t) => t.id === taskId);
        if (task) await startDownload(task);
      }

      addLog("info", translate("search.downloadStarted", {
        filename: pending.file.filename,
        model: pending.modelId,
      }));
      onClose();
    } catch (e) {
      addLog("error", translate("search.downloadFailed", { error: String(e) }));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog
      open={!!pending}
      onOpenChange={(open) => { if (!open) onClose(); }}
    >
      <DialogContent className="sm:max-w-md overflow-hidden">
        <DialogHeader className="min-w-0">
          <DialogTitle>{t("search.confirmTitle")}</DialogTitle>
          <DialogDescription className="truncate" title={pending.file.filename}>
            {pending.file.filename}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 min-w-0">
          {/* Model info */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <span className="font-medium shrink-0">{t("taskDetail.source")}:</span>
            <span className="truncate" title={pending.modelId}>{pending.modelId}</span>
          </div>

          {pending.file.size != null && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium shrink-0">{t("taskDetail.fileSize")}:</span>
              <span>{formatBytes(pending.file.size)}</span>
            </div>
          )}

          {/* Suggested type */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span className="font-medium shrink-0">{t("taskDetail.modelType")}:</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {pending.suggestedType}
            </Badge>
            {pending.matchedSubdir && (
              <>
                <span>→</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {pending.matchedSubdir}
                </Badge>
              </>
            )}
            {!pending.matchedSubdir && (
              <span className="text-destructive">{t("taskInput.noMatch")}</span>
            )}
          </div>

          {/* Subdirectory selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t("search.targetDir")}</label>
            <div className="flex items-center gap-2">
              {!isManual && (
                <Select
                  value={selectedSubdir || undefined}
                  onValueChange={(v) => {
                    if (v) {
                      setSelectedSubdir(v);
                      setSelectedSubSubdir("");
                      setManualDir("");
                    }
                  }}
                >
                  <SelectTrigger className="flex-1 h-8 text-xs min-w-0">
                    <SelectValue placeholder={t("taskInput.subdirectory")} />
                  </SelectTrigger>
                  <SelectContent>
                    {pending.subdirs.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {!isManual && subSubdirs.length > 0 && (
                <Select
                  value={selectedSubSubdir || "__root__"}
                  onValueChange={(v) => setSelectedSubSubdir(v === "__root__" ? "" : v)}
                >
                  <SelectTrigger className="w-[120px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__root__">{t("taskInput.root")}</SelectItem>
                    {subSubdirs.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {isManual && (
                <span className="flex-1 truncate text-xs text-muted-foreground bg-muted rounded px-2 py-1.5 min-w-0" title={manualDir}>
                  {manualDir}
                </span>
              )}

              <Button variant="outline" size="sm" className="h-8 px-2 shrink-0" onClick={handlePickDir}>
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Resolved path preview */}
          {resolvedDir && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
              <span className="font-medium shrink-0">{t("taskInput.target")}</span>
              <span className="truncate flex-1 min-w-0" title={resolvedDir}>{resolvedDir}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            size="sm"
            disabled={downloading || !resolvedDir}
            onClick={handleConfirm}
          >
            {downloading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            {t("search.confirmDownload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { useSearchStore, type SortOption, type SourceFilter } from "@/stores/searchStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTaskStore } from "@/stores/taskStore";
import * as api from "@/lib/api";
import { extractPath } from "@/lib/api";
import { open } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { useI18n, translate } from "@/lib/i18n";
import type { HfFileEntry, SearchResultItem } from "@/lib/types";

function getRepoUrl(item: SearchResultItem): string {
  if (item.source === "huggingface") {
    return `https://huggingface.co/${item.id}`;
  }
  return `https://civitai.com/models/${item.id}`;
}

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
  { value: "checkpoint", labelKey: "search.filter.checkpoint" as const },
  { value: "lora", labelKey: "search.filter.lora" as const },
  { value: "vae", labelKey: "search.filter.vae" as const },
  { value: "embedding", labelKey: "search.filter.embedding" as const },
  { value: "controlnet", labelKey: "search.filter.controlnet" as const },
  { value: "upscale_model", labelKey: "search.filter.upscaler" as const },
  { value: "diffusers", labelKey: "search.filter.diffusers" as const },
  { value: "safetensors", labelKey: "search.filter.safetensors" as const },
  { value: "text-to-image", labelKey: "search.filter.textToImage" as const },
];

const SORT_OPTIONS: { value: SortOption; labelKey: `search.sort.${string}` }[] = [
  { value: "downloads", labelKey: "search.sort.downloads" },
  { value: "likes", labelKey: "search.sort.likes" },
  { value: "lastModified", labelKey: "search.sort.lastModified" },
];

interface PendingDownload {
  file: HfFileEntry;
  modelId: string;
  modelSource: "huggingface" | "civitai";
  suggestedType: string;
  matchedSubdir: string | null;
  subdirs: string[];
}

const SOURCE_OPTIONS: { value: SourceFilter; labelKey: string }[] = [
  { value: "all", labelKey: "search.source.all" },
  { value: "huggingface", labelKey: "search.source.huggingface" },
  { value: "civitai", labelKey: "search.source.civitai" },
];

export default function Search({
  highlightFilename,
  onNavigateToSettings,
}: {
  highlightFilename?: string | null;
  onNavigateToSettings?: () => void;
}) {
  const { t } = useI18n();
  const {
    query, setQuery,
    sort, setSort,
    filter, setFilter,
    sourceFilter, setSourceFilter,
    results, loading, loadingMore, error,
    hfHasMore, civitaiHasMore,
    expandedModelId, modelFiles, loadingFiles,
    selectedVersions,
    search, loadMore, toggleModelFiles, selectVersion,
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

  const handleSortChange = (value: SortOption | null) => {
    if (!value) return;
    setSort(value as SortOption);
    if (query.trim()) {
      setTimeout(() => useSearchStore.getState().search(), 0);
    }
  };

  const handleFilterChange = (value: string | null) => {
    if (!value) return;
    setFilter(value === "__all__" ? "" : value);
    if (query.trim()) {
      setTimeout(() => useSearchStore.getState().search(), 0);
    }
  };

  const handleSourceChange = (value: SourceFilter) => {
    setSourceFilter(value);
    if (query.trim()) {
      setTimeout(() => useSearchStore.getState().search(), 0);
    }
  };

  const hasResults = results.length > 0;
  const hasMore = hfHasMore || civitaiHasMore;
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
              <span className="truncate">
                {t(SORT_OPTIONS.find((o) => o.value === sort)?.labelKey as any)}
              </span>
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
              <span className="truncate">
                {t(FILTER_OPTIONS.find((o) => (o.value || "__all__") === (filter || "__all__"))?.labelKey as any)}
              </span>
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

        {/* Source toggle */}
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 w-fit">
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                sourceFilter === opt.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => handleSourceChange(opt.value)}
            >
              {t(opt.labelKey as any)}
            </button>
          ))}
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
            {results.map((item) => (
              <ModelCard
                key={`${item.source}-${item.id}`}
                item={item}
                expanded={expandedModelId === item.id}
                files={modelFiles[item.id]}
                loadingFiles={loadingFiles === item.id}
                selectedVersionId={selectedVersions[item.id]}
                onToggle={() => toggleModelFiles(item.id)}
                onSelectVersion={(vId) => selectVersion(item.id, vId)}
                onRequestDownload={setPendingDownload}
                highlightFilename={highlightFilename}
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
        onNavigateToSettings={onNavigateToSettings}
      />
    </div>
  );
}

// ── Source Badge ──

function SourceBadge({ source }: { source: "huggingface" | "civitai" }) {
  const { t } = useI18n();
  const isHf = source === "huggingface";
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 font-medium ${
        isHf
          ? "border-blue-400/50 text-blue-600 dark:text-blue-400"
          : "border-green-400/50 text-green-600 dark:text-green-400"
      }`}
    >
      {isHf ? t("search.source.huggingface") : t("search.source.civitai")}
    </Badge>
  );
}

// ── Model Card ──

function ModelCard({
  item,
  expanded,
  files,
  loadingFiles,
  selectedVersionId,
  onToggle,
  onSelectVersion,
  onRequestDownload,
  highlightFilename,
}: {
  item: SearchResultItem;
  expanded: boolean;
  files?: HfFileEntry[];
  loadingFiles: boolean;
  selectedVersionId?: number;
  onToggle: () => void;
  onSelectVersion: (versionId: number) => void;
  onRequestDownload: (p: PendingDownload) => void;
  highlightFilename?: string | null;
}) {
  const { t } = useI18n();

  const modelFiles = files?.filter((f) => isModelFile(f.filename));
  const otherFiles = files?.filter((f) => !isModelFile(f.filename));

  const isCivitai = item.source === "civitai";
  const civitai = item.civitai;
  const hf = item.hf;

  const versions = civitai?.model_versions ?? [];
  const selectedVer = versions.find((v) => v.id === selectedVersionId) ?? versions[0];

  return (
    <div className="group">
      <button
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
        onClick={onToggle}
      >
        {/* Civitai thumbnail */}
        {isCivitai && item.thumbnail_url && (
          <img
            src={item.thumbnail_url}
            alt=""
            className="h-14 w-14 rounded-md object-cover shrink-0 bg-muted"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <SourceBadge source={item.source} />
            <span className="font-semibold text-sm truncate">
              {item.name}
            </span>
            {hf?.private && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                Private
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {item.author && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {item.author}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Download className="h-3 w-3" />
              {formatNumber(item.downloads)}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3" />
              {formatNumber(item.likes)}
            </span>
            {item.last_modified && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(item.last_modified)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {/* Civitai-specific badges */}
            {isCivitai && civitai && (
              <>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {civitai.model_type}
                </Badge>
                {selectedVer?.base_model && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {t("search.baseModel", { model: selectedVer.base_model })}
                  </Badge>
                )}
              </>
            )}

            {/* HF-specific badges */}
            {!isCivitai && hf && (
              <>
                {hf.pipeline_tag && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {hf.pipeline_tag}
                  </Badge>
                )}
                {hf.library_name && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {hf.library_name}
                  </Badge>
                )}
              </>
            )}

            {item.tags
              .filter(
                (tag) =>
                  tag !== hf?.pipeline_tag &&
                  tag !== hf?.library_name &&
                  tag !== item.author &&
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

        <div className="flex items-center gap-3 pt-1 shrink-0">
          <span
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            title={getRepoUrl(item)}
            onClick={(e) => {
              e.stopPropagation();
              shellOpen(getRepoUrl(item));
            }}
          >
            <ExternalLink className="h-3 w-3" />
            {t("search.openRepo")}
          </span>
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
              {/* Version info for Civitai models */}
              {isCivitai && versions.length === 1 && selectedVer && (
                <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                  <span className="font-medium">{t("search.version")}:</span>
                  <span>{selectedVer.name}</span>
                  {selectedVer.base_model && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {selectedVer.base_model}
                    </Badge>
                  )}
                </div>
              )}
              {isCivitai && versions.length > 1 && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("search.version")}:
                  </span>
                  <Select
                    value={String(selectedVersionId ?? versions[0]?.id ?? "")}
                    onValueChange={(v) => onSelectVersion(Number(v))}
                  >
                    <SelectTrigger className="h-7 w-auto max-w-[280px] text-xs">
                      <span className="truncate">
                        {selectedVer
                          ? `${selectedVer.name}${selectedVer.base_model ? ` (${selectedVer.base_model})` : ""}`
                          : t("search.selectVersion")}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {versions.map((ver) => (
                        <SelectItem key={ver.id} value={String(ver.id)}>
                          {ver.name}
                          {ver.base_model ? ` (${ver.base_model})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

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
                      modelId={item.id}
                      modelSource={item.source}
                      onRequestDownload={onRequestDownload}
                      highlightFilename={highlightFilename}
                    />
                  ))}
                </div>
              )}

              {otherFiles && otherFiles.length > 0 && modelFiles && modelFiles.length > 0 && (
                <OtherFilesSection
                  files={otherFiles}
                  modelId={item.id}
                  modelSource={item.source}
                  onRequestDownload={onRequestDownload}
                  highlightFilename={highlightFilename}
                />
              )}

              {(!modelFiles || modelFiles.length === 0) && otherFiles && (
                <div className="space-y-1">
                  {otherFiles.map((file) => (
                    <FileRow
                      key={file.filename}
                      file={file}
                      modelId={item.id}
                      modelSource={item.source}
                      onRequestDownload={onRequestDownload}
                      highlightFilename={highlightFilename}
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
  modelSource,
  onRequestDownload,
  highlightFilename,
}: {
  files: HfFileEntry[];
  modelId: string;
  modelSource: "huggingface" | "civitai";
  onRequestDownload: (p: PendingDownload) => void;
  highlightFilename?: string | null;
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
            <FileRow
              key={file.filename}
              file={file}
              modelId={modelId}
              modelSource={modelSource}
              onRequestDownload={onRequestDownload}
              highlightFilename={highlightFilename}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  modelId,
  modelSource,
  onRequestDownload,
  highlightFilename,
}: {
  file: HfFileEntry;
  modelId: string;
  modelSource: "huggingface" | "civitai";
  onRequestDownload: (p: PendingDownload) => void;
  highlightFilename?: string | null;
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
        modelSource,
        suggestedType,
        matchedSubdir: matched,
        subdirs,
      });
    } catch (e) {
      addLog("error", translate("search.downloadFailed", { error: String(e) }));
    } finally {
      setPreparing(false);
    }
  }, [file, modelId, modelSource, baseDir, rules, addLog, onRequestDownload]);

  const isModel = isModelFile(file.filename);
  const isHighlighted = !!(
    highlightFilename &&
    file.filename.toLowerCase() === highlightFilename.toLowerCase()
  );

  return (
    <div className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
      isHighlighted
        ? "bg-primary/10 ring-1 ring-primary/30"
        : "hover:bg-background/60"
    }`}>
      <FileBox className={`h-3.5 w-3.5 shrink-0 ${isHighlighted ? "text-primary" : isModel ? "text-primary" : "text-muted-foreground"}`} />
      <span className={`flex-1 truncate ${isModel ? "font-medium" : "text-muted-foreground"}`}>
        {file.filename}
      </span>
      {isHighlighted && (
        <Badge variant="default" className="h-4 px-1.5 text-[10px] shrink-0">
          {translate("workflow.match")}
        </Badge>
      )}
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
  onNavigateToSettings,
}: {
  pending: PendingDownload | null;
  onClose: () => void;
  onNavigateToSettings?: () => void;
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

  const isCivitaiSource = pending.modelSource === "civitai";
  const civitaiTokenMissing = isCivitaiSource && !settings.civitai_api_token.trim();
  const isHfSource = pending.modelSource === "huggingface";
  const hfTokenMissing = isHfSource && !settings.huggingface_token.trim();

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
        source: pending.modelSource,
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
            <SourceBadge source={pending.modelSource} />
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

          {/* Token warning */}
          {civitaiTokenMissing && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  {t("search.civitaiTokenRequired")}
                </p>
                <p className="text-[11px] text-amber-600/80 dark:text-amber-400/70 mt-0.5">
                  {t("search.civitaiTokenRequiredHint")}
                </p>
                {onNavigateToSettings && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 h-6 text-[11px] px-2"
                    onClick={() => { onClose(); onNavigateToSettings(); }}
                  >
                    {t("search.goToSettings")}
                  </Button>
                )}
              </div>
            </div>
          )}

          {hfTokenMissing && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
                  {t("search.hfTokenOptional")}
                </p>
                <p className="text-[11px] text-blue-600/80 dark:text-blue-400/70 mt-0.5">
                  {t("search.hfTokenOptionalHint")}
                </p>
              </div>
            </div>
          )}

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
                  onValueChange={(v) => setSelectedSubSubdir(v == null || v === "__root__" ? "" : v)}
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
            disabled={downloading || !resolvedDir || civitaiTokenMissing}
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

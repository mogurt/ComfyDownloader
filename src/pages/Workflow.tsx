import { useState, useCallback, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import * as api from "@/lib/api";
import { cleanFilenameForSearch, getModelBaseDir } from "@/lib/utils";
import type {
  WorkflowModelRef,
  ModelLocalStatus,
  WorkflowFileInfo,
  WorkflowAnalysis,
} from "@/lib/types";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  FileUp,
  ClipboardPaste,
  CheckCircle2,
  XCircle,
  Search,
  Loader2,
  FileJson,
  ChevronDown,
  ChevronUp,
  Package,
  AlertTriangle,
  RefreshCw,
  Settings,
} from "lucide-react";

interface WorkflowPageProps {
  onNavigateToSearch: (query: string, filename: string) => void;
  onNavigateToSettings: () => void;
}

export default function Workflow({
  onNavigateToSearch,
  onNavigateToSettings,
}: WorkflowPageProps) {
  const { t } = useI18n();
  const comfyuiRoot = useSettingsStore((s) => s.settings.comfyui_root);
  const modelBaseDir = useSettingsStore((s) => getModelBaseDir(s.settings));

  const [analysis, setAnalysis] = useState<WorkflowAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const [scanFiles, setScanFiles] = useState<WorkflowFileInfo[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  // Pre-parsed status per workflow file: { total model refs, missing count }
  const [fileStatusMap, setFileStatusMap] = useState<
    Record<string, { total: number; missing: number }>
  >({});

  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (comfyuiRoot) {
      scanWorkflows();
    }
  }, [comfyuiRoot]); // eslint-disable-line react-hooks/exhaustive-deps

  const preParseWorkflows = async (files: WorkflowFileInfo[]) => {
    const baseDir = modelBaseDir;
    for (const f of files) {
      try {
        const result = await api.parseWorkflowFile(f.path);
        if (result.models.length === 0) {
          setFileStatusMap((prev) => ({ ...prev, [f.path]: { total: 0, missing: 0 } }));
          continue;
        }
        if (baseDir) {
          const localStatus = await api.checkModelsLocal(
            baseDir,
            result.models.map((m) => m.filename)
          );
          const missing = localStatus.filter((s) => !s.found).length;
          setFileStatusMap((prev) => ({
            ...prev,
            [f.path]: { total: result.models.length, missing },
          }));
        } else {
          setFileStatusMap((prev) => ({
            ...prev,
            [f.path]: { total: result.models.length, missing: result.models.length },
          }));
        }
      } catch {
        // Skip files that fail to parse (not valid workflow JSON)
      }
    }
  };

  const scanWorkflows = async () => {
    if (!comfyuiRoot) return;
    setScanLoading(true);
    setScanError(null);
    setFileStatusMap({});
    try {
      const files = await api.scanWorkflowDir(comfyuiRoot);
      setScanFiles(files);
      if (files.length === 0) {
        setScanError(t("workflow.noWorkflows"));
      } else {
        preParseWorkflows(files);
      }
    } catch (e) {
      setScanError(String(e));
    } finally {
      setScanLoading(false);
    }
  };

  const processParseResult = useCallback(
    async (result: import("@/lib/types").ParseWorkflowResult, sourceName: string) => {
      if (result.models.length === 0) {
        setAnalysis({
          source_name: sourceName,
          node_count: result.node_count,
          format: result.format,
          models: [],
          local_status: [],
        });
        return;
      }

      let localStatus: ModelLocalStatus[] = [];
      if (modelBaseDir) {
        localStatus = await api.checkModelsLocal(
          modelBaseDir,
          result.models.map((m) => m.filename)
        );
      } else {
        localStatus = result.models.map((m) => ({
          filename: m.filename,
          found: false,
          found_path: null,
        }));
      }

      setAnalysis({
        source_name: sourceName,
        node_count: result.node_count,
        format: result.format,
        models: result.models,
        local_status: localStatus,
      });
    },
    [modelBaseDir]
  );

  const analyzeWorkflowJson = useCallback(
    async (jsonStr: string, sourceName: string) => {
      setLoading(true);
      setError(null);
      setAnalysis(null);
      try {
        const result = await api.parseWorkflowJson(jsonStr);
        await processParseResult(result, sourceName);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [processParseResult]
  );

  const analyzeWorkflowFile = useCallback(
    async (filePath: string, sourceName: string) => {
      setLoading(true);
      setError(null);
      setAnalysis(null);
      setSelectedFilePath(filePath);
      try {
        const result = await api.parseWorkflowFile(filePath);
        await processParseResult(result, sourceName);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [processParseResult]
  );

  // Tauri intercepts OS file drops (HTML5 `drop` never fires), so listen to the
  // webview's drag-drop events, which also give us the real file path.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const isOverDropZone = (position: { x: number; y: number }) => {
      const el = dropRef.current;
      // offsetParent is null while this page is hidden behind another tab.
      if (!el || el.offsetParent === null) return false;
      const rect = el.getBoundingClientRect();
      const x = position.x / window.devicePixelRatio;
      const y = position.y / window.devicePixelRatio;
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragOver(isOverDropZone(payload.position));
        } else if (payload.type === "leave") {
          setDragOver(false);
        } else if (payload.type === "drop") {
          setDragOver(false);
          if (!isOverDropZone(payload.position)) return;
          const path = payload.paths[0];
          if (!path) return;
          if (!path.toLowerCase().endsWith(".json")) {
            setError(t("workflow.onlyJson"));
            return;
          }
          analyzeWorkflowFile(path, path.split(/[\\/]/).pop() || "workflow.json");
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [analyzeWorkflowFile, t]);

  const handleSelectFile = async () => {
    try {
      const file = await open({
        title: t("workflow.selectFile"),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const filePath = api.extractPath(file);
      if (!filePath) return;
      const filename = filePath.split(/[\\/]/).pop() || "workflow.json";
      analyzeWorkflowFile(filePath, filename);
    } catch {
      // user cancelled
    }
  };

  const handlePasteSubmit = () => {
    if (!pasteText.trim()) return;
    setSelectedFilePath(null);
    analyzeWorkflowJson(pasteText.trim(), "Pasted JSON");
    setShowPaste(false);
    setPasteText("");
  };

  const handleSearchModel = (filename: string) => {
    const query = cleanFilenameForSearch(filename);
    onNavigateToSearch(query, filename);
  };

  const getFormatLabel = (format: string) => {
    if (format.includes("api")) return t("workflow.formatApi");
    if (format.includes("litegraph")) return t("workflow.formatLitegraph");
    return t("workflow.formatUnknown");
  };

  const getLocalStatus = (filename: string): ModelLocalStatus | undefined => {
    return analysis?.local_status.find((s) => s.filename === filename);
  };

  const missingCount =
    analysis?.local_status.filter((s) => !s.found).length ?? 0;

  // ── Not configured state ──
  if (!comfyuiRoot) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Settings className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="text-base font-medium">{t("workflow.configRequired")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("workflow.configRequiredHint")}
            </p>
          </div>
          <Button onClick={onNavigateToSettings}>
            <Settings className="mr-1.5 h-4 w-4" />
            {t("workflow.goToSettings")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Main layout ──
  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel: Workflow file list */}
      <div className="flex w-60 flex-shrink-0 flex-col border-r bg-muted/30">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("workflow.workflowList")}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={scanWorkflows}
            disabled={scanLoading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scanLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {scanLoading && scanFiles.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{t("workflow.scanning")}</span>
            </div>
          )}
          {scanError && scanFiles.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              {scanError}
            </div>
          )}
          {scanFiles.map((f) => {
            const status = fileStatusMap[f.path];
            return (
              <button
                key={f.path}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent ${
                  selectedFilePath === f.path ? "bg-accent font-medium" : ""
                }`}
                onClick={() => analyzeWorkflowFile(f.path, f.filename)}
              >
                <FileJson className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{f.filename}</span>
                {status && status.missing > 0 && (
                  <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px] flex-shrink-0">
                    {status.missing}
                  </Badge>
                )}
                {status && status.total > 0 && status.missing === 0 && (
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right panel: Main content */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl p-4 space-y-4">
            {/* Input Area */}
            <div
              ref={dropRef}
              className={`relative rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/40"
              }`}
            >
              <FileJson className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <p className="mt-2 text-sm font-medium text-foreground">
                {t("workflow.dropzone")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("workflow.dropzoneHint")}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={handleSelectFile}>
                  <FileUp className="mr-1.5 h-4 w-4" />
                  {t("workflow.selectFile")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPaste(!showPaste)}
                >
                  <ClipboardPaste className="mr-1.5 h-4 w-4" />
                  {t("workflow.pasteJson")}
                  {showPaste ? (
                    <ChevronUp className="ml-1 h-3 w-3" />
                  ) : (
                    <ChevronDown className="ml-1 h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>

            {showPaste && (
              <div className="space-y-2">
                <Textarea
                  className="min-h-[120px] font-mono text-xs"
                  placeholder={t("workflow.pasteJsonPlaceholder")}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={handlePasteSubmit} disabled={!pasteText.trim()}>
                    {t("workflow.pasteJsonSubmit")}
                  </Button>
                </div>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>{t("workflow.parsing")}</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {analysis && !loading && (
              <>
                <div className="rounded-lg border bg-card p-4">
                  <h3 className="text-sm font-semibold mb-3">
                    {t("workflow.summary")}
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <FileJson className="h-4 w-4" />
                      <span className="truncate max-w-[200px]" title={analysis.source_name}>
                        {analysis.source_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{t("workflow.format")}:</span>
                      <Badge variant="outline" className="text-xs">
                        {getFormatLabel(analysis.format)}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("workflow.nodeCount")}:</span>{" "}
                      <span className="font-medium">{analysis.node_count}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("workflow.modelCount")}:</span>{" "}
                      <span className="font-medium">{analysis.models.length}</span>
                    </div>
                    {missingCount > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {t("workflow.missingCount")}: {missingCount}
                      </Badge>
                    )}
                    {missingCount === 0 && analysis.models.length > 0 && (
                      <Badge
                        variant="outline"
                        className="border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400 text-xs"
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        {t("workflow.allModelsFound")}
                      </Badge>
                    )}
                  </div>
                </div>

                {analysis.models.length > 0 && (
                  <div className="rounded-lg border bg-card">
                    <div className="flex items-center justify-between border-b px-4 py-2.5">
                      <h3 className="text-sm font-semibold flex items-center gap-1.5">
                        <Package className="h-4 w-4" />
                        {t("workflow.modelCount")} ({analysis.models.length})
                      </h3>
                    </div>
                    <div className="divide-y">
                      {analysis.models.map((model) => (
                        <ModelRow
                          key={model.filename}
                          model={model}
                          status={getLocalStatus(model.filename)}
                          t={t}
                          onSearch={handleSearchModel}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {analysis.models.length === 0 && (
                  <div className="flex flex-col items-center py-8 text-muted-foreground">
                    <Package className="h-8 w-8 mb-2 opacity-50" />
                    <p className="text-sm">{t("workflow.noModelDeps")}</p>
                  </div>
                )}
              </>
            )}

            {!analysis && !loading && !error && (
              <div className="flex flex-col items-center py-12 text-muted-foreground">
                <FileJson className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-base font-medium text-foreground/70">
                  {t("workflow.emptyTitle")}
                </p>
                <p className="mt-1 max-w-md text-center text-sm">
                  {t("workflow.emptyHint")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  model,
  status,
  t,
  onSearch,
}: {
  model: WorkflowModelRef;
  status?: ModelLocalStatus;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onSearch: (filename: string) => void;
}) {
  const found = status?.found ?? false;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <div className="flex-shrink-0">
        {found ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate" title={model.filename}>
            {model.filename}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          {model.model_type_hint && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {model.model_type_hint}
            </Badge>
          )}
          {model.node_type && (
            <span className="text-xs text-muted-foreground">
              {t("workflow.nodeType")}: {model.node_type}
            </span>
          )}
          {found && status?.found_path && (
            <span
              className="text-xs text-muted-foreground truncate max-w-[300px]"
              title={status.found_path}
            >
              {t("workflow.localPath", { path: status.found_path })}
            </span>
          )}
        </div>
      </div>
      <div className="flex-shrink-0">
        {found ? (
          <Badge
            variant="outline"
            className="border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400 text-xs"
          >
            {t("workflow.found")}
          </Badge>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onSearch(model.filename)}
          >
            <Search className="mr-1 h-3 w-3" />
            {t("workflow.search")}
          </Button>
        )}
      </div>
    </div>
  );
}

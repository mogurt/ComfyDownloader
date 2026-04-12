import { useState, useCallback, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import * as api from "@/lib/api";
import type {
  WorkflowModelRef,
  ModelLocalStatus,
  WorkflowFileInfo,
  WorkflowAnalysis,
} from "@/lib/types";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  FileUp,
  FolderSearch,
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
} from "lucide-react";

interface WorkflowPageProps {
  onNavigateToSearch?: (query: string) => void;
}

export default function Workflow({ onNavigateToSearch }: WorkflowPageProps) {
  const { t } = useI18n();
  const settings = useSettingsStore((s) => s.settings);

  const [analysis, setAnalysis] = useState<WorkflowAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [scanFiles, setScanFiles] = useState<WorkflowFileInfo[] | null>(null);
  const [showScanList, setShowScanList] = useState(false);

  const dropRef = useRef<HTMLDivElement>(null);

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
      const baseDir = settings.model_base_dir;
      if (baseDir) {
        localStatus = await api.checkModelsLocal(
          baseDir,
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
    [settings.model_base_dir]
  );

  const analyzeWorkflowJson = useCallback(
    async (jsonStr: string, sourceName: string) => {
      setLoading(true);
      setError(null);
      setAnalysis(null);
      setScanFiles(null);
      setShowScanList(false);
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
      setScanFiles(null);
      setShowScanList(false);
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

  const handleFileDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      if (!file.name.endsWith(".json")) {
        setError("Only .json files are supported");
        return;
      }

      const text = await file.text();
      analyzeWorkflowJson(text, file.name);
    },
    [analyzeWorkflowJson]
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    el.addEventListener("drop", handleFileDrop);
    el.addEventListener("dragover", handleDragOver);
    el.addEventListener("dragleave", handleDragLeave);
    return () => {
      el.removeEventListener("drop", handleFileDrop);
      el.removeEventListener("dragover", handleDragOver);
      el.removeEventListener("dragleave", handleDragLeave);
    };
  }, [handleFileDrop, handleDragOver, handleDragLeave]);

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

  const handleScanDir = async () => {
    const root = settings.comfyui_root;
    if (!root) {
      setError("ComfyUI root directory not configured. Please set it in Settings.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const files = await api.scanWorkflowDir(root);
      if (files.length === 0) {
        setError(t("workflow.noWorkflows"));
        setLoading(false);
        return;
      }
      setScanFiles(files);
      setShowScanList(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectScannedFile = (file: WorkflowFileInfo) => {
    setShowScanList(false);
    analyzeWorkflowFile(file.path, file.filename);
  };

  const handlePasteSubmit = () => {
    if (!pasteText.trim()) return;
    analyzeWorkflowJson(pasteText.trim(), "Pasted JSON");
    setShowPaste(false);
    setPasteText("");
  };

  const cleanFilenameForSearch = (filename: string): string => {
    let name = filename.replace(/\.[^.]+$/, "");
    name = name.replace(/[_\-]/g, " ");
    name = name.replace(/_v\d+(\.\d+)?$/i, "");
    name = name.replace(/\s+/g, " ").trim();
    return name;
  };

  const handleSearchModel = (filename: string) => {
    const query = cleanFilenameForSearch(filename);
    if (onNavigateToSearch) {
      onNavigateToSearch(query);
    }
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
  const foundCount =
    analysis?.local_status.filter((s) => s.found).length ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 space-y-4">
          {/* Input Area */}
          <div
            ref={dropRef}
            className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/40"
            }`}
          >
            <FileJson className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-3 text-base font-medium text-foreground">
              {t("workflow.dropzone")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("workflow.dropzoneHint")}
            </p>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={handleSelectFile}>
                <FileUp className="mr-1.5 h-4 w-4" />
                {t("workflow.selectFile")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleScanDir}>
                <FolderSearch className="mr-1.5 h-4 w-4" />
                {t("workflow.scanDir")}
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

          {/* Paste area */}
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

          {/* Scan results list */}
          {showScanList && scanFiles && (
            <div className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">
                  {t("workflow.scanResult", { count: scanFiles.length })}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowScanList(false)}
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {scanFiles.map((f) => (
                  <button
                    key={f.path}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent transition-colors"
                    onClick={() => handleSelectScannedFile(f)}
                  >
                    <FileJson className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{f.filename}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {(f.size / 1024).toFixed(1)} KB
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>{t("workflow.parsing")}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Analysis results */}
          {analysis && !loading && (
            <>
              {/* Summary */}
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

              {/* Model dependency list */}
              {analysis.models.length > 0 && (
                <div className="rounded-lg border bg-card">
                  <div className="flex items-center justify-between border-b px-4 py-2.5">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5">
                      <Package className="h-4 w-4" />
                      {t("workflow.modelCount")} ({analysis.models.length})
                    </h3>
                    {/* Placeholder for future "Download All Missing" */}
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

              {/* Empty state - no models found */}
              {analysis.models.length === 0 && (
                <div className="flex flex-col items-center py-8 text-muted-foreground">
                  <Package className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">No model dependencies found in this workflow.</p>
                </div>
              )}
            </>
          )}

          {/* Empty state - no analysis yet */}
          {!analysis && !loading && !error && !showScanList && (
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
  t: (key: string, params?: Record<string, string | number>) => string;
  onSearch: (filename: string) => void;
}) {
  const found = status?.found ?? false;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
      {/* Status icon */}
      <div className="flex-shrink-0">
        {found ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
      </div>

      {/* Filename + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="font-medium truncate"
            title={model.filename}
          >
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

      {/* Action */}
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

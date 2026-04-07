import { useState, useEffect, useCallback, useRef } from "react";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Download, Loader2, FolderOpen } from "lucide-react";
import { useTaskStore } from "@/stores/taskStore";
import { useSettingsStore } from "@/stores/settingsStore";
import * as api from "@/lib/api";
import { extractPath } from "@/lib/api";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n, translate } from "@/lib/i18n";

function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/.+/i.test(text.trim());
}

export default function TaskInput() {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [parsing, setParsing] = useState(false);
  const [recommendation, setRecommendation] = useState("");
  const [parsedUrl, setParsedUrl] = useState("");

  const [subdirs, setSubdirs] = useState<string[]>([]);
  const [selectedSubdir, setSelectedSubdir] = useState<string>("");
  const [subSubdirs, setSubSubdirs] = useState<string[]>([]);
  const [selectedSubSubdir, setSelectedSubSubdir] = useState<string>("");

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { addTask, startDownload, addLog, aria2Ready } = useTaskStore();
  const { settings, rules, updateSetting } = useSettingsStore();

  const baseDir =
    settings.model_base_dir ||
    (settings.comfyui_root ? `${settings.comfyui_root}\\models` : "");

  const loadSubdirs = useCallback(async () => {
    if (!baseDir) {
      setSubdirs([]);
      return;
    }
    try {
      const dirs = await api.listSubdirs(baseDir);
      setSubdirs(dirs);
    } catch {
      setSubdirs([]);
    }
  }, [baseDir]);

  useEffect(() => {
    loadSubdirs();
  }, [loadSubdirs]);

  useEffect(() => {
    if (!selectedSubdir || selectedSubdir === "__manual__" || !baseDir) {
      setSubSubdirs([]);
      setSelectedSubSubdir("");
      return;
    }
    const fullPath = `${baseDir}\\${selectedSubdir}`;
    api.listSubdirs(fullPath).then(setSubSubdirs).catch(() => setSubSubdirs([]));
  }, [baseDir, selectedSubdir]);

  const targetDir = baseDir
    ? selectedSubSubdir
      ? `${baseDir}\\${selectedSubdir}\\${selectedSubSubdir}`
      : selectedSubdir && selectedSubdir !== "__manual__"
        ? `${baseDir}\\${selectedSubdir}`
        : ""
    : "";

  const doParse = useCallback(async (inputUrl: string) => {
    const trimmed = inputUrl.trim();
    if (!trimmed || !looksLikeUrl(trimmed) || trimmed === parsedUrl) return;
    setParsing(true);
    setRecommendation("");
    try {
      const result = await api.parseDownloadUrl(
        trimmed,
        settings.proxy || undefined,
        settings.civitai_api_token || undefined
      );
      setFilename(result.filename);
      setParsedUrl(trimmed);

      const rulesJson = JSON.stringify(rules);
      const suggestedType = await api.suggestType(
        result.filename,
        trimmed,
        result.suggested_type || undefined,
        rulesJson
      );

      const matched = api.matchSubdir(suggestedType, subdirs);
      if (matched) {
        setSelectedSubdir(matched);
        setSelectedSubSubdir("");
      }

      const displayDir = matched || t("taskInput.noMatch");
      setRecommendation(`${result.source} -> ${suggestedType} -> ${displayDir}`);
      addLog("info", translate("taskInput.log.parsed", {
        filename: result.filename,
        source: result.source,
      }));
    } catch (e) {
      addLog("error", translate("taskInput.log.parseFailed", { error: String(e) }));
      setRecommendation(`${t("common.error")}: ${String(e)}`);
    } finally {
      setParsing(false);
    }
  }, [parsedUrl, settings.proxy, settings.civitai_api_token, subdirs, rules, addLog, t]);

  const handleUrlChange = (value: string) => {
    setUrl(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (looksLikeUrl(value)) {
      debounceRef.current = setTimeout(() => doParse(value), 600);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (looksLikeUrl(pasted)) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setTimeout(() => doParse(pasted), 50);
    }
  };

  const handleSubdirChange = (value: string | null) => {
    if (!value) return;
    setSelectedSubdir(value);
    setSelectedSubSubdir("");
  };

  const handleSubSubdirChange = (value: string | null) => {
    if (value === "__root__") {
      setSelectedSubSubdir("");
    } else if (value) {
      setSelectedSubSubdir(value);
    }
  };

  const handlePickDir = async () => {
    try {
      const selected = await open({ directory: true, title: t("taskInput.dialog.selectTargetDir") });
      const dirPath = extractPath(selected);
      if (dirPath) {
        addLog("info", translate("taskInput.log.manualDirSelected", { path: dirPath }));
        if (!settings.model_base_dir && !settings.comfyui_root) {
          await updateSetting("model_base_dir", dirPath);
        }
        setSelectedSubdir("__manual__");
        setSelectedSubSubdir(dirPath);
      }
    } catch (e) {
      addLog("error", translate("taskInput.log.openDirPickerFailed", { error: String(e) }));
    }
  };

  const isManual = selectedSubdir === "__manual__";
  const resolvedTargetDir = isManual ? selectedSubSubdir : targetDir;

  const handleDownload = async () => {
    if (!url.trim() || !filename.trim() || !resolvedTargetDir.trim()) {
      addLog("error", translate("taskInput.log.fillRequired"));
      return;
    }

    const exists = await api.checkFileExists(resolvedTargetDir, filename);
    if (exists && settings.duplicate_strategy === "skip") {
      addLog("warn", translate("taskInput.log.fileExistsSkipping", { filename }));
      await addTask({
        gid: "",
        url: url.trim(),
        filename,
        source: recommendation.split(" -> ")[0] || "unknown",
        model_type: isManual ? "custom" : selectedSubdir,
        target_dir: resolvedTargetDir,
        file_size: null,
        status: "skipped",
        progress: 0,
        speed: 0,
        hash: null,
        error_msg: t("taskInput.error.fileExists"),
      });
      resetForm();
      return;
    }

    const taskId = await addTask({
      gid: "",
      url: url.trim(),
      filename,
      source: recommendation.split(" -> ")[0] || "unknown",
      model_type: isManual ? "custom" : selectedSubdir,
      target_dir: resolvedTargetDir,
      file_size: null,
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

    resetForm();
  };

  const resetForm = () => {
    setUrl("");
    setFilename("");
    setSelectedSubdir("");
    setSelectedSubSubdir("");
    setRecommendation("");
    setParsedUrl("");
  };

  const showDropdowns = !!baseDir && !isManual;

  return (
    <div className="space-y-3 border-b p-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder={t("taskInput.urlPlaceholder")}
          value={url}
          onChange={(e) => handleUrlChange(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === "Enter") doParse(url);
          }}
          className="flex-1"
        />

        {!baseDir && !isManual && (
          <span className="text-xs text-destructive whitespace-nowrap">
            {t("taskInput.baseDirMissing")}
          </span>
        )}

        {showDropdowns && (
          <>
            <Select
              key={`subdir-${selectedSubdir}`}
              value={selectedSubdir || undefined}
              onValueChange={handleSubdirChange}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t("taskInput.subdirectory")} />
              </SelectTrigger>
              <SelectContent>
                {subdirs.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {subSubdirs.length > 0 && (
              <Select
                key={`subsub-${selectedSubSubdir}`}
                value={selectedSubSubdir || "__root__"}
                onValueChange={handleSubSubdirChange}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">{t("taskInput.root")}</SelectItem>
                  {subSubdirs.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        )}

        <Button
          variant="outline"
          size="icon"
          onClick={handlePickDir}
          title={t("taskInput.chooseTargetDir")}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>

        <Button
          onClick={handleDownload}
          disabled={!aria2Ready || !url.trim() || parsing || !resolvedTargetDir}
          title={aria2Ready ? t("taskInput.startDownload") : t("taskInput.waitingAria2")}
        >
          {parsing ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1 h-4 w-4" />
          )}
          {t("taskInput.download")}
        </Button>
      </div>

      {recommendation && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium">{t("taskInput.recommended")}</span>
          <span>{recommendation}</span>
        </div>
      )}
      <TooltipProvider>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Tooltip>
            <TooltipTrigger render={<div />}>
              <Badge
                variant={baseDir ? "outline" : "destructive"}
                className="max-w-full gap-1.5 px-2 py-1 text-xs"
              >
                <FolderOpen className="h-3 w-3 shrink-0" />
                <span className="shrink-0 font-medium">{t("taskInput.baseDir")}</span>
                <span className="max-w-[380px] truncate">
                  {baseDir || t("taskInput.baseDirMissing")}
                </span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {baseDir || t("taskInput.baseDirMissing")}
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
      {resolvedTargetDir && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium">{t("taskInput.target")}</span>
          <span className="truncate">{resolvedTargetDir}</span>
        </div>
      )}
    </div>
  );
}

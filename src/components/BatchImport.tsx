import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTaskStore } from "@/stores/taskStore";
import { useSettingsStore } from "@/stores/settingsStore";
import * as api from "@/lib/api";
import { extractPath } from "@/lib/api";
import { FileUp, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n, translate } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface BatchImportRow {
  url: string;
  relativeSubdir: string | null;
}

function parseBatchImportLine(line: string): BatchImportRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let url = trimmed;
  let relativeSubdir: string | null = null;

  const tabIndex = trimmed.indexOf("\t");
  const pipeIndex = trimmed.indexOf("|");
  const separatorIndex = tabIndex >= 0
    ? tabIndex
    : pipeIndex >= 0
      ? pipeIndex
      : -1;

  if (separatorIndex >= 0) {
    url = trimmed.slice(0, separatorIndex).trim();
    relativeSubdir = trimmed.slice(separatorIndex + 1).trim() || null;
  }

  if (!(url.startsWith("http://") || url.startsWith("https://"))) {
    return null;
  }

  return { url, relativeSubdir };
}

function getDisplayModelType(resultType: string | null, matchedSubdir: string | null, relativeSubdir: string | null) {
  if (relativeSubdir) {
    return relativeSubdir.split(/[\\/]/).find(Boolean) || "custom";
  }
  return matchedSubdir || resultType || "custom";
}

export default function BatchImport({ open: isOpen, onClose }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [subdirs, setSubdirs] = useState<string[]>([]);

  const { addTask, startDownload, addLog } = useTaskStore();
  const { settings } = useSettingsStore();

  const baseDir =
    settings.model_base_dir ||
    (settings.comfyui_root ? `${settings.comfyui_root}\\models` : "");

  useEffect(() => {
    if (baseDir) {
      api.listSubdirs(baseDir).then(setSubdirs).catch(() => setSubdirs([]));
    }
  }, [baseDir]);

  const handleImportFile = async () => {
    try {
      const file = await open({
        title: t("batchImport.dialogTitle"),
        filters: [{ name: t("batchImport.textFiles"), extensions: ["txt", "csv"] }],
      });
      const filePath = extractPath(file);
      if (filePath) {
        const contents = await (await fetch(`file://${filePath}`)).text();
        setText((prev) => (prev ? prev + "\n" + contents : contents));
      }
    } catch {
      addLog("error", translate("batchImport.log.readFileFailed"));
    }
  };

  const handleImport = async () => {
    const rows = text
      .split("\n")
      .map(parseBatchImportLine)
      .filter((row): row is BatchImportRow => row !== null);

    if (rows.length === 0) {
      addLog("warn", translate("batchImport.log.noValidUrls"));
      return;
    }

    if (!baseDir) {
      addLog("error", translate("batchImport.log.baseDirMissing"));
      return;
    }

    setImporting(true);
    addLog("info", translate("batchImport.log.importing", { count: rows.length }));

    for (const row of rows) {
      const { url, relativeSubdir } = row;
      try {
        const result = await api.parseDownloadUrl(
          url,
          settings.proxy || undefined,
          settings.civitai_api_token || undefined,
          settings.huggingface_token || undefined
        );

        let matchedSubdir: string | null = null;
        let targetDir = "";

        if (relativeSubdir) {
          try {
            targetDir = await api.resolveRelativeSubdir(baseDir, relativeSubdir);
          } catch (e) {
            addLog("warn", translate("batchImport.log.invalidRelativeSubdir", {
              url,
              subdir: relativeSubdir,
              error: String(e),
            }));
            continue;
          }
        } else {
          matchedSubdir = api.matchSubdir(result.suggested_type, subdirs);
          targetDir = matchedSubdir ? `${baseDir}\\${matchedSubdir}` : "";
        }

        if (!targetDir) {
          addLog("warn", translate("batchImport.log.noMatchingSubdir", {
            filename: result.filename,
            type: result.suggested_type ?? "unknown",
          }));
          continue;
        }

        const taskId = await addTask({
          gid: "",
          url,
          filename: result.filename,
          source: result.source,
          model_type: getDisplayModelType(result.suggested_type, matchedSubdir, relativeSubdir),
          target_dir: targetDir,
          file_size: result.file_size,
          status: "pending",
          progress: 0,
          speed: 0,
          hash: result.hash,
          error_msg: null,
        });

        const tasks = useTaskStore.getState().tasks;
        const task = tasks.find((t) => t.id === taskId);
        if (task) {
          await startDownload(task);
        }
      } catch (e) {
        addLog("error", translate("batchImport.log.importFailed", {
          url,
          error: String(e),
        }));
      }
    }

    setImporting(false);
    setText("");
    onClose();
    addLog("info", translate("batchImport.log.complete"));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("batchImport.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!baseDir && (
            <p className="text-sm text-destructive">
              {t("batchImport.noBaseDir")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t("batchImport.formatHelp")}
          </p>
          <Textarea
            placeholder={t("batchImport.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="font-mono text-sm"
          />
          <Button variant="outline" size="sm" onClick={handleImportFile}>
            <FileUp className="mr-1 h-4 w-4" />
            {t("batchImport.importFromFile")}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleImport} disabled={importing || !text.trim() || !baseDir}>
            {importing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t("batchImport.importAndDownload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

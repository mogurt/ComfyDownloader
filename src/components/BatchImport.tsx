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

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function BatchImport({ open: isOpen, onClose }: Props) {
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
        title: "Import URL list",
        filters: [{ name: "Text files", extensions: ["txt", "csv"] }],
      });
      const filePath = extractPath(file);
      if (filePath) {
        const contents = await (await fetch(`file://${filePath}`)).text();
        setText((prev) => (prev ? prev + "\n" + contents : contents));
      }
    } catch {
      addLog("error", "Failed to read file");
    }
  };

  const handleImport = async () => {
    const urls = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && (line.startsWith("http://") || line.startsWith("https://")));

    if (urls.length === 0) {
      addLog("warn", "No valid URLs found");
      return;
    }

    if (!baseDir) {
      addLog("error", "Model base directory not configured. Go to Settings -> Directories.");
      return;
    }

    setImporting(true);
    addLog("info", `Importing ${urls.length} URLs...`);

    for (const url of urls) {
      try {
        const result = await api.parseDownloadUrl(
          url,
          settings.proxy || undefined,
          settings.civitai_api_token || undefined
        );

        const matchedSubdir = api.matchSubdir(result.suggested_type, subdirs);
        const targetDir = matchedSubdir ? `${baseDir}\\${matchedSubdir}` : "";

        if (!targetDir) {
          addLog("warn", `No matching subdirectory for ${result.filename} (type: ${result.suggested_type}), skipping`);
          continue;
        }

        const taskId = await addTask({
          gid: "",
          url,
          filename: result.filename,
          source: result.source,
          model_type: matchedSubdir,
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
        addLog("error", `Failed to import ${url}: ${e}`);
      }
    }

    setImporting(false);
    setText("");
    onClose();
    addLog("info", `Batch import complete`);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Batch Import URLs</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!baseDir && (
            <p className="text-sm text-destructive">
              Model base directory not set. Configure it in Settings first.
            </p>
          )}
          <Textarea
            placeholder="Paste URLs here, one per line..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="font-mono text-sm"
          />
          <Button variant="outline" size="sm" onClick={handleImportFile}>
            <FileUp className="mr-1 h-4 w-4" />
            Import from file
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={importing || !text.trim() || !baseDir}>
            {importing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Import & Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

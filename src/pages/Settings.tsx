import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettingsStore } from "@/stores/settingsStore";
import { FolderOpen, Plus, Trash2, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import * as api from "@/lib/api";
import { extractPath } from "@/lib/api";
import type { ModelType } from "@/lib/types";

const MODEL_TYPES: ModelType[] = [
  "checkpoint", "diffusion_model", "lora", "vae", "embedding",
  "controlnet", "upscale_model", "clip", "ipadapter", "custom",
];

export default function Settings() {
  const {
    settings,
    rules,
    updateSetting,
    addRule,
    deleteRule,
    updateRule,
  } = useSettingsStore();

  const [comfyStatus, setComfyStatus] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [detectedSubdirs, setDetectedSubdirs] = useState<string[]>([]);

  const [newRuleType, setNewRuleType] = useState<"filename" | "url">("filename");
  const [newKeyword, setNewKeyword] = useState("");
  const [newModelType, setNewModelType] = useState<string>("checkpoint");

  const handleCheckComfyUI = async () => {
    setChecking(true);
    try {
      const result = await api.checkComfyuiStatus(settings.comfyui_server);
      setComfyStatus(result.message);
    } catch (e) {
      setComfyStatus(`Error: ${e}`);
    }
    setChecking(false);
  };

  const handlePickComfyRoot = async () => {
    try {
      const selected = await open({ directory: true, title: "Select ComfyUI root directory" });
      console.log("[Dialog] ComfyUI root raw return:", selected, typeof selected);
      const dirPath = extractPath(selected);
      console.log("[Dialog] ComfyUI root extracted:", dirPath);
      if (dirPath) {
        await updateSetting("comfyui_root", dirPath);
      }
    } catch (e) {
      console.error("Failed to pick ComfyUI root:", e);
    }
  };

  const handlePickModelBaseDir = async () => {
    try {
      const selected = await open({ directory: true, title: "Select model base directory" });
      console.log("[Dialog] Model base dir raw return:", selected, typeof selected);
      const dirPath = extractPath(selected);
      console.log("[Dialog] Model base dir extracted:", dirPath);
      if (dirPath) {
        await updateSetting("model_base_dir", dirPath);
      }
    } catch (e) {
      console.error("Failed to pick model base dir:", e);
    }
  };

  const handleAddRule = async () => {
    if (!newKeyword.trim()) return;
    await addRule({
      rule_type: newRuleType,
      keyword: newKeyword.trim(),
      model_type: newModelType,
      priority: 0,
      enabled: true,
    });
    setNewKeyword("");
  };

  const effectiveBaseDir =
    settings.model_base_dir ||
    (settings.comfyui_root ? `${settings.comfyui_root}\\models` : "");

  useEffect(() => {
    if (effectiveBaseDir) {
      api.listSubdirs(effectiveBaseDir).then(setDetectedSubdirs).catch(() => setDetectedSubdirs([]));
    } else {
      setDetectedSubdirs([]);
    }
  }, [effectiveBaseDir]);

  const handleApplyDerivedBaseDir = async () => {
    if (settings.comfyui_root) {
      await updateSetting("model_base_dir", `${settings.comfyui_root}\\models`);
    }
  };

  return (
    <div className="h-full p-4">
      <Tabs defaultValue="general" className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="comfyui">ComfyUI</TabsTrigger>
          <TabsTrigger value="directories">Directories</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 mt-4">
          <TabsContent value="general" className="space-y-6 pr-4">
            <SettingGroup title="Download Settings">
              <SettingRow label="Max Concurrent Downloads">
                <Input
                  type="number"
                  value={settings.aria2_max_concurrent}
                  onChange={(e) => updateSetting("aria2_max_concurrent", e.target.value)}
                  className="w-24"
                  min={1}
                  max={16}
                />
              </SettingRow>
              <SettingRow label="Max Connections Per Server">
                <Input
                  type="number"
                  value={settings.aria2_max_connections}
                  onChange={(e) => updateSetting("aria2_max_connections", e.target.value)}
                  className="w-24"
                  min={1}
                  max={64}
                />
              </SettingRow>
              <SettingRow label="Duplicate File Strategy">
                <Select
                  value={settings.duplicate_strategy}
                  onValueChange={(v) => { if (v) updateSetting("duplicate_strategy", v); }}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip</SelectItem>
                    <SelectItem value="rename">Rename</SelectItem>
                    <SelectItem value="overwrite">Overwrite</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow label="Speed Limit (0 = unlimited)">
                <Input
                  type="number"
                  value={settings.download_speed_limit}
                  onChange={(e) => updateSetting("download_speed_limit", e.target.value)}
                  className="w-32"
                  min={0}
                />
                <span className="text-xs text-muted-foreground ml-1">KB/s</span>
              </SettingRow>
            </SettingGroup>

            <Separator />

            <SettingGroup title="Network">
              <SettingRow label="Proxy (HTTP/SOCKS5)">
                <Input
                  placeholder="e.g. http://127.0.0.1:7890"
                  value={settings.proxy}
                  onChange={(e) => updateSetting("proxy", e.target.value)}
                  className="w-72"
                />
              </SettingRow>
              <SettingRow label="Civitai API Token">
                <Input
                  type="password"
                  placeholder="Your Civitai API token"
                  value={settings.civitai_api_token}
                  onChange={(e) => updateSetting("civitai_api_token", e.target.value)}
                  className="w-72"
                />
              </SettingRow>
            </SettingGroup>
          </TabsContent>

          <TabsContent value="comfyui" className="space-y-6 pr-4">
            <SettingGroup title="ComfyUI Configuration">
              <SettingRow label="ComfyUI Root Directory">
                <div className="flex items-center gap-2">
                  <Input
                    value={settings.comfyui_root}
                    onChange={(e) => updateSetting("comfyui_root", e.target.value)}
                    className="w-80"
                    placeholder="D:/path/to/ComfyUI"
                  />
                  <Button variant="outline" size="icon" onClick={handlePickComfyRoot}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </SettingRow>
              <SettingRow label="ComfyUI Server Address">
                <div className="flex items-center gap-2">
                  <Input
                    value={settings.comfyui_server}
                    onChange={(e) => updateSetting("comfyui_server", e.target.value)}
                    className="w-64"
                  />
                  <Button variant="outline" size="sm" onClick={handleCheckComfyUI} disabled={checking}>
                    {checking ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    Check
                  </Button>
                  {comfyStatus && (
                    <span className="text-xs text-muted-foreground">{comfyStatus}</span>
                  )}
                </div>
              </SettingRow>
              <SettingRow label="Auto-verify after download">
                <Switch
                  checked={settings.auto_verify_comfyui === "true"}
                  onCheckedChange={(v) =>
                    updateSetting("auto_verify_comfyui", v ? "true" : "false")
                  }
                />
              </SettingRow>
            </SettingGroup>
          </TabsContent>

          <TabsContent value="directories" className="space-y-6 pr-4">
            <SettingGroup title="Model Base Directory">
              <p className="text-xs text-muted-foreground">
                The root directory containing your model subdirectories (e.g. checkpoints, loras, vae).
                Downloads will be placed into the matching subdirectory automatically.
              </p>
              <SettingRow label="Model Base Directory">
                <div className="flex items-center gap-2">
                  <Input
                    value={settings.model_base_dir}
                    onChange={(e) => updateSetting("model_base_dir", e.target.value)}
                    className="w-96"
                    placeholder={
                      settings.comfyui_root
                        ? `Auto: ${settings.comfyui_root}\\models`
                        : "e.g. C:\\ComfyUI\\ComfyUI\\models"
                    }
                  />
                  <Button variant="outline" size="icon" onClick={handlePickModelBaseDir}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </SettingRow>
              {!settings.model_base_dir && settings.comfyui_root && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    Auto-detected from ComfyUI root: <code>{settings.comfyui_root}\models</code>
                  </span>
                  <Button variant="outline" size="sm" onClick={handleApplyDerivedBaseDir}>
                    Apply
                  </Button>
                </div>
              )}
            </SettingGroup>

            {detectedSubdirs.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Detected Subdirectories</h3>
                  <p className="text-xs text-muted-foreground">
                    These directories were found under your model base directory. They will appear in the download dropdown.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {detectedSubdirs.map((d) => (
                      <Badge key={d} variant="secondary">
                        {d}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {effectiveBaseDir && detectedSubdirs.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No subdirectories found. Check that the path is correct.
              </p>
            )}
          </TabsContent>

          <TabsContent value="rules" className="space-y-4 pr-4">
            <h3 className="text-sm font-medium">Keyword Rules</h3>
            <p className="text-xs text-muted-foreground">
              When a filename or URL contains the keyword, the model type will be auto-suggested.
            </p>

            <div className="flex items-end gap-2">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={newRuleType} onValueChange={(v) => { if (v) setNewRuleType(v as "filename" | "url"); }}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="filename">Filename</SelectItem>
                    <SelectItem value="url">URL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label className="text-xs">Keyword</Label>
                <Input
                  placeholder="e.g. flux, sdxl"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Model Type</Label>
                <Select value={newModelType} onValueChange={(v) => { if (v) setNewModelType(v); }}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleAddRule} disabled={!newKeyword.trim()}>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            </div>

            <Separator />

            <div className="space-y-2">
              {rules.length === 0 && (
                <p className="text-sm text-muted-foreground">No custom rules defined</p>
              )}
              {rules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-2 rounded border p-2">
                  <Badge variant="outline" className="text-xs">
                    {rule.rule_type}
                  </Badge>
                  <span className="flex-1 text-sm font-mono">{rule.keyword}</span>
                  <Badge variant="secondary">{rule.model_type}</Badge>
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(v) =>
                      updateRule({ ...rule, enabled: v })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => deleteRule(rule.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

function SettingGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="text-sm min-w-[200px]">{label}</Label>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

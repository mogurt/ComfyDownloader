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
import { FolderOpen, Plus, Trash2, Loader2, Laptop, Moon, Sun } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import * as api from "@/lib/api";
import { extractPath } from "@/lib/api";
import type { ModelType } from "@/lib/types";
import type { ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const MODEL_TYPES: ModelType[] = [
  "checkpoint", "diffusion_model", "lora", "vae", "embedding",
  "controlnet", "upscale_model", "clip", "ipadapter", "custom",
];

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  {
    value: "light",
    label: "Light",
    description: "Bright neutral surfaces with softer blue accents.",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Deeper slate surfaces with calmer contrast and vivid highlights.",
    icon: Moon,
  },
  {
    value: "system",
    label: "System",
    description: "Follow your OS appearance automatically.",
    icon: Laptop,
  },
];

export default function Settings() {
  const { t } = useI18n();
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
      const selected = await open({ directory: true, title: t("settings.comfyRoot") });
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
      const selected = await open({ directory: true, title: t("settings.modelBase") });
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
    <div className="flex h-full min-h-0 flex-col p-4">
      <Tabs defaultValue="general" className="flex h-full min-h-0 flex-col">
        <TabsList className="w-full justify-start rounded-xl border border-border/70 bg-card/70 p-1 shadow-sm">
          <TabsTrigger value="general">{t("settings.general")}</TabsTrigger>
          <TabsTrigger value="comfyui">ComfyUI</TabsTrigger>
          <TabsTrigger value="directories">{t("settings.directories")}</TabsTrigger>
          <TabsTrigger value="rules">{t("settings.rules")}</TabsTrigger>
        </TabsList>

        <ScrollArea className="mt-2 min-h-0 flex-1 pr-1">
          <TabsContent value="general" className="space-y-3 pr-3 pb-3">
            <SettingGroup title={t("settings.appearance")}>
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2.5">
                  {THEME_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const active = settings.theme === option.value;
                    const optionLabel = option.value === "light"
                      ? t("settings.themeLight")
                      : option.value === "dark"
                        ? t("settings.themeDark")
                        : t("settings.themeSystem");
                    const optionDescription = option.value === "light"
                      ? t("settings.themeLightDesc")
                      : option.value === "dark"
                        ? t("settings.themeDarkDesc")
                        : t("settings.themeSystemDesc");
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => updateSetting("theme", option.value)}
                        className={cn(
                          "flex min-w-[200px] flex-1 items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                          active
                              ? "border-primary/40 bg-primary/8 shadow-sm"
                              : "border-border/70 bg-background/70 hover:bg-muted/50"
                        )}
                      >
                        <div
                          className={cn(
                            "mt-0.5 rounded-lg border p-1.5",
                            active
                              ? "border-primary/30 bg-primary/12 text-primary"
                              : "border-border bg-muted text-muted-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="space-y-1">
                          <div className="text-sm font-medium">{optionLabel}</div>
                          <div className="text-xs text-muted-foreground">
                            {optionDescription}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <SettingRow label={t("settings.language")}>
                  <Select
                    value={settings.language}
                    onValueChange={(value) => {
                      if (value) void updateSetting("language", value);
                    }}
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">{t("settings.languageEnglish")}</SelectItem>
                      <SelectItem value="zh">{t("settings.languageChinese")}</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <p className="text-xs text-muted-foreground">
                  {t("settings.themeHelp")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.languageHelp")}
                </p>
              </div>
            </SettingGroup>

            <Separator className="my-1" />

            <SettingGroup title={t("settings.downloadSettings")}>
              <SettingRow label={t("settings.maxConcurrent")}>
                <Input
                  type="number"
                  value={settings.aria2_max_concurrent}
                  onChange={(e) => updateSetting("aria2_max_concurrent", e.target.value)}
                  className="w-24"
                  min={1}
                  max={16}
                />
              </SettingRow>
              <SettingRow label={t("settings.maxConnections")}>
                <Input
                  type="number"
                  value={settings.aria2_max_connections}
                  onChange={(e) => updateSetting("aria2_max_connections", e.target.value)}
                  className="w-24"
                  min={1}
                  max={64}
                />
              </SettingRow>
              <SettingRow label={t("settings.duplicateStrategy")}>
                <Select
                  value={settings.duplicate_strategy}
                  onValueChange={(v) => { if (v) updateSetting("duplicate_strategy", v); }}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">{t("settings.duplicate.skip")}</SelectItem>
                    <SelectItem value="rename">{t("settings.duplicate.rename")}</SelectItem>
                    <SelectItem value="overwrite">{t("settings.duplicate.overwrite")}</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow label={t("settings.speedLimit")}>
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

            <Separator className="my-1" />

            <SettingGroup title={t("settings.network")}>
              <SettingRow label={t("settings.proxy")}>
                <Input
                  placeholder={t("settings.placeholder.proxy")}
                  value={settings.proxy}
                  onChange={(e) => updateSetting("proxy", e.target.value)}
                  className="w-72"
                />
              </SettingRow>
              <SettingRow label={t("settings.civitaiToken")}>
                <Input
                  type="password"
                  placeholder={t("settings.placeholder.civitaiToken")}
                  value={settings.civitai_api_token}
                  onChange={(e) => updateSetting("civitai_api_token", e.target.value)}
                  className="w-72"
                />
              </SettingRow>
              <SettingRow label={t("settings.huggingfaceToken")}>
                <Input
                  type="password"
                  placeholder={t("settings.placeholder.huggingfaceToken")}
                  value={settings.huggingface_token}
                  onChange={(e) => updateSetting("huggingface_token", e.target.value)}
                  className="w-72"
                />
              </SettingRow>
            </SettingGroup>
          </TabsContent>

          <TabsContent value="comfyui" className="space-y-3 pr-3 pb-3">
            <SettingGroup title={t("settings.comfyConfig")}>
              <SettingRow label={t("settings.comfyRoot")}>
                <div className="flex items-center gap-2">
                  <Input
                    value={settings.comfyui_root}
                    onChange={(e) => updateSetting("comfyui_root", e.target.value)}
                    className="w-80"
                    placeholder={t("settings.placeholder.comfyRoot")}
                  />
                  <Button variant="outline" size="icon" onClick={handlePickComfyRoot}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </SettingRow>
              <SettingRow label={t("settings.comfyServer")}>
                <div className="flex items-center gap-2">
                  <Input
                    value={settings.comfyui_server}
                    onChange={(e) => updateSetting("comfyui_server", e.target.value)}
                    className="w-64"
                  />
                  <Button variant="outline" size="sm" onClick={handleCheckComfyUI} disabled={checking}>
                    {checking ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    {t("common.check")}
                  </Button>
                  {comfyStatus && (
                    <span className="text-xs text-muted-foreground">{comfyStatus}</span>
                  )}
                </div>
              </SettingRow>
              <SettingRow label={t("settings.autoVerify")}>
                <Switch
                  checked={settings.auto_verify_comfyui === "true"}
                  onCheckedChange={(v) =>
                    updateSetting("auto_verify_comfyui", v ? "true" : "false")
                  }
                />
              </SettingRow>
            </SettingGroup>
          </TabsContent>

          <TabsContent value="directories" className="space-y-3 pr-3 pb-3">
            <SettingGroup title={t("settings.modelBase")}>
              <p className="text-xs text-muted-foreground">
                {t("settings.modelBaseHelp")}
              </p>
              <SettingRow label={t("settings.modelBase")}>
                <div className="flex items-center gap-2">
                  <Input
                    value={settings.model_base_dir}
                    onChange={(e) => updateSetting("model_base_dir", e.target.value)}
                    className="w-96"
                    placeholder={
                      settings.comfyui_root
                        ? `Auto: ${settings.comfyui_root}\\models`
                        : t("settings.placeholder.modelBase")
                    }
                  />
                  <Button variant="outline" size="icon" onClick={handlePickModelBaseDir}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </SettingRow>
              {!settings.model_base_dir && settings.comfyui_root && (
                <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    {t("settings.autoDetectedBaseDir", { path: `${settings.comfyui_root}\\models` })}
                  </span>
                  <Button variant="outline" size="sm" onClick={handleApplyDerivedBaseDir}>
                    {t("common.apply")}
                  </Button>
                </div>
              )}
            </SettingGroup>

            {detectedSubdirs.length > 0 && (
              <>
                <Separator />
                <div className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-sm space-y-2">
                  <h3 className="text-sm font-medium">{t("settings.detectedSubdirs")}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.detectedSubdirsHelp")}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {detectedSubdirs.map((d) => (
                      <Badge key={d} variant="outline" className="border-border/70 bg-background/70">
                        {d}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {effectiveBaseDir && detectedSubdirs.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("settings.noSubdirs")}
              </p>
            )}
          </TabsContent>

          <TabsContent value="rules" className="space-y-3 pr-3 pb-3">
            <SettingGroup title={t("settings.keywordRules")}>
              <p className="text-xs text-muted-foreground">
                {t("settings.keywordRulesHelp")}
              </p>

              <div className="flex items-end gap-2">
              <div>
                <Label className="text-xs">{t("settings.ruleType")}</Label>
                <Select value={newRuleType} onValueChange={(v) => { if (v) setNewRuleType(v as "filename" | "url"); }}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="filename">{t("settings.ruleType.filename")}</SelectItem>
                    <SelectItem value="url">{t("settings.ruleType.url")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label className="text-xs">{t("settings.ruleKeyword")}</Label>
                <Input
                  placeholder={t("settings.placeholder.keyword")}
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">{t("settings.ruleModelType")}</Label>
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
                {t("common.add")}
              </Button>
              </div>

              <Separator className="my-1" />

              <div className="space-y-1.5">
                {rules.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("settings.noRules")}</p>
                )}
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/60 p-3 shadow-sm"
                  >
                    <Badge variant="outline" className="border-border/70 bg-card text-xs">
                      {rule.rule_type}
                    </Badge>
                    <span className="flex-1 text-sm font-mono">{rule.keyword}</span>
                    <Badge variant="outline" className="border-primary/20 bg-primary/8 text-primary">
                      {rule.model_type}
                    </Badge>
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
            </SettingGroup>
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
    <div className="space-y-2 rounded-xl border border-border/70 bg-card/75 p-2.5 shadow-sm">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="space-y-1.5">{children}</div>
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
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/55 px-2.5 py-1.5">
      <Label className="min-w-[156px] text-[13px] leading-5">{label}</Label>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

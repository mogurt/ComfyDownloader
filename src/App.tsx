import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAria2Events } from "@/hooks/useAria2Events";
import { useTaskStore } from "@/stores/taskStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import * as api from "@/lib/api";
import Home from "@/pages/Home";
import Search from "@/pages/Search";
import Settings from "@/pages/Settings";
import { Settings as SettingsIcon, Download, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function App() {
  const { t } = useI18n();
  const [page, setPage] = useState<"home" | "search" | "settings">("home");
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const resetStaleTasks = useTaskStore((s) => s.resetStaleTasks);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadRules = useSettingsStore((s) => s.loadRules);
  const syncAria2Settings = useSettingsStore((s) => s.syncAria2Settings);
  const theme = useSettingsStore((s) => s.settings.theme);

  useAria2Events();

  useEffect(() => {
    const init = async () => {
      await loadSettings();
      await loadRules();
      await resetStaleTasks();
      await loadTasks();
      try {
        const ready = await api.isAria2Ready();
        if (ready) {
          useTaskStore.getState().setAria2Ready(true);
          await syncAria2Settings();
        }
      } catch { /* aria2 not yet started, event listener will handle it */ }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const preventContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    document.addEventListener("contextmenu", preventContextMenu);
    return () => {
      document.removeEventListener("contextmenu", preventContextMenu);
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [theme]);

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">{t("app.title")}</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={page === "home" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setPage("home")}
            >
              <Download className="mr-1 h-4 w-4" />
              {t("nav.downloads")}
            </Button>
            <Button
              variant={page === "search" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setPage("search")}
            >
              <SearchIcon className="mr-1 h-4 w-4" />
              {t("nav.search")}
            </Button>
            <Button
              variant={page === "settings" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setPage("settings")}
            >
              <SettingsIcon className="mr-1 h-4 w-4" />
              {t("nav.settings")}
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-hidden">
          {page === "home" ? <Home /> : page === "search" ? <Search /> : <Settings />}
        </main>
      </div>
    </TooltipProvider>
  );
}

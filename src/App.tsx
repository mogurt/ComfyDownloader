import { useEffect, useState, useCallback } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAria2Events } from "@/hooks/useAria2Events";
import { useTaskStore } from "@/stores/taskStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSearchStore } from "@/stores/searchStore";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import * as api from "@/lib/api";
import Home from "@/pages/Home";
import Search from "@/pages/Search";
import Settings from "@/pages/Settings";
import Workflow from "@/pages/Workflow";
import { Settings as SettingsIcon, Download, Search as SearchIcon, FileJson, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Page = "home" | "search" | "workflow" | "settings";

export default function App() {
  const { t } = useI18n();
  const [page, setPage] = useState<Page>("search");
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const resetStaleTasks = useTaskStore((s) => s.resetStaleTasks);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadRules = useSettingsStore((s) => s.loadRules);
  const syncAria2Settings = useSettingsStore((s) => s.syncAria2Settings);
  const theme = useSettingsStore((s) => s.settings.theme);
  const activeCount = useTaskStore((s) =>
    s.tasks.filter((t) => t.status === "downloading" || t.status === "queued").length
  );

  // Workflow → Search context
  const [workflowSearchFilename, setWorkflowSearchFilename] = useState<string | null>(null);

  useAria2Events();

  useEffect(() => {
    const init = async () => {
      try {
        await loadSettings();
        await loadRules();
        await resetStaleTasks();
        await loadTasks();
      } catch (e) {
        // Otherwise the app silently shows empty settings and task lists.
        useTaskStore.getState().addLog("error", `Failed to load local data: ${String(e)}`);
      }
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

  const handleNavigateToSearch = useCallback((query: string, filename: string) => {
    setWorkflowSearchFilename(filename);
    useSearchStore.getState().setQuery(query);
    setPage("search");
    setTimeout(() => useSearchStore.getState().search(), 50);
  }, []);

  const handleBackToWorkflow = useCallback(() => {
    setWorkflowSearchFilename(null);
    setPage("workflow");
  }, []);

  const handleSetPage = useCallback((p: Page) => {
    if (p !== "search") {
      setWorkflowSearchFilename(null);
    }
    setPage(p);
  }, []);

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
              variant={page === "search" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => handleSetPage("search")}
            >
              <SearchIcon className="mr-1 h-4 w-4" />
              {t("nav.search")}
            </Button>
            <Button
              variant={page === "workflow" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => handleSetPage("workflow")}
            >
              <FileJson className="mr-1 h-4 w-4" />
              {t("nav.workflow")}
            </Button>
            <Button
              variant={page === "home" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => handleSetPage("home")}
            >
              <Download className="mr-1 h-4 w-4" />
              {t("nav.downloads")}
              {activeCount > 0 && (
                <Badge variant="default" className="ml-1 h-4 min-w-4 px-1 text-[10px]">
                  {activeCount}
                </Badge>
              )}
            </Button>
            <Button
              variant={page === "settings" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => handleSetPage("settings")}
            >
              <SettingsIcon className="mr-1 h-4 w-4" />
              {t("nav.settings")}
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden flex flex-col">
          {/* Context bar: searching from workflow */}
          {page === "search" && workflowSearchFilename && (
            <div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={handleBackToWorkflow}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("workflow.backToWorkflow")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t("workflow.searchingFor")}
              </span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                {workflowSearchFilename}
              </code>
            </div>
          )}

          {/* All pages stay mounted, only active one is visible */}
          <div className={`flex-1 overflow-hidden ${page === "home" ? "" : "hidden"}`}>
            <Home />
          </div>
          <div className={`flex-1 overflow-hidden ${page === "search" ? "" : "hidden"}`}>
            <Search
              highlightFilename={workflowSearchFilename}
              onNavigateToSettings={() => handleSetPage("settings")}
            />
          </div>
          <div className={`flex-1 overflow-hidden ${page === "workflow" ? "" : "hidden"}`}>
            <Workflow
              onNavigateToSearch={handleNavigateToSearch}
              onNavigateToSettings={() => handleSetPage("settings")}
            />
          </div>
          <div className={`flex-1 overflow-hidden ${page === "settings" ? "" : "hidden"}`}>
            <Settings />
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

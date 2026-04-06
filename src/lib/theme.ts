export type ThemeMode = "light" | "dark" | "system";

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

function getResolvedTheme(theme: ThemeMode): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light";
  }
  return theme;
}

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  const resolvedTheme = getResolvedTheme(theme);

  root.dataset.theme = theme;
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.style.colorScheme = resolvedTheme;
}

export function watchSystemTheme(onChange: () => void) {
  const media = window.matchMedia(SYSTEM_THEME_QUERY);
  const handler = () => onChange();
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "localfirst-theme";

function isSystemDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    if (typeof window.localStorage?.getItem !== "function") {
      return "system";
    }
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    return "system";
  }
  return "system";
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "light" || pref === "dark") {
    return pref;
  }
  return isSystemDark() ? "dark" : "light";
}

export function applyThemePreference(
  pref: ThemePreference,
  persist: boolean = true
): ResolvedTheme {
  const resolved = resolveTheme(pref);

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.setAttribute("data-theme-preference", pref);
    root.style.colorScheme = resolved;
    root.classList.toggle("dark", resolved === "dark");
  }

  if (persist && typeof window !== "undefined") {
    try {
      if (pref === "system" && typeof window.localStorage?.removeItem === "function") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else if (pref !== "system" && typeof window.localStorage?.setItem === "function") {
        window.localStorage.setItem(THEME_STORAGE_KEY, pref);
      }
    } catch {
      // Ignore storage access errors in restricted frames
    }
  }

  return resolved;
}

export function subscribeToSystemTheme(
  onSystemChange: (resolved: ResolvedTheme) => void
): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  let mql: MediaQueryList;
  try {
    mql = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return () => {};
  }

  const listener = () => {
    onSystemChange(mql.matches ? "dark" : "light");
  };

  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }
  if (typeof mql.addListener === "function") {
    mql.addListener(listener);
    return () => mql.removeListener(listener);
  }
  return () => {};
}

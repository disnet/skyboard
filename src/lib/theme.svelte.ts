const STORAGE_KEY = "skyboard-theme";

type ThemeMode = "light" | "dark" | "system";
type EffectiveTheme = "light" | "dark";

let mode = $state<ThemeMode>("system");
let systemPrefersDark = $state(false);

const effectiveTheme: EffectiveTheme = $derived(
  mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode,
);

let initialized = false;

export function initTheme() {
  if (initialized) return;
  initialized = true;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    mode = stored;
  }

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  systemPrefersDark = mql.matches;
  mql.addEventListener("change", (e) => {
    systemPrefersDark = e.matches;
  });

  $effect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute(
        "content",
        effectiveTheme === "dark" ? "#1a1a1e" : "#0066cc",
      );
    }
  });

  $effect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  });
}

export function getTheme() {
  return {
    get mode() {
      return mode;
    },
    get effectiveTheme() {
      return effectiveTheme;
    },
  };
}

export function setTheme(newMode: ThemeMode) {
  mode = newMode;
}

export function cycleTheme() {
  if (mode === "system") {
    mode = "light";
  } else if (mode === "light") {
    mode = "dark";
  } else {
    mode = "system";
  }
}

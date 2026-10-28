import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "theme";

// Storage can be unavailable (private windows, blocked site data); the device setting still works then.
const stored = (): Theme | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
};

const deviceTheme = (): Theme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const apply = (theme: Theme) => {
  document.documentElement.classList.toggle("dark", theme === "dark");
};

// Follows the device setting until you pick one with the toggle; the pick is remembered per browser.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? deviceTheme());

  useEffect(() => apply(theme), [theme]);

  useEffect(() => {
    if (stored()) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => setTheme(deviceTheme());
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  const toggle = () =>
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // Not remembered, but still switches for this visit.
      }
      return next;
    });

  return { theme, toggle };
}

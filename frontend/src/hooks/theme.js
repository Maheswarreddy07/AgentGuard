import { useEffect, useState } from "react";

const KEY = "ag.theme";
export const THEMES = ["system", "light", "dark"];   // the choices; their names come from the server text
export const readTheme = () => { try { const t = localStorage.getItem(KEY); return THEMES.includes(t) ? t : "system"; } catch { return "system"; } };

/** The person's colour theme: remembered in this browser, applied to <html data-theme>. */
export function useTheme() {
  const [theme, set] = useState(readTheme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return [theme, (next) => { try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ } set(next); }];
}

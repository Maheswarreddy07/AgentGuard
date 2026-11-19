import { useSyncExternalStore } from "react";

const KEY = "ag.mode";
export const UI_MODES = ["simple", "advanced"];   // names come from the server. Simple is the default.
const read = () => { try { const v = localStorage.getItem(KEY); return UI_MODES.includes(v) ? v : "simple"; } catch { return "simple"; } };
let mode = read();
const listeners = new Set();
export const getMode = () => mode;
/** Simple or Advanced: changes only how things are shown (wording, extra detail). The data underneath is the same. */
export function setMode(next) {
  if (!UI_MODES.includes(next) || next === mode) return;
  mode = next; try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  listeners.forEach((f) => f());
}
export const useMode = () => [useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, getMode), setMode];
export const useAdvanced = () => useMode()[0] === "advanced";

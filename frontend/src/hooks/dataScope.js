import { useSyncExternalStore } from "react";

const KEY = "ag.scope";
export const SCOPES = ["production", "synthetic"];     // real activity | demo, sample and starter runs; their names come from the server
const read = () => { try { const v = localStorage.getItem(KEY); return SCOPES.includes(v) ? v : "production"; } catch { return "production"; } };
let scope = read();
const listeners = new Set();
export const getDataScope = () => scope;
/** Switch between real activity and demo data. Reloads so every number on screen is recomputed for that scope; nothing is mixed. */
export function setDataScope(next) {
  if (!SCOPES.includes(next) || next === scope) return;
  scope = next; try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  listeners.forEach((f) => f()); if (typeof window !== "undefined" && window.location) { try { window.location.reload(); } catch { /* jsdom */ } }
}
export const useDataScope = () => [useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, getDataScope), setDataScope];

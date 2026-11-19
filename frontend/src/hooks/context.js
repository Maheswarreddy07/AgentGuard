import { createContext, useContext } from "react";
const EMPTY_META = { categories: {}, metrics: {}, actions: {}, severities: [], severity_colors: {}, roles: [], modes: {}, policy_actions: {}, access: { navigation: [], pages: [], capabilities: {}, capability_info: {} }, ui: {} };
export const MetaCtx = createContext(EMPTY_META);
export const useMeta = () => useContext(MetaCtx);
export const AuthCtx = createContext({ user: null, can: () => true, allowed: () => true, logout: () => {}, authRequired: false });
export const useAuth = () => useContext(AuthCtx);
export const catLabel = (meta, k) => meta.categories?.[k]?.label ?? String(k).replace(/_/g, " ");
export const roleLabel = (meta, k) => meta.roles?.find((r) => r.key === k)?.label ?? k;
/** Fill {placeholders} in a sentence that came from the server. */
export const fill = (text = "", vars = {}) => String(text).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
/** Sentences the server supplies for a page, e.g. useText("scenarios"). */
/** A page's hand-written wording, e.g. useText("scenarios"). One interface: there are no per-mode variants. */
export const useText = (page) => useContext(MetaCtx).ui?.[page] ?? {};

/**
 * The page's wording from the server: `const txt = useT("settings"); txt("save_changes")`.
 * `txt("welcome", { name })` fills {name}. A missing key shows nothing and warns in the console (so it is noticed, never faked).
 */
export function useT(ns) {
  const strings = useContext(MetaCtx).ui?.strings?.[ns];
  return (key, vars) => {
    const text = strings?.[key];
    if (text === undefined) { if (typeof console !== "undefined" && strings) console.warn(`Missing wording: ${ns}.${key}`); return ""; }
    return vars ? fill(text, vars) : text;
  };
}

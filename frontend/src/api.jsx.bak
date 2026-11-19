import { createContext, useCallback, useContext, useEffect, useState } from "react";
const BASE = import.meta.env.VITE_API_URL ?? "";
const TOKEN_KEY = "agentguard.token";
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } };

export async function api(path, init = {}) {
  const token = getToken();
  const r = await fetch(BASE + path, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    try { const j = await r.json(); msg = j.error?.message ?? j.detail ?? msg; if (j.error?.details?.length) msg += ": " + j.error.details.map((d) => `${d.where} ${d.problem}`).join("; "); } catch { /* keep default */ }
    if (r.status === 401 && !/\/auth\/(login|setup|status)/.test(path)) window.dispatchEvent(new Event("ag-unauth"));
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return r.json();
}
export function useApi(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const load = useCallback(() => {
    if (!path) { setLoading(false); return; }
    setLoading(true);
    api(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [path]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}
const EMPTY_META = { categories: {}, metrics: {}, actions: {}, severities: [], severity_colors: {}, roles: [] };
export const MetaCtx = createContext(EMPTY_META);
export const useMeta = () => useContext(MetaCtx);
export const AuthCtx = createContext({ user: null, can: () => true, logout: () => {}, authRequired: false });
export const useAuth = () => useContext(AuthCtx);
export const catLabel = (meta, k) => meta.categories?.[k]?.label ?? String(k).replace(/_/g, " ");
export const roleLabel = (meta, k) => meta.roles?.find((r) => r.key === k)?.label ?? k;
export function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
}

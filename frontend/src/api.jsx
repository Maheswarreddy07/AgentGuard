import { createContext, useCallback, useContext, useEffect, useState } from "react";
const BASE = import.meta.env.VITE_API_URL ?? "";
export async function api(path, init) {
  const r = await fetch(BASE + path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    try { const j = await r.json(); msg = j.error?.message ?? j.detail ?? msg; if (j.error?.details?.length) msg += ": " + j.error.details.map((d) => `${d.where} ${d.problem}`).join("; "); } catch { /* keep default */ }
    throw new Error(msg);
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
export const MetaCtx = createContext({ categories: {}, metrics: {}, actions: {}, severities: [] });
export const useMeta = () => useContext(MetaCtx);
export const catLabel = (meta, k) => meta.categories?.[k]?.label ?? String(k).replace(/_/g, " ");
export function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
}

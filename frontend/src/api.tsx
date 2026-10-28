import { useCallback, useEffect, useState } from "react";
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  return r.json() as Promise<T>;
}
export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    api<T>(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(String(e.message))).finally(() => setLoading(false));
  }, [path]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}
export function State({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <p role="status">Loading…</p>;
  if (error) return <p role="alert" className="err">Error: {error}</p>;
  return null;
}
export const pct = (v: number | null | undefined) => (v == null ? "n/a" : (v * 100).toFixed(1) + "%");
export function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
}

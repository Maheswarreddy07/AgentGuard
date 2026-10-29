import { useCallback, useEffect, useState } from "react";
const BASE = import.meta.env.VITE_API_URL ?? "";
export async function api(path, init) {
    const r = await fetch(BASE + path, { headers: { "Content-Type": "application/json" }, ...init });
    if (!r.ok)
        throw new Error(`${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    return r.json();
}
export function useApi(path) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const load = useCallback(() => {
        setLoading(true);
        api(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(String(e.message))).finally(() => setLoading(false));
    }, [path]);
    useEffect(load, [load]);
    return { data, error, loading, reload: load };
}
export function State({ loading, error }) {
    if (loading)
        return <p role="status">Loading…</p>;
    if (error)
        return <p role="alert" className="err">Error: {error}</p>;
    return null;
}
export const pct = (v) => (v == null ? "n/a" : (v * 100).toFixed(1) + "%");
export function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
}

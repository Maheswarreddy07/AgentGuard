import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

/** Load data from a GET endpoint. Pass null to skip. Returns { data, error, loading, reload }. */
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

/** Reload a useApi() result every `ms` milliseconds (e.g. a queue that fills while you watch). */
export function usePolling(reload, ms) {
  useEffect(() => { const t = setInterval(reload, ms); return () => clearInterval(t); }, [reload, ms]);
}

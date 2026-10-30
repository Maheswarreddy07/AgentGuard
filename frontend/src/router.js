import { useEffect, useState } from "react";
function parse() {
  const h = window.location.hash.replace(/^#/, "") || "/overview";
  const [path, qs = ""] = h.split("?");
  return { path, params: Object.fromEntries(new URLSearchParams(qs)) };
}
export function useRoute() {
  const [r, setR] = useState(parse);
  useEffect(() => { const f = () => setR(parse()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return r;
}
export function go(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null)).toString();
  window.location.hash = path + (qs ? "?" + qs : "");
}

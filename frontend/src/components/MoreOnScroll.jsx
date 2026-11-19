import { useEffect, useRef, useState } from "react";
import { CHUNK } from "../config/ui";
import { useText } from "../hooks/context";

/** Shows `items` a screenful at a time and loads more as the person scrolls. `children(visibleItems)` renders them. */
export default function MoreOnScroll({ items, step = CHUNK, children }) {
  const t = useText("common"), [shown, setShown] = useState(step), end = useRef(null), more = shown < items.length;
  const total = items.length;
  useEffect(() => { setShown(step); }, [total, step]);          // start again when the list itself changes (a new filter), not on every re-render
  useEffect(() => {
    if (!more || !end.current) return undefined;
    if (typeof IntersectionObserver === "undefined") { setShown(items.length); return undefined; }   // very old browsers (and tests): show everything
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setShown((n) => n + step); }, { rootMargin: "400px" });
    io.observe(end.current);
    return () => io.disconnect();
  }, [more, items.length, step]);
  return <>{children(items.slice(0, shown))}{more && <div ref={end} className="more-end muted small" role="status">{t.load_more}</div>}</>;
}

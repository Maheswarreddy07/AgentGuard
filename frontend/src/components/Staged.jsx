import { Children, useEffect, useState } from "react";
import { STAGE_MS } from "../config/ui";

/** Shows its children one after the other. A section only mounts (and so only starts loading its data) after the one before it. */
export default function Staged({ children, step = STAGE_MS }) {
  const items = Children.toArray(children), [shown, setShown] = useState(1);
  useEffect(() => {
    if (shown >= items.length) return undefined;
    const id = setTimeout(() => setShown((n) => n + 1), step);
    return () => clearTimeout(id);
  }, [shown, items.length, step]);
  return <>{items.slice(0, shown).map((c, i) => <div key={c.key ?? i} className="stage-in">{c}</div>)}</>;
}

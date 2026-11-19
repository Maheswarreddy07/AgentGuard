import { timeAgo, when } from "../ui";
import { useT } from "../hooks/context";

const pretty = (k, v) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`;

/** Who did what, newest first. `linkFor(item)` may return a URL for the item's target. */
export default function ActivityTimeline({ items, hasMore, loading, onMore, linkFor = () => null, remaining }) {
  const txt = useT("activity_timeline");
  return (
    <div className="stack">
      <ol className="timeline">
        {items.map((a) => { const link = linkFor(a); return (
          <li key={a.id} className={"tl " + a.kind}><span className="tl-dot" aria-hidden="true" />
            <div className="tl-body">
              <div className="tl-top"><b>{a.label}</b>{a.target && (link ? <a href={link} className="tag">{a.target}</a> : <span className="tag">{a.target}</span>)}<span className="muted small" title={when(a.ts)}>{timeAgo(a.ts)} {txt("by_actor", { actor: a.actor })}</span></div>
              {Object.keys(a.detail ?? {}).length > 0 && <div className="muted small">{Object.entries(a.detail).map(([k, v]) => pretty(k, v)).join(" · ")}</div>}
            </div>
          </li>); })}
      </ol>
      {hasMore && <button className="btn" disabled={loading} onClick={onMore}>{txt("show_more")}{remaining ? txt("remaining_older", { remaining }) : ""}</button>}
    </div>
  );
}

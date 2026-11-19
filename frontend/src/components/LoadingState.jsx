import { useText } from "../hooks/context";

/** Skeleton while loading, or a readable error with an optional retry. */
export default function LoadingState({ h = 120, label, error, onRetry }) {
  const t = useText("shell");
  if (error) {
    return (
      <div role="alert" className="alert">
        {t.error_prefix} {error}
        {onRetry && <> <button className="linkbtn" onClick={onRetry}>{t.retry}</button></>}
      </div>
    );
  }
  return <div className="skeleton" style={{ height: h }} role="status" aria-busy="true" aria-label={label ?? t.loading} />;
}

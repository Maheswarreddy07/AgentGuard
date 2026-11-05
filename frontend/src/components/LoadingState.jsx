/** Skeleton while loading, or a readable error with an optional retry. */
export default function LoadingState({ h = 120, label = "Loading…", error, onRetry }) {
  if (error) {
    return (
      <div role="alert" className="alert">
        Something went wrong: {error}
        {onRetry && <> <button className="linkbtn" onClick={onRetry}>Try again</button></>}
      </div>
    );
  }
  return <div className="skeleton" style={{ height: h }} role="status" aria-busy="true" aria-label={label} />;
}

/** Friendly "nothing here yet" panel with an optional next step. */
export default function EmptyState({ icon = "🗂", title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-i" aria-hidden="true">{icon}</div>
      <div className="empty-t">{title}</div>
      {children}
      {action}
    </div>
  );
}

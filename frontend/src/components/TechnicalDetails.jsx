/** Collapsed-by-default box for raw data, so non-technical readers are not overwhelmed. */
export default function TechnicalDetails({ title = "Technical details", data, children, defaultOpen = false }) {
  return (
    <details className="tech" open={defaultOpen}>
      <summary>{title}</summary>
      {children ?? <pre>{JSON.stringify(data, null, 1)}</pre>}
    </details>
  );
}

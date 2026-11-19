import { useT } from "../hooks/context";

/** Collapsed-by-default box for raw data, so non-technical readers are not overwhelmed. */
export default function TechnicalDetails({ title, data, children, defaultOpen = false }) {
  const txt = useT("technical_details");
  return (
    <details className="tech" open={defaultOpen}>
      <summary>{title ?? txt("title")}</summary>
      {children ?? <pre>{JSON.stringify(data, null, 1)}</pre>}
    </details>
  );
}

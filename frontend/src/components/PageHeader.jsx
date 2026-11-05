/** Page title, a one-line plain-language explanation, and optional action buttons. */
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-h page-h-row">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

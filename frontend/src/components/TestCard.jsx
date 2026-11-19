import { fill, useText } from "../hooks/context";
import { timeAgo } from "../ui";
import TechnicalDetails from "./TechnicalDetails";

/** What the last recorded run says about this test: Passed, Failed, "x of y passed" or Not tested. Never guessed. */
export function lastLabel(last, t) {
  if (!last || !last.total) return [t.not_tested, "none"];
  if (last.passed === last.total) return [t.passed, "ok"];
  if (last.passed === 0) return [t.failed, "bad"];
  return [fill(t.partly, { passed: last.passed, total: last.total }), "warn"];
}

/** One test in the library: a plain name, what it checks, the safe behaviour and its last result. Identifiers live only under Technical details. */
export default function TestCard({ test, onRun, canRun = true, onDelete }) {
  const t = useText("tests").library ?? {}, tech = useText("tests").technical ?? {}, [label, tone] = lastLabel(test.last, t);
  return (
    <article className={"test-card " + tone}>
      <header className="tc-h"><h3>{test.name}</h3><span className={"tc-r " + tone}>{label}</span></header>
      <p className="tc-s">{test.summary}</p>
      <dl className="tc-d">
        <div><dt>{t.checks_label}</dt><dd>{test.checks}</dd></div>
        <div><dt>{t.expected_label}</dt><dd>{test.expected}</dd></div>
      </dl>
      {test.also?.length > 0 && <p className="muted small">{fill(t.combined, { list: test.also.join(", ").toLowerCase() })}</p>}
      <p className="muted small">{test.n_cases === 1 ? t.cases_one : fill(t.cases, { n: test.n_cases })}{test.last?.at ? " · " + fill(t.tested_on, { when: timeAgo(test.last.at) }) : ""}</p>
      <div className="tc-f"><button className="btn sm primary" disabled={!canRun} onClick={() => onRun(test)}>{t.run}</button>{onDelete}</div>
      <TechnicalDetails title={tech.title}>
        <p className="muted small">{tech.ids}</p>
        <ul className="plain small">{test.technical.map((x) => <li key={x.id}><span className="mono">{x.id}</span> · {x.steps != null ? fill(tech.steps, { n: x.steps }) : ""} · {x.split}<div className="muted">{tech.author_note}: {x.description}</div></li>)}</ul>
      </TechnicalDetails>
    </article>
  );
}

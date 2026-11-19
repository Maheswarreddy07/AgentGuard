import { useEffect, useMemo, useState } from "react";
import { benchmarkApi, fill, paths, useApi, useAuth, useText } from "../api";
import { go } from "../router";
import EmptyState from "../components/EmptyState";
import { Card, State } from "../ui";

const POLL_MS = 400, POLL_MAX = 150;

/** Run Tests: choose tests, review exactly what will happen, run. The tests replay scripted situations; they never touch a real agent. */
export default function RunTests({ params = {} }) {
  const T = useText("tests"), t = T.run ?? {}, G = T.groups ?? {}, { allowed } = useAuth(), lib = useApi(paths.testLibrary);
  const [step, setStep] = useState(1), [picked, setPicked] = useState(null), [phase, setPhase] = useState("idle"), [err, setErr] = useState(null), [done, setDone] = useState(null);
  const tests = useMemo(() => (lib.data?.groups ?? []).flatMap((g) => g.tests.map((x) => ({ ...x, group: g.key }))), [lib.data]);
  useEffect(() => { if (lib.data && picked === null) setPicked(new Set((params.pick ?? "").split(",").filter((k) => tests.some((x) => x.key === k)))); }, [lib.data]); // eslint-disable-line
  if (!lib.data || picked === null) return <State loading={lib.loading} error={lib.error} h={240} onRetry={lib.reload} />;
  if (tests.length === 0) return <EmptyState icon="🧪" title={T.library?.none_title} />;
  const chosen = picked.size ? tests.filter((x) => picked.has(x.key)) : tests, cases = chosen.reduce((n, x) => n + x.n_cases, 0);
  const toggle = (keys, on) => setPicked((s) => { const n = new Set(s); keys.forEach((k) => (on ? n.add(k) : n.delete(k))); return n; });
  const can = allowed("run_benchmark");
  async function start() {
    setPhase("running"); setErr(null);
    try {
      const { run_id } = await benchmarkApi.run(chosen.flatMap((x) => x.scenario_ids));
      for (let i = 0; i < POLL_MAX; i++) {            // poll until the server reports a finished state; nothing is assumed
        const g = await benchmarkApi.get(run_id);
        if (g.status === "completed") { const s = await benchmarkApi.summary(run_id); setDone({ id: run_id, ...s }); setPhase("idle"); return; }
        if (g.status === "failed") throw new Error(g.error ?? "");
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      setErr(t.timeout); setPhase("error");
    } catch (e) { setErr(fill(t.failed, { error: e.message })); setPhase("error"); }
  }
  if (done) return (
    <div className="stack"><Card title={fill(t.done, { passed: done.passed, executed: done.executed })}>
      <div className="row"><button className="btn primary" onClick={() => go("/results", { run: done.id })}>{t.see}</button><button className="btn" onClick={() => { setDone(null); setStep(1); }}>{t.back}</button></div></Card></div>);
  return (
    <div className="stack">
      <p className="lead">{t.intro}</p>
      <ol className="steps-bar" aria-label={t.intro}>{[t.step1, t.step2, t.step3].map((l, i) => <li key={i} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""} aria-current={step === i + 1 ? "step" : undefined}>{l}</li>)}</ol>
      {step === 1 && <>
        <p className="muted">{t.step1_hint}</p>
        <div className="row"><button className="btn sm" onClick={() => toggle(tests.map((x) => x.key), true)}>{t.select_all}</button><button className="btn sm" onClick={() => setPicked(new Set())}>{t.clear}</button></div>
        {lib.data.groups.map((g) => { const keys = g.tests.map((x) => x.key), all = keys.every((k) => picked.has(k)); return (
          <fieldset key={g.key} className="pick-group"><legend><label className="check"><input type="checkbox" checked={all} onChange={(e) => toggle(keys, e.target.checked)} /> <b>{G[g.key]?.label}</b></label></legend>
            <ul className="plain">{g.tests.map((x) => <li key={x.key}><label className="check"><input type="checkbox" checked={picked.has(x.key)} onChange={(e) => toggle([x.key], e.target.checked)} /> {x.name} <span className="muted small">· {x.n_cases === 1 ? T.library?.cases_one : fill(T.library?.cases, { n: x.n_cases })}</span></label></li>)}</ul></fieldset>); })}
        <div className="row"><button className="btn primary" onClick={() => setStep(2)}>{t.next}</button></div>
      </>}
      {step >= 2 && <Card title={t.review_title}>
        <p>{picked.size ? fill(t.review_some, { tests: chosen.length, cases }) : fill(t.review_none, { cases })}</p>
        <div className="callout"><b>{t.safe_title}</b> {t.safe_body}</div>
        <div className="callout"><b>{t.synthetic_title}</b> {t.synthetic_body}</div>
        {!can && <p className="muted">{t.no_permission}</p>}
        {phase === "running" && <div className="progress" role="status" aria-label={t.running}><i /></div>}
        {err && <p role="alert" className="alert">{err}</p>}
        <div className="row"><button className="btn" disabled={phase === "running"} onClick={() => setStep(1)}>{t.back}</button>
          <button className="btn primary" disabled={!can || phase === "running"} onClick={() => { setStep(3); start(); }}>{phase === "running" ? t.running : t.start}</button></div>
      </Card>}
    </div>
  );
}

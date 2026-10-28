import argparse, csv, json
from pathlib import Path
from app.evaluation.generator import generate
from app.evaluation.runner import run_benchmark
from app.evaluation.scenario import load_scenarios

ROOT = Path(__file__).resolve().parents[3] / "benchmarks"

def main(argv=None):
    ap = argparse.ArgumentParser(prog="agentguard-bench")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate"); g.add_argument("--seed", type=int, default=0); g.add_argument("--out", type=Path, default=ROOT / "scenarios" / "v1")
    r = sub.add_parser("run"); r.add_argument("--scenarios", type=Path, default=ROOT / "scenarios"); r.add_argument("--ids"); r.add_argument("--seed", type=int, default=0)
    r.add_argument("--json", type=Path); r.add_argument("--csv", type=Path)
    a = ap.parse_args(argv)
    if a.cmd == "generate":
        print(f"generated {generate(a.out, a.seed)} scenarios -> {a.out}"); return
    sc = load_scenarios(a.scenarios, set(a.ids.split(",")) if a.ids else None)
    res = run_benchmark(sc, a.seed)
    if a.json: a.json.parent.mkdir(parents=True, exist_ok=True); a.json.write_text(json.dumps(res, indent=1))
    if a.csv:
        with a.csv.open("w", newline="") as f:
            w = csv.writer(f); w.writerow(["id", "category", "true", "pred", "true_step", "pred_step", "action", "expected_action", "baseline_success", "protected_success", "latency_ms"])
            for x in res["results"]: w.writerow([x["id"], x["category"], "|".join(x["true"]), "|".join(x["pred"]), x["true_step"], x["pred_step"], x["action"], x["expected_action"], x["baseline_success"], x["protected_success"], round(x["latency_ms"], 4)])
    m = res["metrics"]; print(json.dumps({k: m[k] for k in ("n_scenarios", "detection", "localization", "outcomes", "recovery", "unnecessary_intervention_rate", "latency_ms")}, indent=1))

if __name__ == "__main__":
    main()

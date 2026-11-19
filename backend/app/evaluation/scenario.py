import hashlib, json
import yaml
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field

class Labels(BaseModel):
    model_config = ConfigDict(extra="forbid")
    failure_categories: list[str] = Field(default_factory=list)
    earliest_detectable_step: int | None = None
    expected_action: str = "none"
    category_steps: dict[str, int] = Field(default_factory=dict)   # when each failure type first becomes detectable, if different from earliest_detectable_step

class Sim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    transient_fail_count: int = 0
    corrected_args_valid: bool = True
    evidence_available: bool = True

class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,80}$")
    category: str
    description: str
    task: str
    events: list[dict]       # the ONLY thing detectors see
    labels: Labels           # ground truth, never passed to detectors
    sim: Sim = Sim()         # used only by the simulated recovery executor
    split: str | None = None  # dev | validation | test (assigned deterministically from the id when absent)
    source: str | None = None  # builtin | custom | trace

SPLITS = ("dev", "validation", "test")
def split_of(sid: str) -> str:
    """Deterministic 60/20/20 split by hash of the id, so a scenario can never move between sets."""
    n = int(hashlib.sha256(sid.encode()).hexdigest(), 16) % 10
    return "dev" if n < 6 else "validation" if n < 8 else "test"

_IGNORED = {"event_id", "trace_id", "run_id", "timestamp"}
_SPLIT_RANK = {"dev": 0, "validation": 1, "test": 2}

def signature(sc: "Scenario") -> str:
    """What a scenario actually tests: its events (ids and clocks ignored) and its ground-truth labels. Two scenarios with the same signature are the same test."""
    body = [{k: v for k, v in e.items() if k not in _IGNORED} for e in sc.events]
    return hashlib.sha256(json.dumps([body, sc.labels.model_dump()], sort_keys=True, default=str).encode()).hexdigest()[:16]

def _unique(items: list["Scenario"]) -> tuple[list["Scenario"], dict]:
    """Keep one copy of every distinct built-in test. When the same test sits in several data splits the copy in the most 'seen' split is kept
    (dev, then validation, then test), so a held-out test scenario can never also be something the rules were tuned on."""
    builtin = [x for x in items if x.source == "builtin"]
    ranked = sorted(builtin, key=lambda x: (_SPLIT_RANK.get(x.split, 9), x.id)); seen: dict[str, "Scenario"] = {}; same_split = across_splits = 0
    for x in ranked:
        sig = signature(x)
        if sig in seen:
            if seen[sig].split == x.split: same_split += 1
            else: across_splits += 1
        else: seen[sig] = x
    keep = {x.id for x in seen.values()}
    return [x for x in items if x.source != "builtin" or x.id in keep], {"builtin_files": len(builtin), "builtin_unique": len(seen), "repeats_dropped": same_split, "dropped_for_split_leakage": across_splits}

def load_scenarios(root: Path, ids: set[str] | None = None, ws: int | None = None, split: str | None = None, unique: bool = True) -> list[Scenario]:
    """Built-in scenarios are shared. Custom scenarios live in <root>/custom/<workspace_id>/ and are only visible to that workspace.
    Repeated copies of the same built-in test are removed (`unique=True`), so counts reflect distinct tests."""
    def read(p: Path):
        return json.loads(p.read_text(encoding="utf-8")) if p.suffix == ".json" else yaml.safe_load(p.read_text(encoding="utf-8"))
    out = []
    for f in sorted(Path(root).rglob("*")):
        if f.suffix not in (".json", ".yaml", ".yml"): continue
        rel = f.relative_to(root).parts
        if rel[0] == "custom":
            owner = int(rel[1]) if len(rel) > 2 and rel[1].isdigit() else 1
            if ws is None or owner != ws: continue
        sc = Scenario.model_validate(read(f)); sc.source = sc.source or ("custom" if rel[0] == "custom" else "builtin"); sc.split = sc.split or split_of(sc.id)
        out.append(sc)
    if unique: out, _ = _unique(out)
    return [s for s in out if (not ids or s.id in ids) and (not split or s.split == split)]

def library_stats(root: Path) -> dict:
    """How many built-in files exist, how many are distinct tests, and why the rest were left out."""
    every = load_scenarios(root, unique=False); _, st = _unique(every)
    return {**st, "dataset": "synthetic-v1", "dataset_hash": hashlib.sha256("".join(sorted(signature(x) for x in load_scenarios(root))).encode()).hexdigest()[:12]}

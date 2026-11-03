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

def load_scenarios(root: Path, ids: set[str] | None = None, ws: int | None = None, split: str | None = None) -> list[Scenario]:
    """Built-in scenarios are shared. Custom scenarios live in <root>/custom/<workspace_id>/ and are only visible to that workspace."""
    def read(p: Path):
        return json.loads(p.read_text()) if p.suffix == ".json" else yaml.safe_load(p.read_text())
    out = []
    for f in sorted(Path(root).rglob("*")):
        if f.suffix not in (".json", ".yaml", ".yml"): continue
        rel = f.relative_to(root).parts
        if rel[0] == "custom":
            owner = int(rel[1]) if len(rel) > 2 and rel[1].isdigit() else 1
            if ws is None or owner != ws: continue
        sc = Scenario.model_validate(read(f)); sc.source = sc.source or ("custom" if rel[0] == "custom" else "builtin"); sc.split = sc.split or split_of(sc.id)
        out.append(sc)
    return [s for s in out if (not ids or s.id in ids) and (not split or s.split == split)]

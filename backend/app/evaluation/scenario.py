import json
import yaml
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field

class Labels(BaseModel):
    model_config = ConfigDict(extra="forbid")
    failure_categories: list[str] = Field(default_factory=list)
    earliest_detectable_step: int | None = None
    expected_action: str = "none"

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

def load_scenarios(root: Path, ids: set[str] | None = None) -> list[Scenario]:
    def read(p: Path):
        return json.loads(p.read_text()) if p.suffix == ".json" else yaml.safe_load(p.read_text())
    files = sorted(f for f in Path(root).rglob("*") if f.suffix in (".json", ".yaml", ".yml"))
    out = [Scenario.model_validate(read(p)) for p in files]
    return [s for s in out if not ids or s.id in ids]

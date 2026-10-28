"""Failure localization.

origin      : event where the problem was introduced (None if not determinable from evidence)
detectable  : earliest event at which any detector's evidence makes the problem observable
observed    : event where the failure was finally observed (last evidence event)
Returns resolved=False when there are no findings or evidence can't be ordered.
"""
from pydantic import BaseModel
from app.schemas.events import Event
from app.schemas.findings import Finding

class Localization(BaseModel):
    resolved: bool
    origin_event_id: str | None = None
    first_detectable_event_id: str | None = None
    observed_event_id: str | None = None
    first_detectable_step: int | None = None
    note: str = ""

def localize(events: list[Event], findings: list[Finding]) -> Localization:
    if not findings:
        return Localization(resolved=False, note="No findings; nothing to localize.")
    step = {e.event_id: e.step_index for e in events}
    by_id = {e.event_id: e for e in events}
    cand = []  # (detectable_step, detectable_id, finding)
    for f in findings:
        det = f.detectable_event_id or (f.evidence_event_ids[0] if f.evidence_event_ids else None)
        if det in step:
            cand.append((step[det], det, f))
    if not cand:
        return Localization(resolved=False, note="Findings reference unknown events.")
    cand.sort(key=lambda c: c[0])
    dstep, first, ff = cand[0]
    observed = max((i for f in findings for i in f.evidence_event_ids if i in step), key=lambda i: step[i])
    origin = ff.origin_event_id if ff.origin_event_id in step else None
    if origin is None:  # fall back to an explicit causal link only; never guess a root cause
        parent = by_id[first].parent_event_id
        origin = parent if parent in step else None
    return Localization(resolved=True, origin_event_id=origin, first_detectable_event_id=first, observed_event_id=observed,
                        first_detectable_step=dstep, note="" if origin else "Origin not determinable from recorded evidence.")

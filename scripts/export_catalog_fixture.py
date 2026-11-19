"""Writes frontend/src/test/catalog.json from the backend catalog, so UI tests use the real role/page/text data instead of a hand-copied one.
Run from the repo root:  python scripts/export_catalog_fixture.py"""
import json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(root / "backend"))
from app.catalog import ROLES, UI, access_for
out = {"access": {r["key"]: access_for(r["key"]) for r in ROLES}, "ui": UI, "roles": ROLES}
(root / "frontend/src/test/catalog.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
print("written", len(json.dumps(out)), "bytes")

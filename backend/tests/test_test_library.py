"""Test & Improve: the library groups real scenarios, last results come from real runs, and run summaries are counted from stored records."""
import pathlib, shutil
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.evaluation.scenario import load_scenarios
from app.services import test_library as tl

V1 = pathlib.Path(__file__).resolve().parents[2] / "benchmarks/scenarios/v1"
N = len(load_scenarios(V1))
EIGHT = {"normal", "incorrect", "repeated", "tools", "safety", "privacy", "security", "unexpected"}


@pytest.fixture
def c(tmp_path):
    d = tmp_path / "sc"; shutil.copytree(V1, d / "v1")
    return TestClient(create_app("sqlite:///:memory:", d))


def test_library_covers_every_scenario_once_and_uses_the_eight_groups(c):
    lib = c.get("/api/v1/tests/library").json()
    assert {g["key"] for g in lib["groups"]} <= EIGHT | {"custom"} and lib["kind"] == "synthetic"
    ids = [i for g in lib["groups"] for t in g["tests"] for i in t["scenario_ids"]]
    assert len(ids) == N == len(set(ids))                                  # nothing dropped, nothing counted twice
    assert all(t["name"] and t["summary"] and t["checks"] and t["expected"] for g in lib["groups"] for t in g["tests"])


def test_library_never_tells_the_user_a_result_that_was_not_recorded(c):
    lib = c.get("/api/v1/tests/library").json()
    assert all(t["last"] is None for g in lib["groups"] for t in g["tests"])        # nothing run yet = "not tested"
    run = c.post("/api/v1/benchmarks/run", json={"seed": 0}).json()["run_id"]
    results = c.get(f"/api/v1/benchmarks/{run}/results").json()["results"]
    lib = c.get("/api/v1/tests/library").json()
    tests = [t for g in lib["groups"] for t in g["tests"]]
    assert all(t["last"] and t["last"]["total"] == t["n_cases"] for t in tests)
    assert sum(t["last"]["passed"] for t in tests) == sum(tl.passed(x) for x in results)    # the library agrees with the stored records


def test_a_partial_run_only_marks_the_tests_it_covered(c):
    one = next(g["tests"][0] for g in c.get("/api/v1/tests/library").json()["groups"])
    run = c.post("/api/v1/benchmarks/run", json={"scenario_ids": one["scenario_ids"][:1]}).json()["run_id"]
    assert c.get(f"/api/v1/benchmarks/{run}").json()["status"] == "completed"
    tests = {t["key"]: t for g in c.get("/api/v1/tests/library").json()["groups"] for t in g["tests"]}
    assert tests[one["key"]]["last"]["total"] == 1
    assert sum(1 for t in tests.values() if t["last"]) == 1


def test_summary_is_counted_from_the_stored_run(c):
    assert c.get("/api/v1/benchmarks/nope/summary").status_code == 404
    run = c.post("/api/v1/benchmarks/run", json={"seed": 0}).json()["run_id"]
    s = c.get(f"/api/v1/benchmarks/{run}/summary").json(); res = c.get(f"/api/v1/benchmarks/{run}/results").json()["results"]
    assert s["executed"] == N == len(res) and s["passed"] + s["failed"] == s["executed"] and s["kind"] == "synthetic"
    assert s["passed"] == sum(tl.passed(x) for x in res) and len(s["failed_tests"]) == s["failed"]
    assert s["problems"]["of"] == sum(1 for x in res if x["true"]) and s["unnecessary_warnings"]["of"] == sum(1 for x in res if not x["true"])
    assert sum(v["total"] for v in s["by_group"].values()) == N and s["baseline_is_constructed"] is True
    assert s["dataset"]["kind"] == "synthetic" and s["versions"]["detector"]


def test_a_failed_run_has_no_summary(c):
    run = c.post("/api/v1/benchmarks/run", json={"scenario_ids": ["nope"]}).json()["run_id"]
    assert c.get(f"/api/v1/benchmarks/{run}/summary").status_code == 409


def test_custom_tests_stay_in_their_own_group(c):
    sc = c.get("/api/v1/scenarios/template").json(); sc["id"] = "mine-1"; sc["description"] = "Checks my own thing"
    assert c.post("/api/v1/scenarios", json=sc).status_code == 201
    groups = {g["key"]: g for g in c.get("/api/v1/tests/library").json()["groups"]}
    assert [t["scenario_ids"] for t in groups["custom"]["tests"]] == [["mine-1"]]
    assert all("mine-1" not in t["scenario_ids"] for k, g in groups.items() if k != "custom" for t in g["tests"])

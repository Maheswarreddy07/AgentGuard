// Opens every page as viewer, member and admin against a RUNNING backend and fails on crashes or load errors.
// Needs /tmp/smoke.json = { "tokens": { viewer, member, admin }, "trace": "<a trace id>" } and the API on http://127.0.0.1:8012.
// Run: cd frontend && SMOKE=1 npx vitest run scripts/smoke.test.jsx   (ONLY="/overview,/work" limits the routes)
import fs from "node:fs";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { setToken } from "../src/api";
import App from "../src/App";

const HAVE = process.env.SMOKE === "1" && fs.existsSync("/tmp/smoke.json"), { tokens, trace } = HAVE ? JSON.parse(fs.readFileSync("/tmp/smoke.json", "utf8")) : { tokens: {}, trace: "" }, BASE = "http://127.0.0.1:8012", real = globalThis.fetch;
const ROUTES = (process.env.ONLY ? process.env.ONLY.split(",") : ["/overview", "/admin", "/agents", "/traces", "/problems", "/risk", "/policies", "/approvals", "/history", "/scenarios", "/run-tests", "/results", "/integrations", "/integrations?way=try", "/integrations?way=mine", "/integrations?way=dev", "/settings", "/settings?tab=keys", "/settings?tab=team", "/traces/" + trace]);
beforeEach(() => { globalThis.fetch = (u, i) => real(String(u).startsWith("/") ? BASE + u : u, i); });
afterEach(cleanup);
for (const role of ["viewer", "member", "admin"]) {
  (HAVE ? test : test.skip)(`every page renders without errors for a ${role}`, async () => {
    const problems = [], warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const r of ROUTES) {
      cleanup(); setToken(tokens[role]); window.location.hash = "#" + r; const { container, unmount } = render(<App />);
      await waitFor(() => expect(container.querySelector("main .page-h, main .empty, main .alert, .auth-card")).toBeTruthy(), { timeout: 8000 }).catch(() => problems.push(r + " never rendered"));
      await new Promise((ok) => setTimeout(ok, 900));            // let staged sections and data arrive
      const text = container.textContent;
      if (container.querySelector(".crash")) problems.push(r + " CRASHED: " + container.querySelector(".crash").textContent.slice(0, 200));
      else if (/Something went wrong:/.test(text) && !/needs the/.test(text)) problems.push(r + " load error: " + text.match(/Something went wrong:.{0,80}/)?.[0]);
      if (/undefined|NaN|\[object/.test(text)) problems.push(r + " shows raw junk: " + text.match(/.{0,40}(undefined|NaN|\[object).{0,30}/)?.[0]);
      unmount();
    }
    const missingWording = [...new Set(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith("Missing wording")))]; if (missingWording.length) problems.push("CRASHED missing wording: " + missingWording.join("; "));
    console.log(role, "->", problems.length ? problems.join("\n") : "all " + ROUTES.length + " routes OK");
    expect(problems.filter((p) => /CRASHED|never rendered/.test(p))).toEqual([]);
  }, 120000);
}

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(SRC), read = (p) => readFileSync(p, "utf8");
const inDir = (dir) => files.filter((f) => f.startsWith(join(SRC, dir)) && /\.jsx?$/.test(f));

test("the frontend is plain JavaScript: no TypeScript files, types or interfaces", () => {
  expect(files.filter((f) => /\.tsx?$/.test(f))).toEqual([]);
  for (const f of files.filter((f) => /\.jsx?$/.test(f) && !f.includes("/test/"))) expect(read(f), f).not.toMatch(/^\s*(interface|type)\s+\w+\s*(=|\{)/m);
});

test("only the API layer talks to the backend: components and pages contain no URLs or fetch calls", () => {
  for (const f of [...inDir("components"), ...inDir("pages"), join(SRC, "App.jsx"), join(SRC, "ui.jsx")]) {
    const src = read(f);
    expect(src, f).not.toMatch(/\/api\/v1|fetch\(/);
  }
  expect(files.filter((f) => /fetch\(/.test(read(f)) && !f.includes("/test/")).map((f) => f.replace(SRC, ""))).toEqual(["/api/client.js"]);
});

test("components are presentational: they never import the API layer", () => {
  for (const f of inDir("components")) expect(read(f), f).not.toMatch(/from "\.\.\/api(\/|")/);
});

test("every required reusable component exists", () => {
  const need = ["TopNav", "PageHeader", "HealthSummary", "AgentCard", "ProblemCard", "ProblemDetails", "ActivityTimeline", "SafetyRuleCard", "ApprovalCard", "TestCard", "BenchmarkComparison", "EmptyState", "LoadingState", "TechnicalDetails", "IntegrationWizard"];
  const have = readdirSync(join(SRC, "components")).map((f) => f.replace(".jsx", ""));
  expect(need.filter((n) => !have.includes(n))).toEqual([]);
});

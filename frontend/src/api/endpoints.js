// Every backend endpoint the UI uses, in one place. Components never build URLs or call fetch.
import { api } from "./client";

const qs = (o = {}) => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v != null && v !== undefined)).toString(); return s ? "?" + s : ""; };
const send = (method) => (path, body) => api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const post = send("POST"), put = send("PUT"), patch = send("PATCH"), del = send("DELETE");
const id = encodeURIComponent;

/** URL builders for read-only data, used with the useApi() hook. Pass null to skip a request. */
export const paths = {
  health: "/health", meta: "/api/v1/meta", settings: "/api/v1/settings",
  overview: (f) => "/api/v1/metrics/overview" + qs(f), trends: "/api/v1/metrics/trends",
  traces: (f) => "/api/v1/traces" + qs(f), facets: "/api/v1/traces/facets", trace: (t) => `/api/v1/traces/${id(t)}`, analysis: (t) => `/api/v1/traces/${id(t)}/analysis`, recoveryPlan: (t) => `/api/v1/traces/${id(t)}/recovery-plan`,
  findings: (f) => "/api/v1/findings" + qs(f), finding: (fid) => `/api/v1/findings/${id(fid)}`,
  agents: "/api/v1/agents",
  riskMetrics: "/api/v1/risk/metrics", riskMonitor: (f) => "/api/v1/risk/monitor" + qs(f), riskPredictions: (f) => "/api/v1/risk/predictions" + qs(f),
  policies: "/api/v1/policies", policy: (p) => `/api/v1/policies/${p}`, policyTemplates: "/api/v1/policies/templates", policyEvaluations: (f) => "/api/v1/policies/evaluations" + qs(f),
  approvals: (f) => "/api/v1/approvals" + qs(f), approval: (a) => `/api/v1/approvals/${a}`,
  scenarios: (f) => "/api/v1/scenarios" + qs(f), scenario: (s) => `/api/v1/scenarios/${id(s)}`, scenarioTemplate: "/api/v1/scenarios/template",
  benchmarks: "/api/v1/benchmarks", benchmark: (r) => `/api/v1/benchmarks/${r}`, benchmarkResults: (r, only) => `/api/v1/benchmarks/${r}/results` + qs({ only }), benchmarkCompare: (a, b) => `/api/v1/benchmark-compare${qs({ a, b })}`,
  activity: (f) => "/api/v1/history/activity" + qs(f), benchmarkHistory: "/api/v1/history/benchmarks",
  users: "/api/v1/users", apiKeys: "/api/v1/api-keys", workspace: "/api/v1/workspaces/current",
};

export const authApi = {
  status: () => api("/api/v1/auth/status"), me: () => api("/api/v1/auth/me"), logout: () => post("/api/v1/auth/logout"),
  login: (email, password) => post("/api/v1/auth/login", { email, password }), setup: (email, password, name) => post("/api/v1/auth/setup", { email, password, name }),
  changePassword: (current_password, new_password) => post("/api/v1/auth/change-password", { current_password, new_password }),
};
export const demoApi = { seed: () => post("/api/v1/demo/seed") };
export const runApi = {
  recover: (traceId, sim) => post(`/api/v1/traces/${id(traceId)}/recover`, { sim }),
  analyze: (traceId) => post(`/api/v1/traces/${id(traceId)}/analyze`),
};
export const agentApi = { register: (name, description = "", environment = "production") => post("/api/v1/agents", { name, description, environment }) };
export const policyApi = {
  create: (body) => post("/api/v1/policies", body), update: (pid, body) => put(`/api/v1/policies/${pid}`, body),
  toggle: (pid, enabled) => post(`/api/v1/policies/${pid}/toggle`, { enabled }), rollback: (pid, version) => post(`/api/v1/policies/${pid}/rollback`, { version }),
  test: (definition, context) => post("/api/v1/policies/test", { definition, context }), simulate: (definition) => post("/api/v1/policies/simulate", { definition }),
};
export const approvalApi = { decide: (aid, decision, note) => post(`/api/v1/approvals/${aid}/decision`, { decision, note }) };
export const scenarioApi = { add: (jsonText) => api("/api/v1/scenarios", { method: "POST", body: jsonText }) };
export const benchmarkApi = {
  run: (scenario_ids, split) => post("/api/v1/benchmarks/run", { scenario_ids, split: split || undefined }), get: (rid) => api(paths.benchmark(rid)),
  results: (rid, only) => api(paths.benchmarkResults(rid, only)), compare: (a, b) => api(paths.benchmarkCompare(a, b)),
};
export const historyApi = { activity: (f) => api(paths.activity(f)) };
export const settingsApi = { save: (values, disabled_rules) => put("/api/v1/settings", { values, disabled_rules }), cleanup: () => post("/api/v1/settings/cleanup") };
export const teamApi = {
  createUser: (body) => post("/api/v1/users", body), updateUser: (uid, body) => patch(`/api/v1/users/${uid}`, body), resetPassword: (uid, new_password) => post(`/api/v1/users/${uid}/reset-password`, { new_password }),
  createKey: (name) => post("/api/v1/api-keys", { name }), rotateKey: (kid) => post(`/api/v1/api-keys/${kid}/rotate`), revokeKey: (kid) => del(`/api/v1/api-keys/${kid}`),
};

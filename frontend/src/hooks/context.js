import { createContext, useContext } from "react";
const EMPTY_META = { categories: {}, metrics: {}, actions: {}, severities: [], severity_colors: {}, roles: [], modes: {}, policy_actions: {} };
export const MetaCtx = createContext(EMPTY_META);
export const useMeta = () => useContext(MetaCtx);
export const AuthCtx = createContext({ user: null, can: () => true, logout: () => {}, authRequired: false });
export const useAuth = () => useContext(AuthCtx);
export const catLabel = (meta, k) => meta.categories?.[k]?.label ?? String(k).replace(/_/g, " ");
export const roleLabel = (meta, k) => meta.roles?.find((r) => r.key === k)?.label ?? k;

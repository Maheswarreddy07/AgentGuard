// Moves the wording out of the React code into the backend (backend/app/ui_strings.json) and replaces it with txt("key") lookups.
// Developer tool: run it again whenever you add a screen with wording written straight into the JSX.
//   node scripts/extract-text.mjs            (does it)      node scripts/extract-text.mjs --dry   (only reports)
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;
const SRC = path.resolve("src"), OUT = path.resolve("../backend/app/ui_strings.json"), DRY = process.argv.includes("--dry");
const TEXT_ATTRS = new Set(["title", "placeholder", "aria-label", "label", "alt", "sub", "hint", "caption", "text", "legend", "summary", "description", "tip", "message"]);
const SKIP = new Set(["config", "test", "hooks", "api"]);
const hasLetters = (s) => /\p{L}/u.test(s);
const isComponentName = (n) => /^[A-Z]/.test(n ?? "");
const slug = (text) => { const s = text.replace(/\{(\w+)\}/g, "$1").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").split("_").slice(0, 5).join("_").slice(0, 48); return s || "text"; };
const strings = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const unresolved = [];
let total = 0;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? (SKIP.has(d.name) ? [] : files(path.join(dir, d.name))) : d.name.endsWith(".jsx") ? [path.join(dir, d.name)] : []);
}
const nsOf = (file) => path.basename(file, ".jsx").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();

function simpleName(node) {          // a plain variable or property path, e.g. count, a.b, a?.b.c
  if (node.type === "Identifier") return node.name;
  if ((node.type === "MemberExpression" || node.type === "OptionalMemberExpression") && !node.computed && node.property.type === "Identifier" && simpleName(node.object)) return node.property.name;
  return null;
}

for (const file of files(SRC)) {
  const code = fs.readFileSync(file, "utf8"), ns = nsOf(file), rel = path.relative(SRC, file).includes(path.sep) ? "../hooks/context" : "./hooks/context";
  const ast = parse(code, { sourceType: "module", plugins: ["jsx"] }), edits = [], comps = new Map();
  const dict = (strings[ns] ??= {}), byText = new Map(Object.entries(dict).map(([k, v]) => [v, k]));
  const keyFor = (text) => {
    if (byText.has(text)) return byText.get(text);
    let k = slug(text), n = 2; while (dict[k] !== undefined) k = slug(text) + "_" + n++;
    dict[k] = text; byText.set(text, k); return k;
  };
  const componentOf = (p) => {
    for (let q = p; q; q = q.parentPath) {
      const n = q.node;
      if (n.type === "FunctionDeclaration" && isComponentName(n.id?.name)) return { node: n, name: n.id.name };
      if ((n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression") && q.parent.type === "VariableDeclarator" && isComponentName(q.parent.id?.name)) return { node: n, name: q.parent.id.name };
    }
    return null;
  };
  const note = (p, text) => unresolved.push(`${path.relative(SRC, file)}:${p.node.loc.start.line}  ${text.slice(0, 70)}`);
  const claim = (p, node, text, vars) => {
    const comp = componentOf(p);
    if (!comp || comp.node.body.type !== "BlockStatement") return note(p, text);
    comps.set(comp.node, comp);
    const call = `txt(${JSON.stringify(keyFor(text))}${vars.length ? `, { ${vars.map(([n, src]) => (n === src ? n : `${n}: ${src}`)).join(", ")} }` : ""})`;
    edits.push({ start: node.start, end: node.end, text: call, wrap: false }); total++;
  };
  // a template literal or string whose words should move to the server; returns [text, vars] or null
  function templateOf(node) {
    if (node.type === "StringLiteral") return hasLetters(node.value) ? [node.value, []] : null;
    if (node.type !== "TemplateLiteral") return null;
    const vars = [], used = new Set(); let text = "";
    for (let i = 0; i < node.quasis.length; i++) {
      text += node.quasis[i].value.cooked;
      if (i < node.expressions.length) {
        const e = node.expressions[i]; let name = simpleName(e) ?? `v${vars.length + 1}`; while (used.has(name)) name += "_"; used.add(name);
        vars.push([name, code.slice(e.start, e.end)]); text += `{${name}}`;
      }
    }
    return hasLetters(node.quasis.map((q) => q.value.cooked).join("")) ? [text, vars] : null;
  }
  function convertExpr(p, node) {      // string/template literals shown to people, also inside ?: and &&
    if (node.type === "ConditionalExpression") { convertExpr(p, node.consequent); convertExpr(p, node.alternate); return; }
    if (node.type === "LogicalExpression") { convertExpr(p, node.right); if (node.operator !== "&&") convertExpr(p, node.left); return; }
    const t = templateOf(node); if (t) claim(p, node, t[0], t[1]);
  }

  traverse(ast, {
    JSXElement(p) { runs(p, p.node.children); }, JSXFragment(p) { runs(p, p.node.children); },
    JSXAttribute(p) {
      const n = p.node; if (n.name.type !== "JSXIdentifier" || !TEXT_ATTRS.has(n.name.name) || !n.value) return;
      if (n.value.type === "StringLiteral") { if (hasLetters(n.value.value)) { const comp = componentOf(p); if (!comp || comp.node.body.type !== "BlockStatement") return note(p, n.value.value); comps.set(comp.node, comp); edits.push({ start: n.value.start, end: n.value.end, text: `{txt(${JSON.stringify(keyFor(n.value.value))})}` }); total++; } }
      else if (n.value.type === "JSXExpressionContainer") convertExpr(p, n.value.expression);
    },
    CallExpression(p) {
      const c = p.node.callee; if (c.type === "Identifier" && c.name === "toast" && p.node.arguments[0]) convertExpr(p, p.node.arguments[0]);
    },
  });

  function runs(p, children) {
    let run = [];
    const flush = () => {
      const r = run; run = [];
      const texts = r.filter((c) => c.type === "JSXText"); if (!texts.some((c) => hasLetters(c.value))) return;
      let a = 0, b = r.length - 1;
      while (a <= b && r[a].type === "JSXText" && !r[a].value.trim()) a++;
      while (b >= a && r[b].type === "JSXText" && !r[b].value.trim()) b--;
      if (a > b) return;
      const used = new Set(), vars = []; let text = "";
      for (let i = a; i <= b; i++) {
        const c = r[i];
        if (c.type === "JSXText") text += c.value.replace(/\s*\n\s*/g, " ");
        else { let name = simpleName(c.expression); while (used.has(name)) name += "_"; used.add(name); vars.push([name, code.slice(c.expression.start, c.expression.end)]); text += `{${name}}`; }
      }
      text = text.replace(/\s+/g, " ").trim();
      const first = r[a], last = r[b];
      const start = first.type === "JSXText" ? first.start + (first.value.length - first.value.trimStart().length === 0 ? 0 : code.slice(first.start, first.end).search(/\S/)) : first.start;
      const end = last.type === "JSXText" ? last.start + code.slice(last.start, last.end).trimEnd().length : last.end;
      const comp = componentOf(p); if (!comp || comp.node.body.type !== "BlockStatement") return note(p, text);
      comps.set(comp.node, comp);
      edits.push({ start, end, text: `{txt(${JSON.stringify(keyFor(text))}${vars.length ? `, { ${vars.map(([n, s]) => (n === s ? n : `${n}: ${s}`)).join(", ")} }` : ""})}` }); total++;
    };
    for (const c of children) {
      if (c.type === "JSXText" || (c.type === "JSXExpressionContainer" && c.expression.type !== "JSXEmptyExpression" && simpleName(c.expression))) run.push(c);
      else { flush(); if (c.type === "JSXExpressionContainer" && c.expression.type !== "JSXEmptyExpression") convertExpr(p, c.expression); }
    }
    flush();
  }

  if (!edits.length) continue;
  let out = code;
  const inject = [...comps.values()].map((c) => ({ pos: c.node.body.start + 1, text: `\n  const txt = useT(${JSON.stringify(ns)});` }));
  // expression edits that are bare calls (not attributes/children) need to stay valid JS: they replace a literal inside an expression, so no braces needed
  for (const e of [...edits, ...inject.map((i) => ({ start: i.pos, end: i.pos, text: i.text }))].sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const lastImport = [...out.matchAll(/^import .*$/gm)].pop();
  const at = lastImport ? lastImport.index + lastImport[0].length : 0;
  out = out.slice(0, at) + `\nimport { useT } from "${rel}";` + out.slice(at);
  if (!DRY) fs.writeFileSync(file, out);
}
if (!DRY) fs.writeFileSync(OUT, JSON.stringify(strings, null, 1) + "\n");
console.log(`${DRY ? "would move" : "moved"} ${total} pieces of wording; ${unresolved.length} need a manual look:`);
for (const u of unresolved) console.log("  " + u);

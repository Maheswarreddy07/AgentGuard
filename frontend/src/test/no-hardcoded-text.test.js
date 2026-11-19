// Guard: no sentence may be written straight into the screens. Wording lives in the backend (backend/app/ui_strings.json and catalog.py)
// and is read with useT()/useText(). If this fails, run `npm run extract-text` (it moves the new wording out for you).
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;
const SRC = path.resolve(__dirname, ".."), SKIP = new Set(["test", "config"]);
const TEXT_ATTRS = new Set(["title", "placeholder", "aria-label", "label", "alt", "sub", "hint", "caption", "text", "legend", "summary", "description", "tip", "message"]);
const letters = (s) => /\p{L}/u.test(s);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (SKIP.has(e.name) ? [] : walk(path.join(d, e.name))) : /\.jsx$/.test(e.name) ? [path.join(d, e.name)] : []);

test("no wording is hardcoded in the screens", () => {
  const found = [];
  for (const file of walk(SRC)) {
    const ast = parse(fs.readFileSync(file, "utf8"), { sourceType: "module", plugins: ["jsx"] }), at = (n) => `${path.relative(SRC, file)}:${n.loc.start.line}`;
    traverse(ast, {
      JSXText(p) { if (letters(p.node.value)) found.push(`${at(p.node)} text "${p.node.value.trim().slice(0, 50)}"`); },
      JSXAttribute(p) { const n = p.node; if (n.name.type === "JSXIdentifier" && TEXT_ATTRS.has(n.name.name) && n.value?.type === "StringLiteral" && letters(n.value.value)) found.push(`${at(n)} ${n.name.name}="${n.value.value.slice(0, 40)}"`); },
      CallExpression(p) { const n = p.node, a = n.arguments[0]; if (n.callee.type === "Identifier" && n.callee.name === "toast" && a && (a.type === "StringLiteral" || a.type === "TemplateLiteral")) found.push(`${at(n)} toast(literal)`); },
    });
  }
  expect(found).toEqual([]);
});

test("every txt() call has txt defined in its component (no missing useT)", () => {
  const missing = [];
  for (const file of walk(SRC)) {
    const ast = parse(fs.readFileSync(file, "utf8"), { sourceType: "module", plugins: ["jsx"] });
    traverse(ast, { Identifier(p) { if ((p.node.name === "txt" || p.node.name === "useT") && p.isReferencedIdentifier() && !p.scope.hasBinding(p.node.name)) missing.push(`${path.relative(SRC, file)}:${p.node.loc.start.line}`); } });
  }
  expect(missing).toEqual([]);
});

test("every wording key the screens ask for exists on the server", () => {
  const strings = JSON.parse(fs.readFileSync(path.resolve(SRC, "test/catalog.json"), "utf8")).ui.strings, absent = [];
  for (const file of walk(SRC)) {
    const code = fs.readFileSync(file, "utf8"), ns = [...code.matchAll(/useT\("([a-z_]+)"\)/g)].map((m) => m[1]);
    for (const m of code.matchAll(/\btxt\("([a-z0-9_]+)"/g)) if (!ns.some((n) => strings[n]?.[m[1]] !== undefined)) absent.push(`${path.relative(SRC, file)} ${m[1]}`);
  }
  expect(absent).toEqual([]);
});

test("no screen uses a variable that is not defined (a crash waiting to happen)", () => {
  const GLOBALS = new Set(["window", "document", "console", "localStorage", "sessionStorage", "fetch", "URL", "URLSearchParams", "Blob", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Event", "IntersectionObserver", "Math", "JSON", "Number", "String", "Object", "Array", "Set", "Map", "Promise", "Date", "Error", "undefined", "NaN", "Infinity", "Intl", "encodeURIComponent", "decodeURIComponent", "parseInt", "parseFloat", "isNaN", "Boolean", "RegExp", "Symbol", "navigator", "location", "requestAnimationFrame", "cancelAnimationFrame", "FormData", "File", "FileReader", "AbortController", "CSS", "getComputedStyle", "matchMedia", "alert", "confirm", "history"]);
  const bad = [];
  for (const file of [...walk(SRC), ...fs.readdirSync(SRC).filter((f) => /\.jsx?$/.test(f)).map((f) => path.join(SRC, f))]) {
    const ast = parse(fs.readFileSync(file, "utf8"), { sourceType: "module", plugins: ["jsx"] });
    traverse(ast, { ReferencedIdentifier(p) { const n = p.node.name; if (p.node.type === "JSXIdentifier" && !/^[A-Z]/.test(n)) return; if (!p.scope.hasBinding(n) && !GLOBALS.has(n)) bad.push(`${path.relative(SRC, file)}:${p.node.loc.start.line} ${n}`); } });
  }
  expect([...new Set(bad)]).toEqual([]);
});

test("the top menu and the detail panels never share CSS class names (a clash once made every detail panel invisible)", () => {
  const menu = fs.readFileSync(path.join(SRC, "components/TopNav.jsx"), "utf8"), ui = fs.readFileSync(path.join(SRC, "ui.jsx"), "utf8");
  for (const cls of ["drawer", "drawer-wrap", "drawer-h", "drawer-b"]) expect(menu).not.toMatch(new RegExp(`["' ]${cls}["' ]`));
  for (const cls of ["menu-panel", "topbar", "burger"]) expect(ui).not.toMatch(new RegExp(`["' ]${cls}["' ]`));
  const css = fs.readFileSync(path.join(SRC, "styles.css"), "utf8");
  expect(css).not.toMatch(/\.drawer\{position:fixed/);        // the old detail-panel class must keep its own layout
});

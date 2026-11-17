// #4452: the form builder's live preview runs forms-kit.js in a sandboxed srcdoc
// iframe, where `process` does not exist. The bundle once still held
// `process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL`, so it threw
// "ReferenceError: process is not defined" and the kit never rendered.
//
// FAILS-ON-REVERT: dropping the FUNCTIONS_URL / `process.env` define from
// scripts/build-forms-kit.mjs fails this test (the kit throws, or the build
// guard exits 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ADMIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLE = path.join(ADMIN, "public", "forms-kit", "forms-kit.js");

function stubNode(doc) {
  const node = {
    nodeType: 1, style: {}, dataset: {}, childNodes: [], children: [], ownerDocument: doc,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.childNodes.push(c); return c; }, removeChild(c) { return c; },
    insertBefore(c) { this.childNodes.push(c); return c; }, replaceChild(c) { return c; },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }), focus() {}, blur() {}, contains: () => false,
  };
  return node;
}

test("forms-kit.js has no process reference and runs in a bare sandbox without a ReferenceError", async () => {
  // The build runs the kit script (and its own process.env guard).
  const built = spawnSync("node", ["scripts/build-forms-kit.mjs"], { cwd: ADMIN, encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  const code = fs.readFileSync(BUNDLE, "utf8");
  // React reads `process.emit` only behind a typeof guard; nothing else may touch process.
  assert.doesNotMatch(code, /process\.env|(?<![\w$.])process\.(?!emit\b)/);

  const posted = [];
  const doc = { nodeType: 9, readyState: "complete", activeElement: null };
  Object.assign(doc, stubNode(doc), { nodeType: 9 });
  const kit = stubNode(doc);
  doc.body = stubNode(doc); doc.head = stubNode(doc); doc.documentElement = stubNode(doc);
  doc.getElementById = (id) => (id === "kit" ? kit : null);
  doc.createElement = () => stubNode(doc); doc.createElementNS = () => stubNode(doc);
  doc.createTextNode = () => stubNode(doc); doc.createComment = () => stubNode(doc);
  // Track every timer the kit starts so none outlives the test.
  const timers = new Set();
  const track = (fn) => (...a) => { const t = fn(...a); timers.add(t); return t; };
  const trackedTimeout = track(setTimeout), trackedInterval = track(setInterval);
  const win = {
    document: doc, parent: { postMessage: (m) => posted.push(m) },
    addEventListener() {}, removeEventListener() {}, location: { href: "about:srcdoc", search: "", hash: "", pathname: "/" },
    navigator: { userAgent: "node" }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }), requestAnimationFrame: (f) => trackedTimeout(f, 0), cancelAnimationFrame: clearTimeout,
    setTimeout: trackedTimeout, clearTimeout, setInterval: trackedInterval, clearInterval, console, innerWidth: 800, innerHeight: 600, scrollTo() {},
    HTMLElement: function HTMLElement() {}, Node: function Node() {}, Element: function Element() {},
    HTMLIFrameElement: function HTMLIFrameElement() {}, queueMicrotask,
  };
  win.window = win; win.self = win; win.globalThis = win; doc.defaultView = win;
  const ctx = vm.createContext(win);

  let thrown = null;
  try { vm.runInContext(code, ctx); } catch (e) { thrown = e; }
  // Errors are matched by name: the error object comes from another vm realm.
  assert.equal(thrown && thrown.name, null, `forms-kit.js threw ${thrown && thrown.name}: ${thrown && thrown.message}`);

  // Let React mount and run its effect.
  await new Promise((r) => setTimeout(r, 200));
  for (const t of timers) { clearTimeout(t); clearInterval(t); }
  assert.ok(posted.some((m) => m && m.type === "mingla-forms-kit-ready"), `kit never posted ready (posted: ${JSON.stringify(posted)})`);
});

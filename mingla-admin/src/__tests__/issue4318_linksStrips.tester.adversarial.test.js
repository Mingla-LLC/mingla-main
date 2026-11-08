// #4318 — Support › Links page: independent tester adversarial proof.
//
// The implementor suite reads the rule module and the panel's source. This
// suite RUNS the real panel: LinksPagePanel.jsx is bundled with the real
// service module, the real rules and the real UI kit, mounted with
// react-dom/client into a small in-memory DOM, and driven by clicks, typing,
// select changes and drag-and-drop. Only the Supabase client (the network)
// and the toast context are replaced by recorders.
//
//   A-1 reorder: a failure mid-flight puts the old order back, a second move
//       cannot start while one is in flight, drag-and-drop rolls back too
//   A-2 a stale order (PT409) reloads the server's list; other failures do not
//   A-3 save validation: nothing reaches the server for an invalid draft
//       (whitespace of every kind, 61 characters, script links); no strip
//       carries a city (#4318 addendum 2 A); a server refusal is explained without blaming the
//       connection; the client's web-link rule never passes a link the server
//       refuses
//   A-4 blog title prefill never overwrites a typed title, drafts are never
//       offered, and a long post title is cut to 60
//   A-5 strips are not by city: the panel offers no city and the old
//       admin city list is gone (#4318 addendum 2 A, Seth)
//   A-6 removing a strip needs a second, explicit confirm
//
// It needs the admin app's packages (react, react-dom, esbuild, lucide-react):
// run `npm ci` in mingla-admin first. Without them it FAILS; it never skips.

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateStripDraft } from "../lib/linksStrips.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");

// ── A small DOM: just enough of the platform for react-dom/client ──────────
class FakeNode {
  constructor(doc, nodeType, nodeName) {
    this.ownerDocument = doc;
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.childNodes = [];
    this.parentNode = null;
    this._listeners = new Map();
  }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, ref) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(child); else this.childNodes.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }
  contains(node) {
    for (let cur = node; cur; cur = cur.parentNode) if (cur === this) return true;
    return false;
  }
  get textContent() {
    if (this.nodeType === 3 || this.nodeType === 8) return this.nodeValue;
    return this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(text) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    if (text !== "" && text != null) this.appendChild(this.ownerDocument.createTextNode(String(text)));
  }
  addEventListener(type, fn, options) {
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const key = `${type}:${capture}`;
    if (!this._listeners.has(key)) this._listeners.set(key, new Set());
    this._listeners.get(key).add(fn);
  }
  removeEventListener(type, fn, options) {
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    this._listeners.get(`${type}:${capture}`)?.delete(fn);
  }
  _fire(event, capture) {
    const set = this._listeners.get(`${event.type}:${capture}`);
    if (!set) return;
    event.currentTarget = this;
    for (const fn of [...set]) fn.call(this, event);
  }
  dispatchEvent(event) {
    event.target = this;
    const pathUp = [];
    for (let cur = this; cur; cur = cur.parentNode) pathUp.push(cur);
    for (const node of [...pathUp].reverse()) { if (event._stopped) break; event.eventPhase = 1; node._fire(event, true); }
    for (const node of pathUp) { if (event._stopped || (!event.bubbles && node !== this)) break; event.eventPhase = 3; node._fire(event, false); }
    return !event.defaultPrevented;
  }
}

class FakeText extends FakeNode {
  constructor(doc, text) { super(doc, 3, "#text"); this.nodeValue = text; }
  get data() { return this.nodeValue; }
  set data(value) { this.nodeValue = value; }
}

class FakeElement extends FakeNode {
  constructor(doc, tag, namespaceURI = "http://www.w3.org/1999/xhtml") {
    super(doc, 1, tag.toUpperCase());
    this.tagName = this.nodeName;
    this.localName = tag;
    this.namespaceURI = namespaceURI;
    this._attrs = new Map();
    const style = {};
    Object.defineProperty(style, "setProperty", { value: (k, v) => { style[k] = v; } });
    Object.defineProperty(style, "removeProperty", { value: (k) => { delete style[k]; } });
    this.style = style;
    this.disabled = false;
    this.checked = false;
    this.selected = false;
    this._value = undefined;
  }
  setAttribute(name, value) {
    this._attrs.set(name, String(value));
    if (name === "disabled") this.disabled = true;
  }
  getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; }
  hasAttribute(name) { return this._attrs.has(name); }
  removeAttribute(name) {
    this._attrs.delete(name);
    if (name === "disabled") this.disabled = false;
  }
  setAttributeNS(_ns, name, value) { this.setAttribute(name, value); }
  removeAttributeNS(_ns, name) { this.removeAttribute(name); }
  get children() { return this.childNodes.filter((child) => child.nodeType === 1); }
  get options() { return this.descendants().filter((el) => el.localName === "option"); }
  get value() {
    if (this.localName === "select") {
      const chosen = this.options.find((option) => option.selected) || this.options[0];
      return chosen ? chosen.value : "";
    }
    if (this.localName === "option") return this._value ?? this.getAttribute("value") ?? this.textContent;
    return this._value ?? this.getAttribute("value") ?? "";
  }
  set value(next) {
    if (this.localName === "select") {
      for (const option of this.options) option.selected = option.value === String(next);
      return;
    }
    this._value = String(next);
  }
  get type() { return this.getAttribute("type") || (this.localName === "button" ? "submit" : "text"); }
  set type(value) { this.setAttribute("type", value); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  click() { return this.dispatchEvent(makeEvent("click")); }
  descendants() {
    const out = [];
    const walk = (node) => { for (const child of node.childNodes) if (child.nodeType === 1) { out.push(child); walk(child); } };
    walk(this);
    return out;
  }
  querySelectorAll(selector) { return this.descendants().filter((el) => matches(el, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let cur = this; cur && cur.nodeType === 1; cur = cur.parentNode) if (matches(cur, selector)) return cur;
    return null;
  }
}

// Attribute selectors with an optional tag and :not([attr]) — all the panel uses.
function matches(el, selector) {
  let rest = selector.trim();
  const tag = rest.match(/^[a-z]+/i);
  if (tag) {
    if (el.localName !== tag[0].toLowerCase()) return false;
    rest = rest.slice(tag[0].length);
  }
  const parts = [...rest.matchAll(/(:not\()?\[([\w-]+)(?:="([^"]*)")?\]\)?/g)];
  // react-dom sets some attributes as properties (an input's name, for one).
  const read = (name) => (el.hasAttribute(name) ? el.getAttribute(name) : el[name] != null ? String(el[name]) : null);
  return parts.every(([, negate, name, value]) => {
    const has = name === "disabled" ? el.disabled : read(name) !== null;
    const ok = value === undefined ? has : read(name) === value;
    return negate ? !ok : ok;
  });
}

function makeEvent(type, extra = {}) {
  return {
    type, bubbles: true, cancelable: true, defaultPrevented: false, isTrusted: true, timeStamp: Date.now(),
    eventPhase: 0, _stopped: false, target: null, currentTarget: null,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopped = true; },
    stopImmediatePropagation() { this._stopped = true; },
    ...extra,
  };
}

class FakeDocument extends FakeNode {
  constructor() {
    super(null, 9, "#document");
    this.ownerDocument = this;
    this.documentElement = new FakeElement(this, "html");
    this.body = new FakeElement(this, "body");
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
    this.defaultView = globalThis;
    // react-dom feature-detects the input event with \`"oninput" in document\`.
    this.oninput = null;
  }
  createElement(tag) { return new FakeElement(this, tag); }
  createElementNS(ns, tag) { return new FakeElement(this, tag, ns); }
  createTextNode(text) { return new FakeText(this, text); }
  createComment(text) { const node = new FakeText(this, text); node.nodeType = 8; node.nodeName = "#comment"; return node; }
  getElementById(id) { return this.documentElement.querySelector(`[id="${id}"]`); }
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }
  querySelector(selector) { return this.documentElement.querySelector(selector); }
}

function installDom() {
  const doc = new FakeDocument();
  globalThis.window = globalThis;
  globalThis.document = doc;
  globalThis.navigator ??= { userAgent: "node" };
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLIFrameElement = class HTMLIFrameElement {};
  globalThis.Node = FakeNode;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Bundled, React's act() queues work through MessageChannel, whose real
  // ports keep the test process alive after the last test. Same order, no port.
  globalThis.MessageChannel = class MessageChannel {
    constructor() {
      this.port1 = { onmessage: null, close() {} };
      this.port2 = { postMessage: (data) => setImmediate(() => this.port1.onmessage?.({ data })), close() {} };
    }
  };
  return doc;
}

// ── The panel, bundled with the network and toasts replaced ────────────────
const HARNESS = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { LinksPagePanel } from "../components/links/LinksPagePanel.jsx";
export { act };
export function mount(container) {
  const root = createRoot(container);
  return { root, render: () => root.render(createElement(LinksPagePanel)) };
}
`;

let harness;
let doc;

before(async () => {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
  }
  const stubs = {
    name: "issue4318-network-stubs",
    setup(build) {
      build.onResolve({ filter: /\/lib\/supabase(\.js)?$/ }, () => ({ path: "supabase-stub", namespace: "stub" }));
      build.onResolve({ filter: /\/context\/ToastContext(\.jsx)?$/ }, () => ({ path: "toast-stub", namespace: "stub" }));
      build.onLoad({ filter: /^supabase-stub$/, namespace: "stub" }, () => ({
        contents: "export const supabase = { rpc: (name, args) => globalThis.__links4318.rpc(name, args) };",
        loader: "js",
      }));
      build.onLoad({ filter: /^toast-stub$/, namespace: "stub" }, () => ({
        contents: "export function useToast() { return { addToast: (toast) => globalThis.__links4318.toasts.push(toast) }; }",
        loader: "js",
      }));
    },
  };
  const out = await esbuild.build({
    stdin: { contents: HARNESS, resolveDir: HERE, sourcefile: "links-panel.harness.jsx", loader: "jsx" },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    loader: { ".js": "jsx" },
    plugins: [stubs],
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4318-links-panel-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  doc = installDom();
  harness = await import(pathToFileURL(file).href);
});

// esbuild keeps a service process alive until it is told to stop.
after(async () => {
  const esbuild = await import("esbuild");
  await esbuild.stop?.();
});

// ── The fake server ────────────────────────────────────────────────────────
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const strip = (id, position, extra = {}) => ({
  id, shows_on: "2026-11-09", title: `Strip ${id}`, label: "New", opens: "host",
  url: null, blog_post_id: null, blog_title: null, position, is_published: true, ...extra,
});

let server;
beforeEach(() => {
  server = {
    calls: [],
    strips: [strip("a", 1), strip("b", 2), strip("c", 3)],
    posts: [],
    handlers: {},
  };
  globalThis.__links4318 = {
    toasts: [],
    rpc: (name, args) => {
      server.calls.push({ name, args });
      if (server.handlers[name]) return server.handlers[name](args);
      if (name === "admin_links_strips_list") return Promise.resolve({ data: server.strips.map((s) => ({ ...s })), error: null });
      if (name === "issue_4137_blog_list_posts") return Promise.resolve({ data: { posts: server.posts }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
});

const calls = (name) => server.calls.filter((call) => call.name === name);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const mounted = [];
afterEach(async () => {
  while (mounted.length) {
    const view = mounted.pop();
    await harness.act(async () => { view.root.unmount(); });
  }
});

async function mountPanel() {
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const view = harness.mount(container);
  mounted.push(view);
  await harness.act(async () => { view.render(); });
  await harness.act(async () => { await tick(); await tick(); });
  return container;
}

async function settle(fn) {
  await harness.act(async () => { await fn?.(); await tick(); await tick(); });
}

const listTitles = (container) => container.querySelectorAll("li").map((li) => li.querySelector("b").textContent);
const buttonByLabel = (container, label) => container.querySelectorAll("button").find((b) => b.getAttribute("aria-label") === label);
const buttonByText = (container, text) => container.querySelectorAll("button").filter((b) => b.textContent.trim() === text);

// Typing changes the value underneath React's value tracker, the way a
// keyboard does (an assignment through the element would be swallowed).
const setNativeValue = Object.getOwnPropertyDescriptor(FakeElement.prototype, "value").set;
async function typeInto(input, value) {
  await settle(() => {
    setNativeValue.call(input, value);
    input.dispatchEvent(makeEvent("input"));
  });
}
async function choose(select, value) {
  assert.ok(select.options.some((o) => o.value === value), `option ${value} is offered`);
  await settle(() => {
    select.value = value;
    select.dispatchEvent(makeEvent("change"));
  });
}
async function pickOpens(container, id) {
  const radio = container.querySelectorAll("input").find((el) => (el.name ?? el.getAttribute("name")) === "links-strip-opens" && el.value === id);
  await settle(() => { radio.checked = true; radio.dispatchEvent(makeEvent("click")); });
}
async function submit(container) {
  const form = container.querySelector("form");
  await settle(() => { form.dispatchEvent(makeEvent("submit")); });
}
const errorText = (container) => container.querySelector('[id="links-strip-error"]').textContent;

// ── A-1 reorder rollback ───────────────────────────────────────────────────
describe("A-1 reorder rolls back when the save fails mid-flight", () => {
  it("shows the move at once, blocks a second move while saving, then puts the old order back", async () => {
    const pending = deferred();
    server.handlers.admin_links_strips_reorder = () => pending.promise;
    const container = await mountPanel();
    assert.deepEqual(listTitles(container), ["Strip a", "Strip b", "Strip c"]);

    await settle(() => buttonByLabel(container, "Move down: Strip a").click());
    assert.deepEqual(listTitles(container), ["Strip b", "Strip a", "Strip c"], "optimistic order shown");
    assert.deepEqual(calls("admin_links_strips_reorder").map((c) => c.args.p_ids), [["b", "a", "c"]]);

    // Mid-flight: every arrow is disabled and a click does not start a second save.
    const down = buttonByLabel(container, "Move down: Strip b");
    assert.equal(down.disabled, true, "arrows are disabled while a reorder is saving");
    await settle(() => down.click());
    assert.equal(calls("admin_links_strips_reorder").length, 1, "no second reorder while one is in flight");

    await settle(() => pending.resolve({ data: null, error: { code: "08006", message: "connection failure" } }));
    assert.deepEqual(listTitles(container), ["Strip a", "Strip b", "Strip c"], "old order is back");
    assert.equal(calls("admin_links_strips_list").length, 1, "a plain failure does not reload the list");
    const toast = globalThis.__links4318.toasts.at(-1);
    assert.equal(toast.variant, "error");
    assert.equal(toast.title, "The new order wasn't saved");
    assert.equal(buttonByLabel(container, "Move down: Strip a").disabled, false, "arrows work again");
  });

  it("rolls a drag-and-drop back too, and a rejected promise (network throw) is handled the same way", async () => {
    server.handlers.admin_links_strips_reorder = () => Promise.reject(new TypeError("Failed to fetch"));
    const container = await mountPanel();
    const [first, , third] = container.querySelectorAll("li");
    await settle(() => {
      third.dispatchEvent(makeEvent("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } }));
    });
    await settle(() => { first.dispatchEvent(makeEvent("dragover")); });
    await settle(() => { first.dispatchEvent(makeEvent("drop")); });
    assert.deepEqual(calls("admin_links_strips_reorder").map((c) => c.args.p_ids), [["c", "a", "b"]]);
    assert.deepEqual(listTitles(container), ["Strip a", "Strip b", "Strip c"], "drag rolled back");
    assert.equal(globalThis.__links4318.toasts.at(-1).variant, "error");
  });

  it("the top strip cannot move up and the bottom one cannot move down", async () => {
    const container = await mountPanel();
    assert.equal(buttonByLabel(container, "Move up: Strip a").disabled, true);
    assert.equal(buttonByLabel(container, "Move down: Strip c").disabled, true);
    await settle(() => buttonByLabel(container, "Move up: Strip a").click());
    assert.equal(calls("admin_links_strips_reorder").length, 0);
  });
});

// ── A-2 PT409 reload ───────────────────────────────────────────────────────
describe("A-2 a stale order reloads the server's list", () => {
  it("on PT409 puts the old order back, then shows what the server now holds", async () => {
    server.handlers.admin_links_strips_reorder = () => {
      // Someone else added a strip meanwhile.
      server.strips = [strip("z", 0, { title: "Strip z" }), ...server.strips];
      return Promise.resolve({ data: null, error: { code: "PT409", message: "links_strips_stale" } });
    };
    const container = await mountPanel();
    await settle(() => buttonByLabel(container, "Move down: Strip a").click());
    await settle();
    assert.equal(calls("admin_links_strips_list").length, 2, "the list was fetched again");
    assert.deepEqual(listTitles(container), ["Strip z", "Strip a", "Strip b", "Strip c"]);
    const toast = globalThis.__links4318.toasts.at(-1);
    assert.match(toast.description, /reloaded/i);
  });
});

// ── A-3 save validation ────────────────────────────────────────────────────
describe("A-3 save validation and arguments", () => {
  it("sends nothing for a title of whitespace of any kind, 61 characters, or a script link", async () => {
    const container = await mountPanel();
    const title = container.querySelector('[id="links-strip-title"]');
    const url = container.querySelector('[id="links-strip-url"]');
    for (const bad of [" ", "\t\n", "  ", "　", "  "]) {
      await typeInto(title, bad);
      await typeInto(url, "usemingla.com/host");
      await submit(container);
      assert.equal(calls("admin_links_strip_save").length, 0, `title ${JSON.stringify(bad)} reached the server`);
      assert.match(errorText(container), /title/i);
    }
    await typeInto(title, "x".repeat(61));
    await submit(container);
    assert.equal(calls("admin_links_strip_save").length, 0, "61 characters reached the server");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "https://", "usemingla", "usemingla.com/a b", "//evil.com"]) {
      await typeInto(title, "Fine title");
      await typeInto(url, bad);
      await submit(container);
      assert.equal(calls("admin_links_strip_save").length, 0, `${bad} reached the server`);
      assert.match(errorText(container), /web link/i);
    }
  });

  it("a new strip sends no city and the list names none; a scheme is stripped", async () => {
    server.handlers.admin_links_strip_save = (args) => Promise.resolve({ data: { id: "new", ...args }, error: null });
    server.strips = [strip("e", 1, { title: "Everywhere" })];
    const container = await mountPanel();
    assert.doesNotMatch(container.querySelector("li").textContent, /Every live city/);
    assert.ok(!container.querySelector('[id="links-strip-city"]'), "the form has no City field");
    await typeInto(container.querySelector('[id="links-strip-title"]'), "  Fresh strip  ");
    await typeInto(container.querySelector('[id="links-strip-url"]'), " HTTPS://usemingla.com/host ");
    await submit(container);
    const [save] = calls("admin_links_strip_save");
    assert.equal(Object.hasOwn(save.args, "p_city_slug"), false, "admin_links_strip_save has no city parameter");
    assert.equal(save.args.p_title, "Fresh strip");
    assert.equal(save.args.p_url, "usemingla.com/host");
    assert.equal(save.args.p_blog_post_id, null);
    assert.equal(save.args.p_id, null);
  });

  it("editing a row that still carries an old city sends no city and shows none", async () => {
    server.handlers.admin_links_strip_save = (args) => Promise.resolve({ data: args, error: null });
    server.strips = [strip("n", 1, { city_slug: "accra", title: "Old night" })];
    const container = await mountPanel();
    assert.doesNotMatch(container.querySelector("li").textContent, /accra/, "a leftover city is never shown");
    await settle(() => buttonByLabel(container, "Edit: Old night").click());
    await submit(container);
    const [save] = calls("admin_links_strip_save");
    assert.equal(save.args.p_id, "n");
    assert.equal(Object.hasOwn(save.args, "p_city_slug"), false, "an edit never sends a city");
  });

  it("a refusal from the server says what is wrong, not that the connection failed", async () => {
    for (const message of ["links_url_invalid", "links_title_invalid", "links_shows_on_invalid", "links_blog_post_invalid"]) {
      server.calls = [];
      server.handlers.admin_links_strip_save = () => Promise.resolve({ data: null, error: { code: "P0001", message } });
      const container = await mountPanel();
      await typeInto(container.querySelector('[id="links-strip-title"]'), "Fine title");
      await typeInto(container.querySelector('[id="links-strip-url"]'), "usemingla.com/host");
      await submit(container);
      assert.equal(calls("admin_links_strip_save").length, 1);
      assert.doesNotMatch(errorText(container), /connection/i, `${message} is reported as a connection problem: "${errorText(container)}"`);
    }
  });

  it("the form's web-link rule never passes a link the server refuses", () => {
    // admin_links_strip_save's rule (migration 20280508004318), after the
    // http(s):// prefix is stripped.
    const server = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(:[0-9]{1,5})?([/?#][^\s]*)?$/i;
    const base = { showsOn: "2026-11-09", title: "Fine", label: "New", opens: "web" };
    const passedByFormRefusedByServer = [
      "my_site.com", "-usemingla.com", "usemingla-.com/x", "usemingla..com", ".usemingla.com", "a.b.c..com/x", "usemingla.c0m.com_/x",
    ].filter((url) => validateStripDraft({ ...base, url }) === null && !server.test(url.replace(/^https?:\/\//i, "")));
    assert.deepEqual(passedByFormRefusedByServer, [], "links the form accepts but the server refuses");
  });
});

// ── A-4 blog title prefill ─────────────────────────────────────────────────
describe("A-4 blog post picker and title prefill", () => {
  beforeEach(() => {
    server.posts = [
      { id: "p1", title: "Where to eat in Lagos this week", derived_state: "published" },
      { id: "p2", title: "Unfinished draft", derived_state: "draft" },
      { id: "p3", title: "Scheduled for Friday", derived_state: "scheduled" },
      { id: "p4", title: "L".repeat(75), derived_state: "published" },
      { id: "p5", title: "Second published post", derived_state: "published" },
    ];
  });

  it("offers only published posts", async () => {
    const container = await mountPanel();
    await pickOpens(container, "blog");
    const offered = container.querySelector('[id="links-strip-blog"]').options.map((o) => o.value).filter(Boolean);
    assert.deepEqual(offered, ["p1", "p4", "p5"]);
  });

  it("fills an empty title from the post, follows a re-pick, and cuts a long title to 60", async () => {
    const container = await mountPanel();
    await pickOpens(container, "blog");
    const picker = container.querySelector('[id="links-strip-blog"]');
    const title = container.querySelector('[id="links-strip-title"]');
    await choose(picker, "p1");
    assert.equal(title.value, "Where to eat in Lagos this week");
    await choose(picker, "p5");
    assert.equal(title.value, "Second published post", "a prefilled title follows the post until the admin types");
    await choose(picker, "p4");
    assert.equal(title.value, "L".repeat(60));
  });

  it("never overwrites a title the admin typed, before or after choosing Blog post", async () => {
    let container = await mountPanel();
    await typeInto(container.querySelector('[id="links-strip-title"]'), "My own words");
    await pickOpens(container, "blog");
    await choose(container.querySelector('[id="links-strip-blog"]'), "p1");
    assert.equal(container.querySelector('[id="links-strip-title"]').value, "My own words");

    container = await mountPanel();
    await pickOpens(container, "blog");
    await choose(container.querySelector('[id="links-strip-blog"]'), "p1");
    await typeInto(container.querySelector('[id="links-strip-title"]'), "Edited after prefill");
    await choose(container.querySelector('[id="links-strip-blog"]'), "p5");
    assert.equal(container.querySelector('[id="links-strip-title"]').value, "Edited after prefill");
  });

  it("a blog strip sends its post and no URL; with no post chosen nothing is sent", async () => {
    server.handlers.admin_links_strip_save = (args) => Promise.resolve({ data: args, error: null });
    const container = await mountPanel();
    await typeInto(container.querySelector('[id="links-strip-url"]'), "usemingla.com/stale");
    await pickOpens(container, "blog");
    await typeInto(container.querySelector('[id="links-strip-title"]'), "Read this");
    await submit(container);
    assert.equal(calls("admin_links_strip_save").length, 0);
    assert.match(errorText(container), /blog post/i);
    await choose(container.querySelector('[id="links-strip-blog"]'), "p1");
    await submit(container);
    const [save] = calls("admin_links_strip_save");
    assert.equal(save.args.p_opens, "blog");
    assert.equal(save.args.p_blog_post_id, "p1");
    assert.equal(save.args.p_url, null, "the stale web link is not sent");
    assert.equal(save.args.p_title, "Read this");
  });
});

// ── A-5 strips are not by city ─────────────────────────────────────────────
describe("A-5 strips are not by city (#4318 addendum 2 A)", () => {
  it("the admin city list module is gone", () => {
    assert.equal(fs.existsSync(path.join(SRC, "lib/linksCities.js")), false);
  });

  it("the panel renders no city control and no city words", async () => {
    server.strips = [strip("a", 0), strip("b", 1)];
    const container = await mountPanel();
    assert.ok(!container.querySelector('[id="links-strip-city"]'));
    assert.doesNotMatch(container.textContent, /Every live city|not in the list/);
  });
});

// ── A-6 delete needs a confirm ─────────────────────────────────────────────
describe("A-6 removing a strip needs a second, explicit confirm", () => {
  it("the first Remove only asks; Keep cancels; only the confirm deletes, once", async () => {
    server.handlers.admin_links_strip_delete = (args) => {
      server.strips = server.strips.filter((s) => s.id !== args.p_id);
      return Promise.resolve({ data: null, error: null });
    };
    const container = await mountPanel();
    const firstRow = () => container.querySelectorAll("li")[0];
    await settle(() => buttonByText(firstRow(), "Remove")[0].click());
    assert.equal(calls("admin_links_strip_delete").length, 0, "one click deleted the strip");
    assert.match(firstRow().textContent, /Remove this strip\?/);
    assert.equal(firstRow().getAttribute("draggable"), "false", "a strip being confirmed cannot be dragged");

    await settle(() => buttonByText(firstRow(), "Keep")[0].click());
    assert.equal(calls("admin_links_strip_delete").length, 0);
    assert.doesNotMatch(firstRow().textContent, /Remove this strip\?/);

    await settle(() => buttonByText(firstRow(), "Remove")[0].click());
    await settle(() => buttonByText(firstRow(), "Remove")[0].click());
    assert.deepEqual(calls("admin_links_strip_delete").map((c) => c.args), [{ p_id: "a" }]);
    assert.deepEqual(listTitles(container), ["Strip b", "Strip c"]);
  });

  it("a failed delete keeps the strip and says so", async () => {
    server.handlers.admin_links_strip_delete = () => Promise.resolve({ data: null, error: { code: "42501", message: "links_forbidden" } });
    const container = await mountPanel();
    const firstRow = () => container.querySelectorAll("li")[0];
    await settle(() => buttonByText(firstRow(), "Remove")[0].click());
    await settle(() => buttonByText(firstRow(), "Remove")[0].click());
    assert.deepEqual(listTitles(container), ["Strip a", "Strip b", "Strip c"]);
    const toast = globalThis.__links4318.toasts.at(-1);
    assert.equal(toast.variant, "error");
    assert.match(toast.description, /Support access/);
  });
});

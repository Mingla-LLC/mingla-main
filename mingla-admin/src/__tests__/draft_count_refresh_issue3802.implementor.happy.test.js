// Issue #3802 — Connector part 3 count-refresh rework.
//
// This renders the real useDraftCounts hook with a tiny deterministic hook
// runtime. The first server answer is held while several mutation refreshes
// arrive, so the race cannot be hidden by a fast local response.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const originals = new Map();
let harness;
let tempDir;

const REACT_RUNTIME = String.raw`
let states = [];
let refs = [];
let effects = [];
let cleanups = [];
let stateCursor = 0;
let refCursor = 0;
let effectCursor = 0;
let mounted = false;
let updatesAfterUnmount = 0;

function rewind() {
  stateCursor = 0;
  refCursor = 0;
  effectCursor = 0;
}

export function __resetReact() {
  states = [];
  refs = [];
  effects = [];
  cleanups = [];
  mounted = false;
  updatesAfterUnmount = 0;
  rewind();
}

export function __renderHook(render, runEffects = false) {
  rewind();
  const result = render();
  if (runEffects) {
    mounted = true;
    cleanups = effects.map((setup) => setup?.());
  }
  return result;
}

export function __unmountHook() {
  mounted = false;
  for (const cleanup of [...cleanups].reverse()) cleanup?.();
  cleanups = [];
}

export function __updatesAfterUnmount() {
  return updatesAfterUnmount;
}

export function useState(initial) {
  const slot = stateCursor++;
  if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial;
  const setState = (value) => {
    if (!mounted) updatesAfterUnmount += 1;
    states[slot] = typeof value === "function" ? value(states[slot]) : value;
  };
  return [states[slot], setState];
}

export function useRef(initial) {
  const slot = refCursor++;
  if (!(slot in refs)) refs[slot] = { current: initial };
  return refs[slot];
}

export function useEffect(setup) {
  const slot = effectCursor++;
  if (!(slot in effects)) effects[slot] = setup;
}

export function useCallback(callback) { return callback; }
export function createContext(value) { return { value }; }
export function createElement() { return null; }
export function useContext(context) { return context.value; }
`;

const SERVICE_RUNTIME = String.raw`
let calls = 0;
let deferred = [];

export function __resetService() {
  calls = 0;
  deferred = [];
}

export function __deferCounts() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  const entry = { promise, resolve, reject };
  deferred.push(entry);
  return entry;
}

export function __fetchCalls() { return calls; }

export async function fetchDraftCounts() {
  calls += 1;
  const next = deferred.shift();
  if (!next) throw new Error("Unexpected count fetch");
  return next.promise;
}
`;

const ENTRY = String.raw`
import {
  __renderHook,
  __resetReact,
  __unmountHook,
  __updatesAfterUnmount,
} from "react";
import {
  __deferCounts,
  __fetchCalls,
  __resetService,
} from "draft-service-harness";
import { announceDraftMutation, useDraftCounts } from "../hooks/useDraftCounts.js";

let render;

export function reset() {
  __resetReact();
  __resetService();
  render = () => useDraftCounts();
}

export function mount() { return __renderHook(render, true); }
export function read() { return __renderHook(render); }
export function unmount() { __unmountHook(); }
export const announce = announceDraftMutation;
export const deferCounts = __deferCounts;
export const fetchCalls = __fetchCalls;
export const updatesAfterUnmount = __updatesAfterUnmount;
`;

function replaceGlobal(name, value) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

async function eventually(check, message) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await Promise.resolve();
    if (check()) return;
  }
  assert.fail(message);
}

before(async () => {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
  }

  const listeners = new Map();
  const eventTarget = {
    addEventListener(type, listener) {
      const group = listeners.get(type) || new Set();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
  };
  replaceGlobal("window", eventTarget);
  replaceGlobal("document", { ...eventTarget, visibilityState: "visible" });
  replaceGlobal("navigator", { onLine: true });
  replaceGlobal("setInterval", () => 1);
  replaceGlobal("clearInterval", () => {});

  const virtualModules = {
    react: REACT_RUNTIME,
    auth: 'export function useAuth() { return { access: { email: "owner@usemingla.com" } }; }',
    service: SERVICE_RUNTIME,
  };
  const plugin = {
    name: "issue-3802-draft-count-harness",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "draft-count" }));
      build.onResolve({ filter: /^draft-service-harness$/ }, () => ({ path: "service", namespace: "draft-count" }));
      build.onResolve({ filter: /AuthContext$/ }, () => ({ path: "auth", namespace: "draft-count" }));
      build.onResolve({ filter: /draftService$/ }, () => ({ path: "service", namespace: "draft-count" }));
      build.onLoad({ filter: /.*/, namespace: "draft-count" }, ({ path: moduleName }) => ({
        contents: virtualModules[moduleName],
        loader: "js",
      }));
    },
  };
  const out = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: "draft-count-race.harness.js" },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [plugin],
    logLevel: "silent",
  });
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue3802-draft-count-"));
  const output = path.join(tempDir, "harness.mjs");
  fs.writeFileSync(output, out.outputFiles[0].text);
  harness = await import(pathToFileURL(output).href);
});

after(() => {
  harness?.unmount?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

afterEach(() => harness?.unmount?.());

describe("#3802 Draft counts: mutation refreshes cannot be dropped", () => {
  it("runs one coalesced refresh and leaves every count consumer on the post-mutation truth", async () => {
    harness.reset();
    const beforeMutation = harness.deferCounts();
    const afterMutation = harness.deferCounts();
    harness.mount();
    assert.equal(harness.fetchCalls(), 1);

    harness.announce();
    harness.announce();
    harness.announce();
    assert.equal(harness.fetchCalls(), 1, "refreshes share the in-flight request");

    beforeMutation.resolve({ waiting: 4, sent: 1, discarded: 0 });
    await eventually(() => harness.fetchCalls() === 2, "the queued post-mutation count request never ran");
    assert.equal(harness.read().data.waiting, 4, "the older answer may render only while the fresh request is pending");

    afterMutation.resolve({ waiting: 3, sent: 2, discarded: 0 });
    await eventually(() => harness.read().data?.waiting === 3, "the fresh count never became visible");
    assert.deepEqual(harness.read().data, { waiting: 3, sent: 2, discarded: 0 });
    assert.equal(harness.fetchCalls(), 2, "three refresh signals produce one follow-up, not a fetch storm");
    assert.equal(harness.updatesAfterUnmount(), 0);
    harness.unmount();
  });

  it("drops the queued refresh and the delayed answer after unmount", async () => {
    harness.reset();
    const delayed = harness.deferCounts();
    harness.mount();
    harness.announce();
    harness.announce();
    harness.unmount();

    delayed.resolve({ waiting: 99, sent: 0, discarded: 0 });
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    assert.equal(harness.fetchCalls(), 1, "unmount started a queued request");
    assert.equal(harness.updatesAfterUnmount(), 0, "a delayed answer updated state after unmount");
  });
});

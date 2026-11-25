// MINGLA-INVARIANT: I-4571-STALE-CHUNK-RELOAD | issue #4571 | An open Admin tab reloads once when a deploy replaces its code chunks, never in a loop, and the error screen says Admin was updated for a chunk-load error.
// Issue #4571 (stale chunk after a deploy).
//
//   S-1  the vite:preloadError handler prevents the default and reloads once
//   S-2  a second error inside 30 s does not reload; after the window it does
//   S-3  chunk-load messages are recognised, other errors are not
//   S-4  ErrorBoundary shows the update message and a Reload button for a
//        chunk error, and the generic message and Try Again otherwise
//   S-5  main.jsx installs the handler
//
// FAILS-ON-REVERT: without the handler (S-1, S-2, S-5) or the boundary branch
// (S-4) these fail.
//
// Run: node --test src/__tests__/issue4571_stale_chunk_reload.implementor.test.js
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installStaleChunkReload, isChunkLoadError, UPDATED_MESSAGE } from "../lib/staleChunk.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function fakeWin() {
  const listeners = {};
  const store = new Map();
  return {
    reloads: 0,
    listeners,
    addEventListener: (n, f) => { listeners[n] = f; },
    removeEventListener: (n) => { delete listeners[n]; },
    location: { reload() { this.owner.reloads += 1; } },
    storage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
  };
}
function setup(clock) {
  const w = fakeWin();
  w.location.owner = w;
  const logs = [];
  installStaleChunkReload({ win: w, storage: w.storage, now: () => clock.t, log: (o) => logs.push(o) });
  const fire = () => {
    const ev = { prevented: false, preventDefault() { this.prevented = true; }, payload: new Error("x") };
    w.listeners["vite:preloadError"](ev);
    return ev;
  };
  return { w, fire, logs };
}

describe("stale chunk reload handler", () => {
  it("S-1 prevents default and reloads once", () => {
    const { w, fire, logs } = setup({ t: 1000 });
    const ev = fire();
    assert.equal(ev.prevented, true);
    assert.equal(w.reloads, 1);
    assert.deepEqual(logs, ["reloading"]);
  });
  it("S-2 a second error within 30 s does not reload; later one does", () => {
    const clock = { t: 1000 };
    const { w, fire, logs } = setup(clock);
    fire();
    clock.t = 1000 + 5000;
    const ev = fire();
    assert.equal(ev.prevented, false, "a skip lets the error through");
    assert.equal(w.reloads, 1);
    assert.deepEqual(logs, ["reloading", "skipped"]);
    clock.t = 1000 + 31000;
    fire();
    assert.equal(w.reloads, 2);
  });
  it("S-2b blocked storage: no reload, error let through", () => {
    const w = fakeWin();
    w.location.owner = w;
    const logs = [];
    const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    installStaleChunkReload({ win: w, storage: bad, now: () => 1, log: (o) => logs.push(o) });
    const ev = { prevented: false, preventDefault() { this.prevented = true; } };
    w.listeners["vite:preloadError"](ev);
    assert.equal(w.reloads, 0);
    assert.equal(ev.prevented, false);
    assert.deepEqual(logs, ["skipped-no-storage"]);
    const onlyWrite = { getItem: () => null, setItem() { throw new Error("blocked"); } };
    const w2 = fakeWin(); w2.location.owner = w2;
    installStaleChunkReload({ win: w2, storage: onlyWrite, now: () => 1, log: () => {} });
    w2.listeners["vite:preloadError"]({ preventDefault() {} });
    assert.equal(w2.reloads, 0);
  });
  it("S-3 recognises chunk-load messages only", () => {
    for (const m of [
      "Failed to fetch dynamically imported module: https://a/b.js",
      "Importing a module script failed.",
      "error loading dynamically imported module",
    ]) assert.equal(isChunkLoadError(new Error(m)), true, m);
    assert.equal(isChunkLoadError(new Error("x is undefined")), false);
    assert.equal(isChunkLoadError(null), false);
  });
  it("S-5 main.jsx installs the handler", () => {
    const src = fs.readFileSync(path.join(HERE, "..", "main.jsx"), "utf8");
    assert.match(src, /installStaleChunkReload\(/);
  });
});

describe("ErrorBoundary chunk error", () => {
  let h;
  before(async () => {
    const esbuild = await import("esbuild");
    const out = await esbuild.build({
      stdin: {
        contents: `import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary } from "../components/ErrorBoundary.jsx";
const Boom = ({ message }) => { throw new Error(message); };
export const html = (message) => {
  const s = ErrorBoundary.getDerivedStateFromError(new Error(message));
  const b = new ErrorBoundary({ children: null });
  b.state = s;
  return renderToStaticMarkup(b.render());
};`,
        resolveDir: HERE, sourcefile: "issue4571.boundary.harness.jsx", loader: "jsx",
      },
      bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
      loader: { ".js": "jsx" },
      banner: { js: 'import { createRequire as __r } from "node:module"; const require = __r(import.meta.url);' },
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4571-eb-")), "harness.mjs");
    fs.writeFileSync(file, out.outputFiles[0].text);
    h = await import(pathToFileURL(file).href);
  });
  it("S-4 chunk error shows the update message and Reload", () => {
    const out = h.html("Failed to fetch dynamically imported module: https://a/RecordPanel-x.js");
    assert.ok(out.includes(UPDATED_MESSAGE));
    assert.ok(out.includes("Reload"));
    assert.ok(!out.includes("Something went wrong"));
  });
  it("S-4 other errors keep the generic screen", () => {
    const out = h.html("boom");
    assert.ok(out.includes("Something went wrong"));
    assert.ok(out.includes("boom"));
    assert.ok(out.includes("Try Again"));
    assert.ok(!out.includes(UPDATED_MESSAGE));
  });
});

describe("S-7 reading sessionStorage throws (site data blocked)", () => {
  it("installs without throwing and never reloads", () => {
    const listeners = {};
    let reloads = 0;
    const win = {
      addEventListener: (n, f) => { listeners[n] = f; },
      removeEventListener: () => {},
      location: { reload: () => { reloads += 1; } },
    };
    Object.defineProperty(win, "sessionStorage", {
      get() { throw new Error("SecurityError: access denied"); },
    });
    let prevented = false;
    assert.doesNotThrow(() => installStaleChunkReload({ win, now: () => 1 }));
    listeners["vite:preloadError"]({ preventDefault: () => { prevented = true; } });
    assert.equal(reloads, 0);
    assert.equal(prevented, false);
  });
});

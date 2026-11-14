// Issue #4423 rework 2 (tester P3-A): a page FIRST opened during the request
// ceiling pause showed "Couldn't load the board ... tell an admin" under the
// "Your work is safe" banner. Nothing was on screen to keep, so the shared
// LoadError showed the hard error.
//
// Now, while the pause holds, LoadError says the tab is paused (no "tell an
// admin") and runs the page's onRetry once, just after the pause ends.
//
// The first block renders the real LoadError (esbuild + react-dom/server)
// with the tab's real ceiling tripped. It needs the admin app's dependencies:
// run `npm ci` in mingla-admin first. Without them it FAILS; it never skips.
//
// FAILS-ON-REVERT: restore LoadError.jsx from before rework 2 and test 1b
// renders "tell an admin" (red); drop the whenCeilingLifts(onRetry) effect
// and test 3 goes red.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequestCeiling } from "../lib/requestCeiling.js";
import { loadErrorView, PAUSED_LOAD_TITLE, PAUSED_LOAD_WORDS, whenCeilingLifts } from "../lib/pollGate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const BOARD_WORDS = "That didn’t work. Try again, and if it keeps happening tell an admin.";

const HARNESS = `
import { renderToStaticMarkup } from "react-dom/server";
import { LoadError } from "../components/ui/LoadError.jsx";
import { tabCeiling } from "../lib/requestCeiling.js";

export function render() {
  return renderToStaticMarkup(
    <LoadError title="Couldn’t load the board" message=${JSON.stringify(BOARD_WORDS)} onRetry={() => {}} />,
  );
}
export async function trip() {
  globalThis.fetch = async () => ({ status: 200 });
  for (let i = 0; i < 300; i += 1) await tabCeiling.governedFetch("http://x/rest/v1/rpc/ops_work_list");
  await tabCeiling.governedFetch("http://x/rest/v1/rpc/ops_work_list").catch(() => {});
  return tabCeiling.state().tripped;
}
`;

let harness;
before(async () => {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
  }
  const out = await esbuild.build({
    stdin: { contents: HARNESS, resolveDir: HERE, sourcefile: "paused-first-load.harness.jsx", loader: "jsx" },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4423-paused-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  harness = await import(pathToFileURL(file).href);
});

describe("#4423 P3-A: a first load refused by the ceiling pause", () => {
  it("1a with no pause the board's own error shows (unchanged)", () => {
    const html = harness.render();
    assert.match(html, /Couldn’t load the board/);
    assert.match(html, /tell an admin/);
    assert.equal(html.includes("data-load-paused"), false);
  });
  it("1b during the pause the card says the tab is paused, never 'tell an admin'", async () => {
    assert.equal(await harness.trip(), true, "the tab's real ceiling tripped");
    const html = harness.render();
    assert.equal(html.includes("tell an admin"), false, html);
    assert.equal(html.includes("Couldn’t load the board"), false, html);
    assert.ok(html.includes(PAUSED_LOAD_TITLE), html);
    assert.ok(html.includes(PAUSED_LOAD_WORDS), html);
    assert.ok(html.includes("data-load-paused"), html);
  });
});

describe("#4423 P3-A: the words and the read again", () => {
  it("2 loadErrorView keeps the page's words unless paused", () => {
    assert.deepEqual(loadErrorView({ title: "T", message: "M" }, false), { title: "T", message: "M", variant: "error", paused: false });
    const p = loadErrorView({ title: "T", message: "M" }, true);
    assert.equal(p.title, PAUSED_LOAD_TITLE);
    assert.equal(p.message, PAUSED_LOAD_WORDS);
    assert.equal(p.variant, "warning");
    assert.equal(/tell an admin/.test(PAUSED_LOAD_WORDS), false);
  });
  it("3 LoadError runs onRetry once just after the pause ends", async () => {
    const src = read("components/ui/LoadError.jsx");
    assert.match(src, /if \(!paused\) return undefined;\s*return whenCeilingLifts\(\(\) => retryRef\.current\?\.\(\)\);/);
    assert.match(src, /const view = loadErrorView\(\{ title, message \}, paused\);/);
    let t = 0;
    const ceiling = createRequestCeiling({ fetchImpl: async () => ({ status: 200 }), now: () => t, ceiling: 1, pauseMs: 60_000 });
    await ceiling.governedFetch("http://x/rest/v1/rpc/a");
    await assert.rejects(ceiling.governedFetch("http://x/rest/v1/rpc/a"), /request_ceiling/);
    t = 35_000;
    const timers = [];
    let retried = 0;
    whenCeilingLifts(() => { retried += 1; }, { ceiling, setTimer: (fn, ms) => { timers.push({ fn, ms }); return 1; }, clearTimer: () => {} });
    assert.equal(timers[0].ms, 25_050);
    timers[0].fn();
    assert.equal(retried, 1);
  });
});

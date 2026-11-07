// Issue #4270 (Wave 7, retest 1) — tester adversarial suite for the rework's
// new pieces, from angles the implementor's tests do not take:
//
//   P  PageLink (components/ui/PanelStack.jsx): outside the Brand group panel
//      it must stay the exact plain link it replaced, even with `hide` or a
//      `side` (every other admin page is unchanged); inside it, a kind the
//      teammate may not open is plain words, never a button that does nothing
//   H  the panel's history tags (lib/brandGroupPanelHistory.js) against what
//      the rest of the page does to the address: every rewrite of the address
//      while the panel is open must keep the entry's tag, or Close stops
//      landing on the entry the panel opened from
//
// Known defects are pinned as `todo` tests (they run and report but do not
// fail the suite) until the fix lands.
//
// Run: node --no-experimental-websocket --test src/__tests__/issue4270_w7_retest1.tester.adversarial.test.js
// (from mingla-admin, after `npm ci`; without esbuild the test FAILS, never skips).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPanelHistory } from "../lib/brandGroupPanelHistory.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(fs.readFileSync(path.join(SRC, rel), "utf8"));

const U1 = "11111111-2222-4333-8444-555555555555";

let h;
before(async () => {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
  }
  const out = await esbuild.build({
    stdin: {
      contents: `import { renderToStaticMarkup } from "react-dom/server";
import { PageLink } from "../components/ui/PanelStack.jsx";
export { PageLink };
export const html = (props) => renderToStaticMarkup(<PageLink {...props} />);`,
      resolveDir: HERE, sourcefile: "issue4270.w7.retest1.tester.harness.jsx", loader: "jsx",
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    loader: { ".js": "jsx" },
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4270-w7-retest1-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  h = await import(pathToFileURL(file).href);
});

describe("P PageLink outside and inside the Brand group panel", () => {
  it("P-1 without an opener it is the exact plain link, even with hide, a side and a text class", () => {
    const markup = h.html({ href: "#/brands?view=record&brandId=b1", hide: true, side: { kind: "brand", id: U1 }, className: "link", textClassName: "words", children: "Full record" });
    assert.equal(markup, '<a href="#/brands?view=record&amp;brandId=b1" class="link">Full record</a>', "every page other than the Brand group keeps its link");
    const plain = h.html({ href: "#/agent", className: "cta", children: "Open My agent" });
    assert.equal(plain, '<a href="#/agent" class="cta">Open My agent</a>');
  });

  it("P-2 with an opener that does not allow the kind it is plain words (never a button that does nothing)", () => {
    const opener = Object.assign(() => assert.fail("must not open"), { allows: () => false });
    const words = h.html({ href: "#/brands?brandId=b1", side: { kind: "brand", id: U1 }, onOpenSide: opener, textClassName: "words", children: "Harmattan Club" });
    assert.equal(words, '<span data-page-link-text="" class="words">Harmattan Club</span>');
    assert.doesNotMatch(words, /<button|href=/);
    assert.equal(h.html({ href: "#/brands?tab=claims", onOpenSide: opener, hide: true, children: "Review the claim" }), "", "hide shows nothing in the panel");
    assert.equal(h.html({ href: "#/people?userId=u1", onOpenSide: opener, children: "Ada" }), '<span data-page-link-text="" class="">Ada</span>', "no side kind: plain words");
  });

  it("P-3 with an opener that allows the kind it opens that item beside, as (kind, id), and links nowhere", () => {
    const calls = [];
    const opener = Object.assign((kind, id) => calls.push([kind, id]), { allows: (kind) => kind === "brand" });
    const el = h.PageLink({ href: "#/brands?brandId=b1", side: { kind: "brand", id: U1 }, onOpenSide: opener, className: "c", children: "Harmattan Club" });
    assert.equal(el.type, "button");
    assert.equal(el.props["data-side-link"], `brand:${U1}`);
    el.props.onClick();
    assert.deepEqual(calls, [["brand", U1]]);
    assert.doesNotMatch(h.html({ href: "#/brands?brandId=b1", side: { kind: "brand", id: U1 }, onOpenSide: opener, children: "x" }), /href=/);
  });
});

/** Chrome-like history: a hash assignment adds an entry with an empty state. */
function fakeWindow(start) {
  const entries = [{ url: start, state: null }];
  let at = 0;
  return {
    entries,
    location: {
      get href() { return entries[at].url; },
      set hash(value) {
        const url = `${entries[at].url.split("#")[0]}${value}`;
        if (url === entries[at].url) return;
        entries.splice(at + 1);
        entries.push({ url, state: null });
        at = entries.length - 1;
      },
    },
    history: {
      get state() { return entries[at].state; },
      replaceState(state, _t, url) { entries[at] = { url: url ?? entries[at].url, state }; },
      go(delta) { at = Math.max(0, Math.min(entries.length - 1, at + delta)); },
    },
  };
}

describe("H the panel's history tags against the rest of the page", () => {
  const BASE = "https://admin.test/#/community?tab=brand-groups&group=g1";
  const side = (s, extra = "") => `#/community?tab=brand-groups&group=g1&side=${s}${extra}`;

  it("H-1 a full-page link followed from the panel, then the browser's Back: Close still lands on the start", () => {
    const win = fakeWindow(BASE);
    const ph = createPanelHistory(win);
    ph.begin();
    ph.push(() => { win.location.hash = side(`host:${U1}`); });
    ph.push(() => { win.location.hash = side(`brand:${U1}`); });
    win.location.hash = "#/brands?brandId=b1"; // "Open full page": another page's entry, untagged
    win.history.go(-1); // the browser's Back returns to the panel's entry, tag intact
    assert.equal(ph.depth(), 2);
    win.history.go(ph.closeStep().delta);
    assert.equal(win.location.href, BASE);
  });

  it("H-2 a rewrite of the address while the panel is open (useHashQuery's replace writes a null state) loses the tag unless it goes through replace()", () => {
    const win = fakeWindow(BASE);
    const ph = createPanelHistory(win);
    ph.begin();
    ph.push(() => { win.location.hash = side(`host:${U1}`); });
    ph.replace(() => win.history.replaceState(null, "", `https://admin.test/${side(`host:${U1}`, "&rail=media")}`));
    assert.deepEqual(ph.closeStep(), { kind: "go", delta: -1 }, "through replace() the entry keeps its place");
    win.history.replaceState(null, "", `https://admin.test/${side(`host:${U1}`, "&rail=people")}`);
    assert.deepEqual(ph.closeStep(), { kind: "push" }, "a bare replace wipes the tag: Close can no longer walk back");
  });

  it("H-3 every replace-mode address write in BrandGroupsPanel keeps the panel's tag (rail tab while the panel is open)", {
    todo: "#4270 W7 retest 1 R-1: setRailTab (and the brand-match effect) call setSearch(…, { replace: true }) outside panelHistory.replace(), so at 1280 px and wider picking a rail tab while the panel is open wipes the entry's tag; Close then adds a new entry instead of walking back, and Back reopens the panel",
  }, () => {
    const src = code("components/community/BrandGroupsPanel.jsx");
    const offenders = [];
    for (const m of src.matchAll(/setSearch\([^;\n]*\{\s*replace:\s*true\s*\}\)/g)) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (!/\.replace\(\(\)\s*=>\s*$/.test(before)) offenders.push(m[0].slice(0, 90));
    }
    assert.deepEqual(offenders, []);
  });
});

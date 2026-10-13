// Issue #3802 (Wave 1, homes rework) — D-1: a question opened from an open
// card must be ABOVE the card, at every width.
//
// This is a rendered check, not a reading of the source. The real components
// (the layer component the boards use, the real side panel, the real
// "Why is this lost?" prompt) are built and rendered to markup, the markup is
// read back into a tree, and the tree is resolved the way a browser stacks it:
// boxes that are stacking contexts are ordered by their number, then by their
// place in the page, and whatever is inside a box stays inside it. The test
// then asks which element is on top at the centre of the screen.
//
// It needs the admin app's dependencies (react, react-dom, esbuild): run
// `npm ci` in mingla-admin first. Without them it FAILS; it never skips.
//
// The same question is asked of a real browser (document.elementsFromPoint at
// 375, 768, 1280 and 1400px); that run is recorded on the issue.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CRM_LAYER_Z } from "../lib/crmLayers.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const CSS = fs.readFileSync(path.join(SRC, "globals.css"), "utf8");
const Z_TOAST = Number(CSS.match(/--z-toast:\s*(\d+);/)[1]);

const HARNESS = `
import { renderToStaticMarkup } from "react-dom/server";
import { PipelineOverlays } from "../components/crm/CrmLayer.jsx";
import { Drawer } from "../components/ui/Drawer.jsx";
import { ReasonPrompt } from "../components/crm/ReasonPrompt.jsx";

const noop = () => {};
const card = (
  <Drawer open onClose={noop} title="Palm Court Kitchen" footer={<button type="button">Mark as lost</button>}>
    <label>Channel<input aria-label="Channel" /></label>
  </Drawer>
);
const prompt = <ReasonPrompt open stageId="lost" recordName="Palm Court Kitchen" onConfirm={noop} onCancel={noop} />;

export function render({ withCard = true, withPrompt = true } = {}) {
  return renderToStaticMarkup(
    <div id="page">
      <main><h1>Hosts</h1></main>
      <PipelineOverlays card={withCard ? card : null} dialog={withPrompt ? prompt : null} />
    </div>
  );
}
`;

let render;

before(async () => {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
  }
  const out = await esbuild.build({
    stdin: { contents: HARNESS, resolveDir: HERE, sourcefile: "overlay-stack.harness.jsx", loader: "jsx" },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    // react-dom's server build asks for Node's own modules with require().
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue3802-overlay-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  ({ render } = await import(pathToFileURL(file).href));
});

// ── A small tree reader for the rendered markup ────────────────────────────
const VOID = new Set(["input", "br", "img", "hr", "meta", "link"]);

function parse(html) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null, order: 0 };
  let node = root;
  let order = 0;
  const re = /<\/([a-zA-Z0-9]+)>|<([a-zA-Z0-9]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      node = node.parent || root;
    } else if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? "";
      const el = { tag: m[2].toLowerCase(), attrs, children: [], parent: node, order: ++order, text: "" };
      node.children.push(el);
      if (!m[4] && !VOID.has(el.tag)) node = el;
    } else if (m[5].trim()) {
      for (let p = node; p; p = p.parent) p.text = (p.text || "") + m[5];
    }
  }
  return root;
}
const walk = (n, f) => {
  f(n);
  n.children.forEach((c) => walk(c, f));
};
const find = (root, test) => {
  const out = [];
  walk(root, (n) => test(n) && out.push(n));
  return out;
};
const cls = (n) => ` ${n.attrs.class || ""} `;
const styleOf = (n) => Object.fromEntries((n.attrs.style || "").split(";").filter(Boolean).map((p) => p.split(":").map((x) => x.trim())));
const within = (n, a) => {
  for (let p = n; p; p = p.parent) if (p === a) return true;
  return false;
};

/**
 * The layer boxes that cover the whole screen, bottom to top, as a browser
 * paints them: by the box's stacking number, then by its place in the page.
 * A box is a stacking context (positioned, with a number), so everything
 * inside it is painted with it. A box with no number would not be one, and
 * its contents would be stacked by their own numbers (all the same here),
 * that is by page order alone.
 */
function paintOrder(root) {
  return find(root, (n) => n.attrs["data-crm-layer"] !== undefined)
    .map((box) => {
      const st = styleOf(box);
      const number = st.position && st.position !== "static" && st["z-index"] !== undefined ? Number(st["z-index"]) : null;
      const cover = find(box, (n) => /\sfixed\s/.test(cls(n)) && /\sinset-0\s/.test(cls(n)))[0] || null;
      return { name: box.attrs["data-crm-layer"], number, order: box.order, box, cover };
    })
    .filter((l) => l.cover)
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.order - b.order);
}

/** The element on top at the centre of the screen. */
function topAtCentre(root) {
  const layers = paintOrder(root);
  const top = layers[layers.length - 1];
  if (!top) return null;
  // The prompt's cover centres its one child (flex, items-center, justify-center).
  const centred = /\sitems-center\s/.test(cls(top.cover)) && /\sjustify-center\s/.test(cls(top.cover));
  return { layer: top.name, cover: top.cover, hit: centred ? top.cover.children[0] : top.cover, layers };
}

describe("#3802 D-1: the question opened from a card is above the card", () => {
  it("each overlay is rendered in its own layer box, and each box is a stacking context", () => {
    const root = parse(render());
    const boxes = find(root, (n) => n.attrs["data-crm-layer"] !== undefined);
    assert.deepEqual(boxes.map((b) => b.attrs["data-crm-layer"]), ["card", "dialog"]);
    for (const b of boxes) {
      const st = styleOf(b);
      assert.equal(st.position, "relative", `${b.attrs["data-crm-layer"]} is not positioned`);
      assert.equal(Number(st["z-index"]), CRM_LAYER_Z[b.attrs["data-crm-layer"]]);
    }
    // The card panel is in the card box and the prompt is in the dialog box, and nowhere else.
    const aside = find(root, (n) => n.tag === "aside" && n.attrs.role === "dialog");
    const prompt = find(root, (n) => n.tag === "div" && n.attrs.role === "dialog" && n.attrs["aria-label"] === "Why is this lost?");
    assert.equal(aside.length, 1);
    assert.equal(prompt.length, 1);
    assert.ok(within(aside[0], boxes[0]) && !within(aside[0], boxes[1]));
    assert.ok(within(prompt[0], boxes[1]) && !within(prompt[0], boxes[0]));
  });

  it("with a card open and the question asked, the question is the top element at the centre of the screen", () => {
    const root = parse(render());
    const top = topAtCentre(root);
    assert.equal(top.layer, "dialog", `the top layer is ${top.layer}`);
    assert.equal(top.cover.attrs["aria-label"], "Why is this lost?");
    assert.equal(top.cover.attrs["aria-modal"], "true");
    // What is under the pointer there is the question's own panel: its text
    // box and its two buttons, not the card and not the card's backdrop.
    assert.ok(/Why is this lost\?/.test(top.hit.text));
    assert.equal(find(top.hit, (n) => n.tag === "textarea" || n.tag === "input").length, 1);
    assert.ok(find(top.hit, (n) => n.tag === "button" && /Mark as lost/.test(n.text)).length === 1);
    assert.ok(find(top.hit, (n) => n.tag === "button" && /Cancel/.test(n.text)).length === 1);
    assert.equal(find(top.hit, (n) => n.tag === "aside").length, 0);
    // The card is wholly underneath: every layer below the top one.
    assert.deepEqual(top.layers.map((l) => l.name), ["card", "dialog"]);
    assert.ok(top.layers[0].number < top.layers[1].number);
  });

  it("the order holds whichever is drawn first in the page", () => {
    // Stacking must come from the layer numbers, not from the luck of page
    // order: move the dialog box before the card box and resolve again.
    const root = parse(render());
    const page = find(root, (n) => n.attrs.id === "page")[0];
    const boxes = page.children.filter((c) => c.attrs["data-crm-layer"] !== undefined);
    boxes[1].order = boxes[0].order - 0.5;
    assert.equal(topAtCentre(root).layer, "dialog");
  });

  it("toasts are above both, and a card alone is on top of the page", () => {
    const root = parse(render());
    for (const l of paintOrder(root)) assert.ok(l.number < Z_TOAST, `${l.name} is not under the toasts`);
    const alone = topAtCentre(parse(render({ withPrompt: false })));
    assert.equal(alone.layer, "card");
    assert.equal(alone.cover.children.filter((c) => c.tag === "aside").length, 1);
    assert.equal(topAtCentre(parse(render({ withCard: false, withPrompt: false }))), null);
  });

  it("the page really hands both to that component (so this is what the boards draw)", () => {
    const page = fs.readFileSync(path.join(SRC, "pages/PipelinePage.jsx"), "utf8");
    assert.match(page, /<PipelineOverlays\s+card=\{/);
    assert.match(page, /dialog=\{\s*reasonFor \? \(\s*<ReasonPrompt/);
  });
});

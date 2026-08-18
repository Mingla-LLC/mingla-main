/**
 * #2262 [composer-responsive-layout] T3 — I-PROPOSED-2262-EDITABLE-OWNS-THE-BOX.
 *
 * # The property, not the patch
 *
 * On desktop web the message box was a 480px dark rectangle whose typing
 * surface was a 23px strip pinned to the top: a real browser click at the
 * vertical centre left `document.activeElement` on `<body>`, and only a click
 * inside the strip focused the editor. Identical on mobile web at 390x750. The
 * cause is one DOM-ownership mistake: Tiptap's `EditorContent` renders a wrapper
 * and APPENDS the ProseMirror contenteditable INTO it, so `minHeight` and
 * `padding: 12` passed to `EditorContent` landed on the wrapper and the editable
 * stayed one line tall.
 *
 * This suite imports the REAL `COMPOSER_CHIP_CSS` export and parses its rule
 * blocks — not a source grep of a file path, so it cannot be satisfied by a
 * string sitting anywhere in the file. Under the default `testEnvironment:
 * node` config; no mount is needed, because the contract is the stylesheet.
 *
 * WHAT MAKES IT FAIL. T3-a fails on the CURRENT-BEFORE commit: on `main` that
 * selector's only declarations are `caret-color` and `outline`. Delete the box
 * block and T3-a goes red; move `padding` back onto `EditorContent` and T3-c
 * goes red; remove the click backstop and T3-d goes red.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

import { COMPOSER_CHIP_CSS } from "../composerChipHtml";

const BIZ_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const RICH_EDITOR_WEB = "src/components/marketing/ComposerV2/richEditor.tsx";

const readSource = (rel: string): string =>
  fs.readFileSync(path.join(BIZ_ROOT, rel), "utf8");

const stripJsComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Strip CSS comments so prose inside the stylesheet can never satisfy a check. */
const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

interface CssRule {
  selectors: string[];
  declarations: Map<string, string>;
}

/** A deliberately small CSS block parser: selector list + declaration map. */
function parseRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const selectors = (m[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const declarations = new Map<string, string>();
    for (const decl of (m[2] ?? "").split(";")) {
      const idx = decl.indexOf(":");
      if (idx === -1) continue;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const value = decl.slice(idx + 1).trim();
      if (prop.length > 0) declarations.set(prop, value);
    }
    if (selectors.length > 0) out.push({ selectors, declarations });
  }
  return out;
}

const RULES = parseRules(stripCssComments(COMPOSER_CHIP_CSS));

/** The ONE rule that gives the editable its box — selector list, no pseudo. */
const boxRule = RULES.find(
  (r) =>
    r.selectors.some((s) => s === ".mingla-composer-editor" || s === ".ProseMirror") &&
    r.declarations.has("padding"),
);

describe("#2262 T3 — the web editable owns its box", () => {
  test("T3-vacuity: the stylesheet parsed into real rules, and the editable selector exists", () => {
    // Before any absence or presence claim: prove the parse produced something.
    // A regex that stopped matching would otherwise turn this whole suite green.
    expect(RULES.length).toBeGreaterThan(10);
    const editableSelectors = RULES.flatMap((r) => r.selectors).filter(
      (s) => s === ".mingla-composer-editor" || s === ".ProseMirror",
    );
    expect(editableSelectors.length).toBeGreaterThan(0);
  });

  test("T3-a: the editable declares a full box contract, not just caret-color + outline", () => {
    expect(boxRule).toBeDefined();
    const decls = boxRule?.declarations ?? new Map<string, string>();

    // A height-establishing property: `flex` with a non-zero grow, or height:100%.
    const flex = decls.get("flex");
    const height = decls.get("height");
    const establishesHeight =
      (typeof flex === "string" && /^\s*[1-9]/.test(flex)) || height === "100%";
    expect(establishesHeight).toBe(true);

    // The floor, the box model, the gutter and the internal scroll. Every one of
    // these was on the WRAPPER, which is why 95% of the box was inert.
    expect(decls.has("min-height")).toBe(true);
    expect(decls.get("box-sizing")).toBe("border-box");
    expect(decls.has("padding")).toBe(true);
    expect(decls.has("overflow-y")).toBe(true);

    // The type metrics moved with them — leaving them on the wrapper leaves the
    // editable sized by inherited defaults.
    expect(decls.has("font-size")).toBe(true);
    expect(decls.has("line-height")).toBe(true);
  });

  test("T3-b: the min-height floor is DERIVED from the rule's own type scale, never a pixel literal", () => {
    const minHeight = boxRule?.declarations.get("min-height") ?? "";
    expect(minHeight.length).toBeGreaterThan(0);
    const derived = /calc\(/.test(minHeight) || /\dlh\b/.test(minHeight);
    // A bare `400px` here is CHROME_CONTENT_PX one order of magnitude smaller:
    // a hand-typed number standing in for a computed one. The value is folded
    // into the assertion so a failure message names what was actually found.
    expect(`the floor must be derived from the type scale, not typed (#2262). Got: ${minHeight} -> derived=${derived}`).toContain(
      "derived=true",
    );
    expect(/^\s*\d+px\s*$/.test(minHeight)).toBe(false);
  });

  test("T3-a2: the selection highlight is branded, not the browser default blue", () => {
    const selectionRule = RULES.find((r) =>
      r.selectors.some((s) => s.includes("::selection")),
    );
    expect(selectionRule).toBeDefined();
    expect(selectionRule?.declarations.get("background")).toMatch(/235,\s*120,\s*37/);
  });

  test("T3-a3: keyboard focus stays VISIBLE — outline is suppressed only when not :focus-visible", () => {
    const css = stripCssComments(COMPOSER_CHIP_CSS);
    // The blanket suppression removed the only focus indicator a tabbing
    // operator had. `:focus:not(:focus-visible)` is the narrow form.
    expect(css).toMatch(/:focus:not\(:focus-visible\)/);
    const visibleRule = RULES.find(
      (r) =>
        r.selectors.some((s) => /:focus-visible\s*$/.test(s)) &&
        r.declarations.has("outline"),
    );
    expect(visibleRule?.declarations.get("outline")).toMatch(/#eb7825/i);
  });

  test("T3-c: EditorContent carries NO box property, and containerHeight is gone", () => {
    const src = stripJsComments(readSource(RICH_EDITOR_WEB));

    // `containerHeight = initialHeight ?? 240` was the wrapper's magic number.
    expect(src).not.toMatch(/containerHeight/);

    const start = src.indexOf("<EditorContent");
    expect(start).toBeGreaterThan(-1); // vacuity: the element must still exist
    const end = src.indexOf("/>", start);
    expect(end).toBeGreaterThan(start);
    const element = src.slice(start, end);

    // The padding trap: a 16pt inert gutter survives the height fix if the
    // padding stays on the wrapper.
    for (const banned of ["padding", "fontSize", "lineHeight"]) {
      expect(element).not.toMatch(new RegExp(`\\b${banned}\\s*:`));
    }
    // `minHeight` needs the SPEC's own D-4 distinction applied: a `minHeight: 0`
    // is a BOUND that lets the wrapper shrink, and it is required here. A
    // NON-ZERO `minHeight` is a height CLAIM, and it is exactly what made the
    // wrapper grow while the editable stayed one line tall. Ban the claim, keep
    // the bound.
    expect(element).not.toMatch(/minHeight\s*:\s*[1-9]/);
    expect(element).not.toMatch(/minHeight\s*:\s*containerHeight/);
    // What it MUST carry: a flex column that lets the editable fill it.
    expect(element).toMatch(/flex\s*:\s*["']1 1 auto["']/);
    expect(element).toMatch(/minHeight\s*:\s*0\b/);
  });

  test("T3-d: the wrapper click handler is a BACKSTOP — it no-ops on a real in-box hit", () => {
    const src = stripJsComments(readSource(RICH_EDITOR_WEB));

    // Returns early when the click already landed inside the editable, because
    // `focus("end")` always jams the caret to the end of the document — wrong
    // when the operator clicked between two paragraphs. With the CSS applied the
    // browser's own hit-testing places the caret correctly and this never fires.
    expect(src).toMatch(/closest\(["']\.ProseMirror["']\)\s*!==\s*null\)\s*return/);
    expect(src).toMatch(
      /editor\.commands\.focus\(\s*["']end["']\s*,\s*\{\s*scrollIntoView:\s*false\s*\}\s*\)/,
    );
    expect(src).toMatch(/addEventListener\(\s*["']click["']/);
    // And it is removed on unmount — a leaked listener on a remounted editor
    // would focus a dead instance.
    expect(src).toMatch(/removeEventListener\(\s*["']click["']/);
  });

  test("T3-e: the format glyphs' active state is bound to a source that can flip, and only on web", () => {
    const src = stripJsComments(readSource(RICH_EDITOR_WEB));
    const bar = stripJsComments(
      readSource("src/components/marketing/ComposerV2/InsertionBar.tsx"),
    );

    // The four `active={false}` literals are gone. A control that renders a
    // distinct state must be bound to a source that can actually produce it.
    expect(bar).not.toMatch(/active=\{false\}/);

    // Web publishes real mark state off Tiptap's own selection events.
    expect(src).toMatch(/editor\.isActive\(["']bold["']\)/);
    expect(src).toMatch(/editor\.on\(\s*["']selectionUpdate["']/);

    // Native supplies NOTHING, deliberately: `COMPOSER_SELECTION_TRACKER_JS`
    // saves the range into the pell WebView's own `window` and posts nothing
    // back, so an active fill there could never fire. The gate is a real
    // platform check, not a comment.
    expect(bar).toMatch(/Platform\.OS === ["']web["']\s*\?\s*formatState\s*:\s*undefined/);
  });

  test("T3-f: no message channel is claimed on native — the tracker still posts nothing back", () => {
    // Anchors the reason T3-e's native branch is `undefined`. If someone lands
    // the WebView->RN selection channel, this test is the one that tells them
    // the native affordance is now buildable.
    const chipHtml = readSource("src/components/marketing/ComposerV2/composerChipHtml.ts");
    expect(chipHtml).toMatch(/__minglaSelTrackerInstalled/); // vacuity: tracker present
    expect(chipHtml).not.toMatch(/ReactNativeWebView\s*\.\s*postMessage/);
  });
});

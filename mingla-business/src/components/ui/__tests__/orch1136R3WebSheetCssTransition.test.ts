import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1136 R3 — biz-web sheet animations on a compositor CSS transition.
 *
 * Happy-path regression (implementor-owned): asserts each of the 5 shared
 * sheet/overlay primitives drives its WEB open/close animation via a compositor
 * CSS `transition` on transform/opacity (the fix), web-gated so native keeps
 * reanimated, with NO layout/reflow property animated on the web path; and that
 * the `[ORCH-1136-DIAG]` block was reaped from the event detail screen while the
 * non-silent brand-not-resolved guard stays (Const #1, no dead tap).
 *
 * Fails-on-revert: deleting the web CSS `transition:` line from any primitive's
 * web variant (reverting it to the JS-rAF withTiming useAnimatedStyle path)
 * makes the corresponding assertion fail. Mirrors the strict-grep gate
 * i-proposed-1136-web-sheet-css-transition.mjs.
 */
const root = path.resolve(__dirname, "..", "..", "..", "..");
const ui = (rel: string): string =>
  fs.readFileSync(path.join(root, "src/components/ui", rel), "utf8");

// A web CSS transition on transform and/or opacity (multi-line ternary tolerant).
const CSS_TRANSITION_RE = /transition:[^;]{0,140}?\b(?:transform|opacity)\b/;
// A layout/reflow property inside a transition (banned — reflows on main thread).
const LAYOUT_IN_TRANSITION_RE =
  /transition:[^;]{0,140}?\b(?:height|width|top|left|right|bottom)\b/;
const WEB_GATE_RE = /Platform\.OS\s*===\s*["']web["']/;

describe("ORCH-1136 R3 — web sheets animate via compositor CSS transition", () => {
  const sharedPrimitives = ["TopSheet.tsx", "SheetMobile.tsx", "Modal.tsx", "Toast.tsx"];

  it.each(sharedPrimitives)(
    "%s drives its web animation via a CSS transition on transform/opacity",
    (file) => {
      const src = ui(file);
      expect(CSS_TRANSITION_RE.test(src)).toBe(true);
    },
  );

  it.each(sharedPrimitives)(
    "%s web-gates the CSS-transition variant behind Platform.OS === 'web' (native keeps reanimated)",
    (file) => {
      const src = ui(file);
      expect(WEB_GATE_RE.test(src)).toBe(true);
    },
  );

  it.each([...sharedPrimitives, "Sheet.web.tsx"])(
    "%s animates transform/opacity only — no height/layout property in any web transition",
    (file) => {
      const src = ui(file);
      expect(LAYOUT_IN_TRANSITION_RE.test(src)).toBe(false);
    },
  );

  it("Sheet.web.tsx (web-only) drives the card via a CSS transition and imports no reanimated", () => {
    const src = ui("Sheet.web.tsx");
    expect(CSS_TRANSITION_RE.test(src)).toBe(true);
    expect(/from\s*["']react-native-reanimated["']/.test(src)).toBe(false);
  });

  it.each(sharedPrimitives)(
    "%s still keeps the native reanimated path (withTiming/withSpring) for non-web",
    (file) => {
      const src = ui(file);
      expect(/react-native-reanimated/.test(src)).toBe(true);
    },
  );
});

describe("ORCH-1136 R3 — DIAG reaped, non-silent guard kept (Const #1)", () => {
  const eventScreen = fs.readFileSync(
    path.join(root, "app/event/[id]/index.tsx"),
    "utf8",
  );

  it("removes the [ORCH-1136-DIAG] discriminator block", () => {
    expect(eventScreen).not.toContain("[ORCH-1136-DIAG]");
    expect(eventScreen).not.toContain("[DIAG] ⋯ tapped");
  });

  it("keeps the non-silent brand-not-resolved guard (no dead tap)", () => {
    expect(eventScreen).toContain("Loading brand… tap again in a moment.");
    expect(eventScreen).toContain("setManageMenuVisible(true)");
  });
});

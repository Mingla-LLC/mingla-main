import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1207 [business-web sheets too transparent + no swipe-to-dismiss] —
 * implementor-owned happy-path regression over the SheetWeb source contract.
 *
 * The load-bearing runtime proof lives in the real-Chromium Playwright probe
 * (playwright/orch1207/sheet-web-dismiss-opaque.spec.ts): it measures the panel
 * fill alpha (>= 0.97, no page bleed-through) and dispatches real pointer drags
 * to prove onClose fires past threshold + springs back below it. This jest test
 * is the cheap CI-runnable static guard for the SAME two contracts.
 *
 * Fails-on-revert (verified by true line-DELETION, not comment-out):
 *   • delete the `webOpaque` branch's WEB_OPAQUE_BACKGROUND fill → the opacity
 *     assertions fail.
 *   • delete the drag-catch View / dragHandlers wiring → the drag assertions fail.
 */
const root = path.resolve(__dirname, "..", "..", "..", "..");
const SRC = fs.readFileSync(
  path.join(root, "src/components/ui/SheetMobile.tsx"),
  "utf8",
);

/** Parse an `#rgb`/`#rrggbb` or `rgba(...)` color literal to its alpha (0..1). */
function alphaOf(color: string): number {
  const rgba = color.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const parts = rgba[1].split(",").map((s) => parseFloat(s.trim()));
    return parts.length >= 4 ? parts[3] : 1;
  }
  // hex (#16181b etc.) → fully opaque
  if (/^#[0-9a-fA-F]{6}$/.test(color) || /^#[0-9a-fA-F]{3}$/.test(color)) return 1;
  return NaN;
}

describe("ORCH-1207 Bug 1 — SheetWeb panel is effectively opaque on web", () => {
  it("defines WEB_OPAQUE_BACKGROUND as an effectively-opaque color (alpha >= 0.97)", () => {
    const m = SRC.match(/const\s+WEB_OPAQUE_BACKGROUND\s*=\s*["']([^"']+)["']/);
    expect(m).not.toBeNull();
    const alpha = alphaOf(m![1]);
    expect(alpha).toBeGreaterThanOrEqual(0.97);
  });

  it("SheetMobilePanelInner has a webOpaque branch that paints WEB_OPAQUE_BACKGROUND", () => {
    expect(/webOpaque\s*\?/.test(SRC)).toBe(true);
    expect(/backgroundColor:\s*WEB_OPAQUE_BACKGROUND/.test(SRC)).toBe(true);
  });

  it("SheetWeb's <SheetMobilePanelInner> opts into webOpaque; SheetNative's does NOT", () => {
    // Isolate each variant's <SheetMobilePanelInner ...> JSX call (the open tag up
    // to its first child/close) — SheetMobilePanelInner's own DEFINITION sits
    // between the two variants, so slice on the JSX call sites, not whole blocks.
    const callTag = (block: string): string => {
      const i = block.indexOf("<SheetMobilePanelInner");
      return i === -1 ? "" : block.slice(i, block.indexOf(">", i));
    };
    const webIdx = SRC.indexOf("const SheetWeb");
    const stylesIdx = SRC.indexOf("const styles = StyleSheet.create");
    const innerDefIdx = SRC.indexOf("const SheetMobilePanelInner");
    const nativeCall = callTag(SRC.slice(SRC.indexOf("const SheetNative"), innerDefIdx));
    const webCall = callTag(SRC.slice(webIdx, stylesIdx));
    expect(/webOpaque/.test(webCall)).toBe(true);
    expect(/webOpaque/.test(nativeCall)).toBe(false);
  });
});

describe("ORCH-1207 Bug 2 — SheetWeb has a pointer drag-to-dismiss", () => {
  const webBlock = SRC.slice(
    SRC.indexOf("const SheetWeb"),
    SRC.indexOf("const styles = StyleSheet.create"),
  );

  it("wires pointer drag handlers onto a drag-catch element", () => {
    expect(/onPointerDown:/.test(webBlock)).toBe(true);
    expect(/onPointerMove:/.test(webBlock)).toBe(true);
    expect(/onPointerUp:/.test(webBlock)).toBe(true);
    expect(/\{\.\.\.dragHandlers\}/.test(webBlock)).toBe(true);
    expect(/-drag-handle/.test(webBlock)).toBe(true);
  });

  it("commits a close past 25% of panel height OR a downward flick velocity", () => {
    expect(/DRAG_CLOSE_RATIO\s*=\s*0\.25/.test(webBlock)).toBe(true);
    expect(/DRAG_CLOSE_VELOCITY\s*=/.test(webBlock)).toBe(true);
    expect(
      /dragged\s*>\s*sheetHeight\s*\*\s*DRAG_CLOSE_RATIO\s*\|\|\s*velocity\s*>\s*DRAG_CLOSE_VELOCITY/.test(
        webBlock,
      ),
    ).toBe(true);
    expect(/onClose\(\)/.test(webBlock)).toBe(true);
  });

  it("translates the panel with the finger and disables transition while dragging", () => {
    expect(/openTranslateY\s*\+\s*dragY/.test(webBlock)).toBe(true);
    expect(/transition:\s*dragging\s*\n?\s*\?\s*["']none["']/.test(webBlock)).toBe(true);
  });

  it("keeps the existing scrim-tap dismissal (does not replace it)", () => {
    expect(/handleScrimPress/.test(webBlock)).toBe(true);
    expect(/dismissOnScrimTap/.test(webBlock)).toBe(true);
  });
});

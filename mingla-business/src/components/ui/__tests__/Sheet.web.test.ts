/**
 * ORCH-0891 M2 + ORCH-0964 — Sheet.web.tsx desktop-card + recursion-guard test.
 *
 * # What this verifies
 *   (a) [ORCH-0964] Sheet.web.tsx does NOT import the Sheet *value* from
 *       "./Sheet". On web, Metro platform-resolves "./Sheet" to THIS file,
 *       so a `import { Sheet as MobileSheet } from "./Sheet"` + a
 *       `<MobileSheet>` narrow branch makes this component render itself
 *       recursively → unbounded fiber tree → mobile-web renderer OOM
 *       ("page won't load / blank / needs multiple reloads"). The fix renders
 *       the centred card at ALL web widths. These assertions are the
 *       fails-on-revert anchor for that fix.
 *   (b) The wide/centred-card overlay (RN Modal + Reanimated) renders a dim
 *       backdrop scrim + a centred floating card (I-DESKTOP-MODAL-VIA-SHEET-WEB).
 *   (c) Re-exports `SheetProps` so consumers using the canonical specifier
 *       `./Sheet` get the right type on both platforms (Metro picks
 *       `.web.tsx` on web, `.tsx` on native).
 *
 * # Source-grep style (repo precedent)
 * Per `mingla-business/jest.config.cjs` (`testEnvironment: "node"`),
 * there's no jsdom/RTL. We read the file as a string and assert on the
 * structural patterns that satisfy the contract.
 */

import fs from "node:fs";
import path from "node:path";

const SHEET_WEB_PATH = path.resolve(__dirname, "..", "Sheet.web.tsx");

describe("ORCH-0964 — Sheet.web.tsx recursion guard + centred-card", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(SHEET_WEB_PATH, "utf8");
  });

  describe("(T-0964-01) No self-recursive MobileSheet delegation", () => {
    it("does NOT import the Sheet value from './Sheet' (recursion source)", () => {
      // On web, "./Sheet" resolves to Sheet.web.tsx (this file). A value
      // import of Sheet here is the infinite-recursion footgun. Type-only
      // imports are erased at build, so they are allowed.
      expect(source).not.toMatch(/import\s*\{[^}]*\bSheet\s+as\s+MobileSheet/);
      // No JSX self-delegation (the actual recursion). Prose comments may
      // still reference the old MobileSheet name to explain the fix.
      expect(source).not.toMatch(/<\s*MobileSheet\b/);
    });

    it("renders the centred card directly (no isWideDesktop branch)", () => {
      expect(source).toMatch(/return\s*<DesktopCenteredCard\s*\{\.\.\.props\}/);
    });
  });

  describe("(T-M2-02) Type surface preserved", () => {
    it("re-exports SheetProps + SheetSnapPoint / SheetSnapValue type aliases", () => {
      // Consumers import { Sheet, SheetProps } from './Sheet'. Metro picks
      // .web.tsx on web. The web variant MUST re-export the type surface
      // so consumers don't need to know which platform they're on.
      expect(source).toMatch(/export\s+type\s*\{[\s\S]*?SheetProps/);
    });
  });

  describe("(T-M2-03) Wide-desktop branch renders modal-style centered overlay", () => {
    it("contains a scrim/backdrop layer (the modal overlay)", () => {
      // The wide-desktop branch must provide a dim backdrop that scrims
      // the underlying canvas. Look for the canonical backdrop alpha
      // pattern `rgba(0, 0, 0, ...)`. Either RN-Modal-based (ORCH-0885-A)
      // or Radix-Dialog-based (SPEC §3.5.3) implementation satisfies this
      // — both render an absolute-positioned dim layer.
      expect(source).toMatch(/rgba\(0,\s*0,\s*0,\s*0\.\d+\)/);
    });

    it("centers the floating card via translate or position math", () => {
      // The wide-desktop card sits centered on the viewport. The
      // ORCH-0885-A implementation uses RN absolute positioning with
      // alignSelf/justifyContent center; the Radix variant uses CSS
      // transform: translate(-50%, -50%). Either satisfies the
      // visual contract; this assertion just confirms SOME centering
      // mechanism is present.
      const hasCentering =
        source.includes("alignSelf") ||
        source.includes("translate(-50%") ||
        source.includes("justifyContent") ||
        source.includes("alignItems");
      expect(hasCentering).toBe(true);
    });
  });
});

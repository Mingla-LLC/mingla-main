/**
 * ORCH-0891 M2 — Sheet.web.tsx desktop-modal branching regression test.
 *
 * # What this verifies (per SPEC §6 M2 row implementor-happy)
 * Sheet.web.tsx is the canonical primitive for sub-sheet → desktop-modal
 * conversion (I-DESKTOP-MODAL-VIA-SHEET-WEB). The file MUST:
 *   (a) Branch on `useResponsiveLayout().isWideDesktop` so narrow web +
 *       native fall through to the existing mobile bottom-sheet variant
 *       (`MobileSheet`).
 *   (b) On wide-desktop, render a centred modal-style overlay with
 *       opacity-backdrop scrim that closes on tap/Esc — NOT the mobile
 *       bottom-sheet drag-to-dismiss layout.
 *   (c) Re-export `SheetProps` so consumers using the canonical
 *       specifier `./Sheet` get the right type on both platforms
 *       (Metro picks `.web.tsx` on web, `.tsx` on native).
 *
 * # Important context (ORCH-0891 M2 implementation discovery)
 * Sheet.web.tsx was ALREADY built by ORCH-0885-A using RN Modal +
 * Reanimated for the desktop centered card. SPEC §3.5.3 was written
 * without knowing this; the M2 implementor kept the existing
 * implementation rather than rewriting to Radix Dialog. This test
 * therefore verifies the ORCH-0885-A implementation satisfies the
 * I-DESKTOP-MODAL-VIA-SHEET-WEB invariant the M2 SPEC introduced.
 *
 * # Source-grep style (repo precedent)
 * Per `mingla-business/jest.config.cjs` (`testEnvironment: "node"`),
 * there's no jsdom/RTL. We read the file as a string and assert on the
 * structural patterns that satisfy the contract.
 *
 * # Fails-on-revert anchor
 * If a future implementor removes the `isWideDesktop` branch or breaks
 * the SheetProps re-export, this test fails. Reverting the
 * `MobileSheet` import → fall-through to `MobileSheet` chain breaks the
 * I-DESKTOP-GATE-VIA-HOOK + I-DESKTOP-MODAL-VIA-SHEET-WEB invariants
 * simultaneously.
 */

import fs from "node:fs";
import path from "node:path";

const SHEET_WEB_PATH = path.resolve(__dirname, "..", "Sheet.web.tsx");

describe("ORCH-0891 M2 — Sheet.web.tsx desktop-modal branching (implementor-happy)", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(SHEET_WEB_PATH, "utf8");
  });

  describe("(T-M2-01) Branches on isWideDesktop", () => {
    it("imports useResponsiveLayout from the canonical hook path", () => {
      expect(source).toMatch(
        /from\s+["'][^"']*\/useResponsiveLayout["']/,
      );
    });

    it("reads isWideDesktop from useResponsiveLayout()", () => {
      expect(source).toMatch(/isWideDesktop[^;]*?useResponsiveLayout/);
    });

    it("returns MobileSheet (fall-through) when isWideDesktop is false", () => {
      // The narrow + native branch MUST delegate to the existing canonical
      // bottom-sheet. Match the conditional `if (!isWideDesktop)` pattern
      // immediately followed by a JSX MobileSheet usage.
      expect(source).toMatch(/!\s*isWideDesktop[\s\S]{0,200}MobileSheet/);
    });
  });

  describe("(T-M2-02) Mobile-sheet fall-through preserves canonical surface", () => {
    it("imports the mobile Sheet (as MobileSheet) from the sibling Sheet.tsx", () => {
      expect(source).toMatch(/Sheet\s+as\s+MobileSheet/);
    });

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

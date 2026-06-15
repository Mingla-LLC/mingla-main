/**
 * ORCH-1138 [trip-page-redesign] device-rework #3 — Reserve CTA float→dock
 * (BUSINESS / public-web parity with the consumer app).
 *
 * Seth's screenshot feedback: a fixed full-width OPAQUE bar pinned at the bottom
 * left a large BLACK EMPTY GAP between the "Choose how you pay" card and the bar.
 * The new behavior (mirrors ConsumerTripDetailScreen 1:1):
 *
 *   • DOCKED  — the Reserve CTA's resting position: the LAST scroll child, in
 *     normal flow, flush beneath "Choose how you pay" (NO void). Bg ok at rest;
 *     pads its own safe-area bottom.
 *   • FLOATING — JUST the pill (NO full-width opaque bar bg), shown ONLY while the
 *     docked button is scrolled OFF-screen. Hides once the docked button scrolls in.
 *
 * Source-string assertions (the RN components can't mount under ts-jest — mirrors
 * the sibling RT-* gates) PLUS a behavioral replica of the float→dock visibility
 * predicate. fails-on-revert: deleting any asserted line / formula flips a case
 * red. Owner: mingla-implementor.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const routeSrc = read("app/t/[brandSlug]/[tripSlug].tsx");
const previewSrc = read("src/components/trip/TripPreview.tsx");
const reserveBarSrc = read("src/components/trip/TripReserveBar.tsx");
const shellSrc = read("../packages/offering-rendering/ParallaxCoverShell.tsx");

describe("ORCH-1138 DR3 — trip Reserve CTA float→dock (business/web)", () => {
  test("DR3a TripReserveBar exposes a docked|floating variant prop", () => {
    expect(reserveBarSrc).toMatch(/variant:\s*"docked"\s*\|\s*"floating"/);
  });

  test("DR3b the FLOATING variant is just the pill — NO full-width opaque bar bg", () => {
    // floating branch renders styles.floatPill inside styles.floatWrapper.
    expect(reserveBarSrc).toMatch(/styles\.floatPill\b/);
    expect(reserveBarSrc).toMatch(/styles\.floatWrapper\b/);
    // the float wrapper carries NO page-colored full-width background band.
    const floatWrapperBlock = reserveBarSrc.match(
      /floatWrapper:\s*\{[\s\S]*?\},/,
    );
    expect(floatWrapperBlock).not.toBeNull();
    expect(floatWrapperBlock?.[0]).not.toContain("backgroundColor");
  });

  test("DR3c the DOCKED variant is an in-flow card (not absolute) with onLayout", () => {
    expect(reserveBarSrc).toContain('if (variant === "docked")');
    expect(reserveBarSrc).toMatch(/styles\.dockedCard\b/);
    expect(reserveBarSrc).toContain("onLayout={onDockLayout}");
    // dockedCard must NOT be absolute (that would re-introduce a void above it).
    const dockedBlock = reserveBarSrc.match(/dockedCard:\s*\{[\s\S]*?\},/);
    expect(dockedBlock).not.toBeNull();
    expect(dockedBlock?.[0]).not.toContain('position: "absolute"');
  });

  test("DR3d the route renders DOCKED as TripPreview's dockedReserve + FLOATING conditional", () => {
    expect(routeSrc).toContain('variant="docked"');
    expect(routeSrc).toContain("dockedReserve={dockedReserve}");
    expect(routeSrc).toContain('variant="floating"');
    // the floating pill is gated by floatingPillVisible (hides when docked in view).
    expect(routeSrc).toMatch(/!isDesktop && floatingPillVisible/);
    expect(routeSrc).toContain("const floatingPillVisible =");
    expect(routeSrc).toMatch(
      /dockTopY > scrollY \+ viewportH - REVEAL_MARGIN/,
    );
  });

  test("DR3e TripPreview renders dockedReserve as the LAST phone-body child (flush, no void)", () => {
    const payIdx = previewSrc.indexOf("Choose how you pay");
    const dockIdx = previewSrc.lastIndexOf("dockedReserve !== undefined");
    expect(payIdx).toBeGreaterThan(-1);
    expect(dockIdx).toBeGreaterThan(-1);
    expect(dockIdx).toBeGreaterThan(payIdx);
  });

  test("DR3f ParallaxCoverShell forwards onScroll + onLayout to the phone/native Scroll", () => {
    expect(shellSrc).toMatch(/onScroll\?:/);
    expect(shellSrc).toMatch(/onScrollViewLayout\?:/);
    // both phone branches wire onScroll + onLayout.
    const wired = shellSrc.match(/onScroll=\{onScroll\}/g) ?? [];
    expect(wired.length).toBeGreaterThanOrEqual(2);
  });

  test("DR3g the route no longer reserves a bar-sized paddingBottom void", () => {
    // the old `spacing.xl + 96 + insets.bottom` clearance (the void) is GONE.
    expect(routeSrc).not.toMatch(/spacing\.xl \+ 96 \+ insets\.bottom/);
    expect(routeSrc).toContain("contentBottomInset={spacing.md}");
  });

  // ── Behavioral replica of the route's floatingPillVisible predicate ──
  // MUST stay in lockstep with [tripSlug].tsx.
  const REVEAL_MARGIN = 24;
  const floatingPillVisible = (
    dockTopY: number | null,
    scrollY: number,
    viewportH: number,
  ): boolean => {
    if (dockTopY === null || viewportH === 0) return true;
    return dockTopY > scrollY + viewportH - REVEAL_MARGIN;
  };

  test("DR3h pill visible before measurement / below the fold / mid-scroll", () => {
    expect(floatingPillVisible(null, 0, 0)).toBe(true);
    expect(floatingPillVisible(2400, 0, 800)).toBe(true);
    expect(floatingPillVisible(2400, 1200, 800)).toBe(true);
  });

  test("DR3i pill HIDDEN once the docked button scrolls into view (at the end)", () => {
    expect(floatingPillVisible(2400, 1700, 800)).toBe(false);
    expect(floatingPillVisible(1576, 800, 800)).toBe(false);
    // one px before the threshold → still visible (no premature hide).
    expect(floatingPillVisible(1577, 800, 800)).toBe(true);
  });
});

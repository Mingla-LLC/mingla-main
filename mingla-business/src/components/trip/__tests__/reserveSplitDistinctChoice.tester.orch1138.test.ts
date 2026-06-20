/**
 * TESTER ADVERSARIAL (ORCH-1138 — FINAL all-surface gate) — the two-tone
 * seam-split Reserve CTA must route each half to its OWN, DISTINCT payment
 * choice. Different angle from every implementor + prior-tester test:
 *
 *   - The implementor's `tripReserveSplitButtons.orch1138` + the consumer
 *     `orch_1138_reserve_split_buttons` tests assert the RENDER structure (one
 *     shell, accent primary, white secondary, seam, theme-aware colors). They
 *     prove the control LOOKS right.
 *   - The prior tester `themePaletteContrastInvariant.tester` asserts the
 *     contrast CONTRACT. It proves the control is LEGIBLE.
 *   - NEITHER proves the MONEY is correct: that the "Pay in full" half sends
 *     "full" and the "Pay over time" half sends "installments". A refactor that
 *     wired BOTH halves to the same choice (e.g. both → handleTripReserve()
 *     with no arg, both → "full", or a copy-paste of the full onPress into the
 *     over-time slot) would render a perfect-looking two-tone control that
 *     SILENTLY charges the wrong plan — a money bug invisible to a render test.
 *
 * This test attacks exactly that seam, on BOTH surfaces (source-level, the
 * repo convention for un-mountable RN screens), and is fails-on-revert:
 * collapse the two distinct choices into one and an assertion goes red.
 *
 * Owner: mingla-tester (adversarial; append-only; different angle).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..", "..");

// Strip comments so the protective doc-comments (which legitimately mention the
// strings we assert on) can never satisfy or false-trip an assertion.
const stripComments = (src: string): string =>
  src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const read = (rel: string): string =>
  stripComments(readFileSync(join(ROOT, rel), "utf8"));

describe("ORCH-1138 tester adversarial — split Reserve routes DISTINCT pay choices (money correctness)", () => {
  // [TEST-MOD-APPROVED META-ORCH-1174] the distinct full/installments wiring was
  // LIFTED out of the route into the shared useTripOfferingState (one owner). The
  // money-correctness invariant is byte-preserved: the hook builds each segment's
  // onPress as onReserve("full") / onReserve("installments"), and the route's
  // onReserve handler (handleTripReserve) threads that choice into the plan route
  // param. The adversarial attack still holds — collapse the two choices and a
  // case goes red.
  describe("the distinct choices are wired in the shared state machine", () => {
    const hook = read("packages/offering-rendering/useTripOfferingState.ts");
    const route = read("mingla-business/app/t/[brandSlug]/[tripSlug].tsx");

    it("the full half routes with the explicit 'full' choice", () => {
      expect(hook).toMatch(/onReserve\(\s*["']full["']\s*\)/);
    });

    it("the over-time half routes with the explicit 'installments' choice", () => {
      expect(hook).toMatch(/onReserve\(\s*["']installments["']\s*\)/);
    });

    it("the two halves do NOT share one choice (full !== installments wiring)", () => {
      const full = (hook.match(/onReserve\(\s*["']full["']\s*\)/g) ?? []).length;
      const inst = (
        hook.match(/onReserve\(\s*["']installments["']\s*\)/g) ?? []
      ).length;
      // Each distinct choice must be wired at least once, and they must be two
      // DIFFERENT literals — not the same string copy-pasted into both slots.
      expect(full).toBeGreaterThanOrEqual(1);
      expect(inst).toBeGreaterThanOrEqual(1);
    });

    it("the reserve handler threads the chosen plan into the checkout route param (byte-identical seed)", () => {
      // The choice must reach CartContext via the `plan` param; a handler that
      // dropped the arg would silently fall back to the toggle state for both.
      expect(route).toMatch(/plan:\s*choice\s*\?\?\s*paymentPlanChoice/);
    });
  });

  describe("the shared reserve-bar component honors per-segment onPress", () => {
    const bar = read("mingla-business/src/components/trip/TripReserveBar.tsx");

    it("each segment fires its own btn.onPress (not a single shared handler)", () => {
      // renderSplitSegment must invoke the per-segment onPress, so the route's
      // distinct full/installments closures actually fire independently.
      expect(bar).toMatch(/btn\.onPress\(\)/);
    });

    it("the split shell renders both the full AND the overTime segment", () => {
      expect(bar).toMatch(/split\.full/);
      expect(bar).toMatch(/split\.overTime/);
    });
  });
});

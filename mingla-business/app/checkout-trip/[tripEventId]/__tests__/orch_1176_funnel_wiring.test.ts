/**
 * ORCH-1176 → SUPERSEDED BY ORCH-1178 [trip-checkout-always-cart-step].
 *
 * ORCH-1176 made the cart/quantity step conditional: multi-package trips kept it
 * (3 steps) while an effectively single-tier trip auto-skipped it (2 steps, via
 * `bookableTierCount(...) > 1 ? 3 : 2`). ORCH-1178 reverses that — the
 * cart/quantity step ALWAYS shows and STAYS for EVERY trip (single AND multi
 * tier), because a single-tier buyer was briefly shown the cart then yanked to
 * /buyer with no chance to edit quantity. So the `bookableTierCount`-derived
 * `totalSteps` is gone; the funnel is now index → buyer → [intake] → payment =
 * 3 steps (no intake) or 4 (intake), derived via `tripFunnelTotalSteps`.
 *
 * This suite is retargeted to the ORCH-1178 contract (the THREE checkout files):
 *   - index.tsx no longer auto-`router.replace`s to /buyer (both seed effects
 *     just latch + stay on the cart step).
 *   - buyer.tsx + payment.tsx derive totalSteps from `tripFunnelTotalSteps(...)`,
 *     NOT from `bookableTierCount`, and NOT a literal 2.
 *
 * Fails-on-revert via TRUE line deletion (restoring the router.replace / the
 * bookableTierCount derivation → these assertions fail).
 *
 * [TEST-MOD-APPROVED ORCH-1178]
 */

import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

const DIR = join(__dirname, "..");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
// Strip comments so prose mentioning a token never satisfies an assertion.
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("ORCH-1178 — trip checkout always shows the cart step (supersedes ORCH-1176 wiring)", () => {
  test("index.tsx no longer auto-navigates to /buyer (both seed effects stay on the cart step)", () => {
    const src = strip(read("index.tsx"));
    // The auto-skip + multi-seed effects must NOT router.replace to /buyer.
    expect(src).not.toMatch(/router\.replace\(\s*`\/checkout-trip\/\$\{tripEventId\}\/buyer`/);
    // The bookableTierCount import + gate are gone (the multi-seed branch deleted).
    expect(src).not.toContain('from "./bookableTierCount"');
    expect(src).not.toMatch(/if \(bookableCount > 1\)/);
    // The cart step derives its total from the intake-aware helper.
    expect(src).toContain('import { tripFunnelTotalSteps } from "./tripFunnelSteps"');
    expect(src).toMatch(/totalSteps\s*=\s*tripFunnelTotalSteps\(/);
  });

  test("buyer.tsx derives totalSteps from tripFunnelTotalSteps (no bookableTierCount, no literal 2)", () => {
    const src = strip(read("buyer.tsx"));
    expect(src).not.toContain('from "./bookableTierCount"');
    expect(src).toContain('import { tripFunnelTotalSteps } from "./tripFunnelSteps"');
    expect(src).toMatch(/totalSteps\s*=\s*tripFunnelTotalSteps\(/);
    expect(src).toContain("totalSteps={totalSteps}");
    // buyer is step 2 of N → stepIndex 1 (the latent "1 OF" bug fixed).
    expect(src).toContain("stepIndex={1}");
    expect(src).not.toMatch(/totalSteps=\{2\}/);
  });

  test("payment.tsx derives totalSteps + last-step index from tripFunnelSteps (no bookableTierCount, no literal 2)", () => {
    const src = strip(read("payment.tsx"));
    expect(src).not.toContain('from "./bookableTierCount"');
    expect(src).toMatch(/tripFunnelTotalSteps,\s*tripPaymentStepIndex,/);
    expect(src).toMatch(/totalSteps\s*=\s*tripFunnelTotalSteps\(/);
    expect(src).toMatch(/paymentStepIndex\s*=\s*tripPaymentStepIndex\(/);
    expect(src).toContain("totalSteps={totalSteps}");
    // payment is the LAST step → stepIndex is the derived N-1 (was the latent
    // "2 OF" bug: hardcoded stepIndex 1).
    expect(src).toContain("stepIndex={paymentStepIndex}");
    expect(src).not.toMatch(/totalSteps=\{2\}/);
  });
});

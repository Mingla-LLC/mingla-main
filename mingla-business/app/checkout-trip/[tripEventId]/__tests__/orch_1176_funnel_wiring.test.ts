/**
 * ORCH-1176 [trip-multipkg-checkout-wizard] — source-contract wiring proof. The
 * pure gate logic is exercised in orch_1176_multitier_cart_step.test.ts; this
 * proves the THREE checkout files actually consume it:
 *   - index.tsx multi-seed effect gates the /buyer auto-advance on
 *     bookableTierCount(...) > 1 (stay on index for multi-package).
 *   - buyer.tsx + payment.tsx DERIVE totalSteps from bookableTierCount instead of
 *     the old hardcoded `totalSteps={2}`.
 *
 * Fails-on-revert via TRUE line deletion (restore the unconditional
 * router.replace / the literal totalSteps={2} → these assertions fail).
 */

import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

const DIR = join(__dirname, "..");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
// Strip comments so prose mentioning a token never satisfies an assertion.
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("ORCH-1176 — funnel wiring consumes bookableTierCount", () => {
  test("index.tsx gates the multi-seed auto-advance on bookable tier count > 1", () => {
    const src = strip(read("index.tsx"));
    expect(src).toContain('import { bookableTierCount } from "./bookableTierCount"');
    // The seed effect computes the bookable count from the real tiers ...
    expect(src).toMatch(/bookableTierCount\(\s*trip\.pricingTiers\.map\(tierToTicketStub\)/);
    // ... and stays on index (returns WITHOUT router.replace) when > 1.
    expect(src).toMatch(/if \(bookableCount > 1\) \{[\s\S]*?return;/);
  });

  test("buyer.tsx derives totalSteps from bookableTierCount (no hardcoded 2)", () => {
    const src = strip(read("buyer.tsx"));
    expect(src).toContain('import { bookableTierCount } from "./bookableTierCount"');
    expect(src).toMatch(/const totalSteps: 2 \| 3 =[\s\S]*?bookableTierCount\(/);
    expect(src).toMatch(/\? 3\s*\n?\s*: 2/);
    // The header reads the derived value, not a literal.
    expect(src).toContain("totalSteps={totalSteps}");
    // No surviving hardcoded totalSteps={2} on a CheckoutHeader.
    expect(src).not.toMatch(/totalSteps=\{2\}/);
  });

  test("payment.tsx derives totalSteps from bookableTierCount (no hardcoded 2)", () => {
    const src = strip(read("payment.tsx"));
    expect(src).toContain('import { bookableTierCount } from "./bookableTierCount"');
    expect(src).toMatch(/const totalSteps: 2 \| 3 =[\s\S]*?bookableTierCount\(/);
    expect(src).toContain("totalSteps={totalSteps}");
    expect(src).not.toMatch(/totalSteps=\{2\}/);
  });
});

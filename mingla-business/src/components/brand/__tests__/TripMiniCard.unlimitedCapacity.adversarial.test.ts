/**
 * ORCH-0963 T-05 ADVERSARIAL — unlimited-capacity null-spots-left honesty.
 *
 * Attacks a DIFFERENT angle than T-03/T-04 (tab-label / placement contracts):
 * verifies the TripMiniCard spotsLabel logic NEVER renders "null", "undefined",
 * or "null spots left" when trip.spotsLeft === null (unlimited capacity).
 *
 * Why this is the adversarial angle: the naive implementation is
 * `${trip.spotsLeft} spots left` — which compiles, type-checks, and ships
 * "null spots left" to production. SC-2 forbids it; T-05 catches it.
 *
 * Fails-on-revert: changing the spotsLabel branch to `\`${trip.spotsLeft} spots left\``
 * (or removing the null check) FAILs assertion T-05a.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("ORCH-0963 T-05 ADVERSARIAL — TripMiniCard unlimited-capacity honesty", () => {
  // ORCH-1062 [TEST-MOD-APPROVED ORCH-1062] — REPAIR (not removal): the
  // TripMiniCard component moved out of mingla-business/src/components/brand/
  // PublicBrandPage.tsx (now a thin wrapper) into the shared
  // @mingla/brand-rendering package's PublicBrandPage.tsx, and the spotsLabel
  // logic was refactored from a `useMemo` into an equivalent plain-const ternary.
  // The behavior these adversarial pins guard (unlimited-capacity honesty:
  // spotsLeft===null → null, no "null spots left"; sold-out; pluralization;
  // scarcity threshold 5) is load-bearing (Constitution #9 fabricated
  // affordance) with NO other behavioral coverage, so the pins are re-pointed at
  // the moved source and updated to the current shape — every invariant kept.
  const pageSrc = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "packages",
      "brand-rendering",
      "PublicBrandPage.tsx",
    ),
    "utf8",
  );

  // Extract the TripMiniCard component body.
  const tripCardBody = (() => {
    const m = pageSrc.match(
      /const\s+TripMiniCard:\s*React\.FC<\{[\s\S]*?\}>\s*=\s*\(\{[\s\S]*?\}\)\s*=>\s*\{[\s\S]*?\n\};\n/,
    );
    if (m === null) throw new Error("TripMiniCard body not found");
    return m[0];
  })();

  test("T-05a spotsLabel returns null when spotsLeft === null (unlimited)", () => {
    // The null-branch MUST come FIRST in the spotsLabel derivation. If a future
    // patch removes it, fallback `${trip.spotsLeft}` interpolation prints "null".
    expect(tripCardBody).toMatch(
      /spotsLabel\s*=\s*trip\.spotsLeft\s*===\s*null\s*\?\s*null/,
    );
  });

  test("T-05b no naive interpolation `${trip.spotsLeft} spots left` exists in the file", () => {
    // The naive template literal would print "null spots left" when spotsLeft
    // is null. Guard against any direct interpolation without a null check.
    expect(pageSrc).not.toMatch(/`\$\{trip\.spotsLeft\}\s+spots?\s+left`/);
    expect(pageSrc).not.toMatch(/\{trip\.spotsLeft\}\s+spots?\s+left/);
  });

  test("T-05c spotsLabel uses pluralization helper for 1 vs N spots", () => {
    // Reject "spot left" without the conditional pluralization.
    expect(tripCardBody).toMatch(
      /trip\.spotsLeft\s*===\s*1\s*\?\s*"spot"\s*:\s*"spots"/,
    );
  });

  test("T-05d sold-out branch returns 'Sold out' (not '0 spots left')", () => {
    expect(tripCardBody).toMatch(
      /trip\.spotsLeft\s*===\s*0\s*\?\s*"Sold out"/,
    );
  });

  test("T-05e scarcity threshold pinned at 5 (non-scarce capacity shows no badge)", () => {
    expect(tripCardBody).toMatch(/trip\.spotsLeft\s*<=\s*5/);
    // Above-threshold (spotsLeft > 5) falls through to null → no scarcity badge.
    expect(tripCardBody).toMatch(/trip\.spotsLeft\s*<=\s*5[\s\S]*?:\s*null;/);
  });
});

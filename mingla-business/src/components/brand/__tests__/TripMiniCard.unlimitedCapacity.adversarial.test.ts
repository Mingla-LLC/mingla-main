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
  const pageSrc = readFileSync(
    join(__dirname, "..", "PublicBrandPage.tsx"),
    "utf8",
  );

  // Extract the TripMiniCard component body.
  const tripCardBody = (() => {
    const m = pageSrc.match(
      /const\s+TripMiniCard:\s*React\.FC<TripMiniCardProps>\s*=\s*\(\{[\s\S]*?\n\};\n/,
    );
    if (m === null) throw new Error("TripMiniCard body not found");
    return m[0];
  })();

  test("T-05a spotsLabel returns null when spotsLeft === null (unlimited)", () => {
    // The null-branch MUST come FIRST in the spotsLabel memo. If a future
    // patch removes it, fallback `${trip.spotsLeft}` interpolation prints "null".
    expect(tripCardBody).toMatch(
      /spotsLabel\s*=\s*useMemo<string\s*\|\s*null>\(\(\)\s*=>\s*\{\s*if\s*\(\s*trip\.spotsLeft\s*===\s*null\s*\)\s*return\s+null;/,
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
      /if\s*\(\s*trip\.spotsLeft\s*===\s*0\s*\)\s*return\s+"Sold out"/,
    );
  });

  test("T-05e scarcity threshold pinned at 5 (non-scarce capacity shows no badge)", () => {
    expect(tripCardBody).toMatch(/trip\.spotsLeft\s*<=\s*5/);
    // Above-threshold returns null (no badge).
    expect(tripCardBody).toMatch(/return\s+null;\s*\}\s*,\s*\[trip\.spotsLeft\]/);
  });
});

/**
 * META-ORCH-1235 (I-PROPOSED-1235-C) — no unbounded full-screen spinner.
 *
 * NOTE: like the sibling BrandProfileView.orch_1121 test, this suite is a
 * SOURCE-LEVEL assertion. The mingla-business jest environment cannot render RN
 * components (their transitive native imports do not transform under this Node
 * config), so we assert on the component/route SOURCE that the bounded error +
 * Retry path is wired — the strict-grep gate
 * (i-proposed-1235-c-loading-gate-has-error-retry.mjs) is the parallel CI guard.
 *
 * Fails-on-revert: drop the `isError` error+Retry branch (or the route's
 * onRetry → refetch wiring) and these assertions fail.
 */
import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const read = (rel: string): string =>
  readFileSync(path.join(__dirname, rel), "utf8");

describe("META-ORCH-1235 — brand profile gate has a bounded error + Retry", () => {
  const view = read("../BrandProfileView.tsx");
  const route = read("../../../../app/brand/[id]/index.tsx");

  test("BrandProfileView renders an error state with a Retry button when brand is null AND isError", () => {
    // The error branch must precede the spinner/not-found and gate on isError.
    expect(view).toMatch(/brand === null && isError/);
    expect(view).toMatch(/testID="brand-profile-retry"/);
    // Retry is wired to the onRetry callback (→ route's refetch()).
    expect(view).toMatch(/onPress=\{\(\) => onRetry\?\.\(\)\}/);
  });

  test("BrandProfileView still has the bounded loading spinner branch", () => {
    expect(view).toMatch(/brand === null && isResolving/);
    expect(view).toMatch(/testID="brand-profile-loading"/);
  });

  test("brand/[id] route passes isError + an onRetry that calls brandQuery.refetch()", () => {
    expect(route).toMatch(/isError=\{brandQuery\.isError\}/);
    expect(route).toMatch(/brandQuery\.refetch\(\)/);
  });
});

describe("META-ORCH-1235 — Hub experiences & trips gates have a Retry → refetch", () => {
  const experiences = read("../../../../app/(tabs)/hub/experiences.tsx");
  const trips = read("../../../../app/(tabs)/hub/trips.tsx");

  test("experiences isError branch has a Retry wired to refetch()", () => {
    expect(experiences).toMatch(/experiencesQuery\.isError/);
    expect(experiences).toMatch(/testID="experiences-error-retry"/);
    expect(experiences).toMatch(/experiencesQuery\.refetch\(\)/);
  });

  test("trips isError branch has a Retry wired to refetch()", () => {
    expect(trips).toMatch(/tripsQuery\.isError/);
    expect(trips).toMatch(/testID="trips-error-retry"/);
    expect(trips).toMatch(/tripsQuery\.refetch\(\)/);
  });
});

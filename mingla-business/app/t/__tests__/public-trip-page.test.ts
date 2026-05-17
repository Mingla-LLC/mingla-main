/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] — public anon trip page contract.
 *
 * Asserts the /t/[brandSlug]/[tripSlug] route is anon-tolerant per
 * feedback_anon_buyer_routes.md:
 *   - No useAuth import (would force sign-in)
 *   - No router.replace to /(auth) / sign-in redirect
 *   - Mounts TripPreview + TripCheckoutFlow
 *   - Uses usePublicTripBySlug (anon-tolerant fetch hook)
 *   - Handles loading + error + not-found states honestly
 *
 * Fails-on-revert: if useAuth is accidentally added to the public route
 * (which would gate the page behind sign-in and break the share-link flow),
 * test A-PUBLIC-1 fails.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const publicRouteSource = readFileSync(
  join(__dirname, "..", "[brandSlug]", "[tripSlug].tsx"),
  "utf-8",
);
const publicHookSource = readFileSync(
  join(__dirname, "..", "..", "..", "src", "hooks", "usePublicTripBySlug.ts"),
  "utf-8",
);

describe("ORCH-0859 — /t/{brandSlug}/{tripSlug} public anon route contract", () => {
  test("A-PUBLIC-1: route does NOT import or call useAuth (anon-tolerant)", () => {
    // JSDoc may mention "useAuth" as a discipline note; we only flag actual
    // imports or call-sites. Match either `import ... useAuth ... from`
    // (named import) or `useAuth(` (call site).
    expect(publicRouteSource).not.toMatch(/^import[\s\S]*\buseAuth\b[\s\S]*from/m);
    expect(publicRouteSource).not.toMatch(/\buseAuth\s*\(/);
  });

  test("A-PUBLIC-2: route does NOT redirect to sign-in / (auth)", () => {
    expect(publicRouteSource).not.toMatch(/router\.replace.*\(auth\)/);
    expect(publicRouteSource).not.toMatch(/router\.push.*\(auth\)/);
    expect(publicRouteSource).not.toMatch(/router\.replace.*sign-in/);
  });

  test("A-PUBLIC-3: route mounts TripPreview", () => {
    expect(publicRouteSource).toMatch(/<TripPreview/);
  });

  test("A-PUBLIC-4: route mounts TripCheckoutFlow", () => {
    expect(publicRouteSource).toMatch(/<TripCheckoutFlow/);
  });

  test("A-PUBLIC-5: route uses usePublicTripBySlug hook", () => {
    expect(publicRouteSource).toMatch(/usePublicTripBySlug/);
  });

  test("A-PUBLIC-6: route handles loading, error, and not-found states", () => {
    expect(publicRouteSource).toMatch(/isLoading/);
    expect(publicRouteSource).toMatch(/isError/);
    expect(publicRouteSource).toMatch(/Trip not found|null|undefined/);
  });

  test("A-PUBLIC-7: usePublicTripBySlug hook does NOT import or call useAuth", () => {
    expect(publicHookSource).not.toMatch(/^import[\s\S]*\buseAuth\b[\s\S]*from/m);
    expect(publicHookSource).not.toMatch(/\buseAuth\s*\(/);
  });

  test("A-PUBLIC-8: usePublicTripBySlug filters status to scheduled+live only (no draft leakage)", () => {
    // Draft trips must not surface on public route — RLS + query both enforce
    expect(publicHookSource).toMatch(
      /\.in\(\s*"status"\s*,\s*\[\s*"scheduled"\s*,\s*"live"\s*\]/,
    );
  });
});

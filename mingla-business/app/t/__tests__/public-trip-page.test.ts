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

  // [TEST-MOD-APPROVED META-ORCH-1174] — Leg A.2 wired this hook onto the single
  // canonical anon RPC `pg_public_trip_by_slug`, retiring the client-side
  // `.in("status", ["scheduled","live"])` query filter. The no-draft-leakage
  // invariant now lives SERVER-SIDE in the RPC (`e.status = ANY(ARRAY['scheduled',
  // 'live'])` + `e.event_type='trip'`), so this test re-points to assert (a) the
  // hook reads the RPC and (b) the RPC migration enforces the status filter.
  test("A-PUBLIC-8: usePublicTripBySlug reads the canonical RPC, which filters status to scheduled+live only (no draft leakage)", () => {
    // (a) the hook is wired onto the single-source RPC.
    expect(publicHookSource).toMatch(
      /supabase\.rpc\(\s*["']pg_public_trip_by_slug["']/,
    );
    // (b) the RPC migration enforces the no-draft-leakage status filter server-side.
    const rpcMigration = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20261017000000_meta_orch_1174_pg_public_trip_by_slug.sql",
      ),
      "utf-8",
    );
    expect(rpcMigration).toMatch(
      /e\.status\s*=\s*ANY\s*\(\s*ARRAY\['scheduled'::text,\s*'live'::text\]\)/,
    );
    expect(rpcMigration).toMatch(/e\.event_type\s*=\s*'trip'/);
  });

  // ORCH-1114 — the Share control must route through the web-aware ShareModal,
  // NOT bare react-native Share.share (which dead-taps on react-native-web when
  // navigator.share is undefined). Fails-on-revert: reverting to Share.share
  // flips both the .toMatch(<ShareModal) and the .not.toMatch(Share.share).
  test("A-PUBLIC-9: trip share routes through ShareModal, not bare Share.share", () => {
    expect(publicRouteSource).toMatch(/<ShareModal/);
    expect(publicRouteSource).toMatch(/setShareModalVisible/);
    expect(publicRouteSource).toMatch(/tripPublicUrl\(/);
    expect(publicRouteSource).not.toMatch(/\bShare\.share\b/);
    expect(publicRouteSource).not.toMatch(
      /^import[\s\S]*\bShare\b[\s\S]*from ["']react-native["']/m,
    );
  });
});

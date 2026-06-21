/**
 * ORCH-1164 (#507 regression recovery) — IMPLEMENTOR happy-path regression test.
 *
 * PROVES the anon web TRIP page (/t/{brandSlug}/{tripSlug}) can load for a
 * logged-out buyer without a `42501 permission denied for table brands` (HTTP
 * 401) abort on the brand-theme columns.
 *
 * [TEST-MOD-APPROVED META-ORCH-1174] — Leg A.2 (Seth single-source decision)
 * REWIRED usePublicTripBySlug onto the ONE canonical anon RPC
 * `pg_public_trip_by_slug` (SECURITY DEFINER, GRANT anon). The hook no longer
 * issues ANY direct `supabase.from("brands")` read, and no longer needs the
 * `business_public_events_view` theme detour — the definer RPC owner reads
 * brands.theme_color/font/animation directly and emits them in its payload,
 * structurally sidestepping the anon column-grant gap that caused #507.
 *
 * The original guard asserted the hook's direct brands select listed only
 * anon-granted columns + sourced theme from the view. That detour is now GONE,
 * so the guard is re-pointed to the STRONGER post-Leg-A.2 invariant:
 *   • the hook reads the canonical RPC (single source), and
 *   • the hook makes ZERO direct `.from("brands")` read (so there is no brand
 *     column-grant surface for anon to 401 on at all).
 *
 * FAILS-ON-REVERT: re-introducing a direct `.from("brands").select(...)` (which
 * is exactly what re-opened the #507 theme-column 401 surface) makes the
 * no-direct-brands assertion FAIL; dropping the RPC call fails the single-source
 * assertion.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TRIP_HOOK = resolve(__dirname, "..", "usePublicTripBySlug.ts");
const src = readFileSync(TRIP_HOOK, "utf8");
// Strip JSDoc + line comments so the header's prose (which legitimately NAMES the
// now-retired `business_public_events_view` detour to explain why it's gone)
// never false-positives an ACTIVE-code assertion below.
const activeCode = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("ORCH-1164 / META-ORCH-1174 — anon can load the public trip page", () => {
  test("the trip hook reads the canonical pg_public_trip_by_slug RPC (single source)", () => {
    expect(activeCode).toMatch(/supabase\.rpc\(\s*["']pg_public_trip_by_slug["']/);
  });

  test("the trip hook makes ZERO direct brands-table read (no anon column-grant 401 surface — #507 closed)", () => {
    // Any `.from("brands")` reopens the exact column-grant surface #507 broke.
    expect(activeCode).not.toMatch(/\.from\(\s*["']brands["']\s*\)/);
  });

  test("the trip hook no longer needs the business_public_events_view theme detour (definer RPC reads theme directly)", () => {
    // The COMMS-0009 view detour is retired for this hook; theme rides the RPC.
    expect(activeCode).not.toContain("business_public_events_view");
    expect(activeCode).not.toMatch(/fetchBrandThemeFromView\s*\(/);
  });
});

/**
 * ORCH-0963 T-10 ADVERSARIAL (tester-authored) — cancelled-trip MUST NOT
 * leak into either tab body.
 *
 * Attacks a DIFFERENT angle than the implementor's 4 adversarial files:
 *   - T-05 null-spots-left (UI null-handling)
 *   - T-06 bookings-closed precedence (badge ordering)
 *   - T-07 RPC anti-leak (brand-kind boundary)
 *   - T-08 pin-CTA count (sticky-pill scope)
 *   - T-09 past-cap (list-rendering bounds)
 *
 * The cancelled-trip-leak angle is structurally distinct:
 *
 * The RPC `pg_public_trips_by_brand` deliberately INCLUDES rows where
 * `status='cancelled'` in its WHERE clause (so the page COULD render a
 * "we're cancelling these trips for X reason" archive sub-tab in the
 * future). The component's defense is that BOTH memos (upcomingTrips
 * AND pastTrips) filter explicitly:
 *
 *   - upcomingTrips: `t.status === "scheduled" || t.status === "live"`
 *   - pastTrips:     `t.status === "ended"`
 *
 * Neither filter admits 'cancelled'. If a future refactor consolidates
 * these into a single `isTripActive(t)` helper, OR if either filter
 * regresses to a broader predicate (e.g. `t.status !== "draft"`),
 * cancelled trips silently leak into the user-facing UI — violating
 * Constitution #9 (no fabricated affordances): visitors would see and
 * tap a card that resolves to a cancelled trip.
 *
 * This test pins the exact-status filter shape AND the RPC's deliberate
 * inclusion of cancelled rows — so the two layers stay in tension and
 * any single-layer regression is caught.
 *
 * Fails-on-revert proof: changing `t.status === "scheduled" || t.status
 * === "live"` to `t.status !== "ended" && t.status !== "cancelled" ?
 * Wait — even THAT would still work. The naive regression is
 * `t.status !== "ended"` which would admit cancelled — FAIL on T-10b.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("ORCH-0963 T-10 ADVERSARIAL — cancelled-trip MUST NOT leak", () => {
  const pageSrc = readFileSync(
    join(__dirname, "..", "PublicBrandPage.tsx"),
    "utf8",
  );
  const migrationSrc = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "supabase",
      "migrations",
      "20260729000000_meta_orch_0972_universal_authoring.sql",
    ),
    "utf8",
  );

  test("T-10a RPC SQL deliberately INCLUDES 'cancelled' in the WHERE clause", () => {
    // The two-layer defense relies on the server bringing cancelled rows
    // down (so they can be displayed in a future archive view) AND the
    // client filtering them out (because today's UI has no archive tab).
    // If the server-side filter ever ADDS a 'cancelled' exclusion, the
    // two layers fall out of sync and a future archive UI would render
    // empty without anyone noticing — flag as a coordinated change.
    expect(migrationSrc).toMatch(
      /e\.status\s+IN\s*\(\s*'scheduled'\s*,\s*'live'\s*,\s*'ended'\s*,\s*'cancelled'\s*\)/i,
    );
  });

  test("T-10b upcomingTrips memo admits ONLY 'scheduled' OR 'live' (cancelled and ended are filtered)", () => {
    const memo = pageSrc.match(
      /const\s+upcomingTrips\s*=\s*useMemo<PublicTripCard\[\]>\([\s\S]*?\}\,\s*\[trips\]\);/,
    );
    expect(memo).not.toBeNull();
    // Pin the EXACT filter — not a broader negation that could let cancelled slip in.
    expect(memo![0]).toMatch(
      /\.filter\(\(t\)\s*=>\s*t\.status\s*===\s*"scheduled"\s*\|\|\s*t\.status\s*===\s*"live"\)/,
    );
    // Defense in depth: reject any predicate that uses negation (`!==`) which
    // could silently admit cancelled if the negation set is incomplete.
    expect(memo![0]).not.toMatch(/t\.status\s*!==/);
  });

  test("T-10c pastTrips memo admits ONLY 'ended' (cancelled and live are filtered)", () => {
    const memo = pageSrc.match(
      /const\s+pastTrips\s*=\s*useMemo<PublicTripCard\[\]>\([\s\S]*?\}\,\s*\[providedPastTrips,\s*trips\]\);/,
    );
    expect(memo).not.toBeNull();
    // Exact positive match for 'ended' only.
    expect(memo![0]).toMatch(/\.filter\(\(t\)\s*=>\s*t\.status\s*===\s*"ended"\)/);
    // No broadening to "anything not scheduled/live".
    expect(memo![0]).not.toMatch(/t\.status\s*!==/);
  });

  test("T-10d cancelled is the only RPC-supported status the UI rejects in BOTH tabs (defense-in-depth pin)", () => {
    // RPC returns rows for 'scheduled', 'live', 'ended', 'cancelled'.
    // Component memos absorb: upcoming gets {scheduled, live}, past gets {ended}.
    // The disjoint union covers 3 of the 4 statuses. The 4th — 'cancelled' —
    // intentionally falls through both filters and reaches no UI surface.
    // This test pins that the missing status is exactly 'cancelled' (no other
    // gap exists that would mean a published trip silently disappears).
    const rpcStatuses = ["scheduled", "live", "ended", "cancelled"];
    const upcomingMemo = pageSrc.match(
      /const\s+upcomingTrips\s*=\s*useMemo[\s\S]*?\}\,\s*\[trips\]\);/,
    );
    const pastMemo = pageSrc.match(
      /const\s+pastTrips\s*=\s*useMemo[\s\S]*?\}\,\s*\[providedPastTrips,\s*trips\]\);/,
    );
    expect(upcomingMemo).not.toBeNull();
    expect(pastMemo).not.toBeNull();
    const combined = upcomingMemo![0] + " " + pastMemo![0];
    const admitted = rpcStatuses.filter((s) => combined.includes(`"${s}"`));
    // Exactly 3 statuses (scheduled, live, ended) admitted; 'cancelled'
    // NEVER appears in either filter.
    expect(admitted.sort()).toEqual(["ended", "live", "scheduled"]);
    expect(combined).not.toContain('"cancelled"');
  });

  test("T-10e empty-state copy is honest ('No upcoming trips yet', not 'No active trips') so a trip-planner mid-cancellation isn't misrepresented", () => {
    // Constitution #9: if all trips were cancelled, the tab body MUST say
    // "No upcoming trips yet" — not "No trips" or "We have trips but
    // they're cancelled" or any phrasing that fabricates a state the data
    // doesn't carry. Pin the exact copy.
    expect(pageSrc).toMatch(/No upcoming trips yet/);
    expect(pageSrc).toMatch(/Past trips/);
    // No user-facing copy that mentions cancellation state — would imply
    // a hidden archive surface that doesn't exist. The string identifier
    // `"cancelled"` is allowed inside filter predicates / status checks
    // (e.g. `e.status === "cancelled"`), but a Text/Label/heading/Pressable
    // containing the word "cancelled" would be a UI fabrication.
    //
    // Allowlist: any single-line string literal mentioning "cancelled"
    // MUST equal exactly `"cancelled"` (i.e. used as a status enum
    // comparand) — never as user-visible copy. Strip comment blocks
    // first so `*` characters inside JSDoc don't terminate our literal-regex
    // search.
    const srcWithoutComments = pageSrc.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const cancelledLiterals = srcWithoutComments.match(/"[^"\n]*[Cc]ancelled[^"\n]*"/g) ?? [];
    for (const lit of cancelledLiterals) {
      expect(lit.toLowerCase()).toBe('"cancelled"');
    }
  });

  test("T-10f trip card tap navigates regardless of status — but a cancelled trip never reaches the card", () => {
    // The Pressable onPress is unconditional. If a cancelled trip somehow
    // reached <TripMiniCard> (via test fixture or future bug), the user
    // would still navigate to /t/{brandSlug}/{tripSlug}, where the trip
    // detail page is expected to surface the "this trip is cancelled"
    // state honestly. This test pins the unconditional onPress so we
    // don't introduce a status-based dead-tap guard on the card itself —
    // that would violate Constitution #1.
    const cardBody = pageSrc.match(
      /const\s+TripMiniCard:\s*React\.FC<TripMiniCardProps>[\s\S]*?\n\};/,
    );
    expect(cardBody).not.toBeNull();
    expect(cardBody![0]).toMatch(/<Pressable\s+onPress=\{\(\)\s*=>\s*onPress\(trip\)\}/);
    // No `disabled={trip.status === 'cancelled'}` short-circuit.
    expect(cardBody![0]).not.toMatch(/disabled=\{trip\.status/);
  });
});

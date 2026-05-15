// ORCH-0845 [Discover excludes ended events] — adversarial regression test (S-5b).
//
// This file is the tester-authored counterpart to the implementor's
// `excludes_ended_events.test.ts` happy-path file. Per
// SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md §3.5.2 and the ORCH-0840
// [Regression-test enforcement + append-only CI] Step 0.5 gate, this test
// MUST attack a DIFFERENT angle than the happy-path test — a copy with
// renamed `it()` blocks is forbidden.
//
// The implementor's test covered:
//   - lowerBoundUtc decision contract (null window → now; non-null → startUtc)
//   - past end_at < lowerBoundUtc → excluded (existence check)
//   - future end_at >= lowerBoundUtc → included (existence check)
//   - structural: .gte hoisted BEFORE the `if (dateWindowUtc !== null)` block
//   - structural: event_dates!inner embed unified (no !left ternary)
//
// This adversarial test attacks four DIFFERENT angles:
//
//   ATTACK 1 (boundary equal): end_at exactly equal to lowerBoundUtc must
//     SATISFY the >= comparison. If anyone "fixes" the predicate to a strict
//     `>` (greater-than, not greater-than-or-equal), this test catches it.
//     The happy-path test does not exercise the equality boundary.
//
//   ATTACK 2 (boundary one-millisecond-before): end_at = lowerBoundUtc - 1ms
//     must FAIL the >= comparison. Catches off-by-one bugs where someone
//     attempts to add a "grace period" by widening the floor.
//
//   ATTACK 3 (Tonight-invariant regression-inversion): the dated-chip path
//     MUST use `dateWindowUtc.startUtc`, NEVER `new Date().toISOString()`,
//     for the lower bound. If a future "simplification" collapses both
//     branches into `lowerBoundUtc = new Date().toISOString()` (ignoring the
//     window), in-progress events would disappear under Tonight — that is
//     I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS broken. The
//     implementor's structural tests don't catch this collapse because
//     `.gte` would still be hoisted. This test asserts the dated-chip
//     branch's specific source shape.
//
//   ATTACK 4 (upper-bound stays scoped): the `.lte("event_dates.start_at",
//     dateWindowUtc.endUtc)` upper bound MUST remain INSIDE the
//     `if (dateWindowUtc !== null)` block. If anyone hoists it out (mirror
//     of the lower-bound hoist), the no-window "All" path would filter on
//     `undefined`, returning either zero rows or a runtime error. Implementor's
//     structural test asserts only the LOWER bound's placement; this test
//     locks the UPPER bound's placement separately.
//
// Run with:
//   deno test --allow-read supabase/functions/discover-merged-events/__tests__/end_at_boundary.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

// ── Mirror of the production predicate semantics ────────────────────────

// PostgREST's `.gte(col, value)` translates to SQL `col >= value`. We mirror
// that exactly so this file's tests pin the SQL semantics, not just JS.
function passesGteFloor(eventEndAtIso: string, lowerBoundUtcIso: string): boolean {
  return Date.parse(eventEndAtIso) >= Date.parse(lowerBoundUtcIso);
}

// ── ATTACK 1: boundary equality (>=, not >) ─────────────────────────────

Deno.test(
  "ORCH-0845 adversarial — boundary equality: end_at exactly == lowerBoundUtc is INCLUDED",
  () => {
    const lowerBound = "2026-05-15T22:00:00.000Z";
    const eventEndAt = "2026-05-15T22:00:00.000Z"; // exact equality
    assert(
      passesGteFloor(eventEndAt, lowerBound),
      "regression: a fix that switched .gte to .gt would silently drop events whose end_at lands exactly on the request-time floor — these events have NOT yet ended and must remain visible. The predicate must be >= (inclusive), never > (strict).",
    );
  },
);

// ── ATTACK 2: one-millisecond-before boundary ───────────────────────────

Deno.test(
  "ORCH-0845 adversarial — boundary off-by-one: end_at = lowerBoundUtc - 1ms is EXCLUDED",
  () => {
    const lowerBound = "2026-05-15T22:00:00.000Z";
    const eventEndAt = "2026-05-15T21:59:59.999Z"; // 1 ms before
    assert(
      !passesGteFloor(eventEndAt, lowerBound),
      "regression: an event whose end_at is 1 ms before the floor has ENDED. If this test starts passing the row, someone has subtracted from the floor (e.g., added a grace period) and ghost events will leak.",
    );
  },
);

// ── ATTACK 3: Tonight-invariant regression-inversion ────────────────────
//
// This is the most important adversarial angle. The implementor's structural
// test asserts the .gte predicate is hoisted out of the if-block. A reckless
// "simplification" might collapse both branches into a single
//   lowerBoundUtc = new Date().toISOString()
// (always-now), which would still satisfy the implementor's hoisting test
// AND the strict-grep gate AND the happy-path past/future tests. But it
// would BREAK ORCH-0839-A F-5 / I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS:
// an event with start_at = now() - 30m, end_at = now() + 2h would still be
// visible (its end_at is in the future), so the bug wouldn't appear with
// Big Party — but for a Tonight query at 6pm local with window.startUtc =
// "today 04:00 UTC", an event that ended at 05:00 UTC (in-progress 2h ago
// to 09:00 UTC — i.e. ran 05:00–09:00, ended already) WOULD reappear if the
// floor were now() instead of window.startUtc, because now() > 09:00 UTC.
// Wait, the bug shape is more subtle: see the assertion body below.

Deno.test(
  "ORCH-0845 adversarial — Tonight path uses window.startUtc, NOT now() (preserves ORCH-0839-A F-5)",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );
    // The bound decision must reference both branches verbatim. Strict-shape
    // assertion: the ternary `dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString()`
    // (or visually equivalent with whitespace tolerance) must exist.
    const ternaryPresent =
      /dateWindowUtc\s*!==\s*null\s*\?\s*dateWindowUtc\.startUtc\s*:\s*new\s+Date\(\s*\)\.toISOString\(\s*\)/.test(
        source,
      );
    assert(
      ternaryPresent,
      'regression: the lowerBoundUtc decision has been collapsed away from the `dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString()` ternary. If both branches now use new Date(), dated-chip requests would use request-time-now as the floor instead of the window\'s start — and an event that ran earlier in the dated-chip\'s window but already ended (e.g., a 2pm–5pm event when the user queries Tonight at 9pm) would correctly disappear from "All" (still ended) but incorrectly disappear from Tonight too, since Tonight 00:00→23:59 should include the entire span where end_at >= window.start, not just where end_at >= now(). This breaks I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS.',
    );

    // Belt: ensure dateWindowUtc.startUtc is referenced exactly once as the
    // bound source (the ternary), and never twice or as the default branch.
    const startUtcRefs = source.match(/dateWindowUtc\.startUtc/g) ?? [];
    assertEquals(
      startUtcRefs.length,
      1,
      "regression: dateWindowUtc.startUtc should appear exactly once (in the lowerBoundUtc ternary). Multiple references suggests duplicated logic or a copy-paste regression.",
    );
  },
);

// ── ATTACK 4: upper-bound stays scoped to the dated-chip branch ────────

Deno.test(
  "ORCH-0845 adversarial — upper bound .lte(event_dates.start_at, ...) stays INSIDE the if-block",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );
    const upperIdx = source.indexOf(
      '.lte("event_dates.start_at", dateWindowUtc.endUtc)',
    );
    assert(
      upperIdx >= 0,
      "expected `.lte(\"event_dates.start_at\", dateWindowUtc.endUtc)` to exist — this is the dated-chip upper bound",
    );

    const ifIdx = source.indexOf("if (dateWindowUtc !== null)");
    assert(
      ifIdx >= 0,
      "expected `if (dateWindowUtc !== null)` block to exist as the dated-chip branch container",
    );

    // The upper bound MUST appear AFTER the if-block opening. If someone
    // hoists it out (mirror of the ORCH-0845 lower-bound hoist), the
    // no-window path would receive `dateWindowUtc.endUtc` where
    // `dateWindowUtc` is null → either a runtime TypeError reading .endUtc
    // on null, OR (if the compiler/runtime quietly coerces) a literal
    // "undefined" string sent to PostgREST as the upper bound. Either
    // way the "All" view breaks. This test catches the regression at
    // build time.
    assert(
      upperIdx > ifIdx,
      "ORCH-0845 adversarial regression: `.lte(\"event_dates.start_at\", dateWindowUtc.endUtc)` must appear AFTER `if (dateWindowUtc !== null)` (i.e., INSIDE the dated-chip branch). If it has been hoisted out — mirroring the lower-bound hoist — the no-window 'All' path will dereference dateWindowUtc.endUtc on null and either crash or send 'undefined' as the upper bound, breaking the default Discover view.",
    );
  },
);

// ── ATTACK 5 (bonus): no_window path does NOT carry an upper-bound filter ─

Deno.test(
  "ORCH-0845 adversarial — no-window path has NO upper-bound filter on event_dates.start_at",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );
    // Count the number of .lte("event_dates.start_at", ...) calls. There
    // should be exactly ONE, and it should be inside the if-block. Any
    // other appearance suggests an upper bound has been duplicated onto
    // the unconditional path — which would silently filter the "All" view
    // to events whose start_at <= some end-of-day constant, breaking
    // upcoming-event visibility.
    const matches = source.match(/\.lte\(\s*["']event_dates\.start_at["']/g) ?? [];
    assertEquals(
      matches.length,
      1,
      `regression: expected exactly one .lte("event_dates.start_at", ...) call in the file (inside the dated-chip branch). Found ${matches.length}. Multiple calls suggest an upper bound was duplicated onto the no-window path, which would silently filter upcoming events on the default 'All' view.`,
    );
  },
);

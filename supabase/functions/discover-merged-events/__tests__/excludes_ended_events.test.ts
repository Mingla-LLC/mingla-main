// ORCH-0845 [Discover excludes ended events] — happy-path regression test.
//
// Bug: pre-0845, the discover-merged-events edge function applied the
//   `event_dates.end_at >= ...` floor only inside the dated-chip branch
//   (`if (dateWindowUtc !== null)`). On the default "All" view and on any
//   facet chip without a date window, events whose master `end_at` was
//   already in the past were returned because nothing auto-flips
//   `events.status` to 'ended' when end-time passes.
//
// Fix: hoist `.eq("event_dates.is_master", true)` and
//   `.gte("event_dates.end_at", lowerBoundUtc)` into the unconditional
//   query chain, with
//     lowerBoundUtc = dateWindowUtc !== null
//       ? dateWindowUtc.startUtc
//       : new Date().toISOString();
//
// This file exercises the fix via two angles:
//   (1) Pure-function replica of the `lowerBoundUtc` decision logic, with
//       boundary cases on the window-null vs window-set branches. Locks the
//       branch contract in a way that fails if the decision logic is
//       inverted or accidentally always-now.
//   (2) Structural source-file assertion that the floor predicate is
//       hoisted OUT of the `if (dateWindowUtc !== null)` block — i.e., the
//       `.gte("event_dates.end_at",` substring appears BEFORE the
//       `if (dateWindowUtc !== null)` line in `index.ts`. This is the
//       structural property that fails on revert: if anyone moves the
//       predicate back inside the if-block, the assertion flips.
//
// The companion strict-grep CI gate
// `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs`
// covers the substring presence check from a different angle (CI step, not
// unit test). Together they form append-only regression coverage per
// ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5.
//
// Run with:
//   deno test --allow-read supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

// ── (1) Pure-function replica of the lowerBoundUtc decision ─────────────

type DateWindowUtc = { startUtc: string; endUtc: string } | null;

function computeLowerBoundUtc(
  dateWindowUtc: DateWindowUtc,
  nowIso: string,
): string {
  // MUST mirror the production decision at
  // supabase/functions/discover-merged-events/index.ts (search for
  // `const lowerBoundUtc:`). Any drift here means the test is wrong.
  return dateWindowUtc !== null ? dateWindowUtc.startUtc : nowIso;
}

Deno.test(
  "ORCH-0845 — lowerBoundUtc is now() when no date window is supplied",
  () => {
    const now = "2026-05-15T22:00:00.000Z";
    const result = computeLowerBoundUtc(null, now);
    assertEquals(
      result,
      now,
      "no-window path must use the request-time UTC ISO string as the floor",
    );
  },
);

Deno.test(
  "ORCH-0845 — lowerBoundUtc is window.startUtc when a date window is supplied",
  () => {
    const now = "2026-05-15T22:00:00.000Z";
    const window: DateWindowUtc = {
      startUtc: "2026-05-15T04:00:00.000Z",
      endUtc: "2026-05-16T03:59:00.000Z",
    };
    const result = computeLowerBoundUtc(window, now);
    assertEquals(
      result,
      window.startUtc,
      "dated-chip path must use the window's start UTC (preserves ORCH-0839-A 'in-progress events stay under Tonight')",
    );
    assertNotEquals(
      result,
      now,
      "dated-chip path MUST NOT fall back to now() — that would re-introduce the ORCH-0839-A bug where in-progress events disappeared under Tonight",
    );
  },
);

Deno.test(
  "ORCH-0845 — past end_at is strictly less than no-window lowerBoundUtc",
  () => {
    // Simulates the ghost-inventory case the investigation found:
    // Big Party (Raleigh) ended at 2026-05-15 02:00 UTC, ghost-inventory
    // probe ran at 2026-05-15 ~22:40 UTC.
    const pastEndAt = "2026-05-15T02:00:00.000Z";
    const requestNow = "2026-05-15T22:40:00.000Z";
    const lowerBound = computeLowerBoundUtc(null, requestNow);
    // The actual SQL predicate is `event_dates.end_at >= lowerBoundUtc`.
    // For an ended event, pastEndAt < lowerBound must hold, which means
    // the predicate is FALSE and the row is excluded — the bug fix.
    const ended = Date.parse(pastEndAt) < Date.parse(lowerBound);
    assert(
      ended,
      "an event with end_at in the past must not satisfy end_at >= lowerBoundUtc on the no-window path",
    );
  },
);

Deno.test(
  "ORCH-0845 — future end_at satisfies no-window lowerBoundUtc",
  () => {
    const futureEndAt = "2026-05-16T03:00:00.000Z";
    const requestNow = "2026-05-15T22:40:00.000Z";
    const lowerBound = computeLowerBoundUtc(null, requestNow);
    const upcoming = Date.parse(futureEndAt) >= Date.parse(lowerBound);
    assert(
      upcoming,
      "an upcoming event must satisfy end_at >= lowerBoundUtc on the no-window path",
    );
  },
);

// ── (2) Structural source-file assertion (the fails-on-revert hook) ────

Deno.test(
  "ORCH-0845 — .gte(event_dates.end_at, lowerBoundUtc) is hoisted out of the dated-chip if-block",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );

    // Find the position of the binding substring.
    const floorIdx = source.indexOf(
      '.gte("event_dates.end_at", lowerBoundUtc)',
    );
    assert(
      floorIdx >= 0,
      "expected `.gte(\"event_dates.end_at\", lowerBoundUtc)` to exist in discover-merged-events/index.ts — if this fails, the ORCH-0845 fix has been removed or renamed",
    );

    // Find the dated-chip if-block opening.
    const ifIdx = source.indexOf("if (dateWindowUtc !== null)");
    assert(
      ifIdx >= 0,
      "expected `if (dateWindowUtc !== null)` to exist — this is the dated-chip branch boundary",
    );

    // The floor predicate MUST appear BEFORE the if-block. If it's after,
    // the predicate has been moved back inside the if-block (the pre-0845
    // bug shape) and ended events leak on the no-window path.
    assert(
      floorIdx < ifIdx,
      "ORCH-0845 regression: `.gte(\"event_dates.end_at\", lowerBoundUtc)` must appear BEFORE `if (dateWindowUtc !== null)`. If this fails, the floor predicate has been moved back inside the dated-chip branch and ended events will leak on the default 'All' view.",
    );

    // Belt-and-braces: the const lowerBoundUtc declaration must also exist.
    const constIdx = source.indexOf("const lowerBoundUtc");
    assert(
      constIdx >= 0,
      "expected `const lowerBoundUtc` declaration — the strict-grep gate i-discover-excludes-ended-master-date.mjs depends on this identifier name",
    );
    assert(
      constIdx < floorIdx,
      "expected `const lowerBoundUtc` to be declared BEFORE the .gte() call that consumes it",
    );
  },
);

Deno.test(
  "ORCH-0845 — event_dates embed is unified to !inner on every code path",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );
    // Pre-0845 the embed was ternary: !inner under dated-chip, !left otherwise.
    // Post-0845 it is unconditionally !inner because I-PROPOSED-AX
    // EVENT_HAS_MASTER_DATE guarantees the master row exists for any
    // scheduled/live event.
    const innerCount = (
      source.match(
        /event_dates!inner\s*\(\s*id,\s*start_at,\s*end_at,\s*timezone,\s*is_master\s*\)/g,
      ) ?? []
    ).length;
    assert(
      innerCount >= 1,
      "expected at least one `event_dates!inner ( id, start_at, end_at, timezone, is_master )` embed",
    );
    const leftEmbed = source.match(
      /event_dates!left\s*\(\s*id,\s*start_at,\s*end_at,\s*timezone,\s*is_master\s*\)/,
    );
    assertEquals(
      leftEmbed,
      null,
      "ORCH-0845 regression: `event_dates!left ( id, start_at, end_at, timezone, is_master )` embed has reappeared. Pre-0845 the no-window path used !left and let events without a master date row leak through. Post-0845 the embed is unconditionally !inner.",
    );
  },
);

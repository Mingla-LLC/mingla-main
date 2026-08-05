// Issue #1622 — the thumbnail backfill must be able to GIVE UP.
//
// THE DEFECT: the only exit from the work queue was `thumbs_backfilled_at IS
// NOT NULL`, set only when EVERY photo for a place succeeds (all-or-nothing,
// deliberate). A place holding one permanently un-thumbable photo could never
// satisfy that, so it was re-claimed every ~10 minutes forever — 77 places
// pinned in production against 40,031 completed, 84 wasted runs a day.
//
// Proof from a real stuck place (5 photos): photo 4's ORIGINAL returns 400 (the
// storage object is gone) and photo 1's thumb will not generate. Neither can
// ever succeed, so the other three re-ran every round redoing finished work.
//
// FAILS-ON-REVERT: make decideThumbTerminalState always return terminal:false
// (i.e. remove the second exit) and T-2/T-3/T-5 fail immediately.
//
// Run: deno test supabase/functions/backfill-place-photo-thumbs/issue1622_terminal_state.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyThumbFailure,
  decideThumbTerminalState,
  THUMB_MAX_ATTEMPTS,
} from "./index.ts";

// ─── T-1 — classification: what can never succeed vs what might ──────────────
Deno.test("T-1 #1622: permanent vs transient classification", () => {
  // PERMANENT — the source is gone or is not a decodable image.
  assertEquals(classifyThumbFailure("original_fetch_failed_400"), "permanent");
  assertEquals(classifyThumbFailure("original_fetch_failed_404"), "permanent");
  assertEquals(classifyThumbFailure("original_fetch_failed_403"), "permanent");
  assertEquals(classifyThumbFailure("decoded_non_image"), "permanent");
  assertEquals(classifyThumbFailure("Unsupported image format"), "permanent");

  // TRANSIENT — may still recover.
  assertEquals(classifyThumbFailure("original_fetch_failed_500"), "transient");
  assertEquals(classifyThumbFailure("original_fetch_failed_502"), "transient");
  assertEquals(classifyThumbFailure("original_fetch_failed_503"), "transient");

  // 408/429 are 4xx but explicitly retryable — a throttle is not a dead file.
  assertEquals(classifyThumbFailure("original_fetch_failed_408"), "transient");
  assertEquals(classifyThumbFailure("original_fetch_failed_429"), "transient");

  // Network-ish / unknown → transient. The default direction is deliberate:
  // wrongly calling something permanent silently drops a HEALTHY place from the
  // queue (invisible data loss); wrongly calling it transient just costs a few
  // more rounds before the attempt backstop catches it.
  assertEquals(classifyThumbFailure("connection reset by peer"), "transient");
  assertEquals(classifyThumbFailure(""), "transient");
  assertEquals(
    classifyThumbFailure("something nobody has seen yet"),
    "transient",
  );
});

// ─── T-2 — a dead original terminates on the FIRST drained round ─────────────
// This is the production case: retrying a deleted object forever is the bug.
Deno.test("T-2 #1622: a permanent failure is terminal immediately, not after N rounds", () => {
  const v = decideThumbTerminalState(["original_fetch_failed_400"], 0);
  assert(
    v.terminal,
    "a dead original must terminate on the first drained round",
  );
  assertEquals(v.attempts, 1);
  assert(
    v.reason?.startsWith("permanent:"),
    `terminal state must be diagnosable, got: ${v.reason}`,
  );
});

// ─── T-3 — mixed failures: one permanent among transients still terminates ───
// The real stuck place had BOTH kinds. If a permanent failure could be masked by
// a transient one, the place would keep looping — the exact bug, unfixed.
Deno.test("T-3 #1622: one permanent failure among transients still terminates", () => {
  const v = decideThumbTerminalState(
    ["original_fetch_failed_500", "original_fetch_failed_400", "timeout"],
    0,
  );
  assert(
    v.terminal,
    "a permanent failure must not be masked by transient siblings",
  );
  assert(
    v.reason?.includes("400"),
    `reason should name the permanent cause: ${v.reason}`,
  );
});

// ─── T-4 — transient failures are NOT abandoned early ────────────────────────
// Guards the over-correction: a storage blip must not evict a healthy place.
Deno.test("T-4 #1622: transient failures retry up to the backstop, never sooner", () => {
  for (let prior = 0; prior < THUMB_MAX_ATTEMPTS - 1; prior++) {
    const v = decideThumbTerminalState(["original_fetch_failed_503"], prior);
    assert(
      !v.terminal,
      `attempt ${
        prior + 1
      } of ${THUMB_MAX_ATTEMPTS}: a transient failure must still retry`,
    );
    assertEquals(
      v.attempts,
      prior + 1,
      "attempts must advance by exactly one per drained round",
    );
  }
});

// ─── T-5 — the backstop does eventually fire ─────────────────────────────────
// Without this, a permanently-flaky source loops forever under a "transient"
// label — the original bug wearing a different hat.
Deno.test("T-5 #1622: repeated transient failure terminates at the backstop", () => {
  const v = decideThumbTerminalState(
    ["original_fetch_failed_503"],
    THUMB_MAX_ATTEMPTS - 1,
  );
  assert(v.terminal, `must terminate at attempt ${THUMB_MAX_ATTEMPTS}`);
  assertEquals(v.attempts, THUMB_MAX_ATTEMPTS);
  assert(
    v.reason?.includes("transient_exhausted"),
    `backstop reason must be distinguishable from a permanent one: ${v.reason}`,
  );
});

// ─── T-6 — ADVERSARIAL: success must never consume an attempt ────────────────
// The sharpest edge. The CPU wall guard abandons places mid-batch; the caller
// only reaches this function once a round FULLY DRAINED. If a no-failure round
// still advanced the counter, a repeatedly-interrupted HEALTHY place would march
// to the backstop and be marked terminal — turning a performance safeguard into
// silent data loss, which is strictly worse than the bug being fixed.
Deno.test("T-6 #1622 ADVERSARIAL: an empty failure list never terminates or counts", () => {
  for (const prior of [0, 1, THUMB_MAX_ATTEMPTS - 1, THUMB_MAX_ATTEMPTS, 99]) {
    const v = decideThumbTerminalState([], prior);
    assert(!v.terminal, `no failures at prior=${prior} must never be terminal`);
    assertEquals(
      v.attempts,
      prior,
      "a clean round must NOT advance the attempt counter",
    );
    assertEquals(v.reason, null);
  }
});

// ─── T-7 — ADVERSARIAL: already past the backstop cannot un-terminate ────────
Deno.test("T-7 #1622 ADVERSARIAL: attempts beyond the backstop stay terminal", () => {
  const v = decideThumbTerminalState(
    ["original_fetch_failed_503"],
    THUMB_MAX_ATTEMPTS + 10,
  );
  assert(
    v.terminal,
    "a place past the backstop must not become eligible again",
  );
});

// ─── T-8 — the constant is sane (vacuity guard) ──────────────────────────────
// If THUMB_MAX_ATTEMPTS were ever set to 0 or 1, T-4's loop would run zero times
// and pass over nothing — the unfalsifiable-test failure mode.
Deno.test("T-8 #1622: backstop is a real, meaningful bound", () => {
  assert(
    THUMB_MAX_ATTEMPTS >= 3,
    `THUMB_MAX_ATTEMPTS=${THUMB_MAX_ATTEMPTS} is too low — T-4 would assert nothing`,
  );
  assert(
    THUMB_MAX_ATTEMPTS <= 20,
    "an unbounded backstop is the bug, not a fix",
  );
});

// ===========================================================================
// #2218 T-5 — A HELD MESSAGE WAKES ON ITS OWN CLOCK.
// ===========================================================================
// ORCH-0788's ladder is 2^attempt x 60s, capped at three attempts — at most
// about six minutes of patience. A Nigerian confirmation held at 06:10 WAT
// waits nearly two hours; one held at 20:05 WAT waits twelve. Run through that
// ladder, the message is re-offered every few minutes to a network that is
// refusing it, exhausts the cap before dawn, and lands on `failed_terminal`
// having never once been carried.
//
// So `deferred` reads `next_attempt_at` INSTEAD of the backoff, and the two can
// never both apply. These are the executable form of that rule — the eligibility
// logic was extracted out of index.ts for exactly this reason: that file calls
// `serve()` at module scope, so nothing in it could be imported and nothing in
// it could be proved.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isEligible, type RetryableRow } from "./logic.ts";

const NOW = new Date("2026-08-18T07:05:00Z").getTime(); // 08:05 WAT

function row(over: Partial<RetryableRow>): RetryableRow {
  return {
    id: "n-2218",
    order_id: "o-2218",
    status: "deferred",
    attempt_count: 0,
    updated_at: "2026-08-18T05:10:41Z",
    created_at: "2026-08-18T05:10:39Z",
    next_attempt_at: null,
    payload: null,
    ...over,
  };
}

Deno.test("#2218 T-5a: a deferred row is swept once, and only once, its window opens", () => {
  // The production case: held at 06:10 WAT until 08:00 WAT, swept at 08:05.
  assertEquals(
    isEligible(row({ next_attempt_at: "2026-08-18T07:00:00Z" }), NOW),
    true,
    "the window has opened — re-offer it, and the buyer's text arrives",
  );
  // Five minutes earlier the network is still refusing.
  assertEquals(
    isEligible(
      row({ next_attempt_at: "2026-08-18T07:00:00Z" }),
      new Date("2026-08-18T06:55:00Z").getTime(),
    ),
    false,
    "sweeping early spends an attempt on a route that cannot carry it",
  );
  // Exactly on the deadline counts.
  assertEquals(
    isEligible(
      row({ next_attempt_at: "2026-08-18T07:00:00Z" }),
      new Date("2026-08-18T07:00:00Z").getTime(),
    ),
    true,
  );
});

Deno.test("#2218 T-5b: the exponential ladder does NOT apply to a hold", () => {
  // `updated_at` is nearly two hours old — under the ladder that is eligible
  // many times over. It is NOT, because the hold has not expired. If the
  // deferred arm were ever removed and these rows fell through to the backoff,
  // this is the assertion that goes red.
  assertEquals(
    isEligible(
      row({
        next_attempt_at: "2026-08-18T07:00:00Z",
        updated_at: "2026-08-18T05:10:41Z",
        attempt_count: 2,
      }),
      new Date("2026-08-18T06:00:00Z").getTime(),
    ),
    false,
    "50 minutes past `updated_at` clears every rung of the ladder and must " +
      "still not wake a message the network is refusing",
  );
});

Deno.test("#2218 T-5c: a hold with no deadline is never swept", () => {
  // "Re-attempt on an unknown schedule" is guessing. A `deferred` row with no
  // next_attempt_at means the writer failed to record when the hold ends; the
  // reconciler's staleness sweep surfaces it to a human instead of this one
  // silently hammering it.
  assertEquals(isEligible(row({ next_attempt_at: null }), NOW), false);
  assertEquals(isEligible(row({ next_attempt_at: "not a date" }), NOW), false);
});

Deno.test("#2218 T-5d: the pre-existing arms are untouched", () => {
  // ORCH-0788 backoff: 2^attempt x 60s since updated_at.
  const base = new Date("2026-08-18T07:00:00Z");
  assertEquals(
    isEligible(
      row({
        status: "failed_retryable",
        attempt_count: 1,
        updated_at: new Date(base.getTime() - 119_000).toISOString(),
      }),
      base.getTime(),
    ),
    false,
    "attempt 1 waits 2 minutes",
  );
  assertEquals(
    isEligible(
      row({
        status: "failed_retryable",
        attempt_count: 1,
        updated_at: new Date(base.getTime() - 121_000).toISOString(),
      }),
      base.getTime(),
    ),
    true,
  );
  assertEquals(
    isEligible(
      row({
        status: "failed_retryable",
        attempt_count: 3,
        updated_at: "2026-08-01T00:00:00Z",
      }),
      base.getTime(),
    ),
    false,
    "the three-attempt cap still holds",
  );
  // Orphan-pending: older than 5 minutes.
  assertEquals(
    isEligible(
      row({
        status: "pending",
        created_at: new Date(base.getTime() - 299_000).toISOString(),
      }),
      base.getTime(),
    ),
    false,
  );
  assertEquals(
    isEligible(
      row({
        status: "pending",
        created_at: new Date(base.getTime() - 301_000).toISOString(),
      }),
      base.getTime(),
    ),
    true,
  );
  // A status this sweeper does not own is not swept.
  assertEquals(isEligible(row({ status: "sent" }), NOW), false);
  assertEquals(isEligible(row({ status: "delivered" }), NOW), false);
});

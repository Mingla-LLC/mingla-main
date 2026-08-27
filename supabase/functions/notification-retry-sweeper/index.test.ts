// ORCH-0788 — contract tests for the retry sweeper.
//
// issue #2695 — WHY THESE WERE RED ON MAIN, AND WHY THEY NOW ASSERT VALUES.
//
// Every constant these pinned was moved from `index.ts` into `logic.ts` by
// #2218. The assertions kept grepping `index.ts`, found nothing, and went red —
// so the guard on the sweeper has been failing continuously, in NO CI lane
// (`supabase-migrations-and-stripe-deno.yml` runs only `issue2218.deferred.test.ts`).
// Nothing was broken; the test was reading the wrong file.
//
// That matters more than usual right now: #2695 moves the confirmation email off
// the buyer's critical path, and this sweeper becomes the backstop that catches a
// send that never happened. A backstop whose own guard is red and unwatched is
// not a backstop.
//
// So they now IMPORT the constants and assert their VALUES. A file move can no
// longer red them, and — the part that matters — a changed VALUE now can, which
// a grep for the old text never would have caught either.
//
// The `.in("status", ...)` assertion also pinned a two-status list. #2218
// legitimately added `deferred`. Pinned as a SET now, so a status being dropped
// fails while one being added does not.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  BACKOFF_BASE_SECONDS,
  BATCH_LIMIT,
  isEligible,
  MAX_ATTEMPTS,
  ORPHAN_PENDING_SECONDS,
} from "./logic.ts";

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("notification-retry-sweeper: service-role bearer auth required", () => {
  assert(SOURCE.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert(SOURCE.includes('"forbidden"'));
  assert(SOURCE.includes("Bearer"));
});

Deno.test("notification-retry-sweeper: selects failed_retryable, pending AND deferred", () => {
  // A SET, not a literal. Dropping a status fails; adding one does not — and
  // `pending` is the one #2695 depends on, because a send that never happened
  // leaves the row exactly as finalize wrote it.
  const m = SOURCE.match(/\.in\(\s*"status"\s*,\s*\[([^\]]*)\]/);
  assert(m, "the sweeper no longer filters on a status list at all");
  const statuses = m[1].split(",").map((x) => x.trim().replace(/["']/g, ""));
  for (const required of ["failed_retryable", "pending", "deferred"]) {
    assert(
      statuses.includes(required),
      `the sweeper stopped picking up '${required}' rows`,
    );
  }
});

Deno.test("notification-retry-sweeper: orphan-pending threshold is 5 min (300s)", () => {
  assertEquals(ORPHAN_PENDING_SECONDS, 300);
});

Deno.test("notification-retry-sweeper: a never-attempted row IS collected once it ages past the threshold", () => {
  // The arm #2695 leans on, and the one that has NEVER fired in production —
  // zero `pending` rows have ever existed, so the only late deliveries on
  // record came through the `deferred` arm. Asserted behaviourally here
  // because production has never exercised it.
  const now = Date.parse("2026-08-27T12:00:00Z");
  const orphan = (ageSeconds: number) => ({
    status: "pending",
    attempt_count: 0,
    created_at: new Date(now - ageSeconds * 1000).toISOString(),
    updated_at: new Date(now - ageSeconds * 1000).toISOString(),
    next_attempt_at: null,
  });

  assert(
    !isEligible(orphan(299) as never, now),
    "a pending row was collected before the threshold — the sweeper would race the inline send",
  );
  assert(
    isEligible(orphan(301) as never, now),
    "a NEVER-ATTEMPTED pending row was not collected — the backstop #2695 relies on does not exist",
  );
});

Deno.test("notification-retry-sweeper: enforces attempt_count < 3 cap", () => {
  assert(/\.lt\(\s*"attempt_count"\s*,\s*MAX_ATTEMPTS\s*\)/.test(SOURCE));
  assertEquals(MAX_ATTEMPTS, 3);
});

Deno.test("notification-retry-sweeper: applies exponential backoff (2^attempts × 60s)", () => {
  assertEquals(BACKOFF_BASE_SECONDS, 60);
});

Deno.test("notification-retry-sweeper: bounded batch size 50 (thundering-herd guard)", () => {
  assertEquals(BATCH_LIMIT, 50);
  assert(SOURCE.includes(".limit(BATCH_LIMIT)"));
});

Deno.test("notification-retry-sweeper: dispatches via dispatchTicketConfirmation (not raw fetch)", () => {
  assert(SOURCE.includes("dispatchTicketConfirmation"));
  // No inlined fetch to /functions/v1/ticket-confirmation-dispatch.
  assertFalse(SOURCE.includes("fetch(`${supaUrl}/functions/v1/ticket-confirmation-dispatch"));
});

Deno.test("notification-retry-sweeper: groups by order_id (one dispatcher call per affected order)", () => {
  assert(SOURCE.includes("new Set(eligible.map"));
  assert(SOURCE.includes(".order_id"));
});

Deno.test("notification-retry-sweeper: dispatches null-order waitlist notifications by notificationId", () => {
  assert(SOURCE.includes("dispatchTicketNotification"));
  assert(SOURCE.includes('row.payload?.template_key === "waitlist_spot_open"'));
  assert(SOURCE.includes("waitlistNotificationIds"));
});

Deno.test("notification-retry-sweeper: dispatcher failures are NON-FATAL (try/catch per order)", () => {
  // Per-order try/catch with results pushed in both branches.
  assert(/results\.push\(\s*\{\s*orderId,\s*status:\s*"dispatched"/.test(SOURCE));
  assert(/results\.push\(\s*\{\s*orderId,\s*status:\s*"failed"/.test(SOURCE));
});

// Pure-function isEligible test would require exporting the function;
// source-introspection covers the regression surface. Live behaviour is
// validated by Claude `mingla-forensics` (TEST mode) per SPEC §12 T-14..T-18.
Deno.test("notification-retry-sweeper: isEligible NaN/zero-attempt safety", () => {
  // The three NaN guards moved to `logic.ts` intact; this grepped `index.ts`
  // and went red for that reason alone. Exercised instead of grepped now: an
  // unparseable timestamp must FAIL CLOSED — collecting a row whose age cannot
  // be computed would re-send a confirmation on every sweep, forever.
  const now = Date.parse("2026-08-27T12:00:00Z");
  const rows = [
    { status: "pending", attempt_count: 0, created_at: "not-a-date", updated_at: "not-a-date", next_attempt_at: null },
    { status: "deferred", attempt_count: 0, created_at: "not-a-date", updated_at: "not-a-date", next_attempt_at: "not-a-date" },
    { status: "failed_retryable", attempt_count: 1, created_at: "not-a-date", updated_at: "not-a-date", next_attempt_at: null },
  ];
  for (const row of rows) {
    assert(
      !isEligible(row as never, now),
      `an unparseable ${row.status} row was collected — it would be re-sent on every sweep`,
    );
  }
});

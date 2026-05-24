// ORCH-0788 — Source-introspection tests for the retry sweeper.
// Mirrors the pattern in refund-order/index.test.ts and cancel-order/index.test.ts.
// Real integration verification is owned by Claude `mingla-forensics` (TEST mode).

import {
  assert,
  assertFalse,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("notification-retry-sweeper: service-role bearer auth required", () => {
  assert(SOURCE.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert(SOURCE.includes('"forbidden"'));
  assert(SOURCE.includes("Bearer"));
});

Deno.test("notification-retry-sweeper: selects failed_retryable OR pending rows (orphan-pending path)", () => {
  assert(SOURCE.includes('.in("status", ["failed_retryable", "pending"])'));
});

Deno.test("notification-retry-sweeper: orphan-pending threshold is 5 min (300s)", () => {
  assert(SOURCE.includes("ORPHAN_PENDING_SECONDS = 300"));
  // Orphan path uses created_at (not updated_at — pending rows have
  // attempt_count=0 so updated_at == created_at, but using created_at
  // makes the intent explicit).
  assert(SOURCE.includes("created_at"));
});

Deno.test("notification-retry-sweeper: enforces attempt_count < 3 cap", () => {
  assert(/\.lt\(\s*"attempt_count"\s*,\s*MAX_ATTEMPTS\s*\)/.test(SOURCE));
  assert(SOURCE.includes("MAX_ATTEMPTS = 3"));
});

Deno.test("notification-retry-sweeper: applies exponential backoff (2^attempts × 60s)", () => {
  assert(SOURCE.includes("Math.pow(2, attempts)"));
  assert(SOURCE.includes("BACKOFF_BASE_SECONDS = 60"));
});

Deno.test("notification-retry-sweeper: bounded batch size 50 (thundering-herd guard)", () => {
  assert(SOURCE.includes("BATCH_LIMIT = 50"));
  assert(SOURCE.includes(".limit(BATCH_LIMIT)"));
});

Deno.test("notification-retry-sweeper: dispatches via dispatchTicketConfirmation (not raw fetch)", () => {
  assert(SOURCE.includes("dispatchTicketConfirmation"));
  // No inlined fetch to /functions/v1/ticket-confirmation-dispatch.
  assertFalse(
    SOURCE.includes(
      "fetch(`${supaUrl}/functions/v1/ticket-confirmation-dispatch",
    ),
  );
});

Deno.test("notification-retry-sweeper: groups by order_id (one dispatcher call per affected order)", () => {
  assert(SOURCE.includes("new Set("));
  assert(SOURCE.includes(".order_id"));
});

Deno.test("notification-retry-sweeper: dispatches null-order waitlist notifications by notificationId", () => {
  assert(SOURCE.includes("dispatchTicketNotification"));
  assert(SOURCE.includes('row.payload?.template_key === "waitlist_spot_open"'));
  assert(SOURCE.includes("waitlistNotificationIds"));
});

Deno.test("notification-retry-sweeper: dispatcher failures are NON-FATAL (try/catch per order)", () => {
  // Per-order try/catch with results pushed in both branches.
  assert(
    /results\.push\(\s*\{\s*orderId,\s*status:\s*"dispatched"/.test(SOURCE),
  );
  assert(/results\.push\(\s*\{\s*orderId,\s*status:\s*"failed"/.test(SOURCE));
});

// Pure-function isEligible test would require exporting the function;
// source-introspection covers the regression surface. Live behaviour is
// validated by Claude `mingla-forensics` (TEST mode) per SPEC §12 T-14..T-18.
Deno.test("notification-retry-sweeper: isEligible NaN/zero-attempt safety", () => {
  assert(SOURCE.includes("Number.isNaN(updatedMs)"));
});

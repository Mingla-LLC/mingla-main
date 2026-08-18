// ===========================================================================
// #2218 T-7 — THE DISPATCHER'S DEFERRAL CONTRACT.
// ===========================================================================
// This file calls `serve()` at module scope, so nothing in it can be imported
// and executed. Source introspection is the pattern its neighbouring suite
// already uses for exactly that reason, and it is the honest one to use here:
// these assertions pin BRANCHES, not behaviour, and they are worth having
// because the branch being deleted is the difference between a Nigerian buyer's
// text arriving two hours late and never arriving at all.
//
// The executable half of #2218 lives where it can be executed —
// smsAdapter.issue2218.test.ts (the decision), notification-retry-sweeper's
// issue2218.deferred.test.ts (the wake-up), and
// sms-delivery-reconcile/issue2218.reconcile.test.ts (the truth check).
import {
  assert,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const SOURCE = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

// A vacuity guard first: an empty or truncated read would make every
// assertStringIncludes below pass over nothing.
Deno.test("#2218 T-7z: the dispatcher source was actually read", () => {
  assert(SOURCE.length > 20_000, "index.ts is a large file; a short read is a bug");
  assertStringIncludes(SOURCE, "smsAdapter.send(");
});

Deno.test("#2218 T-7a: both SMS call sites raise a deferral before any other branch", () => {
  // Two call sites — the buyer confirmation and the waitlist spot-open — and
  // BOTH must hold. The buyer confirmation is the one that failed in
  // production; the waitlist one shares the adapter and would fail identically.
  const deferThrows = SOURCE.match(
    /if\s*\(\s*result\.status\s*===\s*"deferred"\s*\)\s*\{\s*throw\s+deferredSmsError\(result\);/g,
  );
  assert(
    deferThrows !== null && deferThrows.length === 2,
    `both SMS call sites must handle "deferred"; found ${
      deferThrows?.length ?? 0
    }. A call site that falls through lands in the else-arm and writes status="sent" with a NULL provider_message_id — the #2218 defect, restored.`,
  );
  assertStringIncludes(SOURCE, "function deferredSmsError(");
  assertMatch(
    SOURCE,
    /detail:\s*`sms_deferred:\$\{result\.error \?\? "ng_operator_embargo"\}`/,
    "the reason must survive into last_error, or the row says only that something went wrong",
  );
});

Deno.test("#2218 T-7b: a deferral writes `deferred` + next_attempt_at and spends NO attempt", () => {
  const arms = SOURCE.match(
    /status:\s*"deferred",[\s\S]{0,400}?next_attempt_at:\s*deferredUntil,[\s\S]{0,400}?attempt_count:\s*Number\(notification\.attempt_count \?\? 0\),/g,
  );
  assert(
    arms !== null && arms.length === 2,
    `both catch clauses must write the deferral arm; found ${
      arms?.length ?? 0
    }. Without the attempt_count give-back, twelve hours of embargo burns the whole three-attempt ladder without one provider call and the row lands failed_terminal before dawn.`,
  );
  assertMatch(
    SOURCE,
    /const\s+deferredUntil\s*=\s*err\s+instanceof\s+ProviderSendError\s*\?\s*err\.nextAttemptAt\s*:\s*null/,
    "the deadline rides on the error so ONE catch clause serves every template",
  );
});

Deno.test("#2218 T-7c: a deferred row is still selectable by a later dispatch pass", () => {
  assertMatch(
    SOURCE,
    /\.in\(\s*"status",\s*\[\s*"pending",\s*"failed_retryable",\s*"deferred"\s*\]\s*\)/,
    "the sweeper wakes an order and this query decides what it finds; omit " +
      '"deferred" and the sweep is a retry loop that can never retry',
  );
});

Deno.test("#2218 T-7d: the order rollup does not claim a success it has not earned", () => {
  assertMatch(
    SOURCE,
    /const\s+deferred\s*=\s*outcomes\.some\(\(row\)\s*=>\s*row\.status\s*===\s*"deferred"\)/,
  );
  assertMatch(
    SOURCE,
    /notification_status:\s*failed[\s\S]{0,120}?:\s*deferred\s*\?\s*"pending"/,
    "an order whose email sent and whose SMS is still held is `pending`, not " +
      "`sent` — the same unearned-success shape #1541 removed from the else-arm",
  );
});

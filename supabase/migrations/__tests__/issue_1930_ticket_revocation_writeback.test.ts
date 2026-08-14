import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../20270404001930_issue_1930_ticket_revocation_writeback.sql",
    import.meta.url,
  ),
);
const worker = await Deno.readTextFile(
  new URL(
    "../../functions/checkout-sale-revocation/index.ts",
    import.meta.url,
  ),
);

Deno.test("#1930 ticket result write-back locks event before session and exact attempt", () => {
  const eventLock = migration.indexOf(
    "FROM public.events WHERE id=v_event_id FOR UPDATE",
  );
  const sessionLock = migration.indexOf(
    "FROM public.ticket_checkout_sessions",
    eventLock,
  );
  const attemptLock = migration.indexOf(
    "FROM public.ticket_checkout_provider_attempts",
    sessionLock,
  );
  const outboxWrite = migration.indexOf(
    "UPDATE public.checkout_sale_revocation_outbox SET",
    attemptLock,
  );
  assert(
    eventLock >= 0 && eventLock < sessionLock && sessionLock < attemptLock &&
      attemptLock < outboxWrite,
    "write-back must preserve event -> session -> attempt -> outbox authority",
  );
  assertStringIncludes(
    migration,
    "v_session.provider_attempt_id IS DISTINCT FROM\n       v_snapshot.provider_attempt_id",
  );
  assertStringIncludes(migration, "revocation_attempt_binding_invalid");
});

Deno.test("#1930 terminal ticket outcomes converge session and attempt truth", () => {
  assertStringIncludes(migration, "reversal_state=CASE p_state");
  for (
    const token of [
      "WHEN 'neutralized' THEN 'neutralized'",
      "WHEN 'paid_reversal_pending' THEN 'paid_reversal_pending'",
      "WHEN 'paid_reversed' THEN 'paid_reversed'",
      "WHEN 'failed_terminal' THEN 'failed_terminal'",
      "WHEN 'failed_terminal' THEN 'terminal_failed'",
      "neutralized_at=CASE",
      "reversed_at=CASE",
    ]
  ) {
    assertStringIncludes(migration, token);
  }
});

Deno.test("#1930 retryable ticket outcomes stay pending and observable", () => {
  assertStringIncludes(
    migration,
    "WHEN 'provider_unknown' THEN 'provider_unknown'",
  );
  assertStringIncludes(
    migration,
    "WHEN 'failed_retryable' THEN 'provider_unknown'",
  );
  assertStringIncludes(
    migration,
    "WHEN p_state IN ('provider_unknown','failed_retryable')",
  );
  assertStringIncludes(migration, "LEAST(attempt_count,7)");
});

Deno.test("#1930 duplicate results are harmless and the worker delegates once", () => {
  assertStringIncludes(
    migration,
    "v_snapshot.lease_owner IS DISTINCT FROM p_worker_id",
  );
  assertStringIncludes(migration, "OR v_snapshot.state<>'leased'");
  const calls = worker.match(/issue_1930_record_revocation_result/g) ?? [];
  assert(calls.length === 1, "worker must keep one canonical result owner");
});

Deno.test("#1930 ticket write-back cannot mint buyer value", () => {
  for (
    const forbidden of [
      "INSERT INTO public.orders",
      "INSERT INTO public.tickets",
      "INSERT INTO public.notifications",
      "INSERT INTO public.partner_splits",
      "INSERT INTO public.brand_payout_releases",
    ]
  ) {
    assert(!migration.includes(forbidden), `${forbidden} must remain absent`);
  }
});

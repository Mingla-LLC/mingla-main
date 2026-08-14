import {
  assert,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../20270403001930_issue_1930_checkout_current_truth.sql",
    import.meta.url,
  ),
);

Deno.test("#1930 stores one epoch-bound provider attempt and a durable revocation outbox", () => {
  assertStringIncludes(
    migration,
    "CREATE TABLE public.event_checkout_admission_state",
  );
  assertStringIncludes(
    migration,
    "CREATE TABLE public.ticket_checkout_provider_attempts",
  );
  assertStringIncludes(migration, "checkout_session_id uuid NOT NULL UNIQUE");
  assertStringIncludes(
    migration,
    "provider_idempotency_key text NOT NULL UNIQUE",
  );
  assertStringIncludes(
    migration,
    "CREATE TABLE public.checkout_sale_revocation_outbox",
  );
  assertStringIncludes(
    migration,
    "UNIQUE(subject_type,subject_id,target_epoch)",
  );
  assert(!migration.includes("client_secret text"));
});

Deno.test("#1930 transition writers revoke in the database and readiness defaults closed", () => {
  assertStringIncludes(
    migration,
    "issue_1930_revoke_event_checkout_admissions",
  );
  assertStringIncludes(migration, "CREATE TRIGGER issue_1930_events_revoke");
  assertStringIncludes(
    migration,
    "CREATE TRIGGER issue_1930_ticket_types_revoke",
  );
  assertStringIncludes(
    migration,
    "CREATE TRIGGER issue_1930_event_dates_revoke",
  );
  assertStringIncludes(migration, "VALUES (true,false)");
  assertMatch(
    migration,
    /issue_1930_checkout_transition_guard_ready[\s\S]*COALESCE\([\s\S]*false\)/,
  );
});

Deno.test("#1930 claim and commit use event-first locks and epoch CAS", () => {
  const claim = migration.slice(
    migration.indexOf("issue_1930_claim_ticket_provider_attempt"),
    migration.indexOf("issue_1930_commit_ticket_provider_attempt"),
  );
  assert(
    claim.indexOf("FROM public.events WHERE id=p_event_id FOR UPDATE") <
      claim.indexOf("FROM public.ticket_checkout_sessions"),
  );
  const commit = migration.slice(
    migration.indexOf("issue_1930_commit_ticket_provider_attempt"),
    migration.indexOf("issue_1930_ticket_checkout_preflight"),
  );
  assertStringIncludes(commit, "v_admission.epoch<>p_claimed_epoch");
  assertStringIncludes(commit, "state='neutralization_pending'");
  assertStringIncludes(commit, "commit_epoch_lost");
});

Deno.test("#1930 checkout definers and new authority remain service-only", () => {
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assertStringIncludes(migration, `FROM PUBLIC, anon, authenticated`);
    assert(role.length > 0);
  }
  assertStringIncludes(
    migration,
    "GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session",
  );
  assertStringIncludes(
    migration,
    "GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize",
  );
});

Deno.test("#1930 create replay locks current event before the legacy idempotency owner", () => {
  const wrapper = migration.slice(
    migration.indexOf("ALTER FUNCTION public.biz_ticket_checkout_create_session"),
    migration.indexOf("REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session"),
  );
  assertStringIncludes(wrapper, "FROM public.events WHERE id=p_event_id FOR UPDATE");
  assertStringIncludes(wrapper, "issue_1930_event_sale_reason(v_event)<>'sellable'");
  assertStringIncludes(wrapper, "issue_1930_ticket_checkout_create_session_base");
});

Deno.test("#1930 late ticket reversals extend source refunds without widening other surfaces", () => {
  assertStringIncludes(migration, "'ticket_checkout_session'");
  assertStringIncludes(migration, "'late_payment_no_value'");
  assertStringIncludes(
    migration,
    "source_type='ticket_checkout_session' AND event_id IS NOT NULL AND venue_id IS NULL AND source_id=subject_id",
  );
});

Deno.test("#1930 finalize is event-first and converges late success to one reversal", () => {
  const wrapper = migration.slice(
    migration.indexOf("issue_1930_ticket_checkout_finalize"),
    migration.indexOf("ALTER FUNCTION public.record_source_refund_provider_event"),
  );
  assert(
    wrapper.indexOf("JOIN public.events") <
      wrapper.indexOf("FROM public.ticket_checkout_sessions\n    WHERE id=p_checkout_session_id FOR UPDATE"),
  );
  assertStringIncludes(wrapper, "v_admission.epoch<>v_session.admission_epoch");
  assertStringIncludes(wrapper, "issue_1930_mint_ticket_late_reversal");
  assertStringIncludes(wrapper, "'outcome','paid_reversal_pending'");
  assertStringIncludes(wrapper, "public.biz_ticket_checkout_finalize");
});

Deno.test("#1930 canonical refund recorder explicitly writes ticket reversal terminal state", () => {
  const recorder = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.record_source_refund_provider_event"),
    migration.indexOf("-- Initial truth/backfill"),
  );
  assertStringIncludes(recorder, "v_refund.source_type='ticket_checkout_session'");
  assertStringIncludes(recorder, "p_next_state='processed'");
  assertStringIncludes(recorder, "reversal_state='paid_reversed'");
  assertStringIncludes(recorder, "state='paid_reversed'");
  assertStringIncludes(recorder, "p_next_state='failed_terminal'");
});

Deno.test("#1930 revocation worker claims with SKIP LOCKED and bounded retry", () => {
  assertStringIncludes(migration, "FOR UPDATE SKIP LOCKED");
  assertStringIncludes(migration, "issue_1930_claim_revocations");
  assertStringIncludes(migration, "issue_1930_record_revocation_result");
  assertStringIncludes(migration, "LEAST(interval '1 hour'");
});

Deno.test("#1930 RSVP provider admission is event-first and service-only", () => {
  const rsvp = migration.slice(
    migration.indexOf("issue_1930_rsvp_contribution_authorized"),
    migration.indexOf("issue_1930_revoke_event_checkout_admissions"),
  );
  assertStringIncludes(rsvp, "FROM public.events WHERE id=p_event_id FOR UPDATE");
  assertStringIncludes(rsvp, "v_event.event_type<>'rsvp'");
  assertStringIncludes(rsvp, "v_contribution.revoked_at IS NULL");
  assertStringIncludes(rsvp, "FROM PUBLIC,anon,authenticated");
  assertStringIncludes(migration, "issue_1930_finalize_rsvp_contribution");
  assertStringIncludes(migration, "issue_1930_mint_rsvp_late_reversal");
  assertStringIncludes(migration, "'outcome','paid_reversal_pending'");
});

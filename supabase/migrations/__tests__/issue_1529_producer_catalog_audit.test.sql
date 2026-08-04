\set ON_ERROR_STOP on
BEGIN;

-- Issue #1529 T-2 — THE ANTI-RECURRENCE GUARD.
--
-- #1529 happened because a column was born with four readers and zero writers,
-- and nothing in CI could tell. Every producer that enqueues into
-- notification_outbox must make a CONSCIOUS decision about the recipient's
-- country. The failure mode this file prevents is a NEW producer being added
-- later that silently omits the column, exactly as all 13 original INSERT sites
-- did.
--
-- REWRITTEN FOR P1-1 (tester finding, on this guard's first real CI execution).
-- The original version carried a single flat allowlist of four names and went
-- RED on a FIFTH, previously unaudited producer:
-- `admin_request_source_refund_attention_recovery`
-- (20270131001221_issue_1221_source_refund_control_plane.sql:2987). The tester
-- proved that producer is NOT a routing defect — its rows belong to the
-- source-refund pool, whose country is derived at the DRAIN because #1221
-- deliberately keeps recipient PII out of the outbox — but "legitimately
-- exempt" is a CLAIM, and an unproven claim is precisely how #1529 shipped.
--
-- WHY THIS IS NOT JUST A WIDER ALLOWLIST. The obvious fix — append the fifth
-- name — is exactly how an anti-recurrence guard degrades into decoration: the
-- next unaudited producer gets appended too, and the guard silently stops
-- guarding. So an exemption here is NOT a name on a list. It is a name that
-- must also DEMONSTRATE the structural property that justifies it:
--
--   (a) it must still exist in the live catalog   → no ghost entries;
--   (b) it must NOT write country_code            → if it populates, it belongs
--       in the populating bucket, not the exempt one;
--   (c) its body must carry the source-refund pool markers it claims;
--   (d) a row of that pool's shape must be INVISIBLE to the generic claim RPC
--       and VISIBLE to the source-refund claim RPC — proven by CLAIMING, not
--       by reading source text.
--
-- (d) is load-bearing. To abuse this bucket you would have to make your
-- producer genuinely emit source-refund-pool rows — which is the very property
-- being exempted. An ordinary producer parked here FAILS, because its rows
-- WOULD be claimable by the generic pool, whose consumer reads country_code
-- straight off the row. A hard cap forces a human decision before a third
-- exemption can ever exist.
--
-- Assertion order is deliberate: the VACUITY GUARD runs FIRST. A catalog query
-- matching zero producers must FAIL LOUDLY rather than pass over an empty set.

CREATE TEMP TABLE issue_1529_discovered_producers AS
SELECT p.proname::text AS proname,
       p.prosrc        AS prosrc
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc ~* 'insert\s+into\s+public\.notification_outbox';

-- ---------------------------------------------------------------------------
-- (1) VACUITY GUARD — FIRST, ALWAYS.
-- ---------------------------------------------------------------------------
DO $vacuity$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM issue_1529_discovered_producers;
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'issue_1529_producer_audit_matched_zero_producers__guard_is_vacuous';
  END IF;
END;
$vacuity$;

-- ---------------------------------------------------------------------------
-- (2) RATCHET — raised 4 → 5 for P1-1. The floor is the number that ACTUALLY
--     exists in the catalog, so a producer DISAPPEARING is caught as well as
--     one appearing. At the old floor of 4 the fifth could have vanished
--     unnoticed.
-- ---------------------------------------------------------------------------
DO $ratchet$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM issue_1529_discovered_producers;
  IF v_count < 5 THEN
    RAISE EXCEPTION
      'issue_1529_producer_floor_breached_expected_at_least_5_got_%', v_count;
  END IF;
END;
$ratchet$;

-- ---------------------------------------------------------------------------
-- (3) PARTITION — every discovered producer must be classified, and the two
--     buckets mean different things.
--
--     POPULATING — holds (or can hold) the recipient's contact on the row, so
--     it MUST write country_code at enqueue:
--       orch_1161_reservation_notify_outbox → mingla_e164_country(NEW.guest_phone_e164)
--       pg_notify_reminders_enqueue         → mingla_e164_country(u.contact)
--       finalize_rsvp_contribution          → explicit NULL (no phone recipient)
--       issue_1389_enqueue_stay_event       → explicit NULL on the email legs;
--                                             mingla_e164_country over the
--                                             NORMALISED handset on the SMS legs
--
--     DRAIN-DERIVED — emits source-refund-pool rows carrying contact NULL by
--     #1221's privacy design, so the recipient (and therefore the country) can
--     only be resolved at the drain:
--       admin_request_source_refund_attention_recovery
--
--     ADDING A PRODUCER? Classify it, and add a behavioural case for it to
--     issue_1529_producer_country_code.test.sql. If you classify it as
--     drain-derived it must EARN that in sections (4) and (7) — you cannot
--     simply park it here.
-- ---------------------------------------------------------------------------
DO $partition$
DECLARE
  populating text[] := ARRAY[
    'orch_1161_reservation_notify_outbox',
    'pg_notify_reminders_enqueue',
    'finalize_rsvp_contribution',
    'issue_1389_enqueue_stay_event'
  ];
  drain_derived text[] := ARRAY[
    'admin_request_source_refund_attention_recovery'
  ];
  v_unclassified text;
BEGIN
  SELECT string_agg(d.proname, ', ' ORDER BY d.proname)
    INTO v_unclassified
  FROM issue_1529_discovered_producers d
  WHERE NOT (d.proname = ANY(populating))
    AND NOT (d.proname = ANY(drain_derived));

  IF v_unclassified IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_unclassified_notification_outbox_producer__%__classify_it_as_populating_or_PROVE_it_is_drain_derived',
      v_unclassified;
  END IF;

  -- HARD CAP. A third exemption must be a deliberate human decision, not an
  -- append. This is the tripwire that stops the bucket becoming a blanket.
  IF array_length(drain_derived, 1) > 2 THEN
    RAISE EXCEPTION
      'issue_1529_drain_derived_exemption_bucket_grew_past_2__STOP__an_exemption_bucket_that_keeps_growing_IS_a_blanket_allowlist';
  END IF;

  -- No ghosts: an exempt name that no longer exists must be removed, or the
  -- bucket accumulates stale permissions nobody reviews.
  IF EXISTS (
    SELECT 1 FROM unnest(drain_derived) AS x(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM issue_1529_discovered_producers d WHERE d.proname = x.name
    )
  ) THEN
    RAISE EXCEPTION
      'issue_1529_drain_derived_bucket_names_a_producer_that_no_longer_exists__remove_the_stale_exemption';
  END IF;
END;
$partition$;

-- ---------------------------------------------------------------------------
-- (4) THE EXEMPTION MUST BE EARNED — structural half.
--
--     (b) an exempt producer must NOT mention country_code. If it writes one it
--         is a populating producer that has been mis-filed, and mis-filing is
--         how a real omission would get hidden.
--     (c) it must carry the source-refund pool markers it claims: the
--         contract_version column and the source_refund category family. A
--         producer writing ordinary rows cannot pass this.
-- ---------------------------------------------------------------------------
DO $exemption_structure$
DECLARE
  drain_derived text[] := ARRAY[
    'admin_request_source_refund_attention_recovery'
  ];
  v_bad text;
BEGIN
  SELECT string_agg(d.proname, ', ' ORDER BY d.proname) INTO v_bad
  FROM issue_1529_discovered_producers d
  WHERE d.proname = ANY(drain_derived)
    AND d.prosrc ~* 'country_code';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_exempt_producer_%_DOES_write_country_code__reclassify_it_as_populating',
      v_bad;
  END IF;

  SELECT string_agg(d.proname, ', ' ORDER BY d.proname) INTO v_bad
  FROM issue_1529_discovered_producers d
  WHERE d.proname = ANY(drain_derived)
    AND NOT (d.prosrc ~* 'contract_version' AND d.prosrc ~* 'source_refund');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_exempt_producer_%_does_not_emit_source_refund_pool_rows__the_drain_derived_exemption_does_not_apply',
      v_bad;
  END IF;
END;
$exemption_structure$;

-- ---------------------------------------------------------------------------
-- (5) POPULATING PRODUCERS MUST MENTION country_code — the cheap second net,
--     and the WEAKEST assertion in this file.
--
--     This one is textual. It cannot prove the column is populated CORRECTLY
--     and would pass on a producer that only mentions country_code in a
--     comment. It exists purely as a tripwire behind the real behavioural proof
--     in issue_1529_producer_country_code.test.sql — do NOT mistake it for the
--     guard. The #1518 lesson is exactly this: a source-text check passes
--     vacuously when the string survives somewhere else in the file.
-- ---------------------------------------------------------------------------
DO $column_presence$
DECLARE
  populating text[] := ARRAY[
    'orch_1161_reservation_notify_outbox',
    'pg_notify_reminders_enqueue',
    'finalize_rsvp_contribution',
    'issue_1389_enqueue_stay_event'
  ];
  v_missing text;
BEGIN
  SELECT string_agg(d.proname, ', ' ORDER BY d.proname)
    INTO v_missing
  FROM issue_1529_discovered_producers d
  WHERE d.proname = ANY(populating)
    AND d.prosrc !~* 'country_code';

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_populating_producer_omits_country_code__%', v_missing;
  END IF;
END;
$column_presence$;

-- ---------------------------------------------------------------------------
-- (6) THE SHARED HELPERS MUST EXIST AND BE USED.
--
--     A producer could satisfy (5) by writing its own private country guess —
--     which is how the repo ended up with three divergent copies of this rule
--     (#1529 F-7). Assert the SMS-bearing producers call the SHARED helper, so
--     derivation cannot fork again.
-- ---------------------------------------------------------------------------
DO $shared_helper$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.mingla_e164_country(text)') IS NULL THEN
    RAISE EXCEPTION 'issue_1529_shared_country_helper_missing';
  END IF;
  IF to_regprocedure('public.mingla_e164_normalize(text)') IS NULL THEN
    RAISE EXCEPTION 'issue_1529_shared_normalize_helper_missing';
  END IF;

  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.orch_1161_reservation_notify_outbox()'::regprocedure;
  IF v_src !~* 'mingla_e164_country' THEN
    RAISE EXCEPTION 'issue_1529_reservation_producer_does_not_use_shared_helper';
  END IF;

  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.pg_notify_reminders_enqueue(int, text, int)'::regprocedure;
  IF v_src !~* 'mingla_e164_country' THEN
    RAISE EXCEPTION 'issue_1529_reminder_producer_does_not_use_shared_helper';
  END IF;

  -- The Stay producer must use BOTH: the country helper AND the normaliser,
  -- because without normalisation its SMS rows never reach a provider at all.
  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.issue_1389_enqueue_stay_event()'::regprocedure;
  IF v_src !~* 'mingla_e164_country' THEN
    RAISE EXCEPTION 'issue_1529_stay_producer_does_not_use_shared_country_helper';
  END IF;
  IF v_src !~* 'mingla_e164_normalize' THEN
    RAISE EXCEPTION 'issue_1529_stay_producer_lost_e164_normalisation__ng_sms_unreachable';
  END IF;
END;
$shared_helper$;

-- ---------------------------------------------------------------------------
-- (7) THE EXEMPTION MUST BE EARNED — BEHAVIOURAL half. THE LOAD-BEARING ONE.
--
--     The drain-derived exemption is sound ONLY if such a row is genuinely
--     invisible to the GENERIC claim RPC (whose consumer reads country_code
--     straight off the row) and visible to the SOURCE-REFUND claim RPC (whose
--     consumer derives the country after resolving the recipient). If that ever
--     inverted, a country-less row would flow to the generic dispatcher and
--     #1529 would be back, on a money path.
--
--     Proven by CLAIMING, not by reading source text.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1529-4ca7-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'audit-1529@example.test', now(), now()
);

INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-1529-4ca7-8000-000000000001',
        'audit-1529@example.test', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, created_at, updated_at
) VALUES (
  '00000000-1529-4ca7-8000-000000000010',
  '00000000-1529-4ca7-8000-000000000001',
  'Issue 1529 Audit Brand', 'issue-1529-audit-brand', 'USD', now(), now()
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '00000000-1529-4ca7-8000-000000000011',
  '00000000-1529-4ca7-8000-000000000010',
  'issue1529audit', 'Issue 1529 Audit Venue', 6.45, 3.47,
  'restaurant', 'verified'
);

INSERT INTO public.source_refunds (
  id, source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
  requested_by_type, reason, provider, currency, original_charge_cents,
  buyer_refund_requested_cents, buyer_refund_processed_cents, buyer_state,
  fee_reversal_required_cents, fee_reversal_processed_cents, fee_state,
  fee_leg_kind, financial_state, organizer_refund_liability_cents,
  platform_fee_absorption_cents, provider_payment_reference, idempotency_key,
  ops_status, attention_generation
) VALUES (
  '00000000-1529-4ca7-8000-000000000020',
  'venue_reservation',
  '00000000-1529-4ca7-8000-000000000030',
  '00000000-1529-4ca7-8000-000000000030',
  '00000000-1529-4ca7-8000-000000000010',
  '00000000-1529-4ca7-8000-000000000011',
  'venue_eligible_cancel', 'system', 'Issue 1529 exemption proof',
  'stripe', 'USD', 1000, 1000, 0, 'queued', 0, 0, 'not_required',
  'not_required', 'pending', 1000, 0,
  'pi_issue1529_audit', 'issue-1529-audit-refund', 'none', 1
);

-- A fresh database seeds the attention contract DISABLED at version 0.
-- Production runs it ENABLED at version 9, and the source-refund claim RPC
-- returns nothing unless that holds — so leaving the default would make
-- section (7) prove nothing at all.
UPDATE public.source_refund_attention_contract
   SET contract_version = 9, enabled = true, updated_at = now()
 WHERE singleton;

DO $exemption_earned$
DECLARE
  v_event   bigint;
  v_outbox  uuid := '00000000-1529-4ca7-8000-000000000040';
  v_generic integer;
  v_source  integer;
BEGIN
  INSERT INTO public.source_refund_events (
    refund_id, leg_type, event_key, event_type, to_state, actor_type
  ) VALUES (
    '00000000-1529-4ca7-8000-000000000020', 'buyer_refund',
    'issue-1529-audit-event', 'needs_attention', 'needs_attention', 'system'
  ) RETURNING id INTO v_event;

  -- A row in exactly the shape the exempt producer emits: contact NULL,
  -- country_code NULL, contract_version 9, a channel.
  INSERT INTO public.notification_outbox (
    id, category_key, user_id, contact, brand_id, payload, idempotency_key,
    status, channel, contract_version, attention_generation,
    source_refund_event_id, country_code
  ) VALUES (
    v_outbox, 'source_refund_buyer_state', NULL, NULL,
    '00000000-1529-4ca7-8000-000000000010', '{}'::jsonb,
    'issue-1529-audit-outbox', 'pending', 'sms', 9, 1, v_event, NULL
  );

  -- The GENERIC claim RPC must NOT see it. If it did, a row that structurally
  -- cannot carry a country would reach the dispatcher that reads the column
  -- directly — the exact shape of #1529, on a money path.
  SELECT count(*) INTO v_generic
  FROM public.claim_notification_outbox(25) c WHERE c.id = v_outbox;
  IF v_generic <> 0 THEN
    RAISE EXCEPTION
      'issue_1529_exemption_UNEARNED__source_refund_row_claimed_by_the_GENERIC_pool__its_country_would_be_read_as_NULL_off_the_row';
  END IF;

  -- The SOURCE-REFUND claim RPC MUST see it — otherwise the drain never runs
  -- and "derived at the drain" is a vacuous justification.
  SELECT count(*) INTO v_source
  FROM public.claim_source_refund_notification_outbox(
         25, 9, '00000000-1529-4ca7-8000-000000000099'::uuid, now()) c
  WHERE c.id = v_outbox;
  IF v_source <> 1 THEN
    RAISE EXCEPTION
      'issue_1529_exemption_UNEARNED__source_refund_row_NOT_claimed_by_the_source_pool__drain_derivation_is_unreachable_got_%',
      v_source;
  END IF;
END;
$exemption_earned$;

ROLLBACK;

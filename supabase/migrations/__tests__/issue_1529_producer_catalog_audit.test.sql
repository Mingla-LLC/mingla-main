\set ON_ERROR_STOP on
BEGIN;

-- Issue #1529 T-2 — THE ANTI-RECURRENCE GUARD.
--
-- #1529 happened because a column was born with four readers and zero writers,
-- and nothing in CI could tell. Every producer that enqueues into
-- notification_outbox has to make a CONSCIOUS decision about the recipient's
-- country — including the decision "this category has no phone recipient, so
-- the answer is NULL". The failure mode this file exists to prevent is a NEW
-- producer being added later that silently omits the column, exactly as all 13
-- original INSERT sites did.
--
-- THIS TEST DERIVES ITS SUBJECT SET FROM THE LIVE CATALOG, not from a
-- hand-maintained list, so it CANNOT pass by ignoring a producer nobody
-- remembered to add. A new enqueue function fails this test until someone
-- adds it to AUDITED_PRODUCERS below AND adds a behavioural case for it to
-- issue_1529_producer_country_code.test.sql.
--
-- Assertion order is deliberate and must not be rearranged: the VACUITY GUARD
-- runs FIRST. A catalog query that matches zero producers (because the table
-- was renamed, or the INSERT syntax changed, or the regex rotted) must FAIL
-- LOUDLY rather than pass over an empty set. That silent-zero case is the
-- `unfalsifiable test` bug class this repo has been bitten by before, and it
-- is the single most likely way this guard could stop protecting anything.

CREATE TEMP TABLE issue_1529_discovered_producers AS
SELECT p.proname::text AS proname,
       p.prosrc        AS prosrc
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc ~* 'insert\s+into\s+public\.notification_outbox';

-- ---------------------------------------------------------------------------
-- (1) VACUITY GUARD — FIRST, ALWAYS. Zero discovered producers is a FAILURE,
--     never a pass. If this ever fires, the catalog query stopped matching
--     reality and every assertion below became meaningless.
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
-- (2) RATCHET — the known producer-function floor. A producer DISAPPEARING
--     from the catalog (renamed, dropped, refactored into something the query
--     no longer sees) fails here, which is the other half of the vacuity
--     protection: partial erosion, not just total.
-- ---------------------------------------------------------------------------
DO $ratchet$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM issue_1529_discovered_producers;
  IF v_count < 4 THEN
    RAISE EXCEPTION
      'issue_1529_producer_floor_breached_expected_at_least_4_got_%', v_count;
  END IF;
END;
$ratchet$;

-- ---------------------------------------------------------------------------
-- (3) ALLOWLIST — every discovered producer must be explicitly audited.
--
--     AUDITED_PRODUCERS, and how each one resolves the recipient's country:
--
--       orch_1161_reservation_notify_outbox
--         → public.mingla_e164_country(NEW.guest_phone_e164) on both the
--           INSERT (born-confirmed) and UPDATE (transition) branches.
--       pg_notify_reminders_enqueue
--         → public.mingla_e164_country(u.contact) on both the event leg and
--           the reservation leg.
--       finalize_rsvp_contribution
--         → explicit NULL on all three legs. These categories carry no phone
--           recipient and are not in the SMS-eligible set.
--       issue_1389_enqueue_stay_event
--         → explicit NULL on the two EMAIL legs; mingla_e164_country over the
--           NORMALISED handset on the two SMS legs, which also normalise the
--           contact itself to E.164 (#1529 F-2).
--
--     ADDING A PRODUCER? Add it here AND add a behavioural case for it to
--     issue_1529_producer_country_code.test.sql. This list alone is NOT proof
--     that the producer is correct — it only proves someone looked.
-- ---------------------------------------------------------------------------
DO $allowlist$
DECLARE
  audited text[] := ARRAY[
    'orch_1161_reservation_notify_outbox',
    'pg_notify_reminders_enqueue',
    'finalize_rsvp_contribution',
    'issue_1389_enqueue_stay_event'
  ];
  v_unaudited text;
BEGIN
  SELECT string_agg(d.proname, ', ' ORDER BY d.proname)
    INTO v_unaudited
  FROM issue_1529_discovered_producers d
  WHERE NOT (d.proname = ANY(audited));

  IF v_unaudited IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_unaudited_notification_outbox_producer__%__add_it_to_AUDITED_PRODUCERS_and_give_it_a_T1_case',
      v_unaudited;
  END IF;
END;
$allowlist$;

-- ---------------------------------------------------------------------------
-- (4) COLUMN PRESENCE — the CHEAP SECOND NET, and the WEAKEST assertion here.
--
--     This one is textual: it only proves the string `country_code` appears in
--     the producer's source. It CANNOT prove the column is populated
--     correctly, and it would pass on a producer that mentions country_code in
--     a comment. It exists purely as a cheap tripwire behind the real
--     behavioural proof in issue_1529_producer_country_code.test.sql — do NOT
--     mistake it for the guard. The #1518 lesson is exactly this: a
--     source-text check passes vacuously when the string survives somewhere
--     else in the file.
-- ---------------------------------------------------------------------------
DO $column_presence$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(d.proname, ', ' ORDER BY d.proname)
    INTO v_missing
  FROM issue_1529_discovered_producers d
  WHERE d.prosrc !~* 'country_code';

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_producer_omits_country_code__%', v_missing;
  END IF;
END;
$column_presence$;

-- ---------------------------------------------------------------------------
-- (5) THE SHARED HELPERS MUST EXIST AND BE USED.
--
--     A producer could satisfy (4) by writing its own private country guess —
--     which is how the repo ended up with three divergent copies of this rule
--     (#1529 F-7). Assert that the two SMS-bearing producers actually call the
--     SHARED helper, so derivation cannot fork again.
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

ROLLBACK;

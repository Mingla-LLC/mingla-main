-- #1931 MIGRATION-TIME WRITE PROBE — verify half.
--
-- Runs AFTER 20270413001931 has applied to a database that was seeded by
-- `…probe.seed.sql` BEFORE the migration ran. Asserts that applying #1931 wrote nothing
-- it must not write, against rows that genuinely existed at apply time.
--
-- This is the half that makes SC-54(b) and SC-55(c) non-vacuous on a CI replay, where
-- both target tables are otherwise empty.
\set ON_ERROR_STOP on

DO $verify$
DECLARE
  v_session public.ticket_checkout_sessions%ROWTYPE;
  v_token record;
  v_invite record;
  v_epoch bigint;
  v_active boolean;
BEGIN
  -- Pre-flight: the seed must actually be present, or every assertion below is vacuous
  -- and would pass on an empty table — the exact defect this file exists to close.
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
   WHERE id = '99999999-9999-4999-8999-000000000005';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'migration-time probe is VACUOUS: the seeded checkout session is missing — run …probe.seed.sql BEFORE applying #1931';
  END IF;

  SELECT token_hash, expires_at, revoked_at, consumed_at INTO v_token
    FROM public.brand_offering_invite_tokens WHERE id = '99999999-9999-4999-8999-00000000000b';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'migration-time probe is VACUOUS: the seeded #1770 token is missing';
  END IF;

  -- (P2-1) SC-54(b) with a REAL row: applying #1931 must not populate any inert column.
  IF v_session.issue_1931_grant_id IS NOT NULL
     OR v_session.issue_1931_token_epoch_id IS NOT NULL
     OR v_session.issue_1931_access_epoch IS NOT NULL
     OR v_session.issue_1931_principal_kind IS NOT NULL THEN
    RAISE EXCEPTION 'SC-54(b) migration-time: applying #1931 populated an inert column on a pre-existing checkout session';
  END IF;

  -- ...and must not have disturbed the row otherwise.
  IF v_session.status IS DISTINCT FROM 'requires_payment'
     OR v_session.total_cents IS DISTINCT FROM 500000
     OR v_session.idempotency_key IS DISTINCT FROM 'i1931-mtp-idem' THEN
    RAISE EXCEPTION 'SC-54 migration-time: applying #1931 mutated a pre-existing checkout session row';
  END IF;

  -- (P2-2) SC-55(c) with a REAL row: applying #1931 must not touch the #1770 rail.
  IF v_token.consumed_at IS NOT NULL OR v_token.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'SC-55(c) migration-time: applying #1931 consumed or revoked a live #1770 token';
  END IF;
  IF v_token.token_hash IS DISTINCT FROM repeat('f', 64) THEN
    RAISE EXCEPTION 'SC-55(c) migration-time: applying #1931 rewrote a #1770 token hash';
  END IF;

  SELECT status, superseded_by_invite_id INTO v_invite
    FROM public.brand_offering_invites WHERE id = '99999999-9999-4999-8999-000000000008';
  IF v_invite.status IS DISTINCT FROM 'active' OR v_invite.superseded_by_invite_id IS NOT NULL THEN
    RAISE EXCEPTION 'SC-55(c) migration-time: applying #1931 mutated a live #1770 invite';
  END IF;

  -- The backfill is allowed to record preexisting Private rows as needs_setup, and this
  -- seeded event is PUBLIC, so it must not have gained access state at all.
  SELECT epoch, active INTO v_epoch, v_active
    FROM public.private_event_access_state WHERE event_id = '99999999-9999-4999-8999-000000000003';
  IF FOUND THEN
    RAISE EXCEPTION 'SC-46 migration-time: the backfill created access state for a PUBLIC event (epoch=%, active=%)', v_epoch, v_active;
  END IF;

  RAISE NOTICE 'MIGRATION-TIME PROBE PASS — #1931 wrote nothing to a pre-existing checkout session, #1770 token, #1770 invite, or a public event';
END $verify$;

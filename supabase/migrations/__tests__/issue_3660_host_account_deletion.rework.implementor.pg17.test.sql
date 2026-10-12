\set ON_ERROR_STOP on
-- Issue #3660 — Host account deletion completes or changes nothing.
-- IMPLEMENTOR rework suite: one group per finding of the independent tester's
-- report that was fixed in the database (F-1, F-2, F-5, F-7), plus the runtime
-- evidence for F-6.
--
--   F-1  A paid, non-zero, not fully refunded order blocks (money_in_motion)
--        until a `released` payout item covers it, but ONLY when Mingla holds
--        that money: brand on the hold rail and the sale after its cutover.
--        Collected instalments follow the same rule. A direct charge, a free
--        order and a fully refunded order do not block.
--   F-2  A signed-in, non-admin user cannot clear brands.deleted_at. The
--        service role and an admin still can. Soft-DELETING is unaffected.
--   F-5  A second call on an already-deleted account returns the provider
--        targets of the deletion that happened, and writes nothing.
--   F-6  A checkout session past its expiry does not block, and after the
--        deletion it can no longer be finalised into an order: the finalize
--        entry point refuses it. (Evidence that no change was needed.)
--   F-7  Pending team invitations on the deleted brands are revoked and
--        never-accepted partner links on them are closed, in the same
--        transaction. Accepted rows and other brands are untouched.
--
--   RN-1 / RN-2 (third rework)  The money rule mirrors every arm of the payout
--        sweep, fee snapshot included: a cash sale never blocks; RSVP
--        contributions, venue deposits and menu orders Mingla holds do. The
--        real sweep is run and must agree with the rule on the same fixtures.
--   RN-3 (third rework)  A later deletion returns the provider targets of
--        earlier deletions of the same account, de-duplicated.
--   FK-1 (fourth rework)  ...but only the earlier targets that are still true
--        today: brand still owned by the account, still deleted, provider row
--        still detached with that id. A brand since handed to another owner,
--        reconnected, or an entry that names no brand, is never returned.
--   FK-2 (fourth rework)  A dispute terminally lost for the full amount is not
--        held money and does not block; lost in part, open or won still does.
--
-- Runs as supabase_admin: money fixtures need session_replication_role =
-- replica, and F-2 switches to the real `authenticated` role. The replica role
-- is back to origin before any function or guard under test runs.
--
-- No row in auth.users is deleted here.
BEGIN;

-- A released (or other-status) payout release with one item per order on an event.
CREATE FUNCTION pg_temp.i3660r_cover(p_brand uuid, p_event uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_release uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.brand_payout_releases
    (id, brand_id, occurrence_key, surface, provider, currency, anchor_end_at,
     releasable_at, gross_cents, net_release_cents, status)
  VALUES (v_release, p_brand, 'i3660r-' || v_release::text, 'order', 'stripe', 'usd',
          date_trunc('second', now()) - interval '2 days',
          date_trunc('second', now()) - interval '1 day', 5000, 5000, p_status);
  INSERT INTO public.payout_release_items
    (id, release_id, source_type, source_id, gross_cents, refunded_cents,
     disputed_cents, mingla_fee_cents, partner_share_cents, provider_fee_cents,
     net_cents, source_finalized_at)
  SELECT gen_random_uuid(), v_release, 'order', o.id, o.total_cents, 0, 0, 0, 0, 0,
         o.total_cents, now()
  FROM public.orders o
  WHERE o.event_id = p_event;
END;
$fn$;

CREATE FUNCTION pg_temp.i3660r_codes(p_result jsonb)
RETURNS text
LANGUAGE sql
AS $fn$
  SELECT COALESCE(string_agg(x->>'code', ',' ORDER BY x->>'code'), '')
  FROM jsonb_array_elements(COALESCE(p_result->'blockers', '[]'::jsonb)) x;
$fn$;

-- One F-1 case in its own always-rolled-back subtransaction.
CREATE FUNCTION pg_temp.i3660r_case(
  p_name text, p_setup text, p_user uuid, p_expect text
)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE p_setup;
    PERFORM set_config('session_replication_role', 'origin', true);
    IF current_setting('session_replication_role') <> 'origin' THEN
      RAISE EXCEPTION 'issue_3660 rework [%]: triggers are not live', p_name;
    END IF;
    v_result := public.biz_delete_host_account(p_user);
    IF p_expect = 'deleted' THEN
      IF v_result->>'status' IS DISTINCT FROM 'deleted' THEN
        RAISE EXCEPTION 'issue_3660 rework [%]: expected deleted, got %', p_name, v_result;
      END IF;
    ELSIF v_result->>'status' IS DISTINCT FROM 'blocked'
          OR pg_temp.i3660r_codes(v_result) IS DISTINCT FROM p_expect THEN
      RAISE EXCEPTION 'issue_3660 rework [%]: expected blocked (%), got %', p_name, p_expect, v_result;
    END IF;
    RAISE EXCEPTION 'i3660r_rollback' USING ERRCODE = 'I3661';
  EXCEPTION WHEN SQLSTATE 'I3661' THEN
    NULL;
  END;
END;
$fn$;

-- ============================================================================
-- F-1 — money Mingla is HOLDING for the organiser and has not paid out yet.
--
-- Second rework (coordinator ruling): an unpaid-out order blocks ONLY when
-- Mingla holds the money, which is the payout sweep's own two conditions: the
-- brand is on the hold rail (payout_hold_cutover_at set) and the sale is after
-- that cutover. A direct charge on a brand that is not on the hold rail never
-- gets a payout row and must never block, on a past or an upcoming event.
-- The last block of this group runs the REAL sweep and asserts that it picks
-- up exactly the orders this rule blocks on.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();      -- owns the HOLD-RAIL brand
  v_brand uuid := gen_random_uuid();
  v_ended uuid := gen_random_uuid();      -- status scheduled, last date passed
  v_cancelled uuid := gen_random_uuid();  -- status cancelled, future date
  v_draft uuid := gen_random_uuid();      -- draft, no dates
  v_upcoming uuid := gen_random_uuid();   -- scheduled, future date
  v_owner2 uuid := gen_random_uuid();     -- owns a brand NOT on the hold rail
  v_brand2 uuid := gen_random_uuid();
  v_ended2 uuid := gen_random_uuid();
  v_upcoming2 uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_cutover timestamptz := now() - interval '30 days';
  f_order text;
  f_inst text;
  f_inst_paid_out text;
  v_plan_order uuid := gen_random_uuid();
  v_inst uuid := gen_random_uuid();
  v_o_after uuid := gen_random_uuid();
  v_o_before uuid := gen_random_uuid();
  v_o_direct uuid := gen_random_uuid();
  v_old_event uuid := gen_random_uuid();
  v_old_event2 uuid := gen_random_uuid();
  v_sweep jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner), (v_owner2);
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'i3660r-f1@example.test'), (v_owner2, 'i3660r-f1b@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand, v_owner, 'I3660R F1 Hold', 'i3660r-f1-' || v_sfx, 'USD'),
    (v_brand2, v_owner2, 'I3660R F1 Direct', 'i3660r-f1d-' || v_sfx, 'USD');
  -- The hold rail: Mingla collects and pays out later. Brand 2 stays off it.
  UPDATE public.brands SET payout_hold_cutover_at = v_cutover WHERE id = v_brand;
  IF NOT EXISTS (SELECT 1 FROM public.brands
                 WHERE id = v_brand AND payout_hold_cutover_at = v_cutover)
     OR EXISTS (SELECT 1 FROM public.brands
                WHERE id = v_brand2 AND payout_hold_cutover_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-1 fixture: the hold rail is not set up as intended';
  END IF;
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_brand, 'acct_i3660r_' || left(v_sfx, 10), 'US', 'USD');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status) VALUES
    (v_ended, v_brand, v_owner, 'I3660R Ended', 'i3660r-end-' || v_sfx, 'scheduled'),
    (v_cancelled, v_brand, v_owner, 'I3660R Cancelled', 'i3660r-can-' || v_sfx, 'cancelled'),
    (v_draft, v_brand, v_owner, 'I3660R Draft', 'i3660r-dra-' || v_sfx, 'draft'),
    (v_upcoming, v_brand, v_owner, 'I3660R Upcoming', 'i3660r-upc-' || v_sfx, 'scheduled'),
    (v_old_event, v_brand, v_owner, 'I3660R Old', 'i3660r-old-' || v_sfx, 'scheduled'),
    (v_ended2, v_brand2, v_owner2, 'I3660R Direct Ended', 'i3660r-den-' || v_sfx, 'scheduled'),
    (v_upcoming2, v_brand2, v_owner2, 'I3660R Direct Upcoming', 'i3660r-dup-' || v_sfx, 'scheduled'),
    (v_old_event2, v_brand2, v_owner2, 'I3660R Direct Old', 'i3660r-dol-' || v_sfx, 'scheduled');
  INSERT INTO public.event_dates(event_id, start_at, end_at) VALUES
    (v_ended, now() - interval '5 hours', now() - interval '1 hour'),
    (v_cancelled, now() + interval '9 days', now() + interval '10 days'),
    (v_upcoming, now() + interval '5 days', now() + interval '6 days'),
    (v_old_event, now() - interval '11 days', now() - interval '10 days'),
    (v_ended2, now() - interval '5 hours', now() - interval '1 hour'),
    (v_upcoming2, now() + interval '5 days', now() + interval '6 days'),
    (v_old_event2, now() - interval '11 days', now() - interval '10 days');

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- %1$L event, %2$L payment_status, %3$s total, %4$s refunded,
  -- %5$L how long ago the order was placed, %6$L order id
  -- An ONLINE sale: it carries the provider payment reference that earns it a
  -- fee snapshot. (Cash sales and the other money sources are in the group
  -- "every arm of the payout sweep" further down.)
  f_order := $f$INSERT INTO public.orders
      (id, event_id, buyer_email, buyer_name, total_cents, refunded_amount_cents,
       currency, payment_status, source, created_at, stripe_payment_intent_id)
    VALUES (%6$L, %1$L, 'i3660r-buyer@example.test', 'I3660R Buyer',
            %3$s, %4$s, 'USD', %2$L, 'legacy', now() - (%5$L)::interval,
            'pi_i3660r_' || left(replace(gen_random_uuid()::text, '-', ''), 16))$f$;
  -- %1$L instalment id, %2$L order id, %3$L status,
  -- %4$s collected_at expression (or NULL)
  f_inst := $f$INSERT INTO public.order_installments
      (id, order_id, ordinal, amount_cents, currency, due_at, status,
       stripe_payment_intent_id, collected_at)
    VALUES (%1$L, %2$L, 1, 2500, 'USD', now() - interval '3 days', %3$L,
            'pi_i3660r_' || left(replace(gen_random_uuid()::text, '-', ''), 12), %4$s)$f$;
  -- %1$L brand, %2$L instalment id: a RELEASED payout covering that instalment.
  f_inst_paid_out := $f$WITH r AS (
      INSERT INTO public.brand_payout_releases
        (id, brand_id, occurrence_key, surface, provider, currency, anchor_end_at,
         releasable_at, gross_cents, net_release_cents, status)
      VALUES (gen_random_uuid(), %1$L, 'order_installment:' || %2$L::text,
              'order_installment', 'stripe', 'usd',
              date_trunc('second', now()) - interval '2 days',
              date_trunc('second', now()) - interval '1 day', 2500, 2500, 'released')
      RETURNING id)
    INSERT INTO public.payout_release_items
      (id, release_id, source_type, source_id, gross_cents, refunded_cents,
       disputed_cents, mingla_fee_cents, partner_share_cents, provider_fee_cents,
       net_cents, source_finalized_at)
    SELECT gen_random_uuid(), r.id, 'order_installment', %2$L, 2500, 0, 0, 0, 0, 0,
           2500, now() FROM r$f$;

  -- Baselines: with no order at all both owners ARE deleted.
  PERFORM pg_temp.i3660r_case('baseline, hold-rail owner', 'SELECT 1', v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('baseline, direct-charge owner', 'SELECT 1', v_owner2, 'deleted');

  -- ── Mingla is holding the money: BLOCKED ───────────────────────────────────
  PERFORM pg_temp.i3660r_case('hold rail, order AFTER cutover, ended event, no release row',
    format(f_order, v_ended, 'paid', 5000, 0, '2 hours', gen_random_uuid()), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('hold rail, partly refunded order after cutover, no release row',
    format(f_order, v_ended, 'partial_refund', 5000, 1000, '2 hours', gen_random_uuid()), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('hold rail, paid order on a CANCELLED event, no release row',
    format(f_order, v_cancelled, 'paid', 5000, 0, '2 hours', gen_random_uuid()), v_owner, 'money_in_motion');
  -- Third rework: an event with NO date can never be ledgered (the sweep's
  -- occurrence join finds nothing), so an order on a dateless draft is not
  -- money the sweep would ever pay out and no longer blocks.
  PERFORM pg_temp.i3660r_case('hold rail, paid order on a DRAFT event with no date',
    format(f_order, v_draft, 'paid', 5000, 0, '2 hours', gen_random_uuid()), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('hold rail, order after cutover, release still PENDING',
    format(f_order, v_ended, 'paid', 5000, 0, '2 hours', gen_random_uuid()) || ';' ||
    format('SELECT pg_temp.i3660r_cover(%L, %L, %L)', v_brand, v_ended, 'pending'),
    v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('hold rail, order after cutover, release IN FLIGHT',
    format(f_order, v_ended, 'paid', 5000, 0, '2 hours', gen_random_uuid()) || ';' ||
    format('SELECT pg_temp.i3660r_cover(%L, %L, %L)', v_brand, v_ended, 'in_flight'),
    v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('hold rail, one order released, a second paid after the release',
    format(f_order, v_ended, 'paid', 5000, 0, '2 hours', gen_random_uuid()) || ';' ||
    format('SELECT pg_temp.i3660r_cover(%L, %L, %L)', v_brand, v_ended, 'released') || ';' ||
    format(f_order, v_ended, 'paid', 2500, 0, '1 hour', gen_random_uuid()),
    v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('hold rail, order one second after the cutover',
    format(f_order, v_ended, 'paid', 5000, 0, '30 days', gen_random_uuid())
      || '; UPDATE public.orders SET created_at = ' || quote_literal(v_cutover + interval '1 second')
      || ' WHERE event_id = ' || quote_literal(v_ended),
    v_owner, 'money_in_motion');
  -- An upcoming event's paid order stays reported as a sold ticket.
  PERFORM pg_temp.i3660r_case('hold rail, paid order, upcoming event',
    format(f_order, v_upcoming, 'paid', 5000, 0, '2 hours', gen_random_uuid()), v_owner, 'tickets_sold');

  -- ── Mingla is NOT holding the money: must not block ────────────────────────
  PERFORM pg_temp.i3660r_case('hold rail, order BEFORE the cutover, ended event',
    format(f_order, v_ended, 'paid', 5000, 0, '60 days', gen_random_uuid()), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('hold rail, order exactly AT the cutover (the sweep needs strictly after)',
    format(f_order, v_ended, 'paid', 5000, 0, '30 days', gen_random_uuid())
      || '; UPDATE public.orders SET created_at = ' || quote_literal(v_cutover)
      || ' WHERE event_id = ' || quote_literal(v_ended),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('NOT on the hold rail, paid order on a PAST event',
    format(f_order, v_ended2, 'paid', 5000, 0, '2 hours', gen_random_uuid()), v_owner2, 'deleted');
  PERFORM pg_temp.i3660r_case('NOT on the hold rail, partly refunded order on a past event',
    format(f_order, v_ended2, 'partial_refund', 5000, 1000, '2 hours', gen_random_uuid()), v_owner2, 'deleted');
  -- ...and on an UPCOMING event it is a sold ticket, never money in motion.
  PERFORM pg_temp.i3660r_case('NOT on the hold rail, paid order on an UPCOMING event',
    format(f_order, v_upcoming2, 'paid', 5000, 0, '2 hours', gen_random_uuid()), v_owner2, 'tickets_sold');
  PERFORM pg_temp.i3660r_case('hold rail, order after cutover, RELEASED',
    format(f_order, v_ended, 'paid', 5000, 0, '2 hours', gen_random_uuid()) || ';' ||
    format('SELECT pg_temp.i3660r_cover(%L, %L, %L)', v_brand, v_ended, 'released'),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('hold rail, FREE order (paid, 0)',
    format(f_order, v_ended, 'paid', 0, 0, '2 hours', gen_random_uuid()), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('hold rail, fully REFUNDED order',
    format(f_order, v_ended, 'refunded', 5000, 5000, '2 hours', gen_random_uuid()), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('hold rail, cancelled order',
    format(f_order, v_ended, 'cancelled', 5000, 0, '2 hours', gen_random_uuid()), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('hold rail, failed order',
    format(f_order, v_ended, 'failed', 5000, 0, '2 hours', gen_random_uuid()), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('hold rail, pending order on an ended event',
    format(f_order, v_ended, 'pending', 5000, 0, '2 hours', gen_random_uuid()), v_owner, 'deleted');

  -- ── Instalment plans ───────────────────────────────────────────────────────
  -- The plan's root order is paid out here in every case, so what decides the
  -- outcome is the instalment alone.
  PERFORM pg_temp.i3660r_case('hold rail, COLLECTED instalment after cutover, no released item',
    format(f_order, v_ended, 'paid', 5000, 0, '2 hours', v_plan_order) || ';' ||
    format('SELECT pg_temp.i3660r_cover(%L, %L, %L)', v_brand, v_ended, 'released') || ';' ||
    format(f_inst, v_inst, v_plan_order, 'collected', $q$now() - interval '1 hour'$q$),
    v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('hold rail, collected instalment, RELEASED item',
    format(f_order, v_ended, 'paid', 5000, 0, '2 hours', v_plan_order) || ';' ||
    format('SELECT pg_temp.i3660r_cover(%L, %L, %L)', v_brand, v_ended, 'released') || ';' ||
    format(f_inst, v_inst, v_plan_order, 'collected', $q$now() - interval '1 hour'$q$) || ';' ||
    format(f_inst_paid_out, v_brand, v_inst),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('hold rail, instalment collected BEFORE the cutover',
    format(f_order, v_ended, 'paid', 5000, 0, '60 days', v_plan_order) || ';' ||
    format(f_inst, v_inst, v_plan_order, 'collected', $q$now() - interval '45 days'$q$),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('hold rail, instalment only SCHEDULED (nothing collected)',
    format(f_order, v_ended, 'paid', 5000, 0, '2 hours', v_plan_order) || ';' ||
    format('SELECT pg_temp.i3660r_cover(%L, %L, %L)', v_brand, v_ended, 'released') || ';' ||
    format(f_inst, v_inst, v_plan_order, 'scheduled', 'NULL'),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('NOT on the hold rail, collected instalment',
    format(f_order, v_ended2, 'paid', 5000, 0, '2 hours', v_plan_order) || ';' ||
    format(f_inst, v_inst, v_plan_order, 'collected', $q$now() - interval '1 hour'$q$),
    v_owner2, 'deleted');

  -- ── The rule and the REAL payout sweep agree ───────────────────────────────
  -- Three orders, all old enough to be mature for the sweep, each with the fee
  -- snapshot the sweep requires: hold rail after cutover, hold rail before
  -- cutover, and a direct charge. The sweep must open a payout item for the
  -- first one ONLY, and that is the only one the deletion blocks on.
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE format(f_order, v_old_event, 'paid', 5000, 0, '12 days', v_o_after);
    EXECUTE format(f_order, v_old_event, 'paid', 5000, 0, '60 days', v_o_before);
    EXECUTE format(f_order, v_old_event2, 'paid', 5000, 0, '12 days', v_o_direct);
    INSERT INTO public.payout_source_fee_snapshots
      (id, source_type, source_id, provider_fee_cents, captured_at)
    SELECT gen_random_uuid(), 'order', x, 0, now()
    FROM unnest(ARRAY[v_o_after, v_o_before, v_o_direct]) x;
    PERFORM set_config('session_replication_role', 'origin', true);

    v_sweep := public.run_payout_release_dark_sweep(now());

    IF NOT EXISTS (SELECT 1 FROM public.payout_release_items
                   WHERE source_type = 'order' AND source_id = v_o_after) THEN
      RAISE EXCEPTION 'issue_3660 rework F-1 sweep: the sweep did not open a payout item for a hold-rail order after cutover (%). The mirror is stale; re-read the rule.', v_sweep;
    END IF;
    IF EXISTS (SELECT 1 FROM public.payout_release_items
               WHERE source_type = 'order' AND source_id IN (v_o_before, v_o_direct)) THEN
      RAISE EXCEPTION 'issue_3660 rework F-1 sweep: the sweep opened a payout item for an order before cutover or off the hold rail. The mirror is stale; re-read the rule.';
    END IF;
    -- The swept order is not `released` yet, so its owner is still blocked...
    IF pg_temp.i3660r_codes(public.biz_delete_host_account(v_owner)) IS DISTINCT FROM 'money_in_motion' THEN
      RAISE EXCEPTION 'issue_3660 rework F-1 sweep: the owner of a swept, unreleased order was not blocked';
    END IF;
    -- ...and the direct-charge owner, whose order the sweep ignored, is not.
    IF public.biz_delete_host_account(v_owner2)->>'status' IS DISTINCT FROM 'deleted' THEN
      RAISE EXCEPTION 'issue_3660 rework F-1 sweep: a direct-charge owner the sweep ignores was blocked';
    END IF;
    RAISE EXCEPTION 'i3660r_rollback' USING ERRCODE = 'I3661';
  EXCEPTION WHEN SQLSTATE 'I3661' THEN
    NULL;
  END;

  RAISE NOTICE 'issue_3660 rework F-1 PASS';
END;
$$;

-- ============================================================================
-- F-5 and F-7 — one deletion, then the retry.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_partner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_other_brand uuid := gen_random_uuid();
  v_inv_pending uuid := gen_random_uuid();
  v_inv_owner uuid := gen_random_uuid();     -- pending brand_owner handover
  v_inv_accepted uuid := gen_random_uuid();
  v_inv_elsewhere uuid := gen_random_uuid(); -- pending, on a brand NOT deleted
  v_link_handover uuid := gen_random_uuid(); -- waits on v_inv_owner
  v_link_pending uuid := gen_random_uuid();  -- invited, never accepted
  v_link_accepted uuid := gen_random_uuid(); -- accepted partner on the deleted brand
  v_link_elsewhere uuid := gen_random_uuid();-- pending, on a brand NOT deleted
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_first jsonb;
  v_second jsonb;
  v_snap_before text;
  v_snap_after text;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner), (v_other), (v_partner), (v_member);
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'i3660r-own@example.test'), (v_other, 'i3660r-oth@example.test'),
    (v_partner, 'i3660r-par@example.test'), (v_member, 'i3660r-mem@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand, v_owner, 'I3660R Main', 'i3660r-main-' || v_sfx, 'USD'),
    (v_other_brand, v_other, 'I3660R Other', 'i3660r-oth-' || v_sfx, 'USD');
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_i3660r_' || left(v_sfx, 10)
   WHERE id = v_brand;
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_brand, 'acct_i3660r5_' || left(v_sfx, 10), 'US', 'USD');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_member, 'event_manager', now(), now()),
         (v_brand, v_partner, 'finance_manager', now(), now());

  INSERT INTO public.brand_invitations
    (id, brand_id, email, role, invited_by, token_hash, expires_at, status, accepted_at)
  VALUES
    (v_inv_pending, v_brand, 'i3660r-inv1@example.test', 'event_manager', v_owner,
     'i3660r-' || gen_random_uuid()::text, now() + interval '7 days', 'pending', NULL),
    (v_inv_owner, v_brand, 'i3660r-handover@example.test', 'brand_owner', v_owner,
     'i3660r-' || gen_random_uuid()::text, now() + interval '7 days', 'pending', NULL),
    (v_inv_accepted, v_brand, 'i3660r-mem@example.test', 'event_manager', v_owner,
     'i3660r-' || gen_random_uuid()::text, now() + interval '7 days', 'accepted', now()),
    (v_inv_elsewhere, v_other_brand, 'i3660r-inv2@example.test', 'event_manager', v_other,
     'i3660r-' || gen_random_uuid()::text, now() + interval '7 days', 'pending', NULL);
  INSERT INTO public.partner_brand_links
    (id, partner_account_id, brand_id, invited_owner_email, accepted_at)
  VALUES
    (v_link_handover, v_other, v_brand, 'i3660r-handover@example.test', NULL),
    (v_link_pending, v_member, v_brand, 'i3660r-nobody@example.test', NULL),
    (v_link_accepted, v_partner, v_brand, 'i3660r-own@example.test', now()),
    (v_link_elsewhere, v_partner, v_other_brand, 'i3660r-nobody2@example.test', NULL);

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_first := public.biz_delete_host_account(v_owner);
  IF v_first->>'status' IS DISTINCT FROM 'deleted'
     OR (v_first->>'already_deleted')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'issue_3660 rework fixture: the deletion did not complete: %', v_first;
  END IF;

  -- F-7 — invitations --------------------------------------------------------
  IF (v_first->>'invitations_revoked')::integer <> 2 THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: expected 2 invitations revoked, got %', v_first;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_invitations
             WHERE brand_id = v_brand AND status = 'pending') THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: a pending invitation is left on a deleted brand';
  END IF;
  IF (SELECT count(*) FROM public.brand_invitations
       WHERE id IN (v_inv_pending, v_inv_owner)
         AND status = 'revoked' AND revoked_at IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: revoked invitations do not carry status revoked + revoked_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_invitations
                 WHERE id = v_inv_accepted AND status = 'accepted' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: an ACCEPTED invitation was rewritten';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_invitations
                 WHERE id = v_inv_elsewhere AND status = 'pending') THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: an invitation on a brand that was NOT deleted was revoked';
  END IF;

  -- F-7 — never-accepted partner links ---------------------------------------
  IF EXISTS (SELECT 1 FROM public.partner_brand_links
             WHERE brand_id = v_brand AND accepted_at IS NULL AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: a never-accepted partner link is still open on a deleted brand';
  END IF;
  IF (SELECT count(*) FROM public.partner_brand_links
       WHERE id IN (v_link_handover, v_link_pending)
         AND cancelled_at IS NOT NULL AND cancelled_reason = 'invitation_revoked') <> 2 THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: closed pending links do not carry invitation_revoked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_brand_links
                 WHERE id = v_link_accepted AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: an ACCEPTED partner link on the deleted brand was cancelled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_brand_links
                 WHERE id = v_link_elsewhere AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: a pending link on a brand that was NOT deleted was closed';
  END IF;
  -- Other members' rows on the deleted brand stay as they are.
  IF (SELECT count(*) FROM public.brand_team_members
       WHERE brand_id = v_brand AND user_id IN (v_member, v_partner)
         AND removed_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'issue_3660 rework F-7: another member''s row on the deleted brand was changed';
  END IF;

  -- F-5 — the retry returns the provider targets and writes nothing ----------
  IF jsonb_array_length(v_first->'stripe_accounts') <> 1
     OR jsonb_array_length(v_first->'paystack_subaccounts') <> 1 THEN
    RAISE EXCEPTION 'issue_3660 rework F-5 fixture: first call returned no provider targets: %', v_first;
  END IF;
  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brands t WHERE t.id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.creator_accounts t WHERE t.id = v_owner),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.stripe_connect_accounts t WHERE t.brand_id = v_brand),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brand_team_members t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brand_invitations t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.partner_brand_links t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT count(*)::text FROM public.audit_log)
  )) INTO v_snap_before;

  v_second := public.biz_delete_host_account(v_owner);

  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brands t WHERE t.id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.creator_accounts t WHERE t.id = v_owner),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.stripe_connect_accounts t WHERE t.brand_id = v_brand),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brand_team_members t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.brand_invitations t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT string_agg(to_jsonb(t)::text, ',' ORDER BY t.id) FROM public.partner_brand_links t WHERE t.brand_id IN (v_brand, v_other_brand)),
    (SELECT count(*)::text FROM public.audit_log)
  )) INTO v_snap_after;

  IF v_second->>'status' IS DISTINCT FROM 'deleted'
     OR (v_second->>'already_deleted')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: the retry was not reported as already deleted: %', v_second;
  END IF;
  IF v_second->'stripe_accounts' IS DISTINCT FROM v_first->'stripe_accounts' THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: the retry did not return the Stripe targets again: first % / retry %',
      v_first->'stripe_accounts', v_second->'stripe_accounts';
  END IF;
  IF v_second->'paystack_subaccounts' IS DISTINCT FROM v_first->'paystack_subaccounts' THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: the retry did not return the Paystack targets again: first % / retry %',
      v_first->'paystack_subaccounts', v_second->'paystack_subaccounts';
  END IF;
  IF v_second->'stripe_accounts'->0->>'stripe_account_id' NOT LIKE 'acct_i3660r5_%'
     OR v_second->'paystack_subaccounts'->0->>'subaccount_code' NOT LIKE 'ACCT_i3660r_%' THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: the retry returned the wrong targets: %', v_second;
  END IF;
  IF v_snap_before IS DISTINCT FROM v_snap_after THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: the retry wrote something';
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_log
   WHERE action = 'host_account.deleted' AND target_id = v_owner::text;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: expected one host_account.deleted audit row, found %', v_count;
  END IF;

  -- A deleted account with NO provider rows returns empty lists on the retry,
  -- not somebody else's targets.
  v_first := public.biz_delete_host_account(v_member);
  v_second := public.biz_delete_host_account(v_member);
  IF (v_second->>'already_deleted')::boolean IS NOT TRUE
     OR jsonb_array_length(v_second->'stripe_accounts') <> 0
     OR jsonb_array_length(v_second->'paystack_subaccounts') <> 0 THEN
    RAISE EXCEPTION 'issue_3660 rework F-5: a member-only retry returned provider targets: %', v_second;
  END IF;

  RAISE NOTICE 'issue_3660 rework F-5 F-7 PASS';
END;
$$;

-- ============================================================================
-- F-2 — a signed-in user cannot un-delete a brand.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_coadmin uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();   -- deleted through the Host deletion
  v_brand2 uuid := gen_random_uuid();  -- soft-deleted on its own, account stays
  v_live uuid := gen_random_uuid();    -- never deleted
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_rows integer;
  v_raised boolean;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'i3660r-f2-own-' || v_sfx || '@example.test'),
    (v_coadmin, 'i3660r-f2-co-' || v_sfx || '@example.test'),
    (v_admin, 'i3660r-f2-adm-' || v_sfx || '@example.test');
  INSERT INTO public.admin_users(email, status)
  VALUES ('i3660r-f2-adm-' || v_sfx || '@example.test', 'active');
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'i3660r-f2-own@example.test'), (v_coadmin, 'i3660r-f2-co@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand, v_owner, 'I3660R F2', 'i3660r-f2-' || v_sfx, 'USD'),
    (v_brand2, v_coadmin, 'I3660R F2b', 'i3660r-f2b-' || v_sfx, 'USD'),
    (v_live, v_coadmin, 'I3660R F2c', 'i3660r-f2c-' || v_sfx, 'USD');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand, v_coadmin, 'brand_admin', now(), now());

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  IF public.biz_delete_host_account(v_owner)->>'status' IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 'issue_3660 rework F-2 fixture: the deletion did not complete';
  END IF;

  -- (a) the kept login, on its own deleted brand, through RLS ----------------
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_owner)::text, true);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  BEGIN
    UPDATE public.brands SET deleted_at = NULL WHERE id = v_brand;
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := SQLERRM LIKE '%brand_restore_forbidden%';
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(a): the owner''s un-delete was not refused with brand_restore_forbidden';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(a): the deleted brand came back';
  END IF;

  -- (b) a brand admin who is not the account ---------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_coadmin::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_coadmin)::text, true);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  v_rows := 0;
  BEGIN
    UPDATE public.brands SET deleted_at = NULL WHERE id = v_brand;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(b): a brand admin un-deleted the brand (raised %, rows %)', v_raised, v_rows;
  END IF;

  -- (c) the same rule for an ORDINARY brand deletion, and soft-DELETING still
  --     works for the owner (the guard is one direction only) -----------------
  SET LOCAL ROLE authenticated;
  UPDATE public.brands SET deleted_at = now() WHERE id = v_brand2;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'issue_3660 rework F-2(c): the owner can no longer soft-delete their own brand';
  END IF;
  v_raised := false;
  BEGIN
    UPDATE public.brands SET deleted_at = NULL WHERE id = v_brand2;
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := SQLERRM LIKE '%brand_restore_forbidden%';
  END;
  -- Any other write to a live brand is untouched by the guard.
  UPDATE public.brands SET name = 'I3660R F2c renamed' WHERE id = v_live;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(c): an ordinary deleted brand was un-deleted by its owner';
  END IF;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(c): an unrelated update of a live brand was refused';
  END IF;

  -- (d) an ADMIN, signed in, can still restore (support) ----------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_admin)::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.brands SET deleted_at = NULL WHERE id = v_brand2;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  IF v_rows <> 1
     OR EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand2 AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(d): an admin could not restore a brand (rows %)', v_rows;
  END IF;

  -- (e) the SERVICE ROLE can still restore ------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  UPDATE public.brands SET deleted_at = NULL WHERE id = v_brand;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  IF v_rows <> 1
     OR EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(e): the service role could not restore a brand (rows %)', v_rows;
  END IF;

  -- (f) the guard function cannot be called by an API role, and the older
  --     guard it sits beside is still there -----------------------------------
  IF has_function_privilege('authenticated', 'public.issue_3660_guard_brand_undelete()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3660_guard_brand_undelete()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(f): the guard function is callable by an API role';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.brands'::regclass AND NOT tgisinternal AND tgenabled <> 'D'
         AND tgname IN ('issue_2063_guard_brand_soft_delete', 'issue_3660_guard_brand_undelete')) <> 2 THEN
    RAISE EXCEPTION 'issue_3660 rework F-2(f): one of the two brand guards is missing or disabled';
  END IF;

  RAISE NOTICE 'issue_3660 rework F-2 PASS';
END;
$$;

-- ============================================================================
-- F-6 — a checkout session past its expiry time.
--
-- Runtime evidence, three parts:
--   (1) BEFORE a deletion, an expired session that is still in a payable
--       status and holds a valid admission epoch DOES finalise into a paid
--       order (the finalize path never reads expires_at). The suspicion in the
--       tester's report is correct on that point.
--   (2) AFTER a deletion, the same kind of session does NOT: the take-down
--       revokes it, biz_ticket_checkout_finalize refuses and mints a reversal,
--       and no order or ticket is created.
--   (3) An expired session whose payment is being PROCESSED blocks the
--       deletion (checkout_in_progress); an expired abandoned cart does not.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_abandoned uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_epoch bigint;
  v_result jsonb;
  v_blockers jsonb;
  f_session text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'i3660r-f6@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_owner, 'I3660R F6', 'i3660r-f6-' || v_sfx, 'USD');
  INSERT INTO public.events(
    id, brand_id, created_by, title, description, slug, event_type, visibility,
    status, timezone, location_text, is_online, city, cover_media_url,
    cover_media_type, cover_media_alt, theme, published_at)
  VALUES (v_event, v_brand, v_owner, 'I3660R F6 Event',
    'A published upcoming event used to prove what an expired checkout can still do.',
    'i3660r-f6-e-' || v_sfx, 'event', 'public', 'scheduled', 'America/New_York',
    'Downtown Durham', false, 'Durham', 'https://images.example.test/i3660r-f6.jpg',
    'image', 'People at the event', '{}', now());
  INSERT INTO public.event_dates(event_id, start_at, end_at)
  VALUES (v_event, now() + interval '5 days', now() + interval '6 days');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, quantity_total)
  VALUES (v_tier, v_event, 'General', 1000, 'USD', 100);
  INSERT INTO public.event_checkout_admission_state(event_id, epoch, sellable, reason)
  VALUES (v_event, 1, true, 'sellable')
  ON CONFLICT (event_id) DO UPDATE SET sellable = true, reason = 'sellable';
  SELECT epoch INTO v_epoch FROM public.event_checkout_admission_state WHERE event_id = v_event;

  -- %1$L id, %2$L status, %3$L revoked_at (or NULL)
  f_session := format($f$INSERT INTO public.ticket_checkout_sessions
      (id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, currency,
       subtotal_cents, total_cents, status, idempotency_key, expires_at,
       application_fee_amount_cents, admission_epoch, revoked_at)
    VALUES (%%1$L, %1$L, %2$L, 'I3660R Buyer', 'i3660r-f6b@example.test',
            '+12015550199', 'USD', 1000, 1000, %%2$L,
            'i3660r-' || gen_random_uuid()::text, now() - interval '20 minutes',
            100, %3$s, %%3$s)$f$, v_event, v_brand, v_epoch);

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- (1) An expired, payable session finalises BEFORE any deletion. ------------
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE format(f_session, v_abandoned, 'requires_payment', 'NULL');
    PERFORM set_config('session_replication_role', 'origin', true);
    v_result := public.biz_ticket_checkout_finalize(
      v_abandoned, 'pi_i3660rF6a', 'ch_i3660rF6a', 'card', repeat('p', 64));
    IF v_result->>'outcome' IS DISTINCT FROM 'finalized'
       OR NOT EXISTS (SELECT 1 FROM public.orders
                      WHERE event_id = v_event AND payment_status = 'paid') THEN
      RAISE EXCEPTION 'issue_3660 rework F-6(1): the premise changed — an expired payable session no longer finalises (%). Re-read the F-6 decision.', v_result;
    END IF;
    -- ...and once it has, the paid order blocks the deletion like any other.
    v_result := public.biz_delete_host_account(v_owner);
    IF v_result->>'status' IS DISTINCT FROM 'blocked'
       OR pg_temp.i3660r_codes(v_result) NOT LIKE '%tickets_sold%' THEN
      RAISE EXCEPTION 'issue_3660 rework F-6(1): a late-finalised order did not block: %', v_result;
    END IF;
    RAISE EXCEPTION 'i3660r_rollback' USING ERRCODE = 'I3661';
  EXCEPTION WHEN SQLSTATE 'I3661' THEN
    NULL;
  END;

  -- (3) An expired session with a payment IN PROCESS blocks. ------------------
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE format(f_session, gen_random_uuid(), 'processing_payment', 'NULL');
    PERFORM set_config('session_replication_role', 'origin', true);
    v_result := public.biz_delete_host_account(v_owner);
    IF v_result->>'status' IS DISTINCT FROM 'blocked'
       OR pg_temp.i3660r_codes(v_result) IS DISTINCT FROM 'checkout_in_progress' THEN
      RAISE EXCEPTION 'issue_3660 rework F-6(3): an expired session with a payment in process did not block: %', v_result;
    END IF;
    RAISE EXCEPTION 'i3660r_rollback' USING ERRCODE = 'I3661';
  EXCEPTION WHEN SQLSTATE 'I3661' THEN
    NULL;
  END;
  -- ...unless it was revoked.
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE format(f_session, gen_random_uuid(), 'processing_payment', 'now()');
    PERFORM set_config('session_replication_role', 'origin', true);
    v_result := public.biz_delete_host_account(v_owner);
    IF v_result->>'status' IS DISTINCT FROM 'deleted' THEN
      RAISE EXCEPTION 'issue_3660 rework F-6(3): a REVOKED expired session blocked: %', v_result;
    END IF;
    RAISE EXCEPTION 'i3660r_rollback' USING ERRCODE = 'I3661';
  EXCEPTION WHEN SQLSTATE 'I3661' THEN
    NULL;
  END;

  -- (2) An expired abandoned cart does not block, and AFTER the deletion it
  --     cannot be turned into an order. ----------------------------------------
  PERFORM set_config('session_replication_role', 'replica', true);
  EXECUTE format(f_session, v_abandoned, 'requires_payment', 'NULL');
  PERFORM set_config('session_replication_role', 'origin', true);

  v_blockers := private.host_account_deletion_blockers(v_owner, ARRAY[v_brand]);
  IF v_blockers <> '[]'::jsonb THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2): an expired abandoned cart blocked: %', v_blockers;
  END IF;
  v_result := public.biz_delete_host_account(v_owner);
  IF v_result->>'status' IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2) fixture: the deletion did not complete: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_checkout_sessions
                 WHERE id = v_abandoned AND revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2): the take-down did not revoke the open session';
  END IF;

  v_result := public.biz_ticket_checkout_finalize(
    v_abandoned, 'pi_i3660rF6b', 'ch_i3660rF6b', 'card', repeat('p', 64));
  IF v_result->>'outcome' = 'finalized' THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2): a late payment was finalised on a taken-down event: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE event_id = v_event)
     OR EXISTS (SELECT 1 FROM public.tickets WHERE event_id = v_event) THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2): an order or ticket landed on a taken-down event';
  END IF;
  IF v_result->>'outcome' IS DISTINCT FROM 'paid_reversal_pending' THEN
    RAISE EXCEPTION 'issue_3660 rework F-6(2): the late payment was not routed to a reversal: %', v_result;
  END IF;

  RAISE NOTICE 'issue_3660 rework F-6 PASS';
END;
$$;

-- ============================================================================
-- RN-1 / RN-2 — the money rule mirrors EVERY arm of the payout sweep.
--
-- money_in_motion blocks exactly when the sweep would treat something as money
-- Mingla holds for the brand that has not been released. For each arm: one
-- "the sweep would ledger it, not released -> blocks" and the ways it would
-- never be ledgered -> does not block. The last block runs the REAL sweep over
-- one mixed set of fixtures and asserts that the sources it opens a payout
-- item for are exactly the sources the rule counts.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();      -- hold-rail brand
  v_brand uuid := gen_random_uuid();
  v_old uuid := gen_random_uuid();        -- ended 10 days ago (mature for the sweep)
  v_owner2 uuid := gen_random_uuid();     -- brand NOT on the hold rail
  v_brand2 uuid := gen_random_uuid();
  v_old2 uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_cutover timestamptz := now() - interval '30 days';
  f_order text;      -- %1 id, %2 event, %3 source, %4 payment_method, %5 provider ref or NULL, %6 age
  f_contrib text;    -- %1 id, %2 event, %3 brand, %4 provider ref or NULL, %5 age, %6 status
  f_deposit text;    -- %1 session id, %2 brand, %3 provider ref or NULL, %4 age, %5 session status
  f_menu text;       -- %1 id, %2 brand, %3 money_path, %4 provider or NULL, %5 provider ref or NULL, %6 age
  f_snap text;       -- %1 source_type, %2 source id
  f_released text;   -- %1 brand, %2 source_type, %3 source id
  v_id uuid;
  v_o_led uuid := gen_random_uuid();
  v_o_cash uuid := gen_random_uuid();
  v_o_before uuid := gen_random_uuid();
  v_c_led uuid := gen_random_uuid();
  v_c_none uuid := gen_random_uuid();
  v_d_led uuid := gen_random_uuid();
  v_d_none uuid := gen_random_uuid();
  v_m_led uuid := gen_random_uuid();
  v_m_cash uuid := gen_random_uuid();
  v_swept text;
  v_ruled text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner), (v_owner2);
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'i3660r-arms@example.test'), (v_owner2, 'i3660r-arms2@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand, v_owner, 'I3660R Arms Hold', 'i3660r-arms-' || v_sfx, 'USD'),
    (v_brand2, v_owner2, 'I3660R Arms Direct', 'i3660r-armsd-' || v_sfx, 'USD');
  UPDATE public.brands SET payout_hold_cutover_at = v_cutover WHERE id = v_brand;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status) VALUES
    (v_old, v_brand, v_owner, 'I3660R Arms Old', 'i3660r-arms-o-' || v_sfx, 'scheduled'),
    (v_old2, v_brand2, v_owner2, 'I3660R Arms Old Direct', 'i3660r-arms-od-' || v_sfx, 'scheduled');
  INSERT INTO public.event_dates(event_id, start_at, end_at) VALUES
    (v_old, now() - interval '11 days', now() - interval '10 days'),
    (v_old2, now() - interval '11 days', now() - interval '10 days');

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  f_order := $f$INSERT INTO public.orders
      (id, event_id, buyer_email, buyer_name, total_cents, currency, payment_status,
       source, payment_method, stripe_payment_intent_id, created_at)
    VALUES (%1$L, %2$L, 'i3660r-buyer@example.test', 'I3660R Buyer', 5000, 'USD', 'paid',
            %3$L, %4$L, %5$s, now() - (%6$L)::interval)$f$;
  f_contrib := $f$INSERT INTO public.event_rsvp_contributions
      (id, event_id, brand_id, provider, currency, amount_cents, buyer_total_cents,
       pricing_breakdown, status, paid_at, created_at, stripe_payment_intent_id)
    VALUES (%1$L, %2$L, %3$L, 'stripe', 'USD', 2500, 2500, '{}'::jsonb, %6$L,
            now() - (%5$L)::interval, now() - (%5$L)::interval, %4$s)$f$;
  -- A deposit is a completed reservation checkout session tied to a reservation
  -- that is long past and completed (so upcoming_reservations is not in play).
  f_deposit := $f$WITH r AS (
      INSERT INTO public.reservations
        (id, brand_id, venue_id, reserved_for, party_size, status, created_at)
      VALUES (gen_random_uuid(), %2$L, gen_random_uuid(), now() - interval '10 days', 2,
              'completed', now() - (%4$L)::interval)
      RETURNING id)
    INSERT INTO public.reservation_checkout_sessions
      (id, brand_id, reserved_for, party_size, buyer_name, buyer_email, buyer_phone_e164,
       amount_cents, currency, created_via, status, reservation_id, stripe_payment_intent_id)
    SELECT %1$L, %2$L, now() - interval '10 days', 2, 'I3660R Guest',
           'i3660r-guest@example.test', '+12015550197', 3000, 'USD', 'web', %5$L, r.id, %3$s
    FROM r$f$;
  -- Delivered and older than a day, so open_menu_orders is not in play.
  f_menu := $f$INSERT INTO public.venue_orders
      (id, session_id, brand_id, venue_id, qr_spot_id, source, money_path, currency,
       subtotal_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee,
       pass_service_fee, pass_tax, buyer_subtotal_cents, total_cents, idempotency_key,
       payment_status, fulfillment_status, acknowledged_at, acknowledged_by_user_id,
       confirmed_at, created_at, provider, stripe_payment_intent_id,
       buyer_name, buyer_email, buyer_phone_e164)
    VALUES (%1$L, gen_random_uuid(), %2$L, gen_random_uuid(), gen_random_uuid(), 'guest_qr',
            %3$L, 'USD', 1000, 0, 0, false, false, false, 1000, 1000,
            'i3660r-' || gen_random_uuid()::text, 'paid', 'delivered',
            now() - (%6$L)::interval, gen_random_uuid(), now() - (%6$L)::interval,
            now() - (%6$L)::interval, %4$s, %5$s,
            'I3660R Guest', 'i3660r-guest@example.test', '+12015550196')$f$;
  f_snap := $f$INSERT INTO public.payout_source_fee_snapshots
      (id, source_type, source_id, provider_fee_cents, captured_at)
    VALUES (gen_random_uuid(), %1$L, %2$L, 0, now())$f$;
  f_released := $f$WITH r AS (
      INSERT INTO public.brand_payout_releases
        (id, brand_id, occurrence_key, surface, provider, currency, anchor_end_at,
         releasable_at, gross_cents, net_release_cents, status)
      VALUES (gen_random_uuid(), %1$L, 'i3660r-' || gen_random_uuid()::text, 'order',
              'stripe', 'usd', date_trunc('second', now()) - interval '2 days',
              date_trunc('second', now()) - interval '1 day', 1000, 1000, 'released')
      RETURNING id)
    INSERT INTO public.payout_release_items
      (id, release_id, source_type, source_id, gross_cents, refunded_cents,
       disputed_cents, mingla_fee_cents, partner_share_cents, provider_fee_cents,
       net_cents, source_finalized_at)
    SELECT gen_random_uuid(), r.id, %2$L, %3$L, 1000, 0, 0, 0, 0, 0, 1000, now() FROM r$f$;

  PERFORM pg_temp.i3660r_case('arms baseline', 'SELECT 1', v_owner, 'deleted');

  -- ── ARM 1 — ticket orders ──────────────────────────────────────────────────
  v_id := gen_random_uuid();
  PERFORM pg_temp.i3660r_case('order: online sale WITH a fee snapshot',
    format(f_order, v_id, v_old, 'legacy', 'online_card', 'NULL', '12 days') || ';' || format(f_snap, 'order', v_id),
    v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('order: online sale, snapshot not captured yet (has a provider reference)',
    format(f_order, v_id, v_old, 'legacy', 'online_card', quote_literal('pi_i3660r_arm1'), '12 days'),
    v_owner, 'money_in_motion');
  -- RN-1: Mingla never held this money.
  PERFORM pg_temp.i3660r_case('order: CASH door sale (no snapshot, no provider reference)',
    format(f_order, v_id, v_old, 'door_sale', 'cash', 'NULL', '12 days'), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('order: online sale, RELEASED',
    format(f_order, v_id, v_old, 'legacy', 'online_card', 'NULL', '12 days') || ';' || format(f_snap, 'order', v_id)
      || ';' || format(f_released, v_brand, 'order', v_id),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('order: online sale with a snapshot, brand NOT on the hold rail',
    format(f_order, v_id, v_old2, 'legacy', 'online_card', 'NULL', '12 days') || ';' || format(f_snap, 'order', v_id),
    v_owner2, 'deleted');

  -- ── ARM 2 — RSVP contributions (RN-2) ──────────────────────────────────────
  PERFORM pg_temp.i3660r_case('contribution: paid, with a fee snapshot',
    format(f_contrib, v_id, v_old, v_brand, 'NULL', '12 days', 'paid') || ';' || format(f_snap, 'rsvp_contribution', v_id),
    v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('contribution: partly refunded, provider reference, no snapshot yet',
    format(f_contrib, v_id, v_old, v_brand, quote_literal('pi_i3660r_arm2'), '12 days', 'partially_refunded'),
    v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('contribution: no snapshot and no provider reference',
    format(f_contrib, v_id, v_old, v_brand, 'NULL', '12 days', 'paid'), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('contribution: paid BEFORE the cutover',
    format(f_contrib, v_id, v_old, v_brand, 'NULL', '60 days', 'paid') || ';' || format(f_snap, 'rsvp_contribution', v_id),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('contribution: refunded',
    format(f_contrib, v_id, v_old, v_brand, 'NULL', '12 days', 'refunded') || ';' || format(f_snap, 'rsvp_contribution', v_id),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('contribution: RELEASED',
    format(f_contrib, v_id, v_old, v_brand, 'NULL', '12 days', 'paid') || ';' || format(f_snap, 'rsvp_contribution', v_id)
      || ';' || format(f_released, v_brand, 'rsvp_contribution', v_id),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('contribution: brand NOT on the hold rail',
    format(f_contrib, v_id, v_old2, v_brand2, 'NULL', '12 days', 'paid') || ';' || format(f_snap, 'rsvp_contribution', v_id),
    v_owner2, 'deleted');

  -- ── ARM 3 — venue reservation deposits ─────────────────────────────────────
  PERFORM pg_temp.i3660r_case('deposit: completed, with a fee snapshot',
    format(f_deposit, v_id, v_brand, 'NULL', '12 days', 'completed') || ';' || format(f_snap, 'venue_reservation', v_id),
    v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('deposit: completed, provider reference, no snapshot yet',
    format(f_deposit, v_id, v_brand, quote_literal('pi_i3660r_arm3'), '12 days', 'completed'),
    v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('deposit: no snapshot and no provider reference',
    format(f_deposit, v_id, v_brand, 'NULL', '12 days', 'completed'), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('deposit: checkout never completed',
    format(f_deposit, v_id, v_brand, quote_literal('pi_i3660r_arm3'), '12 days', 'failed'), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('deposit: reservation made BEFORE the cutover',
    format(f_deposit, v_id, v_brand, 'NULL', '60 days', 'completed') || ';' || format(f_snap, 'venue_reservation', v_id),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('deposit: RELEASED',
    format(f_deposit, v_id, v_brand, 'NULL', '12 days', 'completed') || ';' || format(f_snap, 'venue_reservation', v_id)
      || ';' || format(f_released, v_brand, 'venue_reservation', v_id),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('deposit: brand NOT on the hold rail',
    format(f_deposit, v_id, v_brand2, 'NULL', '12 days', 'completed') || ';' || format(f_snap, 'venue_reservation', v_id),
    v_owner2, 'deleted');

  -- ── ARM 4 — menu orders ────────────────────────────────────────────────────
  PERFORM pg_temp.i3660r_case('menu order: paid through Mingla, with a fee snapshot',
    format(f_menu, v_id, v_brand, 'mingla', quote_literal('stripe'), quote_literal('pi_i3660r_arm4'), '12 days')
      || ';' || format(f_snap, 'venue_menu_order', v_id),
    v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('menu order: the venue took the money (venue_collected)',
    format(f_menu, v_id, v_brand, 'venue_collected', 'NULL', 'NULL', '12 days'), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('menu order: placed BEFORE the cutover',
    format(f_menu, v_id, v_brand, 'mingla', quote_literal('stripe'), quote_literal('pi_i3660r_arm4'), '60 days')
      || ';' || format(f_snap, 'venue_menu_order', v_id),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('menu order: RELEASED',
    format(f_menu, v_id, v_brand, 'mingla', quote_literal('stripe'), quote_literal('pi_i3660r_arm4'), '12 days')
      || ';' || format(f_snap, 'venue_menu_order', v_id) || ';' || format(f_released, v_brand, 'venue_menu_order', v_id),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('menu order: brand NOT on the hold rail',
    format(f_menu, v_id, v_brand2, 'mingla', quote_literal('stripe'), quote_literal('pi_i3660r_arm4'), '12 days')
      || ';' || format(f_snap, 'venue_menu_order', v_id),
    v_owner2, 'deleted');

  -- ── The rule and the REAL sweep agree, over one mixed set ──────────────────
  -- Four sources the sweep must ledger (each with its fee snapshot and old
  -- enough to be due) and five it must never ledger. Then the real sweep runs.
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE format(f_order, v_o_led, v_old, 'legacy', 'online_card', 'NULL', '12 days');
    EXECUTE format(f_snap, 'order', v_o_led);
    EXECUTE format(f_order, v_o_cash, v_old, 'door_sale', 'cash', 'NULL', '12 days');
    EXECUTE format(f_order, v_o_before, v_old, 'legacy', 'online_card', 'NULL', '60 days');
    EXECUTE format(f_snap, 'order', v_o_before);
    EXECUTE format(f_contrib, v_c_led, v_old, v_brand, 'NULL', '12 days', 'paid');
    EXECUTE format(f_snap, 'rsvp_contribution', v_c_led);
    EXECUTE format(f_contrib, v_c_none, v_old, v_brand, 'NULL', '12 days', 'paid');
    EXECUTE format(f_deposit, v_d_led, v_brand, 'NULL', '12 days', 'completed');
    EXECUTE format(f_snap, 'venue_reservation', v_d_led);
    EXECUTE format(f_deposit, v_d_none, v_brand, 'NULL', '12 days', 'completed');
    EXECUTE format(f_menu, v_m_led, v_brand, 'mingla', quote_literal('stripe'), quote_literal('pi_i3660r_mix'), '12 days');
    EXECUTE format(f_snap, 'venue_menu_order', v_m_led);
    EXECUTE format(f_menu, v_m_cash, v_brand, 'venue_collected', 'NULL', 'NULL', '12 days');
    PERFORM set_config('session_replication_role', 'origin', true);

    -- What the rule counts BEFORE the sweep has opened anything...
    SELECT COALESCE(string_agg(h.source_type || ':' || h.source_id::text, ',' ORDER BY h.source_type || ':' || h.source_id::text), '')
    INTO v_ruled
    FROM private.host_account_unreleased_held_money(ARRAY[v_brand], ARRAY[]::uuid[]) h;

    PERFORM public.run_payout_release_dark_sweep(now());

    -- ...must be exactly what the sweep then opens a payout item for.
    SELECT COALESCE(string_agg(i.source_type || ':' || i.source_id::text, ',' ORDER BY i.source_type || ':' || i.source_id::text), '')
    INTO v_swept
    FROM public.payout_release_items i
    JOIN public.brand_payout_releases pr ON pr.id = i.release_id
    WHERE pr.brand_id = v_brand AND pr.status <> 'released';

    IF v_swept = '' THEN
      RAISE EXCEPTION 'issue_3660 rework arms: the real sweep opened nothing; the fixtures no longer look like sales to it';
    END IF;
    IF v_ruled IS DISTINCT FROM v_swept THEN
      RAISE EXCEPTION 'issue_3660 rework arms: the rule and the sweep DISAGREE. Rule counts [%]; sweep opened [%]. Mirror the sweep in private.host_account_unreleased_held_money.', v_ruled, v_swept;
    END IF;
    IF v_swept IS DISTINCT FROM (
      SELECT string_agg(x, ',' ORDER BY x) FROM unnest(ARRAY[
        'order:' || v_o_led::text, 'rsvp_contribution:' || v_c_led::text,
        'venue_reservation:' || v_d_led::text, 'venue_menu_order:' || v_m_led::text]) x) THEN
      RAISE EXCEPTION 'issue_3660 rework arms: the sweep did not open exactly the four expected sources: [%]', v_swept;
    END IF;
    -- After the sweep the same four are still unreleased, so still counted...
    IF v_ruled IS DISTINCT FROM (
      SELECT COALESCE(string_agg(h.source_type || ':' || h.source_id::text, ',' ORDER BY h.source_type || ':' || h.source_id::text), '')
      FROM private.host_account_unreleased_held_money(ARRAY[v_brand], ARRAY[]::uuid[]) h) THEN
      RAISE EXCEPTION 'issue_3660 rework arms: opening a payout item changed what the rule counts';
    END IF;
    -- ...and the deletion is refused for exactly that reason.
    IF pg_temp.i3660r_codes(public.biz_delete_host_account(v_owner)) IS DISTINCT FROM 'money_in_motion' THEN
      RAISE EXCEPTION 'issue_3660 rework arms: a Host with four swept, unreleased sources was not blocked';
    END IF;
    -- Once every one of them is released, the same Host is deleted.
    UPDATE public.brand_payout_releases SET status = 'released', released_at = now()
     WHERE brand_id = v_brand;
    IF public.biz_delete_host_account(v_owner)->>'status' IS DISTINCT FROM 'deleted' THEN
      RAISE EXCEPTION 'issue_3660 rework arms: a Host whose payouts were all released is still blocked';
    END IF;
    RAISE EXCEPTION 'i3660r_rollback' USING ERRCODE = 'I3661';
  EXCEPTION WHEN SQLSTATE 'I3661' THEN
    NULL;
  END;

  RAISE NOTICE 'issue_3660 rework RN-1 RN-2 arms PASS';
END;
$$;

-- ============================================================================
-- RN-3 — a later deletion carries the provider targets of an earlier one.
-- ============================================================================
DO $$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b1 uuid := gen_random_uuid();
  v_b2 uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_first jsonb;
  v_second jsonb;
  v_third jsonb;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_a);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_a, 'i3660r-rn3@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b1, v_a, 'I3660R RN3 One', 'i3660r-rn3a-' || v_sfx, 'USD');
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_i3660rn3_' || left(v_sfx, 8) WHERE id = v_b1;
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_b1, 'acct_i3660rn3a_' || left(v_sfx, 8), 'US', 'USD');

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_first := public.biz_delete_host_account(v_a);          -- commits; response lost
  IF jsonb_array_length(v_first->'stripe_accounts') <> 1
     OR jsonb_array_length(v_first->'paystack_subaccounts') <> 1 THEN
    RAISE EXCEPTION 'issue_3660 rework RN-3 fixture: first deletion returned no targets: %', v_first;
  END IF;

  -- The Host reopens the app (sign-in recovery clears the marker) and, this
  -- time, also creates a NEW brand with its own Stripe account before deleting.
  UPDATE public.creator_accounts SET deleted_at = NULL WHERE id = v_a;
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b2, v_a, 'I3660R RN3 Two', 'i3660r-rn3b-' || v_sfx, 'USD');
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_b2, 'acct_i3660rn3b_' || left(v_sfx, 8), 'US', 'USD');

  v_second := public.biz_delete_host_account(v_a);
  IF v_second->>'status' IS DISTINCT FROM 'deleted'
     OR (v_second->>'already_deleted')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'issue_3660 rework RN-3: the second deletion did not run as a fresh deletion: %', v_second;
  END IF;
  -- Earlier AND new Stripe targets, each exactly once.
  IF jsonb_array_length(v_second->'stripe_accounts') <> 2
     OR NOT ((v_second->'stripe_accounts') @> (v_first->'stripe_accounts'))
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_second->'stripe_accounts') x
                    WHERE x->>'brand_id' = v_b2::text
                      AND x->>'stripe_account_id' LIKE 'acct_i3660rn3b_%') THEN
    RAISE EXCEPTION 'issue_3660 rework RN-3: expected the earlier and the new Stripe target, once each: %', v_second->'stripe_accounts';
  END IF;
  -- The earlier Paystack target is carried too (its code was already cleared
  -- from the brand row, so the audit row is the only place it still exists).
  IF v_second->'paystack_subaccounts' IS DISTINCT FROM v_first->'paystack_subaccounts' THEN
    RAISE EXCEPTION 'issue_3660 rework RN-3: the earlier Paystack target was lost: first % / second %',
      v_first->'paystack_subaccounts', v_second->'paystack_subaccounts';
  END IF;
  -- Only the NEW brand was deleted this time, and the count says so.
  IF NOT (v_second->'brand_ids' @> to_jsonb(ARRAY[v_b2]))
     OR jsonb_array_length(v_second->'brand_ids') <> 1 THEN
    RAISE EXCEPTION 'issue_3660 rework RN-3: brand_ids wrong on the second deletion: %', v_second;
  END IF;
  IF (SELECT (after->>'stripe_accounts_detached')::integer FROM public.audit_log
      WHERE action = 'host_account.deleted' AND target_id = v_a::text
      ORDER BY created_at DESC, id DESC LIMIT 1) <> 1 THEN
    RAISE EXCEPTION 'issue_3660 rework RN-3: the audit row over-counts what THIS run detached';
  END IF;

  -- A third call (already deleted) still returns the full, de-duplicated set.
  v_third := public.biz_delete_host_account(v_a);
  IF (v_third->>'already_deleted')::boolean IS NOT TRUE
     OR v_third->'stripe_accounts' IS DISTINCT FROM v_second->'stripe_accounts'
     OR v_third->'paystack_subaccounts' IS DISTINCT FROM v_second->'paystack_subaccounts' THEN
    RAISE EXCEPTION 'issue_3660 rework RN-3: the retry after the second deletion lost targets: %', v_third;
  END IF;

  -- Recover and delete once more with nothing new: still the same set, no
  -- duplicates however many audit rows now hold it.
  UPDATE public.creator_accounts SET deleted_at = NULL WHERE id = v_a;
  v_third := public.biz_delete_host_account(v_a);
  SELECT count(*) INTO v_count FROM public.audit_log
   WHERE action = 'host_account.deleted' AND target_id = v_a::text;
  IF v_count <> 3
     OR v_third->'stripe_accounts' IS DISTINCT FROM v_second->'stripe_accounts'
     OR v_third->'paystack_subaccounts' IS DISTINCT FROM v_second->'paystack_subaccounts' THEN
    RAISE EXCEPTION 'issue_3660 rework RN-3: targets were duplicated or lost across three deletions (audit rows %): %', v_count, v_third;
  END IF;

  -- Another account's audit rows are never mixed in.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.biz_delete_host_account(gen_random_uuid())->'stripe_accounts')) THEN
    RAISE EXCEPTION 'issue_3660 rework RN-3: an unknown account was given provider targets';
  END IF;

  RAISE NOTICE 'issue_3660 rework RN-3 PASS';
END;
$$;

-- ============================================================================
-- FK-1 (fourth rework) — an earlier provider target is returned only if it is
-- STILL true today: the brand is still owned by this account, still deleted,
-- and its provider row still carries that id with the detach stamp. Otherwise
-- it is dropped, on a retry AND on a fresh deletion after sign-in recovery.
-- ============================================================================
DO $$
DECLARE
  v_h uuid := gen_random_uuid();      -- the Host who deletes
  v_n uuid := gen_random_uuid();      -- the new owner support hands a brand to
  v_adm uuid := gen_random_uuid();
  v_keep uuid := gen_random_uuid();   -- stays deleted under H: the positive control
  v_moved uuid := gen_random_uuid();  -- restored + reassigned to N, NOT reconnected
  v_back uuid := gen_random_uuid();   -- restored to H and reconnected
  v_swap uuid := gen_random_uuid();   -- still H's and deleted, but its Stripe row now holds another id
  v_live uuid := gen_random_uuid();   -- still H's and deleted, but its Stripe row is attached again
  v_psr uuid := gen_random_uuid();    -- still H's and deleted, Paystack recipient active again
  v_own uuid := gen_random_uuid();    -- still deleted and detached, but now owned by N
  v_undel uuid := gen_random_uuid();  -- still H's and detached, but no longer deleted
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_first jsonb;
  v_retry jsonb;
  v_fresh jsonb;
  v_helper jsonb;
  v_ids text;
  v_codes text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_h, 'i3660r-fk1-h-' || v_sfx || '@example.test'),
    (v_n, 'i3660r-fk1-n-' || v_sfx || '@example.test'),
    (v_adm, 'i3660r-fk1-a-' || v_sfx || '@example.test');
  INSERT INTO public.creator_accounts(id, email)
  SELECT u.id, u.email FROM auth.users u WHERE u.id IN (v_h, v_n, v_adm);
  INSERT INTO public.admin_users(email, status)
  VALUES ('i3660r-fk1-a-' || v_sfx || '@example.test', 'active');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  SELECT x.id, v_h, 'I3660R FK1 ' || x.tag, 'i3660r-fk1-' || x.tag || '-' || v_sfx, 'USD'
  FROM (VALUES (v_keep, 'keep'), (v_moved, 'moved'), (v_back, 'back'),
               (v_swap, 'swap'), (v_live, 'live'), (v_psr, 'psr'),
               (v_own, 'own'), (v_undel, 'undel')) x(id, tag);
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  SELECT x.id, 'acct_fk1' || x.tag || '_' || left(v_sfx, 8), 'US', 'USD'
  FROM (VALUES (v_keep, 'keep'), (v_moved, 'moved'), (v_back, 'back'),
               (v_swap, 'swap'), (v_live, 'live'), (v_own, 'own'), (v_undel, 'undel')) x(id, tag);
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_fk1keep_' || left(v_sfx, 8) WHERE id = v_keep;
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_fk1moved_' || left(v_sfx, 8) WHERE id = v_moved;
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_fk1psr_' || left(v_sfx, 8) WHERE id = v_psr;
  INSERT INTO public.brand_paystack_recipients
    (brand_id, recipient_code, bank_code, account_fingerprint, account_number_masked, account_name)
  VALUES (v_psr, 'RCP_fk1psr_' || left(v_sfx, 8), '000', 'hmac-sha256:' || repeat('b', 64),
          '••••0000', 'I3660R Fixture');

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 1. H is deleted. Seven Stripe targets, three Paystack targets.
  v_first := public.biz_delete_host_account(v_h);
  IF v_first->>'status' IS DISTINCT FROM 'deleted'
     OR jsonb_array_length(v_first->'stripe_accounts') <> 7
     OR jsonb_array_length(v_first->'paystack_subaccounts') <> 3 THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 fixture: first deletion wrong: %', v_first;
  END IF;

  -- What the audit row stores: every entry names its brand.
  IF EXISTS (
    SELECT 1 FROM public.audit_log al,
      jsonb_array_elements(al.before->'stripe_accounts' || al.before->'paystack_subaccounts') x
    WHERE al.action = 'host_account.deleted' AND al.target_id = v_h::text
      AND NOT (x ? 'brand_id')) THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1: an audit entry does not name its brand';
  END IF;

  -- Positive control: with nothing changed, a retry returns everything again.
  v_retry := public.biz_delete_host_account(v_h);
  IF v_retry->'stripe_accounts' IS DISTINCT FROM v_first->'stripe_accounts'
     OR v_retry->'paystack_subaccounts' IS DISTINCT FROM v_first->'paystack_subaccounts' THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 control: an untouched retry lost targets: %', v_retry;
  END IF;

  -- 2. The world moves on.
  --  (moved) support restores the brand and hands it to N. N does NOT reconnect:
  --          the Stripe row is still stamped detached with the same id.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_adm::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_adm)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_set_brand_deleted(v_moved, false, 'i3660r support restore');
  PERFORM public.admin_reassign_brand_owner(v_moved, v_n, 'i3660r reassign to the new owner');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.brands b JOIN public.stripe_connect_accounts s ON s.brand_id = b.id
                 WHERE b.id = v_moved AND b.account_id = v_n AND b.deleted_at IS NULL
                   AND s.detached_at IS NOT NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 fixture: the moved brand is not live under N with its Stripe row still detached';
  END IF;
  --  (own) the brand changes hands while STILL deleted and STILL detached, so
  --        only the ownership test can drop it. (Written with triggers off: a
  --        brand's account is immutable through the normal paths.)
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.brands SET account_id = v_n WHERE id = v_own;
  -- ...and H's own team row on it is closed, as a real handover closes it, so
  -- H has nothing live left and the retry below takes the already-deleted path.
  UPDATE public.brand_team_members SET removed_at = now()
   WHERE brand_id = v_own AND user_id = v_h AND removed_at IS NULL;
  PERFORM set_config('session_replication_role', 'origin', true);
  --  (swap) still H's and deleted, but the Stripe row now holds a different id.
  UPDATE public.stripe_connect_accounts
     SET stripe_account_id = 'acct_fk1swapNEW_' || left(v_sfx, 8) WHERE brand_id = v_swap;
  --  (live) still H's and deleted, but the Stripe row was attached again.
  UPDATE public.stripe_connect_accounts SET detached_at = NULL WHERE brand_id = v_live;
  --  (psr) still H's and deleted, but its Paystack recipient is active again.
  UPDATE public.brand_paystack_recipients SET is_active = true WHERE brand_id = v_psr;
  --  An older-style audit row whose entries carry NO brand id, plus junk.
  INSERT INTO public.audit_log(user_id, action, target_type, target_id, before, after)
  VALUES (v_h, 'host_account.deleted', 'creator_account', v_h::text,
    jsonb_build_object(
      'stripe_accounts', jsonb_build_array(
        jsonb_build_object('stripe_account_id', 'acct_fk1NOBRAND_' || left(v_sfx, 8)),
        jsonb_build_object('brand_id', 'not-a-uuid', 'stripe_account_id', 'acct_fk1BADBRAND'),
        jsonb_build_object('brand_id', v_keep),
        'null'::jsonb, to_jsonb(7), to_jsonb('x'::text)),
      'paystack_subaccounts', jsonb_build_array(
        jsonb_build_object('subaccount_code', 'ACCT_fk1NOBRAND_' || left(v_sfx, 8)),
        'null'::jsonb)),
    '{}'::jsonb);

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 3a. H retries while still marked deleted.
  v_retry := public.biz_delete_host_account(v_h);
  IF (v_retry->>'already_deleted')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1: expected the already-deleted path, got %', v_retry;
  END IF;
  SELECT string_agg(x->>'stripe_account_id', ',' ORDER BY x->>'stripe_account_id') INTO v_ids
  FROM jsonb_array_elements(v_retry->'stripe_accounts') x;
  SELECT string_agg(x->>'subaccount_code', ',' ORDER BY x->>'subaccount_code') INTO v_codes
  FROM jsonb_array_elements(v_retry->'paystack_subaccounts') x;

  IF v_ids LIKE '%acct_fk1moved_%' THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 RETRY: returned the Stripe account of a brand now owned by another account: %', v_ids;
  END IF;
  IF v_codes LIKE '%ACCT_fk1moved_%' THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 RETRY: returned the Paystack subaccount of a brand now owned by another account: %', v_codes;
  END IF;
  IF v_ids LIKE '%acct_fk1own_%' THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 RETRY: returned the Stripe account of a deleted brand that now belongs to another account: %', v_ids;
  END IF;
  IF v_ids LIKE '%acct_fk1swap_%' OR v_ids LIKE '%acct_fk1swapNEW_%' THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 RETRY: returned an id the brand''s Stripe row no longer carries: %', v_ids;
  END IF;
  IF v_ids LIKE '%acct_fk1live_%' THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 RETRY: returned a Stripe account that is attached again: %', v_ids;
  END IF;
  IF v_codes LIKE '%ACCT_fk1psr_%' THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 RETRY: returned a Paystack subaccount whose recipient is active again: %', v_codes;
  END IF;
  IF v_ids LIKE '%NOBRAND%' OR v_ids LIKE '%BADBRAND%' OR v_codes LIKE '%NOBRAND%' THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 RETRY: returned an entry that names no brand and cannot be checked: % / %', v_ids, v_codes;
  END IF;
  -- Exactly what is still true: the untouched brand, and the one restored
  -- below has not happened yet, so "back" is still deleted and detached.
  IF v_ids IS DISTINCT FROM (
       SELECT string_agg(x, ',' ORDER BY x) FROM unnest(ARRAY[
         'acct_fk1back_' || left(v_sfx, 8), 'acct_fk1keep_' || left(v_sfx, 8),
         'acct_fk1undel_' || left(v_sfx, 8)]) x)
     OR v_codes IS DISTINCT FROM 'ACCT_fk1keep_' || left(v_sfx, 8) THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 RETRY: expected exactly the still-true targets, got % / %', v_ids, v_codes;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_retry->'stripe_accounts' || v_retry->'paystack_subaccounts') x
             WHERE jsonb_typeof(x) <> 'object' OR NOT (x ? 'brand_id')) THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 RETRY: a malformed entry was passed through: %', v_retry;
  END IF;

  -- (undel) the brand is restored to H but payouts are NOT reconnected: still
  -- H's, Stripe row still detached with the same id, so only the "still
  -- deleted" test can drop it. Checked on the function that does the checking,
  -- then put back (a live owned brand would send the next call down the
  -- fresh-deletion path, where it is deleted again as a NEW target).
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.brands SET deleted_at = NULL WHERE id = v_undel;
  PERFORM set_config('session_replication_role', 'origin', true);
  v_helper := private.host_account_earlier_provider_targets(v_h);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_helper->'stripe_accounts') x
             WHERE x->>'stripe_account_id' LIKE 'acct_fk1undel_%') THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1: a brand that is no longer deleted is still listed as an earlier target: %', v_helper;
  END IF;
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.brands SET deleted_at = now() WHERE id = v_undel;
  PERFORM set_config('session_replication_role', 'origin', true);

  -- (back) the brand is restored to H and reconnected: same id, detach cleared.
  -- It is no longer deleted or detached, so as an EARLIER target it is not true.
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.brands SET deleted_at = NULL WHERE id = v_back;
  UPDATE public.stripe_connect_accounts SET detached_at = NULL WHERE brand_id = v_back;
  PERFORM set_config('session_replication_role', 'origin', true);
  v_helper := private.host_account_earlier_provider_targets(v_h);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_helper->'stripe_accounts') x
             WHERE x->>'stripe_account_id' LIKE 'acct_fk1back_%') THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1: a brand restored to its owner and reconnected is still listed as an earlier target: %', v_helper;
  END IF;
  -- Put it back to deleted + detached so the fresh deletion below is about
  -- the earlier targets only (a live owned brand would be deleted afresh,
  -- which is a NEW target and correct).
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.brands SET deleted_at = now() WHERE id = v_back;
  UPDATE public.stripe_connect_accounts SET detached_at = now() WHERE brand_id = v_back;
  PERFORM set_config('session_replication_role', 'origin', true);

  -- 3b. H reopens the app (sign-in recovery clears the marker) and deletes again.
  UPDATE public.creator_accounts SET deleted_at = NULL WHERE id = v_h;
  v_fresh := public.biz_delete_host_account(v_h);
  IF v_fresh->>'status' IS DISTINCT FROM 'deleted'
     OR (v_fresh->>'already_deleted')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1: expected a fresh deletion, got %', v_fresh;
  END IF;
  IF v_fresh->'stripe_accounts' IS DISTINCT FROM v_retry->'stripe_accounts'
     OR v_fresh->'paystack_subaccounts' IS DISTINCT FROM v_retry->'paystack_subaccounts' THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1 FRESH: a fresh deletion returned different earlier targets than the retry: % vs %',
      v_fresh, v_retry;
  END IF;
  -- The new owner's brand was never touched by any of this.
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id = v_moved AND account_id = v_n AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'issue_3660 rework FK-1: the brand handed to another owner was modified';
  END IF;

  RAISE NOTICE 'issue_3660 rework FK-1 PASS';
END;
$$;

-- ============================================================================
-- FK-2 (fourth rework) — a dispute that is terminally LOST is not held money.
-- Lost in full: nothing is left, the sweep never ledgers it, it must not
-- block. Lost in part: the remainder is held and blocks. Open: blocks (money
-- in motion; the same held-money arm covers it, because only 'lost' is
-- subtracted). Won: blocks until released.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_old uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_o uuid := gen_random_uuid();
  v_m uuid := gen_random_uuid();
  f_order text;    -- an online order of 5000 with its fee snapshot
  f_menu text;     -- a Mingla-path menu order of 1000 with its fee snapshot
  f_dispute text;  -- %1 'order_id' | 'venue_order_id', %2 subject id, %3 amount, %4 status
  f_released text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'i3660r-fk2@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_owner, 'I3660R FK2', 'i3660r-fk2-' || v_sfx, 'USD');
  UPDATE public.brands SET payout_hold_cutover_at = now() - interval '30 days' WHERE id = v_brand;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status)
  VALUES (v_old, v_brand, v_owner, 'I3660R FK2 Old', 'i3660r-fk2-o-' || v_sfx, 'scheduled');
  INSERT INTO public.event_dates(event_id, start_at, end_at)
  VALUES (v_old, now() - interval '11 days', now() - interval '10 days');

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  f_order := format($f$INSERT INTO public.orders
      (id, event_id, buyer_email, buyer_name, total_cents, currency, payment_status,
       source, payment_method, stripe_payment_intent_id, created_at)
    VALUES (%1$L, %2$L, 'i3660r-buyer@example.test', 'I3660R Buyer', 5000, 'USD', 'paid',
            'legacy', 'online_card', 'pi_i3660r_fk2', now() - interval '12 days');
    INSERT INTO public.payout_source_fee_snapshots
      (id, source_type, source_id, provider_fee_cents, captured_at)
    VALUES (gen_random_uuid(), 'order', %1$L, 0, now())$f$, v_o, v_old);
  f_menu := format($f$INSERT INTO public.venue_orders
      (id, session_id, brand_id, venue_id, qr_spot_id, source, money_path, currency,
       subtotal_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee,
       pass_service_fee, pass_tax, buyer_subtotal_cents, total_cents, idempotency_key,
       payment_status, fulfillment_status, acknowledged_at, acknowledged_by_user_id,
       confirmed_at, created_at, provider, stripe_payment_intent_id,
       buyer_name, buyer_email, buyer_phone_e164)
    VALUES (%1$L, gen_random_uuid(), %2$L, gen_random_uuid(), gen_random_uuid(), 'guest_qr',
            'mingla', 'USD', 1000, 0, 0, false, false, false, 1000, 1000,
            'i3660r-' || gen_random_uuid()::text, 'paid', 'delivered',
            now() - interval '12 days', gen_random_uuid(), now() - interval '12 days',
            now() - interval '12 days', 'stripe', 'pi_i3660r_fk2m',
            'I3660R Guest', 'i3660r-guest@example.test', '+12015550195');
    INSERT INTO public.payout_source_fee_snapshots
      (id, source_type, source_id, provider_fee_cents, captured_at)
    VALUES (gen_random_uuid(), 'venue_menu_order', %1$L, 0, now())$f$, v_m, v_brand);
  f_dispute := $f$INSERT INTO public.stripe_disputes
      (stripe_dispute_id, stripe_charge_id, stripe_account_id, %1$s, amount, currency,
       status, reason, raw_event)
    VALUES ('dp_i3660r_' || left(replace(gen_random_uuid()::text, '-', ''), 14),
            'ch_i3660r_fk2', 'acct_i3660r_fk2', %2$L, %3$s, 'usd', %4$L, 'fraudulent', '{}'::jsonb)$f$;
  f_released := $f$WITH r AS (
      INSERT INTO public.brand_payout_releases
        (id, brand_id, occurrence_key, surface, provider, currency, anchor_end_at,
         releasable_at, gross_cents, net_release_cents, status)
      VALUES (gen_random_uuid(), %1$L, 'i3660r-' || gen_random_uuid()::text, 'order',
              'stripe', 'usd', date_trunc('second', now()) - interval '2 days',
              date_trunc('second', now()) - interval '1 day', 1000, 1000, 'released')
      RETURNING id)
    INSERT INTO public.payout_release_items
      (id, release_id, source_type, source_id, gross_cents, refunded_cents,
       disputed_cents, mingla_fee_cents, partner_share_cents, provider_fee_cents,
       net_cents, source_finalized_at)
    SELECT gen_random_uuid(), r.id, %2$L, %3$L, 1000, 0, 0, 0, 0, 0, 1000, now() FROM r$f$;

  PERFORM pg_temp.i3660r_case('FK-2 baseline', 'SELECT 1', v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('FK-2 control: the order with no dispute blocks', f_order, v_owner, 'money_in_motion');

  -- ── ticket orders ──────────────────────────────────────────────────────────
  PERFORM pg_temp.i3660r_case('order: dispute LOST in full',
    f_order || ';' || format(f_dispute, 'order_id', v_o, 5000, 'lost'), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('order: two disputes LOST that add up to the whole amount',
    f_order || ';' || format(f_dispute, 'order_id', v_o, 3000, 'lost') || ';' || format(f_dispute, 'order_id', v_o, 2000, 'lost'),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('order: dispute LOST in part (the rest is still held)',
    f_order || ';' || format(f_dispute, 'order_id', v_o, 2000, 'lost'), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('order: dispute OPEN (needs_response)',
    f_order || ';' || format(f_dispute, 'order_id', v_o, 5000, 'needs_response'), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('order: dispute OPEN (under_review)',
    f_order || ';' || format(f_dispute, 'order_id', v_o, 5000, 'under_review'), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('order: dispute WON by the merchant, not yet released',
    f_order || ';' || format(f_dispute, 'order_id', v_o, 5000, 'won'), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('order: dispute WON by the merchant, released',
    f_order || ';' || format(f_dispute, 'order_id', v_o, 5000, 'won') || ';' || format(f_released, v_brand, 'order', v_o),
    v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('order: an inquiry closed without a chargeback (warning_closed)',
    f_order || ';' || format(f_dispute, 'order_id', v_o, 5000, 'warning_closed'), v_owner, 'money_in_motion');
  -- A lost dispute on ANOTHER order takes nothing off this one.
  PERFORM pg_temp.i3660r_case('order: a LOST dispute that belongs to a different order',
    f_order || ';' || format(f_dispute, 'order_id', gen_random_uuid(), 5000, 'lost'), v_owner, 'money_in_motion');

  -- ── menu orders ────────────────────────────────────────────────────────────
  PERFORM pg_temp.i3660r_case('FK-2 control: the menu order with no dispute blocks', f_menu, v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('menu order: dispute LOST in full',
    f_menu || ';' || format(f_dispute, 'venue_order_id', v_m, 1000, 'lost'), v_owner, 'deleted');
  PERFORM pg_temp.i3660r_case('menu order: dispute LOST in part',
    f_menu || ';' || format(f_dispute, 'venue_order_id', v_m, 400, 'lost'), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('menu order: dispute OPEN',
    f_menu || ';' || format(f_dispute, 'venue_order_id', v_m, 1000, 'needs_response'), v_owner, 'money_in_motion');
  PERFORM pg_temp.i3660r_case('menu order: dispute WON, not yet released',
    f_menu || ';' || format(f_dispute, 'venue_order_id', v_m, 1000, 'won'), v_owner, 'money_in_motion');

  -- ── and the real sweep agrees on the two terminal cases ───────────────────
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE f_order;
    EXECUTE format(f_dispute, 'order_id', v_o, 5000, 'lost');
    EXECUTE f_menu;
    EXECUTE format(f_dispute, 'venue_order_id', v_m, 400, 'lost');
    PERFORM set_config('session_replication_role', 'origin', true);
    PERFORM public.run_payout_release_dark_sweep(now() + interval '60 days');
    -- Lost in full: the sweep opens nothing, and the rule counts nothing.
    IF EXISTS (SELECT 1 FROM public.payout_release_items WHERE source_type = 'order' AND source_id = v_o)
       OR EXISTS (SELECT 1 FROM private.host_account_unreleased_held_money(ARRAY[v_brand], ARRAY[]::uuid[]) h
                  WHERE h.source_type = 'order') THEN
      RAISE EXCEPTION 'issue_3660 rework FK-2 sweep: an order lost in full was ledgered or counted';
    END IF;
    -- Lost in part: the sweep opens an item, and the rule counts it.
    IF NOT EXISTS (SELECT 1 FROM public.payout_release_items WHERE source_type = 'venue_menu_order' AND source_id = v_m)
       OR NOT EXISTS (SELECT 1 FROM private.host_account_unreleased_held_money(ARRAY[v_brand], ARRAY[]::uuid[]) h
                      WHERE h.source_type = 'venue_menu_order' AND h.source_id = v_m) THEN
      RAISE EXCEPTION 'issue_3660 rework FK-2 sweep: a menu order lost in part was not ledgered, or not counted';
    END IF;
    RAISE EXCEPTION 'i3660r_rollback' USING ERRCODE = 'I3661';
  EXCEPTION WHEN SQLSTATE 'I3661' THEN
    NULL;
  END;

  RAISE NOTICE 'issue_3660 rework FK-2 PASS';
END;
$$;

ROLLBACK;

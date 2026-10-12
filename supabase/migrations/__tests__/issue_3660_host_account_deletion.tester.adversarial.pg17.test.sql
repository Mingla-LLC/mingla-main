\set ON_ERROR_STOP on
-- Issue #3660 — Host account deletion completes or changes nothing.
-- ADVERSARIAL axis for public.biz_delete_host_account.
--
-- Proves (SPEC success criteria):
--   SC-3  a sold ticket on an upcoming event blocks, and NOTHING is written;
--   SC-4  every blocker code blocks alone, and every "does not count" case
--         does not block;
--   SC-5  a failure forced on a write step raises and leaves every row as it
--         was (first write-adjacent step and the very last write);
--   SC-11 the two pre-existing guards still refuse everybody else;
--   partner amendment: an unsettled partner split blocks and changes nothing,
--         a settled one does not block.
--
-- Each case runs in its own subtransaction that is always rolled back, so the
-- cases cannot contaminate each other. Fixtures for tables with deep foreign
-- key graphs are inserted under session_replication_role = replica; the role is
-- back to origin before the function under test is called, so every trigger
-- and guard the function meets is live.
--
-- No row in auth.users is deleted here (CI and production disagree on those
-- foreign keys).
BEGIN;

-- md5 over every row the function could write, for the fixture ids.
CREATE FUNCTION pg_temp.i3660_snap(p_users uuid[], p_brands uuid[])
RETURNS text
LANGUAGE sql
AS $fn$
  SELECT md5(concat_ws('|',
    (SELECT COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id), '')
       FROM public.events t WHERE t.brand_id = ANY (p_brands)),
    (SELECT COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id), '')
       FROM public.brands t WHERE t.id = ANY (p_brands)),
    (SELECT COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id), '')
       FROM public.brand_team_members t
      WHERE t.brand_id = ANY (p_brands) OR t.user_id = ANY (p_users)),
    (SELECT COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id), '')
       FROM public.creator_accounts t WHERE t.id = ANY (p_users)),
    (SELECT COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id), '')
       FROM public.stripe_connect_accounts t WHERE t.brand_id = ANY (p_brands)),
    (SELECT COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id), '')
       FROM public.brand_paystack_recipients t WHERE t.brand_id = ANY (p_brands)),
    (SELECT COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id), '')
       FROM public.partner_brand_links t
      WHERE t.brand_id = ANY (p_brands) OR t.partner_account_id = ANY (p_users)),
    (SELECT COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id), '')
       FROM public.audit_log t
      WHERE t.user_id = ANY (p_users) OR t.brand_id = ANY (p_brands))
  ));
$fn$;

CREATE FUNCTION pg_temp.i3660_codes(p_result jsonb)
RETURNS text
LANGUAGE sql
AS $fn$
  SELECT COALESCE(string_agg(x->>'code', ',' ORDER BY x->>'code'), '')
  FROM jsonb_array_elements(COALESCE(p_result->'blockers', '[]'::jsonb)) x;
$fn$;

-- One case: run p_setup (fixtures), call the function for p_user, compare.
--   p_expect = 'deleted'            -> the call must return status deleted
--   p_expect = '<code>[,<code>...]' -> the call must return status blocked with
--                                      exactly those codes AND write nothing.
-- The case's subtransaction is always rolled back.
CREATE FUNCTION pg_temp.i3660_case(
  p_name text,
  p_setup text,
  p_user uuid,
  p_expect text,
  p_users uuid[],
  p_brands uuid[]
)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_before text;
  v_after text;
  v_result jsonb;
BEGIN
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    IF p_setup IS NOT NULL THEN
      EXECUTE p_setup;
    END IF;
    PERFORM set_config('session_replication_role', 'origin', true);
    IF current_setting('session_replication_role') <> 'origin' THEN
      RAISE EXCEPTION 'issue_3660 [%]: triggers are not live for the call under test', p_name;
    END IF;

    v_before := pg_temp.i3660_snap(p_users, p_brands);
    v_result := public.biz_delete_host_account(p_user);
    v_after := pg_temp.i3660_snap(p_users, p_brands);

    IF p_expect = 'deleted' THEN
      IF v_result->>'status' IS DISTINCT FROM 'deleted' THEN
        RAISE EXCEPTION 'issue_3660 [%]: expected deleted, got %', p_name, v_result;
      END IF;
      IF v_before = v_after THEN
        RAISE EXCEPTION 'issue_3660 [%]: reported deleted but wrote nothing', p_name;
      END IF;
    ELSE
      IF v_result->>'status' IS DISTINCT FROM 'blocked' THEN
        RAISE EXCEPTION 'issue_3660 [%]: expected blocked (%), got %', p_name, p_expect, v_result;
      END IF;
      IF pg_temp.i3660_codes(v_result) IS DISTINCT FROM p_expect THEN
        RAISE EXCEPTION 'issue_3660 [%]: expected codes (%), got (%)',
          p_name, p_expect, pg_temp.i3660_codes(v_result);
      END IF;
      IF v_before IS DISTINCT FROM v_after THEN
        RAISE EXCEPTION 'issue_3660 [%]: a BLOCKED deletion changed a row', p_name;
      END IF;
    END IF;

    RAISE EXCEPTION 'i3660_case_rollback' USING ERRCODE = 'I3660';
  EXCEPTION WHEN SQLSTATE 'I3660' THEN
    NULL;
  END;
END;
$fn$;

DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_other_owner uuid := gen_random_uuid();
  v_partner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_other_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();        -- upcoming, published, zero-sale
  v_past_event uuid := gen_random_uuid();   -- ended
  v_other_event uuid := gen_random_uuid();  -- upcoming, on the brand v_owner only works on
  v_link uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_users uuid[];
  v_brands uuid[];
  v_before text;
  v_after text;
  v_result jsonb;
  v_raised boolean;
  v_item jsonb;
  -- fixture SQL fragments
  f_order text;
  f_ticket text;
  f_rsvp text;
  f_contrib text;
  f_session text;
  f_reservation text;
  f_stay text;
  f_menu text;
  f_release text;
  f_split text;
  f_paid_out text;
BEGIN
  v_users := ARRAY[v_owner, v_other_owner, v_partner];
  v_brands := ARRAY[v_brand, v_other_brand];

  INSERT INTO auth.users(id) VALUES (v_owner), (v_other_owner), (v_partner);
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_owner, 'i3660-adv-owner@example.test'),
    (v_other_owner, 'i3660-adv-other@example.test'),
    (v_partner, 'i3660-adv-partner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand, v_owner, 'I3660 Adv', 'i3660-adv-' || v_sfx, 'USD'),
    (v_other_brand, v_other_owner, 'I3660 Adv Other', 'i3660-advo-' || v_sfx, 'USD');
  INSERT INTO public.stripe_connect_accounts
    (brand_id, stripe_account_id, country, default_currency)
  VALUES (v_brand, 'acct_i3660adv_' || left(v_sfx, 10), 'US', 'USD');
  -- [TEST-MOD-APPROVED #3660] second rework: an unpaid-out order blocks only
  -- when Mingla holds the money, so the fixture brand is on the hold rail
  -- (cutover 30 days ago; every order below is placed after it). The cases that
  -- are OFF the hold rail are in the rework suite.
  UPDATE public.brands SET payout_hold_cutover_at = now() - interval '30 days'
   WHERE id = v_brand;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, status) VALUES
    (v_event, v_brand, v_owner, 'I3660 Adv Upcoming', 'i3660-adv-e-' || v_sfx, 'scheduled'),
    (v_past_event, v_brand, v_owner, 'I3660 Adv Past', 'i3660-adv-p-' || v_sfx, 'scheduled'),
    (v_other_event, v_other_brand, v_other_owner, 'I3660 Adv Foreign', 'i3660-adv-f-' || v_sfx, 'scheduled');
  INSERT INTO public.event_dates(event_id, start_at, end_at) VALUES
    (v_event, now() + interval '5 days', now() + interval '6 days'),
    (v_past_event, now() - interval '6 days', now() - interval '5 days'),
    (v_other_event, now() + interval '5 days', now() + interval '6 days');
  INSERT INTO public.brand_team_members
    (brand_id, user_id, role, invited_at, accepted_at)
  VALUES
    (v_other_brand, v_owner, 'brand_admin', now(), now()),
    (v_other_brand, v_partner, 'finance_manager', now(), now());
  INSERT INTO public.partner_brand_links
    (id, partner_account_id, brand_id, invited_owner_email, accepted_at)
  VALUES (v_link, v_partner, v_other_brand, 'i3660-adv-other@example.test', now());

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- Fixture fragments. %1$L = event id, %2$L = status-ish value(s). -----------
  -- [TEST-MOD-APPROVED #3660] third rework: every order in this suite is an
  -- ONLINE sale (it carries a provider payment reference). The money rule now
  -- mirrors the payout sweep's fee-snapshot condition, under which a sale with
  -- no provider reference is cash and is never money Mingla holds. Cash sales
  -- are covered in the rework suite.
  f_order := $f$INSERT INTO public.orders
      (id, event_id, buyer_email, buyer_name, total_cents, currency, payment_status, source,
       stripe_payment_intent_id)
    VALUES (gen_random_uuid(), %1$L, 'i3660-buyer@example.test', 'I3660 Buyer',
            %3$s, 'USD', %2$L, 'legacy',
            'pi_i3660_' || left(replace(gen_random_uuid()::text, '-', ''), 16))$f$;
  f_ticket := $f$INSERT INTO public.tickets
      (id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
    VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), %1$L,
            'i3660-qr-' || gen_random_uuid()::text, %2$L, 'auto')$f$;
  f_rsvp := $f$INSERT INTO public.event_rsvps
      (id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
    VALUES (gen_random_uuid(), %1$L, 'I3660 Guest', 'i3660-guest@example.test',
            '+12015550198', %2$L, %3$L)$f$;
  f_contrib := $f$INSERT INTO public.event_rsvp_contributions
      (id, event_id, brand_id, provider, currency, amount_cents, buyer_total_cents,
       pricing_breakdown, status)
    VALUES (gen_random_uuid(), %1$L, %3$L, 'stripe', 'USD', 500, 500, '{}'::jsonb, %2$L)$f$;
  f_session := $f$INSERT INTO public.ticket_checkout_sessions
      (id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164, currency,
       subtotal_cents, total_cents, status, idempotency_key, expires_at,
       application_fee_amount_cents)
    VALUES (gen_random_uuid(), %1$L, %3$L, 'I3660 Buyer', 'i3660-buyer@example.test',
            '+12015550199', 'USD', 1000, 1000, %2$L,
            'i3660-' || gen_random_uuid()::text, now() + (%4$L)::interval, 100)$f$;
  f_reservation := $f$INSERT INTO public.reservations
      (id, brand_id, venue_id, reserved_for, party_size, status)
    VALUES (gen_random_uuid(), %1$L, gen_random_uuid(), now() + (%3$L)::interval, 2, %2$L)$f$;
  f_stay := $f$INSERT INTO public.stay_reservation_groups
      (id, public_reference, quote_id, actor_key_hash, venue_id, brand_id,
       currency_code, mode, state, guest_snapshot, source_subtotal_minor,
       fee_total_minor, tax_total_minor, total_minor, idempotency_key, request_hash)
    VALUES (gen_random_uuid(),
            'ST-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 20)),
            gen_random_uuid(), repeat('a', 64), gen_random_uuid(), %1$L,
            'USD', 'instant', %2$L, '{"name":"I3660 Guest"}'::jsonb, 10000, 0, 0, 10000,
            'i3660-' || gen_random_uuid()::text, repeat('9', 64))$f$;
  f_menu := $f$INSERT INTO public.venue_orders
      (id, session_id, brand_id, venue_id, qr_spot_id, source, money_path, currency,
       subtotal_cents, effective_take_rate_bps, service_fee_bps,
       pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, total_cents,
       idempotency_key, payment_status, fulfillment_status, acknowledged_at,
       acknowledged_by_user_id, created_at)
    VALUES (gen_random_uuid(), gen_random_uuid(), %1$L, gen_random_uuid(),
            gen_random_uuid(), 'guest_qr', 'venue_collected', 'USD',
            1000, 0, 0, false, false, false, 1000, 1000,
            'i3660-' || gen_random_uuid()::text, %2$L, %3$L, now(),
            gen_random_uuid(), now() - (%4$L)::interval)$f$;
  f_release := $f$INSERT INTO public.brand_payout_releases
      (id, brand_id, occurrence_key, surface, provider, currency, anchor_end_at,
       releasable_at, gross_cents, net_release_cents, status)
    VALUES (%3$L, %1$L, 'i3660-' || gen_random_uuid()::text, 'order', 'stripe', 'usd',
            date_trunc('second', now()), date_trunc('second', now()) + interval '1 day',
            1000, 1000, %2$L)$f$;
  f_split := $f$INSERT INTO public.partner_splits
      (id, order_id, brand_id, partner_account_id, mingla_fee_cents, partner_share_cents,
       transfer_currency, stripe_application_fee_id, status)
    VALUES (gen_random_uuid(), gen_random_uuid(), %1$L, %3$L, 100, 50, 'USD',
            'fee_i3660_' || gen_random_uuid()::text, %2$L)$f$;

  -- %1$L = brand id, %2$L = event id: a RELEASED payout covering every order
  -- on that event.
  f_paid_out := $f$WITH r AS (
      INSERT INTO public.brand_payout_releases
        (id, brand_id, occurrence_key, surface, provider, currency, anchor_end_at,
         releasable_at, gross_cents, net_release_cents, status)
      VALUES (gen_random_uuid(), %1$L, 'i3660-' || gen_random_uuid()::text, 'order',
              'stripe', 'usd', date_trunc('second', now()) - interval '2 days',
              date_trunc('second', now()) - interval '1 day', 1000, 1000, 'released')
      RETURNING id)
    INSERT INTO public.payout_release_items
      (id, release_id, source_type, source_id, gross_cents, refunded_cents,
       disputed_cents, mingla_fee_cents, partner_share_cents, provider_fee_cents,
       net_cents, source_finalized_at)
    SELECT gen_random_uuid(), r.id, 'order', o.id, o.total_cents, 0, 0, 0, 0, 0,
           o.total_cents, now()
    FROM r, public.orders o WHERE o.event_id = %2$L$f$;

  -- ==========================================================================
  -- Baseline: with no sales the same owner IS deleted. Without this, every
  -- "blocked" below could be a function that blocks everything.
  -- ==========================================================================
  PERFORM pg_temp.i3660_case('baseline zero-sale owner', NULL, v_owner, 'deleted', v_users, v_brands);

  -- ==========================================================================
  -- SC-3 / SC-4 — tickets_sold, each arm alone.
  -- ==========================================================================
  PERFORM pg_temp.i3660_case('paid order', format(f_order, v_event, 'paid', 1000), v_owner, 'tickets_sold', v_users, v_brands);
  PERFORM pg_temp.i3660_case('free order (paid, 0 cents)', format(f_order, v_event, 'paid', 0), v_owner, 'tickets_sold', v_users, v_brands);
  PERFORM pg_temp.i3660_case('partly refunded order', format(f_order, v_event, 'partial_refund', 1000), v_owner, 'tickets_sold', v_users, v_brands);
  PERFORM pg_temp.i3660_case('pending order', format(f_order, v_event, 'pending', 1000), v_owner, 'tickets_sold', v_users, v_brands);
  PERFORM pg_temp.i3660_case('valid ticket', format(f_ticket, v_event, 'valid'), v_owner, 'tickets_sold', v_users, v_brands);
  PERFORM pg_temp.i3660_case('used ticket', format(f_ticket, v_event, 'used'), v_owner, 'tickets_sold', v_users, v_brands);
  PERFORM pg_temp.i3660_case('transferred ticket', format(f_ticket, v_event, 'transferred'), v_owner, 'tickets_sold', v_users, v_brands);
  PERFORM pg_temp.i3660_case('going approved RSVP', format(f_rsvp, v_event, 'going', 'approved'), v_owner, 'tickets_sold', v_users, v_brands);
  PERFORM pg_temp.i3660_case('going pending RSVP', format(f_rsvp, v_event, 'going', 'pending'), v_owner, 'tickets_sold', v_users, v_brands);
  PERFORM pg_temp.i3660_case('waitlisted RSVP', format(f_rsvp, v_event, 'waitlisted', 'approved'), v_owner, 'tickets_sold', v_users, v_brands);
  PERFORM pg_temp.i3660_case('paid RSVP contribution', format(f_contrib, v_event, 'paid', v_brand), v_owner, 'tickets_sold', v_users, v_brands);
  PERFORM pg_temp.i3660_case('partly refunded RSVP contribution', format(f_contrib, v_event, 'partially_refunded', v_brand), v_owner, 'tickets_sold', v_users, v_brands);

  -- A refund still pending on an upcoming event is both a held ticket and
  -- money in motion: both codes come back, not only the first.
  PERFORM pg_temp.i3660_case('refund_pending ticket, upcoming event', format(f_ticket, v_event, 'refund_pending'), v_owner, 'money_in_motion,tickets_sold', v_users, v_brands);

  -- ...and the things that do NOT count as a sale.
  PERFORM pg_temp.i3660_case('refunded order', format(f_order, v_event, 'refunded', 1000), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('cancelled order', format(f_order, v_event, 'cancelled', 1000), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('failed order', format(f_order, v_event, 'failed', 1000), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('void ticket', format(f_ticket, v_event, 'void'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('refunded ticket', format(f_ticket, v_event, 'refunded'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('maybe RSVP', format(f_rsvp, v_event, 'maybe', 'approved'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('not_going RSVP', format(f_rsvp, v_event, 'not_going', 'approved'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('denied RSVP', format(f_rsvp, v_event, 'going', 'denied'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('refunded RSVP contribution', format(f_contrib, v_event, 'refunded', v_brand), v_owner, 'deleted', v_users, v_brands);
  -- [TEST-MOD-APPROVED #3660] rework F-1: a paid order on a past event now
  -- blocks until it has been paid out, so this "does not count" case is the
  -- PAID-OUT one (a released payout item covers the order). The unpaid case is
  -- asserted the other way round straight below and in the rework suite.
  PERFORM pg_temp.i3660_case('paid order on a PAST event, paid out',
    format(f_order, v_past_event, 'paid', 1000) || ';' || format(f_paid_out, v_brand, v_past_event),
    v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('paid order on a PAST event, NOT yet paid out',
    format(f_order, v_past_event, 'paid', 1000), v_owner, 'money_in_motion', v_users, v_brands);
  PERFORM pg_temp.i3660_case('free order on a PAST event',
    format(f_order, v_past_event, 'paid', 0), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('refunded order on a PAST event',
    format(f_order, v_past_event, 'refunded', 1000), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('valid ticket on a PAST event', format(f_ticket, v_past_event, 'valid'), v_owner, 'deleted', v_users, v_brands);
  -- A brand the user is only a team member of is never considered.
  PERFORM pg_temp.i3660_case('paid order on a brand the user does not own', format(f_order, v_other_event, 'paid', 1000), v_owner, 'deleted', v_users, v_brands);

  -- ==========================================================================
  -- SC-4 — checkout_in_progress.
  -- ==========================================================================
  PERFORM pg_temp.i3660_case('checkout requires_payment', format(f_session, v_event, 'requires_payment', v_brand, '15 minutes'), v_owner, 'checkout_in_progress', v_users, v_brands);
  PERFORM pg_temp.i3660_case('checkout pending_free', format(f_session, v_event, 'pending_free', v_brand, '15 minutes'), v_owner, 'checkout_in_progress', v_users, v_brands);
  PERFORM pg_temp.i3660_case('checkout awaiting_web_redirect', format(f_session, v_event, 'awaiting_web_redirect', v_brand, '15 minutes'), v_owner, 'checkout_in_progress', v_users, v_brands);
  PERFORM pg_temp.i3660_case('checkout processing_payment', format(f_session, v_event, 'processing_payment', v_brand, '15 minutes'), v_owner, 'checkout_in_progress', v_users, v_brands);
  PERFORM pg_temp.i3660_case('checkout past its expiry', format(f_session, v_event, 'requires_payment', v_brand, '-15 minutes'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('checkout failed', format(f_session, v_event, 'failed', v_brand, '15 minutes'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('checkout expired status', format(f_session, v_event, 'expired', v_brand, '15 minutes'), v_owner, 'deleted', v_users, v_brands);

  -- ==========================================================================
  -- SC-4 — upcoming_reservations.
  -- ==========================================================================
  PERFORM pg_temp.i3660_case('reservation confirmed, upcoming', format(f_reservation, v_brand, 'confirmed', '2 days'), v_owner, 'upcoming_reservations', v_users, v_brands);
  PERFORM pg_temp.i3660_case('reservation requested, upcoming', format(f_reservation, v_brand, 'requested', '2 days'), v_owner, 'upcoming_reservations', v_users, v_brands);
  PERFORM pg_temp.i3660_case('reservation waitlisted, upcoming', format(f_reservation, v_brand, 'waitlisted', '2 days'), v_owner, 'upcoming_reservations', v_users, v_brands);
  PERFORM pg_temp.i3660_case('reservation confirmed, PAST', format(f_reservation, v_brand, 'confirmed', '-2 days'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('reservation cancelled, upcoming', format(f_reservation, v_brand, 'cancelled_by_guest', '2 days'), v_owner, 'deleted', v_users, v_brands);

  -- ==========================================================================
  -- SC-4 — upcoming_stays.
  -- ==========================================================================
  PERFORM pg_temp.i3660_case('stay confirmed', format(f_stay, v_brand, 'confirmed'), v_owner, 'upcoming_stays', v_users, v_brands);
  PERFORM pg_temp.i3660_case('stay cancelled', format(f_stay, v_brand, 'cancelled'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('stay declined', format(f_stay, v_brand, 'declined'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('stay request_expired', format(f_stay, v_brand, 'request_expired'), v_owner, 'deleted', v_users, v_brands);

  -- ==========================================================================
  -- SC-4 — open_menu_orders.
  -- ==========================================================================
  PERFORM pg_temp.i3660_case('menu order paid + in_progress', format(f_menu, v_brand, 'paid', 'in_progress', '1 hour'), v_owner, 'open_menu_orders', v_users, v_brands);
  PERFORM pg_temp.i3660_case('menu order pending + placed', format(f_menu, v_brand, 'pending', 'placed', '1 hour'), v_owner, 'open_menu_orders', v_users, v_brands);
  PERFORM pg_temp.i3660_case('menu order delivered', format(f_menu, v_brand, 'paid', 'delivered', '1 hour'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('menu order older than 24h', format(f_menu, v_brand, 'paid', 'in_progress', '25 hours'), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('menu order failed payment', format(f_menu, v_brand, 'failed', 'placed', '1 hour'), v_owner, 'deleted', v_users, v_brands);

  -- ==========================================================================
  -- SC-4 — money_in_motion.
  -- ==========================================================================
  PERFORM pg_temp.i3660_case('payout release pending', format(f_release, v_brand, 'pending', gen_random_uuid()), v_owner, 'money_in_motion', v_users, v_brands);
  PERFORM pg_temp.i3660_case('payout release in_flight', format(f_release, v_brand, 'in_flight', gen_random_uuid()), v_owner, 'money_in_motion', v_users, v_brands);
  PERFORM pg_temp.i3660_case('payout release failed', format(f_release, v_brand, 'failed', gen_random_uuid()), v_owner, 'money_in_motion', v_users, v_brands);
  PERFORM pg_temp.i3660_case('payout release released', format(f_release, v_brand, 'released', gen_random_uuid()), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('payout release cancelled_event', format(f_release, v_brand, 'cancelled_event', gen_random_uuid()), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('payout release reanchored', format(f_release, v_brand, 'reanchored', gen_random_uuid()), v_owner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('open payout debt',
    format($f$INSERT INTO public.organiser_payout_debts
        (id, brand_id, currency, origin_release_id, kind, principal_cents, idempotency_key, status)
      VALUES (gen_random_uuid(), %1$L, 'usd', gen_random_uuid(), 'post_release_refund', 500,
              'i3660-' || gen_random_uuid()::text, 'open')$f$, v_brand),
    v_owner, 'money_in_motion', v_users, v_brands);
  PERFORM pg_temp.i3660_case('closed payout debt',
    format($f$INSERT INTO public.organiser_payout_debts
        (id, brand_id, currency, origin_release_id, kind, principal_cents, idempotency_key,
         status, closed_at, recovered_cents)
      VALUES (gen_random_uuid(), %1$L, 'usd', gen_random_uuid(), 'post_release_refund', 500,
              'i3660-' || gen_random_uuid()::text, 'closed', now(), 500)$f$, v_brand),
    v_owner, 'deleted', v_users, v_brands);
  -- A refund still pending on a PAST event: not a sale on an upcoming event,
  -- but still money in motion.
  PERFORM pg_temp.i3660_case('refund_pending ticket, past event', format(f_ticket, v_past_event, 'refund_pending'), v_owner, 'money_in_motion', v_users, v_brands);

  -- ==========================================================================
  -- Several blockers at once: all of them come back.
  -- ==========================================================================
  PERFORM pg_temp.i3660_case('order + reservation + release',
    format(f_order, v_event, 'paid', 1000) || ';' ||
    format(f_reservation, v_brand, 'confirmed', '2 days') || ';' ||
    format(f_release, v_brand, 'pending', gen_random_uuid()),
    v_owner, 'money_in_motion,tickets_sold,upcoming_reservations', v_users, v_brands);

  -- ==========================================================================
  -- Partner amendment. The link itself never blocks; an unsettled split does.
  -- ==========================================================================
  PERFORM pg_temp.i3660_case('partner, link, no split', NULL, v_partner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('partner, held split', format(f_split, v_other_brand, 'held', v_partner), v_partner, 'partner_payment_in_progress', v_users, v_brands);
  PERFORM pg_temp.i3660_case('partner, pending split', format(f_split, v_other_brand, 'pending', v_partner), v_partner, 'partner_payment_in_progress', v_users, v_brands);
  PERFORM pg_temp.i3660_case('partner, failed split', format(f_split, v_other_brand, 'failed', v_partner), v_partner, 'partner_payment_in_progress', v_users, v_brands);
  PERFORM pg_temp.i3660_case('partner, reversed_pending split', format(f_split, v_other_brand, 'reversed_pending', v_partner), v_partner, 'partner_payment_in_progress', v_users, v_brands);
  PERFORM pg_temp.i3660_case('partner, blocked_no_stripe split', format(f_split, v_other_brand, 'blocked_no_stripe', v_partner), v_partner, 'partner_payment_in_progress', v_users, v_brands);
  PERFORM pg_temp.i3660_case('partner, transferred split', format(f_split, v_other_brand, 'transferred', v_partner), v_partner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('partner, reversed split', format(f_split, v_other_brand, 'reversed', v_partner), v_partner, 'deleted', v_users, v_brands);
  PERFORM pg_temp.i3660_case('partner, cancelled_refund split', format(f_split, v_other_brand, 'cancelled_refund', v_partner), v_partner, 'deleted', v_users, v_brands);
  -- Somebody else's unsettled split does not block this user.
  PERFORM pg_temp.i3660_case('another partner''s held split', format(f_split, v_other_brand, 'held', v_other_owner), v_partner, 'deleted', v_users, v_brands);

  -- The partner's row cannot be removed while the link is live (the guard the
  -- deletion must satisfy, not bypass) ...
  v_raised := false;
  BEGIN
    UPDATE public.brand_team_members SET removed_at = now()
     WHERE brand_id = v_other_brand AND user_id = v_partner AND removed_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%active_partner_use_disconnect%' THEN
      RAISE EXCEPTION 'issue_3660: wrong error removing a live partner row: %', SQLERRM;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_3660: a live partner membership was removed without ending the link';
  END IF;
  -- ... and the deletion never arms the owner-transfer switch to get past it.
  IF current_setting('app.allow_brand_owner_transfer', true) = 'on' THEN
    RAISE EXCEPTION 'issue_3660: app.allow_brand_owner_transfer is armed';
  END IF;

  -- ==========================================================================
  -- Blocker payload shape: items only for the event codes, capped at 5.
  -- ==========================================================================
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    EXECUTE format(f_order, v_event, 'paid', 1000);
    EXECUTE format(f_reservation, v_brand, 'confirmed', '2 days');
    PERFORM set_config('session_replication_role', 'origin', true);
    v_result := public.biz_delete_host_account(v_owner);
    SELECT x INTO v_item FROM jsonb_array_elements(v_result->'blockers') x
     WHERE x->>'code' = 'tickets_sold';
    IF (v_item->>'count')::integer <> 1
       OR jsonb_array_length(v_item->'items') <> 1
       OR v_item->'items'->0->>'id' IS DISTINCT FROM v_event::text
       OR v_item->'items'->0->>'title' IS DISTINCT FROM 'I3660 Adv Upcoming' THEN
      RAISE EXCEPTION 'issue_3660: tickets_sold blocker shape wrong: %', v_item;
    END IF;
    SELECT x INTO v_item FROM jsonb_array_elements(v_result->'blockers') x
     WHERE x->>'code' = 'upcoming_reservations';
    IF (v_item->>'count')::integer <> 1 OR v_item ? 'items' THEN
      RAISE EXCEPTION 'issue_3660: upcoming_reservations blocker shape wrong: %', v_item;
    END IF;
    RAISE EXCEPTION 'i3660_case_rollback' USING ERRCODE = 'I3660';
  EXCEPTION WHEN SQLSTATE 'I3660' THEN
    NULL;
  END;

  -- ==========================================================================
  -- SC-5 — a failure on a write step raises, and nothing is left behind.
  -- Catching the error rolls this block back exactly as the request's own
  -- transaction would be, so the load-bearing assertions are (a) the call
  -- RAISED instead of returning a status, and (b) the rows are as they were.
  -- A function that swallowed the error and returned would fail (a); one that
  -- swallowed it around the failing step only would fail (b).
  -- ==========================================================================
  CREATE FUNCTION pg_temp.i3660_boom() RETURNS trigger LANGUAGE plpgsql AS $t$
  BEGIN
    RAISE EXCEPTION 'i3660_forced_failure';
  END $t$;

  -- (i) the account stamp, after events / Stripe / brands / teams were written.
  CREATE TRIGGER i3660_boom_account
    BEFORE UPDATE OF deleted_at ON public.creator_accounts
    FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL)
    EXECUTE FUNCTION pg_temp.i3660_boom();
  v_before := pg_temp.i3660_snap(v_users, v_brands);
  v_raised := false;
  v_result := NULL;
  BEGIN
    v_result := public.biz_delete_host_account(v_owner);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%i3660_forced_failure%' THEN
      RAISE EXCEPTION 'issue_3660 SC-5(i): unexpected error: %', SQLERRM;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_3660 SC-5(i): a failed write was swallowed; returned %', v_result;
  END IF;
  v_after := pg_temp.i3660_snap(v_users, v_brands);
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'issue_3660 SC-5(i): rows changed although the deletion failed';
  END IF;
  DROP TRIGGER i3660_boom_account ON public.creator_accounts;

  -- (ii) the audit row, the very last write.
  CREATE TRIGGER i3660_boom_audit
    BEFORE INSERT ON public.audit_log
    FOR EACH ROW WHEN (NEW.action = 'host_account.deleted')
    EXECUTE FUNCTION pg_temp.i3660_boom();
  v_raised := false;
  v_result := NULL;
  BEGIN
    v_result := public.biz_delete_host_account(v_owner);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%i3660_forced_failure%' THEN
      RAISE EXCEPTION 'issue_3660 SC-5(ii): unexpected error: %', SQLERRM;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_3660 SC-5(ii): a failed audit write was swallowed; returned %', v_result;
  END IF;
  v_after := pg_temp.i3660_snap(v_users, v_brands);
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'issue_3660 SC-5(ii): rows changed although the audit write failed';
  END IF;
  DROP TRIGGER i3660_boom_audit ON public.audit_log;

  -- ==========================================================================
  -- SC-11 — the two pre-existing guards still refuse everybody else.
  -- ==========================================================================
  v_raised := false;
  BEGIN
    UPDATE public.brands SET deleted_at = now() WHERE id = v_brand;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'brand_delete_blocked_by_events:%' THEN
      RAISE EXCEPTION 'issue_3660 SC-11: wrong brand-delete error: %', SQLERRM;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_3660 SC-11: a plain brand soft-delete with an upcoming event was allowed';
  END IF;

  v_raised := false;
  BEGIN
    UPDATE public.brand_team_members SET removed_at = now()
     WHERE brand_id = v_brand AND user_id = v_owner AND removed_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%cannot_remove_brand_account%' THEN
      RAISE EXCEPTION 'issue_3660 SC-11: wrong owner-row error: %', SQLERRM;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_3660 SC-11: the brand account''s own team row was soft-removed';
  END IF;

  -- The preview RPC is the caller's own account only, and refuses no caller.
  IF has_function_privilege('anon', 'public.biz_my_host_account_deletion_blockers()', 'EXECUTE')
     OR has_function_privilege('service_role', 'private.host_account_deletion_blockers(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.host_account_deletion_blockers(uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3660: a preflight function is executable by a role that must not hold it';
  END IF;
  v_raised := false;
  BEGIN
    PERFORM public.biz_my_host_account_deletion_blockers();
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_3660: the preview RPC answered a caller with no auth.uid()';
  END IF;

  RAISE NOTICE 'issue_3660 host account deletion tester adversarial PASS';
END $$;
ROLLBACK;

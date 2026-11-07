\set ON_ERROR_STOP on

-- Issue #3645 bundle 2b (with #3281) — what can be sold.
-- Migration 20280428003645_issue_3645_sell_publish_integrity.sql.
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.
--
-- MINGLA-INVARIANT: I-3645-PAID-TICKET-HAS-A-PRICE | issue #3645 | business_publish_event_draft and issue_1974_normalize_ticket_tiers refuse a paid ticket whose price is missing or rounds to 0 (paid_ticket_price_required); a live paid whole-price experience cannot be edited to 0 (experience_price_invalid).
-- MINGLA-INVARIANT: I-3645-EXPERIENCE-PUBLISH-ONE-UPDATE | issue #3645 | biz_publish_experience publishes an experience in the same UPDATE that writes its currency, and its tickets carry the currency the row ends up with.
-- MINGLA-INVARIANT: I-3281-CANCELLED-DATE-NOT-SOLD | issue #3281 | cancelling a date revokes open checkouts on the event; a cancelled date is never authorised, checked out, counted as upcoming or auto-picked.
--
-- Red before green: on main's bodies, T1, T2, T3, T4, T6, T7, T8, T9 and T10 fail.

BEGIN;

INSERT INTO auth.users(id) VALUES ('36452b00-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('36452b00-0000-4000-8000-000000000001');

CREATE FUNCTION pg_temp.as_host() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '36452b00-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', '36452b00-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
END $$;

-- A brand that can take money, Organiser Terms accepted.
CREATE FUNCTION pg_temp.brand(p_id uuid, p_currency text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider,
    payment_country, paystack_subaccount_code)
  VALUES (p_id, '36452b00-0000-4000-8000-000000000001', 'B ' || p_id, 'b2b-' || p_id,
    p_currency, 'paystack', 'NG', 'ACCT_b2b_' || right(p_id::text, 4));
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = p_id AND user_id = '36452b00-0000-4000-8000-000000000001';
END $$;

-- What the event wizard sends: one ticket. p_free true = a free ticket.
CREATE FUNCTION pg_temp.event_payload(p_free boolean, p_price numeric) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('title', 'B2b event', 'timezone', 'UTC',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'tickets', jsonb_build_array(jsonb_build_object('id', 't1', 'name', 'General',
        'isFree', p_free, 'priceGbp', p_price, 'capacity', 10, 'availableAt', 'online')),
      'city', 'Lagos', 'partyTypes', jsonb_build_array('club-night'),
      'requestedVisibility', 'public', 'whenMode', 'single',
      'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00'))))
$$;

CREATE FUNCTION pg_temp.draft_event(p_id uuid, p_brand uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (p_id, p_brand, '36452b00-0000-4000-8000-000000000001', 'B2b event',
    'b2b-ev-' || p_id, 'event', 'draft', 'draft', 'UTC')
$$;

-- Publish the event; NULL when it published, else the refusal.
CREATE FUNCTION pg_temp.publish_event(p_event uuid, p_payload jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_host();
  PERFORM public.business_publish_event_draft(p_event, p_payload);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM || ' [' || SQLSTATE || ']';
END $$;

CREATE FUNCTION pg_temp.exp_payload(p_price_cents integer, p_currency text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'title', 'B2b experience', 'description', 'A walk through two good places.',
    'currency', p_currency, 'is_free', p_price_cents = 0, 'pricing_mode', 'whole',
    'whole_price_cents', p_price_cents, 'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'UTC', 'whenMode', 'single',
    'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
      'doorsOpen', '18:00', 'endsAt', '20:00'),
    'stops', jsonb_build_array(
      jsonb_build_object('place_name', 'First', 'ai_description', 'The first stop',
        'address', '1 First St', 'place_id', 'b2b-place-1', 'lat', 6.5, 'lng', 3.4, 'stop_order', 0),
      jsonb_build_object('place_name', 'Second', 'ai_description', 'The second stop',
        'address', '2 Second St', 'place_id', 'b2b-place-2', 'lat', 6.6, 'lng', 3.5, 'stop_order', 1))))
$$;

-- ─── T1  a paid ticket with no price does not go live ───────────────────────
DO $t1$
DECLARE
  v_brand uuid := '36452b00-0000-4000-8000-0000000000b1';
  v_res text;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'NGN');

  PERFORM pg_temp.draft_event('36452b00-0000-4000-8000-0000000000e1', v_brand);
  v_res := pg_temp.publish_event('36452b00-0000-4000-8000-0000000000e1', pg_temp.event_payload(false, NULL));
  IF v_res IS NULL OR v_res NOT LIKE 'paid_ticket_price_required%[22023]' THEN
    RAISE EXCEPTION 'T1 FAIL: unpriced paid ticket: %', coalesce(v_res, 'published');
  END IF;
  IF (SELECT status FROM public.events WHERE id = '36452b00-0000-4000-8000-0000000000e1') <> 'draft'
     OR EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = '36452b00-0000-4000-8000-0000000000e1') THEN
    RAISE EXCEPTION 'T1 FAIL: a refused publish left the event or its tickets behind';
  END IF;

  -- 0.004 rounds to 0 minor units.
  v_res := pg_temp.publish_event('36452b00-0000-4000-8000-0000000000e1', pg_temp.event_payload(false, 0.004));
  IF v_res IS NULL OR v_res NOT LIKE 'paid_ticket_price_required%' THEN
    RAISE EXCEPTION 'T1 FAIL: sub-unit price: %', coalesce(v_res, 'published');
  END IF;
  v_res := pg_temp.publish_event('36452b00-0000-4000-8000-0000000000e1', pg_temp.event_payload(false, 0));
  IF v_res IS NULL OR v_res NOT LIKE 'paid_ticket_price_required%' THEN
    RAISE EXCEPTION 'T1 FAIL: price 0 not free: %', coalesce(v_res, 'published');
  END IF;

  -- 0.0049 rounds to 0 too; priceMajor wins over priceGbp, so priceMajor 0 is no price.
  v_res := pg_temp.publish_event('36452b00-0000-4000-8000-0000000000e1', pg_temp.event_payload(false, 0.0049));
  IF v_res IS NULL OR v_res NOT LIKE 'paid_ticket_price_required%' THEN
    RAISE EXCEPTION 'T1 FAIL: 0.0049: %', coalesce(v_res, 'published');
  END IF;
  v_res := pg_temp.publish_event('36452b00-0000-4000-8000-0000000000e1',
    jsonb_set(pg_temp.event_payload(false, 25), '{theme,business_draft,tickets,0,priceMajor}', '0'));
  IF v_res IS NULL OR v_res NOT LIKE 'paid_ticket_price_required%' THEN
    RAISE EXCEPTION 'T1 FAIL: priceMajor 0 over priceGbp 25: %', coalesce(v_res, 'published');
  END IF;

  -- Unchanged: a free ticket and a priced paid ticket publish.
  v_res := pg_temp.publish_event('36452b00-0000-4000-8000-0000000000e1', pg_temp.event_payload(true, NULL));
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'T1 FAIL: free ticket refused: %', v_res; END IF;
  PERFORM pg_temp.draft_event('36452b00-0000-4000-8000-0000000000e2', v_brand);
  v_res := pg_temp.publish_event('36452b00-0000-4000-8000-0000000000e2', pg_temp.event_payload(false, 2500));
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'T1 FAIL: priced paid ticket refused: %', v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = '36452b00-0000-4000-8000-0000000000e2'
                  AND price_cents = 250000 AND NOT is_free AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'T1 FAIL: priced ticket not stored at 250000';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2B T1 PASS: an unpriced or sub-unit paid ticket cannot publish; free and priced tickets still do';
END $t1$;

-- ─── T2  the tier editor refuses a price that rounds to 0 ───────────────────
DO $t2$
DECLARE
  v_tier jsonb := jsonb_build_object('id', 'tier-a', 'name', 'General', 'isFree', false,
    'capacity', 10, 'visibility', 'public', 'availableAt', 'online');
  v_err text;
BEGIN
  PERFORM public.issue_1974_normalize_ticket_tiers(jsonb_build_array(v_tier || '{"priceGbp": 25}'));
  BEGIN
    PERFORM public.issue_1974_normalize_ticket_tiers(jsonb_build_array(v_tier || '{"priceGbp": 0.004}'));
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'paid_ticket_price_required' THEN
    RAISE EXCEPTION 'T2 FAIL: a 0.004 price normalised (%)', coalesce(v_err, 'accepted');
  END IF;
  RAISE NOTICE 'ISSUE-3645-2B T2 PASS: a sub-unit paid tier price is refused';
END $t2$;

-- ─── T3  a live paid experience cannot be edited to 0 ───────────────────────
DO $t3$
DECLARE
  v_brand uuid := '36452b00-0000-4000-8000-0000000000b3';
  v_event uuid;
  v_err text;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'NGN');
  PERFORM pg_temp.as_host();
  v_event := (public.biz_create_experience(v_brand, pg_temp.exp_payload(25000, 'NGN'), true)->'event'->>'id')::uuid;

  BEGIN
    PERFORM public.biz_update_live_experience(v_event,
      pg_temp.exp_payload(25000, 'NGN') || '{"whole_price_cents": 0, "is_free": false}', 'Correcting the ticket price for guests');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'experience_price_invalid' THEN
    RAISE EXCEPTION 'T3 FAIL: paid edited to 0 (%)', coalesce(v_err, 'accepted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL
                  AND price_cents = 25000 AND NOT is_free) THEN
    RAISE EXCEPTION 'T3 FAIL: the refused edit changed the ticket';
  END IF;

  -- An edit that leaves out the price is refused too, and changes nothing.
  v_err := NULL;
  BEGIN
    PERFORM public.biz_update_live_experience(v_event,
      pg_temp.exp_payload(25000, 'NGN') - 'whole_price_cents', 'Correcting the ticket price for guests');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'experience_price_invalid'
     OR NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL
                     AND price_cents = 25000 AND NOT is_free) THEN
    RAISE EXCEPTION 'T3 FAIL: an edit without a price (%)', coalesce(v_err, 'accepted');
  END IF;

  -- Marking it free is still allowed.
  PERFORM public.biz_update_live_experience(v_event, pg_temp.exp_payload(0, 'NGN'), 'Making this experience free for everyone');
  IF NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL AND is_free) THEN
    RAISE EXCEPTION 'T3 FAIL: marking it free did not make the ticket free';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2B T3 PASS: a live paid experience edited to 0 is refused; marking it free works';
END $t3$;

-- ─── T4/T5  experience publish writes currency and status together ──────────
CREATE TEMP TABLE b2b_status_moves(event_id uuid, old_currency text, new_currency text);
-- The trigger fires inside SECURITY DEFINER publish functions (another role).
GRANT ALL ON b2b_status_moves TO PUBLIC;
CREATE FUNCTION pg_temp.b2b_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status <> 'draft' THEN
    INSERT INTO b2b_status_moves VALUES (NEW.id, OLD.currency, NEW.currency);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER zz_b2b_capture AFTER UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION pg_temp.b2b_capture();

DO $t4$
DECLARE
  v_brand uuid := '36452b00-0000-4000-8000-0000000000b4';
  v_event uuid;
  v_move record;
  v_reach bigint;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'NGN');
  PERFORM pg_temp.as_host();
  -- A draft saved in GBP; the publish sends the brand's NGN, as the wizard does.
  v_event := (public.biz_create_experience(v_brand, pg_temp.exp_payload(25000, 'GBP'), false)->'event'->>'id')::uuid;
  IF (SELECT currency FROM public.events WHERE id = v_event) IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'T4 fixture FAIL: draft currency is not GBP';
  END IF;
  PERFORM public.biz_publish_experience(v_event, pg_temp.exp_payload(25000, 'NGN'), true);

  IF (SELECT count(*) FROM b2b_status_moves WHERE event_id = v_event) <> 1 THEN
    RAISE EXCEPTION 'T4 FAIL: % updates moved the experience out of draft',
      (SELECT count(*) FROM b2b_status_moves WHERE event_id = v_event);
  END IF;
  SELECT * INTO v_move FROM b2b_status_moves WHERE event_id = v_event;
  IF v_move.old_currency IS DISTINCT FROM 'GBP' OR v_move.new_currency IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'T4 FAIL: the status move saw currency % -> %, expected GBP -> NGN',
      v_move.old_currency, v_move.new_currency;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL
              AND currency IS DISTINCT FROM 'NGN') THEN
    RAISE EXCEPTION 'T4 FAIL: a ticket is not in the published currency';
  END IF;
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'scheduled'
     OR (SELECT visibility FROM public.events WHERE id = v_event) <> 'public'
     OR (SELECT published_at FROM public.events WHERE id = v_event) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.event_dates WHERE event_id = v_event AND is_master) THEN
    RAISE EXCEPTION 'T4 FAIL: not published with a master date';
  END IF;

  IF (SELECT theme #>> '{experience_meta,next_occurrence_at}' FROM public.events WHERE id = v_event) IS NULL
     OR (SELECT count(*) FROM public.event_dates WHERE event_id = v_event AND is_master) <> 1 THEN
    RAISE EXCEPTION 'T4 FAIL: next occurrence or master date missing after publish';
  END IF;

  -- Published again: published_at is kept, tickets stay in the stored currency.
  UPDATE public.events SET published_at = now() - interval '3 days' WHERE id = v_event;
  PERFORM public.biz_publish_experience(v_event, pg_temp.exp_payload(25000, 'NGN'), true);
  IF (SELECT published_at FROM public.events WHERE id = v_event) > now() - interval '2 days'
     OR (SELECT count(*) FROM public.event_dates WHERE event_id = v_event AND is_master) <> 1 THEN
    RAISE EXCEPTION 'T4 FAIL: a second publish moved published_at or duplicated the master date';
  END IF;

  -- Re-publishing a live experience with another currency: the row is no
  -- longer a draft, so the brand-currency trigger does not stamp it, and the
  -- event and its tickets take the sent currency together — as on main.
  -- Pinned so step 8b keeps writing currency with status (#3645 records
  -- whether a live experience should be allowed to change currency at all).
  PERFORM public.biz_publish_experience(v_event, pg_temp.exp_payload(25000, 'USD'), true);
  IF (SELECT currency FROM public.events WHERE id = v_event) IS DISTINCT FROM 'USD'
     OR EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL
                 AND currency IS DISTINCT FROM 'USD') THEN
    RAISE EXCEPTION 'T4 FAIL: a re-publish left the event and its tickets in different currencies';
  END IF;

  -- The publish sends a currency the brand does not sell in: the row is
  -- stamped with the brand's currency, and so are its tickets.
  v_event := (public.biz_create_experience(v_brand, pg_temp.exp_payload(25000, 'NGN'), false)->'event'->>'id')::uuid;
  PERFORM public.biz_publish_experience(v_event, pg_temp.exp_payload(25000, 'USD'), true);
  IF (SELECT currency FROM public.events WHERE id = v_event) IS DISTINCT FROM 'NGN'
     OR EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL
                 AND currency IS DISTINCT FROM 'NGN') THEN
    RAISE EXCEPTION 'T4 FAIL: tickets kept the sent currency: event %, tickets %',
      (SELECT currency FROM public.events WHERE id = v_event),
      (SELECT string_agg(DISTINCT currency::text, ',') FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL);
  END IF;

  -- A draft save still stays a draft, and names no status column: the
  -- brand's reach snapshot (an AFTER UPDATE OF status trigger) is not touched.
  v_event := (public.biz_create_experience(v_brand, pg_temp.exp_payload(25000, 'NGN'), false)->'event'->>'id')::uuid;
  v_reach := (SELECT snapshot_version FROM public.brand_reach_refresh_state WHERE brand_id = v_brand);
  PERFORM public.biz_publish_experience(v_event, pg_temp.exp_payload(26000, 'NGN'), false);
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'draft' THEN
    RAISE EXCEPTION 'T4 FAIL: a draft save published';
  END IF;
  IF (SELECT snapshot_version FROM public.brand_reach_refresh_state WHERE brand_id = v_brand)
     IS DISTINCT FROM v_reach THEN
    RAISE EXCEPTION 'T4 FAIL: a draft save marked the brand reach dirty';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2B T4 PASS: one update moves currency and status; tickets follow the stored currency';
END $t4$;

DO $t5$
DECLARE
  v_brand uuid := '36452b00-0000-4000-8000-0000000000b5';
  v_event uuid;
BEGIN
  -- A brand with no currency: a free experience publishes with no currency.
  INSERT INTO public.brands(id, account_id, name, slug)
  VALUES (v_brand, '36452b00-0000-4000-8000-000000000001', 'No currency', 'b2b-nocur');
  PERFORM pg_temp.as_host();
  v_event := (public.biz_create_experience(v_brand, pg_temp.exp_payload(0, NULL), false)->'event'->>'id')::uuid;
  PERFORM public.biz_publish_experience(v_event, pg_temp.exp_payload(0, NULL), true);
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'scheduled'
     OR (SELECT currency FROM public.events WHERE id = v_event) IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL
                 AND currency IS NOT NULL) THEN
    RAISE EXCEPTION 'T5 FAIL: free-only publish on a no-currency brand carries a currency';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2B T5 PASS: a free-only experience on a brand with no currency publishes with none';
END $t5$;

-- ─── T6-T9  a cancelled date ────────────────────────────────────────────────
-- A published multi-date event with two dates and a paid ticket.
CREATE FUNCTION pg_temp.dated_event(p_event uuid, p_brand uuid, p_recurring boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, is_multi_date, is_recurring, currency)
  VALUES (p_event, p_brand, '36452b00-0000-4000-8000-000000000001', 'Dated', 'b2b-dated-' || p_event,
    'event', 'draft', 'draft', 'UTC', NOT p_recurring, p_recurring, 'NGN');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
  VALUES (('36452b00-0000-4000-8000-' || right(p_event::text, 10) || 'd1')::uuid, p_event,
          now() + interval '5 days', now() + interval '5 days 3 hours', 'UTC', true),
         (('36452b00-0000-4000-8000-' || right(p_event::text, 10) || 'd2')::uuid, p_event,
          now() + interval '6 days', now() + interval '6 days 3 hours', 'UTC', false);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now()
   WHERE id = p_event;
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, quantity_total, is_free)
  VALUES (('36452b00-0000-4000-8000-' || right(p_event::text, 10) || 'aa')::uuid, p_event,
          'General', 250000, 'NGN', 100, false);
END $$;

-- An open checkout on that event, for one date.
CREATE FUNCTION pg_temp.session(p_event uuid, p_brand uuid, p_date uuid, p_status text, p_tag text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_checkout_sessions(id, event_id, brand_id, buyer_name, buyer_email,
    buyer_phone_e164, expires_at, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, metadata)
  VALUES (v_id, p_event, p_brand, 'Buyer ' || p_tag, 'b2b-' || p_tag || '@example.test',
    '+2348000000001', now() + interval '1 hour', 250000, 0, 250000, 'NGN', p_status,
    'b2b-' || p_tag || '-' || v_id, jsonb_build_object('event_date_id', p_date));
  INSERT INTO public.ticket_checkout_session_items(checkout_session_id, ticket_type_id,
    ticket_name_at_purchase, quantity)
  SELECT v_id, tt.id, tt.name, 1 FROM public.ticket_types tt WHERE tt.event_id = p_event;
  INSERT INTO public.ticket_checkout_session_event_dates(checkout_session_id, event_date_id)
  VALUES (v_id, p_date);
  RETURN v_id;
END $$;

DO $t6$
DECLARE
  v_brand uuid := '36452b00-0000-4000-8000-0000000000b6';
  v_event uuid := '36452b00-0000-4000-8000-0000000000e6';
  v_d1 uuid := '36452b00-0000-4000-8000-00000000e6d1';
  v_d2 uuid := '36452b00-0000-4000-8000-00000000e6d2';
  v_status text;
  v_open uuid[] := '{}';
  v_done uuid;
  v_other uuid;
  v_epoch bigint;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'NGN');
  PERFORM pg_temp.dated_event(v_event, v_brand, false);
  FOREACH v_status IN ARRAY ARRAY['pending_free','requires_payment','processing_payment','awaiting_web_redirect']
  LOOP
    v_open := v_open || pg_temp.session(v_event, v_brand, v_d1, v_status, v_status);
  END LOOP;
  v_done := pg_temp.session(v_event, v_brand, v_d1, 'expired', 'expired');
  v_other := pg_temp.session(v_event, v_brand, v_d2, 'processing_payment', 'other-date');

  -- A preview revokes nothing.
  PERFORM pg_temp.as_host();
  PERFORM public.business_cancel_event_date(v_event, v_d1, 'Venue flooded', true);
  IF EXISTS (SELECT 1 FROM public.ticket_checkout_sessions WHERE id = ANY(v_open) AND revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'T6 FAIL: a preview revoked a checkout';
  END IF;

  PERFORM public.business_cancel_event_date(v_event, v_d1, 'Venue flooded', false);
  IF (SELECT count(*) FROM public.ticket_checkout_sessions
       WHERE id = ANY(v_open) AND revoked_at IS NOT NULL AND status = 'failed'
         AND revoked_reason = 'inventory_changed') <> 4 THEN
    RAISE EXCEPTION 'T6 FAIL: open checkouts on the cancelled date were not all revoked';
  END IF;
  IF (SELECT count(*) FROM public.checkout_sale_revocation_outbox
       WHERE subject_type = 'ticket_checkout_session' AND subject_id = ANY(v_open)) <> 4 THEN
    RAISE EXCEPTION 'T6 FAIL: revocations were not queued';
  END IF;
  -- Event-wide, as a date's time change is: a checkout on the other date
  -- re-quotes (or, if already charged, is refunded by the late reversal).
  IF (SELECT revoked_at FROM public.ticket_checkout_sessions WHERE id = v_other) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.checkout_sale_revocation_outbox
                     WHERE subject_type = 'ticket_checkout_session' AND subject_id = v_other) THEN
    RAISE EXCEPTION 'T6 FAIL: the open checkout on the other date was not revoked';
  END IF;
  IF (SELECT revoked_at FROM public.ticket_checkout_sessions WHERE id = v_done) IS NOT NULL THEN
    RAISE EXCEPTION 'T6 FAIL: a finished checkout was touched';
  END IF;
  -- The event still sells its other date: sellable is re-read per attempt.
  IF public.issue_1930_event_sale_reason((SELECT e FROM public.events e WHERE e.id = v_event)) <> 'sellable' THEN
    RAISE EXCEPTION 'T6 FAIL: the event stopped selling';
  END IF;
  -- Cancelling it again is refused and bumps nothing.
  SELECT epoch INTO v_epoch FROM public.event_checkout_admission_state WHERE event_id = v_event;
  BEGIN
    PERFORM public.business_cancel_event_date(v_event, v_d1, 'Cancelling again by mistake', false);
    RAISE EXCEPTION 'T6 FAIL: a second cancel was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'occurrence_already_cancelled' THEN RAISE; END IF;
  END;
  IF (SELECT epoch FROM public.event_checkout_admission_state WHERE event_id = v_event) <> v_epoch THEN
    RAISE EXCEPTION 'T6 FAIL: a refused cancel bumped the admission epoch';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2B T6 PASS: cancelling a date revokes open checkouts and queues their reversal';
END $t6$;

DO $t7$
DECLARE
  v_brand uuid := '36452b00-0000-4000-8000-0000000000b6';
  v_event uuid := '36452b00-0000-4000-8000-0000000000e6';
  v_d1 uuid := '36452b00-0000-4000-8000-00000000e6d1';
  v_d2 uuid := '36452b00-0000-4000-8000-00000000e6d2';
  v_on_cancelled uuid;
  v_on_active uuid;
BEGIN
  -- Checkouts started after the cancel (say, from a stale page).
  v_on_cancelled := pg_temp.session(v_event, v_brand, v_d1, 'requires_payment', 'late-d1');
  v_on_active := pg_temp.session(v_event, v_brand, v_d2, 'requires_payment', 'late-d2');
  IF NOT public.issue_1930_ticket_session_authorized(v_on_active, v_event) THEN
    RAISE EXCEPTION 'T7 fixture FAIL: a checkout on the active date is not authorised';
  END IF;
  IF public.issue_1930_ticket_session_authorized(v_on_cancelled, v_event) THEN
    RAISE EXCEPTION 'T7 FAIL: a checkout for the cancelled date is authorised';
  END IF;
  -- Anchored on the active date, but the chosen dates include the cancelled one.
  INSERT INTO public.ticket_checkout_session_event_dates(checkout_session_id, event_date_id)
  VALUES (v_on_active, v_d1);
  IF public.issue_1930_ticket_session_authorized(v_on_active, v_event) THEN
    RAISE EXCEPTION 'T7 FAIL: a checkout whose chosen dates include the cancelled one is authorised';
  END IF;
  -- Only the anchor names the date: still refused.
  DELETE FROM public.ticket_checkout_session_event_dates WHERE checkout_session_id = v_on_cancelled;
  IF public.issue_1930_ticket_session_authorized(v_on_cancelled, v_event) THEN
    RAISE EXCEPTION 'T7 FAIL: a checkout anchored on the cancelled date is authorised';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2B T7 PASS: a checkout for a cancelled date is never authorised';
END $t7$;

DO $t8$
DECLARE
  v_err text;
BEGIN
  BEGIN
    PERFORM public.issue_3872_checkout_day_context('36452b00-0000-4000-8000-0000000000e6',
      ARRAY['36452b00-0000-4000-8000-00000000e6d1'::uuid], NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'occurrence_not_available' THEN
    RAISE EXCEPTION 'T8 FAIL: a new checkout for the cancelled date (%)', coalesce(v_err, 'accepted');
  END IF;
  v_err := NULL;
  BEGIN
    PERFORM public.issue_3872_checkout_day_context('36452b00-0000-4000-8000-0000000000e6',
      ARRAY['36452b00-0000-4000-8000-00000000e6d2'::uuid, '36452b00-0000-4000-8000-00000000e6d1'::uuid], NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'occurrence_not_available' THEN
    RAISE EXCEPTION 'T8 FAIL: a choice including the cancelled date (%)', coalesce(v_err, 'accepted');
  END IF;
  PERFORM public.issue_3872_checkout_day_context('36452b00-0000-4000-8000-0000000000e6',
    ARRAY['36452b00-0000-4000-8000-00000000e6d2'::uuid], NULL, NULL);
  RAISE NOTICE 'ISSUE-3645-2B T8 PASS: a new checkout cannot choose a cancelled date';
END $t8$;

DO $t9$
DECLARE
  v_brand uuid := '36452b00-0000-4000-8000-0000000000b9';
  v_event uuid := '36452b00-0000-4000-8000-0000000000e9';
  v_choice jsonb;
  v_ctx jsonb;
BEGIN
  -- A recurring event with two upcoming dates; the first is cancelled.
  PERFORM pg_temp.brand(v_brand, 'NGN');
  PERFORM pg_temp.dated_event(v_event, v_brand, true);
  PERFORM pg_temp.as_host();
  PERFORM public.business_cancel_event_date(v_event, '36452b00-0000-4000-8000-00000000e9d1', 'Heavy rain forecast', false);
  v_choice := public.issue_3313_event_day_choice(v_event);
  IF (v_choice->>'upcomingCount')::integer <> 1
     OR v_choice->>'soleOccurrenceId' IS DISTINCT FROM '36452b00-0000-4000-8000-00000000e9d2' THEN
    RAISE EXCEPTION 'T9 FAIL: day choice counts the cancelled date: %', v_choice;
  END IF;
  v_ctx := public.issue_3872_checkout_day_context(v_event, NULL, NULL, NULL);
  IF v_ctx->'dayIds' IS DISTINCT FROM '["36452b00-0000-4000-8000-00000000e9d2"]'::jsonb THEN
    RAISE EXCEPTION 'T9 FAIL: the checkout auto-picked %', v_ctx->'dayIds';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2B T9 PASS: a cancelled date is not upcoming and is never auto-picked';
END $t9$;

-- ─── T10  every upcoming date cancelled ─────────────────────────────────────
DO $t10$
DECLARE
  v_brand uuid := '36452b00-0000-4000-8000-0000000000ba';
  v_rec uuid := '36452b00-0000-4000-8000-0000000000ea';
  v_multi uuid := '36452b00-0000-4000-8000-0000000000eb';
  v_choice jsonb;
  v_ev uuid;
  v_err text;
  v_dateless uuid;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'NGN');
  PERFORM pg_temp.dated_event(v_rec, v_brand, true);
  PERFORM pg_temp.dated_event(v_multi, v_brand, false);
  PERFORM pg_temp.as_host();
  FOREACH v_ev IN ARRAY ARRAY[v_rec, v_multi] LOOP
    PERFORM public.business_cancel_event_date(v_ev,
      ('36452b00-0000-4000-8000-' || right(v_ev::text, 10) || 'd1')::uuid, 'Venue closed for repairs', false);
    PERFORM public.business_cancel_event_date(v_ev,
      ('36452b00-0000-4000-8000-' || right(v_ev::text, 10) || 'd2')::uuid, 'Venue closed for repairs', false);
    v_choice := public.issue_3313_event_day_choice(v_ev);
    IF (v_choice->>'upcomingCount')::integer <> 0 OR NOT (v_choice->>'requiresChoice')::boolean
       OR v_choice->>'soleOccurrenceId' IS NOT NULL THEN
      RAISE EXCEPTION 'T10 FAIL: day choice with every date cancelled: %', v_choice;
    END IF;
    v_err := NULL;
    BEGIN
      PERFORM public.issue_3872_checkout_day_context(v_ev, NULL, NULL, NULL);
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF v_err IS DISTINCT FROM 'occurrence_not_available' THEN
      RAISE EXCEPTION 'T10 FAIL: a dateless checkout with every date cancelled (%)', coalesce(v_err, 'accepted');
    END IF;
  END LOOP;
  -- The buyer page still says a date must be chosen (none can be), and
  -- the single-date event whose only date is cancelled is refused too.
  IF (public.pg_direct_event_checkout_bundle(v_rec)->>'isMultiDate')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T10 FAIL: the buyer bundle offers a dateless purchase';
  END IF;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency)
  VALUES ('36452b00-0000-4000-8000-0000000000ed', v_brand, '36452b00-0000-4000-8000-000000000001',
    'One date', 'b2b-one-date', 'event', 'draft', 'draft', 'UTC', 'NGN');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
  VALUES ('36452b00-0000-4000-8000-00000000edd1', '36452b00-0000-4000-8000-0000000000ed',
    now() + interval '5 days', now() + interval '5 days 3 hours', 'UTC', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now()
   WHERE id = '36452b00-0000-4000-8000-0000000000ed';
  PERFORM public.business_cancel_event_date('36452b00-0000-4000-8000-0000000000ed',
    '36452b00-0000-4000-8000-00000000edd1', 'Venue closed for repairs', false);
  -- A checkout with no date of its own (a single-date event's, or one
  -- opened before this migration for a date already cancelled) is not
  -- authorised once every upcoming date is cancelled.
  v_dateless := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions(id, event_id, brand_id, buyer_name, buyer_email,
    buyer_phone_e164, expires_at, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key)
  VALUES (v_dateless, '36452b00-0000-4000-8000-0000000000ed', v_brand, 'Dateless',
    'b2b-dateless@example.test', '+2348000000001', now() + interval '1 hour', 250000, 0, 250000,
    'NGN', 'requires_payment', 'b2b-dateless-' || v_dateless);
  IF public.issue_1930_ticket_session_authorized(v_dateless, '36452b00-0000-4000-8000-0000000000ed') THEN
    RAISE EXCEPTION 'T10 FAIL: a dateless checkout is authorised with its only date cancelled';
  END IF;
  v_err := NULL;
  BEGIN
    PERFORM public.issue_3872_checkout_day_context('36452b00-0000-4000-8000-0000000000ed', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'occurrence_not_available' THEN
    RAISE EXCEPTION 'T10 FAIL: single-date event with its date cancelled (%)', coalesce(v_err, 'accepted');
  END IF;
  -- The cancelled date's original time has passed: the refusal must not lapse.
  UPDATE public.event_dates
     SET start_at = now() - interval '3 hours', end_at = now() - interval '1 hour'
   WHERE id = '36452b00-0000-4000-8000-00000000edd1';
  v_dateless := gen_random_uuid();
  INSERT INTO public.ticket_checkout_sessions(id, event_id, brand_id, buyer_name, buyer_email,
    buyer_phone_e164, expires_at, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key)
  VALUES (v_dateless, '36452b00-0000-4000-8000-0000000000ed', v_brand, 'Dateless later',
    'b2b-dateless-2@example.test', '+2348000000001', now() + interval '1 hour', 250000, 0, 250000,
    'NGN', 'requires_payment', 'b2b-dateless-2-' || v_dateless);
  IF public.issue_1930_ticket_session_authorized(v_dateless, '36452b00-0000-4000-8000-0000000000ed') THEN
    RAISE EXCEPTION 'T10 FAIL: a dateless checkout is authorised once the cancelled date has ended';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2B T10 PASS: with every upcoming date cancelled nothing can be checked out, and the buyer is told why';
END $t10$;

ROLLBACK;

\set ON_ERROR_STOP on

-- Issue #3645 — tester RETEST 3 of "an unpublished draft with nothing sold
-- follows its brand's currency" (20270829003645). Run after the full migration
-- chain on PostgreSQL 17. Everything is rolled back.
--
-- Retest 2 failed on: a draft the brand trigger skips (published, a buyer
-- starts a checkout and leaves, unpublished, then the brand changes currency)
-- went on sale at the OLD number in the NEW currency. Rework 3 adds a stop at
-- Publish and `biz_sync_draft_currency`, the host's way out of that stop.
-- EVERY publish in the product now passes that stop, so this suite attacks it
-- from angles the implementor's publish-stop suite does not take:
--
--   R-1x  The retest-2 scenario through the real owners, plus two ways round
--         the stop: the old number relabelled with the brand's currency, and a
--         caller that switches the "free only" publish flag on for itself
--         before publishing a priced draft. The sync is asked twice.
--   R-2x  What stops the sync: a checkout still open, a payment in flight past
--         its expiry, an order. Nothing is changed by a refused sync.
--   R-3x  Who may run the sync: every rank below event manager, a host of
--         another brand, a signed-out caller and the anon role are refused; an
--         event manager is allowed. It cannot reach a published event, an
--         experience draft or a deleted draft, and clients cannot call the
--         routine behind it.
--   R-4x  The sync is not a way to wipe prices: a draft in step is left byte
--         for byte; a draft with no currency of its own keeps its typed price;
--         a brand with no currency changes nothing.
--   R-5x  Publishes that must not change: a free-only draft that is out of
--         step, a free event of a brand with no currency, a paid event of a
--         brand with no currency (still `event_currency_required`), an
--         untouched unpublish then publish, and a skipped draft whose brand
--         went away and came BACK to its currency.
--   R-6x  An RSVP with chip-in amounts: after the clear, the old amounts are
--         written back in the old currency. It cannot publish; the sync clears
--         it; with new amounts it publishes in the brand's currency.
--   R-7x  The stop's own wiring: order against the re-stamp, and no client
--         role can execute a trigger function.
--
-- NULL-safety: comparisons whose left side can be NULL use IS DISTINCT FROM.

BEGIN;

INSERT INTO auth.users(id) VALUES
  ('36450933-0000-4000-8000-000000000001'), ('36450933-0000-4000-8000-000000000002'),
  ('36450933-0000-4000-8000-000000000003'), ('36450933-0000-4000-8000-000000000004');
INSERT INTO public.creator_accounts(id) VALUES
  ('36450933-0000-4000-8000-000000000001'), ('36450933-0000-4000-8000-000000000002'),
  ('36450933-0000-4000-8000-000000000003'), ('36450933-0000-4000-8000-000000000004');

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user, true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user = '' THEN '' ELSE
      json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END $$;

CREATE FUNCTION pg_temp.host() RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT '36450933-0000-4000-8000-000000000001'::text
$$;

-- A brand that can take money, with the organiser terms accepted, so a paid
-- Publish is refused for no other reason. p_currency NULL = no currency.
CREATE FUNCTION pg_temp.brand(p_id uuid, p_currency text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (p_id, pg_temp.host()::uuid, 'RT3 ' || p_id, 'rt3-' || p_id, p_currency);
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_rt3_' || right(p_id::text, 4)
   WHERE id = p_id;
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = p_id AND user_id = pg_temp.host()::uuid;
END $$;

-- What the wizard sends: one online ticket. p_price NULL = a free ticket.
-- p_currency NULL = a draft with no currency.
CREATE FUNCTION pg_temp.payload(p_currency text, p_price numeric) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('title', 'RT3 draft', 'timezone', 'UTC', 'currency', p_currency,
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'currency', p_currency,
      'tickets', jsonb_build_array(jsonb_build_object('id', 't_one', 'name', 'General',
        'isFree', p_price IS NULL, 'priceGbp', p_price, 'capacity', 10, 'availableAt', 'online')
        || CASE WHEN p_currency IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('currency', p_currency) END),
      'city', 'London', 'partyTypes', jsonb_build_array('club-night'),
      'requestedVisibility', 'public', 'whenMode', 'single',
      'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00'))))
$$;

CREATE FUNCTION pg_temp.draft(p_id uuid, p_brand uuid, p_type text DEFAULT 'event') RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (p_id, p_brand, pg_temp.host()::uuid, 'RT3 draft', 'draft-rt3-' || p_id, p_type,
    'draft', 'draft', 'UTC')
$$;

CREATE FUNCTION pg_temp.revision(p_event uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT COALESCE((theme#>>'{business_draft,clientRevision}')::integer, 0)
    FROM public.events WHERE id = p_event
$$;

CREATE FUNCTION pg_temp.save(p_event uuid, p_payload jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(pg_temp.host());
  SET LOCAL ROLE authenticated;
  PERFORM public.business_update_event_draft(p_event, p_payload, pg_temp.revision(p_event) + 1);
  RESET ROLE;
END $$;

-- The host presses Publish. Returns NULL when it published, else the refusal.
-- p_claim_free: the CALLER first switches the "free only" publish flag on for
-- its own transaction, as a client that could reach set_config would.
CREATE FUNCTION pg_temp.publish(p_event uuid, p_payload jsonb, p_claim_free boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_refused text := NULL;
BEGIN
  PERFORM pg_temp.as_user(pg_temp.host());
  SET LOCAL ROLE authenticated;
  IF p_claim_free THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;
  BEGIN
    PERFORM public.business_publish_event_draft(p_event, p_payload, pg_temp.revision(p_event) + 1);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('mingla.publish_free_only', '', true);
  RETURN v_refused;
END $$;

-- The sync as p_user. Returns the outcome, or 'ERR:<message>' when refused.
CREATE FUNCTION pg_temp.sync(p_event uuid, p_user text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_out text;
BEGIN
  PERFORM pg_temp.as_user(COALESCE(p_user, pg_temp.host()));
  SET LOCAL ROLE authenticated;
  BEGIN
    v_out := public.biz_sync_draft_currency(p_event)->>'outcome';
  EXCEPTION WHEN OTHERS THEN
    v_out := 'ERR:' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v_out;
END $$;

CREATE FUNCTION pg_temp.unpublish(p_event uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(pg_temp.host());
  SET LOCAL ROLE authenticated;
  PERFORM public.business_unpublish_event_to_draft(p_event);
  RESET ROLE;
END $$;

CREATE FUNCTION pg_temp.checkout(p_event uuid, p_brand uuid, p_key text, p_status text,
  p_expires timestamptz) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.ticket_checkout_sessions(event_id, brand_id, buyer_name, buyer_email,
    buyer_phone_e164, idempotency_key, status, expires_at)
  VALUES (p_event, p_brand, 'Buyer', 'buyer@example.com', '+447700900009', p_key, p_status, p_expires)
$$;

-- Is this number on sale under this currency?
CREATE FUNCTION pg_temp.on_sale(p_event uuid, p_currency text, p_cents integer) RETURNS boolean
LANGUAGE sql AS $$
  SELECT (SELECT status FROM public.events WHERE id = p_event) <> 'draft'
     AND EXISTS (SELECT 1 FROM public.ticket_types tt
                  WHERE tt.event_id = p_event AND tt.deleted_at IS NULL
                    AND tt.price_cents = p_cents AND tt.currency = p_currency)
$$;

-- Everything about a draft that a sync or a refused publish must not change.
CREATE FUNCTION pg_temp.snapshot(p_event uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'status', e.status, 'currency', e.currency, 'theme', e.theme, 'published_at', e.published_at,
    'suggested', e.rsvp_contribution_suggested_cents, 'min', e.rsvp_contribution_min_cents,
    'tickets', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', tt.id, 'price', tt.price_cents,
                  'currency', tt.currency, 'deleted', tt.deleted_at) ORDER BY tt.id), '[]'::jsonb)
                  FROM public.ticket_types tt WHERE tt.event_id = e.id))
    FROM public.events e WHERE e.id = p_event
$$;

-- ─── R-1x  the retest-2 scenario, and two ways round the stop ────────────────
DO $r1$
DECLARE
  v_brand uuid := '36450933-0000-4000-8000-0000000000a0';
  v_event uuid := '36450933-0000-4000-8000-0000000000a1';
  v_before jsonb;
  v_after jsonb;
  v_out text;
  e record;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'GBP');
  PERFORM pg_temp.draft(v_event, v_brand);
  PERFORM pg_temp.save(v_event, pg_temp.payload('GBP', 50));
  v_out := pg_temp.publish(v_event, pg_temp.payload('GBP', 50));
  IF v_out IS NOT NULL OR NOT pg_temp.on_sale(v_event, 'GBP', 5000) THEN
    RAISE EXCEPTION 'R-10 fixture: 50 pounds did not go on sale on a pound brand: %', v_out;
  END IF;
  PERFORM pg_temp.checkout(v_event, v_brand, 'rt3-a1', 'requires_payment', now() + interval '1 hour');
  PERFORM pg_temp.unpublish(v_event);
  IF (SELECT status FROM public.events WHERE id = v_event) IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'R-10 fixture: the event did not return to draft';
  END IF;

  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;
  v_before := pg_temp.snapshot(v_event);
  IF v_before->>'currency' IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'R-10 the brand''s own change moved a draft a buyer had opened a checkout on';
  END IF;

  -- R-11 Publish with what the app holds.
  v_out := pg_temp.publish(v_event, pg_temp.payload('GBP', 50));
  IF pg_temp.on_sale(v_event, 'NGN', 5000) THEN
    RAISE EXCEPTION 'R-11 FIFTY POUNDS WENT ON SALE AS FIFTY NAIRA';
  END IF;
  IF v_out IS DISTINCT FROM 'price_reentry_required' THEN
    RAISE EXCEPTION 'R-11 Publish answered "%", expected price_reentry_required', v_out;
  END IF;

  -- R-12 The old number relabelled with the brand's currency.
  v_out := pg_temp.publish(v_event, pg_temp.payload('NGN', 50));
  IF v_out IS DISTINCT FROM 'price_reentry_required' OR pg_temp.on_sale(v_event, 'NGN', 5000) THEN
    RAISE EXCEPTION 'R-12 the old number relabelled as naira answered "%"', v_out;
  END IF;

  -- R-13 A caller that declares its own publish "free only" first. The flag
  -- is a custom setting any role can set for its transaction; the stop must
  -- not take the caller's word for it.
  v_out := pg_temp.publish(v_event, pg_temp.payload('GBP', 50), true);
  IF v_out IS DISTINCT FROM 'price_reentry_required' OR pg_temp.on_sale(v_event, 'NGN', 5000) THEN
    RAISE EXCEPTION 'R-13 a priced publish that claimed to be free-only answered "%"', v_out;
  END IF;
  v_out := pg_temp.publish(v_event, pg_temp.payload('NGN', 50), true);
  IF v_out IS DISTINCT FROM 'price_reentry_required' OR pg_temp.on_sale(v_event, 'NGN', 5000) THEN
    RAISE EXCEPTION 'R-13 a relabelled priced publish that claimed to be free-only answered "%"', v_out;
  END IF;

  -- R-14 Four refused publishes changed nothing.
  v_after := pg_temp.snapshot(v_event);
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'R-14 a refused publish changed the draft: % -> %', v_before, v_after;
  END IF;

  -- R-15 The way out. The buyer's checkout ended when the event came off sale.
  IF EXISTS (SELECT 1 FROM public.ticket_checkout_sessions s
              WHERE s.event_id = v_event
                AND (s.status IN ('paid_completed', 'free_completed', 'processing_payment')
                     OR (s.status IN ('pending_free', 'requires_payment', 'awaiting_web_redirect')
                         AND s.expires_at > now()))) THEN
    RAISE EXCEPTION 'R-15 fixture: unpublishing left the buyer''s checkout open';
  END IF;
  v_out := pg_temp.sync(v_event);
  IF v_out IS DISTINCT FROM 'moved_prices_cleared' THEN
    RAISE EXCEPTION 'R-15 the sync answered "%", expected moved_prices_cleared', v_out;
  END IF;
  SELECT currency, theme INTO e FROM public.events WHERE id = v_event;
  IF e.currency IS DISTINCT FROM 'NGN'
     OR e.theme#>>'{business_draft,currency}' IS DISTINCT FROM 'NGN'
     OR jsonb_typeof(e.theme#>'{business_draft,tickets,0,priceGbp}') IS DISTINCT FROM 'null'
     OR e.theme#>>'{business_draft,pricesClearedForCurrencyChange,from}' IS DISTINCT FROM 'GBP'
     OR e.theme#>>'{business_draft,pricesClearedForCurrencyChange,to}' IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'R-15 after the sync the draft is not "naira, no price, note GBP to NGN": % %',
      e.currency, e.theme->'business_draft';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_types tt
              WHERE tt.event_id = v_event AND tt.deleted_at IS NULL
                AND (tt.price_cents > 0 OR tt.currency IS DISTINCT FROM 'NGN')) THEN
    RAISE EXCEPTION 'R-15 a ticket row kept the old number or the old currency';
  END IF;

  -- R-16 Asked again: nothing to do, and nothing done.
  v_before := pg_temp.snapshot(v_event);
  IF pg_temp.sync(v_event) IS DISTINCT FROM 'in_step' OR pg_temp.sync(v_event) IS DISTINCT FROM 'in_step' THEN
    RAISE EXCEPTION 'R-16 a repeated sync did not answer in_step';
  END IF;
  IF pg_temp.snapshot(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'R-16 a repeated sync changed the draft';
  END IF;

  -- R-17 The stale pound Publish is still refused after the move.
  v_out := pg_temp.publish(v_event, pg_temp.payload('GBP', 50));
  IF v_out IS DISTINCT FROM 'price_reentry_required' OR pg_temp.on_sale(v_event, 'NGN', 5000) THEN
    RAISE EXCEPTION 'R-17 after the sync a stale pound Publish answered "%"', v_out;
  END IF;

  -- R-18 New price, in naira: it publishes.
  PERFORM pg_temp.save(v_event, pg_temp.payload('NGN', 9000));
  v_out := pg_temp.publish(v_event, pg_temp.payload('NGN', 9000));
  IF v_out IS NOT NULL OR NOT pg_temp.on_sale(v_event, 'NGN', 900000)
     OR pg_temp.on_sale(v_event, 'NGN', 5000) OR pg_temp.on_sale(v_event, 'GBP', 5000) THEN
    RAISE EXCEPTION 'R-18 the re-priced draft did not go on sale at 9000 naira only: %', v_out;
  END IF;
END
$r1$;

-- ─── R-2x  what stops the sync ───────────────────────────────────────────────
DO $r2$
DECLARE
  v_brand uuid := '36450933-0000-4000-8000-0000000000b0';
  v_event uuid := '36450933-0000-4000-8000-0000000000b1';
  v_sold uuid := '36450933-0000-4000-8000-0000000000b2';
  v_before jsonb;
  v_out text;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'GBP');
  PERFORM pg_temp.draft(v_event, v_brand);
  PERFORM pg_temp.save(v_event, pg_temp.payload('GBP', 50));
  PERFORM pg_temp.draft(v_sold, v_brand);
  PERFORM pg_temp.save(v_sold, pg_temp.payload('GBP', 50));
  PERFORM pg_temp.checkout(v_event, v_brand, 'rt3-b1', 'requires_payment', now() + interval '20 minutes');
  INSERT INTO public.orders(event_id, payment_status, buyer_phone_e164, total_cents, currency)
  VALUES (v_sold, 'paid', '+447700900001', 5000, 'GBP');
  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;

  -- R-20 a buyer is paying right now.
  v_before := pg_temp.snapshot(v_event);
  v_out := pg_temp.publish(v_event, pg_temp.payload('GBP', 50));
  IF v_out IS DISTINCT FROM 'price_reentry_required' THEN
    RAISE EXCEPTION 'R-20 Publish with a checkout open answered "%"', v_out;
  END IF;
  IF pg_temp.sync(v_event) IS DISTINCT FROM 'checkout_in_progress' THEN
    RAISE EXCEPTION 'R-20 the sync did not answer checkout_in_progress with a buyer paying';
  END IF;
  -- R-21 money moving, long past the session's expiry.
  UPDATE public.ticket_checkout_sessions
     SET status = 'processing_payment', expires_at = now() - interval '3 days'
   WHERE idempotency_key = 'rt3-b1';
  IF pg_temp.sync(v_event) IS DISTINCT FROM 'checkout_in_progress' THEN
    RAISE EXCEPTION 'R-21 a payment in flight was treated as abandoned once it was old';
  END IF;
  IF pg_temp.snapshot(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'R-22 a refused sync or publish changed a draft with a checkout in progress';
  END IF;

  -- R-23 an order exists: never moved, whoever asks, and never published out of step.
  v_before := pg_temp.snapshot(v_sold);
  IF pg_temp.sync(v_sold) IS DISTINCT FROM 'sale_exists' THEN
    RAISE EXCEPTION 'R-23 the sync did not answer sale_exists for a draft with an order';
  END IF;
  v_out := pg_temp.publish(v_sold, pg_temp.payload('GBP', 50));
  IF v_out IS DISTINCT FROM 'price_reentry_required' OR pg_temp.on_sale(v_sold, 'NGN', 5000) THEN
    RAISE EXCEPTION 'R-23 a draft with an order, out of step, answered "%" on Publish', v_out;
  END IF;
  IF pg_temp.snapshot(v_sold) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'R-23 a draft with an order was changed';
  END IF;
END
$r2$;

-- ─── R-3x  who may run the sync, and what it cannot reach ────────────────────
DO $r3$
DECLARE
  v_brand uuid := '36450933-0000-4000-8000-0000000000c0';
  v_other uuid := '36450933-0000-4000-8000-0000000000c9';
  v_event uuid := '36450933-0000-4000-8000-0000000000c1';
  v_live uuid := '36450933-0000-4000-8000-0000000000c2';
  v_exp uuid := '36450933-0000-4000-8000-0000000000c3';
  v_gone uuid := '36450933-0000-4000-8000-0000000000c4';
  v_stranger text := '36450933-0000-4000-8000-000000000002';
  v_member text := '36450933-0000-4000-8000-000000000003';
  v_before jsonb;
  v_role text;
  v_out text;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'GBP');
  -- The stranger owns a brand of their own: a host, but of another brand.
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_other, v_stranger::uuid, 'RT3 other', 'rt3-other-' || v_other, 'NGN');

  PERFORM pg_temp.draft(v_event, v_brand);
  PERFORM pg_temp.save(v_event, pg_temp.payload('GBP', 50));
  PERFORM pg_temp.checkout(v_event, v_brand, 'rt3-c1', 'expired', now() - interval '1 day');
  PERFORM pg_temp.draft(v_live, v_brand);
  PERFORM pg_temp.save(v_live, pg_temp.payload('GBP', 50));
  IF pg_temp.publish(v_live, pg_temp.payload('GBP', 50)) IS NOT NULL THEN
    RAISE EXCEPTION 'R-30 fixture: the live event did not publish';
  END IF;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_exp, v_brand, pg_temp.host()::uuid, 'RT3 exp', 'draft-rt3-exp', 'experience', 'draft',
    'draft', 'UTC', 'GBP', jsonb_build_object('business_draft', jsonb_build_object('currency', 'GBP')));
  PERFORM pg_temp.draft(v_gone, v_brand);
  PERFORM pg_temp.save(v_gone, pg_temp.payload('GBP', 50));
  PERFORM pg_temp.checkout(v_gone, v_brand, 'rt3-c4', 'expired', now() - interval '1 day');
  UPDATE public.events SET deleted_at = now() WHERE id = v_gone;

  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;
  v_before := pg_temp.snapshot(v_event);
  IF v_before->>'currency' IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'R-30 fixture: the draft was expected to be left in pounds';
  END IF;

  -- R-31 a host of ANOTHER brand.
  v_out := pg_temp.sync(v_event, v_stranger);
  IF v_out IS DISTINCT FROM 'ERR:insufficient_event_permission' THEN
    RAISE EXCEPTION 'R-31 a host of another brand got "%"', v_out;
  END IF;
  -- R-32 every rank below event manager, as an accepted member of THIS brand.
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (v_brand, v_member::uuid, 'scanner', now());
  FOREACH v_role IN ARRAY ARRAY['scanner', 'marketing_manager', 'finance_manager'] LOOP
    UPDATE public.brand_team_members SET role = v_role
     WHERE brand_id = v_brand AND user_id = v_member::uuid;
    v_out := pg_temp.sync(v_event, v_member);
    IF v_out IS DISTINCT FROM 'ERR:insufficient_event_permission' THEN
      RAISE EXCEPTION 'R-32 a % of the brand got "%"', v_role, v_out;
    END IF;
  END LOOP;
  -- R-33 a member who was removed, whatever their role was.
  UPDATE public.brand_team_members SET role = 'brand_admin', removed_at = now()
   WHERE brand_id = v_brand AND user_id = v_member::uuid;
  v_out := pg_temp.sync(v_event, v_member);
  IF v_out IS DISTINCT FROM 'ERR:insufficient_event_permission' THEN
    RAISE EXCEPTION 'R-33 a removed brand admin got "%"', v_out;
  END IF;
  -- R-34 signed out, and the anon role.
  v_out := pg_temp.sync(v_event, '');
  IF v_out IS DISTINCT FROM 'ERR:not_authenticated' THEN
    RAISE EXCEPTION 'R-34 a signed-out caller got "%"', v_out;
  END IF;
  IF has_function_privilege('anon', 'public.biz_sync_draft_currency(uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'public.biz_sync_draft_currency(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',
          'public.issue_3645_move_draft_to_currency(uuid, character, character, boolean, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated',
          'public.issue_3645_move_draft_to_currency(uuid, character, character, boolean, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R-34 the sync is open to anon, or the routine behind it is open to a client';
  END IF;
  IF pg_temp.snapshot(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'R-35 a refused caller changed the draft';
  END IF;

  -- R-36 it cannot reach a published event, an experience draft, a deleted draft.
  v_before := pg_temp.snapshot(v_live);
  IF pg_temp.sync(v_live) IS DISTINCT FROM 'not_a_draft'
     OR pg_temp.snapshot(v_live) IS DISTINCT FROM v_before
     OR NOT pg_temp.on_sale(v_live, 'GBP', 5000) THEN
    RAISE EXCEPTION 'R-36 the sync touched an event that is on sale';
  END IF;
  v_before := pg_temp.snapshot(v_exp);
  IF pg_temp.sync(v_exp) IS DISTINCT FROM 'not_a_draft'
     OR pg_temp.snapshot(v_exp) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'R-36 the sync touched an experience draft';
  END IF;
  v_before := pg_temp.snapshot(v_gone);
  IF pg_temp.sync(v_gone) IS DISTINCT FROM 'ERR:event_draft_not_found'
     OR pg_temp.snapshot(v_gone) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'R-36 the sync reached a deleted draft';
  END IF;

  -- R-37 an event manager of the brand MAY.
  UPDATE public.brand_team_members SET role = 'event_manager', removed_at = NULL
   WHERE brand_id = v_brand AND user_id = v_member::uuid;
  v_out := pg_temp.sync(v_event, v_member);
  IF v_out IS DISTINCT FROM 'moved_prices_cleared' THEN
    RAISE EXCEPTION 'R-37 an event manager of the brand got "%"', v_out;
  END IF;

  -- R-38 definer, with a fixed search path.
  IF NOT (SELECT p.prosecdef AND 'search_path=public, pg_temp' = ANY (p.proconfig)
            FROM pg_proc p WHERE p.oid = 'public.biz_sync_draft_currency(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'R-38 biz_sync_draft_currency is not SECURITY DEFINER with a fixed search_path';
  END IF;
END
$r3$;

-- ─── R-4x  the sync is not a way to wipe prices ──────────────────────────────
DO $r4$
DECLARE
  v_brand uuid := '36450933-0000-4000-8000-0000000000d0';
  v_none uuid := '36450933-0000-4000-8000-0000000000d9';
  v_step uuid := '36450933-0000-4000-8000-0000000000d1';
  v_blank uuid := '36450933-0000-4000-8000-0000000000d2';
  v_nocur uuid := '36450933-0000-4000-8000-0000000000d3';
  v_before jsonb;
  v_out text;
  e record;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'NGN');
  PERFORM pg_temp.brand(v_none, NULL);

  -- R-40 in step and priced: left byte for byte.
  PERFORM pg_temp.draft(v_step, v_brand);
  PERFORM pg_temp.save(v_step, pg_temp.payload('NGN', 7000));
  v_before := pg_temp.snapshot(v_step);
  IF pg_temp.sync(v_step) IS DISTINCT FROM 'in_step'
     OR pg_temp.snapshot(v_step) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'R-40 the sync changed a priced draft that is in step with its brand';
  END IF;

  -- R-41 no currency of its own (typed while the screen said "Currency not
  -- set"), on a brand that has one: stamped, and the typed price is KEPT.
  PERFORM pg_temp.draft(v_blank, v_brand);
  PERFORM pg_temp.save(v_blank, pg_temp.payload(NULL, 7000));
  IF (SELECT currency FROM public.events WHERE id = v_blank) IS NOT NULL THEN
    RAISE EXCEPTION 'R-41 fixture: the draft was expected to have no currency';
  END IF;
  v_out := pg_temp.sync(v_blank);
  SELECT currency, theme INTO e FROM public.events WHERE id = v_blank;
  IF v_out IS DISTINCT FROM 'moved'
     OR e.currency IS DISTINCT FROM 'NGN'
     OR (e.theme#>>'{business_draft,tickets,0,priceGbp}')::numeric IS DISTINCT FROM 7000
     OR (e.theme->'business_draft') ? 'pricesClearedForCurrencyChange' THEN
    RAISE EXCEPTION 'R-41 a draft with no currency was not "stamped, price kept, no note": % % %',
      v_out, e.currency, e.theme->'business_draft';
  END IF;

  -- R-42 a brand with no currency: nothing to move to, nothing changed.
  PERFORM pg_temp.draft(v_nocur, v_none);
  PERFORM pg_temp.save(v_nocur, pg_temp.payload('GBP', 50));
  v_before := pg_temp.snapshot(v_nocur);
  IF pg_temp.sync(v_nocur) IS DISTINCT FROM 'brand_has_no_currency'
     OR pg_temp.snapshot(v_nocur) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'R-42 the sync changed a draft whose brand has no currency';
  END IF;
END
$r4$;

-- ─── R-5x  publishes that must not change ────────────────────────────────────
DO $r5$
DECLARE
  v_brand uuid := '36450933-0000-4000-8000-0000000000e0';
  v_none uuid := '36450933-0000-4000-8000-0000000000e9';
  v_round uuid := '36450933-0000-4000-8000-0000000000e8';
  v_free uuid := '36450933-0000-4000-8000-0000000000e1';
  v_again uuid := '36450933-0000-4000-8000-0000000000e2';
  v_nofree uuid := '36450933-0000-4000-8000-0000000000e3';
  v_nopaid uuid := '36450933-0000-4000-8000-0000000000e4';
  v_back uuid := '36450933-0000-4000-8000-0000000000e5';
  v_out text;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'GBP');
  PERFORM pg_temp.brand(v_none, NULL);
  PERFORM pg_temp.brand(v_round, 'GBP');

  -- R-50 an untouched unpublish then publish, same currency throughout.
  PERFORM pg_temp.draft(v_again, v_brand);
  PERFORM pg_temp.save(v_again, pg_temp.payload('GBP', 50));
  IF pg_temp.publish(v_again, pg_temp.payload('GBP', 50)) IS NOT NULL THEN
    RAISE EXCEPTION 'R-50 fixture: first publish refused';
  END IF;
  PERFORM pg_temp.unpublish(v_again);
  v_out := pg_temp.publish(v_again, pg_temp.payload('GBP', 50));
  IF v_out IS NOT NULL OR NOT pg_temp.on_sale(v_again, 'GBP', 5000) THEN
    RAISE EXCEPTION 'R-50 an untouched event could not be published again: %', v_out;
  END IF;

  -- R-51 a brand with no currency: free publishes, paid is refused as before.
  PERFORM pg_temp.draft(v_nofree, v_none);
  PERFORM pg_temp.save(v_nofree, pg_temp.payload(NULL, NULL));
  v_out := pg_temp.publish(v_nofree, pg_temp.payload(NULL, NULL));
  IF v_out IS NOT NULL THEN
    RAISE EXCEPTION 'R-51 a free event of a brand with no currency was refused: %', v_out;
  END IF;
  PERFORM pg_temp.draft(v_nopaid, v_none);
  PERFORM pg_temp.save(v_nopaid, pg_temp.payload(NULL, 50));
  v_out := pg_temp.publish(v_nopaid, pg_temp.payload(NULL, 50));
  IF v_out IS DISTINCT FROM 'event_currency_required' THEN
    RAISE EXCEPTION 'R-51 a paid event of a brand with no currency answered "%", expected event_currency_required as before', v_out;
  END IF;

  -- R-52 a free-only draft the brand's change did not move still publishes.
  PERFORM pg_temp.draft(v_free, v_brand);
  PERFORM pg_temp.save(v_free, pg_temp.payload('GBP', NULL));
  PERFORM pg_temp.checkout(v_free, v_brand, 'rt3-e1', 'failed', now() - interval '1 day');
  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;
  IF (SELECT currency FROM public.events WHERE id = v_free) IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'R-52 fixture: the free draft was expected to be left in pounds';
  END IF;
  v_out := pg_temp.publish(v_free, pg_temp.payload('GBP', NULL));
  IF v_out IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.ticket_types tt
                 WHERE tt.event_id = v_free AND tt.deleted_at IS NULL AND tt.price_cents > 0) THEN
    RAISE EXCEPTION 'R-52 a free-only draft out of step was refused, or gained a price: %', v_out;
  END IF;

  -- R-53 the brand went to naira and came BACK to pounds; a draft the changes
  -- skipped is in step again and publishes at its own number.
  PERFORM pg_temp.draft(v_back, v_round);
  PERFORM pg_temp.save(v_back, pg_temp.payload('GBP', 50));
  PERFORM pg_temp.checkout(v_back, v_round, 'rt3-e5', 'expired', now() - interval '1 day');
  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_round;
  IF pg_temp.publish(v_back, pg_temp.payload('GBP', 50)) IS DISTINCT FROM 'price_reentry_required' THEN
    RAISE EXCEPTION 'R-53 fixture: the skipped draft was not refused while the brand was in naira';
  END IF;
  UPDATE public.brands SET default_currency = 'GBP' WHERE id = v_round;
  v_out := pg_temp.publish(v_back, pg_temp.payload('GBP', 50));
  IF v_out IS NOT NULL OR NOT pg_temp.on_sale(v_back, 'GBP', 5000) THEN
    RAISE EXCEPTION 'R-53 back in its brand''s currency the draft did not publish at 50 pounds: %', v_out;
  END IF;
END
$r5$;

-- ─── R-6x  an RSVP with chip-in amounts ──────────────────────────────────────
CREATE FUNCTION pg_temp.rsvp_payload(p_revision integer, p_currency text, p_suggested integer,
  p_minimum integer) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    '__expectedClientRevision', p_revision, 'title', 'RT3 RSVP', 'description', NULL,
    'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn, New York 11249, United States',
    'online_url', NULL, 'currency', p_currency, 'is_online', false,
    'timezone', 'America/New_York', 'city', 'Brooklyn',
    'theme', jsonb_build_object('coverHue', 25, 'business_draft', jsonb_build_object(
      'format', 'in_person', 'partyTypes', jsonb_build_array('house-party'),
      'vibeTags', '[]'::jsonb, 'musicGenres', '[]'::jsonb, 'city', 'Brooklyn',
      'requestedVisibility', 'public', 'whenMode', 'single',
      'when', jsonb_build_object('date', to_char((now() + interval '30 days')::date, 'YYYY-MM-DD'),
        'doorsOpen', '19:00', 'endsAt', '23:00', 'timezone', 'America/New_York'),
      'location', jsonb_build_object('venueName', 'Lantern Room',
        'address', '61 Wythe Avenue, Brooklyn, New York 11249, United States'),
      'hideAddressUntilTicket', false, 'tickets', '[]'::jsonb, 'isRsvp', true,
      'rsvpApprovalMode', 'auto', 'rsvpDiscoverable', false, 'rsvpContributionEnabled', true,
      'rsvpContributionSuggestedCents', p_suggested, 'rsvpContributionMinCents', p_minimum,
      'clientRevision', p_revision)))
$$;

DO $r6$
DECLARE
  v_brand uuid := '36450933-0000-4000-8000-0000000000f0';
  v_event uuid := '36450933-0000-4000-8000-0000000000f1';
  v_out text;
  e record;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'GBP');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, pg_temp.host()::uuid, 'RT3 RSVP', 'draft-rt3-rsvp', 'rsvp', 'draft',
    'draft', 'America/New_York', 'GBP',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  PERFORM pg_temp.as_user(pg_temp.host());
  SET LOCAL ROLE authenticated;
  PERFORM public.business_update_rsvp_graph(v_event, pg_temp.rsvp_payload(1, 'GBP', 1500, 500), NULL, NULL);
  RESET ROLE;

  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;
  SELECT currency, theme INTO e FROM public.events WHERE id = v_event;
  IF e.currency IS DISTINCT FROM 'NGN'
     OR jsonb_typeof(e.theme#>'{business_draft,rsvpContributionSuggestedCents}') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'R-60 fixture: the RSVP draft was not moved and cleared: % %',
      e.currency, e.theme->'business_draft';
  END IF;

  -- R-61 an older build, or a save already on its way, writes pounds back.
  SET LOCAL ROLE authenticated;
  PERFORM public.business_update_rsvp_graph(v_event, pg_temp.rsvp_payload(2, 'GBP', 1500, 500), NULL, NULL);
  RESET ROLE;
  IF (SELECT currency FROM public.events WHERE id = v_event) IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'R-61 fixture: the write-back did not land';
  END IF;
  v_out := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.business_publish_rsvp_graph(v_event, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_out := SQLERRM;
  END;
  RESET ROLE;
  SELECT status, currency, rsvp_contribution_enabled, rsvp_contribution_suggested_cents INTO e
    FROM public.events WHERE id = v_event;
  IF e.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'R-61 AN RSVP ASKING FOR 15 POUNDS WENT LIVE ON A NAIRA BRAND (% % %)',
      e.status, e.currency, e.rsvp_contribution_suggested_cents;
  END IF;
  IF v_out IS DISTINCT FROM 'price_reentry_required' THEN
    RAISE EXCEPTION 'R-61 Publish answered "%", expected price_reentry_required', v_out;
  END IF;

  -- R-62 the way out clears the amounts in every copy.
  v_out := pg_temp.sync(v_event);
  SELECT currency, theme, rsvp_contribution_suggested_cents AS s, rsvp_contribution_min_cents AS m
    INTO e FROM public.events WHERE id = v_event;
  IF v_out IS DISTINCT FROM 'moved_prices_cleared' OR e.currency IS DISTINCT FROM 'NGN'
     OR e.s IS NOT NULL OR e.m IS NOT NULL
     OR jsonb_typeof(e.theme#>'{business_draft,rsvpContributionSuggestedCents}') IS DISTINCT FROM 'null'
     OR jsonb_typeof(e.theme#>'{business_draft,rsvpContributionMinCents}') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'R-62 after the sync the RSVP is not "naira, no amounts": % % %',
      v_out, e.currency, e.theme->'business_draft';
  END IF;

  -- R-63 new amounts in naira: it publishes with them.
  PERFORM pg_temp.as_user(pg_temp.host());
  SET LOCAL ROLE authenticated;
  PERFORM public.business_update_rsvp_graph(v_event, pg_temp.rsvp_payload(3, 'NGN', 700000, 200000), NULL, NULL);
  PERFORM public.business_publish_rsvp_graph(v_event, gen_random_uuid());
  RESET ROLE;
  SELECT status, currency, rsvp_contribution_suggested_cents AS s, rsvp_contribution_min_cents AS m
    INTO e FROM public.events WHERE id = v_event;
  IF e.status NOT IN ('scheduled', 'live') OR e.currency IS DISTINCT FROM 'NGN'
     OR e.s IS DISTINCT FROM 700000 OR e.m IS DISTINCT FROM 200000 THEN
    RAISE EXCEPTION 'R-63 the re-priced RSVP did not publish in naira with its new amounts: % % % %',
      e.status, e.currency, e.s, e.m;
  END IF;
END
$r6$;

-- ─── R-7x  the stop's own wiring ─────────────────────────────────────────────
DO $r7$
DECLARE
  v_names text[];
BEGIN
  -- BEFORE row triggers on events that fire on a status update, in firing order.
  SELECT array_agg(t.tgname::text ORDER BY t.tgname COLLATE "C") INTO v_names
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.events'::regclass AND NOT t.tgisinternal
     AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16 AND t.tgenabled <> 'D';
  IF array_position(v_names, 'issue_3645_refuse_publish_with_cleared_prices') IS NULL
     OR array_position(v_names, 'trg_require_event_brand_currency_update') IS NULL
     OR array_position(v_names, 'issue_3645_refuse_publish_with_cleared_prices')
        > array_position(v_names, 'trg_require_event_brand_currency_update') THEN
    RAISE EXCEPTION 'R-70 the publish stop does not fire before the currency re-stamp: %', v_names;
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_3645_refuse_publish_with_cleared_prices()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3645_refuse_publish_with_cleared_prices()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3645_drafts_follow_brand_currency()', 'EXECUTE') THEN
    RAISE EXCEPTION 'R-71 a client role can execute a #3645 trigger function';
  END IF;
  -- No function in the API schema lets a client set an arbitrary setting by
  -- name, which is what switching the free-only flag on would need.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND p.prosrc ~* 'set_config\s*\(\s*(p_|_|v_)?[a-z_]*(name|key|setting)[a-z_]*\s*,'
  ) THEN
    RAISE EXCEPTION 'R-72 a function a client can call sets a setting whose name the caller supplies';
  END IF;
END
$r7$;

ROLLBACK;

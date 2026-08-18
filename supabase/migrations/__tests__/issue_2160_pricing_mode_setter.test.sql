-- issue #2160 — THE ORGANISER'S CONTROL, EXECUTED.
--
-- The operator's decision was "the organiser chooses per event". Without a
-- settable column that choice does not exist from the only side that matters,
-- so `biz_set_event_multi_date_pricing_mode` is as load-bearing as the model
-- itself and gets executed proof rather than a source pin.
--
-- WHAT IS PROVED
--   S-1  an authorised organiser can set the mode before any sale
--   S-2  the LOCK is not re-implemented in the setter — the TRIGGER refuses it
--        once a live ticket exists, through this RPC exactly as through a
--        direct UPDATE (one enforcement site, not two)
--   S-3  a refunded-only event may still switch
--   S-4  a no-op re-save on a locked event does NOT error (the trigger's WHEN
--        clause excludes it) — an organiser re-saving an unchanged wizard must
--        not be shown a failure
--   S-5  an invalid mode is refused, and the CHECK constraint would refuse it
--        anyway
--   S-6  a stranger cannot change another brand's pricing, and a SCANNER —
--        who is a brand team member — cannot either
--   S-7  the column default is 'per_day' for a brand-new event, so the
--        no-reprice guarantee holds for anything created after this migration

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.s2160_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2160 pricing-mode-setter FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

-- An event owned by `o_owner`, with a second unrelated user and a scanner.
CREATE OR REPLACE FUNCTION pg_temp.s2160_event(
  p_tag text,
  OUT o_event uuid, OUT o_owner uuid, OUT o_stranger uuid,
  OUT o_scanner uuid, OUT o_ticket_type uuid
) LANGUAGE plpgsql AS $$
DECLARE v_brand uuid := gen_random_uuid();
BEGIN
  o_event := gen_random_uuid();
  o_owner := gen_random_uuid();
  o_stranger := gen_random_uuid();
  o_scanner := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (o_owner), (o_stranger), (o_scanner);
  INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  INSERT INTO public.brands(id, account_id, name, slug)
    VALUES (v_brand, o_owner, 's2160 ' || p_tag, 's2160-' || p_tag || '-' || v_brand);
  -- A brand-scoped SCANNER: a team member, but not an authoring role.
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
    VALUES (v_brand, o_scanner, 'scanner', now());
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status,
                            visibility, timezone, is_multi_date)
    VALUES (o_event, v_brand, 's2160 ' || p_tag, 's2160-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'UTC', true);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '1 day', now() + interval '1 day 6 hours', 'UTC', true),
           (o_event, now() + interval '2 days', now() + interval '2 days 6 hours', 'UTC', false);
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total,
                                  min_purchase_qty, available_online,
                                  available_in_person, display_order)
    VALUES (o_event, 'Entry', 0, true, 50, 1, true, true, 0)
    RETURNING id INTO o_ticket_type;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status='scheduled', visibility='hidden', published_at=now()
   WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
END $$;

-- `auth.uid()` reads request.jwt.claim.sub in this image; set it to act as a user.
CREATE OR REPLACE FUNCTION pg_temp.s2160_act_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.s2160_set(
  p_event uuid, p_mode text, OUT o_error text
) LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.biz_set_event_multi_date_pricing_mode(p_event, p_mode);
  o_error := NULL;
EXCEPTION WHEN OTHERS THEN
  o_error := SQLERRM;
END $$;

DO $$
DECLARE f record; v_err text; v_ticket uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.s2160_event('setter');

  -- S-7 — the default, before anything is touched.
  PERFORM pg_temp.s2160_assert(
    (SELECT multi_date_pricing_mode FROM public.events WHERE id = f.o_event) = 'per_day',
    'S-7 a new event defaults to per_day — the no-reprice guarantee');

  -- S-1 — the organiser sets it.
  PERFORM pg_temp.s2160_act_as(f.o_owner);
  v_err := pg_temp.s2160_set(f.o_event, 'all_days');
  PERFORM pg_temp.s2160_assert(v_err IS NULL,
    'S-1a the organiser can set the mode before any sale (got ' || COALESCE(v_err,'ok') || ')');
  PERFORM pg_temp.s2160_assert(
    (SELECT multi_date_pricing_mode FROM public.events WHERE id = f.o_event) = 'all_days',
    'S-1b and it persisted');

  -- S-5 — an invalid mode is refused before anything is written.
  v_err := pg_temp.s2160_set(f.o_event, 'banana');
  PERFORM pg_temp.s2160_assert(v_err LIKE '%multi_date_pricing_mode_invalid%',
    'S-5a an invalid mode is refused (got ' || COALESCE(v_err,'NO ERROR') || ')');
  PERFORM pg_temp.s2160_assert(
    (SELECT multi_date_pricing_mode FROM public.events WHERE id = f.o_event) = 'all_days',
    'S-5b and the stored mode did not move');

  -- S-6 — permission. A stranger and a SCANNER are both refused.
  PERFORM pg_temp.s2160_act_as(f.o_stranger);
  v_err := pg_temp.s2160_set(f.o_event, 'per_day');
  PERFORM pg_temp.s2160_assert(v_err LIKE '%insufficient_event_permission%',
    'S-6a a stranger cannot change another brand''s pricing (got ' || COALESCE(v_err,'NO ERROR') || ')');

  PERFORM pg_temp.s2160_act_as(f.o_scanner);
  v_err := pg_temp.s2160_set(f.o_event, 'per_day');
  PERFORM pg_temp.s2160_assert(v_err LIKE '%insufficient_event_permission%',
    'S-6b a SCANNER is a team member but still cannot reprice (got ' || COALESCE(v_err,'NO ERROR') || ')');
  PERFORM pg_temp.s2160_assert(
    (SELECT multi_date_pricing_mode FROM public.events WHERE id = f.o_event) = 'all_days',
    'S-6c and neither of them moved it');

  -- ── S-2 — THE LOCK IS THE TRIGGER, NOT A SECOND CHECK IN THE SETTER. ─────
  -- Mint a live ticket the way the roster counts one.
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164,
                            total_cents, currency, payment_method, payment_status,
                            source)
    VALUES (gen_random_uuid(), f.o_event, 'lock@example.com', 'Lock', '+15550003333',
            0, NULL, 'free', 'paid', 'online_checkout')
    RETURNING id INTO v_ticket;
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code,
                             qr_token_hash, status, approval_status)
    -- Unique per run: a fixed qr_code collides with idx_tickets_qr_code on a
    -- SECOND run, and a suite that only passes on a virgin database is not a
    -- suite you can trust.
    VALUES (gen_random_uuid(), v_ticket, f.o_ticket_type, f.o_event,
            'mingla:v1:ticket:' || gen_random_uuid()::text,
            encode(gen_random_bytes(16), 'hex'), 'valid', 'auto');

  PERFORM pg_temp.s2160_act_as(f.o_owner);
  v_err := pg_temp.s2160_set(f.o_event, 'per_day');
  PERFORM pg_temp.s2160_assert(v_err LIKE '%multi_date_pricing_mode_locked%',
    'S-2a the RPC is refused once a live ticket exists (got ' || COALESCE(v_err,'NO ERROR') || ')');

  -- The SAME refusal through a direct UPDATE proves there is ONE enforcement
  -- site: the setter did not re-implement the rule, the trigger owns it.
  BEGIN
    UPDATE public.events SET multi_date_pricing_mode = 'per_day' WHERE id = f.o_event;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM pg_temp.s2160_assert(v_err LIKE '%multi_date_pricing_mode_locked%',
    'S-2b a DIRECT update is refused identically — one enforcement site, not two');

  -- S-4 — a no-op re-save must NOT error. An organiser re-saving an unchanged
  -- wizard on a sold-out event is not trying to change anything.
  v_err := pg_temp.s2160_set(f.o_event, 'all_days');
  PERFORM pg_temp.s2160_assert(v_err IS NULL,
    'S-4 re-saving the UNCHANGED mode on a locked event is not an error (got '
    || COALESCE(v_err,'ok') || ')');

  -- S-3 — a fully refunded event may still switch: a refunded pass is not a
  -- live entitlement, and the predicate is exactly the set capacity treats as
  -- consumed.
  UPDATE public.tickets SET status = 'refunded' WHERE event_id = f.o_event;
  v_err := pg_temp.s2160_set(f.o_event, 'per_day');
  PERFORM pg_temp.s2160_assert(v_err IS NULL,
    'S-3a an event whose only ticket is refunded may still switch (got '
    || COALESCE(v_err,'ok') || ')');
  PERFORM pg_temp.s2160_assert(
    (SELECT multi_date_pricing_mode FROM public.events WHERE id = f.o_event) = 'per_day',
    'S-3b and the switch took effect');

  PERFORM pg_temp.s2160_act_as(NULL);
END $$;

DO $$ BEGIN
  RAISE NOTICE 'issue #2160 pricing-mode-setter suite: ALL CHECKS PASSED';
END $$;

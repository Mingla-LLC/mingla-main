\set ON_ERROR_STOP on
-- #4420 wave 2 (D-S7): the booked-under-another-email page's recovery.
--   R-1 the view shows a non-owner only the mask, the names and the reference;
--   R-2 a resend goes to the booking's OWN address, at most once per 10 min;
--   R-3 nothing to resend (a pending request, an unknown group) is NULL;
--   R-4 guests (anon, authenticated) cannot call either function.
BEGIN;

-- Fixture rows only: FK checks and triggers are skipped inside this rolled-back
-- transaction (CHECK constraints still apply).
SET LOCAL session_replication_role = replica;

INSERT INTO public.brands (id, account_id, name, slug)
VALUES ('44200000-0000-4000-8000-000000000001', '44200000-0000-4000-8000-0000000000a1',
        'Glass Stay Co', 'glass-stay-co-4420');
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category)
VALUES ('44200000-0000-4000-8000-000000000002', '44200000-0000-4000-8000-000000000001',
        'glasshouse4420', 'The Glasshouse', 6.45, 3.4, 'stay');
INSERT INTO public.stay_reservation_groups (
  id, public_reference, quote_id, actor_key_hash, venue_id, brand_id,
  currency_code, mode, state, guest_snapshot,
  source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
  idempotency_key, request_hash, request_deadline
) VALUES
  ('44200000-0000-4000-8000-000000000010', 'ST-4420000000000000000A',
   '44200000-0000-4000-8000-0000000000b1', repeat('a', 64),
   '44200000-0000-4000-8000-000000000002', '44200000-0000-4000-8000-000000000001',
   'USD', 'instant', 'confirmed',
   '{"name":"Ada","email":"ada.owner@example.com"}'::jsonb,
   82500, 0, 0, 82500, 'issue-4420-recovery-confirmed', repeat('b', 64), NULL),
  ('44200000-0000-4000-8000-000000000011', 'ST-4420000000000000000B',
   '44200000-0000-4000-8000-0000000000b2', repeat('c', 64),
   '44200000-0000-4000-8000-000000000002', '44200000-0000-4000-8000-000000000001',
   'USD', 'request', 'request_pending',
   '{"name":"Bo","email":"bo.owner@example.com"}'::jsonb,
   27500, 0, 0, 27500, 'issue-4420-recovery-pending', repeat('d', 64),
   pg_catalog.now() + interval '1 day');

SET LOCAL session_replication_role = origin;
SET LOCAL ROLE service_role;

DO $$
DECLARE
  v jsonb := public.issue_4420_stay_group_other_contact_view('44200000-0000-4000-8000-000000000010');
BEGIN
  -- R-1
  IF v->>'masked_email' <> 'a•••@example.com' THEN
    RAISE EXCEPTION 'view: expected the mask, got %', v->>'masked_email';
  END IF;
  IF v->>'venue_name' <> 'The Glasshouse' OR v->>'brand_slug' <> 'glass-stay-co-4420'
     OR v->>'brand_name' <> 'Glass Stay Co' OR v->>'public_reference' <> 'ST-4420000000000000000A' THEN
    RAISE EXCEPTION 'view: names and reference wrong: %', v;
  END IF;
  IF (v->>'resendable')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'view: a confirmed booking is resendable';
  END IF;
  IF v::text LIKE '%ada.owner%' OR v ? 'total_minor' OR v ? 'guest_snapshot' THEN
    RAISE EXCEPTION 'view: must never carry the full address or the booking details: %', v;
  END IF;
END $$;

DO $$
DECLARE
  v_first text := public.issue_4420_stay_group_resend_link('44200000-0000-4000-8000-000000000010');
  v_second text := public.issue_4420_stay_group_resend_link('44200000-0000-4000-8000-000000000010');
  v_rows int;
  v_contact text;
  v_country text;
BEGIN
  -- R-2
  IF v_first <> 'a•••@example.com' OR v_second <> 'a•••@example.com' THEN
    RAISE EXCEPTION 'resend: returns the mask (got %, %)', v_first, v_second;
  END IF;
  SELECT count(*), min(contact), min(country_code) INTO v_rows, v_contact, v_country
  FROM public.notification_outbox
  WHERE idempotency_key LIKE 'stay:44200000-0000-4000-8000-000000000010:%:resend:%';
  -- #1529: the email-only resend writes an explicit NULL country.
  IF v_country IS NOT NULL THEN
    RAISE EXCEPTION 'resend: an email row carries no country, got %', v_country;
  END IF;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'resend: two taps in ten minutes queue ONE email, got %', v_rows;
  END IF;
  IF v_contact <> 'ada.owner@example.com' THEN
    RAISE EXCEPTION 'resend: goes to the booking''s own address, got %', v_contact;
  END IF;
  -- R-3
  IF public.issue_4420_stay_group_resend_link('44200000-0000-4000-8000-000000000011') IS NOT NULL THEN
    RAISE EXCEPTION 'resend: a pending request has nothing to resend';
  END IF;
  IF public.issue_4420_stay_group_resend_link('00000000-0000-4000-8000-000000004420') IS NOT NULL
     OR public.issue_4420_stay_group_other_contact_view('00000000-0000-4000-8000-000000004420') IS NOT NULL THEN
    RAISE EXCEPTION 'an unknown group returns NULL';
  END IF;
END $$;
RESET ROLE;

-- R-4
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.issue_4420_stay_group_other_contact_view(uuid)',
    'public.issue_4420_stay_group_resend_link(uuid)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% must not be executable by guests', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be executable by the service role', f;
    END IF;
  END LOOP;
END $$;

ROLLBACK;

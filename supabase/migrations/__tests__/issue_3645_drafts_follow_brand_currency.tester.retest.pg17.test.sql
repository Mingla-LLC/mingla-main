\set ON_ERROR_STOP on

-- Issue #3645 — tester RETEST of the rework of "an unpublished draft with
-- nothing sold follows its brand's currency" (20270829003645). Run after the
-- full migration chain on PostgreSQL 17.
--
-- The first tester pass failed the change on two database paths. This suite
-- attacks the rework of both, from angles the implementor's rework suite does
-- not take.
--
--   TWO WRITES (X -> none -> Y). Leaving Nigeria clears the currency and then
--   sets the new one. Proven here:
--     T-1x  NGN -> none -> USD clears event ticket prices, RSVP chip-ins and a
--           trip package, in every copy, and leaves the notice naming NGN.
--     T-2x  drafts created and priced WHILE the brand had no currency are not
--           wiped by the write that follows, although the brand's older drafts
--           are; a trip cannot be priced in that window at all.
--     T-3x  none -> NGN on a brand that never had a currency keeps everything.
--     T-4x  NGN -> none -> NGN keeps everything and uses up what was remembered.
--     T-5x  none written twice, and an unrelated write in between, change
--           nothing; the change still clears.
--     T-6x  two brands interleaved never read each other's remembered currency.
--     T-7x  the Stripe account mirror setting the new currency after the clear
--           clears prices like any other writer.
--     T-8x  the remembered currency is not a client surface (no read, no
--           write, for anon or a signed-in host) and goes with its brand.
--
--   A CLEARED TRIP PACKAGE AND THE OLD NUMBER. Each case runs as the signed-in
--   host (role authenticated), calls the real draft owner
--   `biz_apply_trip_draft_graph`, and then forces the commit-time check:
--     S-1x  the old number with the marker, the old number with NO metadata at
--           all (an older build), a NEW package carrying a marker and a price,
--           and a marker that is not the server's shape: all refused, nothing
--           left behind.
--     S-2x  a new number with the marker left out, and 0 with the marker left
--           out, are saved.
--     S-3x  0 with the marker kept is saved but still cannot publish.
--     S-4x  what the refusal does NOT touch: an ordinary ticket price change on
--           an event, and a price change on a trip package that was never
--           cleared, as the same signed-in host.
--     S-5x  the shape the first tester suite's P-10 wrote (a marker put on a
--           priced package by a direct write) is now refused when it would be
--           committed.
--
-- The committed-transaction replay of S-1x..S-3x (separate psql invocations,
-- each statement its own transaction, followed by Publish) is recorded on the
-- issue; inside one transaction the same check is reached with
-- SET CONSTRAINTS ALL IMMEDIATE.
--
-- NULL-safety: comparisons whose left side can be NULL use IS DISTINCT FROM.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '3645be7e-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id) VALUES ('3645be7e-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('3645be7e-0000-4000-8000-000000000001');

-- a: naira, leaves Nigeria in two writes for dollars.
-- b: never had a currency, takes naira.
-- c: naira -> none -> naira.
-- d: naira -> none (twice, with an unrelated write) -> euros.
-- f, g: interleaved. f pounds -> none -> euros; g naira -> none -> dollars.
-- h: naira -> none, then the Stripe account mirror sets pounds.
-- z: naira -> none; holds a remembered currency for the client-access checks.
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('3645be7e-0000-4000-8000-00000000000a', '3645be7e-0000-4000-8000-000000000001', 'R3645 a', 'r3645-rt-a', 'NGN'),
  ('3645be7e-0000-4000-8000-00000000000b', '3645be7e-0000-4000-8000-000000000001', 'R3645 b', 'r3645-rt-b', NULL),
  ('3645be7e-0000-4000-8000-00000000000c', '3645be7e-0000-4000-8000-000000000001', 'R3645 c', 'r3645-rt-c', 'NGN'),
  ('3645be7e-0000-4000-8000-00000000000d', '3645be7e-0000-4000-8000-000000000001', 'R3645 d', 'r3645-rt-d', 'NGN'),
  ('3645be7e-0000-4000-8000-00000000000f', '3645be7e-0000-4000-8000-000000000001', 'R3645 f', 'r3645-rt-f', 'GBP'),
  ('3645be7e-0000-4000-8000-000000000009', '3645be7e-0000-4000-8000-000000000001', 'R3645 g', 'r3645-rt-g', 'NGN'),
  ('3645be7e-0000-4000-8000-000000000008', '3645be7e-0000-4000-8000-000000000001', 'R3645 h', 'r3645-rt-h', 'NGN');

CREATE FUNCTION pg_temp.iso(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')
$$;

CREATE FUNCTION pg_temp.rev(p_event uuid) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT updated_at FROM public.events WHERE id = p_event $$;

-- One paid ticket (with the all-in copy), one free ticket.
CREATE FUNCTION pg_temp.tickets(p_price numeric) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('id', 't_paid', 'name', 'General', 'priceGbp', p_price,
      'priceAllInGbp', p_price + 2.25, 'isFree', false, 'capacity', 100, 'displayOrder', 0),
    jsonb_build_object('id', 't_free', 'name', 'Community', 'priceGbp', NULL,
      'isFree', true, 'capacity', 20, 'displayOrder', 1))
$$;

CREATE FUNCTION pg_temp.draft(
  p_id uuid, p_brand uuid, p_type text, p_currency text, p_draft jsonb,
  p_suggested integer DEFAULT NULL, p_min integer DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status,
    visibility, timezone, currency, theme,
    rsvp_contribution_suggested_cents, rsvp_contribution_min_cents)
  VALUES (p_id, p_brand, '3645be7e-0000-4000-8000-000000000001', 'R3645 ' || p_type,
    'r3645-rt-' || p_id, p_type, 'draft', 'draft', 'Africa/Lagos', p_currency,
    jsonb_build_object('coverHue', 25, 'business_draft',
      p_draft || jsonb_build_object('clientRevision', 0)
        || CASE WHEN p_currency IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('currency', p_currency) END),
    p_suggested, p_min)
$$;

CREATE FUNCTION pg_temp.rsvp_json(p_suggested integer, p_min integer) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
    'rsvpContributionEnabled', true,
    'rsvpContributionSuggestedCents', p_suggested, 'rsvpContributionMinCents', p_min)
$$;

-- A trip draft built through the real owners. p_price NULL = leave it unpriced.
CREATE FUNCTION pg_temp.trip(p_brand uuid, p_op text, p_price integer)
RETURNS uuid LANGUAGE plpgsql AS $trip$
DECLARE
  g jsonb;
  v_event uuid;
  v_standard uuid;
BEGIN
  g := public.biz_create_trip_draft(p_brand, jsonb_build_object('title', 'Untitled trip'),
    (p_op || '1')::uuid);
  v_event := (g#>>'{event,id}')::uuid;
  v_standard := (g#>>'{tiers,0,ticket_type_id}')::uuid;
  IF v_event IS NULL OR v_standard IS NULL THEN
    RAISE EXCEPTION 'fixture: trip create returned no event or no package';
  END IF;
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object(
      'event', jsonb_build_object(
        'title', 'Accra long weekend',
        'business_trip', jsonb_build_object(
          'startAt', pg_temp.iso(date_trunc('second', now() + interval '60 days')),
          'endAt', pg_temp.iso(date_trunc('second', now() + interval '63 days')),
          'destinationLocationText', 'Accra, Ghana')),
      'days', jsonb_build_array(jsonb_build_object('ordinal', 1, 'title', 'Arrival'))),
    pg_temp.rev(v_event), (p_op || '2')::uuid);
  IF p_price IS NOT NULL THEN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_standard, 'tier_name', 'Standard', 'price_cents', p_price,
        'capacity', 12,
        'tier_metadata', jsonb_build_object(
          'description', 'Shared room',
          'installments', jsonb_build_object(
            'deposit_pct', 25,
            'installments', jsonb_build_array(jsonb_build_object(
              'ordinal', 1, 'pct', 75, 'days_after_booking', 30))))))),
      pg_temp.rev(v_event), (p_op || '3')::uuid);
  END IF;
  RETURN v_event;
END
$trip$;

-- What a draft looks like, in one row, for the assertions below.
CREATE FUNCTION pg_temp.look(p_event uuid) RETURNS TABLE(
  currency text, json_currency text, paid_price text, all_in text, free_is_free text,
  note jsonb, suggested integer, minimum integer, json_suggested text)
LANGUAGE sql AS $$
  SELECT e.currency::text,
         e.theme#>>'{business_draft,currency}',
         jsonb_typeof(e.theme#>'{business_draft,tickets,0,priceGbp}') || ':' ||
           COALESCE(e.theme#>>'{business_draft,tickets,0,priceGbp}', ''),
         jsonb_typeof(e.theme#>'{business_draft,tickets,0,priceAllInGbp}'),
         e.theme#>>'{business_draft,tickets,1,isFree}',
         e.theme#>'{business_draft,pricesClearedForCurrencyChange}',
         e.rsvp_contribution_suggested_cents, e.rsvp_contribution_min_cents,
         jsonb_typeof(e.theme#>'{business_draft,rsvpContributionSuggestedCents}')
    FROM public.events e WHERE e.id = p_event
$$;

CREATE TEMP TABLE r3645_ids(name text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;

-- ─── Fixtures ────────────────────────────────────────────────────────────────
DO $fixtures$
DECLARE
  v_a uuid := '3645be7e-0000-4000-8000-00000000000a';
  v_b uuid := '3645be7e-0000-4000-8000-00000000000b';
  v_c uuid := '3645be7e-0000-4000-8000-00000000000c';
  v_d uuid := '3645be7e-0000-4000-8000-00000000000d';
  v_f uuid := '3645be7e-0000-4000-8000-00000000000f';
  v_g uuid := '3645be7e-0000-4000-8000-000000000009';
  v_h uuid := '3645be7e-0000-4000-8000-000000000008';
BEGIN
  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-0000000000a1', v_a, 'event', 'NGN',
    jsonb_build_object('tickets', pg_temp.tickets(5000)));
  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-0000000000a2', v_a, 'rsvp', 'NGN',
    pg_temp.rsvp_json(150000, 50000), 150000, 50000);
  INSERT INTO r3645_ids VALUES
    ('trip_a', pg_temp.trip(v_a, '3645be7e-0000-4000-8000-0000000001a', 4500000));

  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-0000000000b1', v_b, 'event', NULL,
    jsonb_build_object('tickets', pg_temp.tickets(40)));
  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-0000000000b2', v_b, 'rsvp', NULL,
    pg_temp.rsvp_json(1500, 500), 1500, 500);

  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-0000000000c1', v_c, 'event', 'NGN',
    jsonb_build_object('tickets', pg_temp.tickets(5000)));
  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-0000000000c2', v_c, 'rsvp', 'NGN',
    pg_temp.rsvp_json(150000, 50000), 150000, 50000);
  INSERT INTO r3645_ids VALUES
    ('trip_c', pg_temp.trip(v_c, '3645be7e-0000-4000-8000-0000000001c', 4500000));

  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-0000000000d1', v_d, 'event', 'NGN',
    jsonb_build_object('tickets', pg_temp.tickets(5000)));
  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-0000000000f1', v_f, 'event', 'GBP',
    jsonb_build_object('tickets', pg_temp.tickets(50)));
  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-000000000091', v_g, 'event', 'NGN',
    jsonb_build_object('tickets', pg_temp.tickets(5000)));
  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-000000000081', v_h, 'event', 'NGN',
    jsonb_build_object('tickets', pg_temp.tickets(5000)));
END
$fixtures$;

-- ─── 1. NGN -> none -> USD, with drafts created in between ───────────────────
UPDATE public.brands SET default_currency = NULL
 WHERE id = '3645be7e-0000-4000-8000-00000000000a';

DO $between$
DECLARE
  v_a uuid := '3645be7e-0000-4000-8000-00000000000a';
  l record;
  v_trip uuid;
  v_refused boolean := false;
BEGIN
  -- T-10 losing the currency moves nothing and clears nothing.
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-0000000000a1');
  IF l.currency IS DISTINCT FROM 'NGN' OR l.paid_price IS DISTINCT FROM 'number:5000'
     OR l.note IS NOT NULL THEN
    RAISE EXCEPTION 'T-10 losing the currency touched a draft: % / % / %', l.currency, l.paid_price, l.note;
  END IF;
  IF (SELECT m.currency FROM public.brand_cleared_currency m WHERE m.brand_id = v_a)
       IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'T-11 the outgoing currency was not remembered';
  END IF;

  -- Days later: the host, still with no currency, starts NEW drafts and types
  -- prices into them. The screen says "Currency not set"; the rows carry none.
  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-0000000000a5', v_a, 'event', NULL,
    jsonb_build_object('tickets', pg_temp.tickets(80)));
  PERFORM pg_temp.draft('3645be7e-0000-4000-8000-0000000000a6', v_a, 'rsvp', NULL,
    pg_temp.rsvp_json(2000, 700), 2000, 700);

  -- T-20 a trip started in that window cannot hold a price at all, so there
  -- is no new trip price for the next write to get wrong.
  v_trip := pg_temp.trip(v_a, '3645be7e-0000-4000-8000-0000000002a', NULL);
  INSERT INTO r3645_ids VALUES ('trip_a_new', v_trip);
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_trip,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', (SELECT ticket_type_id FROM public.trip_pricing_tiers WHERE event_id = v_trip),
        'tier_name', 'Standard', 'price_cents', 80000, 'capacity', 12))),
      pg_temp.rev(v_trip), '3645be7e-0000-4000-8000-0000000002a9');
  EXCEPTION WHEN OTHERS THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'T-20 a trip on a brand with no currency took a price; the next currency write would have to guess what it meant';
  END IF;
END
$between$;

UPDATE public.brands SET default_currency = 'USD'
 WHERE id = '3645be7e-0000-4000-8000-00000000000a';

DO $two_writes$
DECLARE
  v_a uuid := '3645be7e-0000-4000-8000-00000000000a';
  l record;
  t record;
  v_meta jsonb;
  v_trip uuid;
  v_want jsonb := jsonb_build_object('from', 'NGN', 'to', 'USD');
BEGIN
  -- T-12 the OLD event draft: every copy in dollars, both copies of the paid
  -- price cleared, free still free, and the notice names naira.
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-0000000000a1');
  IF l.currency IS DISTINCT FROM 'USD' OR l.json_currency IS DISTINCT FROM 'USD' THEN
    RAISE EXCEPTION 'T-12 the old event draft did not move to USD: % / %', l.currency, l.json_currency;
  END IF;
  IF l.paid_price IS DISTINCT FROM 'null:' OR l.all_in IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'T-12 a naira ticket price survived a two-write change as dollars: % / all-in %', l.paid_price, l.all_in;
  END IF;
  IF l.free_is_free IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'T-12 the free ticket is no longer free';
  END IF;
  IF l.note IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'T-12 the notice is %, expected %', l.note, v_want;
  END IF;

  -- T-13 the OLD RSVP draft: chip-ins cleared in the columns and the JSON.
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-0000000000a2');
  IF l.currency IS DISTINCT FROM 'USD' OR l.suggested IS NOT NULL OR l.minimum IS NOT NULL
     OR l.json_suggested IS DISTINCT FROM 'null' OR l.note IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'T-13 naira chip-in amounts survived as dollars: % % % % %',
      l.currency, l.suggested, l.minimum, l.json_suggested, l.note;
  END IF;

  -- T-14 the OLD trip: price 0, not free by choice, marked, plan untouched.
  SELECT id INTO v_trip FROM r3645_ids WHERE name = 'trip_a';
  SELECT tt.* INTO t FROM public.ticket_types tt
   WHERE tt.event_id = v_trip AND tt.deleted_at IS NULL;
  SELECT tpt.tier_metadata INTO v_meta FROM public.trip_pricing_tiers tpt
   WHERE tpt.ticket_type_id = t.id;
  IF t.price_cents IS DISTINCT FROM 0 OR t.currency IS DISTINCT FROM 'USD'
     OR t.is_free IS DISTINCT FROM false
     OR v_meta->'price_cleared_for_currency_change' IS DISTINCT FROM v_want
     OR v_meta#>>'{installments,deposit_pct}' IS DISTINCT FROM '25' THEN
    RAISE EXCEPTION 'T-14 the old trip package after a two-write change: price=% currency=% free=% meta=%',
      t.price_cents, t.currency, t.is_free, v_meta;
  END IF;

  -- T-21 the NEW event draft, priced while the brand had no currency: stamped,
  -- every typed number kept, no notice.
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-0000000000a5');
  IF l.currency IS DISTINCT FROM 'USD' OR l.json_currency IS DISTINCT FROM 'USD' THEN
    RAISE EXCEPTION 'T-21 the new draft was not stamped USD: % / %', l.currency, l.json_currency;
  END IF;
  IF l.paid_price IS DISTINCT FROM 'number:80' OR l.all_in IS DISTINCT FROM 'number'
     OR l.note IS NOT NULL THEN
    RAISE EXCEPTION 'T-21 a price typed while the brand had NO currency was wiped because the brand once had one: % / all-in % / note %',
      l.paid_price, l.all_in, l.note;
  END IF;

  -- T-22 the NEW RSVP draft: chip-ins kept.
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-0000000000a6');
  IF l.currency IS DISTINCT FROM 'USD' OR l.suggested IS DISTINCT FROM 2000
     OR l.minimum IS DISTINCT FROM 700 OR l.json_suggested IS DISTINCT FROM 'number'
     OR l.note IS NOT NULL THEN
    RAISE EXCEPTION 'T-22 chip-ins typed while the brand had NO currency were wiped: % % % % %',
      l.currency, l.suggested, l.minimum, l.json_suggested, l.note;
  END IF;

  -- T-23 the NEW (unpriced) trip: stamped, not marked.
  SELECT id INTO v_trip FROM r3645_ids WHERE name = 'trip_a_new';
  IF (SELECT count(*) FROM public.ticket_types tt
        JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
       WHERE tt.event_id = v_trip AND tt.currency = 'USD'
         AND NOT (COALESCE(tpt.tier_metadata, '{}'::jsonb) ? 'price_cleared_for_currency_change')) <> 1 THEN
    RAISE EXCEPTION 'T-23 a trip that never had a price was marked "price cleared", or not stamped';
  END IF;

  -- T-15 what was remembered is used up.
  IF EXISTS (SELECT 1 FROM public.brand_cleared_currency m WHERE m.brand_id = v_a) THEN
    RAISE EXCEPTION 'T-15 the remembered currency outlived the write that used it';
  END IF;
END
$two_writes$;

-- ─── 3. A brand that never had a currency ────────────────────────────────────
UPDATE public.brands SET default_currency = 'NGN'
 WHERE id = '3645be7e-0000-4000-8000-00000000000b';

DO $first$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-0000000000b1');
  IF l.currency IS DISTINCT FROM 'NGN' OR l.paid_price IS DISTINCT FROM 'number:40'
     OR l.all_in IS DISTINCT FROM 'number' OR l.note IS NOT NULL THEN
    RAISE EXCEPTION 'T-30 a first currency cleared or failed to stamp an event draft: % % % %',
      l.currency, l.paid_price, l.all_in, l.note;
  END IF;
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-0000000000b2');
  IF l.currency IS DISTINCT FROM 'NGN' OR l.suggested IS DISTINCT FROM 1500
     OR l.minimum IS DISTINCT FROM 500 OR l.note IS NOT NULL THEN
    RAISE EXCEPTION 'T-31 a first currency cleared RSVP chip-ins: % % % %',
      l.currency, l.suggested, l.minimum, l.note;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_cleared_currency m
              WHERE m.brand_id = '3645be7e-0000-4000-8000-00000000000b') THEN
    RAISE EXCEPTION 'T-32 a brand that never lost a currency has one remembered';
  END IF;
END
$first$;

-- ─── 4. NGN -> none -> NGN ───────────────────────────────────────────────────
CREATE TEMP TABLE r3645_c_before ON COMMIT DROP AS
  SELECT e.id, e.currency, e.theme, e.rsvp_contribution_suggested_cents AS s,
         e.rsvp_contribution_min_cents AS m, e.updated_at
    FROM public.events e WHERE e.brand_id = '3645be7e-0000-4000-8000-00000000000c';

UPDATE public.brands SET default_currency = NULL
 WHERE id = '3645be7e-0000-4000-8000-00000000000c';
UPDATE public.brands SET default_currency = 'NGN'
 WHERE id = '3645be7e-0000-4000-8000-00000000000c';

DO $same$
DECLARE
  v_changed integer;
  v_trip uuid;
BEGIN
  SELECT count(*) INTO v_changed
    FROM public.events e JOIN r3645_c_before b ON b.id = e.id
   WHERE e.currency IS DISTINCT FROM b.currency OR e.theme IS DISTINCT FROM b.theme
      OR e.rsvp_contribution_suggested_cents IS DISTINCT FROM b.s
      OR e.rsvp_contribution_min_cents IS DISTINCT FROM b.m
      OR e.updated_at IS DISTINCT FROM b.updated_at;
  IF v_changed <> 0 THEN
    RAISE EXCEPTION 'T-40 coming back to the same currency rewrote % draft(s)', v_changed;
  END IF;
  SELECT id INTO v_trip FROM r3645_ids WHERE name = 'trip_c';
  IF (SELECT count(*) FROM public.ticket_types tt
        JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
       WHERE tt.event_id = v_trip AND tt.price_cents = 4500000 AND tt.currency = 'NGN'
         AND NOT (tpt.tier_metadata ? 'price_cleared_for_currency_change')) <> 1 THEN
    RAISE EXCEPTION 'T-41 coming back to the same currency cleared or marked a trip package';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_cleared_currency m
              WHERE m.brand_id = '3645be7e-0000-4000-8000-00000000000c') THEN
    RAISE EXCEPTION 'T-42 the remembered currency was not used up by the write that set a currency';
  END IF;
END
$same$;

-- T-43 and the memory really is gone: the same brand now takes a DIFFERENT
-- currency directly; the from-currency in the notice is the one replaced.
UPDATE public.brands SET default_currency = 'GBP'
 WHERE id = '3645be7e-0000-4000-8000-00000000000c';
DO $after_same$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-0000000000c1');
  IF l.currency IS DISTINCT FROM 'GBP' OR l.paid_price IS DISTINCT FROM 'null:'
     OR l.note IS DISTINCT FROM jsonb_build_object('from', 'NGN', 'to', 'GBP') THEN
    RAISE EXCEPTION 'T-43 a direct change after a round trip: % % %', l.currency, l.paid_price, l.note;
  END IF;
END
$after_same$;

-- ─── 5. none written twice, with an unrelated write in between ───────────────
UPDATE public.brands SET default_currency = NULL
 WHERE id = '3645be7e-0000-4000-8000-00000000000d';
UPDATE public.brands SET default_currency = NULL, name = 'R3645 d renamed'
 WHERE id = '3645be7e-0000-4000-8000-00000000000d';
UPDATE public.brands SET name = 'R3645 d renamed again'
 WHERE id = '3645be7e-0000-4000-8000-00000000000d';
UPDATE public.brands SET default_currency = '   '
 WHERE id = '3645be7e-0000-4000-8000-00000000000d';

DO $twice$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-0000000000d1');
  IF l.currency IS DISTINCT FROM 'NGN' OR l.paid_price IS DISTINCT FROM 'number:5000' THEN
    RAISE EXCEPTION 'T-50 writing "no currency" again touched a draft: % %', l.currency, l.paid_price;
  END IF;
  -- T-51 a blank written over "none" must not replace NGN with nothing.
  IF (SELECT m.currency FROM public.brand_cleared_currency m
       WHERE m.brand_id = '3645be7e-0000-4000-8000-00000000000d') IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'T-51 writing "no currency" twice lost what was remembered: %',
      (SELECT m.currency FROM public.brand_cleared_currency m
        WHERE m.brand_id = '3645be7e-0000-4000-8000-00000000000d');
  END IF;
END
$twice$;

UPDATE public.brands SET default_currency = 'EUR'
 WHERE id = '3645be7e-0000-4000-8000-00000000000d';

DO $twice_then$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-0000000000d1');
  IF l.currency IS DISTINCT FROM 'EUR' OR l.paid_price IS DISTINCT FROM 'null:'
     OR l.note IS DISTINCT FROM jsonb_build_object('from', 'NGN', 'to', 'EUR') THEN
    RAISE EXCEPTION 'T-52 NGN -> none -> none -> EUR kept a naira price as euros: % % %',
      l.currency, l.paid_price, l.note;
  END IF;
END
$twice_then$;

-- ─── 6. Two brands interleaved ───────────────────────────────────────────────
UPDATE public.brands SET default_currency = NULL WHERE id = '3645be7e-0000-4000-8000-00000000000f';
UPDATE public.brands SET default_currency = NULL WHERE id = '3645be7e-0000-4000-8000-000000000009';
UPDATE public.brands SET default_currency = 'USD' WHERE id = '3645be7e-0000-4000-8000-000000000009';

DO $interleaved_mid$
BEGIN
  -- g used its own memory and left f's alone.
  IF (SELECT m.currency FROM public.brand_cleared_currency m
       WHERE m.brand_id = '3645be7e-0000-4000-8000-00000000000f') IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'T-60 one brand''s change used up another brand''s remembered currency';
  END IF;
  IF (SELECT currency FROM public.events WHERE id = '3645be7e-0000-4000-8000-0000000000f1')
       IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'T-61 one brand''s change moved another brand''s draft';
  END IF;
END
$interleaved_mid$;

UPDATE public.brands SET default_currency = 'EUR' WHERE id = '3645be7e-0000-4000-8000-00000000000f';

DO $interleaved$
DECLARE
  l record;
BEGIN
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-000000000091');
  IF l.currency IS DISTINCT FROM 'USD' OR l.paid_price IS DISTINCT FROM 'null:'
     OR l.note IS DISTINCT FROM jsonb_build_object('from', 'NGN', 'to', 'USD') THEN
    RAISE EXCEPTION 'T-62 brand g: % % %', l.currency, l.paid_price, l.note;
  END IF;
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-0000000000f1');
  IF l.currency IS DISTINCT FROM 'EUR' OR l.paid_price IS DISTINCT FROM 'null:'
     OR l.note IS DISTINCT FROM jsonb_build_object('from', 'GBP', 'to', 'EUR') THEN
    RAISE EXCEPTION 'T-63 brand f: % % %', l.currency, l.paid_price, l.note;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_cleared_currency m
              WHERE m.brand_id IN ('3645be7e-0000-4000-8000-00000000000f',
                                   '3645be7e-0000-4000-8000-000000000009')) THEN
    RAISE EXCEPTION 'T-64 a remembered currency was left behind';
  END IF;
END
$interleaved$;

-- ─── 7. The Stripe account mirror sets the new currency after the clear ──────
UPDATE public.brands SET default_currency = NULL WHERE id = '3645be7e-0000-4000-8000-000000000008';
INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
VALUES ('3645be7e-0000-4000-8000-000000000008', 'acct_r3645_retest_h', 'GB', 'gbp');

DO $mirror$
DECLARE
  l record;
BEGIN
  IF (SELECT default_currency FROM public.brands
       WHERE id = '3645be7e-0000-4000-8000-000000000008') IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'T-70 fixture: the Stripe account mirror did not set the brand''s currency';
  END IF;
  SELECT * INTO l FROM pg_temp.look('3645be7e-0000-4000-8000-000000000081');
  IF l.currency IS DISTINCT FROM 'GBP' OR l.paid_price IS DISTINCT FROM 'null:'
     OR l.note IS DISTINCT FROM jsonb_build_object('from', 'NGN', 'to', 'GBP') THEN
    RAISE EXCEPTION 'T-71 a currency set by the Stripe account mirror after the clear kept a naira price as pounds: % % %',
      l.currency, l.paid_price, l.note;
  END IF;
END
$mirror$;

-- ─── 8. The remembered currency is not a client surface ──────────────────────
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('3645be7e-0000-4000-8000-0000000000e0', '3645be7e-0000-4000-8000-000000000001', 'R3645 z', 'r3645-rt-z', 'NGN');
UPDATE public.brands SET default_currency = NULL WHERE id = '3645be7e-0000-4000-8000-0000000000e0';

DO $surface$
DECLARE
  v_role text;
  v_stmt text;
  v_refused boolean;
BEGIN
  IF (SELECT count(*) FROM public.brand_cleared_currency
       WHERE brand_id = '3645be7e-0000-4000-8000-0000000000e0') <> 1 THEN
    RAISE EXCEPTION 'T-80 fixture: nothing remembered for brand z';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c
           WHERE c.oid = 'public.brand_cleared_currency'::regclass) THEN
    RAISE EXCEPTION 'T-81 row level security is off on brand_cleared_currency';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'brand_cleared_currency') THEN
    RAISE EXCEPTION 'T-82 brand_cleared_currency has a policy; it must have none';
  END IF;

  -- The owner of the brand, signed in, and a signed-out visitor: every verb
  -- is refused outright. (Not "returns no rows": refused.)
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    FOREACH v_stmt IN ARRAY ARRAY[
      'SELECT count(*) FROM public.brand_cleared_currency',
      'INSERT INTO public.brand_cleared_currency(brand_id, currency) VALUES (''3645be7e-0000-4000-8000-00000000000b'', ''GBP'')',
      'UPDATE public.brand_cleared_currency SET currency = ''GBP''',
      'DELETE FROM public.brand_cleared_currency'
    ] LOOP
      v_refused := false;
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', v_role);
        EXECUTE v_stmt;
      EXCEPTION WHEN insufficient_privilege THEN
        v_refused := true;
      END;
      RESET ROLE;
      IF NOT v_refused THEN
        RAISE EXCEPTION 'T-83 role % was allowed to run: %', v_role, v_stmt;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT m.currency FROM public.brand_cleared_currency m
       WHERE m.brand_id = '3645be7e-0000-4000-8000-0000000000e0') IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'T-84 a refused client write changed what was remembered';
  END IF;

  -- T-85 it goes with its brand: the row is tied to the brand with ON DELETE
  -- CASCADE. (A brand row cannot be hard-deleted from a test: the team-member
  -- removal guard refuses it. Brands are soft-deleted in the product.)
  IF (SELECT c.confdeltype FROM pg_constraint c
       WHERE c.conrelid = 'public.brand_cleared_currency'::regclass AND c.contype = 'f'
         AND c.confrelid = 'public.brands'::regclass) IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION 'T-85 brand_cleared_currency is not tied to its brand with ON DELETE CASCADE';
  END IF;
END
$surface$;

-- ─── 9. A cleared trip package and the old number, as the signed-in host ─────
-- pg_temp.save: one draft save as role authenticated, then the commit-time
-- check. Returns '' when the save would commit, else the refusal.
CREATE FUNCTION pg_temp.save_as_host(p_event uuid, p_tier jsonb) RETURNS text
LANGUAGE plpgsql AS $save$
DECLARE
  v_rev timestamptz := pg_temp.rev(p_event);
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.biz_apply_trip_draft_graph(
      p_event, jsonb_build_object('tiers', jsonb_build_array(p_tier)), v_rev, gen_random_uuid());
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    -- The sub-transaction is rolled back: nothing of this save remains.
    SET CONSTRAINTS ALL DEFERRED;
    RESET ROLE;
    RETURN SQLERRM;
  END;
  RETURN '';
END
$save$;

CREATE FUNCTION pg_temp.package(p_event uuid) RETURNS TABLE(
  id uuid, price integer, is_free boolean, marked boolean, meta jsonb, packages bigint)
LANGUAGE sql AS $$
  SELECT tt.id, tt.price_cents, tt.is_free,
         COALESCE(tpt.tier_metadata, '{}'::jsonb) ? 'price_cleared_for_currency_change',
         tpt.tier_metadata,
         (SELECT count(*) FROM public.ticket_types x WHERE x.event_id = p_event AND x.deleted_at IS NULL)
    FROM public.ticket_types tt
    JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
   WHERE tt.event_id = p_event AND tt.deleted_at IS NULL
   ORDER BY tt.created_at LIMIT 1
$$;

DO $stale$
DECLARE
  v_a uuid := '3645be7e-0000-4000-8000-00000000000a';
  v_owner uuid := '3645be7e-0000-4000-8000-000000000001';
  v_trip uuid;
  p record;
  v_marker jsonb;
  v_clean jsonb;
  v_out text;
  v_case text;
  v_tier jsonb;
  v_status text;
  v_event_tt uuid;
BEGIN
  SELECT id INTO v_trip FROM r3645_ids WHERE name = 'trip_a';
  SELECT * INTO p FROM pg_temp.package(v_trip);
  IF p.price IS DISTINCT FROM 0 OR NOT p.marked THEN
    RAISE EXCEPTION 'S-00 fixture: trip_a is not a cleared package: % %', p.price, p.meta;
  END IF;
  v_marker := p.meta;
  v_clean := p.meta - 'price_cleared_for_currency_change';

  -- S-1x every way the OLD number can arrive is refused, and leaves nothing.
  FOR v_case, v_tier IN
    SELECT * FROM (VALUES
      ('S-10 the old number with the marker (a form left open)',
        jsonb_build_object('ticket_type_id', p.id, 'tier_name', 'Standard',
          'price_cents', 4500000, 'capacity', 12, 'tier_metadata', v_marker)),
      ('S-11 the old number with no metadata at all (an older build, a script)',
        jsonb_build_object('ticket_type_id', p.id, 'tier_name', 'Standard',
          'price_cents', 4500000, 'capacity', 12)),
      ('S-12 the price alone',
        jsonb_build_object('ticket_type_id', p.id, 'price_cents', 1)),
      ('S-13 the old number with a marker that is not the server''s shape',
        jsonb_build_object('ticket_type_id', p.id, 'price_cents', 4500000,
          'tier_metadata', v_clean || jsonb_build_object('price_cleared_for_currency_change', true))),
      ('S-14 a NEW package carrying a marker and a price',
        jsonb_build_object('tier_name', 'Second room', 'price_cents', 4500000, 'capacity', 4,
          'tier_metadata', jsonb_build_object('price_cleared_for_currency_change',
            jsonb_build_object('from', 'NGN', 'to', 'USD'))))
    ) AS c(label, tier)
  LOOP
    v_out := pg_temp.save_as_host(v_trip, v_tier);
    IF v_out IS DISTINCT FROM 'price_reentry_required' THEN
      RAISE EXCEPTION '% was not refused with price_reentry_required (got "%")', v_case, v_out;
    END IF;
    SELECT * INTO p FROM pg_temp.package(v_trip);
    IF p.price IS DISTINCT FROM 0 OR NOT p.marked OR p.packages <> 1
       OR p.meta IS DISTINCT FROM v_marker THEN
      RAISE EXCEPTION '% was refused but left something behind: price=% packages=% meta=%',
        v_case, p.price, p.packages, p.meta;
    END IF;
  END LOOP;

  -- S-30 0 with the marker kept (the field left empty) is saved...
  v_out := pg_temp.save_as_host(v_trip, jsonb_build_object('ticket_type_id', p.id,
    'tier_name', 'Standard', 'price_cents', 0, 'capacity', 12, 'tier_metadata', v_marker));
  IF v_out <> '' THEN
    RAISE EXCEPTION 'S-30 saving a still-empty price was refused: %', v_out;
  END IF;
  -- ...S-31 and still cannot go on sale, by the command or by a status write.
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_r3645_retest' WHERE id = v_a;
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = v_a AND user_id = v_owner;
  v_out := '';
  BEGIN
    PERFORM public.biz_publish_trip_command(v_trip, pg_temp.rev(v_trip), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    v_out := SQLERRM;
  END;
  IF v_out IS DISTINCT FROM 'price_reentry_required' THEN
    RAISE EXCEPTION 'S-31 a package saved as 0 with the marker kept: publish answered "%"', v_out;
  END IF;

  -- S-20 a NEW number with the marker left out is saved and holds.
  v_out := pg_temp.save_as_host(v_trip, jsonb_build_object('ticket_type_id', p.id,
    'tier_name', 'Standard', 'price_cents', 30000, 'capacity', 12, 'tier_metadata', v_clean));
  IF v_out <> '' THEN
    RAISE EXCEPTION 'S-20 a correct re-price was refused: %', v_out;
  END IF;
  SELECT * INTO p FROM pg_temp.package(v_trip);
  IF p.price IS DISTINCT FROM 30000 OR p.marked OR p.is_free
     OR p.meta#>>'{installments,deposit_pct}' IS DISTINCT FROM '25' THEN
    RAISE EXCEPTION 'S-20 after a correct re-price: price=% marked=% free=% meta=%',
      p.price, p.marked, p.is_free, p.meta;
  END IF;
  -- S-21 once re-priced, later saves are ordinary: a new price with no
  -- metadata, as an older build sends, is accepted.
  v_out := pg_temp.save_as_host(v_trip, jsonb_build_object('ticket_type_id', p.id, 'price_cents', 32000));
  IF v_out <> '' THEN
    RAISE EXCEPTION 'S-21 a re-priced package cannot be priced again: %', v_out;
  END IF;

  -- S-50 the shape the first tester suite's P-10 wrote: a marker put onto a
  -- package that HAS a price by a direct write. It is no longer a state that
  -- can be committed.
  v_out := '';
  BEGIN
    UPDATE public.trip_pricing_tiers tpt
       SET tier_metadata = tpt.tier_metadata || jsonb_build_object(
             'price_cleared_for_currency_change', jsonb_build_object('from', 'NGN', 'to', 'USD'))
     WHERE tpt.ticket_type_id = p.id;
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    SET CONSTRAINTS ALL DEFERRED;
    v_out := SQLERRM;
  END;
  IF v_out IS DISTINCT FROM 'price_reentry_required' THEN
    RAISE EXCEPTION 'S-50 a marker written directly onto a priced package would commit (got "%")', v_out;
  END IF;

  -- S-22 0 with the marker left out: the host said free. Saved, and it publishes.
  v_out := pg_temp.save_as_host(v_trip, jsonb_build_object('ticket_type_id', p.id,
    'tier_name', 'Standard', 'price_cents', 0, 'capacity', 12,
    'tier_metadata', v_clean - 'installments'));
  IF v_out <> '' THEN
    RAISE EXCEPTION 'S-22 a package the host set free was refused: %', v_out;
  END IF;
  PERFORM public.biz_publish_trip_command(v_trip, pg_temp.rev(v_trip), gen_random_uuid());
  SELECT status INTO v_status FROM public.events WHERE id = v_trip;
  IF v_status IS NULL OR v_status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'S-22 a package the host set free on purpose did not publish: %', v_status;
  END IF;

  -- S-40 what the refusal must not touch. An ordinary event ticket: its price
  -- changes, by the signed-in host's role, and the commit-time check passes.
  INSERT INTO public.ticket_types(event_id, name, price_cents, currency, quantity_total,
    is_unlimited, is_free, min_purchase_qty, available_online, available_in_person, display_order)
  VALUES ('3645be7e-0000-4000-8000-0000000000a1', 'General', 2500, 'USD', 100,
    false, false, 1, true, false, 0)
  RETURNING id INTO v_event_tt;
  v_out := '';
  BEGIN
    UPDATE public.ticket_types SET price_cents = 3500 WHERE id = v_event_tt;
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    SET CONSTRAINTS ALL DEFERRED;
    v_out := SQLERRM;
  END;
  IF v_out <> '' OR (SELECT price_cents FROM public.ticket_types WHERE id = v_event_tt) <> 3500 THEN
    RAISE EXCEPTION 'S-40 an ordinary ticket price change was refused or lost: "%"', v_out;
  END IF;

  -- S-41 a trip package that was never cleared (brand c's trip moved NGN ->
  -- GBP above and was cleared; the brand-new unpriced trip on brand a was not).
  SELECT id INTO v_trip FROM r3645_ids WHERE name = 'trip_a_new';
  SELECT * INTO p FROM pg_temp.package(v_trip);
  v_out := pg_temp.save_as_host(v_trip, jsonb_build_object('ticket_type_id', p.id,
    'tier_name', 'Standard', 'price_cents', 80000, 'capacity', 12));
  IF v_out <> '' THEN
    RAISE EXCEPTION 'S-41 pricing a package that was never cleared was refused: %', v_out;
  END IF;
  IF (SELECT price FROM pg_temp.package(v_trip)) IS DISTINCT FROM 80000 THEN
    RAISE EXCEPTION 'S-41 the price of a never-cleared package was not stored';
  END IF;
END
$stale$;

ROLLBACK;

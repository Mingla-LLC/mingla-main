\set ON_ERROR_STOP on

-- Issue #3645 — tester adversarial proof for "an unpublished draft with nothing
-- sold follows its brand's currency" (20270829003645). Run after the full
-- migration chain on PostgreSQL 17.
--
-- The implementor suite proves the happy path. This one attacks the two ways
-- the change can hurt a host:
--
--   WRONG WIPE. Prices must survive on: a draft with a checkout session, an
--   order, an RSVP chip-in or a door sale; a draft unpublished after a sale; a
--   published event; a deleted draft; another brand's drafts; a brand whose
--   currency is set to NULL; a brand whose currency is "changed" to the value
--   it already has; a brand choosing its FIRST currency (event, RSVP and a
--   trip with a deposit plan all keep what was typed).
--
--   MISSED WIPE / FREE BY ACCIDENT. On a real change every price-bearing copy
--   is cleared (the all-in copy too), two brands changed in ONE statement both
--   move, and a cleared trip package cannot leave draft through a plain status
--   update (scheduled or live) nor through the publish command, while a
--   package the host then sets free on purpose does publish. A marker on a
--   package that has a price blocks nothing.
--
-- Every assertion names what a host would lose. NULL-safety: comparisons whose
-- left side can be NULL use IS DISTINCT FROM.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '3645a0e5-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id) VALUES ('3645a0e5-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('3645a0e5-0000-4000-8000-000000000001');

-- a: pounds, changes to naira.      b: pounds, never changes (the bystander).
-- c: no currency, takes naira.      d: pounds, loses its currency.
-- f1, f2: pounds, both changed to dollars by ONE statement.
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('3645a0e5-0000-4000-8000-00000000000a', '3645a0e5-0000-4000-8000-000000000001', 'T3645 a', 't3645-adv-a', 'GBP'),
  ('3645a0e5-0000-4000-8000-00000000000b', '3645a0e5-0000-4000-8000-000000000001', 'T3645 b', 't3645-adv-b', 'GBP'),
  ('3645a0e5-0000-4000-8000-00000000000c', '3645a0e5-0000-4000-8000-000000000001', 'T3645 c', 't3645-adv-c', NULL),
  ('3645a0e5-0000-4000-8000-00000000000d', '3645a0e5-0000-4000-8000-000000000001', 'T3645 d', 't3645-adv-d', 'GBP'),
  ('3645a0e5-0000-4000-8000-0000000000f1', '3645a0e5-0000-4000-8000-000000000001', 'T3645 f1', 't3645-adv-f1', 'GBP'),
  ('3645a0e5-0000-4000-8000-0000000000f2', '3645a0e5-0000-4000-8000-000000000001', 'T3645 f2', 't3645-adv-f2', 'GBP');

CREATE FUNCTION pg_temp.iso(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')
$$;

CREATE FUNCTION pg_temp.rev(p_event uuid) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT updated_at FROM public.events WHERE id = p_event $$;

-- One paid ticket (with the server's all-in copy), one free ticket.
CREATE FUNCTION pg_temp.tickets() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('id', 't_paid', 'name', 'General', 'priceGbp', 50,
      'priceAllInGbp', 52.25, 'isFree', false, 'capacity', 100, 'displayOrder', 0),
    jsonb_build_object('id', 't_free', 'name', 'Community', 'priceGbp', NULL,
      'isFree', true, 'capacity', 20, 'displayOrder', 1))
$$;

CREATE FUNCTION pg_temp.draft(
  p_id uuid, p_brand uuid, p_type text, p_currency text, p_draft jsonb,
  p_status text DEFAULT 'draft', p_published_at timestamptz DEFAULT NULL,
  p_deleted_at timestamptz DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status,
    visibility, timezone, currency, theme, published_at, deleted_at)
  VALUES (p_id, p_brand, '3645a0e5-0000-4000-8000-000000000001', 'T3645 ' || p_type,
    't3645-adv-' || p_id, p_type, p_status,
    CASE WHEN p_status = 'draft' THEN 'draft' ELSE 'public' END,
    'Europe/London', p_currency,
    jsonb_build_object('coverHue', 25, 'business_draft',
      p_draft || jsonb_build_object('clientRevision', 0)
        || CASE WHEN p_currency IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('currency', p_currency) END),
    p_published_at, p_deleted_at)
$$;

-- A trip draft built through the real owners: one priced package with a
-- deposit plan. Returns the event id.
CREATE FUNCTION pg_temp.trip(p_brand uuid, p_op text, p_placeholder_currency text)
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
  IF p_placeholder_currency IS NOT NULL THEN
    UPDATE public.events SET currency = p_placeholder_currency WHERE id = v_event;
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
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_standard, 'tier_name', 'Standard', 'price_cents', 45000,
      'capacity', 12,
      'tier_metadata', jsonb_build_object(
        'description', 'Shared room',
        'installments', jsonb_build_object(
          'deposit_pct', 25,
          'installments', jsonb_build_array(jsonb_build_object(
            'ordinal', 1, 'pct', 75, 'days_after_booking', 30))))))),
    pg_temp.rev(v_event), (p_op || '3')::uuid);
  RETURN v_event;
END
$trip$;

CREATE TEMP TABLE t3645_ids(name text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
-- What every "must not move" row looked like before any brand changed.
CREATE TEMP TABLE t3645_before(
  id uuid PRIMARY KEY, currency text, theme jsonb,
  suggested integer, minimum integer, updated_at timestamptz) ON COMMIT DROP;

-- ─── Fixtures ────────────────────────────────────────────────────────────────
DO $fixtures$
DECLARE
  v_a uuid := '3645a0e5-0000-4000-8000-00000000000a';
  v_b uuid := '3645a0e5-0000-4000-8000-00000000000b';
  v_c uuid := '3645a0e5-0000-4000-8000-00000000000c';
  v_d uuid := '3645a0e5-0000-4000-8000-00000000000d';
  v_t jsonb := jsonb_build_object('tickets', pg_temp.tickets());
  v_rsvp jsonb := jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
    'rsvpContributionEnabled', true,
    'rsvpContributionSuggestedCents', 1500, 'rsvpContributionMinCents', 500);
BEGIN
  -- Brand a. MUST NOT MOVE:
  --   a1 a buyer is mid-checkout            a2 an order exists (it failed)
  --   a3 an RSVP guest chipped in           a4 a door sale was recorded
  --   a5 it is published                    a6 it was deleted
  --   a7 it was unpublished after a sale
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000a1', v_a, 'event', 'GBP', v_t);
  INSERT INTO public.ticket_checkout_sessions(event_id, brand_id, buyer_name, buyer_email,
    buyer_phone_e164, idempotency_key, expires_at)
  VALUES ('3645a0e5-0000-4000-8000-0000000000a1', v_a, 'Buyer', 'buyer@example.com',
    '+447700900001', 't3645-adv-session-a1', now() + interval '1 hour');

  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000a2', v_a, 'event', 'GBP', v_t);
  INSERT INTO public.orders(event_id, payment_status, buyer_phone_e164)
  VALUES ('3645a0e5-0000-4000-8000-0000000000a2', 'failed', '+447700900001');

  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000a3', v_a, 'rsvp', 'GBP', v_rsvp);
  UPDATE public.events
     SET rsvp_contribution_enabled = true, rsvp_contribution_suggested_cents = 1500,
         rsvp_contribution_min_cents = 500
   WHERE id = '3645a0e5-0000-4000-8000-0000000000a3';
  INSERT INTO public.event_rsvp_contributions(event_id, brand_id, provider, currency,
    amount_cents, buyer_total_cents, pricing_breakdown)
  VALUES ('3645a0e5-0000-4000-8000-0000000000a3', v_a, 'stripe', 'GBP', 500, 500, '{}'::jsonb);

  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000a4', v_a, 'event', 'GBP', v_t);
  INSERT INTO public.door_sales_ledger(event_id, payment_method, amount_cents)
  VALUES ('3645a0e5-0000-4000-8000-0000000000a4', 'cash', 500);

  -- Published, with NO published_at (rows published before that column was
  -- kept): only its status protects it.
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000a5', v_a, 'event', 'GBP', v_t,
    'scheduled', NULL);
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000a6', v_a, 'event', 'GBP', v_t,
    'draft', NULL, now() - interval '1 hour');
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000a7', v_a, 'event', 'GBP', v_t,
    'draft', now() - interval '3 days');
  INSERT INTO public.orders(event_id, payment_status, buyer_phone_e164, total_cents, currency)
  VALUES ('3645a0e5-0000-4000-8000-0000000000a7', 'paid', '+447700900001', 5000, 'GBP');

  -- Brand a. MUST MOVE: a clean event draft, a clean RSVP draft, a trip.
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000a8', v_a, 'event', 'GBP', v_t);
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000a9', v_a, 'rsvp', 'GBP', v_rsvp);
  UPDATE public.events
     SET rsvp_contribution_enabled = true, rsvp_contribution_suggested_cents = 1500,
         rsvp_contribution_min_cents = 500
   WHERE id = '3645a0e5-0000-4000-8000-0000000000a9';
  INSERT INTO t3645_ids VALUES
    ('trip_a', pg_temp.trip(v_a, '3645a0e5-0000-4000-8000-0000000001a', NULL));

  -- Brand b, the bystander: an event draft and a trip that must never move.
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000b1', v_b, 'event', 'GBP', v_t);
  INSERT INTO t3645_ids VALUES
    ('trip_b', pg_temp.trip(v_b, '3645a0e5-0000-4000-8000-0000000001b', NULL));

  -- Brand c, no currency yet: prices typed while the screen said "Currency not set".
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000c1', v_c, 'event', NULL, v_t);
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000c2', v_c, 'rsvp', NULL, v_rsvp);
  UPDATE public.events
     SET rsvp_contribution_enabled = true, rsvp_contribution_suggested_cents = 1500,
         rsvp_contribution_min_cents = 500
   WHERE id = '3645a0e5-0000-4000-8000-0000000000c2';
  INSERT INTO t3645_ids VALUES
    ('trip_c', pg_temp.trip(v_c, '3645a0e5-0000-4000-8000-0000000001c', 'USD'));

  -- Brand d loses its currency. Brands f1 and f2 change together.
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000000d1', v_d, 'event', 'GBP', v_t);
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000001f1',
    '3645a0e5-0000-4000-8000-0000000000f1', 'event', 'GBP', v_t);
  PERFORM pg_temp.draft('3645a0e5-0000-4000-8000-0000000001f2',
    '3645a0e5-0000-4000-8000-0000000000f2', 'event', 'GBP', v_t);

  INSERT INTO t3645_before
  SELECT e.id, e.currency::text, e.theme, e.rsvp_contribution_suggested_cents,
         e.rsvp_contribution_min_cents, e.updated_at
    FROM public.events e
   WHERE e.brand_id IN (v_a, v_b, v_d);
END
$fixtures$;

-- ─── 1. Brand a: pounds to naira, fired by service_role ──────────────────────
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
UPDATE public.brands SET default_currency = 'NGN'
 WHERE id = '3645a0e5-0000-4000-8000-00000000000a';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '3645a0e5-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $wrong_wipes$
DECLARE
  r record;
  ev record;
  v_paid jsonb;
  v_trip_b uuid;
  v_count integer;
  v_label text;
BEGIN
  -- W-01..W-07 every "must not move" draft of brand a is byte-for-byte what it was.
  FOR r IN
    SELECT b.*, e.currency::text AS now_currency, e.theme AS now_theme,
           e.rsvp_contribution_suggested_cents AS now_suggested,
           e.rsvp_contribution_min_cents AS now_minimum,
           e.updated_at AS now_updated_at
      FROM t3645_before b JOIN public.events e ON e.id = b.id
     WHERE b.id IN (
       '3645a0e5-0000-4000-8000-0000000000a1', '3645a0e5-0000-4000-8000-0000000000a2',
       '3645a0e5-0000-4000-8000-0000000000a3', '3645a0e5-0000-4000-8000-0000000000a4',
       '3645a0e5-0000-4000-8000-0000000000a5', '3645a0e5-0000-4000-8000-0000000000a6',
       '3645a0e5-0000-4000-8000-0000000000a7')
     ORDER BY b.id
  LOOP
    v_label := CASE right(r.id::text, 2)
      WHEN 'a1' THEN 'W-01 a draft with a buyer mid-checkout'
      WHEN 'a2' THEN 'W-02 a draft with an order (failed)'
      WHEN 'a3' THEN 'W-03 an RSVP draft a guest chipped in to'
      WHEN 'a4' THEN 'W-04 a draft with a door sale'
      WHEN 'a5' THEN 'W-05 a published event'
      WHEN 'a6' THEN 'W-06 a deleted draft'
      ELSE 'W-07 a draft unpublished after a sale' END;
    IF r.now_currency IS DISTINCT FROM r.currency
       OR r.now_theme IS DISTINCT FROM r.theme
       OR r.now_suggested IS DISTINCT FROM r.suggested
       OR r.now_minimum IS DISTINCT FROM r.minimum
       OR r.now_updated_at IS DISTINCT FROM r.updated_at THEN
      RAISE EXCEPTION '% was changed by the brand''s currency change: % -> %, theme now %',
        v_label, r.currency, r.now_currency, r.now_theme->'business_draft';
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM t3645_before
   WHERE id::text LIKE '3645a0e5-0000-4000-8000-0000000000a_' AND right(id::text, 1) BETWEEN '1' AND '7';
  IF v_count <> 7 THEN RAISE EXCEPTION 'W-00 fixture: % of 7 protected drafts were snapshotted', v_count; END IF;

  -- W-10 the bystander brand: its event draft and its trip did not move.
  SELECT count(*) INTO v_count
    FROM t3645_before b JOIN public.events e ON e.id = b.id
   WHERE e.brand_id = '3645a0e5-0000-4000-8000-00000000000b'
     AND e.currency = 'GBP' AND e.theme IS NOT DISTINCT FROM b.theme
     AND e.updated_at IS NOT DISTINCT FROM b.updated_at;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'W-10 another brand''s drafts moved when brand a changed currency (% of 2 untouched)', v_count;
  END IF;
  SELECT id INTO v_trip_b FROM t3645_ids WHERE name = 'trip_b';
  SELECT count(*) INTO v_count
    FROM public.ticket_types tt JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
   WHERE tt.event_id = v_trip_b AND tt.price_cents = 45000 AND tt.currency = 'GBP'
     AND NOT (tpt.tier_metadata ? 'price_cleared_for_currency_change');
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'W-11 another brand''s trip package lost its price or currency';
  END IF;

  -- C-01 the control: the clean draft DID move, and no pound amount is left in
  -- it. Without this, every W- assertion above passes with no trigger at all.
  SELECT * INTO ev FROM public.events x WHERE x.id = '3645a0e5-0000-4000-8000-0000000000a8';
  v_paid := ev.theme#>'{business_draft,tickets,0}';
  IF ev.currency IS DISTINCT FROM 'NGN'
     OR ev.theme#>>'{business_draft,currency}' IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'C-01 a clean draft did not follow its brand to NGN: % / %',
      ev.currency, ev.theme#>>'{business_draft,currency}';
  END IF;
  IF jsonb_typeof(v_paid->'priceGbp') IS DISTINCT FROM 'null'
     OR jsonb_typeof(v_paid->'priceAllInGbp') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'C-02 a pound amount is still inside the naira draft (price or all-in price): %', v_paid;
  END IF;
  IF (v_paid->'isFree') IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'C-03 the paid ticket was turned into a free one: %', v_paid;
  END IF;
  -- C-04 nothing numeric that looks like money survives anywhere in the paid ticket.
  IF EXISTS (
    SELECT 1 FROM jsonb_each(v_paid) kv
     WHERE kv.key ~* '(price|cents|amount|fee)' AND jsonb_typeof(kv.value) = 'number'
  ) THEN
    RAISE EXCEPTION 'C-04 a money field of the paid ticket was carried across currencies: %', v_paid;
  END IF;
  SELECT * INTO ev FROM public.events x WHERE x.id = '3645a0e5-0000-4000-8000-0000000000a9';
  IF ev.currency IS DISTINCT FROM 'NGN'
     OR ev.rsvp_contribution_suggested_cents IS NOT NULL
     OR ev.rsvp_contribution_min_cents IS NOT NULL
     OR ev.rsvp_contribution_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'C-05 the clean RSVP draft was not moved with its amounts cleared and chip-ins left on';
  END IF;
END
$wrong_wipes$;

-- ─── 2. "Changing" a currency to the one it already has moves nothing ────────
-- The host enters a naira price; the brand row is then written again with the
-- same currency (every bank status refresh does this).
UPDATE public.events
   SET theme = jsonb_set(theme, '{business_draft,tickets,0,priceGbp}', '7000'::jsonb)
 WHERE id = '3645a0e5-0000-4000-8000-0000000000a8';
UPDATE public.brands SET default_currency = 'NGN', name = 'T3645 a renamed'
 WHERE id = '3645a0e5-0000-4000-8000-00000000000a';
UPDATE public.brands SET default_currency = default_currency
 WHERE id = '3645a0e5-0000-4000-8000-00000000000a';

DO $same$
BEGIN
  IF (SELECT theme#>>'{business_draft,tickets,0,priceGbp}' FROM public.events
       WHERE id = '3645a0e5-0000-4000-8000-0000000000a8') IS DISTINCT FROM '7000' THEN
    RAISE EXCEPTION 'S-01 writing the SAME currency onto the brand cleared a price the host had just entered';
  END IF;
END
$same$;

-- ─── 3. A brand that loses its currency moves nothing ────────────────────────
UPDATE public.brands SET default_currency = NULL
 WHERE id = '3645a0e5-0000-4000-8000-00000000000d';

DO $to_null$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM t3645_before b JOIN public.events e ON e.id = b.id
   WHERE e.id = '3645a0e5-0000-4000-8000-0000000000d1'
     AND e.currency = 'GBP' AND e.theme IS NOT DISTINCT FROM b.theme
     AND e.updated_at IS NOT DISTINCT FROM b.updated_at;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'N-01 a brand losing its currency changed its draft';
  END IF;
END
$to_null$;

-- ─── 4. FIRST currency: stamp only, keep everything typed ────────────────────
UPDATE public.brands SET default_currency = 'NGN'
 WHERE id = '3645a0e5-0000-4000-8000-00000000000c';

DO $first$
DECLARE
  v_trip uuid;
  ev record;
  v_paid jsonb;
  t record;
  v_meta jsonb;
BEGIN
  SELECT * INTO ev FROM public.events x WHERE x.id = '3645a0e5-0000-4000-8000-0000000000c1';
  v_paid := ev.theme#>'{business_draft,tickets,0}';
  IF ev.currency IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'K-01 the event draft did not take the first currency: %', ev.currency;
  END IF;
  IF (v_paid->>'priceGbp')::numeric IS DISTINCT FROM 50
     OR (v_paid->>'priceAllInGbp')::numeric IS DISTINCT FROM 52.25 THEN
    RAISE EXCEPTION 'K-02 a price typed before the brand had a currency was cleared: %', v_paid;
  END IF;

  SELECT * INTO ev FROM public.events x WHERE x.id = '3645a0e5-0000-4000-8000-0000000000c2';
  IF ev.currency IS DISTINCT FROM 'NGN'
     OR ev.rsvp_contribution_suggested_cents IS DISTINCT FROM 1500
     OR ev.rsvp_contribution_min_cents IS DISTINCT FROM 500
     OR (ev.theme#>>'{business_draft,rsvpContributionSuggestedCents}')::int IS DISTINCT FROM 1500
     OR (ev.theme#>>'{business_draft,rsvpContributionMinCents}')::int IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'K-03 RSVP chip-in amounts typed before the brand had a currency were cleared: % / % / %',
      ev.rsvp_contribution_suggested_cents, ev.rsvp_contribution_min_cents, ev.theme->'business_draft';
  END IF;
  IF (ev.theme->'business_draft') ? 'pricesClearedForCurrencyChange' THEN
    RAISE EXCEPTION 'K-04 the RSVP draft tells the host its prices were cleared; nothing was';
  END IF;

  SELECT id INTO v_trip FROM t3645_ids WHERE name = 'trip_c';
  SELECT tt.* INTO t FROM public.ticket_types tt
   WHERE tt.event_id = v_trip AND tt.name = 'Standard' AND tt.deleted_at IS NULL;
  SELECT tpt.tier_metadata INTO v_meta FROM public.trip_pricing_tiers tpt
   WHERE tpt.ticket_type_id = t.id;
  IF t.price_cents IS DISTINCT FROM 45000 OR t.currency IS DISTINCT FROM 'NGN'
     OR t.is_free IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'K-05 the trip package is % % free=% (expected NGN 45000, not free)',
      t.currency, t.price_cents, t.is_free;
  END IF;
  IF (v_meta#>>'{installments,deposit_pct}')::numeric IS DISTINCT FROM 25
     OR (v_meta#>>'{installments,installments,0,pct}')::numeric IS DISTINCT FROM 75
     OR v_meta ? 'price_cleared_for_currency_change' THEN
    RAISE EXCEPTION 'K-06 the trip''s deposit plan was changed, or a kept price was marked as cleared: %', v_meta;
  END IF;
END
$first$;

-- ─── 5. Two brands changed by ONE statement both move ────────────────────────
UPDATE public.brands SET default_currency = 'USD'
 WHERE id IN ('3645a0e5-0000-4000-8000-0000000000f1', '3645a0e5-0000-4000-8000-0000000000f2');

DO $multi$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.events e
   WHERE e.id IN ('3645a0e5-0000-4000-8000-0000000001f1', '3645a0e5-0000-4000-8000-0000000001f2')
     AND e.currency = 'USD'
     AND jsonb_typeof(e.theme#>'{business_draft,tickets,0,priceGbp}') = 'null'
     AND e.theme#>'{business_draft,pricesClearedForCurrencyChange}'
           = jsonb_build_object('from', 'GBP', 'to', 'USD');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'M-01 only % of 2 brands changed in one statement had their drafts moved and cleared', v_count;
  END IF;
  -- The bystander is still untouched after every change above.
  IF (SELECT currency FROM public.events WHERE id = '3645a0e5-0000-4000-8000-0000000000b1')
       IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'M-02 the bystander brand''s draft moved';
  END IF;
END
$multi$;

-- ─── 6. The publish stop, attacked from every door ───────────────────────────
DO $publish$
DECLARE
  v_brand uuid := '3645a0e5-0000-4000-8000-00000000000a';
  v_owner uuid := '3645a0e5-0000-4000-8000-000000000001';
  v_trip uuid;
  v_trip_c uuid;
  t record;
  v_meta jsonb;
  v_status text;
  v_target text;
  v_refused boolean;
  v_result jsonb;
BEGIN
  SELECT id INTO v_trip FROM t3645_ids WHERE name = 'trip_a';
  SELECT id INTO v_trip_c FROM t3645_ids WHERE name = 'trip_c';
  SELECT tt.* INTO t FROM public.ticket_types tt
   WHERE tt.event_id = v_trip AND tt.name = 'Standard' AND tt.deleted_at IS NULL;
  SELECT tpt.tier_metadata INTO v_meta FROM public.trip_pricing_tiers tpt
   WHERE tpt.ticket_type_id = t.id;
  IF t.price_cents IS DISTINCT FROM 0 OR t.is_free IS DISTINCT FROM false
     OR NOT (v_meta ? 'price_cleared_for_currency_change') THEN
    RAISE EXCEPTION 'P-00 the trip package was not cleared and marked: price=% free=% meta=%',
      t.price_cents, t.is_free, v_meta;
  END IF;

  -- P-01 / P-02 a plain status write (an authorised role, a job, a console)
  -- cannot put the cleared trip on sale, as scheduled or as live. The refusal
  -- must be THIS rule's, not a side effect of another check.
  FOREACH v_target IN ARRAY ARRAY['scheduled', 'live'] LOOP
    v_refused := false;
    BEGIN
      UPDATE public.events SET status = v_target, visibility = 'public' WHERE id = v_trip;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'price_reentry_required' THEN
        RAISE EXCEPTION 'P-01 a direct move to % was stopped by "%", not by the cleared-price rule', v_target, SQLERRM;
      END IF;
      v_refused := true;
    END;
    IF NOT v_refused THEN
      RAISE EXCEPTION 'P-02 a trip whose price was cleared was moved to % by a plain status update', v_target;
    END IF;
  END LOOP;
  SELECT status INTO v_status FROM public.events WHERE id = v_trip;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'P-03 a refused status write left the trip as %', v_status;
  END IF;

  -- P-10 a marker on a package that HAS a price blocks nothing: whatever stops
  -- this direct write, it is not the cleared-price rule.
  UPDATE public.trip_pricing_tiers tpt
     SET tier_metadata = tpt.tier_metadata
           || jsonb_build_object('price_cleared_for_currency_change',
                jsonb_build_object('from', 'GBP', 'to', 'NGN'))
   WHERE tpt.event_id = v_trip_c;
  BEGIN
    UPDATE public.events SET status = 'scheduled', visibility = 'public' WHERE id = v_trip_c;
    UPDATE public.events SET status = 'draft', visibility = 'draft' WHERE id = v_trip_c;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'price_reentry_required' THEN
      RAISE EXCEPTION 'P-10 a priced package was refused publish because of a left-over marker';
    END IF;
  END;

  -- P-20 the host decides the cleared package is free after all. The wizard
  -- saves 0 without the marker; the SAME draft then publishes, as free.
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_t3645_adv' WHERE id = v_brand;
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = v_brand AND user_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'P-19 fixture: the owner has no team row'; END IF;

  v_refused := false;
  BEGIN
    v_result := public.biz_publish_trip_command(
      v_trip, pg_temp.rev(v_trip), '3645a0e5-0000-4000-8000-0000000002a1');
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'price_reentry_required' THEN
      RAISE EXCEPTION 'P-20 the publish command refused with %, expected price_reentry_required', SQLERRM;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'P-21 the publish command put a cleared package on sale as free';
  END IF;

  PERFORM public.biz_apply_trip_draft_graph(
    v_trip,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'ticket_type_id', t.id, 'tier_name', 'Standard', 'price_cents', 0,
      'capacity', 12,
      'tier_metadata', v_meta - 'price_cleared_for_currency_change'))),
    pg_temp.rev(v_trip), '3645a0e5-0000-4000-8000-0000000002a2');
  v_result := public.biz_publish_trip_command(
    v_trip, pg_temp.rev(v_trip), '3645a0e5-0000-4000-8000-0000000002a3');
  SELECT status INTO v_status FROM public.events WHERE id = v_trip;
  IF v_status IS NULL OR v_status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'P-22 a package the host set free on purpose still cannot publish: status=% result=%',
      v_status, left(v_result::text, 200);
  END IF;
  IF (SELECT count(*) FROM public.ticket_types tt
       WHERE tt.id = t.id AND tt.price_cents = 0 AND tt.is_free = true AND tt.currency = 'NGN') <> 1 THEN
    RAISE EXCEPTION 'P-23 the published free package is not a plain free NGN package';
  END IF;
END
$publish$;

ROLLBACK;

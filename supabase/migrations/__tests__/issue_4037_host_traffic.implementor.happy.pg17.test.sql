-- Issue #4037 — host traffic capture and rollups: implementor happy-path proof.
-- Fails on revert of 20271210004037_issue_4037_host_traffic_analytics.sql.
-- MINGLA-INVARIANT: I-4037-TRAFFIC-BRAND-DAY | issue #4037 | A visit's day bucket is fixed at write time in the brand timezone (payout country, then brand address or main venue, then the brand's own events, then UTC); the visitor salt rotates at the brand's local midnight; brand-wide visitors count once per brand-day under their first source; bookings and value come only from completed orders, reservations and RSVPs.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t4037_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION '#4037 happy FAIL: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.t4037_key(p_label text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('issue-4037-' || p_label, 'UTF8')), 'hex');
$$;

-- Fixtures (triggers off while seeding; every function under test runs with
-- triggers back on).
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users(id, email) VALUES
  ('40370000-0000-4000-8000-0000000000a1', 'owner-4037@example.test'),
  ('40370000-0000-4000-8000-0000000000a2', 'member-4037@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('40370000-0000-4000-8000-0000000000a1', 'owner-4037@example.test');

-- London (GB payout), New York (US payout + NYC address), Lagos (NG payout),
-- and a brand with nothing to go on (UTC).
INSERT INTO public.brands(id, account_id, name, slug, default_currency, payout_country, lat, lng, country_code, social_links)
VALUES
  ('40370000-0000-4000-8000-0000000000b1', '40370000-0000-4000-8000-0000000000a1',
   'Issue 4037 London', 'issue-4037-london', 'GBP', 'GB', NULL, NULL, NULL,
   '{"website":"https://www.london-4037.example"}'::jsonb),
  ('40370000-0000-4000-8000-0000000000b2', '40370000-0000-4000-8000-0000000000a1',
   'Issue 4037 New York', 'issue-4037-new-york', 'USD', 'US', 40.7128, -74.0060, 'US', '{}'::jsonb),
  ('40370000-0000-4000-8000-0000000000b3', '40370000-0000-4000-8000-0000000000a1',
   'Issue 4037 Lagos', 'issue-4037-lagos', 'NGN', 'NG', NULL, NULL, NULL, '{}'::jsonb),
  ('40370000-0000-4000-8000-0000000000b4', '40370000-0000-4000-8000-0000000000a1',
   'Issue 4037 Nowhere', 'issue-4037-nowhere', 'GBP', NULL, NULL, NULL, NULL, '{}'::jsonb);

INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
  ('40370000-0000-4000-8000-0000000000b1', '40370000-0000-4000-8000-0000000000a2',
   'event_manager', now());

INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, timezone)
VALUES
  ('40370000-0000-4000-8000-0000000000e1', '40370000-0000-4000-8000-0000000000b1',
   '40370000-0000-4000-8000-0000000000a1', 'Rooftop Supper', 'rooftop-supper-4037', 'event', 'live', 'Europe/London'),
  ('40370000-0000-4000-8000-0000000000e2', '40370000-0000-4000-8000-0000000000b1',
   '40370000-0000-4000-8000-0000000000a1', 'Garden RSVP', 'garden-rsvp-4037', 'rsvp', 'live', 'Europe/London'),
  ('40370000-0000-4000-8000-0000000000e3', '40370000-0000-4000-8000-0000000000b2',
   '40370000-0000-4000-8000-0000000000a1', 'Harbour Walk', 'harbour-walk-4037', 'event', 'live', 'America/New_York');

-- Completed sales on the London brand: one search-sourced paid order (Mingla),
-- one paid order with no touch (direct_unknown), one going+approved RSVP.
INSERT INTO public.ad_attribution_touches(id, click_id, network, surface, entry_source, referrer_host)
VALUES ('40370000-0000-4000-8000-0000000000d1', 'issue-4037-search', 'other', 'web', 'search', 'google.com');

INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, total_cents, currency,
  payment_method, payment_status, source, created_at, confirmed_at)
VALUES
  ('40370000-0000-4000-8000-0000000000f1', '40370000-0000-4000-8000-0000000000e1',
   'ada@example.test', '+447700900001', 4000, 'GBP', 'online_card', 'paid', 'online_checkout',
   now() - interval '1 day', now() - interval '1 day'),
  ('40370000-0000-4000-8000-0000000000f2', '40370000-0000-4000-8000-0000000000e1',
   'ben@example.test', '+447700900002', 2500, 'GBP', 'online_card', 'paid', 'online_checkout',
   now() - interval '1 day', now() - interval '1 day');

INSERT INTO public.ad_conversions(id, touch_id, click_id, order_id, event_type, event_name, surface, event_id, created_at)
VALUES ('40370000-0000-4000-8000-0000000000c1', '40370000-0000-4000-8000-0000000000d1',
  'issue-4037-search', '40370000-0000-4000-8000-0000000000f1', 'purchase', 'Purchase', 'web',
  'issue-4037-order-f1', now() - interval '1 day');

INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status, created_at)
VALUES ('40370000-0000-4000-8000-0000000000a9', '40370000-0000-4000-8000-0000000000e2',
  'Cleo', 'cleo@example.test', '+447700900003', 'going', 'approved', now() - interval '1 day');

SET LOCAL session_replication_role = origin;

-- ── H1: brand timezone (decision 1) ─────────────────────────────────────────
SELECT pg_temp.t4037_assert(
  public.offering_traffic_brand_timezone('40370000-0000-4000-8000-0000000000b1') = 'Europe/London',
  'H1 GB payout country resolves to Europe/London');
SELECT pg_temp.t4037_assert(
  public.offering_traffic_brand_timezone('40370000-0000-4000-8000-0000000000b2') = 'America/New_York',
  'H1 multi-zone US payout country resolves through the brand address to America/New_York');
SELECT pg_temp.t4037_assert(
  public.offering_traffic_brand_timezone('40370000-0000-4000-8000-0000000000b3') = 'Africa/Lagos',
  'H1 NG payout country resolves to Africa/Lagos');
SELECT pg_temp.t4037_assert(
  public.offering_traffic_brand_timezone('40370000-0000-4000-8000-0000000000b4') = 'UTC',
  'H1 a brand with no country, address, venue or event zone falls back to UTC');

-- ── H2: brand-day bucket is fixed at write time in the brand timezone ──────
-- 03:30Z on 15 Jan is 22:30 on 14 Jan in New York; 05:30Z is 00:30 on 15 Jan.
SELECT pg_temp.t4037_assert(public.offering_engagement_capture_at(
  '40370000-0000-4000-8000-000000000101', '40370000-0000-4000-8000-0000000000b2',
  'event', '40370000-0000-4000-8000-0000000000e3', 'page_view', NULL, 'buyer_web',
  pg_temp.t4037_key('ny-1'), NULL, NULL, NULL, NULL, false, false,
  '2027-01-15 03:30:00+00') = 'counted', 'H2 late-evening New York view counted');
SELECT pg_temp.t4037_assert(public.offering_engagement_capture_at(
  '40370000-0000-4000-8000-000000000102', '40370000-0000-4000-8000-0000000000b2',
  'event', '40370000-0000-4000-8000-0000000000e3', 'page_view', NULL, 'buyer_web',
  pg_temp.t4037_key('ny-1'), NULL, NULL, NULL, NULL, false, false,
  '2027-01-15 05:30:00+00') = 'counted', 'H2 after-midnight New York view counted');
SELECT pg_temp.t4037_assert((
  SELECT array_agg(brand_day ORDER BY occurred_at) FROM public.offering_engagement_events
  WHERE brand_id = '40370000-0000-4000-8000-0000000000b2'
) = ARRAY['2027-01-14'::date, '2027-01-15'::date],
  'H2 the two views land on 14 Jan and 15 Jan New York time, not both on 15 Jan UTC');
SELECT pg_temp.t4037_assert((
  SELECT array_agg(day::text || ':' || page_views || ':' || visitors ORDER BY day)
  FROM public.offering_engagement_daily
  WHERE brand_id = '40370000-0000-4000-8000-0000000000b2'
) = ARRAY['2027-01-14:1:1', '2027-01-15:1:1'],
  'H2 each New York day counts one view and one visitor');

-- ── H3: salt rotates at the brand's local midnight (decision 2) ────────────
DO $$
DECLARE
  v_first text;
  v_again text;
  v_next text;
BEGIN
  -- 04:59Z = 23:59 on 14 Jan in New York; 05:01Z = 00:01 on 15 Jan.
  v_first := public.offering_engagement_claim_salt_at(
    '40370000-0000-4000-8000-0000000000b2', repeat('a', 64), '2027-01-15 04:59:00+00');
  v_again := public.offering_engagement_claim_salt_at(
    '40370000-0000-4000-8000-0000000000b2', repeat('b', 64), '2027-01-15 04:59:30+00');
  v_next := public.offering_engagement_claim_salt_at(
    '40370000-0000-4000-8000-0000000000b2', repeat('c', 64), '2027-01-15 05:01:00+00');
  PERFORM pg_temp.t4037_assert(v_first = repeat('a', 64), 'H3 first claim stores the candidate');
  PERFORM pg_temp.t4037_assert(v_again = v_first, 'H3 same local day returns the same salt');
  PERFORM pg_temp.t4037_assert(v_next = repeat('c', 64), 'H3 a new local day rotates the salt');
  PERFORM pg_temp.t4037_assert((
    SELECT array_agg(local_day ORDER BY local_day) FROM public.offering_engagement_salts
    WHERE brand_id = '40370000-0000-4000-8000-0000000000b2'
  ) = ARRAY['2027-01-14'::date, '2027-01-15'::date], 'H3 salts are keyed by the New York day');
END
$$;

-- ── H4: page-view dedupe and first-touch brand-day visitors (decision 6) ───
DO $$
DECLARE
  v_brand constant uuid := '40370000-0000-4000-8000-0000000000b1';
  v_event constant uuid := '40370000-0000-4000-8000-0000000000e1';
  v_day_start constant timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/London')
    AT TIME ZONE 'Europe/London';
  v_t0 timestamptz;
BEGIN
  -- Today at 09:00 London time (or an hour ago if earlier), so the rollups see it.
  v_t0 := LEAST(v_day_start + interval '9 hours', now() - interval '61 minutes');
  IF v_t0 < v_day_start THEN
    v_t0 := v_day_start;
  END IF;

  -- Visitor V arrives from Instagram on the event page...
  PERFORM pg_temp.t4037_assert(public.offering_engagement_capture_at(
    '40370000-0000-4000-8000-000000000201', v_brand, 'event', v_event, 'page_view', NULL,
    'buyer_web', pg_temp.t4037_key('v'), NULL, NULL, 'l.instagram.com', '/', false, false,
    v_t0) = 'counted', 'H4 first view counted');
  -- ...reloads 10 minutes later (deduped)...
  PERFORM pg_temp.t4037_assert(public.offering_engagement_capture_at(
    '40370000-0000-4000-8000-000000000202', v_brand, 'event', v_event, 'page_view', NULL,
    'buyer_web', pg_temp.t4037_key('v'), NULL, NULL, 'l.instagram.com', '/', false, false,
    v_t0 + interval '10 minutes') = 'duplicate_page_view', 'H4 view within 30 minutes deduped');
  -- ...comes back 31 minutes after the first view (a second visit, same visitor)...
  PERFORM pg_temp.t4037_assert(public.offering_engagement_capture_at(
    '40370000-0000-4000-8000-000000000203', v_brand, 'event', v_event, 'page_view', NULL,
    'buyer_web', pg_temp.t4037_key('v'), NULL, NULL, 'google.com', '/', false, false,
    v_t0 + interval '31 minutes') = 'counted', 'H4 view after 30 minutes counted');
  -- ...then opens the brand page from Google the same day, and taps Buy.
  PERFORM pg_temp.t4037_assert(public.offering_engagement_capture_at(
    '40370000-0000-4000-8000-000000000204', v_brand, 'brand', NULL, 'page_view', NULL,
    'buyer_web', pg_temp.t4037_key('v'), NULL, NULL, 'google.com', '/', false, false,
    v_t0 + interval '40 minutes') = 'counted', 'H4 brand page view counted');
  PERFORM pg_temp.t4037_assert(public.offering_engagement_capture_at(
    '40370000-0000-4000-8000-000000000205', v_brand, 'event', v_event, 'cta_click', 'buy',
    'buyer_web', pg_temp.t4037_key('v'), NULL, NULL, 'google.com', '/', false, false,
    v_t0 + interval '41 minutes') = 'counted', 'H4 buy tap counted');
  -- A second visitor arrives from the brand's own website.
  PERFORM pg_temp.t4037_assert(public.offering_engagement_capture_at(
    '40370000-0000-4000-8000-000000000206', v_brand, 'event', v_event, 'page_view', NULL,
    'buyer_web', pg_temp.t4037_key('w'), NULL, NULL, 'london-4037.example', '/', false, false,
    v_t0 + interval '42 minutes') = 'counted', 'H4 second visitor counted');

  -- Brand-wide: V once (social, first touch), W once (own_links).
  PERFORM pg_temp.t4037_assert((
    SELECT array_agg(source || ':' || visitors ORDER BY source)
    FROM public.offering_engagement_brand_daily WHERE brand_id = v_brand
  ) = ARRAY['own_links:1', 'social:1'], 'H4 brand-day visitors are first-touch deduped');
  -- Page-level: the event page counts V once under social, W under own_links;
  -- page views 3 (social, search, own_links); the brand page counts V once.
  PERFORM pg_temp.t4037_assert((
    SELECT array_agg(entity_type || ':' || source || ':' || page_views || ':' || visitors
                     || ':' || cta_buy ORDER BY entity_type, source)
    FROM public.offering_engagement_daily WHERE brand_id = v_brand
  ) = ARRAY['brand:search:1:1:0', 'event:own_links:1:1:0', 'event:search:1:0:1',
            'event:social:1:1:0'],
    'H4 page rows: views per source, visitors first-touch per page-day, taps as engagement');
END
$$;

-- ── H5: brand rollup for a member (shape, reconciliation, conversions) ─────
DO $$
DECLARE
  v jsonb;
  v_entity jsonb;
  v_brand_page jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '40370000-0000-4000-8000-0000000000a2', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"40370000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

  v := public.brand_traffic_rollup('40370000-0000-4000-8000-0000000000b1', '30d');
  v_entity := public.entity_traffic_rollup('40370000-0000-4000-8000-0000000000b1', 'event',
    '40370000-0000-4000-8000-0000000000e1', '7d');
  v_brand_page := public.entity_traffic_rollup('40370000-0000-4000-8000-0000000000b1', 'brand',
    NULL, '30d');
  RESET ROLE;

  PERFORM pg_temp.t4037_assert(v ->> 'brand_id' = '40370000-0000-4000-8000-0000000000b1'
    AND (v ->> 'authorized')::boolean AND v ->> 'range' = '30d', 'H5 authorized envelope');
  PERFORM pg_temp.t4037_assert(jsonb_array_length(v -> 'daily') = 30, 'H5 30 daily points');
  PERFORM pg_temp.t4037_assert((v #>> '{totals,page_views}')::int = 4
    AND (SELECT sum((d ->> 'page_views')::int) FROM jsonb_array_elements(v -> 'daily') d) = 4,
    'H5 page views total and the daily series agree');
  PERFORM pg_temp.t4037_assert((v #>> '{totals,visitors}')::int = 2,
    'H5 brand visitors are deduped once per brand-day (2, not the 3 page-level visitors)');
  PERFORM pg_temp.t4037_assert((v #>> '{totals,button_taps}')::int = 1
    AND (v #>> '{totals,checkout_starts}')::int = 0, 'H5 one engagement tap, no checkout');
  PERFORM pg_temp.t4037_assert((v #>> '{totals,bookings}')::int = 3
    AND (v #>> '{totals,customers}')::int = 3, 'H5 bookings = 2 paid orders + 1 RSVP');
  PERFORM pg_temp.t4037_assert(v #> '{totals,booking_value}' = '{"GBP": 6500}'::jsonb
    AND v #> '{totals,value_mingla_brought}' = '{"GBP": 4000}'::jsonb
    AND v #>> '{totals,primary_currency}' = 'GBP', 'H5 value from completed orders only');
  PERFORM pg_temp.t4037_assert((v #>> '{totals,mingla_customers}')::int = 1
    AND (v #>> '{totals,mingla_visitors}')::int = 0,
    'H5 only the search-sourced buyer is a Mingla customer; social/own-links visitors are not Mingla');
  PERFORM pg_temp.t4037_assert((
    SELECT array_agg(s ->> 'source' || ':' || (s ->> 'visitors') || ':' || (s ->> 'bookings'))
    FROM jsonb_array_elements(v -> 'sources') s
  ) = ARRAY['mingla_app:0:0', 'mingla_ads:0:0', 'search:0:1', 'social:1:0', 'own_links:1:0',
            'direct_unknown:0:2'], 'H5 sources in contract order; no touch is direct_unknown');
  PERFORM pg_temp.t4037_assert(jsonb_array_length(v -> 'ctas') = 11
    AND (SELECT sum((c ->> 'count')::int) FROM jsonb_array_elements(v -> 'ctas') c) = 1,
    'H5 every tap type listed and summing to button taps');
  PERFORM pg_temp.t4037_assert((
    SELECT array_agg((p ->> 'entity_type') || ':' || (p ->> 'title') || ':' || (p ->> 'page_views')
                     || ':' || (p ->> 'bookings'))
    FROM jsonb_array_elements(v -> 'pages') p
  ) = ARRAY['event:Rooftop Supper:3:2', 'brand:Issue 4037 London:1:0', 'event:Garden RSVP:0:1'],
    'H5 pages sorted by visits, brand page listed (decision 3)');
  PERFORM pg_temp.t4037_assert(v ->> 'capture_started_at' IS NOT NULL
    AND (v ->> 'window_complete')::boolean = false, 'H5 capture start honesty');

  PERFORM pg_temp.t4037_assert((v_entity ->> 'authorized')::boolean
    AND v_entity ->> 'entity_type' = 'event'
    AND v_entity ->> 'entity_id' = '40370000-0000-4000-8000-0000000000e1'
    AND NOT (v_entity ? 'pages')
    AND (v_entity #>> '{totals,page_views}')::int = 3
    AND (v_entity #>> '{totals,visitors}')::int = 2
    AND (v_entity #>> '{totals,bookings}')::int = 2, 'H5 entity rollup scoped to one page');
  PERFORM pg_temp.t4037_assert((v_brand_page ->> 'authorized')::boolean
    AND v_brand_page -> 'entity_id' = 'null'::jsonb
    AND (v_brand_page #>> '{totals,page_views}')::int = 1
    AND (v_brand_page #>> '{totals,bookings}')::int = 0, 'H5 brand page detail (decision 4)');
END
$$;

-- ── H6: purge removes raw rows, keeps aggregates ────────────────────────────
UPDATE public.offering_engagement_events SET occurred_at = now() - interval '36 days'
WHERE brand_id = '40370000-0000-4000-8000-0000000000b2';
UPDATE public.offering_engagement_visitor_marks SET created_at = now() - interval '4 days'
WHERE brand_id = '40370000-0000-4000-8000-0000000000b2';
UPDATE public.offering_engagement_salts SET created_at = now() - interval '49 hours'
WHERE brand_id = '40370000-0000-4000-8000-0000000000b2';
SELECT pg_temp.t4037_assert((
  SELECT events_deleted = 2 AND marks_deleted >= 2 AND salts_deleted = 2
  FROM public.cleanup_offering_engagement(100)
), 'H6 purge deletes the 36-day-old events, old marks and 48h-old salts');
SELECT pg_temp.t4037_assert(
  (SELECT count(*) FROM public.offering_engagement_events
    WHERE brand_id = '40370000-0000-4000-8000-0000000000b2') = 0
  AND (SELECT count(*) FROM public.offering_engagement_daily
    WHERE brand_id = '40370000-0000-4000-8000-0000000000b2') = 2
  AND (SELECT count(*) FROM public.offering_engagement_events
    WHERE brand_id = '40370000-0000-4000-8000-0000000000b1') = 5,
  'H6 aggregates kept forever; recent raw events untouched');
SELECT pg_temp.t4037_assert(EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'issue_4037_offering_engagement_retention' AND active
), 'H6 retention job scheduled');

DO $$ BEGIN RAISE NOTICE '#4037 implementor happy: PASS'; END $$;
ROLLBACK;

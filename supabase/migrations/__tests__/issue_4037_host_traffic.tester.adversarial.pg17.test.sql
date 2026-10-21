-- Issue #4037 — host traffic: adversarial proof (access, cross-brand pages,
-- privileges, abuse limits, dedupe, timezone midnight, source rules, and
-- conversions only from completed sales).
-- Fails on revert of 20271210004037_issue_4037_host_traffic_analytics.sql.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t4037_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION '#4037 adversarial FAIL: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.t4037_key(p_label text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('issue-4037-adv-' || p_label, 'UTF8')), 'hex');
$$;

-- Runs p_sql as p_role and returns the SQLSTATE it raised ('ok' if none).
CREATE FUNCTION pg_temp.t4037_sqlstate_as(p_role text, p_sub text, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_state text := 'ok';
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_sub, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_sub IS NULL THEN '{"role":"anon"}'
      ELSE json_build_object('sub', p_sub, 'role', p_role)::text END, true);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  RETURN v_state;
END
$$;

CREATE FUNCTION pg_temp.t4037_as(p_sub text, p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', p_sub, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
END
$$;

SET LOCAL session_replication_role = replica;

INSERT INTO auth.users(id, email) VALUES
  ('40371000-0000-4000-8000-0000000000a1', 'owner-adv-4037@example.test'),
  ('40371000-0000-4000-8000-0000000000a2', 'member-adv-4037@example.test'),
  ('40371000-0000-4000-8000-0000000000a3', 'stranger-adv-4037@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('40371000-0000-4000-8000-0000000000a1', 'owner-adv-4037@example.test');

INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country)
VALUES
  ('40371000-0000-4000-8000-0000000000b1', '40371000-0000-4000-8000-0000000000a1',
   'Adv 4037 Lagos', 'adv-4037-lagos', 'NGN', 'paystack', 'NG'),
  ('40371000-0000-4000-8000-0000000000b2', '40371000-0000-4000-8000-0000000000a1',
   'Adv 4037 Other', 'adv-4037-other', 'GBP', 'stripe', NULL);

-- The member belongs to Lagos only.
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
  ('40371000-0000-4000-8000-0000000000b1', '40371000-0000-4000-8000-0000000000a2',
   'marketing_manager', now());

INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, timezone)
VALUES
  ('40371000-0000-4000-8000-0000000000e1', '40371000-0000-4000-8000-0000000000b1',
   '40371000-0000-4000-8000-0000000000a1', 'Lagos Night', 'lagos-night-adv-4037', 'event', 'live', 'Africa/Lagos'),
  ('40371000-0000-4000-8000-0000000000e2', '40371000-0000-4000-8000-0000000000b1',
   '40371000-0000-4000-8000-0000000000a1', 'Lagos Trip', 'lagos-trip-adv-4037', 'trip', 'live', 'Africa/Lagos'),
  ('40371000-0000-4000-8000-0000000000e3', '40371000-0000-4000-8000-0000000000b1',
   '40371000-0000-4000-8000-0000000000a1', 'Lagos RSVP', 'lagos-rsvp-adv-4037', 'rsvp', 'live', 'Africa/Lagos'),
  ('40371000-0000-4000-8000-0000000000e9', '40371000-0000-4000-8000-0000000000b2',
   '40371000-0000-4000-8000-0000000000a1', 'Other Brand Night', 'other-night-adv-4037', 'event', 'live', 'Europe/London');

INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category)
VALUES ('40371000-0000-4000-8000-0000000000c1', '40371000-0000-4000-8000-0000000000b1',
  'lagosvenueadv4037', 'Lagos Venue', 6.45, 3.39, 'restaurant');

-- Sales that are NOT completed, plus exactly one completed sale of each kind.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, total_cents, currency,
  payment_method, payment_status, source, created_at)
VALUES
  ('40371000-0000-4000-8000-0000000000f1', '40371000-0000-4000-8000-0000000000e1',
   'paid@example.test', '+2348000000001', 500000, 'NGN', 'online_card', 'paid', 'online_checkout', now() - interval '2 days'),
  ('40371000-0000-4000-8000-0000000000f2', '40371000-0000-4000-8000-0000000000e1',
   'pending@example.test', '+2348000000002', 500000, 'NGN', 'online_card', 'pending', 'online_checkout', now() - interval '2 days'),
  ('40371000-0000-4000-8000-0000000000f3', '40371000-0000-4000-8000-0000000000e1',
   'failed@example.test', '+2348000000003', 500000, 'NGN', 'online_card', 'failed', 'online_checkout', now() - interval '2 days'),
  ('40371000-0000-4000-8000-0000000000f4', '40371000-0000-4000-8000-0000000000e1',
   'door@example.test', '+2348000000004', 500000, 'NGN', 'cash', 'paid', 'door_sale', now() - interval '2 days'),
  ('40371000-0000-4000-8000-0000000000f5', '40371000-0000-4000-8000-0000000000e1',
   'refunded@example.test', '+2348000000005', 500000, 'NGN', 'online_card', 'refunded', 'online_checkout', now() - interval '2 days');

INSERT INTO public.reservations(id, brand_id, venue_id, reserved_for, party_size, status, source,
  guest_email, fee_cents, fee_currency, payment_status, created_at)
VALUES
  ('40371000-0000-4000-8000-000000000d01', '40371000-0000-4000-8000-0000000000b1',
   '40371000-0000-4000-8000-0000000000c1', now() + interval '3 days', 2, 'confirmed', 'mingla',
   'table@example.test', 100000, 'NGN', 'paid', now() - interval '2 days'),
  ('40371000-0000-4000-8000-000000000d02', '40371000-0000-4000-8000-0000000000b1',
   '40371000-0000-4000-8000-0000000000c1', now() + interval '3 days', 2, 'cancelled_by_guest', 'mingla',
   'cancelled@example.test', 100000, 'NGN', 'paid', now() - interval '2 days'),
  ('40371000-0000-4000-8000-000000000d03', '40371000-0000-4000-8000-0000000000b1',
   '40371000-0000-4000-8000-0000000000c1', now() + interval '3 days', 2, 'confirmed', 'phone',
   'phone@example.test', 0, 'NGN', 'none', now() - interval '2 days');

INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status, created_at)
VALUES
  ('40371000-0000-4000-8000-000000000e01', '40371000-0000-4000-8000-0000000000e3',
   'Going', 'going@example.test', '+2348000000010', 'going', 'approved', now() - interval '2 days'),
  ('40371000-0000-4000-8000-000000000e02', '40371000-0000-4000-8000-0000000000e3',
   'Pending', 'pend@example.test', '+2348000000011', 'going', 'pending', now() - interval '2 days'),
  ('40371000-0000-4000-8000-000000000e03', '40371000-0000-4000-8000-0000000000e3',
   'Not going', 'no@example.test', '+2348000000012', 'not_going', 'approved', now() - interval '2 days');

INSERT INTO public.ad_campaigns(id, connection_id, platform, external_campaign_id, name, objective,
  status, dest_page_type, dest_brand_slug, dest_url, dest_smart_link, owner_kind, currency)
VALUES ('40371000-0000-4000-8000-0000000000aa', '40371000-0000-4000-8000-0000000000ab', 'meta',
  'adv-4037-campaign', 'Adv 4037', 'OUTCOME_TRAFFIC', 'PAUSED', 'brand', 'adv-4037-lagos',
  'https://usemingla.com/b/adv-4037-lagos', 'https://usemingla.com/b/adv-4037-lagos', 'mingla', 'USD');

SET LOCAL session_replication_role = origin;

-- ── A1: privileges ───────────────────────────────────────────────────────────
SELECT pg_temp.t4037_assert(pg_temp.t4037_sqlstate_as('anon', NULL,
  $q$SELECT public.brand_traffic_rollup('40371000-0000-4000-8000-0000000000b1', '30d')$q$) = '42501',
  'A1 anon cannot call brand_traffic_rollup');
SELECT pg_temp.t4037_assert(pg_temp.t4037_sqlstate_as('anon', NULL,
  $q$SELECT public.entity_traffic_rollup('40371000-0000-4000-8000-0000000000b1', 'brand', NULL, '30d')$q$) = '42501',
  'A1 anon cannot call entity_traffic_rollup');
SELECT pg_temp.t4037_assert(pg_temp.t4037_sqlstate_as('authenticated', '40371000-0000-4000-8000-0000000000a2', q) = '42501',
  'A1 authenticated cannot run ' || q)
FROM unnest(ARRAY[
  $q$SELECT public.claim_offering_engagement_salt('40371000-0000-4000-8000-0000000000b1', repeat('a', 64))$q$,
  $q$SELECT public.capture_offering_engagement_event(gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1', 'brand', NULL, 'page_view', NULL, 'buyer_web', repeat('a', 64), NULL, NULL, NULL, NULL, false, false)$q$,
  $q$SELECT public.offering_engagement_capture_at(gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1', 'brand', NULL, 'page_view', NULL, 'buyer_web', repeat('a', 64), NULL, NULL, NULL, NULL, false, false, now())$q$,
  $q$SELECT public.offering_engagement_claim_salt_at('40371000-0000-4000-8000-0000000000b1', repeat('a', 64), now())$q$,
  $q$SELECT public.cleanup_offering_engagement(1)$q$,
  $q$SELECT public.offering_traffic_period('40371000-0000-4000-8000-0000000000b1', NULL, NULL, NULL, current_date, 'UTC', 'GBP', true)$q$,
  $q$SELECT public.offering_traffic_rollup_envelope('40371000-0000-4000-8000-0000000000b1', NULL, NULL, '30d', true)$q$,
  $q$SELECT public.offering_traffic_brand_timezone('40371000-0000-4000-8000-0000000000b1')$q$,
  $q$SELECT count(*) FROM public.offering_engagement_events$q$,
  $q$SELECT count(*) FROM public.offering_engagement_daily$q$,
  $q$SELECT count(*) FROM public.offering_engagement_brand_daily$q$,
  $q$SELECT count(*) FROM public.offering_engagement_salts$q$,
  $q$SELECT count(*) FROM public.offering_engagement_visitor_marks$q$,
  $q$INSERT INTO public.offering_engagement_daily(brand_id, entity_type, entity_id, day, source) VALUES ('40371000-0000-4000-8000-0000000000b1', 'brand', NULL, current_date, 'search')$q$
]) AS q;
SELECT pg_temp.t4037_assert(c.relrowsecurity AND c.relforcerowsecurity, 'A1 RLS forced on ' || c.relname)
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'offering_engagement_%' AND c.relkind = 'r';

-- ── A2: the capture refuses pages that are not the brand's ───────────────────
SELECT pg_temp.t4037_assert(public.offering_engagement_capture_at(
  gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1', 'event',
  '40371000-0000-4000-8000-0000000000e9', 'page_view', NULL, 'buyer_web',
  pg_temp.t4037_key('x'), NULL, NULL, NULL, NULL, false, false, now()) = 'unknown_page',
  'A2 another brand''s event cannot be credited to this brand');
SELECT pg_temp.t4037_assert(public.offering_engagement_capture_at(
  gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1', 'event',
  '40371000-0000-4000-8000-0000000000e2', 'page_view', NULL, 'buyer_web',
  pg_temp.t4037_key('x'), NULL, NULL, NULL, NULL, false, false, now()) = 'unknown_page',
  'A2 a trip cannot be recorded as an event page');
SELECT pg_temp.t4037_assert(public.offering_engagement_capture_at(
  gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1', 'venue',
  '40371000-0000-4000-8000-0000000000e1', 'page_view', NULL, 'buyer_web',
  pg_temp.t4037_key('x'), NULL, NULL, NULL, NULL, false, false, now()) = 'unknown_page',
  'A2 an event id cannot be recorded as a venue page');
SELECT pg_temp.t4037_assert(public.offering_engagement_capture_at(
  gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1', 'event',
  '40371000-0000-4000-8000-0000000000e1', 'cta_click', NULL, 'buyer_web',
  pg_temp.t4037_key('x'), NULL, NULL, NULL, NULL, false, false, now()) = 'invalid',
  'A2 a tap without a tap type is invalid');
SELECT pg_temp.t4037_assert(public.offering_engagement_capture_at(
  gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1', 'event',
  '40371000-0000-4000-8000-0000000000e1', 'page_view', NULL, 'buyer_web',
  'not-a-hash', NULL, NULL, NULL, NULL, false, false, now()) = 'invalid',
  'A2 a malformed visitor key is invalid');
SELECT pg_temp.t4037_assert(NOT EXISTS (SELECT 1 FROM public.offering_engagement_events)
  AND NOT EXISTS (SELECT 1 FROM public.offering_engagement_daily),
  'A2 refused captures write nothing');

-- ── A3: Lagos midnight (UTC+1) and first-touch reset the next day ───────────
-- 22:30Z on 14 Jan is 23:30 on 14 Jan in Lagos; 23:30Z is 00:30 on 15 Jan.
SELECT pg_temp.t4037_assert(public.offering_engagement_capture_at(
  '40371000-0000-4000-8000-000000000301', '40371000-0000-4000-8000-0000000000b1', 'brand', NULL,
  'page_view', NULL, 'buyer_web', pg_temp.t4037_key('night'), NULL, NULL, 'instagram.com', '/',
  false, false, '2027-01-14 22:30:00+00') = 'counted', 'A3 late view');
SELECT pg_temp.t4037_assert(public.offering_engagement_capture_at(
  '40371000-0000-4000-8000-000000000302', '40371000-0000-4000-8000-0000000000b1', 'event',
  '40371000-0000-4000-8000-0000000000e1', 'page_view', NULL, 'buyer_web', pg_temp.t4037_key('night'),
  NULL, NULL, 'google.com', '/', false, false, '2027-01-14 22:50:00+00') = 'counted', 'A3 same-day second page');
SELECT pg_temp.t4037_assert(public.offering_engagement_capture_at(
  '40371000-0000-4000-8000-000000000303', '40371000-0000-4000-8000-0000000000b1', 'event',
  '40371000-0000-4000-8000-0000000000e1', 'page_view', NULL, 'buyer_web', pg_temp.t4037_key('night'),
  NULL, NULL, 'google.com', '/', false, false, '2027-01-14 23:30:00+00') = 'counted',
  'A3 after Lagos midnight (also >30 minutes later)');
SELECT pg_temp.t4037_assert((
  SELECT array_agg(day::text || ':' || source || ':' || visitors ORDER BY day, source)
  FROM public.offering_engagement_brand_daily
  WHERE brand_id = '40371000-0000-4000-8000-0000000000b1'
) = ARRAY['2027-01-14:social:1', '2027-01-15:search:1'],
  'A3 one brand visitor per Lagos day; first touch resets at Lagos midnight, not UTC midnight');

-- ── A4: source rules (§2) ───────────────────────────────────────────────────
SELECT pg_temp.t4037_assert(public.offering_traffic_event_source(
  '40371000-0000-4000-8000-0000000000b1', 'buyer_web', c.mc, c.host, c.path, c.share, c.utm) = c.expected,
  'A4 source ' || c.label || ' expected ' || c.expected)
FROM (VALUES
  ('resolvable mc_id beats a social referrer', 'adv-4037-campaign', 'instagram.com', '/', false, false, 'mingla_ads'),
  ('mc_id by campaign uuid', '40371000-0000-4000-8000-0000000000aa', NULL, NULL, false, false, 'mingla_ads'),
  ('unresolvable mc_id on IG link-in-bio is social', 'not-a-campaign', 'l.instagram.com', '/', false, false, 'social'),
  ('host ad outside Mingla (fbclid, no mc_id) is social', NULL, 'm.facebook.com', '/', false, false, 'social'),
  ('Mingla share link', NULL, 'wa.me', '/', true, false, 'mingla_app'),
  ('Mingla explore page', NULL, 'usemingla.com', '/explore/lagos', false, false, 'mingla_app'),
  ('Mingla marketing page that is not discovery', NULL, 'usemingla.com', '/pricing', false, false, 'direct_unknown'),
  ('search engine', NULL, 'google.co.uk', '/', false, false, 'search'),
  ('non-Mingla UTM tags', NULL, 'newsletter.example', '/', false, true, 'own_links'),
  ('a look-alike host is not social', NULL, 'notinstagram.com', '/', false, false, 'direct_unknown'),
  ('no referrer at all', NULL, NULL, NULL, false, false, 'direct_unknown')
) AS c(label, mc, host, path, share, utm, expected);
SELECT pg_temp.t4037_assert(public.offering_traffic_event_source(
  '40371000-0000-4000-8000-0000000000b1', s, NULL, NULL, NULL, false, false) = 'mingla_app',
  'A4 consumer app surface ' || s || ' is mingla_app')
FROM unnest(ARRAY['consumer_ios', 'consumer_android']) s;
SELECT pg_temp.t4037_assert(public.offering_traffic_sale_source(c.has, c.entry, c.click, NULL, NULL) = c.expected,
  'A4 sale source ' || COALESCE(c.entry, 'null') || ' expected ' || c.expected)
FROM (VALUES
  (false, NULL::text, NULL::text, 'direct_unknown'),
  (true, 'ad', 'c', 'mingla_ads'),
  (true, 'search', 'c', 'search'),
  (true, 'social', 'c', 'social'),
  (true, 'organic', 'c', 'mingla_app'),
  (true, 'direct', 'c', 'direct_unknown'),
  (true, 'unknown', 'c', 'direct_unknown'),
  (true, NULL, 'legacy-click', 'mingla_ads'),
  (true, NULL, NULL, 'direct_unknown')
) AS c(has, entry, click, expected);

-- ── A5: dedupe of impressions and checkouts ─────────────────────────────────
SELECT pg_temp.t4037_assert(
  public.offering_engagement_capture_at(gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1',
    'trip', '40371000-0000-4000-8000-0000000000e2', 'app_impression', NULL, 'consumer_ios',
    pg_temp.t4037_key('imp'), NULL, NULL, NULL, NULL, false, false, '2027-02-01 10:00:00+00') = 'counted'
  AND public.offering_engagement_capture_at(gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1',
    'trip', '40371000-0000-4000-8000-0000000000e2', 'app_impression', NULL, 'consumer_ios',
    pg_temp.t4037_key('imp'), NULL, NULL, NULL, NULL, false, false, '2027-02-01 18:00:00+00') = 'duplicate_impression'
  AND public.offering_engagement_capture_at(gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1',
    'trip', '40371000-0000-4000-8000-0000000000e2', 'app_impression', NULL, 'consumer_ios',
    pg_temp.t4037_key('imp'), NULL, NULL, NULL, NULL, false, false, '2027-02-02 10:00:00+00') = 'counted',
  'A5 app impression counts once per visitor, offering and Lagos day');
SELECT pg_temp.t4037_assert(
  public.offering_engagement_capture_at(gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1',
    'event', '40371000-0000-4000-8000-0000000000e1', 'checkout_start', NULL, 'buyer_web',
    pg_temp.t4037_key('co'), '40371000-0000-4000-8000-0000000000cc', NULL, NULL, NULL, false, false,
    '2027-02-01 10:00:00+00') = 'counted'
  AND public.offering_engagement_capture_at(gen_random_uuid(), '40371000-0000-4000-8000-0000000000b1',
    'event', '40371000-0000-4000-8000-0000000000e1', 'checkout_start', NULL, 'buyer_web',
    pg_temp.t4037_key('co-other-device'), '40371000-0000-4000-8000-0000000000cc', NULL, NULL, NULL, false, false,
    '2027-02-01 12:00:00+00') = 'duplicate_checkout',
  'A5 a checkout session starts once, whoever reports it');
SELECT pg_temp.t4037_assert((
  SELECT sum(app_impressions) = 2 AND sum(checkout_starts) = 1 AND sum(visitors) FILTER (
    WHERE entity_type = 'trip') = 0
  FROM public.offering_engagement_daily WHERE day IN ('2027-02-01', '2027-02-02')
), 'A5 impressions are not visits');

-- ── A6: 120 events per visitor per hour, the rest dropped ───────────────────
DO $$
DECLARE
  v_outcome text;
  v_counted integer := 0;
BEGIN
  FOR i IN 1..125 LOOP
    v_outcome := public.offering_engagement_capture_at(gen_random_uuid(),
      '40371000-0000-4000-8000-0000000000b1', 'event', '40371000-0000-4000-8000-0000000000e1',
      'cta_click', 'share', 'buyer_web', pg_temp.t4037_key('flood'), NULL, NULL, NULL, NULL,
      false, false, '2027-03-01 10:00:00+00'::timestamptz + make_interval(secs => i));
    IF v_outcome = 'counted' THEN v_counted := v_counted + 1; END IF;
  END LOOP;
  PERFORM pg_temp.t4037_assert(v_counted = 120, 'A6 exactly 120 counted, got ' || v_counted);
  PERFORM pg_temp.t4037_assert(public.offering_engagement_capture_at(gen_random_uuid(),
      '40371000-0000-4000-8000-0000000000b1', 'event', '40371000-0000-4000-8000-0000000000e1',
      'cta_click', 'share', 'buyer_web', pg_temp.t4037_key('flood'), NULL, NULL, NULL, NULL,
      false, false, '2027-03-01 11:05:00+00') = 'counted', 'A6 the limit is per hour');
  PERFORM pg_temp.t4037_assert((SELECT sum(cta_share) FROM public.offering_engagement_daily
    WHERE day = '2027-03-01') = 121, 'A6 dropped events never reach the daily counts');
END
$$;

-- ── A7: access and cross-brand detail (decision 4) ──────────────────────────
DO $$
DECLARE
  v jsonb;
  v_empty_totals constant jsonb := '{"page_views":0,"visitors":0,"button_taps":0,"checkout_starts":0,"bookings":0,"customers":0,"mingla_customers":0,"mingla_visitors":0,"booking_value":{},"value_mingla_brought":{},"primary_currency":null}';
  v_member constant text := '40371000-0000-4000-8000-0000000000a2';
  v_stranger constant text := '40371000-0000-4000-8000-0000000000a3';
BEGIN
  v := pg_temp.t4037_as(v_stranger,
    $q$SELECT public.brand_traffic_rollup('40371000-0000-4000-8000-0000000000b1', '30d')$q$);
  PERFORM pg_temp.t4037_assert(v = jsonb_build_object(
    'brand_id', '40371000-0000-4000-8000-0000000000b1', 'authorized', false, 'range', '30d',
    'totals', v_empty_totals, 'prior', v_empty_totals, 'daily', '[]'::jsonb,
    'sources', '[]'::jsonb, 'ctas', '[]'::jsonb, 'pages', '[]'::jsonb,
    'capture_started_at', NULL, 'window_complete', false),
    'A7 a non-member gets the honest empty result and nothing else: ' || v::text);

  v := pg_temp.t4037_as(v_stranger,
    $q$SELECT public.entity_traffic_rollup('40371000-0000-4000-8000-0000000000b1', 'event', '40371000-0000-4000-8000-0000000000e1', '30d')$q$);
  PERFORM pg_temp.t4037_assert((v ->> 'authorized')::boolean = false AND v -> 'totals' = v_empty_totals
    AND v -> 'sources' = '[]'::jsonb, 'A7 a non-member cannot read a page');

  -- The member of Lagos names Lagos but asks for the other brand's event.
  v := pg_temp.t4037_as(v_member,
    $q$SELECT public.entity_traffic_rollup('40371000-0000-4000-8000-0000000000b1', 'event', '40371000-0000-4000-8000-0000000000e9', '30d')$q$);
  PERFORM pg_temp.t4037_assert((v ->> 'authorized')::boolean = false AND v -> 'totals' = v_empty_totals,
    'A7 a page of another brand is refused even to a member of the named brand');
  -- ...or names the other brand directly.
  v := pg_temp.t4037_as(v_member,
    $q$SELECT public.entity_traffic_rollup('40371000-0000-4000-8000-0000000000b2', 'event', '40371000-0000-4000-8000-0000000000e9', '30d')$q$);
  PERFORM pg_temp.t4037_assert((v ->> 'authorized')::boolean = false,
    'A7 a member of one brand cannot read another brand''s page');
  v := pg_temp.t4037_as(v_member,
    $q$SELECT public.brand_traffic_rollup('40371000-0000-4000-8000-0000000000b2', '7d')$q$);
  PERFORM pg_temp.t4037_assert((v ->> 'authorized')::boolean = false,
    'A7 a member of one brand cannot read another brand');
  -- A trip asked for as an event is not that brand's event.
  v := pg_temp.t4037_as(v_member,
    $q$SELECT public.entity_traffic_rollup('40371000-0000-4000-8000-0000000000b1', 'event', '40371000-0000-4000-8000-0000000000e2', '30d')$q$);
  PERFORM pg_temp.t4037_assert((v ->> 'authorized')::boolean = false,
    'A7 the page type must match the page');

  PERFORM pg_temp.t4037_assert(pg_temp.t4037_sqlstate_as('authenticated', v_member,
    $q$SELECT public.brand_traffic_rollup('40371000-0000-4000-8000-0000000000b1', '14d')$q$) = '22023',
    'A7 an unknown range is refused');
  PERFORM pg_temp.t4037_assert(pg_temp.t4037_sqlstate_as('authenticated', v_member,
    $q$SELECT public.entity_traffic_rollup('40371000-0000-4000-8000-0000000000b1', 'event', NULL, '30d')$q$) = '22023',
    'A7 a non-brand page without an id is refused');
  PERFORM pg_temp.t4037_assert(pg_temp.t4037_sqlstate_as('authenticated', v_member,
    $q$SELECT public.entity_traffic_rollup('40371000-0000-4000-8000-0000000000b1', 'brand', '40371000-0000-4000-8000-0000000000b1', '30d')$q$) = '22023',
    'A7 the brand page has no entity id');
END
$$;

-- ── A8: conversions come only from completed sales (decision 5) ─────────────
DO $$
DECLARE
  v jsonb;
  v_member constant text := '40371000-0000-4000-8000-0000000000a2';
  v_now timestamptz := now() - interval '3 hours';
BEGIN
  -- Taps on buy / rsvp / book are engagement, never bookings.
  PERFORM public.offering_engagement_capture_at(gen_random_uuid(),
    '40371000-0000-4000-8000-0000000000b1', 'event', '40371000-0000-4000-8000-0000000000e1',
    'cta_click', t, 'buyer_web', pg_temp.t4037_key('tapper'), NULL, NULL, NULL, NULL, false, false, v_now)
  FROM unnest(ARRAY['buy', 'rsvp', 'book', 'view_brand', 'view_venue', 'view_offering']) t;

  v := pg_temp.t4037_as(v_member,
    $q$SELECT public.brand_traffic_rollup('40371000-0000-4000-8000-0000000000b1', '7d')$q$);
  PERFORM pg_temp.t4037_assert((v #>> '{totals,button_taps}')::int = 6,
    'A8 six taps (including view taps) are engagement');
  PERFORM pg_temp.t4037_assert((v #>> '{totals,bookings}')::int = 3,
    'A8 bookings = paid online order + live Mingla reservation + going/approved RSVP; got '
      || (v #>> '{totals,bookings}'));
  PERFORM pg_temp.t4037_assert(v #> '{totals,booking_value}' = '{"NGN": 600000}'::jsonb,
    'A8 value excludes pending, failed, refunded, door and cancelled sales; got '
      || (v #> '{totals,booking_value}')::text);
  PERFORM pg_temp.t4037_assert(v #> '{totals,value_mingla_brought}' = '{}'::jsonb
    AND (v #>> '{totals,mingla_customers}')::int = 0,
    'A8 untouched sales are direct_unknown, never claimed by Mingla');
  PERFORM pg_temp.t4037_assert((
    SELECT array_agg((p ->> 'entity_type') || ':' || (p ->> 'bookings'))
    FROM jsonb_array_elements(v -> 'pages') p
  ) @> ARRAY['venue:1', 'event:1', 'brand:0'], 'A8 venue and event pages carry their own bookings');
  PERFORM pg_temp.t4037_assert(v #>> '{totals,primary_currency}' = 'NGN', 'A8 primary currency');
END
$$;

DO $$ BEGIN RAISE NOTICE '#4037 tester adversarial: PASS'; END $$;
ROLLBACK;

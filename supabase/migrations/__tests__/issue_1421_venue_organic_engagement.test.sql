\set ON_ERROR_STOP on

DO $test$
DECLARE
  v_command text;
BEGIN
  IF to_regclass('public.venue_organic_journeys') IS NULL
     OR to_regclass('public.venue_organic_engagement_events') IS NULL
     OR to_regclass('public.venue_organic_reservation_attributions') IS NULL THEN
    RAISE EXCEPTION 'issue1421 tables missing';
  END IF;
  IF has_table_privilege('anon', 'public.venue_organic_journeys', 'SELECT')
     OR has_table_privilege('authenticated', 'public.venue_organic_engagement_events', 'SELECT') THEN
    RAISE EXCEPTION 'issue1421 raw table grant leaked';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.venue_organic_engagement_rollup(uuid,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.venue_organic_engagement_rollup(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue1421 aggregate RPC grant invalid';
  END IF;
  SELECT command INTO v_command
  FROM cron.job
  WHERE jobname = 'issue_1421_venue_organic_retention'
    AND active
    AND schedule = '17 3 * * *';
  IF v_command IS DISTINCT FROM
    'SELECT public.cleanup_venue_organic_engagement(5000);' THEN
    RAISE EXCEPTION 'issue1421 retention job invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.reservation_checkout_sessions'::regclass
      AND tgname = 'reservation_checkout_sessions_attribute_organic'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'issue1421 attribution trigger missing';
  END IF;
  RAISE NOTICE 'issue1421 schema/grants/retention/trigger PASS';
END
$test$;

-- Executable happy-path/isolation/retention proof. Everything below rolls back.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES
  (
    '00000000-1421-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'issue1421-owner@example.test',
    now(), now()
  ),
  (
    '00000000-1421-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'issue1421-outsider@example.test',
    now(), now()
  );
INSERT INTO public.creator_accounts(id, created_at) VALUES
  ('00000000-1421-4000-8000-000000000001', now()),
  ('00000000-1421-4000-8000-000000000002', now());

INSERT INTO public.place_pool(
  id, name, lat, lng, utc_offset_minutes, created_at
) VALUES
  (
    '00000000-1421-4000-8000-000000000101',
    'Issue 1421 Venue A', 40.7, -74.0, 0, now()
  ),
  (
    '00000000-1421-4000-8000-000000000102',
    'Issue 1421 Venue B', 40.8, -74.1, 0, now()
  );
INSERT INTO public.brands(
  id, account_id, default_currency, name, slug, created_at
) VALUES (
  '00000000-1421-4000-8000-000000000201',
  '00000000-1421-4000-8000-000000000001',
  'USD', 'Issue 1421 Brand',
  'issue-1421-brand-' || substr(md5(random()::text), 1, 8),
  now()
);
INSERT INTO public.venue_listings(
  id, brand_id, place_pool_id, slug, name, lat, lng, venue_category
) VALUES
  (
    '00000000-1421-4000-8000-000000000301',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000101',
    'issue1421a' || substr(md5(random()::text), 1, 8),
    'Issue 1421 A', 40.7, -74.0, 'restaurant'
  ),
  (
    '00000000-1421-4000-8000-000000000302',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000102',
    'issue1421b' || substr(md5(random()::text), 1, 8),
    'Issue 1421 B', 40.8, -74.1, 'restaurant'
  );
INSERT INTO public.venue_availability_config(
  brand_id, venue_id, place_pool_id, iana_timezone
) VALUES
  (
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    '00000000-1421-4000-8000-000000000101',
    'UTC'
  ),
  (
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000302',
    '00000000-1421-4000-8000-000000000102',
    'UTC'
  );
INSERT INTO public.venue_reservation_settings(
  brand_id, venue_id, place_pool_id, reservations_enabled
) VALUES (
  '00000000-1421-4000-8000-000000000201',
  '00000000-1421-4000-8000-000000000301',
  '00000000-1421-4000-8000-000000000101',
  true
);
UPDATE public.venue_organic_capture_config
SET capture_started_at = now()
WHERE singleton;

INSERT INTO public.venue_organic_journeys(
  id, token_hash, brand_id, venue_id, entry_source, surface,
  created_at, expires_at
) VALUES
  (
    '00000000-1421-4000-8000-000000000401',
    repeat('a', 64),
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    'direct', 'buyer_web', now() - interval '23 hours', now() + interval '1 hour'
  ),
  (
    '00000000-1421-4000-8000-000000000402',
    repeat('b', 64),
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000302',
    'search', 'buyer_web', now() - interval '23 hours', now() + interval '1 hour'
  );

-- Exact boundaries: 04:59/21:00 late-night, 05:00/11:59 morning,
-- 12:00/16:59 afternoon, 17:00/20:59 evening.
INSERT INTO public.venue_organic_engagement_events(
  id, journey_id, brand_id, venue_id, event_type, surface, occurred_at
)
SELECT
  gen_random_uuid(),
  '00000000-1421-4000-8000-000000000401',
  '00000000-1421-4000-8000-000000000201',
  '00000000-1421-4000-8000-000000000301',
  'page_view',
  'buyer_web',
  date_trunc('day', now()) - interval '1 day' + boundary.offset_value
FROM unnest(ARRAY[
  interval '4 hours 59 minutes',
  interval '5 hours',
  interval '11 hours 59 minutes',
  interval '12 hours',
  interval '16 hours 59 minutes',
  interval '17 hours',
  interval '20 hours 59 minutes',
  interval '21 hours'
]) AS boundary(offset_value);

INSERT INTO public.venue_organic_engagement_events(
  id, journey_id, brand_id, venue_id, event_type, surface, occurred_at
) VALUES
  (
    '00000000-1421-4000-8000-000000000501',
    '00000000-1421-4000-8000-000000000401',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    'menu_open', 'buyer_web', now() - interval '29 days 23 hours'
  ),
  (
    '00000000-1421-4000-8000-000000000502',
    '00000000-1421-4000-8000-000000000401',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    'menu_open', 'buyer_web', now() - interval '30 days 1 minute'
  ),
  (
    '00000000-1421-4000-8000-000000000503',
    '00000000-1421-4000-8000-000000000401',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    'availability_shown', 'buyer_web', now() - interval '1 hour'
  ),
  (
    '00000000-1421-4000-8000-000000000504',
    '00000000-1421-4000-8000-000000000402',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000302',
    'page_view', 'buyer_web', now() - interval '1 hour'
  );
-- Database idempotency mirrors the public endpoint's ignoreDuplicates upsert.
INSERT INTO public.venue_organic_engagement_events(
  id, journey_id, brand_id, venue_id, event_type, surface, occurred_at
) VALUES (
  '00000000-1421-4000-8000-000000000503',
  '00000000-1421-4000-8000-000000000401',
  '00000000-1421-4000-8000-000000000201',
  '00000000-1421-4000-8000-000000000301',
  'availability_shown', 'buyer_web', now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.reservations(
  id, brand_id, venue_id, reserved_for, party_size, status, source,
  guest_email, fee_cents, fee_currency, payment_status, created_at
) VALUES
  (
    '00000000-1421-4000-8000-000000000601',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    now() + interval '1 day', 2, 'confirmed', 'website',
    'live@example.test', 0, 'USD', 'none', now()
  ),
  (
    '00000000-1421-4000-8000-000000000602',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    now() + interval '1 day', 2, 'cancelled_by_guest', 'website',
    'cancelled@example.test', 0, 'USD', 'none', now()
  ),
  (
    '00000000-1421-4000-8000-000000000603',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    now() + interval '1 day', 2, 'confirmed', 'website',
    'old@example.test', 0, 'USD', 'none', now() - interval '31 days'
  ),
  (
    '00000000-1421-4000-8000-000000000604',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    now() + interval '1 day', 2, 'confirmed', 'website',
    'mismatch@example.test', 0, 'USD', 'none', now()
  );

INSERT INTO public.reservation_checkout_sessions(
  id, brand_id, venue_id, place_pool_id, reserved_for, party_size,
  buyer_name, buyer_email, buyer_phone_e164, amount_cents, currency,
  created_via, status, reservation_id, organic_journey_id
) VALUES
  (
    '00000000-1421-4000-8000-000000000701',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    '00000000-1421-4000-8000-000000000101',
    now() + interval '1 day', 2, 'Live', 'live@example.test',
    '+15555550101', 0, 'USD', 'web', 'pending',
    '00000000-1421-4000-8000-000000000601',
    '00000000-1421-4000-8000-000000000401'
  ),
  (
    '00000000-1421-4000-8000-000000000702',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    '00000000-1421-4000-8000-000000000101',
    now() + interval '1 day', 2, 'Cancelled', 'cancelled@example.test',
    '+15555550102', 0, 'USD', 'web', 'completed',
    '00000000-1421-4000-8000-000000000602',
    '00000000-1421-4000-8000-000000000401'
  ),
  (
    '00000000-1421-4000-8000-000000000703',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    '00000000-1421-4000-8000-000000000101',
    now() + interval '1 day', 2, 'Old', 'old@example.test',
    '+15555550103', 0, 'USD', 'web', 'completed',
    '00000000-1421-4000-8000-000000000603',
    '00000000-1421-4000-8000-000000000401'
  ),
  (
    '00000000-1421-4000-8000-000000000704',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    '00000000-1421-4000-8000-000000000101',
    now() + interval '1 day', 2, 'Mismatch', 'mismatch@example.test',
    '+15555550104', 0, 'USD', 'web', 'completed',
    '00000000-1421-4000-8000-000000000604',
    '00000000-1421-4000-8000-000000000402'
  );
UPDATE public.reservation_checkout_sessions
SET status = 'completed'
WHERE id = '00000000-1421-4000-8000-000000000701';
-- Re-fire an unrelated update: reservation attribution must remain one row.
UPDATE public.reservation_checkout_sessions
SET updated_at = now()
WHERE id = '00000000-1421-4000-8000-000000000701';

DO $happy$
DECLARE
  v_a jsonb;
  v_b jsonb;
  v_denied jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '00000000-1421-4000-8000-000000000001',
      'role', 'authenticated'
    )::text,
    true
  );
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-1421-4000-8000-000000000001',
    true
  );
  v_a := public.venue_organic_engagement_rollup(
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301'
  );
  v_b := public.venue_organic_engagement_rollup(
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000302'
  );
  IF (v_a->>'authorized')::boolean IS DISTINCT FROM true
    OR (v_a->>'page_views')::bigint <> 8
    OR (v_a->>'menu_opens')::bigint <> 1
    OR (v_a->>'availability_shown')::bigint <> 1
    OR (v_a->>'reservations_made')::bigint <> 1
    OR (v_a->'dayparts'->>'morning')::bigint <> 2
    OR (v_a->'dayparts'->>'afternoon')::bigint <> 2
    OR (v_a->'dayparts'->>'evening')::bigint <> 2
    OR (v_a->'dayparts'->>'late_night')::bigint <> 2
    OR (v_a->>'window_complete')::boolean IS DISTINCT FROM false
    OR v_a->>'resolved_timezone' <> 'UTC'
    OR v_a->>'tz_confidence' <> 'iana'
  THEN
    RAISE EXCEPTION 'H-1 exact venue/daypart/window/attribution FAIL: %', v_a;
  END IF;
  IF (v_b->>'authorized')::boolean IS DISTINCT FROM true
    OR (v_b->>'page_views')::bigint <> 1
    OR (v_b->>'reservations_made')::bigint <> 0
  THEN
    RAISE EXCEPTION 'H-2 sibling venue isolation FAIL: %', v_b;
  END IF;
  IF (
    SELECT count(*) FROM public.venue_organic_reservation_attributions
    WHERE reservation_id = '00000000-1421-4000-8000-000000000601'
  ) <> 1 OR EXISTS (
    SELECT 1 FROM public.venue_organic_reservation_attributions
    WHERE reservation_id = '00000000-1421-4000-8000-000000000604'
  ) THEN
    RAISE EXCEPTION 'H-3 trigger idempotency/token-venue mismatch FAIL';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-1421-4000-8000-000000000002',
    true
  );
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '00000000-1421-4000-8000-000000000002',
      'role', 'authenticated'
    )::text,
    true
  );
  v_denied := public.venue_organic_engagement_rollup(
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301'
  );
  IF (v_denied->>'authorized')::boolean IS DISTINCT FROM false
    OR (SELECT count(*) FROM jsonb_object_keys(v_denied)) <> 3
  THEN
    RAISE EXCEPTION 'H-4 outsider denial envelope FAIL: %', v_denied;
  END IF;
  v_denied := public.venue_organic_engagement_rollup(
    '00000000-1421-4000-8000-000000000999',
    '00000000-1421-4000-8000-000000000301'
  );
  IF (v_denied->>'authorized')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'H-5 brand/venue mismatch FAIL: %', v_denied;
  END IF;
END
$happy$;

DO $privileges$
BEGIN
  IF has_table_privilege(
    'anon', 'public.venue_organic_engagement_events', 'SELECT'
  ) OR has_table_privilege(
    'authenticated', 'public.venue_organic_reservation_attributions', 'SELECT'
  ) OR has_function_privilege(
    'anon', 'public.venue_organic_engagement_rollup(uuid,uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'H-6 raw privilege denial FAIL';
  END IF;
END
$privileges$;

-- Two event-backed old journeys prove the per-table limit; an old
-- attribution-backed journey proves deletion order is FK-safe.
INSERT INTO public.venue_organic_journeys(
  id, token_hash, brand_id, venue_id, entry_source, surface,
  created_at, expires_at
) VALUES
  (
    '00000000-1421-4000-8000-000000000801', repeat('c', 64),
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    'direct', 'buyer_web', now() - interval '37 days',
    now() - interval '36 days 23 hours'
  ),
  (
    '00000000-1421-4000-8000-000000000802', repeat('d', 64),
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    'direct', 'buyer_web', now() - interval '37 days',
    now() - interval '36 days 23 hours'
  ),
  (
    '00000000-1421-4000-8000-000000000803', repeat('e', 64),
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    'direct', 'buyer_web', now() - interval '37 days',
    now() - interval '36 days 23 hours'
  );
INSERT INTO public.venue_organic_engagement_events(
  id, journey_id, brand_id, venue_id, event_type, surface, occurred_at
) VALUES
  (
    '00000000-1421-4000-8000-000000000901',
    '00000000-1421-4000-8000-000000000801',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    'page_view', 'buyer_web', now() - interval '36 days'
  ),
  (
    '00000000-1421-4000-8000-000000000902',
    '00000000-1421-4000-8000-000000000802',
    '00000000-1421-4000-8000-000000000201',
    '00000000-1421-4000-8000-000000000301',
    'page_view', 'buyer_web', now() - interval '36 days'
  );
INSERT INTO public.venue_organic_reservation_attributions(
  reservation_id, journey_id, brand_id, venue_id, attributed_at
) VALUES (
  '00000000-1421-4000-8000-000000000603',
  '00000000-1421-4000-8000-000000000803',
  '00000000-1421-4000-8000-000000000201',
  '00000000-1421-4000-8000-000000000301',
  now() - interval '36 days'
) ON CONFLICT (reservation_id) DO UPDATE
SET journey_id = EXCLUDED.journey_id,
    attributed_at = EXCLUDED.attributed_at;

DO $retention$
DECLARE
  v_events bigint;
  v_attributions bigint;
  v_journeys bigint;
BEGIN
  SELECT events_deleted, attributions_deleted, journeys_deleted
  INTO v_events, v_attributions, v_journeys
  FROM public.cleanup_venue_organic_engagement(1);
  IF v_events <> 1 OR v_attributions <> 1
    OR v_journeys < 1 OR v_journeys > 1
  THEN
    RAISE EXCEPTION 'H-7 bounded cleanup FAIL: %, %, %',
      v_events, v_attributions, v_journeys;
  END IF;
  PERFORM public.cleanup_venue_organic_engagement(5000);
  IF EXISTS (
    SELECT 1 FROM public.venue_organic_journeys
    WHERE id IN (
      '00000000-1421-4000-8000-000000000801',
      '00000000-1421-4000-8000-000000000802',
      '00000000-1421-4000-8000-000000000803'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.venue_organic_engagement_events
    WHERE id IN (
      '00000000-1421-4000-8000-000000000901',
      '00000000-1421-4000-8000-000000000902'
    )
  ) THEN
    RAISE EXCEPTION 'H-8 FK-safe retention completion FAIL';
  END IF;
END
$retention$;

ROLLBACK;

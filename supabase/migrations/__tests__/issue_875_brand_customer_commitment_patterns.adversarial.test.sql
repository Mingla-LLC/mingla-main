-- ISSUE #875 — tester-owned adversarial regression suite.
-- Applies after all repository migrations on PostgreSQL 17.
-- Fixtures are transaction-local and leave no rows behind.

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.issue875_uuid(p_seed text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(p_seed)::uuid
$$;

CREATE OR REPLACE FUNCTION pg_temp.issue875_seed_event_orders(
  p_brand_id uuid,
  p_owner_id uuid,
  p_tag text,
  p_event_type text,
  p_start_at timestamptz,
  p_timezone text,
  p_count integer,
  p_checkout_at timestamptz DEFAULT now()
)
RETURNS TABLE(event_id uuid, event_date_id uuid, first_order_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid := pg_temp.issue875_uuid(p_tag || ':event');
  v_event_date_id uuid := pg_temp.issue875_uuid(p_tag || ':date');
  v_order_id uuid;
  v_index integer;
BEGIN
  INSERT INTO public.events (
    id, brand_id, created_by, title, slug, timezone, event_type, created_at
  )
  VALUES (
    v_event_id,
    p_brand_id,
    p_owner_id,
    'Issue 875 ' || p_tag,
    'issue-875-' || substr(md5(p_tag), 1, 20),
    p_timezone,
    p_event_type,
    now()
  );

  INSERT INTO public.event_dates (
    id, event_id, start_at, end_at, timezone, is_master
  )
  VALUES (
    v_event_date_id,
    v_event_id,
    p_start_at,
    p_start_at + interval '2 hours',
    p_timezone,
    true
  );

  FOR v_index IN 1..p_count LOOP
    v_order_id := pg_temp.issue875_uuid(p_tag || ':order:' || v_index);
    INSERT INTO public.orders (
      id,
      event_id,
      event_date_id,
      buyer_email,
      buyer_phone_e164,
      confirmed_at,
      created_at,
      total_cents,
      refunded_amount_cents,
      payment_status,
      currency,
      source
    )
    VALUES (
      v_order_id,
      v_event_id,
      v_event_date_id,
      p_tag || '-' || v_index || '@adversarial.test',
      '+1555875' || lpad((abs(hashtext(p_tag || v_index::text)) % 100000)::text, 5, '0'),
      p_checkout_at,
      p_checkout_at,
      999999,
      0,
      'paid',
      'USD',
      'online_checkout'
    );
    IF v_index = 1 THEN
      first_order_id := v_order_id;
    END IF;
  END LOOP;

  event_id := v_event_id;
  event_date_id := v_event_date_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.issue875_local_start(
  p_days_ago integer,
  p_local_time time,
  p_timezone text DEFAULT 'UTC'
)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT (
    date_trunc('day', now() AT TIME ZONE p_timezone)
    - make_interval(days => p_days_ago)
    + p_local_time
  ) AT TIME ZONE p_timezone
$$;

-- One owner and isolated brands for independent adversarial scenarios.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES (
  '00000000-0875-4000-8000-00000000aa01',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'issue875-adversarial-owner@example.test',
  now(),
  now()
);

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-0875-4000-8000-00000000aa01', now());

INSERT INTO public.place_pool (id, name, lat, lng, created_at)
VALUES (
  '00000000-0875-4000-8000-00000000ac01',
  'Issue 875 adversarial place',
  40.7,
  -74.0,
  now()
);

INSERT INTO public.brands (
  id, account_id, place_pool_id, default_currency, name, slug, created_at
)
SELECT
  pg_temp.issue875_uuid('issue875:brand:' || series_number),
  '00000000-0875-4000-8000-00000000aa01',
  '00000000-0875-4000-8000-00000000ac01',
  'USD',
  'Issue 875 adversarial brand ' || series_number,
  'issue-875-adversarial-brand-' || series_number || '-' || substr(md5(random()::text), 1, 8),
  now()
FROM generate_series(1, 17) AS series_number;

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0875-4000-8000-00000000aa01',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0875-4000-8000-00000000aa01',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- A-1: a NULL-linked order on a multi-occurrence offering is excluded.
DO $test$
DECLARE
  v_brand uuid := pg_temp.issue875_uuid('issue875:brand:1');
  v_event uuid := pg_temp.issue875_uuid('a1:event');
  v_result jsonb;
BEGIN
  INSERT INTO public.events (
    id, brand_id, created_by, title, slug, timezone, event_type
  )
  VALUES (
    v_event,
    v_brand,
    '00000000-0875-4000-8000-00000000aa01',
    'A1 ambiguous',
    'issue-875-a1-' || substr(md5(random()::text), 1, 8),
    'UTC',
    'event'
  );
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  VALUES
    (
      pg_temp.issue875_uuid('a1:date:1'),
      v_event,
      pg_temp.issue875_local_start(7, time '09:00', 'UTC'),
      pg_temp.issue875_local_start(7, time '11:00', 'UTC'),
      'UTC',
      true
    ),
    (
      pg_temp.issue875_uuid('a1:date:2'),
      v_event,
      pg_temp.issue875_local_start(14, time '18:00', 'UTC'),
      pg_temp.issue875_local_start(14, time '20:00', 'UTC'),
      'UTC',
      false
    );
  INSERT INTO public.orders (
    id, event_id, event_date_id, buyer_email, buyer_phone_e164, confirmed_at, total_cents,
    payment_status, currency, source
  )
  VALUES (
    pg_temp.issue875_uuid('a1:order'),
    v_event,
    NULL,
    'ambiguous@adversarial.test',
    '+15558750101',
    now(),
    1,
    'paid',
    'USD',
    'online_checkout'
  );

  v_result := public.brand_customer_commitment_patterns_rollup(v_brand);
  IF (v_result->'days'->>'sample_commitments')::integer <> 0
    OR v_result->'days'->>'state' <> 'no_data'
  THEN
    RAISE EXCEPTION 'A-1 FAIL: ambiguous NULL occurrence was admitted: %', v_result;
  END IF;
  RAISE NOTICE 'A-1 PASS: ambiguous multi-occurrence NULL link excluded';
END;
$test$;

-- A-2: a non-NULL occurrence link belonging to another event is invalid and
-- must not fall back to the target event's sole valid date.
DO $test$
DECLARE
  v_brand uuid := pg_temp.issue875_uuid('issue875:brand:2');
  v_event uuid := pg_temp.issue875_uuid('a2:event');
  v_other_event uuid := pg_temp.issue875_uuid('a2:other:event');
  v_other_date uuid := pg_temp.issue875_uuid('a2:other:date');
  v_result jsonb;
BEGIN
  INSERT INTO public.events (
    id, brand_id, created_by, title, slug, timezone, event_type
  )
  VALUES
    (v_event,v_brand,'00000000-0875-4000-8000-00000000aa01','A2 target','issue-875-a2-target-'||substr(md5(random()::text),1,8),'UTC','event'),
    (v_other_event,v_brand,'00000000-0875-4000-8000-00000000aa01','A2 other','issue-875-a2-other-'||substr(md5(random()::text),1,8),'UTC','event');
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  VALUES
    (pg_temp.issue875_uuid('a2:target:date'),v_event,pg_temp.issue875_local_start(8,time '09:00'),pg_temp.issue875_local_start(8,time '11:00'),'UTC',true),
    (v_other_date,v_other_event,pg_temp.issue875_local_start(9,time '18:00'),pg_temp.issue875_local_start(9,time '20:00'),'UTC',true);
  INSERT INTO public.orders (
    id, event_id, event_date_id, buyer_email, buyer_phone_e164, confirmed_at, total_cents,
    payment_status, currency, source
  )
  VALUES (
    pg_temp.issue875_uuid('a2:order'),
    v_event,
    v_other_date,
    'mismatch@adversarial.test',
    '+15558750201',
    now(),
    1,
    'paid',
    'USD',
    'online_checkout'
  );

  v_result := public.brand_customer_commitment_patterns_rollup(v_brand);
  IF (v_result->'days'->>'sample_commitments')::integer <> 0 THEN
    RAISE EXCEPTION 'A-2 FAIL: mismatched explicit occurrence fell back: %', v_result;
  END IF;
  RAISE NOTICE 'A-2 PASS: mismatched explicit occurrence excluded without fallback';
END;
$test$;

-- A-3: invalid named timezone and missing venue timezone configuration are
-- both excluded. No UTC/fixed-offset fallback is permitted.
DO $test$
DECLARE
  v_brand uuid := pg_temp.issue875_uuid('issue875:brand:3');
  v_result jsonb;
BEGIN
  PERFORM pg_temp.issue875_seed_event_orders(
    v_brand,
    '00000000-0875-4000-8000-00000000aa01',
    'a3-invalid-zone',
    'event',
    pg_temp.issue875_local_start(10, time '12:00'),
    'UTC+99',
    1
  );

  INSERT INTO public.venue_listings (
    id, brand_id, slug, name, lat, lng, venue_category
  )
  VALUES (
    pg_temp.issue875_uuid('a3:venue'),
    v_brand,
    'issue875a3venue' || substr(md5(random()::text),1,8),
    'A3 venue',
    40.7,
    -74.0,
    'restaurant'
  );
  INSERT INTO public.reservations (
    id, brand_id, venue_id, reserved_for, party_size, status, source,
    guest_email, fee_cents, fee_currency, payment_status
  )
  VALUES (
    pg_temp.issue875_uuid('a3:reservation'),
    v_brand,
    pg_temp.issue875_uuid('a3:venue'),
    pg_temp.issue875_local_start(11, time '18:00'),
    100,
    'completed',
    'mingla',
    'missing-zone@adversarial.test',
    888888,
    'USD',
    'paid'
  );

  v_result := public.brand_customer_commitment_patterns_rollup(v_brand);
  IF (v_result->'days'->>'sample_commitments')::integer <> 0 THEN
    RAISE EXCEPTION 'A-3 FAIL: invalid/missing timezone row was admitted: %', v_result;
  END IF;
  RAISE NOTICE 'A-3 PASS: invalid and missing named-IANA timezone data excluded';
END;
$test$;

-- A-4/A-9: scheduled local time, not checkout time, owns the bucket. Inflated
-- order value, ticket quantity, used tickets, and successful scans do not
-- multiply the one normalized purchaser-occurrence commitment.
DO $test$
DECLARE
  v_brand uuid := pg_temp.issue875_uuid('issue875:brand:4');
  v_event uuid;
  v_date uuid;
  v_order uuid;
  v_result jsonb;
  v_scheduled_day text;
  v_checkout_day text;
BEGIN
  SELECT event_id, event_date_id, first_order_id
  INTO v_event, v_date, v_order
  FROM pg_temp.issue875_seed_event_orders(
    v_brand,
    '00000000-0875-4000-8000-00000000aa01',
    'a4-scheduled-morning',
    'event',
    pg_temp.issue875_local_start(7, time '06:00'),
    'UTC',
    1,
    pg_temp.issue875_local_start(1, time '18:00')
  );

  INSERT INTO public.ticket_types (
    id, event_id, name, price_cents, currency, quantity_total
  )
  VALUES (
    pg_temp.issue875_uuid('a9:ticket-type'),
    v_event,
    'A9 inflated ticket type',
    999999,
    'USD',
    100
  );
  INSERT INTO public.tickets (
    id, order_id, ticket_type_id, event_id, attendee_email, qr_code,
    status, used_at
  )
  SELECT
    pg_temp.issue875_uuid('a9:ticket:' || series_number),
    v_order,
    pg_temp.issue875_uuid('a9:ticket-type'),
    v_event,
    'attendee-' || series_number || '@adversarial.test',
    'issue875-a9-' || series_number,
    'used',
    now()
  FROM generate_series(1, 25) AS series_number;
  INSERT INTO public.scan_events (
    ticket_id, event_id, scanner_user_id, scan_result, scanned_at
  )
  SELECT
    pg_temp.issue875_uuid('a9:ticket:' || series_number),
    v_event,
    '00000000-0875-4000-8000-00000000aa01',
    'success',
    now()
  FROM generate_series(1, 25) AS series_number;

  v_result := public.brand_customer_commitment_patterns_rollup(v_brand);
  v_scheduled_day := lower(trim(to_char(
    pg_temp.issue875_local_start(7, time '06:00') AT TIME ZONE 'UTC',
    'FMDay'
  )));
  v_checkout_day := lower(trim(to_char(
    pg_temp.issue875_local_start(1, time '18:00') AT TIME ZONE 'UTC',
    'FMDay'
  )));

  IF (v_result->'days'->>'sample_commitments')::integer <> 1
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result->'days'->'buckets') bucket
      WHERE bucket->>'key' = v_scheduled_day
        AND (bucket->>'commitments')::integer = 1
    )
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result->'dayparts'->'buckets') bucket
      WHERE bucket->>'key' = 'morning'
        AND (bucket->>'commitments')::integer = 1
    )
    OR (
      v_checkout_day <> v_scheduled_day
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_result->'days'->'buckets') bucket
        WHERE bucket->>'key' = v_checkout_day
      )
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result->'dayparts'->'buckets') bucket
      WHERE bucket->>'key' = 'evening'
    )
  THEN
    RAISE EXCEPTION 'A-4/A-9 FAIL: checkout/ticket/scan inflation affected scheduled truth: %', v_result;
  END IF;
  RAISE NOTICE 'A-4/A-9 PASS: scheduled bucket wins; checkout, value, tickets, scans do not inflate';
END;
$test$;

-- A-5: dynamically find the latest America/New_York offset transition within
-- the cohort and prove both sides use their named-zone local day/daypart.
DO $test$
DECLARE
  v_brand uuid := pg_temp.issue875_uuid('issue875:brand:5');
  v_timezone text;
  v_transition timestamptz;
  v_before timestamptz;
  v_after timestamptz;
  v_result jsonb;
  v_expected_before_part text;
  v_expected_after_part text;
BEGIN
  SELECT timezone_name, sampled_at
  INTO v_timezone, v_transition
  FROM (
    SELECT
      timezone_name,
      sampled_at,
      (sampled_at AT TIME ZONE timezone_name)
        - (sampled_at AT TIME ZONE 'UTC') AS local_offset,
      lag(
        (sampled_at AT TIME ZONE timezone_name)
          - (sampled_at AT TIME ZONE 'UTC')
      ) OVER (PARTITION BY timezone_name ORDER BY sampled_at) AS prior_offset
    FROM (
      VALUES
        ('America/New_York'::text),
        ('Europe/London'::text),
        ('Australia/Sydney'::text),
        ('Pacific/Auckland'::text)
    ) zones(timezone_name)
    CROSS JOIN LATERAL generate_series(
      now() - interval '179 days',
      now() - interval '1 day',
      interval '15 minutes'
    ) sampled_at
  ) transitions
  WHERE prior_offset IS DISTINCT FROM local_offset
  ORDER BY sampled_at DESC
  LIMIT 1;

  IF v_transition IS NULL THEN
    RAISE EXCEPTION 'A-5 fixture failed: no DST transition found in trailing 179 days';
  END IF;
  v_before := v_transition - interval '30 minutes';
  v_after := v_transition + interval '30 minutes';

  PERFORM pg_temp.issue875_seed_event_orders(
    v_brand,'00000000-0875-4000-8000-00000000aa01','a5-before','event',
    v_before,v_timezone,1,now()
  );
  PERFORM pg_temp.issue875_seed_event_orders(
    v_brand,'00000000-0875-4000-8000-00000000aa01','a5-after','event',
    v_after,v_timezone,1,now()
  );

  v_expected_before_part := CASE
    WHEN (v_before AT TIME ZONE v_timezone)::time >= time '05:00'
      AND (v_before AT TIME ZONE v_timezone)::time < time '12:00' THEN 'morning'
    WHEN (v_before AT TIME ZONE v_timezone)::time >= time '12:00'
      AND (v_before AT TIME ZONE v_timezone)::time < time '17:00' THEN 'afternoon'
    WHEN (v_before AT TIME ZONE v_timezone)::time >= time '17:00'
      AND (v_before AT TIME ZONE v_timezone)::time < time '21:00' THEN 'evening'
    ELSE 'late_night'
  END;
  v_expected_after_part := CASE
    WHEN (v_after AT TIME ZONE v_timezone)::time >= time '05:00'
      AND (v_after AT TIME ZONE v_timezone)::time < time '12:00' THEN 'morning'
    WHEN (v_after AT TIME ZONE v_timezone)::time >= time '12:00'
      AND (v_after AT TIME ZONE v_timezone)::time < time '17:00' THEN 'afternoon'
    WHEN (v_after AT TIME ZONE v_timezone)::time >= time '17:00'
      AND (v_after AT TIME ZONE v_timezone)::time < time '21:00' THEN 'evening'
    ELSE 'late_night'
  END;

  v_result := public.brand_customer_commitment_patterns_rollup(v_brand);
  IF (v_result->'days'->>'sample_commitments')::integer <> 2
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result->'dayparts'->'buckets') bucket
      WHERE bucket->>'key' = v_expected_before_part
    )
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result->'dayparts'->'buckets') bucket
      WHERE bucket->>'key' = v_expected_after_part
    )
  THEN
    RAISE EXCEPTION 'A-5 FAIL: named-zone DST boundary mapped incorrectly: %', v_result;
  END IF;
  RAISE NOTICE 'A-5 PASS: named-IANA DST boundary maps to correct local buckets';
END;
$test$;

-- A-6: every exact daypart edge lands in the approved half-open interval.
DO $test$
DECLARE
  v_brand uuid := pg_temp.issue875_uuid('issue875:brand:6');
  v_result jsonb;
  v_key text;
  v_expected integer;
BEGIN
  PERFORM pg_temp.issue875_seed_event_orders(v_brand,'00000000-0875-4000-8000-00000000aa01','a6-045959','event',pg_temp.issue875_local_start(20,time '04:59:59'),'UTC',1);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand,'00000000-0875-4000-8000-00000000aa01','a6-050000','event',pg_temp.issue875_local_start(21,time '05:00:00'),'UTC',1);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand,'00000000-0875-4000-8000-00000000aa01','a6-115959','event',pg_temp.issue875_local_start(22,time '11:59:59'),'UTC',1);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand,'00000000-0875-4000-8000-00000000aa01','a6-120000','event',pg_temp.issue875_local_start(23,time '12:00:00'),'UTC',1);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand,'00000000-0875-4000-8000-00000000aa01','a6-165959','event',pg_temp.issue875_local_start(24,time '16:59:59'),'UTC',1);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand,'00000000-0875-4000-8000-00000000aa01','a6-170000','event',pg_temp.issue875_local_start(25,time '17:00:00'),'UTC',1);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand,'00000000-0875-4000-8000-00000000aa01','a6-205959','event',pg_temp.issue875_local_start(26,time '20:59:59'),'UTC',1);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand,'00000000-0875-4000-8000-00000000aa01','a6-210000','event',pg_temp.issue875_local_start(27,time '21:00:00'),'UTC',1);

  v_result := public.brand_customer_commitment_patterns_rollup(v_brand);
  FOREACH v_key IN ARRAY ARRAY['morning','afternoon','evening','late_night'] LOOP
    SELECT (bucket->>'commitments')::integer
    INTO v_expected
    FROM jsonb_array_elements(v_result->'dayparts'->'buckets') bucket
    WHERE bucket->>'key' = v_key;
    IF v_expected IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'A-6 FAIL: % did not receive exactly two boundary instants: %', v_key, v_result->'dayparts';
    END IF;
  END LOOP;
  RAISE NOTICE 'A-6 PASS: all eight exact daypart boundaries map correctly';
END;
$test$;

-- A-7: state precedence at empty, sample 9, sample 10/two dates, one bucket,
-- and leader-count boundaries.
DO $test$
DECLARE
  v_brand_empty uuid := pg_temp.issue875_uuid('issue875:brand:7');
  v_brand_nine uuid := pg_temp.issue875_uuid('issue875:brand:8');
  v_brand_two_dates uuid := pg_temp.issue875_uuid('issue875:brand:9');
  v_brand_one_bucket uuid := pg_temp.issue875_uuid('issue875:brand:10');
  v_brand_leader_two uuid := pg_temp.issue875_uuid('issue875:brand:11');
  v_brand_leader_three uuid := pg_temp.issue875_uuid('issue875:brand:17');
  v_result jsonb;
BEGIN
  v_result := public.brand_customer_commitment_patterns_rollup(v_brand_empty);
  IF v_result->'types'->>'state' <> 'no_data' THEN
    RAISE EXCEPTION 'A-7 FAIL: sample 0 was not no_data: %', v_result->'types';
  END IF;

  PERFORM pg_temp.issue875_seed_event_orders(v_brand_nine,'00000000-0875-4000-8000-00000000aa01','a7-nine-event','event',pg_temp.issue875_local_start(7,time '09:00'),'UTC',5);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_nine,'00000000-0875-4000-8000-00000000aa01','a7-nine-trip','trip',pg_temp.issue875_local_start(14,time '18:00'),'UTC',2);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_nine,'00000000-0875-4000-8000-00000000aa01','a7-nine-experience','experience',pg_temp.issue875_local_start(21,time '13:00'),'UTC',2);
  v_result := public.brand_customer_commitment_patterns_rollup(v_brand_nine);
  IF v_result->'types'->>'state' <> 'more_data_needed'
    OR (v_result->'types'->>'sample_commitments')::integer <> 9
    OR (v_result->'types'->>'distinct_dates')::integer <> 3
  THEN
    RAISE EXCEPTION 'A-7 FAIL: sample 9 precedence mismatch: %', v_result->'types';
  END IF;

  PERFORM pg_temp.issue875_seed_event_orders(v_brand_two_dates,'00000000-0875-4000-8000-00000000aa01','a7-two-dates-event','event',pg_temp.issue875_local_start(8,time '09:00'),'UTC',6);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_two_dates,'00000000-0875-4000-8000-00000000aa01','a7-two-dates-trip','trip',pg_temp.issue875_local_start(15,time '18:00'),'UTC',4);
  v_result := public.brand_customer_commitment_patterns_rollup(v_brand_two_dates);
  IF v_result->'types'->>'state' <> 'more_data_needed'
    OR (v_result->'types'->>'sample_commitments')::integer <> 10
    OR (v_result->'types'->>'distinct_dates')::integer <> 2
  THEN
    RAISE EXCEPTION 'A-7 FAIL: sample 10/two-date boundary mismatch: %', v_result->'types';
  END IF;

  PERFORM pg_temp.issue875_seed_event_orders(v_brand_one_bucket,'00000000-0875-4000-8000-00000000aa01','a7-one-bucket-1','event',pg_temp.issue875_local_start(9,time '09:00'),'UTC',4);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_one_bucket,'00000000-0875-4000-8000-00000000aa01','a7-one-bucket-2','event',pg_temp.issue875_local_start(16,time '09:00'),'UTC',3);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_one_bucket,'00000000-0875-4000-8000-00000000aa01','a7-one-bucket-3','event',pg_temp.issue875_local_start(23,time '09:00'),'UTC',3);
  v_result := public.brand_customer_commitment_patterns_rollup(v_brand_one_bucket);
  IF v_result->'types'->>'state' <> 'more_data_needed'
    OR (v_result->'types'->>'positive_buckets')::integer <> 1
  THEN
    RAISE EXCEPTION 'A-7 FAIL: one-bucket boundary mismatch: %', v_result->'types';
  END IF;

  -- Five type buckets at two commitments each gives sample=10, dates>=3,
  -- buckets=5, but leader_count=2; state must remain more_data_needed.
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_leader_two,'00000000-0875-4000-8000-00000000aa01','a7-l2-event','event',pg_temp.issue875_local_start(10,time '09:00'),'UTC',2);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_leader_two,'00000000-0875-4000-8000-00000000aa01','a7-l2-trip','trip',pg_temp.issue875_local_start(17,time '09:00'),'UTC',2);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_leader_two,'00000000-0875-4000-8000-00000000aa01','a7-l2-experience','experience',pg_temp.issue875_local_start(24,time '09:00'),'UTC',2);

  INSERT INTO public.events (id,brand_id,created_by,title,slug,timezone,event_type)
  VALUES (
    pg_temp.issue875_uuid('a7-l2-rsvp:event'),v_brand_leader_two,'00000000-0875-4000-8000-00000000aa01',
    'A7 RSVP','issue-875-a7-rsvp-'||substr(md5(random()::text),1,8),'UTC','rsvp'
  );
  INSERT INTO public.event_dates (id,event_id,start_at,end_at,timezone,is_master)
  VALUES (
    pg_temp.issue875_uuid('a7-l2-rsvp:date'),pg_temp.issue875_uuid('a7-l2-rsvp:event'),
    pg_temp.issue875_local_start(31,time '09:00'),pg_temp.issue875_local_start(31,time '11:00'),'UTC',true
  );
  INSERT INTO public.event_rsvps (event_id,guest_name,guest_email,guest_phone,rsvp_status,approval_status)
  VALUES
    (pg_temp.issue875_uuid('a7-l2-rsvp:event'),'A','a7-rsvp-a@adversarial.test','+15558751001','going','approved'),
    (pg_temp.issue875_uuid('a7-l2-rsvp:event'),'B','a7-rsvp-b@adversarial.test','+15558751002','going','approved');

  INSERT INTO public.venue_listings (id,brand_id,slug,name,lat,lng,venue_category)
  VALUES (
    pg_temp.issue875_uuid('a7-l2-venue'),v_brand_leader_two,
    'issue875a7venue'||substr(md5(random()::text),1,8),'A7 venue',40.7,-74.0,'restaurant'
  );
  INSERT INTO public.venue_availability_config (id,brand_id,venue_id,place_pool_id,iana_timezone)
  VALUES (
    pg_temp.issue875_uuid('a7-l2-config'),v_brand_leader_two,pg_temp.issue875_uuid('a7-l2-venue'),
    '00000000-0875-4000-8000-00000000ac01','UTC'
  );
  INSERT INTO public.reservations (
    brand_id,venue_id,reserved_for,party_size,status,source,guest_email
  )
  VALUES
    (v_brand_leader_two,pg_temp.issue875_uuid('a7-l2-venue'),pg_temp.issue875_local_start(38,time '09:00'),100,'completed','mingla','a7-res-a@adversarial.test'),
    (v_brand_leader_two,pg_temp.issue875_uuid('a7-l2-venue'),pg_temp.issue875_local_start(45,time '09:00'),100,'completed','mingla','a7-res-b@adversarial.test');

  v_result := public.brand_customer_commitment_patterns_rollup(v_brand_leader_two);
  IF v_result->'types'->>'state' <> 'more_data_needed'
    OR (v_result->'types'->>'sample_commitments')::integer <> 10
    OR (v_result->'types'->>'positive_buckets')::integer <> 5
    OR (v_result->'types'->'buckets'->0->>'commitments')::integer <> 2
  THEN
    RAISE EXCEPTION 'A-7 FAIL: leader-count 2 boundary mismatch: %', v_result->'types';
  END IF;

  -- Leader count reaches 3, but a 3–3 tie must advance past the minimum
  -- threshold and truthfully stop at no_clear_pattern.
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_leader_three,'00000000-0875-4000-8000-00000000aa01','a7-l3-event','event',pg_temp.issue875_local_start(11,time '09:00'),'UTC',3);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_leader_three,'00000000-0875-4000-8000-00000000aa01','a7-l3-trip','trip',pg_temp.issue875_local_start(18,time '09:00'),'UTC',3);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_leader_three,'00000000-0875-4000-8000-00000000aa01','a7-l3-experience','experience',pg_temp.issue875_local_start(25,time '09:00'),'UTC',2);
  INSERT INTO public.events (id,brand_id,created_by,title,slug,timezone,event_type)
  VALUES (
    pg_temp.issue875_uuid('a7-l3-rsvp:event'),v_brand_leader_three,'00000000-0875-4000-8000-00000000aa01',
    'A7 leader three RSVP','issue-875-a7-l3-rsvp-'||substr(md5(random()::text),1,8),'UTC','rsvp'
  );
  INSERT INTO public.event_dates (id,event_id,start_at,end_at,timezone,is_master)
  VALUES (
    pg_temp.issue875_uuid('a7-l3-rsvp:date'),pg_temp.issue875_uuid('a7-l3-rsvp:event'),
    pg_temp.issue875_local_start(32,time '09:00'),pg_temp.issue875_local_start(32,time '11:00'),'UTC',true
  );
  INSERT INTO public.event_rsvps (event_id,guest_name,guest_email,guest_phone,rsvp_status,approval_status)
  VALUES
    (pg_temp.issue875_uuid('a7-l3-rsvp:event'),'A','a7-l3-rsvp-a@adversarial.test','+15558751701','going','approved'),
    (pg_temp.issue875_uuid('a7-l3-rsvp:event'),'B','a7-l3-rsvp-b@adversarial.test','+15558751702','going','approved');
  v_result := public.brand_customer_commitment_patterns_rollup(v_brand_leader_three);
  IF v_result->'types'->>'state' <> 'no_clear_pattern'
    OR (v_result->'types'->>'sample_commitments')::integer <> 10
    OR (v_result->'types'->'buckets'->0->>'commitments')::integer <> 3
  THEN
    RAISE EXCEPTION 'A-7 FAIL: leader-count 3 transition mismatch: %', v_result->'types';
  END IF;
  RAISE NOTICE 'A-7 PASS: sample/date/bucket/leader threshold precedence is exact';
END;
$test$;

-- A-8: tie, +1 gap, +2 but under 20%, and exact +2/exactly 20%.
DO $test$
DECLARE
  v_brand_tie uuid := pg_temp.issue875_uuid('issue875:brand:12');
  v_brand_gap_one uuid := pg_temp.issue875_uuid('issue875:brand:13');
  v_brand_under_twenty uuid := pg_temp.issue875_uuid('issue875:brand:14');
  v_brand_exact uuid := pg_temp.issue875_uuid('issue875:brand:15');
  v_result jsonb;
BEGIN
  -- Each brand uses three or more dates; type is the compared view.
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_tie,'00000000-0875-4000-8000-00000000aa01','a8-tie-e1','event',pg_temp.issue875_local_start(7,time '09:00'),'UTC',3);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_tie,'00000000-0875-4000-8000-00000000aa01','a8-tie-e2','event',pg_temp.issue875_local_start(14,time '09:00'),'UTC',2);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_tie,'00000000-0875-4000-8000-00000000aa01','a8-tie-t1','trip',pg_temp.issue875_local_start(21,time '18:00'),'UTC',5);
  v_result := public.brand_customer_commitment_patterns_rollup(v_brand_tie);
  IF v_result->'types'->>'state' <> 'no_clear_pattern' THEN
    RAISE EXCEPTION 'A-8 FAIL: exact tie produced wrong state: %', v_result->'types';
  END IF;

  PERFORM pg_temp.issue875_seed_event_orders(v_brand_gap_one,'00000000-0875-4000-8000-00000000aa01','a8-gap1-e1','event',pg_temp.issue875_local_start(8,time '09:00'),'UTC',3);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_gap_one,'00000000-0875-4000-8000-00000000aa01','a8-gap1-e2','event',pg_temp.issue875_local_start(15,time '09:00'),'UTC',3);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_gap_one,'00000000-0875-4000-8000-00000000aa01','a8-gap1-t1','trip',pg_temp.issue875_local_start(22,time '18:00'),'UTC',5);
  v_result := public.brand_customer_commitment_patterns_rollup(v_brand_gap_one);
  IF v_result->'types'->>'state' <> 'no_clear_pattern' THEN
    RAISE EXCEPTION 'A-8 FAIL: +1 gap produced wrong state: %', v_result->'types';
  END IF;

  PERFORM pg_temp.issue875_seed_event_orders(v_brand_under_twenty,'00000000-0875-4000-8000-00000000aa01','a8-under-e1','event',pg_temp.issue875_local_start(9,time '09:00'),'UTC',6);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_under_twenty,'00000000-0875-4000-8000-00000000aa01','a8-under-e2','event',pg_temp.issue875_local_start(16,time '09:00'),'UTC',5);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_under_twenty,'00000000-0875-4000-8000-00000000aa01','a8-under-t1','trip',pg_temp.issue875_local_start(23,time '18:00'),'UTC',10);
  v_result := public.brand_customer_commitment_patterns_rollup(v_brand_under_twenty);
  IF v_result->'types'->>'state' <> 'no_clear_pattern' THEN
    RAISE EXCEPTION 'A-8 FAIL: +2 but under 20 percent produced wrong state: %', v_result->'types';
  END IF;

  PERFORM pg_temp.issue875_seed_event_orders(v_brand_exact,'00000000-0875-4000-8000-00000000aa01','a8-exact-e1','event',pg_temp.issue875_local_start(10,time '09:00'),'UTC',6);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_exact,'00000000-0875-4000-8000-00000000aa01','a8-exact-e2','event',pg_temp.issue875_local_start(17,time '09:00'),'UTC',6);
  PERFORM pg_temp.issue875_seed_event_orders(v_brand_exact,'00000000-0875-4000-8000-00000000aa01','a8-exact-t1','trip',pg_temp.issue875_local_start(24,time '18:00'),'UTC',10);
  v_result := public.brand_customer_commitment_patterns_rollup(v_brand_exact);
  IF v_result->'types'->>'state' <> 'winner'
    OR v_result->'types'->'winner' <> '{"key":"event","label":"Event","commitments":12}'::jsonb
  THEN
    RAISE EXCEPTION 'A-8 FAIL: exact +2/exactly 20 percent did not win: %', v_result->'types';
  END IF;
  RAISE NOTICE 'A-8 PASS: tie and both margin boundaries are exact';
END;
$test$;

-- A-9 continued: RSVP plus-ones/contribution and reservation party/fee count
-- as one identity each, never their inflated quantities.
DO $test$
DECLARE
  v_brand uuid := pg_temp.issue875_uuid('issue875:brand:16');
  v_rsvp_event uuid := pg_temp.issue875_uuid('a9:rsvp:event');
  v_venue uuid := pg_temp.issue875_uuid('a9:venue');
  v_result jsonb;
BEGIN
  INSERT INTO public.events (id,brand_id,created_by,title,slug,timezone,event_type)
  VALUES (
    v_rsvp_event,v_brand,'00000000-0875-4000-8000-00000000aa01','A9 RSVP',
    'issue-875-a9-rsvp-'||substr(md5(random()::text),1,8),'UTC','rsvp'
  );
  INSERT INTO public.event_dates (id,event_id,start_at,end_at,timezone,is_master)
  VALUES (
    pg_temp.issue875_uuid('a9:rsvp:date'),v_rsvp_event,
    pg_temp.issue875_local_start(12,time '13:00'),pg_temp.issue875_local_start(12,time '15:00'),'UTC',true
  );
  INSERT INTO public.event_rsvps (
    event_id,guest_name,guest_email,guest_phone,rsvp_status,approval_status,plus_count
  )
  VALUES (
    v_rsvp_event,'A9 RSVP','a9-rsvp@adversarial.test','+15558759001','going','approved',99
  );

  INSERT INTO public.venue_listings (id,brand_id,slug,name,lat,lng,venue_category)
  VALUES (v_venue,v_brand,'issue875a9venue'||substr(md5(random()::text),1,8),'A9 venue',40.7,-74.0,'restaurant');
  INSERT INTO public.venue_availability_config (id,brand_id,venue_id,place_pool_id,iana_timezone)
  VALUES (pg_temp.issue875_uuid('a9:config'),v_brand,v_venue,'00000000-0875-4000-8000-00000000ac01','UTC');
  INSERT INTO public.reservations (
    brand_id,venue_id,reserved_for,party_size,status,source,guest_email,
    fee_cents,fee_currency,payment_status
  )
  VALUES (
    v_brand,v_venue,pg_temp.issue875_local_start(13,time '18:00'),100,'completed','mingla',
    'a9-reservation@adversarial.test',999999,'USD','paid'
  );

  v_result := public.brand_customer_commitment_patterns_rollup(v_brand);
  IF (v_result->'days'->>'sample_commitments')::integer <> 2
    OR (SELECT (bucket->>'commitments')::integer FROM jsonb_array_elements(v_result->'types'->'buckets') bucket WHERE bucket->>'key'='rsvp') <> 1
    OR (SELECT (bucket->>'commitments')::integer FROM jsonb_array_elements(v_result->'types'->'buckets') bucket WHERE bucket->>'key'='venue_reservation') <> 1
  THEN
    RAISE EXCEPTION 'A-9 FAIL: plus-one/party/value multiplied commitments: %', v_result;
  END IF;
  RAISE NOTICE 'A-9 PASS: plus-ones, party size, covers, and money do not inflate';
END;
$test$;

-- A-10: every nonqualifying order/RSVP/reservation status and deleted offering
-- is excluded from the same eligible cohort.
DO $test$
DECLARE
  v_brand uuid := pg_temp.issue875_uuid('issue875:brand:7');
  v_event uuid := pg_temp.issue875_uuid('a10:event');
  v_deleted_event uuid := pg_temp.issue875_uuid('a10:deleted:event');
  v_rsvp_event uuid := pg_temp.issue875_uuid('a10:rsvp:event');
  v_venue uuid := pg_temp.issue875_uuid('a10:venue');
  v_result jsonb;
BEGIN
  INSERT INTO public.events (id,brand_id,created_by,title,slug,timezone,event_type,deleted_at)
  VALUES
    (v_event,v_brand,'00000000-0875-4000-8000-00000000aa01','A10 event','issue-875-a10-event-'||substr(md5(random()::text),1,8),'UTC','event',NULL),
    (v_deleted_event,v_brand,'00000000-0875-4000-8000-00000000aa01','A10 deleted','issue-875-a10-deleted-'||substr(md5(random()::text),1,8),'UTC','event',now()),
    (v_rsvp_event,v_brand,'00000000-0875-4000-8000-00000000aa01','A10 RSVP','issue-875-a10-rsvp-'||substr(md5(random()::text),1,8),'UTC','rsvp',NULL);
  INSERT INTO public.event_dates (id,event_id,start_at,end_at,timezone,is_master)
  VALUES
    (pg_temp.issue875_uuid('a10:event:date'),v_event,pg_temp.issue875_local_start(40,time '09:00'),pg_temp.issue875_local_start(40,time '11:00'),'UTC',true),
    (pg_temp.issue875_uuid('a10:deleted:date'),v_deleted_event,pg_temp.issue875_local_start(41,time '09:00'),pg_temp.issue875_local_start(41,time '11:00'),'UTC',true),
    (pg_temp.issue875_uuid('a10:rsvp:date'),v_rsvp_event,pg_temp.issue875_local_start(42,time '09:00'),pg_temp.issue875_local_start(42,time '11:00'),'UTC',true);
  INSERT INTO public.orders (
    event_id,event_date_id,buyer_email,buyer_phone_e164,confirmed_at,total_cents,payment_status,currency,source
  )
  VALUES
    (v_event,pg_temp.issue875_uuid('a10:event:date'),'pending@adversarial.test','+15558753001',now(),1,'pending','USD','online_checkout'),
    (v_event,pg_temp.issue875_uuid('a10:event:date'),'failed@adversarial.test','+15558753002',now(),1,'failed','USD','online_checkout'),
    (v_event,pg_temp.issue875_uuid('a10:event:date'),'refunded@adversarial.test','+15558753003',now(),1,'refunded','USD','online_checkout'),
    (v_event,pg_temp.issue875_uuid('a10:event:date'),'door@adversarial.test','+15558753004',now(),1,'paid','USD','door_sale'),
    (v_deleted_event,pg_temp.issue875_uuid('a10:deleted:date'),'deleted@adversarial.test','+15558753005',now(),1,'paid','USD','online_checkout');
  INSERT INTO public.event_rsvps (
    event_id,guest_name,guest_email,guest_phone,rsvp_status,approval_status
  )
  VALUES
    (v_rsvp_event,'Not going','notgoing@adversarial.test','+15558752001','not_going','approved'),
    (v_rsvp_event,'Waitlist','waitlist@adversarial.test','+15558752002','waitlisted','approved'),
    (v_rsvp_event,'Pending','pending-rsvp@adversarial.test','+15558752003','going','pending'),
    (v_rsvp_event,'Denied','denied@adversarial.test','+15558752004','going','denied');

  INSERT INTO public.venue_listings (id,brand_id,slug,name,lat,lng,venue_category)
  VALUES (v_venue,v_brand,'issue875a10venue'||substr(md5(random()::text),1,8),'A10 venue',40.7,-74.0,'restaurant');
  INSERT INTO public.venue_availability_config (id,brand_id,venue_id,place_pool_id,iana_timezone)
  VALUES (pg_temp.issue875_uuid('a10:config'),v_brand,v_venue,'00000000-0875-4000-8000-00000000ac01','UTC');
  INSERT INTO public.reservations (
    brand_id,venue_id,reserved_for,party_size,status,source,guest_email
  )
  VALUES
    (v_brand,v_venue,pg_temp.issue875_local_start(43,time '18:00'),2,'cancelled_by_guest','mingla','cancel-guest@adversarial.test'),
    (v_brand,v_venue,pg_temp.issue875_local_start(44,time '18:00'),2,'cancelled_by_venue','mingla','cancel-venue@adversarial.test'),
    (v_brand,v_venue,pg_temp.issue875_local_start(45,time '18:00'),2,'completed','phone','phone@adversarial.test');

  v_result := public.brand_customer_commitment_patterns_rollup(v_brand);
  IF v_result->'days'->>'state' <> 'no_data'
    OR (v_result->'days'->>'sample_commitments')::integer <> 0
  THEN
    RAISE EXCEPTION 'A-10 FAIL: nonqualifying status/source/deleted row admitted: %', v_result;
  END IF;
  RAISE NOTICE 'A-10 PASS: bad statuses, non-Mingla sources, and deleted offerings excluded';
END;
$test$;

-- A-11: anon has no EXECUTE. An unrelated authenticated caller receives the
-- exact non-leaking unauthorized envelope and no commerce-derived values.
DO $test$
DECLARE
  v_brand uuid := pg_temp.issue875_uuid('issue875:brand:4');
  v_result jsonb;
BEGIN
  IF has_function_privilege(
    'anon',
    'public.brand_customer_commitment_patterns_rollup(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'A-11 FAIL: anon can execute the private RPC';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0875-4000-8000-00000000ffff","role":"authenticated"}',
    true
  );
  PERFORM set_config('request.jwt.claim.sub','00000000-0875-4000-8000-00000000ffff',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  v_result := public.brand_customer_commitment_patterns_rollup(v_brand);

  IF v_result <> jsonb_build_object(
    'brand_id', v_brand,
    'authorized', false,
    'generated_at', NULL,
    'window_days', 180,
    'metric', 'qualified_customer_commitments',
    'days', jsonb_build_object('state','unauthorized','sample_commitments',0,'distinct_dates',0,'positive_buckets',0,'winner',NULL,'buckets','[]'::jsonb),
    'dayparts', jsonb_build_object('state','unauthorized','sample_commitments',0,'distinct_dates',0,'positive_buckets',0,'winner',NULL,'buckets','[]'::jsonb),
    'types', jsonb_build_object('state','unauthorized','sample_commitments',0,'distinct_dates',0,'positive_buckets',0,'winner',NULL,'buckets','[]'::jsonb)
  ) THEN
    RAISE EXCEPTION 'A-11 FAIL: unrelated caller response leaked or changed shape: %', v_result;
  END IF;
  RAISE NOTICE 'A-11 PASS: anon denied; unrelated caller gets exact non-leaking envelope';
END;
$test$;

-- A-12: the seven existing analytics candidates retain the expected function
-- definition and ACL fingerprints from origin/main before issue #875.
DO $test$
DECLARE
  v_mismatch text;
BEGIN
  WITH expected(signature, expected_fingerprint) AS (
    VALUES
      ('public.brand_mingla_drove_rollup(uuid)'::text, 'a9ca3764e1b49b7bb6ba7c9b3c435fb6'::text),
      ('public.entity_conversion_rollup(uuid)'::text, '817e6243a42bdebac0ef46ea5c3bd906'::text),
      ('public.reservation_metrics_rollup(uuid)'::text, 'c713ed3f5c45b52d7f49ac3eb5ab4d42'::text),
      ('public.brand_regulars_rollup(uuid)'::text, '2395341733d7b8a1cec1120aa193d70f'::text),
      ('public.brand_conversion_rollup(uuid)'::text, 'c57b570636a34b25732bb910f3f4c947'::text),
      ('public.ad_campaign_conversion_rollup(uuid)'::text, '09116db9216bb19a64b666c83000b033'::text),
      ('public.venue_intelligence_overview(uuid,uuid)'::text, 'd474d12571f53bd24f5d969c24fae87e'::text)
  ),
  actual AS (
    SELECT
      expected.signature,
      expected.expected_fingerprint,
      md5(
        pg_catalog.pg_get_functiondef(expected.signature::regprocedure)
        || E'\nACL='
        || COALESCE(
          (
            SELECT function_proc.proacl::text
            FROM pg_catalog.pg_proc function_proc
            WHERE function_proc.oid = expected.signature::regprocedure::oid
          ),
          '<default>'
        )
      ) AS actual_fingerprint
    FROM expected
  )
  SELECT string_agg(
    signature || ' expected=' || expected_fingerprint || ' actual=' || actual_fingerprint,
    '; '
  )
  INTO v_mismatch
  FROM actual
  WHERE actual_fingerprint <> expected_fingerprint;

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'A-12 FAIL: existing definition/ACL fingerprint drift: %', v_mismatch;
  END IF;
  RAISE NOTICE 'A-12 PASS: seven existing RPC definition/ACL fingerprints unchanged';
END;
$test$;

ROLLBACK;

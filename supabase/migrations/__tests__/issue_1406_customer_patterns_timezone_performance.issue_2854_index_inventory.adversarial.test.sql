-- Issue #2854 tester-owned guard: prove the exact post-#1406 index delta
-- without trusting the re-banked A-7 constants or weakening its RPC/ACL pins.
BEGIN;

-- T-1: the sole post-#1406 index must retain its exact structural contract.
DO $test$
DECLARE
  v_match_count integer;
  v_is_unique boolean;
  v_is_valid boolean;
  v_is_ready boolean;
  v_key_count integer;
  v_attribute_count integer;
  v_key_names text[];
  v_predicate text;
  v_definition text;
BEGIN
  SELECT COUNT(*)::integer
  INTO v_match_count
  FROM pg_catalog.pg_index table_index
  JOIN pg_catalog.pg_class table_class
    ON table_class.oid = table_index.indrelid
  JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = table_class.relnamespace
  JOIN pg_catalog.pg_class index_class
    ON index_class.oid = table_index.indexrelid
  WHERE namespace.nspname = 'public'
    AND table_class.relname = 'orders'
    AND index_class.relname = 'orders_attendance_claim_unconsumed_digest_uniq';

  IF v_match_count <> 1 THEN
    RAISE EXCEPTION
      'T-1 FAIL: expected exactly one public.orders.orders_attendance_claim_unconsumed_digest_uniq index, found %',
      v_match_count;
  END IF;

  SELECT
    table_index.indisunique,
    table_index.indisvalid,
    table_index.indisready,
    table_index.indnkeyatts::integer,
    table_index.indnatts::integer,
    ARRAY(
      SELECT attribute.attname
      FROM unnest(table_index.indkey::smallint[]) WITH ORDINALITY
        AS index_key(attribute_number, key_ordinal)
      JOIN pg_catalog.pg_attribute attribute
        ON attribute.attrelid = table_index.indrelid
       AND attribute.attnum = index_key.attribute_number
      WHERE index_key.key_ordinal <= table_index.indnkeyatts
      ORDER BY index_key.key_ordinal
    ),
    pg_catalog.pg_get_expr(table_index.indpred, table_index.indrelid),
    pg_catalog.pg_get_indexdef(index_class.oid)
  INTO
    v_is_unique,
    v_is_valid,
    v_is_ready,
    v_key_count,
    v_attribute_count,
    v_key_names,
    v_predicate,
    v_definition
  FROM pg_catalog.pg_index table_index
  JOIN pg_catalog.pg_class table_class
    ON table_class.oid = table_index.indrelid
  JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = table_class.relnamespace
  JOIN pg_catalog.pg_class index_class
    ON index_class.oid = table_index.indexrelid
  WHERE namespace.nspname = 'public'
    AND table_class.relname = 'orders'
    AND index_class.relname = 'orders_attendance_claim_unconsumed_digest_uniq';

  IF v_is_unique IS DISTINCT FROM true
    OR v_is_valid IS DISTINCT FROM true
    OR v_is_ready IS DISTINCT FROM true
    OR v_key_count <> 1
    OR v_attribute_count <> 1
    OR v_key_names IS DISTINCT FROM ARRAY['attendance_claim_token_digest']::text[]
    OR v_predicate IS NULL
    OR v_definition IS DISTINCT FROM
      'CREATE UNIQUE INDEX orders_attendance_claim_unconsumed_digest_uniq ON public.orders USING btree (attendance_claim_token_digest) WHERE ((attendance_claim_token_digest IS NOT NULL) AND (attendance_claim_token_consumed_at IS NULL))'
  THEN
    RAISE EXCEPTION
      'T-1 FAIL: #871 index contract drift unique=% valid=% ready=% keys=% attrs=% key_names=% predicate=% definition=%',
      v_is_unique,
      v_is_valid,
      v_is_ready,
      v_key_count,
      v_attribute_count,
      v_key_names,
      v_predicate,
      v_definition;
  END IF;

  RAISE NOTICE 'T-1 PASS: #871 index is exact, unique, valid, ready, single-key, and partial';
END;
$test$;

-- T-2: independently pin the complete current inventory on exactly the eight
-- business relations protected by #1406.
DO $test$
DECLARE
  v_index_count integer;
  v_index_fingerprint text;
BEGIN
  WITH index_rows AS (
    SELECT
      namespace.nspname
        || '.'
        || table_class.relname
        || '|'
        || index_class.relname
        || '|'
        || pg_catalog.pg_get_indexdef(index_class.oid) AS item
    FROM pg_catalog.pg_index table_index
    JOIN pg_catalog.pg_class table_class
      ON table_class.oid = table_index.indrelid
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = table_class.relnamespace
    JOIN pg_catalog.pg_class index_class
      ON index_class.oid = table_index.indexrelid
    WHERE namespace.nspname = 'public'
      AND table_class.relname IN (
        'brand_team_members',
        'brands',
        'event_dates',
        'event_rsvps',
        'events',
        'orders',
        'reservations',
        'venue_availability_config'
      )
  )
  SELECT COUNT(*)::integer, md5(string_agg(item, E'\n' ORDER BY item))
  INTO v_index_count, v_index_fingerprint
  FROM index_rows;

  IF v_index_count <> 61
    OR v_index_fingerprint <> '6070f6b1331ff498899cfd34d77e3e61'
  THEN
    RAISE EXCEPTION
      'T-2 FAIL: complete business-index inventory drift count=% hash=%',
      v_index_count,
      v_index_fingerprint;
  END IF;

  RAISE NOTICE 'T-2 PASS: complete business-index inventory is exactly 61 / 6070f6b1331ff498899cfd34d77e3e61';
END;
$test$;

-- T-3: remove only the exact #871 member and reconstruct the frozen #1406
-- inventory byte-for-byte. This rejects any second post-#1406 delta.
DO $test$
DECLARE
  v_projected_count integer;
  v_projected_fingerprint text;
BEGIN
  WITH projected_rows AS (
    SELECT
      namespace.nspname
        || '.'
        || table_class.relname
        || '|'
        || index_class.relname
        || '|'
        || pg_catalog.pg_get_indexdef(index_class.oid) AS item
    FROM pg_catalog.pg_index table_index
    JOIN pg_catalog.pg_class table_class
      ON table_class.oid = table_index.indrelid
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = table_class.relnamespace
    JOIN pg_catalog.pg_class index_class
      ON index_class.oid = table_index.indexrelid
    WHERE namespace.nspname = 'public'
      AND table_class.relname IN (
        'brand_team_members',
        'brands',
        'event_dates',
        'event_rsvps',
        'events',
        'orders',
        'reservations',
        'venue_availability_config'
      )
      AND index_class.relname <> 'orders_attendance_claim_unconsumed_digest_uniq'
  )
  SELECT COUNT(*)::integer, md5(string_agg(item, E'\n' ORDER BY item))
  INTO v_projected_count, v_projected_fingerprint
  FROM projected_rows;

  IF v_projected_count <> 60
    OR v_projected_fingerprint <> '6b03ce0a69d76988b1f13c367f396547'
  THEN
    RAISE EXCEPTION
      'T-3 FAIL: projected #1406 inventory drift count=% hash=%',
      v_projected_count,
      v_projected_fingerprint;
  END IF;

  RAISE NOTICE 'T-3 PASS: excluding only the #871 index reconstructs 60 / 6b03ce0a69d76988b1f13c367f396547';
END;
$test$;

-- T-4: independently recompute every frozen unrelated RPC definition+ACL
-- fingerprint; expected values are literal tester-owned authorities.
DO $test$
DECLARE
  v_function_mismatch text;
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
    ORDER BY signature
  )
  INTO v_function_mismatch
  FROM actual
  WHERE actual_fingerprint <> expected_fingerprint;

  IF v_function_mismatch IS NOT NULL THEN
    RAISE EXCEPTION
      'T-4 FAIL: protected RPC definition+ACL drift: %',
      v_function_mismatch;
  END IF;

  RAISE NOTICE 'T-4 PASS: all seven protected RPC definition+ACL fingerprints are exact';
END;
$test$;

ROLLBACK;

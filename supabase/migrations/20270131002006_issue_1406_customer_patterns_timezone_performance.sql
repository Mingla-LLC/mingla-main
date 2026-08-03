-- ISSUE #1406 — remove request-time timezone catalog enumeration from the
-- private customer-commitment patterns rollup.

CREATE TABLE IF NOT EXISTS public.analytics_iana_timezones (
  name text PRIMARY KEY
);

ALTER TABLE public.analytics_iana_timezones ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.analytics_iana_timezones
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.analytics_iana_timezones (name)
SELECT DISTINCT timezone_name.name
FROM pg_catalog.pg_timezone_names timezone_name
WHERE timezone_name.name IS NOT NULL
  AND btrim(timezone_name.name) <> ''
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE public.analytics_iana_timezones IS
  'ISSUE #1406: deployment-time snapshot of recognized IANA timezone names for analytics validation. Runtime analytics must use this indexed lookup instead of enumerating pg_timezone_names; timezone offset and DST conversion still use PostgreSQL current rules at call time.';

DO $lookup_assertion$
DECLARE
  v_column_count integer;
  v_primary_key_count integer;
  v_policy_count integer;
  v_timezone_count bigint;
  v_missing_timezone text;
BEGIN
  SELECT COUNT(*)::integer
  INTO v_column_count
  FROM pg_catalog.pg_attribute table_column
  WHERE table_column.attrelid = 'public.analytics_iana_timezones'::regclass
    AND table_column.attnum > 0
    AND NOT table_column.attisdropped;

  IF v_column_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute table_column
    WHERE table_column.attrelid = 'public.analytics_iana_timezones'::regclass
      AND table_column.attnum > 0
      AND NOT table_column.attisdropped
      AND table_column.attname = 'name'
      AND table_column.atttypid = 'text'::regtype
      AND table_column.attnotnull
  ) THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: lookup must have exactly one text NOT NULL column named name';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_primary_key_count
  FROM pg_catalog.pg_constraint table_constraint
  WHERE table_constraint.conrelid = 'public.analytics_iana_timezones'::regclass
    AND table_constraint.contype = 'p'
    AND table_constraint.conkey = ARRAY[
      (
        SELECT table_column.attnum
        FROM pg_catalog.pg_attribute table_column
        WHERE table_column.attrelid = 'public.analytics_iana_timezones'::regclass
          AND table_column.attname = 'name'
          AND NOT table_column.attisdropped
      )
    ]::smallint[];

  IF v_primary_key_count <> 1 THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: lookup name primary key missing';
  END IF;

  IF NOT (
    SELECT table_class.relrowsecurity
    FROM pg_catalog.pg_class table_class
    WHERE table_class.oid = 'public.analytics_iana_timezones'::regclass
  ) THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: lookup RLS is not enabled';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_policy_count
  FROM pg_catalog.pg_policy table_policy
  WHERE table_policy.polrelid = 'public.analytics_iana_timezones'::regclass;

  IF v_policy_count <> 0 THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: lookup must have no RLS policy';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class table_class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        table_class.relacl,
        pg_catalog.acldefault('r', table_class.relowner)
      )
    ) table_acl
    WHERE table_class.oid = 'public.analytics_iana_timezones'::regclass
      AND table_acl.grantee = 0
      AND table_acl.privilege_type IN (
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER'
      )
  ) OR EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('anon'::text),
        ('authenticated'::text),
        ('service_role'::text)
    ) denied_role(role_name)
    CROSS JOIN (
      VALUES
        ('SELECT'::text),
        ('INSERT'::text),
        ('UPDATE'::text),
        ('DELETE'::text),
        ('TRUNCATE'::text),
        ('REFERENCES'::text),
        ('TRIGGER'::text)
    ) table_privilege(privilege_name)
    WHERE has_table_privilege(
      denied_role.role_name,
      'public.analytics_iana_timezones',
      table_privilege.privilege_name
    )
  ) THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: denied role retains a lookup table privilege';
  END IF;

  SELECT COUNT(*)
  INTO v_timezone_count
  FROM public.analytics_iana_timezones;

  IF v_timezone_count < 1000 THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: lookup has only % timezone names', v_timezone_count;
  END IF;

  WITH used_timezones AS (
    SELECT event_date.timezone AS timezone_name
    FROM public.event_dates event_date
    WHERE event_date.timezone IS NOT NULL

    UNION

    SELECT availability.iana_timezone
    FROM public.venue_availability_config availability
    WHERE availability.iana_timezone IS NOT NULL
  )
  SELECT used_timezones.timezone_name
  INTO v_missing_timezone
  FROM used_timezones
  LEFT JOIN public.analytics_iana_timezones recognized_timezone
    ON recognized_timezone.name = used_timezones.timezone_name
  WHERE recognized_timezone.name IS NULL
  ORDER BY used_timezones.timezone_name
  LIMIT 1;

  IF v_missing_timezone IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: stored timezone % is not recognized', v_missing_timezone;
  END IF;
END;
$lookup_assertion$;

CREATE OR REPLACE FUNCTION public.brand_customer_commitment_patterns_rollup(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_authorized boolean;
  v_result jsonb;
BEGIN
  IF p_brand_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_authorized := public.is_admin_user()
    OR public.biz_is_brand_member_for_read_for_caller(p_brand_id);

  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'brand_id', p_brand_id,
      'authorized', false,
      'generated_at', NULL,
      'window_days', 180,
      'metric', 'qualified_customer_commitments',
      'days', jsonb_build_object(
        'state', 'unauthorized',
        'sample_commitments', 0,
        'distinct_dates', 0,
        'positive_buckets', 0,
        'winner', NULL,
        'buckets', '[]'::jsonb
      ),
      'dayparts', jsonb_build_object(
        'state', 'unauthorized',
        'sample_commitments', 0,
        'distinct_dates', 0,
        'positive_buckets', 0,
        'winner', NULL,
        'buckets', '[]'::jsonb
      ),
      'types', jsonb_build_object(
        'state', 'unauthorized',
        'sample_commitments', 0,
        'distinct_dates', 0,
        'positive_buckets', 0,
        'winner', NULL,
        'buckets', '[]'::jsonb
      )
    );
  END IF;

  WITH candidate_rows AS MATERIALIZED (
    -- Paid/partially-refunded online purchasers of ticketed offerings.
    SELECT
      COALESCE(
        NULLIF(lower(trim(o.buyer_email)), ''),
        o.buyer_phone_e164,
        'o:' || o.id::text
      ) AS customer_key,
      'event_date:' || occurrence.id::text AS occurrence_key,
      occurrence.start_at AS scheduled_at,
      occurrence.timezone AS scheduled_timezone,
      e.event_type AS type_key
    FROM public.orders o
    JOIN public.events e
      ON e.id = o.event_id
     AND e.brand_id = p_brand_id
     AND e.deleted_at IS NULL
     AND e.event_type IN ('event', 'trip', 'experience')
    JOIN LATERAL (
      SELECT ed.id, ed.start_at, ed.timezone
      FROM public.event_dates ed
      WHERE ed.event_id = o.event_id
        AND (
          (o.event_date_id IS NOT NULL AND ed.id = o.event_date_id)
          OR (
            o.event_date_id IS NULL
            AND (
              SELECT COUNT(*)
              FROM public.event_dates only_date
              WHERE only_date.event_id = o.event_id
            ) = 1
          )
        )
    ) occurrence ON true
    JOIN public.analytics_iana_timezones timezone_name
      ON timezone_name.name = occurrence.timezone
    WHERE o.payment_status IN ('paid', 'partial_refund')
      AND o.source = 'online_checkout'

    UNION ALL

    -- Approved-going identities for free RSVP offerings.
    SELECT
      COALESCE(
        NULLIF(lower(trim(er.guest_email)), ''),
        er.guest_phone,
        'e:' || er.id::text
      ) AS customer_key,
      'event_date:' || occurrence.id::text AS occurrence_key,
      occurrence.start_at AS scheduled_at,
      occurrence.timezone AS scheduled_timezone,
      'rsvp'::text AS type_key
    FROM public.event_rsvps er
    JOIN public.events e
      ON e.id = er.event_id
     AND e.brand_id = p_brand_id
     AND e.deleted_at IS NULL
     AND e.event_type = 'rsvp'
    JOIN LATERAL (
      SELECT ed.id, ed.start_at, ed.timezone
      FROM public.event_dates ed
      WHERE ed.event_id = er.event_id
        AND (
          SELECT COUNT(*)
          FROM public.event_dates only_date
          WHERE only_date.event_id = er.event_id
        ) = 1
    ) occurrence ON true
    JOIN public.analytics_iana_timezones timezone_name
      ON timezone_name.name = occurrence.timezone
    WHERE er.rsvp_status = 'going'
      AND er.approval_status = 'approved'

    UNION ALL

    -- One Mingla reservation contact per reservation, using only the venue's
    -- unambiguous named-IANA availability configuration.
    SELECT
      COALESCE(
        NULLIF(lower(trim(r.guest_email)), ''),
        r.guest_phone_e164,
        'r:' || r.id::text
      ) AS customer_key,
      'reservation:' || r.id::text AS occurrence_key,
      r.reserved_for AS scheduled_at,
      venue_timezone.iana_timezone AS scheduled_timezone,
      'venue_reservation'::text AS type_key
    FROM public.reservations r
    JOIN LATERAL (
      SELECT vac.iana_timezone
      FROM public.venue_availability_config vac
      WHERE vac.venue_id = r.venue_id
        AND vac.brand_id = r.brand_id
        AND (
          SELECT COUNT(*)
          FROM public.venue_availability_config only_config
          WHERE only_config.venue_id = r.venue_id
            AND only_config.brand_id = r.brand_id
        ) = 1
    ) venue_timezone ON true
    JOIN public.analytics_iana_timezones timezone_name
      ON timezone_name.name = venue_timezone.iana_timezone
    WHERE r.brand_id = p_brand_id
      AND r.source = 'mingla'
      AND r.status NOT IN ('cancelled_by_guest', 'cancelled_by_venue')
  ),
  scheduled_local AS (
    SELECT
      customer_key,
      occurrence_key,
      type_key,
      scheduled_at AT TIME ZONE scheduled_timezone AS local_start,
      now() AT TIME ZONE scheduled_timezone AS local_now
    FROM candidate_rows
  ),
  eligible_rows AS (
    SELECT
      customer_key,
      occurrence_key,
      type_key,
      local_start,
      local_start::date AS local_date,
      local_start::time AS local_time
    FROM scheduled_local
    WHERE local_start >= local_now - interval '180 days'
      AND local_start < local_now
  ),
  deduplicated_commitments AS (
    SELECT DISTINCT ON (customer_key, occurrence_key)
      customer_key,
      occurrence_key,
      type_key,
      local_start,
      local_date,
      local_time
    FROM eligible_rows
    ORDER BY customer_key, occurrence_key
  ),
  view_rows AS (
    SELECT
      'days'::text AS view_name,
      CASE EXTRACT(ISODOW FROM local_date)
        WHEN 1 THEN 'monday'
        WHEN 2 THEN 'tuesday'
        WHEN 3 THEN 'wednesday'
        WHEN 4 THEN 'thursday'
        WHEN 5 THEN 'friday'
        WHEN 6 THEN 'saturday'
        WHEN 7 THEN 'sunday'
      END AS bucket_key,
      CASE EXTRACT(ISODOW FROM local_date)
        WHEN 1 THEN 'Monday'
        WHEN 2 THEN 'Tuesday'
        WHEN 3 THEN 'Wednesday'
        WHEN 4 THEN 'Thursday'
        WHEN 5 THEN 'Friday'
        WHEN 6 THEN 'Saturday'
        WHEN 7 THEN 'Sunday'
      END AS bucket_label,
      EXTRACT(ISODOW FROM local_date)::integer AS canonical_order,
      local_date
    FROM deduplicated_commitments

    UNION ALL

    SELECT
      'dayparts'::text,
      CASE
        WHEN local_time >= time '05:00:00' AND local_time < time '12:00:00' THEN 'morning'
        WHEN local_time >= time '12:00:00' AND local_time < time '17:00:00' THEN 'afternoon'
        WHEN local_time >= time '17:00:00' AND local_time < time '21:00:00' THEN 'evening'
        ELSE 'late_night'
      END,
      CASE
        WHEN local_time >= time '05:00:00' AND local_time < time '12:00:00' THEN 'Morning'
        WHEN local_time >= time '12:00:00' AND local_time < time '17:00:00' THEN 'Afternoon'
        WHEN local_time >= time '17:00:00' AND local_time < time '21:00:00' THEN 'Evening'
        ELSE 'Late night'
      END,
      CASE
        WHEN local_time >= time '05:00:00' AND local_time < time '12:00:00' THEN 1
        WHEN local_time >= time '12:00:00' AND local_time < time '17:00:00' THEN 2
        WHEN local_time >= time '17:00:00' AND local_time < time '21:00:00' THEN 3
        ELSE 4
      END,
      local_date
    FROM deduplicated_commitments

    UNION ALL

    SELECT
      'types'::text,
      type_key,
      CASE type_key
        WHEN 'event' THEN 'Event'
        WHEN 'trip' THEN 'Trip'
        WHEN 'experience' THEN 'Experience'
        WHEN 'rsvp' THEN 'RSVP'
        WHEN 'venue_reservation' THEN 'Venue reservation'
      END,
      CASE type_key
        WHEN 'event' THEN 1
        WHEN 'trip' THEN 2
        WHEN 'experience' THEN 3
        WHEN 'rsvp' THEN 4
        WHEN 'venue_reservation' THEN 5
      END,
      local_date
    FROM deduplicated_commitments
    WHERE type_key IN ('event', 'trip', 'experience', 'rsvp', 'venue_reservation')
  ),
  bucket_counts AS (
    SELECT
      view_name,
      bucket_key,
      bucket_label,
      canonical_order,
      COUNT(*)::bigint AS commitments
    FROM view_rows
    GROUP BY view_name, bucket_key, bucket_label, canonical_order
  ),
  ranked_buckets AS (
    SELECT
      bucket_counts.*,
      ROW_NUMBER() OVER (
        PARTITION BY view_name
        ORDER BY commitments DESC, canonical_order
      ) AS bucket_rank
    FROM bucket_counts
  ),
  view_names(view_name) AS (
    VALUES ('days'::text), ('dayparts'::text), ('types'::text)
  ),
  view_stats AS (
    SELECT
      view_names.view_name,
      (SELECT COUNT(*)::bigint FROM deduplicated_commitments) AS sample_commitments,
      (SELECT COUNT(DISTINCT local_date)::bigint FROM deduplicated_commitments) AS distinct_dates,
      COUNT(ranked_buckets.bucket_key)::integer AS positive_buckets,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'key', ranked_buckets.bucket_key,
            'label', ranked_buckets.bucket_label,
            'commitments', ranked_buckets.commitments
          )
          ORDER BY ranked_buckets.commitments DESC, ranked_buckets.canonical_order
        ) FILTER (WHERE ranked_buckets.bucket_key IS NOT NULL),
        '[]'::jsonb
      ) AS buckets,
      MAX(ranked_buckets.commitments) FILTER (WHERE ranked_buckets.bucket_rank = 1) AS leader_count,
      MAX(ranked_buckets.commitments) FILTER (WHERE ranked_buckets.bucket_rank = 2) AS runner_up_count,
      MAX(ranked_buckets.bucket_key) FILTER (WHERE ranked_buckets.bucket_rank = 1) AS leader_key,
      MAX(ranked_buckets.bucket_label) FILTER (WHERE ranked_buckets.bucket_rank = 1) AS leader_label
    FROM view_names
    LEFT JOIN ranked_buckets
      ON ranked_buckets.view_name = view_names.view_name
    GROUP BY view_names.view_name
  ),
  view_payloads AS (
    SELECT
      view_name,
      CASE
        WHEN sample_commitments = 0 THEN 'no_data'
        WHEN sample_commitments < 10
          OR distinct_dates < 3
          OR positive_buckets < 2
          OR leader_count < 3
          THEN 'more_data_needed'
        WHEN leader_count = runner_up_count
          OR leader_count - runner_up_count < 2
          OR leader_count::numeric < runner_up_count::numeric * 1.20
          THEN 'no_clear_pattern'
        ELSE 'winner'
      END AS state,
      sample_commitments,
      distinct_dates,
      positive_buckets,
      buckets,
      leader_key,
      leader_label,
      leader_count
    FROM view_stats
  )
  SELECT jsonb_build_object(
    'brand_id', p_brand_id,
    'authorized', true,
    'generated_at', now(),
    'window_days', 180,
    'metric', 'qualified_customer_commitments',
    'days', (
      SELECT jsonb_build_object(
        'state', state,
        'sample_commitments', sample_commitments,
        'distinct_dates', distinct_dates,
        'positive_buckets', positive_buckets,
        'winner', CASE
          WHEN state = 'winner' THEN jsonb_build_object(
            'key', leader_key,
            'label', leader_label,
            'commitments', leader_count
          )
          ELSE NULL
        END,
        'buckets', buckets
      )
      FROM view_payloads
      WHERE view_name = 'days'
    ),
    'dayparts', (
      SELECT jsonb_build_object(
        'state', state,
        'sample_commitments', sample_commitments,
        'distinct_dates', distinct_dates,
        'positive_buckets', positive_buckets,
        'winner', CASE
          WHEN state = 'winner' THEN jsonb_build_object(
            'key', leader_key,
            'label', leader_label,
            'commitments', leader_count
          )
          ELSE NULL
        END,
        'buckets', buckets
      )
      FROM view_payloads
      WHERE view_name = 'dayparts'
    ),
    'types', (
      SELECT jsonb_build_object(
        'state', state,
        'sample_commitments', sample_commitments,
        'distinct_dates', distinct_dates,
        'positive_buckets', positive_buckets,
        'winner', CASE
          WHEN state = 'winner' THEN jsonb_build_object(
            'key', leader_key,
            'label', leader_label,
            'commitments', leader_count
          )
          ELSE NULL
        END,
        'buckets', buckets
      )
      FROM view_payloads
      WHERE view_name = 'types'
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.brand_customer_commitment_patterns_rollup(uuid) IS
  'ISSUE #875: private 180-day scheduled-local weekday, daypart, and offering-type patterns over deduplicated qualified Mingla customer-occurrence commitments. Descriptive booking/RSVP truth only; no attendance, money, PII, prediction, or recommendation.';

REVOKE EXECUTE ON FUNCTION public.brand_customer_commitment_patterns_rollup(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_customer_commitment_patterns_rollup(uuid)
  TO authenticated;

DO $function_assertion$
DECLARE
  v_function_oid oid;
  v_function_definition text;
  v_normalized_definition text;
  v_lookup_reference_count integer;
  v_materialized_count integer;
  v_mismatch text;
BEGIN
  SELECT function_proc.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc function_proc
  JOIN pg_catalog.pg_namespace function_namespace
    ON function_namespace.oid = function_proc.pronamespace
  WHERE function_namespace.nspname = 'public'
    AND function_proc.proname = 'brand_customer_commitment_patterns_rollup'
    AND pg_catalog.pg_get_function_identity_arguments(function_proc.oid) = 'p_brand_id uuid';

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: function signature missing';
  END IF;

  IF NOT (
    SELECT function_proc.prosecdef
      AND function_proc.provolatile = 's'
      AND COALESCE(function_proc.proconfig, '{}'::text[]) @> ARRAY['search_path=public']
    FROM pg_catalog.pg_proc function_proc
    WHERE function_proc.oid = v_function_oid
  ) THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: function attributes mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc function_proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function_proc.proacl,
        pg_catalog.acldefault('f', function_proc.proowner)
      )
    ) function_acl
    WHERE function_proc.oid = v_function_oid
      AND function_acl.grantee = 0
      AND function_acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: PUBLIC can execute';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.brand_customer_commitment_patterns_rollup(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: anon can execute';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.brand_customer_commitment_patterns_rollup(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: authenticated cannot execute';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_function_definition;

  v_normalized_definition := regexp_replace(
    lower(v_function_definition),
    '\s+',
    ' ',
    'g'
  );

  IF lower(v_function_definition) LIKE '%pg_timezone_names%' THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: runtime function still references dynamic timezone catalog';
  END IF;

  SELECT COUNT(*)::integer - 1
  INTO v_lookup_reference_count
  FROM regexp_split_to_table(
    lower(v_function_definition),
    'analytics_iana_timezones'
  );

  IF v_lookup_reference_count <> 3 THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: expected 3 lookup references, found %', v_lookup_reference_count;
  END IF;

  IF v_normalized_definition NOT LIKE '%with candidate_rows as materialized (%'
    OR v_normalized_definition LIKE '%with candidate_rows as (%'
  THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: candidate_rows materialization barrier missing';
  END IF;

  SELECT COUNT(*)::integer - 1
  INTO v_materialized_count
  FROM regexp_split_to_table(v_normalized_definition, ' as materialized \(');

  IF v_materialized_count <> 1 THEN
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: expected only candidate_rows to be materialized, found % barriers',
      v_materialized_count;
  END IF;

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
    RAISE EXCEPTION 'ISSUE #1406 apply assertion failed: protected RPC fingerprint drift: %', v_mismatch;
  END IF;
END;
$function_assertion$;

-- ISSUE #875 — private 180-day scheduled customer-commitment patterns.
--
-- Additive and dark: downstream issue #874 will add the only client consumer.
-- This function intentionally reports descriptive booking/RSVP patterns, never
-- attendance, revenue, a prediction, or a recommendation.

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

  WITH candidate_rows AS (
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
    JOIN pg_catalog.pg_timezone_names timezone_name
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
    JOIN pg_catalog.pg_timezone_names timezone_name
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
    JOIN pg_catalog.pg_timezone_names timezone_name
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

DO $assertion$
DECLARE
  v_function_oid oid;
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
    RAISE EXCEPTION 'ISSUE #875 apply assertion failed: function signature missing';
  END IF;

  IF NOT (
    SELECT function_proc.prosecdef
      AND function_proc.provolatile = 's'
      AND COALESCE(function_proc.proconfig, '{}'::text[]) @> ARRAY['search_path=public']
    FROM pg_catalog.pg_proc function_proc
    WHERE function_proc.oid = v_function_oid
  ) THEN
    RAISE EXCEPTION 'ISSUE #875 apply assertion failed: function attributes mismatch';
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
    RAISE EXCEPTION 'ISSUE #875 apply assertion failed: PUBLIC can execute';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.brand_customer_commitment_patterns_rollup(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ISSUE #875 apply assertion failed: anon can execute';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.brand_customer_commitment_patterns_rollup(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ISSUE #875 apply assertion failed: authenticated cannot execute';
  END IF;
END;
$assertion$;

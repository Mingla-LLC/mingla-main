-- META-ORCH-0972 Sub-C [brand-kind decommission + universal public authoring]
-- Stage 0 + Stage 2 + Stage 3 safe-deploy migration. Stage 4 drops
-- brands.kind in a later release-cycle migration after this is live.

BEGIN;

-- Stage 0: additive index + owner-side counts RPC.
CREATE INDEX IF NOT EXISTS events_experience_next_occurrence_idx
  ON public.events ((theme->'experience_meta'->>'next_occurrence_at'))
  WHERE event_type = 'experience' AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.pg_brand_offering_counts(p_brand_id uuid)
RETURNS TABLE (
  events bigint,
  trips bigint,
  experiences bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*) FILTER (WHERE event_type = 'event')      AS events,
    count(*) FILTER (WHERE event_type = 'trip')       AS trips,
    count(*) FILTER (WHERE event_type = 'experience') AS experiences
  FROM public.events
  WHERE brand_id = p_brand_id
    AND deleted_at IS NULL
    AND published_at IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_brand_offering_counts(uuid) TO authenticated;

-- Stage 2: views no longer select or filter on brands.kind.
DROP VIEW IF EXISTS public.business_public_events_view;
DROP VIEW IF EXISTS public.claimed_venues_public_view;
DROP VIEW IF EXISTS public.business_public_brands_view;

CREATE VIEW public.business_public_brands_view AS
SELECT
  b.id,
  b.slug,
  b.name,
  b.description,
  b.profile_photo_url,
  b.contact_email,
  b.contact_phone,
  b.social_links,
  b.custom_links,
  b.display_attendee_count,
  b.claim_status,
  b.address,
  b.cover_hue,
  b.cover_media_url,
  b.cover_media_type,
  b.profile_photo_type,
  b.created_at,
  b.updated_at
FROM public.brands b
WHERE b.deleted_at IS NULL;

COMMENT ON VIEW public.business_public_brands_view IS
  'META-ORCH-0972 Sub-C: universal public brand read model without brands.kind.';

CREATE VIEW public.claimed_venues_public_view
  WITH (security_invoker = true) AS
SELECT
  b.id,
  b.name,
  b.slug,
  b.description,
  b.profile_photo_url,
  b.profile_photo_type,
  b.contact_email,
  b.contact_phone,
  b.social_links,
  b.custom_links,
  b.display_attendee_count,
  b.default_currency,
  b.address,
  b.city,
  b.country_code,
  b.lat,
  b.lng,
  b.cover_hue,
  b.cover_media_url,
  b.cover_media_type,
  b.claim_status,
  b.venue_category,
  b.place_pool_id,
  b.google_place_id,
  b.created_at,
  b.updated_at,
  (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'weekday', bh.weekday,
          'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
          'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
          'is_closed', bh.is_closed
        )
        ORDER BY bh.weekday
      ),
      '[]'::jsonb
    )
    FROM public.brand_hours bh
    WHERE bh.brand_id = b.id
  ) AS hours,
  pp.stored_photo_urls AS pool_photo_urls
FROM public.brands b
LEFT JOIN public.place_pool pp ON pp.id = b.place_pool_id
WHERE b.deleted_at IS NULL
  AND b.claim_status = 'verified'::text;

COMMENT ON VIEW public.claimed_venues_public_view IS
  'META-ORCH-0972 Sub-C: verified venue claim public read model without brands.kind.';

CREATE VIEW public.business_public_events_view
  WITH (security_invoker = true) AS
SELECT
  e.id,
  e.brand_id,
  b.slug AS brand_slug,
  b.name AS brand_name,
  b.description AS brand_description,
  b.profile_photo_url AS brand_profile_photo_url,
  b.display_attendee_count AS brand_display_attendee_count,
  b.address AS brand_address,
  b.cover_media_url AS brand_cover_media_url,
  e.title,
  e.description,
  e.slug,
  e.event_type,
  e.location_text,
  e.online_url,
  e.is_online,
  e.is_recurring,
  e.is_multi_date,
  e.recurrence_rules,
  e.cover_media_url,
  e.cover_media_type,
  e.visibility,
  e.show_on_discover,
  e.status,
  e.published_at,
  e.timezone,
  e.created_at,
  e.updated_at,
  e.theme - 'business_draft'::text AS public_theme,
  e.currency,
  e.cover_media_provider,
  e.cover_media_source_url,
  e.cover_media_credit,
  e.cover_media_credit_url,
  e.cover_media_alt,
  ed.start_at AS master_start_at,
  ed.end_at AS master_end_at,
  ed.timezone AS master_timezone,
  ed.id AS master_event_date_id,
  e.city,
  e.party_types,
  e.vibe_tags,
  e.music_genres,
  e.location_geo
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
WHERE e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND e.visibility = 'public'::text
  AND (e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]));

COMMENT ON VIEW public.business_public_events_view IS
  'META-ORCH-0972 Sub-C: public buyer event view with brand type column removed.';

GRANT SELECT ON public.business_public_brands_view TO anon, authenticated, service_role;
GRANT SELECT ON public.claimed_venues_public_view TO anon, authenticated, service_role;
GRANT SELECT ON public.business_public_events_view TO anon, authenticated, service_role;
GRANT SELECT (claim_status) ON public.brands TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read verified physical venues" ON public.brands;
CREATE POLICY "Public can read non-deleted brands"
  ON public.brands
  FOR SELECT
  TO anon, authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "Public can read hours for verified physical venues" ON public.brand_hours;
CREATE POLICY "Public can read hours for verified venues"
  ON public.brand_hours
  FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_hours.brand_id
        AND b.deleted_at IS NULL
        AND b.claim_status = 'verified'
    )
  );

DROP POLICY IF EXISTS "Public can read place_pool for verified physical venues" ON public.place_pool;
CREATE POLICY "Public can read place_pool for verified-claimed venues"
  ON public.place_pool
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.place_pool_id = place_pool.id
        AND b.deleted_at IS NULL
        AND b.claim_status = 'verified'
    )
  );

CREATE OR REPLACE FUNCTION public.pg_public_trips_by_brand(
  p_brand_slug text
)
RETURNS TABLE (
  trip_id          uuid,
  trip_slug        text,
  brand_slug       text,
  title            text,
  description      text,
  destination_text text,
  cover_media_url  text,
  cover_media_type text,
  status           text,
  start_at         timestamptz,
  end_at           timestamptz,
  timezone         text,
  bookings_closed  boolean,
  total_capacity   integer,
  tickets_sold     integer,
  spots_left       integer,
  min_price_cents  integer,
  currency         text,
  has_free_tier    boolean,
  published_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH brand AS (
    SELECT b.id, b.slug
    FROM public.brands b
    WHERE b.slug = p_brand_slug
      AND b.deleted_at IS NULL
  ),
  trip_rows AS (
    SELECT e.id, e.slug, e.title, e.description, e.destination_text,
           e.cover_media_url, e.cover_media_type, e.status,
           e.timezone, e.bookings_closed, e.published_at
    FROM public.events e
    JOIN brand ON brand.id = e.brand_id
    WHERE e.event_type = 'trip'
      AND e.visibility = 'public'
      AND e.status IN ('scheduled', 'live', 'ended', 'cancelled')
      AND e.deleted_at IS NULL
  ),
  dates AS (
    SELECT ed.event_id, ed.start_at, ed.end_at
    FROM public.event_dates ed
    WHERE ed.event_id IN (SELECT id FROM trip_rows)
      AND ed.is_master = true
  ),
  capacity AS (
    SELECT tpt.event_id,
           bool_or(tt.is_unlimited) AS any_unlimited,
           SUM(tt.quantity_total)::int AS total_capacity
    FROM public.trip_pricing_tiers tpt
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE tpt.event_id IN (SELECT id FROM trip_rows)
      AND tt.deleted_at IS NULL
    GROUP BY tpt.event_id
  ),
  sold AS (
    SELECT tt.event_id, COUNT(*)::int AS tickets_sold
    FROM public.tickets t
    JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
    WHERE tt.event_id IN (SELECT id FROM trip_rows)
      AND t.status IN ('valid', 'used', 'transferred')
    GROUP BY tt.event_id
  ),
  pricing AS (
    SELECT tpt.event_id,
           MIN(NULLIF(tt.price_cents, 0)) FILTER (WHERE NOT tt.is_free) AS min_price_cents,
           (ARRAY_AGG(tt.currency ORDER BY tt.price_cents ASC, tt.id ASC)
              FILTER (WHERE NOT tt.is_free))[1] AS currency,
           bool_or(tt.is_free) AS has_free_tier
    FROM public.trip_pricing_tiers tpt
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE tpt.event_id IN (SELECT id FROM trip_rows)
      AND tt.deleted_at IS NULL
    GROUP BY tpt.event_id
  )
  SELECT
    tr.id                    AS trip_id,
    tr.slug                  AS trip_slug,
    (SELECT slug FROM brand) AS brand_slug,
    tr.title,
    tr.description,
    tr.destination_text,
    tr.cover_media_url,
    tr.cover_media_type,
    tr.status,
    d.start_at,
    d.end_at,
    tr.timezone,
    tr.bookings_closed,
    CASE WHEN c.any_unlimited THEN NULL ELSE c.total_capacity END AS total_capacity,
    COALESCE(s.tickets_sold, 0) AS tickets_sold,
    CASE
      WHEN c.any_unlimited THEN NULL
      WHEN c.total_capacity IS NULL THEN NULL
      ELSE GREATEST(c.total_capacity - COALESCE(s.tickets_sold, 0), 0)
    END AS spots_left,
    p.min_price_cents,
    p.currency,
    COALESCE(p.has_free_tier, false) AS has_free_tier,
    tr.published_at
  FROM trip_rows tr
  LEFT JOIN dates    d ON d.event_id = tr.id
  LEFT JOIN capacity c ON c.event_id = tr.id
  LEFT JOIN sold     s ON s.event_id = tr.id
  LEFT JOIN pricing  p ON p.event_id = tr.id
  ORDER BY
    (CASE WHEN tr.status IN ('scheduled','live') THEN 0 ELSE 1 END),
    d.start_at NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.pg_public_trips_by_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_trips_by_brand(text) TO anon, authenticated;

COMMENT ON FUNCTION public.pg_public_trips_by_brand(text) IS
  'META-ORCH-0972 Sub-C: anon-callable public trips by brand without brands.kind guard. Sold formula mirrors I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE.';

CREATE OR REPLACE FUNCTION public.pg_public_experiences_by_brand(p_brand_slug text)
RETURNS TABLE (
  experience_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  experience_slug text,
  title text,
  description text,
  cover_media_url text,
  theme jsonb,
  venue_text text,
  next_occurrence_at timestamptz,
  price_from_cents bigint,
  currency text,
  is_free boolean,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    e.id AS experience_id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    e.slug AS experience_slug,
    e.title,
    e.description,
    e.cover_media_url,
    e.theme,
    (e.theme->'experience_meta'->>'venue_text')::text AS venue_text,
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz AS next_occurrence_at,
    (
      SELECT min(tt.price_cents)
      FROM public.ticket_types tt
      WHERE tt.event_id = e.id
        AND tt.deleted_at IS NULL
        AND tt.is_hidden IS NOT TRUE
        AND tt.is_disabled IS NOT TRUE
    ) AS price_from_cents,
    e.currency::text AS currency,
    (
      SELECT NOT EXISTS (
        SELECT 1
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.price_cents > 0
      )
    ) AS is_free,
    e.published_at
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  WHERE b.slug = p_brand_slug
    AND b.deleted_at IS NULL
    AND e.event_type = 'experience'
    AND e.visibility = 'public'
    AND e.published_at IS NOT NULL
    AND e.deleted_at IS NULL
  ORDER BY
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz ASC NULLS LAST,
    e.published_at DESC;
$$;

REVOKE ALL ON FUNCTION public.pg_public_experiences_by_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_experiences_by_brand(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.pg_public_brand_upcoming(
  p_brand_slug text,
  p_cursor_at timestamptz DEFAULT now(),
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  offering_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  offering_type text,
  offering_slug text,
  title text,
  description text,
  cover_media_url text,
  cover_media_type text,
  theme jsonb,
  starts_at timestamptz,
  price_from_cents bigint,
  currency text,
  is_free boolean,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH offerings AS (
    SELECT
      e.id AS offering_id,
      e.brand_id,
      b.slug AS brand_slug,
      b.name AS brand_name,
      e.event_type AS offering_type,
      e.slug AS offering_slug,
      e.title,
      e.description,
      e.cover_media_url,
      e.cover_media_type,
      e.theme,
      CASE e.event_type
        WHEN 'event' THEN ed.start_at
        WHEN 'trip' THEN ed.start_at
        WHEN 'experience' THEN NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz
      END AS starts_at,
      (
        SELECT min(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
      ) AS price_from_cents,
      e.currency::text AS currency,
      (
        SELECT NOT EXISTS (
          SELECT 1
          FROM public.ticket_types tt
          WHERE tt.event_id = e.id
            AND tt.deleted_at IS NULL
            AND tt.price_cents > 0
        )
      ) AS is_free,
      e.published_at
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND b.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.published_at IS NOT NULL
      AND e.status IN ('scheduled', 'live')
  )
  SELECT
    o.offering_id,
    o.brand_id,
    o.brand_slug,
    o.brand_name,
    o.offering_type,
    o.offering_slug,
    o.title,
    o.description,
    o.cover_media_url,
    o.cover_media_type,
    o.theme,
    o.starts_at,
    o.price_from_cents,
    o.currency,
    o.is_free,
    o.published_at
  FROM offerings o
  WHERE o.starts_at IS NOT NULL
    AND o.starts_at > COALESCE(p_cursor_at, now())
  ORDER BY o.starts_at ASC, o.published_at DESC
  LIMIT (LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100) + 1);
$$;

REVOKE ALL ON FUNCTION public.pg_public_brand_upcoming(text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_brand_upcoming(text, timestamptz, integer) TO anon, authenticated;

-- Stage 3: SECURITY DEFINER bodies no longer write or filter on brands.kind.
CREATE OR REPLACE FUNCTION public.biz_create_venue_brand_pending_review (
  p_name text,
  p_slug text,
  p_description text,
  p_google_place_id text,
  p_lat double precision,
  p_lng double precision,
  p_city text,
  p_country_code text,
  p_address text,
  p_venue_category text,
  p_contact_email text,
  p_contact_phone text,
  p_cover_media_url text,
  p_cover_media_type text,
  p_hours jsonb,
  p_place_pool_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_brand_id uuid;
  v_idx int;
  v_hour jsonb;
  v_cover_url text;
  v_cover_type text;
  v_pool_google text;
BEGIN
  v_uid := auth.uid ();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  IF length(trim(coalesce(p_slug, ''))) = 0 THEN
    RAISE EXCEPTION 'slug_required';
  END IF;

  IF trim(p_slug) !~ '^[a-z0-9]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;

  IF p_google_place_id IS NULL OR length(trim(p_google_place_id)) = 0 THEN
    RAISE EXCEPTION 'google_place_id_required';
  END IF;

  IF p_hours IS NULL OR jsonb_typeof(p_hours) != 'array' OR jsonb_array_length(p_hours) != 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;

  IF p_venue_category IS NULL OR p_venue_category NOT IN ('restaurant', 'play', 'creative_and_arts') THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;

  IF p_place_pool_id IS NOT NULL THEN
    SELECT p.google_place_id
    INTO v_pool_google
    FROM public.place_pool p
    WHERE p.id = p_place_pool_id
      AND p.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'place_pool_not_found';
    END IF;

    IF trim(v_pool_google) IS DISTINCT FROM trim(p_google_place_id) THEN
      RAISE EXCEPTION 'place_pool_google_place_id_mismatch';
    END IF;
  END IF;

  v_cover_url := nullif(trim(coalesce(p_cover_media_url, '')), '');
  v_cover_type := nullif(trim(coalesce(p_cover_media_type, '')), '');

  IF v_cover_type IS NOT NULL AND v_cover_type NOT IN ('image', 'video', 'gif') THEN
    RAISE EXCEPTION 'invalid_cover_media_type';
  END IF;

  IF v_cover_url IS NOT NULL AND v_cover_type IS NULL THEN
    RAISE EXCEPTION 'cover_media_type_required';
  END IF;

  IF v_cover_url IS NULL THEN
    v_cover_type := NULL;
  END IF;

  INSERT INTO public.brands (
    account_id,
    name,
    slug,
    description,
    address,
    google_place_id,
    place_pool_id,
    lat,
    lng,
    city,
    country_code,
    claim_status,
    venue_category,
    contact_email,
    contact_phone,
    cover_media_url,
    cover_media_type,
    cover_hue,
    tax_settings,
    social_links,
    custom_links,
    display_attendee_count,
    stripe_connect_id,
    stripe_payouts_enabled,
    stripe_charges_enabled
  )
  VALUES (
    v_uid,
    trim(p_name),
    trim(p_slug),
    p_description,
    nullif(trim(p_address), ''),
    trim(p_google_place_id),
    p_place_pool_id,
    p_lat,
    p_lng,
    nullif(trim(p_city), ''),
    nullif(trim(p_country_code), ''),
    'pending_review',
    p_venue_category,
    nullif(trim(p_contact_email), ''),
    nullif(trim(p_contact_phone), ''),
    v_cover_url,
    v_cover_type,
    25,
    '{}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    true,
    NULL,
    false,
    false
  )
  RETURNING id INTO v_brand_id;

  FOR v_idx IN 0 .. 6 LOOP
    v_hour := p_hours -> v_idx;
    IF v_hour IS NULL THEN
      RAISE EXCEPTION 'missing_hour_index_%', v_idx;
    END IF;

    INSERT INTO public.brand_hours (
      brand_id,
      weekday,
      open_time,
      close_time,
      is_closed
    )
    VALUES (
      v_brand_id,
      (v_hour ->> 'weekday')::smallint,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'open_time' IS NULL OR (v_hour ->> 'open_time') = '' THEN NULL
        ELSE (v_hour ->> 'open_time')::time
      END,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'close_time' IS NULL OR (v_hour ->> 'close_time') = '' THEN NULL
        ELSE (v_hour ->> 'close_time')::time
      END,
      coalesce((v_hour ->> 'is_closed')::boolean, false)
    );
  END LOOP;

  RETURN v_brand_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.biz_review_venue_claim (
  p_brand_id uuid,
  p_action text,
  p_rejection_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_dup_count integer := 0;
  v_reason text;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_admin_user () THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_action NOT IN ('mark_called', 'approve', 'reject', 'need_more_info') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT *
  INTO v_brand
  FROM public.brands b
  WHERE b.id = p_brand_id
    AND b.deleted_at IS NULL
    AND b.claim_status IN ('pending_review','verified','rejected');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  IF p_action = 'mark_called' THEN
    IF v_brand.claim_status <> 'pending_review' THEN
      IF v_brand.marked_called_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'noop', true);
      END IF;
      RAISE EXCEPTION 'brand_not_pending_review';
    END IF;

    IF v_brand.marked_called_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'noop', true);
    END IF;

    UPDATE public.brands
    SET
      marked_called_at = now(),
      marked_called_by = auth.uid()
    WHERE id = p_brand_id;

    RETURN jsonb_build_object('ok', true, 'action', 'mark_called');
  END IF;

  IF p_action = 'need_more_info' THEN
    IF v_brand.claim_status <> 'pending_review' THEN
      RAISE EXCEPTION 'brand_not_pending_review';
    END IF;

    UPDATE public.brands
    SET claim_follow_up_at = now()
    WHERE id = p_brand_id;

    RETURN jsonb_build_object('ok', true, 'action', 'need_more_info');
  END IF;

  IF p_action = 'approve' THEN
    IF v_brand.claim_status = 'verified' THEN
      RETURN jsonb_build_object('ok', true, 'noop', true, 'claim_status', 'verified');
    END IF;

    IF v_brand.claim_status <> 'pending_review' THEN
      RAISE EXCEPTION 'brand_not_pending_review';
    END IF;

    IF v_brand.marked_called_at IS NULL THEN
      RAISE EXCEPTION 'must_mark_called_first';
    END IF;

    IF v_brand.google_place_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.brands b2
      WHERE b2.deleted_at IS NULL
        AND b2.id <> p_brand_id
        AND b2.google_place_id = v_brand.google_place_id
        AND b2.claim_status = 'verified'
    ) THEN
      RAISE EXCEPTION 'google_place_already_verified';
    END IF;

    UPDATE public.brands
    SET
      claim_status = 'verified',
      verified_at = now(),
      verified_by = auth.uid(),
      rejection_reason = NULL,
      claim_follow_up_at = NULL,
      duplicate_of_brand_id = NULL
    WHERE id = p_brand_id;

    IF v_brand.google_place_id IS NOT NULL THEN
      UPDATE public.brands
      SET duplicate_of_brand_id = p_brand_id
      WHERE deleted_at IS NULL
        AND id <> p_brand_id
        AND google_place_id = v_brand.google_place_id
        AND claim_status = 'pending_review'
        AND duplicate_of_brand_id IS DISTINCT FROM p_brand_id;

      GET DIAGNOSTICS v_dup_count = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
      'ok',
      true,
      'action',
      'approve',
      'claim_status',
      'verified',
      'duplicate_flagged_count',
      v_dup_count
    );
  END IF;

  IF v_brand.claim_status = 'rejected' THEN
    RETURN jsonb_build_object('ok', true, 'noop', true, 'claim_status', 'rejected');
  END IF;

  IF v_brand.claim_status <> 'pending_review' THEN
    RAISE EXCEPTION 'brand_not_pending_review';
  END IF;

  v_reason := nullif(trim(coalesce(p_rejection_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'rejection_reason_required';
  END IF;

  UPDATE public.brands
  SET
    claim_status = 'rejected',
    rejection_reason = v_reason,
    verified_at = NULL,
    verified_by = NULL,
    claim_follow_up_at = NULL,
    duplicate_of_brand_id = NULL
  WHERE id = p_brand_id;

  RETURN jsonb_build_object(
    'ok',
    true,
    'action',
    'reject',
    'claim_status',
    'rejected'
  );
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

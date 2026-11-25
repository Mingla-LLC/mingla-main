-- #4490 P1 migration 5 — the feature-driven public venue page read.
--
-- pg_public_venue_page(brand_slug, venue_slug) is what the guest page (web and
-- app) reads to decide its third info row, tabs and booking bar: FEATURES,
-- never venue_category (reconciliation ruling 5, A-N1, conflicts 1–5, 33, 65).
--   * the venue row (the same columns venue_public_view returns),
--   * features = enabled AND every dependency met AND shipped (built),
--   * spaces (active; planShape whenever set), hours {weekly, specialDays},
--   * events.upcoming (next 6 public events at this venue, when events_here is on),
--   * tables {partyMax, ...} only when table_reservations is a feature,
--   * offers [] (P2 fills them; always [] while VENUE_OFFERS_READS is off),
--   * no ways_to_come and no booking_bar (the client derives them).
-- Same gate as venue_public_view: a verified venue of a live brand, else NULL.
-- biz_preview_venue_page(venue_id): the same payload for brand members, any
-- claim status (Host preview). admin_venue_features(venue_id): Mingla admins.
--
-- Static SQL. Local stack only until Seth says otherwise.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- The venue row in venue_public_view's exact column set, without its claim
-- gate (callers apply their own). Kept beside the view: the P1-5 suite proves
-- the two agree column for column.
CREATE OR REPLACE FUNCTION public.issue_4490_venue_page_row(p_venue_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', v.id, 'brand_id', v.brand_id, 'brand_slug', b.slug, 'brand_name', b.name,
    'slug', v.slug, 'name', v.name, 'address', v.address, 'city', v.city,
    'country_code', v.country_code, 'lat', v.lat, 'lng', v.lng,
    'venue_category', v.venue_category, 'google_place_id', v.google_place_id,
    'contact_email', v.contact_email, 'contact_phone', v.contact_phone,
    'cover_media_url', v.cover_media_url, 'cover_media_type', v.cover_media_type,
    'place_pool_id', v.place_pool_id,
    'theme_color', COALESCE(v.theme_color_override, b.theme_color),
    'theme_font', COALESCE(v.theme_font_override, b.theme_font),
    'theme_animation', COALESCE(v.theme_animation_override, b.theme_animation),
    'cover_hue', b.cover_hue, 'default_currency', b.default_currency,
    'hours', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'weekday', bh.weekday, 'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
        'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
        'is_closed', bh.is_closed) ORDER BY bh.weekday), '[]'::jsonb)
       FROM public.brand_hours bh WHERE bh.venue_id = v.id AND bh.window_ordinal = 0),
    'pool_photo_urls', to_jsonb(pp.stored_photo_urls),
    'pitch', pp.generative_summary,
    'created_at', v.created_at, 'updated_at', v.updated_at,
    'iana_timezone', CASE WHEN vac.iana_timezone_source IN ('derived', 'operator')
                          THEN vac.iana_timezone END,
    'cover_media_poster_url', v.cover_media_poster_url,
    'hours_windows', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'weekday', bh.weekday, 'window_ordinal', bh.window_ordinal,
        'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
        'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
        'is_closed', bh.is_closed) ORDER BY bh.weekday, bh.window_ordinal), '[]'::jsonb)
       FROM public.brand_hours bh WHERE bh.venue_id = v.id),
    'special_hours', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'local_date', sh.local_date, 'label', sh.label,
        'is_closed', sh.is_closed, 'windows', sh.windows) ORDER BY sh.local_date), '[]'::jsonb)
       FROM public.venue_special_hours sh
       WHERE sh.venue_id = v.id
         AND sh.local_date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1
                               AND (now() AT TIME ZONE 'UTC')::date + 60)
  )
  FROM public.venue_listings v
  JOIN public.brands b ON b.id = v.brand_id
  LEFT JOIN public.place_pool pp ON pp.id = v.place_pool_id
  LEFT JOIN public.venue_availability_config vac ON vac.venue_id = v.id
  WHERE v.id = p_venue_id;
$function$;

-- Features the public page may show: on, every dependency met, shipped.
CREATE OR REPLACE FUNCTION public.issue_4490_public_features(p_venue_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH rows AS (SELECT * FROM public.issue_4490_venue_feature_rows(p_venue_id))
  SELECT COALESCE(array_agg(r.feature_key ORDER BY array_position(public.issue_4490_feature_keys(), r.feature_key)), '{}'::text[])
  FROM rows r
  WHERE r.enabled
    AND r.feature_key = ANY(public.issue_4490_built_features())
    AND NOT EXISTS (
      SELECT 1 FROM unnest(public.issue_4490_feature_ancestors(r.feature_key)) AS parent
      WHERE NOT EXISTS (SELECT 1 FROM rows p WHERE p.feature_key = parent AND p.enabled)
    )
    AND (NOT public.issue_4490_feature_needs_space(r.feature_key)
         OR public.issue_4490_venue_active_space_count(p_venue_id) > 0);
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_page_payload(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_row jsonb;
  v_features text[];
  v_currency text;
  v_brand_slug text;
  v_spaces jsonb;
  v_events jsonb;
  v_tables jsonb;
  v_version bigint;
BEGIN
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_row := public.issue_4490_venue_page_row(p_venue_id);
  v_features := public.issue_4490_public_features(p_venue_id);
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')), b.slug
    INTO v_currency, v_brand_slug
  FROM public.brands b WHERE b.id = v_venue.brand_id;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'setting', s.setting,
      'capacityStanding', s.capacity_standing,
      'capacitySeated', s.capacity_seated,
      'planShape', s.plan_shape,
      'photoUrls', (SELECT COALESCE(jsonb_agg(p->>'url' ORDER BY i), '[]'::jsonb)
                    FROM jsonb_array_elements(s.photos) WITH ORDINALITY AS ph(p, i))
    )) ORDER BY s.sort_order, s.created_at), '[]'::jsonb)
  INTO v_spaces
  FROM public.venue_spaces s
  WHERE s.venue_id = p_venue_id AND s.is_active AND s.archived_at IS NULL;

  IF 'events_here' = ANY(v_features) THEN
    SELECT COALESCE(jsonb_agg(item ORDER BY starts_at), '[]'::jsonb)
    INTO v_events
    FROM (
      SELECT jsonb_build_object(
          'id', e.id,
          'kind', e.event_type,
          'title', e.title,
          'startsAt', nd.starts_at,
          'spaceName', sp.name,
          'fromMinor', (SELECT min(tt.price_cents) FROM public.ticket_types tt
                        WHERE tt.event_id = e.id AND tt.deleted_at IS NULL
                          AND NOT COALESCE(tt.is_hidden, false) AND NOT COALESCE(tt.is_disabled, false)),
          'href', CASE e.event_type
                    WHEN 'experience' THEN '/exp/' || v_brand_slug || '/' || e.slug
                    WHEN 'trip' THEN '/t/' || v_brand_slug || '/' || e.slug
                    ELSE '/e/' || v_brand_slug || '/' || e.slug END
        ) AS item,
        nd.starts_at
      FROM public.events e
      CROSS JOIN LATERAL (
        SELECT min(d.start_at) AS starts_at FROM public.event_dates d
        WHERE d.event_id = e.id AND d.start_at > now()
      ) nd
      LEFT JOIN public.venue_spaces sp ON sp.id = e.space_id
      WHERE e.venue_id = p_venue_id
        AND e.visibility = 'public'
        AND e.status IN ('scheduled', 'live')
        AND e.deleted_at IS NULL
        AND e.slug IS NOT NULL
        AND nd.starts_at IS NOT NULL
      ORDER BY nd.starts_at
      LIMIT 6
    ) upcoming;
  ELSE
    v_events := '[]'::jsonb;
  END IF;

  IF 'table_reservations' = ANY(v_features) THEN
    v_tables := jsonb_build_object(
      'partyMax', (SELECT LEAST(100, max(t.capacity)) FROM public.venue_tables t
                   WHERE t.venue_id = p_venue_id AND t.is_active AND t.deleted_at IS NULL
                     AND t.reservation_policy = 'reservable'),
      'pickATable', NULL,
      'holdFromMinor', NULL,
      'minSpendFromMinor', NULL,
      'largePartyRequest', NULL,
      'guestWaitlist', NULL
    );
  END IF;

  SELECT GREATEST(
      COALESCE((SELECT max(f.version) FROM public.venue_features f WHERE f.venue_id = p_venue_id), 0),
      COALESCE((SELECT max(s.version) FROM public.venue_spaces s WHERE s.venue_id = p_venue_id), 0))
  INTO v_version;

  RETURN jsonb_build_object(
    'version', v_version,
    'venue', v_row,
    'currencyCode', v_currency,
    -- #4490 W3 fix 1: the exponent comes from its one owner (supported_brand_currencies).
    'minorUnitExponent', COALESCE((SELECT c.minor_unit_exponent FROM public.supported_brand_currencies c
                                   WHERE c.code = v_currency), 2),
    'vat', NULL,
    'features', to_jsonb(v_features),
    'spaces', v_spaces,
    'hours', jsonb_build_object('weekly', v_row->'hours_windows', 'specialDays', v_row->'special_hours'),
    'events', jsonb_build_object('upcoming', v_events),
    'tables', v_tables,
    'offers', '[]'::jsonb,
    'memberships', '[]'::jsonb
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pg_public_venue_page(p_brand_slug text, p_venue_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  SELECT v.id INTO v_id
  FROM public.venue_listings v
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE b.slug = p_brand_slug AND v.slug = p_venue_slug AND v.claim_status = 'verified';
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN public.issue_4490_venue_page_payload(v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_preview_venue_page(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_brand uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT brand_id INTO v_brand FROM public.venue_listings WHERE id = p_venue_id;
  IF v_brand IS NULL THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.biz_is_brand_member_for_read_for_caller(v_brand) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4490_venue_page_payload(p_venue_id) || jsonb_build_object('preview', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_venue_features(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_listings WHERE id = p_venue_id) THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.issue_4490_get_venue_features(p_venue_id)
    || jsonb_build_object('page', public.issue_4490_venue_page_payload(p_venue_id));
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_venue_page_row(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_public_features(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_venue_page_payload(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_page_payload(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.pg_public_venue_page(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_venue_page(text, text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.biz_preview_venue_page(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_preview_venue_page(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_venue_features(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_venue_features(uuid) TO authenticated;

COMMIT;

-- Reverse (local use only): DROP FUNCTION public.admin_venue_features(uuid),
--   public.biz_preview_venue_page(uuid), public.pg_public_venue_page(text, text),
--   public.issue_4490_venue_page_payload(uuid), public.issue_4490_public_features(uuid),
--   public.issue_4490_venue_page_row(uuid);

-- issue #3281 PR7 — discover_v2_event_base schedule keys after #4174.
-- Timestamp after 20280208004174 so CREATE OR REPLACE keeps the explorer
-- internal-brand guard. Schedule helper stays off this eligibility base.

BEGIN;

-- Discover base: append schedule keys (master_* stay the windowed next occurrence).
CREATE OR REPLACE FUNCTION public.discover_v2_event_base(
  p_cities text[], p_lower_bound timestamptz, p_upper_start timestamptz DEFAULT NULL,
  p_party_types text[] DEFAULT NULL, p_vibe_tags text[] DEFAULT NULL,
  p_music_genres text[] DEFAULT NULL, p_center_lng float8 DEFAULT NULL,
  p_center_lat float8 DEFAULT NULL, p_radius_km float8 DEFAULT NULL
) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id',e.id,'brand_id',e.brand_id,'title',e.title,'description',e.description,'slug',e.slug,
    'location_text',CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_text END,
    'location_geo',CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE to_jsonb(e.location_geo) END,
    'online_url',e.online_url,'is_online',e.is_online,'cover_media_url',e.cover_media_url,
    'cover_media_type',e.cover_media_type,'theme',public.issue_2489_public_theme(e.theme),
    'timezone',e.timezone,'currency',e.currency,'city',e.city,'party_types',to_jsonb(e.party_types),
    'vibe_tags',to_jsonb(e.vibe_tags),'music_genres',to_jsonb(e.music_genres),'event_type',e.event_type,
    'brand_slug',b.slug,'brand_name',b.name,'brand_profile_photo_url',b.profile_photo_url,
    'master_start_at',ed.start_at,'master_end_at',ed.end_at,'master_timezone',ed.timezone,
    -- Window-selected occurrence is the card timestamp authority (#3281 PR7).
    -- Do NOT run the full schedule helper here: this base feeds eligibility,
    -- facets, and counts before pagination (same page-only rule as admin_list).
    'next_start_at',ed.start_at,
    'next_end_at',ed.end_at,
    'upcoming_count',NULL,
    'schedule_line',NULL,
    'price_min_cents',(SELECT min(tt.price_cents) FROM public.ticket_types tt
      WHERE tt.event_id=e.id AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE
        AND tt.is_disabled IS NOT TRUE AND tt.price_cents IS NOT NULL),
    'price_max_cents',(SELECT max(tt.price_cents) FROM public.ticket_types tt
      WHERE tt.event_id=e.id AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE
        AND tt.is_disabled IS NOT TRUE AND tt.price_cents IS NOT NULL),
    'display_price_cents',public.discover_v2_from_price_minor(e.id),
    'pricing_currency',b.pricing_currency
  )
  FROM public.events e
  JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
  JOIN public.event_dates master_ed ON master_ed.event_id=e.id
    AND master_ed.is_master IS TRUE
  JOIN LATERAL (
    SELECT occurrence.start_at,occurrence.end_at,occurrence.timezone
    FROM public.event_dates occurrence
    WHERE occurrence.event_id=e.id AND occurrence.end_at>=p_lower_bound
      AND (p_upper_start IS NULL OR occurrence.start_at<=p_upper_start)
    ORDER BY occurrence.start_at,occurrence.id LIMIT 1
  ) ed ON true
  WHERE e.deleted_at IS NULL
    AND public.issue_4174_explorer_brand_visible(e.brand_id)
    AND e.visibility='public'
    AND (e.event_type='event' OR (e.event_type='rsvp' AND e.rsvp_discoverable=true))
    AND e.status=ANY(ARRAY['scheduled','live'])
    AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    AND (
      e.city=ANY(p_cities)
      OR (p_center_lng IS NOT NULL AND p_center_lat IS NOT NULL AND p_radius_km IS NOT NULL
        AND e.location_geo IS NOT NULL AND public.ST_DWithin(
          public.ST_SetSRID(e.location_geo::public.geometry,4326)::public.geography,
          public.ST_SetSRID(public.ST_MakePoint(p_center_lng,p_center_lat),4326)::public.geography,
          p_radius_km*1000))
      OR (e.is_online IS TRUE AND lower(btrim(COALESCE(e.theme->'business_event'->>'format',''),
        E' \t\n\r\f\v'||chr(160)))='online')
    )
    AND (p_party_types IS NULL OR cardinality(p_party_types)=0 OR e.party_types && p_party_types)
    AND (p_vibe_tags IS NULL OR cardinality(p_vibe_tags)=0 OR e.vibe_tags && p_vibe_tags)
    AND (p_music_genres IS NULL OR cardinality(p_music_genres)=0 OR e.music_genres && p_music_genres)
    AND NOT (
      EXISTS (SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id
        AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE AND tt.is_disabled IS NOT TRUE
        AND tt.available_online IS TRUE AND tt.price_cents>0)
      AND NOT public.pg_brand_can_collect(e.brand_id)
    )
$function$;


COMMIT;

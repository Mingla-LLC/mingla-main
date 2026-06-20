-- ORCH-1163 [rsvp-shared-body] — Migration 1: canonical anon RSVP read RPC.
--
-- LEG 2 of META-ORCH-1166 (public offering-page single source of truth). Sibling
-- of ORCH-1167's pg_public_event_by_slug (LEG 1), restricted to event_type='rsvp'.
--
-- WHAT: `pg_public_rsvp_by_slug(p_brand_slug, p_event_slug) RETURNS json` — the ONE
-- anon read path that fills the shared `RsvpOfferingBody` props on ALL THREE surfaces
-- (buyer-web, business native, consumer app). Returns identity/slugs/description,
-- date fields, status, derived format, venue + privacy-gated geo, cover, brand card,
-- the pills arrays (party_types / vibe_tags / music_genres), city + city_geo — and
-- the RSVP HOST-CONTROL block (rsvpGoingCount / rsvpCapacity / rsvpAllowPlusOnes /
-- rsvpPlusOnesMax / rsvpWaitlistEnabled / rsvpApprovalMode), NOT a `tickets` aggregate
-- (RSVP is ticketless). See SPEC §C.
--
-- PRIVACY (server-side, I-PROPOSED-1163-... / mirrors I-PROPOSED-1167-CITY-LEVEL-MAP-
-- NO-EXACT-PIN-WHEN-HIDDEN): when the event hides the street until the viewer is
-- going (theme.business_event.hideAddressUntilTicket, defaulting TRUE for safety),
-- the RPC OMITS the exact `address` + `location_geo` and returns ONLY `city` +
-- `city_geo`. The anon RPC NEVER returns the exact pin for a hidden-address RSVP. The
-- post-RSVP street reveal rides the client (SPEC OQ-2, out of scope here).
--
-- rsvpGoingCount math is byte-identical to submit_event_rsvp's capacity predicate:
-- SUM(1 + plus_count) over rows that are rsvp_status='going' AND
-- approval_status='approved' (ORCH-1150 maybe = cap-neutral, never counted).
--
-- SAFE-MIGRATION PROTOCOL:
--   • SECURITY DEFINER, STABLE, SET search_path = public; reads ONLY anon-safe cols.
--   • $function$ terminator BEFORE the GRANT.
--   • DROP IF EXISTS before CREATE (RETURNS json → no RETURNS-TABLE widening hazard).
--   • GRANT EXECUTE TO anon, authenticated. NOTIFY pgrst.
--
-- DO NOT auto-apply — orchestrator/Seth applies via the Management API (SPEC §13).

DROP FUNCTION IF EXISTS public.pg_public_rsvp_by_slug(text, text);

CREATE FUNCTION public.pg_public_rsvp_by_slug(
  p_brand_slug text,
  p_event_slug text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_credit,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      -- RSVP host-control columns (ORCH-1150 mig 20261004000000).
      e.rsvp_capacity,
      e.rsvp_allow_plus_ones,
      e.rsvp_plus_ones_max,
      e.rsvp_waitlist_enabled,
      e.rsvp_approval_mode,
      (e.theme - 'business_draft'::text) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb). Default
      -- TRUE when absent so a legacy row never leaks the street (mirror the event RPC).
      COALESCE(
        ((e.theme #>> '{business_event,hideAddressUntilTicket}')::boolean),
        true
      ) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'rsvp'            -- RSVP ONLY (SPEC scope)
      AND e.visibility = 'public'::text
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
    LIMIT 1
  ),
  going AS (
    -- Confirmed-going headcount: SUM(1 + plus_count) over going+approved rows.
    -- Byte-identical to submit_event_rsvp's capacity predicate (maybe excluded =
    -- cap-neutral, ORCH-1150).
    SELECT COALESCE(SUM(1 + r.plus_count), 0) AS going_count
      FROM public.event_rsvps r
      JOIN ev ON ev.id = r.event_id
     WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text),
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng}.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.location_geo::geometry),
          'lng', ST_X(ev.location_geo::geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.city_geo),
          'lng', ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'brand', json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      -- RSVP host-control block (REPLACES the event RPC's `tickets` aggregate).
      'rsvpGoingCount', (SELECT going_count FROM going),
      'rsvpCapacity', ev.rsvp_capacity,
      'rsvpAllowPlusOnes', ev.rsvp_allow_plus_ones,
      'rsvpPlusOnesMax', ev.rsvp_plus_ones_max,
      'rsvpWaitlistEnabled', ev.rsvp_waitlist_enabled,
      'rsvpApprovalMode', ev.rsvp_approval_mode
    ) END
  FROM ev;
$function$;

COMMENT ON FUNCTION public.pg_public_rsvp_by_slug(text, text) IS
  'ORCH-1163 — the ONE canonical anon read path for the public RSVP page '
  '(event_type=rsvp). Returns the full RsvpOfferingBody payload as json incl. pills '
  '(party/vibe/music), city + city_geo, and the RSVP host-control block '
  '(rsvpGoingCount/rsvpCapacity/rsvpAllowPlusOnes/rsvpPlusOnesMax/rsvpWaitlistEnabled/'
  'rsvpApprovalMode). NO tickets aggregate (RSVP is ticketless). PRIVACY: omits '
  'address + exact location_geo when the street is hidden, returning only city + city_geo.';

GRANT EXECUTE ON FUNCTION public.pg_public_rsvp_by_slug(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

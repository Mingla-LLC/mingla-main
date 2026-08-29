-- Issue #2774 — expose the existing author/provider primary-cover alt text through
-- the four canonical anonymous offering readers. Every predicate, privacy branch,
-- commerce value, visibility gate, search_path, and existing JSON key remains copied
-- from its latest definition; coverMediaAlt is the sole additive root payload key.
-- Written only: apply from merged main after the orchestrator's drift and read-only checks.

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_public_event_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'event'           -- standard ticketed ONLY (SPEC scope)
      AND e.visibility = 'public'::text
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
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
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
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
      'coverMediaAlt', ev.cover_media_alt,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
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
      'tickets', COALESCE((
        SELECT json_agg(json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json)
    ) END
  FROM ev;
$function$
;

CREATE OR REPLACE FUNCTION public.pg_public_rsvp_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
      e.cover_media_alt,
      e.cover_media_provider,
      e.cover_media_credit,
      e.cover_media_gallery,
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
      public.issue_2489_public_theme(e.theme) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb). Default
      -- TRUE when absent so a legacy row never leaks the street (mirror the event RPC).
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
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
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
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
      'coverMediaAlt', ev.cover_media_alt,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
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
$function$
;

CREATE OR REPLACE FUNCTION public.pg_public_trip_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tr AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.status,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.departure_text,
      e.destination_text,
      e.refund_policy,
      e.booking_deadline,
      e.bookings_closed,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      e.theme               AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      b.id                  AS brand_id_b,
      b.slug                AS brand_slug,
      b.name                AS brand_name,
      b.description         AS brand_description,
      b.cover_media_url     AS brand_cover_media_url,
      b.cover_media_type    AS brand_cover_media_type,
      b.cover_hue           AS brand_cover_hue,
      b.theme_color         AS brand_theme_color,
      b.theme_font          AS brand_theme_font,
      b.theme_animation     AS brand_theme_animation,
      (b.claim_status = 'verified') AS brand_is_verified
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'trip'             -- trip ONLY (Leg A scope)
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text])
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      -- issue #2117 -- the offering visibility rule is expressed ONLY through
      -- the Offering Visibility Gate. Do NOT write it locally here or anywhere
      -- else; a second copy is a violation of
      -- I-PROPOSED-2117-ONE-OFFERING-VISIBILITY-GATE. The e.status predicate
      -- ABOVE deliberately stays local and verbatim (A-4.2): this reader admits
      -- two statuses where its family sibling admits four, and one per-audience
      -- status set cannot preserve both.
      AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')
    LIMIT 1
  ),
  tiers AS (
    SELECT
      tpt.id,
      tpt.ticket_type_id,
      tpt.tier_name,
      tpt.tier_metadata,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      -- remaining capacity (NULL for unlimited / no cap); sold formula IDENTICAL
      -- to pg_public_ticket_types_remaining (ORCH-0946).
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.trip_pricing_tiers tpt
    JOIN tr ON tr.id = tpt.event_id
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE tt.deleted_at IS NULL
      AND COALESCE(tt.is_hidden, false) = false
  )
  SELECT
    CASE WHEN tr.id IS NULL THEN NULL ELSE json_build_object(
      'id', tr.id,
      'brandId', tr.brand_id,
      'brandSlug', tr.brand_slug,
      'tripSlug', tr.event_slug,
      'title', tr.title,
      'description', tr.description,
      'status', tr.status,
      'timezone', tr.timezone,
      -- master dates (event_dates) first, theme business_trip mirror fallback.
      'startAt', COALESCE(
        tr.master_start_at::text,
        NULLIF((tr.public_theme #>> '{business_trip,startAt}'), '')
      ),
      'endAt', COALESCE(
        tr.master_end_at::text,
        NULLIF((tr.public_theme #>> '{business_trip,endAt}'), '')
      ),
      -- route legs: canonical column first, theme mirror fallback (rule 9 — null
      -- when neither present → that leg/pill is omitted by the body).
      'departureText', COALESCE(
        NULLIF(tr.departure_text, ''),
        NULLIF((tr.public_theme #>> '{business_trip,departureLocationText}'), '')
      ),
      'destinationText', COALESCE(
        NULLIF(tr.destination_text, ''),
        NULLIF((tr.public_theme #>> '{business_trip,destinationLocationText}'), '')
      ),
      -- destination lat/lng (theme mirror only today). The consumer payload lacks
      -- these → its §11 map silently omitted; the RPC closes that parity gap.
      'destinationLat', (tr.public_theme #>> '{business_trip,destinationLat}')::float8,
      'destinationLng', (tr.public_theme #>> '{business_trip,destinationLng}')::float8,
      'departureLat', (tr.public_theme #>> '{business_trip,departureLat}')::float8,
      'departureLng', (tr.public_theme #>> '{business_trip,departureLng}')::float8,
      'currency', COALESCE(tr.currency, 'usd'),
      'coverMediaUrl', tr.cover_media_url,
      'coverMediaType', tr.cover_media_type,
      'coverMediaAlt', tr.cover_media_alt,
      'coverGallery', COALESCE(tr.cover_media_gallery, '[]'::jsonb),
      'refundPolicy', tr.refund_policy,
      'bookingDeadline', tr.booking_deadline,
      'bookingsClosed', COALESCE(tr.bookings_closed, false),
      'themeColorOverride', tr.theme_color_override,
      'themeFontOverride', tr.theme_font_override,
      'themeAnimationOverride', tr.theme_animation_override,
      'brand', json_build_object(
        'id', tr.brand_id_b,
        'slug', tr.brand_slug,
        'name', tr.brand_name,
        'bio', tr.brand_description,
        'coverMediaUrl', tr.brand_cover_media_url,
        'coverMediaType', tr.brand_cover_media_type,
        'coverHue', tr.brand_cover_hue,
        'verified', COALESCE(tr.brand_is_verified, false),
        'themeColor', tr.brand_theme_color,
        'themeFont', tr.brand_theme_font,
        'themeAnimation', tr.brand_theme_animation
      ),
      'days', COALESCE((
        SELECT json_agg(json_build_object(
          'id', d.id,
          'ordinal', d.ordinal,
          'title', d.title,
          'narrative', d.narrative,
          'date', d.date,
          'stops', COALESCE(d.stops, '[]'::jsonb),
          'media', COALESCE(d.media, '[]'::jsonb)
        ) ORDER BY d.ordinal ASC)
        FROM public.trip_days d
        WHERE d.event_id = tr.id
      ), '[]'::json),
      'inclusions', COALESCE((
        SELECT json_agg(json_build_object(
          'id', i.id,
          'kind', i.kind,
          'item', i.item,
          'ordinal', i.ordinal
        ) ORDER BY i.kind ASC, i.ordinal ASC)
        FROM public.trip_inclusions i
        WHERE i.event_id = tr.id
      ), '[]'::json),
      'tiers', COALESCE((
        SELECT json_agg(json_build_object(
          'id', tiers.id,
          'ticketTypeId', tiers.ticket_type_id,
          'tierName', tiers.tier_name,
          'tierMetadata', COALESCE(tiers.tier_metadata, '{}'::jsonb),
          'priceCents', COALESCE(tiers.price_cents, 0),
          'currency', COALESCE(tiers.currency, ''),
          'quantityTotal', tiers.quantity_total,
          'ticketsRemaining', tiers.remaining,
          'isUnlimited', COALESCE(tiers.is_unlimited, false),
          'isFree', COALESCE(tiers.is_free, false),
          'installments', tiers.tier_metadata -> 'installments'
        ))
        FROM tiers
      ), '[]'::json)
    ) END
  FROM tr;
$function$;

CREATE OR REPLACE FUNCTION public.pg_public_experience_by_slug(p_brand_slug text, p_experience_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ex AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug                AS event_slug,
      e.status,
      e.visibility,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.is_recurring,
      e.is_multi_date,
      e.recurrence_rules,
      e.experience_intents,
      e.pass_mingla_fee,
      e.pass_service_fee,
      e.theme               AS public_theme,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      -- hideAddressUntilTicket lives in theme.business_event (jsonb); default TRUE
      -- for safety (mirror the service + venue mapper fail-closed semantics).
      public.issue_2489_address_withheld(e.theme) AS hide_address,
      b.id                  AS brand_id_b,
      b.slug                AS brand_slug,
      b.name                AS brand_name,
      b.description         AS brand_description,
      b.cover_media_url     AS brand_cover_media_url,
      b.cover_media_type    AS brand_cover_media_type,
      b.cover_hue           AS brand_cover_hue,
      b.theme_color         AS brand_theme_color,
      b.theme_font          AS brand_theme_font,
      b.theme_animation     AS brand_theme_animation,
      (b.claim_status = 'verified') AS brand_is_verified
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    WHERE b.slug = p_brand_slug
      AND e.slug = p_experience_slug
      AND e.event_type = 'experience'           -- experience ONLY
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      -- issue #2117 -- the offering visibility rule is expressed ONLY through
      -- the Offering Visibility Gate. Do NOT write it locally here or anywhere
      -- else. The e.status predicate ABOVE deliberately stays local and
      -- verbatim (A-4.2): this reader admits four statuses where its family
      -- sibling admits two.
      -- NOTE: this reader EMITS the offering's own visibility value into its
      -- response. Before #2117 it did so while filtering on nothing. The gate
      -- below is what makes that emission safe.
      AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')
    LIMIT 1
  ),
  -- the ONE sellable ticket (lowest display_order, non-hidden, not deleted).
  tk AS (
    SELECT
      tt.id,
      tt.name,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.available_online,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ex.pass_mingla_fee,
               ex.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ex.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining (GREATEST(total - sold, 0)); NULL for unlimited. Sold formula
      -- IDENTICAL to pg_public_ticket_types_remaining (ORCH-0946).
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ex ON ex.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND COALESCE(tt.is_hidden, false) = false
    ORDER BY tt.display_order ASC NULLS LAST, tt.created_at ASC
    LIMIT 1
  )
  SELECT
    CASE WHEN ex.id IS NULL THEN NULL ELSE json_build_object(
      'id', ex.id,
      'brandId', ex.brand_id,
      'brandSlug', ex.brand_slug,
      'experienceSlug', ex.event_slug,
      'title', ex.title,
      'description', ex.description,
      'status', ex.status,
      'visibility', ex.visibility,
      'timezone', COALESCE(ex.timezone, 'UTC'),
      'currency', COALESCE(ex.currency, 'usd'),
      'coverMediaUrl', ex.cover_media_url,
      'coverMediaType', ex.cover_media_type,
      'coverMediaAlt', ex.cover_media_alt,
      'coverGallery', COALESCE(ex.cover_media_gallery, '[]'::jsonb),
      'venueText', COALESCE(
        NULLIF((ex.public_theme #>> '{experience_meta,venue_text}'), ''),
        (SELECT s.address FROM public.experience_stops s
          WHERE s.event_id = ex.id ORDER BY s.stop_order ASC LIMIT 1)
      ),
      'isRecurring', COALESCE(ex.is_recurring, false),
      'isMultiDate', COALESCE(ex.is_multi_date, false),
      'recurrenceRules', ex.recurrence_rules,
      'intents', COALESCE(to_json(ex.experience_intents), '[]'::json),
      'hideAddressUntilTicket', ex.hide_address,
      'themeColorOverride', ex.theme_color_override,
      'themeFontOverride', ex.theme_font_override,
      'themeAnimationOverride', ex.theme_animation_override,
      'brand', json_build_object(
        'id', ex.brand_id_b,
        'slug', ex.brand_slug,
        'name', ex.brand_name,
        'bio', ex.brand_description,
        'coverMediaUrl', ex.brand_cover_media_url,
        'coverMediaType', ex.brand_cover_media_type,
        'coverHue', ex.brand_cover_hue,
        'verified', COALESCE(ex.brand_is_verified, false),
        'themeColor', ex.brand_theme_color,
        'themeFont', ex.brand_theme_font,
        'themeAnimation', ex.brand_theme_animation
      ),
      -- itinerary stops — ADDRESS-PRIVACY-AWARE (NULL street/lat/lng when hidden).
      'stops', COALESCE((
        SELECT json_agg(json_build_object(
          'id', s.id,
          'stopOrder', s.stop_order,
          'placeName', s.place_name,
          'address', CASE WHEN ex.hide_address THEN NULL ELSE NULLIF(s.address, '') END,
          'description', NULLIF(s.ai_description, ''),
          'startTime', s.start_time,
          'lat', CASE WHEN ex.hide_address THEN NULL ELSE s.lat END,
          'lng', CASE WHEN ex.hide_address THEN NULL ELSE s.lng END,
          'imageUrls', COALESCE(to_json(s.image_urls), '[]'::json)
        ) ORDER BY s.stop_order ASC)
        FROM public.experience_stops s
        WHERE s.event_id = ex.id
      ), '[]'::json),
      -- the ONE sellable ticket (per-stop summed all-in, ORCH-1151).
      'ticket', (
        SELECT CASE WHEN tk.id IS NULL THEN NULL ELSE json_build_object(
          'ticketTypeId', tk.id,
          'name', tk.name,
          'priceCents', COALESCE(tk.price_cents, 0),
          'allInCents', tk.all_in_cents,
          'currency', COALESCE(tk.currency, ex.currency, 'usd'),
          'quantityTotal', tk.quantity_total,
          'isUnlimited', COALESCE(tk.is_unlimited, false),
          'isFree', COALESCE(tk.is_free, false) OR COALESCE(tk.price_cents, 0) = 0,
          'ticketsRemaining', tk.remaining,
          'availableOnline', COALESCE(tk.available_online, false)
        ) END
        FROM tk
      ),
      -- bookable occurrences (event_dates) with per-occurrence remaining stamped
      -- from the ONE ticket's event-level remaining (Q2: no per-occurrence cap).
      'dates', COALESCE((
        SELECT json_agg(json_build_object(
          'id', d.id,
          'startAt', d.start_at,
          'endAt', d.end_at,
          'timezone', d.timezone,
          'isMaster', COALESCE(d.is_master, false),
          'ticketsRemaining', (SELECT tk.remaining FROM tk)
        ) ORDER BY d.start_at ASC)
        FROM public.event_dates d
        WHERE d.event_id = ex.id
      ), '[]'::json),
      -- bookable: free → always true; paid → pg_brand_can_collect.
      'bookable', CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM tk
          WHERE tk.available_online = true
            AND COALESCE(tk.price_cents, 0) > 0
        ) THEN true
        ELSE public.pg_brand_can_collect(ex.brand_id)
      END
    ) END
  FROM ex;
$function$
;

COMMIT;

NOTIFY pgrst, 'reload schema';

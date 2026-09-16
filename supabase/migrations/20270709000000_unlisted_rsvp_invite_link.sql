-- =====================================================================================
-- Unlisted RSVP events open from their invite link.
--
-- WHAT GUESTS SAW: a host published an RSVP event with "Who can find this" = Unlisted
-- (events.visibility = 'hidden'). The server-rendered page title was right, but the page
-- body said "This event isn't live", in the Business app right after publishing and for
-- every guest who opened the invite link.
--
-- WHY: #1929 gave TICKETED events an exact-link reader that admits public and hidden
-- (pg_direct_event_checkout_bundle). RSVP events never got one. Every RSVP page read still
-- went through a public-only source:
--
--   business web + Business app  the ticketed bundle is event_type = 'event' only, so an
--                                RSVP falls back to business_public_events_view, which is
--                                visibility = 'public' only -> not found.
--   Explorer app cold /e/ link    same bundle, then the same view -> not found; its RSVP
--                                settings read is the same view.
--   pg_public_rsvp_by_slug        visibility = 'public' only.
--   server metadata               public_search_source_facts already admits public and
--                                hidden, which is why the title was right.
--   RSVP submit                   submit_event_rsvp has no visibility predicate, so the write
--                                itself was never the blocker. Unchanged here.
--
-- WHAT THIS FILE DOES — pg_public_rsvp_by_slug only, as a full copy of the live production
-- definition (read back from production on 2026-09-15; identical to 20270607002774):
--
--   1. visibility = 'public'  ->  visibility IN ('public','hidden'), the #1929 set.
--   2. + NOT issue_1931_event_ordinary_read_blocked(e.id), the containment clause the
--      ticketed reader and the view already carry.
--   3. + one appended key, `publicEventRow`: the same event as a single
--      business_public_events_view-shaped row, column for column, with the view's own
--      #2489 address withholding. Both apps already render public RSVPs from that view
--      through their row mappers; on a view miss they now take this key instead, so an
--      unlisted RSVP renders through exactly the same code. Every existing key keeps its
--      name, value and position.
--
-- WHY NOT A NEW FUNCTION: an RSVP sibling of pg_direct_event_checkout_bundle would be a
-- new anonymous SECURITY DEFINER reader, and the anon-definer allowlist is frozen by the
-- #2117 lane (A-SC-9 clause 1). This reader is already allowlisted, already the declared
-- one read path for public RSVP pages (ORCH-1163), and already a #2489 gate carrier.
--
-- UNCHANGED ON PURPOSE:
--   * Private stays closed. Private access grants are not live (#2144) and ticketed
--     private events are closed the same way.
--   * Discovery, brand pages, search and business_public_events_view stay public-only.
--     Unlisted means "anyone with the link", never "listed". This reader takes an exact
--     brand slug + event slug and cannot list anything.
--   * The literal visibility set is used rather than pg_offering_visibility_gate, for the
--     reason recorded above pg_direct_event_checkout_bundle's predicate (#2160).
--
-- DEPLOY: apply this file's SQL alone through the surgical lane (no db push), insert its
-- history row, read the definition back, then probe the invite link anonymously.
-- =====================================================================================

BEGIN;

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
      -- Unlisted (hidden) RSVPs open from their invite link, like #1929 did for
      -- ticketed events. Private stays closed: its access grants are not live (#2144).
      AND e.visibility IN ('public'::text, 'hidden'::text)
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      -- Same containment the ticketed exact-link reader and the public view apply.
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
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
      'rsvpApprovalMode', ev.rsvp_approval_mode,
      -- The same event as ONE business_public_events_view-shaped row (every view
      -- column, same names, same values, the view's own address withholding), so the
      -- buyer-web / Business-app and Explorer row mappers that already render public
      -- RSVPs from that view render an unlisted RSVP from its link unchanged. Re-read
      -- by the id `ev` already admitted; it adds no visibility of its own.
      'publicEventRow', (
        SELECT to_json(r)
        FROM (
          SELECT e.id,
            e.brand_id,
            b.slug AS brand_slug,
            b.name AS brand_name,
            b.description AS brand_description,
            b.profile_photo_url AS brand_profile_photo_url,
            b.display_attendee_count AS brand_display_attendee_count,
            b.address AS brand_address,
            b.cover_media_url AS brand_cover_media_url,
            b.theme_color AS brand_theme_color,
            b.theme_font AS brand_theme_font,
            b.theme_animation AS brand_theme_animation,
            e.title,
            e.description,
            e.slug,
            e.event_type,
            CASE
              WHEN public.issue_2489_address_withheld(e.theme) THEN NULL::text
              ELSE e.location_text
            END AS location_text,
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
            public.issue_2489_public_theme(e.theme) AS public_theme,
            e.theme_color_override,
            e.theme_font_override,
            e.theme_animation_override,
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
            CASE
              WHEN public.issue_2489_address_withheld(e.theme) THEN NULL::point
              ELSE e.location_geo
            END AS location_geo,
            COALESCE(e.pass_tax, b.default_pass_tax) AS pass_tax,
            COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee) AS pass_mingla_fee,
            COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
            b.pricing_region,
            b.pricing_currency,
            e.pricing_locked_at IS NOT NULL AS pricing_locked,
            ( SELECT public.compute_all_in_cents(min(tt.price_cents),
                       COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
                       COALESCE(e.pass_service_fee, b.default_pass_service_fee),
                       ( SELECT rt.effective_take_rate_bps
                           FROM public.resolve_effective_take_rate_bps(b.id) rt(effective_take_rate_bps, take_rate_source)))
                FROM public.ticket_types tt
               WHERE tt.event_id = e.id AND tt.price_cents > 0 AND tt.deleted_at IS NULL) AS display_price_cents,
            e.rsvp_discoverable,
            e.rsvp_capacity,
            e.rsvp_allow_plus_ones,
            e.rsvp_plus_ones_max,
            e.rsvp_waitlist_enabled,
            e.rsvp_approval_mode,
            ( SELECT COALESCE(sum(1 + rs.plus_count), 0::bigint)::integer
                FROM public.event_rsvps rs
               WHERE rs.event_id = e.id AND rs.rsvp_status = 'going'::text AND rs.approval_status = 'approved'::text) AS rsvp_going_count,
            e.city_geo,
            e.rsvp_contribution_enabled,
            e.rsvp_contribution_suggested_cents,
            e.rsvp_contribution_min_cents,
            e.cover_media_gallery
          FROM public.events e
          JOIN public.brands b ON b.id = e.brand_id
          LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
          WHERE e.id = ev.id
        ) r
      )
    ) END
  FROM ev;
$function$;

COMMIT;

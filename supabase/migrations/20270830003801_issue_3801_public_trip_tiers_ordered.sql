-- Issue #3801 -- the public trip page lists packages in the order the host set.
--
-- WHAT WAS BROKEN. A host arranges a trip's packages (for example Private,
-- Couple, Shared) and the public trip page, on the web and in the Explorer
-- app, showed them in a different order. `pg_public_trip_by_slug` builds its
-- `tiers` array with a `json_agg` that had no ORDER BY, so the array followed
-- the physical row order of `trip_pricing_tiers`. The `days` and `inclusions`
-- arrays in the same function were already ordered. The authored order lives
-- on `ticket_types.display_order`.
--
-- WHAT THIS DOES. One thing: the `tiers` array is ordered by the ticket type's
-- `display_order` (nulls last), then its `created_at`, then the tier id, so
-- the order is total and repeatable. The `tiers` CTE reads those two columns
-- to sort by; they are not returned. The response shape is unchanged: no key
-- is added, removed or renamed. Signature, STABLE, SECURITY DEFINER, the
-- pinned search_path and the EXECUTE grants are unchanged (CREATE OR REPLACE
-- keeps the existing ACL; no GRANT or REVOKE is issued here).
--
-- WHERE THE BODY CAME FROM. Re-emitted verbatim from its latest definition,
--   supabase/migrations/20270607002774_issue_2774_public_hero_alt.sql
-- with only the two marked `issue #3801` hunks changed. That definition
-- matched production byte for byte (md5 of prosrc
-- d176054fc08f09825603a561ee6c7448) when this was written. No other function
-- is touched.

BEGIN;

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
      -- issue #3801 -- the authored package order and its tie-breaker, read
      -- only to sort the `tiers` array below. Neither is returned.
      tt.display_order,
      tt.created_at,
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
        -- issue #3801 -- packages come back in the order the host authored
        -- them. Without an ORDER BY the array followed the physical row order
        -- of trip_pricing_tiers.
        ) ORDER BY tiers.display_order ASC NULLS LAST, tiers.created_at ASC, tiers.id ASC)
        FROM tiers
      ), '[]'::json)
    ) END
  FROM tr;
$function$;

-- Self-check: the installed definition carries the ordering, kept its security
-- contract, and anonymous buyers can still call it.
DO $verify$
DECLARE
  v_oid oid;
  v_src text;
  v_def text;
BEGIN
  SELECT p.oid, p.prosrc, pg_get_functiondef(p.oid)
    INTO v_oid, v_src, v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'pg_public_trip_by_slug'
     AND pg_get_function_identity_arguments(p.oid) = 'p_brand_slug text, p_event_slug text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'issue_3801_pg_public_trip_by_slug_missing';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'pg_public_trip_by_slug') <> 1 THEN
    RAISE EXCEPTION 'issue_3801_pg_public_trip_by_slug_overloaded';
  END IF;
  IF position('ORDER BY tiers.display_order ASC NULLS LAST, tiers.created_at ASC, tiers.id ASC' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3801_tiers_not_ordered';
  END IF;
  IF position('SECURITY DEFINER' IN v_def) = 0
     OR position('SET search_path TO ''public''' IN v_def) = 0
     OR position('STABLE' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue_3801_security_contract_drift';
  END IF;
  IF position('pg_offering_visibility_gate(e.visibility, e.deleted_at, ''listing'')' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3801_visibility_gate_missing';
  END IF;
  IF NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3801_public_execute_missing';
  END IF;
END
$verify$;

COMMIT;

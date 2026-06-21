-- ORCH-1183 [experience-standardize] — Migration: canonical experience read RPC.
--
-- Experience leg of META-ORCH-1166 (public offering-page single source of truth).
-- Mirrors pg_public_trip_by_slug (ORCH-1174) + pg_public_event_by_slug (ORCH-1167)
-- + pg_public_rsvp_by_slug (ORCH-1163).
--
-- WHAT: `pg_public_experience_by_slug(p_brand_slug, p_experience_slug) RETURNS json`
-- — the ONE anon read path that fills the shared `ExperienceOfferingBody` prop
-- contract on ALL surfaces (buyer-web, business native, AND the consumer by-slug
-- route) from a single source. Replaces the web service's direct anon table reads
-- (publicExperienceService.getPublicExperienceBySlug). Returns the full payload:
-- identity/slugs/description, cover, venue text, the ordered itinerary STOPS
-- (ai_description/lat/lng, ADDRESS-PRIVACY-AWARE — NULL street + pin when the brand
-- hides the address until ticket), the ONE sellable ticket (server all-in via the
-- SAME compute_all_in_cents single-owner the cart + pg_public_event_tier_allin use,
-- + remaining), the bookable occurrences (event_dates), recurrence/open-daily
-- fields, the curated vibe intents, the brand card (cover + theme + verified), AND
-- a `bookable` flag (pg_brand_can_charge for a PAID experience; always true when
-- free). Restricted to event_type='experience' + published.
--
-- READING NOTES (parity with publicExperienceService):
--   • venue text: theme.experience_meta.venue_text first, stop[0].address fallback.
--   • per-stop price is DISPLAY-ONLY and intentionally NOT emitted — ORCH-1151 sums
--     stop prices into the ONE ticket's price_cents server-side (pricing_mode=
--     'per_stop'); the page shows ONE combined all-in price, never a per-stop price.
--   • all-in: compute_all_in_cents(price_cents, pass_mingla_fee, pass_service_fee,
--     effective_take_rate_bps) — the WYSIWYP single owner; free/zero → 0.
--   • remaining: GREATEST(quantity_total - sold, 0); sold = COUNT of tickets rows
--     status IN ('valid','used','transferred') — IDENTICAL to
--     pg_public_ticket_types_remaining (ORCH-0946).
--   • ADDRESS PRIVACY: hideAddressUntilTicket lives in theme.business_event (jsonb),
--     defaulting TRUE for safety (mirrors the service/venue mapper). When hidden the
--     RPC NULLs every stop's `address`, `lat`, `lng` so the anon page never leaks a
--     street/pin (the per-stop map + address row silently omit — rule 9). The
--     authenticated post-purchase unlock path is unchanged (out of scope).
--   • brand THEME: read from the brands row here (SECURITY DEFINER, so the anon
--     column-level grant gap that 401'd the service direct-read (COMMS-0009) does
--     NOT apply — the definer owner reads theme_color/font/animation directly).
--     Per-experience overrides come off the events row.
--   • recurrence/open-daily: is_recurring + recurrence_rules (the shared
--     isOpenDailyExperience detector reads {preset, termination.kind} on the client).
--
-- SAFE-MIGRATION PROTOCOL (cross-host rules / migration baseline):
--   • SECURITY DEFINER, STABLE, SET search_path = public; reads anon-safe columns.
--   • $function$ terminator BEFORE the GRANT.
--   • DROP IF EXISTS before CREATE (idempotent; RETURNS json so no RETURNS-TABLE
--     widening hazard).
--   • GRANT EXECUTE TO anon, authenticated.
--   • MONOTONIC VERSION 20261115000000 > the current max migration prefix
--     (20261114000000) across anchor main + sibling worktrees.
--
-- DO NOT auto-apply — orchestrator/Seth applies via the Management API post-merge.

DROP FUNCTION IF EXISTS public.pg_public_experience_by_slug(text, text);

CREATE FUNCTION public.pg_public_experience_by_slug(
  p_brand_slug text,
  p_experience_slug text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
      COALESCE(
        ((e.theme #>> '{business_event,hideAddressUntilTicket}')::boolean),
        true
      ) AS hide_address,
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
      -- bookable: free → always true; paid → pg_brand_can_charge.
      'bookable', CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM tk
          WHERE tk.available_online = true
            AND COALESCE(tk.price_cents, 0) > 0
        ) THEN true
        ELSE public.pg_brand_can_charge(ex.brand_id)
      END
    ) END
  FROM ex;
$function$;

COMMENT ON FUNCTION public.pg_public_experience_by_slug(text, text) IS
  'ORCH-1183 [experience-standardize] — the ONE canonical anon read path for the '
  'public experience page (event_type=experience). Returns the full '
  'ExperienceOfferingBody payload as json incl. cover, ADDRESS-PRIVACY-AWARE '
  'itinerary stops (NULL street/pin when hideAddressUntilTicket), the ONE sellable '
  'ticket with server all-in (compute_all_in_cents) + remaining, bookable '
  'occurrences, recurrence/open-daily fields, curated vibe intents, the brand card '
  '(cover/theme/verified), and a bookable flag (pg_brand_can_charge for paid).';

GRANT EXECUTE ON FUNCTION public.pg_public_experience_by_slug(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

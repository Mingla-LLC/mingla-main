-- Issue #3859 slice 1: one provider-neutral capability authority for trip
-- installments. Unsupported/unknown capability keeps stored schedules intact
-- while refusing new authoring, public exposure, and checkout creation.

BEGIN;

-- The provider mapping is intentionally private. Product-facing callers see
-- only supported/unavailable and a bounded provider-neutral refusal code.
CREATE OR REPLACE FUNCTION public.pg_trip_installments_supported(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE((
    SELECT b.payment_provider::text = 'stripe'
      FROM public.events e
      JOIN public.brands b ON b.id = e.brand_id
     WHERE e.id = p_event_id
       AND e.event_type = 'trip'
       AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL
     LIMIT 1
  ), false)
$fn$;

REVOKE ALL ON FUNCTION public.pg_trip_installments_supported(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_trip_installments_supported(uuid)
  TO service_role;

COMMENT ON FUNCTION public.pg_trip_installments_supported(uuid) IS
  'Issue #3859: provider-neutral trip-installment capability. Unknown/missing is false; service-side authority only.';

-- Authoring belt: a stale client may retain an existing schedule byte-for-byte,
-- but cannot add, remove, or edit one while capability is unavailable. This
-- preserves historical metadata rather than deleting or converting it.
CREATE OR REPLACE FUNCTION public.trg_trip_tier_installment_capability_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_new_schedule jsonb := NEW.tier_metadata -> 'installments';
  v_old_schedule jsonb := CASE
    WHEN TG_OP = 'UPDATE' THEN OLD.tier_metadata -> 'installments'
    ELSE NULL
  END;
  v_new_has_schedule boolean :=
    NEW.tier_metadata ? 'installments'
    AND NEW.tier_metadata -> 'installments' IS NOT NULL
    AND jsonb_typeof(NEW.tier_metadata -> 'installments') <> 'null';
  v_old_has_schedule boolean :=
    TG_OP = 'UPDATE'
    AND OLD.tier_metadata ? 'installments'
    AND OLD.tier_metadata -> 'installments' IS NOT NULL
    AND jsonb_typeof(OLD.tier_metadata -> 'installments') <> 'null';
BEGIN
  IF public.pg_trip_installments_supported(NEW.event_id) THEN
    RETURN NEW;
  END IF;

  IF NOT v_new_has_schedule AND NOT v_old_has_schedule THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND v_old_has_schedule
     AND v_new_has_schedule
     AND v_old_schedule IS NOT DISTINCT FROM v_new_schedule THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'installment_capability_unavailable'
    USING ERRCODE = 'P0001',
          HINT = 'The saved payment setup does not support trip installments.';
END
$fn$;

DROP TRIGGER IF EXISTS trg_trip_tier_installment_capability_guard
  ON public.trip_pricing_tiers;
CREATE TRIGGER trg_trip_tier_installment_capability_guard
  BEFORE INSERT OR UPDATE OF tier_metadata ON public.trip_pricing_tiers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_trip_tier_installment_capability_guard();

REVOKE ALL ON FUNCTION public.trg_trip_tier_installment_capability_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_trip_tier_installment_capability_guard()
  TO service_role;

-- Publish belt: an unsupported saved schedule is a suspended draft artifact,
-- never an effective published buyer option.
CREATE OR REPLACE FUNCTION public.trg_trip_publish_installment_capability_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.event_type = 'trip'
     AND NEW.status IN ('scheduled', 'live')
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.visibility IS DISTINCT FROM NEW.visibility)
     AND EXISTS (
       SELECT 1
         FROM public.trip_pricing_tiers tpt
        WHERE tpt.event_id = NEW.id
          AND tpt.tier_metadata ? 'installments'
          AND tpt.tier_metadata -> 'installments' IS NOT NULL
          AND jsonb_typeof(tpt.tier_metadata -> 'installments') <> 'null'
     )
     AND NOT public.pg_trip_installments_supported(NEW.id) THEN
    RAISE EXCEPTION 'installment_capability_unavailable'
      USING ERRCODE = 'P0001',
            HINT = 'The saved payment setup does not support trip installments.';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_trip_publish_installment_capability_guard
  ON public.events;
CREATE TRIGGER trg_trip_publish_installment_capability_guard
  BEFORE UPDATE OF status, visibility ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_trip_publish_installment_capability_guard();

REVOKE ALL ON FUNCTION public.trg_trip_publish_installment_capability_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_trip_publish_installment_capability_guard()
  TO service_role;

-- Direct-RPC belt: if a caller bypasses the Edge preflight, the checkout RPC's
-- insert is refused transactionally before a session/capacity hold survives.
CREATE OR REPLACE FUNCTION public.trg_ticket_session_installment_capability_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.installment_schedule IS NOT NULL
     AND NOT public.pg_trip_installments_supported(NEW.event_id) THEN
    RAISE EXCEPTION 'installment_capability_unavailable'
      USING ERRCODE = 'P0001',
            HINT = 'The saved payment setup does not support trip installments.';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_ticket_session_installment_capability_guard
  ON public.ticket_checkout_sessions;
CREATE TRIGGER trg_ticket_session_installment_capability_guard
  BEFORE INSERT OR UPDATE OF installment_schedule
  ON public.ticket_checkout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ticket_session_installment_capability_guard();

REVOKE ALL ON FUNCTION public.trg_ticket_session_installment_capability_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_ticket_session_installment_capability_guard()
  TO service_role;

-- Keep the one canonical public reader and its response shape. Patch only the
-- two schedule-bearing values in its latest installed definition: unsupported
-- schedules become null/absent to every web and native adapter, while the
-- underlying tier metadata remains unchanged for authorized Host/support reads.
-- Re-emit the latest pre-#3859 canonical reader definition directly so static
-- migration audits can inspect every statement. The only changes from #3801
-- are the two capability-gated schedule projections below.
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
          'tierMetadata', CASE
        WHEN public.pg_trip_installments_supported(tr.id)
          THEN COALESCE(tiers.tier_metadata, '{}'::jsonb)
        ELSE COALESCE(tiers.tier_metadata, '{}'::jsonb) - 'installments'
      END,
          'priceCents', COALESCE(tiers.price_cents, 0),
          'currency', COALESCE(tiers.currency, ''),
          'quantityTotal', tiers.quantity_total,
          'ticketsRemaining', tiers.remaining,
          'isUnlimited', COALESCE(tiers.is_unlimited, false),
          'isFree', COALESCE(tiers.is_free, false),
          'installments', CASE
        WHEN public.pg_trip_installments_supported(tr.id)
          THEN tiers.tier_metadata -> 'installments'
        ELSE NULL
      END
        -- issue #3801 -- packages come back in the order the host authored
        -- them. Without an ORDER BY the array followed the physical row order
        -- of trip_pricing_tiers.
        ) ORDER BY tiers.display_order ASC NULLS LAST, tiers.created_at ASC, tiers.id ASC)
        FROM tiers
      ), '[]'::json)
    ) END
  FROM tr;
$function$;

-- Aggregate-only operational census. No ids, buyer/Host data, references,
-- tokens, or provider names leave this function.
CREATE OR REPLACE FUNCTION public.issue_3859_trip_installment_census()
RETURNS TABLE(
  capability_state text,
  offering_state text,
  trip_count bigint,
  schedule_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT
    CASE
      WHEN public.pg_trip_installments_supported(e.id) THEN 'supported'
      ELSE 'unavailable'
    END AS capability_state,
    e.status::text AS offering_state,
    count(DISTINCT e.id)::bigint AS trip_count,
    count(*)::bigint AS schedule_count
  FROM public.events e
  JOIN public.trip_pricing_tiers tpt ON tpt.event_id = e.id
  WHERE e.event_type = 'trip'
    AND e.deleted_at IS NULL
    AND tpt.tier_metadata ? 'installments'
    AND tpt.tier_metadata -> 'installments' IS NOT NULL
    AND jsonb_typeof(tpt.tier_metadata -> 'installments') <> 'null'
  GROUP BY 1, e.status::text
  ORDER BY 1, 2
$fn$;

REVOKE ALL ON FUNCTION public.issue_3859_trip_installment_census()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3859_trip_installment_census()
  TO service_role;

COMMENT ON FUNCTION public.issue_3859_trip_installment_census() IS
  'Issue #3859 aggregate-only census of stored trip schedules by effective capability and offering state; no identifiers or personal data.';

DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p
   WHERE p.oid = 'public.pg_public_trip_by_slug(text,text)'::regprocedure;
  IF position('pg_trip_installments_supported(tr.id)' IN v_src) = 0
     OR position('- ''installments''' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3859_public_trip_reader_not_guarded';
  END IF;
  IF has_function_privilege('anon', 'public.pg_trip_installments_supported(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3859_trip_installment_census()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3859_capability_or_census_overexposed';
  END IF;
END
$verify$;

COMMIT;

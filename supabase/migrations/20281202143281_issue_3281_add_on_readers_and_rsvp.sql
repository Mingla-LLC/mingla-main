-- issue #3281 S2 + S6 — add-ons on every public reader, and add-ons on RSVPs
-- (the free list) with the door line.
--
-- S2. Every public reader carries each ticket's add-ons the way the event
-- readers already do (20280315003281), so a buyer surface has no separate
-- add-on load: if the tickets rendered, the add-ons rendered.
--   * issue_3281_public_add_on_items is the one owner of the public item shape
--     (id, name, description, priceCents, priceAllInCents, maxPerTicket,
--     isUnlimited, validOccurrenceIds, remaining) and adds showOnPublicPage,
--     photoPath and photoThumbPath (storage object paths; clients build the
--     public URL, never an image transformation URL). Hidden add-ons are still
--     returned: checkout needs them; the public block hides them.
--     issue_3281_public_ticket_extras keeps its signature and calls it, so the
--     two event readers gain the three keys for tickets that have add-ons.
--   * pg_public_trip_by_slug (tiers[].ticketTypeId), pg_public_experience_by_slug
--     (options[].ticketTypeId and the single ticket) gain `extras` on each
--     ticket that has an active add-on; pg_public_rsvp_by_slug gains a last
--     key `rsvpAddOns` when the RSVP has one and add_on_rollout.rsvp_enabled is
--     on. Any payload without add-ons comes back byte for byte (the #4244 rule):
--     no reader grows while no add-on exists or, for RSVPs, the switch is off.
-- S6 (the free list; paid RSVP add-ons are a later slice). Behind
-- add_on_rollout.rsvp_enabled (false):
--   * event_rsvp_add_ons holds the free add-ons a guest chose with their RSVP;
--     issue_3281_add_on_taken counts them (a going, not denied RSVP), so one
--     stock is shared with ticket buyers (I-ADDON-SHARED-STOCK).
--   * issue_3281_submit_rsvp_with_add_ons (service role) calls the unchanged
--     #4541 submit_event_rsvp_with_form first, with the same twelve arguments,
--     then checks and stores the add-ons in the same transaction; any refusal
--     undoes the RSVP. With no add-ons it returns the inner result untouched.
--   * issue_3281_rsvp_door_add_ons (service role) is the door line; biz_rsvp_scan
--     returns it with the admission (`addOns`, absent when none), so the door
--     makes no extra read.
-- Re-emitted from the replayed database (md5 drift-guarded):
--   issue_3281_public_ticket_extras (20281202033281),
--   issue_3281_add_on_taken (20280313003281), pg_public_trip_by_slug,
--   pg_public_experience_by_slug, pg_public_rsvp_by_slug (latest bodies,
--   wrapped unchanged inside a CTE as 20280315003281 wrapped the event readers),
--   biz_rsvp_scan (20281119014508, one hunk: the door line).
-- Signatures, settings and grants are unchanged. Static SQL only; no lock
-- beyond the new rows' own add-ons (ORDER BY id FOR UPDATE), taken after the
-- RSVP is written, the same event-then-add-on order checkout takes.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.issue_3281_public_ticket_extras(uuid)','3c570b493fb230da46424c02ee789cb5'),
    ('public.issue_3281_add_on_taken(uuid,text,uuid)','e8b69267c8ee94a9d4a4132b1b3b0cce'),
    ('public.pg_public_trip_by_slug(text,text)','46ad6c508e10a5f5b9b80bf90cd81647'),
    ('public.pg_public_experience_by_slug(text,text)','b7b9e4e76ba14a3936958732acaf24d4'),
    ('public.pg_public_rsvp_by_slug(text,text)','014dc8b12e2bd7a42960116119d02649'),
    ('public.biz_rsvp_scan(uuid,text)','e6150c405d4279b4bddf03baa0061125')
  ) v(sig,expected_md5) LOOP
    SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
    IF v_actual IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #3281 S2/S6 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
    END IF;
  END LOOP;
END;
$drift$;

-- ---------------------------------------------------------------------------
-- 1. S6 table: a guest's free add-ons on an RSVP.
-- ---------------------------------------------------------------------------
CREATE TABLE public.event_rsvp_add_ons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rsvp_id uuid NOT NULL REFERENCES public.event_rsvps(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  add_on_id uuid NOT NULL REFERENCES public.ticket_add_ons(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 400),
  -- The add-on's dates when chosen ('{}' when it runs every date), counted
  -- per date by issue_3281_add_on_taken like an order line's day scope.
  day_scope text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_rsvp_add_ons_one_per_add_on UNIQUE (rsvp_id, add_on_id)
);
CREATE INDEX event_rsvp_add_ons_add_on_idx ON public.event_rsvp_add_ons (add_on_id);
CREATE INDEX event_rsvp_add_ons_event_idx ON public.event_rsvp_add_ons (event_id);
ALTER TABLE public.event_rsvp_add_ons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_rsvp_add_ons FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_rsvp_add_ons TO service_role;
COMMENT ON TABLE public.event_rsvp_add_ons IS
  'issue #3281 S6: free add-ons a guest chose with their RSVP. Written only by issue_3281_submit_rsvp_with_add_ons.';

-- ---------------------------------------------------------------------------
-- 2. Stock: free RSVP add-ons share the add-on's one count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3281_add_on_taken(p_add_on_id uuid, p_occurrence_key text, p_exclude_session uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT (
    SELECT COALESCE(SUM(li.quantity), 0)
      FROM public.order_add_on_line_items li
      JOIN public.orders o ON o.id = li.order_id
     WHERE li.ticket_add_on_id = p_add_on_id
       AND o.payment_status IN ('pending', 'paid', 'partial_refund')
       AND (p_occurrence_key IS NULL OR p_occurrence_key = ANY (li.day_scope_at_order))
  )::integer + (
    SELECT COALESCE(SUM(si.quantity), 0)
      FROM public.ticket_checkout_session_add_on_items si
      JOIN public.ticket_checkout_sessions s ON s.id = si.checkout_session_id
     WHERE si.ticket_add_on_id = p_add_on_id
       AND s.id IS DISTINCT FROM p_exclude_session
       AND s.expires_at > now()
       AND s.order_id IS NULL
       AND s.revoked_at IS NULL
       AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
       AND (p_occurrence_key IS NULL OR p_occurrence_key = ANY (si.day_scope))
  )::integer + (
    -- issue #3281 S6 — a going RSVP's free add-ons, until the host denies it.
    SELECT COALESCE(SUM(ra.quantity), 0)
      FROM public.event_rsvp_add_ons ra
      JOIN public.event_rsvps v ON v.id = ra.rsvp_id
     WHERE ra.add_on_id = p_add_on_id
       AND v.rsvp_status = 'going'
       AND v.approval_status <> 'denied'
       AND (p_occurrence_key IS NULL OR p_occurrence_key = ANY (ra.day_scope))
  )::integer;
$function$;

-- ---------------------------------------------------------------------------
-- 3. S2: one owner of the public add-on item; readers carry add-ons.
-- ---------------------------------------------------------------------------
-- The add-ons linked to one ticket (p_ticket_type_id) or to the RSVP of
-- p_event_id (p_ticket_type_id NULL), on sale, in the host's order.
CREATE FUNCTION public.issue_3281_public_add_on_items(p_event_id uuid, p_ticket_type_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'name', a.name,
      'description', a.description,
      'priceCents', a.price_cents,
      'priceAllInCents', CASE WHEN a.price_cents = 0 THEN 0 ELSE public.compute_all_in_cents(
        a.price_cents,
        COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
        COALESCE(e.pass_service_fee, b.default_pass_service_fee),
        (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
      ) END,
      'maxPerTicket', a.max_per_ticket,
      'isUnlimited', a.is_unlimited,
      'validOccurrenceIds', CASE WHEN a.valid_occurrence_keys IS NULL THEN NULL ELSE to_jsonb(ARRAY(
        SELECT d.id FROM public.event_dates d
         WHERE d.event_id = e.id AND d.occurrence_key = ANY (a.valid_occurrence_keys)
         ORDER BY d.start_at, d.id)) END,
      'remaining', CASE
        WHEN a.is_unlimited THEN NULL
        WHEN a.valid_occurrence_keys IS NULL
          THEN to_jsonb(GREATEST(a.quantity_total - public.issue_3281_add_on_taken(a.id, NULL, NULL), 0))
        ELSE COALESCE((
          SELECT jsonb_object_agg(d.id::text,
                   GREATEST(a.quantity_total - public.issue_3281_add_on_taken(a.id, d.occurrence_key, NULL), 0))
            FROM public.event_dates d
           WHERE d.event_id = e.id AND d.occurrence_key = ANY (a.valid_occurrence_keys)
        ), '{}'::jsonb)
      END,
      -- issue #3281 S2 — the public page switch and the stored photo objects.
      'showOnPublicPage', a.show_on_public_page,
      'photoPath', a.photo_path,
      'photoThumbPath', a.photo_thumb_path
    ) ORDER BY a.sort_order, a.id), '[]'::jsonb)
  FROM public.ticket_add_on_links l
  JOIN public.ticket_add_ons a ON a.id = l.add_on_id
  JOIN public.events e ON e.id = l.event_id
  JOIN public.brands b ON b.id = e.brand_id
  LEFT JOIN public.ticket_types tt ON tt.id = l.ticket_type_id
  WHERE a.is_active
    AND CASE WHEN p_ticket_type_id IS NULL
      THEN l.target_kind = 'rsvp' AND l.event_id = p_event_id
      ELSE l.target_kind = 'ticket_type' AND l.ticket_type_id = p_ticket_type_id
           AND tt.deleted_at IS NULL END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3281_public_ticket_extras(p_ticket_type_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- issue #3281 S2 — one owner of the item shape (adds showOnPublicPage,
  -- photoPath, photoThumbPath).
  SELECT public.issue_3281_public_add_on_items(NULL, p_ticket_type_id);
$fn$;

-- One ticket object with its add-ons as a last `extras` key; anything else,
-- or a ticket with none on sale, comes back as it was.
CREATE FUNCTION public.issue_3281_with_ticket_add_ons(p_item json, p_id_key text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN x.extras = '[]'::jsonb THEN p_item ELSE (
    SELECT json_object_agg(s.k, s.v ORDER BY s.o)
      FROM (
        SELECT e.key AS k, e.value AS v, e.ordinality AS o
          FROM json_each(p_item) WITH ORDINALITY e(key, value, ordinality)
         WHERE e.key <> 'extras'
        UNION ALL
        SELECT 'extras', x.extras::json, 9223372036854775807
      ) s)
  END
  FROM (SELECT CASE
      WHEN json_typeof(p_item) = 'object'
       AND COALESCE(p_item->>p_id_key, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.issue_3281_public_add_on_items(NULL, (p_item->>p_id_key)::uuid)
      ELSE '[]'::jsonb END AS extras) x;
$fn$;

-- Adds `extras` to each ticket of p_array_key (and the single ticket object
-- under p_object_key) that has an add-on on sale, keeping every key's order.
-- A payload with none comes back untouched, byte for byte.
CREATE FUNCTION public.issue_3281_attach_offering_add_ons(
  p_payload json, p_array_key text, p_id_key text, p_object_key text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_out json;
BEGIN
  IF p_payload IS NULL OR json_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RETURN p_payload;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM (
        SELECT t->>p_id_key AS id
          FROM json_array_elements(CASE WHEN json_typeof(p_payload->p_array_key) = 'array'
                                        THEN p_payload->p_array_key ELSE '[]'::json END) t
         WHERE json_typeof(t) = 'object'
        UNION ALL
        SELECT p_payload->p_object_key->>p_id_key
         WHERE p_object_key IS NOT NULL AND json_typeof(p_payload->p_object_key) = 'object'
      ) ids
      JOIN public.ticket_add_on_links l
        ON l.target_kind = 'ticket_type'
       AND l.ticket_type_id = CASE WHEN COALESCE(ids.id, '') ~* v_uuid THEN ids.id::uuid END
      JOIN public.ticket_add_ons a ON a.id = l.add_on_id
     WHERE a.is_active) THEN
    RETURN p_payload;
  END IF;
  SELECT json_object_agg(entry.key,
      CASE
        WHEN entry.key = p_array_key AND json_typeof(entry.value) = 'array' THEN (
          SELECT COALESCE(json_agg(public.issue_3281_with_ticket_add_ons(item.value, p_id_key)
                                   ORDER BY item.ordinality), '[]'::json)
            FROM json_array_elements(entry.value) WITH ORDINALITY item(value, ordinality))
        WHEN p_object_key IS NOT NULL AND entry.key = p_object_key
         AND json_typeof(entry.value) = 'object'
          THEN public.issue_3281_with_ticket_add_ons(entry.value, p_id_key)
        ELSE entry.value END
      ORDER BY entry.ordinality)
    INTO v_out
    FROM json_each(p_payload) WITH ORDINALITY entry(key, value, ordinality);
  RETURN v_out;
END;
$fn$;

-- The RSVP page: a last `rsvpAddOns` key when the RSVP has an add-on on sale
-- and RSVP add-ons are switched on; otherwise the payload, byte for byte.
CREATE FUNCTION public.issue_3281_attach_rsvp_add_ons(p_payload json)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_items jsonb;
BEGIN
  IF p_payload IS NULL OR json_typeof(p_payload) IS DISTINCT FROM 'object'
     OR COALESCE(p_payload->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR NOT public.issue_3281_add_on_switch('rsvp_enabled') THEN
    RETURN p_payload;
  END IF;
  v_items := public.issue_3281_public_add_on_items((p_payload->>'id')::uuid, NULL);
  IF v_items = '[]'::jsonb THEN RETURN p_payload; END IF;
  RETURN (
    SELECT json_object_agg(s.k, s.v ORDER BY s.o)
      FROM (
        SELECT e.key AS k, e.value AS v, e.ordinality AS o
          FROM json_each(p_payload) WITH ORDINALITY e(key, value, ordinality)
         WHERE e.key <> 'rsvpAddOns'
        UNION ALL
        SELECT 'rsvpAddOns', v_items::json, 9223372036854775807
      ) s);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_public_add_on_items(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_with_ticket_add_ons(json, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_attach_offering_add_ons(json, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_attach_rsvp_add_ons(json) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The readers, re-emitted with their bodies unchanged inside the wrapper.
-- ---------------------------------------------------------------------------
-- pg_public_trip_by_slug: the trip page (buyer web /t and Explorer).
CREATE OR REPLACE FUNCTION public.pg_public_trip_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH issue_3281_s2_original(payload) AS MATERIALIZED (
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
      e.theme_gradient_override,
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
      b.theme_gradient      AS brand_theme_gradient,
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
      'installmentCapabilityAvailable', public.pg_trip_installments_supported(tr.id),
      'themeColorOverride', tr.theme_color_override,
      'themeFontOverride', tr.theme_font_override,
      'themeAnimationOverride', tr.theme_animation_override,
      'themeGradientOverride', tr.theme_gradient_override,
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
        'themeAnimation', tr.brand_theme_animation,
        'themeGradient', tr.brand_theme_gradient
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
  FROM tr
)
-- issue #3281 G-9 — the add-on switches ride the trip payload (last key,
-- booleans only), so the trip checkout offers only add-ons the server takes.
SELECT CASE WHEN x IS NULL OR json_typeof(x) <> 'object' THEN x ELSE (
  SELECT json_object_agg(k, v ORDER BY ord) FROM (
    SELECT e.key AS k, e.value AS v, e.ordinality AS ord FROM json_each(x) WITH ORDINALITY e
    UNION ALL
    SELECT 'addOnRollout', public.issue_3281_add_on_rollout_flags()::json, 9223372036854775807
  ) t) END
FROM (SELECT public.issue_3281_attach_offering_add_ons(payload,'tiers','ticketTypeId',NULL) AS x
        FROM issue_3281_s2_original) s;
$function$;

-- pg_public_experience_by_slug: the experience page (buyer web /exp, Explorer)
-- and the experience checkout (publicExperienceService).
CREATE OR REPLACE FUNCTION public.pg_public_experience_by_slug(p_brand_slug text, p_experience_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH issue_3281_s2_original(payload) AS MATERIALIZED (
WITH issue_3872_original(payload) AS MATERIALIZED (

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
      COALESCE(e.capacity_scope, 'total') AS capacity_scope,
      COALESCE(e.booking_spacing_minutes, 30) AS booking_spacing_minutes,
      COALESCE(e.min_notice_minutes, 120) AS min_notice_minutes,
      e.experience_intents,
      e.pass_mingla_fee,
      e.pass_service_fee,
      e.theme               AS public_theme,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      e.theme_gradient_override,
      e.refund_policy,
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
      b.theme_gradient      AS brand_theme_gradient,
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
      tt.price_basis,
      tt.block_minutes,
      tt.min_blocks,
      tt.max_blocks,
      tt.group_max,

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
        -- Scoped inventory lives on day/slot chips; never lifetime-disable Reserve.
        WHEN ex.capacity_scope IN ('per_day', 'per_start') THEN NULL
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
      -- #4420: the first stop's street never rides venueText while the address is
      -- hidden; the area line (city, country) does. One rule, shared below.
      'venueText', public.issue_4420_experience_venue_line(ex.id, ex.public_theme),
      'isRecurring', COALESCE(ex.is_recurring, false),
      'isMultiDate', COALESCE(ex.is_multi_date, false),
      'recurrenceRules', ex.recurrence_rules,
      'intents', COALESCE(to_json(ex.experience_intents), '[]'::json),
      'hideAddressUntilTicket', ex.hide_address,
      'themeColorOverride', ex.theme_color_override,
      'themeFontOverride', ex.theme_font_override,
      'themeAnimationOverride', ex.theme_animation_override,
      'themeGradientOverride', ex.theme_gradient_override,
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
        'themeAnimation', ex.brand_theme_animation,
        'themeGradient', ex.brand_theme_gradient
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
          -- issue #3281 R3 — minutes from guest start (open-hours); null → clock startTime
          'startOffsetMinutes', s.start_offset_minutes,
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
          'availableOnline', COALESCE(tk.available_online, false),
          'priceBasis', COALESCE(tk.price_basis, 'person'),
          'blockMinutes', tk.block_minutes,
          'minBlocks', tk.min_blocks,
          'maxBlocks', tk.max_blocks,
          'groupMax', tk.group_max
        ) END
        FROM tk
      ),
      -- #3281 R2: all sellable options (ticket = default / first by display_order)
      'options', COALESCE((
        SELECT json_agg(json_build_object(
          'ticketTypeId', o.id,
          'name', o.name,
          'priceCents', COALESCE(o.price_cents, 0),
          'allInCents', CASE
            WHEN COALESCE(o.is_free, false) OR COALESCE(o.price_cents, 0) = 0 THEN 0
            ELSE public.compute_all_in_cents(
                   o.price_cents,
                   ex.pass_mingla_fee,
                   ex.pass_service_fee,
                   (SELECT r.effective_take_rate_bps
                      FROM public.resolve_effective_take_rate_bps(ex.brand_id) AS r)
                 )
          END,
          'currency', COALESCE(o.currency, ex.currency, 'usd'),
          'quantityTotal', o.quantity_total,
          'isUnlimited', COALESCE(o.is_unlimited, false),
          'isFree', COALESCE(o.is_free, false) OR COALESCE(o.price_cents, 0) = 0,
          'ticketsRemaining', CASE
            WHEN COALESCE(o.is_unlimited, false) THEN NULL
            WHEN o.quantity_total IS NULL THEN NULL
            WHEN ex.capacity_scope IN ('per_day', 'per_start') THEN NULL
            ELSE GREATEST(
              0,
              o.quantity_total - (
                SELECT COUNT(*)::integer FROM public.tickets t
                 WHERE t.ticket_type_id = o.id
                   AND t.status IN ('valid','used','transferred')
              )
            )
          END,
          'availableOnline', COALESCE(o.available_online, false),
          'priceBasis', COALESCE(o.price_basis, 'person'),
          'blockMinutes', o.block_minutes,
          'minBlocks', o.min_blocks,
          'maxBlocks', o.max_blocks,
          'groupMax', o.group_max
        ) ORDER BY o.display_order, o.created_at)
        FROM public.ticket_types o
        WHERE o.event_id = ex.id
          AND o.deleted_at IS NULL
          AND COALESCE(o.is_hidden, false) IS NOT TRUE
          AND COALESCE(o.is_disabled, false) IS NOT TRUE
      ), '[]'::json),
      -- bookable occurrences (event_dates) with per-occurrence remaining stamped
      -- from the ONE ticket's event-level remaining (Q2: no per-occurrence cap).
      'dates', COALESCE((
        SELECT json_agg(json_build_object(
          'id', d.id,
          'startAt', d.start_at,
          'endAt', d.end_at,
          'timezone', d.timezone,
          'isMaster', COALESCE(d.is_master, false),
          -- issue #3281 R3 — per_day/per_start day chips use occurrence taken;
          -- total keeps the event-level remaining (legacy).
          'ticketsRemaining', CASE
            WHEN (SELECT tk.is_unlimited FROM tk) THEN NULL
            WHEN (SELECT tk.quantity_total FROM tk) IS NULL THEN NULL
            WHEN ex.capacity_scope = 'per_day' THEN GREATEST(
              0,
              (SELECT tk.quantity_total FROM tk)
                - public.issue_3313_ticket_type_occurrence_taken(
                    (SELECT tk.id FROM tk), d.id)
            )
            WHEN ex.capacity_scope = 'per_start' THEN GREATEST(
              0,
              (SELECT tk.quantity_total FROM tk)
                - COALESCE((
                    SELECT MIN(public.issue_3281_ticket_type_slot_taken(
                      (SELECT tk.id FROM tk),
                      d.id,
                      gs,
                      gs + make_interval(mins => COALESCE(ex.booking_spacing_minutes, 30)),
                      NULL
                    ))
                    FROM generate_series(
                      d.start_at,
                      d.end_at - interval '1 microsecond',
                      make_interval(mins => COALESCE(ex.booking_spacing_minutes, 30))
                    ) AS gs
                    WHERE gs >= now() + make_interval(mins => COALESCE(ex.min_notice_minutes, 120))
                  ), 0)
            )
            ELSE (SELECT tk.remaining FROM tk)
          END
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
      END,
      'capacityScope', ex.capacity_scope,
      'spacingMinutes', ex.booking_spacing_minutes,
      'minNoticeMinutes', ex.min_notice_minutes,
      'refundPolicy', ex.refund_policy
    ) END
  FROM ex
)
SELECT public.issue_3872_enrich_public_ticket_payload(payload,'options','ticketTypeId','ticket') FROM issue_3872_original
)
SELECT public.issue_3281_attach_offering_add_ons(payload,'options','ticketTypeId','ticket') FROM issue_3281_s2_original;
$function$;

-- pg_public_rsvp_by_slug: the RSVP page (buyer web and Explorer).
CREATE OR REPLACE FUNCTION public.pg_public_rsvp_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH issue_3281_s2_original(payload) AS MATERIALIZED (
WITH issue_3872_original(payload) AS MATERIALIZED (

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
      e.location_provider_place_id,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      e.theme_gradient_override,
      -- RSVP host-control columns (ORCH-1150 mig 20261004000000).
      e.rsvp_capacity,
      e.rsvp_allow_plus_ones,
      e.rsvp_plus_ones_max,
      e.rsvp_waitlist_enabled,
      e.rsvp_approval_mode,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      -- issue #3827 going-box — read by the #3827 helpers only; never emitted.
      e.theme AS raw_theme,
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
      b.theme_gradient AS brand_theme_gradient,
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
      'themeGradientOverride', ev.theme_gradient_override,
      'brand', json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation,
        'themeGradient', ev.brand_theme_gradient
      ),
      -- RSVP host-control block (REPLACES the event RPC's `tickets` aggregate).
      -- issue #3827 going-box — a private list withholds the count (NULL, never 0).
      'rsvpGoingCount', CASE WHEN public.issue_3827_private_guest_list(ev.raw_theme)
                             THEN NULL ELSE (SELECT going_count FROM going) END,
      'rsvpCapacity', ev.rsvp_capacity,
      'rsvpAllowPlusOnes', ev.rsvp_allow_plus_ones,
      'rsvpPlusOnesMax', ev.rsvp_plus_ones_max,
      'rsvpWaitlistEnabled', ev.rsvp_waitlist_enabled,
      'rsvpApprovalMode', ev.rsvp_approval_mode,
      -- #4334 N-1: the picked Google place id, withheld with the street. Added
      -- just before publicEventRow so every earlier key keeps its position.
      'googlePlaceId', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE ev.location_provider_place_id
      END,
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
            -- issue #3827 going-box — NULL when the guest list is private.
            CASE WHEN public.issue_3827_private_guest_list(e.theme) THEN NULL::integer
            ELSE ( SELECT COALESCE(sum(1 + rs.plus_count), 0::bigint)::integer
                FROM public.event_rsvps rs
               WHERE rs.event_id = e.id AND rs.rsvp_status = 'going'::text AND rs.approval_status = 'approved'::text) END AS rsvp_going_count,
            e.city_geo,
            e.rsvp_contribution_enabled,
            e.rsvp_contribution_suggested_cents,
            e.rsvp_contribution_min_cents,
            e.cover_media_gallery,
            sched.next_start_at,
            sched.next_end_at,
            sched.upcoming_count,
            sched.schedule_line,
            b.theme_gradient AS brand_theme_gradient,
            e.theme_gradient_override,
            -- #4334: the view's appended last column, same withholding rule.
            CASE
              WHEN public.issue_2489_address_withheld(e.theme) THEN NULL::text
              ELSE e.location_provider_place_id
            END AS location_provider_place_id
          FROM public.events e
          JOIN public.brands b ON b.id = e.brand_id
          LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
          LEFT JOIN LATERAL (
            SELECT
              n.start_at AS next_start_at,
              n.end_at AS next_end_at,
              COALESCE(c.upcoming_count, 0) AS upcoming_count,
              CASE
                WHEN COALESCE(c.upcoming_count, 0) = 0 THEN NULL
                WHEN c.upcoming_count = 1 THEN to_char(
                  n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''), 'UTC'), 'Dy DD Mon')
                ELSE format(
                  '%s · +%s more',
                  to_char(n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''), 'UTC'), 'Dy DD Mon'),
                  c.upcoming_count - 1)
              END AS schedule_line
            FROM (
              SELECT count(*)::integer AS upcoming_count
                FROM public.event_dates d
               WHERE d.event_id = e.id AND d.end_at > now()
                 AND d.status = 'active'  -- issue #3281
            ) c
            LEFT JOIN LATERAL (
              SELECT d.start_at, d.end_at
                FROM public.event_dates d
               WHERE d.event_id = e.id AND d.end_at > now()
                 AND d.status = 'active'  -- issue #3281
               ORDER BY d.start_at, d.id
               LIMIT 1
            ) n ON true
          ) sched ON true
          WHERE e.id = ev.id
        ) r
      )
    ) END
  FROM ev
)
SELECT public.issue_3872_enrich_rsvp_payload(payload) FROM issue_3872_original
)
SELECT public.issue_3281_attach_rsvp_add_ons(payload) FROM issue_3281_s2_original;
$function$;

-- ---------------------------------------------------------------------------
-- 5. S6: an RSVP with free add-ons. The first twelve arguments are exactly
--    submit_event_rsvp_with_form's (#4541), which is called unchanged first.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_3281_submit_rsvp_with_add_ons(
  p_event_id uuid, p_user_id uuid, p_guest_name text, p_guest_email text,
  p_guest_phone text, p_rsvp_status text, p_plus_count integer DEFAULT 0,
  p_guests jsonb DEFAULT '[]'::jsonb, p_qr_token_pepper text DEFAULT NULL::text,
  p_guest_phone_country_iso text DEFAULT NULL::text, p_capable boolean DEFAULT false,
  p_form jsonb DEFAULT NULL::jsonb, p_add_ons jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_result jsonb;
  v_rsvp public.event_rsvps%ROWTYPE;
  v_item jsonb;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_qty integer;
  v_parents integer;
  v_add_on record;
  v_key text;
  v_chosen jsonb := '[]'::jsonb;
BEGIN
  -- No add-ons: exactly the #4541 RSVP, nothing else read or written.
  IF p_add_ons IS NULL OR jsonb_typeof(p_add_ons) = 'null'
     OR (jsonb_typeof(p_add_ons) = 'array' AND jsonb_array_length(p_add_ons) = 0) THEN
    RETURN public.submit_event_rsvp_with_form(
      p_event_id, p_user_id, p_guest_name, p_guest_email, p_guest_phone, p_rsvp_status,
      p_plus_count, p_guests, p_qr_token_pepper, p_guest_phone_country_iso, p_capable, p_form);
  END IF;
  IF NOT public.issue_3281_add_on_switch('rsvp_enabled') OR p_rsvp_status IS DISTINCT FROM 'going' THEN
    RAISE EXCEPTION 'rsvp_add_ons_unavailable';
  END IF;
  IF jsonb_typeof(p_add_ons) <> 'array' OR jsonb_array_length(p_add_ons) > 40 THEN
    RAISE EXCEPTION 'extras_invalid' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_add_ons) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR v_item - ARRAY['addOnId', 'quantity'] <> '{}'::jsonb
       OR COALESCE(v_item->>'addOnId', '') !~ v_uuid
       OR jsonb_typeof(v_item->'quantity') IS DISTINCT FROM 'number'
       OR (v_item->>'quantity') !~ '^[1-9][0-9]{0,2}$'
       OR (v_item->>'addOnId')::uuid = ANY (v_ids) THEN
      RAISE EXCEPTION 'extras_invalid' USING ERRCODE = '22023';
    END IF;
    v_ids := v_ids || (v_item->>'addOnId')::uuid;
  END LOOP;

  -- The RSVP first (it locks the event and the guest's rows), then the add-ons.
  v_result := public.submit_event_rsvp_with_form(
    p_event_id, p_user_id, p_guest_name, p_guest_email, p_guest_phone, p_rsvp_status,
    p_plus_count, p_guests, p_qr_token_pepper, p_guest_phone_country_iso, p_capable, p_form);
  SELECT * INTO v_rsvp FROM public.event_rsvps
   WHERE id = CASE WHEN COALESCE(v_result->>'rsvpId', '') ~ v_uuid THEN (v_result->>'rsvpId')::uuid END;
  -- A waitlisted or not-yet-written RSVP takes no add-ons (the whole call undoes).
  IF NOT FOUND OR v_rsvp.event_id <> p_event_id OR v_rsvp.rsvp_status <> 'going'
     OR v_rsvp.approval_status = 'denied' THEN
    RAISE EXCEPTION 'rsvp_add_ons_unavailable';
  END IF;
  -- A re-RSVP replaces this RSVP's own picks; they stop counting against stock.
  DELETE FROM public.event_rsvp_add_ons WHERE rsvp_id = v_rsvp.id;
  v_parents := 1 + GREATEST(v_rsvp.plus_count, 0);

  -- Locked in id order, the order checkout locks them.
  PERFORM 1 FROM public.ticket_add_ons a WHERE a.id = ANY (v_ids) ORDER BY a.id FOR UPDATE;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_add_ons) LOOP
    SELECT a.* INTO v_add_on
      FROM public.ticket_add_ons a
      JOIN public.ticket_add_on_links l
        ON l.add_on_id = a.id AND l.target_kind = 'rsvp' AND l.event_id = p_event_id
     WHERE a.id = (v_item->>'addOnId')::uuid AND a.event_id = p_event_id AND a.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'extra_not_available' USING DETAIL = v_item->>'addOnId';
    END IF;
    -- Paid RSVP add-ons are an order (a later slice); this path takes free ones.
    IF v_add_on.price_cents > 0 THEN
      RAISE EXCEPTION 'rsvp_add_on_needs_payment' USING DETAIL = v_add_on.id::text;
    END IF;
    v_qty := (v_item->>'quantity')::integer;
    IF v_qty > v_add_on.max_per_ticket * v_parents THEN
      RAISE EXCEPTION 'extra_quantity_above_max' USING DETAIL = v_add_on.id::text;
    END IF;
    IF NOT v_add_on.is_unlimited THEN
      IF v_add_on.valid_occurrence_keys IS NULL THEN
        IF public.issue_3281_add_on_taken(v_add_on.id, NULL, NULL) + v_qty > v_add_on.quantity_total THEN
          RAISE EXCEPTION 'extra_capacity_exceeded' USING DETAIL = v_add_on.id::text;
        END IF;
      ELSE
        FOREACH v_key IN ARRAY v_add_on.valid_occurrence_keys LOOP
          IF public.issue_3281_add_on_taken(v_add_on.id, v_key, NULL) + v_qty > v_add_on.quantity_total THEN
            RAISE EXCEPTION 'extra_capacity_exceeded' USING DETAIL = v_key;
          END IF;
        END LOOP;
      END IF;
    END IF;
    INSERT INTO public.event_rsvp_add_ons (rsvp_id, event_id, add_on_id, quantity, day_scope)
    VALUES (v_rsvp.id, p_event_id, v_add_on.id, v_qty, COALESCE(v_add_on.valid_occurrence_keys, '{}'::text[]));
    v_chosen := v_chosen || jsonb_build_object('addOnId', v_add_on.id, 'name', v_add_on.name, 'quantity', v_qty);
  END LOOP;
  RETURN v_result || jsonb_build_object('rsvpAddOns', v_chosen);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_submit_rsvp_with_add_ons(uuid, uuid, text, text, text, text, integer, jsonb, text, text, boolean, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_submit_rsvp_with_add_ons(uuid, uuid, text, text, text, text, integer, jsonb, text, text, boolean, jsonb, jsonb) TO service_role;

-- The door line for one admitted RSVP: each add-on and how many.
CREATE FUNCTION public.issue_3281_rsvp_door_add_ons(p_rsvp_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'quantity', ra.quantity)
                            ORDER BY a.sort_order, a.id), '[]'::jsonb)
    FROM public.event_rsvp_add_ons ra
    JOIN public.event_rsvps v ON v.id = ra.rsvp_id
    JOIN public.ticket_add_ons a ON a.id = ra.add_on_id
   WHERE ra.rsvp_id = p_rsvp_id
     AND v.rsvp_status = 'going'
     AND v.approval_status <> 'denied';
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_rsvp_door_add_ons(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_rsvp_door_add_ons(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- S6 door line in the admission reply (#3281, rework). biz_rsvp_scan returns
-- an admitted RSVP holder's add-ons as `addOns` (absent when there are none,
-- so every other scan reply is byte for byte as before), and scan-rsvp makes
-- no extra read at the door. Re-emitted from 20281119014508 (md5-guarded
-- above); one hunk.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_rsvp_scan(p_event_id uuid, p_qr_payload text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  c_before constant interval := interval '120 minutes';
  c_after constant interval := interval '360 minutes';
  v_actor uuid := auth.uid(); v_match text[]; v_entity_id uuid;
  v_rsvp public.event_rsvps%ROWTYPE; v_guest public.event_rsvp_guests%ROWTYPE;
  v_event_id uuid; v_outcome text := 'not_found'; v_now timestamptz := now();
  v_next_start timestamptz; v_last_end timestamptz; v_scan_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
      AND public.biz_brand_effective_rank(e.brand_id,v_actor)
        >= public.biz_role_rank('event_manager'))
    OR EXISTS (SELECT 1 FROM public.event_scanners es WHERE es.event_id=p_event_id
      AND es.user_id=v_actor AND es.removed_at IS NULL
      AND COALESCE((es.permissions->>'scan')::boolean,true))
    OR EXISTS (SELECT 1 FROM public.events e JOIN public.brand_team_members m ON m.brand_id=e.brand_id
      WHERE e.id=p_event_id AND m.user_id=v_actor AND m.role='scanner'
        AND m.removed_at IS NULL AND m.accepted_at IS NOT NULL)
  ) THEN RAISE EXCEPTION 'scanner_not_authorized'; END IF;

  v_match := regexp_match(COALESCE(p_qr_payload,''),
    '^mingla:v1:rsvp:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$');
  IF v_match IS NOT NULL THEN
    v_entity_id := v_match[1]::uuid;
    SELECT * INTO v_rsvp FROM public.event_rsvps
      WHERE id=v_entity_id AND qr_code=p_qr_payload FOR UPDATE;
    IF NOT FOUND THEN
      SELECT * INTO v_guest FROM public.event_rsvp_guests
        WHERE id=v_entity_id AND qr_code=p_qr_payload FOR UPDATE;
      IF FOUND THEN SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id=v_guest.rsvp_id; END IF;
    END IF;
    IF v_rsvp.id IS NOT NULL THEN
      v_event_id := v_rsvp.event_id;
      IF v_event_id <> p_event_id THEN v_outcome := 'wrong_event';
      ELSIF v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN
        v_outcome := CASE WHEN v_rsvp.approval_status='denied' THEN 'revoked' ELSE 'not_eligible' END;
      ELSIF EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
        AND (e.deleted_at IS NOT NULL OR e.status='cancelled')) THEN v_outcome := 'revoked';
      ELSIF (CASE WHEN v_guest.id IS NOT NULL THEN v_guest.checked_in_at ELSE v_rsvp.checked_in_at END) IS NOT NULL
        THEN v_outcome := 'duplicate';
      ELSIF NOT EXISTS (SELECT 1 FROM public.event_dates WHERE event_id=p_event_id) THEN v_outcome := 'success';
      ELSIF EXISTS (SELECT 1 FROM public.event_dates WHERE event_id=p_event_id
        AND v_now BETWEEN start_at-c_before AND end_at+c_after) THEN v_outcome := 'success';
      ELSE
        SELECT min(start_at) INTO v_next_start FROM public.event_dates
          WHERE event_id=p_event_id AND start_at-c_before > v_now;
        IF v_next_start IS NOT NULL THEN v_outcome := 'not_yet_open';
        ELSE v_outcome := 'event_ended';
          SELECT max(end_at) INTO v_last_end FROM public.event_dates WHERE event_id=p_event_id;
        END IF;
      END IF;
      IF v_outcome='success' THEN
        IF v_guest.id IS NOT NULL THEN UPDATE public.event_rsvp_guests
          SET checked_in_at=v_now, checked_in_by=v_actor WHERE id=v_guest.id;
        ELSE UPDATE public.event_rsvps SET checked_in_at=v_now, checked_in_by=v_actor WHERE id=v_rsvp.id;
        END IF;
      END IF;
    END IF;
  END IF;
  INSERT INTO public.rsvp_scan_events(requested_event_id,matched_event_id,rsvp_id,guest_id,
    scanner_user_id,outcome,metadata)
  VALUES(p_event_id,v_event_id,
    CASE WHEN v_guest.id IS NULL THEN v_rsvp.id ELSE NULL END,v_guest.id,v_actor,v_outcome,
    jsonb_strip_nulls(jsonb_build_object('source','scan-rsvp','nextStartAt',v_next_start,'lastEndAt',v_last_end)))
  RETURNING id INTO v_scan_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'result',v_outcome,'scanId',v_scan_id,
    'entityType',CASE WHEN v_outcome IN ('success','duplicate') THEN
      CASE WHEN v_guest.id IS NULL THEN 'primary' ELSE 'guest' END END,
    'entityId',CASE WHEN v_outcome IN ('success','duplicate') THEN
      COALESCE(v_guest.id,v_rsvp.id) END,
    'attendeeDisplayName',CASE WHEN v_outcome IN ('success','duplicate') THEN
      CASE WHEN v_guest.id IS NOT NULL THEN public.rsvp_guest_host_label(v_guest.id)
        ELSE v_rsvp.guest_name END END,
    -- #4508 1.25: who brought an unclaimed guest, for the door.
    'invitedByName',CASE WHEN v_outcome IN ('success','duplicate') AND v_guest.id IS NOT NULL THEN
      (SELECT n.label FROM public.rsvp_guest_inviter_names(v_guest.id) n) END,
    'claimed',CASE WHEN v_outcome IN ('success','duplicate') AND v_guest.id IS NOT NULL THEN
      v_guest.claimed_at IS NOT NULL END,
    'phoneLast4',CASE WHEN v_outcome IN ('success','duplicate') AND v_guest.id IS NOT NULL
      AND v_guest.claimed_at IS NULL AND v_guest.phone IS NOT NULL THEN
      right(regexp_replace(v_guest.phone,'\D','','g'),4) END,
    -- #3281 S6 — an admitted RSVP holder's add-ons, for the door line, in the
    -- admission reply itself (no second read at the door). Absent when none.
    'addOns',CASE WHEN v_outcome IN ('success','duplicate') AND v_guest.id IS NULL
      AND EXISTS (SELECT 1 FROM public.event_rsvp_add_ons ra WHERE ra.rsvp_id=v_rsvp.id)
      THEN public.issue_3281_rsvp_door_add_ons(v_rsvp.id) END,
    'nextStartAt',v_next_start,'lastEndAt',v_last_end,'checkedInAt',
    CASE WHEN v_outcome IN ('success','duplicate') THEN
      COALESCE(CASE WHEN v_guest.id IS NOT NULL THEN v_guest.checked_in_at ELSE v_rsvp.checked_in_at END,v_now) END));
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;

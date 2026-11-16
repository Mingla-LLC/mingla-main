-- =====================================================================================
-- Issue #4420 — an experience's street address never leaves the server while the host
-- hides it until booking.
--
-- ROOT CAUSE. Publishing an experience writes the FIRST STOP'S STREET ADDRESS into
-- theme.experience_meta.venue_text (biz_publish_experience and its siblings). The public
-- readers then emitted that value, or the first stop's address directly, as the
-- experience's venue line with no regard for hideAddressUntilTicket:
--   * pg_public_experience_by_slug  'venueText'  (buyer web page + checkout, Explorer detail)
--   * pg_public_experiences_by_brand venue_text + raw theme   (brand page experience cards)
--   * pg_brand_experiences_for_place venue_text + raw theme + each stop's place id, street
--     and pin (Explorer place sheet)
-- The by-slug reader already nulled each stop's street and pin; its venueText was the gap.
--
-- THE RULE (one place): issue_4420_experience_venue_line(event id, theme).
--   hidden  -> the first stop's area line: "City, CC" (city, else region, plus the
--              stored country code); NULL when the stop has no structured area.
--              Missing is hidden, never faked (Constitution #9).
--   visible -> unchanged: venue_text, else the first stop's address.
-- issue_2489_public_theme also drops experience_meta.venue_text when the address is
-- withheld, so every view or reader that returns the public theme stops carrying it.
--
-- Signatures, return shapes, volatility, SECURITY DEFINER and grants are unchanged
-- (CREATE OR REPLACE keeps the ACL). Bodies are the live definitions with only the
-- marked #4420 lines changed.
--
-- ORDERING: strictly greater than 20280718004420 (the newest prefix in this worktree and
-- every sibling worktree when this file was created).
-- =====================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_4420_experience_venue_line(p_event_id uuid, p_theme jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN public.issue_2489_address_withheld(p_theme) THEN (
      SELECT CASE
               WHEN area.place IS NULL THEN NULL
               ELSE pg_catalog.concat_ws(', ', area.place, area.country)
             END
        FROM public.experience_stops s
        CROSS JOIN LATERAL (
          SELECT COALESCE(NULLIF(pg_catalog.btrim(s.city), ''), NULLIF(pg_catalog.btrim(s.region), '')) AS place,
                 NULLIF(pg_catalog.upper(pg_catalog.btrim(s.country_code)), '') AS country
        ) area
       WHERE s.event_id = p_event_id
       ORDER BY s.stop_order ASC
       LIMIT 1)
    ELSE COALESCE(
      NULLIF(p_theme #>> '{experience_meta,venue_text}', ''),
      (SELECT s.address
         FROM public.experience_stops s
        WHERE s.event_id = p_event_id
        ORDER BY s.stop_order ASC
        LIMIT 1))
  END
$function$;

COMMENT ON FUNCTION public.issue_4420_experience_venue_line(uuid, jsonb) IS
  '#4420 — an experience''s public venue line. Hidden address: the first stop''s area '
  '(city or region, country code) or NULL, never the street. Visible: venue_text, else the '
  'first stop''s address. Called only from SECURITY DEFINER public readers.';

-- Not callable by app clients: it reads any event's stops. The definer readers run it
-- as their owner.
REVOKE ALL ON FUNCTION public.issue_4420_experience_venue_line(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_4420_experience_venue_line(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_experience_venue_line(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_2489_public_theme(p_theme jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_theme IS NULL THEN NULL
    WHEN pg_catalog.jsonb_typeof(p_theme) IS DISTINCT FROM 'object' THEN '{}'::jsonb
    WHEN public.issue_2489_address_withheld(p_theme) THEN
      -- #4420: an experience's venue_text is its first stop's street (written at
      -- publish), so it is withheld with the address. `#-` on a missing path is
      -- a no-op, so a theme without experience_meta is unchanged.
      CASE WHEN pg_catalog.jsonb_typeof(p_theme #> '{business_event,location}') = 'object'
             THEN ((p_theme - 'business_draft') #- '{business_event,location,address}') #- '{experience_meta,venue_text}'
           ELSE (p_theme - 'business_draft') #- '{experience_meta,venue_text}'
      END
    ELSE (p_theme - 'business_draft')
  END
$function$
;

CREATE OR REPLACE FUNCTION public.pg_public_experience_by_slug(p_brand_slug text, p_experience_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$WITH issue_3872_original(payload) AS MATERIALIZED (

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
SELECT public.issue_3872_enrich_public_ticket_payload(payload,'options','ticketTypeId','ticket') FROM issue_3872_original;$function$
;

CREATE OR REPLACE FUNCTION public.pg_public_experiences_by_brand(p_brand_slug text)
 RETURNS TABLE(experience_id uuid, brand_id uuid, brand_slug text, brand_name text, experience_slug text, title text, description text, cover_media_url text, cover_media_type text, theme jsonb, venue_text text, next_occurrence_at timestamp with time zone, price_from_cents bigint, currency text, is_free boolean, published_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    e.id AS experience_id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    e.slug AS experience_slug,
    e.title,
    e.description,
    e.cover_media_url,
    e.cover_media_type::text AS cover_media_type,   -- NEW (sibling pattern, proven)
    -- #4420: the public theme projection (no street, no host draft) and the
    -- area line while the address is hidden.
    public.issue_2489_public_theme(e.theme) AS theme,
    public.issue_4420_experience_venue_line(e.id, e.theme) AS venue_text,
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
    -- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: paid-only Stripe-readiness gate (mirror of checkout 409 + ORCH-1075 publish guard). FREE + in-person-only-paid exempt. Buyer-facing only — owners read events directly.
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.ticket_types tt
         WHERE tt.event_id = e.id
           AND tt.available_online = true
           AND tt.deleted_at IS NULL
           AND tt.price_cents > 0
      )
      OR public.pg_brand_can_collect(e.brand_id)
    )
  ORDER BY
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz ASC NULLS LAST,
    e.published_at DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.pg_brand_experiences_for_place(p_place_pool_id uuid)
 RETURNS TABLE(experience_id uuid, brand_id uuid, brand_slug text, brand_name text, experience_slug text, title text, description text, cover_media_url text, cover_media_type text, theme jsonb, venue_text text, next_occurrence_at timestamp with time zone, price_from_cents bigint, currency text, is_free boolean, experience_intents text[], stops jsonb, upcoming_occurrences jsonb, published_at timestamp with time zone, is_recurring boolean, recurrence_rules jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    e.id AS experience_id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    e.slug AS experience_slug,
    e.title,
    e.description,
    e.cover_media_url,
    e.cover_media_type::text AS cover_media_type,
    -- #4420: the public theme projection (no street, no host draft) and the
    -- area line while the address is hidden.
    public.issue_2489_public_theme(e.theme) AS theme,
    public.issue_4420_experience_venue_line(e.id, e.theme) AS venue_text,
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
    e.experience_intents,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'stop_order',     s.stop_order,
          -- #4420: a hidden address also hides the stop's map place id, street
          -- and pin (the same rule as pg_public_experience_by_slug).
          'place_id',       CASE WHEN public.issue_2489_address_withheld(e.theme) THEN s.id::text
                                 ELSE COALESCE(s.place_id, s.id::text) END,
          'place_name',     s.place_name,
          'address',        CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE s.address END,
          'city',           s.city,
          'image_urls',     to_jsonb(s.image_urls),
          'ai_description', s.ai_description,
          'lat',            CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE s.lat END,
          'lng',            CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE s.lng END,
          'start_time',     s.start_time,
          'price_cents',    s.price_cents
        )
        ORDER BY s.stop_order ASC
      )
      FROM public.experience_stops s
      WHERE s.event_id = e.id
    ), '[]'::jsonb) AS stops,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'event_date_id', occ.id,
          'start_at',      occ.start_at,
          'end_at',        occ.end_at,
          'capacity',      occ.cap,
          'sold',          occ.sold,
          'remaining',     occ.remaining
        )
        ORDER BY occ.start_at ASC
      )
      FROM (
        SELECT
          ed.id, ed.start_at, ed.end_at,
          tcap.cap, tcap.sold, tcap.remaining,
          ROW_NUMBER() OVER (ORDER BY ed.start_at ASC) AS rn
        FROM public.event_dates ed
        CROSS JOIN LATERAL (
          SELECT
            tt.quantity_total AS cap,
            COALESCE((
              SELECT COUNT(*) FROM public.tickets tk
              WHERE tk.ticket_type_id = tt.id
                AND tk.status IN ('valid','used','transferred')
            ), 0)::int AS sold,
            CASE
              WHEN tt.is_unlimited THEN NULL
              WHEN tt.quantity_total IS NULL THEN NULL
              ELSE GREATEST(tt.quantity_total - COALESCE((
                SELECT COUNT(*) FROM public.tickets tk
                WHERE tk.ticket_type_id = tt.id
                  AND tk.status IN ('valid','used','transferred')
              ), 0), 0)::int
            END AS remaining
          FROM public.ticket_types tt
          WHERE tt.event_id = e.id
            AND tt.available_online = true
            AND tt.deleted_at IS NULL
          ORDER BY tt.price_cents ASC, tt.id ASC
          LIMIT 1
        ) tcap
        WHERE ed.event_id = e.id
          AND ed.end_at > now()
      ) occ
      WHERE occ.rn <= 12
    ), '[]'::jsonb) AS upcoming_occurrences,
    e.published_at,
    e.is_recurring,
    e.recurrence_rules
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  -- META-ORCH-1255 M4 (F-7): the place→brand resolution is the VENUE row now.
  JOIN public.venue_listings vl
    ON vl.brand_id = b.id
   AND vl.place_pool_id = p_place_pool_id
   AND vl.claim_status = 'verified'
  WHERE b.deleted_at IS NULL
    AND e.event_type = 'experience'
    AND e.visibility = 'public'
    AND e.published_at IS NOT NULL
    AND e.deleted_at IS NULL
    -- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: paid-only Stripe-readiness gate (mirror of checkout 409 + ORCH-1075 publish guard). FREE + in-person-only-paid exempt. Buyer-facing only — owners read events directly.
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.ticket_types tt
         WHERE tt.event_id = e.id
           AND tt.available_online = true
           AND tt.deleted_at IS NULL
           AND tt.price_cents > 0
      )
      OR public.pg_brand_can_collect(e.brand_id)
    )
  ORDER BY
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz ASC NULLS LAST,
    e.published_at DESC;
$function$
;

-- Restate the readers' grants (#1023 F-9 style): CREATE OR REPLACE keeps an ACL, but
-- no reader should depend on that carry-over. Values equal the live ACLs.
GRANT EXECUTE ON FUNCTION public.issue_2489_public_theme(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pg_public_experience_by_slug(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pg_public_experiences_by_brand(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pg_brand_experiences_for_place(uuid) TO anon, authenticated, service_role;

-- #2489 SC-25: every object that carries the shared address gate is declared.
INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind) VALUES
  ('issue_4420_experience_venue_line', 'function'),
  ('pg_brand_experiences_for_place', 'function'),
  ('pg_public_experiences_by_brand', 'function')
ON CONFLICT (object_name) DO NOTHING;

COMMIT;

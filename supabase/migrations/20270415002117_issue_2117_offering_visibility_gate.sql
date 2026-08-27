-- =====================================================================
-- issue #2117 -- public offering reads must consistently respect offering
-- visibility.
--
-- CONTRACT: BINDING SPEC (#issuecomment-5310185921) as amended by
-- AMENDMENT 1 (#issuecomment-5310364586) and AMENDMENT 2
-- (#issuecomment-5310590806), read together, AMENDMENT 2 CONTROLLING.
-- Authorized by the independent review at #issuecomment-5310644617.
-- §8 step-0 derivation + A-4.9 rung evidence: #issuecomment-5310742144.
--
-- §8 steps 1-6 are ONE migration file, ONE transaction. Splitting them
-- creates a window in which a reader references a gate that does not
-- exist, and is out of contract.
--
-- WHY THIS EXISTS
-- Some reads that serve unauthenticated callers resolved on identifiers
-- alone and did not consult the offering's visibility. An organiser who
-- marks an offering private or hidden has made a decision about who can
-- see it; those reads did not participate in it. This migration replaces
-- that with ONE shared mechanism -- the Offering Visibility Gate -- with
-- every deliberate exception recorded at its site.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * It does not touch public.events, any RLS policy, or any
--     security_invoker = true view. A gate placed in an invoker-evaluated
--     context is the #1931 Amendment 3 failure, and is forbidden here even
--     though the gate is engineered to survive it (SPEC §9).
--   * It adds ZERO entries to the anon-executable-definer allowlist. Every
--     object created here is revoked from PUBLIC, anon AND authenticated.
--     Revoking from PUBLIC alone is NOT sufficient in this schema: default
--     privileges attach EXPLICIT anon/authenticated grants at creation
--     time, which a PUBLIC revoke does not remove. Measured on the SPEC's
--     original clause: the gate landed in the shipped CI probe as an
--     unallowlisted violation and the gate exited non-zero. A-4.1
--     corrected it, and it is the single most load-bearing line here.
--   * It does not fold status into the audience (A-4.2). The gate governs
--     SOFT-DELETE and VISIBILITY ONLY. Every reader keeps its own status
--     predicate VERBATIM, because the readers do not share a status set
--     and one per-audience status set cannot preserve both. Measured:
--     folding status in flips a PUBLICLY VISIBLE ended offering from
--     denied to served -- a widening on the PUBLIC path caused by the
--     adoption rule itself. AR-1 and A-4.2 are load-bearing on each other
--     and neither may be revisited without the other.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- §8 STEP 1 -- the mechanism: the Offering Visibility Gate (§4.1)
--
-- Two forms, created BEFORE any reader is replaced.
--
-- OUTAGE IMMUNITY IS A MEASUREMENT, NOT AN ARGUMENT. From a role stripped
-- of every privilege on the offering relation, a direct table read raises
-- `permission denied for table events` -- the exact #1931 Amendment 3
-- condition -- while BOTH forms below answer correctly and NEITHER raises.
-- Form A reads no relation at all, so there is no privilege for it to be
-- missing. Form B is SECURITY DEFINER, so its read runs with the owner's
-- privileges and the caller needs only EXECUTE.
--
-- NEITHER FORM MAY EVER BRANCH ON THE CALLER'S ROLE. Inside a SECURITY
-- DEFINER function current_user is the owner, so the caller's role is not
-- visible; the only thing that exposes it is the role GUC, and outside a
-- SET ROLE session that GUC is literally 'none', which makes the natural
-- role check RAISE. A role-introspecting gate would be the next outage
-- rather than a defence against one. A-SC-3 exists to red exactly that,
-- and it asserts the PROPERTY -- no changed object's result varies with
-- the caller's role -- rather than banning named mechanisms, because the
-- named-mechanism form was independently forged twice during review.
-- ---------------------------------------------------------------------

-- Form A -- the scalar gate. Pure function of three scalars; reads NO
-- relation whatsoever. The SINGLE authoritative expression of the offering
-- visibility rule. A second copy anywhere in the schema violates
-- I-PROPOSED-2117-ONE-OFFERING-VISIBILITY-GATE.
--
-- NOT declared STRICT / RETURNS NULL ON NULL INPUT: a NULL p_deleted_at is
-- the NORMAL case (an offering that has not been soft-deleted), so STRICT
-- would make the gate return NULL for every live offering.
--
-- Total and fail-closed on EVERY input: NULL visibility, NULL audience and
-- any audience outside the closed two-value set all return false. It never
-- returns NULL and never raises.
CREATE OR REPLACE FUNCTION public.pg_offering_visibility_gate(
  p_visibility  text,
  p_deleted_at  timestamptz,
  p_audience    text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT COALESCE(
    p_deleted_at IS NULL
      AND CASE p_audience
            -- 'listing' -- readers that can be enumerated, or that power
            -- feeds, brand pages and render surfaces. Admits only the
            -- publicly visible form. Reproduces the deployed render-path
            -- reference reader's predicate exactly.
            WHEN 'listing' THEN p_visibility = 'public'
            -- 'direct' -- readers on the ACQUISITION path, whose result is
            -- required to complete a purchase, booking or RSVP, so that
            -- withholding it breaks a link the organiser deliberately
            -- handed to a specific person. Admits the publicly visible
            -- form AND the unlisted form. Reproduces the deployed
            -- acquisition-path reference reader's predicate exactly. NOT a
            -- loosening -- it is the existing, deliberate unlisted
            -- exact-link contract, written once instead of three times.
            WHEN 'direct'  THEN p_visibility IN ('public', 'hidden')
            -- The audience set is CLOSED. Anything else fails closed.
            ELSE false
          END,
    false);
$function$;

COMMENT ON FUNCTION public.pg_offering_visibility_gate(text, timestamptz, text) IS
  'issue #2117 -- Offering Visibility Gate, Form A (scalar). The single '
  'authoritative expression of offering public-readability. Reads no '
  'relation, so it cannot raise for a caller lacking privileges. Governs '
  'soft-delete and visibility ONLY -- status is deliberately NOT folded in '
  '(A-4.2). Audience set is closed {listing, direct}; every other input '
  'fails closed. Never branches on the caller''s role (A-SC-3).';

-- Form B -- the identifier gate. Resolves the offering row and delegates
-- to Form A. Returns false, NEVER NULL, for an unresolvable or NULL
-- identifier.
CREATE OR REPLACE FUNCTION public.pg_offering_passes_visibility_gate(
  p_event_id  uuid,
  p_audience  text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT public.pg_offering_visibility_gate(e.visibility, e.deleted_at, p_audience)
    FROM public.events e
    WHERE e.id = p_event_id
  ), false);
$function$;

COMMENT ON FUNCTION public.pg_offering_passes_visibility_gate(uuid, text) IS
  'issue #2117 -- Offering Visibility Gate, Form B (identifier). Resolves '
  'the offering and delegates to Form A. SECURITY DEFINER so the read runs '
  'with the owner''s privileges and the caller needs only EXECUTE -- it '
  'therefore cannot produce a permission error for a caller in any '
  'evaluation context. Returns false (never NULL, never a raise) for an '
  'unresolvable or NULL identifier. Never branches on the caller''s role.';

-- GRANTS (A-4.1, the corrected clause). See the header note: REVOKE FROM
-- PUBLIC ALONE IS NOT ENOUGH in this schema. Neither form is called by a
-- client; both are called from SECURITY DEFINER bodies where the executing
-- role is the owner and these grants are not consulted. Consequence, and
-- it is success criterion A-SC-9: the allowlist requires ZERO edits.
REVOKE EXECUTE ON FUNCTION public.pg_offering_visibility_gate(text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pg_offering_passes_visibility_gate(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_offering_visibility_gate(text, timestamptz, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.pg_offering_passes_visibility_gate(uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------
-- §8 STEP 5 (emitted FIRST so no narrowed reader ever references a
-- sibling that does not yet exist) -- Class D: grant separation for
-- privileged consumers (§4.5 as widened by A-4.5).
--
-- A sibling is required wherever a consumer's admitted set is not
-- contained in the audience assigned under AR-1, MEASURED at every
-- visibility state rather than reasoned about.
--
-- BOTH siblings below are required by ONE consumer -- the share-preview
-- path -- whose own predicate admits THREE visibility states where
-- 'direct' admits two. The extra state is the one SPEC §2 explicitly keeps
-- out of the gate, and the consumer additionally requires a publication
-- timestamp that neither audience models. It reaches BOTH narrowed
-- readers, so BOTH need siblings (A-4.5). Without them a released public
-- surface silently loses pricing and inventory for that state.
--
-- The remaining-inventory sibling is additionally required by the
-- capacity-notification consumer, which runs against offerings of ANY
-- visibility including drafts. Its failure mode is NOT silent and NOT an
-- error: a narrowed reader returns ZERO ROWS, not an error, so the
-- consumer's error branch is never taken, its accumulation loop no-ops,
-- capacity and remaining both compute to 0, both are non-null so the
-- unlimited-skip guard passes, and it emits a SOLD-OUT NOTIFICATION for an
-- offering that has sold nothing. That notification's idempotency key is
-- per-offering AND per-recipient, is persisted, and carries a UNIQUE
-- constraint -- so the false alert PERMANENTLY CONSUMES the key and the
-- organiser's genuine sold-out notification, later, is never delivered.
-- It is louder, not quieter, and it is the permanent loss of a real alert.
--
-- Each sibling preserves TODAY'S BEHAVIOUR VERBATIM -- the bodies below
-- are byte-identical to the pre-#2117 readers apart from their names.
-- Neither is anon-executable, so neither is added to any allowlist.
-- ---------------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.pg_privileged_event_tier_allin(p_event_id uuid)
 RETURNS TABLE(ticket_type_id uuid, base_cents integer, all_in_cents integer, currency text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    tt.id AS ticket_type_id,
    GREATEST(0, COALESCE(tt.price_cents, 0)) AS base_cents,
    -- Free tiers (is_free OR null/0 price) => 0, never NaN. compute_all_in_cents
    -- floors the base at 0 and only grosses up a positive base by the passed
    -- fees, so a free tier already returns 0; the CASE makes that explicit and
    -- short-circuits the take-rate subquery for free rows.
    CASE
      WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
      ELSE public.compute_all_in_cents(
             tt.price_cents,
             COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee),
             COALESCE(e.pass_service_fee, b.default_pass_service_fee),
             (SELECT r.effective_take_rate_bps
                FROM public.resolve_effective_take_rate_bps(b.id) AS r)
           )
    END AS all_in_cents,
    COALESCE(b.pricing_currency, tt.currency, 'usd') AS currency
  FROM public.ticket_types tt
  JOIN public.events e ON e.id = tt.event_id
  JOIN public.brands b ON b.id = e.brand_id
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND b.deleted_at IS NULL
  ORDER BY GREATEST(0, COALESCE(tt.price_cents, 0)) ASC, tt.id ASC;
$function$;

COMMENT ON FUNCTION public.pg_privileged_event_tier_allin(uuid) IS
  'issue #2117 §4.5 -- privileged sibling of the per-tier all-in pricing '
  'reader. Preserves the pre-#2117 behaviour VERBATIM (no visibility gate) '
  'for the share-preview consumer, whose admitted visibility set is '
  'strictly wider than the ''direct'' audience. service_role ONLY -- never '
  'anon-executable, so it adds no allowlist entry.';

REVOKE EXECUTE ON FUNCTION public.pg_privileged_event_tier_allin(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_privileged_event_tier_allin(uuid)
  TO service_role;


CREATE OR REPLACE FUNCTION public.pg_privileged_ticket_types_remaining(p_event_id uuid)
 RETURNS TABLE(ticket_type_id uuid, sold integer, remaining integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    tt.id AS ticket_type_id,
    COALESCE(s.sold, 0)::int AS sold,
    CASE
      WHEN tt.is_unlimited THEN NULL
      WHEN tt.quantity_total IS NULL THEN NULL
      ELSE GREATEST(tt.quantity_total - COALESCE(s.sold, 0), 0)::int
    END AS remaining
  FROM public.ticket_types tt
  LEFT JOIN (
    SELECT t.ticket_type_id, COUNT(*)::int AS sold
    FROM public.tickets t
    WHERE t.status IN ('valid', 'used', 'transferred')
    GROUP BY t.ticket_type_id
  ) s ON s.ticket_type_id = tt.id
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;
$function$;

COMMENT ON FUNCTION public.pg_privileged_ticket_types_remaining(uuid) IS
  'issue #2117 §4.5 -- privileged sibling of the remaining-inventory '
  'reader. Preserves the pre-#2117 behaviour VERBATIM (no visibility gate) '
  'for the share-preview consumer AND the capacity-notification consumer, '
  'the latter running against offerings of ANY visibility including '
  'drafts. Without it that consumer computes capacity 0 / remaining 0 from '
  'an empty result and emits a false sold-out notification that '
  'permanently consumes a UNIQUE idempotency key, suppressing the '
  'organiser''s real notification forever. service_role ONLY.';

REVOKE EXECUTE ON FUNCTION public.pg_privileged_ticket_types_remaining(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_privileged_ticket_types_remaining(uuid)
  TO service_role;

-- ---------------------------------------------------------------------
-- §8 STEP 2 -- Class A adoption (§4.2 as amended by A-4.2): the reader
-- already resolves the offering row, so its inline predicate is replaced
-- by a single call to Form A on the columns already in scope. Keeping the
-- old predicate AND adding the gate alongside it is NOT permitted -- the
-- point is that exactly one expression of the rule survives.
--
-- Every changed site below carries the §9 protective comment stating BOTH
-- halves: why visibility is not written locally, and why status still is.
-- ---------------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.pg_public_event_tier_allin(p_event_id uuid)
 RETURNS TABLE(ticket_type_id uuid, base_cents integer, all_in_cents integer, currency text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    tt.id AS ticket_type_id,
    GREATEST(0, COALESCE(tt.price_cents, 0)) AS base_cents,
    -- Free tiers (is_free OR null/0 price) => 0, never NaN. compute_all_in_cents
    -- floors the base at 0 and only grosses up a positive base by the passed
    -- fees, so a free tier already returns 0; the CASE makes that explicit and
    -- short-circuits the take-rate subquery for free rows.
    CASE
      WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
      ELSE public.compute_all_in_cents(
             tt.price_cents,
             COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee),
             COALESCE(e.pass_service_fee, b.default_pass_service_fee),
             (SELECT r.effective_take_rate_bps
                FROM public.resolve_effective_take_rate_bps(b.id) AS r)
           )
    END AS all_in_cents,
    COALESCE(b.pricing_currency, tt.currency, 'usd') AS currency
  FROM public.ticket_types tt
  JOIN public.events e ON e.id = tt.event_id
  JOIN public.brands b ON b.id = e.brand_id
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    -- issue #2117 -- the offering visibility rule is expressed ONLY through the
    -- Offering Visibility Gate. Do NOT write it locally here or anywhere else.
    -- Audience 'direct' by AR-2: this reader is dual-reach and its acquisition
    -- path is ITSELF UNAUTHENTICATED (the unlisted exact-link direct-checkout
    -- contract), while an already-narrow render reader exists to serve the
    -- render surface -- measured: it serves the publicly visible state only and
    -- carries both the all-in pricing and the remaining inventory. Assigning
    -- 'listing' here would strip pricing from the shipped anon acquisition
    -- surface for an unlisted offering and break the invariant SPEC §6 lists as
    -- PRESERVED. This reader has no status predicate today and none is added.
    AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'direct')
  ORDER BY GREATEST(0, COALESCE(tt.price_cents, 0)) ASC, tt.id ASC;
$function$;


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
$function$;



-- ---------------------------------------------------------------------
-- §8 STEP 3 -- Class B adoption (§4.3): the reader is keyed on an offering
-- but never resolves it, so it gains ONE conjunct calling Form B on its
-- own p_event_id. Nothing else in the body changes.
-- ---------------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.pg_public_ticket_types_remaining(p_event_id uuid)
 RETURNS TABLE(ticket_type_id uuid, sold integer, remaining integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    tt.id AS ticket_type_id,
    COALESCE(s.sold, 0)::int AS sold,
    CASE
      WHEN tt.is_unlimited THEN NULL
      WHEN tt.quantity_total IS NULL THEN NULL
      ELSE GREATEST(tt.quantity_total - COALESCE(s.sold, 0), 0)::int
    END AS remaining
  FROM public.ticket_types tt
  LEFT JOIN (
    SELECT t.ticket_type_id, COUNT(*)::int AS sold
    FROM public.tickets t
    WHERE t.status IN ('valid', 'used', 'transferred')
    GROUP BY t.ticket_type_id
  ) s ON s.ticket_type_id = tt.id
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL
    -- issue #2117 -- Class B (§4.3): this reader is keyed on an offering but
    -- NEVER resolves it -- which is exactly why the naive "does the body
    -- reference the offering table" test misses it -- so it gains ONE conjunct
    -- calling the identifier form of the gate. Nothing else in the body
    -- changes. Audience 'direct' by the same AR-2 derivation recorded on the
    -- per-tier pricing reader. Documented empty value: ZERO ROWS. It does NOT
    -- raise -- a raise would be an observable behavioural change and is out of
    -- contract.
    AND public.pg_offering_passes_visibility_gate(p_event_id, 'direct');
$function$;



-- ---------------------------------------------------------------------
-- §8 STEP 4 -- Class C adoption (§4.4): AUTHORISATION, not visibility.
--
-- These are event-keyed commercial counters that the business app calls
-- WHILE AN ORGANISER EDITS THEIR OWN NOT-YET-PUBLIC OFFERING. A visibility
-- predicate on them is the WRONG remedy and produces a DENY where ALLOW is
-- correct -- the #1931 Amendment 3 failure, one layer deeper.
--
-- MEASURED, on the object whose guard this rule exists to protect:
--   remedy              | organiser's capacity guard | unauthenticated read
--   --------------------+----------------------------+---------------------
--   unchanged           | fires at all five states   | SERVED at all five
--   visibility gate     | DEFEATED at four of five   | denied
--   authorisation arm   | fires at all five states   | denied at all five,
--                       |                            | and denied to a
--                       |                            | signed-in stranger
-- The gate collapses the count the guard reads to zero, so capacity may be
-- set BELOW units already sold. The authorisation arm satisfies both
-- constraints at once.
--
-- These MUST NOT call Form A or Form B. There is NO visibility term here.
--
-- A-SC-3 COMPATIBILITY, and this is the exact line that separates §4.4
-- from the forgery A-SC-3 exists to kill: the arm branches on the caller's
-- IDENTITY, which is a SUPPLIED INPUT, not on their ROLE, which is an
-- AMBIENT property of the connection. A-SC-3 fixes the inputs and the
-- identity claim is one of them. Measured: holding the identity claim
-- constant and executing under two distinct roles produces ZERO
-- role-dependent cells.
-- ---------------------------------------------------------------------

-- D4 -- experience sold count. Rung R-3, because a REAL CLIENT CALL SITE
-- EXISTS, which makes R-2 (EXECUTE-narrowing) inadmissible.
-- Documented empty value: 0.
CREATE OR REPLACE FUNCTION public.biz_experience_sold_count(p_event_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN public.biz_is_event_manager_plus(p_event_id, auth.uid()) THEN (
      SELECT COALESCE(SUM(oli.quantity), 0)::int
      FROM public.orders o
      JOIN public.order_line_items oli ON oli.order_id = o.id
      WHERE o.event_id = p_event_id
        AND o.payment_status NOT IN ('failed', 'cancelled')
    )
    ELSE 0
  END;
$function$;

-- R5 -- per-tier issued-ticket counts. Rung R-3, same ground as D4: a real
-- client call site exists, so the object must stay caller-executable. This
-- one additionally exposes ENUMERABLE TIER IDENTIFIERS in its payload, so
-- leaving it unremedied was not acceptable on the payload test.
-- Documented empty value: '{}'::jsonb.
CREATE OR REPLACE FUNCTION public.biz_trip_tickets_sold_by_tier(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN public.biz_is_event_manager_plus(p_event_id, auth.uid()) THEN (
      SELECT COALESCE(
        jsonb_object_agg(tt.id::text, c.sold_count),
        '{}'::jsonb
      )
      FROM public.ticket_types tt
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS sold_count
        FROM public.tickets t
        WHERE t.ticket_type_id = tt.id
          AND t.status IN ('valid', 'used', 'transferred')
      ) c ON true
      WHERE tt.event_id = p_event_id
        AND tt.deleted_at IS NULL
    )
    ELSE '{}'::jsonb
  END;
$function$;

-- R6 -- web-purchase predicate. Rung R-3: a real client call site exists.
-- Documented empty value: false. A-4.3 warns that a boolean has no neutral
-- empty value IN GENERAL -- that warning does not bite here, because this
-- object has ZERO in-database consumers. Its only consumer is a client
-- hook that already defaults to false, so the empty value is observed as
-- ABSENCE, never as a CHANGED DECISION (A-SC-12).
CREATE OR REPLACE FUNCTION public.biz_trip_has_web_purchases(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN public.biz_is_event_manager_plus(p_event_id, auth.uid()) THEN EXISTS (
      SELECT 1 FROM public.orders
      WHERE event_id = p_event_id
        AND payment_status NOT IN ('failed', 'cancelled')
        AND payment_method IN ('card', 'apple_pay', 'google_pay')
    )
    ELSE false
  END;
$function$;

-- ---------------------------------------------------------------------
-- §8 STEP 5 (continued) -- A-4.9 rung R-2: EXECUTE-NARROWING.
--
-- Admissible ONLY where EVERY enumerated consumer is a SECURITY DEFINER
-- body AND NO real client call site exists -- both derived from the
-- catalog and the repository with comments stripped and call positions
-- only. Where those hold it is the STRONGEST remedy: the object stops
-- being reachable by the governed audience at all, and no consumer can
-- observe the change, because a definer body is evaluated with the
-- OWNER's privileges. Where they do NOT hold it is the larger outage --
-- measured, on the two caller-evaluated objects, as `permission denied for
-- function` raised INSIDE the policies for every signed-in caller.
--
-- BODIES ARE NOT MODIFIED HERE. Only grants.
-- ---------------------------------------------------------------------

-- D3 -- the terminated-series boolean oracle. Rung R-2.
-- THIS OBJECT IS THE REASON THE LADDER IS EVALUATED PER OBJECT AND NEVER
-- BY KIND. It is the same KIND as D4 above and it takes a DIFFERENT rung.
-- Measured, through its real consumers:
--   unchanged         -> correct at 5 of 5
--   visibility gate   -> correct at 1 of 5; the scheduled top-up job stops
--                        skipping series that have legitimately ended
--   authorisation arm -> correct at 0 of 5 -- the scheduled job carries NO
--                        CALLER IDENTITY, so the arm denies
--                        unconditionally. THIS IS WORSE THAN THE REMEDY
--                        AMENDMENT 1 FORBADE.
--   EXECUTE-narrowing -> every consumer IDENTICAL to control at all five
--                        states; both unauthorised callers refused.
-- All three consumers are SECURITY DEFINER bodies; zero client call sites.
REVOKE EXECUTE ON FUNCTION public.pg_recurrence_is_terminated(jsonb, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_recurrence_is_terminated(jsonb, uuid, timestamptz)
  TO service_role;

-- D5 -- per-tier sold counts (count + ENUMERABLE TIER IDENTIFIERS). R-2.
-- Its single consumer is a SECURITY DEFINER body and it has NO real client
-- call site: all FIVE repository matches are COMMENTS -- one of which
-- states in terms that the calling hook was never built and that the
-- server-side guard is canonical regardless. Its twin D4 -- the same kind,
-- the same payload shape, the same consumer shape -- has ONE genuine call
-- and therefore takes R-3 instead. That single fact, settled only by
-- stripping comments, is what separates their rungs.
-- Measured: consumer outcome identical to control at all five states;
-- both an unauthenticated caller and a signed-in stranger refused.
REVOKE EXECUTE ON FUNCTION public.biz_trip_sold_count_by_tier(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_trip_sold_count_by_tier(uuid)
  TO service_role;

-- R7 -- brand pricing / payment-provider configuration resolver. R-2.
-- Payload carries the connected-account identifier, the payout subaccount
-- code, the effective take rate and the tax basis. ZERO in-database
-- consumers and ZERO client call sites; its only consumers are two Edge
-- Functions already running under service_role, one of which carries a
-- comment stating exactly that. Narrowing is therefore invisible to them
-- and removes the object from the governed audience entirely.
REVOKE EXECUTE ON FUNCTION public.resolve_event_pricing_inputs(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_event_pricing_inputs(uuid)
  TO service_role;

-- ---------------------------------------------------------------------
-- §8 STEP 6 -- recorded exceptions (§4.6 as extended by A-4.6), and the
-- A-SC-14 residual record for the objects left at rung R-4.
--
-- The exception forms are a CLOSED set. An exception that does not fit one
-- of these four is not permitted; the implementor stops and requests an
-- amendment.
--   E-1  exact-key, non-enumerable, unlisted sharing is a deliberate
--        product contract.
--   E-2  the gate is a different and correct axis -- the reader's publish
--        / verification / ordering state is the authoritative control for
--        that object and offering visibility is not the governing
--        property.
--   E-3  no offering identity in the payload -- place-directory data.
--   E-4  outside the audience this issue governs -- the object's access
--        list grants EXECUTE to no role in the governed audience, so it is
--        not reachable by the caller this issue is about, BY
--        CONSTRUCTION. The record must carry the MEASURED access list,
--        taken from the catalog in the same run, never an assertion.
--        A-SC-13 verifies every E-4 in BOTH directions: an E-4 whose
--        object IS reachable reds, and so does an E-1/E-2/E-3 whose object
--        is NOT.
--
-- ---- RUNG R-4: FULL EXCLUSION, with a measured residual (A-SC-14) ----
--
-- Two objects in the change set are internal IDENTITY RESOLVERS: given one
-- opaque internal identifier they return another. They carry NO
-- offering-derived content -- no title, price, date, capacity, inventory
-- or visibility -- and are therefore outside the class this issue governs
-- on the PAYLOAD test. The investigation's closure derivation captured
-- them because it tested REACHABILITY of offering data; the discriminator
-- it was missing is PAYLOAD.
--
-- They receive NO CHANGE OF ANY KIND here -- not their bodies, not their
-- grants -- and that exclusion is itself measured, per rung:
--   R-1 visibility gate : FORBIDDEN. Their consumers ARE the authorisation
--       layer -- row-level-security policy expressions across several
--       tables plus a write-path trigger. Gating them converts "this
--       offering is not public" into "you are not its organiser": an
--       organiser acting on their OWN non-public offering goes from 2
--       readable rows to 0, effective rank 60 to 0, manager predicate true
--       to false, and THEIR OWN WRITE FROM 2 AFFECTED ROWS TO 0, SILENTLY,
--       with no denial and no raise. Nothing anywhere reports that.
--   R-2 EXECUTE-narrowing : LARGER OUTAGE, opposite direction. Policy
--       expressions are evaluated with the CALLER's privileges, so
--       narrowing raises `permission denied for function` INSIDE THE
--       POLICIES for every signed-in caller across all dependent tables --
--       including a plain buyer reading their own record.
--   R-3 authorisation arm : measures clean, but buys nothing the payload
--       test does not already give, and would add risk to several policies
--       and a write-path trigger for no content benefit. Adopting it on
--       these two is explicitly out of contract (Amendment 2 (c)).
--
-- A-SC-14 RESIDUAL, MEASURED AND RECORDED so the bottom rung cannot become
-- a way to do nothing quietly: an unauthenticated caller, and a signed-in
-- stranger, holding one opaque internal identifier can still obtain the
-- corresponding opaque internal identifier, at every visibility state. NO
-- offering-derived content is reachable through them.
-- Linked follow-up issue: #2126.
-- The suite asserts this residual in BOTH directions -- a residual that
-- does not match what the probe returns reds either way, so the record
-- cannot be written from belief.
--
-- ---- Registered separately; deliberately NOT folded in ----
--   * The five stale allowlist entries, one of which differs from its live
--     object only in ARITY (the live form takes one argument more), which
--     is why the shipped gate's reverse-drift check warns while its
--     forward check stays green. Hygiene, not correctness.
--   * The payment-method CHECK mismatch: a helper tests for a
--     payment-method value that the table's own CHECK constraint does not
--     permit, so the branch it guards can never be taken for that value.
--     Re-confirmed from the catalog during this implementation. A
--     correctness defect INDEPENDENT of visibility.
--   * Whether a write reached through a privileged caller should consult
--     visibility.
-- ---------------------------------------------------------------------

COMMIT;

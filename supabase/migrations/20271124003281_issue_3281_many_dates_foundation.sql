-- issue #3281 many-dates foundation (PR 1 + PR 3 server).
-- Additive checkout-bundle keys, schedule helper, override persistence.
-- BEFORE MERGE: apply on production (Seth migration chat). Money-adjacent reader.

BEGIN;

-- ---------------------------------------------------------------------------
-- Schedule helper (service_role): next upcoming occurrence + count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3281_event_schedule(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_next_start timestamptz;
  v_next_end timestamptz;
  v_upcoming integer := 0;
BEGIN
  SELECT count(*)::integer
    INTO v_upcoming
    FROM public.event_dates d
   WHERE d.event_id = p_event_id
     AND d.end_at > now();

  SELECT d.start_at, d.end_at
    INTO v_next_start, v_next_end
    FROM public.event_dates d
   WHERE d.event_id = p_event_id
     AND d.end_at > now()
   ORDER BY d.start_at, d.id
   LIMIT 1;

  RETURN jsonb_build_object(
    'nextStartAt', v_next_start,
    'nextEndAt', v_next_end,
    'upcomingCount', COALESCE(v_upcoming, 0),
    'scheduleLine', CASE
      WHEN v_upcoming IS NULL OR v_upcoming = 0 THEN NULL
      WHEN v_upcoming = 1 THEN to_char(v_next_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ELSE format('%s upcoming dates', v_upcoming)
    END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_event_schedule(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_event_schedule(uuid)
  TO service_role;

COMMENT ON FUNCTION public.issue_3281_event_schedule(uuid) IS
  'issue #3281 many-dates — next upcoming occurrence + count for cards/bundle.';


CREATE OR REPLACE FUNCTION public.pg_direct_event_checkout_bundle(p_event_id uuid DEFAULT NULL::uuid, p_brand_slug text DEFAULT NULL::text, p_event_slug text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
      -- issue #2160 DELTA 1 of 3. See the note above the appended keys.
      e.is_multi_date,
      e.is_recurring,
      e.multi_date_pricing_mode,
      e.refund_policy,
      -- issue #3313 — the stored rule, and the one day-choice predicate.
      e.recurrence_rules,
      public.issue_3313_event_day_choice(e.id) AS day_choice,
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
      -- issue #3314 — the organiser's "Hide remaining count", read from the raw
      -- row (theme.business_event.settings), never from the public_theme above:
      -- a later tightening of that sanitiser must not quietly turn this into
      -- "show". Resolved to a boolean on the output key below.
      e.theme #>> '{business_event,settings,hideRemainingCount}' AS hide_remaining_count_setting,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.address       AS brand_address,
      b.cover_media_url AS brand_cover_media_url,
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
    WHERE (
      (p_event_id IS NOT NULL AND p_brand_slug IS NULL AND p_event_slug IS NULL AND e.id = p_event_id)
      OR
      (p_event_id IS NULL
       AND NULLIF(pg_catalog.btrim(p_brand_slug), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(p_event_slug), '') IS NOT NULL
       AND b.slug = p_brand_slug
       AND e.slug = p_event_slug)
    )
      AND e.event_type = 'event'
      -- issue #2160 DELTA 2 of 3 — WITHDRAWN. The literal predicate STAYS.
      --
      -- This clause was briefly `pg_offering_visibility_gate(e.visibility,
      -- e.deleted_at, 'direct')`, to make the SPEC's demanded end state
      -- (T-14 / I-PROPOSED-2117-ONE-OFFERING-VISIBILITY-GATE) true — the SPEC
      -- asserted the gate was ALREADY here and it was not. The substitution was
      -- behaviour-identical and proved so. It is withdrawn anyway, because it
      -- is STRUCTURALLY UNAVAILABLE to any migration that lands after #2117:
      --
      --   The #2117 offering-visibility-gate workflow under `.github/workflows/`
      --   (filename ends `issue-2117-offering-visibility-gate-tests`; the
      --   extension is omitted ON PURPOSE — `validate-manifest-v2.mjs:796`
      --   discovers CI dependencies by scanning EVERY non-workflow file for
      --   `/[A-Za-z0-9_.-]+\.ya?ml/`, comments included, so spelling it in full
      --   here registers this migration as a consumer of that workflow and
      --   drifts the reference inventory. It failed exactly that way in CI.
      --   This file is not a consumer of it; it only explains a decision.)
      --   applies THE WHOLE CHAIN EXCEPT #2117, captures the A-SC-9 baseline,
      --   then applies #2117. Calling the gate makes this file fail phase 1
      --   with "function public.pg_offering_visibility_gate(...) does not
      --   exist" — a `LANGUAGE sql` body is validated at CREATE time. Moving
      --   this file to phase 2 fixes that and then fails A-SC-9(a), because
      --   §H's `authenticated` grant is no longer in the BEFORE snapshot and
      --   is reported as having "arrived" with #2117.
      --
      -- Both constraints cannot hold at once, so the gate is not reusable by
      -- anything downstream of it until that lane's baseline capture is
      -- restructured. That is #2117's own decision to make, not this issue's,
      -- and it is recorded in the implementation report rather than worked
      -- around here: a payment-adjacent public reader is the wrong place to
      -- carry a CI-shaped compromise.
      --
      -- The literal below is what #1929/#1931 shipped and is byte-identical to
      -- what the gate would have returned for audience 'direct'.
      AND e.visibility IN ('public'::text, 'hidden'::text)
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
      -- issue #2462 — THE ORGANISER'S PURCHASE RULES. Absent from this reader
      -- since #1929, which is why `directBundleTicketToStub` fabricated
      -- `minPurchaseQty: 1, maxPurchaseQty: null, allowTransfers: true`: it had
      -- nothing to map. The server has always enforced them, so the cart let a
      -- guest pick a quantity the RPC then refused with
      -- `ticket_quantity_above_max` -> "Nothing was reserved - please try again",
      -- a permanent dead end. DELETE THESE THREE LINES and that returns.
      tt.min_purchase_qty,
      tt.max_purchase_qty,
      tt.allow_transfers,
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
        -- issue #3313 — per-night capacity: the most places any UPCOMING night
        -- still has, from the same per-night counter the checkout guard reads
        -- (ONE OWNER FOR CAPACITY). "Sold out" only when every night is full.
        WHEN COALESCE((ev.day_choice ->> 'perOccurrenceCapacity')::boolean, false)
             AND EXISTS (
               SELECT 1 FROM public.event_dates d
                WHERE d.event_id = ev.id AND d.end_at > now()
             )
          THEN (
            SELECT GREATEST(0, MAX(
                     tt.quantity_total
                     - public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                   ))
              FROM public.event_dates d
             WHERE d.event_id = ev.id AND d.end_at > now()
          )
        ELSE GREATEST(
          0,
          tt.quantity_total
            -- issue #2491 C2 step 4 — the same switch as the guard, on the READ
            -- path. This subquery ran once per ticket type PER PAGE VIEW, and at
            -- 100k sold that is ~18.7 ms of database time for every person merely
            -- LOOKING at the event. Page views arrive before reservations and
            -- outnumber them, so this is the larger volume problem of the two.
            -- Switched to the same column the guard now reads, so the advertised
            -- number and the enforced number remain ONE OWNER FOR CAPACITY (#2462).
            - COALESCE(tt.sold_count, 0)
            -- issue #2462 — IN-FLIGHT HOLDS COUNT. This subtrahend is byte-for-byte
            -- the `v_reserved` the capacity guard in
            -- issue_1930_ticket_checkout_create_session_base already applies. Without
            -- it the page advertises stock the server has committed: measured on
            -- production, 5 concurrent holds moved the guard by 5 and moved this
            -- number by 0 (229 -> 229). At low traffic v_reserved is ~0 so the two
            -- agree and the divergence is invisible; under load the guest reads
            -- "N available" and is refused as sold out. ONE OWNER FOR CAPACITY.
            - COALESCE((
                SELECT SUM(i.quantity)::integer
                FROM public.ticket_checkout_session_items i
                JOIN public.ticket_checkout_sessions s
                  ON s.id = i.checkout_session_id
                WHERE i.ticket_type_id = tt.id
                  AND s.expires_at > now()
                  AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
              ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE pg_catalog.json_build_object(
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
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.location_geo::public.geometry),
          'lng', public.ST_X(ev.location_geo::public.geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.city_geo),
          'lng', public.ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
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
      'brand', pg_catalog.json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'address', ev.brand_address,
        'coverMediaUrl', ev.brand_cover_media_url,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      'tickets', COALESCE((
        SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
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
          'displayOrder', tix.display_order,
          -- issue #2462 — APPENDED LAST so CREATE OR REPLACE preserves every
          -- pre-existing key name and order (house rule, …1931…:735-740).
          'minPurchaseQty', tix.min_purchase_qty,
          'maxPurchaseQty', tix.max_purchase_qty,
          'allowTransfers', tix.allow_transfers
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json),
      -- ══ issue #2160 DELTA 3 of 3 — APPENDED LAST ═══════════════════════
      -- Appended after every pre-existing key so CREATE OR REPLACE preserves
      -- each existing key's name AND order (the house rule at …1931…:735-740).
      --
      -- `occurrences` (SPEC §F / D-4, closes #2161). The occurrence list now
      -- travels on the SAME SECURITY DEFINER reader that served the event, so
      -- ONE authority decides who may see this event and its schedule. The
      -- direct `.from("event_dates")` read in publicEventOccurrencesService is
      -- deleted in the same change: a guest surface must never read that table
      -- again (I-PROPOSED-2160-D). Costs zero extra round trips.
      --
      -- NO `ticketsRemaining` KEY, DELIBERATELY. `event_dates` has no capacity
      -- column and capacity is authored event-level on ticket_types.quantity_
      -- total, so there is no honest per-day remaining. Stamping the
      -- event-level number onto each day would claim per-day availability that
      -- does not exist (Constitution #9).
      'occurrences', (
        SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object(
                 'id',        d.id,
                 'startAt',   d.start_at,
                 'endAt',     d.end_at,
                 'timezone',  d.timezone,
                 'isMaster',  d.is_master,
                 -- issue #3281 many-dates — APPENDED LAST on each occurrence
                 'soldOut', CASE
                   WHEN (CASE
                   WHEN ev.hide_remaining_count_setting IS NULL THEN false
                   WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')
                     THEN ev.hide_remaining_count_setting::boolean
                   ELSE true
                 END) THEN NULL
                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL
                   WHEN EXISTS (
                     SELECT 1 FROM public.ticket_types tt
                      WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                        AND COALESCE(tt.is_unlimited, false)
                   ) THEN NULL
                   ELSE COALESCE((
                     SELECT bool_and(
                       tt.quantity_total IS NOT NULL
                       AND public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                             >= tt.quantity_total
                     )
                     FROM public.ticket_types tt
                     WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND NOT COALESCE(tt.is_unlimited, false)
                   ), false)
                 END,
                 'placesLeft', CASE
                   WHEN (CASE
                   WHEN ev.hide_remaining_count_setting IS NULL THEN false
                   WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')
                     THEN ev.hide_remaining_count_setting::boolean
                   ELSE true
                 END) THEN NULL
                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL
                   WHEN EXISTS (
                     SELECT 1 FROM public.ticket_types tt
                      WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                        AND COALESCE(tt.is_unlimited, false)
                   ) THEN NULL
                   ELSE (
                     SELECT GREATEST(0, SUM(
                       GREATEST(0,
                         tt.quantity_total
                         - public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                       )
                     ))
                     FROM public.ticket_types tt
                     WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND NOT COALESCE(tt.is_unlimited, false)
                       AND tt.quantity_total IS NOT NULL
                   )
                 END,
                 'placesLeftByTicket', CASE
                   WHEN (CASE
                   WHEN ev.hide_remaining_count_setting IS NULL THEN false
                   WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')
                     THEN ev.hide_remaining_count_setting::boolean
                   ELSE true
                 END) THEN NULL
                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL
                   WHEN EXISTS (
                     SELECT 1 FROM public.ticket_types tt
                      WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                        AND COALESCE(tt.is_unlimited, false)
                   ) THEN NULL
                   ELSE (
                     SELECT COALESCE(pg_catalog.json_object_agg(
                       tt.id::text,
                       GREATEST(0,
                         tt.quantity_total
                         - public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                       )
                     ), '{}'::json)
                     FROM public.ticket_types tt
                     WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL
                       AND NOT COALESCE(tt.is_unlimited, false)
                       AND tt.quantity_total IS NOT NULL
                   )
                 END,
                 'overrideTitle', d.override_title,
                 'overrideLocation', d.override_location
               ) ORDER BY d.start_at, d.id), '[]'::json)
          FROM public.event_dates d
         WHERE d.event_id = ev.id
           -- issue #3313 — a recurring event offers only nights still ahead,
           -- which keeps `isMultiDate === (occurrences.length > 1)` true (the
           -- shipped native shape check). Multi-date events are unchanged
           -- (do NOT filter ended multi-date rows — F5 / many-dates picker).
           AND (NOT (COALESCE(ev.is_recurring, false) AND NOT COALESCE(ev.is_multi_date, false))
                OR d.end_at > now())
      ),
      -- THE MULTI-DATE SIGNAL. Without these two keys the day chooser is
      -- UNREACHABLE, and it was: `detailFromDirectBundle` hard-codes
      -- `is_multi_date: false`, this bundle is the FIRST reader consulted by
      -- both getPublicEventBySlug and getPublicEventById, and the bundle
      -- carried no multi-date key — so `asWhenMode` resolved every
      -- bundle-served ticketed event to 'single' and #2135's chooser never
      -- mounted, on PUBLIC events as well as unlisted ones. #2161 diagnosed
      -- this as "works for public, silently empty for unlisted"; measured on
      -- the full migration chain, it worked for neither. See the
      -- implementation report.
      --
      -- `isRecurring` rides along because the gate is `multi_date` ONLY —
      -- deriving multi-date from `occurrences.length > 1` would sweep in
      -- recurring events, which #2145 keeps out of scope.
      -- issue #3313 — `isMultiDate` now means "the guest must pick a day":
      -- unchanged for multi-date events, and true for a recurring event while
      -- more than one night is ahead. Every shipped client already mounts the
      -- day chooser from this key, so recurring events get it with no release.
      'isMultiDate', COALESCE((ev.day_choice ->> 'requiresChoice')::boolean, false),
      'isRecurring', COALESCE(ev.is_recurring, false),
      -- The organiser's pricing choice, so the page can say "per day" or
      -- "for all days" BEFORE the guest sees a total (amendment §7).
      'multiDatePricingMode', COALESCE(ev.multi_date_pricing_mode, 'per_day'),
      -- issue #3314 — the organiser's "Hide remaining count", so a guest page can
      -- decide from the SAME reader that served the event, public or unlisted.
      -- The social-proof read that carried it before answers for public events
      -- only, so an unlisted page could never learn the count was allowed.
      -- Same value as pg_public_social_proof: absent or JSON null is false (the
      -- organiser never turned it on). A value that is not a boolean, which
      -- makes that read raise, is true here: fail closed without breaking the page.
      -- Placed BEFORE recurrenceRule, not last: #3284's contract keeps
      -- recurrenceRule then refundPolicy as the final two keys.
      'hideRemainingCount', CASE
        WHEN ev.hide_remaining_count_setting IS NULL THEN false
        WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')
          THEN ev.hide_remaining_count_setting::boolean
        ELSE true
      END,
      -- issue #3313 — APPENDED LAST. The stored repeat rule, so the public page
      -- can say "Every Tuesday" over the real dates instead of "Recurring
      -- (incomplete)".
      'recurrenceRule', CASE
        WHEN COALESCE(ev.is_recurring, false) AND jsonb_typeof(ev.recurrence_rules) = 'object'
          THEN ev.recurrence_rules
        ELSE NULL
      END,
      'refundPolicy', ev.refund_policy,
      -- issue #3281 many-dates — APPENDED LAST (after #3284 refundPolicy).
      'allDaysPass', (
        COALESCE(ev.is_multi_date, false)
        AND NOT COALESCE(ev.is_recurring, false)
        AND COALESCE(ev.multi_date_pricing_mode, 'per_day') = 'all_days'
      ),
      'nextStartAt', (public.issue_3281_event_schedule(ev.id) ->> 'nextStartAt')::timestamptz,
      'nextEndAt', (public.issue_3281_event_schedule(ev.id) ->> 'nextEndAt')::timestamptz,
      'upcomingCount', COALESCE((public.issue_3281_event_schedule(ev.id) ->> 'upcomingCount')::integer, 0)
    ) END
  FROM ev;
$function$;

-- ---------------------------------------------------------------------------
-- Recurring / live: set one date's title + location (Host Dates editor).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_set_event_date_override(
  p_event_id uuid,
  p_event_date_id uuid,
  p_title text,
  p_location text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_brand uuid;
  v_title text;
  v_location text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(btrim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'invalid_edit_reason';
  END IF;

  SELECT e.brand_id INTO v_brand
    FROM public.events e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF public.biz_brand_effective_rank(v_brand, v_uid)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_dates d
     WHERE d.id = p_event_date_id AND d.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'occurrence_not_found';
  END IF;

  v_title := NULLIF(left(btrim(COALESCE(p_title, '')), 120), '');
  v_location := NULLIF(left(btrim(COALESCE(p_location, '')), 120), '');

  UPDATE public.event_dates
     SET override_title = v_title,
         override_location = v_location
   WHERE id = p_event_date_id;

  RETURN jsonb_build_object(
    'ok', true,
    'eventDateId', p_event_date_id,
    'overrideTitle', v_title,
    'overrideLocation', v_location
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_set_event_date_override(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_set_event_date_override(uuid, uuid, text, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.business_publish_event_draft(p_event_id uuid, p_draft_payload jsonb, p_client_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_theme jsonb;
  v_business_draft jsonb;
  v_tickets jsonb;
  v_ticket jsonb;
  v_title text;
  v_description text;
  v_location_text text;
  v_online_url text;
  v_cover_media_url text;
  v_cover_media_type text;
  v_cover_media_poster_url text;
  v_keep_cover boolean; -- #3439: resolve under the existing event row lock
  v_cover_media_provider text;
  v_cover_media_source_url text;
  v_cover_media_credit text;
  v_cover_media_credit_url text;
  v_cover_media_alt text;
  v_cover_media_gallery jsonb;  -- issue #868 (additive, independent)
  v_timezone text;
  v_visibility text;
  v_currency char(3);
  v_price numeric;
  v_base_slug text;
  v_final_slug text;
  v_suffix integer := 2;
  v_now timestamptz := now();
  v_ticket_rows jsonb;
  v_event_dates_rows jsonb;
  v_when_mode text;
  v_when jsonb;
  v_multi_dates jsonb;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_start timestamptz;
  v_end timestamptz;
  v_date_entry jsonb;
  v_min_start timestamptz;
  -- ORCH-0824: new locals for taxonomy + city.
  v_city text;
  v_format text;   -- issue #2333
  -- issue #1653 — the wizard's pin was collected and then discarded at publish.
  v_location_geo point;
  v_coordinate_precision text;
  v_party_types text[];
  v_vibe_tags text[];
  v_music_genres text[];
  -- ORCH-1075: paid-publish guard locals.
  v_paid_online boolean;
  v_max_end timestamptz;
  -- issue #1014: money-bearing predicate (BROADER than v_paid_online — no
  -- availableAt filter, no isFree shortcut: a paid DOOR ticket has no Stripe
  -- requirement but DOES display money and therefore requires a currency).
  v_money_bearing boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;

  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_draft_deleted';
  END IF;

  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_event.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_theme := COALESCE(p_draft_payload->'theme', '{}'::jsonb);
  v_business_draft := COALESCE(v_theme->'business_draft', '{}'::jsonb);
  v_tickets := COALESCE(v_business_draft->'tickets', '[]'::jsonb);
  -- issue #1014 delta (1): the 'GBP' fabrication is REMOVED — v_currency may
  -- now be NULL (currency-less brand, no draft override). Trigger (c) is
  -- authoritative: it stamps a resolvable brand currency or NULLs a free-only
  -- publish; the explicit gate below fail-closes money-bearing publishes.
  v_currency := upper(COALESCE(
    NULLIF(v_business_draft->>'currency', ''),
    NULLIF(p_draft_payload->>'currency', ''),
    v_brand.default_currency::text
  ))::char(3);

  -- issue #1014 delta (2): whitelist gains NGN (NG Paystack brands stamp
  -- brands.default_currency='NGN' at onboard) and runs only for a known
  -- currency — NULL means "no currency yet", not "unsupported currency".
  -- issue #3645: public.supported_brand_currencies owns the list; this
  -- function asks the shared helper and carries no list of its own.
  IF v_currency IS NOT NULL
     AND NOT public.is_supported_offering_currency(v_currency::text) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;

  v_title := NULLIF(btrim(COALESCE(p_draft_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'event_title_required';
  END IF;

  IF jsonb_typeof(v_tickets) IS DISTINCT FROM 'array' OR jsonb_array_length(v_tickets) = 0 THEN
    RAISE EXCEPTION 'event_ticket_required';
  END IF;

  FOR v_ticket IN SELECT value FROM jsonb_array_elements(v_tickets)
  LOOP
    IF NULLIF(btrim(COALESCE(v_ticket->>'name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'ticket_name_required';
    END IF;

    v_price := COALESCE(
      NULLIF(v_ticket->>'priceMajor', '')::numeric,
      NULLIF(v_ticket->>'price', '')::numeric,
      NULLIF(v_ticket->>'priceGbp', '')::numeric,
      0
    );

    IF COALESCE((v_ticket->>'isFree')::boolean, false) = true THEN
      IF v_price <> 0 THEN
        RAISE EXCEPTION 'free_ticket_price_must_be_zero';
      END IF;
    ELSE
      IF v_price < 0 THEN
        RAISE EXCEPTION 'ticket_price_cannot_be_negative';
      END IF;
    END IF;
    IF COALESCE((v_ticket->>'isUnlimited')::boolean, false) = false
      AND COALESCE((v_ticket->>'capacity')::integer, 0) <= 0
    THEN
      RAISE EXCEPTION 'ticket_capacity_required';
    END IF;
    IF NULLIF(COALESCE(v_ticket->>'password', ''), '') IS NOT NULL THEN
      RAISE EXCEPTION 'ticket_plaintext_password_forbidden';
    END IF;
  END LOOP;

  -- ORCH-0824: read new taxonomy + city fields and validate.
  v_city := NULLIF(btrim(COALESCE(v_business_draft->>'city', '')), '');
  v_format := lower(NULLIF(btrim(COALESCE(v_business_draft->>'format', '')), ''));
  v_party_types := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'partyTypes', '[]'::jsonb))),
    ARRAY[]::text[]
  );
  v_vibe_tags := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'vibeTags', '[]'::jsonb))),
    ARRAY[]::text[]
  );
  v_music_genres := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'musicGenres', '[]'::jsonb))),
    ARRAY[]::text[]
  );

  -- issue #2333 — an ONLINE-ONLY event has no city and the wizard renders no
  -- field that could set one (CreatorStep3Where.tsx:138-140 gates the ONLY
  -- writer of city behind in_person|hybrid), so demanding one here made every
  -- online publish impossible while the client said "Ready to publish".
  -- Keyed on business_draft.format, the SAME node v_city is read from, and NOT
  -- on p_draft_payload.is_online — is_online is TRUE for HYBRID too
  -- (serverDraftEventMapper.ts:708), and hybrid genuinely has a city that
  -- validateWhere:382-406 requires. Absent/unknown format FAILS CLOSED.
  IF v_city IS NULL AND v_format IS DISTINCT FROM 'online' THEN
    RAISE EXCEPTION 'city_required';
  END IF;

  IF array_length(v_party_types, 1) IS NULL THEN
    RAISE EXCEPTION 'party_types_required';
  END IF;

  IF NOT (v_party_types <@ ARRAY[
    'birthday-party','rooftop-party','club-night','house-party','warehouse-party',
    'beach-party','pool-party','boat-party','themed-party','corporate-event',
    'graduation-party','holiday-party','networking-event','rave','festival'
  ]::text[]) THEN
    RAISE EXCEPTION 'party_types_not_canonical';
  END IF;

  IF NOT (v_vibe_tags <@ ARRAY[
    'energetic','chill','intimate','wild','classy','casual','upscale','underground',
    'mainstream','artsy','social','exclusive','laid-back','vibrant','retro','futuristic'
  ]::text[]) THEN
    RAISE EXCEPTION 'vibe_tags_not_canonical';
  END IF;

  IF NOT (v_music_genres <@ ARRAY[
    'electronic-edm','house','hiphop-rap','pop','rock','latin','afrobeats',
    'afro-house','amapiano','gospel','rnb-soul','disco-funk','reggae-dancehall',
    'indie','country','jazz','classical','mixed-variety'
  ]::text[]) THEN
    RAISE EXCEPTION 'music_genres_not_canonical';
  END IF;

  v_visibility := CASE COALESCE(v_business_draft->>'requestedVisibility', 'public')
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    ELSE 'public'
  END;

  -- #1931 Amendment 1 §3 / Amendment 3 §5 released item 6 — the legacy-Private-draft
  -- publish block. This is the AUTHORITATIVE half: the client hook blocks too, but
  -- deleting the client block cannot admit a Private publish because this raises.
  --
  -- It is evaluated BEFORE any write, so a denied publish mutates nothing.
  --
  -- DELIBERATE, CONTRACT-MANDATED BEHAVIOUR CHANGE AT READINESS FALSE, and the only one
  -- in the released set. Today this function publishes visibility='private' UNGUARDED,
  -- which creates an offering no guest has a working access path to — the exact defect
  -- #1931 is named after. Amendment 1 §3 requires the server to "independently return
  -- typed private_access_not_ready", and Amendment 3 §5 frozen item 2 freezes anything
  -- that PERMITS Private publication. Non-private publishes are bit-identical.
  IF v_visibility = 'private' AND NOT public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'private_access_not_ready';
  END IF;

  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' OR v_base_slug LIKE 'draft-%' THEN
    v_base_slug := 'event';
  END IF;
  v_final_slug := v_base_slug;

  WHILE EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id = v_event.brand_id
      AND e.deleted_at IS NULL
      AND e.id <> p_event_id
      AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  v_description := NULLIF(p_draft_payload->>'description', '');
  v_location_text := NULLIF(p_draft_payload->>'location_text', '');

  -- issue #1653 — promote the coordinate the wizard already captured. Mirrors
  -- business_patch_event_taxonomy exactly, including point(LNG, LAT) argument
  -- order. When the payload carries no coordinate we KEEP whatever the row
  -- already holds, so publishing can never erase a pin a later edit set.
  IF (p_draft_payload->'locationGeo'->>'lat') IS NOT NULL
     AND (p_draft_payload->'locationGeo'->>'lng') IS NOT NULL THEN
    v_location_geo := point(
      (p_draft_payload->'locationGeo'->>'lng')::double precision,
      (p_draft_payload->'locationGeo'->>'lat')::double precision
    );
    -- Normalise the token so the coordinate_precision CHECK only ever sees
    -- 'exact' | 'approximate' | NULL — a stale client cannot break publish.
    v_coordinate_precision := NULLIF(
      btrim(COALESCE(p_draft_payload->>'coordinatePrecision', '')), ''
    );
    IF v_coordinate_precision NOT IN ('exact', 'approximate') THEN
      v_coordinate_precision := NULL;
    END IF;
  ELSE
    SELECT e.location_geo, e.coordinate_precision
      INTO v_location_geo, v_coordinate_precision
      FROM public.events e WHERE e.id = p_event_id;
  END IF;
  v_online_url := NULLIF(p_draft_payload->>'online_url', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_cover_media_provider := NULLIF(p_draft_payload->>'cover_media_provider', '');
  v_cover_media_source_url := NULLIF(p_draft_payload->>'cover_media_source_url', '');
  v_cover_media_credit := NULLIF(p_draft_payload->>'cover_media_credit', '');
  v_cover_media_credit_url := NULLIF(p_draft_payload->>'cover_media_credit_url', '');
  v_cover_media_alt := NULLIF(p_draft_payload->>'cover_media_alt', '');
  -- #3439: validate explicit input exactly as the poster wrapper did, then
  -- resolve all cover fields together against the locked row. Validation must
  -- not disappear when a stale URL is protected.
  v_cover_media_poster_url := COALESCE(NULLIF(p_draft_payload->>'cover_media_poster_url', ''),
    CASE WHEN v_cover_media_type = 'image' THEN v_cover_media_url END);
  PERFORM public.assert_cover_media_triplet(
    v_cover_media_url, v_cover_media_type, v_cover_media_poster_url);
  v_keep_cover := (CASE WHEN p_draft_payload ? '__coverBase' THEN
      v_cover_media_url IS NOT DISTINCT FROM NULLIF(p_draft_payload->>'__coverBase','')
      AND v_event.cover_media_url IS DISTINCT FROM NULLIF(p_draft_payload->>'__coverBase','')
    ELSE
      v_event.cover_media_url IS NOT NULL
      AND v_cover_media_url IS DISTINCT FROM v_event.cover_media_url
      AND EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
        WHERE j.event_id = p_event_id AND j.target_kind = 'event'
          AND j.apply_mode = 'draft_auto' AND j.status = 'applied'
          AND j.processed_url = v_event.cover_media_url
          AND j.applied_at >= v_event.updated_at)
    END);
  IF v_keep_cover THEN
    v_cover_media_url := v_event.cover_media_url;
    v_cover_media_type := v_event.cover_media_type;
    v_cover_media_poster_url := v_event.cover_media_poster_url;
    v_cover_media_provider := v_event.cover_media_provider;
    v_cover_media_source_url := v_event.cover_media_source_url;
    v_cover_media_credit := v_event.cover_media_credit;
    v_cover_media_credit_url := v_event.cover_media_credit_url;
    v_cover_media_alt := v_event.cover_media_alt;
  END IF;
  PERFORM public.assert_cover_media_triplet(
    v_cover_media_url, v_cover_media_type, v_cover_media_poster_url);
  -- issue #868 — ADDITIVE + INDEPENDENT: read the extra-photos gallery; it is
  -- NOT nulled when the cover url is absent (a photo gallery coexists with any
  -- cover, incl. a video cover). Default [] preserves single-cover behavior.
  -- issue #3288 — an ABSENT key keeps the stored gallery; a PRESENT key
  -- (including an explicit []) is written exactly as before.
  v_cover_media_gallery := CASE WHEN p_draft_payload ? 'cover_media_gallery'
    THEN COALESCE(p_draft_payload->'cover_media_gallery', '[]'::jsonb)
    ELSE COALESCE(v_event.cover_media_gallery, '[]'::jsonb) END;
  IF v_cover_media_url IS NULL THEN
    v_cover_media_type := NULL;
    v_cover_media_provider := NULL;
    v_cover_media_source_url := NULL;
    v_cover_media_credit := NULL;
    v_cover_media_credit_url := NULL;
    v_cover_media_alt := NULL;
  END IF;
  v_timezone := COALESCE(NULLIF(p_draft_payload->>'timezone', ''), v_event.timezone, 'UTC');

  v_when_mode := COALESCE(NULLIF(v_business_draft->>'whenMode', ''), 'single');
  v_when := v_business_draft->'when';
  v_multi_dates := v_business_draft->'multiDates';

  IF v_when_mode NOT IN ('single', 'multi_date', 'recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  DELETE FROM public.event_dates WHERE event_id = p_event_id;

  IF v_when_mode IN ('single', 'recurring') THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_start, v_end, v_timezone, true);

    -- issue #3313 — A RECURRING EVENT GETS EVERY DATE ITS RULE DESCRIBES.
    -- This branch used to stop at the master row above, so "every Tuesday, 8
    -- times" published ONE Tuesday: the rule was only copied onto the event
    -- row. The #1138 expander (52-date cap, master = date #1, same local start
    -- time and length) has always been type-agnostic; experiences called it and
    -- events never did. The rule expanded is the SAME value written to
    -- events.recurrence_rules below, so the stored rule and the dates cannot
    -- disagree. DELETE THIS BLOCK and a recurring event sells one night only.
    IF v_when_mode = 'recurring'
       AND jsonb_typeof(p_draft_payload->'recurrence_rules') = 'object' THEN
      PERFORM public.pg_expand_experience_recurrence(
        p_event_id, v_start, v_end, p_draft_payload->'recurrence_rules', v_timezone
      );
    END IF;

  ELSIF v_when_mode = 'multi_date' THEN
    IF v_multi_dates IS NULL
      OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_multi_dates) = 0
    THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    SELECT min(
      (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp AT TIME ZONE v_timezone
    )
    INTO v_min_start
    FROM jsonb_array_elements(v_multi_dates) entry
    WHERE NULLIF(entry->>'date', '') IS NOT NULL;

    IF v_min_start IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
    LOOP
      v_date_iso := NULLIF(v_date_entry->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
      v_ends := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      INSERT INTO public.event_dates (
        event_id, start_at, end_at, timezone, is_master,
        override_title, override_location
      ) VALUES (
        p_event_id, v_start, v_end, v_timezone, v_start = v_min_start,
        NULLIF(left(btrim(COALESCE(
          v_date_entry #>> '{overrides,title}',
          v_date_entry->>'overrideTitle',
          ''
        )), 120), ''),
        NULLIF(left(btrim(COALESCE(
          v_date_entry #>> '{overrides,venueName}',
          v_date_entry->>'overrideLocation',
          ''
        )), 120), '')
      );
    END LOOP;
  END IF;

  -- ORCH-1075 paid-publish integrity guards (event publish path) ---------
  -- PAID = a ticket about to be written that is online-sellable
  -- (availableAt in ('online','both')) AND has price_cents > 0. In-person-only
  -- paid tickets (availableAt='door') and FREE tickets are exempt: they cannot
  -- reach the buyer-web/native checkout 409, so Guard A is N/A (operator-confirmed
  -- 2026-06-04). Mirror the checkout readiness predicate + reject past-dated paid
  -- publishes BEFORE the status flips to scheduled.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  SELECT bool_or(
           COALESCE((t->>'availableAt'), 'both') IN ('online', 'both')
           AND NOT COALESCE((t->>'isFree')::boolean, false)
           AND round(
                 COALESCE(
                   NULLIF(t->>'priceMajor', '')::numeric,
                   NULLIF(t->>'price', '')::numeric,
                   NULLIF(t->>'priceGbp', '')::numeric,
                   0
                 ) * 100
               ) > 0
         )
    INTO v_paid_online
    FROM jsonb_array_elements(v_tickets) t;

  IF COALESCE(v_paid_online, false) THEN
    -- Collection + past-date stay online-only (door money cannot hit checkout 409).
    IF NOT public.pg_brand_can_collect(v_event.brand_id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RAISE EXCEPTION 'stripe_charges_disabled';
    END IF;
    SELECT max(ed.end_at) INTO v_max_end
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  -- issue #1014 deltas (3)+(4) — money-bearing predicate + explicit currency
  -- gate, grouped with the ORCH-1075 guards (before the events write). ANY
  -- ticket priced > 0 (online OR door, isFree flag irrelevant — price is
  -- truth) makes the publish money-bearing; money without a resolvable
  -- currency fails close HERE for error locality (the trigger remains the
  -- backstop for undeclared paths).
  SELECT bool_or(
           round(
             COALESCE(
               NULLIF(t->>'priceMajor', '')::numeric,
               NULLIF(t->>'price', '')::numeric,
               NULLIF(t->>'priceGbp', '')::numeric,
               0
             ) * 100
           ) > 0
         )
    INTO v_money_bearing
    FROM jsonb_array_elements(v_tickets) t;

  -- #3645 PR11d — Organiser Terms 1.0 on ANY money-bearing publish (door-only
  -- included). Matches the app gate (positive price, not online-only). Free
  -- path skips. Collection/date guards above stay online-only.
  IF COALESCE(v_money_bearing, false) THEN
    PERFORM public.biz_require_current_organiser_terms(v_event.brand_id);
  END IF;

  IF COALESCE(v_money_bearing, false) AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  -- issue #1014 delta (5): declare the moneyless transition to
  -- tg_require_event_brand_currency (transaction-scoped flag).
  IF NOT COALESCE(v_money_bearing, false) THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;

  -- ORCH-0824: write the four new top-level columns + strip taxonomy keys
  -- and deprecated 'category' from business_event JSONB so the same data
  -- is not stored in two places.
  UPDATE public.events
  SET
    title = v_title,
    description = v_description,
    slug = v_final_slug,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = v_cover_media_url,
    cover_media_type = v_cover_media_type,
    cover_media_poster_url = v_cover_media_poster_url,
    cover_media_provider = v_cover_media_provider,
    cover_media_source_url = v_cover_media_source_url,
    cover_media_credit = v_cover_media_credit,
    cover_media_credit_url = v_cover_media_credit_url,
    cover_media_alt = v_cover_media_alt,
    cover_media_gallery = v_cover_media_gallery,
    is_online = COALESCE((p_draft_payload->>'is_online')::boolean, false),
    is_recurring = COALESCE((p_draft_payload->>'is_recurring')::boolean, false),
    is_multi_date = COALESCE((p_draft_payload->>'is_multi_date')::boolean, false),
    recurrence_rules = p_draft_payload->'recurrence_rules',
    theme = (v_theme - 'business_draft') || jsonb_build_object(
      'business_event',
      (v_business_draft
        - 'tickets'
        - 'category'      -- ORCH-0824: deprecated; promoted to party_types column
        - 'partyTypes'    -- ORCH-0824: promoted to party_types column
        - 'vibeTags'      -- ORCH-0824: promoted to vibe_tags column
        - 'musicGenres'   -- ORCH-0824: promoted to music_genres column
        - 'city'          -- ORCH-0824: promoted to city column
        - 'locationGeo'   -- ORCH-0824: cached client-side only
      ) || jsonb_build_object('currency', v_currency::text),
      'coverHue',
      COALESCE(v_business_draft->'coverHue', v_theme->'coverHue', '25'::jsonb)
    ),
    currency = v_currency,
    status = 'scheduled',
    visibility = v_visibility,
    published_at = v_now,
    timezone = v_timezone,
    -- ORCH-0824: new top-level columns
    city = v_city,
    location_geo = v_location_geo,              -- issue #1653
    coordinate_precision = v_coordinate_precision,  -- issue #1653
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    updated_at = v_now
  WHERE id = p_event_id
    AND status = 'draft'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  UPDATE public.ticket_types
  SET deleted_at = v_now, updated_at = v_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL;

  FOR v_ticket IN SELECT value FROM jsonb_array_elements(v_tickets)
  LOOP
    v_price := COALESCE(
      NULLIF(v_ticket->>'priceMajor', '')::numeric,
      NULLIF(v_ticket->>'price', '')::numeric,
      NULLIF(v_ticket->>'priceGbp', '')::numeric,
      0
    );

    INSERT INTO public.ticket_types (
      event_id, name, description, price_cents, currency,
      quantity_total, is_unlimited, is_free,
      sale_start_at, sale_end_at,
      min_purchase_qty, max_purchase_qty,
      is_hidden, is_disabled, requires_approval, allow_transfers,
      password_protected, password_hash,
      available_online, available_in_person,
      waitlist_enabled, display_order, deleted_at
    ) VALUES (
      p_event_id,
      btrim(v_ticket->>'name'),
      NULLIF(v_ticket->>'description', ''),
      CASE
        WHEN COALESCE((v_ticket->>'isFree')::boolean, false) THEN 0
        ELSE round(v_price * 100)::integer
      END,
      v_currency,
      CASE
        WHEN COALESCE((v_ticket->>'isUnlimited')::boolean, false) THEN NULL
        ELSE COALESCE((v_ticket->>'capacity')::integer, 0)
      END,
      COALESCE((v_ticket->>'isUnlimited')::boolean, false),
      COALESCE((v_ticket->>'isFree')::boolean, false),
      NULLIF(v_ticket->>'saleStartAt', '')::timestamptz,
      NULLIF(v_ticket->>'saleEndAt', '')::timestamptz,
      COALESCE((v_ticket->>'minPurchaseQty')::integer, 1),
      NULLIF(v_ticket->>'maxPurchaseQty', '')::integer,
      COALESCE(v_ticket->>'visibility', 'public') = 'hidden',
      COALESCE(v_ticket->>'visibility', 'public') = 'disabled',
      COALESCE((v_ticket->>'approvalRequired')::boolean, false),
      COALESCE((v_ticket->>'allowTransfers')::boolean, true),
      COALESCE((v_ticket->>'passwordProtected')::boolean, false),
      NULL,
      COALESCE(v_ticket->>'availableAt', 'both') IN ('online', 'both'),
      COALESCE(v_ticket->>'availableAt', 'both') IN ('door', 'both'),
      COALESCE((v_ticket->>'waitlistEnabled')::boolean, false),
      COALESCE((v_ticket->>'displayOrder')::integer, 0),
      NULL
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'slug', v_brand.slug,
      'name', v_brand.name
    ),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows,
    'client_revision', p_client_revision
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_patch_event_when(p_event_id uuid, p_when_payload jsonb, p_reason text, p_client_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_now timestamptz := now();
  v_trimmed_reason text;
  v_reason_len integer;
  v_when_mode text;
  v_old_when_mode text;
  v_when jsonb;
  v_multi_dates jsonb;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_min_start timestamptz;
  v_date_entry jsonb;
  v_sold_count integer;
  v_old_recurrence jsonb;
  v_new_recurrence jsonb;
  v_old_master_dates date[];
  v_new_payload_dates date[];
  v_updated public.events%ROWTYPE;
  v_event_is_paid_online boolean; -- ORCH-1075: event currently online-paid?
  v_max_end timestamptz;          -- ORCH-1075: latest end_at after the patch
  -- #3285: reconcile state. Targets (t_*) are the payload occurrences; rows
  -- (e_*) are the event's existing event_dates, locked FOR UPDATE below.
  v_ack boolean;
  v_t_dates date[] := '{}'::date[];
  v_t_starts timestamptz[] := '{}'::timestamptz[];
  v_t_ends timestamptz[] := '{}'::timestamptz[];
  v_t_match uuid[] := '{}'::uuid[];
  v_n_t integer := 0;
  v_e_ids uuid[];
  v_e_starts timestamptz[];
  v_e_ends timestamptz[];
  v_e_days date[];
  v_e_matched boolean[];
  v_n_e integer := 0;
  v_i integer;
  v_j integer;
  v_cand integer;
  v_cand_count integer;
  v_t_on_day integer;
  v_e_on_day integer;
  v_removed uuid[] := '{}'::uuid[];
  v_hold text;
  v_master_id uuid;
  -- issue #3313: a recurring event's targets are every date of its rule.
  v_rule jsonb;
  v_cover_through timestamptz;
  v_occ record;
  v_persist_when_shape boolean;
BEGIN
  -- 1. Authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 2. Fetch + lock the events row (concurrent edit/publish protection)
  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- 3. Soft-delete guard
  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_deleted';
  END IF;

  -- 4. Status guard — only scheduled/live events are editable
  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'event_not_editable_status';
  END IF;

  -- 5. Permission — event_manager+ for the brand
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- #3285: lock the complete schedule before any guard reads it. A concurrent
  -- scan or mint takes FOR KEY SHARE on the date row it references, so it
  -- serialises behind this edit: the "held" check below cannot be raced by a
  -- success scan or a pass that commits between the check and the write.
  -- Mirrors business_unpublish_event_to_draft.
  PERFORM 1 FROM public.event_dates WHERE event_id = p_event_id ORDER BY id FOR UPDATE;


  -- 6. Reason validation (mirror publishedEventEditGuards.ts:26-32 — trim ∈ [10, 200])
  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'missing_edit_reason';
  END IF;
  v_trimmed_reason := btrim(p_reason);
  IF length(v_trimmed_reason) = 0 THEN
    RAISE EXCEPTION 'missing_edit_reason';
  END IF;
  v_reason_len := length(v_trimmed_reason);
  IF v_reason_len < 10 OR v_reason_len > 200 THEN
    RAISE EXCEPTION 'invalid_edit_reason';
  END IF;

  -- 7. Client revision check (NO-OP — events.client_revision column does
  --    not exist yet; param reserved for future optimistic-concurrency
  --    extension. Service still passes the param per SPEC §4.8 contract.)
  IF p_client_revision IS NOT NULL THEN
    -- Future: SELECT client_revision FROM events WHERE id = p_event_id;
    -- and raise stale_client_revision on mismatch. Currently a no-op.
    NULL;
  END IF;

  -- 8. whenMode validation
  v_when_mode := COALESCE(NULLIF(p_when_payload->>'whenMode', ''), 'single');
  v_when := p_when_payload->'when';
  v_multi_dates := p_when_payload->'multiDates';
  v_timezone := COALESCE(NULLIF(p_when_payload->>'timezone', ''), v_event.timezone, 'UTC');

  IF v_when_mode NOT IN ('single', 'multi_date', 'recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- 9. Buyer-protection (CONSERVATIVE) — block structural changes when sold>0
  SELECT count(*)::integer INTO v_sold_count
  FROM public.orders
  WHERE event_id = p_event_id
    AND payment_status IN ('paid', 'partial_refund');

  v_old_when_mode := CASE
    WHEN v_event.is_multi_date THEN 'multi_date'
    WHEN v_event.is_recurring THEN 'recurring'
    ELSE 'single'
  END;

  -- ORCH-1047 "Refund all & proceed": when the payload carries
  -- "acknowledgeSoldImpact": true (organiser chose to refund all buyers and
  -- change anyway), bypass every sold-ticket structural block below. Carried
  -- inside p_when_payload (not a new param) so this stays a CREATE OR REPLACE
  -- with no signature change / no DROP. Absent/false preserves the
  -- conservative refund-first behaviour for all other callers. The client only
  -- sets this true AFTER attempting to refund every order for the event.
  IF v_sold_count > 0 AND NOT COALESCE((p_when_payload->>'acknowledgeSoldImpact')::boolean, false) THEN
    -- Block whenMode change
    IF v_when_mode <> v_old_when_mode THEN
      RAISE EXCEPTION 'when_mode_drops_active_date';
    END IF;

    -- Block recurrenceRule structural change in recurring mode
    IF v_when_mode = 'recurring' THEN
      v_old_recurrence := v_event.recurrence_rules;
      v_new_recurrence := p_when_payload->'recurrenceRule';
      IF COALESCE(v_old_recurrence::text, '') <> COALESCE(v_new_recurrence::text, '') THEN
        RAISE EXCEPTION 'recurrence_drops_occurrence';
      END IF;
    END IF;

    -- Block multi-date structural removal OR single-mode date change
    IF v_when_mode = 'multi_date' THEN
      -- Compare existing event_dates dates with payload dates
      SELECT array_agg(DISTINCT (start_at AT TIME ZONE v_timezone)::date ORDER BY (start_at AT TIME ZONE v_timezone)::date)
      INTO v_old_master_dates
      FROM public.event_dates
      WHERE event_id = p_event_id;

      SELECT array_agg(DISTINCT (entry->>'date')::date ORDER BY (entry->>'date')::date)
      INTO v_new_payload_dates
      FROM jsonb_array_elements(v_multi_dates) entry
      WHERE NULLIF(entry->>'date', '') IS NOT NULL;

      -- Reject if any existing date is missing from new payload
      IF v_old_master_dates IS NOT NULL AND v_new_payload_dates IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM unnest(v_old_master_dates) AS d
          WHERE d <> ALL(v_new_payload_dates)
        ) THEN
          RAISE EXCEPTION 'multi_date_remove_with_sales';
        END IF;
      END IF;
    END IF;

    IF v_when_mode = 'single' THEN
      -- Reject date change in single mode with sold>0
      v_date_iso := NULLIF(v_when->>'date', '');
      IF v_date_iso IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.event_dates
          WHERE event_id = p_event_id
            AND is_master = true
            AND (start_at AT TIME ZONE v_timezone)::date <> v_date_iso::date
        ) THEN
          RAISE EXCEPTION 'multi_date_remove_with_sales';
        END IF;
        -- ORCH-1047 buyer protection: a TIME / timezone change (same calendar
        -- day) is just as material to a ticket holder as a date move — the
        -- event they paid for is moving — so it must also pass through the
        -- refund-first process rather than saving silently. Compute the
        -- proposed master start/end instant (mirror the §10 midnight-wrap) and
        -- reject if it differs from the current master row.
        v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
        v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.event_dates
          WHERE event_id = p_event_id
            AND is_master = true
            AND (start_at <> v_start OR end_at <> v_end)
        ) THEN
          RAISE EXCEPTION 'schedule_change_with_sales';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10. #3285 — RECONCILE event_dates IN PLACE. NEVER DELETE-AND-REINSERT.
  --
  -- The previous body ran `DELETE` over every row for the event and
  -- re-inserted them with new ids. Three things point at those ids:
  -- ticket_event_dates (the days a pass admits), orders.event_date_id (the
  -- payout anchor) and scan_events.event_date_id (the admitting day, which is
  -- what de-duplicates a multi-day pass at the door). Adding a day or
  -- retiming one passed the old guard, so every sold pass silently became an
  -- any-day pass, every anchor went NULL, and every in-flight checkout was
  -- revoked, on a save that changed nothing a guest holds.
  --
  -- An occurrence is now matched to its existing row and updated in place:
  --   P1 same start instant (exactly one candidate);
  --   P2 same local calendar day, row day in the row's own stored zone,
  --      when exactly one unmatched target and one unmatched row share it;
  --   P3 single/recurring only: the one occurrence is the same occurrence
  --      even when its date moves.
  -- A multi-date day is NEVER matched across dates: Friday -> Saturday is
  -- remove Friday + add Saturday, so a Friday pass cannot become a Saturday
  -- pass. A day with unmatched targets AND unmatched rows after P2 is
  -- ambiguous (e.g. two same-day sessions both retimed).
  -- ═════════════════════════════════════════════════════════════════════════
  v_ack := COALESCE((p_when_payload->>'acknowledgeSoldImpact')::boolean, false);

  -- 10.1 Build and validate the targets (same codes, same order as before).
  IF v_when_mode IN ('single', 'recurring') THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    -- Midnight wrap — IDENTICAL to business_publish_event_draft:292-294
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    -- Zero-duration rejection (defensive — wizard should prevent this client-side)
    IF v_end = v_start THEN
      RAISE EXCEPTION 'event_end_must_differ_from_start';
    END IF;
    -- issue #3313 — A RECURRING EVENT'S TARGETS ARE EVERY DATE OF ITS RULE.
    -- #3285 built ONE target here for recurring, so the in-place reconcile
    -- below would have deleted every other date nothing held. The rule is the
    -- one the organiser just saved, else the stored one. The window is every
    -- date since the anchor that has already started, up to 52 upcoming dates,
    -- and — when the rule is unchanged — every date the top-up has already
    -- added, so an unchanged save matches every existing row and writes
    -- nothing. No rule at all keeps the single #3285 target.
    IF v_when_mode = 'recurring' THEN
      v_rule := CASE
        WHEN jsonb_typeof(p_when_payload->'recurrenceRule') = 'object'
          THEN p_when_payload->'recurrenceRule'
        WHEN jsonb_typeof(v_event.recurrence_rules) = 'object'
          THEN v_event.recurrence_rules
        ELSE NULL
      END;
    END IF;
    IF v_rule IS NULL THEN
      v_t_dates := ARRAY[v_date_iso::date];
      v_t_starts := ARRAY[v_start];
      v_t_ends := ARRAY[v_end];
    ELSE
      IF v_rule IS NOT DISTINCT FROM v_event.recurrence_rules THEN
        SELECT max(ed.start_at) INTO v_cover_through
          FROM public.event_dates ed
         WHERE ed.event_id = p_event_id;
      END IF;
      FOR v_occ IN
        SELECT o.start_at, o.end_at
          FROM public.issue_3313_recurrence_occurrences(
                 v_start, v_end, v_rule, v_timezone, v_now, 52, v_cover_through
               ) o
         ORDER BY o.occurrence_index
      LOOP
        v_t_dates := v_t_dates || (v_occ.start_at AT TIME ZONE v_timezone)::date;
        v_t_starts := v_t_starts || v_occ.start_at;
        v_t_ends := v_t_ends || v_occ.end_at;
      END LOOP;
    END IF;

  ELSIF v_when_mode = 'multi_date' THEN
    IF v_multi_dates IS NULL
      OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_multi_dates) = 0
    THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    SELECT min(
      (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp AT TIME ZONE v_timezone
    )
    INTO v_min_start
    FROM jsonb_array_elements(v_multi_dates) entry
    WHERE NULLIF(entry->>'date', '') IS NOT NULL;

    IF v_min_start IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
    LOOP
      v_date_iso := NULLIF(v_date_entry->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
      v_ends := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
      -- Per-entry midnight wrap — IDENTICAL to business_publish_event_draft:327-329
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      IF v_end = v_start THEN
        RAISE EXCEPTION 'event_end_must_differ_from_start';
      END IF;
      -- Two occurrences starting at the same instant cannot be told apart, so
      -- they cannot be matched. The wizard already refuses duplicate
      -- date+startTime; this is the server's own refusal.
      IF v_start = ANY (v_t_starts) THEN
        RAISE EXCEPTION 'event_date_duplicate';
      END IF;
      v_t_dates := v_t_dates || v_date_iso::date;
      v_t_starts := v_t_starts || v_start;
      v_t_ends := v_t_ends || v_end;
    END LOOP;
  END IF;

  v_n_t := COALESCE(array_length(v_t_starts, 1), 0);
  v_t_match := array_fill(NULL::uuid, ARRAY[v_n_t]);

  -- 10.2 The existing rows (already locked).
  SELECT COALESCE(array_agg(ed.id ORDER BY ed.start_at, ed.id), '{}'::uuid[]),
         COALESCE(array_agg(ed.start_at ORDER BY ed.start_at, ed.id), '{}'::timestamptz[]),
         COALESCE(array_agg(ed.end_at ORDER BY ed.start_at, ed.id), '{}'::timestamptz[]),
         COALESCE(array_agg((ed.start_at AT TIME ZONE ed.timezone)::date ORDER BY ed.start_at, ed.id), '{}'::date[])
    INTO v_e_ids, v_e_starts, v_e_ends, v_e_days
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id;
  v_n_e := COALESCE(array_length(v_e_ids, 1), 0);
  v_e_matched := array_fill(false, ARRAY[v_n_e]);

  -- 10.3 P1 — same start instant.
  FOR v_i IN 1 .. v_n_t LOOP
    v_cand := NULL;
    v_cand_count := 0;
    FOR v_j IN 1 .. v_n_e LOOP
      IF NOT v_e_matched[v_j] AND v_e_starts[v_j] = v_t_starts[v_i] THEN
        v_cand := v_j;
        v_cand_count := v_cand_count + 1;
      END IF;
    END LOOP;
    IF v_cand_count = 1 THEN
      v_t_match[v_i] := v_e_ids[v_cand];
      v_e_matched[v_cand] := true;
    END IF;
  END LOOP;

  -- 10.3 P2 — same local calendar day, only when it is 1:1.
  FOR v_i IN 1 .. v_n_t LOOP
    CONTINUE WHEN v_t_match[v_i] IS NOT NULL;
    v_t_on_day := 0;
    FOR v_j IN 1 .. v_n_t LOOP
      IF v_t_match[v_j] IS NULL AND v_t_dates[v_j] = v_t_dates[v_i] THEN
        v_t_on_day := v_t_on_day + 1;
      END IF;
    END LOOP;
    v_e_on_day := 0;
    v_cand := NULL;
    FOR v_j IN 1 .. v_n_e LOOP
      IF NOT v_e_matched[v_j] AND v_e_days[v_j] = v_t_dates[v_i] THEN
        v_e_on_day := v_e_on_day + 1;
        v_cand := v_j;
      END IF;
    END LOOP;
    IF v_t_on_day = 1 AND v_e_on_day = 1 THEN
      v_t_match[v_i] := v_e_ids[v_cand];
      v_e_matched[v_cand] := true;
    END IF;
  END LOOP;

  -- 10.3 P3 — a single/recurring event's one occurrence is the same
  -- occurrence when its date moves.
  IF v_when_mode IN ('single', 'recurring') AND v_n_t = 1 AND v_t_match[1] IS NULL THEN
    v_e_on_day := 0;
    v_cand := NULL;
    FOR v_j IN 1 .. v_n_e LOOP
      IF NOT v_e_matched[v_j] THEN
        v_e_on_day := v_e_on_day + 1;
        v_cand := v_j;
      END IF;
    END LOOP;
    IF v_e_on_day = 1 THEN
      v_t_match[1] := v_e_ids[v_cand];
      v_e_matched[v_cand] := true;
    END IF;
  END IF;

  -- 10.4 Removed = every existing row nothing matched.
  FOR v_j IN 1 .. v_n_e LOOP
    IF NOT v_e_matched[v_j] THEN
      v_removed := v_removed || v_e_ids[v_j];
    END IF;
  END LOOP;

  -- 10.5a The multi-date twin of ORCH-1047's single-date rule. With sales and
  -- no "Refund all & proceed", guests who bought a day must not find it moved
  -- or gone. Adding a day is allowed: no holder's day changes.
  -- issue #3313 — recurring joins multi_date: with sales, a guest's night must
  -- not move or disappear without "Refund all & proceed".
  IF v_sold_count > 0 AND NOT v_ack AND v_when_mode IN ('multi_date', 'recurring') THEN
    -- A day removed outright: its local day has no unmatched target.
    FOR v_j IN 1 .. v_n_e LOOP
      CONTINUE WHEN v_e_matched[v_j];
      v_t_on_day := 0;
      FOR v_i IN 1 .. v_n_t LOOP
        IF v_t_match[v_i] IS NULL AND v_t_dates[v_i] = v_e_days[v_j] THEN
          v_t_on_day := v_t_on_day + 1;
        END IF;
      END LOOP;
      IF v_t_on_day = 0 THEN
        RAISE EXCEPTION 'multi_date_remove_with_sales';
      END IF;
    END LOOP;
    -- A matched day whose start or end moved.
    FOR v_i IN 1 .. v_n_t LOOP
      CONTINUE WHEN v_t_match[v_i] IS NULL;
      FOR v_j IN 1 .. v_n_e LOOP
        IF v_e_ids[v_j] = v_t_match[v_i]
           AND (v_e_starts[v_j], v_e_ends[v_j]) IS DISTINCT FROM (v_t_starts[v_i], v_t_ends[v_i]) THEN
          RAISE EXCEPTION 'schedule_change_with_sales';
        END IF;
      END LOOP;
    END LOOP;
    -- Anything still unmatched shares its day with an unmatched target: an
    -- ambiguous same-day change, which is a schedule change.
    IF COALESCE(array_length(v_removed, 1), 0) > 0 THEN
      RAISE EXCEPTION 'schedule_change_with_sales';
    END IF;
  END IF;

  -- 10.5b ALWAYS, including "Refund all & proceed" and sold_count = 0: an
  -- occurrence that something still holds is never deleted.
  FOR v_j IN 1 .. v_n_e LOOP
    CONTINUE WHEN v_e_matched[v_j];
    v_hold := public.issue_3285_event_date_hold_reason(v_e_ids[v_j]);
    CONTINUE WHEN v_hold IS NULL;
    v_t_on_day := 0;
    FOR v_i IN 1 .. v_n_t LOOP
      IF v_t_match[v_i] IS NULL AND v_t_dates[v_i] = v_e_days[v_j] THEN
        v_t_on_day := v_t_on_day + 1;
      END IF;
    END LOOP;
    IF v_t_on_day > 0 THEN
      RAISE EXCEPTION 'event_date_match_ambiguous'
        USING DETAIL = format('issue #3285: occurrence %s is held (%s) and its day cannot be matched to exactly one new time', v_e_ids[v_j], v_hold);
    END IF;
    RAISE EXCEPTION 'multi_date_remove_with_sales'
      USING DETAIL = format('issue #3285: occurrence %s is held (%s)', v_e_ids[v_j], v_hold);
  END LOOP;

  -- 10.6 Writes. Only rows whose values actually change are touched, so the
  -- #1930 revocation trigger and the #1777 reach trigger fire on real changes
  -- only.
  IF COALESCE(array_length(v_removed, 1), 0) > 0 THEN
    -- W1 Dead entitlements only (void/refunded passes) for days being removed.
    -- A live one cannot reach here (10.5b); if one ever did, the RESTRICT FK
    -- refuses the delete below instead of orphaning it.
    DELETE FROM public.ticket_event_dates ted
     USING public.tickets t
     WHERE t.id = ted.ticket_id
       AND ted.event_date_id = ANY (v_removed)
       AND t.status NOT IN ('valid', 'used', 'transferred', 'refund_pending');
    -- W2
    DELETE FROM public.event_dates WHERE id = ANY (v_removed);
  END IF;

  -- W3 Retime matched rows in place. The id — and everything pointing at it —
  -- survives.
  FOR v_i IN 1 .. v_n_t LOOP
    CONTINUE WHEN v_t_match[v_i] IS NULL;
    UPDATE public.event_dates
       SET start_at = v_t_starts[v_i],
           end_at = v_t_ends[v_i]
     WHERE id = v_t_match[v_i]
       AND (start_at, end_at) IS DISTINCT FROM (v_t_starts[v_i], v_t_ends[v_i]);
  END LOOP;

  -- W4 Zone relabel.
  UPDATE public.event_dates
     SET timezone = v_timezone
   WHERE event_id = p_event_id
     AND timezone IS DISTINCT FROM v_timezone;

  -- W5 Genuinely new occurrences.
  FOR v_i IN 1 .. v_n_t LOOP
    CONTINUE WHEN v_t_match[v_i] IS NOT NULL;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_t_starts[v_i], v_t_ends[v_i], v_timezone, false);
  END LOOP;

  -- W6 Exactly one master = the earliest occurrence. Clear before set:
  -- event_dates_master_unique is a non-deferrable partial unique index.
  SELECT ed.id INTO v_master_id
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id
   ORDER BY ed.start_at, ed.id
   LIMIT 1;
  UPDATE public.event_dates
     SET is_master = false
   WHERE event_id = p_event_id
     AND is_master
     AND id <> v_master_id;
  UPDATE public.event_dates
     SET is_master = true
   WHERE id = v_master_id
     AND NOT is_master;


  -- issue #3281 many-dates — persist per-date title/place only when the payload
  -- carries an overrides object (never wipe Dates-screen edits with absent keys).
  IF jsonb_typeof(p_when_payload->'multiDates') = 'array' THEN
    UPDATE public.event_dates d
       SET override_title = NULLIF(left(btrim(COALESCE(
             e #>> '{overrides,title}', e->>'overrideTitle', ''
           )), 120), ''),
           override_location = NULLIF(left(btrim(COALESCE(
             e #>> '{overrides,venueName}', e->>'overrideLocation', ''
           )), 120), '')
      FROM jsonb_array_elements(p_when_payload->'multiDates') e
     WHERE d.event_id = p_event_id
       AND e ? 'overrides'
       AND d.start_at = (
         (NULLIF(e->>'date','') || ' ' || COALESCE(NULLIF(e->>'startTime',''), '00:00') || ':00')::timestamp
         AT TIME ZONE v_timezone
       );
  END IF;

  -- ORCH-1075 paid-publish integrity guard (event-edit family — Guard B only).
  -- business_patch_event_when patches WHEN (dates) only; it never writes
  -- price_cents / available_online, so a free<->paid transition is impossible
  -- here and Guard A (Stripe readiness) is N/A. But editing dates CAN push an
  -- already-PAID online event onto a past date, so reject that. FREE events and
  -- in-person-only paid events are exempt (paid-only, mirrors checkout).
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  v_event_is_paid_online := EXISTS (
    SELECT 1 FROM public.ticket_types t
     WHERE t.event_id = p_event_id
       AND t.deleted_at IS NULL
       AND t.available_online = true
       AND t.price_cents > 0
  );
  IF v_event_is_paid_online THEN
    SELECT max(ed.end_at) INTO v_max_end
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  -- 11. Update events row (timezone may have changed; updated_at bump)
  -- issue #3313 — a save that involves recurring (either side) also stores
  -- the When shape it just materialised: the mode flags, the rule the top-up
  -- and the public reader expand, and the organiser's copy in
  -- theme.business_event. Before this a live rule change moved the dates while
  -- every stored copy kept the old rule. Every other save is byte-identical.
  v_persist_when_shape := v_when_mode = 'recurring' OR v_old_when_mode = 'recurring';
  UPDATE public.events
  SET
    timezone = v_timezone,
    is_recurring = CASE WHEN v_persist_when_shape
      THEN v_when_mode = 'recurring' ELSE is_recurring END,
    is_multi_date = CASE WHEN v_persist_when_shape
      THEN v_when_mode = 'multi_date' ELSE is_multi_date END,
    recurrence_rules = CASE WHEN v_persist_when_shape
      THEN CASE WHEN v_when_mode = 'recurring' THEN v_rule ELSE NULL END
      ELSE recurrence_rules END,
    theme = CASE WHEN v_persist_when_shape
      THEN COALESCE(theme, '{}'::jsonb) || jsonb_build_object(
        'business_event',
        CASE WHEN jsonb_typeof(theme->'business_event') = 'object'
          THEN theme->'business_event' ELSE '{}'::jsonb END
        || jsonb_build_object(
          'whenMode', v_when_mode,
          'when', v_when,
          'multiDates', v_multi_dates,
          'recurrenceRule', CASE WHEN v_when_mode = 'recurring' THEN v_rule ELSE NULL END
        ))
      ELSE theme END,
    updated_at = v_now
  WHERE id = p_event_id
    AND status IN ('scheduled', 'live')
    AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_editable_race';
  END IF;

  -- 12. Return canonical shape (mirror business_patch_event_taxonomy)
  RETURN jsonb_build_object(
    'event', to_jsonb(v_updated),
    'when_mode', v_when_mode,
    'sold_count', v_sold_count,
    'updated_at', v_now
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.pg_direct_event_checkout_bundle(uuid, text, text)
  TO anon, authenticated, service_role;

COMMIT;

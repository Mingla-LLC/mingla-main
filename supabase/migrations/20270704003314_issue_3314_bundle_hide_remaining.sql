-- =====================================================================================
-- Issue #3314 — the public event bundle carries the organiser's "Hide remaining count".
--
-- WHY. #3360 made every guest surface fail closed: no remaining-ticket count shows
-- until the server says the organiser allows it. The only guest-readable source of the
-- setting was `pg_public_social_proof`, which answers for PUBLIC events only, so an
-- UNLISTED event never showed a count even with the setting off. The bundle below
-- already serves public and unlisted events alike, so the setting now rides it.
--
-- WHAT THIS DOES. Re-emits `public.pg_direct_event_checkout_bundle(uuid,text,text)`
-- from its latest definition, 20270703003284_issue_3284_offering_refund_terms.sql
-- (prosrc md5 e26e1b4fbc414b4f816ca18eae31a932, which production carries), BYTE FOR
-- BYTE, plus exactly two textual edits, each marked "issue #3314":
--
--   1. one column in the `ev` CTE: the raw `theme.business_event.settings`
--      value, after `hide_address_until_ticket`;
--   2. one output key, `hideRemainingCount` (boolean, never null), straight after
--      `multiDatePricingMode` and BEFORE `recurrenceRule`.
--
-- WHY NOT LAST. #3284's contract (issue_3284_offering_refund_terms.test.sql R-15, R-16)
-- requires `recurrenceRule` then `refundPolicy` to stay the final two keys. Every
-- pre-existing key keeps its name, value and relative order; clients read keys by
-- name. issue_3314_bundle_hide_remaining.test.sql proves both.
--
-- WHAT THIS DOES NOT TOUCH. Same signature, RETURNS json, LANGUAGE sql, STABLE,
-- SECURITY DEFINER, `SET search_path TO ''`. A same-signature CREATE OR REPLACE keeps
-- the existing grants and COMMENT, so neither is restated. Every visibility, privacy,
-- held, remaining and day-choice expression is copied verbatim. Display only: the
-- remaining numbers still travel for the quantity stepper and the sold-out gate.
--
-- ORDER MATTERS. Versioned after 20270703003284 (and after every file on main), so it
-- sorts, replays and applies last. Applied before #3284, one would revert the other.
--
-- ADDITIVE ONLY. A client that meets a server without this migration sees the key as
-- ABSENT and falls back to the social-proof read, still fail closed.
--
-- Contract test: supabase/migrations/__tests__/issue_3314_bundle_hide_remaining.test.sql
-- =====================================================================================
BEGIN;

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
                 'isMaster',  d.is_master
               ) ORDER BY d.start_at, d.id), '[]'::json)
          FROM public.event_dates d
         WHERE d.event_id = ev.id
           -- issue #3313 — a recurring event offers only nights still ahead,
           -- which keeps `isMultiDate === (occurrences.length > 1)` true (the
           -- shipped native shape check). Multi-date events are unchanged.
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
      'refundPolicy', ev.refund_policy
    ) END
  FROM ev;
$function$;

COMMIT;

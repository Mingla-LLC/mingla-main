-- =====================================================================================
-- Issue #3284 — refund terms on events and experiences (server contract).
--
-- WHAT THIS DOES, in three parts:
--
--   1. A NEW gated writer for `events.refund_policy` on rows whose event_type is
--      'event' or 'experience'. Trips keep their own live-edit owner, unchanged.
--      The column, its shape validator and its CHECK constraint already exist
--      (20260612000000_tr4_refund_tiers_booking_deadline.sql); nothing about the
--      schema changes here.
--
--      ONCE A PAID ORDER EXISTS, TERMS MAY ONLY GET MORE GENEROUS. The downgrade
--      classifier is the trip one, copied verbatim: at every threshold in
--      old ∪ new ∪ {0} days, the realized refund pct is the refund_pct of the
--      tier with the largest days_before_start <= threshold, else 0, and a null
--      policy is 0% everywhere. Any threshold where new < old is refused with
--      `refund_policy_downgrade_with_sales` and nothing is written. Free orders
--      (total_cents = 0) never lock terms: there is no money to refund.
--
--      A draft is written with no reason and no gate. A scheduled or live
--      offering needs a 10–200 character reason (the trip strings). Only an
--      experience writes an audit row: events have no edit-log table, which
--      matches every other event live-edit sub-function.
--
--   2. The public EVENT page reader (the direct checkout bundle) re-emitted from
--      20270702003313_issue_3313_recurring_event_occurrences.sql (its latest
--      definition, which carries #3313's day-choice predicate, upcoming-night
--      occurrences, per-night remaining and `recurrenceRule` key) BYTE FOR BYTE,
--      plus exactly two textual edits: `e.refund_policy` in the `ev` CTE, and a
--      trailing `'refundPolicy'` output key after `'recurrenceRule'`. Its
--      grants are left exactly as #3313 left them: a same-signature CREATE OR
--      REPLACE keeps every existing grant.
--
--      ORDER MATTERS. This file is versioned 20270703… so it sorts, replays and
--      applies AFTER 20270702003313: applied the other way round, one migration
--      would silently revert the other's reader.
--
--   3. The public EXPERIENCE page reader re-emitted from
--      20270607002774_issue_2774_public_hero_alt.sql BYTE FOR BYTE, plus exactly
--      two textual edits: `e.refund_policy` in the `ex` CTE, and a trailing
--      `'refundPolicy'` output key after `'bookable'`.
--
-- WHAT THIS DOES NOT TOUCH. No checkout execution, refund execution or payout code.
-- Both readers are `STABLE` SQL readers; each gains one display key, and every held,
-- remaining, visibility, privacy and readiness expression is copied verbatim. Both
-- keep their signature, SECURITY DEFINER, pinned search_path and grants. Both stay
-- carriers of the #2489 shared address-privacy gate exactly as before.
--
-- ADDITIVE ONLY. Every key either reader emitted before is still emitted, with the
-- same value and in the same order; `refundPolicy` is appended last. A client that
-- meets a server WITHOUT this migration sees the key as ABSENT, which the client
-- reads as "unknown" and hides — never as "no policy" (I-3284-UNKNOWN-IS-NOT-NONE).
--
-- Contract test: supabase/migrations/__tests__/issue_3284_offering_refund_terms.test.sql
-- =====================================================================================
BEGIN;

-- -------------------------------------------------------------------------------------
-- 1. The gated refund-terms writer for events and experiences.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_patch_offering_refund_policy(
  p_event_id uuid,
  p_policy jsonb,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_trimmed_reason text;
  v_paid int := 0;
  v_old_policy jsonb;
  v_new_policy jsonb;
  v_thresholds int[];
  v_threshold int;
  v_old_pct int;
  v_new_pct int;
  v_refund_unfavorable boolean := false;
  v_changed boolean;
BEGIN
  -- ---------- 1. Auth ----------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  -- ---------- 2. Row lookup, locked so a concurrent writer cannot interleave ----------
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offering_not_found');
  END IF;

  -- ---------- 3. Offering type ----------
  IF v_event.event_type NOT IN ('event', 'experience') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offering_type_not_supported');
  END IF;

  -- ---------- 4. Permission (fail closed on anything but a definite true) ----------
  IF public.biz_is_event_manager_plus(p_event_id, v_user_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- ---------- 5. Status ----------
  IF v_event.status NOT IN ('draft', 'scheduled', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offering_not_editable_status');
  END IF;

  v_old_policy := v_event.refund_policy;
  v_new_policy := CASE
                    WHEN p_policy IS NULL OR jsonb_typeof(p_policy) = 'null' THEN NULL
                    ELSE p_policy
                  END;

  -- ---------- 6. Published offerings only: reason, paid buyers, downgrade gate ----------
  IF v_event.status IN ('scheduled', 'live') THEN
    v_trimmed_reason := btrim(COALESCE(p_reason, ''));
    IF v_trimmed_reason = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
    END IF;
    IF char_length(v_trimmed_reason) < 10 OR char_length(v_trimmed_reason) > 200 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
    END IF;
  END IF;

  -- Shape validation BEFORE any classification or write. It RAISEs on a bad shape;
  -- the events_refund_policy_valid CHECK on the UPDATE below is the second line.
  PERFORM public.validate_refund_policy(v_new_policy);

  IF v_event.status IN ('scheduled', 'live') THEN
    -- Only paid money can be refunded, so free orders never lock terms.
    SELECT count(*)::int INTO v_paid
      FROM public.orders o
     WHERE o.event_id = p_event_id
       AND o.payment_status IN ('paid', 'partial_refund')
       AND o.total_cents > 0;

    -- Favorable/unfavorable classification only matters when paid buyers exist.
    IF v_paid > 0 THEN
      -- Thresholds = union of both policies' days_before_start + {0}.
      v_thresholds := (
        SELECT array_agg(DISTINCT x)
        FROM (
          SELECT (t->>'days_before_start')::int AS x
            FROM jsonb_array_elements(COALESCE(v_old_policy->'tiers', '[]'::jsonb)) t
          UNION
          SELECT (t->>'days_before_start')::int
            FROM jsonb_array_elements(COALESCE(v_new_policy->'tiers', '[]'::jsonb)) t
          UNION
          SELECT 0
        ) u
      );

      v_refund_unfavorable := false;
      IF v_thresholds IS NOT NULL THEN
        FOREACH v_threshold IN ARRAY v_thresholds LOOP
          -- realized refund_pct at v_threshold = winning tier (largest
          -- days_before_start <= v_threshold), else 0. A NULL policy has no
          -- tiers, so it is 0% at every threshold.
          SELECT COALESCE(
            (SELECT (te->>'refund_pct')::int
               FROM jsonb_array_elements(COALESCE(v_old_policy->'tiers', '[]'::jsonb)) te
              WHERE (te->>'days_before_start')::int <= v_threshold
              ORDER BY (te->>'days_before_start')::int DESC
              LIMIT 1),
            0
          ) INTO v_old_pct;

          SELECT COALESCE(
            (SELECT (te->>'refund_pct')::int
               FROM jsonb_array_elements(COALESCE(v_new_policy->'tiers', '[]'::jsonb)) te
              WHERE (te->>'days_before_start')::int <= v_threshold
              ORDER BY (te->>'days_before_start')::int DESC
              LIMIT 1),
            0
          ) INTO v_new_pct;

          IF v_new_pct < v_old_pct THEN
            v_refund_unfavorable := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_refund_unfavorable THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'refund_policy_downgrade_with_sales',
          'affected_order_count', v_paid
        );
      END IF;
    END IF;
  END IF;

  -- ---------- 7. Write ----------
  v_changed := v_old_policy IS DISTINCT FROM v_new_policy;

  UPDATE public.events
     SET refund_policy = v_new_policy,
         updated_at = now()
   WHERE id = p_event_id;

  -- ---------- 8. Audit: published experiences only, and only on a real change ----------
  IF v_event.event_type = 'experience'
     AND v_event.status IN ('scheduled', 'live')
     AND v_changed THEN
    INSERT INTO public.experience_edit_log
      (event_id, brand_id, edited_by, reason, severity,
       changed_field_keys, diff_summary, affected_order_ids, occurred_at)
    VALUES (
      p_event_id,
      v_event.brand_id,
      v_user_id,
      v_trimmed_reason,
      'material',
      ARRAY['refund_policy']::text[],
      jsonb_build_object('refund_policy',
        jsonb_build_object('before', v_old_policy, 'after', v_new_policy)),
      '{}'::uuid[],
      now()
    );
  END IF;

  -- ---------- 9. Result ----------
  RETURN jsonb_build_object(
    'ok', true,
    'refundPolicy', v_new_policy,
    'changed', v_changed
  );
END;
$function$;

COMMENT ON FUNCTION public.business_patch_offering_refund_policy(uuid, jsonb, text) IS
  'Issue #3284 — the one gated writer of events.refund_policy for event_type event and '
  'experience (trips keep their own live-edit owner). Drafts write freely. Scheduled or '
  'live offerings need a 10-200 character reason, and once a paid order (paid or '
  'partial_refund, total_cents > 0) exists the terms may only become more generous: a '
  'downgrade at any threshold returns {ok:false, reason:refund_policy_downgrade_with_sales, '
  'affected_order_count} and writes nothing. Published experiences append one '
  'experience_edit_log row per real change. Returns {ok:true, refundPolicy, changed}.';

REVOKE ALL ON FUNCTION public.business_patch_offering_refund_policy(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_patch_offering_refund_policy(uuid, jsonb, text) TO authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 2. Public event page reader — #3313 body plus the refund terms display key.
-- -------------------------------------------------------------------------------------
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


-- -------------------------------------------------------------------------------------
-- 3. Public experience page reader — #2774 body plus the refund terms display key.
-- -------------------------------------------------------------------------------------
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
      END,
      'refundPolicy', ex.refund_policy
    ) END
  FROM ex;
$function$
;

GRANT EXECUTE ON FUNCTION public.pg_public_experience_by_slug(text, text) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

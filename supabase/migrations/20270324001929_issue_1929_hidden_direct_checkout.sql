-- issue #1929: exact-key public/hidden event bundle and hidden fresh checkout admission.
-- Additive read authority; checkout is the latest 11-argument writer re-emitted below.


CREATE FUNCTION public.pg_direct_event_checkout_bundle(
  p_event_id uuid DEFAULT NULL,
  p_brand_slug text DEFAULT NULL,
  p_event_slug text DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
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
      (e.theme - 'business_draft'::text) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      COALESCE(
        ((e.theme #>> '{business_event,hideAddressUntilTicket}')::boolean),
        true
      ) AS hide_address_until_ticket,
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
      AND e.visibility IN ('public'::text, 'hidden'::text)
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
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
      'venueName', COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text),
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
          'displayOrder', tix.display_order
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json)
    ) END
  FROM ev;
$function$;

COMMENT ON FUNCTION public.pg_direct_event_checkout_bundle(uuid, text, text) IS 'Issue #1929 exact-key public/hidden standard-event bundle; non-enumerable and NULL on denial; contains no authoring or management fields.';
REVOKE ALL ON FUNCTION public.pg_direct_event_checkout_bundle(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pg_direct_event_checkout_bundle(uuid, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_marketing_opt_in boolean,
  p_lines jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,
  p_payment_plan_choice text DEFAULT 'auto'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
  v_is_trip boolean := false;
  v_line_count int := 0;
  -- META-ORCH-1174 B1: per-line installment locals. v_first_ticket_type_id is
  -- retained for compatibility but the schedule is now computed PER LINE in a
  -- second loop, not off the first tier only.
  v_first_ticket_type_id uuid := NULL;
  v_tier_metadata jsonb;
  v_installments_input jsonb;
  v_deposit_pct numeric;
  v_inst_array jsonb;
  v_inst_count int;
  v_inst_item jsonb;
  v_inst_ord int;
  v_inst_pct numeric;
  v_inst_days int;
  v_inst_fixed text;
  v_pct_sum numeric := 0;
  v_line_total bigint;          -- THIS line's total (price_cents × qty)
  v_line_deposit_cents bigint;  -- THIS line's deposit
  v_line_running bigint;        -- THIS line's running installment total
  v_inst_amount bigint;
  v_inst_due timestamptz;
  v_now timestamptz := now();
  v_i int;
  -- Aggregate accumulators across all lines:
  v_due_today_cents bigint := 0;          -- Σ deposits + Σ non-plan full
  v_any_installments boolean := false;    -- did ANY line produce a schedule?
  v_unioned jsonb := '[]'::jsonb;         -- all lines' raw installment entries
  v_full_price_cents bigint := 0;         -- Σ of all line totals (the trip total)
  -- issue #1014: a NULL-currency (free-only) event's tickets carry NULL
  -- currency; track whether the cart saw one so mixing raises ONLY on money.
  v_saw_null_currency boolean := false;
BEGIN
  IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;

  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             status = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at = now()
       WHERE id = v_existing.id;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId', i.ticket_type_id,
        'ticketName', i.ticket_name_at_purchase,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents
      ) ORDER BY i.created_at), '[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId', v_existing.id,
        'eventId', v_existing.event_id,
        'brandId', v_existing.brand_id,
        'status', v_existing.status,
        'totalCents', v_existing.total_cents,
        'subtotalCents', v_existing.total_cents,
        'currency', trim(v_existing.currency),
        'stripeAccountId', v_existing.stripe_account_id,
        'orderId', v_existing.order_id,
        'items', v_items,
        'lineItems', v_items,
        'installmentSchedule', v_existing.installment_schedule
      );
    END IF;
  END IF;

  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
         s.stripe_account_id, s.charges_enabled,
         b.payment_provider
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.stripe_connect_accounts s
      ON s.brand_id = e.brand_id
     AND s.detached_at IS NULL
   WHERE e.id = p_event_id
   FOR SHARE OF e;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.visibility NOT IN ('public', 'hidden') OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  v_is_trip := v_event.event_type = 'trip';
  v_session_id := gen_random_uuid();

  -- ---------------- Pass 1: validate lines + build line items (UNCHANGED). ----------------
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
    v_qty := COALESCE((v_line ->> 'quantity')::integer, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'ticket_quantity_invalid';
    END IF;

    SELECT *
      INTO v_ticket_type
      FROM public.ticket_types
     WHERE id = (v_line ->> 'ticketTypeId')::uuid
       AND event_id = p_event_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket_type_not_found';
    END IF;
    IF v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN
      RAISE EXCEPTION 'ticket_type_unavailable';
    END IF;
    IF v_ticket_type.sale_start_at IS NOT NULL AND v_ticket_type.sale_start_at > now() THEN
      RAISE EXCEPTION 'ticket_sales_not_started';
    END IF;
    IF v_ticket_type.sale_end_at IS NOT NULL AND v_ticket_type.sale_end_at <= now() THEN
      RAISE EXCEPTION 'ticket_sales_ended';
    END IF;
    IF v_qty < v_ticket_type.min_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_below_min';
    END IF;
    IF v_ticket_type.max_purchase_qty IS NOT NULL AND v_qty > v_ticket_type.max_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_above_max';
    END IF;

    -- META-ORCH-1174 B1 — PER-PACKAGE capacity (DEC-1174-D): each ticket_type's
    -- own quantity_total is its own cap. This was already correct (per-line),
    -- and is the only capacity model multi-package needs.
    IF NOT v_ticket_type.is_unlimited THEN
      SELECT COUNT(*)
        INTO v_sold
        FROM public.tickets t
       WHERE t.ticket_type_id = v_ticket_type.id
         AND t.status IN ('valid', 'used', 'transferred');

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment');

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_qty > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
    END IF;

    -- issue #1014 delta (2): null-safe cart mixing. An all-NULL (all-free)
    -- cart never raises; two DIFFERENT non-null currencies always raise;
    -- null-vs-non-null mixing is checked AFTER the loop (raises only when
    -- the cart carries money — see the post-loop gate).
    IF v_ticket_type.currency IS NOT NULL THEN
      IF v_currency IS NULL THEN
        v_currency := v_ticket_type.currency;
      ELSIF v_currency IS DISTINCT FROM v_ticket_type.currency THEN
        RAISE EXCEPTION 'mixed_currency_cart';
      END IF;
    ELSE
      v_saw_null_currency := true;
    END IF;

    IF v_first_ticket_type_id IS NULL THEN
      v_first_ticket_type_id := v_ticket_type.id;
    END IF;

    v_total := v_total + (v_ticket_type.price_cents * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_ticket_type.price_cents,
      'totalCents', v_ticket_type.price_cents * v_qty
    ));
  END LOOP;

  -- The full trip total (Σ all line totals) — used for the persisted schedule's
  -- fullPriceCents (informational; the buyer-facing receipt shows the trip total).
  v_full_price_cents := v_total;

  -- issue #1014 delta (2), post-loop leg: a cart mixing NULL-currency and
  -- currency-bearing tickets is legal ONLY when it carries no money (schema-
  -- impossible per-event today; defensive for cross-era rows).
  IF v_saw_null_currency AND v_currency IS NOT NULL AND v_total > 0 THEN
    RAISE EXCEPTION 'mixed_currency_cart';
  END IF;

  -- ---------------- Pass 2: per-line installment math (META-ORCH-1174 B1). ----------------
  -- For trips only, walk the BUILT line items (v_items carries the per-line
  -- totals). For each line, look up its package's tier_metadata.installments.
  -- A line with a plan (and not opted to pay-full) contributes its OWN deposit
  -- to "due today" + its OWN installment entries to the union; a line without a
  -- plan contributes its full total to "due today". The union is then re-
  -- numbered ordinal 1..M sorted by dueAt.
  --
  -- ORCH-0915 opt-out: p_payment_plan_choice='full' ⇒ NO line installments at
  -- all (every line pays full now). This is the session-wide pay-in-full path.
  IF v_is_trip AND p_payment_plan_choice <> 'full' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_line_total := (v_line ->> 'totalCents')::bigint;
      v_tier_metadata := NULL;

      SELECT tpt.tier_metadata
        INTO v_tier_metadata
        FROM public.trip_pricing_tiers tpt
       WHERE tpt.event_id = p_event_id
         AND tpt.ticket_type_id = (v_line ->> 'ticketTypeId')::uuid;

      v_installments_input := CASE
        WHEN v_tier_metadata IS NOT NULL THEN v_tier_metadata -> 'installments'
        ELSE NULL
      END;

      IF v_installments_input IS NOT NULL
         AND jsonb_typeof(v_installments_input) = 'object' THEN
        -- This package carries a payment plan → compute its per-line schedule.
        v_deposit_pct := COALESCE((v_installments_input ->> 'deposit_pct')::numeric, 0);
        v_inst_array := v_installments_input -> 'installments';

        IF v_deposit_pct <= 0 OR v_deposit_pct > 100 THEN
          RAISE EXCEPTION 'installment_deposit_pct_out_of_range';
        END IF;
        IF v_inst_array IS NULL OR jsonb_typeof(v_inst_array) <> 'array' THEN
          RAISE EXCEPTION 'installment_schedule_malformed';
        END IF;

        v_inst_count := jsonb_array_length(v_inst_array);
        IF v_inst_count < 1 OR v_inst_count > 11 THEN
          RAISE EXCEPTION 'installment_count_out_of_range';
        END IF;

        -- First pass over THIS line's installments: validate + accumulate pct.
        v_pct_sum := v_deposit_pct;
        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := COALESCE((v_inst_item ->> 'ordinal')::int, -1);
          v_inst_pct := COALESCE((v_inst_item ->> 'pct')::numeric, 0);
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_ord <> v_i + 1 THEN
            RAISE EXCEPTION 'installment_ordinal_invalid';
          END IF;
          IF v_inst_pct <= 0 OR v_inst_pct >= 100 THEN
            RAISE EXCEPTION 'installment_pct_out_of_range';
          END IF;
          IF (v_inst_days IS NULL AND v_inst_fixed IS NULL)
             OR (v_inst_days IS NOT NULL AND v_inst_fixed IS NOT NULL) THEN
            RAISE EXCEPTION 'installment_due_mode_invalid';
          END IF;

          v_pct_sum := v_pct_sum + v_inst_pct;
        END LOOP;

        IF abs(v_pct_sum - 100) > 0.01 THEN
          RAISE EXCEPTION 'installment_pct_sum_mismatch';
        END IF;

        -- Second pass: amounts scaled by THIS LINE's total, last-absorbs-rounding.
        v_line_deposit_cents := floor(v_line_total::numeric * v_deposit_pct / 100)::bigint;
        v_line_running := 0;

        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := (v_inst_item ->> 'ordinal')::int;
          v_inst_pct := (v_inst_item ->> 'pct')::numeric;
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_days IS NOT NULL THEN
            IF v_inst_days < 1 THEN
              RAISE EXCEPTION 'installment_days_after_booking_invalid';
            END IF;
            v_inst_due := v_now + (v_inst_days || ' days')::interval;
          ELSE
            v_inst_due := (v_inst_fixed)::timestamptz;
          END IF;

          IF v_i = 0 AND v_inst_due <= v_now THEN
            RAISE EXCEPTION 'installment_schedule_past_due_at_booking';
          END IF;

          IF v_i < v_inst_count - 1 THEN
            v_inst_amount := floor(v_line_total::numeric * v_inst_pct / 100)::bigint;
            v_line_running := v_line_running + v_inst_amount;
          ELSE
            v_inst_amount := v_line_total - v_line_deposit_cents - v_line_running;
            IF v_inst_amount <= 0 THEN
              RAISE EXCEPTION 'installment_rounding_invalid';
            END IF;
          END IF;

          -- Append to the UNION with a sortable dueAt (ordinal re-numbered below).
          v_unioned := v_unioned || jsonb_build_array(jsonb_build_object(
            'pct', v_inst_pct,
            'amountCents', v_inst_amount,
            'dueAt', to_char(v_inst_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'sourceTicketTypeId', (v_line ->> 'ticketTypeId'),
            'sourceOrdinal', v_inst_ord
          ));
        END LOOP;

        v_due_today_cents := v_due_today_cents + v_line_deposit_cents;
        v_any_installments := true;
      ELSE
        -- No plan on this package → its full total is due today.
        v_due_today_cents := v_due_today_cents + v_line_total;
      END IF;
    END LOOP;
  END IF;

  -- ---------------- Finalize the schedule + the deposit override. ----------------
  -- When at least one line produced installments, override v_total to the summed
  -- "due today" (Σ deposits + Σ non-plan fulls) and build the unioned schedule
  -- with sequential ordinals 1..M sorted by dueAt (then stable source order). The
  -- persisted shape is byte-identical to the single-line ORCH-0869 schedule.
  IF v_any_installments THEN
    v_total := v_due_today_cents::integer;

    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'ordinal', rn,
               'pct', (elem ->> 'pct')::numeric,
               'amountCents', (elem ->> 'amountCents')::bigint,
               'dueAt', elem ->> 'dueAt'
             )
             ORDER BY rn
           ), '[]'::jsonb)
      INTO v_unioned
      FROM (
        SELECT elem,
               row_number() OVER (
                 ORDER BY (elem ->> 'dueAt') ASC, (elem ->> 'sourceOrdinal')::int ASC
               ) AS rn
        FROM jsonb_array_elements(v_unioned) AS elem
      ) ranked;
  END IF;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND v_event.payment_provider = 'stripe'
     AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE
    WHEN v_total > 0 AND v_event.payment_provider = 'stripe' THEN v_event.stripe_account_id
    ELSE NULL
  END;

  -- issue #1014 delta (3): belt-and-braces — money never enters a session
  -- without a currency (unreachable given the (a) CHECKs: paid tickets always
  -- carry currency — but the RPC stays self-defending).
  IF v_total > 0 AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents,
    installment_schedule
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    v_currency, v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0),
    CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer
    );
  END LOOP;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'subtotalCents', v_total,
    'currency', trim(v_currency),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items,
    'lineItems', v_items,
    'installmentSchedule', CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text) TO service_role;

DO $assert$
DECLARE
  v_count integer;
  v_def text;
  v_proc regprocedure;
  v_prosecdef boolean;
  v_provolatile "char";
  v_proconfig text[];
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'biz_ticket_checkout_create_session';
  v_proc := to_regprocedure('public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text)');
  SELECT pg_get_functiondef(p.oid), p.prosecdef, p.provolatile, p.proconfig
    INTO v_def, v_prosecdef, v_provolatile, v_proconfig
  FROM pg_proc p WHERE p.oid = v_proc;
  IF v_count <> 1 OR v_def NOT LIKE '%visibility NOT IN (''public'', ''hidden'')%'
     OR v_def NOT LIKE '%WHERE idempotency_key = p_idempotency_key%'
     OR v_def NOT LIKE '%ticket_type_unavailable%'
     OR NOT v_prosecdef OR v_provolatile <> 'v'
     OR v_proconfig IS DISTINCT FROM ARRAY['search_path=public, auth']::text[]
     OR NOT has_function_privilege('public', v_proc, 'EXECUTE')
     OR NOT has_function_privilege('anon', v_proc, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_proc, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_1929_checkout_writer_assertion_failed';
  END IF;

  v_proc := to_regprocedure('public.pg_direct_event_checkout_bundle(uuid,text,text)');
  SELECT p.prosecdef, p.provolatile, p.proconfig
    INTO v_prosecdef, v_provolatile, v_proconfig
  FROM pg_proc p WHERE p.oid = v_proc;
  IF v_proc IS NULL OR NOT v_prosecdef OR v_provolatile <> 's'
     OR NOT (
       v_proconfig = ARRAY['search_path=']::text[]
       OR v_proconfig = ARRAY['search_path=""']::text[]
     )
     OR has_function_privilege('public', v_proc, 'EXECUTE')
     OR NOT has_function_privilege('anon', v_proc, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_proc, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_1929_bundle_catalog_assertion_failed';
  END IF;
END;
$assert$;

NOTIFY pgrst, 'reload schema';

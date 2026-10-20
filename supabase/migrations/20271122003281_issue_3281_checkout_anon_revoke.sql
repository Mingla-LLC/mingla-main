-- #3281 repair: keep checkout and the booking quote server-only.
--
-- 20271121003281 dropped and recreated the two checkout session functions with
-- a new 15-argument signature, which reset their ACL to the default (anon and
-- authenticated could EXECUTE). It also granted pg_experience_booking_quote to
-- anon and authenticated. These are SECURITY DEFINER functions, and only the
-- ticket-checkout-create edge function (service_role) calls them. This restores
-- the posture production had before Round 2: postgres + service_role only.
--
-- Second fix: issue_3281_apply_experience_price_options (20271120003281) still
-- parked NEW or edited group/block options offline ("until 2c"). 20271121003281
-- re-opened existing rows once but never redefined the writer, so any option a
-- host saves afterwards went offline again. The body below is the 20271120003281
-- body byte-for-byte except that one assignment. CREATE OR REPLACE keeps its
-- service_role-only ACL. No checkout function body changes, so
-- biz_ticket_checkout_finalize and its issue_3872_copy_session_totals_to_order
-- call are untouched.
--
-- The grants were applied to production on 2026-10-20 (see #3281).

BEGIN;

REVOKE ALL ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.pg_experience_booking_quote(uuid, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_experience_booking_quote(uuid, uuid, integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3281_apply_experience_price_options(
  p_event_id uuid,
  p_currency text,
  p_pricing_mode text,
  p_legacy_total_cents integer,
  p_capacity integer,
  p_price_options jsonb,
  p_has_sales boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_opt jsonb;
  v_idx integer := 0;
  v_name text;
  v_price integer;
  v_basis text;
  v_block smallint;
  v_min smallint;
  v_max smallint;
  v_group smallint;
  v_cap integer;
  v_hidden boolean;
  v_id uuid;
  v_existing uuid;
  v_first uuid;
  v_count integer;
  v_keep uuid[] := '{}'::uuid[];
  v_sold integer;
  v_old public.ticket_types%ROWTYPE;
  v_online boolean;
BEGIN
  -- Absent / empty / non-array
  IF p_price_options IS NULL
     OR jsonb_typeof(p_price_options) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_price_options) = 0 THEN
    IF p_has_sales THEN
      RAISE EXCEPTION 'price_change_with_sales';
    END IF;
    -- No options key material → legacy single Standard rewrite (create/publish).
    UPDATE public.ticket_types
       SET deleted_at = now()
     WHERE event_id = p_event_id AND deleted_at IS NULL;
    INSERT INTO public.ticket_types (
      event_id, name, description, price_cents, currency,
      quantity_total, is_unlimited, is_free,
      min_purchase_qty, max_purchase_qty,
      is_hidden, is_disabled, requires_approval, allow_transfers,
      password_protected, available_online, available_in_person,
      waitlist_enabled, display_order, price_basis
    ) VALUES (
      p_event_id, 'Standard', NULL, p_legacy_total_cents, p_currency,
      CASE WHEN p_capacity IS NULL OR p_capacity <= 0 THEN NULL ELSE p_capacity END,
      (p_capacity IS NULL OR p_capacity <= 0),
      (p_legacy_total_cents = 0),
      1, NULL,
      false, false, false, true,
      false, true, true,
      false, 0, 'person'
    )
    RETURNING id INTO v_first;
    RETURN v_first;
  END IF;

  v_count := jsonb_array_length(p_price_options);
  IF v_count > 20 THEN
    RAISE EXCEPTION 'experience_price_invalid';
  END IF;
  -- Reject is_free / zero legacy total with a positive-priced option (paid guards
  -- in create/publish key off legacy total; options must not bypass them).
  IF p_legacy_total_cents <= 0 AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_price_options) o
     WHERE COALESCE((o.value->>'price_cents')::integer, 0) > 0
  ) THEN
    RAISE EXCEPTION 'experience_price_invalid';
  END IF;

  FOR v_opt IN SELECT value FROM jsonb_array_elements(p_price_options)
  LOOP
    v_name := NULLIF(btrim(COALESCE(v_opt->>'name', '')), '');
    IF v_name IS NULL THEN
      v_name := CASE WHEN v_idx = 0 THEN 'Standard' ELSE 'Option ' || (v_idx + 1)::text END;
    END IF;
    v_price := COALESCE((v_opt->>'price_cents')::integer, 0);
    IF v_price < 0 THEN RAISE EXCEPTION 'experience_price_invalid'; END IF;
    v_basis := COALESCE(NULLIF(btrim(v_opt->>'price_basis'), ''), 'person');
    IF v_basis NOT IN ('person', 'group', 'block') THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
    IF v_basis <> 'person' AND p_pricing_mode = 'per_stop' THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
    v_block := NULLIF(v_opt->>'block_minutes', '')::smallint;
    v_min := NULLIF(v_opt->>'min_blocks', '')::smallint;
    v_max := NULLIF(v_opt->>'max_blocks', '')::smallint;
    v_group := NULLIF(v_opt->>'group_max', '')::smallint;
    IF v_basis = 'person' THEN
      v_block := NULL; v_min := NULL; v_max := NULL; v_group := NULL;
    ELSIF v_basis = 'group' THEN
      IF v_group IS NULL OR v_group < 2 OR v_group > 50 THEN
        RAISE EXCEPTION 'experience_price_invalid';
      END IF;
      v_block := NULL; v_min := NULL; v_max := NULL;
    ELSE
      IF v_block IS NULL OR v_block NOT IN (15, 30, 45, 60) THEN
        RAISE EXCEPTION 'experience_price_invalid';
      END IF;
      IF v_min IS NULL OR v_max IS NULL OR v_min < 1 OR v_max < v_min THEN
        RAISE EXCEPTION 'experience_price_invalid';
      END IF;
      v_group := NULL;
    END IF;
    -- Shared experience capacity owns option caps (wizard Total spots).
    v_cap := p_capacity;
    v_hidden := COALESCE((v_opt->>'is_hidden')::boolean, false);
    -- Unit-aware checkout (#3281 2c, 20271121003281) is live: every basis
    -- (person, group, block) is bookable online and in person.
    v_online := true;

    v_existing := NULLIF(v_opt->>'id', '')::uuid;
    IF v_existing IS NOT NULL THEN
      SELECT * INTO v_old FROM public.ticket_types
       WHERE id = v_existing AND event_id = p_event_id AND deleted_at IS NULL;
      IF FOUND THEN
        SELECT count(*)::integer INTO v_sold
          FROM public.tickets t
         WHERE t.ticket_type_id = v_existing
           AND t.status NOT IN ('void', 'refunded');
        IF p_has_sales OR v_sold > 0 THEN
          IF v_old.price_cents IS DISTINCT FROM v_price
             OR v_old.price_basis IS DISTINCT FROM v_basis
             OR v_old.block_minutes IS DISTINCT FROM v_block
             OR v_old.min_blocks IS DISTINCT FROM v_min
             OR v_old.max_blocks IS DISTINCT FROM v_max
             OR v_old.group_max IS DISTINCT FROM v_group THEN
            RAISE EXCEPTION 'price_change_with_sales';
          END IF;
          -- Sold rows: hide / display_order / capacity only.
          UPDATE public.ticket_types SET
            name = v_name,
            is_hidden = v_hidden,
            display_order = v_idx,
            quantity_total = CASE WHEN v_cap IS NULL OR v_cap <= 0 THEN NULL ELSE v_cap END,
            is_unlimited = (v_cap IS NULL OR v_cap <= 0),
            updated_at = now()
          WHERE id = v_existing;
        ELSE
          UPDATE public.ticket_types SET
            name = v_name,
            price_cents = v_price,
            currency = p_currency,
            quantity_total = CASE WHEN v_cap IS NULL OR v_cap <= 0 THEN NULL ELSE v_cap END,
            is_unlimited = (v_cap IS NULL OR v_cap <= 0),
            is_free = (v_price = 0),
            is_hidden = v_hidden,
            display_order = v_idx,
            price_basis = v_basis,
            block_minutes = v_block,
            min_blocks = v_min,
            max_blocks = v_max,
            group_max = v_group,
            available_online = v_online,
            available_in_person = v_online,
            updated_at = now()
          WHERE id = v_existing;
        END IF;
        v_id := v_existing;
      ELSE
        v_existing := NULL;
      END IF;
    END IF;

    IF v_existing IS NULL THEN
      IF p_has_sales AND v_price IS DISTINCT FROM 0 AND false THEN
        NULL; -- new options allowed with sales (additive)
      END IF;
      INSERT INTO public.ticket_types (
        event_id, name, description, price_cents, currency,
        quantity_total, is_unlimited, is_free,
        min_purchase_qty, max_purchase_qty,
        is_hidden, is_disabled, requires_approval, allow_transfers,
        password_protected, available_online, available_in_person,
        waitlist_enabled, display_order,
        price_basis, block_minutes, min_blocks, max_blocks, group_max
      ) VALUES (
        p_event_id, v_name, NULLIF(btrim(COALESCE(v_opt->>'description','')), ''),
        v_price, p_currency,
        CASE WHEN v_cap IS NULL OR v_cap <= 0 THEN NULL ELSE v_cap END,
        (v_cap IS NULL OR v_cap <= 0),
        (v_price = 0),
        1, NULL,
        v_hidden, false, false, true,
        false, v_online, v_online,
        false, v_idx,
        v_basis, v_block, v_min, v_max, v_group
      )
      RETURNING id INTO v_id;
    END IF;

    v_keep := array_append(v_keep, v_id);
    IF v_first IS NULL THEN v_first := v_id; END IF;
    v_idx := v_idx + 1;
  END LOOP;

  -- Soft-delete options dropped from the payload (never when they have sales).
  FOR v_old IN
    SELECT * FROM public.ticket_types
     WHERE event_id = p_event_id AND deleted_at IS NULL
       AND NOT (id = ANY (v_keep))
  LOOP
    SELECT count(*)::integer INTO v_sold
      FROM public.tickets t
     WHERE t.ticket_type_id = v_old.id
       AND t.status NOT IN ('void', 'refunded');
    IF v_sold > 0 OR p_has_sales THEN
      RAISE EXCEPTION 'price_change_with_sales';
    END IF;
    UPDATE public.ticket_types SET deleted_at = now(), updated_at = now()
     WHERE id = v_old.id;
  END LOOP;

  IF v_first IS NULL THEN
    RAISE EXCEPTION 'experience_price_invalid';
  END IF;
  RETURN v_first;
END;
$function$;

COMMIT;

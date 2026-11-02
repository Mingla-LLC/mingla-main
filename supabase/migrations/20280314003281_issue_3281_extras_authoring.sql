-- issue #3281 — Extras, slice 3: organisers author extras in both wizards.
--
-- A ticket tier in the draft and edit payloads may carry
--   extras: [{ id, name, description, priceGbp, isUnlimited, capacity,
--              maxPerTicket, validDayIds }]
-- the same way it carries validDayIds. A payload without the key leaves the
-- tier's extras exactly as they are, so older Host builds can't wipe them.
--
-- Re-emitted from their terminal bodies, with only the marked #3281 changes:
--   issue_1974_normalize_ticket_tiers from 20280228003281_issue_3281_day_limited_tickets.sql
--   issue_3281_keep_draft_day_lists from 20280228003281_issue_3281_day_limited_tickets.sql
--   business_publish_event_draft from 20280228003281_issue_3281_day_limited_tickets.sql
--   business_patch_event_ticket_tiers from 20280228003281_issue_3281_day_limited_tickets.sql
--   business_event_draft_payload_from_graph from 20280228003281_issue_3281_day_limited_tickets.sql
--   issue_3281_strip_removed_days from 20280228003281_issue_3281_day_limited_tickets.sql
--   business_update_live_event_atomic from 20271014103827_issue_3827_live_edit_buyer_email.sql
--
-- Rules, from the approved design (#3283):
--   * An extra belongs to one ticket tier and sells only with it.
--   * Its dates are a subset of the tier's dates; none means every date the
--     tier admits.
--   * Price is never negative; zero is a free extra with its own capacity. A
--     paid extra on a free tier is refused, as checkout refuses it (#4241).
--   * Once an extra has sold, its price is locked, its capacity can't go below
--     what's sold on its busiest date, and a sold date can't be removed.
--     Removing a sold extra stops its sales; what was bought is kept.

BEGIN;

-- Places sold on live orders, all dates or one date.
CREATE FUNCTION public.issue_3281_add_on_sold(p_add_on_id uuid, p_occurrence_key text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(SUM(li.quantity), 0)::integer
    FROM public.order_add_on_line_items li
    JOIN public.orders o ON o.id = li.order_id
   WHERE li.ticket_add_on_id = p_add_on_id
     AND o.payment_status IN ('pending', 'paid', 'partial_refund')
     AND (p_occurrence_key IS NULL OR p_occurrence_key = ANY (li.day_scope_at_order));
$fn$;

-- Validates a tier's extras and returns them in one shape.
CREATE FUNCTION public.issue_3281_normalize_tier_extras(p_extras jsonb, p_tier_free boolean)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_extra jsonb;
  v_out jsonb := '[]'::jsonb;
  v_id text;
  v_name text;
  v_description text;
  v_price numeric;
  v_unlimited boolean;
  v_capacity integer;
  v_max integer;
BEGIN
  IF jsonb_typeof(p_extras) IS DISTINCT FROM 'array' OR jsonb_array_length(p_extras) > 20 THEN
    RAISE EXCEPTION 'invalid_ticket_extras';
  END IF;
  FOR v_extra IN SELECT value FROM jsonb_array_elements(p_extras) LOOP
    IF jsonb_typeof(v_extra) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_ticket_extra'; END IF;
    BEGIN
      v_id := NULLIF(btrim(v_extra->>'id'), '');
      v_name := btrim(COALESCE(v_extra->>'name', ''));
      v_description := NULLIF(btrim(v_extra->>'description'), '');
      v_price := COALESCE(NULLIF(v_extra->>'priceGbp', '')::numeric, 0);
      v_unlimited := COALESCE((v_extra->>'isUnlimited')::boolean, false);
      v_capacity := NULLIF(v_extra->>'capacity', '')::integer;
      v_max := COALESCE(NULLIF(v_extra->>'maxPerTicket', '')::integer, 1);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_ticket_extra';
    END;
    IF v_id IS NULL OR length(v_id) > 100 THEN RAISE EXCEPTION 'invalid_ticket_extra'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) prior WHERE prior->>'id' = v_id) THEN
      RAISE EXCEPTION 'duplicate_ticket_extra_id';
    END IF;
    IF length(v_name) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'ticket_extra_name_invalid'; END IF;
    IF length(COALESCE(v_description, '')) > 280 THEN RAISE EXCEPTION 'ticket_extra_description_too_long'; END IF;
    IF v_price < 0 OR v_price * 100 <> round(v_price * 100) THEN RAISE EXCEPTION 'ticket_extra_price_invalid'; END IF;
    IF v_price > 0 AND p_tier_free THEN RAISE EXCEPTION 'paid_extra_on_free_ticket'; END IF;
    IF v_unlimited AND v_capacity IS NOT NULL THEN RAISE EXCEPTION 'ticket_extra_capacity_invalid'; END IF;
    IF NOT v_unlimited AND COALESCE(v_capacity, 0) < 1 THEN RAISE EXCEPTION 'ticket_extra_capacity_required'; END IF;
    IF v_max NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'ticket_extra_max_invalid'; END IF;
    IF COALESCE(jsonb_typeof(v_extra->'validDayIds'), 'null') <> 'null'
       AND (jsonb_typeof(v_extra->'validDayIds') <> 'array'
         OR jsonb_array_length(v_extra->'validDayIds') = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_extra->'validDayIds') k
                     WHERE jsonb_typeof(k) <> 'string')) THEN
      RAISE EXCEPTION 'ticket_extra_day_scope_empty';
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'name', v_name, 'description', v_description, 'priceGbp', v_price,
      'isUnlimited', v_unlimited, 'capacity', CASE WHEN v_unlimited THEN NULL ELSE v_capacity END,
      'maxPerTicket', v_max,
      'validDayIds', CASE WHEN jsonb_typeof(v_extra->'validDayIds') = 'array'
        THEN v_extra->'validDayIds' ELSE NULL END));
  END LOOP;
  RETURN v_out;
END;
$fn$;

-- An extra's dates must sit inside its tier's dates.
CREATE FUNCTION public.issue_3281_assert_extra_days_in_tier(p_extra_keys text[], p_tier_keys text[])
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_extra_keys IS NOT NULL AND p_tier_keys IS NOT NULL AND NOT (p_extra_keys <@ p_tier_keys) THEN
    RAISE EXCEPTION 'extra_day_scope_outside_ticket';
  END IF;
END;
$fn$;

-- Publish: a tier's draft extras become rows, with draft day ids as keys.
CREATE FUNCTION public.issue_3281_publish_tier_extras(
  p_ticket_type_id uuid, p_tier jsonb, p_when_mode text, p_multi_dates jsonb, p_tier_keys text[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_extra jsonb;
  v_order bigint;
  v_keys text[];
BEGIN
  IF NOT (p_tier ? 'extras') OR jsonb_typeof(p_tier->'extras') = 'null' THEN RETURN; END IF;
  FOR v_extra, v_order IN
    SELECT value, ordinality FROM jsonb_array_elements(public.issue_3281_normalize_tier_extras(
      p_tier->'extras', COALESCE((p_tier->>'isFree')::boolean, false))) WITH ORDINALITY
  LOOP
    -- A draft date deleted after the extra was set up leaves its list here; an
    -- extra that loses every date is refused rather than widened.
    IF jsonb_typeof(v_extra->'validDayIds') = 'array' AND p_when_mode = 'multi_date' THEN
      v_extra := jsonb_set(v_extra, '{validDayIds}', COALESCE((
        SELECT jsonb_agg(k.value) FROM jsonb_array_elements(v_extra->'validDayIds') k
         WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p_multi_dates) e WHERE e->'id' = k.value)
      ), '[]'::jsonb));
      IF jsonb_array_length(v_extra->'validDayIds') = 0 THEN
        RAISE EXCEPTION 'extra_day_scope_empty';
      END IF;
    END IF;
    v_keys := public.issue_3281_draft_ticket_scope(v_extra, p_when_mode, p_multi_dates);
    PERFORM public.issue_3281_assert_extra_days_in_tier(v_keys, p_tier_keys);
    INSERT INTO public.ticket_add_ons (
      ticket_type_id, name, description, price_cents, quantity_total, is_unlimited,
      max_per_ticket, sort_order, valid_occurrence_keys
    ) VALUES (
      p_ticket_type_id, v_extra->>'name', v_extra->>'description',
      round((v_extra->>'priceGbp')::numeric * 100)::integer,
      NULLIF(v_extra->>'capacity', '')::integer, (v_extra->>'isUnlimited')::boolean,
      (v_extra->>'maxPerTicket')::integer, v_order::integer - 1, v_keys);
  END LOOP;
END;
$fn$;

-- Live edit: the listed extras are the tier's extras. New ones are added,
-- listed ones are updated under the sold locks, and unlisted ones stop selling.
CREATE FUNCTION public.issue_3281_sync_live_tier_extras(
  p_ticket_type_id uuid, p_event_id uuid, p_extras jsonb, p_tier_free boolean, p_tier_keys text[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_extra jsonb;
  v_order bigint;
  v_existing public.ticket_add_ons%ROWTYPE;
  v_keys text[];
  v_price integer;
  v_capacity integer;
  v_sold integer;
  v_listed uuid[] := '{}'::uuid[];
  v_new_id uuid;
  v_uuid text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  p_extras := public.issue_3281_normalize_tier_extras(p_extras, p_tier_free);
  -- One lock order with checkout: the tier's extras, by id.
  PERFORM 1 FROM public.ticket_add_ons a WHERE a.ticket_type_id = p_ticket_type_id ORDER BY a.id FOR UPDATE;
  FOR v_extra, v_order IN SELECT value, ordinality FROM jsonb_array_elements(p_extras) WITH ORDINALITY LOOP
    v_existing := NULL::public.ticket_add_ons;
    IF v_extra->>'id' ~ v_uuid THEN
      SELECT * INTO v_existing FROM public.ticket_add_ons a WHERE a.id = (v_extra->>'id')::uuid;
      IF NOT FOUND OR v_existing.ticket_type_id <> p_ticket_type_id THEN
        RAISE EXCEPTION 'ticket_extra_mismatch';
      END IF;
    END IF;
    v_keys := public.issue_3281_resolve_tier_scope(p_event_id, v_extra, v_existing.valid_occurrence_keys);
    PERFORM public.issue_3281_assert_extra_days_in_tier(v_keys, p_tier_keys);
    v_price := round((v_extra->>'priceGbp')::numeric * 100)::integer;
    v_capacity := NULLIF(v_extra->>'capacity', '')::integer;
    IF v_existing.id IS NOT NULL THEN
      v_sold := public.issue_3281_add_on_sold(v_existing.id, NULL);
      IF v_sold > 0 THEN
        -- The floor follows the capacity mode the extra will have: one shared
        -- count with no list, the busiest listed date with one.
        IF v_keys IS NOT NULL THEN
          SELECT COALESCE(MAX(public.issue_3281_add_on_sold(v_existing.id, k)), 0) INTO v_sold
            FROM unnest(v_keys) k;
        END IF;
        IF v_price <> v_existing.price_cents OR COALESCE(v_capacity, 2147483647) < v_sold THEN
          RAISE EXCEPTION 'sold_extra_mutation_blocked';
        END IF;
        -- A date anyone bought it for stays, whatever the old list said.
        IF v_keys IS NOT NULL AND EXISTS (
          SELECT 1
            FROM public.order_add_on_line_items li
            JOIN public.orders o ON o.id = li.order_id
           WHERE li.ticket_add_on_id = v_existing.id
             AND o.payment_status IN ('pending', 'paid', 'partial_refund')
             AND EXISTS (SELECT 1 FROM unnest(li.day_scope_at_order) k WHERE NOT (k = ANY (v_keys)))
        ) THEN
          RAISE EXCEPTION 'extra_day_scope_drops_sold_day';
        END IF;
      END IF;
      UPDATE public.ticket_add_ons SET
        name = v_extra->>'name', description = v_extra->>'description', price_cents = v_price,
        quantity_total = v_capacity, is_unlimited = (v_extra->>'isUnlimited')::boolean,
        max_per_ticket = (v_extra->>'maxPerTicket')::integer, sort_order = v_order::integer - 1,
        valid_occurrence_keys = v_keys, is_active = true, updated_at = now()
      WHERE id = v_existing.id;
      v_listed := v_listed || v_existing.id;
    ELSE
      INSERT INTO public.ticket_add_ons (
        ticket_type_id, name, description, price_cents, quantity_total, is_unlimited,
        max_per_ticket, sort_order, valid_occurrence_keys
      ) VALUES (
        p_ticket_type_id, v_extra->>'name', v_extra->>'description', v_price, v_capacity,
        (v_extra->>'isUnlimited')::boolean, (v_extra->>'maxPerTicket')::integer,
        v_order::integer - 1, v_keys)
      RETURNING id INTO v_new_id;
      v_listed := v_listed || v_new_id;
    END IF;
  END LOOP;
  -- Unlisted extras stop selling. Rows stay, so orders and holds keep them.
  UPDATE public.ticket_add_ons SET is_active = false, updated_at = now()
   WHERE ticket_type_id = p_ticket_type_id AND is_active AND NOT (id = ANY (v_listed));
END;
$fn$;

-- A tier edited without its extras keeps them, and they must still fit it:
-- no paid extra on a free tier, and no extra dated outside the tier's dates.
CREATE FUNCTION public.issue_3281_assert_kept_extras_fit_tier(
  p_ticket_type_id uuid, p_tier_free boolean, p_tier_keys text[]
) RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_tier_free AND EXISTS (
    SELECT 1 FROM public.ticket_add_ons a
     WHERE a.ticket_type_id = p_ticket_type_id AND a.is_active AND a.price_cents > 0
  ) THEN
    RAISE EXCEPTION 'paid_extra_on_free_ticket';
  END IF;
  IF p_tier_keys IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ticket_add_ons a
     WHERE a.ticket_type_id = p_ticket_type_id AND a.is_active
       AND a.valid_occurrence_keys IS NOT NULL AND NOT (a.valid_occurrence_keys <@ p_tier_keys)
  ) THEN
    RAISE EXCEPTION 'extra_day_scope_outside_ticket';
  END IF;
END;
$fn$;

-- A live tier's extras, in the payload shape the wizards edit.
CREATE FUNCTION public.issue_3281_tier_extras_json(p_ticket_type_id uuid, p_with_sales boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id::text, 'name', a.name, 'description', a.description,
    'priceGbp', a.price_cents / 100.0, 'isUnlimited', a.is_unlimited,
    'capacity', a.quantity_total, 'maxPerTicket', a.max_per_ticket,
    'validDayIds', to_jsonb(a.valid_occurrence_keys)
  ) || CASE WHEN p_with_sales THEN jsonb_build_object(
    -- Total sales lock the price; the capacity floor follows the extra's mode.
    'soldCount', public.issue_3281_add_on_sold(a.id, NULL),
    'capacityFloor', CASE WHEN a.valid_occurrence_keys IS NULL
      THEN public.issue_3281_add_on_sold(a.id, NULL)
      ELSE (SELECT COALESCE(MAX(public.issue_3281_add_on_sold(a.id, k)), 0)
              FROM unnest(a.valid_occurrence_keys) k) END,
    -- The dates someone bought it for: only these are locked on the list.
    'soldDayIds', to_jsonb(ARRAY(
      SELECT DISTINCT k
        FROM public.order_add_on_line_items li
        JOIN public.orders o ON o.id = li.order_id,
             unnest(li.day_scope_at_order) k
       WHERE li.ticket_add_on_id = a.id
         AND o.payment_status IN ('pending', 'paid', 'partial_refund')
       ORDER BY k))
  ) ELSE '{}'::jsonb END ORDER BY a.sort_order, a.id), '[]'::jsonb)
  FROM public.ticket_add_ons a
  WHERE a.ticket_type_id = p_ticket_type_id AND a.is_active;
$fn$;

-- The Host reads tiers straight from ticket_types, which carries no extras, so
-- event managers read a live event's extras here, keyed by ticket type id.
-- Anyone else gets an empty map rather than an error.
CREATE FUNCTION public.business_event_ticket_extras(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_brand uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF v_brand IS NULL
     OR public.biz_brand_effective_rank(v_brand, auth.uid()) < public.biz_role_rank('event_manager') THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_object_agg(tt.id::text, public.issue_3281_tier_extras_json(tt.id))
      FROM public.ticket_types tt
     WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM public.ticket_add_ons a WHERE a.ticket_type_id = tt.id AND a.is_active)
  ), '{}'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_event_ticket_extras(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_event_ticket_extras(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_add_on_sold(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_normalize_tier_extras(jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_assert_extra_days_in_tier(text[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_publish_tier_extras(uuid, jsonb, text, jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_sync_live_tier_extras(uuid, uuid, jsonb, boolean, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_tier_extras_json(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_assert_kept_extras_fit_tier(uuid, boolean, text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_1974_normalize_ticket_tiers(p_tiers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier jsonb;
  v_out jsonb := '[]'::jsonb;
  v_id text;
  v_name text;
  v_free boolean;
  v_unlimited boolean;
  v_price numeric;
  v_capacity integer;
  v_visibility text;
  v_order integer;
  v_min integer;
  v_max integer;
  v_description text;
  v_start timestamptz;
  v_end timestamptz;
  v_available text;
BEGIN
  IF jsonb_typeof(p_tiers) IS DISTINCT FROM 'array' OR jsonb_array_length(p_tiers) > 50 THEN
    RAISE EXCEPTION 'invalid_ticket_tiers';
  END IF;

  FOR v_tier IN SELECT value FROM jsonb_array_elements(p_tiers)
  LOOP
    BEGIN
      v_id := NULLIF(v_tier->>'id', '');
      v_name := btrim(COALESCE(v_tier->>'name', ''));
      v_free := COALESCE((v_tier->>'isFree')::boolean, false);
      v_unlimited := COALESCE((v_tier->>'isUnlimited')::boolean, false);
      v_price := NULLIF(v_tier->>'priceGbp', '')::numeric;
      v_capacity := NULLIF(v_tier->>'capacity', '')::integer;
      v_visibility := COALESCE(NULLIF(v_tier->>'visibility', ''), 'public');
      v_order := COALESCE(NULLIF(v_tier->>'displayOrder', '')::integer, jsonb_array_length(v_out));
      v_min := COALESCE(NULLIF(v_tier->>'minPurchaseQty', '')::integer, 1);
      v_max := NULLIF(v_tier->>'maxPurchaseQty', '')::integer;
      v_description := NULLIF(btrim(v_tier->>'description'), '');
      v_start := NULLIF(v_tier->>'saleStartAt', '')::timestamptz;
      v_end := NULLIF(v_tier->>'saleEndAt', '')::timestamptz;
      v_available := COALESCE(NULLIF(v_tier->>'availableAt', ''), 'both');
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_ticket_tier';
    END;

    IF v_id IS NULL OR length(v_id)>100 OR v_name = '' THEN RAISE EXCEPTION 'invalid_ticket_tier'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) prior WHERE prior->>'id'=v_id) THEN
      RAISE EXCEPTION 'duplicate_ticket_tier_id';
    END IF;
    IF v_visibility NOT IN ('public','hidden','disabled') OR v_available NOT IN ('online','door','both') THEN
      RAISE EXCEPTION 'invalid_ticket_tier';
    END IF;
    IF v_free AND COALESCE(v_price,0) <> 0 THEN RAISE EXCEPTION 'free_ticket_price_invalid'; END IF;
    IF NOT v_free AND COALESCE(v_price,0) <= 0 THEN RAISE EXCEPTION 'paid_ticket_price_required'; END IF;
    IF v_unlimited AND v_capacity IS NOT NULL THEN RAISE EXCEPTION 'unlimited_ticket_capacity_invalid'; END IF;
    IF NOT v_unlimited AND COALESCE(v_capacity,0) <= 0 THEN RAISE EXCEPTION 'ticket_capacity_required'; END IF;
    IF v_unlimited AND COALESCE((v_tier->>'waitlistEnabled')::boolean,false) THEN
      RAISE EXCEPTION 'unlimited_ticket_waitlist_invalid';
    END IF;
    IF v_min < 1 OR (v_max IS NOT NULL AND v_max < v_min) THEN RAISE EXCEPTION 'ticket_purchase_limits_invalid'; END IF;
    IF length(COALESCE(v_description,'')) > 280 THEN RAISE EXCEPTION 'ticket_description_too_long'; END IF;
    IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end <= v_start THEN RAISE EXCEPTION 'ticket_sale_window_invalid'; END IF;
    IF v_order < 0 THEN RAISE EXCEPTION 'ticket_display_order_invalid'; END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id',v_id,
      'name',v_name,
      'isFree',v_free,
      'isUnlimited',v_unlimited,
      'priceGbp',CASE WHEN v_free THEN NULL ELSE v_price END,
      'capacity',CASE WHEN v_unlimited THEN NULL ELSE v_capacity END,
      'visibility',v_visibility,
      'displayOrder',v_order,
      'approvalRequired',COALESCE((v_tier->>'approvalRequired')::boolean,false),
      'passwordProtected',COALESCE((v_tier->>'passwordProtected')::boolean,false),
      'passwordConfigured',COALESCE((v_tier->>'passwordConfigured')::boolean,false),
      'waitlistEnabled',COALESCE((v_tier->>'waitlistEnabled')::boolean,false),
      'minPurchaseQty',v_min,
      'maxPurchaseQty',v_max,
      'allowTransfers',COALESCE((v_tier->>'allowTransfers')::boolean,true),
      'description',v_description,
      'saleStartAt',v_start,
      'saleEndAt',v_end,
      'availableAt',v_available
    ) || CASE WHEN v_tier ? 'validDayIds'
      THEN jsonb_build_object('validDayIds',v_tier->'validDayIds')
      ELSE '{}'::jsonb END
      -- issue #3281 — extras ride their tier, validated; no key keeps them.
      || CASE WHEN v_tier ? 'extras' AND jsonb_typeof(v_tier->'extras') <> 'null'
      THEN jsonb_build_object('extras',public.issue_3281_normalize_tier_extras(v_tier->'extras',v_free))
      ELSE '{}'::jsonb END);
  END LOOP;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3281_keep_draft_day_lists(p_new jsonb, p_old jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN jsonb_typeof(p_new) IS DISTINCT FROM 'array' THEN p_new ELSE COALESCE((
    SELECT jsonb_agg(
      (CASE WHEN rows.tier ? 'validDayIds' THEN rows.tier
        ELSE rows.tier || COALESCE((
          SELECT jsonb_build_object('validDayIds', old_tier->'validDayIds')
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(p_old) = 'array' THEN p_old ELSE '[]'::jsonb END) old_tier
           WHERE old_tier->>'id' = rows.tier->>'id' AND old_tier ? 'validDayIds'
           LIMIT 1
        ), '{}'::jsonb) END)
      -- issue #3281 — and the extras, the same way.
      || CASE WHEN rows.tier ? 'extras' THEN '{}'::jsonb ELSE COALESCE((
          SELECT jsonb_build_object('extras', old_tier->'extras')
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(p_old) = 'array' THEN p_old ELSE '[]'::jsonb END) old_tier
           WHERE old_tier->>'id' = rows.tier->>'id' AND old_tier ? 'extras'
           LIMIT 1
        ), '{}'::jsonb) END
      ORDER BY rows.ordinality)
      FROM jsonb_array_elements(p_new) WITH ORDINALITY rows(tier, ordinality)
  ), '[]'::jsonb) END;
$fn$;

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
  v_ticket_type_id uuid; -- issue #3281
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
  -- issue #3281 — a client that predates day lists cannot widen a ticket.
  v_tickets := public.issue_3281_keep_draft_day_lists(v_tickets,
    (SELECT e.theme#>'{business_draft,tickets}' FROM public.events e WHERE e.id = p_event_id));
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
    -- issue #3281 — the organiser's day id is the stable key a ticket scopes to.
    PERFORM public.issue_3281_sync_occurrence_keys(p_event_id, v_multi_dates);
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
      valid_occurrence_keys,
      event_id, name, description, price_cents, currency,
      quantity_total, is_unlimited, is_free,
      sale_start_at, sale_end_at,
      min_purchase_qty, max_purchase_qty,
      is_hidden, is_disabled, requires_approval, allow_transfers,
      password_protected, password_hash,
      available_online, available_in_person,
      waitlist_enabled, display_order, deleted_at
    ) VALUES (
      public.issue_3281_draft_ticket_scope(v_ticket, v_when_mode, v_multi_dates),
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
    ) RETURNING id INTO v_ticket_type_id;
    -- issue #3281 — the tier's extras, inside its dates.
    PERFORM public.issue_3281_publish_tier_extras(
      v_ticket_type_id, v_ticket, v_when_mode, v_multi_dates,
      (SELECT tt.valid_occurrence_keys FROM public.ticket_types tt WHERE tt.id = v_ticket_type_id));
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

CREATE OR REPLACE FUNCTION public.business_patch_event_ticket_tiers(p_event_id uuid, p_tiers jsonb, p_expected_event_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expected_client_revision integer DEFAULT NULL::integer, p_operation_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_tiers jsonb;
  v_tier jsonb;
  v_existing public.ticket_types%ROWTYPE;
  v_current_revision integer;
  v_next_revision integer;
  v_sold integer;
  v_currency char(3);
  v_password_hash text;
  v_result_tiers jsonb;
  v_per_occurrence boolean; -- issue #3313
  v_scope text[]; -- issue #3281: NULL means All dates
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_event_id IS NULL OR p_tiers IS NULL THEN RAISE EXCEPTION 'invalid_ticket_tiers'; END IF;
  IF p_operation_id IS NOT NULL AND p_operation_id::text = '' THEN RAISE EXCEPTION 'invalid_operation_id'; END IF;

  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_event.event_type NOT IN ('event','experience') THEN RAISE EXCEPTION 'event_ticket_type_unsupported'; END IF;
  IF v_event.status NOT IN ('draft','scheduled','live') THEN RAISE EXCEPTION 'event_not_editable_status'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF p_expected_event_updated_at IS NOT NULL AND v_event.updated_at IS DISTINCT FROM p_expected_event_updated_at THEN
    RAISE EXCEPTION 'stale_event_revision';
  END IF;

  v_tiers := public.issue_1974_normalize_ticket_tiers(p_tiers);
  SELECT upper(COALESCE(v_event.currency::text,sca.default_currency::text,b.default_currency::text))::char(3)
    INTO v_currency
    FROM public.brands b
    LEFT JOIN public.stripe_connect_accounts sca ON sca.brand_id=b.id AND sca.detached_at IS NULL
   WHERE b.id=v_event.brand_id;

  IF v_currency IS NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_tiers) t
    WHERE NOT COALESCE((t->>'isFree')::boolean,false)
      AND round((t->>'priceGbp')::numeric*100)>0
  ) THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  IF v_event.status='draft' THEN
    v_current_revision := COALESCE(NULLIF(v_event.theme->'business_draft'->>'clientRevision','')::integer,0);
    IF p_expected_client_revision IS NULL OR p_expected_client_revision <> v_current_revision THEN
      RAISE EXCEPTION 'stale_client_revision';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'draft_ticket_projection_conflict';
    END IF;
    -- A draft tier id belongs only to the draft JSON graph. Reusing an id from
    -- any live ticket or from the separate trip-pricing graph would make the
    -- caller's lifecycle intent ambiguous and can poison deterministic retry.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_tiers) t
      WHERE EXISTS (
              SELECT 1 FROM public.ticket_types tt
              WHERE tt.id=CASE
                WHEN (t->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (t->>'id')::uuid ELSE NULL END
            )
         OR EXISTS (
              SELECT 1 FROM public.trip_pricing_tiers trip
              WHERE trip.id=CASE
                WHEN (t->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (t->>'id')::uuid ELSE NULL END
            )
    ) THEN RAISE EXCEPTION 'ticket_lifecycle_mismatch'; END IF;
    -- Collection readiness is required only for a new or newly-paid tier. An
    -- unrelated edit to an already-paid tier must not become hostage to a later
    -- provider disconnect; checkout remains independently fail closed.
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_tiers) t
      LEFT JOIN LATERAL (
        SELECT old_tier
        FROM jsonb_array_elements(COALESCE(v_event.theme->'business_draft'->'tickets','[]'::jsonb)) old_tier
        WHERE old_tier->>'id'=t->>'id'
        LIMIT 1
      ) previous ON true
      WHERE NOT (t->>'isFree')::boolean
        AND (previous.old_tier IS NULL OR COALESCE((previous.old_tier->>'isFree')::boolean,true))
    ) AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
      RAISE EXCEPTION 'payout_not_ready';
    END IF;
    v_next_revision := v_current_revision+1;
    -- issue #3281 — no validDayIds key keeps the draft's list, as on a live edit.
    v_tiers := public.issue_3281_keep_draft_day_lists(v_tiers, v_event.theme->'business_draft'->'tickets');
    UPDATE public.events
       SET theme=jsonb_set(
             COALESCE(theme,'{}'::jsonb),
             '{business_draft}',
             COALESCE(theme->'business_draft','{}'::jsonb) || jsonb_build_object(
               'tickets',v_tiers,
               'clientRevision',v_next_revision
             ),
             true
           ),
           currency=CASE WHEN EXISTS(
             SELECT 1 FROM jsonb_array_elements(v_tiers) t
             WHERE NOT COALESCE((t->>'isFree')::boolean,false)
           ) THEN v_currency ELSE currency END,
           updated_at=now()
     WHERE id=p_event_id;
  ELSE
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 200 THEN
      RAISE EXCEPTION 'invalid_edit_reason';
    END IF;

    -- Business creates new client-side tiers with the established `t_*`
    -- temporary identity. Resolve those markers inside this transaction before
    -- validating or writing the graph; any other malformed identity remains a
    -- hard failure. The #1972 client revision gate makes an ambiguous retry
    -- stale instead of creating a second row.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_tiers) t
      WHERE (t->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (t->>'id') !~ '^t_[a-z0-9]+$'
    ) THEN RAISE EXCEPTION 'live_ticket_id_must_be_uuid'; END IF;
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN tier->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN tier
        ELSE jsonb_set(tier,'{id}',to_jsonb(gen_random_uuid()::text),false)
      END
      ORDER BY ordinality
    ),'[]'::jsonb)
    INTO v_tiers
    FROM jsonb_array_elements(v_tiers) WITH ORDINALITY rows(tier,ordinality);

    -- Supplied ids may be new or belong to this event, never another graph.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_tiers) t
      JOIN public.ticket_types tt ON tt.id=(t->>'id')::uuid
      WHERE tt.event_id<>p_event_id OR tt.deleted_at IS NOT NULL
    ) THEN RAISE EXCEPTION 'ticket_event_mismatch'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_tiers) t
      JOIN public.trip_pricing_tiers trip ON trip.id=(t->>'id')::uuid
    ) THEN RAISE EXCEPTION 'ticket_lifecycle_mismatch'; END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_tiers) t
      LEFT JOIN public.ticket_types existing_tier
        ON existing_tier.id=(t->>'id')::uuid AND existing_tier.event_id=p_event_id AND existing_tier.deleted_at IS NULL
      WHERE NOT (t->>'isFree')::boolean
        AND (existing_tier.id IS NULL OR existing_tier.is_free)
    ) AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
      RAISE EXCEPTION 'payout_not_ready';
    END IF;

    -- Removed tiers are soft-deleted only when no ticket has ever been issued.
    FOR v_existing IN
      SELECT * FROM public.ticket_types tt
      WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_tiers) t WHERE (t->>'id')::uuid=tt.id)
      FOR UPDATE
    LOOP
      SELECT count(*)::integer INTO v_sold FROM public.tickets tk
      WHERE tk.ticket_type_id=v_existing.id AND tk.status IN ('valid','used','transferred');
      IF v_sold>0 THEN RAISE EXCEPTION 'tier_delete_with_sales'; END IF;
      UPDATE public.ticket_types SET deleted_at=now(),is_disabled=true,updated_at=now() WHERE id=v_existing.id;
    END LOOP;

    FOR v_tier IN SELECT value FROM jsonb_array_elements(v_tiers)
    LOOP
      SELECT * INTO v_existing FROM public.ticket_types
      WHERE id=(v_tier->>'id')::uuid AND event_id=p_event_id AND deleted_at IS NULL FOR UPDATE;
      IF FOUND THEN
        v_scope := public.issue_3281_resolve_tier_scope(p_event_id, v_tier, v_existing.valid_occurrence_keys);
        SELECT count(*)::integer INTO v_sold FROM public.tickets tk
        WHERE tk.ticket_type_id=v_existing.id AND tk.status IN ('valid','used','transferred');
        -- issue #3313 — on a recurring event capacity is PER NIGHT, so the
        -- floor below is the BUSIEST night's issued passes, not the run's
        -- total. v_sold stays > 0 exactly when any pass is live, so the price
        -- and free/paid locks are unchanged.
        IF v_sold > 0 THEN
          IF v_per_occurrence IS NULL THEN
            v_per_occurrence := COALESCE(
              (public.issue_3313_event_day_choice(p_event_id) ->> 'perOccurrenceCapacity')::boolean,
              false);
          END IF;
          -- issue #3281 — a day-limited ticket's capacity is per date too.
          IF v_per_occurrence OR v_scope IS NOT NULL THEN
            SELECT COALESCE(MAX(public.issue_3313_ticket_type_occurrence_sold(v_existing.id, d.id)), v_sold)
              INTO v_sold
              FROM public.event_dates d
             WHERE d.event_id = p_event_id;
          END IF;
        END IF;
        -- ══ issue #2590 — THE LOCK NOW COVERS ONLY WHAT IT PROTECTS ═══════
        -- This guard froze EIGHT things the moment a single ticket sold. Three
        -- of them genuinely change a deal an existing holder already accepted.
        -- The other five took nothing away from anyone, and freezing them turned
        -- an ordinary correction into a permanent mistake.
        --
        -- Proven on a live event: We Go Again Exhibition's sales were set to
        -- close 07:00 on the morning of Day 2 — six hours BEFORE doors — almost
        -- certainly 19:00 misread on a 12-hour picker. 124 tickets had sold, so
        -- the organiser could not correct it from the product at all. Every
        -- attempt raised here, and the screen redrew the old value with no
        -- message (`sold_ticket_mutation_blocked` has no organiser copy).
        --
        -- STILL LOCKED, and each for the same reason — it rewrites a deal
        -- somebody already accepted:
        --   * price_cents  — what they agreed to pay
        --   * is_free      — whether they agreed to pay at all
        --   * capacity     — only BELOW the number already issued, which would
        --                    invalidate real tickets. Raising it stays free.
        --
        -- NO LONGER LOCKED, because an issued ticket is unaffected by any of it:
        --   * is_hidden / is_disabled — hiding or pausing a tier stops FUTURE
        --     sales. Pausing mid-event is an ordinary operational need, and the
        --     holders keep their tickets either way.
        --   * available_online — same shape. Turning it off stops future online
        --     sales; turning it on harms nobody. The client warns on the
        --     off direction rather than the server refusing it.
        --   * sale_start_at / sale_end_at — when the window opens and closes.
        --     Moving it cannot reach backwards and un-issue a ticket.
        --
        -- Deleting a tier with sales is still refused, above, by
        -- `tier_delete_with_sales`. That one does destroy real tickets.
        --
        -- DELETE THE THREE REMAINING CLAUSES and a sold-out tier's price becomes
        -- editable, which is the defect this guard exists to prevent.
        IF v_sold>0 AND (
          v_existing.price_cents IS DISTINCT FROM CASE WHEN (v_tier->>'isFree')::boolean THEN 0 ELSE round((v_tier->>'priceGbp')::numeric*100)::integer END OR
          v_existing.is_free IS DISTINCT FROM (v_tier->>'isFree')::boolean OR
          COALESCE((v_tier->>'capacity')::integer,2147483647)<v_sold
        ) THEN RAISE EXCEPTION 'sold_ticket_mutation_blocked'; END IF;
        IF (v_tier->>'passwordProtected')::boolean AND v_existing.password_hash IS NULL THEN
          RAISE EXCEPTION 'ticket_password_setup_required';
        END IF;
        v_password_hash:=v_existing.password_hash;
        UPDATE public.ticket_types SET
          name=v_tier->>'name',description=NULLIF(v_tier->>'description',''),
          price_cents=CASE WHEN (v_tier->>'isFree')::boolean THEN 0 ELSE round((v_tier->>'priceGbp')::numeric*100)::integer END,
          currency=CASE WHEN (v_tier->>'isFree')::boolean THEN v_existing.currency ELSE v_currency END,
          quantity_total=NULLIF(v_tier->>'capacity','')::integer,is_unlimited=(v_tier->>'isUnlimited')::boolean,
          is_free=(v_tier->>'isFree')::boolean,sale_start_at=NULLIF(v_tier->>'saleStartAt','')::timestamptz,
          sale_end_at=NULLIF(v_tier->>'saleEndAt','')::timestamptz,min_purchase_qty=(v_tier->>'minPurchaseQty')::integer,
          max_purchase_qty=NULLIF(v_tier->>'maxPurchaseQty','')::integer,is_hidden=(v_tier->>'visibility')='hidden',
          is_disabled=(v_tier->>'visibility')='disabled',requires_approval=(v_tier->>'approvalRequired')::boolean,
          allow_transfers=(v_tier->>'allowTransfers')::boolean,password_protected=(v_tier->>'passwordProtected')::boolean,
          password_hash=v_password_hash,available_online=(v_tier->>'availableAt') IN ('online','both'),
          available_in_person=(v_tier->>'availableAt') IN ('door','both'),waitlist_enabled=(v_tier->>'waitlistEnabled')::boolean,
          display_order=(v_tier->>'displayOrder')::integer,updated_at=now(),
          valid_occurrence_keys=v_scope
        WHERE id=v_existing.id;
      ELSE
        IF (v_tier->>'passwordProtected')::boolean THEN RAISE EXCEPTION 'ticket_password_setup_required'; END IF;
        v_scope := public.issue_3281_resolve_tier_scope(p_event_id, v_tier, NULL);
        INSERT INTO public.ticket_types(
          valid_occurrence_keys,id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,
          sale_start_at,sale_end_at,min_purchase_qty,max_purchase_qty,is_hidden,is_disabled,
          requires_approval,allow_transfers,password_protected,available_online,available_in_person,
          waitlist_enabled,display_order
        ) VALUES (
          v_scope,(v_tier->>'id')::uuid,p_event_id,v_tier->>'name',NULLIF(v_tier->>'description',''),
          CASE WHEN (v_tier->>'isFree')::boolean THEN 0 ELSE round((v_tier->>'priceGbp')::numeric*100)::integer END,
          CASE WHEN (v_tier->>'isFree')::boolean THEN NULL ELSE v_currency END,NULLIF(v_tier->>'capacity','')::integer,
          (v_tier->>'isUnlimited')::boolean,(v_tier->>'isFree')::boolean,NULLIF(v_tier->>'saleStartAt','')::timestamptz,
          NULLIF(v_tier->>'saleEndAt','')::timestamptz,(v_tier->>'minPurchaseQty')::integer,
          NULLIF(v_tier->>'maxPurchaseQty','')::integer,(v_tier->>'visibility')='hidden',(v_tier->>'visibility')='disabled',
          (v_tier->>'approvalRequired')::boolean,(v_tier->>'allowTransfers')::boolean,false,
          (v_tier->>'availableAt') IN ('online','both'),(v_tier->>'availableAt') IN ('door','both'),
          (v_tier->>'waitlistEnabled')::boolean,(v_tier->>'displayOrder')::integer
        );
      END IF;
      -- issue #3281 — a tier sent with extras gets exactly those extras.
      IF v_tier ? 'extras' THEN
        PERFORM public.issue_3281_sync_live_tier_extras((v_tier->>'id')::uuid, p_event_id,
          v_tier->'extras', (v_tier->>'isFree')::boolean, v_scope);
      ELSE
        -- Kept extras must still fit the edited tier.
        PERFORM public.issue_3281_assert_kept_extras_fit_tier((v_tier->>'id')::uuid,
          (v_tier->>'isFree')::boolean, v_scope);
      END IF;
    END LOOP;
    UPDATE public.events SET updated_at=now() WHERE id=p_event_id;
  END IF;

  SELECT e.currency INTO v_currency FROM public.events e WHERE e.id=p_event_id;
  IF v_event.status='draft' THEN
    SELECT e.theme->'business_draft'->'tickets' INTO v_result_tiers FROM public.events e WHERE e.id=p_event_id;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',tt.id::text,'name',tt.name,'isFree',tt.is_free,'isUnlimited',tt.is_unlimited,
      'priceGbp',CASE WHEN tt.is_free THEN NULL ELSE tt.price_cents::numeric/100 END,
      'capacity',tt.quantity_total,'visibility',CASE WHEN tt.is_hidden THEN 'hidden' WHEN tt.is_disabled THEN 'disabled' ELSE 'public' END,
      'displayOrder',tt.display_order,'approvalRequired',tt.requires_approval,'passwordProtected',tt.password_protected,
      'passwordConfigured',tt.password_hash IS NOT NULL,'waitlistEnabled',tt.waitlist_enabled,
      'validDayIds',to_jsonb(tt.valid_occurrence_keys),
      'extras',public.issue_3281_tier_extras_json(tt.id),
      'minPurchaseQty',tt.min_purchase_qty,'maxPurchaseQty',tt.max_purchase_qty,'allowTransfers',tt.allow_transfers,
      'description',tt.description,'saleStartAt',tt.sale_start_at,'saleEndAt',tt.sale_end_at,
      'availableAt',CASE WHEN tt.available_online AND tt.available_in_person THEN 'both' WHEN tt.available_in_person THEN 'door' ELSE 'online' END
    ) ORDER BY tt.display_order),'[]'::jsonb) INTO v_result_tiers
    FROM public.ticket_types tt WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  END IF;
  RETURN jsonb_build_object(
    'event_id',p_event_id,'operation_id',p_operation_id,'representation',CASE WHEN v_event.status='draft' THEN 'draft' ELSE 'live' END,
    'effective_currency',v_currency,'tiers',v_result_tiers,
    'client_revision',CASE WHEN v_event.status='draft' THEN v_next_revision ELSE NULL END,
    'updated_at',(SELECT updated_at FROM public.events WHERE id=p_event_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_event_draft_payload_from_graph(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
  v_business jsonb;
  v_tickets jsonb;
  v_dates jsonb;
  v_when_mode text;
  v_when jsonb;
  v_multi jsonb;
  v_requested_visibility text;
BEGIN
  SELECT * INTO v_event FROM public.events
   WHERE id = p_event_id AND deleted_at IS NULL;
  IF NOT FOUND OR v_event.event_type <> 'event' THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, auth.uid())
       < public.biz_role_rank('scanner') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tt.id::text,
    'name', tt.name,
    'description', tt.description,
    'priceGbp', CASE WHEN tt.price_cents IS NULL THEN NULL ELSE tt.price_cents / 100.0 END,
    'currency', btrim(tt.currency::text),
    'capacity', tt.quantity_total,
    'isFree', tt.is_free,
    'isUnlimited', tt.is_unlimited,
    'visibility', CASE WHEN tt.is_disabled THEN 'disabled' WHEN tt.is_hidden THEN 'hidden' ELSE 'public' END,
    'displayOrder', tt.display_order,
    'validDayIds', to_jsonb(tt.valid_occurrence_keys),
    -- No sales metadata: a draft (or a duplicate) has sold nothing.
    'extras', public.issue_3281_tier_extras_json(tt.id, false),
    'approvalRequired', tt.requires_approval,
    'passwordProtected', tt.password_protected,
    'passwordConfigured', tt.password_hash IS NOT NULL,
    'password', NULL,
    'waitlistEnabled', tt.waitlist_enabled,
    'minPurchaseQty', tt.min_purchase_qty,
    'maxPurchaseQty', tt.max_purchase_qty,
    'allowTransfers', tt.allow_transfers,
    'saleStartAt', tt.sale_start_at,
    'saleEndAt', tt.sale_end_at,
    'availableAt', CASE WHEN tt.available_online AND tt.available_in_person THEN 'both'
      WHEN tt.available_online THEN 'online' ELSE 'door' END
  ) ORDER BY tt.display_order, tt.created_at), '[]'::jsonb)
  INTO v_tickets FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL;
  IF v_event.status='draft' THEN
    v_tickets:=COALESCE(v_event.theme#>'{business_draft,tickets}',v_tickets);
  END IF;

  -- Draft schedule topology is typed but deliberately not materialized in
  -- event_dates until publish. Preserve that canonical payload byte-for-byte.
  IF v_event.status = 'draft' THEN
    v_when_mode := COALESCE(v_event.theme#>>'{business_draft,whenMode}', 'single');
    v_when := v_event.theme#>'{business_draft,when}';
    v_multi := v_event.theme#>'{business_draft,multiDates}';
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'date', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'YYYY-MM-DD'),
      'startTime', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
      'endTime', to_char(ed.end_at AT TIME ZONE v_event.timezone, 'HH24:MI')
    ) || CASE WHEN ed.occurrence_key IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object('id', ed.occurrence_key) END
    ORDER BY ed.start_at), '[]'::jsonb)
    INTO v_dates FROM public.event_dates ed WHERE ed.event_id = p_event_id;

    v_when_mode := CASE WHEN v_event.is_multi_date THEN 'multi_date'
      WHEN v_event.is_recurring THEN 'recurring' ELSE 'single' END;
    SELECT jsonb_build_object(
      'date', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'YYYY-MM-DD'),
      'doorsOpen', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
      'endsAt', to_char(ed.end_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
      'timezone', v_event.timezone
    ) INTO v_when FROM public.event_dates ed
    WHERE ed.event_id = p_event_id AND ed.is_master ORDER BY ed.start_at LIMIT 1;
    v_multi := CASE WHEN v_when_mode = 'multi_date' THEN v_dates ELSE NULL END;
  END IF;

  IF v_event.status='draft' THEN
    v_requested_visibility:=public.business_assert_event_visibility(
      v_event.theme#>'{business_draft,requestedVisibility}'
    );
  ELSIF v_event.visibility='public' THEN
    v_requested_visibility:='public';
  ELSIF v_event.visibility='hidden' THEN
    v_requested_visibility:='unlisted';
  ELSIF v_event.visibility='private' THEN
    v_requested_visibility:='private';
  ELSE
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;

  v_business := COALESCE(v_event.theme->'business_draft', v_event.theme->'business_event', '{}'::jsonb)
    || jsonb_build_object(
      'schemaVersion', 1,
      'legacyLocalDraftId', NULL,
      -- issue #2353 — is_online is a TWO-valued projection of a THREE-valued
      -- enum (serverDraftEventMapper.ts:708 writes
      -- `format === "online" || format === "hybrid"`), so deriving format from
      -- it cannot distinguish online from hybrid and makes 'hybrid'
      -- unreachable as an output. business_unpublish_event_to_draft:979
      -- installs this payload with `theme = v_payload->'theme'`, a WHOLESALE
      -- replace, so the stored value was overwritten and unrecoverable — a
      -- host tapping Duplicate or Unpublish on a hybrid event got it back
      -- relabelled Online. Read the stored enum first, exactly as the client's
      -- asFormat/asDraftFormat already do; fall back to the is_online
      -- derivation ONLY when nothing valid is stored, which is the pre-#2089
      -- behaviour and never a fabricated 'hybrid'.
      'format', CASE
        WHEN lower(btrim(COALESCE(v_event.theme#>>'{business_event,format}',
                                  v_event.theme#>>'{business_draft,format}',''), E' \t\n\r\f\v'||chr(160)))
             IN ('in_person','online','hybrid')
        THEN lower(btrim(COALESCE(v_event.theme#>>'{business_event,format}',
                                  v_event.theme#>>'{business_draft,format}'), E' \t\n\r\f\v'||chr(160)))
        WHEN v_event.is_online THEN 'online'
        ELSE 'in_person'
      END,
      'partyTypes', to_jsonb(COALESCE(v_event.party_types, ARRAY[]::text[])),
      'vibeTags', to_jsonb(COALESCE(v_event.vibe_tags, ARRAY[]::text[])),
      'musicGenres', to_jsonb(COALESCE(v_event.music_genres, ARRAY[]::text[])),
      'city', v_event.city,
      'locationGeo', CASE WHEN v_event.location_geo IS NULL THEN NULL ELSE
        jsonb_build_object('lng', (v_event.location_geo)[0], 'lat', (v_event.location_geo)[1]) END,
      'requestedVisibility', v_requested_visibility,
      'coverHue', COALESCE((v_event.theme->>'coverHue')::numeric, 25),
      'coverProvider', jsonb_build_object(
        'provider', v_event.cover_media_provider,
        'sourceUrl', v_event.cover_media_source_url,
        'credit', v_event.cover_media_credit,
        'creditUrl', v_event.cover_media_credit_url,
        'alt', v_event.cover_media_alt),
      'currency', btrim(v_event.currency::text),
      'whenMode', v_when_mode,
      'when', v_when,
      'recurrenceRule', CASE WHEN v_event.status='draft'
        THEN v_event.theme#>'{business_draft,recurrenceRule}'
        ELSE v_event.recurrence_rules END,
      'multiDates', v_multi,
      'location', CASE WHEN v_event.status='draft' THEN
        COALESCE(v_event.theme#>'{business_draft,location}',
          jsonb_build_object('venueName',v_event.location_text,'address',NULL))
        ELSE jsonb_build_object('venueName',v_event.location_text,'address',NULL) END,
      'tickets', v_tickets,
      'lastStepReached', 6,
      'clientRevision', COALESCE(
        (v_event.theme#>>'{business_draft,clientRevision}')::integer,
        (v_event.theme#>>'{business_event,clientRevision}')::integer,0)
    );

  RETURN to_jsonb(v_event) || jsonb_build_object(
    'theme', (COALESCE(v_event.theme, '{}'::jsonb) - 'business_event' - 'business_draft')
      || jsonb_build_object('business_draft', v_business),
    'visibility', 'draft', 'status', 'draft'
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3281_strip_removed_days(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ticket record;
  v_kept text[];
  v_extra record; -- issue #3281
BEGIN
  FOR v_ticket IN
    SELECT tt.id, tt.valid_occurrence_keys
      FROM public.ticket_types tt
     WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL
       AND tt.valid_occurrence_keys IS NOT NULL
     ORDER BY tt.id
       FOR UPDATE
  LOOP
    SELECT array_agg(d.occurrence_key ORDER BY d.occurrence_key) INTO v_kept
      FROM public.event_dates d
     WHERE d.event_id = p_event_id
       AND d.occurrence_key = ANY (v_ticket.valid_occurrence_keys);
    IF v_kept IS NULL THEN RAISE EXCEPTION 'tier_day_scope_empty'; END IF;
    IF cardinality(v_kept) <> cardinality(v_ticket.valid_occurrence_keys) THEN
      UPDATE public.ticket_types SET valid_occurrence_keys = v_kept, updated_at = now()
       WHERE id = v_ticket.id;
    END IF;
  END LOOP;
  -- issue #3281 — extras follow the same rule as their tiers.
  FOR v_extra IN
    SELECT a.id, a.valid_occurrence_keys
      FROM public.ticket_add_ons a
      JOIN public.ticket_types tt ON tt.id = a.ticket_type_id
     WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL
       AND a.is_active AND a.valid_occurrence_keys IS NOT NULL
     ORDER BY a.id
       FOR UPDATE OF a
  LOOP
    SELECT array_agg(d.occurrence_key ORDER BY d.occurrence_key) INTO v_kept
      FROM public.event_dates d
     WHERE d.event_id = p_event_id
       AND d.occurrence_key = ANY (v_extra.valid_occurrence_keys);
    IF v_kept IS NULL THEN RAISE EXCEPTION 'extra_day_scope_empty'; END IF;
    IF cardinality(v_kept) <> cardinality(v_extra.valid_occurrence_keys) THEN
      UPDATE public.ticket_add_ons SET valid_occurrence_keys = v_kept, updated_at = now()
       WHERE id = v_extra.id;
    END IF;
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.business_update_live_event_atomic(
  p_event_id uuid,p_patch jsonb,p_reason text,p_client_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_core jsonb:=COALESCE(p_patch->'core','{}'::jsonb);
  v_core_without_tickets jsonb:=COALESCE(p_patch->'core','{}'::jsonb)-'tickets';
  v_taxonomy jsonb:=p_patch->'taxonomy';
  v_when jsonb:=p_patch->'when';
  v_cover jsonb:=p_patch->'cover';
  v_selection public.event_cover_selections%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tickets jsonb;
  v_item jsonb;
  v_mode text;
  v_timezone text;
  v_local_when jsonb;
  v_pricing_patch jsonb:='{}'::jsonb;
  v_reason text;   -- issue #3827
  v_notice jsonb;  -- issue #3827 buyer email
BEGIN
  -- issue #3827 — a reason is owed to BUYERS. With none, a blank reason is
  -- recorded as the stated constant; with one or more it is still refused.
  -- The core, tier and when leaves below are unchanged and still validate
  -- what they are handed, which is now the resolved reason.
  v_reason:=public.business_resolve_edit_reason(p_event_id,p_reason);
  IF v_reason IS NULL THEN RAISE EXCEPTION 'invalid_edit_reason';END IF;
  IF v_core ? 'visibility'
     AND COALESCE(v_core->>'visibility','') NOT IN('public','unlisted','private') THEN
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;
  PERFORM public.business_update_live_event(
    p_event_id,v_core_without_tickets,v_reason,p_client_revision   -- issue #3827
  );
  IF v_core ? 'tickets' THEN
    PERFORM public.business_patch_event_ticket_tiers(
      p_event_id,v_core->'tickets',NULL,NULL,NULL,v_reason   -- issue #3827
    );
  END IF;

  IF v_taxonomy IS NOT NULL THEN
    PERFORM public.business_patch_event_taxonomy(
      p_event_id,
      v_taxonomy->>'city',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'partyTypes','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'vibeTags','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'musicGenres','[]'::jsonb))),
      NULLIF(v_taxonomy#>>'{locationGeo,lat}','')::numeric,
      NULLIF(v_taxonomy#>>'{locationGeo,lng}','')::numeric,
      NULLIF(v_taxonomy->>'locationText',''),
      COALESCE(v_taxonomy->>'coordinatePrecision','')
    );
  END IF;

  IF v_when IS NOT NULL THEN
    v_mode:=COALESCE(NULLIF(v_when->>'whenMode',''),'single');
    v_timezone:=COALESCE(NULLIF(v_when->>'timezone',''),
      (SELECT timezone FROM public.events WHERE id=p_event_id),'UTC');
    IF v_mode IN('single','recurring') THEN
      v_local_when:=v_when->'when';
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00'),v_timezone
      );
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'endsAt',''),
          COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00')),v_timezone
      );
    ELSIF v_mode='multi_date' THEN
      FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_when->'multiDates','[]'::jsonb)) LOOP
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'startTime',''),'00:00'),v_timezone
        );
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'endTime',''),
            COALESCE(NULLIF(v_item->>'startTime',''),'00:00')),v_timezone
        );
      END LOOP;
    END IF;
    PERFORM public.business_patch_event_when(
      p_event_id,v_when,v_reason,p_client_revision   -- issue #3827
    );
  END IF;

  IF p_patch ? 'theme' THEN
    UPDATE public.events SET
      theme_color_override=NULLIF(p_patch#>>'{theme,color}',''),
      theme_font_override=NULLIF(p_patch#>>'{theme,font}',''),
      theme_animation_override=NULLIF(p_patch#>>'{theme,animation}',''),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  IF p_patch ? 'pricing' THEN
    IF p_patch->'pricing' ? 'passTax' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_tax',p_patch#>'{pricing,passTax}');
    END IF;
    IF p_patch->'pricing' ? 'passMinglaFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_mingla_fee',p_patch#>'{pricing,passMinglaFee}');
    END IF;
    IF p_patch->'pricing' ? 'passServiceFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_service_fee',p_patch#>'{pricing,passServiceFee}');
    END IF;
    PERFORM public.business_patch_pricing_switches(p_event_id,v_pricing_patch);
  END IF;

  IF v_cover IS NOT NULL THEN
    IF COALESCE((v_cover->>'clear')::boolean,false) THEN
      PERFORM public.business_clear_event_cover_media(p_event_id);
    ELSE
      SELECT * INTO v_selection FROM public.event_cover_selections
      WHERE selection_ref=v_cover->>'selectionRef'
        AND user_id=auth.uid() AND event_id=p_event_id
        AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'cover_selection_unverified';END IF;
      PERFORM public.business_set_event_cover_media(
        p_event_id,v_selection.selection_ref,v_selection.media_url,
        v_selection.media_type,v_selection.poster_url,v_selection.provider,
        v_selection.source_url,v_selection.credit,v_selection.credit_url,
        v_selection.alt
      );
    END IF;
  END IF;

  -- issue #3288 — the additional photos. AFTER the cover block, so a save that
  -- removes the cover and edits the gallery keeps the new gallery. The caller
  -- is already authenticated, role-checked and revision-checked by
  -- business_update_live_event above; the column CHECK enforces the array shape.
  IF p_patch ? 'gallery' THEN
    UPDATE public.events SET
      cover_media_gallery=COALESCE(p_patch->'gallery','[]'::jsonb),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  -- issue #3281 — with each tier's extras, so the editor keeps them.
  SELECT COALESCE(jsonb_agg(to_jsonb(tt)||jsonb_build_object('extras',public.issue_3281_tier_extras_json(tt.id))
      ORDER BY tt.display_order,tt.created_at),'[]'::jsonb)
    INTO v_tickets FROM public.ticket_types tt
    WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  -- issue #3827 buyer email — every write above is done. Record this edit
  -- (who, why, what changed) and decide whether buyers are emailed. A save
  -- made with "refund all and proceed" holds the email. Never raises.
  v_notice:=public.event_edit_notice_flush(
    p_event_id,v_reason,'event',
    COALESCE((v_when->>'acknowledgeSoldImpact')::boolean,false)
  );
  RETURN jsonb_build_object(
    'event',to_jsonb(v_event),'tickets',v_tickets,
    'client_revision',p_client_revision,
    'buyer_notice',v_notice   -- issue #3827 buyer email
  );
END;$fn$;

NOTIFY pgrst, 'reload schema';

COMMIT;

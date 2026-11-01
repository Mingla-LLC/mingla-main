-- issue #3281 — day-limited tickets, server side.
--
-- A ticket type can now list the dates it is valid on. NULL stays All dates, so
-- nothing changes for any ticket until a list is set, and no surface sets one yet.
--
-- Rules, from the design Seth approved on 2026-09-12:
--   A list stores stable date keys (MultiDateEntry.id), never event_dates.id.
--   Capacity on a listed ticket is per date. All dates tickets keep one pool.
--   A pass admits what ticket_event_dates says. The list is a sale and mint input,
--     and changing it never touches an issued pass.
--   Dates with sales or holds cannot leave a list. Adding dates is always allowed.
--     A table trigger holds direct updates to this rule too.
--
-- Pricing needs no new path. A per_day line that covers only some chosen dates
-- must use byDate, which already prices, holds and mints each date on its own.
-- Shipped clients send uniform lines, so they are refused, never overcharged.
--
-- Door sales, comps and private links keep their shared capacity check on a
-- listed ticket. That can stop early but cannot oversell, because a date's sold
-- count never exceeds the ticket's total.

BEGIN;

-- A date's stable key. MultiDateEntry.id survives time edits; event_dates.id does
-- not exist for a draft, so a ticket's day list stores this key.
ALTER TABLE public.event_dates ADD COLUMN IF NOT EXISTS occurrence_key text;
CREATE UNIQUE INDEX IF NOT EXISTS event_dates_event_occurrence_key_unique
  ON public.event_dates (event_id, occurrence_key)
  WHERE occurrence_key IS NOT NULL;

-- NULL means All dates. Capacity on a listed ticket is per date.
ALTER TABLE public.ticket_types ADD COLUMN IF NOT EXISTS valid_occurrence_keys text[];
ALTER TABLE public.ticket_types DROP CONSTRAINT IF EXISTS ticket_types_valid_occurrence_keys_not_empty;
ALTER TABLE public.ticket_types ADD CONSTRAINT ticket_types_valid_occurrence_keys_not_empty
  CHECK (valid_occurrence_keys IS NULL OR cardinality(valid_occurrence_keys) > 0);

CREATE OR REPLACE FUNCTION public.issue_3281_sync_occurrence_keys(p_event_id uuid, p_multi_dates jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ids uuid[];
  v_keys text[];
BEGIN
  -- Every caller has already placed the rows, so start time matches one entry.
  SELECT COALESCE(array_agg(w.id), '{}'), COALESCE(array_agg(w.key), '{}')
    INTO v_ids, v_keys
    FROM (
      SELECT min(d.id::text)::uuid AS id, e.key
        FROM public.event_dates d
        JOIN LATERAL (
          SELECT entry->>'id' AS key,
                 CASE WHEN entry->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
                       AND COALESCE(NULLIF(entry->>'startTime',''),'00:00') ~ '^\d{2}:\d{2}$'
                   THEN ((entry->>'date')||' '||COALESCE(NULLIF(entry->>'startTime',''),'00:00')||':00')::timestamp
                 END AS local_start
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(p_multi_dates)='array' THEN p_multi_dates ELSE '[]'::jsonb END
            ) entry
        ) e ON NULLIF(e.key,'') IS NOT NULL AND e.local_start AT TIME ZONE d.timezone = d.start_at
       WHERE d.event_id = p_event_id
       GROUP BY e.key
      HAVING count(*) = 1
    ) w;

  UPDATE public.event_dates d SET occurrence_key = NULL
   WHERE d.event_id = p_event_id AND d.occurrence_key IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM unnest(v_ids, v_keys) AS w(id, key)
        WHERE w.id = d.id AND w.key = d.occurrence_key);
  UPDATE public.event_dates d SET occurrence_key = w.key
    FROM unnest(v_ids, v_keys) AS w(id, key)
   WHERE d.id = w.id AND d.occurrence_key IS DISTINCT FROM w.key;
END;
$fn$;

-- A removed date leaves every day list. A list that would empty is refused:
-- widening to All dates would sell a ticket on dates the organiser never chose.
CREATE OR REPLACE FUNCTION public.issue_3281_strip_removed_days(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ticket record;
  v_kept text[];
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
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3281_draft_ticket_scope(
  p_ticket jsonb, p_when_mode text, p_multi_dates jsonb
) RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_keys text[];
BEGIN
  IF p_when_mode IS DISTINCT FROM 'multi_date'
     OR COALESCE(jsonb_typeof(p_ticket->'validDayIds'), 'null') = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_ticket->'validDayIds') <> 'array'
     OR jsonb_array_length(p_ticket->'validDayIds') = 0 THEN
    RAISE EXCEPTION 'tier_day_scope_empty';
  END IF;
  SELECT array_agg(DISTINCT k.value) INTO v_keys
    FROM jsonb_array_elements_text(p_ticket->'validDayIds') k;
  IF EXISTS (
    SELECT 1 FROM unnest(v_keys) k
     WHERE NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_multi_dates) e WHERE e->>'id' = k)
  ) THEN
    RAISE EXCEPTION 'tier_day_scope_unknown_day';
  END IF;
  RETURN v_keys;
END;
$fn$;

-- A payload with no validDayIds key leaves the list alone, so a caller that
-- predates day lists can never widen a ticket. JSON null means All dates.
CREATE OR REPLACE FUNCTION public.issue_3281_resolve_tier_scope(
  p_event_id uuid, p_tier jsonb, p_existing text[]
) RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_keys text[];
BEGIN
  IF NOT (p_tier ? 'validDayIds') THEN RETURN p_existing; END IF;
  IF jsonb_typeof(p_tier->'validDayIds') = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_tier->'validDayIds') <> 'array'
     OR jsonb_array_length(p_tier->'validDayIds') = 0 THEN
    RAISE EXCEPTION 'tier_day_scope_empty';
  END IF;
  SELECT array_agg(DISTINCT k.value) INTO v_keys
    FROM jsonb_array_elements_text(p_tier->'validDayIds') k;
  IF EXISTS (
    SELECT 1 FROM unnest(v_keys) k
     WHERE NOT EXISTS (
       SELECT 1 FROM public.event_dates d
        WHERE d.event_id = p_event_id AND d.occurrence_key = k)
  ) THEN
    RAISE EXCEPTION 'tier_day_scope_unknown_day';
  END IF;
  RETURN v_keys;
END;
$fn$;

-- Sold and held places both count: a hold left off the list would be paid for
-- and then refused at mint. Only dates leaving the list are measured, because an
-- all_days hold also names chosen dates the ticket never covered.
CREATE OR REPLACE FUNCTION public.issue_3281_assert_scope_keeps_taken_days(
  p_ticket_type_id uuid, p_old_keys text[], p_new_keys text[]
) RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_new_keys IS NULL THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1
      FROM public.ticket_types tt
      JOIN public.event_dates d ON d.event_id = tt.event_id
     WHERE tt.id = p_ticket_type_id
       AND (p_old_keys IS NULL OR d.occurrence_key = ANY (p_old_keys))
       AND (d.occurrence_key IS NULL OR NOT d.occurrence_key = ANY (p_new_keys))
       AND public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id) > 0
  ) THEN
    RAISE EXCEPTION 'tier_day_scope_drops_sold_day';
  END IF;
END;
$fn$;

-- At the table, so a direct update is held to the same rules as a wizard save.
CREATE OR REPLACE FUNCTION public.issue_3281_ticket_type_day_list_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_old text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN v_old := OLD.valid_occurrence_keys; END IF;
  IF NEW.valid_occurrence_keys IS NULL
     OR cardinality(NEW.valid_occurrence_keys) = 0
     OR NEW.valid_occurrence_keys IS NOT DISTINCT FROM v_old THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.valid_occurrence_keys) k
     WHERE NOT (k = ANY (COALESCE(v_old, '{}'::text[])))
       AND NOT EXISTS (
         SELECT 1 FROM public.event_dates d
          WHERE d.event_id = NEW.event_id AND d.occurrence_key = k)
  ) THEN
    RAISE EXCEPTION 'tier_day_scope_unknown_day';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    PERFORM public.issue_3281_assert_scope_keeps_taken_days(
      NEW.id, v_old, NEW.valid_occurrence_keys);
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3281_ticket_type_day_list_guard ON public.ticket_types;
CREATE TRIGGER issue_3281_ticket_type_day_list_guard
  BEFORE INSERT OR UPDATE OF valid_occurrence_keys ON public.ticket_types
  FOR EACH ROW EXECUTE FUNCTION public.issue_3281_ticket_type_day_list_guard();

-- A listed ticket's capacity is per date: the best upcoming date, so it only
-- reads sold out once every one of its dates is.
CREATE OR REPLACE FUNCTION public.issue_3281_listed_remaining(p_ticket_type_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN tt.is_unlimited OR tt.quantity_total IS NULL THEN NULL ELSE COALESCE((
    SELECT GREATEST(MAX(tt.quantity_total
             - public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)), 0)::integer
      FROM public.event_dates d
     WHERE d.event_id = tt.event_id
       AND d.occurrence_key = ANY (tt.valid_occurrence_keys)
       AND d.end_at > now()
  ), 0) END
  FROM public.ticket_types tt
  WHERE tt.id = p_ticket_type_id;
$fn$;

-- NULL for an All dates ticket, otherwise the given dates it is valid on.
CREATE OR REPLACE FUNCTION public.issue_3281_days_in_scope(
  p_ticket_type_id uuid, p_day_ids uuid[]
) RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN tt.valid_occurrence_keys IS NULL THEN NULL ELSE ARRAY(
    SELECT d.id FROM public.event_dates d
     WHERE d.id = ANY (COALESCE(p_day_ids, '{}'::uuid[]))
       AND d.occurrence_key = ANY (tt.valid_occurrence_keys)
     ORDER BY d.start_at, d.id
  ) END
  FROM public.ticket_types tt
  WHERE tt.id = p_ticket_type_id;
$fn$;

-- A per_day line outside the list must state its dates in byDate. That is the
-- per-line multiplier: byDate already prices and mints each date, so a uniform
-- line can only cover dates the ticket admits on all of them.
CREATE OR REPLACE FUNCTION public.issue_3281_assert_line_days(
  p_ticket_type_id uuid, p_by_date jsonb, p_day_ids uuid[], p_pricing_mode text
) RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_days uuid[];
BEGIN
  v_days := public.issue_3281_days_in_scope(p_ticket_type_id, p_day_ids);
  IF v_days IS NULL THEN RETURN NULL; END IF;
  IF cardinality(v_days) = 0 THEN
    RAISE EXCEPTION 'ticket_not_valid_on_chosen_days';
  END IF;
  IF p_by_date IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(p_by_date) q
       WHERE COALESCE(q.value::integer, 0) <> 0
         AND NOT (q.key::uuid = ANY (v_days))
    ) THEN
      RAISE EXCEPTION 'ticket_not_valid_on_chosen_days';
    END IF;
  ELSIF COALESCE(p_pricing_mode, 'per_day') = 'per_day' AND EXISTS (
    SELECT 1 FROM unnest(p_day_ids) x WHERE NOT (x = ANY (v_days))
  ) THEN
    RAISE EXCEPTION 'ticket_not_valid_on_chosen_days';
  END IF;
  RETURN v_days;
END;
$fn$;

-- Every issuer (checkout, door, comps, links) writes through these two guards.
CREATE OR REPLACE FUNCTION public.issue_3281_pass_day_in_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_keys text[];
BEGIN
  SELECT tt.valid_occurrence_keys INTO v_keys
    FROM public.tickets t
    JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
   WHERE t.id = NEW.ticket_id;
  IF v_keys IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_dates d
     WHERE d.id = NEW.event_date_id AND d.occurrence_key = ANY (v_keys)
  ) THEN
    RAISE EXCEPTION 'ticket_not_valid_on_chosen_days';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3281_pass_day_in_scope ON public.ticket_event_dates;
CREATE TRIGGER issue_3281_pass_day_in_scope
  BEFORE INSERT OR UPDATE OF event_date_id, ticket_id ON public.ticket_event_dates
  FOR EACH ROW EXECUTE FUNCTION public.issue_3281_pass_day_in_scope();

-- A pass with no day row admits any day, so a listed ticket must have one.
CREATE OR REPLACE FUNCTION public.issue_3281_pass_has_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ticket_types tt
     WHERE tt.id = NEW.ticket_type_id AND tt.valid_occurrence_keys IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.ticket_event_dates ted WHERE ted.ticket_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'ticket_not_valid_on_chosen_days';
  END IF;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3281_pass_has_day ON public.tickets;
CREATE CONSTRAINT TRIGGER issue_3281_pass_has_day
  AFTER INSERT ON public.tickets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.issue_3281_pass_has_day();

REVOKE ALL ON FUNCTION public.issue_3281_sync_occurrence_keys(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_strip_removed_days(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_draft_ticket_scope(jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_resolve_tier_scope(uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_assert_scope_keeps_taken_days(uuid, text[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_ticket_type_day_list_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_listed_remaining(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_days_in_scope(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_assert_line_days(uuid, jsonb, uuid[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_pass_day_in_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_pass_has_day() FROM PUBLIC, anon, authenticated;

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
      ELSE '{}'::jsonb END);
  END LOOP;
  RETURN v_out;
END;
$$;

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


  -- issue #3281 many-dates — per-date title/place are owned by
  -- business_set_event_date_override (Host Dates). When-save must NOT write
  -- them: CreatorStep2When always initializes a blank `overrides` object, and
  -- theme.business_event.multiDates can be stale relative to event_dates after
  -- a Dates-screen edit. Schedule-only When patches therefore leave overrides alone.

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

  -- issue #3281 — dates keep their stable key, and a ticket never keeps a
  -- removed date in its day list. Emptying a list is refused, never widened.
  PERFORM public.issue_3281_sync_occurrence_keys(
    p_event_id, CASE WHEN v_when_mode = 'multi_date' THEN v_multi_dates ELSE NULL END
  );

  PERFORM public.issue_3281_strip_removed_days(p_event_id);

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
    SELECT COALESCE(jsonb_agg(
      CASE WHEN rows.tier ? 'validDayIds' THEN rows.tier
        ELSE rows.tier || COALESCE((
          SELECT jsonb_build_object('validDayIds',old_tier->'validDayIds')
            FROM jsonb_array_elements(COALESCE(v_event.theme->'business_draft'->'tickets','[]'::jsonb)) old_tier
           WHERE old_tier->>'id'=rows.tier->>'id' AND old_tier ? 'validDayIds'
           LIMIT 1
        ),'{}'::jsonb) END
      ORDER BY rows.ordinality),'[]'::jsonb)
      INTO v_tiers
      FROM jsonb_array_elements(v_tiers) WITH ORDINALITY rows(tier,ordinality);
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

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_create_session_base(p_event_id uuid, p_buyer_user_id uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone_e164 text, p_marketing_opt_in boolean, p_lines jsonb, p_idempotency_key text, p_expires_at timestamp with time zone, p_application_fee_amount_cents integer DEFAULT 0, p_payment_plan_choice text DEFAULT 'auto'::text, p_event_date_ids uuid[] DEFAULT NULL::uuid[], p_booked_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_party_size integer DEFAULT NULL::integer, p_discount_code text DEFAULT NULL::text, p_expected_quote_digest text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
  v_unit_price bigint;
  v_admits integer;
  v_basis text;
  v_blocks integer;
  -- issue #1014: a NULL-currency (free-only) event's tickets carry NULL
  -- currency; track whether the cart saw one so mixing raises ONLY on money.
  v_saw_null_currency boolean := false;
  -- issue #2160 DELTA 2 of 6 — the day set, the mode, and the multiplier.
  v_day_ids uuid[];
  v_day_count integer := 0;
  v_pricing_mode text := 'per_day';
  v_day_multiplier integer := 1;
  v_qty_raw integer;
  v_cart_qty_for_type integer;
  v_day_id uuid;
  -- issue #3313: whether a day must be chosen, and capacity per night.
  v_day_choice jsonb;
  v_per_occurrence boolean := false;
  v_line_days uuid[]; -- issue #3281: this ticket's chosen dates, NULL for All dates
  v_night_taken integer;
  -- issue #3281 R3 — effective booked window (may bind fixed-slot opening).
  v_booked_start timestamptz := p_booked_start_at;
  v_booked_end timestamptz := p_booked_end_at;
  v_open_daily boolean := false;
  v_ctx jsonb;
  v_price jsonb;
  v_plan jsonb;
  v_code text;
  v_engine_lines jsonb := '[]'::jsonb;
  v_candidates jsonb;
  v_quote jsonb;
  v_buyer jsonb;
  v_candidate_ids uuid[];
  v_queued boolean := false;
  v_list_total bigint := 0;
  v_list_due_today bigint := 0;
  v_ap jsonb;
  -- issue #3281 PR10 — optional per-date quantities on a line
  v_by_date jsonb;
  v_date_qty integer;
  v_ctx_price jsonb;
  v_sum integer;
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
        'listUnitPriceCents', COALESCE(i.list_unit_price_cents,i.unit_price_cents),
        'discountCents', i.discount_cents,
        'totalCents', i.total_cents,
        'applied', i.applied_discounts
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
        'listSubtotalCents', COALESCE(v_existing.list_subtotal_cents,v_existing.total_cents),
        'discountCents', v_existing.discount_cents,
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
         e.capacity_scope, e.booking_spacing_minutes, e.is_recurring, e.recurrence_rules,
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

  -- ══ issue #2562 — AN EVENT THAT HAS ALREADY HAPPENED CANNOT BE SOLD ═══
  --
  -- Before this, NOTHING on the reservation path asked whether the event was
  -- over. `event_not_selling` above checks `events.status`, and a finished
  -- event is still `scheduled` — status describes the LISTING, not the clock.
  -- The only thing standing between a guest and paying for a past event was an
  -- OPTIONAL per-tier `sale_end_at`, and six live tiers do not have one.
  --
  -- Proven against production before this guard existed: a checkout session for
  -- FIFA Grill Night — last occurrence ended 2026-07-26 — came back
  -- `status=requires_payment total=2000 currency=USD`, a month after the event.
  -- The buyer web blocked it; the Explorer app offered "Buy ticket"; the server
  -- accepted. A guarantee cannot rest on an optional field being filled in.
  --
  -- SCOPE, and both halves are deliberate:
  --   * Only fires when the event HAS occurrences. No rows means we do not know
  --     when it is, and refusing on unknown would be a different bug — one live
  --     event legitimately carries none.
  --   * `end_at > now()` allows an event that is CURRENTLY RUNNING, so walk-up
  --     sales during the event still work. It refuses only once every occurrence
  --     has finished.
  --
  -- This is the EVENT-level backstop. #2160's `occurrence_not_available` already
  -- refuses an individual chosen day that has passed; that guard only runs when
  -- the guest sent a day set, which is exactly why this one is needed too.
  --
  -- DELETE THIS BLOCK and a past event becomes payable again.
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.event_dates d
        WHERE d.event_id = p_event_id AND d.end_at > now()
     ) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;

  v_is_trip := v_event.event_type = 'trip';
  v_session_id := gen_random_uuid();

  -- #3872 TC-7: the base and quote share the same day/window owner.
  v_ctx := public.issue_3872_checkout_day_context(
    p_event_id,p_event_date_ids,p_booked_start_at,p_booked_end_at);
  SELECT ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(v_ctx->'dayIds')='array' THEN v_ctx->'dayIds' ELSE '[]'::jsonb END
  )) INTO v_day_ids;
  v_day_count := COALESCE((v_ctx->>'dayCount')::integer,0);
  v_per_occurrence := COALESCE((v_ctx->>'perOccurrence')::boolean,false);
  v_pricing_mode := COALESCE(v_ctx->>'pricingMode','per_day');
  v_day_multiplier := COALESCE((v_ctx->>'dayMultiplier')::integer,1);
  v_booked_start := NULLIF(v_ctx->>'bookedStart','')::timestamptz;
  v_booked_end := NULLIF(v_ctx->>'bookedEnd','')::timestamptz;

  -- ══ issue #2462 — CANONICAL LOCK ORDER, TAKEN BEFORE PASS 1 ═══════════
  -- Pass 1 below takes `SELECT … FROM ticket_types … FOR UPDATE` once per
  -- line, in the order the CLIENT sent them, because
  -- `jsonb_array_elements(p_lines)` has no ORDER BY. The cart appends lines in
  -- the order the buyer TAPPED them (CartContext.tsx:290-292), so two guests
  -- who add the same two ticket types in opposite orders take the same two row
  -- locks in opposite orders and DEADLOCK. Postgres kills one; the RPC raises;
  -- the guest is told "Nothing was reserved — please try again". It can only
  -- happen under concurrency, on a multi-ticket-type cart, which is why it
  -- never reproduces in testing.
  --
  -- Proven on production: lines sent as [Day 2, Day 1] were processed
  -- [Day 2, Day 1] — lock order follows the client array verbatim.
  --
  -- Taking every lock ONCE here, ordered by primary key, makes the order
  -- total and identical for every caller. Pass 1's per-line FOR UPDATE then
  -- re-acquires a lock this transaction already holds, which is a no-op, so
  -- NOTHING below changes — including the order line items are inserted in,
  -- which the response's `items` array and its tests depend on.
  --
  -- DELETE THIS BLOCK and the deadlock returns under load.
  PERFORM 1
     FROM public.ticket_types tt
    WHERE tt.id IN (
            SELECT DISTINCT (l ->> 'ticketTypeId')::uuid
              FROM jsonb_array_elements(p_lines) AS l
             WHERE (l ->> 'ticketTypeId') IS NOT NULL
          )
      AND tt.event_id = p_event_id
      AND tt.deleted_at IS NULL
    ORDER BY tt.id
      FOR UPDATE;

  -- ---------------- Pass 1: validate lines + build line items (UNCHANGED). ----------------
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
    v_by_date := CASE
      WHEN jsonb_typeof(v_line -> 'byDate') = 'object' THEN v_line -> 'byDate'
      ELSE NULL
    END;
    IF v_by_date IS NOT NULL THEN
      -- Optional byDate only applies under per_day minting. all_days mints one
      -- pass entitled to every chosen day — per-date counts would be ignored
      -- and silently wrong. Reject at create so finalize never sees this shape.
      IF v_pricing_mode = 'all_days' THEN
        RAISE EXCEPTION 'by_date_not_supported_for_all_days';
      END IF;
      -- Optional byDate: quantity is the sum over chosen days; pricing skips the
      -- day multiplier (already expanded). Zero on a date is allowed; any
      -- non-zero must sit in [min, max] once the tier is loaded below.
      v_sum := 0;
      IF v_day_count = 0 THEN
        RAISE EXCEPTION 'ticket_quantity_invalid';
      END IF;
      FOREACH v_day_id IN ARRAY v_day_ids LOOP
        IF NOT (v_by_date ? v_day_id::text) THEN
          CONTINUE;
        END IF;
        v_date_qty := COALESCE((v_by_date ->> v_day_id::text)::integer, 0);
        IF v_date_qty < 0 THEN
          RAISE EXCEPTION 'ticket_quantity_invalid';
        END IF;
        v_sum := v_sum + v_date_qty;
      END LOOP;
      -- Reject unknown byDate keys outside the chosen set.
      IF EXISTS (
        SELECT 1
          FROM jsonb_object_keys(v_by_date) AS key
         WHERE NOT (key::uuid = ANY (v_day_ids))
      ) THEN
        RAISE EXCEPTION 'ticket_quantity_invalid';
      END IF;
      v_qty_raw := v_sum;
      v_ctx_price := v_ctx || jsonb_build_object('dayMultiplier', 1);
    ELSE
      v_qty_raw := COALESCE((v_line ->> 'quantity')::integer, 0);
      v_ctx_price := v_ctx;
    END IF;
    v_qty := v_qty_raw;
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

    -- issue #3281 — a day-limited ticket only sells on its own dates.
    v_line_days := public.issue_3281_assert_line_days(
      v_ticket_type.id, v_by_date, v_day_ids, v_pricing_mode);

    -- Per-date min/max when byDate is present (decision 8).
    IF v_by_date IS NOT NULL THEN
      FOREACH v_day_id IN ARRAY v_day_ids LOOP
        v_date_qty := COALESCE((v_by_date ->> v_day_id::text)::integer, 0);
        IF v_date_qty = 0 THEN
          CONTINUE;
        END IF;
        IF v_date_qty < v_ticket_type.min_purchase_qty THEN
          RAISE EXCEPTION 'ticket_quantity_below_min';
        END IF;
        IF v_ticket_type.max_purchase_qty IS NOT NULL
           AND v_date_qty > v_ticket_type.max_purchase_qty THEN
          RAISE EXCEPTION 'ticket_quantity_above_max';
        END IF;
      END LOOP;
    END IF;

    v_price := public.issue_3872_ticket_line_price(
      p_event_id,v_ticket_type.id,v_qty_raw,v_ctx_price,p_expires_at,p_booked_party_size);
    v_qty := (v_price->>'quantity')::integer;
    -- #3872: quantity already includes the shared day multiplier.
    -- META-ORCH-1174 B1 — PER-PACKAGE capacity (DEC-1174-D): each ticket_type's
    -- own quantity_total is its own cap. This was already correct (per-line),
    -- and is the only capacity model multi-package needs.
    IF NOT v_ticket_type.is_unlimited THEN
      -- issue #2491 C2 step 3 — THE COUNTER, not the count.
      -- Was: COUNT(*) over public.tickets, measured at 18.71 ms per call once a
      -- ticket type holds 100k rows, executed INSIDE the serialized critical
      -- section so every other buyer waits behind it. Now a column read.
      -- sold_count is maintained by issue_2491_tickets_counters, which fires on
      -- INSERT, DELETE and UPDATE OF (status, ticket_type_id) — precisely the
      -- columns this formula reads — and RECOMPUTES from
      -- issue_2491_derived_sold rather than incrementing. Its only failure mode
      -- is structural (the trigger removed), never gradual, and 288 consecutive
      -- shadow observations over 77.7 h reported zero drift across 699 sales.
      -- ══ issue #3313 — CAPACITY PER NIGHT ON A RECURRING EVENT (Seth) ═══
      -- quantity_total is the capacity of EACH night, not of the whole run.
      -- For every chosen night: places already taken that night (sold + held,
      -- issue_3313_ticket_type_occurrence_taken — the ONE per-night counter,
      -- also used by the public reader's `remaining`) plus this cart's raw
      -- quantity of the type must fit. per_day stores quantity x D and mints q
      -- passes per night; all_days mints q passes valid on every chosen night;
      -- both consume q places per night. Every other event keeps the shared
      -- check below, verbatim.
      -- DELETE THIS BRANCH and a recurring event's 60 places are shared by
      -- every night of the run.
      -- issue #3281 — a day-limited ticket's capacity is per date, on its own
      -- dates only. All dates tickets keep the shared check below.
      IF (v_per_occurrence OR v_line_days IS NOT NULL) AND v_day_count > 0 THEN
        IF v_ticket_type.quantity_total IS NOT NULL THEN
          FOREACH v_day_id IN ARRAY COALESCE(v_line_days, v_day_ids) LOOP
            SELECT COALESCE(SUM(public.issue_3281_line_qty_for_date(l, v_day_id)), 0)::integer
              INTO v_cart_qty_for_type
              FROM jsonb_array_elements(p_lines) AS l
             WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;
            v_night_taken := public.issue_3313_ticket_type_occurrence_taken(
              v_ticket_type.id, v_day_id
            );
            IF v_night_taken + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
              RAISE EXCEPTION 'ticket_capacity_exceeded'
                USING DETAIL = v_day_id::text;
            END IF;
          END LOOP;
        END IF;
      ELSIF v_event.event_type = 'experience'
            AND COALESCE(v_event.capacity_scope, 'total') IN ('per_day', 'per_start') THEN
        -- Scoped counters are enforced in the R3 block below; skip lifetime.
        NULL;
      ELSE
      -- (the shared check, verbatim from 20270609002879)
      SELECT tt2.sold_count
        INTO v_sold
        FROM public.ticket_types tt2
       WHERE tt2.id = v_ticket_type.id;

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');

      -- ══ issue #2160 DELTA 5 of 6 — CAPACITY AGGREGATES PER TICKET TYPE ═
      -- THIS ONE PROTECTS MONEY. The pre-#2160 check compared
      -- `v_sold + v_reserved + v_qty` where v_qty is THIS LINE alone, and
      -- the current session's own items are inserted AFTER this loop — so a
      -- second line of the SAME ticket_type in the same cart was invisible
      -- to the first line's check and both passed independently.
      --
      -- Honest scoping: under the amendment's session-level day set, lines
      -- are never expanded, so multi-day does NOT create this shape. The
      -- hole is real but LATENT, exactly as it is today — this is hardening,
      -- not the load-bearing fix the pre-amendment spec described. It is
      -- kept because it is two lines inside a function being re-emitted
      -- anyway and any future feature that sends two lines of one type
      -- (bundles, add-ons) walks straight into it.
      --
      -- DELETE THE AGGREGATION and a cart with two lines of a
      -- quantity_total=1 ticket type mints 2 tickets against a cap of 1.
      SELECT COALESCE(SUM(
          CASE
            WHEN jsonb_typeof(l -> 'byDate') = 'object' THEN
              public.issue_3281_line_qty_sum(l)
            ELSE
              COALESCE((l ->> 'quantity')::integer, 0) * v_day_multiplier
          END
        ), 0)::integer
        INTO v_cart_qty_for_type
        FROM jsonb_array_elements(p_lines) AS l
       WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
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

    -- #3872 TC-8: list unit and scaling come from the shared line owner.
    v_unit_price := (v_price->>'unitPriceCents')::bigint;
    v_admits := (v_price->>'admitsCount')::integer;
    v_basis := v_price->>'priceBasis';
    v_blocks := NULLIF(v_price->>'blocks','')::integer;

    -- issue #3281 R3 — capacity_scope counters (cart-aggregated like lifetime).
    -- Same byDate / day-multiplier expansion as the lifetime quantity_total
    -- gate above so experience scopes cannot under-count uneven carts.
    IF v_event.event_type = 'experience'
       AND v_ticket_type.quantity_total IS NOT NULL THEN
      SELECT COALESCE(SUM(
          CASE
            WHEN jsonb_typeof(l -> 'byDate') = 'object' THEN
              public.issue_3281_line_qty_sum(l)
            ELSE
              COALESCE((l ->> 'quantity')::integer, 0) * v_day_multiplier
          END
        ), 0)::integer
        INTO v_cart_qty_for_type
        FROM jsonb_array_elements(p_lines) AS l
       WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;
      IF COALESCE(v_event.capacity_scope, 'total') = 'per_start'
         AND v_booked_start IS NOT NULL THEN
        IF public.issue_3281_ticket_type_slot_taken(
             v_ticket_type.id,
             CASE WHEN v_day_count = 1 THEN v_day_ids[1] ELSE NULL END,
             v_booked_start,
             COALESCE(
               v_booked_end,
               v_booked_start + make_interval(
                 mins => GREATEST(1, COALESCE(v_event.booking_spacing_minutes, 30))
               )
             ),
             NULL
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'slot_full';
        END IF;
      ELSIF COALESCE(v_event.capacity_scope, 'total') = 'per_day'
         AND v_day_count = 1 THEN
        IF public.issue_3313_ticket_type_occurrence_taken(
             v_ticket_type.id, v_day_ids[1]
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'ticket_capacity_exceeded';
        END IF;
      ELSIF v_booked_start IS NOT NULL THEN
        IF public.issue_3281_ticket_type_slot_taken(
             v_ticket_type.id,
             CASE WHEN v_day_count = 1 THEN v_day_ids[1] ELSE NULL END,
             v_booked_start,
             COALESCE(
               v_booked_end,
               v_booked_start + make_interval(
                 mins => GREATEST(1, COALESCE(v_event.booking_spacing_minutes, 30))
               )
             ),
             NULL
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'slot_full';
        END IF;
      END IF;
    END IF;

    v_total := v_total + (v_unit_price * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_unit_price,
      'listUnitPriceCents', v_unit_price,
      'discountCents', 0,
      'totalCents', v_unit_price * v_qty,
      'admitsCount', v_admits,
      'valueScale', (v_price->>'valueScale')::integer,
      'countScale', (v_price->>'countScale')::integer,
      'discountsAllowed', (v_price->>'discountsAllowed')::boolean,
      'priceBasis', v_price->>'priceBasis',
      'isFree', (v_price->>'isFree')::boolean,
      'applied', '[]'::jsonb
    ) || CASE
      WHEN v_by_date IS NOT NULL THEN jsonb_build_object('byDate', v_by_date)
      ELSE '{}'::jsonb
    END);
  END LOOP;

  -- The full trip total (Σ all line totals) — used for the persisted schedule's
  -- fullPriceCents (informational; the buyer-facing receipt shows the trip total).
  v_list_total := v_total;
  v_code := NULLIF(upper(regexp_replace(btrim(COALESCE(p_discount_code,'')),'[\s-]','','g')),'');
  IF v_code IS NOT NULL AND (length(v_code)>32 OR v_code!~'^[A-Z0-9]+$') THEN
    RAISE EXCEPTION 'discount_code_invalid';
  END IF;
  v_queued := p_expires_at='infinity'::timestamptz;
  v_buyer := jsonb_build_object('email',lower(btrim(p_buyer_email)),
    'phone',p_buyer_phone_e164,'userId',p_buyer_user_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'lineRef',i->>'ticketTypeId','itemKind','ticket_type','itemId',i->'ticketTypeId',
    'listingId',p_event_id,'listingKind',v_event.event_type,
    'listUnitMinor',(i->>'listUnitPriceCents')::integer,'qty',(i->>'quantity')::integer,
    'valueScale',(i->>'valueScale')::integer,'countScale',(i->>'countScale')::integer,
    'allowed',(i->>'discountsAllowed')::boolean AND NOT (i->>'isFree')::boolean,
    'tz',COALESCE(v_ctx->>'eventTimezone','UTC')) ORDER BY ord),'[]'::jsonb)
    INTO v_engine_lines FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord);
  v_candidates:=public.issue_3872_discount_candidates(
    v_event.brand_id,v_engine_lines,v_code,v_buyer,now());
  SELECT COALESCE(array_agg((x->>'id')::uuid),'{}'::uuid[]) INTO v_candidate_ids FROM (
    SELECT value x FROM jsonb_array_elements(v_candidates->'automatics')
    UNION ALL SELECT v_candidates->'code' WHERE v_candidates->'code' IS NOT NULL
  ) c;
  PERFORM public.issue_3872_lock_limited_discounts(v_candidate_ids);
  v_candidates:=public.issue_3872_discount_candidates(
    v_event.brand_id,v_engine_lines,v_code,v_buyer,now());
  v_quote:=public.issue_3872_discount_apply(jsonb_build_object(
    'currency',trim(v_currency),'at',now(),'queued',v_queued,'lines',v_engine_lines,
    'automatics',v_candidates->'automatics','code',v_candidates->'code',
    'codeLookup',v_candidates->>'codeLookup'));
  IF p_expected_quote_digest IS NOT NULL
     AND p_expected_quote_digest IS DISTINCT FROM v_quote->>'digest' THEN
    RAISE EXCEPTION 'checkout_quote_changed';
  END IF;
  SELECT COALESCE(jsonb_agg(i || jsonb_build_object(
    'unitPriceCents',(q->>'netUnitMinor')::integer,
    'totalCents',(q->>'lineNetMinor')::integer,
    'discountCents',(q->>'lineDiscountMinor')::integer,
    'unitsCounted',(q->>'unitsCounted')::integer,
    'applied',q->'applied') ORDER BY ord),'[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord)
    JOIN jsonb_array_elements(v_quote->'lines') q ON q->>'lineRef'=i->>'ticketTypeId';
  v_total := (v_quote->>'netSubtotalMinor')::integer;
  v_list_total := (v_quote->>'listSubtotalMinor')::bigint;
  v_full_price_cents := v_total;

  -- issue #1014 delta (2), post-loop leg: a cart mixing NULL-currency and
  -- currency-bearing tickets is legal ONLY when it carries no money (schema-
  -- impossible per-event today; defensive for cross-era rows).
  IF v_saw_null_currency AND v_currency IS NOT NULL AND v_total > 0 THEN
    RAISE EXCEPTION 'mixed_currency_cart';
  END IF;

  -- #3872 TC-12: net and list due-today totals share one plan owner.
  v_plan := public.issue_3872_plan_due_today(p_event_id,v_items,p_payment_plan_choice);
  v_total := (v_plan->>'dueTodayNetCents')::integer;
  v_list_due_today := (v_plan->>'dueTodayListCents')::bigint;
  v_any_installments := v_plan->'installmentSchedule' IS NOT NULL
    AND v_plan->'installmentSchedule'<>'null'::jsonb;
  v_unioned := v_plan->'installmentSchedule';

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
    marketing_opt_in, list_subtotal_cents, discount_cents,
    subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents,
    installment_schedule,
    -- issue #2160 — the mode this reservation was PRICED under. Finalize mints
    -- under this value, never a fresh read (§A.7).
    multi_date_pricing_mode_snapshot,
    -- issue #3281 — guest-chosen start (open-daily); NULL = legacy / slots / flag-off.
    booked_start_at,
    booked_end_at,
    booked_party_size
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_list_due_today::integer, (v_list_due_today-v_total)::integer,
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    v_currency, v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0),
    CASE WHEN v_any_installments THEN v_unioned ELSE NULL END,
    v_pricing_mode,
    v_booked_start,
    v_booked_end,
    p_booked_party_size
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents, list_unit_price_cents, discount_cents,
      units_counted, applied_discounts, by_date
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer,
      (v_line ->> 'listUnitPriceCents')::integer,
      (v_line ->> 'discountCents')::integer,
      (v_line ->> 'unitsCounted')::integer,
      COALESCE(v_line->'applied','[]'::jsonb),
      CASE WHEN jsonb_typeof(v_line -> 'byDate') = 'object' THEN v_line -> 'byDate' ELSE NULL END
    );
  END LOOP;

  -- Reserve every applied definition in the same transaction as inventory.
  FOR v_ap IN SELECT value FROM jsonb_array_elements(COALESCE(v_quote->'applied','[]'::jsonb)) LOOP
    INSERT INTO public.discount_uses(
      discount_id,brand_id,checkout_kind,checkout_ref_id,buyer_user_id,
      buyer_email_norm,buyer_phone_e164,status,units,amount_minor,expires_at,channel)
    VALUES((v_ap->>'discountId')::uuid,v_event.brand_id,'ticket',v_session_id,p_buyer_user_id,
      NULLIF(lower(btrim(p_buyer_email)),''),p_buyer_phone_e164,'reserved',
      (v_ap->>'units')::integer,(v_ap->>'amountMinor')::integer,p_expires_at,'online')
    ON CONFLICT(discount_id,checkout_kind,checkout_ref_id) DO NOTHING;
  END LOOP;

  -- ══ issue #2160 DELTA 6 of 6 — PERSIST THE CHOSEN DAY SET ═════════════
  -- The finalize base reads these rows to distribute ticket_event_dates
  -- entitlements. DELETE THIS LOOP and every pass mints with zero days, so
  -- a guest who chose Saturday is silently admitted on every day of the
  -- event — and a guest who paid for two days gets one pass, not two.
  IF v_day_count > 0 THEN
    FOREACH v_day_id IN ARRAY v_day_ids LOOP
      INSERT INTO public.ticket_checkout_session_event_dates (
        checkout_session_id, event_date_id
      ) VALUES (v_session_id, v_day_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'subtotalCents', v_total,
    'listSubtotalCents', v_list_due_today,
    'discountCents', v_list_due_today-v_total,
    'fullListCents', v_list_total,
    'fullNetCents', v_full_price_cents,
    'currency', trim(v_currency),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items,
    'lineItems', v_items,
    'installmentSchedule', v_plan->'installmentSchedule',
    'quoteDigest', v_quote->>'digest',
    'quoteListDigest', v_quote->>'listDigest',
    'discounts', v_quote->'applied',
    'codeOutcome', v_quote->'codeOutcome',
    'notices', v_quote->'notices'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3872_ticket_line_price(
  p_event_id uuid,p_ticket_type_id uuid,p_qty_raw integer,p_ctx jsonb,
  p_expires_at timestamptz,p_booked_party_size integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $fn$
DECLARE v_event record; v_tt record; v_qty integer; v_unit bigint; v_admits integer:=1;
  v_basis text; v_blocks integer; v_day_count integer; v_mode text; v_value_scale integer:=1; v_count_scale integer:=1;
  v_start timestamptz; v_end timestamptz;
BEGIN
  IF COALESCE(p_qty_raw,0)<=0 THEN RAISE EXCEPTION 'ticket_quantity_invalid'; END IF;
  SELECT e.event_type,e.discounts_allowed INTO v_event FROM public.events e
    WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  SELECT * INTO v_tt FROM public.ticket_types t
    WHERE t.id=p_ticket_type_id AND t.event_id=p_event_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_type_not_found'; END IF;
  IF (v_tt.is_hidden AND NOT public.issue_3827_link_unlocks_tier(v_tt.id))
     OR v_tt.is_disabled OR NOT v_tt.available_online THEN RAISE EXCEPTION 'ticket_type_unavailable'; END IF;
  IF v_tt.sale_start_at IS NOT NULL AND v_tt.sale_start_at>now() AND NOT (
    p_expires_at='infinity'::timestamptz AND EXISTS(SELECT 1 FROM public.ticket_queue_arming a
      WHERE a.ticket_type_id=v_tt.id AND a.disarmed_at IS NULL)) THEN
    RAISE EXCEPTION 'ticket_sales_not_started';
  END IF;
  IF v_tt.sale_end_at IS NOT NULL AND v_tt.sale_end_at<=now() THEN RAISE EXCEPTION 'ticket_sales_ended'; END IF;
  IF p_qty_raw<v_tt.min_purchase_qty THEN RAISE EXCEPTION 'ticket_quantity_below_min'; END IF;
  -- A by-date line over several dates arrives as its total with no day
  -- multiplier, a shape no uniform cart has. create-session checks each date.
  IF v_tt.max_purchase_qty IS NOT NULL AND p_qty_raw>v_tt.max_purchase_qty
     AND NOT (COALESCE(p_ctx->>'pricingMode','per_day')='per_day'
       AND COALESCE((p_ctx->>'dayCount')::integer,0)>1
       AND COALESCE((p_ctx->>'dayMultiplier')::integer,1)=1) THEN
    RAISE EXCEPTION 'ticket_quantity_above_max';
  END IF;

  v_day_count:=COALESCE((p_ctx->>'dayCount')::integer,0);
  -- issue #3281 — an all_days pass counts only the dates it admits.
  IF v_tt.valid_occurrence_keys IS NOT NULL THEN
    v_day_count:=COALESCE(cardinality(public.issue_3281_days_in_scope(v_tt.id,ARRAY(
      SELECT value::uuid FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p_ctx->'dayIds')='array' THEN p_ctx->'dayIds' ELSE '[]'::jsonb END)
    ))),0);
  END IF;
  v_mode:=COALESCE(p_ctx->>'pricingMode','per_day');
  v_qty:=p_qty_raw*COALESCE((p_ctx->>'dayMultiplier')::integer,1);
  v_unit:=v_tt.price_cents; v_basis:=COALESCE(v_tt.price_basis,'person');
  v_start:=NULLIF(p_ctx->>'bookedStart','')::timestamptz; v_end:=NULLIF(p_ctx->>'bookedEnd','')::timestamptz;
  IF v_event.event_type='experience' AND v_basis='group' THEN
    IF p_booked_party_size IS NULL OR p_booked_party_size<1 OR v_tt.group_max IS NULL
       OR p_booked_party_size>v_tt.group_max THEN RAISE EXCEPTION 'booked_party_invalid'; END IF;
    v_admits:=v_tt.group_max;
  ELSIF v_event.event_type='experience' AND v_basis='block' THEN
    IF v_start IS NULL OR v_end IS NULL OR v_tt.block_minutes IS NULL OR v_end<=v_start THEN
      RAISE EXCEPTION 'booked_length_invalid';
    END IF;
    v_blocks:=(extract(epoch FROM (v_end-v_start))/(v_tt.block_minutes::numeric*60.0))::integer;
    IF v_blocks<COALESCE(v_tt.min_blocks,1) OR v_blocks>COALESCE(v_tt.max_blocks,v_blocks) THEN
      RAISE EXCEPTION 'booked_length_invalid';
    END IF;
    v_unit:=v_tt.price_cents*v_blocks; v_value_scale:=v_blocks; v_count_scale:=v_blocks;
  ELSIF v_mode='all_days' AND v_day_count>0 THEN v_count_scale:=v_day_count;
  END IF;
  RETURN jsonb_build_object('ticketTypeId',v_tt.id,'ticketName',v_tt.name,
    'rawQuantity',p_qty_raw,'quantity',v_qty,'unitPriceCents',v_unit,'totalCents',v_unit*v_qty,
    'admitsCount',v_admits,'priceBasis',v_basis,'blocks',v_blocks,'currency',v_tt.currency,
    'isFree',COALESCE(v_tt.is_free,false) OR COALESCE(v_tt.price_cents,0)=0,
    'discountsAllowed',COALESCE(v_event.discounts_allowed,true) AND COALESCE(v_tt.discounts_allowed,true),
    'valueScale',v_value_scale,'countScale',v_count_scale);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_ticket_quote(
  p_event_id uuid,
  p_lines jsonb,
  p_event_date_ids uuid[],
  p_booked_start_at timestamptz,
  p_booked_end_at timestamptz,
  p_booked_party_size integer,
  p_payment_plan_choice text,
  p_discount_code text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_buyer_user_id uuid,
  p_link_token_hash text,
  p_queued boolean
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $quote$
DECLARE
  v_event record;
  v_link public.ticket_type_links;
  v_state text;
  v_ctx jsonb;
  v_price jsonb;
  v_line_ctx jsonb;
  v_line jsonb;
  v_items jsonb := '[]'::jsonb;
  v_engine_lines jsonb := '[]'::jsonb;
  v_candidates jsonb;
  v_quote jsonb;
  v_plan jsonb;
  v_buyer jsonb;
  v_code text;
  v_currency character(3);
  v_line_currency text;
  v_saw_null_currency boolean := false;
  v_units integer := 0;
  v_expires_at timestamptz;
  v_result jsonb;
BEGIN
  IF COALESCE(p_payment_plan_choice,'') NOT IN ('auto','full','installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT e.id,e.brand_id,e.visibility,e.status,e.deleted_at,e.event_type,e.timezone
    INTO v_event FROM public.events e WHERE e.id=p_event_id;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_event.visibility NOT IN ('public','hidden')
     OR v_event.status NOT IN ('scheduled','live') THEN RAISE EXCEPTION 'event_not_selling'; END IF;
  IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id)
     AND NOT EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id AND d.end_at>now()) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;

  IF p_link_token_hash IS NOT NULL THEN
    SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash=p_link_token_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
    IF v_link.event_id<>p_event_id OR v_link.kind<>'private_ticket' THEN
      RAISE EXCEPTION 'not_a_private_ticket_link';
    END IF;
    v_state:=public.issue_3827_link_state(v_link,now());
    IF v_state<>'active' THEN
      RAISE EXCEPTION '%',CASE v_state WHEN 'revoked' THEN 'link_revoked'
        WHEN 'expired' THEN 'link_expired' WHEN 'full' THEN 'link_full' ELSE v_state END;
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      IF (v_line->>'ticketTypeId')::uuid<>v_link.ticket_type_id THEN
        RAISE EXCEPTION 'link_tier_mismatch';
      END IF;
      v_units:=v_units+public.issue_3281_line_qty_sum(v_line);
    END LOOP;
    IF v_units<=0 THEN RAISE EXCEPTION 'invalid_request'; END IF;
    IF v_link.max_uses IS NOT NULL
       AND public.issue_3827_link_uses_taken(v_link.id)+v_units>v_link.max_uses THEN
      RAISE EXCEPTION 'link_full';
    END IF;
    PERFORM set_config('mingla.ticket_link_id',v_link.id::text,true);
  END IF;

  v_ctx:=public.issue_3872_checkout_day_context(
    p_event_id,p_event_date_ids,p_booked_start_at,p_booked_end_at);
  v_expires_at:=CASE WHEN COALESCE(p_queued,false) THEN 'infinity'::timestamptz
    ELSE now()+interval '30 minutes' END;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    -- issue #3281 — quote and create-session refuse the same lines.
    PERFORM public.issue_3281_assert_line_days(
      (v_line->>'ticketTypeId')::uuid,
      CASE WHEN jsonb_typeof(v_line->'byDate')='object' THEN v_line->'byDate' ELSE NULL END,
      ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(v_ctx->'dayIds')='array' THEN v_ctx->'dayIds' ELSE '[]'::jsonb END)),
      v_ctx->>'pricingMode');
    -- Same rules as create-session: byDate is already expanded per date.
    v_line_ctx:=v_ctx;
    IF jsonb_typeof(v_line->'byDate')='object' THEN
      IF v_ctx->>'pricingMode'='all_days' THEN
        RAISE EXCEPTION 'by_date_not_supported_for_all_days';
      END IF;
      IF COALESCE((v_ctx->>'dayCount')::integer,0)=0 OR EXISTS(
        SELECT 1 FROM jsonb_object_keys(v_line->'byDate') AS k
        WHERE NOT (k::uuid=ANY(ARRAY(
          SELECT jsonb_array_elements_text(v_ctx->'dayIds')::uuid)))
      ) THEN
        RAISE EXCEPTION 'ticket_quantity_invalid';
      END IF;
      v_line_ctx:=v_ctx||jsonb_build_object('dayMultiplier',1);
    END IF;
    v_price:=public.issue_3872_ticket_line_price(
      p_event_id,(v_line->>'ticketTypeId')::uuid,
      public.issue_3281_line_qty_sum(v_line),v_line_ctx,v_expires_at,p_booked_party_size);
    v_line_currency:=NULLIF(v_price->>'currency','');
    IF v_line_currency IS NULL THEN
      v_saw_null_currency:=true;
    ELSIF v_currency IS NULL THEN
      v_currency:=v_line_currency::character(3);
    ELSIF trim(v_currency)<>v_line_currency THEN
      RAISE EXCEPTION 'mixed_currency_cart';
    END IF;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'ticketTypeId',v_price->'ticketTypeId','ticketName',v_price->>'ticketName',
      'quantity',(v_price->>'quantity')::integer,
      'unitPriceCents',(v_price->>'unitPriceCents')::integer,
      'listUnitPriceCents',(v_price->>'unitPriceCents')::integer,
      'discountCents',0,'totalCents',(v_price->>'totalCents')::integer,
      'admitsCount',(v_price->>'admitsCount')::integer,
      'valueScale',(v_price->>'valueScale')::integer,
      'countScale',(v_price->>'countScale')::integer,
      'discountsAllowed',(v_price->>'discountsAllowed')::boolean,
      'priceBasis',v_price->>'priceBasis','isFree',(v_price->>'isFree')::boolean,
      'applied','[]'::jsonb));
  END LOOP;

  v_code:=NULLIF(upper(regexp_replace(btrim(COALESCE(p_discount_code,'')),'[\s-]','','g')),'');
  IF v_code IS NOT NULL AND (length(v_code)>32 OR v_code!~'^[A-Z0-9]+$') THEN
    RAISE EXCEPTION 'discount_code_invalid';
  END IF;
  v_buyer:=jsonb_build_object('email',NULLIF(lower(btrim(p_buyer_email)),''),
    'phone',p_buyer_phone_e164,'userId',p_buyer_user_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'lineRef',i->>'ticketTypeId','itemKind','ticket_type','itemId',i->'ticketTypeId',
    'listingId',p_event_id,'listingKind',v_event.event_type,
    'listUnitMinor',(i->>'listUnitPriceCents')::integer,'qty',(i->>'quantity')::integer,
    'valueScale',(i->>'valueScale')::integer,'countScale',(i->>'countScale')::integer,
    'allowed',(i->>'discountsAllowed')::boolean AND NOT (i->>'isFree')::boolean,
    'tz',COALESCE(v_event.timezone,'UTC')) ORDER BY ord),'[]'::jsonb)
    INTO v_engine_lines FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord);
  v_candidates:=public.issue_3872_discount_candidates(
    v_event.brand_id,v_engine_lines,v_code,v_buyer,now());
  v_quote:=public.issue_3872_discount_apply(jsonb_build_object(
    'currency',trim(v_currency),'at',now(),'queued',COALESCE(p_queued,false),
    'lines',v_engine_lines,'automatics',v_candidates->'automatics',
    'code',v_candidates->'code','codeLookup',v_candidates->>'codeLookup'));
  SELECT COALESCE(jsonb_agg(i||jsonb_build_object(
    'unitPriceCents',(q->>'netUnitMinor')::integer,
    'totalCents',(q->>'lineNetMinor')::integer,
    'discountCents',(q->>'lineDiscountMinor')::integer,
    'unitsCounted',(q->>'unitsCounted')::integer,
    'applied',q->'applied') ORDER BY ord),'[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord)
    JOIN jsonb_array_elements(v_quote->'lines') q ON q->>'lineRef'=i->>'ticketTypeId';
  IF v_saw_null_currency AND v_currency IS NOT NULL
     AND (v_quote->>'netSubtotalMinor')::bigint>0 THEN RAISE EXCEPTION 'mixed_currency_cart'; END IF;
  IF (v_quote->>'netSubtotalMinor')::bigint>0 AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  v_plan:=public.issue_3872_plan_due_today(p_event_id,v_items,p_payment_plan_choice);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ticketTypeId',i->'ticketTypeId','ticketName',i->>'ticketName',
    'quantity',(i->>'quantity')::integer,
    'listUnitCents',(i->>'listUnitPriceCents')::integer,
    'netUnitCents',(i->>'unitPriceCents')::integer,
    'lineListCents',(i->>'listUnitPriceCents')::integer*(i->>'quantity')::integer,
    'lineNetCents',(i->>'totalCents')::integer,
    'discountCents',(i->>'discountCents')::integer,
    'discounts',COALESCE(i->'applied','[]'::jsonb)) ORDER BY ord),'[]'::jsonb)
    INTO v_result FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord);
  IF p_link_token_hash IS NOT NULL THEN PERFORM set_config('mingla.ticket_link_id','',true); END IF;
  RETURN jsonb_build_object(
    'currency',trim(v_currency),'lines',v_result,
    'listSubtotalCents',(v_quote->>'listSubtotalMinor')::bigint,
    'discountCents',(v_quote->>'discountMinor')::bigint,
    'netSubtotalCents',(v_quote->>'netSubtotalMinor')::bigint,
    'dueTodayNetCents',(v_plan->>'dueTodayNetCents')::bigint,
    'dueTodayListCents',(v_plan->>'dueTodayListCents')::bigint,
    'installmentSchedule',v_plan->'installmentSchedule',
    'discounts',v_quote->'applied','codeOutcome',v_quote->'codeOutcome',
    'notices',v_quote->'notices','quoteDigest',v_quote->>'digest',
    'quoteListDigest',v_quote->>'listDigest');
END;
$quote$;

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_session_authorized(
  p_session_id uuid, p_event_id uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE; v_bad boolean;
  v_session public.ticket_checkout_sessions%ROWTYPE; v_decision text;
  v_per_occurrence boolean; -- issue #3313
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  IF public.issue_1930_event_sale_reason(v_event) <> 'sellable' THEN RETURN false; END IF;
  -- #2101 — the sole decision owner, consuming this session's snapshots. It
  -- takes event -> brand in the canonical order before any lower-order row.
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_session_id AND event_id=p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, v_session.buyer_user_id,
    v_session.checkout_access_mode_snapshot,
    v_session.checkout_access_restrictive_epoch_snapshot,
    v_session.checkout_access_membership_id_snapshot,
    v_session.checkout_access_membership_epoch_snapshot);
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN RETURN false; END IF;
  v_per_occurrence := COALESCE(
    (public.issue_3313_event_day_choice(p_event_id) ->> 'perOccurrenceCapacity')::boolean, false);
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND s.event_id=p_event_id AND s.revoked_at IS NULL
      AND s.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
  THEN RETURN false; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.ticket_checkout_session_items i
    LEFT JOIN public.ticket_types tt ON tt.id=i.ticket_type_id AND tt.event_id=p_event_id
    WHERE i.checkout_session_id=p_session_id AND (
      tt.id IS NULL OR tt.deleted_at IS NOT NULL OR tt.is_hidden OR tt.is_disabled
      OR NOT tt.available_online
      OR (tt.sale_start_at IS NOT NULL AND tt.sale_start_at > now())
      OR (tt.sale_end_at IS NOT NULL AND tt.sale_end_at <= now())
      -- issue #3313 — a recurring event's capacity is PER NIGHT, so the
      -- finalize-time re-check measures each of this session's nights (every
      -- upcoming night when it has none): everyone else's sold + held places
      -- that night, plus this session's own places that night. The shared
      -- whole-run check below stays for every other event. DELETE THIS and a
      -- second night's buyer is authorised at reserve and refused at finalize.
      -- issue #3281 — a day-limited ticket is measured per date, on its dates.
      OR ((v_per_occurrence OR tt.valid_occurrence_keys IS NOT NULL)
        AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM public.event_dates night
           WHERE night.event_id = p_event_id
             AND (tt.valid_occurrence_keys IS NULL
               OR night.occurrence_key = ANY (tt.valid_occurrence_keys))
             AND (
               EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                        WHERE sd.checkout_session_id = p_session_id AND sd.event_date_id = night.id)
               OR (NOT EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id)
                   AND night.end_at > now())
             )
             AND public.issue_3313_ticket_type_occurrence_taken(tt.id, night.id, p_session_id)
                 + CASE
                     WHEN jsonb_typeof(i.by_date) = 'object'
                       THEN COALESCE((i.by_date ->> night.id::text)::integer, 0)
                     WHEN COALESCE(v_session.multi_date_pricing_mode_snapshot, 'per_day') = 'per_day'
                          AND (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id) > 0
                       THEN i.quantity / (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                           WHERE sd.checkout_session_id = p_session_id)
                     ELSE i.quantity
                   END
                 > tt.quantity_total
        ))
      OR (NOT v_per_occurrence AND tt.valid_occurrence_keys IS NULL
        AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL AND
        (SELECT count(*) FROM public.tickets sold
          WHERE sold.ticket_type_id=tt.id
            AND sold.status IN ('valid','used','transferred'))
        + (SELECT COALESCE(sum(reserved.quantity),0) FROM public.ticket_checkout_session_items reserved
            JOIN public.ticket_checkout_sessions active
              ON active.id=reserved.checkout_session_id
          WHERE reserved.ticket_type_id=tt.id
            AND active.id<>p_session_id
            AND active.expires_at>now()
            AND active.order_id IS NULL
            AND active.revoked_at IS NULL
            AND active.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
        + i.quantity > tt.quantity_total)
    )
  ) INTO v_bad;
  IF v_bad THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND (s.metadata->>'event_date_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.event_dates d
        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id
          AND d.end_at > now())) THEN RETURN false; END IF;
  -- ══ issue #2160 — RE-VALIDATE **EVERY** CHOSEN DAY, NOT JUST THE ANCHOR ══
  -- The clause above re-checks only `metadata->>'event_date_id'`, which under
  -- #2160 is the ANCHOR (the latest-ENDING day). Without the clause below a
  -- stale NON-anchor day could still mint an entitlement at finalize for an
  -- occurrence that has already ended — the guest gets a pass for a day that
  -- is over, and the scanner correctly refuses them at a door they paid for.
  --
  -- DELETE THIS BLOCK and a session that sat in the cart across the end of
  -- day 1 finalizes into a day-1 pass.
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_session_event_dates i
             WHERE i.checkout_session_id=p_session_id
               AND NOT EXISTS(SELECT 1 FROM public.event_dates d
                 WHERE d.id=i.event_date_id AND d.event_id=p_event_id
                   AND d.end_at > now())) THEN RETURN false; END IF;
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  p_checkout_session_id uuid,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_stripe_payment_method_type text,
  p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL,
  p_saved_payment_method_id text DEFAULT NULL,
  p_installment_plan_root boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_session record;
  v_item record;
  v_order_id uuid;
  v_ticket_id uuid;
  v_token text;
  v_token_hash text;
  v_qr text;
  v_tickets jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_method text;
  v_qr_token_pepper text;
  i integer;
  v_schedule jsonb;
  v_inst_array jsonb;
  v_inst_item jsonb;
  v_inst_count int;
  v_idx int;
  v_inst_amount bigint;
  v_inst_currency char(3);
  v_inst_due timestamptz;
  -- issue #2160 DELTA 1 of 4 — the pricing mode and the chosen day set.
  v_pricing_mode text := 'per_day';
  v_days uuid[];
  v_line_days uuid[]; -- issue #3281: the dates this line's passes admit
  v_day_count integer;
  v_date_qty integer := 0;
  v_day_id uuid;
  -- issue #3827 — the mint helper's result.
  v_mint jsonb;
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  SELECT *
    INTO v_session
    FROM public.ticket_checkout_sessions
   WHERE id = p_checkout_session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found';
  END IF;

  IF v_session.order_id IS NOT NULL THEN
    -- ORCH-0921: replace the silent early-return with compare-and-correct.
    -- When the second caller passes p_installment_plan_root=true AND the
    -- existing order row has installment_plan_root=false AND the session
    -- carries an installment_schedule AND zero order_installments rows exist,
    -- backfill the missing installment-plan state. Idempotent: re-running
    -- after the backfill is a no-op (the EXISTS checks prevent duplicate
    -- INSERTs and redundant UPDATEs).
    IF p_installment_plan_root
       AND v_session.installment_schedule IS NOT NULL
       -- issue #3645: a Paystack plan has no Stripe customer/card pair.
       AND ((p_stripe_customer_id_on_connected_account IS NOT NULL
             AND p_saved_payment_method_id IS NOT NULL)
            OR public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id))
       AND EXISTS (
         SELECT 1 FROM public.orders
         WHERE id = v_session.order_id
           AND installment_plan_root = false
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.order_installments
         WHERE order_id = v_session.order_id
       )
    THEN
      v_schedule := v_session.installment_schedule;
      v_inst_array := v_schedule -> 'installments';
      v_inst_currency := COALESCE((v_schedule ->> 'currency')::char(3), v_session.currency);
      v_inst_count := COALESCE(jsonb_array_length(v_inst_array), 0);

      FOR v_idx IN 0 .. v_inst_count - 1 LOOP
        v_inst_item := v_inst_array -> v_idx;
        v_inst_amount := COALESCE((v_inst_item ->> 'amountCents')::bigint, 0);
        v_inst_due := (v_inst_item ->> 'dueAt')::timestamptz;

        IF v_inst_amount <= 0 THEN
          RAISE EXCEPTION 'installment_amount_invalid';
        END IF;

        INSERT INTO public.order_installments (
          order_id, ordinal, amount_cents, currency, due_at, status,
          provider, collection_method, plan_bound_at
        ) VALUES (
          v_session.order_id,
          (v_inst_item ->> 'ordinal')::smallint,
          v_inst_amount,
          v_inst_currency,
          v_inst_due,
          'scheduled',
          CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
               THEN 'paystack' ELSE 'stripe' END,
          CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
               THEN 'pay_link' ELSE 'auto_card' END,
          CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
               THEN NULL ELSE now() END
        );
      END LOOP;

      UPDATE public.orders
         SET installment_plan_root = true,
             stripe_customer_id_on_connected_account = p_stripe_customer_id_on_connected_account,
             saved_payment_method_id = p_saved_payment_method_id,
             updated_at = now()
       WHERE id = v_session.order_id;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ticketId', t.id,
      'ticketTypeId', t.ticket_type_id,
      'ticketName', tt.name,
      'qrPayload', t.qr_code,
      'status', t.status,
      -- issue #2160 DELTA 2 of 4 — the days THIS pass admits, so the client
      -- can label it without a second read. `[]` for every pre-#2160 pass,
      -- which is what "not day-scoped" looks like on the wire.
      'eventDateIds', COALESCE((
        SELECT jsonb_agg(ted.event_date_id ORDER BY ed.start_at, ed.id)
          FROM public.ticket_event_dates ted
          JOIN public.event_dates ed ON ed.id = ted.event_date_id
         WHERE ted.ticket_id = t.id), '[]'::jsonb)
    ) ORDER BY t.created_at), '[]'::jsonb)
      INTO v_tickets
      FROM public.tickets t
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.order_id = v_session.order_id;

    RETURN jsonb_build_object(
      'orderId', v_session.order_id,
      'checkoutSessionId', v_session.id,
      'eventId', v_session.event_id,
      'paymentStatus', 'paid',
      'totalCents', v_session.total_cents,
      'currency', trim(v_session.currency),
      'tickets', v_tickets,
      'notificationStatus', 'queued',
      'installmentPlanRoot', (
        SELECT installment_plan_root FROM public.orders WHERE id = v_session.order_id
      )
    );
  END IF;

  IF v_session.total_cents > 0 AND COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id) IS NULL THEN
    RAISE EXCEPTION 'payment_intent_required';
  END IF;

  v_order_id := gen_random_uuid();
  v_method := CASE
    WHEN v_session.total_cents = 0 THEN 'free'
    WHEN p_stripe_payment_method_type = 'apple_pay' THEN 'apple_pay'
    WHEN p_stripe_payment_method_type = 'google_pay' THEN 'google_pay'
    ELSE 'online_card'
  END;

  v_schedule := v_session.installment_schedule;

  INSERT INTO public.orders (
    id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone,
    buyer_phone_e164, total_cents, currency, payment_method, payment_status,
    stripe_payment_intent_id, stripe_charge_id, is_door_sale, metadata,
    checkout_session_id, source, confirmed_at, notification_status,
    stripe_application_fee_amount_cents, stripe_transfer_destination,
    stripe_payment_method_type, stripe_payment_intent_status, created_at, updated_at,
    installment_plan_root,
    stripe_customer_id_on_connected_account,
    saved_payment_method_id,
    pricing_breakdown,
    -- ORCH-1188 FIX 3b: persist the buyer's selected occurrence (NULL-safe).
    event_date_id,
    -- issue #3281 — copy session booked start onto the paid order.
    booked_start_at,
    booked_end_at,
    booked_party_size
  ) VALUES (
    v_order_id, v_session.event_id, v_session.buyer_user_id, v_session.buyer_email,
    v_session.buyer_name, v_session.buyer_phone_e164, v_session.buyer_phone_e164,
    v_session.total_cents, v_session.currency, v_method, 'paid',
    COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id),
    p_stripe_charge_id, false,
    jsonb_build_object(
      'checkout_session_id', v_session.id,
      'marketing_opt_in', v_session.marketing_opt_in
    ),
    v_session.id, 'online_checkout', v_now, 'pending',
    COALESCE(v_session.stripe_application_fee_amount_cents, 0), v_session.stripe_account_id,
    p_stripe_payment_method_type,
    CASE WHEN v_session.total_cents = 0 THEN NULL ELSE 'succeeded' END,
    v_now, v_now,
    COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false),
    CASE WHEN p_installment_plan_root THEN p_stripe_customer_id_on_connected_account ELSE NULL END,
    CASE WHEN p_installment_plan_root THEN p_saved_payment_method_id ELSE NULL END,
    v_session.pricing_breakdown,
    -- ORCH-1188 FIX 3b: the occurrence the buyer booked, read from the session
    -- metadata jsonb (NULL for single-date events / no selection). NULLIF guards
    -- an empty string, ::uuid is NULL-safe on NULL input.
    NULLIF(v_session.metadata->>'event_date_id', '')::uuid,
    v_session.booked_start_at,
    v_session.booked_end_at,
    v_session.booked_party_size
  );

  IF p_installment_plan_root AND v_schedule IS NOT NULL THEN
    -- issue #3645: Stripe plans need the customer + saved card; a Paystack plan
    -- binds its price (and any reusable card) right after finalize.
    IF NOT public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
       AND (p_stripe_customer_id_on_connected_account IS NULL OR p_saved_payment_method_id IS NULL) THEN
      RAISE EXCEPTION 'installment_plan_finalize_missing_customer_or_pm';
    END IF;

    v_inst_array := v_schedule -> 'installments';
    v_inst_currency := COALESCE((v_schedule ->> 'currency')::char(3), v_session.currency);
    v_inst_count := COALESCE(jsonb_array_length(v_inst_array), 0);

    FOR v_idx IN 0 .. v_inst_count - 1 LOOP
      v_inst_item := v_inst_array -> v_idx;
      v_inst_amount := COALESCE((v_inst_item ->> 'amountCents')::bigint, 0);
      v_inst_due := (v_inst_item ->> 'dueAt')::timestamptz;

      IF v_inst_amount <= 0 THEN
        RAISE EXCEPTION 'installment_amount_invalid';
      END IF;

      INSERT INTO public.order_installments (
        order_id, ordinal, amount_cents, currency, due_at, status,
        provider, collection_method, plan_bound_at
      ) VALUES (
        v_order_id,
        (v_inst_item ->> 'ordinal')::smallint,
        v_inst_amount,
        v_inst_currency,
        v_inst_due,
        'scheduled',
        CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
             THEN 'paystack' ELSE 'stripe' END,
        CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
             THEN 'pay_link' ELSE 'auto_card' END,
        CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
             THEN NULL ELSE v_now END
      );
    END LOOP;
  END IF;

  INSERT INTO public.order_line_items (
    order_id, ticket_type_id, quantity, unit_price_cents, total_cents
  )
  SELECT v_order_id, ticket_type_id, quantity, unit_price_cents, total_cents
    FROM public.ticket_checkout_session_items
   WHERE checkout_session_id = v_session.id;

  -- ══ issue #2160 DELTA 3 of 4 — MINT UNDER THE MODE THE GUEST WAS QUOTED ═
  --
  -- THE SNAPSHOT, NOT A FRESH READ OF `events`. The session was PRICED and
  -- SIZED under `multi_date_pricing_mode_snapshot` at create; minting under a
  -- different value issues a pass that does not match what the guest paid for,
  -- in both directions (§A.7 states the two reproductions). The lock cannot
  -- prevent the flip, because an in-flight session holds no ticket yet — which
  -- is precisely the window this line closes.
  --
  -- DELETE THE SNAPSHOT READ and an organiser flipping the mode mid-checkout
  -- either takes a two-day guest's money and admits them on one day, or sells
  -- two admissions and lets four people in.
  --
  -- COALESCE to the live event ONLY for a session created before the column
  -- existed, so anything already in flight at deploy still finalizes.
  SELECT COALESCE(
           v_session.multi_date_pricing_mode_snapshot,
           (SELECT e.multi_date_pricing_mode FROM public.events e
             WHERE e.id = v_session.event_id),
           'per_day')
    INTO v_pricing_mode;

  -- The day set, ordered by start_at so the per_day round-robin below is
  -- deterministic and testable, not incidental.

  SELECT ARRAY(
           SELECT d.event_date_id
             FROM public.ticket_checkout_session_event_dates d
             JOIN public.event_dates ed ON ed.id = d.event_date_id
            WHERE d.checkout_session_id = v_session.id
            ORDER BY ed.start_at, ed.id
         ) INTO v_days;
  v_day_count := COALESCE(array_length(v_days, 1), 0);

  FOR v_item IN
    SELECT *
      FROM public.ticket_checkout_session_items
     WHERE checkout_session_id = v_session.id
     ORDER BY created_at, id
  LOOP
    -- issue #3281 — an all_days pass admits only this ticket's own dates.
    v_line_days := COALESCE(public.issue_3281_days_in_scope(v_item.ticket_type_id, v_days), v_days);
    -- issue #3281 PR10 — when by_date is set, mint each date's own quantity
    -- instead of round-robin on the summed quantity. Create already rejects
    -- by_date under all_days; fail closed here if a legacy row still has it.
    IF v_item.by_date IS NOT NULL AND jsonb_typeof(v_item.by_date) = 'object'
       AND v_pricing_mode = 'all_days' THEN
      RAISE EXCEPTION 'by_date_not_supported_for_all_days';
    END IF;
    IF v_item.by_date IS NOT NULL AND jsonb_typeof(v_item.by_date) = 'object'
       AND v_day_count > 0 AND v_pricing_mode <> 'all_days' THEN
      FOREACH v_day_id IN ARRAY v_days LOOP
        v_date_qty := COALESCE((v_item.by_date ->> v_day_id::text)::integer, 0);
        FOR i IN 1..v_date_qty LOOP
          v_mint := public.issue_3827_mint_ticket(
            v_order_id, v_session.event_id, v_item.ticket_type_id,
            v_session.buyer_name, v_session.buyer_email, v_session.buyer_phone_e164,
            v_qr_token_pepper, v_now
          );
          v_ticket_id := (v_mint ->> 'ticketId')::uuid;
          v_qr := v_mint ->> 'qrPayload';
          INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
          VALUES (v_ticket_id, v_day_id) ON CONFLICT DO NOTHING;
          v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
            'ticketId', v_ticket_id,
            'ticketTypeId', v_item.ticket_type_id,
            'ticketName', v_item.ticket_name_at_purchase,
            'qrPayload', v_qr,
            'status', 'valid',
            'eventDateIds', jsonb_build_array(v_day_id)
          ));
        END LOOP;
      END LOOP;
      CONTINUE;
    END IF;

    FOR i IN 1..v_item.quantity LOOP
      -- issue #3827 — THE ONE MINT. The token, its hash, the signed QR payload
      -- and the tickets row are now minted by issue_3827_mint_ticket, whose body
      -- is the block that stood here, verbatim. Host guest-list comps call the
      -- same helper, so a comp QR and a bought QR can never drift apart.
      v_mint := public.issue_3827_mint_ticket(
        v_order_id, v_session.event_id, v_item.ticket_type_id,
        v_session.buyer_name, v_session.buyer_email, v_session.buyer_phone_e164,
        v_qr_token_pepper, v_now
      );
      v_ticket_id := (v_mint ->> 'ticketId')::uuid;
      v_qr := v_mint ->> 'qrPayload';

      -- ══ issue #2160 DELTA 4 of 4 — MINT THE ADMISSION ENTITLEMENTS ═════
      -- A pass admits the days it has rows for. The mint loop itself is
      -- UNCHANGED — `v_item.quantity` already carries the per-day multiplier
      -- from the create-session base (amendment §1), so all that differs
      -- between the modes is how the days are DISTRIBUTED.
      --
      --   zero days   -> NO ROWS. Not day-scoped. Today's any-occurrence
      --                  admission window, byte-identical, which is what
      --                  every pass issued before #2160 has and must keep.
      --   all_days    -> one row per chosen day on the SINGLE pass.
      --   per_day     -> ONE row, dealt round-robin across the ordered day
      --                  set: with quantity = qty x D this yields exactly
      --                  `qty` passes per day, deterministically.
      --
      -- DELETE THIS BLOCK and every pass mints with zero days, so a guest is
      -- admitted on a day they did not pay for and the whole issue reverts.
      IF v_day_count > 0 THEN
        IF v_pricing_mode = 'all_days' THEN
          FOREACH v_day_id IN ARRAY v_line_days LOOP
            INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
            VALUES (v_ticket_id, v_day_id) ON CONFLICT DO NOTHING;
          END LOOP;
        ELSE
          INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
          VALUES (v_ticket_id, v_days[((i - 1) % v_day_count) + 1])
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;

      v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
        'ticketId', v_ticket_id,
        'ticketTypeId', v_item.ticket_type_id,
        'ticketName', v_item.ticket_name_at_purchase,
        'qrPayload', v_qr,
        'status', 'valid',
        'eventDateIds', CASE
          WHEN v_day_count = 0 THEN '[]'::jsonb
          WHEN v_pricing_mode = 'all_days' THEN to_jsonb(v_line_days)
          ELSE jsonb_build_array(v_days[((i - 1) % v_day_count) + 1])
        END
      ));
    END LOOP;
  END LOOP;

  PERFORM public.add_buyer_to_event_chat(
    v_session.event_id,
    v_session.buyer_user_id,
    v_order_id,
    v_session.buyer_email
  );

  INSERT INTO public.ticket_order_notifications (
    order_id, event_id, channel, recipient, idempotency_key, payload
  ) VALUES
    (
      v_order_id,
      v_session.event_id,
      'email',
      v_session.buyer_email,
      'ticket_confirmation:' || v_order_id::text || ':email',
      jsonb_build_object('checkoutSessionId', v_session.id)
    ),
    (
      v_order_id,
      v_session.event_id,
      'sms',
      v_session.buyer_phone_e164,
      'ticket_confirmation:' || v_order_id::text || ':sms',
      jsonb_build_object('checkoutSessionId', v_session.id)
    )
  ON CONFLICT (idempotency_key) DO NOTHING;

  UPDATE public.ticket_checkout_sessions
     SET order_id = v_order_id,
         status = CASE WHEN total_cents = 0 THEN 'free_completed' ELSE 'paid_completed' END,
         stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
         completed_at = v_now,
         updated_at = v_now
   WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'orderId', v_order_id,
    'checkoutSessionId', v_session.id,
    'eventId', v_session.event_id,
    'paymentStatus', 'paid',
    'totalCents', v_session.total_cents,
    'currency', trim(v_session.currency),
    'tickets', v_tickets,
    'notificationStatus', 'queued',
    'installmentPlanRoot', COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3872_ticket_sale_json(p_ticket_type_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'saleBaseCents',s.sale_base_cents,
    'saleAllInCents',CASE WHEN s.sale_base_cents IS NULL THEN NULL ELSE public.compute_all_in_cents(
      s.sale_base_cents,COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),
      COALESCE(e.pass_service_fee,b.default_pass_service_fee),
      (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
    ) END,
    'saleEndsAt',s.sale_ends_at,
    'saleName',s.sale_name,
    'saleRemaining',s.sale_remaining
  ) || CASE WHEN tt.valid_occurrence_keys IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object(
      -- issue #3281 — keys exist only on day-limited tickets, so every other
      -- ticket's payload is unchanged. No counts: "Hide remaining" still holds.
      -- The reader's run-wide remaining would read sold out after one full date.
      'remaining',public.issue_3281_listed_remaining(tt.id),
      'validOccurrenceIds',COALESCE((
        SELECT jsonb_agg(d.id ORDER BY d.start_at,d.id) FROM public.event_dates d
         WHERE d.event_id=tt.event_id AND d.occurrence_key=ANY(tt.valid_occurrence_keys)
      ),'[]'::jsonb),
      'soldOutOccurrenceIds',COALESCE((
        SELECT jsonb_agg(d.id ORDER BY d.start_at,d.id) FROM public.event_dates d
         WHERE d.event_id=tt.event_id AND d.occurrence_key=ANY(tt.valid_occurrence_keys)
           AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL
           AND public.issue_3313_ticket_type_occurrence_taken(tt.id,d.id)>=tt.quantity_total
      ),'[]'::jsonb)
    ) END
  FROM public.ticket_types tt
  JOIN public.events e ON e.id=tt.event_id
  JOIN public.brands b ON b.id=e.brand_id
  LEFT JOIN LATERAL public.issue_3872_display_sale_unit(tt.id,now()) s ON true
  WHERE tt.id=p_ticket_type_id;
$fn$;

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
      -- issue #3281 — per date: the best upcoming date, so a ticket only reads
      -- sold out once every one of its dates is.
      WHEN tt.valid_occurrence_keys IS NOT NULL THEN public.issue_3281_listed_remaining(tt.id)
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
    AND COALESCE(tt.is_hidden, false) = false
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

-- Existing multi-date events take their keys from the stored schedule. A date
-- that matches nothing keeps a NULL key, and a list naming it is refused.
DO $backfill$
DECLARE
  v_event record;
BEGIN
  FOR v_event IN
    SELECT e.id, e.theme#>'{business_event,multiDates}' AS multi
      FROM public.events e
     WHERE e.is_multi_date
       AND jsonb_typeof(e.theme#>'{business_event,multiDates}') = 'array'
  LOOP
    BEGIN
      PERFORM public.issue_3281_sync_occurrence_keys(v_event.id, v_event.multi);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_3281_day_limited_tickets: no keys for event %: %', v_event.id, SQLERRM;
    END;
  END LOOP;
END;
$backfill$;

DO $verify$
BEGIN
  IF position('issue_3281_assert_line_days' IN pg_get_functiondef(
       'public.issue_3872_ticket_quote(uuid, jsonb, uuid[], timestamptz, timestamptz, integer, text, text, text, text, uuid, text, boolean)'::regprocedure)) = 0
     OR position('issue_3281_assert_line_days' IN pg_get_functiondef(
       'public.issue_1930_ticket_checkout_create_session_base'::regproc)) = 0 THEN
    RAISE EXCEPTION 'issue_3281_day_limited_tickets: a checkout path ignores day lists';
  END IF;
  IF position('v_line_days' IN pg_get_functiondef(
       'public.issue_1930_ticket_checkout_finalize_base(uuid, text, text, text, text, text, text, boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue_3281_day_limited_tickets: mint ignores day lists';
  END IF;
  IF position('issue_3281_strip_removed_days' IN pg_get_functiondef(
       'public.business_patch_event_when(uuid, jsonb, text, integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue_3281_day_limited_tickets: a date edit leaves stale day lists';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

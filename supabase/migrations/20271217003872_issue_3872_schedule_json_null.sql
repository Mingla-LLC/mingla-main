-- #3872 R1 post-merge correction: normalize JSON null schedules at the table boundary.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- The Host draft serializer includes `"schedule": null` for code discounts and
-- for automatic discounts whose weekly schedule was cleared. PostgreSQL casts
-- that JSON token to jsonb `null`, not SQL NULL, so the intended nullable column
-- instead tripped bd_schedule_kind / bd_schedule_shape. Keep the invariant at
-- the table boundary so every present and future writer gets the same safe
-- representation before constraints run.
CREATE OR REPLACE FUNCTION public.issue_3872_normalize_schedule_null()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.schedule = 'null'::jsonb THEN
    NEW.schedule := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_normalize_schedule_null() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3872_schedule_json_null ON public.brand_discounts;
CREATE TRIGGER issue_3872_schedule_json_null
BEFORE INSERT OR UPDATE OF schedule ON public.brand_discounts
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_normalize_schedule_null();

COMMENT ON FUNCTION public.issue_3872_normalize_schedule_null() IS
  'Issue #3872: converts JSON null schedules to SQL NULL before discount constraints run.';

-- PostgreSQL 17 has no built-in min(uuid) aggregate. The R1 writer used it to
-- inspect the only target for sale-price validation, which meant every create
-- or update reached a function-not-found error after its target loop. Preserve
-- the shipped writer contract and aggregate the textual UUID ordering before
-- casting the single result back to uuid.
CREATE OR REPLACE FUNCTION public.issue_3872_upsert_discount(
  p_actor uuid,
  p_action text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $fn$
DECLARE
  v_id uuid;
  v_brand uuid;
  v_kind text;
  v_rank integer;
  v_row public.brand_discounts%ROWTYPE;
  v_t jsonb;
  v_target_brand uuid;
  v_target_count integer;
  v_target_kind text;
  v_target_id uuid;
  v_list_minor integer;
  v_brand_currency text;
BEGIN
  v_id := NULLIF(p_payload->>'id','')::uuid;
  v_brand := NULLIF(p_payload->>'brandId','')::uuid;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.brand_discounts WHERE id=v_id FOR UPDATE;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'discount_not_found'; END IF;
    v_brand := v_row.brand_id;
  END IF;
  IF v_brand IS NULL THEN RAISE EXCEPTION 'brand_required'; END IF;

  v_kind := COALESCE(p_payload->>'kind',v_row.kind);
  v_rank := COALESCE(public.biz_brand_effective_rank(v_brand,p_actor),0);
  IF v_rank < (CASE WHEN v_kind='code' THEN 20 ELSE 30 END) THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;
  IF v_kind='voucher' THEN RAISE EXCEPTION 'kind_not_available'; END IF;
  SELECT upper(COALESCE(pricing_currency,default_currency))
    INTO v_brand_currency FROM public.brands WHERE id=v_brand;

  IF p_action='create' THEN
    IF v_kind IN ('automatic','sale_price') AND (
      SELECT count(*) FROM public.brand_discounts
       WHERE brand_id=v_brand AND kind IN ('automatic','sale_price')
         AND status='active' AND deleted_at IS NULL
    ) >= 20 THEN RAISE EXCEPTION 'too_many_automatics'; END IF;

    INSERT INTO public.brand_discounts(
      brand_id,kind,code,name,value_type,value_bps,value_minor,currency,
      scope_kind,combines_with,starts_at,ends_at,schedule,ends_after_count,
      max_total_uses,max_uses_per_buyer,min_subtotal_minor,status,source,
      source_ref,created_by
    ) VALUES (
      v_brand,v_kind,
      NULLIF(upper(regexp_replace(btrim(COALESCE(p_payload->>'code','')),'[\s-]','','g')),''),
      p_payload->>'name',p_payload->>'valueType',
      NULLIF(p_payload->>'valueBps','')::integer,
      NULLIF(p_payload->>'valueMinor','')::integer,
      CASE WHEN p_payload->>'valueType'='percent' THEN NULL ELSE v_brand_currency END,
      p_payload->>'scopeKind',
      COALESCE(p_payload->>'combinesWith',
        CASE WHEN v_kind IN ('automatic','sale_price') THEN 'any' ELSE 'automatic_only' END),
      COALESCE(NULLIF(p_payload->>'startsAt','')::timestamptz,now()),
      NULLIF(p_payload->>'endsAt','')::timestamptz,
      p_payload->'schedule',NULLIF(p_payload->>'endsAfterCount','')::integer,
      NULLIF(p_payload->>'maxTotalUses','')::integer,
      NULLIF(p_payload->>'maxUsesPerBuyer','')::integer,
      NULLIF(p_payload->>'minSubtotalMinor','')::integer,
      COALESCE(p_payload->>'status','active'),COALESCE(p_payload->>'source','host'),
      NULLIF(p_payload->>'sourceRef','')::uuid,p_actor
    ) RETURNING * INTO v_row;
    v_id := v_row.id;
  ELSIF p_action='update' THEN
    IF v_row.version<>COALESCE(NULLIF(p_payload->>'version','')::integer,-1) THEN
      RAISE EXCEPTION 'version_conflict';
    END IF;
    UPDATE public.brand_discounts SET
      kind = CASE WHEN p_payload?'kind' THEN p_payload->>'kind' ELSE kind END,
      code = CASE WHEN p_payload?'code' THEN NULLIF(upper(regexp_replace(btrim(COALESCE(p_payload->>'code','')),'[\s-]','','g')),'') ELSE code END,
      name = CASE WHEN p_payload?'name' THEN p_payload->>'name' ELSE name END,
      value_type = CASE WHEN p_payload?'valueType' THEN p_payload->>'valueType' ELSE value_type END,
      value_bps = CASE WHEN p_payload?'valueBps' THEN NULLIF(p_payload->>'valueBps','')::integer ELSE value_bps END,
      value_minor = CASE WHEN p_payload?'valueMinor' THEN NULLIF(p_payload->>'valueMinor','')::integer ELSE value_minor END,
      currency = CASE
        WHEN p_payload?'valueType' AND p_payload->>'valueType'='percent' THEN NULL
        WHEN p_payload?'valueType' OR p_payload?'valueMinor' THEN v_brand_currency
        ELSE currency END,
      scope_kind = CASE WHEN p_payload?'scopeKind' THEN p_payload->>'scopeKind' ELSE scope_kind END,
      combines_with = CASE WHEN p_payload?'combinesWith' THEN p_payload->>'combinesWith' ELSE combines_with END,
      starts_at = CASE WHEN p_payload?'startsAt' THEN (p_payload->>'startsAt')::timestamptz ELSE starts_at END,
      ends_at = CASE WHEN p_payload?'endsAt' THEN NULLIF(p_payload->>'endsAt','')::timestamptz ELSE ends_at END,
      schedule = CASE WHEN p_payload?'schedule' THEN p_payload->'schedule' ELSE schedule END,
      ends_after_count = CASE WHEN p_payload?'endsAfterCount' THEN NULLIF(p_payload->>'endsAfterCount','')::integer ELSE ends_after_count END,
      max_total_uses = CASE WHEN p_payload?'maxTotalUses' THEN NULLIF(p_payload->>'maxTotalUses','')::integer ELSE max_total_uses END,
      max_uses_per_buyer = CASE WHEN p_payload?'maxUsesPerBuyer' THEN NULLIF(p_payload->>'maxUsesPerBuyer','')::integer ELSE max_uses_per_buyer END,
      min_subtotal_minor = CASE WHEN p_payload?'minSubtotalMinor' THEN NULLIF(p_payload->>'minSubtotalMinor','')::integer ELSE min_subtotal_minor END,
      needs_attention = NULL
    WHERE id=v_id RETURNING * INTO v_row;
    DELETE FROM public.brand_discount_targets WHERE discount_id=v_id;
  ELSIF p_action IN ('pause','resume','end') THEN
    UPDATE public.brand_discounts
       SET status=CASE p_action WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'active' ELSE 'ended' END,
           ended_reason=CASE WHEN p_action='end' THEN 'host' ELSE NULL END
     WHERE id=v_id RETURNING * INTO v_row;
  ELSIF p_action='delete_draft' THEN
    IF v_row.status<>'draft' OR (v_row.created_by<>p_actor AND v_rank<50) THEN
      RAISE EXCEPTION 'delete_not_allowed';
    END IF;
    UPDATE public.brand_discounts SET deleted_at=now() WHERE id=v_id RETURNING * INTO v_row;
  ELSE
    RAISE EXCEPTION 'discount_action_invalid';
  END IF;

  IF p_action IN ('create','update') THEN
    FOR v_t IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'targets','[]'::jsonb)) LOOP
      v_target_brand := NULL;
      IF v_t->>'targetKind'='event' THEN
        SELECT brand_id INTO v_target_brand FROM public.events
         WHERE id=(v_t->>'targetId')::uuid AND event_type<>'rsvp' AND deleted_at IS NULL;
      ELSIF v_t->>'targetKind'='ticket_type' THEN
        SELECT e.brand_id INTO v_target_brand FROM public.ticket_types tt
        JOIN public.events e ON e.id=tt.event_id
         WHERE tt.id=(v_t->>'targetId')::uuid AND tt.deleted_at IS NULL AND e.deleted_at IS NULL;
      ELSIF v_t->>'targetKind'='menu_item' THEN
        SELECT brand_id INTO v_target_brand FROM public.menu_items WHERE id=(v_t->>'targetId')::uuid;
      ELSIF v_t->>'targetKind' IN ('venue_menu','venue_deposit') THEN
        SELECT brand_id INTO v_target_brand FROM public.venue_listings WHERE id=(v_t->>'targetId')::uuid;
      ELSIF v_t->>'targetKind'='listing_kind' THEN
        v_target_brand := v_brand;
      END IF;
      IF v_target_brand IS NULL THEN RAISE EXCEPTION 'target_not_discountable'; END IF;
      IF v_target_brand<>v_brand THEN RAISE EXCEPTION 'target_not_in_brand'; END IF;
      INSERT INTO public.brand_discount_targets(discount_id,target_kind,listing_kind,target_id)
      VALUES(v_id,v_t->>'targetKind',NULLIF(v_t->>'listingKind',''),NULLIF(v_t->>'targetId','')::uuid);
    END LOOP;

    SELECT count(*),min(target_kind),min(target_id::text)::uuid
      INTO v_target_count,v_target_kind,v_target_id
      FROM public.brand_discount_targets WHERE discount_id=v_id;
    IF (v_row.value_type='set_price' OR v_row.kind='sale_price') AND v_target_count<>1 THEN
      RAISE EXCEPTION 'set_price_needs_one_item';
    END IF;
    IF v_row.value_type='set_price' OR v_row.kind='sale_price' THEN
      IF v_target_kind='ticket_type' THEN
        SELECT price_cents INTO v_list_minor FROM public.ticket_types WHERE id=v_target_id;
      ELSIF v_target_kind='menu_item' THEN
        SELECT price_cents INTO v_list_minor FROM public.menu_items WHERE id=v_target_id;
      ELSIF v_target_kind='venue_deposit' THEN
        SELECT fee_amount_cents INTO v_list_minor FROM public.venue_reservation_settings WHERE venue_id=v_target_id;
      END IF;
      IF v_list_minor IS NULL THEN RAISE EXCEPTION 'target_not_discountable'; END IF;
      IF v_row.value_minor>=v_list_minor THEN RAISE EXCEPTION 'set_price_not_lower'; END IF;
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.brand_discounts WHERE id=v_id;
  RETURN to_jsonb(v_row)||jsonb_build_object('targets',COALESCE((
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at,t.id)
      FROM public.brand_discount_targets t WHERE t.discount_id=v_id
  ),'[]'::jsonb));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'code_taken';
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_upsert_discount(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_upsert_discount(uuid,text,jsonb) TO service_role;

COMMENT ON FUNCTION public.issue_3872_upsert_discount(uuid,text,jsonb) IS
  'Issue #3872: Host discount writer with JSON-null schedule normalization and PostgreSQL 17-safe UUID target aggregation.';

COMMIT;

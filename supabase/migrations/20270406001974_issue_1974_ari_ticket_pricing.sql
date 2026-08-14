-- Issue #1974 — one ticket-tier and pricing owner for Ari + Business.
--
-- Deliberately does NOT define agent_operation_receipts. Issue #1972 owns the
-- shared atomic receipt API. p_operation_id is accepted as immutable execution
-- context and is used as the deterministic identity for Ari-created tiers;
-- once #1972 lands, the orchestrator integrates this command with that shared
-- receipt in the same transaction rather than creating a competing receipt.

BEGIN;

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
    ));
  END LOOP;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_1974_normalize_ticket_tiers(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1974_normalize_ticket_tiers(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.business_patch_event_ticket_tiers(
  p_event_id uuid,
  p_tiers jsonb,
  p_expected_event_updated_at timestamptz DEFAULT NULL,
  p_expected_client_revision integer DEFAULT NULL,
  p_operation_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_tiers) t
      WHERE (t->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) THEN RAISE EXCEPTION 'live_ticket_id_must_be_uuid'; END IF;

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
        SELECT count(*)::integer INTO v_sold FROM public.tickets tk
        WHERE tk.ticket_type_id=v_existing.id AND tk.status IN ('valid','used','transferred');
        IF v_sold>0 AND (
          v_existing.price_cents IS DISTINCT FROM CASE WHEN (v_tier->>'isFree')::boolean THEN 0 ELSE round((v_tier->>'priceGbp')::numeric*100)::integer END OR
          v_existing.is_free IS DISTINCT FROM (v_tier->>'isFree')::boolean OR
          COALESCE((v_tier->>'capacity')::integer,2147483647)<v_sold OR
          v_existing.is_hidden IS DISTINCT FROM ((v_tier->>'visibility')='hidden') OR
          v_existing.is_disabled IS DISTINCT FROM ((v_tier->>'visibility')='disabled') OR
          v_existing.available_online IS DISTINCT FROM ((v_tier->>'availableAt') IN ('online','both')) OR
          v_existing.sale_start_at IS DISTINCT FROM NULLIF(v_tier->>'saleStartAt','')::timestamptz OR
          v_existing.sale_end_at IS DISTINCT FROM NULLIF(v_tier->>'saleEndAt','')::timestamptz
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
          display_order=(v_tier->>'displayOrder')::integer,updated_at=now()
        WHERE id=v_existing.id;
      ELSE
        IF (v_tier->>'passwordProtected')::boolean THEN RAISE EXCEPTION 'ticket_password_setup_required'; END IF;
        INSERT INTO public.ticket_types(
          id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,
          sale_start_at,sale_end_at,min_purchase_qty,max_purchase_qty,is_hidden,is_disabled,
          requires_approval,allow_transfers,password_protected,available_online,available_in_person,
          waitlist_enabled,display_order
        ) VALUES (
          (v_tier->>'id')::uuid,p_event_id,v_tier->>'name',NULLIF(v_tier->>'description',''),
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
$$;

REVOKE ALL ON FUNCTION public.business_patch_event_ticket_tiers(uuid,jsonb,timestamptz,integer,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_patch_event_ticket_tiers(uuid,jsonb,timestamptz,integer,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.business_patch_pricing_switches(p_event_id uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_event public.events%ROWTYPE;v_uid uuid:=auth.uid();v_tax boolean;v_mingla boolean;v_service boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required';END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb THEN RAISE EXCEPTION 'empty_pricing_patch';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) AS keys(key) WHERE key NOT IN('pass_tax','pass_mingla_fee','pass_service_fee')) THEN RAISE EXCEPTION 'invalid_pricing_patch';END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF v_event.event_type NOT IN('event','experience') OR v_event.status IN('ended','cancelled') THEN RAISE EXCEPTION 'event_not_editable_status';END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('finance_manager') THEN RAISE EXCEPTION 'insufficient_finance_permission';END IF;
  IF v_event.pricing_locked_at IS NOT NULL THEN RAISE EXCEPTION 'pricing_switches_locked';END IF;
  v_tax:=CASE WHEN p_patch?'pass_tax' THEN (p_patch->>'pass_tax')::boolean ELSE v_event.pass_tax END;
  v_mingla:=CASE WHEN p_patch?'pass_mingla_fee' THEN (p_patch->>'pass_mingla_fee')::boolean ELSE v_event.pass_mingla_fee END;
  v_service:=CASE WHEN p_patch?'pass_service_fee' THEN (p_patch->>'pass_service_fee')::boolean ELSE v_event.pass_service_fee END;
  UPDATE public.events SET pass_tax=v_tax,pass_mingla_fee=v_mingla,pass_service_fee=v_service,updated_at=now() WHERE id=p_event_id;
  RETURN jsonb_build_object('event_id',p_event_id,'updated_at',(SELECT updated_at FROM public.events WHERE id=p_event_id),
    'overrides',jsonb_build_object('pass_tax',v_tax,'pass_mingla_fee',v_mingla,'pass_service_fee',v_service),
    'resolved',jsonb_build_object('pass_tax',COALESCE(v_tax,(SELECT default_pass_tax FROM public.brands WHERE id=v_event.brand_id)),
      'pass_mingla_fee',COALESCE(v_mingla,(SELECT default_pass_mingla_fee FROM public.brands WHERE id=v_event.brand_id)),
      'pass_service_fee',COALESCE(v_service,(SELECT default_pass_service_fee FROM public.brands WHERE id=v_event.brand_id))));
END;$$;
REVOKE ALL ON FUNCTION public.business_patch_pricing_switches(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_patch_pricing_switches(uuid,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.business_patch_brand_pricing_defaults(p_brand_id uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_brand public.brands%ROWTYPE;v_uid uuid:=auth.uid();v_tax boolean;v_mingla boolean;v_service boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required';END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb THEN RAISE EXCEPTION 'empty_pricing_patch';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) AS keys(key) WHERE key NOT IN('default_pass_tax','default_pass_mingla_fee','default_pass_service_fee')) THEN RAISE EXCEPTION 'invalid_pricing_patch';END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id=p_brand_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found';END IF;
  IF public.biz_brand_effective_rank(p_brand_id,v_uid)<public.biz_role_rank('finance_manager') THEN RAISE EXCEPTION 'insufficient_finance_permission';END IF;
  v_tax:=CASE WHEN p_patch?'default_pass_tax' THEN (p_patch->>'default_pass_tax')::boolean ELSE v_brand.default_pass_tax END;
  v_mingla:=CASE WHEN p_patch?'default_pass_mingla_fee' THEN (p_patch->>'default_pass_mingla_fee')::boolean ELSE v_brand.default_pass_mingla_fee END;
  v_service:=CASE WHEN p_patch?'default_pass_service_fee' THEN (p_patch->>'default_pass_service_fee')::boolean ELSE v_brand.default_pass_service_fee END;
  IF v_tax IS NULL OR v_mingla IS NULL OR v_service IS NULL THEN RAISE EXCEPTION 'brand_defaults_must_be_concrete';END IF;
  UPDATE public.brands SET default_pass_tax=v_tax,default_pass_mingla_fee=v_mingla,default_pass_service_fee=v_service,updated_at=now() WHERE id=p_brand_id;
  RETURN jsonb_build_object('brand_id',p_brand_id,'defaults',jsonb_build_object('pass_tax',v_tax,'pass_mingla_fee',v_mingla,'pass_service_fee',v_service));
END;$$;
REVOKE ALL ON FUNCTION public.business_patch_brand_pricing_defaults(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_patch_brand_pricing_defaults(uuid,jsonb) TO authenticated,service_role;

-- Compatibility wrappers retain their signatures but consume the rank-aware,
-- sparse canonical owner. They never manufacture omitted values because all
-- legacy parameters are concrete and explicitly present.
CREATE OR REPLACE FUNCTION public.business_set_pricing_switches(p_event_id uuid,p_pass_tax boolean,p_pass_mingla_fee boolean,p_pass_service_fee boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM public.business_patch_pricing_switches(p_event_id,jsonb_build_object('pass_tax',p_pass_tax,'pass_mingla_fee',p_pass_mingla_fee,'pass_service_fee',p_pass_service_fee));END;$$;
REVOKE ALL ON FUNCTION public.business_set_pricing_switches(uuid,boolean,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_set_pricing_switches(uuid,boolean,boolean,boolean) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.business_set_brand_pricing_defaults(p_brand_id uuid,p_default_pass_tax boolean,p_default_pass_mingla_fee boolean,p_default_pass_service_fee boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM public.business_patch_brand_pricing_defaults(p_brand_id,jsonb_build_object('default_pass_tax',p_default_pass_tax,'default_pass_mingla_fee',p_default_pass_mingla_fee,'default_pass_service_fee',p_default_pass_service_fee));END;$$;
REVOKE ALL ON FUNCTION public.business_set_brand_pricing_defaults(uuid,boolean,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_set_brand_pricing_defaults(uuid,boolean,boolean,boolean) TO authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;

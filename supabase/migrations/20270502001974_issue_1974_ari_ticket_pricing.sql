-- Issue #1974 — canonical ticket/pricing commands on top of #1972 receipt truth.
-- The migration is intentionally later than deployed #1972/#2353 so the
-- receipt/terminalization owner and final event-format writer already exist.

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

-- The Stripe registration probe is provider-authoritative but cannot run
-- inside PostgreSQL. It records only this short-lived server attestation using
-- the service role; authenticated clients have no table privileges or RLS
-- policy that could mint or refresh one themselves.
CREATE TABLE IF NOT EXISTS public.brand_tax_registration_attestations (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  stripe_account_id text,
  has_active_registration boolean NOT NULL,
  observed_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source='brand-tax-registrations-list'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_tax_registration_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_tax_registration_attestations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.brand_tax_registration_attestations TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1974_require_fresh_tax_registration(p_brand_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.brand_tax_registration_attestations attestation
    JOIN public.stripe_connect_accounts account
      ON account.brand_id=attestation.brand_id
     AND account.detached_at IS NULL
     AND account.stripe_account_id=attestation.stripe_account_id
    WHERE attestation.brand_id=p_brand_id
      AND attestation.has_active_registration
      AND attestation.source='brand-tax-registrations-list'
      AND attestation.observed_at>=clock_timestamp()-interval '5 minutes'
      AND attestation.observed_at<=clock_timestamp()+interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'tax_registration_required';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_1974_require_fresh_tax_registration(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1974_require_fresh_tax_registration(uuid)
  TO service_role;

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
  IF p_patch?'pass_tax' AND v_tax IS TRUE THEN
    PERFORM public.issue_1974_require_fresh_tax_registration(v_event.brand_id);
  END IF;
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
  IF p_patch?'default_pass_tax' AND v_tax IS TRUE THEN
    PERFORM public.issue_1974_require_fresh_tax_registration(p_brand_id);
  END IF;
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

-- Re-emit only #1972's transactional owner. Its #2353-corrected core leaf is
-- left untouched and receives a ticket-free patch; the ticket and pricing legs
-- delegate to #1974's canonical commands in the same transaction.
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
BEGIN
  IF v_core ? 'visibility'
     AND COALESCE(v_core->>'visibility','') NOT IN('public','unlisted','private') THEN
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;
  PERFORM public.business_update_live_event(
    p_event_id,v_core_without_tickets,p_reason,p_client_revision
  );
  IF v_core ? 'tickets' THEN
    PERFORM public.business_patch_event_ticket_tiers(
      p_event_id,v_core->'tickets',NULL,NULL,NULL,p_reason
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
      p_event_id,v_when,p_reason,p_client_revision
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

  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order,tt.created_at),'[]'::jsonb)
    INTO v_tickets FROM public.ticket_types tt
    WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  RETURN jsonb_build_object(
    'event',to_jsonb(v_event),'tickets',v_tickets,
    'client_revision',p_client_revision
  );
END;$fn$;
REVOKE ALL ON FUNCTION public.business_update_live_event_atomic(uuid,jsonb,text,integer)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_update_live_event_atomic(uuid,jsonb,text,integer)
  TO authenticated,service_role;

-- The #2353-corrected leaf remains an owner-internal core helper. Removing its
-- external service-role grant closes the only remaining route to its legacy
-- ticket loop; authenticated Business callers already use the atomic owner.
REVOKE EXECUTE ON FUNCTION public.business_update_live_event(uuid,jsonb,text,integer)
  FROM service_role;

-- #1974 consumes #1972's receipt owner instead of inventing a second
-- terminal-truth table. The immutable pending-action UUID, exact confirmed
-- arguments, domain mutation, and result receipt all live in this transaction.
CREATE OR REPLACE FUNCTION public.ari_execute_ticket_pricing_operation(
  p_operation_id uuid,
  p_tool_name text,
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_begin jsonb;
  v_event public.events%ROWTYPE;
  v_current jsonb;
  v_existing jsonb;
  v_patch jsonb := '{}'::jsonb;
  v_final jsonb;
  v_tier_id text;
  v_result jsonb;
  v_pricing_patch jsonb := '{}'::jsonb;
  v_revision integer;
BEGIN
  IF p_tool_name NOT IN (
    'upsert_ticket_tier',
    'set_pricing_switches',
    'set_brand_pricing_defaults'
  ) THEN
    RAISE EXCEPTION 'unsupported_ticket_pricing_operation';
  END IF;

  v_begin := public.agent_operation_receipt_begin(
    p_operation_id,
    p_tool_name,
    p_args
  );
  IF COALESCE((v_begin->>'replay')::boolean, false) THEN
    RETURN v_begin->'result';
  END IF;

  IF p_tool_name = 'upsert_ticket_tier' THEN
    SELECT * INTO v_event
    FROM public.events
    WHERE id = NULLIF(p_args->>'event_id', '')::uuid
    FOR UPDATE;
    IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'event_not_found';
    END IF;
    IF v_event.event_type NOT IN ('event', 'experience') THEN
      RAISE EXCEPTION 'event_ticket_type_unsupported';
    END IF;

    IF v_event.status = 'draft' THEN
      v_current := COALESCE(
        v_event.theme#>'{business_draft,tickets}',
        '[]'::jsonb
      );
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', tt.id::text,
        'name', tt.name,
        'isFree', tt.is_free,
        'isUnlimited', tt.is_unlimited,
        'priceGbp', CASE WHEN tt.is_free THEN NULL ELSE tt.price_cents::numeric / 100 END,
        'capacity', tt.quantity_total,
        'visibility', CASE WHEN tt.is_hidden THEN 'hidden' WHEN tt.is_disabled THEN 'disabled' ELSE 'public' END,
        'displayOrder', tt.display_order,
        'approvalRequired', tt.requires_approval,
        'passwordProtected', tt.password_protected,
        'passwordConfigured', tt.password_hash IS NOT NULL,
        'waitlistEnabled', tt.waitlist_enabled,
        'minPurchaseQty', tt.min_purchase_qty,
        'maxPurchaseQty', tt.max_purchase_qty,
        'allowTransfers', tt.allow_transfers,
        'description', tt.description,
        'saleStartAt', tt.sale_start_at,
        'saleEndAt', tt.sale_end_at,
        'availableAt', CASE WHEN tt.available_online AND tt.available_in_person THEN 'both' WHEN tt.available_in_person THEN 'door' ELSE 'online' END
      ) ORDER BY tt.display_order), '[]'::jsonb)
      INTO v_current
      FROM public.ticket_types tt
      WHERE tt.event_id = v_event.id AND tt.deleted_at IS NULL;
    END IF;

    v_tier_id := COALESCE(NULLIF(p_args->>'tier_id', ''), p_operation_id::text);
    SELECT tier INTO v_existing
    FROM jsonb_array_elements(v_current) tier
    WHERE tier->>'id' = v_tier_id
    LIMIT 1;
    IF p_args ? 'tier_id' AND v_existing IS NULL THEN
      RAISE EXCEPTION 'ticket_event_mismatch';
    END IF;

    IF p_args ? 'name' THEN v_patch := v_patch || jsonb_build_object('name', p_args->'name'); END IF;
    IF p_args ? 'is_free' THEN v_patch := v_patch || jsonb_build_object('isFree', p_args->'is_free'); END IF;
    IF p_args ? 'is_unlimited' THEN v_patch := v_patch || jsonb_build_object('isUnlimited', p_args->'is_unlimited'); END IF;
    IF p_args ? 'price_cents' THEN
      v_patch := v_patch || jsonb_build_object(
        'priceGbp', CASE WHEN (p_args->>'price_cents')::integer = 0 THEN NULL ELSE (p_args->>'price_cents')::numeric / 100 END
      );
    END IF;
    IF p_args ? 'capacity' THEN v_patch := v_patch || jsonb_build_object('capacity', p_args->'capacity'); END IF;
    IF p_args ? 'visibility' THEN v_patch := v_patch || jsonb_build_object('visibility', p_args->'visibility'); END IF;
    IF p_args ? 'display_order' THEN v_patch := v_patch || jsonb_build_object('displayOrder', p_args->'display_order'); END IF;
    IF p_args ? 'approval_required' THEN v_patch := v_patch || jsonb_build_object('approvalRequired', p_args->'approval_required'); END IF;
    IF p_args ? 'waitlist_enabled' THEN v_patch := v_patch || jsonb_build_object('waitlistEnabled', p_args->'waitlist_enabled'); END IF;
    IF p_args ? 'min_purchase_qty' THEN v_patch := v_patch || jsonb_build_object('minPurchaseQty', p_args->'min_purchase_qty'); END IF;
    IF p_args ? 'max_purchase_qty' THEN v_patch := v_patch || jsonb_build_object('maxPurchaseQty', p_args->'max_purchase_qty'); END IF;
    IF p_args ? 'allow_transfers' THEN v_patch := v_patch || jsonb_build_object('allowTransfers', p_args->'allow_transfers'); END IF;
    IF p_args ? 'description' THEN v_patch := v_patch || jsonb_build_object('description', p_args->'description'); END IF;
    IF p_args ? 'sale_start_at' THEN v_patch := v_patch || jsonb_build_object('saleStartAt', p_args->'sale_start_at'); END IF;
    IF p_args ? 'sale_end_at' THEN v_patch := v_patch || jsonb_build_object('saleEndAt', p_args->'sale_end_at'); END IF;
    IF p_args ? 'available_at' THEN v_patch := v_patch || jsonb_build_object('availableAt', p_args->'available_at'); END IF;

    IF v_existing IS NULL THEN
      v_existing := jsonb_build_object(
        'id', v_tier_id,
        'visibility', 'public',
        'displayOrder', jsonb_array_length(v_current),
        'approvalRequired', false,
        'passwordProtected', false,
        'passwordConfigured', false,
        'waitlistEnabled', false,
        'minPurchaseQty', 1,
        'maxPurchaseQty', NULL,
        'allowTransfers', true,
        'description', NULL,
        'saleStartAt', NULL,
        'saleEndAt', NULL,
        'availableAt', 'both'
      );
      v_current := v_current || jsonb_build_array(v_existing || v_patch);
    ELSE
      SELECT COALESCE(jsonb_agg(
        CASE WHEN tier->>'id' = v_tier_id THEN tier || v_patch ELSE tier END
        ORDER BY ordinality
      ), '[]'::jsonb)
      INTO v_current
      FROM jsonb_array_elements(v_current) WITH ORDINALITY AS rows(tier, ordinality);
    END IF;

    v_revision := COALESCE(
      (v_event.theme#>>'{business_draft,clientRevision}')::integer,
      0
    );
    v_result := public.business_patch_event_ticket_tiers(
      v_event.id,
      v_current,
      v_event.updated_at,
      CASE WHEN v_event.status = 'draft' THEN v_revision ELSE NULL END,
      p_operation_id,
      CASE WHEN v_event.status = 'draft' THEN NULL ELSE 'Updated through a confirmed Ari ticket request.' END
    );
    SELECT tier INTO v_existing
    FROM jsonb_array_elements(COALESCE(v_result->'tiers', '[]'::jsonb)) tier
    WHERE tier->>'id' = v_tier_id
    LIMIT 1;
    IF v_existing IS NULL THEN RAISE EXCEPTION 'ticket_readback_missing'; END IF;
    v_result := v_result || jsonb_build_object('tier', v_existing);
  ELSIF p_tool_name = 'set_pricing_switches' THEN
    IF p_args ? 'tax' THEN
      v_pricing_patch := v_pricing_patch || jsonb_build_object(
        'pass_tax', CASE WHEN p_args->>'tax' = 'inherit' THEN NULL ELSE p_args->>'tax' IN ('pass_to_buyer', 'included_in_price') END
      );
    END IF;
    IF p_args ? 'mingla_fee' THEN
      v_pricing_patch := v_pricing_patch || jsonb_build_object(
        'pass_mingla_fee', CASE WHEN p_args->>'mingla_fee' = 'inherit' THEN NULL ELSE p_args->>'mingla_fee' = 'pass_to_buyer' END
      );
    END IF;
    IF p_args ? 'service_fee' THEN
      v_pricing_patch := v_pricing_patch || jsonb_build_object(
        'pass_service_fee', CASE WHEN p_args->>'service_fee' = 'inherit' THEN NULL ELSE p_args->>'service_fee' = 'pass_to_buyer' END
      );
    END IF;
    v_result := public.business_patch_pricing_switches(
      NULLIF(p_args->>'event_id', '')::uuid,
      v_pricing_patch
    );
  ELSE
    IF p_args ? 'tax' THEN
      v_pricing_patch := v_pricing_patch || jsonb_build_object(
        'default_pass_tax', p_args->>'tax' IN ('pass_to_buyer', 'included_in_price')
      );
    END IF;
    IF p_args ? 'mingla_fee' THEN
      v_pricing_patch := v_pricing_patch || jsonb_build_object(
        'default_pass_mingla_fee', p_args->>'mingla_fee' = 'pass_to_buyer'
      );
    END IF;
    IF p_args ? 'service_fee' THEN
      v_pricing_patch := v_pricing_patch || jsonb_build_object(
        'default_pass_service_fee', p_args->>'service_fee' = 'pass_to_buyer'
      );
    END IF;
    v_result := public.business_patch_brand_pricing_defaults(
      NULLIF(p_args->>'brand_id', '')::uuid,
      v_pricing_patch
    );
  END IF;

  RETURN public.agent_operation_receipt_complete(
    p_operation_id,
    p_tool_name,
    p_args,
    v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ari_execute_ticket_pricing_operation(uuid,text,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_execute_ticket_pricing_operation(uuid,text,jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ari_execute_ticket_pricing_operation(uuid,text,jsonb)
  IS '#1974 receipt-backed ticket/pricing dispatcher; reuses #1972 terminal truth.';

NOTIFY pgrst,'reload schema';
COMMIT;

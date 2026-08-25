BEGIN;
-- ===========================================================================
-- issue #2590 — AN ORGANISER COULD NOT CORRECT A SALE WINDOW AFTER ONE SALE.
--
-- Re-emitted from the INSTALLED definition of
-- `business_patch_event_ticket_tiers` (pulled with `pg_get_functiondef`, not
-- retyped from the migration file), with the sold-ticket guard narrowed and
-- NOTHING else changed. Diffing code lines against the installed text shows
-- exactly five removed clauses and no other difference — the #2462 lesson,
-- where a re-emit silently dropped the previous migration's lock pre-pass.
--
-- WHAT WAS WRONG. The guard froze eight fields the instant a single ticket
-- sold. Three of them protect a buyer. Five did not, and freezing them turned
-- an ordinary correction into a permanent mistake — with no message, because
-- `sold_ticket_mutation_blocked` has no organiser-facing copy anywhere in the
-- app. The organiser edits, saves, and the screen redraws the old value.
--
-- Reported on a live event: We Go Again Exhibition (29-30 Aug, Lagos) had its
-- sales closing 07:00 on the morning of Day 2, six hours BEFORE doors, almost
-- certainly 19:00 misread on a 12-hour picker. 124 and 117 tickets had sold,
-- so it could not be corrected from the product at all.
--
-- The client half of this issue adds the lock/greyed states, the live boundary
-- messages and the disabled Save. This file is the half that decides what is
-- genuinely refusable.
-- ===========================================================================

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
$function$;


-- ---------------------------------------------------------------------------
-- POST-MIGRATION PROBE — RAISES rather than warns, so a degraded apply cannot
-- report success (the #2113 lesson). Pinned to the EXACT signature and
-- asserting exactly one overload, because an unfiltered `proname` lookup reads
-- whichever row the scan hands it first (#2573).
-- ---------------------------------------------------------------------------
DO $probe$
DECLARE v_def text; v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='business_patch_event_ticket_tiers';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'issue #2590 probe: expected exactly one overload, found %', v_count;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='business_patch_event_ticket_tiers';

  -- The three clauses that must SURVIVE. Losing any one of them would let a
  -- sold-out tier's price or paid/free status be rewritten under existing
  -- holders, which is the whole reason this guard exists.
  IF position('sold_ticket_mutation_blocked' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2590 probe: the sold-ticket guard is gone entirely';
  END IF;
  IF position('v_existing.price_cents IS DISTINCT FROM' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2590 probe: price is no longer protected after a sale';
  END IF;
  IF position('v_existing.is_free IS DISTINCT FROM' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2590 probe: free/paid is no longer protected after a sale';
  END IF;
  IF position('<v_sold' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2590 probe: capacity can now be set below tickets already issued';
  END IF;
  IF position('tier_delete_with_sales' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2590 probe: a tier with sales can now be deleted';
  END IF;

  -- The five that must be GONE from the guard. Each is asserted by its exact
  -- guard-clause text, not by the column name — the columns still appear in the
  -- UPDATE and INSERT, which is the point.
  IF position('v_existing.sale_end_at IS DISTINCT FROM' IN v_def) > 0 THEN
    RAISE EXCEPTION 'issue #2590 probe: the sale window is still frozen after a sale';
  END IF;
  IF position('v_existing.sale_start_at IS DISTINCT FROM' IN v_def) > 0 THEN
    RAISE EXCEPTION 'issue #2590 probe: the sale start is still frozen after a sale';
  END IF;
  IF position('v_existing.is_hidden IS DISTINCT FROM' IN v_def) > 0 THEN
    RAISE EXCEPTION 'issue #2590 probe: hiding a tier is still frozen after a sale';
  END IF;
  IF position('v_existing.is_disabled IS DISTINCT FROM' IN v_def) > 0 THEN
    RAISE EXCEPTION 'issue #2590 probe: pausing a tier is still frozen after a sale';
  END IF;
  IF position('v_existing.available_online IS DISTINCT FROM' IN v_def) > 0 THEN
    RAISE EXCEPTION 'issue #2590 probe: online/door is still frozen after a sale';
  END IF;

  -- And the write path must still carry the window, or unlocking it achieves
  -- nothing: the guard would pass and the value would never be stored.
  IF position('sale_start_at=NULLIF' IN v_def) = 0
     OR position('sale_end_at=NULLIF' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2590 probe: the UPDATE no longer writes the sale window';
  END IF;
END
$probe$;

COMMIT;

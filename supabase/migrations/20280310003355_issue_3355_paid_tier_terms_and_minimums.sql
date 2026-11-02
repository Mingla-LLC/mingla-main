-- Issue #3355 P6 — money flow: Seth's decisions 5 and 6, enforced on the server.
--
-- Decision 5: a teammate who never accepted the Organiser Terms 1.0 must accept
--   them before turning a live free offering paid. Today the publish RPCs check
--   Terms, but a live tier write (business_patch_event_ticket_tiers, the live
--   trip/experience editors, direct Host tier writes) can turn a free event
--   paid with no Terms check. This closes that gap by reusing
--   biz_require_current_organiser_terms (its body is NOT changed here).
--
-- Decision 6: a paid ticket price must be at least the payment provider's
--   minimum charge for its currency (Stripe, https://docs.stripe.com/currencies
--   #minimum-and-maximum-charge-amounts), checked when a price is SET: a new
--   paid tier or a changed price. Existing rows are never re-validated, so no
--   backfill and no table constraint; an untouched older price stays valid.
--   Currencies without a verified minimum (BGN, ISK) are not checked. NGN
--   (Paystack) is ₦100.00 = 10000 kobo: Seth's decision, 2026-11-01, not
--   Paystack's documentation.
--
-- Both rules live in one BEFORE trigger on public.ticket_types, the single
-- table every ticket, trip-package and experience price is written to. The
-- publish functions (business_publish_*_draft / biz_publish_*), the money
-- predicates (pg_brand_can_collect / pg_brand_can_payout) and
-- biz_require_current_organiser_terms are untouched. A paid publish already
-- requires the publisher's Terms, so the Terms leg only adds a check on live
-- free→paid changes.
--
-- The minimum table is mirrored in edge code
-- (supabase/functions/_shared/money/providerMinimums.ts) and the Host app
-- (mingla-business/src/constants/providerMinimumCharges.ts); the Deno parity
-- test supabase/functions/_shared/__tests__/
-- issue_3355_money_flow.implementor.test.ts fails when they drift.
-- Behaviour is pinned by
-- supabase/migrations/__tests__/issue_3355_paid_tier_terms_and_minimums.implementor.pg17.test.sql.

-- ── Provider minimum charge, minor units (same unit as price_cents) ────────
CREATE OR REPLACE FUNCTION public.issue_3355_provider_minimum_charge_minor(
  p_currency text
) RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT CASE upper(btrim(COALESCE(p_currency, '')))
    WHEN 'CAD' THEN 50
    WHEN 'CHF' THEN 50
    WHEN 'CZK' THEN 1500
    WHEN 'DKK' THEN 250
    WHEN 'EUR' THEN 50
    WHEN 'GBP' THEN 30
    WHEN 'HUF' THEN 17500
    WHEN 'NGN' THEN 10000
    WHEN 'NOK' THEN 300
    WHEN 'PLN' THEN 200
    WHEN 'RON' THEN 200
    WHEN 'SEK' THEN 300
    WHEN 'USD' THEN 50
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.issue_3355_provider_minimum_charge_minor(text) IS
  'Issue #3355 P6 (Seth decision 6): the payment provider minimum charge for a currency in minor units, NULL when no verified minimum. Mirrors _shared/money/providerMinimums.ts and the Host constants.';

REVOKE ALL ON FUNCTION public.issue_3355_provider_minimum_charge_minor(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_3355_provider_minimum_charge_minor(text)
  TO anon, authenticated, service_role;

-- ── The ticket price rules (decisions 5 and 6) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3355_ticket_type_paid_price_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_now_paid boolean;
  v_was_paid boolean;
  v_price_set boolean;
  v_minimum integer;
  v_brand_id uuid;
  v_status text;
  v_uid uuid;
BEGIN
  v_now_paid := NEW.deleted_at IS NULL
    AND NOT COALESCE(NEW.is_free, false)
    AND COALESCE(NEW.price_cents, 0) > 0;
  IF NOT v_now_paid THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_was_paid := false;
    v_price_set := true;
  ELSE
    v_was_paid := OLD.deleted_at IS NULL
      AND NOT COALESCE(OLD.is_free, false)
      AND COALESCE(OLD.price_cents, 0) > 0;
    v_price_set := NEW.price_cents IS DISTINCT FROM OLD.price_cents
      OR NEW.is_free IS DISTINCT FROM OLD.is_free;
  END IF;

  -- Decision 6: only a price being set now is checked.
  IF v_price_set THEN
    v_minimum := public.issue_3355_provider_minimum_charge_minor(NEW.currency);
    IF v_minimum IS NOT NULL AND NEW.price_cents < v_minimum THEN
      RAISE EXCEPTION 'ticket_price_below_minimum'
        USING ERRCODE = '22023',
              DETAIL = format('currency=%s minimum_minor=%s',
                upper(btrim(NEW.currency)), v_minimum),
              HINT = 'A paid ticket must be at least the payment provider''s minimum charge for its currency.';
    END IF;
  END IF;

  -- Decision 5: a live offering with no paid tier becoming paid needs the
  -- acting member's Organiser Terms. Drafts are checked at publish; system
  -- writes (no signed-in member of the brand) are unchanged.
  IF NOT v_was_paid THEN
    v_uid := auth.uid();
    IF v_uid IS NOT NULL THEN
      SELECT e.brand_id, e.status INTO v_brand_id, v_status
      FROM public.events e
      WHERE e.id = NEW.event_id;
      IF v_status IS DISTINCT FROM 'draft'
         AND EXISTS (
           SELECT 1 FROM public.brand_team_members m
           WHERE m.brand_id = v_brand_id
             AND m.user_id = v_uid
             AND m.removed_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.ticket_types o
           WHERE o.event_id = NEW.event_id
             AND o.id IS DISTINCT FROM NEW.id
             AND o.deleted_at IS NULL
             AND NOT COALESCE(o.is_free, false)
             AND COALESCE(o.price_cents, 0) > 0
         )
      THEN
        PERFORM public.biz_require_current_organiser_terms(v_brand_id);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.issue_3355_ticket_type_paid_price_rules() IS
  'Issue #3355 P6: on a new or changed paid ticket price, refuse a price below the provider minimum (ticket_price_below_minimum) and, when a live offering with no paid tier turns paid, require the acting member''s Organiser Terms (mingla_tos_not_accepted via biz_require_current_organiser_terms).';

REVOKE ALL ON FUNCTION public.issue_3355_ticket_type_paid_price_rules()
  FROM PUBLIC, anon, authenticated;

-- Named to fire after trg_enforce_event_ticket_currency (BEFORE triggers run in
-- name order), so the currency it resolves is the one checked.
DROP TRIGGER IF EXISTS trg_zz_issue_3355_ticket_type_paid_price_rules
  ON public.ticket_types;
CREATE TRIGGER trg_zz_issue_3355_ticket_type_paid_price_rules
  BEFORE INSERT OR UPDATE OF price_cents, is_free
  ON public.ticket_types
  FOR EACH ROW
  EXECUTE FUNCTION public.issue_3355_ticket_type_paid_price_rules();

-- ── Decision 3: Ari may save paid tickets on a draft before payments ───────
-- Seth's decision 3 (2026-11-01): a draft may hold paid tickets before the
-- brand can take payments; only publishing is blocked. The Host form already
-- works this way: business_update_event_draft stores the draft's tickets in
-- theme.business_draft.tickets and bumps clientRevision, with no payments
-- check. Ari's confirmed ticket writes went through
-- business_patch_event_ticket_tiers, whose draft branch refused a new paid
-- tier with payout_not_ready, so Ari refused earlier than the Host form.
--
-- Ari's draft ticket writes now use this writer instead: the same storage the
-- Host draft save uses (business_draft.tickets JSON + clientRevision bump),
-- with every other check of the old draft branch kept (role, revision,
-- canonical tier shape, currency for a paid tier, no live projection, no id
-- reuse). business_update_event_draft itself replaces the whole draft row, so
-- it cannot take a tickets-only change from inside this transaction.
-- business_patch_event_ticket_tiers is NOT changed: live and scheduled
-- offerings keep every check (payout_not_ready, decision 5 Terms and the
-- decision 6 minimum trigger above), and publishing keeps every gate.
CREATE OR REPLACE FUNCTION public.issue_3355_ari_save_draft_ticket_tiers(
  p_event_id uuid,
  p_tiers jsonb,
  p_expected_client_revision integer,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_tiers jsonb;
  v_currency char(3);
  v_current_revision integer;
  v_next_revision integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_event_id IS NULL OR p_tiers IS NULL THEN RAISE EXCEPTION 'invalid_ticket_tiers'; END IF;

  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_event.event_type NOT IN ('event','experience') THEN RAISE EXCEPTION 'event_ticket_type_unsupported'; END IF;
  IF v_event.status <> 'draft' THEN RAISE EXCEPTION 'event_draft_not_editable'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
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

  v_current_revision := COALESCE(NULLIF(v_event.theme->'business_draft'->>'clientRevision','')::integer,0);
  IF p_expected_client_revision IS NULL OR p_expected_client_revision <> v_current_revision THEN
    RAISE EXCEPTION 'stale_client_revision';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'draft_ticket_projection_conflict';
  END IF;
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

  -- No payments check here (decision 3). Publishing stays the gate.
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
   WHERE id=p_event_id
   RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'event_id',p_event_id,'operation_id',p_operation_id,'representation','draft',
    'effective_currency',v_event.currency,
    'tiers',v_event.theme->'business_draft'->'tickets',
    'client_revision',v_next_revision,
    'updated_at',v_event.updated_at
  );
END;
$function$;

COMMENT ON FUNCTION public.issue_3355_ari_save_draft_ticket_tiers(uuid,jsonb,integer,uuid) IS
  'Issue #3355 P6 (Seth decision 3): Ari''s confirmed draft ticket write. Same storage as the Host draft save (business_draft.tickets + clientRevision), no payments check; publishing stays the gate. Internal: called only by ari_execute_ticket_pricing_operation.';

REVOKE ALL ON FUNCTION public.issue_3355_ari_save_draft_ticket_tiers(uuid,jsonb,integer,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3355_ari_save_draft_ticket_tiers(uuid,jsonb,integer,uuid)
  TO service_role;

-- Exact latest body from 20270508001974 (its only definition); the one change
-- is the draft branch, which now calls issue_3355_ari_save_draft_ticket_tiers.
-- Live and scheduled offerings still call business_patch_event_ticket_tiers.
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
    IF v_event.status = 'draft' THEN
      -- #3355 P6 (Seth decision 3): the Host draft storage, no payments check.
      v_result := public.issue_3355_ari_save_draft_ticket_tiers(
        v_event.id,
        v_current,
        v_revision,
        p_operation_id
      );
    ELSE
      v_result := public.business_patch_event_ticket_tiers(
        v_event.id,
        v_current,
        v_event.updated_at,
        NULL,
        p_operation_id,
        'Updated through a confirmed Ari ticket request.'
      );
    END IF;
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
  IS '#1974 receipt-backed ticket/pricing dispatcher; reuses #1972 terminal truth. #3355 P6: draft ticket writes use issue_3355_ari_save_draft_ticket_tiers (no payments check, decision 3); live writes keep business_patch_event_ticket_tiers.';

NOTIFY pgrst,'reload schema';

-- ── The currency-change decision follows its server owner ──────────────────
-- issue_1384_resolve_reconciliation / issue_1387_resolve_currency_reconciliation
-- (and ari_execute_brand_operation in front of them) admit any member whose
-- effective rank is at least finance_manager, an event manager included. The
-- readiness row held "who can fix" to the stricter money predicate, so an
-- event manager was told someone else had to decide. It now uses the
-- resolver's own rule (min_role finance_manager, no money predicate). Refunds,
-- payouts, balances and tax registration keep biz_can_manage_payments_for_brand.
UPDATE public.brand_readiness_catalog
   SET server_predicate = NULL
 WHERE key = 'money.currency_reconciliation'
   AND min_role = 'finance_manager';

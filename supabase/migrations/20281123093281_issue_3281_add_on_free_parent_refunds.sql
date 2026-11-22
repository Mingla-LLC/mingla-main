-- issue #3281 S4 — add-ons on every offering: free tickets carrying paid
-- add-ons, add-on-only refunds, and the free-ticket refund rule.
--
-- Everything new is gated by add_on_rollout.free_parent_enabled (false), the
-- one owner of these rules (merging auto-deploys edge functions, so no edge
-- flag exists). With the switch off, quotes, sessions, refunds and settled
-- statuses are what they were before this file:
--   * quote / create-session still raise extras_need_paid_ticket;
--   * an add-on-only refund (add-on lines in p_lines) raises add_on_refunds_off;
--   * "every ticket returned" still ignores free tickets;
--   * settled / proposed statuses ignore add-on lines.
--
-- With the switch on:
--   * a free ticket can carry paid add-ons; the cart is paid when tickets plus
--     add-ons are above zero, and a cart with no ticket currency takes the
--     event's currency (event_currency_required when it has none). The edge's
--     all-in engine already prices the session total, so the application fee
--     is taken on the add-ons and a free ticket contributes 0.
--   * a host (biz_refund_order / refund_preview) or an admin
--     (admin_refund_order) can refund add-on lines on their own through
--     p_lines elements {order_add_on_line_item_id, quantity}, at the line's
--     unit price, never above what is left (add_on_line_overrefund, P0005).
--   * an order with no paid ticket line returns its add-ons only when every
--     ticket line (free ones included) is returned (decision V-6 fix).
--   * refunded only when every ticket line and every add-on line is back.
--
-- Add-on refunds now count quantity per line (several refunds may share a
-- line); with only whole-line rows, as before, every result is unchanged.
--
-- Re-emitted from their current bodies (md5 drift-guarded):
--   issue_3872_ticket_quote, issue_1930_ticket_checkout_create_session_base
--     (20281123034522); refund_preview, biz_refund_order, admin_refund_order,
--     issue_3281_refund_returns_all_tickets, issue_3281_extras_refund_cents,
--     issue_3281_extras_refund_cents_settled, issue_3281_record_extras_refund,
--     issue_3281_settled_payment_status (20280301003281).
-- refund_preview, biz_refund_order and admin_refund_order keep their
-- signatures, grants and comments: add-on lines ride p_lines as elements
-- keyed order_add_on_line_item_id (edge field addOnLines), the same way the
-- add-on plan choice rides cart lines (#4522 review decision).
-- New: issue_3281_add_on_refund_lines, issue_3281_add_on_refund_cents,
--   issue_3281_record_add_on_refund, issue_3281_add_ons_all_returned,
--   issue_3281_split_refund_lines,
--   admin_order_add_on_lines (admin order view, is_admin_user() only).
-- Static SQL only. Conflicts would raise PT409, never 40001 (none raised here).

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.issue_3872_ticket_quote(uuid,jsonb,uuid[],timestamptz,timestamptz,integer,text,text,text,text,uuid,text,boolean)','f311f66c466a39268749678a8fbcfb0f'),
    ('public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)','64b8c647021a0a9e328c6ef2a60ecc27'),
    ('public.refund_preview(uuid,jsonb)','d13f8639613e626fa5e91fc390787d36'),
    ('public.biz_refund_order(uuid,jsonb,text,text)','b1a78555db6dbf4e443dbcd5716ad3bc'),
    ('public.admin_refund_order(uuid,jsonb,text,text)','16e2fa4f857a9b35f07d96521867ca9c'),
    ('public.issue_3281_refund_returns_all_tickets(uuid,jsonb,uuid)','d406e50029cde7787a21a18fc8deb216'),
    ('public.issue_3281_extras_refund_cents(uuid,jsonb,uuid)','deb5007c723e11a81f7deb1657d34ec4'),
    ('public.issue_3281_extras_refund_cents_settled(uuid,jsonb)','beddae88c00f9c6e5283d6ff534d0af9'),
    ('public.issue_3281_record_extras_refund(uuid,uuid,jsonb,integer)','fde8678cab76a711a8b9752c63746dc7'),
    ('public.issue_3281_settled_payment_status(uuid)','c701128a7d0c2d799e49ad9886f7120a')
  ) v(sig,expected_md5) LOOP
    SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
    IF v_actual IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #3281 S4 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
    END IF;
  END LOOP;
END;
$drift$;

-- ---------------------------------------------------------------------------
-- 1. Checkout: a free ticket may carry paid add-ons (switch on).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_ticket_quote(p_event_id uuid, p_lines jsonb, p_event_date_ids uuid[], p_booked_start_at timestamp with time zone, p_booked_end_at timestamp with time zone, p_booked_party_size integer, p_payment_plan_choice text, p_discount_code text, p_buyer_email text, p_buyer_phone_e164 text, p_buyer_user_id uuid, p_link_token_hash text, p_queued boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
  v_extras jsonb;
  v_preview jsonb;
  v_addon_mode text;
BEGIN
  IF COALESCE(p_payment_plan_choice,'') NOT IN ('auto','full','installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;
  -- issue #4522 — how add-ons on a v2 plan are paid (today | spread), carried
  -- on the cart lines so every caller and wrapper keeps its signature.
  v_addon_mode:=public.issue_4522_lines_addon_payment_mode(p_lines);
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
  -- issue #3281 — extras, priced after discounts and never on a plan.
  v_extras:=public.issue_3281_price_extras(p_event_id,p_lines,
    ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(v_ctx->'dayIds')='array' THEN v_ctx->'dayIds' ELSE '[]'::jsonb END)),false);
  IF jsonb_array_length(v_extras->'items')>0 THEN
    IF (v_extras->>'totalCents')::integer>0 AND (v_quote->>'netSubtotalMinor')::bigint=0
       AND NOT public.issue_3281_add_on_switch('free_parent_enabled') THEN
      RAISE EXCEPTION 'extras_need_paid_ticket';
    END IF;
    -- issue #3281 S4 — free tickets carrying paid add-ons take the event's currency.
    IF (v_extras->>'totalCents')::bigint>0 AND v_currency IS NULL AND public.issue_3281_add_on_switch('free_parent_enabled') THEN
      SELECT e.currency INTO v_currency FROM public.events e WHERE e.id=p_event_id;
      IF v_currency IS NULL THEN RAISE EXCEPTION 'event_currency_required'; END IF;
    END IF;
    IF v_plan->'installmentSchedule' IS NOT NULL AND v_plan->'installmentSchedule'<>'null'::jsonb THEN
      -- issue #4522 — add-ons ride only a v2 plan, and only with #3281's plan switch on.
      IF COALESCE((v_plan->>'planVersion')::integer,1)<>2
         OR NOT public.issue_3281_add_on_switch('plan_enabled') THEN
        RAISE EXCEPTION 'extras_not_on_installments';
      END IF;
      v_plan:=public.issue_4522_plan_cart_v2(p_event_id,v_items,p_payment_plan_choice,now(),
        v_extras,COALESCE(v_addon_mode,'today'));
    END IF;
  END IF;
  -- issue #4522 — what a v2 plan would look like on this booking day, so a
  -- client asking for `full` still learns the plan's availability first.
  IF NOT (v_plan ? 'planVersion') AND public.issue_4522_cart_has_v2(p_event_id,v_items) THEN
    v_preview:=public.issue_4522_plan_cart_v2(p_event_id,v_items,'auto',now(),v_extras,
      COALESCE(v_addon_mode,'today'));
  ELSIF v_plan ? 'planVersion' THEN
    v_preview:=v_plan;
  END IF;
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
    'listSubtotalCents',(v_quote->>'listSubtotalMinor')::bigint+(v_extras->>'totalCents')::bigint,
    'discountCents',(v_quote->>'discountMinor')::bigint,
    'netSubtotalCents',(v_quote->>'netSubtotalMinor')::bigint+(v_extras->>'totalCents')::bigint,
    'dueTodayNetCents',(v_plan->>'dueTodayNetCents')::bigint+(v_extras->>'totalCents')::bigint
      -COALESCE((v_plan->>'addonScheduledCents')::bigint,0),
    'dueTodayListCents',(v_plan->>'dueTodayListCents')::bigint+(v_extras->>'totalCents')::bigint
      -COALESCE((v_plan->>'addonScheduledCents')::bigint,0),
    'extras',v_extras->'items','extrasTotalCents',(v_extras->>'totalCents')::bigint,
    'installmentSchedule',v_plan->'installmentSchedule',
    'discounts',v_quote->'applied','codeOutcome',v_quote->'codeOutcome',
    'notices',v_quote->'notices','quoteDigest',public.issue_3281_quote_digest(v_quote->>'digest',v_extras),
    'quoteListDigest',v_quote->>'listDigest')
    -- issue #4522 — present only when the cart has a v2 plan line.
    || CASE WHEN v_preview IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'paymentPlanV2',jsonb_build_object(
        'availability',v_preview->'availability','countOffered',v_preview->'countOffered',
        'countGiven',v_preview->'countGiven','finalDueAt',v_preview->'finalDueAt',
        'installmentSchedule',v_preview->'installmentSchedule'),
      'addonPaymentMode',v_plan->'addonPaymentMode') END;
END;
$function$
;

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
  v_extras jsonb;
  v_extras_total integer := 0;
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
  v_addon_mode text;
BEGIN
  IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;
  -- issue #4522 — how add-ons on a v2 plan are paid (today | spread), carried
  -- on the cart lines so every caller and wrapper keeps its signature.
  v_addon_mode := public.issue_4522_lines_addon_payment_mode(p_lines);

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
        'installmentSchedule', v_existing.installment_schedule,
        'extras', public.issue_3281_session_extras(v_existing.id)->'items',
        'extrasTotalCents', (public.issue_3281_session_extras(v_existing.id)->>'totalCents')::integer
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
  -- issue #3281 — extras: locked and priced after discounts, inside this hold.
  v_extras := public.issue_3281_price_extras(p_event_id, p_lines, v_day_ids, true);
  v_extras_total := (v_extras->>'totalCents')::integer;
  IF p_expected_quote_digest IS NOT NULL
     AND p_expected_quote_digest IS DISTINCT FROM
       public.issue_3281_quote_digest(v_quote->>'digest', v_extras) THEN
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
  IF jsonb_array_length(v_extras->'items') > 0 THEN
    IF v_extras_total > 0 AND v_full_price_cents = 0 AND NOT public.issue_3281_add_on_switch('free_parent_enabled') THEN
      RAISE EXCEPTION 'extras_need_paid_ticket';
    END IF;
    -- issue #3281 S4 — free tickets carrying paid add-ons take the event's currency
    -- (event_currency_required below still refuses when the event has none).
    IF v_extras_total > 0 AND v_currency IS NULL AND public.issue_3281_add_on_switch('free_parent_enabled') THEN
      SELECT e.currency INTO v_currency FROM public.events e WHERE e.id = p_event_id;
    END IF;
    IF v_any_installments THEN
      -- issue #4522 — add-ons ride only a v2 plan, and only with #3281's plan switch on.
      IF COALESCE((v_plan->>'planVersion')::integer, 1) <> 2
         OR NOT public.issue_3281_add_on_switch('plan_enabled') THEN
        RAISE EXCEPTION 'extras_not_on_installments';
      END IF;
      v_plan := public.issue_4522_plan_cart_v2(p_event_id, v_items, p_payment_plan_choice, now(),
        v_extras, COALESCE(v_addon_mode, 'today'));
      v_total := (v_plan->>'dueTodayNetCents')::integer;
      v_list_due_today := (v_plan->>'dueTodayListCents')::bigint;
      v_unioned := v_plan->'installmentSchedule';
    END IF;
    -- issue #4522 — spread add-ons already sit on the plan rows.
    v_total := v_total + v_extras_total - COALESCE((v_plan->>'addonScheduledCents')::integer, 0);
    v_list_due_today := v_list_due_today + v_extras_total
      - COALESCE((v_plan->>'addonScheduledCents')::bigint, 0);
    v_list_total := v_list_total + v_extras_total;
    v_full_price_cents := v_full_price_cents + v_extras_total;
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
    booked_party_size,
    -- issue #4522 — v2 plan terms and the add-on choice, frozen with the session.
    payment_plan_terms,
    addon_payment_mode
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
    p_booked_party_size,
    CASE WHEN v_any_installments THEN v_plan->'paymentPlanTerms' END,
    CASE WHEN v_any_installments THEN v_plan->>'addonPaymentMode' END
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

  -- issue #3281 — the extras hold their places with the session.
  INSERT INTO public.ticket_checkout_session_add_on_items (
    checkout_session_id, ticket_add_on_id, ticket_type_id, add_on_name_at_purchase,
    ticket_type_name_at_purchase, day_scope, quantity, unit_price_cents, total_cents,
    plan_choice
  )
  SELECT v_session_id, (x->>'addOnId')::uuid, (x->>'ticketTypeId')::uuid, x->>'addOnName',
         x->>'ticketName',
         CASE WHEN jsonb_typeof(x->'dayScope') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(x->'dayScope')) END,
         (x->>'quantity')::integer, (x->>'unitPriceCents')::integer, (x->>'totalCents')::integer,
         -- issue #4522 / #3281 §9 — the add-on choice when it rides a v2 plan.
         CASE WHEN v_any_installments THEN v_plan->>'addonPaymentMode' END
    FROM jsonb_array_elements(v_extras->'items') AS x;

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
    'quoteDigest', public.issue_3281_quote_digest(v_quote->>'digest', v_extras),
    'quoteListDigest', v_quote->>'listDigest',
    'discounts', v_quote->'applied',
    'codeOutcome', v_quote->'codeOutcome',
    'notices', v_quote->'notices',
    'extras', v_extras->'items',
    'extrasTotalCents', v_extras_total
  )
  -- issue #4522 — present only when the cart took the v2 planner.
  || CASE WHEN v_plan ? 'planVersion'
       THEN jsonb_build_object('addonPaymentMode', v_plan->'addonPaymentMode')
       ELSE '{}'::jsonb END;
END;
$function$
;

-- ---------------------------------------------------------------------------
-- 2. Refund helpers.
-- ---------------------------------------------------------------------------
-- Every ticket returned: the paid lines when the order has one; otherwise
-- (switch on) every line, free ones included, so returning one of two free
-- tickets no longer returns the add-ons.
CREATE OR REPLACE FUNCTION public.issue_3281_refund_returns_all_tickets(
  p_order_id uuid, p_lines jsonb, p_this_refund uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
     WHERE oli.order_id = p_order_id
       -- A free ticket has no refund to wait for, so it can't hold the extras,
       -- unless no ticket on the order is paid (#3281 S4, switch on).
       AND (oli.unit_price_cents > 0
            OR (public.issue_3281_add_on_switch('free_parent_enabled')
                AND NOT EXISTS (
                  SELECT 1 FROM public.order_line_items paid
                   WHERE paid.order_id = p_order_id AND paid.unit_price_cents > 0)))
       AND oli.quantity > (
         SELECT COALESCE(SUM(rli.quantity), 0)
           FROM public.refund_line_items rli
           JOIN public.refunds r ON r.id = rli.refund_id
          WHERE rli.order_line_item_id = oli.id
            AND r.status IN ('pending', 'succeeded')
            AND r.id IS DISTINCT FROM p_this_refund
       ) + COALESCE((
         SELECT SUM((l->>'quantity')::integer)
           FROM jsonb_array_elements(p_lines) l
          WHERE l->>'order_line_item_id' = oli.id::text
       ), 0)
  );
$fn$;

-- What is still owed back on each add-on line: quantity and cents not yet
-- held by a live refund (p_this_refund excluded).
CREATE OR REPLACE FUNCTION public.issue_3281_extras_refund_cents(
  p_order_id uuid, p_lines jsonb, p_this_refund uuid
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_cents bigint;
BEGIN
  IF NOT public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, p_this_refund) THEN
    RETURN 0;
  END IF;
  -- An add-on is returned once per unit, even when a discount capped what it got back.
  SELECT COALESCE(SUM(item.total_cents::bigint - done.cents), 0)
    INTO v_cents
    FROM public.order_add_on_line_items item
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(ra.quantity), 0) AS qty,
             COALESCE(SUM(ra.amount_cents::bigint), 0) AS cents
        FROM public.refund_add_on_line_items ra
        JOIN public.refunds r ON r.id = ra.refund_id
       WHERE ra.order_add_on_line_item_id = item.id
         AND r.status IN ('pending', 'succeeded')
         AND r.id IS DISTINCT FROM p_this_refund
    ) done
   WHERE item.order_id = p_order_id
     AND done.qty < item.quantity;
  RETURN GREATEST(v_cents, 0)::integer;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3281_extras_refund_cents_settled(
  p_order_id uuid, p_lines jsonb
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_cents integer := public.issue_3281_extras_refund_cents(p_order_id, p_lines, NULL);
BEGIN
  -- A free extra waits too: it is still recorded as returned.
  IF public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, NULL)
     AND EXISTS (
       SELECT 1 FROM public.order_add_on_line_items item
        WHERE item.order_id = p_order_id
          AND item.quantity > (
            SELECT COALESCE(SUM(ra.quantity), 0) FROM public.refund_add_on_line_items ra
              JOIN public.refunds r ON r.id = ra.refund_id
             WHERE ra.order_add_on_line_item_id = item.id
               AND r.status IN ('pending', 'succeeded')
          )
     )
     AND EXISTS (
       SELECT 1 FROM public.refunds r
        WHERE r.order_id = p_order_id AND r.status = 'pending'
     ) THEN
    RAISE EXCEPTION 'refund_pending_on_order' USING ERRCODE = 'P0013';
  END IF;
  RETURN v_cents;
END;
$fn$;

-- p_cap limits what the extras take in total when the refund can't cover them.
CREATE OR REPLACE FUNCTION public.issue_3281_record_extras_refund(
  p_refund_id uuid, p_order_id uuid, p_lines jsonb, p_cap integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, p_refund_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.refund_add_on_line_items (
    refund_id, order_add_on_line_item_id, quantity, amount_cents
  )
  SELECT p_refund_id, due.id, due.open_qty,
         CASE WHEN p_cap IS NULL THEN due.open_cents
              ELSE LEAST(due.open_cents, GREATEST(p_cap::bigint - due.before, 0)) END::integer
    FROM (
      SELECT item.id, item.quantity - done.qty AS open_qty,
             GREATEST(item.total_cents::bigint - done.cents, 0) AS open_cents,
             COALESCE(SUM(GREATEST(item.total_cents::bigint - done.cents, 0)) OVER (
               ORDER BY item.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0) AS before
        FROM public.order_add_on_line_items item
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(ra.quantity), 0)::integer AS qty,
                 COALESCE(SUM(ra.amount_cents::bigint), 0) AS cents
            FROM public.refund_add_on_line_items ra
            JOIN public.refunds r ON r.id = ra.refund_id
           WHERE ra.order_add_on_line_item_id = item.id
             AND r.status IN ('pending', 'succeeded')
        ) done
       WHERE item.order_id = p_order_id
         AND done.qty < item.quantity
    ) due;
END;
$fn$;

-- True when every add-on line is back in full (by quantity). Always true while
-- the switch is off, so statuses stay what they were.
CREATE FUNCTION public.issue_3281_add_ons_all_returned(
  p_order_id uuid, p_settled_only boolean
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT NOT public.issue_3281_add_on_switch('free_parent_enabled')
    OR NOT EXISTS (
      SELECT 1 FROM public.order_add_on_line_items item
       WHERE item.order_id = p_order_id
         AND item.quantity > (
           SELECT COALESCE(SUM(ra.quantity), 0)
             FROM public.refund_add_on_line_items ra
             JOIN public.refunds r ON r.id = ra.refund_id
            WHERE ra.order_add_on_line_item_id = item.id
              AND (r.status = 'succeeded'
                   OR (NOT p_settled_only AND r.status = 'pending'))
         )
    );
$fn$;

-- A settled full cancellation means the whole charge goes back, so a free ticket
-- left on the order doesn't keep it partial, whichever refund settles last.
-- Without one, every line counts, free tickets included. With the S4 switch on,
-- every add-on line must be back too.
CREATE OR REPLACE FUNCTION public.issue_3281_settled_payment_status(
  p_order_id uuid
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
     WHERE oli.order_id = p_order_id
       AND NOT (oli.unit_price_cents = 0 AND EXISTS (
         SELECT 1 FROM public.refunds cancel
          WHERE cancel.order_id = p_order_id
            AND cancel.status = 'succeeded'
            AND cancel.metadata #>> '{refund_request_manifest,is_full_refund}' = 'true'
       ))
       AND oli.quantity > (
         SELECT COALESCE(SUM(rli.quantity), 0)
           FROM public.refund_line_items rli
           JOIN public.refunds r ON r.id = rli.refund_id
          WHERE rli.order_line_item_id = oli.id AND r.status = 'succeeded'
       )
  ) AND public.issue_3281_add_ons_all_returned(p_order_id, true)
  THEN 'refunded' ELSE 'partial_refund' END;
$fn$;

-- The add-on lines a host or admin asked to refund on their own, canonical:
-- one entry per line, sorted, with the server's amount (quantity x the line's
-- unit price, never above what the line has left in cents). NULL when none.
CREATE FUNCTION public.issue_3281_add_on_refund_lines(
  p_order_id uuid, p_add_on_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_out jsonb;
  v_missing text;
BEGIN
  IF p_add_on_lines IS NULL OR p_add_on_lines = 'null'::jsonb
     OR (jsonb_typeof(p_add_on_lines) = 'array' AND jsonb_array_length(p_add_on_lines) = 0) THEN
    RETURN NULL;
  END IF;
  IF NOT public.issue_3281_add_on_switch('free_parent_enabled') THEN
    RAISE EXCEPTION 'add_on_refunds_off' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_add_on_lines) <> 'array' OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_add_on_lines) l
        WHERE jsonb_typeof(l) <> 'object'
           OR jsonb_typeof(l->'quantity') IS DISTINCT FROM 'number'
           OR (l->>'quantity') !~ '^[0-9]+$'
           OR (l->>'order_add_on_line_item_id') !~* '^[0-9a-f-]{36}$') THEN
    RAISE EXCEPTION 'refund_lines_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT l->>'order_add_on_line_item_id' INTO v_missing
    FROM jsonb_array_elements(p_add_on_lines) l
   WHERE NOT EXISTS (
     SELECT 1 FROM public.order_add_on_line_items item
      WHERE item.id = (l->>'order_add_on_line_item_id')::uuid AND item.order_id = p_order_id)
   LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'add_on_line_not_found: %', v_missing USING ERRCODE = 'P0004';
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
           'order_add_on_line_item_id', req.line_id,
           'quantity', req.qty,
           'amount_cents', LEAST(req.qty * item.unit_price_cents::bigint, item.total_cents::bigint))
         ORDER BY req.line_id)
    INTO v_out
    FROM (
      SELECT (l->>'order_add_on_line_item_id')::uuid AS line_id,
             SUM((l->>'quantity')::bigint) AS qty
        FROM jsonb_array_elements(p_add_on_lines) l
       GROUP BY 1
    ) req
    JOIN public.order_add_on_line_items item ON item.id = req.line_id;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) l WHERE (l->>'quantity')::bigint <= 0) THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;
  RETURN v_out;
END;
$fn$;

-- Cents the add-ons add to a refund. Returning every ticket returns whatever
-- the add-ons have left (the existing rule, which covers any named add-on
-- lines too); otherwise the named add-on lines alone, each bounded by what is
-- left on its line (I-ADDON-REFUND-BOUNDED).
CREATE FUNCTION public.issue_3281_add_on_refund_cents(
  p_order_id uuid, p_lines jsonb, p_add_on_lines jsonb, p_settled boolean
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_line jsonb;
  v_item public.order_add_on_line_items%ROWTYPE;
  v_done_qty bigint;
  v_done_cents bigint;
  v_cents bigint := 0;
BEGIN
  -- Bounds are checked first, so a named line can never be refunded twice.
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_add_on_lines, '[]'::jsonb)) LOOP
    SELECT * INTO v_item FROM public.order_add_on_line_items
     WHERE id = (v_line->>'order_add_on_line_item_id')::uuid AND order_id = p_order_id;
    SELECT COALESCE(SUM(ra.quantity), 0), COALESCE(SUM(ra.amount_cents::bigint), 0)
      INTO v_done_qty, v_done_cents
      FROM public.refund_add_on_line_items ra
      JOIN public.refunds r ON r.id = ra.refund_id
     WHERE ra.order_add_on_line_item_id = v_item.id
       AND r.status IN ('pending', 'succeeded');
    IF v_done_qty + (v_line->>'quantity')::bigint > v_item.quantity
       OR v_done_cents + (v_line->>'amount_cents')::bigint > v_item.total_cents THEN
      RAISE EXCEPTION 'add_on_line_overrefund: line=% requested=% existing=% capacity=%',
        v_item.id, v_line->>'quantity', v_done_qty, v_item.quantity USING ERRCODE = 'P0005';
    END IF;
    v_cents := v_cents + (v_line->>'amount_cents')::bigint;
  END LOOP;
  IF public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, NULL) THEN
    RETURN CASE WHEN p_settled
      THEN public.issue_3281_extras_refund_cents_settled(p_order_id, p_lines)
      ELSE public.issue_3281_extras_refund_cents(p_order_id, p_lines, NULL) END;
  END IF;
  RETURN v_cents::integer;
END;
$fn$;

-- Records the add-on side of a refund: everything left when every ticket is
-- returned (the existing recorder), else the named lines.
CREATE FUNCTION public.issue_3281_record_add_on_refund(
  p_refund_id uuid, p_order_id uuid, p_lines jsonb, p_add_on_lines jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, p_refund_id) THEN
    PERFORM public.issue_3281_record_extras_refund(p_refund_id, p_order_id, p_lines);
    RETURN;
  END IF;
  IF p_add_on_lines IS NULL THEN RETURN; END IF;
  INSERT INTO public.refund_add_on_line_items (
    refund_id, order_add_on_line_item_id, quantity, amount_cents
  )
  SELECT p_refund_id, (l->>'order_add_on_line_item_id')::uuid,
         (l->>'quantity')::integer, (l->>'amount_cents')::integer
    FROM jsonb_array_elements(p_add_on_lines) l;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_add_ons_all_returned(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_add_on_refund_lines(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_add_on_refund_cents(uuid, jsonb, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_record_add_on_refund(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_add_ons_all_returned(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3281_add_on_refund_lines(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3281_add_on_refund_cents(uuid, jsonb, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3281_record_add_on_refund(uuid, uuid, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Refund entry points: add-on lines ride p_lines (signatures unchanged).
-- ---------------------------------------------------------------------------
-- p_lines elements keyed order_add_on_line_item_id are add-on lines; the rest
-- are ticket lines. Returns p_lines itself when it has no add-on element, so
-- every existing caller sees exactly what it sent.
CREATE FUNCTION public.issue_3281_split_refund_lines(p_lines jsonb, p_add_ons boolean)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
         OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) l
                         WHERE jsonb_typeof(l) = 'object' AND l ? 'order_add_on_line_item_id')
      THEN CASE WHEN p_add_ons THEN NULL ELSE p_lines END
    ELSE (SELECT COALESCE(jsonb_agg(l ORDER BY ord), '[]'::jsonb)
            FROM jsonb_array_elements(p_lines) WITH ORDINALITY e(l, ord)
           WHERE (jsonb_typeof(l) = 'object' AND l ? 'order_add_on_line_item_id') = p_add_ons)
  END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3281_split_refund_lines(jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_split_refund_lines(jsonb, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.refund_preview(p_order_id uuid, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_lines jsonb;
  v_line jsonb;
  v_item public.order_line_items%ROWTYPE;
  v_existing integer;
  v_amount bigint := 0;
  v_remaining bigint;
  v_add_on_lines jsonb;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- issue #3281 S4 — add-on lines ride p_lines, keyed order_add_on_line_item_id.
  v_add_on_lines := public.issue_3281_add_on_refund_lines(
    p_order_id, public.issue_3281_split_refund_lines(p_lines, true));
  p_lines := public.issue_3281_split_refund_lines(p_lines, false);
  v_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    SELECT * INTO v_item FROM public.order_line_items
     WHERE id::text = v_line->>'order_line_item_id' AND order_id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %', v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;
    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;
    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_item.id AND r.status IN ('pending', 'succeeded');
    IF v_existing + (v_line->>'quantity')::int > v_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_item.id, v_line->>'quantity', v_existing, v_item.quantity USING ERRCODE = 'P0005';
    END IF;
    v_amount := v_amount + (v_line->>'amount_cents')::bigint;
  END LOOP;
  -- issue #3281 — the same rule the refund itself applies.
  v_amount := v_amount + public.issue_3281_add_on_refund_cents(p_order_id, v_lines, v_add_on_lines, false);

  v_remaining := COALESCE(v_order.buyer_total_cents, v_order.total_cents)
    - COALESCE(v_order.refunded_amount_cents, 0);
  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'currency', v_order.currency,
    'lines', v_lines,
    'amount_cents', v_amount,
    'remaining_cents', v_remaining,
    'within_remaining', v_amount <= v_remaining
  );
END
$function$
;

CREATE OR REPLACE FUNCTION public.biz_refund_order(p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_caller uuid := auth.uid();
  v_refund_id uuid;
  v_refund_amount_cents int := 0;
  v_line jsonb;
  v_line_item public.order_line_items%ROWTYPE;
  v_existing_refunded int;
  v_all_lines_fully_refunded boolean;
  v_proposed_new_payment_status text;
  v_existing_refund public.refunds%ROWTYPE;
  v_canonical_lines jsonb;
  v_request_manifest jsonb;
  v_stored_manifest jsonb;
  v_client_lines jsonb;
  v_client_amount_cents bigint;
  -- issue #3281 S4 — add-on lines refunded on their own (NULL when none).
  v_add_on_lines jsonb;
BEGIN
  -- Authorization precedes the idempotency lookup so replay cannot disclose
  -- refund or payment identifiers to a caller outside the order's brand.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  -- issue #3281 S4 — add-on lines ride p_lines, keyed order_add_on_line_item_id;
  -- the ticket lines below never see them.
  v_add_on_lines := public.issue_3281_add_on_refund_lines(
    p_order_id, public.issue_3281_split_refund_lines(p_lines, true));
  p_lines := public.issue_3281_split_refund_lines(p_lines, false);

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_line_item_id', line->>'order_line_item_id',
        'quantity', (line->>'quantity')::int,
        'amount_cents', (line->>'amount_cents')::int
      )
      ORDER BY
        line->>'order_line_item_id',
        (line->>'quantity')::int,
        (line->>'amount_cents')::int
    ),
    '[]'::jsonb
  )
  INTO v_client_lines
  FROM jsonb_array_elements(p_lines) AS line;

  -- Issue #3872 (F4): the refund amount is derived on the server from the
  -- order snapshot (quantity x order_line_items.unit_price_cents, the policy the
  -- Host app has always sent). A client-sent amount_cents is ignored; it is
  -- only logged below when it disagrees. Replays of a key minted before this
  -- change still match their stored client-shaped manifest.
  v_canonical_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  SELECT sum((l->>'amount_cents')::bigint) INTO v_client_amount_cents
  FROM jsonb_array_elements(v_client_lines) l;

  v_request_manifest := jsonb_build_object(
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    -- What the client sent, kept so a retry under the same key must repeat it.
    'client_lines', v_client_lines
  );
  IF v_add_on_lines IS NOT NULL THEN
    v_request_manifest := v_request_manifest || jsonb_build_object('add_on_lines', v_add_on_lines);
  END IF;

  -- Serialize same-key requests before the lookup/insert pair. The existing
  -- unique expression index remains the final database backstop.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_order_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_existing_refund
  FROM public.refunds
  WHERE metadata->>'idempotency_key' = p_idempotency_key
    AND order_id = p_order_id
  LIMIT 1;

  IF FOUND THEN
    v_stored_manifest := v_existing_refund.metadata->'refund_request_manifest';
    IF v_stored_manifest IS NULL
       OR (v_stored_manifest->'lines' IS DISTINCT FROM v_canonical_lines
           AND v_stored_manifest->'lines' IS DISTINCT FROM v_client_lines)
       -- A request that names amounts must repeat the amounts first sent under
       -- this key (same key, different body is still a mismatch, #1175).
       OR (v_stored_manifest ? 'client_lines'
           AND v_client_amount_cents IS NOT NULL
           AND v_stored_manifest->'client_lines' IS DISTINCT FROM v_client_lines)
       OR v_stored_manifest->'add_on_lines' IS DISTINCT FROM v_add_on_lines
       OR v_stored_manifest->>'reason' IS DISTINCT FROM trim(p_reason) THEN
      RAISE EXCEPTION 'idempotency_request_mismatch'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'refund_id', v_existing_refund.id,
      'order_id', p_order_id,
      'amount_cents', v_existing_refund.amount_cents,
      'currency', v_existing_refund.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status',
        v_stored_manifest->>'proposed_new_payment_status',
      'is_full_refund',
        (v_stored_manifest->>'is_full_refund')::boolean,
      'lines', v_stored_manifest->'lines',
      'reason', v_stored_manifest->>'reason',
      'idempotent_replay', true
    );
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    SELECT * INTO v_line_item
    FROM public.order_line_items
    WHERE id = (v_line->>'order_line_item_id')::uuid
      AND order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %',
        v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;

    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_line_item.id
      AND r.status IN ('pending', 'succeeded');

    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;

    IF v_existing_refunded + (v_line->>'quantity')::int > v_line_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_line_item.id, v_line->>'quantity', v_existing_refunded,
        v_line_item.quantity USING ERRCODE = 'P0005';
    END IF;

    v_refund_amount_cents :=
      v_refund_amount_cents + (v_line->>'amount_cents')::int;
  END LOOP;

  -- issue #3281 — returning the last tickets also returns the order's extras.
  v_refund_amount_cents := v_refund_amount_cents
    + public.issue_3281_add_on_refund_cents(p_order_id, v_canonical_lines, v_add_on_lines, true);

  IF v_refund_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  -- Issue #3872: never more than the buyer paid and has not had back.
  IF v_refund_amount_cents >
     COALESCE(v_order.buyer_total_cents, v_order.total_cents)
       - COALESCE(v_order.refunded_amount_cents, 0) THEN
    RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%',
      v_refund_amount_cents,
      COALESCE(v_order.buyer_total_cents, v_order.total_cents)
        - COALESCE(v_order.refunded_amount_cents, 0)
      USING ERRCODE = 'P0009';
  END IF;

  INSERT INTO public.refunds (
    order_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    p_order_id,
    v_refund_amount_cents,
    v_order.currency,
    trim(p_reason),
    v_caller,
    'pending',
    v_order.stripe_payment_intent_id,
    v_order.stripe_charge_id,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'refund_request_manifest', v_request_manifest
    ) || CASE
      WHEN v_client_amount_cents IS NOT NULL
        AND v_client_amount_cents IS DISTINCT FROM v_refund_amount_cents::bigint
      THEN jsonb_build_object('issue_3872_client_reported', jsonb_build_object(
        'amount_cents', v_client_amount_cents,
        'lines', v_client_lines,
        'server_amount_cents', v_refund_amount_cents))
      ELSE '{}'::jsonb
    END
  ) RETURNING id INTO v_refund_id;

  PERFORM public.issue_3281_record_add_on_refund(v_refund_id, p_order_id, v_canonical_lines, v_add_on_lines);

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    INSERT INTO public.refund_line_items (
      refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
    )
    SELECT
      v_refund_id,
      (v_line->>'order_line_item_id')::uuid,
      oli.ticket_type_id,
      (v_line->>'quantity')::int,
      (v_line->>'amount_cents')::int
    FROM public.order_line_items oli
    WHERE oli.id = (v_line->>'order_line_item_id')::uuid
      -- issue #3281 S4 — a free ticket has nothing to refund: naming it returns
      -- it (status below), never a $0 row.
      AND ((v_line->>'amount_cents')::int > 0 OR NOT public.issue_3281_add_on_switch('free_parent_enabled'));
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id
          AND r.status IN ('pending', 'succeeded')
      )
      + CASE WHEN oli.unit_price_cents = 0 AND public.issue_3281_add_on_switch('free_parent_enabled')
          THEN COALESCE((SELECT SUM((l->>'quantity')::int) FROM jsonb_array_elements(v_canonical_lines) l
                          WHERE l->>'order_line_item_id' = oli.id::text), 0)
          ELSE 0 END
  ) AND public.issue_3281_add_ons_all_returned(p_order_id, false)
  INTO v_all_lines_fully_refunded;

  v_proposed_new_payment_status := CASE
    WHEN v_all_lines_fully_refunded THEN 'refunded'
    ELSE 'partial_refund'
  END;
  v_request_manifest := v_request_manifest || jsonb_build_object(
    'amount_cents', v_refund_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded
  );
  UPDATE public.refunds
  SET metadata = metadata ||
    jsonb_build_object('refund_request_manifest', v_request_manifest)
  WHERE id = v_refund_id;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'order_id', p_order_id,
    'amount_cents', v_refund_amount_cents,
    'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded,
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    'idempotent_replay', false
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_refund_order(p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_caller uuid := auth.uid();
  v_refund_id uuid;
  v_refund_amount_cents int := 0;
  v_line jsonb;
  v_line_item public.order_line_items%ROWTYPE;
  v_existing_refunded int;
  v_all_lines_fully_refunded boolean;
  v_proposed_new_payment_status text;
  v_existing_refund public.refunds%ROWTYPE;
  v_remaining_cents int;
  v_canonical_lines jsonb;
  v_request_manifest jsonb;
  v_stored_manifest jsonb;
  v_client_lines jsonb;
  v_client_amount_cents bigint;
  -- issue #3281 S4 — add-on lines refunded on their own (NULL when none).
  v_add_on_lines jsonb;
BEGIN
  -- I-PROPOSED-1278-ADMIN-GATE-FIRST: this remains the first executable
  -- statement, byte-for-byte equivalent to the approved service-role twin.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  -- issue #3281 S4 — add-on lines ride p_lines, keyed order_add_on_line_item_id;
  -- the ticket lines below never see them.
  v_add_on_lines := public.issue_3281_add_on_refund_lines(
    p_order_id, public.issue_3281_split_refund_lines(p_lines, true));
  p_lines := public.issue_3281_split_refund_lines(p_lines, false);

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_line_item_id', line->>'order_line_item_id',
        'quantity', (line->>'quantity')::int,
        'amount_cents', (line->>'amount_cents')::int
      )
      ORDER BY
        line->>'order_line_item_id',
        (line->>'quantity')::int,
        (line->>'amount_cents')::int
    ),
    '[]'::jsonb
  )
  INTO v_client_lines
  FROM jsonb_array_elements(p_lines) AS line;

  -- Issue #3872 (F4): the refund amount is derived on the server from the
  -- order snapshot (quantity x order_line_items.unit_price_cents, the policy the
  -- Host app has always sent). A client-sent amount_cents is ignored; it is
  -- only logged below when it disagrees. Replays of a key minted before this
  -- change still match their stored client-shaped manifest.
  v_canonical_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  SELECT sum((l->>'amount_cents')::bigint) INTO v_client_amount_cents
  FROM jsonb_array_elements(v_client_lines) l;

  v_request_manifest := jsonb_build_object(
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    -- What the client sent, kept so a retry under the same key must repeat it.
    'client_lines', v_client_lines
  );
  IF v_add_on_lines IS NOT NULL THEN
    v_request_manifest := v_request_manifest || jsonb_build_object('add_on_lines', v_add_on_lines);
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_order_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_existing_refund
  FROM public.refunds
  WHERE metadata->>'idempotency_key' = p_idempotency_key
    AND order_id = p_order_id
  LIMIT 1;

  IF FOUND THEN
    v_stored_manifest := v_existing_refund.metadata->'refund_request_manifest';
    IF v_stored_manifest IS NULL
       OR (v_stored_manifest->'lines' IS DISTINCT FROM v_canonical_lines
           AND v_stored_manifest->'lines' IS DISTINCT FROM v_client_lines)
       -- A request that names amounts must repeat the amounts first sent under
       -- this key (same key, different body is still a mismatch, #1175).
       OR (v_stored_manifest ? 'client_lines'
           AND v_client_amount_cents IS NOT NULL
           AND v_stored_manifest->'client_lines' IS DISTINCT FROM v_client_lines)
       OR v_stored_manifest->'add_on_lines' IS DISTINCT FROM v_add_on_lines
       OR v_stored_manifest->>'reason' IS DISTINCT FROM trim(p_reason) THEN
      RAISE EXCEPTION 'idempotency_request_mismatch'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'refund_id', v_existing_refund.id,
      'order_id', p_order_id,
      'amount_cents', v_existing_refund.amount_cents,
      'currency', v_existing_refund.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status',
        v_stored_manifest->>'proposed_new_payment_status',
      'is_full_refund',
        (v_stored_manifest->>'is_full_refund')::boolean,
      'lines', v_stored_manifest->'lines',
      'reason', v_stored_manifest->>'reason',
      'idempotent_replay', true
    );
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    SELECT * INTO v_line_item
    FROM public.order_line_items
    WHERE id = (v_line->>'order_line_item_id')::uuid
      AND order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %',
        v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;

    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_line_item.id
      AND r.status IN ('pending', 'succeeded');

    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;

    IF v_existing_refunded + (v_line->>'quantity')::int > v_line_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_line_item.id, v_line->>'quantity', v_existing_refunded,
        v_line_item.quantity USING ERRCODE = 'P0005';
    END IF;

    v_refund_amount_cents :=
      v_refund_amount_cents + (v_line->>'amount_cents')::int;
  END LOOP;

  -- issue #3281 — returning the last tickets also returns the order's extras.
  v_refund_amount_cents := v_refund_amount_cents
    + public.issue_3281_add_on_refund_cents(p_order_id, v_canonical_lines, v_add_on_lines, true);

  IF v_refund_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  v_remaining_cents :=
    v_order.total_cents - COALESCE(v_order.refunded_amount_cents, 0);
  IF v_refund_amount_cents > v_remaining_cents THEN
    RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%',
      v_refund_amount_cents, v_remaining_cents USING ERRCODE = 'P0009';
  END IF;

  INSERT INTO public.refunds (
    order_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    p_order_id,
    v_refund_amount_cents,
    v_order.currency,
    trim(p_reason),
    v_caller,
    'pending',
    v_order.stripe_payment_intent_id,
    v_order.stripe_charge_id,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'refund_request_manifest', v_request_manifest
    ) || CASE
      WHEN v_client_amount_cents IS NOT NULL
        AND v_client_amount_cents IS DISTINCT FROM v_refund_amount_cents::bigint
      THEN jsonb_build_object('issue_3872_client_reported', jsonb_build_object(
        'amount_cents', v_client_amount_cents,
        'lines', v_client_lines,
        'server_amount_cents', v_refund_amount_cents))
      ELSE '{}'::jsonb
    END
  ) RETURNING id INTO v_refund_id;

  PERFORM public.issue_3281_record_add_on_refund(v_refund_id, p_order_id, v_canonical_lines, v_add_on_lines);

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    INSERT INTO public.refund_line_items (
      refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
    )
    SELECT
      v_refund_id,
      (v_line->>'order_line_item_id')::uuid,
      oli.ticket_type_id,
      (v_line->>'quantity')::int,
      (v_line->>'amount_cents')::int
    FROM public.order_line_items oli
    WHERE oli.id = (v_line->>'order_line_item_id')::uuid
      -- issue #3281 S4 — a free ticket has nothing to refund: naming it returns
      -- it (status below), never a $0 row.
      AND ((v_line->>'amount_cents')::int > 0 OR NOT public.issue_3281_add_on_switch('free_parent_enabled'));
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id
          AND r.status IN ('pending', 'succeeded')
      )
      + CASE WHEN oli.unit_price_cents = 0 AND public.issue_3281_add_on_switch('free_parent_enabled')
          THEN COALESCE((SELECT SUM((l->>'quantity')::int) FROM jsonb_array_elements(v_canonical_lines) l
                          WHERE l->>'order_line_item_id' = oli.id::text), 0)
          ELSE 0 END
  ) AND public.issue_3281_add_ons_all_returned(p_order_id, false)
  INTO v_all_lines_fully_refunded;

  v_proposed_new_payment_status := CASE
    WHEN v_all_lines_fully_refunded THEN 'refunded'
    ELSE 'partial_refund'
  END;
  v_request_manifest := v_request_manifest || jsonb_build_object(
    'amount_cents', v_refund_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded
  );
  UPDATE public.refunds
  SET metadata = metadata ||
    jsonb_build_object('refund_request_manifest', v_request_manifest)
  WHERE id = v_refund_id;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'order_id', p_order_id,
    'amount_cents', v_refund_amount_cents,
    'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded,
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    'idempotent_replay', false
  );
END;
$function$
;

-- ---------------------------------------------------------------------------
-- 4. Admin order view: the order's add-on lines with what is refunded.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_order_add_on_lines(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', item.id,
             'name', item.add_on_name_at_order,
             'quantity', item.quantity,
             'unit_price_cents', item.unit_price_cents,
             'total_cents', item.total_cents,
             'refunded_quantity', done.qty,
             'refunded_cents', done.cents) ORDER BY item.created_at, item.id)
      FROM public.order_add_on_line_items item
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(ra.quantity), 0)::integer AS qty,
               COALESCE(SUM(ra.amount_cents::bigint), 0) AS cents
          FROM public.refund_add_on_line_items ra
          JOIN public.refunds r ON r.id = ra.refund_id
         WHERE ra.order_add_on_line_item_id = item.id
           AND r.status IN ('pending', 'succeeded')
      ) done
     WHERE item.order_id = p_order_id), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_order_add_on_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_order_add_on_lines(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_order_add_on_lines(uuid) IS
  'Issue #3281 S4: Admin order view — each add-on line with its paid and refunded (pending + succeeded) quantity and cents. is_admin_user() only; read-only.';

COMMIT;

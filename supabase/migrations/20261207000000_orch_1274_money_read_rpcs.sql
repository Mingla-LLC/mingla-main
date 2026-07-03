-- ORCH-1274 [Admin Money console — READ-ONLY] — the 10 money read-RPCs.
--
-- Backs the admin console's money layer: per-brand Stripe Connect status,
-- orders (list + detail), the refunds / disputes / payouts / platform-revenue
-- ledger, and a support-context subscription bundle. Every read is DERIVED /
-- JOINED / CROSS-BRAND / crosses a sensitive money table, so per ORCH-1271 §3
-- read-authz it is served by a guard-first SECURITY DEFINER RPC — NOT an admin
-- RLS SELECT policy. NO admin RLS is added to any money table (the money-
-- containment invariant I-PROPOSED-1274-MONEY-READ-VIA-DEFINER-RPC).
--
-- CONTRACT (per ORCH-1271 §3 + the ORCH-1272 admin_get_person precedent):
--   * READ-ONLY: no INSERT/UPDATE/DELETE, no admin_write_audit (these are not
--     in the i-admin-write-audited write-RPC registry). Wave-2 act-RPCs (refund,
--     Connect refresh, dispute resolve) are deferred design notes (SPEC §9).
--   * Guard-FIRST: `IF NOT public.is_admin_user() THEN RAISE EXCEPTION
--     'not_authorized'` is the first executable statement of every function
--     (I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT; enforced by
--     i-admin-gate-first-statement.mjs, where all 10 names are registered).
--   * SHAPE: list RPCs return jsonb `{ "rows": <jsonb[]>, "total": <int> }`
--     (the FULL filtered count, not the page); detail RPCs return one jsonb
--     bundle. Money is INTEGER CENTS + a currency code — never a pre-formatted
--     string (no to_char, no '$'); I-PROPOSED-1274-MONEY-READ-CENTS-CONTRACT.
--   * NO Stripe API call — schema/webhook-synced data only.
--   * LEAST-PRIVILEGE: each RPC is REVOKE'd from anon/PUBLIC + GRANT'd to
--     authenticated only (admin UI user-JWT path; the is_admin_user() guard is
--     the real gate). A tail DO block self-asserts the lockdown at apply time
--     (ORCH-1271 P0 golden template). Anon-EXECUTABLE = apply FAILS.
--
-- Reused helpers (called, never altered — verified live 2026-07-03):
--   pg_derive_brand_stripe_status(uuid)->text, biz_order_brand_id(uuid)->uuid,
--   get_effective_tier(uuid)->text, admin_get_override_history(uuid)->TABLE(...).
--
-- Enforces: I-PROPOSED-1274-MONEY-READ-VIA-DEFINER-RPC,
--           I-PROPOSED-1274-MONEY-READ-CENTS-CONTRACT,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT.

--------------------------------------------------------------------------------
-- 1. Per-brand Stripe Connect status — list (SPEC §4.2, ships verbatim).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_brand_stripe_status(
  p_search text DEFAULT NULL, p_status_filter text DEFAULT NULL,
  p_provider_filter text DEFAULT NULL, p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT b.id AS brand_id, b.name AS brand_name, b.slug AS brand_slug,
      b.stripe_connect_id, b.paystack_subaccount_code,
      public.pg_derive_brand_stripe_status(b.id) AS derived_status,
      sca.charges_enabled, sca.payouts_enabled, sca.country, sca.default_currency,
      sca.detached_at, sca.updated_at,
      NULLIF(sca.requirements->>'disabled_reason','') AS disabled_reason,
      (CASE WHEN b.stripe_connect_id IS NOT NULL THEN 'stripe'
            WHEN b.paystack_subaccount_code IS NOT NULL THEN 'paystack'
            ELSE 'none' END) AS provider
    FROM public.brands b
    LEFT JOIN public.stripe_connect_accounts sca ON sca.brand_id = b.id
    WHERE b.deleted_at IS NULL
      AND (b.stripe_connect_id IS NOT NULL OR b.paystack_subaccount_code IS NOT NULL
           OR sca.id IS NOT NULL)
  ), filtered AS (
    SELECT * FROM base
    WHERE (p_search IS NULL OR brand_name ILIKE '%'||p_search||'%' OR brand_slug ILIKE '%'||p_search||'%'
           OR stripe_connect_id ILIKE '%'||p_search||'%')
      AND (p_status_filter IS NULL OR derived_status = p_status_filter)
      AND (p_provider_filter IS NULL OR provider = p_provider_filter)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.updated_at DESC NULLS LAST), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
    INTO v_rows, v_total
    FROM (SELECT * FROM filtered ORDER BY updated_at DESC NULLS LAST
          LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) f;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END; $$;

--------------------------------------------------------------------------------
-- 2. Per-brand Stripe Connect status — detail bundle (SPEC §4.3).
--    Surfaces the full stripe_connect_accounts row (incl. requirements jsonb,
--    country, detached_at, controller_dashboard_type) the brands mirror hides,
--    plus external bank accounts. UI derives next-steps from requirements.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_brand_stripe_status(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT jsonb_build_object(
    'brand', jsonb_build_object(
      'id', b.id, 'name', b.name, 'slug', b.slug,
      'pricing_currency', b.pricing_currency, 'default_currency', b.default_currency,
      'paystack_subaccount_code', b.paystack_subaccount_code,
      'stripe_connect_id', b.stripe_connect_id,
      'payment_provider', b.payment_provider, 'payment_country', b.payment_country),
    'status', public.pg_derive_brand_stripe_status(b.id),
    'provider', (CASE WHEN b.stripe_connect_id IS NOT NULL THEN 'stripe'
                      WHEN b.paystack_subaccount_code IS NOT NULL THEN 'paystack'
                      ELSE 'none' END),
    'account', to_jsonb(sca),
    'requirements', sca.requirements,
    'external_accounts', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'type', ea.type, 'last4', ea.last4, 'currency', ea.currency,
                'status', ea.status, 'country', ea.country,
                'default_for_currency', ea.default_for_currency))
       FROM public.stripe_external_accounts ea WHERE ea.brand_id = b.id), '[]'::jsonb))
    INTO v_out
    FROM public.brands b
    LEFT JOIN public.stripe_connect_accounts sca ON sca.brand_id = b.id
    WHERE b.id = p_brand_id;
  IF v_out IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN v_out;
END; $$;

--------------------------------------------------------------------------------
-- 3. Orders — list (SPEC §5.2). No direct brand_id on orders → brand resolves
--    via event_id → events.brand_id.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_orders(
  p_search text DEFAULT NULL, p_status_filter text DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL, p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT o.id AS order_id, o.created_at, o.buyer_name, o.buyer_email, o.buyer_phone,
      o.buyer_user_id, o.event_id, e.title AS event_title, e.event_type,
      e.brand_id, b.name AS brand_name,
      o.total_cents, o.currency, o.payment_method, o.payment_status,
      o.stripe_payment_intent_id, o.stripe_charge_id, o.refunded_amount_cents,
      o.is_door_sale, o.at_risk, o.installment_plan_root, o.source
    FROM public.orders o
    LEFT JOIN public.events e ON e.id = o.event_id
    LEFT JOIN public.brands b ON b.id = e.brand_id
  ), filtered AS (
    SELECT * FROM base
    WHERE (p_search IS NULL
           OR buyer_email ILIKE '%'||p_search||'%' OR buyer_phone ILIKE '%'||p_search||'%'
           OR buyer_name ILIKE '%'||p_search||'%'
           OR stripe_payment_intent_id ILIKE '%'||p_search||'%'
           OR order_id::text = p_search)
      AND (p_status_filter IS NULL OR payment_status = p_status_filter)
      AND (p_brand_id IS NULL OR brand_id = p_brand_id)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
    INTO v_rows, v_total
    FROM (SELECT * FROM filtered ORDER BY created_at DESC
          LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) f;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END; $$;

--------------------------------------------------------------------------------
-- 4. Orders — detail bundle (SPEC §5.2): order + event + brand + line items +
--    installments + refunds + partner split.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_order jsonb; v_event_id uuid; v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT to_jsonb(o) INTO v_order FROM public.orders o WHERE o.id = p_order_id;
  IF v_order IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  v_event_id := NULLIF(v_order->>'event_id','')::uuid;
  v_out := jsonb_build_object(
    'order', v_order,
    'event', (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'event_type', e.event_type,
                'city', e.city, 'status', e.status, 'visibility', e.visibility)
              FROM public.events e WHERE e.id = v_event_id),
    'brand', (SELECT jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug)
              FROM public.events e JOIN public.brands b ON b.id = e.brand_id
              WHERE e.id = v_event_id),
    'line_items', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'ticket_type_name', tt.name, 'quantity', li.quantity,
                'unit_price_cents', li.unit_price_cents, 'total_cents', li.total_cents)
              ORDER BY li.id)
       FROM public.order_line_items li
       LEFT JOIN public.ticket_types tt ON tt.id = li.ticket_type_id
       WHERE li.order_id = p_order_id), '[]'::jsonb),
    'installments', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'ordinal', oi.ordinal, 'amount_cents', oi.amount_cents, 'currency', oi.currency,
                'due_at', oi.due_at, 'status', oi.status, 'collected_at', oi.collected_at,
                'failed_at', oi.failed_at, 'failure_reason', oi.failure_reason)
              ORDER BY oi.ordinal)
       FROM public.order_installments oi WHERE oi.order_id = p_order_id), '[]'::jsonb),
    'refunds', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'id', r.id, 'amount_cents', r.amount_cents, 'currency', r.currency,
                'status', r.status, 'reason', r.reason, 'stripe_refund_id', r.stripe_refund_id,
                'created_at', r.created_at, 'processed_at', r.processed_at)
              ORDER BY r.created_at DESC)
       FROM public.refunds r WHERE r.order_id = p_order_id), '[]'::jsonb),
    'partner_split', (SELECT jsonb_build_object(
                'mingla_fee_cents', ps.mingla_fee_cents, 'partner_share_cents', ps.partner_share_cents,
                'transfer_currency', ps.transfer_currency, 'status', ps.status)
              FROM public.partner_splits ps WHERE ps.order_id = p_order_id
              ORDER BY ps.created_at DESC LIMIT 1));
  RETURN v_out;
END; $$;

--------------------------------------------------------------------------------
-- 5. Refunds — list (SPEC §6.2). Brand via biz_order_brand_id(order_id).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_refunds(
  p_search text DEFAULT NULL, p_status_filter text DEFAULT NULL,
  p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT r.id, r.order_id, public.biz_order_brand_id(r.order_id) AS brand_id,
      r.amount_cents, r.currency, r.reason, r.status, r.stripe_refund_id,
      r.stripe_charge_id, r.application_fee_refunded_cents, r.initiated_by,
      r.created_at, r.processed_at
    FROM public.refunds r
  ), enriched AS (
    SELECT base.*, b.name AS brand_name
    FROM base LEFT JOIN public.brands b ON b.id = base.brand_id
  ), filtered AS (
    SELECT * FROM enriched
    WHERE (p_search IS NULL
           OR stripe_refund_id ILIKE '%'||p_search||'%' OR stripe_charge_id ILIKE '%'||p_search||'%'
           OR order_id::text = p_search)
      AND (p_status_filter IS NULL OR status = p_status_filter)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
    INTO v_rows, v_total
    FROM (SELECT * FROM filtered ORDER BY created_at DESC
          LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) f;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END; $$;

--------------------------------------------------------------------------------
-- 6. Disputes — list (SPEC §6.2). Ordered soonest-evidence-due first.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_disputes(
  p_search text DEFAULT NULL, p_status_filter text DEFAULT NULL,
  p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT d.id, d.stripe_dispute_id, d.brand_id, b.name AS brand_name, d.order_id,
      d.amount, d.currency, d.status, d.reason, d.evidence_due_by, d.is_charge_refundable,
      d.stripe_charge_id, d.created_at, d.updated_at
    FROM public.stripe_disputes d LEFT JOIN public.brands b ON b.id = d.brand_id
  ), filtered AS (
    SELECT * FROM base
    WHERE (p_search IS NULL
           OR stripe_dispute_id ILIKE '%'||p_search||'%' OR stripe_charge_id ILIKE '%'||p_search||'%')
      AND (p_status_filter IS NULL OR status = p_status_filter)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.evidence_due_by ASC NULLS LAST, f.created_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
    INTO v_rows, v_total
    FROM (SELECT * FROM filtered ORDER BY evidence_due_by ASC NULLS LAST, created_at DESC
          LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) f;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END; $$;

--------------------------------------------------------------------------------
-- 7. Disputes — detail bundle (SPEC §6.2): dispute + linked order + brand +
--    whole raw_event (UI shows structured fields + a collapsible raw viewer).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_dispute(p_dispute_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_dispute jsonb; v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT to_jsonb(d) INTO v_dispute FROM public.stripe_disputes d WHERE d.id = p_dispute_id;
  IF v_dispute IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  v_out := jsonb_build_object(
    'dispute', v_dispute,
    'order', (SELECT jsonb_build_object('order_id', o.id, 'total_cents', o.total_cents,
                'currency', o.currency, 'payment_status', o.payment_status, 'buyer_email', o.buyer_email)
              FROM public.orders o WHERE o.id = NULLIF(v_dispute->>'order_id','')::uuid),
    'brand', (SELECT jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug)
              FROM public.brands b WHERE b.id = NULLIF(v_dispute->>'brand_id','')::uuid),
    'raw_event', v_dispute->'raw_event');
  RETURN v_out;
END; $$;

--------------------------------------------------------------------------------
-- 8. Payouts — list (SPEC §6.2).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_payouts(
  p_search text DEFAULT NULL, p_status_filter text DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL, p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT p.id, p.brand_id, b.name AS brand_name, p.stripe_payout_id,
      p.amount_cents, p.currency, p.status, p.arrival_date, p.created_at
    FROM public.payouts p LEFT JOIN public.brands b ON b.id = p.brand_id
  ), filtered AS (
    SELECT * FROM base
    WHERE (p_search IS NULL OR stripe_payout_id ILIKE '%'||p_search||'%')
      AND (p_status_filter IS NULL OR status = p_status_filter)
      AND (p_brand_id IS NULL OR brand_id = p_brand_id)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
    INTO v_rows, v_total
    FROM (SELECT * FROM filtered ORDER BY created_at DESC
          LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) f;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END; $$;

--------------------------------------------------------------------------------
-- 9. Platform revenue log — list (SPEC §6.2). Mingla application-fee ledger,
--    the only current money surface with real rows (49 live).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_revenue_log(
  p_search text DEFAULT NULL, p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT m.id, m.stripe_application_fee_id, m.stripe_account_id, m.brand_id,
      b.name AS brand_name, m.amount_cents, m.currency,
      m.refunded_amount_cents, m.refunded, m.created_at
    FROM public.mingla_revenue_log m LEFT JOIN public.brands b ON b.id = m.brand_id
  ), filtered AS (
    SELECT * FROM base
    WHERE (p_search IS NULL
           OR stripe_application_fee_id ILIKE '%'||p_search||'%'
           OR stripe_account_id ILIKE '%'||p_search||'%')
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
    INTO v_rows, v_total
    FROM (SELECT * FROM filtered ORDER BY created_at DESC
          LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) f;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END; $$;

--------------------------------------------------------------------------------
-- 10. Subscription support-context bundle (SPEC §7.2). One user's tier /
--     effective tier / active override / override history for a support lookup.
--     Reuses get_effective_tier + admin_get_override_history (both admin-gated
--     SECURITY DEFINER; auth.uid() is preserved through the nested calls).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_subscription_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sub jsonb; v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT to_jsonb(s) INTO v_sub FROM public.subscriptions s WHERE s.user_id = p_user_id;
  v_out := jsonb_build_object(
    'subscription', v_sub,                       -- full subscriptions row; may be null
    'effective_tier', public.get_effective_tier(p_user_id),
    'raw_tier', COALESCE(v_sub->>'tier', 'free'),
    'override', (SELECT jsonb_build_object(
                   'active', true, 'tier', o.tier, 'reason', o.reason,
                   'starts_at', o.starts_at, 'expires_at', o.expires_at, 'granted_by', o.granted_by)
                 FROM public.admin_subscription_overrides o
                 WHERE o.user_id = p_user_id AND o.revoked_at IS NULL
                   AND o.starts_at <= now() AND o.expires_at > now()
                 ORDER BY o.expires_at DESC LIMIT 1),
    'override_history', COALESCE(
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC)
       FROM public.admin_get_override_history(p_user_id) h), '[]'::jsonb));
  RETURN v_out;
END; $$;

--------------------------------------------------------------------------------
-- LEAST-PRIVILEGE (ORCH-1271 P0 golden template — MANDATORY on every admin RPC).
-- Functions default to PUBLIC EXECUTE. These are user-JWT admin reads (the admin
-- UI calls them via the anon key + an authenticated admin JWT; the is_admin_user()
-- guard is the real gate). Lock EXECUTE to authenticated only; anon / PUBLIC get
-- nothing. Defense-in-depth behind the guard-first check.
--------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.admin_list_brand_stripe_status(text,text,text,int,int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_brand_stripe_status(text,text,text,int,int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_brand_stripe_status(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_get_brand_stripe_status(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_orders(text,text,uuid,int,int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_orders(text,text,uuid,int,int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_order(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_get_order(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_refunds(text,text,int,int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_refunds(text,text,int,int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_disputes(text,text,int,int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_disputes(text,text,int,int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_dispute(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_get_dispute(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_payouts(text,text,uuid,int,int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_payouts(text,text,uuid,int,int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_revenue_log(text,int,int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_revenue_log(text,int,int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_subscription_detail(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_get_subscription_detail(uuid) TO authenticated;

--------------------------------------------------------------------------------
-- Self-assert: apply FAILS unless the privilege lockdown holds for ALL 10 RPCs
-- (anon cannot execute; authenticated can). Runtime-proves the P0 containment at
-- apply time — anon-EXECUTABLE = REJECT.
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_sigs text[] := ARRAY[
    'public.admin_list_brand_stripe_status(text,text,text,integer,integer)',
    'public.admin_get_brand_stripe_status(uuid)',
    'public.admin_list_orders(text,text,uuid,integer,integer)',
    'public.admin_get_order(uuid)',
    'public.admin_list_refunds(text,text,integer,integer)',
    'public.admin_list_disputes(text,text,integer,integer)',
    'public.admin_get_dispute(uuid)',
    'public.admin_list_payouts(text,text,uuid,integer,integer)',
    'public.admin_list_revenue_log(text,integer,integer)',
    'public.admin_get_subscription_detail(uuid)'
  ];
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY v_sigs LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'ORCH-1274: % still EXECUTE-able by anon', v_sig;
    END IF;
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'ORCH-1274: authenticated lost EXECUTE on % (admin UI would break)', v_sig;
    END IF;
  END LOOP;
END $$;

-- Issue #4130 (Wave 2a) — Mingla money, Payments, Orders and Money ledger.
--
-- What this adds:
--   1. fx_rate_on / fx_usd_minor_exact: a read-only HISTORICAL exchange-rate
--      lookup. fx_convert_minor (#1384) refuses expired snapshots, which is
--      right for live prices and wrong for history: a sale converts at the
--      rate of its own day, so past revenue never moves when rates change.
--      The lookup returns the latest stored rate ON OR BEFORE the moment asked
--      about, never one from later (no forward extrapolation), and NULL when
--      nothing that old exists. Callers show NULL as "not converted"; they
--      never invent a rate.
--   2. admin_mingla_money_summary: what buyers paid, what Mingla kept, what it
--      cost and what reached hosts, per currency, with every figure also in
--      US dollars at each row's own-day rate. Source of truth is the payout
--      release ledger (payout_release_items for fee and processing,
--      payout_transfer_legs for actual transfer costs) plus orders for what
--      buyers paid. mingla_revenue_log is NOT read: it holds only Stripe
--      application fees and missed all naira revenue.
--   3. payout_owes_back_settlements + admin_settle_owes_back: "Mingla owes
--      back" (transfer_fee_credit adjustments) can be marked settled with a
--      reference. payout_ledger_adjustments is append-only, so settlement is a
--      separate row per adjustment; every summary excludes settled credits.
--   4. admin_list_brand_payment_readiness: the facts the Payments page (and
--      the Brands page later) needs to say whether a brand can take money and
--      get paid, for Stripe AND Paystack. The readiness verdict itself is
--      derived client-side in mingla-admin/src/lib/paymentReadiness.js (one
--      place, shared by both pages).
--   5. admin_list_orders (replaced, same signature): ticket price, Mingla fee,
--      buyer paid, host-paid state and provider per order; real status filter
--      plus "free" and "host_not_paid". admin_orders_overview: paid orders all
--      time, discounts given (discounted orders only) and margin, separately.
--   6. admin_list_payouts (replaced, same signature): ticket price per payout
--      so the fee reads as a share of the ticket price; owes-back excludes
--      settled credits.
--
-- Every function is SECURITY DEFINER with search_path public, pg_temp; the
-- admin_* ones open with the is_admin_user() guard (the gate every money page
-- already uses, I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT), are revoked from
-- PUBLIC and anon, and return integer minor units plus a currency code, never
-- a formatted string (I-PROPOSED-1274-MONEY-READ-CENTS-CONTRACT).
--
-- Invariant (declared in the pg17 test): I-4130-FX-OWN-DAY | issue #4130 | a historical money figure converts at the latest stored rate on or before its own moment; never a later rate; NULL when none exists.
-- Invariant (declared in the pg17 test): I-4130-NO-CROSS-CURRENCY-SUM | issue #4130 | admin money summaries keep each currency separate; the only cross-currency totals are USD conversions.

BEGIN;

--------------------------------------------------------------------------------
-- 1. Historical FX lookup
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fx_rate_on(p_currency text, p_at timestamptz)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_currency IS NULL OR p_at IS NULL THEN NULL::numeric
    WHEN upper(btrim(p_currency)) = 'USD' THEN 1::numeric
    ELSE (
      SELECT r.rate_per_base
      FROM public.fx_rate_snapshots s
      JOIN public.fx_rates r ON r.snapshot_id = s.id
      WHERE r.currency_code = upper(btrim(p_currency))::character(3)
        AND s.base_currency_code = 'USD'
        AND s.status IN ('active', 'superseded')
        AND s.provider_updated_at <= p_at
      ORDER BY s.provider_updated_at DESC, s.fetched_at DESC
      LIMIT 1
    )
  END;
$$;

COMMENT ON FUNCTION public.fx_rate_on(text, timestamptz) IS
  'Issue #4130: units of p_currency per 1 USD from the latest non-rejected snapshot whose provider time is on or before p_at. Ignores expiry (history), never uses a later snapshot, NULL when none. USD is 1.';

CREATE OR REPLACE FUNCTION public.fx_usd_minor_exact(
  p_amount numeric, p_currency text, p_at timestamptz
)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_amount IS NULL OR p_currency IS NULL THEN NULL::numeric
    WHEN upper(btrim(p_currency)) = 'USD' THEN p_amount
    ELSE p_amount
      * power(10::numeric, 2 - COALESCE((
          SELECT c.minor_unit_exponent FROM public.supported_brand_currencies c
          WHERE c.code = upper(btrim(p_currency))::character(3)), 2))
      / NULLIF(public.fx_rate_on(p_currency, p_at), 0)
  END;
$$;

COMMENT ON FUNCTION public.fx_usd_minor_exact(numeric, text, timestamptz) IS
  'Issue #4130: an amount in p_currency minor units as UNROUNDED US cents at the own-moment rate (fx_rate_on). NULL when no rate. Callers round once per currency and day.';

REVOKE ALL ON FUNCTION public.fx_rate_on(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fx_usd_minor_exact(numeric, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_rate_on(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fx_usd_minor_exact(numeric, text, timestamptz) TO service_role;

--------------------------------------------------------------------------------
-- 2. Owes-back settlement (payout_ledger_adjustments stays append-only)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payout_owes_back_settlements (
  adjustment_id uuid PRIMARY KEY
    REFERENCES public.payout_ledger_adjustments(id) ON DELETE RESTRICT,
  settled_at timestamptz NOT NULL DEFAULT now(),
  settled_by uuid NOT NULL,
  reference text NOT NULL
    CHECK (length(btrim(reference)) BETWEEN 3 AND 200),
  reason text NOT NULL
    CHECK (length(btrim(reason)) BETWEEN 3 AND 500)
);

COMMENT ON TABLE public.payout_owes_back_settlements IS
  'Issue #4130: one row per transfer_fee_credit adjustment Mingla has paid back to the host. Written only by admin_settle_owes_back; read only through admin definer RPCs.';

ALTER TABLE public.payout_owes_back_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_owes_back_settlements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.payout_owes_back_settlements TO service_role;

CREATE OR REPLACE FUNCTION public.admin_settle_owes_back(
  p_currency text,
  p_reference text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_currency text := lower(btrim(COALESCE(p_currency, '')));
  v_count int;
  v_cents bigint;
  v_ids jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_currency !~ '^[a-z]{3}$' THEN RAISE EXCEPTION 'currency_required'; END IF;
  IF p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'reference_required';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  WITH open_credits AS (
    SELECT a.id, a.amount_cents
    FROM public.payout_ledger_adjustments a
    WHERE a.kind = 'transfer_fee_credit'
      AND lower(a.currency) = v_currency
      AND NOT EXISTS (
        SELECT 1 FROM public.payout_owes_back_settlements s WHERE s.adjustment_id = a.id
      )
    FOR UPDATE OF a
  ), ins AS (
    INSERT INTO public.payout_owes_back_settlements (adjustment_id, settled_by, reference, reason)
    SELECT id, auth.uid(), btrim(p_reference), btrim(p_reason) FROM open_credits
    ON CONFLICT (adjustment_id) DO NOTHING
    RETURNING adjustment_id
  )
  SELECT count(*)::int,
         COALESCE(sum(o.amount_cents), 0)::bigint,
         COALESCE(jsonb_agg(o.id ORDER BY o.id), '[]'::jsonb)
    INTO v_count, v_cents, v_ids
  FROM ins JOIN open_credits o ON o.id = ins.adjustment_id;

  IF v_count = 0 THEN RAISE EXCEPTION 'nothing_to_settle'; END IF;

  PERFORM public.admin_write_audit(
    'payout.owes_back_settle', 'payout_ledger_adjustment', upper(v_currency), p_reason,
    jsonb_build_object('currency', upper(v_currency), 'settled_count', v_count,
      'settled_cents', v_cents, 'reference', btrim(p_reference), 'adjustment_ids', v_ids));

  RETURN jsonb_build_object('currency', upper(v_currency), 'settled_count', v_count,
    'settled_cents', v_cents);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_settle_owes_back(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_settle_owes_back(text, text, text) TO authenticated;

--------------------------------------------------------------------------------
-- 3. Mingla money summary
--------------------------------------------------------------------------------
-- Every money line, one row per (what, currency, moment, amount). Period kinds
-- are limited to [from, to); host-money "all time" and "held now" kinds are not.
-- Pricing period per sale ("era"): Mingla's fee as a share of the ticket price.
-- The 4.5% pricing (since PR #4044) takes 4.5% of the ticket; older pricing
-- took about 1.5%. 4% splits them with room for rounding on small tickets.
CREATE OR REPLACE FUNCTION public.mingla_money_lines(
  p_from timestamptz, p_to timestamptz
)
RETURNS TABLE (kind text, cur text, era text, at timestamptz, amount numeric, ref uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sale AS (
    SELECT upper(r.currency) AS cur, i.source_finalized_at AS at, i.source_id,
      i.mingla_fee_cents, i.provider_fee_cents, i.disputed_cents,
      CASE
        WHEN COALESCE(o.net_subtotal_cents, i.gross_cents - i.mingla_fee_cents) > 0
         AND i.mingla_fee_cents::numeric
             / COALESCE(o.net_subtotal_cents, i.gross_cents - i.mingla_fee_cents)::numeric >= 0.04
        THEN 'current' ELSE 'older'
      END AS era
    FROM public.payout_release_items i
    JOIN public.brand_payout_releases r ON r.id = i.release_id
    LEFT JOIN public.orders o ON i.source_type = 'order' AND o.id = i.source_id
    WHERE i.source_finalized_at >= p_from AND i.source_finalized_at < p_to
  ), paid_release AS (
    SELECT upper(r.currency) AS cur, r.released_at AS at,
      r.organiser_cash_delivered_cents::numeric AS amount, r.id AS ref
    FROM public.brand_payout_releases r
    WHERE r.status = 'released' AND r.organiser_cash_delivered_cents > 0
    UNION ALL
    -- The older payouts table (Stripe, before the release ledger).
    SELECT upper(p.currency::text), p.created_at, p.amount_cents::numeric, p.id
    FROM public.payouts p
    WHERE p.status = 'paid' AND p.release_id IS NULL AND p.amount_cents > 0
  ), held AS (
    SELECT upper(r.currency) AS cur, r.created_at AS at,
      GREATEST(r.net_release_cents, 0)::numeric AS amount, r.id AS ref,
      public.payout_screen_host_state(r.status, r.error_message, r.releasable_at,
        h.brand_id IS NOT NULL, now()) AS host_state
    FROM public.brand_payout_releases r
    LEFT JOIN public.brand_payout_admin_holds h ON h.brand_id = r.brand_id
    WHERE r.status NOT IN ('released', 'cancelled_event') AND r.net_release_cents > 0
  )
  -- Paid orders that took money (free orders excluded).
  SELECT 'buyers_paid', upper(o.currency::text), NULL::text, COALESCE(o.confirmed_at, o.created_at),
         COALESCE(o.buyer_total_cents, o.total_cents)::numeric, o.id
  FROM public.orders o
  WHERE o.payment_status IN ('paid', 'partial_refund', 'refunded')
    AND o.currency IS NOT NULL
    AND COALESCE(o.payment_method, '') <> 'free'
    AND COALESCE(o.buyer_total_cents, o.total_cents, 0) > 0
    AND COALESCE(o.confirmed_at, o.created_at) >= p_from
    AND COALESCE(o.confirmed_at, o.created_at) < p_to
  UNION ALL
  SELECT 'refunds', upper(o.currency::text), NULL, COALESCE(o.confirmed_at, o.created_at),
         o.refunded_amount_cents::numeric, o.id
  FROM public.orders o
  WHERE COALESCE(o.refunded_amount_cents, 0) > 0
    AND o.currency IS NOT NULL
    AND COALESCE(o.confirmed_at, o.created_at) >= p_from
    AND COALESCE(o.confirmed_at, o.created_at) < p_to
  UNION ALL
  -- Sales in the payout ledger: fee, processing, disputes and profit.
  SELECT k.kind, s.cur, s.era, s.at, k.amount, s.source_id
  FROM sale s
  CROSS JOIN LATERAL (VALUES
    ('fee', s.mingla_fee_cents::numeric),
    ('processing', s.provider_fee_cents::numeric),
    ('disputes', s.disputed_cents::numeric),
    ('profit', (s.mingla_fee_cents - s.provider_fee_cents)::numeric)
  ) AS k(kind, amount)
  WHERE k.amount <> 0 OR k.kind IN ('fee', 'profit')
  UNION ALL
  -- Actual transfer fee and stamp duty Mingla paid on host transfers.
  SELECT k.kind, upper(r.currency), NULL, COALESCE(l.reconciled_at, l.created_at), k.amount, l.id
  FROM public.payout_transfer_legs l
  JOIN public.brand_payout_releases r ON r.id = l.release_id
  CROSS JOIN LATERAL (VALUES
    ('transfer_costs', (COALESCE(l.actual_fee_cents, 0) + COALESCE(l.actual_stamp_duty_cents, 0))::numeric),
    ('profit', -(COALESCE(l.actual_fee_cents, 0) + COALESCE(l.actual_stamp_duty_cents, 0))::numeric)
  ) AS k(kind, amount)
  WHERE l.kind = 'organiser'
    AND COALESCE(l.reconciled_at, l.created_at) >= p_from
    AND COALESCE(l.reconciled_at, l.created_at) < p_to
    AND k.amount <> 0
  UNION ALL
  SELECT 'host_paid_all_time', cur, NULL, at, amount, ref FROM paid_release
  UNION ALL
  SELECT 'host_paid_in_period', cur, NULL, at, amount, ref FROM paid_release
  WHERE at >= p_from AND at < p_to
  UNION ALL
  SELECT 'host_paid_last_24h', cur, NULL, at, amount, ref FROM paid_release
  WHERE at >= now() - interval '24 hours'
  UNION ALL
  -- Host money held now, by the host-facing state the payout screens use.
  SELECT CASE host_state
      WHEN 'waiting_for_bank' THEN 'host_waiting_for_bank'
      WHEN 'late_on_us' THEN 'host_late_on_mingla'
      WHEN 'scheduled' THEN 'host_scheduled'
      WHEN 'sending_today' THEN 'host_scheduled'
      WHEN 'on_its_way' THEN 'host_scheduled'
      ELSE 'host_held_other'
    END, cur, NULL, at, amount, ref
  FROM held WHERE host_state NOT IN ('paid', 'cancelled')
  UNION ALL
  -- Paid sales that never went into a payout (no payout item at all).
  SELECT 'host_never_in_payout', upper(o.currency::text), NULL, COALESCE(o.confirmed_at, o.created_at),
         COALESCE(o.buyer_total_cents, o.total_cents)::numeric, o.id
  FROM public.orders o
  WHERE o.payment_status IN ('paid', 'partial_refund')
    AND o.currency IS NOT NULL
    AND COALESCE(o.payment_method, '') <> 'free'
    AND COALESCE(o.buyer_total_cents, o.total_cents, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.payout_release_items i
      WHERE i.source_type = 'order' AND i.source_id = o.id
    )
  UNION ALL
  -- Transfer fees Mingla held back and has not repaid (settled ones excluded).
  SELECT 'host_owes_back', upper(a.currency), NULL, a.created_at, a.amount_cents::numeric, a.id
  FROM public.payout_ledger_adjustments a
  WHERE a.kind = 'transfer_fee_credit' AND a.amount_cents > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.payout_owes_back_settlements s WHERE s.adjustment_id = a.id
    );
$$;

COMMENT ON FUNCTION public.mingla_money_lines(timestamptz, timestamptz) IS
  'Issue #4130: the money lines behind admin_mingla_money_summary. Source: orders (buyers paid, refunds), payout_release_items (fee, processing, disputes), payout_transfer_legs (actual transfer costs), releases + legacy payouts (host money), unsettled transfer_fee_credit (owes back). Not mingla_revenue_log.';

REVOKE ALL ON FUNCTION public.mingla_money_lines(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mingla_money_lines(timestamptz, timestamptz) TO service_role;

-- Totals per kind and currency: native minor units, and US cents rounded once
-- per currency and UTC day (that day's rate applied to that day's total). A
-- currency with any line lacking a rate has usd_cents NULL, never a partial
-- figure. Currencies are never added together; the page adds usd_cents only.
CREATE OR REPLACE FUNCTION public.admin_mingla_money_summary(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  v_from := COALESCE(p_from, '-infinity'::timestamptz);
  v_to := COALESCE(p_to, now());
  IF v_to < v_from THEN RAISE EXCEPTION 'invalid_period'; END IF;

  WITH ln AS MATERIALIZED (
    SELECT l.*, public.fx_usd_minor_exact(l.amount, l.cur, l.at) AS usd_x,
      public.fx_rate_on(l.cur, l.at) IS NULL AS missing
    FROM public.mingla_money_lines(v_from, v_to) l
  ), day_agg AS (
    SELECT kind, cur, date_trunc('day', at, 'UTC') AS d,
      sum(amount) AS amt, sum(usd_x) AS usd_x, bool_or(missing) AS missing, count(*) AS n
    FROM ln GROUP BY 1, 2, 3
  ), cur_agg AS (
    SELECT kind, cur, sum(amt)::bigint AS cents,
      CASE WHEN bool_or(missing) THEN NULL ELSE sum(round(usd_x))::bigint END AS usd_cents,
      sum(n)::int AS lines
    FROM day_agg GROUP BY 1, 2
  ), era_day AS (
    SELECT kind, cur, era, date_trunc('day', at, 'UTC') AS d,
      sum(amount) AS amt, sum(usd_x) AS usd_x, bool_or(missing) AS missing, count(*) AS n
    FROM ln WHERE era IS NOT NULL GROUP BY 1, 2, 3, 4
  ), era_agg AS (
    SELECT kind, cur, era, sum(amt)::bigint AS cents,
      CASE WHEN bool_or(missing) THEN NULL ELSE sum(round(usd_x))::bigint END AS usd_cents,
      sum(n)::int AS lines
    FROM era_day GROUP BY 1, 2, 3
  ), late AS (
    SELECT r.id, r.releasable_at
    FROM public.brand_payout_releases r
    LEFT JOIN public.brand_payout_admin_holds h ON h.brand_id = r.brand_id
    WHERE r.status NOT IN ('released', 'cancelled_event')
      AND public.payout_screen_host_state(r.status, r.error_message, r.releasable_at,
            h.brand_id IS NOT NULL, now()) = 'late_on_us'
  ), over_fee AS (
    SELECT i.source_id, i.source_finalized_at,
      (COALESCE(o.net_subtotal_cents, i.gross_cents - i.mingla_fee_cents) <= 0
        OR i.mingla_fee_cents::numeric
           / COALESCE(o.net_subtotal_cents, i.gross_cents - i.mingla_fee_cents)::numeric < 0.04) AS older
    FROM public.payout_release_items i
    LEFT JOIN public.orders o ON i.source_type = 'order' AND o.id = i.source_id
    WHERE i.provider_fee_cents > i.mingla_fee_cents
      AND i.source_finalized_at >= v_from AND i.source_finalized_at < v_to
  ), zero_fee_legs AS (
    SELECT l.release_id, l.created_at
    FROM public.payout_transfer_legs l
    WHERE l.kind = 'organiser' AND l.status = 'succeeded'
      AND COALESCE(l.actual_fee_cents, 0) = 0
      AND COALESCE(l.actual_stamp_duty_cents, 0) = 0
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', v_to),
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'kind', kind, 'currency', cur, 'cents', cents, 'usd_cents', usd_cents, 'lines', lines)
        ORDER BY kind, cur) FROM cur_agg), '[]'::jsonb),
    'pricing', jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'kind', kind, 'currency', cur, 'period', era, 'cents', cents,
          'usd_cents', usd_cents, 'lines', lines) ORDER BY era, cur, kind) FROM era_agg), '[]'::jsonb),
      'current_since', COALESCE((SELECT jsonb_object_agg(cur, since) FROM (
          SELECT cur, min(at) AS since FROM ln WHERE kind = 'fee' AND era = 'current'
          GROUP BY cur) q), '{}'::jsonb)),
    -- Weekly: buyers paid and fee per currency, last 26 weeks of the period.
    'weekly', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'week_start', wk, 'currency', cur, 'buyers_paid_cents', paid, 'fee_cents', fee)
        ORDER BY wk, cur) FROM (
        SELECT date_trunc('week', at, 'UTC') AS wk, cur,
          COALESCE(sum(amount) FILTER (WHERE kind = 'buyers_paid'), 0)::bigint AS paid,
          COALESCE(sum(amount) FILTER (WHERE kind = 'fee'), 0)::bigint AS fee
        FROM ln
        WHERE kind IN ('buyers_paid', 'fee')
          AND at >= GREATEST(v_from, date_trunc('week', v_to, 'UTC') - interval '25 weeks')
        GROUP BY 1, 2) w), '[]'::jsonb),
    -- Needs a look: counts and the first 200 ids per exception.
    'exceptions', jsonb_build_object(
      'never_in_payout', (SELECT jsonb_build_object('count', count(*),
          'ids', COALESCE((array_agg(ref ORDER BY at))[1:200], '{}'::uuid[]),
          'by_currency', COALESCE((SELECT jsonb_object_agg(cur, c) FROM (
            SELECT cur, sum(amount)::bigint AS c FROM ln
            WHERE kind = 'host_never_in_payout' GROUP BY cur) z), '{}'::jsonb),
          'first_at', min(at), 'last_at', max(at))
        FROM ln WHERE kind = 'host_never_in_payout'),
      'late_on_mingla', (SELECT jsonb_build_object('count', count(*),
          'ids', COALESCE((array_agg(id ORDER BY releasable_at))[1:200], '{}'::uuid[]),
          'oldest_due_at', min(releasable_at)) FROM late),
      'processing_over_fee', (SELECT jsonb_build_object('count', count(*),
          'ids', COALESCE((array_agg(source_id ORDER BY source_finalized_at))[1:200], '{}'::uuid[]),
          'older_pricing_count', count(*) FILTER (WHERE older)) FROM over_fee),
      'transfer_fee_not_recorded', (SELECT jsonb_build_object('count', count(*),
          'ids', COALESCE((array_agg(release_id ORDER BY created_at))[1:200], '{}'::uuid[]))
        FROM zero_fee_legs),
      'owes_back_open', (SELECT jsonb_build_object('count', count(*),
          'ids', COALESCE((array_agg(ref ORDER BY at))[1:200], '{}'::uuid[]))
        FROM ln WHERE kind = 'host_owes_back')),
    -- No money table records live vs test today; the page says so.
    'live_test_recorded', false,
    'generated_at', now()
  ) INTO v_out;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.admin_mingla_money_summary(timestamptz, timestamptz) IS
  'Issue #4130: Mingla money by currency (never summed across currencies) with USD at each line''s own-day rate, rounded per currency and day. Lines from mingla_money_lines; not mingla_revenue_log.';

REVOKE ALL ON FUNCTION public.admin_mingla_money_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mingla_money_summary(timestamptz, timestamptz) TO authenticated;

--------------------------------------------------------------------------------
-- 4. Payments: per-brand readiness facts (Stripe AND Paystack)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_brand_payment_readiness(
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  WITH base AS (
    SELECT
      b.id AS brand_id, b.name AS brand_name, b.slug AS brand_slug,
      b.payment_provider, b.payment_country, upper(b.default_currency) AS default_currency,
      b.stripe_connect_id, b.paystack_subaccount_code,
      sca.id IS NOT NULL AS has_stripe_account,
      COALESCE(sca.charges_enabled, false) AS stripe_charges_enabled,
      COALESCE(sca.payouts_enabled, false) AS stripe_payouts_enabled,
      sca.detached_at IS NOT NULL AS stripe_detached,
      NULLIF(sca.requirements->>'disabled_reason', '') AS stripe_disabled_reason,
      CASE WHEN jsonb_typeof(sca.requirements->'past_due') = 'array'
        THEN jsonb_array_length(sca.requirements->'past_due') ELSE 0 END AS stripe_past_due_count,
      CASE WHEN jsonb_typeof(sca.requirements->'currently_due') = 'array'
        THEN jsonb_array_length(sca.requirements->'currently_due') ELSE 0 END AS stripe_currently_due_count,
      ext.bank_last4 AS stripe_bank_last4,
      COALESCE(ext.bank_verified, false) AS stripe_bank_verified,
      rcp.recipient_code AS paystack_recipient_code,
      rcp.account_number_masked AS paystack_bank_mask,
      rcp.recipient_code IS NOT NULL AS paystack_recipient_active,
      COALESCE(paid.by_currency, '{}'::jsonb) AS paid_out_by_currency,
      COALESCE(held.by_currency, '{}'::jsonb) AS held_by_currency,
      COALESCE(held.states, '{}'::jsonb) AS held_states,
      COALESCE(held.blocked_balance, false) AS blocked_on_mingla_balance,
      EXISTS (
        SELECT 1 FROM public.orders o JOIN public.events e ON e.id = o.event_id
        WHERE e.brand_id = b.id AND o.payment_status IN ('paid', 'partial_refund')
          AND COALESCE(o.buyer_total_cents, o.total_cents, 0) > 0
      ) AS has_paid_sales
    FROM public.brands b
    LEFT JOIN public.stripe_connect_accounts sca ON sca.brand_id = b.id
    LEFT JOIN LATERAL (
      SELECT ea.last4 AS bank_last4, (ea.status = 'verified') AS bank_verified
      FROM public.stripe_external_accounts ea
      WHERE ea.brand_id = b.id AND ea.status <> 'removed'
      ORDER BY ea.default_for_currency DESC NULLS LAST, ea.updated_at DESC NULLS LAST
      LIMIT 1
    ) ext ON true
    LEFT JOIN LATERAL (
      SELECT pr.recipient_code, pr.account_number_masked
      FROM public.brand_paystack_recipients pr
      WHERE pr.brand_id = b.id AND pr.is_active
      ORDER BY pr.updated_at DESC
      LIMIT 1
    ) rcp ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(cur, cents) AS by_currency FROM (
        SELECT upper(x.cur) AS cur, sum(x.cents)::bigint AS cents FROM (
          SELECT r.currency AS cur, r.organiser_cash_delivered_cents AS cents
          FROM public.brand_payout_releases r
          WHERE r.brand_id = b.id AND r.status = 'released'
          UNION ALL
          SELECT p.currency::text, p.amount_cents
          FROM public.payouts p
          WHERE p.brand_id = b.id AND p.status = 'paid' AND p.release_id IS NULL
        ) x GROUP BY 1
      ) y
    ) paid ON true
    LEFT JOIN LATERAL (
      WITH q AS (
        SELECT r.currency, r.net_release_cents, r.status,
          public.payout_screen_host_state(r.status, r.error_message, r.releasable_at,
            EXISTS (SELECT 1 FROM public.brand_payout_admin_holds h WHERE h.brand_id = r.brand_id),
            now()) AS host_state
        FROM public.brand_payout_releases r
        WHERE r.brand_id = b.id AND r.status NOT IN ('released', 'cancelled_event')
          AND r.net_release_cents > 0
      )
      SELECT
        (SELECT jsonb_object_agg(cur, cents) FROM (
          SELECT upper(q.currency) AS cur, sum(GREATEST(q.net_release_cents, 0))::bigint AS cents
          FROM q GROUP BY 1) z) AS by_currency,
        (SELECT jsonb_object_agg(host_state, n) FROM (
          SELECT q.host_state, count(*)::int AS n FROM q GROUP BY 1) z) AS states,
        (SELECT bool_or(q.status = 'blocked_balance') FROM q) AS blocked_balance
    ) held ON true
    WHERE b.deleted_at IS NULL
      AND (b.stripe_connect_id IS NOT NULL OR b.paystack_subaccount_code IS NOT NULL
           OR sca.id IS NOT NULL OR rcp.recipient_code IS NOT NULL
           OR b.payment_provider = 'paystack')
  ), filtered AS (
    SELECT * FROM base
    WHERE p_search IS NULL OR btrim(p_search) = ''
       OR brand_name ILIKE '%' || btrim(p_search) || '%'
       OR brand_slug ILIKE '%' || btrim(p_search) || '%'
       OR stripe_connect_id ILIKE '%' || btrim(p_search) || '%'
       OR paystack_subaccount_code ILIKE '%' || btrim(p_search) || '%'
       OR paystack_recipient_code ILIKE '%' || btrim(p_search) || '%'
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.brand_name), '[]'::jsonb), count(*)::int
    INTO v_rows, v_total
  FROM (SELECT * FROM filtered ORDER BY brand_name LIMIT 2000) f;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

COMMENT ON FUNCTION public.admin_list_brand_payment_readiness(text) IS
  'Issue #4130: payment-readiness FACTS for every live brand with any payment setup or the Paystack provider (Stripe Connect, Stripe bank, Paystack recipient, paid out to date, held now). The verdict is derived in mingla-admin/src/lib/paymentReadiness.js. Capped at 2000 rows.';

REVOKE ALL ON FUNCTION public.admin_list_brand_payment_readiness(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_brand_payment_readiness(text) TO authenticated;

--------------------------------------------------------------------------------
-- 5. Orders: money columns, host-paid state, real filters
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_orders(
  p_search text DEFAULT NULL, p_status_filter text DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL, p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT o.id AS order_id, o.created_at, o.buyer_name, o.buyer_email, o.buyer_phone,
      o.buyer_user_id, o.event_id, e.title AS event_title, e.event_type,
      e.brand_id, b.name AS brand_name, b.payment_provider AS provider,
      o.total_cents, upper(o.currency::text) AS currency, o.payment_method, o.payment_status,
      o.stripe_payment_intent_id, o.stripe_charge_id, o.refunded_amount_cents,
      o.is_door_sale, o.at_risk, o.installment_plan_root, o.source,
      o.discount_cents,
      (COALESCE(o.payment_method, '') = 'free'
        OR COALESCE(o.buyer_total_cents, o.total_cents, 0) = 0) AS is_free,
      COALESCE(o.net_subtotal_cents, o.total_cents) AS ticket_cents,
      COALESCE(o.buyer_total_cents, o.total_cents) AS buyer_paid_cents,
      COALESCE(it.mingla_fee_cents, o.stripe_application_fee_amount_cents) AS mingla_fee_cents,
      it.provider_fee_cents AS processing_cents,
      it.host_state AS payout_state,
      it.release_id
    FROM public.orders o
    LEFT JOIN public.events e ON e.id = o.event_id
    LEFT JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN LATERAL (
      SELECT i.mingla_fee_cents, i.provider_fee_cents, r.id AS release_id,
        public.payout_screen_host_state(r.status, r.error_message, r.releasable_at,
          EXISTS (SELECT 1 FROM public.brand_payout_admin_holds h WHERE h.brand_id = r.brand_id),
          now()) AS host_state
      FROM public.payout_release_items i
      JOIN public.brand_payout_releases r ON r.id = i.release_id
      WHERE i.source_type = 'order' AND i.source_id = o.id
      ORDER BY i.attached_at DESC
      LIMIT 1
    ) it ON true
  ), classified AS (
    SELECT base.*,
      CASE
        WHEN is_free THEN 'free'
        WHEN payment_status NOT IN ('paid', 'partial_refund') THEN 'not_applicable'
        WHEN release_id IS NULL THEN 'not_in_payout'
        WHEN payout_state = 'paid' THEN 'paid_out'
        WHEN payout_state = 'late_on_us' THEN 'late'
        WHEN payout_state = 'waiting_for_bank' THEN 'waiting_for_bank'
        WHEN payout_state IN ('needs_you', 'couldnt_send', 'paused') THEN 'held'
        WHEN payout_state = 'cancelled' THEN 'not_applicable'
        ELSE 'in_payout'
      END AS host_paid
    FROM base
  ), filtered AS (
    SELECT * FROM classified
    WHERE (p_search IS NULL OR btrim(p_search) = ''
           OR buyer_email ILIKE '%'||btrim(p_search)||'%' OR buyer_phone ILIKE '%'||btrim(p_search)||'%'
           OR buyer_name ILIKE '%'||btrim(p_search)||'%'
           OR event_title ILIKE '%'||btrim(p_search)||'%'
           OR brand_name ILIKE '%'||btrim(p_search)||'%'
           OR stripe_payment_intent_id ILIKE '%'||btrim(p_search)||'%'
           OR stripe_charge_id ILIKE '%'||btrim(p_search)||'%'
           OR order_id::text = btrim(p_search))
      AND (p_status_filter IS NULL
           OR (p_status_filter = 'free' AND is_free)
           OR (p_status_filter = 'host_not_paid'
               AND host_paid IN ('not_in_payout', 'late', 'waiting_for_bank', 'held'))
           OR (p_status_filter = 'paid' AND payment_status = 'paid' AND NOT is_free)
           OR (p_status_filter NOT IN ('free', 'host_not_paid', 'paid')
               AND payment_status = p_status_filter))
      AND (p_brand_id IS NULL OR brand_id = p_brand_id)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
    INTO v_rows, v_total
    FROM (SELECT * FROM filtered ORDER BY created_at DESC
          LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) f;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_orders(text,text,uuid,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_orders(text,text,uuid,int,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_orders_overview(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  v_from := COALESCE(p_from, now() - interval '30 days');
  v_to := COALESCE(p_to, now());

  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    -- All time: paid orders that took money, per currency; free orders counted.
    'paid_all_time', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', cur, 'orders', n, 'buyer_paid_cents', cents) ORDER BY cur)
      FROM (
        SELECT upper(o.currency::text) AS cur, count(*)::int AS n,
          sum(COALESCE(o.buyer_total_cents, o.total_cents))::bigint AS cents
        FROM public.orders o
        WHERE o.payment_status IN ('paid', 'partial_refund')
          AND COALESCE(o.payment_method, '') <> 'free'
          AND COALESCE(o.buyer_total_cents, o.total_cents, 0) > 0
          AND o.currency IS NOT NULL
        GROUP BY 1
      ) q), '[]'::jsonb),
    'free_orders_all_time', (
      SELECT count(*)::int FROM public.orders o
      WHERE o.payment_status IN ('paid', 'partial_refund')
        AND (COALESCE(o.payment_method, '') = 'free' OR COALESCE(o.buyer_total_cents, o.total_cents, 0) = 0)),
    -- Discounts: discounted orders ONLY, in the period.
    'discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', cur, 'orders', n, 'discount_cents', cents) ORDER BY cur)
      FROM (
        SELECT upper(o.currency::text) AS cur, count(*)::int AS n, sum(o.discount_cents)::bigint AS cents
        FROM public.orders o
        WHERE COALESCE(o.discount_cents, 0) > 0 AND o.currency IS NOT NULL
          AND o.payment_status IN ('paid', 'partial_refund', 'refunded')
          AND o.created_at >= v_from AND o.created_at < v_to
        GROUP BY 1
      ) q), '[]'::jsonb),
    -- Margin: Mingla fee minus processing on every sale in the period, from
    -- the payout ledger; below_zero counts sales where processing > fee.
    'margin', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', cur, 'sales', n, 'fee_cents', fee,
          'processing_cents', proc, 'margin_cents', fee - proc, 'below_zero', below) ORDER BY cur)
      FROM (
        SELECT upper(r.currency) AS cur, count(*)::int AS n,
          sum(i.mingla_fee_cents)::bigint AS fee, sum(i.provider_fee_cents)::bigint AS proc,
          count(*) FILTER (WHERE i.provider_fee_cents > i.mingla_fee_cents)::int AS below
        FROM public.payout_release_items i
        JOIN public.brand_payout_releases r ON r.id = i.release_id
        WHERE i.source_finalized_at >= v_from AND i.source_finalized_at < v_to
        GROUP BY 1
      ) q), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_orders_overview(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_orders_overview(timestamptz, timestamptz) TO authenticated;

--------------------------------------------------------------------------------
-- 6. Payouts list: ticket price per payout; owes-back excludes settled
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_payouts(
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_rows jsonb; v_total int; v_summary jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  WITH base AS (
    SELECT
      r.id, r.brand_id, b.name AS brand_name, r.provider, r.currency,
      r.gross_cents, r.refunded_cents, r.disputed_cents, r.mingla_fee_cents,
      r.partner_share_cents, r.permanent_debt_withheld_cents,
      r.temporary_debt_withheld_cents, r.maturity_recredit_cents,
      r.net_release_cents AS host_gets_cents,
      r.organiser_cash_delivered_cents AS sent_to_bank_cents,
      r.releasable_at AS due_at, r.released_at, r.created_at,
      public.payout_screen_host_state(
        r.status, r.error_message, r.releasable_at,
        h.brand_id IS NOT NULL, now()
      ) AS status,
      CASE
        WHEN h.brand_id IS NOT NULL THEN 'Payouts are paused by Mingla.'
        WHEN r.status = 'blocked_kyc' THEN 'The host must finish payout verification.'
        WHEN r.status = 'pending' AND lower(COALESCE(r.error_message, '')) ~
          '(waiting_for_bank|bank|recipient|external.account|destination)'
          THEN 'Sold before a verified bank destination was available. The host needs to add or fix a bank.'
        WHEN r.status = 'blocked_balance' THEN 'The connected balance is short. Mingla must cover the shortfall before sending.'
        WHEN r.status = 'blocked_otp' THEN 'Paystack needs an OTP before the transfer can be sent.'
        WHEN r.status = 'blocked_over_cap' THEN 'This transfer is above the provider limit and needs an operations review.'
        WHEN r.status = 'fee_unreconciled' THEN 'The bank fee has not reconciled yet.'
        WHEN r.status = 'blocked_anchor' THEN 'The payout schedule needs an operations review.'
        WHEN r.status = 'failed' THEN 'The provider could not send this payout.'
        WHEN r.releasable_at + interval '8 hours' <= now()
          AND r.status NOT IN ('released','in_flight','failed','cancelled_event')
          THEN 'Mingla missed the promised send time by more than eight hours.'
        ELSE NULL
      END AS why,
      COALESCE(credits.owed_cents, 0) AS transfer_fee_credit_owed_cents,
      COALESCE(credits.settled_cents, 0) AS transfer_fee_credit_settled_cents,
      COALESCE(items.sales_count, 0) AS sales_count,
      -- #4130: the ticket price the fee is a share of: each order's own
      -- ticket subtotal, and buyer-paid minus fee for non-order sales.
      COALESCE(items.ticket_cents, r.gross_cents - r.mingla_fee_cents) AS ticket_cents,
      COALESCE(leg_fees.transfer_fee_cents, 0) AS transfer_fee_cents,
      COALESCE(leg_fees.stamp_duty_cents, 0) AS stamp_duty_cents,
      CASE
        WHEN COALESCE(items.ticket_cents, r.gross_cents - r.mingla_fee_cents) > 0
          AND r.mingla_fee_cents::numeric
              / COALESCE(items.ticket_cents, r.gross_cents - r.mingla_fee_cents)::numeric < 0.04
          THEN true
        WHEN COALESCE(items.ticket_cents, r.gross_cents - r.mingla_fee_cents) > 0 THEN false
        ELSE false
      END AS older_pricing,
      -- #4130: each sale is judged on its own; a payout holding both kinds
      -- is 'mixed', never labelled older from its blended share.
      CASE
        WHEN COALESCE(items.older_items, 0) > 0 AND COALESCE(items.current_items, 0) > 0 THEN 'mixed'
        WHEN COALESCE(items.older_items, 0) > 0 THEN 'older'
        WHEN COALESCE(items.current_items, 0) > 0 THEN 'current'
        ELSE NULL
      END AS pricing
    FROM public.brand_payout_releases r
    JOIN public.brands b ON b.id = r.brand_id
    LEFT JOIN public.brand_payout_admin_holds h ON h.brand_id = r.brand_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(sum(a.amount_cents) FILTER (WHERE s.adjustment_id IS NULL), 0)::bigint AS owed_cents,
        COALESCE(sum(a.amount_cents) FILTER (WHERE s.adjustment_id IS NOT NULL), 0)::bigint AS settled_cents
      FROM public.payout_ledger_adjustments a
      LEFT JOIN public.payout_owes_back_settlements s ON s.adjustment_id = a.id
      WHERE a.release_id = r.id AND a.kind = 'transfer_fee_credit'
    ) credits ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS sales_count,
        sum(COALESCE(o.net_subtotal_cents, i.gross_cents - i.mingla_fee_cents))::bigint AS ticket_cents,
        count(*) FILTER (WHERE COALESCE(o.net_subtotal_cents, i.gross_cents - i.mingla_fee_cents) > 0
          AND i.mingla_fee_cents::numeric / COALESCE(o.net_subtotal_cents, i.gross_cents - i.mingla_fee_cents)::numeric < 0.04)::int AS older_items,
        count(*) FILTER (WHERE COALESCE(o.net_subtotal_cents, i.gross_cents - i.mingla_fee_cents) > 0
          AND i.mingla_fee_cents::numeric / COALESCE(o.net_subtotal_cents, i.gross_cents - i.mingla_fee_cents)::numeric >= 0.04)::int AS current_items
      FROM public.payout_release_items i
      LEFT JOIN public.orders o ON i.source_type = 'order' AND o.id = i.source_id
      WHERE i.release_id = r.id
    ) items ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(sum(l.estimated_fee_cents), 0)::bigint AS transfer_fee_cents,
        COALESCE(sum(l.stamp_duty_cents), 0)::bigint AS stamp_duty_cents
      FROM public.payout_transfer_legs l
      WHERE l.release_id = r.id AND l.kind = 'organiser'
    ) leg_fees ON true
  ), filtered AS (
    SELECT * FROM base
    WHERE (p_search IS NULL OR brand_name ILIKE '%' || p_search || '%'
      OR id::text ILIKE '%' || p_search || '%' OR provider ILIKE '%' || p_search || '%')
      AND (p_status_filter IS NULL OR status = p_status_filter)
      AND (p_brand_id IS NULL OR brand_id = p_brand_id)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY
      CASE f.status WHEN 'late_on_us' THEN 0 WHEN 'needs_you' THEN 1
        WHEN 'waiting_for_bank' THEN 2 ELSE 3 END,
      f.due_at), '[]'::jsonb),
    (SELECT count(*) FROM filtered)
  INTO v_rows, v_total
  FROM (SELECT * FROM filtered
    ORDER BY CASE status WHEN 'late_on_us' THEN 0 WHEN 'needs_you' THEN 1
      WHEN 'waiting_for_bank' THEN 2 ELSE 3 END, due_at
    LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0)) f;

  WITH classified AS (
    SELECT r.*,
      public.payout_screen_host_state(r.status, r.error_message, r.releasable_at,
        h.brand_id IS NOT NULL, now()) AS host_state
    FROM public.brand_payout_releases r
    LEFT JOIN public.brand_payout_admin_holds h ON h.brand_id = r.brand_id
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT count(*) FROM classified),
    'count_by_state', COALESCE((SELECT jsonb_object_agg(host_state, row_count)
      FROM (SELECT host_state, count(*)::int AS row_count
        FROM classified GROUP BY host_state) q), '{}'::jsonb),
    'due_next_24h_by_currency', COALESCE((SELECT jsonb_object_agg(currency, cents)
      FROM (SELECT currency, sum(net_release_cents)::bigint AS cents
        FROM classified WHERE releasable_at BETWEEN now() AND now() + interval '24 hours'
          AND status NOT IN ('released','failed','cancelled_event') GROUP BY currency) q), '{}'::jsonb),
    'late_count', (SELECT count(*) FROM classified WHERE host_state = 'late_on_us'),
    'late_by_currency', COALESCE((SELECT jsonb_object_agg(currency, cents)
      FROM (SELECT currency, sum(GREATEST(net_release_cents, 0))::bigint AS cents
        FROM classified WHERE host_state = 'late_on_us' GROUP BY currency) q), '{}'::jsonb),
    'oldest_late_due_at', (SELECT min(releasable_at) FROM classified WHERE host_state = 'late_on_us'),
    'waiting_for_bank_count', (SELECT count(*) FROM classified WHERE host_state = 'waiting_for_bank'),
    'waiting_for_bank_by_currency', COALESCE((SELECT jsonb_object_agg(currency, cents)
      FROM (SELECT currency, sum(GREATEST(net_release_cents, 0))::bigint AS cents
        FROM classified WHERE host_state = 'waiting_for_bank' GROUP BY currency) q), '{}'::jsonb),
    'paid_last_24h_by_currency', COALESCE((SELECT jsonb_object_agg(currency, cents)
      FROM (SELECT currency, sum(organiser_cash_delivered_cents)::bigint AS cents
        FROM classified WHERE status = 'released' AND released_at >= now() - interval '24 hours'
        GROUP BY currency) q), '{}'::jsonb),
    'paid_last_24h_count', (SELECT count(*) FROM classified
      WHERE status = 'released' AND released_at >= now() - interval '24 hours'),
    -- #4130: credits marked settled no longer count as owed.
    'transfer_fee_credits_owed_by_currency', COALESCE((SELECT jsonb_object_agg(currency, cents)
      FROM (SELECT a.currency, sum(a.amount_cents)::bigint AS cents
        FROM public.payout_ledger_adjustments a
        WHERE a.kind = 'transfer_fee_credit'
          AND NOT EXISTS (SELECT 1 FROM public.payout_owes_back_settlements s
                          WHERE s.adjustment_id = a.id)
        GROUP BY a.currency) q), '{}'::jsonb)
  ) INTO v_summary;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'summary', v_summary);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_payouts(text,text,uuid,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_payouts(text,text,uuid,int,int) TO authenticated;

--------------------------------------------------------------------------------
-- Apply-time self-check: nothing here is callable by anon; the FX helpers are
-- not callable by signed-in users directly.
--------------------------------------------------------------------------------
DO $$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_mingla_money_summary(timestamptz,timestamptz)',
    'public.admin_settle_owes_back(text,text,text)',
    'public.admin_list_brand_payment_readiness(text)',
    'public.admin_list_orders(text,text,uuid,int,int)',
    'public.admin_orders_overview(timestamptz,timestamptz)',
    'public.admin_list_payouts(text,text,uuid,int,int)',
    'public.fx_rate_on(text,timestamptz)',
    'public.fx_usd_minor_exact(numeric,text,timestamptz)',
    'public.mingla_money_lines(timestamptz,timestamptz)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue_4130: anon can execute %', v_fn;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.fx_rate_on(text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fx_usd_minor_exact(numeric,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mingla_money_lines(timestamptz,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_4130: internal money helpers must not be callable by signed-in users';
  END IF;
END $$;

COMMIT;

-- Issue #3645 — payout-screen read model.
--
-- Display only. This migration does not mutate payout rows, release money,
-- schedule work, or call Stripe / Paystack. It gives the Business and Admin
-- clients one server-owned vocabulary for the host-facing payout state and
-- one reconciled read bundle built from the existing ledger.

BEGIN;

-- INV-3645-PAYOUT-SCREEN-STATE: clients render this result verbatim and never
-- infer payout state from provider/error strings. `late_on_us` begins only
-- after the promised due time has been missed by eight hours.
CREATE OR REPLACE FUNCTION public.payout_screen_host_state(
  p_status text,
  p_error_message text,
  p_releasable_at timestamptz,
  p_paused boolean,
  p_as_of timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_status = 'released' THEN 'paid'
    WHEN p_status = 'in_flight' THEN 'on_its_way'
    WHEN p_status = 'cancelled_event' THEN 'cancelled'
    WHEN p_paused THEN 'paused'
    WHEN p_status = 'blocked_kyc' THEN 'needs_you'
    WHEN p_status = 'failed' THEN 'couldnt_send'
    WHEN p_status = 'pending' AND lower(COALESCE(p_error_message, '')) ~
      '(waiting_for_bank|bank|recipient|external.account|destination)' THEN 'waiting_for_bank'
    WHEN p_releasable_at > p_as_of THEN 'scheduled'
    WHEN p_releasable_at + interval '8 hours' <= p_as_of THEN 'late_on_us'
    ELSE 'sending_today'
  END;
$fn$;

COMMENT ON FUNCTION public.payout_screen_host_state(text,text,timestamptz,boolean,timestamptz) IS
  'Issue #3645: canonical host-facing payout state. Late begins at due+8h. Server-side error classification prevents clients from parsing provider errors.';

REVOKE ALL ON FUNCTION public.payout_screen_host_state(text,text,timestamptz,boolean,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_screen_host_state(text,text,timestamptz,boolean,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.brand_get_payout_screen(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_paused boolean;
  v_currency text;
  v_releases jsonb;
  v_sales_week bigint;
  v_coming bigint;
  v_paid_month bigint;
BEGIN
  IF auth.uid() IS NULL OR p_brand_id IS NULL
     OR NOT public.biz_can_view_payments_for_brand(p_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'insufficient_finance_permission' USING ERRCODE = '42501';
  END IF;

  v_paused := EXISTS (
    SELECT 1 FROM public.brand_payout_admin_holds h WHERE h.brand_id = p_brand_id
  );

  SELECT r.currency INTO v_currency
  FROM public.brand_payout_releases r
  WHERE r.brand_id = p_brand_id
    AND r.status NOT IN ('cancelled_event', 'failed')
  ORDER BY r.created_at DESC, r.id
  LIMIT 1;

  IF v_currency IS NULL THEN
    SELECT lower(b.default_currency) INTO v_currency
    FROM public.brands b WHERE b.id = p_brand_id;
  END IF;

  WITH rows AS (
    SELECT
      r.*,
      public.payout_screen_host_state(
        r.status, r.error_message, r.releasable_at, v_paused, now()
      ) AS host_state,
      COALESCE(e.title, CASE r.surface
        WHEN 'rsvp_contribution' THEN 'Chip-ins'
        WHEN 'venue_reservation' THEN 'Bookings'
        ELSE 'Ticket sales'
      END) AS offering_name,
      COALESCE(items.sales_count, 0) AS sales_count,
      items.last_sale_at,
      COALESCE(items.items, '[]'::jsonb) AS items,
      COALESCE(credits.transfer_fee_credit_cents, 0) AS transfer_fee_credit_cents,
      COALESCE(leg_fees.transfer_fee_cents, 0) AS transfer_fee_cents,
      COALESCE(leg_fees.stamp_duty_cents, 0) AS stamp_duty_cents,
      CASE
        WHEN r.provider = 'paystack' THEN recipient.account_number_masked
        ELSE stripe_bank.bank_mask
      END AS bank_mask
    FROM public.brand_payout_releases r
    LEFT JOIN public.events e ON e.id = r.event_id
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS sales_count,
        max(i.source_finalized_at) AS last_sale_at,
        jsonb_agg(jsonb_build_object(
          'source_type', i.source_type,
          'source_id', i.source_id,
          'gross_cents', i.gross_cents,
          'refunded_cents', i.refunded_cents,
          'disputed_cents', i.disputed_cents,
          'mingla_fee_cents', i.mingla_fee_cents,
          'net_cents', i.net_cents,
          'paid_at', i.source_finalized_at
        ) ORDER BY i.source_finalized_at DESC, i.id) AS items
      FROM public.payout_release_items i WHERE i.release_id = r.id
    ) items ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(a.amount_cents), 0)::bigint AS transfer_fee_credit_cents
      FROM public.payout_ledger_adjustments a
      WHERE a.release_id = r.id AND a.kind = 'transfer_fee_credit'
    ) credits ON true
    LEFT JOIN LATERAL (
      -- Host cash is planned after the estimated transfer costs. Any provider
      -- over-estimate is a separate append-only credit that Mingla still owes;
      -- replacing the deduction with a later actual zero would make the stored
      -- cash waterfall stop adding up.
      SELECT
        COALESCE(sum(l.estimated_fee_cents), 0)::bigint AS transfer_fee_cents,
        COALESCE(sum(l.stamp_duty_cents), 0)::bigint AS stamp_duty_cents
      FROM public.payout_transfer_legs l
      WHERE l.release_id = r.id AND l.kind = 'organiser'
    ) leg_fees ON true
    LEFT JOIN LATERAL (
      SELECT pr.account_number_masked
      FROM public.brand_paystack_recipients pr
      WHERE pr.brand_id = r.brand_id AND pr.is_active
      LIMIT 1
    ) recipient ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN ea.last4 IS NULL THEN NULL ELSE '••••' || ea.last4 END AS bank_mask
      FROM public.stripe_external_accounts ea
      WHERE ea.brand_id = r.brand_id
        AND ea.status <> 'removed'
      ORDER BY ea.default_for_currency DESC, ea.updated_at DESC
      LIMIT 1
    ) stripe_bank ON true
    WHERE r.brand_id = p_brand_id
      AND (v_currency IS NULL OR r.currency = v_currency)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'event_id', event_id,
    'offering_name', offering_name,
    'provider', provider,
    'currency', currency,
    'ledger_status', status,
    'host_state', host_state,
    'due_at', releasable_at,
    'released_at', released_at,
    'gross_cents', gross_cents,
    'refunded_cents', refunded_cents,
    'disputed_cents', disputed_cents,
    'mingla_fee_cents', mingla_fee_cents,
    'partner_share_cents', partner_share_cents,
    'permanent_debt_withheld_cents', permanent_debt_withheld_cents,
    'temporary_debt_withheld_cents', temporary_debt_withheld_cents,
    'maturity_recredit_cents', maturity_recredit_cents,
    'net_release_cents', net_release_cents,
    'cash_to_bank_cents', organiser_cash_delivered_cents,
    'transfer_fee_credit_cents', transfer_fee_credit_cents,
    'transfer_fee_cents', transfer_fee_cents,
    'stamp_duty_cents', stamp_duty_cents,
    'sales_count', sales_count,
    'last_sale_at', last_sale_at,
    'bank_mask', bank_mask,
    'older_pricing', gross_cents > 0
      AND mingla_fee_cents::numeric / gross_cents::numeric < 0.03,
    'items', items
  ) ORDER BY releasable_at DESC, id), '[]'::jsonb)
  INTO v_releases
  FROM rows;

  SELECT COALESCE(sum(i.gross_cents), 0)::bigint
    INTO v_sales_week
  FROM public.payout_release_items i
  JOIN public.brand_payout_releases r ON r.id = i.release_id
  WHERE r.brand_id = p_brand_id
    AND (v_currency IS NULL OR r.currency = v_currency)
    AND i.source_finalized_at >= date_trunc('week', now());

  SELECT
    COALESCE(sum(CASE WHEN r.status <> 'released'
      AND r.status <> 'cancelled_event'
      THEN greatest(r.net_release_cents, 0)
      ELSE 0 END), 0)::bigint,
    COALESCE(sum(CASE WHEN r.status = 'released'
      AND r.released_at >= date_trunc('month', now())
      THEN r.organiser_cash_delivered_cents ELSE 0 END), 0)::bigint
    INTO v_coming, v_paid_month
  FROM public.brand_payout_releases r
  WHERE r.brand_id = p_brand_id
    AND (v_currency IS NULL OR r.currency = v_currency);

  RETURN jsonb_build_object(
    'currency', v_currency,
    'payouts_paused', v_paused,
    'sales_this_week_cents', v_sales_week,
    'coming_to_you_cents', v_coming,
    'paid_this_month_cents', v_paid_month,
    'releases', v_releases
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.brand_get_payout_screen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_get_payout_screen(uuid) TO authenticated;
COMMENT ON FUNCTION public.brand_get_payout_screen(uuid) IS
  'Issue #3645: read-only organiser payout screen bundle. Stored cents only; provider processing cost is intentionally not a host deduction.';

-- Replace the legacy Stripe-only `payouts` list with the unified ledger. The
-- shape deliberately exposes the host state and a sanitised why, not raw
-- provider errors.
CREATE OR REPLACE FUNCTION public.admin_list_payouts(
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
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
      COALESCE(items.sales_count, 0) AS sales_count,
      COALESCE(leg_fees.transfer_fee_cents, 0) AS transfer_fee_cents,
      COALESCE(leg_fees.stamp_duty_cents, 0) AS stamp_duty_cents,
      CASE WHEN r.gross_cents > 0
        AND r.mingla_fee_cents::numeric / r.gross_cents::numeric < 0.03
        THEN true ELSE false END AS older_pricing
    FROM public.brand_payout_releases r
    JOIN public.brands b ON b.id = r.brand_id
    LEFT JOIN public.brand_payout_admin_holds h ON h.brand_id = r.brand_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(a.amount_cents), 0)::bigint AS owed_cents
      FROM public.payout_ledger_adjustments a
      WHERE a.release_id = r.id AND a.kind = 'transfer_fee_credit'
    ) credits ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS sales_count
      FROM public.payout_release_items i
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
    'oldest_late_due_at', (SELECT min(releasable_at) FROM classified WHERE host_state = 'late_on_us'),
    'waiting_for_bank_count', (SELECT count(*) FROM classified WHERE host_state = 'waiting_for_bank'),
    'paid_last_24h_by_currency', COALESCE((SELECT jsonb_object_agg(currency, cents)
      FROM (SELECT currency, sum(organiser_cash_delivered_cents)::bigint AS cents
        FROM classified WHERE status = 'released' AND released_at >= now() - interval '24 hours'
        GROUP BY currency) q), '{}'::jsonb),
    'transfer_fee_credits_owed_by_currency', COALESCE((SELECT jsonb_object_agg(currency, cents)
      FROM (SELECT currency, sum(amount_cents)::bigint AS cents
        FROM public.payout_ledger_adjustments WHERE kind = 'transfer_fee_credit'
        GROUP BY currency) q), '{}'::jsonb)
  ) INTO v_summary;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'summary', v_summary);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_list_payouts(text,text,uuid,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_payouts(text,text,uuid,int,int) TO authenticated;

COMMIT;

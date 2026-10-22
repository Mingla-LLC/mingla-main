-- Issue #3645 — backfill the Stripe payout partner outcome that the webhook
-- never recorded.
--
-- For our direct charges, charge.succeeded carries application_fee: null and
-- lands before the ticket order exists, so no Stripe order ever received a
-- payout_partner_attributions row. plan_pending_payout_partner_legs skips any
-- release holding a positive-fee item without one, and the payout sweep stops
-- with 409 partner_attribution_pending. The webhook now records the outcome
-- from application_fee.created; this backfill records it for sales that
-- already happened.
--
-- Every value comes from immutable stored provider evidence, through the same
-- #1174 writer the webhook uses (record_payout_partner_outcome):
--   - fee id, amount, currency: the one mingla_revenue_log row whose stored
--     application fee object names the order's charge (orders.stripe_charge_id);
--   - sale time: charge.created from the stored charge.succeeded event;
--   - partner: resolve_partner_for_brand_at_time(brand, charge.created).
-- Only sales after the brand's payout_hold_cutover_at are written (the same
-- rule the webhook applies; the writer itself does not check it). A sale with
-- missing or inconsistent evidence is skipped and counted, never invented.
-- Re-running is a no-op: an order with a row is no longer a candidate, and the
-- writer rejects any drift.

BEGIN;

CREATE OR REPLACE FUNCTION public.backfill_stripe_payout_partner_attributions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_sale_at timestamptz;
  v_partner uuid;
  v_written integer := 0;
  v_partner_written integer := 0;
  v_pre_cutover integer := 0;
  v_no_evidence integer := 0;
BEGIN
  FOR v_row IN
    WITH candidates AS (
      -- Orders a pending or future Stripe payout depends on: a positive-fee
      -- item in a Stripe release, or a sale with a stored Stripe fee.
      SELECT o.id AS order_id, e.brand_id, b.payout_hold_cutover_at,
             o.stripe_charge_id
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      WHERE NOT EXISTS (
          SELECT 1 FROM public.payout_partner_attributions a
          WHERE a.order_id = o.id
        )
        AND (
          EXISTS (
            SELECT 1
            FROM public.payout_release_items i
            JOIN public.brand_payout_releases r ON r.id = i.release_id
            WHERE i.source_type = 'order'
              AND i.source_id = o.id
              AND i.mingla_fee_cents > 0
              AND r.provider = 'stripe'
          )
          OR (
            o.stripe_charge_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.mingla_revenue_log m
              WHERE m.raw_payload->>'charge' = o.stripe_charge_id
                AND m.amount_cents > 0
            )
          )
        )
    )
    SELECT
      c.order_id,
      c.brand_id,
      c.payout_hold_cutover_at,
      fee.fee_count,
      fee.fee_id,
      fee.fee_amount,
      fee.fee_currency,
      fee.fee_account,
      chg.charge_created,
      chg.charge_fee_amount,
      chg.charge_currency,
      chg.charge_account
    FROM candidates c
    LEFT JOIN LATERAL (
      SELECT count(*) OVER () AS fee_count,
             m.stripe_application_fee_id AS fee_id,
             m.amount_cents AS fee_amount,
             lower(m.currency) AS fee_currency,
             m.stripe_account_id AS fee_account
      FROM public.mingla_revenue_log m
      WHERE c.stripe_charge_id IS NOT NULL
        AND m.raw_payload->>'charge' = c.stripe_charge_id
        AND m.amount_cents > 0
      ORDER BY m.stripe_application_fee_id
      LIMIT 1
    ) fee ON true
    LEFT JOIN LATERAL (
      SELECT (w.payload->'data'->'object'->>'created')::bigint
               AS charge_created,
             (w.payload->'data'->'object'->>'application_fee_amount')::bigint
               AS charge_fee_amount,
             lower(w.payload->'data'->'object'->>'currency')
               AS charge_currency,
             w.payload->>'account' AS charge_account
      FROM public.payment_webhook_events w
      WHERE c.stripe_charge_id IS NOT NULL
        AND w.type = 'charge.succeeded'
        AND w.payload->'data'->'object'->>'id' = c.stripe_charge_id
        AND (w.payload->'data'->'object'->>'created') ~ '^[0-9]+$'
      ORDER BY w.created_at, w.id
      LIMIT 1
    ) chg ON true
    ORDER BY c.order_id
  LOOP
    -- Evidence must be complete and self-consistent; otherwise skip.
    IF v_row.fee_id IS NULL
       OR v_row.fee_count <> 1
       OR v_row.charge_created IS NULL
       OR v_row.charge_created <= 0
       OR (v_row.charge_fee_amount IS NOT NULL
           AND v_row.charge_fee_amount <> v_row.fee_amount)
       OR (v_row.charge_currency IS NOT NULL
           AND v_row.charge_currency <> v_row.fee_currency)
       OR (v_row.charge_account IS NOT NULL AND v_row.fee_account IS NOT NULL
           AND v_row.charge_account <> v_row.fee_account) THEN
      v_no_evidence := v_no_evidence + 1;
      CONTINUE;
    END IF;

    v_sale_at := to_timestamp(v_row.charge_created);
    IF v_row.payout_hold_cutover_at IS NULL
       OR v_sale_at <= v_row.payout_hold_cutover_at THEN
      v_pre_cutover := v_pre_cutover + 1;
      CONTINUE;
    END IF;

    v_partner := public.resolve_partner_for_brand_at_time(
      v_row.brand_id, v_sale_at
    );

    PERFORM public.record_payout_partner_outcome(
      v_row.fee_id,
      v_row.order_id,
      v_row.brand_id,
      v_partner,
      v_sale_at,
      v_row.fee_amount,
      CASE
        WHEN v_partner IS NULL THEN 0
        ELSE round(v_row.fee_amount::numeric * 0.10)::integer
      END,
      v_row.fee_currency,
      'stripe'
    );
    v_written := v_written + 1;
    IF v_partner IS NOT NULL THEN
      v_partner_written := v_partner_written + 1;
    END IF;
  END LOOP;

  IF v_no_evidence > 0 THEN
    RAISE NOTICE
      'issue_3645 backfill: skipped % Stripe order(s) without complete provider evidence',
      v_no_evidence;
  END IF;
  IF v_pre_cutover > 0 THEN
    RAISE NOTICE
      'issue_3645 backfill: left % pre-cutover Stripe order(s) untouched',
      v_pre_cutover;
  END IF;
  RAISE NOTICE
    'issue_3645 backfill: recorded % outcome(s) (% with a partner)',
    v_written, v_partner_written;

  RETURN jsonb_build_object(
    'written', v_written,
    'partner_written', v_partner_written,
    'pre_cutover', v_pre_cutover,
    'no_evidence', v_no_evidence
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.backfill_stripe_payout_partner_attributions()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.backfill_stripe_payout_partner_attributions() IS
  'Issue #3645: records missing post-cutover Stripe payout partner outcomes from stored provider evidence through record_payout_partner_outcome. Idempotent.';

SELECT public.backfill_stripe_payout_partner_attributions();

COMMIT;

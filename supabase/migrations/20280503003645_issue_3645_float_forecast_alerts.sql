-- issue #3645 bundle 2c: the Nigerian payout float forecast counts paid sales
-- that are not attached yet; the shortfall alert can fire with no release; a
-- stay payout held by a long-open dispute alerts ops.
--
-- 1. issue_3645_unattached_payout_sources(p_mature_by): the paid sales both
--    dark sweeps would attach once they mature by p_mature_by, with the net
--    their release will store. The sweeps are NOT changed; their candidate
--    text is copied verbatim and a structural test fails CI if it drifts.
-- 2. paystack_payout_float_obligation adds unattached Paystack sales (orders,
--    RSVP contributions, venue deposits and menu orders, instalments, stays)
--    maturing inside the horizon. Before, it read 0 until each sale matured,
--    so the top-up warning and the blocked payout arrived together.
-- 3. payout_release_alert_outbox: release_id and brand_id may both be NULL,
--    for the float-shortfall kind only, on one Mingla-wide row. A shortfall
--    anchored by a release keeps its anchored row exactly as before.
-- 4. issue_3645_raise_stale_stay_dispute_alerts: a stay dispute hold open for
--    over 90 days raises 'stay_dispute_hold_open'; a different set of stale
--    disputes on the release re-arms it. Added to the CHECK and the drain in
--    this one migration (the #1217 trap), asserted above COMMIT.
--
-- No release, item, leg, debt or hold row is written; no money moves.

BEGIN;

-- §1. The outbox can hold one Mingla-wide float row.
ALTER TABLE public.payout_release_alert_outbox
  ALTER COLUMN release_id DROP NOT NULL,
  ALTER COLUMN brand_id DROP NOT NULL;

-- Both set, or both NULL; and only the float-shortfall kind may be NULL.
-- Existing rows all have both set, so validation cannot fail.
ALTER TABLE public.payout_release_alert_outbox
  ADD CONSTRAINT payout_release_alert_outbox_anchor_check CHECK (
    (release_id IS NULL) = (brand_id IS NULL)
    AND (alert_kind = 'paystack_float_shortfall' OR release_id IS NOT NULL)
  );

-- One Mingla-wide row per kind. UNIQUE (release_id, alert_kind) keeps its
-- name: surface_payout_releases_waiting_for_bank names it in ON CONFLICT.
CREATE UNIQUE INDEX payout_release_alert_outbox_mingla_wide_key
  ON public.payout_release_alert_outbox (alert_kind)
  WHERE release_id IS NULL;

-- Widen the kinds (append only; every earlier kind is kept).
ALTER TABLE public.payout_release_alert_outbox
  DROP CONSTRAINT IF EXISTS payout_release_alert_outbox_alert_kind_check;
ALTER TABLE public.payout_release_alert_outbox
  ADD CONSTRAINT payout_release_alert_outbox_alert_kind_check
  CHECK (alert_kind IN (
    'stripe_attempt_cap',
    'paystack_otp_blocked',
    'paystack_attempt_cap',
    'paystack_fee_unreconciled',
    'paystack_over_cap',
    'paystack_reversal_unreconciled',
    'paystack_balance_blocked',
    'paystack_float_shortfall',
    'waiting_for_bank',
    'stay_dispute_hold_open'
  ));

-- §2. Paid sales that are not attached yet (one source with the sweeps).
CREATE OR REPLACE FUNCTION public.issue_3645_unattached_payout_sources(
  p_mature_by timestamptz
) RETURNS TABLE (
  source_type text,
  source_id uuid,
  brand_id uuid,
  provider text,
  currency text,
  finalized_at timestamptz,
  net_cents bigint
)
LANGUAGE sql
STABLE
-- No SET clause on purpose: a set-returning SQL function with a SET clause is
-- never inlined, and inlining lets the caller's own filters (provider,
-- currency) reach each arm instead of materialising every candidate first.
-- The body is fully schema-qualified, and EXECUTE is service_role only.
AS $fn$
  -- issue #3645: the paid sales the two dark sweeps would attach once they
  -- mature by p_mature_by but have not attached yet, with the net
  -- attach_payout_release / issue_1389_attach_stay_payout_release would store.
  -- Both arms are the sweeps' own candidate text, copied verbatim with p_now
  -- renamed; issue_3645_unattached_sources_match_sweeps.structural.test.ts
  -- fails CI the moment either sweep's text changes without this function.
  SELECT
    sale.source_type, sale.source_id, sale.brand_id, sale.provider,
    sale.currency, sale.finalized_at,
    greatest(0, sale.gross_cents::bigint - sale.refunded_cents
      - sale.disputed_cents - sale.mingla_fee_cents)
  FROM (
    WITH candidates AS (
      SELECT 'order'::text source_type,o.id source_id,e.brand_id,o.event_id,
        occ.event_date_id,b.payment_provider provider,lower(o.currency::text) currency,
        -- Issue #3872 (F10): gross is what the provider charged (buyer_total_cents);
        -- orders.total_cents is the ticket base on Stripe paths.
        o.created_at finalized_at,occ.end_at anchor_end_at,
        coalesce(o.buyer_total_cents,o.total_cents)::int gross_cents,
        o.refunded_amount_cents refunded_cents,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.order_id=o.id AND d.status NOT IN ('won','warning_closed')),0) disputed_cents,
        -- Issue #3872: only the fee Mingla kept. A refund with
        -- refund_application_fee returns part of the fee to the host's balance.
        greatest(0,coalesce(o.stripe_application_fee_amount_cents,0)-coalesce((
          SELECT sum(rf.application_fee_refunded_cents)::int FROM public.refunds rf
          WHERE rf.order_id=o.id AND rf.status='succeeded'
            AND rf.application_fee_refund_status='succeeded_positive'
        ),0)) mingla_fee_cents,
        coalesce((SELECT sum(ps.partner_share_cents)::int FROM public.partner_splits ps
          WHERE ps.order_id=o.id),0) partner_share_cents,
        (fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)) provider_fee_cents,occ.event_date_id::text occurrence_key
      FROM public.orders o JOIN public.events e ON e.id=o.event_id
      JOIN public.brands b ON b.id=e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,o.created_at
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='order' AND fs.source_id=o.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE o.payment_status IN ('paid','partial_refund')
        AND o.total_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND o.created_at>b.payout_hold_cutover_at AND e.status<>'cancelled'
      UNION ALL
      SELECT 'rsvp_contribution',c.id,e.brand_id,c.event_id,occ.event_date_id,c.provider,
        lower(c.currency),coalesce(c.paid_at,c.created_at),occ.end_at,
        c.buyer_total_cents,
        greatest(c.refunded_amount_cents,coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.buyer_state='processed'
        ),0)),0,
        greatest(0,coalesce(c.application_fee_amount_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.fee_state='processed'
        ),0)),0,(fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),
        occ.event_date_id::text
      FROM public.event_rsvp_contributions c JOIN public.events e ON e.id=c.event_id
      JOIN public.brands b ON b.id=c.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        c.event_id,NULL,coalesce(c.paid_at,c.created_at)
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='rsvp_contribution' AND fs.source_id=c.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE c.status IN ('paid','partially_refunded') AND b.payout_hold_cutover_at IS NOT NULL
        AND coalesce(c.paid_at,c.created_at)>b.payout_hold_cutover_at AND e.status<>'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      SELECT 'venue_reservation',s.id,s.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(s.currency::text),r.created_at,s.reserved_for,s.amount_cents,
        coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.buyer_state='processed'
        ),0),0,
        -- Issue #3872: the deposit pays Mingla an application fee; deduct what
        -- Mingla kept (this arm used to deduct 0 and over-release by the fee).
        greatest(0,coalesce(s.application_fee_amount_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.fee_state='processed'
        ),0)),0,(fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),'reservation:'||s.id::text
      FROM public.reservation_checkout_sessions s
      JOIN public.reservations r ON r.id=s.reservation_id
      JOIN public.brands b ON b.id=s.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_reservation' AND fs.source_id=s.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE s.status='completed' AND s.amount_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND r.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      SELECT 'venue_menu_order',vo.id,vo.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(vo.currency),vo.confirmed_at,vo.created_at,vo.total_cents,
        coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.buyer_state='processed'
        ),0),
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.venue_order_id=vo.id AND d.status NOT IN ('won','warning_closed')),0),
        -- #3645 flat 4.5%: Mingla take = mingla_fee + platform_service_fee
        -- (equals application_fee_amount at charge). Fee reversals reduce it.
        greatest(0,coalesce(vo.mingla_fee_cents,0)+coalesce(vo.platform_service_fee_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.fee_state='processed'
        ),0)),
        0,
        (fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),'venue_order:'||vo.id::text
      FROM public.venue_orders vo
      JOIN public.brands b ON b.id=vo.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_menu_order' AND fs.source_id=vo.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE vo.money_path='mingla'
        AND vo.payment_status IN ('paid','partial_refund')
        AND vo.total_cents>0
        AND vo.confirmed_at IS NOT NULL
        AND b.payout_hold_cutover_at IS NOT NULL
        AND vo.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      -- #3645 / #2036 — collected installment arm. Fees live on the row
      -- (application_fee_amount_cents / provider_fee_cents). Gated by
      -- issue_2036_installment_payout_ready() (default false). Skip cancelled
      -- events. Maturity = collected_at + 1 day via attach (payment+24h).
      SELECT 'order_installment',oi.id,e.brand_id,o.event_id,occ.event_date_id,
        -- #3645: the instalment's own immutable provider; never derive from mutable brands.payment_provider.
        oi.provider,
        lower(oi.currency::text),oi.collected_at,oi.collected_at,
        coalesce(oi.buyer_total_cents,oi.amount_cents)::integer,oi.refunded_amount_cents::integer,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE oi.provider='stripe' AND d.stripe_charge_id=oi.stripe_charge_id
            AND d.status NOT IN ('won','warning_closed')),0)
        +coalesce((SELECT sum(pd.amount_cents)::int FROM public.paystack_disputes pd
          WHERE pd.order_installment_id=oi.id AND pd.is_resolved IS NOT TRUE),0),
        coalesce(oi.application_fee_amount_cents,0),0,
        coalesce(oi.provider_fee_cents,0),
        -- Unique per installment payment so a later installment never mutates
        -- an already-released release keyed by shared occurrence (#3645).
        'order_installment:' || oi.id::text
      FROM public.order_installments oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,oi.collected_at
      ) occ ON true
      WHERE public.issue_2036_installment_payout_ready()
        AND oi.status = 'collected'
        AND oi.payout_accounting_state = 'ready'
        AND oi.collected_at IS NOT NULL
        AND oi.amount_cents > 0
        AND oi.application_fee_amount_cents IS NOT NULL
        AND b.payout_hold_cutover_at IS NOT NULL
        AND oi.collected_at > b.payout_hold_cutover_at
        AND e.status <> 'cancelled'
    )
    -- Issue #3645: every sale becomes sweep-eligible about 24 hours after its
    -- payment, independent of the event or reservation date.
    SELECT * FROM candidates c
    WHERE c.finalized_at IS NOT NULL
      AND c.finalized_at + interval '1 day' <= p_mature_by
      AND c.gross_cents-c.refunded_cents-c.disputed_cents>0
      AND NOT EXISTS (SELECT 1 FROM public.payout_release_items i
        WHERE i.source_type=c.source_type AND i.source_id=c.source_id)
  ) sale
  UNION ALL
  SELECT
    'stay_reservation'::text, stay.source_id, stay.brand_id, stay.provider,
    stay.currency, stay.finalized_at,
    greatest(0, stay.gross_cents::bigint - stay.refunded_cents
      - stay.mingla_fee_cents)
  FROM (
    SELECT
      line.id AS source_id,
      group_row.id AS group_id,
      group_row.brand_id,
      attempt.provider,
      lower(attempt.currency_code::text) AS currency,
      attempt.succeeded_at AS finalized_at,
      CASE line.kind
        WHEN 'room' THEN (
          line.room_check_out::timestamp + settings.check_out_time
        ) AT TIME ZONE settings.timezone
        ELSE place_window.ends_at
      END AS anchor_end_at,
      line.total_minor::integer AS gross_cents,
      COALESCE((
        SELECT sum(allocation.refunded_minor)::integer
        FROM public.stay_payment_allocations allocation
        WHERE allocation.payment_attempt_id = attempt.id
          AND allocation.reservation_line_id = line.id
      ), 0) AS refunded_cents,
      snapshot.platform_fee_minor AS mingla_fee_cents,
      snapshot.provider_fee_minor AS provider_fee_cents,
      'stay:' || group_row.id || ':' || line.id AS occurrence_key
    FROM public.stay_reservation_lines line
    JOIN public.stay_reservation_groups group_row
      ON group_row.id = line.group_id
    JOIN public.stay_payment_attempts attempt
      ON attempt.group_id = group_row.id
     AND attempt.state = 'succeeded'
    JOIN public.stay_payout_line_snapshots snapshot
      ON snapshot.reservation_line_id = line.id
     AND snapshot.payment_attempt_id = attempt.id
    JOIN public.stay_settings settings
      ON settings.venue_id = group_row.venue_id
    LEFT JOIN public.stay_place_windows place_window
      ON place_window.id = line.place_window_id
    JOIN public.brands brand ON brand.id = group_row.brand_id
    WHERE line.state = 'confirmed'
      AND attempt.succeeded_at > brand.payout_hold_cutover_at
      AND attempt.succeeded_at + interval '1 day' <= p_mature_by
      AND NOT EXISTS (
        SELECT 1
        FROM public.source_refunds source_refund
        WHERE source_refund.source_type = 'stay_reservation'
          AND source_refund.subject_id = group_row.id
          AND source_refund.financial_state <> 'reconciled'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.payout_release_items item
        WHERE item.source_type = 'stay_reservation'
          AND item.source_id = line.id
      )
  ) stay
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_unattached_payout_sources(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_unattached_payout_sources(timestamptz)
  TO service_role;

-- §3. Mark the Mingla-wide float row covered.
CREATE OR REPLACE FUNCTION public.issue_3645_mark_mingla_float_covered(
  p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_count integer;
BEGIN
  -- issue #3645: the Nigerian float is covered (or a release now anchors the
  -- shortfall), so the next release-less shortfall is a new alert, not a
  -- figure to compare with the last one. A row being delivered is left alone.
  UPDATE public.payout_release_alert_outbox
  SET alert_magnitude_kobo = 0, updated_at = p_now
  WHERE release_id IS NULL AND alert_kind = 'paystack_float_shortfall'
    AND status <> 'dispatching' AND alert_magnitude_kobo <> 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_mark_mingla_float_covered(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_mark_mingla_float_covered(timestamptz)
  TO service_role;

-- Re-emit: paystack_payout_float_obligation (from supabase/migrations/20270720003645_issue_3645_payment_plus_24h_payouts.sql; hunks declared in __tests__/issue_3645_float_forecast_reemit_hunks.ts).
CREATE OR REPLACE FUNCTION public.paystack_payout_float_obligation(
  p_horizon_days integer DEFAULT 7,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- #3645 — floor is 1 day (payment + ~24h maturity). Was 3 under event_end+3d
  -- (#1840). Clamped, never rejected: an out-of-range value must degrade to a
  -- usable window, never disable the forecast. Mirrors
  -- NG_PAYOUT_FLOAT_HORIZON_{MIN,MAX}_DAYS in runtimeConfig.
  v_days integer := greatest(1,least(coalesce(p_horizon_days,7),90));
  v_horizon_end timestamptz;
  v_obligation bigint := 0;
  v_count integer := 0;
  v_anchor_release uuid;
  v_anchor_brand uuid;
  v_earliest timestamptz;
  -- issue #3645: paid Paystack sales the sweep has not attached yet.
  v_unattached_kobo bigint := 0;
  v_unattached_count integer := 0;
  v_unattached_earliest timestamptz;
BEGIN
  v_horizon_end := p_now + make_interval(days => v_days);

  WITH eligible AS (
    SELECT
      r.id,
      r.brand_id,
      r.releasable_at,
      r.net_release_cents::bigint AS net_release_cents,
      coalesce((
        SELECT sum(a.amount_cents)::bigint
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0) AS recredit
    FROM public.brand_payout_releases r
    WHERE r.provider='paystack'
      AND r.paystack_transfer_code IS NULL
      AND r.releasable_at<=v_horizon_end
      AND r.status IN (
        'pending','in_flight','blocked_balance','blocked_otp',
        'blocked_over_cap','fee_unreconciled'
      )
      AND (
        r.event_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id=r.event_id AND e.status<>'cancelled'
        )
      )
  ),
  outstanding_legs AS (
    SELECT
      l.release_id,
      l.kind,
      sum(l.principal_cents+l.estimated_fee_cents+l.stamp_duty_cents)::bigint
        AS kobo
    FROM public.payout_transfer_legs l
    JOIN eligible e ON e.id=l.release_id
    WHERE l.status NOT IN ('succeeded','failed','reversed')
    GROUP BY l.release_id,l.kind
  ),
  organiser_planned AS (
    SELECT DISTINCT l.release_id
    FROM public.payout_transfer_legs l
    JOIN eligible e ON e.id=l.release_id
    WHERE l.kind='organiser'
  ),
  per_release AS (
    SELECT
      e.id,
      e.brand_id,
      e.releasable_at,
      (
        CASE
          WHEN EXISTS (
            SELECT 1 FROM organiser_planned p WHERE p.release_id=e.id
          ) THEN coalesce((
            SELECT o.kobo FROM outstanding_legs o
            WHERE o.release_id=e.id AND o.kind='organiser'
          ),0)
          ELSE e.net_release_cents+e.recredit
        END
      ) + coalesce((
        SELECT o.kobo FROM outstanding_legs o
        WHERE o.release_id=e.id AND o.kind='partner'
      ),0) AS kobo
    FROM eligible e
  ),
  owed AS (
    SELECT * FROM per_release WHERE kobo>0
  )
  SELECT
    coalesce(sum(o.kobo),0),
    count(*)::integer,
    min(o.releasable_at),
    (
      SELECT a.id FROM owed a
      ORDER BY a.releasable_at,a.id
      LIMIT 1
    ),
    (
      SELECT a.brand_id FROM owed a
      ORDER BY a.releasable_at,a.id
      LIMIT 1
    )
  INTO v_obligation,v_count,v_earliest,v_anchor_release,v_anchor_brand
  FROM owed o;

  -- issue #3645: a sale only becomes a release when it matures, so counting
  -- releases alone read 0 until the moment the money was due. Add every paid
  -- Paystack sale that matures inside the horizon and is not attached yet, at
  -- the net its release will store. Debts are not subtracted (over-inclusion
  -- is the safe direction for a top-up warning). The anchor stays release-only.
  SELECT coalesce(sum(u.net_cents),0), count(*)::integer,
         min(u.finalized_at + interval '1 day')
  INTO v_unattached_kobo, v_unattached_count, v_unattached_earliest
  FROM public.issue_3645_unattached_payout_sources(v_horizon_end) u
  WHERE u.provider='paystack' AND u.currency='ngn' AND u.net_cents>0;

  v_obligation := coalesce(v_obligation,0) + v_unattached_kobo;
  v_earliest := least(v_earliest, v_unattached_earliest);

  RETURN jsonb_build_object(
    'horizon_days',v_days,
    'horizon_end',v_horizon_end,
    'release_count',coalesce(v_count,0),
    'obligation_kobo',coalesce(v_obligation,0),
    'earliest_maturity_at',v_earliest,
    'anchor_release_id',v_anchor_release,
    'anchor_brand_id',v_anchor_brand,
    'unattached_count',v_unattached_count,
    'unattached_kobo',v_unattached_kobo
  );
END;
$fn$;

-- Re-emit: raise_paystack_float_shortfall_alert (from supabase/migrations/20270320001840_issue_1840_ng_payout_float_alerts.sql; hunks declared in __tests__/issue_3645_float_forecast_reemit_hunks.ts).
CREATE OR REPLACE FUNCTION public.raise_paystack_float_shortfall_alert(
  p_balance_kobo bigint,
  p_horizon_days integer DEFAULT 7,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- Re-alert thresholds. Deliberately constants: an operator tunable here
  -- would be one more way to accidentally silence the alert.
  c_growth_ratio  constant numeric := 0.25;      -- 25% worse
  c_growth_floor  constant bigint  := 100000;    -- or ₦1,000, whichever larger
  c_max_silence   constant interval := interval '24 hours';
  v_forecast jsonb;
  v_obligation bigint;
  v_shortfall bigint;
  v_anchor_release uuid;
  v_anchor_brand uuid;
  v_horizon_end timestamptz;
  v_message text;
  v_existing public.payout_release_alert_outbox;
  v_revision integer := 1;
  v_written integer := 0;
  v_verdict text;
  -- issue #3645: the release id, or 'mingla' for the one Mingla-wide row used
  -- when the shortfall is made only of sales that are not releases yet.
  v_key_base text;
BEGIN
  IF p_balance_kobo IS NULL OR p_balance_kobo < 0 THEN
    RAISE EXCEPTION 'invalid_paystack_float_balance' USING ERRCODE='22023';
  END IF;

  v_forecast := public.paystack_payout_float_obligation(p_horizon_days,p_now);
  v_obligation := (v_forecast->>'obligation_kobo')::bigint;
  v_anchor_release := nullif(v_forecast->>'anchor_release_id','')::uuid;
  v_anchor_brand := nullif(v_forecast->>'anchor_brand_id','')::uuid;
  v_horizon_end := (v_forecast->>'horizon_end')::timestamptz;
  v_shortfall := v_obligation - p_balance_kobo;

  -- issue #3645: whenever the Mingla-wide row is not the one raising (no
  -- shortfall, or a release anchors it), mark it covered so the next
  -- release-less shortfall is raised at once instead of waiting out the bounds.
  -- (The sweep calls the same function when the obligation is 0, because it
  -- does not call this raise then.)
  IF v_obligation<=0 OR v_shortfall<=0 OR v_anchor_release IS NOT NULL THEN
    PERFORM public.issue_3645_mark_mingla_float_covered(p_now);
  END IF;
  v_key_base := coalesce(v_anchor_release::text,'mingla');

  IF v_obligation<=0 OR v_shortfall<=0 THEN
    RETURN v_forecast || jsonb_build_object(
      'balance_kobo',p_balance_kobo,
      'shortfall_kobo',greatest(v_shortfall,0),
      'alert','none'
    );
  END IF;

  v_message := 'NGN '
    || to_char(v_obligation::numeric/100,'FM999,999,999,990.00')
    || ' of Nigerian payouts mature by '
    || to_char(v_horizon_end AT TIME ZONE 'UTC','YYYY-MM-DD')
    || '; Paystack balance is NGN '
    || to_char(p_balance_kobo::numeric/100,'FM999,999,999,990.00')
    || '; top up NGN '
    || to_char(v_shortfall::numeric/100,'FM999,999,999,990.00')
    || ' before then.';

  SELECT * INTO v_existing
  FROM public.payout_release_alert_outbox
  WHERE alert_kind='paystack_float_shortfall'
    AND (release_id=v_anchor_release
         OR (v_anchor_release IS NULL AND release_id IS NULL))
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.payout_release_alert_outbox (
      release_id,alert_kind,idempotency_key,brand_id,error_message,
      alert_revision,alert_magnitude_kobo,alert_refreshed_at,
      created_at,updated_at
    ) VALUES (
      v_anchor_release,'paystack_float_shortfall',
      'paystack_float_shortfall:'||v_key_base||':r1',
      v_anchor_brand,left(v_message,1000),
      1,v_shortfall,p_now,p_now,p_now
    ) ON CONFLICT DO NOTHING;  -- issue #3645: (release_id, alert_kind) or the Mingla-wide index
    GET DIAGNOSTICS v_written = ROW_COUNT;
    -- A concurrent sweep won the race; it wrote the current figure, so this
    -- tick has nothing to add.
    v_verdict := CASE WHEN v_written>0 THEN 'raised' ELSE 'suppressed' END;
    RETURN v_forecast || jsonb_build_object(
      'balance_kobo',p_balance_kobo,
      'shortfall_kobo',v_shortfall,
      'alert_revision',CASE WHEN v_written>0 THEN 1 ELSE NULL END,
      'alert',v_verdict
    );
  END IF;

  -- An in-flight claim is never disturbed (see the header note).
  IF v_existing.status='dispatching' THEN
    RETURN v_forecast || jsonb_build_object(
      'balance_kobo',p_balance_kobo,
      'shortfall_kobo',v_shortfall,
      'alert_revision',v_existing.alert_revision,
      'alert','suppressed'
    );
  END IF;

  IF NOT (
    -- 1. materially worse
    v_shortfall - coalesce(v_existing.alert_magnitude_kobo,0)
      >= greatest(
           ceil(coalesce(v_existing.alert_magnitude_kobo,0)::numeric
                * c_growth_ratio)::bigint,
           c_growth_floor
         )
    -- 2. bounded silence
    OR coalesce(v_existing.alert_refreshed_at,v_existing.created_at)
         <= p_now - c_max_silence
    -- 3. never delivered, and the figure actually moved
    OR (
      v_existing.status='pending'
      AND left(v_message,1000) IS DISTINCT FROM v_existing.error_message
    )
    -- 4. issue #3645: marked covered since it was last alerted (the
    -- Mingla-wide row), so a new shortfall is a new alert
    OR (v_existing.release_id IS NULL
        AND coalesce(v_existing.alert_magnitude_kobo,1)=0)
  ) THEN
    RETURN v_forecast || jsonb_build_object(
      'balance_kobo',p_balance_kobo,
      'shortfall_kobo',v_shortfall,
      'alert_revision',v_existing.alert_revision,
      'alert','suppressed'
    );
  END IF;

  v_revision := coalesce(v_existing.alert_revision,1)+1;
  UPDATE public.payout_release_alert_outbox
  SET error_message=left(v_message,1000),
      -- Revision-bearing so notify-dispatch cannot dedupe the corrected figure
      -- away one layer below this table.
      idempotency_key='paystack_float_shortfall:'||v_key_base
        ||':r'||v_revision::text,
      -- Re-arm an already-delivered row so a NEW artefact carries the NEW
      -- number. A row still 'pending' simply keeps its place in the queue.
      status='pending',
      dispatch_claim_id=NULL,
      dispatch_claimed_at=NULL,
      last_delivery_error=NULL,
      provider_accepted_at=NULL,
      alert_revision=v_revision,
      alert_magnitude_kobo=v_shortfall,
      alert_refreshed_at=p_now,
      updated_at=p_now
  WHERE id=v_existing.id;

  RETURN v_forecast || jsonb_build_object(
    'balance_kobo',p_balance_kobo,
    'shortfall_kobo',v_shortfall,
    'alert_revision',v_revision,
    'alert','refreshed'
  );
END;
$fn$;

-- Re-emit: claim_payout_release_alerts (from supabase/migrations/20270727003645_issue_3645_no_silent_skip_waiting_for_bank.sql; hunks declared in __tests__/issue_3645_float_forecast_reemit_hunks.ts).
CREATE OR REPLACE FUNCTION public.claim_payout_release_alerts(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  alert_id uuid,
  release_id uuid,
  brand_id uuid,
  alert_kind text,
  error_message text,
  idempotency_key text,
  claim_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT o.id
    FROM public.payout_release_alert_outbox o
    WHERE o.alert_kind IN (
        'stripe_attempt_cap',
        'paystack_otp_blocked',
        'paystack_attempt_cap',
        'paystack_fee_unreconciled',
        'paystack_over_cap',
        'paystack_reversal_unreconciled',
        'paystack_balance_blocked',
        'paystack_float_shortfall',
        'waiting_for_bank',
        'stay_dispute_hold_open'  -- issue #3645
      )
      AND (
        o.status='pending'
        OR (
          o.status='dispatching'
          AND o.dispatch_claimed_at < p_now-interval '10 minutes'
        )
      )
    ORDER BY o.created_at,o.id
    FOR UPDATE OF o SKIP LOCKED
    LIMIT greatest(1,least(p_limit,100))
  ),
  claimed AS (
    UPDATE public.payout_release_alert_outbox o
    SET status='dispatching',
        dispatch_claim_id=gen_random_uuid(),
        dispatch_claimed_at=p_now,
        updated_at=p_now
    FROM eligible
    WHERE o.id=eligible.id
    RETURNING o.*
  )
  SELECT
    c.id,
    c.release_id,
    c.brand_id,
    c.alert_kind,
    c.error_message,
    c.idempotency_key,
    c.dispatch_claim_id
  FROM claimed c
  ORDER BY c.created_at,c.id;
END;
$fn$;

-- §4. Long-open stay dispute holds.
CREATE OR REPLACE FUNCTION public.issue_3645_raise_stale_stay_dispute_alerts(
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- Stripe can take ~75 days to decide a dispute after evidence; past this an
  -- open hold is worth a human look. A constant on purpose (no way to silence).
  c_age constant interval := interval '90 days';
  v_rel record;
  v_message text;
  v_existing public.payout_release_alert_outbox;
  v_written integer;
  v_revision integer;
  v_raised integer := 0;
  v_refreshed integer := 0;
BEGIN
  FOR v_rel IN
    SELECT
      opened.release_id,
      release.brand_id,
      string_agg(DISTINCT opened.provider_ref, ', ' ORDER BY opened.provider_ref) AS refs
    FROM public.stay_payout_release_holds opened
    JOIN public.brand_payout_releases release ON release.id = opened.release_id
    WHERE opened.kind = 'dispute_opened'
      AND opened.created_at <= p_now - c_age
      AND release.status <> 'released'
      -- The SAME dispute on the same line is still open (not any dispute on
      -- the release: an old closed one plus a young open one is not stale).
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_payout_release_holds closed
        WHERE closed.release_id = opened.release_id
          AND closed.line_id = opened.line_id
          AND closed.provider_ref = opened.provider_ref
          AND closed.kind IN ('dispute_won', 'dispute_lost')
      )
    GROUP BY opened.release_id, release.brand_id
    ORDER BY opened.release_id
  LOOP
    v_message := left(
      'Stay payout held by a dispute open for over 90 days: '
        || v_rel.refs
        || '. The payout stays held until each dispute closes; check them in Stripe.',
      1000
    );

    SELECT * INTO v_existing
    FROM public.payout_release_alert_outbox
    WHERE release_id = v_rel.release_id AND alert_kind = 'stay_dispute_hold_open'
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.payout_release_alert_outbox (
        release_id, alert_kind, idempotency_key, brand_id, error_message,
        alert_revision, alert_refreshed_at, created_at, updated_at
      ) VALUES (
        v_rel.release_id, 'stay_dispute_hold_open',
        'stay_dispute_hold_open:' || v_rel.release_id::text || ':r1',
        v_rel.brand_id, v_message, 1, p_now, p_now, p_now
      ) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_written = ROW_COUNT;
      v_raised := v_raised + v_written;
    -- A different set of stale disputes on this release (one closed, another
    -- went stale) is a new fact: re-arm with a new key so it is delivered.
    -- An in-flight delivery is never disturbed; the next tick picks it up.
    ELSIF v_existing.status <> 'dispatching'
      AND v_existing.error_message IS DISTINCT FROM v_message THEN
      v_revision := coalesce(v_existing.alert_revision, 1) + 1;
      UPDATE public.payout_release_alert_outbox
      SET error_message = v_message,
          idempotency_key = 'stay_dispute_hold_open:' || v_rel.release_id::text
            || ':r' || v_revision::text,
          status = 'pending',
          dispatch_claim_id = NULL,
          dispatch_claimed_at = NULL,
          last_delivery_error = NULL,
          provider_accepted_at = NULL,
          alert_revision = v_revision,
          alert_refreshed_at = p_now,
          updated_at = p_now
      WHERE id = v_existing.id;
      v_refreshed := v_refreshed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('raised', v_raised, 'refreshed', v_refreshed);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_raise_stale_stay_dispute_alerts(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_raise_stale_stay_dispute_alerts(timestamptz)
  TO service_role;

-- §5. Self-assert above COMMIT: a kind written but never delivered (the #1217
-- defect) or a half-applied outbox change rolls the whole migration back.
DO $$
DECLARE
  v_drain text := pg_get_functiondef(
    'public.claim_payout_release_alerts(integer,timestamptz)'::regprocedure
  );
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_release_alert_outbox_alert_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%stay_dispute_hold_open%'
  ) OR position('stay_dispute_hold_open' in v_drain) = 0 THEN
    RAISE EXCEPTION '#3645 2c self-assert: stay_dispute_hold_open missing from the outbox CHECK or the drain';
  END IF;
  IF position('waiting_for_bank' in v_drain) = 0
     OR position('paystack_float_shortfall' in v_drain) = 0 THEN
    RAISE EXCEPTION '#3645 2c self-assert: the drain lost an earlier kind';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_release_alert_outbox_anchor_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'payout_release_alert_outbox_mingla_wide_key'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_release_alert_outbox_release_id_alert_kind_key'
  ) THEN
    RAISE EXCEPTION '#3645 2c self-assert: outbox anchor check, Mingla-wide index or (release_id, alert_kind) key missing';
  END IF;
END$$;

COMMIT;

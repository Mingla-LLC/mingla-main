-- Issue #1840 (step 1 of #1845) — the Nigerian payout float can never fail
-- silently, and its shortfall is forecast BEFORE maturity.
--
-- Forward-only hardening of functions first shipped by #1172 (20270110000002),
-- #1177 (20270110000008) and #1217/#1219 (20270110000010). Those files are NOT
-- edited in place (migration-history-drift rule; #1217 is the precedent).
--
-- Context. Nigerian organiser payouts settle 100% into Mingla's Paystack
-- balance and are released later by payout-release-sweep. Paystack is on
-- next-day automatic settlement, so transaction proceeds leave the balance
-- overnight and are NOT there when a release matures days later. The operator
-- has chosen to keep next-day settlement and fund the balance instead, which
-- makes these two alerts the only thing between a matured Nigerian payout and
-- an organiser who is silently never paid.
--
-- D1 — blocked_balance is never silent again (the backstop).
--   record_paystack_transfer_leg_outcome already parks the release on
--   'blocked_balance' when the main balance is under the release ceiling, but
--   raised NO alert: the organiser's payout could block on every sweep tick
--   forever with nothing surfacing. It now writes a paystack_balance_blocked
--   row to payout_release_alert_outbox on exactly that branch, using the same
--   ON CONFLICT (release_id, alert_kind) DO NOTHING dedupe every other #1177 /
--   #1217 alert writer uses — so a release that blocks on every tick raises
--   ONE alert, not one per tick. Everything else in that function is
--   byte-identical to #1177: no leg transition, no attempt burn, no amount, no
--   status change is altered. This adds observability and moves no money.
--
-- D2 — the forecast (the part that prevents the problem).
--   A backstop only fires once an organiser is already unpaid. The forecast
--   computes the NGN obligation maturing inside a configurable horizon
--   (default 7 days) and, when the balance cannot cover it, raises ONE
--   actionable paystack_float_shortfall alert: how much matures, by when, what
--   the balance is, and what to top up.
--
--   I-1013-LEDGER-ONLY is NOT relaxed. paystack_payout_float_obligation reads
--   the obligation exclusively from the payout ledger (brand_payout_releases /
--   payout_transfer_legs / payout_ledger_adjustments) and never sees a balance
--   at all — it takes no balance argument. The balance enters only in
--   raise_paystack_float_shortfall_alert, and only as a COMPARISON operand,
--   exactly as the existing ceiling check uses it. No release amount is ever
--   computed from a balance read.
--
-- THE #1217 TRAP, and why both changes are one indivisible migration.
--   claim_payout_release_alerts filters on a HARDCODED alert_kind IN (...)
--   list. A kind added only to payout_release_alert_outbox_alert_kind_check is
--   written, deduped, and NEVER DELIVERED — verbatim the #1217 defect ("#1177
--   writes three Paystack alert kinds… the drain hard-filters
--   alert_kind='stripe_attempt_cap', so those rows were written + deduped but
--   NEVER delivered"). Both new kinds are therefore added to the CHECK AND to
--   the drain list in this one migration, and the advisory block at the bottom
--   FAILS the migration if either kind is missing from either place.
--
-- Nothing is enabled here. Paystack organiser execution remains dark behind
-- PAYOUT_RELEASE_EXECUTE; no flag is flipped, no brand is stamped, no money
-- moves. record_payout_release_alert_delivery is alert_kind-agnostic and is
-- NOT changed.

BEGIN;

-- ── Widen the alert-outbox kinds (append only; every prior kind is kept) ────
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
    'paystack_float_shortfall'
  ));

-- ── Widen the drain in the SAME migration (the #1217 trap) ─────────────────
-- Signature and RETURNS TABLE are unchanged from #1217, so CREATE OR REPLACE
-- is safe and keeps the existing grants; they are re-asserted below anyway.
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
        'paystack_float_shortfall'
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

REVOKE ALL ON FUNCTION public.claim_payout_release_alerts(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payout_release_alerts(integer,timestamptz)
  TO service_role;

-- ── D1: blocked_balance raises an ops alert ────────────────────────────────
-- Byte-identical to #1177 (20270110000008) except for the INSERT inside the
-- p_outcome='blocked_balance' branch. Same signature, so CREATE OR REPLACE
-- keeps the existing grants. No leg transition, attempt count, amount, status
-- value or return value anywhere in this function changes.
CREATE OR REPLACE FUNCTION public.record_paystack_transfer_leg_outcome(
  p_leg_id uuid,
  p_release_id uuid,
  p_outcome text,
  p_transfer_code text,
  p_reference text,
  p_error text,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_leg public.payout_transfer_legs;
  v_release public.brand_payout_releases;
BEGIN
  IF p_outcome NOT IN (
    'in_flight','succeeded','otp','blocked_balance','retryable_error',
    'definitive_error'
  ) THEN
    RAISE EXCEPTION 'invalid_paystack_leg_outcome' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_leg
  FROM public.payout_transfer_legs
  WHERE id=p_leg_id AND release_id=p_release_id AND kind='organiser'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_organiser_leg_not_found' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE='P0002';
  END IF;
  -- Terminal legs never regress (idempotent replay guard).
  IF v_leg.status IN ('succeeded','failed','reversed') THEN
    RETURN v_leg.status;
  END IF;

  IF p_outcome='in_flight' THEN
    UPDATE public.payout_transfer_legs
    SET status='in_flight',
        provider_transfer_code=coalesce(p_transfer_code,provider_transfer_code),
        provider_reference=coalesce(p_reference,provider_reference)
    WHERE id=p_leg_id;
    RETURN 'in_flight';
  END IF;

  IF p_outcome='succeeded' THEN
    UPDATE public.payout_transfer_legs
    SET status='succeeded',
        provider_transfer_code=coalesce(p_transfer_code,provider_transfer_code),
        provider_reference=coalesce(p_reference,provider_reference)
    WHERE id=p_leg_id;
    RETURN 'succeeded';
  END IF;

  IF p_outcome='otp' THEN
    -- OTP blocks the whole rail (OPS-2 unmet). Release-level; no attempt burn.
    UPDATE public.brand_payout_releases
    SET status='blocked_otp',
        error_message='paystack_transfer_otp_enabled',
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    INSERT INTO public.payout_release_alert_outbox (
      release_id,alert_kind,idempotency_key,brand_id,error_message,
      created_at,updated_at
    ) VALUES (
      p_release_id,'paystack_otp_blocked',
      'paystack_otp_blocked:'||p_release_id::text,
      v_release.brand_id,
      left(coalesce(p_error,'paystack_transfer_otp_enabled'),1000),
      p_now,p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    RETURN 'blocked_otp';
  END IF;

  IF p_outcome='blocked_balance' THEN
    UPDATE public.brand_payout_releases
    SET status='blocked_balance',
        error_message=left(coalesce(p_error,'paystack_balance_below_release_ceiling'),1000),
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    -- #1840 D1 — the ONLY addition to this function. A parked release used to
    -- surface nowhere; it now raises a drainable ops alert. Release-keyed
    -- dedupe (the same ON CONFLICT every #1177/#1217 writer uses) means a
    -- release that blocks on every sweep tick raises exactly ONE alert.
    INSERT INTO public.payout_release_alert_outbox (
      release_id,alert_kind,idempotency_key,brand_id,error_message,
      created_at,updated_at
    ) VALUES (
      p_release_id,'paystack_balance_blocked',
      'paystack_balance_blocked:'||p_release_id::text,
      v_release.brand_id,
      left(coalesce(p_error,'paystack_balance_below_release_ceiling'),1000),
      p_now,p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    RETURN 'blocked_balance';
  END IF;

  IF p_outcome='retryable_error' THEN
    -- Ambiguous/operational: keep the leg selectable with the SAME reference
    -- (no attempt bump). Release re-pending so it is re-claimable next sweep;
    -- reconcile-first resolves any transfer that actually processed.
    UPDATE public.payout_transfer_legs
    SET status='in_flight',
        provider_reference=coalesce(p_reference,provider_reference)
    WHERE id=p_leg_id;
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message=left(coalesce(p_error,'paystack_transfer_retryable'),1000),
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN 'retryable';
  END IF;

  -- definitive_error: burn the leg attempt. At cap → leg + release failed +
  -- alert. Below cap → clear the dead code/reference so reconcile-first takes
  -- the INITIATE path with the bumped a<n+1> reference; release re-pending.
  IF v_leg.attempt_count+1>=10 THEN
    UPDATE public.payout_transfer_legs
    SET status='failed',attempt_count=v_leg.attempt_count+1
    WHERE id=p_leg_id;
    UPDATE public.brand_payout_releases
    SET status='failed',
        error_message=left(coalesce(p_error,'paystack_transfer_attempt_cap'),1000),
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    INSERT INTO public.payout_release_alert_outbox (
      release_id,alert_kind,idempotency_key,brand_id,error_message,
      created_at,updated_at
    ) VALUES (
      p_release_id,'paystack_attempt_cap',
      'paystack_attempt_cap:'||p_release_id::text,
      v_release.brand_id,
      left(coalesce(p_error,'paystack_transfer_attempt_cap'),1000),
      p_now,p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    RETURN 'failed';
  END IF;
  UPDATE public.payout_transfer_legs
  SET status='planned',
      attempt_count=v_leg.attempt_count+1,
      provider_transfer_code=NULL,
      provider_reference=NULL
  WHERE id=p_leg_id;
  UPDATE public.brand_payout_releases
  SET status='pending',
      error_message=left(coalesce(p_error,'paystack_transfer_definitive'),1000),
      paystack_execution_claim_id=NULL,
      paystack_execution_claimed_at=NULL,
      updated_at=p_now
  WHERE id=p_release_id;
  RETURN 'pending';
END;
$fn$;

-- ── D2a: the LEDGER-ONLY obligation reader ─────────────────────────────────
-- Takes NO balance argument and reads no balance anywhere — structurally
-- incapable of computing an obligation from a balance (I-1013-LEDGER-ONLY).
--
-- Per release the obligation is the outstanding NGN main-balance draw:
--   * organiser legs already planned → sum over legs NOT already terminal
--     (succeeded / failed / reversed) of principal + estimated fee + stamp,
--     which mirrors paystackReleaseCeilingKobo exactly. Excluding succeeded
--     legs is what stops a matured-and-partly-paid release double-counting;
--   * organiser legs NOT yet planned → net_release_cents + the matured
--     recredit, i.e. the pool the chunk planner will consume. Under model B
--     the transfer fee comes OUT of that pool, so the pool IS the whole draw;
--   * plus the release's non-terminal partner legs, which draw on the same
--     balance and are already inside the sweep's ceiling.
--
-- Scope is deliberately a superset of claim_paystack_payout_releases: a
-- release parked on blocked_otp/blocked_balance/fee_unreconciled, or one still
-- inside the 10-minute in-flight re-claim window, is money that is STILL OWED
-- and must be funded. Under-forecasting is the failure mode that hurts.
CREATE OR REPLACE FUNCTION public.paystack_payout_float_obligation(
  p_horizon_days integer DEFAULT 7,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_days integer := greatest(1,least(coalesce(p_horizon_days,7),90));
  v_horizon_end timestamptz;
  v_obligation bigint := 0;
  v_count integer := 0;
  v_anchor_release uuid;
  v_anchor_brand uuid;
  v_earliest timestamptz;
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

  RETURN jsonb_build_object(
    'horizon_days',v_days,
    'horizon_end',v_horizon_end,
    'release_count',coalesce(v_count,0),
    'obligation_kobo',coalesce(v_obligation,0),
    'earliest_maturity_at',v_earliest,
    'anchor_release_id',v_anchor_release,
    'anchor_brand_id',v_anchor_brand
  );
END;
$fn$;

REVOKE ALL ON FUNCTION
  public.paystack_payout_float_obligation(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.paystack_payout_float_obligation(integer,timestamptz)
  TO service_role;

-- ── D2b: the forecast alert ────────────────────────────────────────────────
-- The obligation is re-derived from the ledger INSIDE this function; the
-- balance is a comparison operand only and never contributes to any amount
-- that is paid out. Alerts only on a real shortfall, and dedupes on the
-- earliest-maturing unpaid release exactly like every other outbox writer, so
-- a persistent shortfall raises ONE alert rather than one per sweep tick.
CREATE OR REPLACE FUNCTION public.raise_paystack_float_shortfall_alert(
  p_balance_kobo bigint,
  p_horizon_days integer DEFAULT 7,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_forecast jsonb;
  v_obligation bigint;
  v_shortfall bigint;
  v_anchor_release uuid;
  v_anchor_brand uuid;
  v_horizon_end timestamptz;
  v_message text;
  v_inserted integer := 0;
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

  IF v_obligation<=0 OR v_anchor_release IS NULL OR v_shortfall<=0 THEN
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

  INSERT INTO public.payout_release_alert_outbox (
    release_id,alert_kind,idempotency_key,brand_id,error_message,
    created_at,updated_at
  ) VALUES (
    v_anchor_release,'paystack_float_shortfall',
    'paystack_float_shortfall:'||v_anchor_release::text,
    v_anchor_brand,left(v_message,1000),p_now,p_now
  ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_forecast || jsonb_build_object(
    'balance_kobo',p_balance_kobo,
    'shortfall_kobo',v_shortfall,
    'alert',CASE WHEN v_inserted>0 THEN 'raised' ELSE 'deduped' END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION
  public.raise_paystack_float_shortfall_alert(bigint,integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.raise_paystack_float_shortfall_alert(bigint,integer,timestamptz)
  TO service_role;

COMMIT;

-- ── Advisory: the #1217 trap cannot recur silently ─────────────────────────
-- A kind present in the CHECK but absent from the drain is written, deduped
-- and NEVER delivered. This block fails the migration if either half of that
-- indivisible pair is missing, so the trap can never be half-shipped.
DO $$
DECLARE
  v_drain text := pg_get_functiondef(
    'public.claim_payout_release_alerts(integer,timestamptz)'::regprocedure
  );
  v_kind text;
BEGIN
  FOREACH v_kind IN ARRAY ARRAY[
    'paystack_balance_blocked','paystack_float_shortfall'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname='payout_release_alert_outbox_alert_kind_check'
        AND pg_get_constraintdef(oid) LIKE '%'||v_kind||'%'
    ) THEN
      RAISE EXCEPTION
        '#1840 advisory: alert kind % missing from the outbox CHECK',v_kind;
    END IF;
    IF position(v_kind in v_drain)=0 THEN
      RAISE EXCEPTION
        '#1840 advisory: alert kind % missing from claim_payout_release_alerts (written but never delivered — the #1217 defect)',
        v_kind;
    END IF;
  END LOOP;
  RAISE NOTICE '#1840 NG payout float alerts installed (backstop + forecast; DARK until PAYOUT_RELEASE_EXECUTE=true).';
END$$;

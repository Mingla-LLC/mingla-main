BEGIN;
SET LOCAL lock_timeout = '10s';

-- Both authorizers use the #4522 refund and payout bodies. Alert claiming
-- builds on #3645 ledger follow-ups, which re-emitted the float forecast body.
-- The late refund debt hunk test checks each replacement against its source.
DO $drift$
DECLARE target record;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('public.record_payout_release_alert_delivery(uuid,uuid,text,text,timestamptz)', '8c6835256cfc2f81b8057fdfc56b57d6'),
    ('public.authorize_paystack_payout_execution(uuid,uuid,timestamptz)', '67fab4094e0103b58c0e0eaf188c22fc'),
    ('public.claim_payout_release_alerts(integer,timestamptz)', '782ac13b1bea65330a0ff918d06195ea'),
    ('public.issue_4522_refund_debt_alert_trigger()', 'bc4a15cee9d10f26daad676ade2dea57'),
    ('public.authorize_stripe_payout_execution(uuid,uuid,integer,timestamptz)', 'eceab4bf530af4d3a0b7ebe61306da1e'),
    ('public.record_paystack_leg_plan(uuid,uuid,jsonb,timestamptz)', 'c4032173cbba453a2c97149e803da7ae'),
    ('public.reconcile_paystack_transfer_leg_fee(uuid,integer,integer,timestamptz)', 'd0522ca9d0202784157b06919a536370'),
    ('public.issue_3645_record_release_claim_snapshot()', 'f1895b02abaa6753b7405609dc21a8bd'),
    ('public.paystack_payout_float_obligation(integer,timestamptz)', '54f7d3c7234b1ce0f90ffde91f9976af')
  ) AS expected(signature, digest) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(target.signature))) IS DISTINCT FROM target.digest THEN
      RAISE EXCEPTION '#3645 function drift: %', target.signature;
    END IF;
  END LOOP;
END;
$drift$;

-- Preserve every old plan row for audit while permitting a new, untouched
-- plan to use fresh chunk references. Existing in-flight claims are treated
-- as possibly authorized during the deployment window.
ALTER TABLE public.payout_transfer_legs ADD COLUMN refund_debt_superseded_at timestamptz;
ALTER TABLE public.brand_payout_releases
  ADD COLUMN paystack_authorized_claim_id uuid,
  ADD COLUMN stripe_authorized_attempt integer;
UPDATE public.brand_payout_releases
SET paystack_authorized_claim_id=paystack_execution_claim_id
WHERE provider='paystack' AND status='in_flight';
UPDATE public.brand_payout_releases
SET stripe_authorized_attempt=attempt_count
WHERE provider='stripe' AND status='in_flight';

ALTER TABLE public.payout_release_alert_outbox
  DROP CONSTRAINT payout_release_alert_outbox_alert_kind_check,
  ADD COLUMN dispatch_claim_revision integer,
  ADD CONSTRAINT payout_release_alert_outbox_alert_kind_check CHECK (alert_kind IN (
    'stripe_attempt_cap', 'paystack_otp_blocked', 'paystack_attempt_cap',
    'paystack_fee_unreconciled', 'paystack_over_cap', 'paystack_reversal_unreconciled',
    'paystack_balance_blocked', 'paystack_float_shortfall', 'waiting_for_bank',
    'stay_dispute_hold_open', 'paystack_plan_exceeds_due', 'payout_refund_debt'
  ));

-- A refund-debt writer enters this lock before the debt becomes visible. The
-- execution side tries the same lock while holding its distinct release row.
-- A busy lock is a retry, so a writer holding a debt/release row cannot
-- deadlock an execution that wants the same row.
CREATE FUNCTION public.issue_3645_refund_debt_lock_key(p_brand_id uuid, p_currency text)
RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT pg_catalog.hashtextextended('payout-refund-debt:' || p_brand_id::text || ':' || lower(p_currency), 0);
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_refund_debt_lock_key(uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_3645_serialize_refund_debt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.principal_cents > OLD.principal_cents THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(public.issue_3645_refund_debt_lock_key(NEW.brand_id, NEW.currency));
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_serialize_refund_debt() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER issue_3645_serialize_refund_debt
  BEFORE INSERT OR UPDATE OF principal_cents ON public.organiser_payout_debts
  FOR EACH ROW WHEN (NEW.kind = 'post_release_refund')
  EXECUTE FUNCTION public.issue_3645_serialize_refund_debt();

CREATE OR REPLACE FUNCTION public.issue_4522_refund_debt_alert_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_key text := 'payout_refund_debt:' || NEW.origin_release_id::text || ':r';
  v_message text := format('payout_refund_debt_opened: %s %s owed back from the next payouts',
                           NEW.principal_cents, upper(NEW.currency));
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.principal_cents <= OLD.principal_cents THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.payout_release_alert_outbox AS o (
    release_id, brand_id, alert_kind, error_message, idempotency_key,
    alert_revision, alert_magnitude_kobo, alert_refreshed_at
  ) VALUES (
    NEW.origin_release_id, NEW.brand_id, 'payout_refund_debt', v_message, v_key || '1',
    1, NEW.principal_cents, now()
  )
  ON CONFLICT (release_id, alert_kind) DO UPDATE
  SET error_message = EXCLUDED.error_message,
      idempotency_key = v_key || (o.alert_revision + 1)::text,
      alert_revision = o.alert_revision + 1,
      alert_magnitude_kobo = EXCLUDED.alert_magnitude_kobo,
      alert_refreshed_at = now(), updated_at = now(),
      status = CASE WHEN o.status = 'dispatching' THEN o.status ELSE 'pending' END,
      delivery_attempt_count = 0, last_delivery_error = NULL, provider_accepted_at = NULL;
  RETURN NULL;
END;
$fn$;

-- Keep delivery history and any claim for unrelated alert kinds. A legacy
-- debt alert can occupy an attempt-cap slot only if it actually has this
-- prefix. Refresh it only if the current debt is open and its figure changed.
UPDATE public.payout_release_alert_outbox o
SET alert_kind = 'payout_refund_debt',
    alert_revision = 1,
    alert_magnitude_kobo = d.principal_cents,
    alert_refreshed_at = now(),
    idempotency_key = 'payout_refund_debt:' || d.origin_release_id::text || ':r1',
    error_message = n.message,
    status = CASE WHEN d.status = 'open' AND o.error_message IS DISTINCT FROM n.message
                  THEN 'pending' ELSE o.status END,
    dispatch_claim_revision = CASE WHEN o.status = 'dispatching'
      AND NOT (d.status = 'open' AND o.error_message IS DISTINCT FROM n.message) THEN 1 END,
    dispatch_claim_id = CASE WHEN d.status = 'open' AND o.error_message IS DISTINCT FROM n.message
                             THEN NULL ELSE o.dispatch_claim_id END,
    dispatch_claimed_at = CASE WHEN d.status = 'open' AND o.error_message IS DISTINCT FROM n.message
                              THEN NULL ELSE o.dispatch_claimed_at END
FROM public.organiser_payout_debts d
CROSS JOIN LATERAL (
  SELECT format('payout_refund_debt_opened: %s %s owed back from the next payouts',
                d.principal_cents, upper(d.currency)) AS message
) n
WHERE d.origin_release_id = o.release_id AND d.kind = 'post_release_refund'
  AND o.alert_kind IN ('stripe_attempt_cap', 'paystack_attempt_cap')
  AND o.error_message LIKE 'payout_refund_debt_opened:%';

-- The direct-once index protects the original attachment. Late reservations
-- use a distinct key namespace and keep their positions even after returns.
CREATE FUNCTION public.issue_3645_apply_late_refund_debt(p_release_id uuid, p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_debt public.organiser_payout_debts;
  v_available integer;
  v_take integer;
  v_total integer := 0;
  v_position bigint;
  v_key text;
  v_owed record;
BEGIN
  SELECT * INTO STRICT v_release FROM public.brand_payout_releases
  WHERE id = p_release_id AND status = 'in_flight' FOR UPDATE;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    public.issue_3645_refund_debt_lock_key(v_release.brand_id, v_release.currency)
  ) THEN
    RAISE EXCEPTION 'payout_refund_debt_busy' USING ERRCODE = '55P03';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organiser_payout_debts
    WHERE brand_id = v_release.brand_id AND currency = v_release.currency
      AND kind = 'post_release_refund' AND status = 'open' AND recovered_cents < principal_cents
  ) THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_owed FROM public.issue_3645_release_projected_totals(p_release_id);
  v_available := least(v_release.net_release_cents, v_owed.net_release_cents);

  -- Preserve enough to cover Paystack legs that may have reached the provider.
  -- The existing authorization guard handles any remaining oversized plan.
  IF v_release.provider = 'paystack' THEN
    v_available := greatest(0, v_available - coalesce((
      SELECT sum(l.principal_cents::bigint + l.estimated_fee_cents + l.stamp_duty_cents)
      FROM public.payout_transfer_legs l
      WHERE l.release_id = p_release_id AND l.kind = 'organiser'
        AND l.status NOT IN ('failed', 'reversed')
        AND (l.status <> 'planned' OR l.attempt_count > 0
          OR l.provider_reference IS NOT NULL OR l.provider_transfer_code IS NOT NULL)
    ), 0))::integer;
  END IF;

  FOR v_debt IN
    SELECT * FROM public.organiser_payout_debts
    WHERE brand_id = v_release.brand_id AND currency = v_release.currency
      AND kind = 'post_release_refund' AND status = 'open'
      AND recovered_cents < principal_cents
    ORDER BY opened_at, id
    FOR UPDATE NOWAIT
  LOOP
    EXIT WHEN v_available <= 0;
    v_take := least(v_available, v_debt.principal_cents - v_debt.recovered_cents);
    SELECT count(*) INTO v_position FROM public.payout_debt_applications
    WHERE debt_id = v_debt.id AND release_id = p_release_id;
    v_key := v_debt.id::text || ':' || p_release_id::text || ':slice:' || (v_position + 1)::text;

    INSERT INTO public.payout_debt_applications(debt_id, release_id, amount_cents, idempotency_key)
    VALUES (v_debt.id, p_release_id, v_take, 'late-debt-apply:' || v_key);
    UPDATE public.organiser_payout_debts
    SET recovered_cents = recovered_cents + v_take,
        status = CASE WHEN recovered_cents + v_take = principal_cents THEN 'closed' ELSE status END,
        closed_at = CASE WHEN recovered_cents + v_take = principal_cents THEN p_now ELSE closed_at END,
        updated_at = p_now
    WHERE id = v_debt.id;
    INSERT INTO public.payout_debt_events(debt_id, event_kind, amount_cents, release_id, idempotency_key, created_at)
    VALUES (v_debt.id, 'future_value_reserved', v_take, p_release_id, 'debt-reserve:' || v_key, p_now);
    IF v_debt.recovered_cents + v_take = v_debt.principal_cents THEN
      INSERT INTO public.payout_debt_events(debt_id, event_kind, amount_cents, release_id, idempotency_key, created_at)
      VALUES (v_debt.id, 'cleared', v_debt.principal_cents, p_release_id, 'permanent-cleared:' || v_key, p_now);
    END IF;
    v_available := v_available - v_take;
    v_total := v_total + v_take;
  END LOOP;

  IF v_total > 0 THEN
    UPDATE public.brand_payout_releases
    SET permanent_debt_withheld_cents = permanent_debt_withheld_cents + v_total,
        refunded_cents = v_owed.refunded_cents, disputed_cents = v_owed.disputed_cents,
        net_release_cents = least(net_release_cents, v_owed.net_release_cents) - v_total,
        updated_at = p_now
    WHERE id = p_release_id;
  END IF;
  RETURN v_total;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_apply_late_refund_debt(uuid,timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.authorize_stripe_payout_execution(
  p_release_id uuid,
  p_claim_id uuid,
  p_amount_cents integer,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_event_status text;
  v_expected integer;
  v_owed record;  -- issue #4522 section 8
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='stripe'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stripe_release_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_release.stripe_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status<>'in_flight'
     OR v_release.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'stale_stripe_execution_claim' USING ERRCODE='P0001';
  END IF;
  -- #3645: like Paystack, fail closed while a stay dispute held on this
  -- unpaid release is open. Won returns the hold; lost keeps it and unblocks.
  IF public.issue_3645_stay_release_has_open_dispute(p_release_id) THEN
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message='stay_dispute_open',
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;
  v_expected:=v_release.net_release_cents+v_release.maturity_recredit_cents;
  IF p_amount_cents IS DISTINCT FROM v_expected OR v_expected<=0 THEN
    RAISE EXCEPTION 'stripe_release_amount_not_ledger_exact'
      USING ERRCODE='P0001';
  END IF;

  IF v_release.event_id IS NOT NULL THEN
    SELECT e.status INTO v_event_status
    FROM public.events e
    WHERE e.id=v_release.event_id;
    IF v_event_status IS NULL THEN
      UPDATE public.brand_payout_releases
      SET status='blocked_anchor',
          error_message='missing_live_event_truth',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
    IF v_event_status='cancelled' THEN
      UPDATE public.brand_payout_releases
      SET status='cancelled_event',
          error_message='event_cancelled_before_stripe_payout',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
  END IF;

  IF v_release.releasable_at > p_now THEN
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message='release_no_longer_mature',
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;

  -- issue #4522 section 8: the last check before money moves. A refund (or
  -- an unrecorded provider refund) since this release's sales were attached
  -- lowered what it owes: never send the old amount. Store what it owes,
  -- put it back for the next claim, and tell ops once.
  SELECT * INTO v_owed FROM public.issue_3645_release_projected_totals(p_release_id);
  IF v_owed.net_release_cents < v_release.net_release_cents THEN
    UPDATE public.brand_payout_releases
    SET refunded_cents=v_owed.refunded_cents,
        disputed_cents=v_owed.disputed_cents,
        net_release_cents=v_owed.net_release_cents,
        status='pending',
        error_message='payout_refund_unreconciled',
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    PERFORM public.issue_4522_alert_payout_refund(p_release_id, 'paystack_plan_exceeds_due',
      format('payout_refund_unreconciled: stripe due %s > owed %s',
        v_release.net_release_cents::bigint+v_release.maturity_recredit_cents,
        v_owed.net_release_cents::bigint+v_release.maturity_recredit_cents), p_now);
    RETURN false;
  END IF;

  -- A retry of the same provider idempotency key may have already moved
  -- money. A debt that opened after that authorization uses a later payout.
  IF v_release.stripe_authorized_attempt IS DISTINCT FROM v_release.attempt_count
     AND public.issue_3645_apply_late_refund_debt(p_release_id, p_now) > 0 THEN
    UPDATE public.brand_payout_releases
    SET status='pending', error_message='payout_refund_debt_repriced',
        stripe_execution_claim_id=NULL, stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;

  UPDATE public.brand_payout_releases SET stripe_authorized_attempt=v_release.attempt_count
  WHERE id=p_release_id AND stripe_authorized_attempt IS DISTINCT FROM v_release.attempt_count;
  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.authorize_paystack_payout_execution(
  p_release_id uuid,
  p_claim_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases%ROWTYPE;
  v_event_status text;
  v_plan_cents bigint;  -- #3645 bundle 4
  v_due_cents bigint;  -- #3645 bundle 4
  v_owed record;  -- issue #4522 section 8
  v_late_debt integer := 0;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id = p_release_id AND provider = 'paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Fail closed before the stale-claim check so a dispute arriving between
  -- claim and authorization cleanly cancels that attempt without provider I/O.
  IF public.paystack_release_has_unresolved_dispute(p_release_id) THEN
    UPDATE public.brand_payout_releases
    SET status = 'pending',
        error_message = 'paystack_dispute_open',
        paystack_execution_claim_id = NULL,
        paystack_execution_claimed_at = NULL,
        updated_at = p_now
    WHERE id = p_release_id;
    RETURN false;
  END IF;

  IF v_release.paystack_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status <> 'in_flight'
     OR v_release.paystack_transfer_code IS NOT NULL THEN
    RAISE EXCEPTION 'stale_paystack_execution_claim' USING ERRCODE = 'P0001';
  END IF;

  IF v_release.event_id IS NOT NULL THEN
    SELECT status INTO v_event_status
    FROM public.events
    WHERE id = v_release.event_id;
    IF v_event_status IS NULL THEN
      UPDATE public.brand_payout_releases
      SET status = 'blocked_anchor',
          error_message = 'missing_live_event_truth',
          paystack_execution_claim_id = NULL,
          paystack_execution_claimed_at = NULL,
          updated_at = p_now
      WHERE id = p_release_id;
      RETURN false;
    END IF;
    IF v_event_status = 'cancelled' THEN
      UPDATE public.brand_payout_releases
      SET status = 'cancelled_event',
          error_message = 'event_cancelled_before_paystack_transfer',
          paystack_execution_claim_id = NULL,
          paystack_execution_claimed_at = NULL,
          updated_at = p_now
      WHERE id = p_release_id;
      RETURN false;
    END IF;
  END IF;

  IF v_release.releasable_at > p_now THEN
    UPDATE public.brand_payout_releases
    SET status = 'pending',
        error_message = 'release_no_longer_mature',
        paystack_execution_claim_id = NULL,
        paystack_execution_claimed_at = NULL,
        updated_at = p_now
    WHERE id = p_release_id;
    RETURN false;
  END IF;

  -- issue #4522 section 8: a refund (or an unrecorded provider refund)
  -- since this release's sales were attached lowers what it owes before the
  -- plan check below, which then refuses the larger plan and alerts ops.
  SELECT * INTO v_owed FROM public.issue_3645_release_projected_totals(p_release_id);
  IF v_owed.net_release_cents < v_release.net_release_cents THEN
    UPDATE public.brand_payout_releases
    SET refunded_cents = v_owed.refunded_cents,
        disputed_cents = v_owed.disputed_cents,
        net_release_cents = v_owed.net_release_cents,
        updated_at = p_now
    WHERE id = p_release_id;
    v_release.net_release_cents := v_owed.net_release_cents;
  END IF;

  IF v_release.paystack_authorized_claim_id IS DISTINCT FROM p_claim_id THEN
    v_late_debt := public.issue_3645_apply_late_refund_debt(p_release_id, p_now);
  END IF;
  IF v_late_debt > 0 THEN
    SELECT * INTO STRICT v_release FROM public.brand_payout_releases WHERE id=p_release_id;
  END IF;

  -- #3645 bundle 4: the organiser legs were planned from the pool at claim
  -- time. If a hold or refund has since lowered what this release owes
  -- (its net plus recredits), sending that plan would overpay the host.
  -- Never send it: put the release back, keep the legs (a leg may already
  -- be at Paystack), and alert ops. If the release owes the plan again (a
  -- dispute won), the next claim sends it unchanged.
  SELECT coalesce(sum(
    leg.principal_cents::bigint + leg.estimated_fee_cents + leg.stamp_duty_cents
  ), 0)
  INTO v_plan_cents
  FROM public.payout_transfer_legs leg
  WHERE leg.release_id = p_release_id
    AND leg.kind = 'organiser'
    AND leg.status NOT IN ('failed', 'reversed');
  v_due_cents := v_release.net_release_cents::bigint + coalesce((
    SELECT sum(a.amount_cents)
    FROM public.payout_ledger_adjustments a
    WHERE a.release_id = p_release_id AND a.kind = 'maturity_recredit'
  ), 0);
  IF v_plan_cents > v_due_cents THEN
    -- Only this claim's untouched plan can be superseded. A prior or
    -- ambiguous provider attempt keeps its original plan and ops alert.
    IF v_late_debt > 0 THEN
      PERFORM 1 FROM public.payout_transfer_legs l
      WHERE l.release_id=p_release_id AND l.kind='organiser'
      ORDER BY l.chunk_index FOR UPDATE NOWAIT;
    END IF;
    IF v_late_debt > 0 AND NOT EXISTS (
      SELECT 1 FROM public.payout_transfer_legs l
      WHERE l.release_id=p_release_id AND l.kind='organiser'
        AND l.refund_debt_superseded_at IS NULL
        AND (l.planned_claim_id IS DISTINCT FROM p_claim_id
          OR l.status <> 'planned' OR l.attempt_count <> 0
          OR l.provider_reference IS NOT NULL OR l.provider_transfer_code IS NOT NULL)
    ) THEN
      UPDATE public.payout_transfer_legs SET status='failed',refund_debt_superseded_at=p_now
      WHERE release_id=p_release_id AND kind='organiser' AND refund_debt_superseded_at IS NULL;
    END IF;
    UPDATE public.brand_payout_releases
    SET status = 'pending',
        error_message = 'paystack_plan_exceeds_due',
        paystack_execution_claim_id = NULL,
        paystack_execution_claimed_at = NULL,
        updated_at = p_now
    WHERE id = p_release_id;
    INSERT INTO public.payout_release_alert_outbox (
      release_id, alert_kind, idempotency_key, brand_id, error_message,
      created_at, updated_at
    ) VALUES (
      p_release_id, 'paystack_plan_exceeds_due',
      'paystack_plan_exceeds_due:' || p_release_id::text,
      v_release.brand_id,
      left(format('plan %s > due %s', v_plan_cents, v_due_cents), 1000),
      p_now, p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    RETURN false;
  END IF;

  UPDATE public.brand_payout_releases SET paystack_authorized_claim_id=p_claim_id
  WHERE id=p_release_id AND paystack_authorized_claim_id IS DISTINCT FROM p_claim_id;
  RETURN true;
END;
$fn$;

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
        'stay_dispute_hold_open',  -- issue #3645
        'paystack_plan_exceeds_due',
        'payout_refund_debt'
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
        dispatch_claim_revision=o.alert_revision,
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

CREATE OR REPLACE FUNCTION public.record_payout_release_alert_delivery(
  p_alert_id uuid,
  p_claim_id uuid,
  p_outcome text,
  p_error_message text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_alert public.payout_release_alert_outbox;
BEGIN
  IF p_outcome NOT IN ('provider_accepted','retryable','manual_review') THEN
    RAISE EXCEPTION 'invalid_payout_release_alert_outcome'
      USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_alert
  FROM public.payout_release_alert_outbox
  WHERE id=p_alert_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_release_alert_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_alert.status<>'dispatching'
     OR v_alert.dispatch_claim_id IS DISTINCT FROM p_claim_id THEN
    RAISE EXCEPTION 'stale_payout_release_alert_claim' USING ERRCODE='P0001';
  END IF;

  IF v_alert.alert_kind = 'payout_refund_debt'
     AND v_alert.dispatch_claim_revision IS DISTINCT FROM v_alert.alert_revision THEN
    UPDATE public.payout_release_alert_outbox
    SET status='pending', dispatch_claim_id=NULL, dispatch_claimed_at=NULL,
        dispatch_claim_revision=NULL, updated_at=p_now
    WHERE id=p_alert_id;
    RETURN 'pending';
  END IF;

  UPDATE public.payout_release_alert_outbox
  SET status=CASE p_outcome
        WHEN 'provider_accepted' THEN 'provider_accepted'
        WHEN 'manual_review' THEN 'manual_review'
        ELSE 'pending'
      END,
      delivery_attempt_count=delivery_attempt_count+1,
      dispatch_claim_id=NULL,
      dispatch_claimed_at=NULL,
      dispatch_claim_revision=NULL,
      last_delivery_error=CASE
        WHEN p_outcome='provider_accepted' THEN NULL
        ELSE left(coalesce(p_error_message,'alert_delivery_failed'),1000)
      END,
      provider_accepted_at=CASE WHEN p_outcome='provider_accepted'
        THEN p_now ELSE provider_accepted_at END,
      updated_at=p_now
  WHERE id=p_alert_id;
  RETURN CASE p_outcome
    WHEN 'provider_accepted' THEN 'provider_accepted'
    WHEN 'manual_review' THEN 'manual_review'
    ELSE 'pending'
  END;
END;
$fn$;

-- Re-emit the guarded functions from their latest definitions.

CREATE OR REPLACE FUNCTION public.record_paystack_leg_plan(
  p_release_id uuid,
  p_claim_id uuid,
  p_legs jsonb,
  p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_leg jsonb;
  v_inserted integer:=0;
  v_first_chunk integer;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_release.paystack_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status<>'in_flight' THEN
    RAISE EXCEPTION 'stale_paystack_execution_claim' USING ERRCODE='P0001';
  END IF;
  IF jsonb_typeof(p_legs) <> 'array' THEN
    RAISE EXCEPTION 'paystack_leg_plan_must_be_array' USING ERRCODE='22023';
  END IF;

  SELECT coalesce(max(chunk_index)+1,0) INTO v_first_chunk
  FROM public.payout_transfer_legs WHERE release_id=p_release_id AND kind='organiser'
    AND refund_debt_superseded_at IS NOT NULL;

  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs)
  LOOP
    INSERT INTO public.payout_transfer_legs (
      release_id,
      partner_split_id,
      kind,
      chunk_index,
      principal_cents,
      estimated_fee_cents,
      stamp_duty_cents,
      fee_schedule_version
    ) VALUES (
      p_release_id,
      NULL,
      'organiser',
      v_first_chunk + (v_leg->>'chunk_index')::integer,
      (v_leg->>'principal_cents')::integer,
      (v_leg->>'estimated_fee_cents')::integer,
      (v_leg->>'stamp_duty_cents')::integer,
      coalesce(v_leg->>'fee_schedule_version','verified-2026-07-24')
    )
    ON CONFLICT (release_id, chunk_index) WHERE kind='organiser'
    DO NOTHING;
    IF FOUND THEN v_inserted:=v_inserted+1; END IF;
  END LOOP;
  RETURN v_inserted;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reconcile_paystack_transfer_leg_fee(
  p_leg_id uuid,
  p_actual_fee_cents integer,
  p_actual_stamp_cents integer,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_leg public.payout_transfer_legs;
  v_release public.brand_payout_releases;
  v_variance integer;
  v_kind text;
  v_outstanding integer;
  v_delivered integer;
  v_code text;
BEGIN
  SELECT * INTO v_leg
  FROM public.payout_transfer_legs
  WHERE id=p_leg_id AND kind='organiser'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_organiser_leg_not_found' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=v_leg.release_id AND provider='paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE='P0002';
  END IF;

  IF v_leg.refund_debt_superseded_at IS NOT NULL THEN
    RETURN 'superseded';
  END IF;

  -- Missing fee truth: mark fee_unreconciled + alert. Never charge Mingla.
  IF p_actual_fee_cents IS NULL THEN
    UPDATE public.payout_transfer_legs
    SET status='fee_unreconciled'
    WHERE id=p_leg_id
      AND reconciled_at IS NULL
      AND status NOT IN ('failed','reversed');
    UPDATE public.brand_payout_releases
    SET status='fee_unreconciled',
        error_message='paystack_transfer_fee_unreconciled',
        updated_at=p_now
    WHERE id=v_leg.release_id AND status IN ('in_flight','pending','blocked_balance');
    INSERT INTO public.payout_release_alert_outbox (
      release_id,alert_kind,idempotency_key,brand_id,error_message,
      created_at,updated_at
    ) VALUES (
      v_leg.release_id,'paystack_fee_unreconciled',
      'paystack_fee_unreconciled:'||v_leg.release_id::text,
      v_release.brand_id,'paystack_transfer_fee_unreconciled',p_now,p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    RETURN 'fee_unreconciled';
  END IF;

  -- Idempotent: an already-reconciled leg does not re-post its adjustment.
  IF v_leg.reconciled_at IS NOT NULL THEN
    RETURN 'already_reconciled';
  END IF;

  v_variance := (p_actual_fee_cents + coalesce(p_actual_stamp_cents,0))
    - (v_leg.estimated_fee_cents + v_leg.stamp_duty_cents);
  UPDATE public.payout_transfer_legs
  SET status='succeeded',
      actual_fee_cents=p_actual_fee_cents,
      actual_stamp_duty_cents=coalesce(p_actual_stamp_cents,0),
      fee_variance_cents=v_variance,
      reconciled_at=p_now
  WHERE id=p_leg_id;

  IF v_variance<>0 THEN
    v_kind := CASE WHEN v_variance>0 THEN 'transfer_fee_debit'
                   ELSE 'transfer_fee_credit' END;
    INSERT INTO public.payout_ledger_adjustments (
      release_id,brand_id,currency,kind,amount_cents,provider_ref,idempotency_key
    ) VALUES (
      v_leg.release_id,v_release.brand_id,v_release.currency,v_kind,
      abs(v_variance),v_leg.provider_transfer_code,
      'paystack-fee-reconcile:'||p_leg_id::text
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  -- Finalize the release once every organiser leg is succeeded AND reconciled.
  SELECT count(*)::integer INTO v_outstanding
  FROM public.payout_transfer_legs
  WHERE release_id=v_leg.release_id AND kind='organiser'
    AND refund_debt_superseded_at IS NULL
    AND NOT (status='succeeded' AND reconciled_at IS NOT NULL);
  IF v_outstanding=0 THEN
    SELECT coalesce(sum(principal_cents),0)::integer,
           (array_agg(provider_transfer_code ORDER BY chunk_index))[1]
      INTO v_delivered,v_code
    FROM public.payout_transfer_legs
    WHERE release_id=v_leg.release_id AND kind='organiser'
      AND status='succeeded';
    UPDATE public.brand_payout_releases
    SET status='released',
        released_at=p_now,
        organiser_cash_delivered_cents=v_delivered,
        paystack_transfer_code=coalesce(v_code,paystack_transfer_code),
        error_message=NULL,
        paystack_execution_claim_id=NULL,
        paystack_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=v_leg.release_id AND status<>'released';
    RETURN 'released';
  END IF;
  RETURN 'reconciled';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3645_record_release_claim_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_claim     uuid;
  v_provider  text;
  v_projected jsonb;
  v_withheld  bigint;
BEGIN
  -- A claim sets a new claim id (and the status, recredit) in one UPDATE.
  IF NEW.stripe_execution_claim_id IS NOT NULL
     AND NEW.stripe_execution_claim_id IS DISTINCT FROM OLD.stripe_execution_claim_id THEN
    v_claim := NEW.stripe_execution_claim_id;
    v_provider := 'stripe';
  ELSIF NEW.paystack_execution_claim_id IS NOT NULL
     AND NEW.paystack_execution_claim_id IS DISTINCT FROM OLD.paystack_execution_claim_id THEN
    v_claim := NEW.paystack_execution_claim_id;
    v_provider := 'paystack';
  END IF;

  IF v_claim IS NOT NULL THEN
    BEGIN
      BEGIN
        SELECT to_jsonb(t) INTO v_projected
          FROM public.issue_3645_release_projected_totals(NEW.id) t;
        v_withheld := public.issue_3645_release_effective_withheld(NEW.id);
      EXCEPTION WHEN OTHERS THEN
        -- The inputs read live are optional; the release's own columns are not.
        v_projected := NULL;
        v_withheld := NULL;
      END;
      INSERT INTO public.payout_release_claim_snapshots (
        release_id, brand_id, provider, claim_id, currency,
        gross_cents, refunded_cents, disputed_cents, mingla_fee_cents,
        partner_share_cents, provider_fee_cents,
        permanent_debt_withheld_cents, temporary_debt_withheld_cents,
        effective_withheld_cents, maturity_recredit_cents, net_release_cents,
        due_cents, projected, plan_reused
      ) VALUES (
        NEW.id, NEW.brand_id, v_provider, v_claim, NEW.currency,
        NEW.gross_cents, NEW.refunded_cents, NEW.disputed_cents, NEW.mingla_fee_cents,
        NEW.partner_share_cents, NEW.provider_fee_cents,
        NEW.permanent_debt_withheld_cents, NEW.temporary_debt_withheld_cents,
        v_withheld, NEW.maturity_recredit_cents, NEW.net_release_cents,
        COALESCE(NEW.net_release_cents, 0)::bigint + COALESCE(NEW.maturity_recredit_cents, 0)::bigint,
        v_projected,
        CASE WHEN v_provider = 'paystack' THEN EXISTS (
          SELECT 1 FROM public.payout_transfer_legs l
           WHERE l.release_id = NEW.id AND l.kind = 'organiser'
                      AND l.refund_debt_superseded_at IS NULL) END
      )
      ON CONFLICT (release_id, claim_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      -- Never block a payout for a record of it.
      RAISE WARNING 'issue_3645_claim_snapshot_failed: release % claim %: %',
        NEW.id, v_claim, SQLERRM;
    END;
  END IF;

  -- Leaving 'released' (a Stripe payout.failed): the link no longer holds.
  IF OLD.status = 'released' AND NEW.status IS DISTINCT FROM 'released' THEN
    NEW.paid_snapshot_id := NULL;
  END IF;

  -- Paid: link the snapshot of the claim that paid (see the header). Set on
  -- every move into 'released', never kept from an earlier payment.
  IF NEW.status = 'released' AND OLD.status IS DISTINCT FROM 'released' THEN
    NEW.paid_snapshot_id := NULL;
    BEGIN
      IF NEW.provider = 'paystack' THEN
        IF EXISTS (SELECT 1 FROM public.payout_transfer_legs l
                    WHERE l.release_id = NEW.id AND l.kind = 'organiser'
                      AND l.refund_debt_superseded_at IS NULL) THEN
          -- The claim the legs were planned under (a re-claim sends that
          -- plan unchanged): exactly that claim's snapshot, and only if the
          -- legs were planned from its due (the sweep plans the pool
          -- net + recredit into principal + fee + stamp). Legs planned before
          -- planned_claim_id existed, or a planning snapshot that was not
          -- recorded, leave the link null.
          SELECT s.id INTO NEW.paid_snapshot_id
            FROM public.payout_release_claim_snapshots s
           WHERE s.release_id = NEW.id AND s.provider = 'paystack'
             AND s.claim_id = (
                   SELECT l.planned_claim_id FROM public.payout_transfer_legs l
                    WHERE l.release_id = NEW.id AND l.kind = 'organiser'
                      AND l.refund_debt_superseded_at IS NULL
                    ORDER BY l.chunk_index LIMIT 1)
             AND s.due_cents = (
                   SELECT sum(l.principal_cents::bigint
                              + COALESCE(l.estimated_fee_cents, 0)
                              + COALESCE(l.stamp_duty_cents, 0))
                     FROM public.payout_transfer_legs l
                    WHERE l.release_id = NEW.id AND l.kind = 'organiser'
                      AND l.refund_debt_superseded_at IS NULL);
        ELSE
          -- Nothing planned (nothing to send): the claim being settled.
          SELECT s.id INTO NEW.paid_snapshot_id
            FROM public.payout_release_claim_snapshots s
           WHERE s.release_id = NEW.id AND s.provider = 'paystack'
             AND s.claim_id = COALESCE(OLD.paystack_execution_claim_id, NEW.paystack_execution_claim_id);
        END IF;
      ELSE
        SELECT s.id INTO NEW.paid_snapshot_id
          FROM public.payout_release_claim_snapshots s
         WHERE s.release_id = NEW.id
           AND s.provider = 'stripe'
           AND s.claim_id = COALESCE(OLD.stripe_execution_claim_id, NEW.stripe_execution_claim_id);
      END IF;
      IF NEW.paid_snapshot_id IS NULL THEN
        RAISE WARNING 'issue_3645_paid_snapshot_missing: release %', NEW.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NEW.paid_snapshot_id := NULL;
      RAISE WARNING 'issue_3645_paid_snapshot_link_failed: release %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

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
    WHERE l.kind='organiser' AND l.refund_debt_superseded_at IS NULL
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

COMMIT;

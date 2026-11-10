-- Issue #3645 bundle 4 — payout ledger follow-ups from bundle 2d (#4337).
--
-- 1. Matured value whose release already paid is carried to the brand's next
--    payable release. mature_postponement_debts used to book a
--    maturity_recredit on the paid release, which no claim ever takes, so the
--    host never got that money. A release that has not paid keeps 2d's
--    recredit: its items may no longer fund the value. Only the part a
--    Paystack transfer did not already send is carried. Placement runs inside
--    each provider's claim, under a lock all its claims take, just before the
--    claim reads recredits, so no claim can miss a placed value.
-- 2. A Paystack plan is never sent when it is larger than what its release
--    owes now. Organiser legs are planned from the pool at claim time; a hold
--    or refund that lowers the release afterwards used to be overpaid when the
--    release was claimed again and the old legs were reused. The release goes
--    back to pending with an ops alert instead, and the legs are kept (a leg
--    may already be at Paystack, so nothing is voided or re-planned).
-- 3. A release closed with its event before it was ever claimed hands back
--    the debt it withheld, so the debt is owed again and the next release
--    recovers it. Carried value placed on such a release moves on again. A
--    release that was ever claimed keeps both (a Stripe payout may exist
--    whose id was never recorded; a planned Paystack leg may be at Paystack).
--
-- Invariants and proofs: __tests__/issue_3645_payout_ledger_followups.pg17.test.sql.
-- Re-emits: __tests__/issue_3645_ledger_followup_reemit_hunks.ts.

BEGIN;

-- §1. A matured postponement debt's withheld value whose own release already
-- paid (so a recredit on it would never be paid). Append-only except for
-- placement (carried_*) and a single re-home (rehomed_at).
CREATE TABLE public.payout_maturity_carryovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  currency text NOT NULL CHECK (currency = lower(currency)),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  debt_id uuid NOT NULL
    REFERENCES public.organiser_payout_debts(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL
    REFERENCES public.payout_debt_applications(id) ON DELETE RESTRICT,
  source_release_id uuid NOT NULL
    REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  -- Set when a carrier was closed unpaid and the value moved on again.
  parent_carryover_id uuid
    REFERENCES public.payout_maturity_carryovers(id) ON DELETE RESTRICT,
  carried_release_id uuid
    REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  carried_at timestamptz,
  rehomed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_maturity_carryovers_carried_pair
    CHECK ((carried_release_id IS NULL) = (carried_at IS NULL)),
  CONSTRAINT payout_maturity_carryovers_rehome_after_carry
    CHECK (rehomed_at IS NULL OR carried_at IS NOT NULL)
);

-- One carryover per matured application, and one re-home per carryover.
CREATE UNIQUE INDEX payout_maturity_carryovers_application_once
  ON public.payout_maturity_carryovers (application_id)
  WHERE parent_carryover_id IS NULL;
CREATE UNIQUE INDEX payout_maturity_carryovers_parent_once
  ON public.payout_maturity_carryovers (parent_carryover_id)
  WHERE parent_carryover_id IS NOT NULL;
CREATE INDEX payout_maturity_carryovers_uncarried_idx
  ON public.payout_maturity_carryovers (brand_id, provider, currency)
  WHERE carried_at IS NULL;
CREATE INDEX payout_maturity_carryovers_carrier_idx
  ON public.payout_maturity_carryovers (carried_release_id)
  WHERE carried_release_id IS NOT NULL AND rehomed_at IS NULL;

CREATE OR REPLACE FUNCTION public.issue_3645_protect_maturity_carryover()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_maturity_carryovers is append-only'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.brand_id IS DISTINCT FROM OLD.brand_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.debt_id IS DISTINCT FROM OLD.debt_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.source_release_id IS DISTINCT FROM OLD.source_release_id
     OR NEW.parent_carryover_id IS DISTINCT FROM OLD.parent_carryover_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     -- carried_* is written once (NULL → value), rehomed_at likewise.
     OR (OLD.carried_release_id IS NOT NULL
         AND (NEW.carried_release_id IS DISTINCT FROM OLD.carried_release_id
              OR NEW.carried_at IS DISTINCT FROM OLD.carried_at))
     OR (OLD.rehomed_at IS NOT NULL
         AND NEW.rehomed_at IS DISTINCT FROM OLD.rehomed_at) THEN
    RAISE EXCEPTION 'payout_maturity_carryovers: only one placement and one re-home may be recorded'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER payout_maturity_carryovers_protect
  BEFORE UPDATE OR DELETE ON public.payout_maturity_carryovers
  FOR EACH ROW EXECUTE FUNCTION public.issue_3645_protect_maturity_carryover();

-- Only the SECURITY DEFINER functions below write it; service_role reads.
ALTER TABLE public.payout_maturity_carryovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_maturity_carryovers
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.payout_maturity_carryovers TO service_role;

-- §1b. Whether a release was ever claimed for a provider call. A Stripe
-- payout can be created and its id never recorded (a crash after the call),
-- and both claims clear their claim columns when they put a release back, so
-- the claim columns cannot say whether money may have moved. Rows that exist
-- before this migration have an unknown history and stay NULL (treated as
-- claimed); new rows start TRUE and the trigger sets FALSE on the first move
-- to in_flight. Nothing is rewritten, so no status trigger fires.
ALTER TABLE public.brand_payout_releases
  ADD COLUMN never_claimed boolean;
ALTER TABLE public.brand_payout_releases
  ALTER COLUMN never_claimed SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.issue_3645_mark_release_claimed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.status = 'in_flight' THEN
    NEW.never_claimed := false;
  ELSIF TG_OP = 'UPDATE' AND OLD.never_claimed IS DISTINCT FROM TRUE THEN
    -- Once claimed (or unknown), never unclaimed.
    NEW.never_claimed := OLD.never_claimed;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER brand_payout_releases_mark_claimed
  BEFORE INSERT OR UPDATE ON public.brand_payout_releases
  FOR EACH ROW EXECUTE FUNCTION public.issue_3645_mark_release_claimed();

-- §2. Returns get a third reason: the release was closed without paying.
ALTER TABLE public.payout_debt_application_returns
  DROP CONSTRAINT payout_debt_application_returns_reason_check;
ALTER TABLE public.payout_debt_application_returns
  ADD CONSTRAINT payout_debt_application_returns_reason_check
  CHECK (reason IN ('hold', 'matured', 'release_closed'));

-- §3. A new ops alert: a Paystack plan larger than what the release now owes.
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
    'stay_dispute_hold_open',
    'paystack_plan_exceeds_due'
  ));

-- §4. A release that was closed (cancelled with its event) and can never have
-- sent money: it was never claimed for a provider call, has no organiser leg
-- that is not failed or reversed, and no provider id. What it withheld or
-- carries can safely move on. A release that was ever claimed keeps both
-- (a Stripe payout may exist whose id was never recorded; a planned Paystack
-- leg may be waiting at Paystack on OTP).
CREATE OR REPLACE FUNCTION public.issue_3645_release_closed_unpaid(
  p_release_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.brand_payout_releases r
    WHERE r.id = p_release_id
      AND r.status = 'cancelled_event'
      AND r.never_claimed IS TRUE
      AND r.stripe_payout_id IS NULL
      AND r.paystack_transfer_code IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payout_transfer_legs leg
        WHERE leg.release_id = r.id
          AND leg.kind = 'organiser'
          AND leg.status NOT IN ('failed', 'reversed')
      )
  );
$fn$;

-- §5. A release that can take a carried value: one its provider's claim pays
-- (pending, under the attempt cap, its event not cancelled, not being sent)
-- and that was never claimed, so if it is closed before it pays, the value
-- can move on (§4). Placement runs inside that provider's claim, just before
-- the claim reads recredits, under a lock every claim of the provider takes,
-- so no claim can read a carrier without the value placed on it.
CREATE OR REPLACE FUNCTION public.issue_3645_release_can_carry(
  p_release_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.brand_payout_releases r
    WHERE r.id = p_release_id
      AND r.status = 'pending'
      AND r.never_claimed IS TRUE
      AND r.attempt_count < 10
      AND r.stripe_payout_id IS NULL
      AND r.paystack_transfer_code IS NULL
      AND (
        r.event_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id = r.event_id AND e.status <> 'cancelled'
        )
      )
      -- Not held by a dispute: the Stripe claim skips an open stay dispute and
      -- Paystack authorize refuses an unresolved one, so value placed there
      -- would wait while a payable release goes without it.
      AND NOT public.issue_3645_stay_release_has_open_dispute(r.id)
      AND NOT public.paystack_release_has_unresolved_dispute(r.id)
      AND public.issue_3645_release_settleable(r.id)
  );
$fn$;

-- §5b. What a release can still take before net + recredits leaves the
-- integer range both claims and the Stripe payout amount use. Placement
-- never pushes a carrier past it; the value goes to another carrier.
CREATE OR REPLACE FUNCTION public.issue_3645_release_carry_room(
  p_release_id uuid
) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT 2147483647::bigint - r.net_release_cents::bigint - coalesce((
    SELECT sum(a.amount_cents)
    FROM public.payout_ledger_adjustments a
    WHERE a.release_id = r.id AND a.kind = 'maturity_recredit'
  ), 0)
  FROM public.brand_payout_releases r
  WHERE r.id = p_release_id;
$fn$;

-- §5c. A Paystack release's kept organiser plan (every leg not failed or
-- reversed, principal + fee + stamp), the total authorize compares with what
-- the release owes.
CREATE OR REPLACE FUNCTION public.issue_3645_paystack_plan_cents(
  p_release_id uuid
) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT coalesce(sum(
    leg.principal_cents::bigint + leg.estimated_fee_cents + leg.stamp_duty_cents
  ), 0)
  FROM public.payout_transfer_legs leg
  WHERE leg.release_id = p_release_id
    AND leg.kind = 'organiser'
    AND leg.status NOT IN ('failed', 'reversed');
$fn$;

-- §5d. What a release owes now: net plus recredits (bigint).
CREATE OR REPLACE FUNCTION public.issue_3645_release_due_cents(
  p_release_id uuid
) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT r.net_release_cents::bigint + coalesce((
    SELECT sum(a.amount_cents)
    FROM public.payout_ledger_adjustments a
    WHERE a.release_id = r.id AND a.kind = 'maturity_recredit'
  ), 0)
  FROM public.brand_payout_releases r
  WHERE r.id = p_release_id;
$fn$;

-- §5e. Tell ops about every claimable Paystack release whose kept organiser
-- plan is larger than it now owes. The Paystack claim leaves those out
-- (unless a leg still needs reconciling), so authorize, the other writer of
-- this alert, never sees them. One alert per release (the outbox key); the
-- release keeps the reason in error_message. Busy releases are skipped and
-- flagged on a later claim.
CREATE OR REPLACE FUNCTION public.issue_3645_flag_oversized_paystack_plans(
  p_now timestamptz
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_rel record;
  v_flagged integer := 0;
BEGIN
  FOR v_rel IN
    SELECT r.id, r.brand_id,
      public.issue_3645_paystack_plan_cents(r.id) AS plan_cents,
      public.issue_3645_release_due_cents(r.id) AS due_cents
    FROM public.brand_payout_releases r
    WHERE r.provider = 'paystack'
      AND r.paystack_transfer_code IS NULL
      AND r.status IN (
        'pending', 'blocked_balance', 'blocked_otp', 'blocked_over_cap',
        'fee_unreconciled'
      )
      AND EXISTS (
        SELECT 1 FROM public.payout_transfer_legs leg
        WHERE leg.release_id = r.id AND leg.kind = 'organiser'
          AND leg.status NOT IN ('failed', 'reversed')
      )
      AND public.issue_3645_paystack_plan_cents(r.id)
        > public.issue_3645_release_due_cents(r.id)
    ORDER BY r.id
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    INSERT INTO public.payout_release_alert_outbox (
      release_id, alert_kind, idempotency_key, brand_id, error_message,
      created_at, updated_at
    ) VALUES (
      v_rel.id, 'paystack_plan_exceeds_due',
      'paystack_plan_exceeds_due:' || v_rel.id::text, v_rel.brand_id,
      left(format('plan %s > due %s', v_rel.plan_cents, v_rel.due_cents), 1000),
      p_now, p_now
    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;
    UPDATE public.brand_payout_releases
    SET error_message = 'paystack_plan_exceeds_due', updated_at = p_now
    WHERE id = v_rel.id
      AND error_message IS DISTINCT FROM 'paystack_plan_exceeds_due';
    v_flagged := v_flagged + 1;
  END LOOP;
  RETURN v_flagged;
END;
$fn$;

-- §6. Hand back what a closed, unpaid release withheld, so the debt is owed
-- again and the next release recovers it. Locks never wait (SKIP LOCKED and
-- NOWAIT): a busy release or debt is retried on the next sweep tick.
CREATE OR REPLACE FUNCTION public.issue_3645_return_closed_release_debt(
  p_now timestamptz DEFAULT now()
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_rel record;
  v_app record;
  v_return_id uuid;
  v_total bigint := 0;
BEGIN
  FOR v_rel IN
    SELECT r.id
    FROM public.brand_payout_releases r
    WHERE r.status = 'cancelled_event'
      AND EXISTS (
        SELECT 1 FROM public.payout_debt_applications a
        WHERE a.release_id = r.id
          AND a.released_at IS NULL
          AND a.amount_cents - a.converted_cents
            - public.issue_3645_application_returned_cents(a.id) > 0
      )
      AND public.issue_3645_release_closed_unpaid(r.id)
    ORDER BY r.id
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    -- Same lock order as the returner: release, then debts by id.
    BEGIN
      PERFORM 1 FROM public.organiser_payout_debts d
      WHERE d.id IN (
        SELECT a.debt_id FROM public.payout_debt_applications a
        WHERE a.release_id = v_rel.id
      )
      ORDER BY d.id
      FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      CONTINUE;
    END;
    -- Re-check under the release lock (a later status write may have won).
    CONTINUE WHEN NOT public.issue_3645_release_closed_unpaid(v_rel.id);

    FOR v_app IN
      SELECT
        a.id, a.debt_id,
        a.amount_cents - a.converted_cents
          - public.issue_3645_application_returned_cents(a.id) AS effective
      FROM public.payout_debt_applications a
      WHERE a.release_id = v_rel.id
        AND a.released_at IS NULL
      ORDER BY a.id
      FOR UPDATE OF a
    LOOP
      CONTINUE WHEN v_app.effective <= 0;

      v_return_id := NULL;
      INSERT INTO public.payout_debt_application_returns(
        application_id, debt_id, release_id, reason, amount_cents,
        idempotency_key, created_at
      ) VALUES (
        v_app.id, v_app.debt_id, v_rel.id, 'release_closed', v_app.effective,
        'debt-close-return:' || v_app.id, p_now
      ) ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id INTO v_return_id;
      CONTINUE WHEN v_return_id IS NULL;

      -- Owed again, exactly as the returner does it.
      UPDATE public.organiser_payout_debts SET
        recovered_cents = recovered_cents - v_app.effective,
        status = CASE
          WHEN kind <> 'post_release_postponement' AND status = 'closed'
            THEN 'open'
          ELSE status
        END,
        closed_at = CASE
          WHEN kind <> 'post_release_postponement' AND status = 'closed'
            THEN NULL
          ELSE closed_at
        END,
        updated_at = p_now
      WHERE id = v_app.debt_id;

      INSERT INTO public.payout_debt_events(
        debt_id, event_kind, amount_cents, release_id, idempotency_key, created_at
      ) VALUES (
        v_app.debt_id, 'recovery_returned', v_app.effective, v_rel.id,
        'debt-returned:' || v_return_id, p_now
      );

      v_total := v_total + v_app.effective;
    END LOOP;
  END LOOP;

  RETURN v_total;
END;
$fn$;

-- §7. Place a provider's carried value on each brand's next payable release
-- (same brand, provider and currency), and move it on again if that release
-- was closed before any claim. Called only by that provider's claim (below),
-- under the claim's lock and before the claim reads recredits. A placed
-- carryover is an ordinary maturity_recredit on its carrier: the claim pays
-- it (net + recredits) and the float forecast counts it; the host screen
-- shows it from the claim on (it reads the claim-time column). Until placed,
-- a carryover is visible only in this table (bundle 2e makes the payout
-- screen add up, and shows it). Carriers are locked SKIP LOCKED.
CREATE OR REPLACE FUNCTION public.issue_3645_place_maturity_carryovers(
  p_now timestamptz,
  p_provider text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_c public.payout_maturity_carryovers%ROWTYPE;
  v_target uuid;
  v_placed integer := 0;
BEGIN
  -- A carrier that was closed unpaid never pays its recredit: re-home the
  -- value as a new carryover. The old recredit stays as history on a release
  -- no claim takes.
  FOR v_c IN
    SELECT c.*
    FROM public.payout_maturity_carryovers c
    WHERE c.provider = p_provider
      AND c.carried_release_id IS NOT NULL
      AND c.rehomed_at IS NULL
      AND public.issue_3645_release_closed_unpaid(c.carried_release_id)
    ORDER BY c.created_at, c.id
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    INSERT INTO public.payout_maturity_carryovers(
      brand_id, provider, currency, amount_cents, debt_id, application_id,
      source_release_id, parent_carryover_id, created_at
    ) VALUES (
      v_c.brand_id, v_c.provider, v_c.currency, v_c.amount_cents, v_c.debt_id,
      v_c.application_id, v_c.source_release_id, v_c.id, p_now
    ) ON CONFLICT (parent_carryover_id) WHERE parent_carryover_id IS NOT NULL
      DO NOTHING;
    UPDATE public.payout_maturity_carryovers
    SET rehomed_at = p_now
    WHERE id = v_c.id;
  END LOOP;

  FOR v_c IN
    SELECT c.*
    FROM public.payout_maturity_carryovers c
    WHERE c.provider = p_provider
      AND c.carried_at IS NULL
    ORDER BY c.created_at, c.id
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    v_target := NULL;
    SELECT r.id INTO v_target
    FROM public.brand_payout_releases r
    WHERE r.brand_id = v_c.brand_id
      AND r.provider = v_c.provider
      AND r.currency = v_c.currency
      AND public.issue_3645_release_can_carry(r.id)
      AND public.issue_3645_release_carry_room(r.id) >= v_c.amount_cents
      -- A Paystack carrier must end up with a pool the transfer planner
      -- sends (planOrganiserTransferChunks defers a pool under 5000 kobo,
      -- and a deferred release is claimed and can no longer pass the value
      -- on). Pinned to engine.ts by the bundle 4 sweep test.
      AND (v_c.provider <> 'paystack'
           OR public.issue_3645_release_due_cents(r.id) + v_c.amount_cents >= 5000)
    ORDER BY r.releasable_at, r.created_at, r.id
    FOR UPDATE OF r SKIP LOCKED
    LIMIT 1;
    CONTINUE WHEN v_target IS NULL;
    -- Re-check under the lock: a claim may have taken it since.
    CONTINUE WHEN NOT public.issue_3645_release_can_carry(v_target)
      OR public.issue_3645_release_carry_room(v_target) < v_c.amount_cents
      OR (v_c.provider = 'paystack'
          AND public.issue_3645_release_due_cents(v_target) + v_c.amount_cents < 5000);

    INSERT INTO public.payout_ledger_adjustments(
      release_id, brand_id, currency, kind, amount_cents, idempotency_key,
      created_at
    ) VALUES (
      v_target, v_c.brand_id, v_c.currency, 'maturity_recredit',
      v_c.amount_cents, 'carryover-recredit:' || v_c.id, p_now
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    UPDATE public.payout_maturity_carryovers
    SET carried_release_id = v_target, carried_at = p_now
    WHERE id = v_c.id;
    v_placed := v_placed + 1;
  END LOOP;

  RETURN v_placed;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_protect_maturity_carryover()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_mark_release_claimed()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_release_closed_unpaid(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_release_can_carry(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_release_carry_room(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_paystack_plan_cents(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_flag_oversized_paystack_plans(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_release_due_cents(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_return_closed_release_debt(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_place_maturity_carryovers(timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_release_closed_unpaid(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_release_can_carry(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_release_carry_room(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_paystack_plan_cents(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_flag_oversized_paystack_plans(timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_release_due_cents(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_return_closed_release_debt(timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_place_maturity_carryovers(timestamptz, text)
  TO service_role;


-- ---- mature_postponement_debts (source and hunks: __tests__/issue_3645_ledger_followup_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.mature_postponement_debts(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_debt record; v_app record; v_recredit integer; v_count integer:=0;
  v_return_id uuid;  -- #3645 2d
  v_source public.brand_payout_releases;  -- #3645 bundle 4
  v_carry integer;  -- #3645 bundle 4
  v_sent bigint;  -- #3645 bundle 4
BEGIN
  -- #3645 bundle 4: a release closed before it was ever claimed hands back
  -- what it withheld first, so maturity below sees it as no longer withheld.
  -- Its own failure never stops maturity or the sweep: it retries next tick.
  BEGIN
    PERFORM public.issue_3645_return_closed_release_debt(p_now);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue_3645_return_closed_failed sqlstate=% message=%',
      SQLSTATE, SQLERRM;
  END;
  FOR v_debt IN
    SELECT * FROM public.organiser_payout_debts
     WHERE kind='post_release_postponement' AND status='open' AND maturity_at<=p_now
     ORDER BY maturity_at,id FOR UPDATE SKIP LOCKED
  LOOP
    -- #3645 2d: every release this debt touches is locked up front, without
    -- waiting (the returner locks release, then debt). If one is busy, or a
    -- payout is in flight on it, nothing of this debt is done this tick:
    -- no released_at, no recredit, no return, no writeoff, no close.
    BEGIN
      PERFORM 1 FROM public.brand_payout_releases r
      WHERE r.id IN (
        SELECT a.release_id FROM public.payout_debt_applications a
        WHERE a.debt_id=v_debt.id AND a.released_at IS NULL
      )
      ORDER BY r.id FOR UPDATE NOWAIT;
      -- and every debt withheld from those releases, so settling them below
      -- never waits on another transaction.
      PERFORM 1 FROM public.organiser_payout_debts d
      WHERE d.id IN (
        SELECT a2.debt_id FROM public.payout_debt_applications a2
        WHERE a2.release_id IN (
          SELECT a.release_id FROM public.payout_debt_applications a
          WHERE a.debt_id=v_debt.id AND a.released_at IS NULL
        )
      )
      ORDER BY d.id FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      CONTINUE;
    END;
    IF EXISTS (
      SELECT 1 FROM public.payout_debt_applications a
      JOIN public.brand_payout_releases r ON r.id=a.release_id
      WHERE a.debt_id=v_debt.id AND a.released_at IS NULL
        AND (r.status='in_flight'
             -- An ambiguous Paystack outcome puts the release back to
             -- pending but leaves its organiser leg in flight, and the
             -- re-claim reuses that leg: a recredit booked now would not be
             -- in it. Wait until the transfer is reconciled.
             OR EXISTS (
               SELECT 1 FROM public.payout_transfer_legs leg
               WHERE leg.release_id=r.id AND leg.kind='organiser'
                 AND leg.status='in_flight'
             ))
    ) THEN
      CONTINUE;
    END IF;
    -- #3645 2d: settle each unpaid release first, so the part holds left
    -- uncovered is handed back as a 'hold' return (and written off below)
    -- before maturity hands the rest back through net. Maturity and settle
    -- then end in the same state whichever runs first.
    PERFORM public.issue_3645_return_unrecovered_release_debt(x.release_id, p_now)
    FROM (
      SELECT DISTINCT a.release_id FROM public.payout_debt_applications a
      WHERE a.debt_id=v_debt.id AND a.released_at IS NULL
    ) x;
    -- Store the settled projection on each of those unpaid releases now: a
    -- hand-back above may leave nothing for maturity to return below, and a
    -- blocked release is claimed (Stripe) without the planner re-projecting.
    UPDATE public.brand_payout_releases r SET
      refunded_cents=projected.refunded_cents,
      disputed_cents=projected.disputed_cents,
      net_release_cents=projected.net_release_cents,
      updated_at=p_now
    FROM (
      SELECT DISTINCT a.release_id FROM public.payout_debt_applications a
      WHERE a.debt_id=v_debt.id AND a.released_at IS NULL
    ) x
    CROSS JOIN LATERAL public.issue_3645_release_projected_totals(x.release_id) projected
    WHERE r.id=x.release_id AND public.issue_3645_release_settleable(r.id);
    SELECT * INTO v_debt FROM public.organiser_payout_debts WHERE id=v_debt.id;
    FOR v_app IN
      SELECT * FROM public.payout_debt_applications
      WHERE debt_id=v_debt.id AND released_at IS NULL
      ORDER BY created_at,id FOR UPDATE
    LOOP
      -- #3645 2d: what this application still withholds.
      v_recredit:=v_app.amount_cents-v_app.converted_cents
        -public.issue_3645_application_returned_cents(v_app.id);
      IF v_recredit>0 AND public.issue_3645_release_settleable(v_app.release_id) THEN
        -- #3645 2d: the release is unpaid, so hand the withheld part back
        -- through net (a 'matured' return) instead of booking a recredit on
        -- top: net = max(0, N − W) cannot overpay when holds shrank N, and a
        -- recredit can. recovered_cents is NOT lowered: the debt is closed
        -- below and its writeoff stays principal − recovered as read above.
        INSERT INTO public.payout_debt_application_returns(
          application_id,debt_id,release_id,reason,amount_cents,idempotency_key,created_at
        ) VALUES(
          v_app.id,v_debt.id,v_app.release_id,'matured',v_recredit,
          'postpone-return:'||v_app.id,p_now
        ) ON CONFLICT(idempotency_key) DO NOTHING
        RETURNING id INTO v_return_id;
        IF v_return_id IS NOT NULL THEN
          UPDATE public.brand_payout_releases r SET
            net_release_cents=projected.net_release_cents,updated_at=p_now
          FROM public.issue_3645_release_projected_totals(v_app.release_id) projected
          WHERE r.id=v_app.release_id;
          INSERT INTO public.payout_debt_events(
            debt_id,event_kind,amount_cents,anchor_at,release_id,idempotency_key
          ) VALUES(
            v_debt.id,'future_value_released',v_recredit,v_debt.maturity_at,
            v_app.release_id,'postpone-released:'||v_app.id
          ) ON CONFLICT(idempotency_key) DO NOTHING;
        END IF;
      ELSIF v_recredit>0 THEN
        -- #3645 bundle 4: a recredit on a release that already paid is never
        -- paid (no claim takes a paid release), so carry the value to the
        -- brand's next payable release. Only the part its transfers did not
        -- already send: a Paystack plan made before this value was withheld
        -- can hold some of it. Every organiser leg not failed or reversed
        -- counts as sent (a confirmed transfer still waiting on its fee is
        -- fee_unreconciled; a planned leg goes out once the recredit left
        -- below covers it), the same rule authorize uses. A release that has not paid (closed after a
        -- claim, failed, or holding a fixed Paystack plan) carries nothing:
        -- its items may no longer fund the value. What is not carried stays
        -- 2d's recredit on the release, so the ledger still adds up.
        SELECT * INTO v_source FROM public.brand_payout_releases
        WHERE id=v_app.release_id;
        v_carry:=0;
        IF v_source.status IN ('released','fee_unreconciled') THEN
          SELECT coalesce(sum(
            leg.principal_cents::bigint+leg.estimated_fee_cents+leg.stamp_duty_cents
          ),0) INTO v_sent
          FROM public.payout_transfer_legs leg
          WHERE leg.release_id=v_app.release_id AND leg.kind='organiser'
            AND leg.status NOT IN ('failed','reversed');
          v_carry:=greatest(0,least(v_recredit::bigint,
            v_recredit::bigint-greatest(0,v_sent-(
              v_source.net_release_cents::bigint+coalesce((
                SELECT sum(adj.amount_cents) FROM public.payout_ledger_adjustments adj
                WHERE adj.release_id=v_app.release_id AND adj.kind='maturity_recredit'
              ),0)
            ))
          ))::integer;
        END IF;
        IF v_carry>0 THEN
          INSERT INTO public.payout_maturity_carryovers(
            brand_id,provider,currency,amount_cents,debt_id,application_id,
            source_release_id,created_at
          ) VALUES(
            v_debt.brand_id,v_source.provider,v_debt.currency,v_carry,
            v_debt.id,v_app.id,v_app.release_id,p_now
          ) ON CONFLICT(application_id) WHERE parent_carryover_id IS NULL
            DO NOTHING;
        END IF;
        IF v_recredit-v_carry>0 THEN
        INSERT INTO public.payout_ledger_adjustments(
          release_id,brand_id,currency,kind,amount_cents,idempotency_key
        ) VALUES(
          v_app.release_id,v_debt.brand_id,v_debt.currency,'maturity_recredit',
          v_recredit-v_carry,'postpone-recredit:'||v_app.id
        ) ON CONFLICT(idempotency_key) DO NOTHING;
        END IF;
        INSERT INTO public.payout_debt_events(
          debt_id,event_kind,amount_cents,anchor_at,release_id,idempotency_key
        ) VALUES(
          v_debt.id,'future_value_released',v_recredit,v_debt.maturity_at,
          v_app.release_id,'postpone-released:'||v_app.id
        ) ON CONFLICT(idempotency_key) DO NOTHING;
      END IF;
      UPDATE public.payout_debt_applications SET released_at=p_now WHERE id=v_app.id;
    END LOOP;
    IF v_debt.principal_cents>v_debt.recovered_cents THEN
      INSERT INTO public.payout_ledger_adjustments(
        release_id,brand_id,currency,kind,amount_cents,idempotency_key
      ) VALUES(
        v_debt.origin_release_id,v_debt.brand_id,v_debt.currency,'debt_writeoff',
        v_debt.principal_cents-v_debt.recovered_cents,'postpone-close:'||v_debt.id
      ) ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
    UPDATE public.organiser_payout_debts SET
      recovered_cents=0,status='closed',closed_at=p_now,updated_at=p_now
     WHERE id=v_debt.id;
    INSERT INTO public.payout_debt_events(debt_id,event_kind,amount_cents,anchor_at,idempotency_key)
    VALUES(
      v_debt.id,'cleared',v_debt.recovered_cents,v_debt.maturity_at,
      'postpone-cleared:'||v_debt.id||':'||
        extract(epoch from v_debt.maturity_at)::bigint
    )
    ON CONFLICT DO NOTHING;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$fn$;


-- ---- authorize_paystack_payout_execution (source and hunks: __tests__/issue_3645_ledger_followup_reemit_hunks.ts)
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

  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.authorize_paystack_payout_execution(
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_paystack_payout_execution(
  uuid, uuid, timestamptz
) TO service_role;


-- ---- claim_payout_release_alerts (source and hunks: __tests__/issue_3645_ledger_followup_reemit_hunks.ts)
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
        'paystack_plan_exceeds_due'  -- issue #3645 bundle 4
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


-- ---- claim_paystack_payout_releases (source and hunks: __tests__/issue_3645_ledger_followup_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.claim_paystack_payout_releases(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  release_id uuid,
  brand_id uuid,
  recipient_code text,
  currency text,
  net_release_cents integer,
  maturity_recredit_cents integer,
  attempt_count integer,
  claim_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- #3645 bundle 4: every Paystack claim takes this lock, then places carried
  -- maturity value on payable releases, then reads recredits below in a
  -- later statement. A value placed by one claim is therefore in the
  -- snapshot of the next; no claim reads a carrier without it. Placement
  -- failing never stops the claim: the value waits for the next one.
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_3645_claim:paystack', 0));
  BEGIN
    PERFORM public.issue_3645_place_maturity_carryovers(p_now, 'paystack');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue_3645_place_carryovers_failed provider=paystack sqlstate=% message=%',
      SQLSTATE, SQLERRM;
  END;
  -- #3645 bundle 4: alert ops about releases left out below for a kept plan
  -- larger than they owe (authorize never sees those).
  BEGIN
    PERFORM public.issue_3645_flag_oversized_paystack_plans(p_now);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue_3645_flag_oversized_plans_failed sqlstate=% message=%',
      SQLSTATE, SQLERRM;
  END;
  RETURN QUERY
  WITH eligible AS (
    SELECT
      r.id,
      least(coalesce((
        SELECT sum(a.amount_cents)
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0), 2147483647::bigint)::integer AS recredit
    FROM public.brand_payout_releases r
    JOIN public.brand_paystack_recipients rec
      ON rec.brand_id=r.brand_id AND rec.is_active
    WHERE r.provider='paystack'
      AND r.paystack_transfer_code IS NULL
      AND r.attempt_count<10
      AND r.releasable_at<=p_now
      -- #3645 PR9: skip admin-paused brands (money accrues, released on resume).
      AND NOT EXISTS (
        SELECT 1 FROM public.brand_payout_admin_holds h
        WHERE h.brand_id=r.brand_id
      )
      AND (
        r.status IN (
          'pending','blocked_balance','blocked_otp','blocked_over_cap',
          'fee_unreconciled'
        )
        OR (
          r.status='in_flight'
          AND r.paystack_execution_claimed_at < p_now-interval '10 minutes'
        )
      )
      AND (
        r.event_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id=r.event_id AND e.status<>'cancelled'
        )
      )
      -- Due test in bigint (see claim_stripe_payout_releases): avoid an int4
      -- overflow on net_release_cents + the clamped recredit aborting the RPC.
      AND r.net_release_cents::bigint + least(coalesce((
        SELECT sum(a.amount_cents)
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0), 2147483647::bigint) > 0
      -- #3645 bundle 4: authorize refuses a kept organiser plan larger than
      -- the release now owes. Leave such a release out before the LIMIT until
      -- it owes the plan again, so refused releases never fill every slot,
      -- unless a leg still needs reconciling (sent and not settled): the
      -- sweep's reconcile-first must still reach it. Ops are alerted above.
      AND (
        public.issue_3645_paystack_plan_cents(r.id)
          <= public.issue_3645_release_due_cents(r.id)
        OR EXISTS (
          SELECT 1 FROM public.payout_transfer_legs leg
          WHERE leg.release_id=r.id AND leg.kind='organiser'
            AND leg.status IN ('in_flight','fee_unreconciled')
        )
      )
    ORDER BY r.releasable_at,r.created_at,r.id
    FOR UPDATE OF r SKIP LOCKED
    LIMIT greatest(1,least(p_limit,100))
  ),
  claimed AS (
    UPDATE public.brand_payout_releases r
    SET status='in_flight',
        maturity_recredit_cents=eligible.recredit,
        paystack_execution_claim_id=gen_random_uuid(),
        paystack_execution_claimed_at=p_now,
        error_message=NULL,
        updated_at=p_now
    FROM eligible
    WHERE r.id=eligible.id
    RETURNING r.*
  )
  SELECT
    c.id,
    c.brand_id,
    rec.recipient_code,
    c.currency,
    c.net_release_cents,
    c.maturity_recredit_cents,
    c.attempt_count,
    c.paystack_execution_claim_id
  FROM claimed c
  JOIN public.brand_paystack_recipients rec
    ON rec.brand_id=c.brand_id AND rec.is_active
  ORDER BY c.releasable_at,c.created_at,c.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_paystack_payout_releases(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_payout_releases(integer,timestamptz)
  TO service_role;


-- ---- claim_stripe_payout_releases (source and hunks: __tests__/issue_3645_ledger_followup_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.claim_stripe_payout_releases(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  release_id uuid,
  brand_id uuid,
  stripe_account_id text,
  currency text,
  net_release_cents integer,
  maturity_recredit_cents integer,
  attempt_count integer,
  claim_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- #3645 bundle 4: every Stripe claim takes this lock, then places carried
  -- maturity value on payable releases, then reads recredits below in a
  -- later statement. A value placed by one claim is therefore in the
  -- snapshot of the next; no claim reads a carrier without it. Placement
  -- failing never stops the claim: the value waits for the next one.
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_3645_claim:stripe', 0));
  BEGIN
    PERFORM public.issue_3645_place_maturity_carryovers(p_now, 'stripe');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue_3645_place_carryovers_failed provider=stripe sqlstate=% message=%',
      SQLSTATE, SQLERRM;
  END;
  RETURN QUERY
  WITH eligible AS (
    SELECT
      r.id,
      least(coalesce((
        SELECT sum(a.amount_cents)
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0), 2147483647::bigint)::integer AS recredit
    FROM public.brand_payout_releases r
    JOIN public.stripe_connect_accounts sca
      ON sca.brand_id=r.brand_id
     AND sca.detached_at IS NULL
     AND sca.payouts_enabled IS TRUE
    WHERE r.provider='stripe'
      AND r.stripe_payout_id IS NULL
      AND r.attempt_count<10
      AND r.releasable_at<=p_now
      -- #3645 PR9: an admin-paused brand's mature money stays pending (never
      -- claimed); it keeps accruing and the next sweep claims it after resume.
      AND NOT EXISTS (
        SELECT 1 FROM public.brand_payout_admin_holds h
        WHERE h.brand_id=r.brand_id
      )
      -- #3645: a stay release held by an open dispute waits without taking
      -- one of the claim slots, so it cannot starve newer payouts.
      AND NOT public.issue_3645_stay_release_has_open_dispute(r.id)
      AND (
        r.status IN ('pending','blocked_kyc','blocked_balance')
        OR (
          r.status='in_flight'
          AND r.stripe_execution_claimed_at < p_now-interval '10 minutes'
        )
      )
      AND (
        r.event_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id=r.event_id AND e.status<>'cancelled'
        )
      )
      -- Due test in bigint: net_release_cents (integer) + the already-clamped
      -- bigint recredit must not be summed as two integers, or a combined due
      -- over int4 max would raise integer overflow and abort the whole claim
      -- RPC (stalling unrelated payouts in the sweep). bigint the predicate.
      AND r.net_release_cents::bigint + least(coalesce((
        SELECT sum(a.amount_cents)
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0), 2147483647::bigint) > 0
    ORDER BY r.releasable_at,r.created_at,r.id
    FOR UPDATE OF r SKIP LOCKED
    LIMIT greatest(1,least(p_limit,100))
  ),
  claimed AS (
    UPDATE public.brand_payout_releases r
    SET status='in_flight',
        maturity_recredit_cents=eligible.recredit,
        stripe_execution_claim_id=gen_random_uuid(),
        stripe_execution_claimed_at=p_now,
        error_message=NULL,
        updated_at=p_now
    FROM eligible
    WHERE r.id=eligible.id
    RETURNING r.*
  )
  SELECT
    c.id,
    c.brand_id,
    sca.stripe_account_id,
    c.currency,
    c.net_release_cents,
    c.maturity_recredit_cents,
    c.attempt_count,
    c.stripe_execution_claim_id
  FROM claimed c
  JOIN public.stripe_connect_accounts sca
    ON sca.brand_id=c.brand_id
   AND sca.detached_at IS NULL
   AND sca.payouts_enabled IS TRUE
  ORDER BY c.releasable_at,c.created_at,c.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_stripe_payout_releases(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_payout_releases(integer,timestamptz)
  TO service_role;


-- ---- private.host_account_deletion_blockers (source and hunks: __tests__/issue_3645_ledger_followup_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION private.host_account_deletion_blockers(
  p_user_id uuid,
  p_brand_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand_ids uuid[] := COALESCE(p_brand_ids, ARRAY[]::uuid[]);
  v_event_ids uuid[];
  v_blockers jsonb := '[]'::jsonb;
  v_ids uuid[];
  v_count integer;
BEGIN
  -- Live or upcoming: copied from issue_2063_guard_brand_soft_delete so the set
  -- the deletion takes down is always a superset of the set that guard counts.
  SELECT COALESCE(array_agg(e.id), ARRAY[]::uuid[])
  INTO v_event_ids
  FROM public.events e
  WHERE e.brand_id = ANY (v_brand_ids)
    AND e.deleted_at IS NULL
    AND e.status IN ('scheduled', 'live')
    AND EXISTS (
      SELECT 1 FROM public.event_dates d
      WHERE d.event_id = e.id
        AND d.end_at > statement_timestamp()
    );

  -- tickets_sold -------------------------------------------------------------
  SELECT COALESCE(array_agg(e.id ORDER BY e.id), ARRAY[]::uuid[])
  INTO v_ids
  FROM public.events e
  WHERE e.id = ANY (v_event_ids)
    AND (
      EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.event_id = e.id
          AND o.payment_status IN ('paid', 'partial_refund', 'pending')
      )
      OR EXISTS (
        SELECT 1 FROM public.tickets t
        WHERE t.event_id = e.id
          AND t.status IN ('valid', 'used', 'transferred', 'refund_pending')
      )
      OR EXISTS (
        SELECT 1 FROM public.event_rsvps r
        WHERE r.event_id = e.id
          AND r.rsvp_status IN ('going', 'waitlisted')
          AND r.approval_status IN ('approved', 'pending')
      )
      OR EXISTS (
        SELECT 1 FROM public.event_rsvp_contributions c
        WHERE c.event_id = e.id
          AND c.status IN ('paid', 'partially_refunded')
      )
    );
  IF cardinality(v_ids) > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tickets_sold',
      'count', cardinality(v_ids),
      'items', (
        SELECT COALESCE(jsonb_agg(x.item ORDER BY x.id), '[]'::jsonb)
        FROM (
          SELECT e.id, jsonb_build_object('id', e.id, 'title', e.title) AS item
          FROM public.events e
          WHERE e.id = ANY (v_ids)
          ORDER BY e.id
          LIMIT 5
        ) x
      )
    ));
  END IF;

  -- checkout_in_progress -----------------------------------------------------
  SELECT COALESCE(array_agg(e.id ORDER BY e.id), ARRAY[]::uuid[])
  INTO v_ids
  FROM public.events e
  WHERE e.id = ANY (v_event_ids)
    AND EXISTS (
      SELECT 1 FROM public.ticket_checkout_sessions s
      WHERE s.event_id = e.id
        AND (
          (
            s.status IN (
              'pending_free', 'requires_payment',
              'awaiting_web_redirect', 'processing_payment'
            )
            AND s.expires_at > now()
          )
          -- A payment the provider is processing right now still finalises
          -- into a paid order after the session's expiry time has passed
          -- (the finalize path does not look at expires_at). It counts for as
          -- long as it is unresolved. The other open statuses do NOT count
          -- once expired: nothing ever flips an abandoned cart to `expired`,
          -- so counting them would refuse a Host for weeks over a cart nobody
          -- is paying for, and a late payment on one of those after the
          -- deletion is refused and reversed by biz_ticket_checkout_finalize.
          OR (
            s.status = 'processing_payment'
            AND s.revoked_at IS NULL
            AND s.order_id IS NULL
          )
        )
    );
  IF cardinality(v_ids) > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'checkout_in_progress',
      'count', cardinality(v_ids),
      'items', (
        SELECT COALESCE(jsonb_agg(x.item ORDER BY x.id), '[]'::jsonb)
        FROM (
          SELECT e.id, jsonb_build_object('id', e.id, 'title', e.title) AS item
          FROM public.events e
          WHERE e.id = ANY (v_ids)
          ORDER BY e.id
          LIMIT 5
        ) x
      )
    ));
  END IF;

  -- upcoming_reservations ----------------------------------------------------
  SELECT count(*)::integer INTO v_count
  FROM public.reservations r
  WHERE r.brand_id = ANY (v_brand_ids)
    AND r.reserved_for > now()
    AND r.status IN ('requested', 'confirmed', 'waitlisted');
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'upcoming_reservations', 'count', v_count));
  END IF;

  -- upcoming_stays (deliberately fail-closed: no end-date column to test) ----
  SELECT count(*)::integer INTO v_count
  FROM public.stay_reservation_groups g
  WHERE g.brand_id = ANY (v_brand_ids)
    AND g.state NOT IN ('declined', 'request_expired', 'cancelled');
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'upcoming_stays', 'count', v_count));
  END IF;

  -- open_menu_orders ---------------------------------------------------------
  SELECT count(*)::integer INTO v_count
  FROM public.venue_orders vo
  WHERE vo.brand_id = ANY (v_brand_ids)
    AND vo.payment_status IN ('pending', 'paid')
    AND vo.fulfillment_status IN ('placed', 'acknowledged', 'in_progress', 'ready')
    AND vo.created_at > now() - interval '24 hours';
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'open_menu_orders', 'count', v_count));
  END IF;

  -- money_in_motion ----------------------------------------------------------
  SELECT (
    (SELECT count(*) FROM public.brand_payout_releases pr
      WHERE pr.brand_id = ANY (v_brand_ids)
        AND pr.status NOT IN ('released', 'cancelled_event', 'reanchored'))
    + (SELECT count(*) FROM public.organiser_payout_debts od
        WHERE od.brand_id = ANY (v_brand_ids)
          AND od.status = 'open')
    + (SELECT count(*) FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
        WHERE e.brand_id = ANY (v_brand_ids)
          AND t.status = 'refund_pending')
    -- Money Mingla is holding for the organiser and has not released yet:
    -- every source the payout sweep would ledger, with no `released` item.
    -- ONE definition, one arm per sweep arm: see
    -- private.host_account_unreleased_held_money above.
    + (SELECT count(*)
       FROM private.host_account_unreleased_held_money(v_brand_ids, v_event_ids))
    -- #3645 bundle 4: matured value carried to a later payout and not placed
    -- yet is still owed to the host (placed value rides on a pending
    -- release, which the first arm counts).
    + (SELECT count(*) FROM public.payout_maturity_carryovers c
        WHERE c.brand_id = ANY (v_brand_ids)
          AND c.carried_at IS NULL)
  )::integer INTO v_count;
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'money_in_motion', 'count', v_count));
  END IF;

  -- partner_payment_in_progress ----------------------------------------------
  -- The user's partner links are ended by the deletion itself. The one thing
  -- that refuses is a partner share that has not reached a terminal state:
  -- everything except transferred / reversed / cancelled_refund still has
  -- money owed in one direction or the other.
  SELECT count(*)::integer INTO v_count
  FROM public.partner_splits ps
  WHERE ps.partner_account_id = p_user_id
    AND ps.status NOT IN ('transferred', 'reversed', 'cancelled_refund');
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'partner_payment_in_progress', 'count', v_count));
  END IF;

  RETURN v_blockers;
END;
$function$;


-- §8. Self-assert above COMMIT.
DO $$
DECLARE
  v_drain text := pg_get_functiondef(
    'public.claim_payout_release_alerts(integer,timestamptz)'::regprocedure
  );
  v_mature text := pg_get_functiondef(
    'public.mature_postponement_debts(timestamptz)'::regprocedure
  );
  v_auth text := pg_get_functiondef(
    'public.authorize_paystack_payout_execution(uuid,uuid,timestamptz)'::regprocedure
  );
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_release_alert_outbox_alert_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%paystack_plan_exceeds_due%'
  ) OR position('paystack_plan_exceeds_due' in v_drain) = 0
    OR position('paystack_plan_exceeds_due' in v_auth) = 0 THEN
    RAISE EXCEPTION '#3645 bundle 4 self-assert: paystack_plan_exceeds_due is not written, allowed and delivered';
  END IF;
  IF position('stay_dispute_hold_open' in v_drain) = 0
     OR position('waiting_for_bank' in v_drain) = 0 THEN
    RAISE EXCEPTION '#3645 bundle 4 self-assert: the drain lost an earlier kind';
  END IF;
  IF position('payout_maturity_carryovers' in v_mature) = 0
     OR position('issue_3645_place_maturity_carryovers' in v_mature) > 0
     OR position('issue_3645_place_maturity_carryovers(p_now, ''paystack'')' in
          pg_get_functiondef('public.claim_paystack_payout_releases(integer,timestamptz)'::regprocedure)) = 0
     OR position('issue_3645_place_maturity_carryovers(p_now, ''stripe'')' in
          pg_get_functiondef('public.claim_stripe_payout_releases(integer,timestamptz)'::regprocedure)) = 0
     OR position('issue_3645_return_closed_release_debt' in v_mature) = 0
     OR position('''released'',''fee_unreconciled''' in v_mature) = 0 THEN
    RAISE EXCEPTION '#3645 bundle 4 self-assert: matured value is not carried off a paid release, or not placed inside the claims';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'brand_payout_releases_mark_claimed'
      AND tgrelid = 'public.brand_payout_releases'::regclass
  ) THEN
    RAISE EXCEPTION '#3645 bundle 4 self-assert: the never-claimed marker trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_debt_application_returns_reason_check'
      AND pg_get_constraintdef(oid) LIKE '%release_closed%'
  ) THEN
    RAISE EXCEPTION '#3645 bundle 4 self-assert: release_closed return reason missing';
  END IF;
END$$;

COMMIT;

-- Issue #3645 bundle 2e-1 — a payout release's breakdown, recorded as it was
-- when it was claimed.
--
-- A release keeps changing after it is paid: bundle 4's
-- mature_postponement_debts books a maturity recredit adjustment after
-- payment, issue_3645_release_projected_totals reads disputes live, and the
-- claim id is cleared (Stripe, on execution) or re-claimed (Paystack, after a
-- refresh puts it back to pending). Recomputing a paid release therefore
-- rewrites what was sent, so the Host payout screen and the admin drawer
-- cannot show lines that add up to what was paid (#3645 bundle 2e).
--
-- This records the raw claim-time inputs, so bundle 2e-2's single breakdown
-- reader can show paid releases exactly as they were sent:
--   * payout_release_claim_snapshots: one append-only row per (release,
--     claim), with every money column of the release as claimed, the
--     effective withheld amount and the projected totals at that moment, and
--     the amount due (net + recredit, what the claim pays);
--   * brand_payout_releases.paid_snapshot_id: the snapshot of the claim that
--     paid it, set when the release turns 'released'.
--
-- Written by a BEFORE UPDATE trigger, not by editing the claim functions
-- (they are pinned by issue_3645_ledger_followup_reemit_hunks.ts). The
-- trigger never raises and never changes a money column: a failure only
-- warns, and the payout goes on exactly as before. No reader changes and no
-- backfill (releases paid before this have no reliable claim-time state).
-- Proofs: __tests__/issue_3645_payout_claim_snapshots.pg17.test.sql.

BEGIN;

-- The snapshot reads the 2d/bundle-4 helpers; refuse to apply before them.
DO $precondition$
BEGIN
  IF to_regprocedure('public.issue_3645_release_effective_withheld(uuid)') IS NULL
     OR to_regprocedure('public.issue_3645_release_projected_totals(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue_3645_2e1_requires_20280508003645'
      USING HINT = 'Apply 20280508003645 and 20280602003645 first.';
  END IF;
END
$precondition$;

CREATE TABLE IF NOT EXISTS public.payout_release_claim_snapshots (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id                     uuid NOT NULL REFERENCES public.brand_payout_releases(id),
  brand_id                       uuid NOT NULL,
  provider                       text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  claim_id                       uuid NOT NULL,
  claimed_at                     timestamptz NOT NULL DEFAULT clock_timestamp(),
  currency                       text,
  gross_cents                    integer,
  refunded_cents                 integer,
  disputed_cents                 integer,
  mingla_fee_cents               integer,
  partner_share_cents            integer,
  provider_fee_cents             integer,
  permanent_debt_withheld_cents  integer,
  temporary_debt_withheld_cents  integer,
  effective_withheld_cents       bigint,
  maturity_recredit_cents        integer,
  net_release_cents              integer,
  -- What the claim pays: net + recredit.
  due_cents                      bigint NOT NULL,
  -- issue_3645_release_projected_totals at claim time (null if it failed).
  projected                      jsonb,
  UNIQUE (release_id, claim_id)
);

COMMENT ON TABLE public.payout_release_claim_snapshots IS
  'issue #3645 bundle 2e-1: append-only claim-time breakdown inputs of a payout release (one per claim), so a paid release is shown as it was sent.';

CREATE INDEX IF NOT EXISTS payout_release_claim_snapshots_release_idx
  ON public.payout_release_claim_snapshots (release_id, claimed_at DESC);

DROP TRIGGER IF EXISTS payout_release_claim_snapshots_append_only
  ON public.payout_release_claim_snapshots;
CREATE TRIGGER payout_release_claim_snapshots_append_only
  BEFORE DELETE OR UPDATE ON public.payout_release_claim_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.reject_payout_append_only_mutation();

ALTER TABLE public.payout_release_claim_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_release_claim_snapshots_brand_read
  ON public.payout_release_claim_snapshots;
CREATE POLICY payout_release_claim_snapshots_brand_read
  ON public.payout_release_claim_snapshots
  FOR SELECT TO authenticated
  USING (public.biz_brand_effective_rank(brand_id, (SELECT auth.uid()))
         >= public.biz_role_rank('finance_manager'::text));
REVOKE ALL ON public.payout_release_claim_snapshots FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.payout_release_claim_snapshots FROM authenticated;
GRANT SELECT ON public.payout_release_claim_snapshots TO authenticated;
GRANT ALL ON public.payout_release_claim_snapshots TO service_role;

ALTER TABLE public.brand_payout_releases
  ADD COLUMN IF NOT EXISTS paid_snapshot_id uuid
    REFERENCES public.payout_release_claim_snapshots(id);

COMMENT ON COLUMN public.brand_payout_releases.paid_snapshot_id IS
  'issue #3645 bundle 2e-1: the claim snapshot of the claim that paid this release (null for releases paid before snapshots existed).';

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
        due_cents, projected
      ) VALUES (
        NEW.id, NEW.brand_id, v_provider, v_claim, NEW.currency,
        NEW.gross_cents, NEW.refunded_cents, NEW.disputed_cents, NEW.mingla_fee_cents,
        NEW.partner_share_cents, NEW.provider_fee_cents,
        NEW.permanent_debt_withheld_cents, NEW.temporary_debt_withheld_cents,
        v_withheld, NEW.maturity_recredit_cents, NEW.net_release_cents,
        COALESCE(NEW.net_release_cents, 0)::bigint + COALESCE(NEW.maturity_recredit_cents, 0)::bigint,
        v_projected
      )
      ON CONFLICT (release_id, claim_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      -- Never block a payout for a record of it.
      RAISE WARNING 'issue_3645_claim_snapshot_failed: release % claim %: %',
        NEW.id, v_claim, SQLERRM;
    END;
  END IF;

  -- Paid: link the latest snapshot (Paystack may have cleared the claim id by
  -- now, so the latest one for this release, not one matched by claim id).
  IF NEW.status = 'released' AND OLD.status IS DISTINCT FROM 'released'
     AND NEW.paid_snapshot_id IS NULL THEN
    BEGIN
      SELECT s.id INTO NEW.paid_snapshot_id
        FROM public.payout_release_claim_snapshots s
       WHERE s.release_id = NEW.id
       ORDER BY s.claimed_at DESC, s.id DESC
       LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_3645_paid_snapshot_link_failed: release %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3645_record_release_claim_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brand_payout_releases_record_claim_snapshot
  ON public.brand_payout_releases;
CREATE TRIGGER brand_payout_releases_record_claim_snapshot
  BEFORE UPDATE ON public.brand_payout_releases
  FOR EACH ROW EXECUTE FUNCTION public.issue_3645_record_release_claim_snapshot();

COMMIT;

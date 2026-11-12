-- #4402 — a creator-hire payment that Paystack or Stripe took is always
-- recorded, and a paid hold can never be retired as unpaid.
--
-- Before: the only recorder was the Host sheet's in-memory "I've paid" button.
-- The webhooks filed gig charges as orphans, and a Retry (or the 48-hour
-- sweep) set the paid hold to `failed`, after which it could never be captured
-- or refunded. This migration gives the edge code what it needs:
--   1. gig_hold_set_provider_ref: store the provider reference before the
--      provider call, so reconcile can always find the charge.
--   2. gig_hold_mark_captured / gig_topup_mark_captured: refuse a different
--      reference on a pending row, and accept a late payment on an offer that
--      was retired as unpaid (status failed, contract cancelled
--      payment_not_completed). The late payment is marked captured and a
--      `late_capture_refund_due` event is written; the edge then refunds it in
--      full through gig-refund branch `payment_late`.
--   3. payment_late: a machine-only full refund branch that keeps the contract
--      as it is (cancelled, payment_not_completed), so it stays hidden from
--      the creator and the Host lists.
--   4. gig_pending_offer_sweep now retires only contracts the edge has proven
--      unpaid with the provider (p_contract_ids). The old one-argument
--      signature is dropped.
--   5. gig_payment_reconcile_candidates: pending holds and top-ups, retired
--      holds from the last 30 days and late payments still owed a refund.
--   6. brand_id on the gig_offer_prepare and gig_topup_prepare answers (the
--      server builds the Host return URL from it).
--   7. pg_cron runs gig-hire `reconcile` every 15 minutes.
--   Tester follow-ups (comment 6833246656):
--   8. F1: gig_offer_prepare no longer retires an unpaid offer itself. A
--      signed-in host gets `payment_unverified`; only the service-role
--      gig_offer_retire_unpaid, called with the provider's proof, retires it.
--   9. F2: gig_payment_checks remembers each reconcile check. Candidates go
--      never-checked first, then least recently checked; a row the provider
--      proves unpaid for 72 hours is marked terminal and never re-checked.
--  10. F3: gig_refund_claims makes every gig refund single-flight: one claim
--      per hold (or per counter-offer difference) before any provider call,
--      a backoff after a failure and a stop (with an alert) after 5 tries.
--      A capture replay no longer reports a refund as due, and
--      host_before_accept is refused on an offer retired as unpaid.
--
-- Invariant I-4402-C (no pending gig hold is retired to failed without a
-- provider check proving it unpaid) is enforced here for the sweep, the
-- prepare wrapper and the retire RPC, and declared in supabase/migrations/__tests__/issue_4402_gig_payment_capture.implementor.pg17.test.sql.
--
-- Static SQL only. Conflicts raise 55000 (never 40001). No backfill: the one
-- stranded TEST hold is captured by the first reconcile run after deploy.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Store the provider reference on the pending row, first writer wins.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gig_hold_set_provider_ref(
  p_contract_id uuid, p_terms_version integer, p_kind text, p_provider_ref text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_hold public.gig_holds; v_adj public.gig_hold_adjustments;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('gig_hold', 'gig_topup')
     OR coalesce(btrim(p_provider_ref), '') = '' THEN
    RAISE EXCEPTION 'invalid_provider_ref' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.gig_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_kind = 'gig_hold' THEN
    SELECT * INTO v_hold FROM public.gig_holds
     WHERE contract_id = p_contract_id AND terms_version = p_terms_version FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'hold_not_found' USING ERRCODE = 'P0002'; END IF;
    IF v_hold.provider_ref IS NOT NULL THEN
      IF v_hold.provider_ref <> p_provider_ref THEN
        RAISE EXCEPTION 'hold_provider_mismatch' USING ERRCODE = '55000';
      END IF;
      RETURN jsonb_build_object('ok', true, 'replayed', true);
    END IF;
    IF v_hold.status <> 'pending' THEN RAISE EXCEPTION 'hold_not_pending' USING ERRCODE = '55000'; END IF;
    UPDATE public.gig_holds SET provider_ref = p_provider_ref WHERE id = v_hold.id;
  ELSE
    SELECT * INTO v_adj FROM public.gig_hold_adjustments
     WHERE contract_id = p_contract_id AND kind = 'topup' AND terms_version = p_terms_version
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'topup_not_found' USING ERRCODE = 'P0002'; END IF;
    IF v_adj.provider_ref IS NOT NULL THEN
      IF v_adj.provider_ref <> p_provider_ref THEN
        RAISE EXCEPTION 'hold_provider_mismatch' USING ERRCODE = '55000';
      END IF;
      RETURN jsonb_build_object('ok', true, 'replayed', true);
    END IF;
    IF v_adj.status <> 'pending' THEN RAISE EXCEPTION 'topup_not_pending' USING ERRCODE = '55000'; END IF;
    UPDATE public.gig_hold_adjustments SET provider_ref = p_provider_ref WHERE id = v_adj.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'replayed', false);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Capture: replay-safe, reference-checked, and late payments recorded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gig_hold_mark_captured(
  p_contract_id uuid, p_terms_version integer, p_provider_ref text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_hold public.gig_holds; v_contract public.gig_contracts; v_retired boolean;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_contract FROM public.gig_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_hold FROM public.gig_holds
   WHERE contract_id = p_contract_id AND terms_version = p_terms_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'hold_not_found' USING ERRCODE = 'P0002'; END IF;
  v_retired := v_contract.state = 'cancelled'
    AND v_contract.cancel_reason IS NOT DISTINCT FROM 'payment_not_completed';
  IF v_hold.status IN ('captured', 'released', 'refunded', 'partially_refunded') THEN
    IF v_hold.provider_ref IS DISTINCT FROM p_provider_ref THEN
      RAISE EXCEPTION 'hold_provider_mismatch' USING ERRCODE = '55000';
    END IF;
    -- F3: a replay never reports a refund as due (only the first recorder
    -- asks for it); `retired` still tells the Host page what happened.
    RETURN to_jsonb(v_hold) || jsonb_build_object(
      'replayed', true, 'late_capture', false, 'retired', v_retired);
  END IF;
  IF v_hold.provider_ref IS NOT NULL AND v_hold.provider_ref <> p_provider_ref THEN
    RAISE EXCEPTION 'hold_provider_mismatch' USING ERRCODE = '55000';
  END IF;
  IF v_hold.status = 'failed' AND v_retired THEN
    -- Paid after the offer was retired as unpaid: record the money so it can
    -- be refunded in full. The contract stays cancelled.
    UPDATE public.gig_holds SET status = 'captured', provider_ref = p_provider_ref, captured_at = now()
     WHERE id = v_hold.id RETURNING * INTO v_hold;
    INSERT INTO public.gig_events(contract_id, actor, kind, data)
    VALUES (p_contract_id, 'system', 'late_capture_refund_due', jsonb_build_object(
      'terms_version', p_terms_version, 'rail', v_hold.rail, 'amount_minor', v_hold.amount_minor, 'source', 'hold'));
    RETURN to_jsonb(v_hold) || jsonb_build_object('replayed', false, 'late_capture', true, 'retired', true);
  END IF;
  IF v_hold.status <> 'pending' THEN RAISE EXCEPTION 'hold_not_pending' USING ERRCODE = '55000'; END IF;
  UPDATE public.gig_holds SET status = 'captured', provider_ref = p_provider_ref, captured_at = now()
   WHERE id = v_hold.id RETURNING * INTO v_hold;
  IF v_contract.state = 'offered' THEN
    UPDATE public.gig_contracts SET state_deadline_at = now() + interval '48 hours' WHERE id = p_contract_id;
  END IF;
  INSERT INTO public.gig_events(contract_id, actor, kind, data)
  VALUES (p_contract_id, 'system', 'hold_captured', jsonb_build_object('terms_version', p_terms_version, 'rail', v_hold.rail));
  RETURN to_jsonb(v_hold) || jsonb_build_object('replayed', false, 'late_capture', false, 'retired', false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_topup_mark_captured(
  p_contract_id uuid, p_terms_version integer, p_provider_ref text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_adj public.gig_hold_adjustments; v_contract public.gig_contracts; v_retired boolean;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_contract FROM public.gig_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_adj FROM public.gig_hold_adjustments
   WHERE contract_id = p_contract_id AND kind = 'topup' AND terms_version = p_terms_version
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'topup_not_found' USING ERRCODE = 'P0002'; END IF;
  v_retired := v_contract.state = 'cancelled'
    AND v_contract.cancel_reason IS NOT DISTINCT FROM 'payment_not_completed';
  IF v_adj.status IN ('captured', 'released', 'refunded', 'partially_refunded') THEN
    IF v_adj.provider_ref IS DISTINCT FROM p_provider_ref THEN
      RAISE EXCEPTION 'hold_provider_mismatch' USING ERRCODE = '55000';
    END IF;
    RETURN to_jsonb(v_adj) || jsonb_build_object(
      'replayed', true, 'late_capture', false, 'retired', v_retired);
  END IF;
  IF v_adj.provider_ref IS NOT NULL AND v_adj.provider_ref <> p_provider_ref THEN
    RAISE EXCEPTION 'hold_provider_mismatch' USING ERRCODE = '55000';
  END IF;
  IF v_adj.status = 'failed' AND v_retired THEN
    UPDATE public.gig_hold_adjustments SET status = 'captured', provider_ref = p_provider_ref, captured_at = now()
     WHERE id = v_adj.id RETURNING * INTO v_adj;
    INSERT INTO public.gig_events(contract_id, actor, kind, data)
    VALUES (p_contract_id, 'system', 'late_capture_refund_due', jsonb_build_object(
      'terms_version', p_terms_version, 'rail', v_adj.rail, 'amount_minor', v_adj.amount_minor, 'source', 'topup'));
    RETURN to_jsonb(v_adj) || jsonb_build_object('replayed', false, 'late_capture', true, 'retired', true);
  END IF;
  IF v_adj.status <> 'pending' THEN RAISE EXCEPTION 'topup_not_pending' USING ERRCODE = '55000'; END IF;
  UPDATE public.gig_hold_adjustments SET status = 'captured', provider_ref = p_provider_ref, captured_at = now()
   WHERE id = v_adj.id RETURNING * INTO v_adj;
  UPDATE public.gig_contracts SET state_deadline_at = now() + interval '48 hours'
   WHERE id = p_contract_id AND state = 'offered';
  INSERT INTO public.gig_events(contract_id, actor, kind, data)
  VALUES (p_contract_id, 'system', 'topup_captured', jsonb_build_object('terms_version', p_terms_version, 'amount_minor', v_adj.amount_minor));
  RETURN to_jsonb(v_adj) || jsonb_build_object('replayed', false, 'late_capture', false, 'retired', false);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. payment_late: the automatic full refund of a late payment.
-- ---------------------------------------------------------------------------
-- plpgsql (was sql): same answers, including NULL for an unknown contract.
-- The body is not validated at CREATE time, which keeps filtered replay lanes
-- that skip unrelated migrations closed (#2492).
CREATE OR REPLACE FUNCTION public.issue_3872_gig_refund_branch_allowed(p_contract_id uuid, p_branch text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_allowed boolean;
BEGIN
  SELECT coalesce(CASE p_branch
    -- #4402 F3: an offer retired as unpaid is refunded only through
    -- payment_late, never by the host's cancel (which would rewrite the
    -- cancel reason and race the automatic refund).
    WHEN 'host_before_accept' THEN c.state='offered'
      OR (c.state='cancelled' AND c.cancel_reason IS DISTINCT FROM 'payment_not_completed')
    WHEN 'creator_decline' THEN c.state IN ('offered','declined')
    WHEN 'declined_or_expired' THEN (c.state='offered' AND c.state_deadline_at<=now()) OR c.state IN ('expired','declined')
    WHEN 'host_after_accept_before_lock' THEN c.state IN ('accepted','shoot_planned','script_drafting','script_sent')
    WHEN 'creator_after_accept' THEN c.state IN ('accepted','shoot_planned','script_drafting','script_sent')
    WHEN 'upload_missed' THEN c.state='script_locked' AND c.state_deadline_at<=now()
    WHEN 'resolved_partial' THEN c.state='disputed' AND EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=c.id AND d.status='decided' AND d.decided_outcome='partial_refund')
    WHEN 'resolved_refund' THEN c.state='disputed' AND EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=c.id AND d.status='decided' AND d.decided_outcome='full_refund')
    WHEN 'counter_lower' THEN EXISTS(SELECT 1 FROM public.gig_hold_adjustments a WHERE a.contract_id=c.id AND a.kind='refund' AND a.status='pending')
    -- #4402: a payment that landed after the offer was retired as unpaid.
    WHEN 'payment_late' THEN c.state='cancelled' AND c.cancel_reason IS NOT DISTINCT FROM 'payment_not_completed'
    ELSE false END,false)
    INTO v_allowed
  FROM public.gig_contracts c WHERE c.id=p_contract_id;
  RETURN v_allowed;
END;
$fn$;

-- The existing recorder moves the contract and rewrites cancel_reason. A late
-- refund must do neither (the retired offer stays hidden from the creator), so
-- payment_late is recorded here and every other branch keeps the old body.
ALTER FUNCTION public.gig_refund_record(uuid, text, bigint, bigint, text)
  RENAME TO issue_4402_gig_refund_record_impl;

CREATE OR REPLACE FUNCTION public.gig_refund_record(
  p_contract_id uuid, p_branch text, p_refund_minor bigint, p_creator_fee_minor bigint, p_provider_ref text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v public.gig_contracts; v_hold public.gig_holds; v_quote jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  IF p_branch IS DISTINCT FROM 'payment_late' THEN
    RETURN public.issue_4402_gig_refund_record_impl(p_contract_id, p_branch, p_refund_minor, p_creator_fee_minor, p_provider_ref);
  END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.issue_3872_gig_refund_branch_allowed(v.id, p_branch) THEN
    RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_hold FROM public.gig_holds
   WHERE contract_id = v.id AND terms_version = v.current_terms_version FOR UPDATE;
  IF FOUND AND v_hold.status = 'refunded' THEN
    IF EXISTS (SELECT 1 FROM public.gig_events e WHERE e.contract_id = v.id AND e.kind = 'refund_recorded'
                AND e.data->>'branch' = 'payment_late' AND (e.data->>'refund_minor')::bigint = p_refund_minor) THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'state', v.state);
    END IF;
    RAISE EXCEPTION 'refund_replay_mismatch' USING ERRCODE = '55000';
  END IF;
  IF v_hold.id IS NULL OR v_hold.status <> 'captured' THEN
    RAISE EXCEPTION 'captured_hold_required' USING ERRCODE = '55000';
  END IF;
  v_quote := public.gig_refund_quote(v.id, p_branch);
  IF (v_quote->>'refund_minor')::bigint <> p_refund_minor OR p_creator_fee_minor <> 0 THEN
    RAISE EXCEPTION 'refund_amount_mismatch' USING ERRCODE = '22023';
  END IF;
  UPDATE public.gig_holds
     SET refunded_minor = refunded_minor + p_refund_minor,
         status = CASE WHEN refunded_minor + p_refund_minor >= amount_minor THEN 'refunded' ELSE 'partially_refunded' END
   WHERE id = v_hold.id;
  INSERT INTO public.gig_events(contract_id, actor, kind, data)
  VALUES (v.id, 'system', 'refund_recorded', jsonb_build_object(
    'branch', p_branch, 'refund_minor', p_refund_minor, 'creator_fee_minor', 0, 'provider_ref', p_provider_ref));
  RETURN jsonb_build_object('ok', true, 'state', v.state);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. The sweep retires only contracts the edge proved unpaid.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.gig_pending_offer_sweep(timestamptz);
CREATE OR REPLACE FUNCTION public.gig_pending_offer_sweep(p_now timestamptz, p_contract_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_row record; v_count integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  FOR v_row IN
    SELECT c.id FROM public.gig_contracts c
     WHERE c.id = ANY(coalesce(p_contract_ids, '{}'::uuid[]))
       AND c.state = 'offered' AND c.state_deadline_at <= p_now
       AND NOT EXISTS (SELECT 1 FROM public.gig_holds h WHERE h.contract_id = c.id AND h.status <> 'pending')
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.gig_holds SET status = 'failed' WHERE contract_id = v_row.id AND status = 'pending';
    PERFORM public.issue_3872_contract_apply_state(v_row.id, 'cancelled', NULL, NULL, NULL, 'payment_not_completed');
    UPDATE public.gig_interest i SET status = 'shortlisted'
      FROM public.gig_contracts c
     WHERE c.id = v_row.id AND i.gig_id = c.gig_id AND i.creator_account_id = c.creator_account_id AND i.status = 'offered';
    INSERT INTO public.gig_events(contract_id, actor, kind, data)
    VALUES (v_row.id, 'system', 'offer_payment_abandoned', jsonb_build_object('proven_unpaid', true));
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'retired', v_count);
END;
$fn$;

-- The unpaid offers whose deadline passed; the edge checks each with the
-- provider before passing the proven-unpaid ids to the sweep.
CREATE OR REPLACE FUNCTION public.gig_pending_offer_candidates(p_now timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'contract_id', h.contract_id, 'terms_version', h.terms_version, 'kind', 'gig_hold',
    'rail', h.rail, 'amount_minor', h.amount_minor, 'currency', h.currency,
    'reference', CASE WHEN h.rail = 'paystack'
      THEN 'ghold_' || replace(h.contract_id::text, '-', '') || '_v' || h.terms_version
      ELSE h.provider_ref END,
    'created_at', h.created_at
  ) ORDER BY h.created_at), '[]'::jsonb)
  FROM public.gig_contracts c JOIN public.gig_holds h ON h.contract_id = c.id
  WHERE auth.uid() IS NULL AND c.state = 'offered' AND c.state_deadline_at <= p_now AND h.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM public.gig_holds x WHERE x.contract_id = c.id AND x.status <> 'pending');
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Reconcile: what was checked (F2), candidates, and the refund claim (F3).
-- ---------------------------------------------------------------------------
CREATE TABLE public.gig_payment_checks (
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('gig_hold', 'gig_topup')),
  terms_version integer NOT NULL CHECK (terms_version > 0),
  checks integer NOT NULL DEFAULT 0 CHECK (checks >= 0),
  last_checked_at timestamptz,
  last_outcome text,
  last_provider_status text,
  -- Set once the provider has proven the row unpaid for long enough; a
  -- terminal row is never probed again (a later payment still arrives by
  -- webhook and is late-captured and refunded).
  terminal_at timestamptz,
  terminal_proof jsonb CHECK (terminal_proof IS NULL OR jsonb_typeof(terminal_proof) = 'object'),
  PRIMARY KEY (contract_id, kind, terms_version)
);
ALTER TABLE public.gig_payment_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gig_payment_checks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gig_payment_checks TO service_role;

CREATE TABLE public.gig_refund_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One per hold (hold:<id>) or per counter-offer difference (counter:<id>).
  claim_key text NOT NULL UNIQUE,
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE RESTRICT,
  branch text NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed', 'completed', 'failed', 'gave_up')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  next_attempt_at timestamptz,
  provider_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gig_refund_claims_contract_idx ON public.gig_refund_claims(contract_id);
CREATE TRIGGER issue_4402_gig_refund_claims_updated BEFORE UPDATE ON public.gig_refund_claims
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.gig_refund_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gig_refund_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gig_refund_claims TO service_role;

-- Record one reconcile check. A not-paid answer on a row older than
-- p_terminal_after makes it terminal, with the provider's answer as proof.
CREATE OR REPLACE FUNCTION public.gig_payment_check_record(
  p_contract_id uuid, p_kind text, p_terms_version integer, p_outcome text, p_provider_status text,
  p_terminal_after interval DEFAULT interval '72 hours'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_created timestamptz; v_terminal boolean := false; v_row public.gig_payment_checks;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('gig_hold', 'gig_topup') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'gig_hold' THEN
    SELECT created_at INTO v_created FROM public.gig_holds
     WHERE contract_id = p_contract_id AND terms_version = p_terms_version;
  ELSE
    SELECT created_at INTO v_created FROM public.gig_hold_adjustments
     WHERE contract_id = p_contract_id AND kind = 'topup' AND terms_version = p_terms_version
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_created IS NULL THEN RAISE EXCEPTION 'hold_not_found' USING ERRCODE = 'P0002'; END IF;
  v_terminal := p_outcome = 'not_paid' AND v_created <= now() - coalesce(p_terminal_after, interval '72 hours');
  INSERT INTO public.gig_payment_checks AS g (contract_id, kind, terms_version, checks, last_checked_at,
    last_outcome, last_provider_status, terminal_at, terminal_proof)
  VALUES (p_contract_id, p_kind, p_terms_version, 1, now(), p_outcome, p_provider_status,
    CASE WHEN v_terminal THEN now() END,
    CASE WHEN v_terminal THEN jsonb_build_object('outcome', p_outcome, 'provider_status', p_provider_status, 'hold_created_at', v_created) END)
  ON CONFLICT (contract_id, kind, terms_version) DO UPDATE SET
    checks = g.checks + 1, last_checked_at = now(), last_outcome = EXCLUDED.last_outcome,
    last_provider_status = EXCLUDED.last_provider_status,
    terminal_at = coalesce(g.terminal_at, EXCLUDED.terminal_at),
    terminal_proof = coalesce(g.terminal_proof, EXCLUDED.terminal_proof)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'checks', v_row.checks, 'terminal', v_row.terminal_at IS NOT NULL);
END;
$fn$;

-- Candidates: never-checked rows first, then the least recently checked,
-- newest first on ties, so a pile of abandoned checkouts can never starve a
-- new stranded payment. Terminal rows are skipped. p_limit caps provider calls.
CREATE OR REPLACE FUNCTION public.gig_payment_reconcile_candidates(
  p_older_than interval DEFAULT interval '30 minutes', p_limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  WITH candidates AS (
    -- A pending hold: the host may have paid with nothing recorded.
    SELECT 1 AS tier, chk.last_checked_at AS checked, h.created_at AS created, jsonb_build_object(
      'reason', 'pending', 'kind', 'gig_hold', 'contract_id', h.contract_id, 'terms_version', h.terms_version,
      'rail', h.rail, 'amount_minor', h.amount_minor, 'currency', h.currency, 'created_at', h.created_at,
      'reference', CASE WHEN h.rail = 'paystack'
        THEN 'ghold_' || replace(h.contract_id::text, '-', '') || '_v' || h.terms_version
        ELSE h.provider_ref END) AS row
      FROM public.gig_holds h
      LEFT JOIN public.gig_payment_checks chk
        ON chk.contract_id = h.contract_id AND chk.kind = 'gig_hold' AND chk.terms_version = h.terms_version
     WHERE h.status = 'pending' AND h.created_at <= now() - p_older_than AND chk.terminal_at IS NULL
    UNION ALL
    SELECT 1, chk.last_checked_at, a.created_at, jsonb_build_object(
      'reason', 'pending', 'kind', 'gig_topup', 'contract_id', a.contract_id, 'terms_version', a.terms_version,
      'rail', a.rail, 'amount_minor', a.amount_minor, 'currency', a.currency, 'created_at', a.created_at,
      'reference', CASE WHEN a.rail = 'paystack'
        THEN 'gtop_' || replace(a.contract_id::text, '-', '') || '_v' || a.terms_version
        ELSE a.provider_ref END)
      FROM public.gig_hold_adjustments a
      LEFT JOIN public.gig_payment_checks chk
        ON chk.contract_id = a.contract_id AND chk.kind = 'gig_topup' AND chk.terms_version = a.terms_version
     WHERE a.kind = 'topup' AND a.status = 'pending' AND a.created_at <= now() - p_older_than AND chk.terminal_at IS NULL
    UNION ALL
    -- A hold retired as unpaid in the last 30 days: a late payment is refunded.
    SELECT 1, chk.last_checked_at, h.created_at, jsonb_build_object(
      'reason', 'retired', 'kind', 'gig_hold', 'contract_id', h.contract_id, 'terms_version', h.terms_version,
      'rail', h.rail, 'amount_minor', h.amount_minor, 'currency', h.currency, 'created_at', h.created_at,
      'reference', CASE WHEN h.rail = 'paystack'
        THEN 'ghold_' || replace(h.contract_id::text, '-', '') || '_v' || h.terms_version
        ELSE h.provider_ref END)
      FROM public.gig_holds h JOIN public.gig_contracts c ON c.id = h.contract_id
      LEFT JOIN public.gig_payment_checks chk
        ON chk.contract_id = h.contract_id AND chk.kind = 'gig_hold' AND chk.terms_version = h.terms_version
     WHERE h.status = 'failed' AND c.state = 'cancelled'
       AND c.cancel_reason IS NOT DISTINCT FROM 'payment_not_completed'
       AND h.updated_at >= now() - interval '30 days' AND chk.terminal_at IS NULL
    UNION ALL
    -- A late payment recorded whose refund is not done, not in flight and
    -- not waiting out a backoff (F3).
    SELECT 0, NULL::timestamptz, h.captured_at, jsonb_build_object(
      'reason', 'refund_due', 'kind', 'gig_hold', 'contract_id', h.contract_id, 'terms_version', h.terms_version,
      'rail', h.rail, 'amount_minor', h.amount_minor, 'currency', h.currency, 'reference', h.provider_ref)
      FROM public.gig_holds h JOIN public.gig_contracts c ON c.id = h.contract_id
      LEFT JOIN public.gig_refund_claims rc ON rc.claim_key = 'hold:' || h.id::text
     WHERE h.status = 'captured' AND c.state = 'cancelled'
       AND c.cancel_reason IS NOT DISTINCT FROM 'payment_not_completed'
       AND (rc.id IS NULL
         OR (rc.status = 'failed' AND rc.next_attempt_at <= now())
         OR (rc.status = 'claimed' AND rc.updated_at < now() - interval '15 minutes'))
  )
  SELECT coalesce(jsonb_agg(row ORDER BY tier, checked NULLS FIRST, created DESC), '[]'::jsonb) INTO v_rows
    FROM (SELECT tier, checked, created, row FROM candidates
           ORDER BY tier, checked NULLS FIRST, created DESC
           LIMIT greatest(1, least(coalesce(p_limit, 25), 100))) picked;
  RETURN jsonb_build_object('ok', true, 'candidates', v_rows);
END;
$fn$;

-- F3: claim the one refund of a hold (or counter difference) before any
-- provider call. A completed claim is a replay; a live claim is in flight; a
-- failed claim may be retaken only after its backoff; a claim older than
-- 15 minutes that never finished is retaken (provider idempotency keys make
-- the retry safe).
CREATE OR REPLACE FUNCTION public.gig_refund_claim(p_contract_id uuid, p_branch text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v public.gig_contracts; v_key text; v_hold uuid; v_adj uuid; v_claim public.gig_refund_claims;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_branch = 'counter_lower' THEN
    SELECT id INTO v_adj FROM public.gig_hold_adjustments
     WHERE contract_id = v.id AND kind = 'refund' AND status = 'pending' ORDER BY created_at LIMIT 1;
    IF v_adj IS NULL THEN RETURN jsonb_build_object('claimed', false, 'reason', 'nothing_due'); END IF;
    v_key := 'counter:' || v_adj::text;
  ELSE
    SELECT id INTO v_hold FROM public.gig_holds WHERE contract_id = v.id AND terms_version = v.current_terms_version;
    IF v_hold IS NULL THEN RETURN jsonb_build_object('claimed', false, 'reason', 'nothing_due'); END IF;
    v_key := 'hold:' || v_hold::text;
  END IF;
  INSERT INTO public.gig_refund_claims AS rc (claim_key, contract_id, branch, status)
  VALUES (v_key, v.id, p_branch, 'claimed')
  ON CONFLICT (claim_key) DO UPDATE SET status = 'claimed', branch = EXCLUDED.branch,
    attempts = rc.attempts + 1, next_attempt_at = NULL
  WHERE (rc.status = 'failed' AND rc.next_attempt_at <= now())
     OR (rc.status = 'claimed' AND rc.updated_at < now() - interval '15 minutes')
  RETURNING * INTO v_claim;
  IF v_claim.id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', true, 'claim_id', v_claim.id, 'attempt', v_claim.attempts, 'claim_key', v_key);
  END IF;
  SELECT * INTO v_claim FROM public.gig_refund_claims WHERE claim_key = v_key;
  RETURN jsonb_build_object('claimed', false, 'claim_id', v_claim.id,
    'reason', CASE v_claim.status WHEN 'completed' THEN 'completed' WHEN 'claimed' THEN 'in_flight'
      WHEN 'gave_up' THEN 'gave_up' ELSE 'backoff' END,
    'branch', v_claim.branch, 'next_attempt_at', v_claim.next_attempt_at, 'provider_ref', v_claim.provider_ref);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_refund_claim_finish(
  p_claim_id uuid, p_ok boolean, p_provider_ref text DEFAULT NULL, p_error text DEFAULT NULL, p_max_attempts integer DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v public.gig_refund_claims;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.gig_refund_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v.status <> 'claimed' THEN RAISE EXCEPTION 'claim_not_active' USING ERRCODE = '55000'; END IF;
  IF p_ok THEN
    UPDATE public.gig_refund_claims SET status = 'completed', provider_ref = p_provider_ref, last_error = NULL
     WHERE id = v.id RETURNING * INTO v;
  ELSIF v.attempts >= greatest(coalesce(p_max_attempts, 5), 1) THEN
    UPDATE public.gig_refund_claims SET status = 'gave_up', last_error = left(coalesce(p_error, 'unknown'), 500)
     WHERE id = v.id RETURNING * INTO v;
  ELSE
    -- 5, 10, 20, 40 minutes … capped at 6 hours.
    UPDATE public.gig_refund_claims SET status = 'failed', last_error = left(coalesce(p_error, 'unknown'), 500),
      next_attempt_at = now() + least(interval '6 hours', interval '5 minutes' * power(2, v.attempts - 1))
     WHERE id = v.id RETURNING * INTO v;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', v.status, 'attempts', v.attempts, 'next_attempt_at', v.next_attempt_at);
END;
$fn$;

-- F1: the only way an unpaid offer is retired outside the proven-unpaid
-- sweep: the service role, with the provider's answer as proof.
CREATE OR REPLACE FUNCTION public.gig_offer_retire_unpaid(p_contract_id uuid, p_proof jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v public.gig_contracts;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  IF p_proof IS NULL OR jsonb_typeof(p_proof) <> 'object' OR coalesce(p_proof->>'provider_status', '') = '' THEN
    RAISE EXCEPTION 'provider_proof_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v.state <> 'offered'
     OR NOT EXISTS (SELECT 1 FROM public.gig_holds h WHERE h.contract_id = v.id AND h.status = 'pending')
     OR EXISTS (SELECT 1 FROM public.gig_holds h WHERE h.contract_id = v.id AND h.status <> 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_retirable');
  END IF;
  UPDATE public.gig_holds SET status = 'failed' WHERE contract_id = v.id AND status = 'pending';
  PERFORM public.issue_3872_contract_apply_state(v.id, 'cancelled', NULL, NULL, NULL, 'payment_not_completed');
  -- The host may offer again (the old in-function retire skipped this check).
  UPDATE public.gig_interest SET status = 'shortlisted'
   WHERE gig_id = v.gig_id AND creator_account_id = v.creator_account_id AND status = 'offered';
  INSERT INTO public.gig_events(contract_id, actor, kind, data)
  VALUES (v.id, 'system', 'offer_payment_abandoned', jsonb_build_object('proven_unpaid', true, 'proof', p_proof));
  RETURN jsonb_build_object('ok', true, 'retired', v.id);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. brand_id on the prepare answers (the #4216 rights wrapper is kept).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gig_offer_prepare(
  p_interest_id uuid, p_terms jsonb, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_perpetual boolean; v_result jsonb; v_live uuid;
BEGIN
  SELECT g.rights_model = 'creator_v1_perpetual' INTO v_perpetual
  FROM public.gig_interest i JOIN public.gigs g ON g.id = i.gig_id
  WHERE i.id = p_interest_id;
  IF coalesce(v_perpetual, false)
     AND coalesce((p_terms->>'rights_accepted')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'creator_rights_acceptance_required');
  END IF;
  -- #4402 F1: an unpaid offer for this creator is never retired here (the
  -- impl's retire branch ran without any provider check). The edge proves it
  -- unpaid and retires it through gig_offer_retire_unpaid first.
  SELECT c.id INTO v_live
    FROM public.gig_interest i
    JOIN public.gig_contracts c ON c.gig_id = i.gig_id AND c.creator_account_id = i.creator_account_id
   WHERE i.id = p_interest_id AND c.state = 'offered'
     AND EXISTS (SELECT 1 FROM public.gig_holds h WHERE h.contract_id = c.id AND h.status = 'pending')
     AND NOT EXISTS (SELECT 1 FROM public.gig_holds h WHERE h.contract_id = c.id AND h.status <> 'pending')
     AND NOT EXISTS (SELECT 1 FROM public.gig_holds h WHERE h.idempotency_key = p_idempotency_key)
   LIMIT 1;
  IF v_live IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_unverified', 'contract_id', v_live);
  END IF;
  PERFORM set_config('issue4216.host_rights_accepted', 'on', true);
  v_result := public.issue_4216_gig_offer_prepare_impl(
    p_interest_id, p_terms - 'rights_accepted', p_idempotency_key);
  IF coalesce((v_result->>'ok')::boolean, false) AND v_result ? 'contract_id' THEN
    v_result := v_result || jsonb_build_object('brand_id',
      (SELECT c.brand_id FROM public.gig_contracts c WHERE c.id = (v_result->>'contract_id')::uuid));
  END IF;
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_topup_prepare(p_contract_id uuid, p_terms_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $fn$
DECLARE v public.gig_contracts; v_adj public.gig_hold_adjustments; v_new public.gig_terms_versions; v_old public.gig_terms_versions;
BEGIN
  SELECT * INTO v FROM public.gig_contracts WHERE id = p_contract_id;
  IF NOT FOUND OR NOT public.issue_3872_gig_host_writer(v.brand_id, auth.uid()) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_adj FROM public.gig_hold_adjustments WHERE contract_id = v.id AND kind = 'topup' AND status = 'pending' AND terms_version = p_terms_version;
  IF NOT FOUND OR v.state <> 'offered' THEN RETURN jsonb_build_object('ok', false, 'error', 'topup_not_pending'); END IF;
  SELECT * INTO v_new FROM public.gig_terms_versions WHERE contract_id = v.id AND version = p_terms_version;
  SELECT * INTO v_old FROM public.gig_terms_versions WHERE contract_id = v.id AND version = p_terms_version - 1;
  RETURN jsonb_build_object('ok', true, 'contract_id', v.id, 'brand_id', v.brand_id, 'terms_version', p_terms_version, 'rail', v_adj.rail,
    'fee_minor', v_new.fee_minor - v_old.fee_minor, 'booking_fee_minor', v_new.booking_fee_minor - v_old.booking_fee_minor,
    'total_minor', v_adj.amount_minor, 'currency', v_adj.currency, 'adjustment_id', v_adj.id);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants. Every new or replaced money function is service-role only; the two
-- prepare functions keep their authenticated grant.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.gig_hold_set_provider_ref(uuid, integer, text, text),
  public.gig_hold_mark_captured(uuid, integer, text),
  public.gig_topup_mark_captured(uuid, integer, text),
  public.issue_3872_gig_refund_branch_allowed(uuid, text),
  public.issue_4402_gig_refund_record_impl(uuid, text, bigint, bigint, text),
  public.gig_refund_record(uuid, text, bigint, bigint, text),
  public.gig_pending_offer_sweep(timestamptz, uuid[]),
  public.gig_pending_offer_candidates(timestamptz),
  public.gig_payment_reconcile_candidates(interval, integer),
  public.gig_payment_check_record(uuid, text, integer, text, text, interval),
  public.gig_refund_claim(uuid, text),
  public.gig_refund_claim_finish(uuid, boolean, text, text, integer),
  public.gig_offer_retire_unpaid(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_hold_set_provider_ref(uuid, integer, text, text),
  public.gig_hold_mark_captured(uuid, integer, text),
  public.gig_topup_mark_captured(uuid, integer, text),
  public.issue_3872_gig_refund_branch_allowed(uuid, text),
  public.issue_4402_gig_refund_record_impl(uuid, text, bigint, bigint, text),
  public.gig_refund_record(uuid, text, bigint, bigint, text),
  public.gig_pending_offer_sweep(timestamptz, uuid[]),
  public.gig_pending_offer_candidates(timestamptz),
  public.gig_payment_reconcile_candidates(interval, integer),
  public.gig_payment_check_record(uuid, text, integer, text, text, interval),
  public.gig_refund_claim(uuid, text),
  public.gig_refund_claim_finish(uuid, boolean, text, text, integer),
  public.gig_offer_retire_unpaid(uuid, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.gig_offer_prepare(uuid, jsonb, text), public.gig_topup_prepare(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gig_offer_prepare(uuid, jsonb, text), public.gig_topup_prepare(uuid, integer)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Reconcile every 15 minutes (Seth, 12 Nov). Same caller as every other
-- cron-to-edge job: pg_net POST with the vault service_role_key bearer, which
-- gig-hire checks in code. Skipped, loudly, where pg_cron, pg_net or the vault
-- rows are missing (a local replay). gig-timers is NOT scheduled here.
-- ---------------------------------------------------------------------------
DO $cron$
DECLARE
  v_job bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE NOTICE '#4402: pg_cron/pg_net unavailable; gig payment reconcile not scheduled'; RETURN;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL
    OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url')
    OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE '#4402: runtime vault rows unavailable; gig payment reconcile not scheduled'; RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'issue_4402_gig_payment_reconcile';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('issue_4402_gig_payment_reconcile', '*/15 * * * *', $job$SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/gig-hire',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)),
    body := '{"action":"reconcile"}'::jsonb,
    timeout_milliseconds := 55000)$job$);
END;
$cron$;

NOTIFY pgrst, 'reload schema';
COMMIT;

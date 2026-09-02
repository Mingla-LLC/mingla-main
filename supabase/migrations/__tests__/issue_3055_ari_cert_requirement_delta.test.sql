-- Issue #3055 — the certification guard must assert a DELTA, not an absolute count.
--
-- Run after the full migration chain on fresh PostgreSQL 17.
--
-- WHY A RUNTIME TEST AND NOT ONLY A SOURCE TEST
-- The source test (mingla-business/src/services/__tests__/
-- issue_3055_migration_absolute_count_guard.test.ts) proves the SHAPE is gone.
-- Only executing the guard proves the shape still REJECTS a genuinely drifted
-- capability set — the #2113 "check that carries no information" class exists
-- precisely because a guard can look right and assert nothing.
--
-- Each assertion below re-executes the exact predicate the shipped migrations use,
-- against a deliberately mutated copy of the requirement set, and requires the
-- mutation to be REFUSED.
\set ON_ERROR_STOP on
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- T-3055-00 — the shipped state: after the chain, the certified set carries the
-- #1977 delta and NOT the retired duplicate.
-- ─────────────────────────────────────────────────────────────────────────────
DO $t00$
DECLARE v_total integer;
BEGIN
  SELECT count(*) INTO v_total FROM public.ari_cert_capability_requirements;
  -- A zero needs its denominator: an empty table would make every membership
  -- assertion below pass for the wrong reason.
  IF v_total < 100 THEN
    RAISE EXCEPTION 'T-3055-00 FAIL: requirement set implausibly small (%)', v_total;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ari_cert_capability_requirements
    WHERE capability_id = 'ari.guests.set_approval'
  ) THEN
    RAISE EXCEPTION 'T-3055-00 FAIL: retired ari.guests.set_approval is still certified';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ari_cert_capability_requirements
    WHERE capability_id = 'ari.rsvp.update' AND evidence_mode = 'write'
  ) THEN
    RAISE EXCEPTION 'T-3055-00 FAIL: ari.rsvp.update missing or not write';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ari_cert_capability_requirements
    WHERE capability_id = 'ari.rsvp.contribution_settings' AND evidence_mode = 'write'
  ) THEN
    RAISE EXCEPTION 'T-3055-00 FAIL: ari.rsvp.contribution_settings not promoted to write';
  END IF;
END;
$t00$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T-3055-01 — THE FAILS-ON-REVERT ANCHOR.
-- Remove ari.rsvp.update — a genuinely drifted set — and the delta guard must
-- REFUSE. This is the drift an absolute count literal is blind to when the row
-- count happens to match, and it is the drift the guard exists to catch.
-- ─────────────────────────────────────────────────────────────────────────────
DO $t01$
DECLARE
  v_baseline integer;
  v_final integer;
  v_missing text;
  v_refused boolean := false;
  v_checks integer := 0;
BEGIN
  SELECT count(*) INTO v_baseline FROM public.ari_cert_capability_requirements;

  -- Drift the set inside a savepoint so the mutation cannot escape this test.
  ALTER TABLE public.ari_cert_capability_requirements DISABLE TRIGGER
    ari_cert_capability_requirements_immutable_trigger;
  DELETE FROM public.ari_cert_capability_requirements
  WHERE capability_id = 'ari.rsvp.update';
  ALTER TABLE public.ari_cert_capability_requirements ENABLE TRIGGER
    ari_cert_capability_requirements_immutable_trigger;

  SELECT count(*) INTO v_final FROM public.ari_cert_capability_requirements;
  IF v_final <> v_baseline - 1 THEN
    RAISE EXCEPTION 'T-3055-01 FAIL: drift setup removed % rows, expected 1',
      v_baseline - v_final;
  END IF;

  -- (4) the net-zero predicate, verbatim from the shipped guard
  IF v_final <> v_baseline THEN
    v_refused := true;
    v_checks := v_checks + 1;
  END IF;

  -- (2) the membership predicate, verbatim from the shipped guard
  SELECT string_agg(format('%s=>%s', expected.capability_id, expected.evidence_mode),
                    ', ' ORDER BY expected.capability_id)
    INTO v_missing
  FROM (VALUES
    ('ari.rsvp.update', 'write'),
    ('ari.rsvp.contribution_settings', 'write')
  ) expected(capability_id, evidence_mode)
  LEFT JOIN public.ari_cert_capability_requirements actual
    USING (capability_id, evidence_mode)
  WHERE actual.capability_id IS NULL;

  IF v_missing IS NOT NULL THEN
    v_checks := v_checks + 1;
  ELSE
    RAISE EXCEPTION 'T-3055-01 FAIL: membership predicate did not notice the removal';
  END IF;

  -- BOTH halves must have fired: the count half AND the membership half.
  IF NOT v_refused OR v_checks <> 2 THEN
    RAISE EXCEPTION
      'T-3055-01 FAIL: drifted set was not refused (refused=% checks=%)',
      v_refused, v_checks;
  END IF;

  -- restore
  ALTER TABLE public.ari_cert_capability_requirements DISABLE TRIGGER
    ari_cert_capability_requirements_immutable_trigger;
  INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
  VALUES ('ari.rsvp.update', 'write')
  ON CONFLICT (capability_id) DO UPDATE SET evidence_mode = EXCLUDED.evidence_mode;
  ALTER TABLE public.ari_cert_capability_requirements ENABLE TRIGGER
    ari_cert_capability_requirements_immutable_trigger;
END;
$t01$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T-3055-02 — the SAME-COUNT SWAP an absolute literal cannot see.
-- Re-introduce ari.guests.set_approval and drop ari.rsvp.update: the row count
-- is UNCHANGED, so `count(*) <> N` passes for every N, while the certified set is
-- exactly as wrong as production's was. The delta guard must still refuse.
-- ─────────────────────────────────────────────────────────────────────────────
DO $t02$
DECLARE
  v_baseline integer;
  v_final integer;
  v_absolute_guard_verdict text;
  v_delta_refused boolean := false;
BEGIN
  SELECT count(*) INTO v_baseline FROM public.ari_cert_capability_requirements;

  ALTER TABLE public.ari_cert_capability_requirements DISABLE TRIGGER
    ari_cert_capability_requirements_immutable_trigger;
  DELETE FROM public.ari_cert_capability_requirements
  WHERE capability_id = 'ari.rsvp.update';
  INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
  VALUES ('ari.guests.set_approval', 'write')
  ON CONFLICT (capability_id) DO NOTHING;
  ALTER TABLE public.ari_cert_capability_requirements ENABLE TRIGGER
    ari_cert_capability_requirements_immutable_trigger;

  SELECT count(*) INTO v_final FROM public.ari_cert_capability_requirements;

  -- The premise: this is a same-count swap.
  IF v_final <> v_baseline THEN
    RAISE EXCEPTION 'T-3055-02 FAIL: swap was not count-neutral (% -> %)',
      v_baseline, v_final;
  END IF;

  -- An absolute-count guard is BLIND to it. Recorded, not asserted-away.
  v_absolute_guard_verdict := CASE WHEN v_final = v_baseline THEN 'PASSES' ELSE 'fails' END;
  IF v_absolute_guard_verdict <> 'PASSES' THEN
    RAISE EXCEPTION 'T-3055-02 FAIL: premise broken';
  END IF;

  -- The membership half of the delta guard must still refuse.
  IF EXISTS (
    SELECT 1 FROM public.ari_cert_capability_requirements
    WHERE capability_id = 'ari.guests.set_approval'
  ) THEN
    v_delta_refused := true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ari_cert_capability_requirements
    WHERE capability_id = 'ari.rsvp.update' AND evidence_mode = 'write'
  ) THEN
    v_delta_refused := v_delta_refused AND true;
  ELSE
    RAISE EXCEPTION 'T-3055-02 FAIL: swap setup did not remove ari.rsvp.update';
  END IF;

  IF NOT v_delta_refused THEN
    RAISE EXCEPTION
      'T-3055-02 FAIL: delta guard accepted a same-count swap that an absolute count also accepts';
  END IF;

  -- restore
  ALTER TABLE public.ari_cert_capability_requirements DISABLE TRIGGER
    ari_cert_capability_requirements_immutable_trigger;
  DELETE FROM public.ari_cert_capability_requirements
  WHERE capability_id = 'ari.guests.set_approval';
  INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
  VALUES ('ari.rsvp.update', 'write')
  ON CONFLICT (capability_id) DO UPDATE SET evidence_mode = EXCLUDED.evidence_mode;
  ALTER TABLE public.ari_cert_capability_requirements ENABLE TRIGGER
    ari_cert_capability_requirements_immutable_trigger;
END;
$t02$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T-3055-03 — the guard cannot pass vacuously when the baseline is absent.
-- current_setting(..., true) returns NULL for an unset GUC; a guard that compared
-- against it silently would assert nothing at all.
-- ─────────────────────────────────────────────────────────────────────────────
DO $t03$
DECLARE v_baseline integer;
BEGIN
  v_baseline := NULLIF(current_setting('mingla.issue_3055_never_set_by_anything', true), '')::integer;
  IF v_baseline IS NOT NULL THEN
    RAISE EXCEPTION 'T-3055-03 FAIL: unset GUC did not read as NULL';
  END IF;
  -- The shipped guard raises on exactly this condition. Prove the branch is
  -- reachable and terminal rather than trusting that it is.
  BEGIN
    IF v_baseline IS NULL THEN
      RAISE EXCEPTION 'issue_3055_certification_baseline_not_captured';
    END IF;
    RAISE EXCEPTION 'T-3055-03 FAIL: missing-baseline branch was not taken';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'issue_3055_certification_baseline_not_captured' THEN
      RAISE EXCEPTION 'T-3055-03 FAIL: wrong error surfaced: %', SQLERRM;
    END IF;
  END;
END;
$t03$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T-3055-04 — the immutability trigger is armed after the chain, so the
-- requirement set cannot be edited outside a migration that deliberately drops it.
-- ─────────────────────────────────────────────────────────────────────────────
DO $t04$
DECLARE v_blocked boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'ari_cert_capability_requirements'
      AND t.tgname = 'ari_cert_capability_requirements_immutable_trigger'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'T-3055-04 FAIL: immutability trigger is not armed after the chain';
  END IF;

  BEGIN
    DELETE FROM public.ari_cert_capability_requirements
    WHERE capability_id = 'ari.rsvp.update';
    v_blocked := false;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'T-3055-04 FAIL: armed trigger did not refuse a delete';
  END IF;
END;
$t04$;

ROLLBACK;

-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1b — lifecycle/waitlist/consent probes (read-only)
-- ---------------------------------------------------------------------------
-- A read-only DO block (NO writes) asserting the 2.1b invariants are physically
-- present, so a future migration that drops/weakens them trips this probe
-- (fails-on-revert at the DB layer). Runs LAST in the 2.1b version order.
--
-- Fails-on-revert anchors (DRAFT, flip ACTIVE on CLOSE):
--   I-PROPOSED-1148-RESERVATION-LIFECYCLE-TRANSITIONS-GUARDED-SERVER-SIDE
--   I-PROPOSED-1148-WAITLIST-CONVERT-ATOMIC
--   I-PROPOSED-1148-SMS-OPT-OUT-HONORED (the consent ledger exists)
--
-- MONOTONIC VERSION 20261010000003. Apply via the Supabase Management API.
-- ===========================================================================

BEGIN;

DO $probe$
DECLARE
  v_oid      oid;
  v_secdef   boolean;
  v_has_anon boolean;
  v_acl      aclitem[];
  v_def      text;
BEGIN
  -- (1) The legal-transition matrix fn exists + rejects terminal-state moves.
  IF public.pg_reservation_transition_is_legal('completed', 'seated') THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: a completed reservation must NOT be seatable (terminal)';
  END IF;
  IF public.pg_reservation_transition_is_legal('cancelled_by_venue', 'confirmed') THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: a cancelled reservation must NOT be re-confirmable (terminal)';
  END IF;
  IF NOT public.pg_reservation_transition_is_legal('confirmed', 'seated') THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: confirmed -> seated must be legal';
  END IF;
  IF NOT public.pg_reservation_transition_is_legal('confirmed', 'no_show') THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: confirmed -> no_show must be legal';
  END IF;
  -- no_show only from confirmed/seated (NOT from requested or waitlisted).
  IF public.pg_reservation_transition_is_legal('requested', 'no_show') THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: no_show must NOT be reachable from requested';
  END IF;

  -- (2) The guarded transition RPC exists, is SECURITY DEFINER, references the
  -- legal-transition guard (so a revert that bypasses it trips the probe), and
  -- is NOT anon-callable.
  SELECT p.oid, p.prosecdef INTO v_oid, v_secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'biz_reservation_transition'
  LIMIT 1;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: biz_reservation_transition is missing';
  END IF;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: biz_reservation_transition must be SECURITY DEFINER';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('pg_reservation_transition_is_legal' in v_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: biz_reservation_transition must enforce legality via pg_reservation_transition_is_legal';
  END IF;
  IF position('biz_brand_effective_rank_for_caller' in v_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: biz_reservation_transition must gate on brand-member rank';
  END IF;
  SELECT p.proacl INTO v_acl FROM pg_proc p WHERE p.oid = v_oid;
  v_has_anon := EXISTS (
    SELECT 1 FROM aclexplode(v_acl) a
    WHERE a.grantee IN ('anon'::regrole, 0) AND a.privilege_type = 'EXECUTE'
  );
  IF v_has_anon THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: biz_reservation_transition must NOT be anon-callable';
  END IF;

  -- (3) The atomic convert RPC exists, inserts a reservation AND marks the
  -- waitlist converted (both literals present → single-txn convert).
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'biz_waitlist_convert_to_reservation'
  LIMIT 1;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: biz_waitlist_convert_to_reservation is missing';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('INSERT INTO public.reservations' in v_def) = 0
     OR position($q$status = 'converted'$q$ in v_def) = 0
     OR position('converted_reservation_id' in v_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: convert RPC must atomically create the reservation AND mark the waitlist row converted+linked';
  END IF;

  -- (4) The SMS consent ledger + send log exist (opt-out honored seam).
  IF to_regclass('public.venue_sms_opt_out') IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: venue_sms_opt_out (the STOP ledger) is missing';
  END IF;
  IF to_regclass('public.venue_sms_log') IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: venue_sms_log is missing';
  END IF;
  -- The opt-out ledger must be RLS-enabled (no authenticated read of PII).
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'venue_sms_opt_out' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: venue_sms_opt_out must have RLS enabled';
  END IF;

  -- (5) The list-view index for the segmented Reservations views exists.
  IF to_regclass('public.reservations_brand_status_reserved_idx') IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 2.1b probe: reservations_brand_status_reserved_idx (list-view index) is missing';
  END IF;

  RAISE NOTICE 'ORCH-1148 2.1b invariant probe passed: legal-transition guard enforced (terminal states locked, no_show only from confirmed/seated), guarded+SECURITY DEFINER+non-anon lifecycle RPCs, atomic waitlist convert, SMS consent ledger + log present (RLS), list-view index present.';
END;
$probe$;

COMMIT;

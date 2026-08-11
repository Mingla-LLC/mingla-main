-- #1807 TESTER ADVERSARIAL — attacks the Paystack cutover ledger from angles the
-- implementor's happy-path suite does not reach.
--
-- payout_hold_cutover_migrations is an APPEND-ONLY money audit ledger and
-- brands.payout_hold_cutover_at is a one-way per-brand switch that changes WHEN
-- a real business is paid. A false stamp, a DOUBLE stamp, a stamp that cannot be
-- rolled back, or a stamp recorded untruthfully is real financial harm. Every
-- assertion below exists because one of those outcomes would otherwise be
-- possible and silent.
--
-- Distinct from issue_1807_paystack_ledger_truth.test.sql (single-session happy
-- path + a Stripe control). This file attacks:
--   A1  two REAL concurrent sessions stamping the SAME Paystack brand
--   A2  the same race on a STRIPE brand (regression control under contention)
--   A3  rollback -> re-stamp: the switch is reversible, not a one-way trap
--   A4  rollback of a brand that was NEVER stamped (fail-open characterisation)
--   A5  SECURITY DEFINER / search_path / EXECUTE grants survived CREATE OR REPLACE
--   A6  the ledger is still APPEND-ONLY (no UPDATE/DELETE/TRUNCATE to service_role)
--   A7  EXACTLY ONE result CHECK, asserted independently of the migration's own
--       self-assert (a second stale CHECK would silently reject 'stamp_failed')
--   A8  brand_not_found still fails CLOSED on both RPCs on the Paystack rail
--   A9  the #1807 contract cross-checked over every row this file produced
--
-- Runs after every migration is applied, via psql -v ON_ERROR_STOP=1. Unlike its
-- sibling this file COMMITS (real concurrency cannot happen inside one
-- transaction), so it uses an isolated 18079999- UUID namespace and deletes
-- everything it created at the end.
--
-- Fails-on-revert: restore the hardcoded 'daily'/'manual' literals in
-- 20270317001807 and A1/A3/A9 fail; drop 'stamp_failed' from the widened CHECK
-- and A7 fails; remove SECURITY DEFINER or the search_path pin from either
-- CREATE OR REPLACE and A5 fails; grant UPDATE or DELETE on the ledger and A6
-- fails; delete the `FOR UPDATE` row lock from stamp_payout_hold_cutover and A1
-- fails with a DOUBLE STAMP.

\set ON_ERROR_STOP on

--------------------------------------------------------------------------------
-- Concurrency is produced by REAL OS PROCESSES, not from inside this file.
--
-- The #1173 workflow runs, in order: ..._race_setup.sql (fixtures),
-- ..._race_a.sql in the BACKGROUND (stamps both race brands, then holds its
-- transaction open on the FOR UPDATE row lock), ..._race_b.sql two seconds later
-- in the foreground (contends for the same rows and blocks), and finally this
-- file, which asserts what the two of them produced.
--
-- The earlier version of this file opened the second session with dblink. That
-- cannot work here: dblink_connect and dblink_connect_u are the SAME C function
-- differing only in SECURITY DEFINER, and it gates on superuser(). supabase/
-- postgres de-superusers `postgres`, and `postgres` is what creates the
-- extension in this job, so it also OWNS dblink_connect_u — SECURITY DEFINER
-- resolves to a non-superuser and the bypass is inert. Every candidate, with and
-- without a password, over sockets and TCP alike, is refused with
-- "Non-superusers may only connect using credentials they provide". Two psql
-- processes authenticate exactly the way every other step in this job already
-- does, so the proof depends on nothing that has to be guessed.
--
-- Neither race process is told it is the winner. The assertions below are
-- written so that whichever commits first, the outcome must be exactly one stamp
-- and exactly one idempotent skip per brand.
--------------------------------------------------------------------------------
DO $precheck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.brands
                  WHERE id = '18079999-0000-4000-8000-000000000011') THEN
    RAISE EXCEPTION
      '#1807(A): race fixtures are missing — issue_1807_tester_adversarial_race_setup.sql did not run. Refusing to pass vacuously.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payout_hold_cutover_migrations
                  WHERE brand_id = '18079999-0000-4000-8000-000000000011') THEN
    RAISE EXCEPTION
      '#1807(A): the race produced NO ledger rows — race_a/race_b did not run, so the concurrency assertions would be vacuous. Refusing to pass.';
  END IF;
END $precheck$;

--------------------------------------------------------------------------------
-- A1 — TWO REAL CONCURRENT SESSIONS stamp the SAME Paystack brand.
--
-- The money question: can two admins clicking at once produce TWO stamps, or a
-- second 'flipped' ledger row claiming a hold that never happened? The RPC's
-- defence is a FOR UPDATE row lock plus an atomic `WHERE ... IS NULL` update.
-- Session A stamps and HOLDS its transaction open; session B fires into the
-- lock. Exactly one must win; the loser must record a SKIP, never a second flip.
--------------------------------------------------------------------------------
DO $a1b$
DECLARE
  v_brand uuid := '18079999-0000-4000-8000-000000000011';
  v_flipped int;
  v_skipped int;
  v_prior text;
  v_new text;
  v_acct text;
BEGIN
  SELECT count(*) INTO v_flipped FROM public.payout_hold_cutover_migrations
   WHERE brand_id = v_brand AND result = 'flipped';
  IF v_flipped <> 1 THEN
    RAISE EXCEPTION
      '#1807(A1): the race produced % flipped ledger rows for one brand (expected exactly 1)', v_flipped;
  END IF;

  SELECT count(*) INTO v_skipped FROM public.payout_hold_cutover_migrations
   WHERE brand_id = v_brand AND result = 'skipped_already_stamped';
  IF v_skipped <> 1 THEN
    RAISE EXCEPTION
      '#1807(A1): expected exactly 1 idempotent-skip row from the losing session, found %', v_skipped;
  END IF;

  IF (SELECT payout_hold_cutover_at FROM public.brands WHERE id = v_brand) IS NULL THEN
    RAISE EXCEPTION '#1807(A1): the winning session did not actually stamp the brand';
  END IF;

  -- The winner's row is the real decision record: it must be truthful.
  SELECT prior_interval, new_interval, stripe_account_id INTO v_prior, v_new, v_acct
    FROM public.payout_hold_cutover_migrations
   WHERE brand_id = v_brand AND result = 'flipped';
  IF v_acct IS NOT NULL THEN
    RAISE EXCEPTION '#1807(A1): paystack flipped row carried a stripe account id (%)', v_acct;
  END IF;
  IF v_prior IS NOT NULL OR v_new IS NOT NULL THEN
    RAISE EXCEPTION
      '#1807(A1): the race winner fabricated Stripe schedule intervals on a Paystack brand (prior=%, new=%)',
      COALESCE(v_prior,'<null>'), COALESCE(v_new,'<null>');
  END IF;

  -- RESIDUAL FIXED (#1807 condition 3a). A pin stood here asserting the #1173
  -- hardcoded 'manual','manual' on the idempotent-skip row, with the standing
  -- instruction "if this assertion ever fires the residual was fixed — delete
  -- this block, do not weaken it". 20270317001807 now makes that branch
  -- rail-aware too, so the pin is replaced by the assertion of the CORRECTED
  -- behaviour rather than deleted: A1 proved this row is genuinely reachable on
  -- the Paystack rail (this very concurrency loser, and equally an admin
  -- retry), so the seam stays covered — and now covered by truth, not by the
  -- bug. The Stripe control for the same branch lives in A2.
  SELECT prior_interval, new_interval INTO v_prior, v_new
    FROM public.payout_hold_cutover_migrations
   WHERE brand_id = v_brand AND result = 'skipped_already_stamped';
  IF v_prior IS NOT NULL OR v_new IS NOT NULL THEN
    RAISE EXCEPTION
      '#1807(A1): the race LOSER fabricated Stripe schedule intervals on a Paystack brand (prior=%, new=%)',
      COALESCE(v_prior,'<null>'), COALESCE(v_new,'<null>');
  END IF;
END $a1b$;

--------------------------------------------------------------------------------
-- A2 — THE SAME RACE ON A STRIPE BRAND. #1807 must not have changed how the
-- Stripe rail behaves under contention, and the winner's row must still read
-- daily -> manual. This is the zero-Stripe-impact claim tested where it is
-- hardest, not on the quiet single-session path.
--------------------------------------------------------------------------------
DO $a2b$
DECLARE
  v_brand uuid := '18079999-0000-4000-8000-000000000012';
  v_prior text;
  v_new text;
  v_acct text;
  v_flipped int;
BEGIN
  SELECT count(*) INTO v_flipped FROM public.payout_hold_cutover_migrations
   WHERE brand_id = v_brand AND result = 'flipped';
  IF v_flipped <> 1 THEN
    RAISE EXCEPTION '#1807(A2): STRIPE REGRESSION — % flipped rows for one brand (expected 1)', v_flipped;
  END IF;

  SELECT prior_interval, new_interval, stripe_account_id INTO v_prior, v_new, v_acct
    FROM public.payout_hold_cutover_migrations
   WHERE brand_id = v_brand AND result = 'flipped';
  IF v_prior IS DISTINCT FROM 'daily' OR v_new IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION
      '#1807(A2): STRIPE REGRESSION — flipped row reads (prior=%, new=%), expected daily/manual',
      COALESCE(v_prior,'<null>'), COALESCE(v_new,'<null>');
  END IF;
  IF v_acct IS DISTINCT FROM 'acct_adv_1807' THEN
    RAISE EXCEPTION '#1807(A2): STRIPE REGRESSION — account id not recorded (%)', COALESCE(v_acct,'<null>');
  END IF;

  -- The Stripe control for the branch #1807 condition 3a made rail-aware. The
  -- Paystack loser's row must be NULL/NULL (asserted in A1); the STRIPE loser's
  -- row must still read manual/manual, exactly as #1173 wrote it. Without this,
  -- a CASE that collapsed to NULL for every rail would pass A1 and go unnoticed.
  SELECT prior_interval, new_interval INTO v_prior, v_new
    FROM public.payout_hold_cutover_migrations
   WHERE brand_id = v_brand AND result = 'skipped_already_stamped';
  IF v_prior IS DISTINCT FROM 'manual' OR v_new IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION
      '#1807(A2): STRIPE REGRESSION — the idempotent-skip row reads (prior=%, new=%), expected manual/manual',
      COALESCE(v_prior,'<null>'), COALESCE(v_new,'<null>');
  END IF;
END $a2b$;

--------------------------------------------------------------------------------
-- A3 — REVERSIBILITY. A stamped Paystack brand must roll back, and must be
-- re-stampable afterwards. If the stamp were a one-way trap, an admin who
-- stamped the wrong Nigerian business could never restore them to the at-charge
-- Paystack split. Every mutating row on this rail must carry NULL intervals.
--------------------------------------------------------------------------------
DO $a3$
DECLARE
  v_brand uuid := '18079999-0000-4000-8000-000000000011'; -- already stamped by A1
  v_result text;
  v_prior text;
  v_new text;
  v_flipped int;
  v_rolled int;
BEGIN
  v_result := public.rollback_payout_hold_cutover(
    v_brand, NULL, '18079999-0000-4000-8000-0000000000a3'::uuid,
    'admin@usemingla.com', '18079999-0000-4000-8000-000000000001'::uuid, 'adversarial rollback');
  IF v_result <> 'rolled_back' THEN
    RAISE EXCEPTION '#1807(A3): rollback returned % (expected rolled_back)', v_result;
  END IF;
  IF (SELECT payout_hold_cutover_at FROM public.brands WHERE id = v_brand) IS NOT NULL THEN
    RAISE EXCEPTION '#1807(A3): ONE-WAY TRAP — rollback did not un-stamp the Paystack brand';
  END IF;

  SELECT prior_interval, new_interval INTO v_prior, v_new
    FROM public.payout_hold_cutover_migrations
   WHERE batch_id = '18079999-0000-4000-8000-0000000000a3' AND result = 'rolled_back';
  IF v_prior IS NOT NULL OR v_new IS NOT NULL THEN
    RAISE EXCEPTION
      '#1807(A3): paystack rolled_back row fabricated intervals (prior=%, new=%)',
      COALESCE(v_prior,'<null>'), COALESCE(v_new,'<null>');
  END IF;

  -- Re-stamp after the rollback: the switch must be usable again, and must
  -- produce a genuinely NEW flip, not another idempotent skip.
  v_result := public.stamp_payout_hold_cutover(
    v_brand, NULL, '18079999-0000-4000-8000-0000000000a4'::uuid,
    'admin@usemingla.com', '18079999-0000-4000-8000-000000000001'::uuid, 'adversarial re-stamp');
  IF v_result <> 'flipped' THEN
    RAISE EXCEPTION
      '#1807(A3): a rolled-back Paystack brand could not be re-stamped (returned %)', v_result;
  END IF;
  IF (SELECT payout_hold_cutover_at FROM public.brands WHERE id = v_brand) IS NULL THEN
    RAISE EXCEPTION '#1807(A3): re-stamp reported flipped but left the brand unstamped';
  END IF;

  SELECT prior_interval, new_interval INTO v_prior, v_new
    FROM public.payout_hold_cutover_migrations
   WHERE batch_id = '18079999-0000-4000-8000-0000000000a4' AND result = 'flipped';
  IF v_prior IS NOT NULL OR v_new IS NOT NULL THEN
    RAISE EXCEPTION
      '#1807(A3): the re-stamp row fabricated intervals (prior=%, new=%)',
      COALESCE(v_prior,'<null>'), COALESCE(v_new,'<null>');
  END IF;

  -- The append-only ledger must now hold BOTH flips and the rollback between
  -- them: history is added to, never rewritten.
  SELECT count(*) INTO v_flipped FROM public.payout_hold_cutover_migrations
   WHERE brand_id = v_brand AND result = 'flipped';
  SELECT count(*) INTO v_rolled FROM public.payout_hold_cutover_migrations
   WHERE brand_id = v_brand AND result = 'rolled_back';
  IF v_flipped <> 2 OR v_rolled <> 1 THEN
    RAISE EXCEPTION
      '#1807(A3): append-only history wrong after stamp/rollback/re-stamp: flipped=%, rolled_back=% (expected 2 / 1)',
      v_flipped, v_rolled;
  END IF;
END $a3$;

--------------------------------------------------------------------------------
-- A4 — ROLLING BACK A BRAND THAT WAS NEVER STAMPED.
-- rollback_payout_hold_cutover writes its 'rolled_back' row unconditionally, so
-- an admin who rolls back an unstamped Nigerian brand still gets a row that
-- reads as a completed rollback. Characterised here (behaviour is #1173's and is
-- identical on both rails) so any future change is deliberate, and so the shape
-- an auditor will actually see is on record: cutover_before must be NULL, which
-- is the only field distinguishing it from a real rollback.
--------------------------------------------------------------------------------
DO $a4$
DECLARE
  v_brand uuid := '18079999-0000-4000-8000-000000000013';
  v_result text;
  v_before timestamptz;
  v_after timestamptz;
BEGIN
  IF (SELECT payout_hold_cutover_at FROM public.brands WHERE id = v_brand) IS NOT NULL THEN
    RAISE EXCEPTION '#1807(A4): fixture brand was unexpectedly already stamped';
  END IF;

  v_result := public.rollback_payout_hold_cutover(
    v_brand, NULL, '18079999-0000-4000-8000-0000000000d1'::uuid,
    'admin@usemingla.com', '18079999-0000-4000-8000-000000000001'::uuid, 'adversarial never-stamped rollback');
  IF v_result <> 'rolled_back' THEN
    RAISE EXCEPTION '#1807(A4): unstamped rollback returned % (expected rolled_back)', v_result;
  END IF;

  SELECT cutover_before, cutover_after INTO v_before, v_after
    FROM public.payout_hold_cutover_migrations
   WHERE batch_id = '18079999-0000-4000-8000-0000000000d1';
  IF v_before IS NOT NULL THEN
    RAISE EXCEPTION
      '#1807(A4): a rollback of a NEVER-stamped brand recorded cutover_before=% — the row is indistinguishable from a real rollback',
      v_before;
  END IF;
  IF v_after IS NOT NULL THEN
    RAISE EXCEPTION '#1807(A4): rollback row recorded a non-NULL cutover_after (%)', v_after;
  END IF;
  IF (SELECT payout_hold_cutover_at FROM public.brands WHERE id = v_brand) IS NOT NULL THEN
    RAISE EXCEPTION '#1807(A4): rollback of an unstamped brand STAMPED it';
  END IF;
END $a4$;

--------------------------------------------------------------------------------
-- A5 — CREATE OR REPLACE must not have quietly dropped the security posture.
-- These two functions write brands.payout_hold_cutover_at, the switch that
-- decides when a business is paid. A replace that lost SECURITY DEFINER, lost
-- the search_path pin, or leaked EXECUTE to anon/authenticated would be a
-- privilege hole that every behavioural test in this repo would still pass.
--------------------------------------------------------------------------------
DO $a5$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('stamp_payout_hold_cutover','rollback_payout_hold_cutover')
  LOOP
    IF NOT r.prosecdef THEN
      RAISE EXCEPTION '#1807(A5): % lost SECURITY DEFINER', r.proname;
    END IF;
    IF r.proconfig IS NULL
       OR NOT (r.proconfig::text LIKE '%search_path=public, pg_temp%') THEN
      RAISE EXCEPTION '#1807(A5): % lost its search_path pin (proconfig=%)',
        r.proname, COALESCE(r.proconfig::text,'<null>');
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public'
         AND p.proname IN ('stamp_payout_hold_cutover','rollback_payout_hold_cutover')) <> 2 THEN
    RAISE EXCEPTION '#1807(A5): expected exactly 2 cutover functions — a signature changed';
  END IF;

  FOR r IN
    SELECT p.proname, ro.rolname,
           has_function_privilege(ro.rolname, p.oid, 'EXECUTE') AS can_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')) ro
     WHERE n.nspname='public'
       AND p.proname IN ('stamp_payout_hold_cutover','rollback_payout_hold_cutover')
  LOOP
    IF r.can_exec THEN
      RAISE EXCEPTION
        '#1807(A5): PRIVILEGE HOLE — % is EXECUTEable by %, which can stamp a brand onto held payouts',
        r.proname, r.rolname;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('service_role',
        'public.stamp_payout_hold_cutover(uuid,text,uuid,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '#1807(A5): service_role lost EXECUTE on stamp_payout_hold_cutover';
  END IF;
  IF NOT has_function_privilege('service_role',
        'public.rollback_payout_hold_cutover(uuid,text,uuid,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '#1807(A5): service_role lost EXECUTE on rollback_payout_hold_cutover';
  END IF;
END $a5$;

--------------------------------------------------------------------------------
-- A6 — THE LEDGER IS STILL APPEND-ONLY. #1807 runs ALTER TABLE on this table;
-- an append-only money audit trail that the writing role can UPDATE or DELETE is
-- not an audit trail. Nothing else in the repo asserts this.
--------------------------------------------------------------------------------
DO $a6$
DECLARE
  v_priv text;
BEGIN
  FOREACH v_priv IN ARRAY ARRAY['UPDATE','DELETE','TRUNCATE'] LOOP
    IF has_table_privilege('service_role','public.payout_hold_cutover_migrations', v_priv) THEN
      RAISE EXCEPTION
        '#1807(A6): APPEND-ONLY BROKEN — service_role holds % on payout_hold_cutover_migrations', v_priv;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('service_role','public.payout_hold_cutover_migrations','INSERT') THEN
    RAISE EXCEPTION '#1807(A6): service_role lost INSERT on the cutover ledger — skip/fail rows would vanish';
  END IF;
  IF NOT has_table_privilege('service_role','public.payout_hold_cutover_migrations','SELECT') THEN
    RAISE EXCEPTION '#1807(A6): service_role lost SELECT on the cutover ledger';
  END IF;

  FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
    IF has_table_privilege('anon','public.payout_hold_cutover_migrations', v_priv)
       OR has_table_privilege('authenticated','public.payout_hold_cutover_migrations', v_priv) THEN
      RAISE EXCEPTION '#1807(A6): a client role holds % on the cutover ledger', v_priv;
    END IF;
  END LOOP;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.payout_hold_cutover_migrations'::regclass) THEN
    RAISE EXCEPTION '#1807(A6): RLS was disabled on the cutover ledger';
  END IF;
END $a6$;

--------------------------------------------------------------------------------
-- A7 — EXACTLY ONE result CHECK, asserted here and not only inside the migration.
-- The #1173 CHECK was created inline and UNNAMED. If PostgreSQL's auto-generated
-- name ever differs from the literal in the migration's DROP ... IF EXISTS, the
-- drop no-ops and the ADD leaves TWO CHECKs — the stale one still rejecting
-- 'stamp_failed', so every Paystack stamp failure would lose its audit row while
-- the API returned 200. The migration self-asserts this; a constraint change is
-- exactly the kind that silently no-ops, so it is asserted independently too.
--------------------------------------------------------------------------------
DO $a7$
DECLARE
  v_count int;
  v_def text;
  v_value text;
BEGIN
  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE conrelid = 'public.payout_hold_cutover_migrations'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%flipped%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      '#1807(A7): expected exactly 1 result CHECK on the cutover ledger, found % — a stale CHECK would silently reject stamp_failed',
      v_count;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.payout_hold_cutover_migrations'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%flipped%';

  FOREACH v_value IN ARRAY ARRAY[
    'flipped','skipped_already_stamped','skipped_no_account','flip_failed',
    'stamp_failed','stamp_failed_rolled_back','rolled_back','rollback_failed'
  ] LOOP
    IF v_def NOT LIKE '%''' || v_value || '''%' THEN
      RAISE EXCEPTION '#1807(A7): result CHECK is missing %. Got: %', v_value, v_def;
    END IF;
  END LOOP;
END $a7$;

-- A7 cont. — the widened CHECK must ADMIT a real stamp_failed row on a real
-- brand (a definition-only assertion would pass against a NOT VALID constraint).
DO $a7b$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.payout_hold_cutover_migrations (
    batch_id, brand_id, stripe_account_id, direction,
    prior_interval, new_interval, result, error_message, actor_email, actor_uid, reason
  ) VALUES (
    '18079999-0000-4000-8000-0000000000e1', '18079999-0000-4000-8000-000000000011', NULL, 'hold',
    NULL, NULL, 'stamp_failed', 'adversarial probe', 'admin@usemingla.com',
    '18079999-0000-4000-8000-000000000001', 'adversarial stamp_failed probe'
  ) RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION '#1807(A7): stamp_failed row did not persist';
  END IF;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION
    '#1807(A7): the widened CHECK rejected stamp_failed — every Paystack stamp failure would lose its audit row';
END $a7b$;

--------------------------------------------------------------------------------
-- A8 — FAIL CLOSED on an unknown brand. Both RPCs must RAISE, on the Paystack
-- rail too, rather than quietly writing a ledger row for a brand that is not
-- there. A fail-open here would let a typo'd UUID look like a successful stamp.
--------------------------------------------------------------------------------
DO $a8$
DECLARE
  v_ghost uuid := '18079999-0000-4000-8000-00000000dead';
  v_raised boolean;
  v_rows int;
BEGIN
  v_raised := false;
  BEGIN
    PERFORM public.stamp_payout_hold_cutover(
      v_ghost, NULL, '18079999-0000-4000-8000-0000000000f1'::uuid,
      'admin@usemingla.com', '18079999-0000-4000-8000-000000000001'::uuid, 'ghost stamp');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '#1807(A8): FAIL OPEN — stamping a non-existent brand did not raise';
  END IF;

  v_raised := false;
  BEGIN
    PERFORM public.rollback_payout_hold_cutover(
      v_ghost, NULL, '18079999-0000-4000-8000-0000000000f2'::uuid,
      'admin@usemingla.com', '18079999-0000-4000-8000-000000000001'::uuid, 'ghost rollback');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '#1807(A8): FAIL OPEN — rolling back a non-existent brand did not raise';
  END IF;

  SELECT count(*) INTO v_rows FROM public.payout_hold_cutover_migrations
   WHERE brand_id = v_ghost;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '#1807(A8): % ledger rows exist for a brand that does not', v_rows;
  END IF;
END $a8$;

--------------------------------------------------------------------------------
-- A9 — THE #1807 CONTRACT, cross-checked over EVERY row this file produced.
-- The column comments added by 20270317001807 state that prior_interval /
-- new_interval are NULL on the Paystack rail and "never fabricated". Held to
-- that on the mutating rows, which are the actual decision records, in both
-- directions: no Stripe row may have lost its intervals either.
--------------------------------------------------------------------------------
DO $a9$
DECLARE
  v_bad int;
  r record;
BEGIN
  SELECT count(*) INTO v_bad FROM public.payout_hold_cutover_migrations
   WHERE brand_id IN ('18079999-0000-4000-8000-000000000011',
                      '18079999-0000-4000-8000-000000000012',
                      '18079999-0000-4000-8000-000000000013')
     AND result IN ('flipped','rolled_back')
     AND stripe_account_id IS NULL
     AND (prior_interval IS NOT NULL OR new_interval IS NOT NULL);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      '#1807(A9): % Paystack decision rows carry fabricated Stripe schedule intervals', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.payout_hold_cutover_migrations
   WHERE brand_id IN ('18079999-0000-4000-8000-000000000011',
                      '18079999-0000-4000-8000-000000000012',
                      '18079999-0000-4000-8000-000000000013')
     AND result IN ('flipped','rolled_back')
     AND stripe_account_id IS NOT NULL
     AND (prior_interval IS NULL OR new_interval IS NULL);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      '#1807(A9): STRIPE REGRESSION — % Stripe decision rows LOST their schedule intervals', v_bad;
  END IF;

  -- No decision row may name a Stripe account for the Paystack fixture brand.
  SELECT count(*) INTO v_bad FROM public.payout_hold_cutover_migrations
   WHERE brand_id = '18079999-0000-4000-8000-000000000011'
     AND stripe_account_id IS NOT NULL;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '#1807(A9): % rows attach a Stripe account to a Paystack-only brand', v_bad;
  END IF;

  -- And the ledger only ever holds values the CHECK allows.
  FOR r IN
    SELECT DISTINCT result FROM public.payout_hold_cutover_migrations
     WHERE brand_id IN ('18079999-0000-4000-8000-000000000011',
                        '18079999-0000-4000-8000-000000000012',
                        '18079999-0000-4000-8000-000000000013')
  LOOP
    IF r.result NOT IN ('flipped','skipped_already_stamped','skipped_no_account',
                        'flip_failed','stamp_failed','stamp_failed_rolled_back',
                        'rolled_back','rollback_failed') THEN
      RAISE EXCEPTION '#1807(A9): unknown result value % reached the ledger', r.result;
    END IF;
  END LOOP;
END $a9$;

--------------------------------------------------------------------------------
-- Cleanup. This file COMMITs, and the #1173 job runs several SQL suites against
-- one database, so it must leave nothing behind.
--------------------------------------------------------------------------------
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.payout_hold_cutover_migrations
 WHERE brand_id IN (
   '18079999-0000-4000-8000-000000000011',
   '18079999-0000-4000-8000-000000000012',
   '18079999-0000-4000-8000-000000000013');
DELETE FROM public.brands WHERE id IN (
   '18079999-0000-4000-8000-000000000011',
   '18079999-0000-4000-8000-000000000012',
   '18079999-0000-4000-8000-000000000013');
DELETE FROM public.creator_accounts WHERE id = '18079999-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id = '18079999-0000-4000-8000-000000000001';
COMMIT;

DO $done$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE id = '18079999-0000-4000-8000-000000000011') THEN
    RAISE EXCEPTION '#1807: adversarial fixtures leaked into the shared test database';
  END IF;
  RAISE NOTICE '#1807 tester adversarial: A1-A9 all passed';
END $done$;

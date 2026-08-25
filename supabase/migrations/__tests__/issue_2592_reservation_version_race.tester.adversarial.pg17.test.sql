-- =====================================================================================
-- #2592 TESTER ADVERSARIAL — the reservation version contract under conditions the
-- implementor's suite never creates.
--
-- Run AFTER the complete migration chain has been applied to a fresh
-- supabase/postgres:17.4.1.075, and AFTER
-- `issue_2592_reservation_version_contract.test.sql` (both re-apply the #1975
-- migration and mutate `reservations_version_positive`):
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_2592_reservation_version_race.tester.adversarial.pg17.test.sql
--
-- The implementor's suite proves the CHECK is scoped, a stale version is refused
-- classifiably, and every mutator bumps exactly once. All three run in ONE session,
-- sequentially, against a decoy that lives on a DIFFERENTLY-NAMED table in the SAME
-- schema. This suite attacks the three things that leaves open:
--
--   (1) An INDEPENDENT fixture for the A1 scoping property: the decoy here is a relation
--       that is ALSO called `reservations`, in another schema, so the catalog carries two
--       relations of the same name AND two constraints of the same name at once. This is
--       a second, differently-shaped witness for the same fix, not a stronger one —
--       measured honestly, it does NOT distinguish a name-based pseudo-fix
--       (`conrelid::regclass::text = 'reservations'`), because `public.reservations`
--       renders unqualified while the private relation renders schema-qualified, so a
--       name comparison still matches only the public row. Both this fixture and the
--       implementor's go red when the `conrelid` scoping is deleted outright.
--
--   (2) RACE SAFETY, which nothing tests. `version` exists solely to stop two callers
--       from both winning. Every existing assertion is single-session, so deleting
--       ` FOR UPDATE` from the entrypoint's row read leaves the ENTIRE suite green
--       while production silently takes lost updates: two transactions read version N,
--       both pass the equality check, and the second overwrites the first's transition.
--       Proven here by lock mode: a row read with FOR UPDATE leaves a RowShareLock on
--       `public.reservations` held by this transaction. A plain SELECT followed by an
--       UPDATE leaves AccessShareLock + RowExclusiveLock and NEVER RowShareLock, so
--       this assertion goes red the moment the lock is removed. (Verified both ways
--       before this file was committed.)
--
--   (3) MONOTONICITY in the BACKWARD direction. The implementor's c3 already proves a
--       caller cannot steer the counter FORWARD (`SET version = 9999`). This is the
--       mirror case — `SET version = 1` on a row at version N must still land at N+1 —
--       because forward steering and backward steering are not the same production risk:
--       a backward write re-opens every optimistic-concurrency window the column exists
--       to close, letting an already-superseded caller's `expected_version` match again.
--       Stated plainly: this assertion OVERLAPS the implementor's c3 and both go red on
--       the same revert. It is here for the direction c3 does not cover, not as a new axis.
--
-- Everything behavioural rolls back; the decoy relation is dropped explicitly.
-- =====================================================================================

\set ON_ERROR_STOP on

-- -------------------------------------------------------------------------------------
-- ARRANGE (1): a relation that is ALSO named `reservations`, in another schema, holding
-- the same constraint name — then remove the real CHECK so the re-applied migration has
-- to re-add it against a genuinely ambiguous catalog.
-- -------------------------------------------------------------------------------------
DROP TABLE IF EXISTS private.issue_2592_race_decoy;
DROP TABLE IF EXISTS private.reservations;
CREATE TABLE private.reservations (version bigint NOT NULL DEFAULT 1);
ALTER TABLE private.reservations
  ADD CONSTRAINT reservations_version_positive CHECK (version > 0);
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_version_positive;

-- Re-apply the REAL migration, unmodified. Idempotent by construction.
\ir ../20270512001975_issue_1975_ari_stays_reservations.sql

BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '25920001-0000-4000-8000-000000000001';
  v_brand   constant uuid := '25920001-0000-4000-8000-000000000101';
  v_venue   constant uuid := '25920001-0000-4000-8000-000000000201';
  v_res     public.reservations;
  v_before  bigint;
  v_after   bigint;
  v_modes   text[];
BEGIN
  -- -----------------------------------------------------------------------------------
  -- (1) The CHECK landed on public.reservations despite a same-named constraint on a
  --     same-NAMED relation in another schema.
  -- -----------------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservations_version_positive'
       AND conrelid = 'private.reservations'::regclass
  ) THEN
    RAISE EXCEPTION 'issue_2592_arrange_broken_cross_schema_decoy_missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservations_version_positive'
       AND conrelid = 'public.reservations'::regclass
  ) THEN
    RAISE EXCEPTION
      'issue_2592_version_check_skipped_by_cross_schema_conname_collision: the existence probe did not scope to the public.reservations OID';
  END IF;

  -- -----------------------------------------------------------------------------------
  -- ARRANGE (2)(3): the smallest real brand/venue/reservation the canonical RPC accepts.
  -- -----------------------------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, aud, role, email)
  VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'issue2592-race@test.local'
  );
  INSERT INTO public.creator_accounts (id) VALUES (v_owner);
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_brand, v_owner, 'Issue 2592 Race Brand', 'issue2592racebrand');
  INSERT INTO public.venue_listings (
    id, brand_id, slug, name, lat, lng, venue_category
  ) VALUES (
    v_venue, v_brand, 'issue2592racevenue', 'Issue 2592 Race Venue',
    51.5074, -0.1278, 'restaurant'
  );

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  v_res := public.biz_reservation_create(
    v_venue, now() + interval '2 hours', 2, 'phone', 'Issue 2592 Race Guest'
  );

  -- -----------------------------------------------------------------------------------
  -- (2) The entrypoint must LOCK the row it version-checks, or the check is advisory.
  -- -----------------------------------------------------------------------------------
  PERFORM public.issue_1975_reservation_transition(
    v_res.id, 'seated', v_res.version, NULL, NULL
  );

  SELECT array_agg(DISTINCT mode ORDER BY mode) INTO v_modes
  FROM pg_locks
  WHERE relation = 'public.reservations'::regclass
    AND pid = pg_backend_pid()
    AND granted;

  IF v_modes IS NULL OR NOT ('RowShareLock' = ANY (v_modes)) THEN
    RAISE EXCEPTION
      'issue_2592_version_check_is_not_race_safe: the entrypoint read the row without FOR UPDATE (locks held: %). Two callers can both pass the version equality check and the second silently overwrites the first.',
      coalesce(array_to_string(v_modes, ','), 'none');
  END IF;

  -- -----------------------------------------------------------------------------------
  -- (3) A caller-supplied version must be OVERRIDDEN, never honoured.
  -- -----------------------------------------------------------------------------------
  SELECT version INTO v_before FROM public.reservations WHERE id = v_res.id;

  UPDATE public.reservations
     SET version = 1, party_size = party_size
   WHERE id = v_res.id;

  SELECT version INTO v_after FROM public.reservations WHERE id = v_res.id;

  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION
      'issue_2592_caller_supplied_version_was_honoured: version went %->% on an UPDATE that explicitly set version = 1; the BEFORE UPDATE trigger must override it to %',
      v_before, v_after, v_before + 1;
  END IF;

  RAISE NOTICE
    '#2592 tester adversarial: (1) CHECK survived a same-named relation in another schema, (2) entrypoint holds RowShareLock (locks: %), (3) caller-supplied version overridden %->% — ALL PASSED',
    array_to_string(v_modes, ','), v_before, v_after;
END;
$test$;

ROLLBACK;

-- The decoy is DDL and does not roll back with the behavioural block.
DROP TABLE IF EXISTS private.reservations;

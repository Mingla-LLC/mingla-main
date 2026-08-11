-- ===========================================================================
-- Issue #1860 — every table in `public` has row-level security, bar one.
--
-- This is the LIVE half. It reads `pg_class.relrowsecurity` on the REAL applied
-- schema, so it cannot be satisfied by a line of SQL that looks like an enable.
-- The static half —
-- `.github/scripts/strict-grep/issue-1860-public-tables-rls-enabled.mjs` — runs
-- on every PR without a database and asserts the migration chain; this one runs
-- in the containerised Postgres job with the whole chain applied. Neither is
-- sufficient alone: source can lie about the catalog, and a catalog assertion
-- cannot run on a PR that never reaches the container.
--
-- Why RLS is the whole question: the baseline squash carries the platform
-- standard `ALTER DEFAULT PRIVILEGES … IN SCHEMA public GRANT ALL ON TABLES`
-- for the standard roles (#1827), so a table's own GRANT lines cannot narrow
-- what it already holds. RLS off means no constraint at all.
--
-- T-1860-05 is the one that matters. Groups 01-04 read the catalog, and a
-- catalog assertion proves a switch is flipped, not that anything is refused —
-- so 05 BECOMES `anon` and reads, then turns RLS back off inside a savepoint
-- and reads again. If the second read does not see what the first could not,
-- the first proved nothing and the whole file fails.
--
-- Runs inside ONE transaction and ROLLBACKs.
-- ===========================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- T-1860-00 — VACUITY. Every group below asks a question about a set of tables.
-- If that set is tiny, every group passes by asking about almost nothing.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p');
  IF v_n < 300 THEN
    RAISE EXCEPTION
      'issue_1860 T-00 VACUITY: only % tables in public — the migration chain did not apply, so every assertion below is vacuous',
      v_n;
  END IF;
  RAISE NOTICE 'issue_1860 T-00: % tables in public', v_n;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1860-01 — THE RULE. No table in `public` has RLS disabled, except the one
-- documented exemption. Reported by name so a regression says which table.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_offenders text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_offenders
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r','p')
     AND c.relrowsecurity = false
     AND c.relname <> 'spatial_ref_sys';
  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1860 T-01: row-level security is DISABLED on public.{%} — RLS is the only constraint on this schema, so these carry none',
      v_offenders;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1860-02 — THE EXEMPTION IS EXACTLY WHAT IT CLAIMS. `spatial_ref_sys` is
-- exempt for one reason only: the PostGIS extension owns it, we do not, and the
-- ALTER would fail on a role we do not hold. If a first-party table ever took
-- that name, the exemption would be laundering a table we DO own — so the
-- extension ownership is asserted, not assumed.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_oid oid; v_ext int; v_owner text;
BEGIN
  SELECT c.oid, pg_get_userbyid(c.relowner) INTO v_oid, v_owner
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r','p')
     AND c.relname = 'spatial_ref_sys';

  IF v_oid IS NULL THEN
    -- PostGIS is not installed in this database. The exemption is then moot and
    -- T-01 above already proved the real rule with no exception applied.
    RAISE NOTICE 'issue_1860 T-02: spatial_ref_sys absent (PostGIS not installed); exemption unused';
    RETURN;
  END IF;

  SELECT count(*) INTO v_ext
    FROM pg_depend d
    JOIN pg_extension e ON e.oid = d.refobjid
   WHERE d.classid = 'pg_class'::regclass AND d.objid = v_oid AND d.deptype = 'e';

  IF v_ext = 0 THEN
    RAISE EXCEPTION
      'issue_1860 T-02: public.spatial_ref_sys is NOT extension-owned (owner %) — the single documented exemption only holds while an extension owns it',
      v_owner;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1860-03 — the tables #1860 fixed, by name, with a vacuity floor. T-01 would
-- already catch a regression on any of them; this group exists so a regression
-- names #1860's own list rather than reporting a generic offender.
--
-- `_archive_orch_0898_board_messages_pre_migration` is created by the chain and
-- never dropped by it, so a fresh replay HAS it; production does not, because it
-- was removed outside the chain. It is checked when present, which is why the
-- floor is 11 and not 12.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE v_tbl text; v_checked int := 0; v_rls boolean; v_forced boolean; v_pol int;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    '_archive_orch_0700_doomed_columns',
    '_archive_orch_0734_signal_anchors',
    '_archive_orch_0898_board_messages_pre_migration',
    '_backup_friends',
    '_backup_messages',
    '_backup_profiles',
    '_backup_user_sessions',
    '_deprecated_profiles_is_admin_backup',
    '_orch_0588_dead_cards_backup',
    '_orch_0588_dead_stops_backup',
    'seed_map_presence',
    'used_trial_phones'
  ] LOOP
    IF to_regclass('public.' || quote_ident(v_tbl)) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_forced
      FROM pg_class c
     WHERE c.oid = to_regclass('public.' || quote_ident(v_tbl));

    IF NOT v_rls THEN
      RAISE EXCEPTION 'issue_1860 T-03: public.% still has row-level security DISABLED', v_tbl;
    END IF;

    -- T-1860-04a — NOT forced, deliberately. FORCE subjects the table OWNER to
    -- RLS, and the owner is `postgres`, which is the role every live reader of
    -- these tables runs as (SECURITY DEFINER functions owned by postgres, and
    -- the service-role Edge clients). Adding FORCE would put a working feature
    -- one privilege change away from breaking.
    IF v_forced THEN
      RAISE EXCEPTION
        'issue_1860 T-04a: public.% is FORCE ROW LEVEL SECURITY — the owner-side readers were not audited for that',
        v_tbl;
    END IF;

    -- T-1860-04b — no policy. "RLS on, zero policies" IS the denial: every
    -- non-bypassing role matches no row on any command. A policy appearing here
    -- would open a door nobody asked for.
    SELECT count(*) INTO v_pol FROM pg_policies WHERE schemaname = 'public' AND tablename = v_tbl;
    IF v_pol <> 0 THEN
      RAISE EXCEPTION
        'issue_1860 T-04b: public.% grew % RLS policy/policies — these tables are denied to anon and authenticated by having NONE',
        v_tbl, v_pol;
    END IF;

    v_checked := v_checked + 1;
  END LOOP;

  IF v_checked < 11 THEN
    RAISE EXCEPTION
      'issue_1860 T-03 VACUITY: only % of the #1860 tables exist to be checked (floor 11)',
      v_checked;
  END IF;
  RAISE NOTICE 'issue_1860 T-03/T-04: % tables checked', v_checked;
END $t$;

-- ---------------------------------------------------------------------------
-- T-1860-05 — BEHAVIOURAL, and its own fails-on-revert.
--
-- Groups 01-04 prove a switch is flipped. This one BECOMES `anon` — the role
-- behind the public key — and reads a row that definitely exists.
--
-- Two honest worlds, both proved rather than assumed:
--   * anon holds SELECT (today's state, and the premise of #1860): RLS must
--     return zero rows, and turning RLS back off inside a savepoint MUST return
--     the row. If it does not, the zero was never RLS's doing.
--   * anon holds no SELECT (a future, stronger state): denial is by GRANT and
--     the privilege absence is asserted directly.
-- ---------------------------------------------------------------------------
INSERT INTO public._backup_friends (id, user_id, status)
VALUES ('00000000-0000-0000-0000-000000001860', '00000000-0000-0000-0000-000000001860', 'probe');

DO $t$
DECLARE v_n bigint; v_denied boolean := false; v_granted boolean;
BEGIN
  v_granted := has_table_privilege('anon', 'public._backup_friends', 'SELECT');

  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_n FROM public._backup_friends;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  RESET ROLE;

  IF v_granted THEN
    IF v_denied THEN
      RAISE EXCEPTION 'issue_1860 T-05a: anon holds SELECT but the read raised insufficient_privilege — the probe is not measuring what it thinks';
    END IF;
    IF v_n <> 0 THEN
      RAISE EXCEPTION
        'issue_1860 T-05a: anon read % row(s) from public._backup_friends — RLS is not denying an unauthenticated caller',
        v_n;
    END IF;
    RAISE NOTICE 'issue_1860 T-05a: anon holds SELECT and RLS returned 0 rows';
  ELSE
    IF NOT v_denied AND v_n <> 0 THEN
      RAISE EXCEPTION 'issue_1860 T-05a: anon holds no SELECT yet read % row(s)', v_n;
    END IF;
    RAISE NOTICE 'issue_1860 T-05a: anon holds no SELECT; denial is by GRANT, not RLS';
  END IF;
END $t$;

-- The revert half. Turn RLS back off on the same table and read again as anon.
-- With the grant in place the row MUST reappear; that is the proof T-05a's zero
-- came from RLS and not from an empty table, a missing grant, or a typo'd name.
SAVEPOINT issue_1860_revert;
ALTER TABLE public._backup_friends DISABLE ROW LEVEL SECURITY;

DO $t$
DECLARE v_n bigint; v_denied boolean := false; v_granted boolean;
BEGIN
  v_granted := has_table_privilege('anon', 'public._backup_friends', 'SELECT');
  IF NOT v_granted THEN
    RAISE NOTICE 'issue_1860 T-05b: anon holds no SELECT; the revert probe is not applicable';
    RETURN;
  END IF;

  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_n FROM public._backup_friends;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  RESET ROLE;

  IF v_denied OR v_n < 1 THEN
    RAISE EXCEPTION
      'issue_1860 T-05b FAILS-ON-REVERT BROKEN: with RLS DISABLED anon read % row(s) (denied=%) — T-05a''s zero was not RLS doing the work, so this file proves nothing',
      COALESCE(v_n, -1), v_denied;
  END IF;
  RAISE NOTICE 'issue_1860 T-05b: with RLS disabled anon read % row(s) — T-05a is falsifiable', v_n;
END $t$;

ROLLBACK TO SAVEPOINT issue_1860_revert;
RELEASE SAVEPOINT issue_1860_revert;

-- Belt: the rollback restored the enable.
DO $t$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public._backup_friends'::regclass) THEN
    RAISE EXCEPTION 'issue_1860 T-05c: the revert savepoint did not restore RLS on public._backup_friends';
  END IF;
END $t$;

ROLLBACK;

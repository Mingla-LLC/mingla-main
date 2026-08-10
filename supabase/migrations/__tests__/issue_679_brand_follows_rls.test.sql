-- Issue #679 (Wave 0 of #876) — TESTER adversarial BEHAVIORAL proof of the
-- brand_follows owner-only RLS (append-only; new file).
--
-- The implementor's Deno suite (issue_679_brand_follows.test.ts) pins the
-- MIGRATION TEXT. This file attacks the other side: the migration is APPLIED
-- to a real PostgreSQL 17 catalog and the policies are EXECUTED under the
-- anon / authenticated roles with auth.uid() minted per attacker. A migration
-- that reads correctly but behaves permissively (the text-pin blind spot)
-- fails here.
--
-- Harness: identical shape to issue_1771_friends_accept_trigger_dropped
-- .test.sql — fresh supabase/postgres:17.4.1.075 container, no baseline
-- replay; the workflow docker-cp's the #679 migration to
-- /issue_679_migration.sql and pipes this file through
-- `psql -v ON_ERROR_STOP=1`. Identity is minted through the image's REAL
-- auth.uid() (which reads the PostgREST GUC request.jwt.claim.sub — see
-- supabase/postgres init-scripts/00000000000001-auth-schema.sql at that tag);
-- the suite sets that same GUC per attacker. Nothing is created in the auth
-- schema on the image: its migration 20250421084701 REVOKEs CREATE on schema
-- auth from `postgres`, so any auth-schema DDL here would 42501 (the exact
-- red this arm replaces). On a bare PostgreSQL (local runs) the arm block
-- creates the missing pieces with the verbatim Supabase definition.
--
-- ATTACKS (every EXPECT-FAIL leg raises unless the exact SQLSTATE arrives, so
-- no leg can pass vacuously):
--   A-1  owner INSERT lands (vacuity guard for every rejection below)
--   A-2  duplicate follow raises 23505 (the unique key really backs the
--        client's 23505-as-success idempotency) and the ON CONFLICT DO
--        NOTHING upsert form is a clean no-op (SC-7)
--   A-3  cross-user INSERT (uid=A writing user_id=B) rejected, 42501
--   A-4  anon: SELECT and INSERT both rejected, 42501 (revoke all)
--   A-5  cross-user SELECT: attacker sees ZERO of the victim's rows while the
--        victim sees their own (paired legs)
--   A-6  cross-user DELETE: 0 rows affected, victim's row survives
--   A-7  BRAND-SIDE READ (the #876 Ring-2 boundary): a brand's own controller
--        identity reads its brand's follow rows — ZERO rows; and the catalog
--        carries EXACTLY the three owner policies, every qual/check being
--        (auth.uid() = user_id), so no policy CAN widen silently
--   A-8  no UPDATE path: even the OWNER's UPDATE mutates NOTHING. On the
--        Supabase image the initial-schema ALTER DEFAULT PRIVILEGES hands
--        authenticated UPDATE on every new public table, so the contract is
--        enforced by POLICY ABSENCE (RLS default-deny → zero-row no-op); on
--        a bare PostgreSQL the same attack dies 42501. Either way the row is
--        proven byte-unchanged, and the leg asserts it attacks as the
--        authenticated client role (owner/superuser would prove nothing)
--
-- Fails-on-revert: deleting the migration fails the workflow's docker cp;
-- loosening any policy/grant (adding a brand-side SELECT, widening the grant,
-- adding UPDATE) fails A-4/A-5/A-7/A-8. Whole file is additive — no
-- append-only token needed.
\set ON_ERROR_STOP on

BEGIN;

-- ── ARM: Supabase-shaped auth model + the two FK target tables ──
-- Everything auth-side is conditional: on the CI image the roles, the auth
-- schema, and auth.uid() ALREADY exist (and `postgres` may not CREATE in
-- schema auth), so the arm only fills gaps on a bare local PostgreSQL.
DO $arm$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS auth;
    -- Supabase's auth.uid() VERBATIM (the JWT sub claim via PostgREST's GUC);
    -- STABLE like the real function.
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $uid$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $uid$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  END IF;
END;
$arm$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Minimal FK targets (shape only — brand_follows FKs point here).
CREATE TABLE IF NOT EXISTS public.profiles (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.brands (id uuid PRIMARY KEY);

-- Personas: Alice (follower/victim), Bob (attacker), Carol (brand controller).
INSERT INTO public.profiles (id) VALUES
  ('679a0000-0000-0000-0000-00000000000a'),  -- Alice
  ('679b0000-0000-0000-0000-00000000000b'),  -- Bob
  ('679c0000-0000-0000-0000-00000000000c');  -- Carol
INSERT INTO public.brands (id) VALUES
  ('679d0000-0000-0000-0000-0000000000d1');  -- Carol's brand

-- ── APPLY the real #679 migration (docker-cp'd by the workflow) ──
\i /issue_679_migration.sql

-- ── A-1: owner INSERT lands (vacuity guard for every rejection below) ──
SET ROLE authenticated;
SET request.jwt.claim.sub = '679a0000-0000-0000-0000-00000000000a';

INSERT INTO public.brand_follows (user_id, brand_id)
VALUES ('679a0000-0000-0000-0000-00000000000a',
        '679d0000-0000-0000-0000-0000000000d1');

DO $a1$
BEGIN
  IF (SELECT count(*) FROM public.brand_follows
       WHERE user_id = '679a0000-0000-0000-0000-00000000000a') <> 1 THEN
    RAISE EXCEPTION 'issue-679 A-1: owner INSERT did not land / owner cannot read own row';
  END IF;
END;
$a1$;

-- ── A-2: duplicate follow → 23505; ON CONFLICT DO NOTHING → clean no-op ──
DO $a2$
DECLARE
  v_threw boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.brand_follows (user_id, brand_id)
    VALUES ('679a0000-0000-0000-0000-00000000000a',
            '679d0000-0000-0000-0000-0000000000d1');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '23505' THEN
      RAISE EXCEPTION
        'issue-679 A-2: expected 23505 unique_violation on duplicate follow, got % (%)',
        SQLSTATE, SQLERRM;
    END IF;
    v_threw := true;
  END;
  IF NOT v_threw THEN
    RAISE EXCEPTION
      'issue-679 A-2: duplicate follow did NOT raise — the unique key behind the client 23505-as-success path is missing';
  END IF;
END;
$a2$;

INSERT INTO public.brand_follows (user_id, brand_id)
VALUES ('679a0000-0000-0000-0000-00000000000a',
        '679d0000-0000-0000-0000-0000000000d1')
ON CONFLICT (user_id, brand_id) DO NOTHING;

DO $a2b$
BEGIN
  IF (SELECT count(*) FROM public.brand_follows
       WHERE user_id = '679a0000-0000-0000-0000-00000000000a') <> 1 THEN
    RAISE EXCEPTION 'issue-679 A-2: upsert no-op duplicated the follow row';
  END IF;
END;
$a2b$;

-- ── A-3: cross-user INSERT — Alice's session writing a row AS Bob ──
DO $a3$
DECLARE
  v_threw boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.brand_follows (user_id, brand_id)
    VALUES ('679b0000-0000-0000-0000-00000000000b',
            '679d0000-0000-0000-0000-0000000000d1');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      RAISE EXCEPTION
        'issue-679 A-3: expected 42501 RLS rejection of cross-user INSERT, got % (%)',
        SQLSTATE, SQLERRM;
    END IF;
    v_threw := true;
  END;
  IF NOT v_threw THEN
    RAISE EXCEPTION
      'issue-679 A-3: cross-user INSERT LANDED — a user can forge follows for other users';
  END IF;
END;
$a3$;

-- ── A-4: anon has zero access — SELECT and INSERT both 42501 ──
RESET ROLE;
SET ROLE anon;
SET request.jwt.claim.sub = '';

DO $a4$
DECLARE
  v_threw boolean := false;
  v_count integer;
BEGIN
  BEGIN
    SELECT count(*) INTO v_count FROM public.brand_follows;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      RAISE EXCEPTION
        'issue-679 A-4: expected 42501 permission denied for anon SELECT, got % (%)',
        SQLSTATE, SQLERRM;
    END IF;
    v_threw := true;
  END;
  IF NOT v_threw THEN
    RAISE EXCEPTION
      'issue-679 A-4: anon SELECT succeeded (revoke all from anon is not holding)';
  END IF;

  v_threw := false;
  BEGIN
    INSERT INTO public.brand_follows (user_id, brand_id)
    VALUES ('679b0000-0000-0000-0000-00000000000b',
            '679d0000-0000-0000-0000-0000000000d1');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      RAISE EXCEPTION
        'issue-679 A-4: expected 42501 permission denied for anon INSERT, got % (%)',
        SQLSTATE, SQLERRM;
    END IF;
    v_threw := true;
  END;
  IF NOT v_threw THEN
    RAISE EXCEPTION 'issue-679 A-4: anon INSERT succeeded';
  END IF;
END;
$a4$;

-- ── A-5: cross-user SELECT — Bob sees ZERO of Alice's rows ──
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '679b0000-0000-0000-0000-00000000000b';

DO $a5$
BEGIN
  IF (SELECT count(*) FROM public.brand_follows) <> 0 THEN
    RAISE EXCEPTION
      'issue-679 A-5: attacker (Bob) can SELECT other users'' follow rows';
  END IF;
END;
$a5$;

-- ── A-6: cross-user DELETE — silently filtered, victim's row survives ──
DO $a6$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.brand_follows
   WHERE user_id = '679a0000-0000-0000-0000-00000000000a';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION
      'issue-679 A-6: attacker (Bob) DELETED % of Alice''s follow rows', v_deleted;
  END IF;
END;
$a6$;

-- ── A-7: BRAND-SIDE READ — Carol (the brand's controller) sees ZERO rows;
--        and the catalog carries EXACTLY the three owner policies ──
SET request.jwt.claim.sub = '679c0000-0000-0000-0000-00000000000c';

DO $a7$
DECLARE
  v_bad integer;
BEGIN
  IF (SELECT count(*) FROM public.brand_follows
       WHERE brand_id = '679d0000-0000-0000-0000-0000000000d1') <> 0 THEN
    RAISE EXCEPTION
      'issue-679 A-7: a brand-side identity can read its followers'' rows — Ring-2 boundary (#876) breached';
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'brand_follows') <> 3 THEN
    RAISE EXCEPTION
      'issue-679 A-7: brand_follows carries % policies, expected exactly 3 (a 4th is a silent widening)',
      (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'brand_follows');
  END IF;

  -- every policy expression is exactly the owner check — nothing else may
  -- appear in qual or with_check
  SELECT count(*) INTO v_bad FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'brand_follows'
     AND coalesce(qual, with_check) IS DISTINCT FROM '(auth.uid() = user_id)';
  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      'issue-679 A-7: % brand_follows policies carry a non-owner expression', v_bad;
  END IF;
END;
$a7$;

-- ── A-8: no UPDATE path — even the OWNER's UPDATE mutates NOTHING ──
-- Supabase's initial-schema.sql runs ALTER DEFAULT PRIVILEGES granting ALL on
-- new public tables to authenticated, so the migration's select/insert/delete
-- grant does NOT withhold UPDATE — policy absence does (RLS default-deny).
-- There the attack is a zero-row no-op; on a bare PostgreSQL without those
-- default grants it dies earlier with 42501. ANY mutated row is the breach:
-- adding an UPDATE policy flips ROW_COUNT to 1 and fails here (and the
-- policy census in A-7).
SET request.jwt.claim.sub = '679a0000-0000-0000-0000-00000000000a';

DO $a8$
DECLARE
  v_threw boolean := false;
  v_updated integer := 0;
  v_source text;
BEGIN
  -- The leg must attack as the client role: the table OWNER (or a BYPASSRLS
  -- superuser) sails past RLS, and this leg would then "pass" while proving
  -- nothing (unfalsifiable-test guard).
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION
      'issue-679 A-8: leg is running as % — not the authenticated client role',
      current_user;
  END IF;

  BEGIN
    UPDATE public.brand_follows
       SET source = 'forged'
     WHERE user_id = '679a0000-0000-0000-0000-00000000000a';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      RAISE EXCEPTION
        'issue-679 A-8: expected 42501 or a zero-row RLS no-op on UPDATE, got % (%)',
        SQLSTATE, SQLERRM;
    END IF;
    v_threw := true;
  END;

  IF NOT v_threw AND v_updated <> 0 THEN
    RAISE EXCEPTION
      'issue-679 A-8: UPDATE mutated % row(s) — the no-update-path contract is gone',
      v_updated;
  END IF;

  -- Vacuity guard: the owner reads their own row back — 'forged' landing
  -- anywhere means the attack mutated state regardless of how it reported.
  SELECT source INTO v_source FROM public.brand_follows
   WHERE user_id = '679a0000-0000-0000-0000-00000000000a'
     AND brand_id = '679d0000-0000-0000-0000-0000000000d1';
  IF v_source IS DISTINCT FROM 'brand_page' THEN
    RAISE EXCEPTION
      'issue-679 A-8: follow row source reads % — the UPDATE mutated the row',
      v_source;
  END IF;
END;
$a8$;

RESET ROLE;

DO $done$
BEGIN
  RAISE NOTICE 'issue-679 RLS adversarial suite: ALL ATTACKS REPELLED';
END;
$done$;

ROLLBACK;

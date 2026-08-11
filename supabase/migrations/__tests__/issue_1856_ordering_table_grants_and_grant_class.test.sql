-- ===========================================================================
-- Issue #1856 — TRUNCATE on the four ordering tables, and the CLASS.
--
-- Two halves, and the second is the one that has to survive:
--
--   A-C  the four tables themselves — the LIVE ACL, then the TRUNCATE executed
--        as a real `authenticated` session, then a cross-check that the two
--        catalog authorities agree;
--   D    the class gate — NOTHING in schema `public` may hold a privilege for
--        anon/PUBLIC on a base table, or anything beyond SELECT for anyone,
--        outside the allowlist and the baseline frozen on 2026-08-11;
--   E    the vacuity guard — six probe relations, one per corner of the rule.
--        A check that cannot fail is not a check, and this whole class exists
--        because the grants nobody wrote were invisible to everything that
--        looked;
--   F    fails-on-revert — re-GRANT TRUNCATE and prove BOTH that the gate reds
--        AND that a real `authenticated` session can then actually empty the
--        table. Without F, "42501" in group B could be any refusal at all.
--
-- Every assertion reads the catalog or executes a statement. None of them look
-- at a REVOKE line in source: a REVOKE that did not work still looks exactly
-- like a REVOKE, which is how this survived #1789, #1819 and #1846.
--
-- Runs inside ONE transaction and ROLLBACKs.
-- ===========================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ===========================================================================
-- A-01  The four tables hold NOTHING for anon and NOTHING for PUBLIC.
--
-- Asserted per privilege rather than as one "has any" question, so a partial
-- revoke — the exact shape that produced this bug — fails loudly and names the
-- privilege it left behind.
-- ===========================================================================
DO $group_a$
DECLARE
  v_tbl  text;
  v_priv text;
  v_checked int := 0;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'qr_spots', 'menu_modifier_groups', 'menu_modifiers', 'venue_ordering_settings'
  ] LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      RAISE EXCEPTION 'A-01 VACUITY: public.% does not exist', v_tbl;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ] LOOP
      IF has_table_privilege('anon', 'public.' || v_tbl, v_priv) THEN
        RAISE EXCEPTION 'A-01: anon still holds % on public.%', v_priv, v_tbl;
      END IF;
      v_checked := v_checked + 1;
    END LOOP;
  END LOOP;

  IF v_checked <> 32 THEN
    RAISE EXCEPTION 'A-01 VACUITY: checked % pairs, expected 32', v_checked;
  END IF;

  -- PUBLIC reaches anon and authenticated both, and is invisible to a per-role
  -- audit. There must be no ACL entry for it on any of the four.
  IF EXISTS (
    SELECT 1
    FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname IN ('qr_spots','menu_modifier_groups','menu_modifiers','venue_ordering_settings')
      AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'A-01: one of the four ordering tables carries a grant to PUBLIC';
  END IF;
END $group_a$;

-- ===========================================================================
-- A-02  `authenticated` lost TRUNCATE, REFERENCES, TRIGGER and MAINTAIN, and
--       KEPT everything a live client path uses.
--
-- Both directions, because over-revoking is its own outage: every one of the
-- four is read straight through PostgREST by mingla-business, and #1846 proved
-- that dropping a needed read breaks the surface with no error anywhere.
-- ===========================================================================
DO $group_a2$
DECLARE
  v_tbl  text;
  v_priv text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'qr_spots', 'menu_modifier_groups', 'menu_modifiers', 'venue_ordering_settings'
  ] LOOP
    FOREACH v_priv IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
      IF has_table_privilege('authenticated', 'public.' || v_tbl, v_priv) THEN
        RAISE EXCEPTION
          'A-02: authenticated still holds % on public.% — RLS does not gate TRUNCATE',
          v_priv, v_tbl;
      END IF;
    END LOOP;

    IF NOT has_table_privilege('authenticated', 'public.' || v_tbl, 'SELECT') THEN
      RAISE EXCEPTION
        'A-02: authenticated LOST SELECT on public.% — the read path breaks SILENTLY', v_tbl;
    END IF;
  END LOOP;

  -- The three operator-edited tables keep their PostgREST write path
  -- (useQrSpots.ts:158, useMenuModifiers.ts:205/:231/:238/:267), gated by the
  -- "manager plus can write" policy at rank >= event_manager.
  FOREACH v_tbl IN ARRAY ARRAY['qr_spots', 'menu_modifier_groups', 'menu_modifiers'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('authenticated', 'public.' || v_tbl, v_priv) THEN
        RAISE EXCEPTION
          'A-02: authenticated lost % on public.% — the operator can no longer edit it',
          v_priv, v_tbl;
      END IF;
    END LOOP;
  END LOOP;

  -- venue_ordering_settings is SELECT-only for authenticated: the ordering
  -- switch is an edge-function decision (ruling OQ-7, locked by #1846).
  FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
    IF has_table_privilege('authenticated', 'public.venue_ordering_settings', v_priv) THEN
      RAISE EXCEPTION
        'A-02: authenticated regained % on venue_ordering_settings — OQ-7 says service-role only',
        v_priv;
    END IF;
  END LOOP;

  -- ...and service_role still runs the rail, or ordering is dead.
  IF NOT has_table_privilege('service_role', 'public.qr_spots', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.menu_modifiers', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.venue_ordering_settings', 'UPDATE') THEN
    RAISE EXCEPTION 'A-02: service_role cannot write the ordering tables';
  END IF;
END $group_a2$;

-- ===========================================================================
-- B  THE PROOF, EXECUTED. Become a real `authenticated` session — the role
--    PostgREST switches to for every signed-in Mingla user — and attempt the
--    TRUNCATE. It must be refused for LACK OF PRIVILEGE, asserted on SQLSTATE
--    42501 and never on message text.
--
--    Aimed at `venue_ordering_settings` because it is the only one of the four
--    with NO inbound foreign key (qr_spots is referenced by venue_order_sessions
--    and venue_orders; menu_modifiers by venue_order_item_modifiers;
--    menu_modifier_groups by menu_modifiers). On a referenced table a TRUNCATE
--    raises 0A000 the moment the PRIVILEGE CHECK PASSES, so a refusal would
--    look identical to the bug. On a leaf, 42501 is the only way to fail and
--    this cannot pass for the wrong reason. The other three are covered by the
--    per-privilege ACL sweep above and by group F below.
-- ===========================================================================
DO $group_b$
DECLARE
  v_state   text;
  v_refused boolean := false;
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    TRUNCATE public.venue_ordering_settings;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    v_state   := SQLSTATE;
    v_refused := (v_state = '42501');
  END;
  RESET ROLE;

  IF NOT v_refused THEN
    RAISE EXCEPTION
      'B-01: authenticated TRUNCATE of venue_ordering_settings was not refused for lack of privilege (sqlstate %)',
      coalesce(v_state, 'none — IT SUCCEEDED');
  END IF;
END $group_b$;

-- ===========================================================================
-- C  The two catalog authorities agree on the four tables.
--
--    `has_table_privilege()` answers the EFFECTIVE question (it follows role
--    membership and PUBLIC); `pg_class.relacl` via aclexplode() answers the
--    DIRECT-ACL question (what a REVOKE actually targets). The guard is built
--    on the second. If they ever disagree, a privilege is arriving by a route
--    the guard does not model, and the guard is lying.
-- ===========================================================================
DO $group_c$
DECLARE
  v_role text;
  v_tbl  text;
  v_priv text;
  v_acl  boolean;
  v_eff  boolean;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_tbl IN ARRAY ARRAY[
      'qr_spots', 'menu_modifier_groups', 'menu_modifiers', 'venue_ordering_settings'
    ] LOOP
      FOREACH v_priv IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ] LOOP
        SELECT EXISTS (
          SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
          WHERE c.relnamespace = 'public'::regnamespace
            AND c.relname = v_tbl
            AND (a.grantee = 0 OR a.grantee::regrole::text = v_role)
            AND a.privilege_type = v_priv
        ) INTO v_acl;
        v_eff := has_table_privilege(v_role, 'public.' || v_tbl, v_priv);
        IF v_acl <> v_eff THEN
          RAISE EXCEPTION
            'C-01: direct ACL and effective privilege disagree for % on public.% (% vs %) — % / %',
            v_role, v_tbl, v_acl, v_eff, v_priv, 'the guard models only the ACL';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $group_c$;

-- ===========================================================================
-- D  THE CLASS GATE. No offender anywhere in `public` outside the allowlist
--    and the frozen baseline.
--
--    This is the assertion that makes #1856 the LAST time this class ships.
--    Every previous instance passed review because the offending grant is
--    written by `ALTER DEFAULT PRIVILEGES` at CREATE TABLE time and no source
--    line ever says it. A grep cannot match a line that does not exist; the
--    catalog is the only witness.
-- ===========================================================================
DO $group_d$
DECLARE
  v_new text;
BEGIN
  SELECT string_agg(
           relation_kind || ' public.' || relation_name || '  ->  ' || grantee ||
           ' holds ' || privilege_type || E'\n      fix: ' || remediation,
           E'\n    ' ORDER BY relation_name, grantee, privilege_type)
    INTO v_new
  FROM public.audit_overbroad_table_grants()
  WHERE NOT is_baselined;

  IF v_new IS NOT NULL THEN
    RAISE EXCEPTION
      'D-01 NEW over-broad grants in schema public, beyond the #1856 baseline:%',
      E'\n    ' || v_new ||
      E'\n  These are NOT to be added to the baseline. Revoke them, or state a reason in the allowlist.';
  END IF;
END $group_d$;

-- ===========================================================================
-- E  VACUITY GUARD — six probe relations, one per corner of the rule.
--
--    Note that `issue_1856_probe_default` is created with NO grant statement
--    at all. If it comes back holding TRUNCATE for anon and authenticated,
--    that is `ALTER DEFAULT PRIVILEGES` writing the bug in front of the test,
--    live, in this database — which is simultaneously the root-cause
--    demonstration and the proof that group D above is not vacuous.
-- ===========================================================================
CREATE TABLE public.issue_1856_probe_default (id int PRIMARY KEY);

CREATE TABLE public.issue_1856_probe_clean (id int PRIMARY KEY);
REVOKE ALL ON public.issue_1856_probe_clean FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.issue_1856_probe_clean TO authenticated;

CREATE TABLE public.issue_1856_probe_anon_select (id int PRIMARY KEY);
REVOKE ALL ON public.issue_1856_probe_anon_select FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.issue_1856_probe_anon_select TO anon;

CREATE TABLE public.issue_1856_probe_public_grant (id int PRIMARY KEY);
REVOKE ALL ON public.issue_1856_probe_public_grant FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.issue_1856_probe_public_grant TO PUBLIC;

CREATE VIEW public.issue_1856_probe_view_read AS
  SELECT id FROM public.issue_1856_probe_clean;
REVOKE ALL ON public.issue_1856_probe_view_read FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.issue_1856_probe_view_read TO anon, authenticated;

CREATE VIEW public.issue_1856_probe_view_write AS
  SELECT id FROM public.issue_1856_probe_clean;
REVOKE ALL ON public.issue_1856_probe_view_write FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.issue_1856_probe_view_write TO anon;

DO $group_e$
DECLARE
  v_flagged text[];
  v_default_privs text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT relation_name ORDER BY relation_name), '{}')
    INTO v_flagged
  FROM public.audit_overbroad_table_grants()
  WHERE relation_name LIKE 'issue\_1856\_probe\_%';

  -- E-01  A table created with NO grant statement arrives holding the full
  --       default set. This IS the bug class, reproduced live.
  SELECT coalesce(array_agg(DISTINCT privilege_type ORDER BY privilege_type), '{}')
    INTO v_default_privs
  FROM public.audit_overbroad_table_grants()
  WHERE relation_name = 'issue_1856_probe_default' AND grantee = 'authenticated';
  IF NOT ('TRUNCATE' = ANY (v_default_privs)) THEN
    RAISE EXCEPTION
      'E-01 a table created with no GRANT did NOT arrive holding TRUNCATE for authenticated — either ALTER DEFAULT PRIVILEGES is not active on this database (so group D proves nothing) or the guard is blind. Saw: %',
      v_default_privs;
  END IF;
  IF NOT ('issue_1856_probe_default' = ANY (v_flagged)) THEN
    RAISE EXCEPTION 'E-01 the guard MISSED a raw default-grant table — group D is vacuous';
  END IF;

  -- E-02  A base table with anon SELECT and nothing else is still an offence:
  --       an anonymous read belongs behind a view or an RPC, where the column
  --       list is chosen rather than inherited.
  IF NOT ('issue_1856_probe_anon_select' = ANY (v_flagged)) THEN
    RAISE EXCEPTION 'E-02 the guard MISSED anon SELECT on a base table';
  END IF;

  -- E-03  A grant to PUBLIC reaches anon and authenticated and is invisible to
  --       any per-role query. It must be caught, and reported as PUBLIC.
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_overbroad_table_grants()
    WHERE relation_name = 'issue_1856_probe_public_grant' AND grantee = 'PUBLIC'
  ) THEN
    RAISE EXCEPTION 'E-03 the guard MISSED a grant to PUBLIC on a base table';
  END IF;

  -- E-04  A view granted INSERT to anon is caught. This is not hypothetical:
  --       a simple auto-updatable view that is NOT security_invoker executes
  --       its write as the VIEW OWNER, so the base table's RLS never runs.
  IF NOT ('issue_1856_probe_view_write' = ANY (v_flagged)) THEN
    RAISE EXCEPTION 'E-04 the guard MISSED INSERT granted to anon on a view';
  END IF;

  -- E-05  ...and the clean shapes are NOT caught, or the guard is unusable
  --       noise and the next reader will disable it.
  IF 'issue_1856_probe_clean' = ANY (v_flagged) THEN
    RAISE EXCEPTION 'E-05 the guard false-flagged a table revoked down to authenticated SELECT';
  END IF;
  IF 'issue_1856_probe_view_read' = ANY (v_flagged) THEN
    RAISE EXCEPTION 'E-06 the guard false-flagged SELECT on a view — that IS the public read surface';
  END IF;

  -- E-07  Exactly the four planted offenders and no more.
  IF array_length(v_flagged, 1) <> 4 THEN
    RAISE EXCEPTION 'E-07 expected exactly 4 flagged probes, got: %', v_flagged;
  END IF;

  -- E-08  Nothing planted here is baselined. A frozen baseline that quietly
  --       absorbed new relations would make group D permanently green.
  IF EXISTS (
    SELECT 1 FROM public.audit_overbroad_table_grants()
    WHERE relation_name LIKE 'issue\_1856\_probe\_%' AND is_baselined
  ) THEN
    RAISE EXCEPTION 'E-08 a freshly planted probe was reported as BASELINED';
  END IF;
END $group_e$;

DROP VIEW public.issue_1856_probe_view_write;
DROP VIEW public.issue_1856_probe_view_read;
DROP TABLE public.issue_1856_probe_public_grant;
DROP TABLE public.issue_1856_probe_anon_select;
DROP TABLE public.issue_1856_probe_clean;
DROP TABLE public.issue_1856_probe_default;

-- ===========================================================================
-- E-09  The allowlist is doing work, not decorating the file. `authenticated`
--       genuinely holds UPDATE on qr_spots — the operator edits spots straight
--       through PostgREST — and the guard must stay silent about exactly that
--       triple while still reporting anything else on the same table.
-- ===========================================================================
DO $group_e9$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.qr_spots', 'UPDATE') THEN
    RAISE EXCEPTION 'E-09 VACUITY: authenticated does not hold UPDATE on qr_spots, so the allowlist row proves nothing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.audit_overbroad_table_grants()
    WHERE relation_name = 'qr_spots' AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'E-09 the allowlist did not suppress the reasoned qr_spots UPDATE grant';
  END IF;
END $group_e9$;

-- ===========================================================================
-- F  FAILS-ON-REVERT. Put TRUNCATE back and prove three things at once:
--      1. the guard reds, naming all four tables;
--      2. a real `authenticated` session can then ACTUALLY EMPTY the table —
--         so the 42501 in group B was the privilege and not some other
--         refusal, and the vulnerability in the issue is not a theory;
--      3. rolling the grant away returns the schema to clean, so this group
--         cannot leave the gate poisoned for whatever runs after it.
-- ===========================================================================
SAVEPOINT issue_1856_revert;

GRANT TRUNCATE ON public.qr_spots                TO authenticated;
GRANT TRUNCATE ON public.menu_modifier_groups    TO authenticated;
GRANT TRUNCATE ON public.menu_modifiers          TO authenticated;
GRANT TRUNCATE ON public.venue_ordering_settings TO authenticated;

DO $group_f$
DECLARE
  v_flagged text[];
  v_state   text;
  v_truncated boolean := false;
BEGIN
  -- F-01  The gate reds on all four, and reds as NEW rather than baselined.
  SELECT coalesce(array_agg(DISTINCT relation_name ORDER BY relation_name), '{}')
    INTO v_flagged
  FROM public.audit_overbroad_table_grants()
  WHERE NOT is_baselined AND privilege_type = 'TRUNCATE' AND grantee = 'authenticated';

  IF v_flagged <> ARRAY[
    'menu_modifier_groups', 'menu_modifiers', 'qr_spots', 'venue_ordering_settings'
  ] THEN
    RAISE EXCEPTION
      'F-01 the guard did not red on the reverted TRUNCATE grants — it caught: %', v_flagged;
  END IF;

  -- F-02  And the grant is not cosmetic: with it, a signed-in user with no
  --       brand membership at all empties the table. RLS is enabled on it and
  --       does not help, because RLS does not gate TRUNCATE.
  BEGIN
    SET LOCAL ROLE authenticated;
    TRUNCATE public.venue_ordering_settings;
    v_truncated := true;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;

  IF NOT v_truncated THEN
    RAISE EXCEPTION
      'F-02 VACUITY: even WITH the TRUNCATE grant the statement failed (sqlstate %) — group B''s 42501 proves nothing about privilege',
      coalesce(v_state, 'unknown');
  END IF;
END $group_f$;

ROLLBACK TO SAVEPOINT issue_1856_revert;

-- F-03  Back to clean. The revert left nothing behind.
DO $group_f3$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left
  FROM public.audit_overbroad_table_grants()
  WHERE NOT is_baselined;
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'F-03 the schema did not return to clean after the revert: % new offenders', v_left;
  END IF;
  IF has_table_privilege('authenticated', 'public.qr_spots', 'TRUNCATE') THEN
    RAISE EXCEPTION 'F-03 the savepoint rollback did not remove the reverted TRUNCATE grant';
  END IF;
END $group_f3$;

ROLLBACK;

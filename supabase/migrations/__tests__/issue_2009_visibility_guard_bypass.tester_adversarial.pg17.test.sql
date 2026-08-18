-- =====================================================================
-- issue #2009 — TESTER-OWNED ADVERSARIAL SIBLING.
--
-- Owner: mingla-tester (independent verification of pass 1).
-- Contract: AMENDMENT 3B (#issuecomment-5317545075) > 3A (#issuecomment-5317431821)
--           > AMENDMENT 3 (#issuecomment-5317187049) > AMENDMENT 1
--           (#issuecomment-5283729259) > original SPEC SC-1..SC-24.
--           SC-31..SC-37 are HELD IN ABEYANCE and are NOT asserted here.
--
-- ANGLE. The implementor's suites attack the write guard through the shape a
-- product client actually sends: one UPDATE that names `visibility` on a row
-- whose `event_type` is already `'event'`. This file attacks the guard's
-- ENABLING CONDITIONS instead — the trigger's column list and its
-- `event_type = 'event'` scope — plus the statement classes the guard never
-- sees at all. Every #2009 guard is deliberately scoped to `event_type='event'`
-- because `biz_update_live_rsvp` writes `visibility='private'` for RSVP rows;
-- this file asks what that scoping costs.
--
-- Per #2113 every assertion EXECUTES an object against real rows. There is no
-- source-text assertion in this file. The whole point of the primary section is
-- that it is only findable by performing the mutation.
--
-- Run with:
--   psql -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/__tests__/issue_2009_visibility_guard_bypass.tester_adversarial.pg17.test.sql
-- after applying every migration in timestamp order to
-- supabase/postgres:17.4.1.075.
--
-- The file RAISES at the end if any assertion failed, so a green run is the
-- only passing outcome.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

DROP SCHEMA IF EXISTS i2009adv CASCADE;

DO $preclean$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.events
            WHERE brand_id IN ('00000000-2009-4ad0-8000-0000000000a1',
                               '00000000-2009-4ad0-8000-0000000000b1')
  LOOP
    DELETE FROM public.audit_log                              WHERE event_id = r.id;
    DELETE FROM public.event_visibility_transition_effects    WHERE event_id = r.id;
    DELETE FROM public.event_dates                            WHERE event_id = r.id;
    DELETE FROM public.events                                 WHERE id       = r.id;
  END LOOP;
  DELETE FROM public.brand_team_members WHERE brand_id IN ('00000000-2009-4ad0-8000-0000000000a1',
                                                           '00000000-2009-4ad0-8000-0000000000b1');
  DELETE FROM public.brands            WHERE id       IN ('00000000-2009-4ad0-8000-0000000000a1',
                                                          '00000000-2009-4ad0-8000-0000000000b1');
  DELETE FROM public.profiles          WHERE id       IN ('00000000-2009-4ad0-8000-00000000000a',
                                                          '00000000-2009-4ad0-8000-00000000000b');
  DELETE FROM public.creator_accounts  WHERE id       IN ('00000000-2009-4ad0-8000-00000000000a',
                                                          '00000000-2009-4ad0-8000-00000000000b');
  DELETE FROM auth.users               WHERE id       IN ('00000000-2009-4ad0-8000-00000000000a',
                                                          '00000000-2009-4ad0-8000-00000000000b');
END $preclean$;

CREATE SCHEMA i2009adv;

CREATE TABLE i2009adv.result(
  id        serial primary key,
  section   text not null,
  criterion text not null,
  name      text not null,
  outcome   text not null,
  detail    text
);

CREATE FUNCTION i2009adv.assert(
  p_section text, p_criterion text, p_name text, p_ok boolean, p_detail text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO i2009adv.result(section, criterion, name, outcome, detail)
  VALUES (p_section, p_criterion, p_name, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_detail);
END $$;

CREATE FUNCTION i2009adv.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END $$;

CREATE FUNCTION i2009adv.gen() RETURNS bigint LANGUAGE sql AS $$
  SELECT generation FROM public.event_discovery_generation WHERE singleton;
$$;

CREATE FUNCTION i2009adv.try_set(
  p_user uuid, p_event uuid, p_vis text, p_reason text, p_expected timestamptz
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM i2009adv.act_as(p_user);
  BEGIN
    v := public.business_set_event_visibility(p_event, p_vis, p_reason, p_expected);
    RETURN 'OK:' || v::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END;
END $$;

-- Make a fresh standard ticketed event for one attack, so no attack inherits
-- another's residue.
CREATE FUNCTION i2009adv.mk_event(p_key text, p_vis text, p_status text, p_type text DEFAULT 'event')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_ev uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.events(id, brand_id, title, slug, event_type, visibility, status,
                            timezone, published_at, currency)
  VALUES (v_ev, '00000000-2009-4ad0-8000-0000000000a1', 'I2009ADV ' || p_key,
          'i2009adv-' || replace(p_key, '_', '-') || '-' || substr(v_ev::text, 1, 8),
          p_type, p_vis, p_status, 'UTC', now(), 'USD');
  INSERT INTO public.event_dates(event_id, start_at, end_at, is_master, timezone)
  VALUES (v_ev, now() + interval '15 day', now() + interval '15 day 3 hour', true, 'UTC');
  RETURN v_ev;
END $$;

-- ---------------------------------------------------------------------
-- Fixtures: brand A with an event_manager, brand B with its own manager.
-- ---------------------------------------------------------------------
DO $fx$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  uB uuid := '00000000-2009-4ad0-8000-00000000000b';
  bA uuid := '00000000-2009-4ad0-8000-0000000000a1';
  bB uuid := '00000000-2009-4ad0-8000-0000000000b1';
BEGIN
  INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES (uA, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'adv-a@i2009adv.test', 'x', now(), now()),
         (uB, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'adv-b@i2009adv.test', 'x', now(), now())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.creator_accounts(id) VALUES (uA), (uB) ON CONFLICT DO NOTHING;
  INSERT INTO public.brands(id, account_id, name, slug, claim_status, pricing_currency, default_currency)
  VALUES (bA, uA, 'I2009ADV Brand A', 'i2009adv-brand-a', 'verified', 'usd', 'USD'),
         (bB, uB, 'I2009ADV Brand B', 'i2009adv-brand-b', 'verified', 'usd', 'USD');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (bA, uA, 'event_manager', now()), (bB, uB, 'event_manager', now())
  ON CONFLICT (brand_id, user_id) WHERE removed_at IS NULL
    DO UPDATE SET role = EXCLUDED.role, accepted_at = EXCLUDED.accepted_at;
END $fx$;

-- =====================================================================
-- T0 — NON-VACUITY CONTROLS.
--      Everything after this is only meaningful if the guard is actually
--      installed and actually refuses the naive shape. If T0 fails, the
--      bypass sections below prove nothing.
-- =====================================================================
DO $t0$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  ev uuid; msg text; rows_hit int;
BEGIN
  ev := i2009adv.mk_event('t0_control', 'public', 'live');
  PERFORM i2009adv.act_as(uA);

  -- T0.1 the naive one-statement direct write IS refused (SC-8 as tested today).
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET visibility = 'hidden' WHERE id = ev;
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  PERFORM i2009adv.assert('T0','SC-8',
    'CONTROL: a one-statement authenticated visibility UPDATE is refused',
    msg = 'event_visibility_direct_update_blocked', msg);

  -- T0.2 the same caller CAN write the row, so T0.1 is the guard, not RLS.
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET title = 'I2009ADV control touched' WHERE id = ev;
    GET DIAGNOSTICS rows_hit = ROW_COUNT;
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM; rows_hit := -1;
  END;
  PERFORM i2009adv.assert('T0','SC-8',
    'CONTROL: the same caller can still write a non-visibility column',
    msg = '<no error>' AND rows_hit = 1, msg || ' rows=' || rows_hit);

  -- T0.3 the Private boundary is refused for the naive shape too.
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET visibility = 'private' WHERE id = ev;
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  PERFORM i2009adv.assert('T0','SC-12',
    'CONTROL: a one-statement authenticated Private write is refused',
    msg = 'private_visibility_unavailable', msg);

  -- T0.4 and the combined single statement is refused as well, because OLD
  --      still reads `event`.
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET event_type = 'rsvp', visibility = 'private' WHERE id = ev;
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  PERFORM i2009adv.assert('T0','SC-12',
    'CONTROL: retyping and flipping Private in ONE statement is refused',
    msg = 'private_visibility_unavailable', msg);
END $t0$;

-- =====================================================================
-- T1 — THE ATTACK: `event_type` laundering defeats every #2009 guard.
--
--      The BEFORE guard is `BEFORE UPDATE OF visibility`, so a statement that
--      does not NAME visibility never runs it. Both the BEFORE guard and the
--      AFTER effects coordinator then skip any row whose OLD and NEW
--      `event_type` are both other than 'event'. Three ordinary PostgREST
--      PATCHes therefore walk a standard ticketed event straight past the
--      Private fail-closed boundary, the audit contract and the discovery
--      generation:
--
--        1. PATCH {"event_type":"rsvp"}       -- visibility not named
--        2. PATCH {"visibility":"private"}    -- OLD and NEW type are 'rsvp'
--        3. PATCH {"event_type":"event"}      -- visibility not named
--
--      The actor must already be an event_manager of the owning brand (RLS is
--      intact — see T4), so this is not privilege escalation. It is evasion of
--      SC-8, SC-9, SC-12 and SC-14/SC-15 by an ordinary authorised editor
--      using nothing but the table PostgREST already exposes.
-- =====================================================================
DO $t1$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  ev uuid; msg text;
  g0 bigint; g1 bigint;
  aud int; eff int;
  fin_vis text; fin_type text;
BEGIN
  ev := i2009adv.mk_event('t1_launder_private', 'public', 'live');
  g0 := i2009adv.gen();
  PERFORM i2009adv.act_as(uA);

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET event_type = 'rsvp'    WHERE id = ev;
    UPDATE public.events SET visibility = 'private' WHERE id = ev;
    UPDATE public.events SET event_type = 'event'   WHERE id = ev;
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;

  g1 := i2009adv.gen();
  SELECT visibility, event_type INTO fin_vis, fin_type FROM public.events WHERE id = ev;
  SELECT count(*) INTO aud FROM public.audit_log
   WHERE event_id = ev AND action = 'event.visibility_changed';
  SELECT count(*) INTO eff FROM public.event_visibility_transition_effects WHERE event_id = ev;

  PERFORM i2009adv.assert('T1','SC-12',
    'a three-statement authenticated launder CANNOT put a standard event into Private',
    fin_vis <> 'private',
    format('error=%s final_visibility=%s final_event_type=%s', msg, fin_vis, fin_type));

  PERFORM i2009adv.assert('T1','SC-8',
    'no authenticated statement sequence may change a standard event''s visibility off-RPC',
    msg = 'event_visibility_direct_update_blocked'
      OR msg = 'private_visibility_unavailable',
    'guard verdict was: ' || msg);

  PERFORM i2009adv.assert('T1','SC-9',
    'a visibility change that landed leaves exactly one audit row (never zero)',
    (fin_vis = 'public') OR aud = 1,
    format('final=%s audit_rows=%s', fin_vis, aud));

  PERFORM i2009adv.assert('T1','SC-9A',
    'a visibility change that landed leaves exactly one transition-effect row',
    (fin_vis = 'public') OR eff = 1,
    format('final=%s effect_rows=%s', fin_vis, eff));

  PERFORM i2009adv.assert('T1','SC-14',
    'a visibility change that landed moved the discovery generation',
    (fin_vis = 'public') OR g1 > g0,
    format('final=%s generation %s -> %s', fin_vis, g0, g1));
END $t1$;

-- ---------------------------------------------------------------------
-- T1b — the same laundering to `hidden`. This is the Public -> Unlisted leg
--       AMENDMENT 3A exists for, and it is the one that has a live privacy
--       consequence today: with the generation unmoved the discover cache key
--       is unchanged, so the pre-change deck stays servable for the full
--       DISCOVER_CACHE_TTL_MS / DISCOVER_STALE_TTL_MS window (120s / 600s) —
--       the exact ten-minute hole 3A closed for the RPC path.
-- ---------------------------------------------------------------------
DO $t1b$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  ev uuid; msg text; g0 bigint; g1 bigint; fin_vis text; fin_type text;
BEGIN
  ev := i2009adv.mk_event('t1b_launder_hidden', 'public', 'live');
  g0 := i2009adv.gen();
  PERFORM i2009adv.act_as(uA);
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET event_type = 'rsvp'   WHERE id = ev;
    UPDATE public.events SET visibility = 'hidden' WHERE id = ev;
    UPDATE public.events SET event_type = 'event'  WHERE id = ev;
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  g1 := i2009adv.gen();
  SELECT visibility, event_type INTO fin_vis, fin_type FROM public.events WHERE id = ev;

  PERFORM i2009adv.assert('T1b','SC-14',
    'a Public -> Unlisted change by ANY authenticated path bumps the discovery generation',
    (fin_vis = 'public') OR g1 > g0,
    format('error=%s final_visibility=%s final_event_type=%s generation %s -> %s',
           msg, fin_vis, fin_type, g0, g1));
END $t1b$;

-- ---------------------------------------------------------------------
-- T1c — once laundered into Private the row is UNRECOVERABLE. Business
--       refuses `private_visibility_unavailable` on the exit leg and Admin
--       refuses `private_transition_requires_business`, so the organiser has
--       trapped their own event with no supported way out until #2144.
--       This is also true of any standard event ALREADY at `private` in
--       production before the migration applies — an operator pre-deploy count
--       is required.
-- ---------------------------------------------------------------------
DO $t1c$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  ev uuid; biz text; adm text;
BEGIN
  ev := i2009adv.mk_event('t1c_stranded', 'private', 'scheduled');

  biz := i2009adv.try_set(uA, ev, 'public', 'tester recovery attempt reason',
                          (SELECT updated_at FROM public.events WHERE id = ev));
  BEGIN
    PERFORM public.admin_set_offering_visibility(ev, 'public', 'tester admin recovery');
    adm := '<no error>';
  EXCEPTION WHEN OTHERS THEN adm := SQLERRM;
  END;

  PERFORM i2009adv.assert('T1c','SC-12',
    'RECORDED (not a pass/fail of the fix): a standard event at private has no supported exit',
    biz = 'private_visibility_unavailable',
    format('business=%s admin=%s', biz, adm));
  PERFORM i2009adv.assert('T1c','SC-29',
    'RECORDED: Admin also refuses the exit leg, so nothing can unstick such a row',
    adm LIKE '%private_transition_requires_business%' OR adm LIKE '%not_authorized%',
    format('admin=%s', adm));
END $t1c$;

-- =====================================================================
-- T2 — the guard is UPDATE-only. An authenticated event_manager can INSERT a
--      standard ticketed event straight into `private`, so a Private standard
--      event can be created while the boundary is supposed to be closed.
--      No discovery generation moves and no effect row is written.
-- =====================================================================
DO $t2$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  bA uuid := '00000000-2009-4ad0-8000-0000000000a1';
  ev uuid := gen_random_uuid();
  msg text; got text;
BEGIN
  PERFORM i2009adv.act_as(uA);
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type,
                              visibility, status, timezone, currency)
    VALUES (ev, bA, uA, 'I2009ADV t2 insert', 'i2009adv-t2-insert', 'event',
            'private', 'scheduled', 'UTC', 'USD');
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  SELECT visibility INTO got FROM public.events WHERE id = ev;

  PERFORM i2009adv.assert('T2','SC-12',
    'an authenticated INSERT cannot create a standard ticketed event at Private',
    coalesce(got, 'absent') <> 'private',
    format('error=%s stored=%s', msg, coalesce(got, '<no row>')));
END $t2$;

-- =====================================================================
-- T3 — attacks the shipped implementation SURVIVES. These are the
--      fails-on-revert anchors for this file.
-- =====================================================================

-- T3.1 — reason boundaries, and whether the 10-character floor can be met with
--        characters that carry no information. `btrim` strips ASCII space only,
--        so a reason of ten NO-BREAK SPACEs (U+00A0) would satisfy a naive
--        length check. Probe it.
DO $t31$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  ev uuid; r text; ts timestamptz;
BEGIN
  ev := i2009adv.mk_event('t31_reason', 'public', 'live');
  SELECT updated_at INTO ts FROM public.events WHERE id = ev;

  r := i2009adv.try_set(uA, ev, 'unlisted', repeat('a', 9), ts);
  PERFORM i2009adv.assert('T3.1','SC-6', 'a 9-character reason is refused',
    r = 'invalid_edit_reason', r);

  r := i2009adv.try_set(uA, ev, 'unlisted', repeat('a', 201), ts);
  PERFORM i2009adv.assert('T3.1','SC-6', 'a 201-character reason is refused',
    r = 'invalid_edit_reason', r);

  r := i2009adv.try_set(uA, ev, 'unlisted', repeat('a', 200), ts);
  PERFORM i2009adv.assert('T3.1','SC-6', 'a 200-character reason is exactly on the boundary and accepted',
    r LIKE 'OK:%', r);

  -- put it back so the next probe has a real diff to make
  PERFORM i2009adv.try_set(uA, ev, 'public', repeat('b', 10),
    (SELECT updated_at FROM public.events WHERE id = ev));

  r := i2009adv.try_set(uA, ev, 'unlisted', repeat('c', 10),
    (SELECT updated_at FROM public.events WHERE id = ev));
  PERFORM i2009adv.assert('T3.1','SC-6', 'a 10-character reason is exactly on the boundary and accepted',
    r LIKE 'OK:%', r);

  -- RECORDED: a reason of ten U+00A0 characters. char_length counts characters,
  -- btrim() strips ASCII whitespace only, so this passes the floor while
  -- carrying nothing an auditor could read.
  PERFORM i2009adv.try_set(uA, ev, 'public', repeat('d', 10),
    (SELECT updated_at FROM public.events WHERE id = ev));
  r := i2009adv.try_set(uA, ev, 'unlisted', repeat(U&'\00A0', 10),
    (SELECT updated_at FROM public.events WHERE id = ev));
  PERFORM i2009adv.assert('T3.1','SC-6',
    'RECORDED: an all-U+00A0 reason is accepted by the 10..200 bound',
    true, 'verdict=' || left(r, 40));
END $t31$;

-- T3.2 — ORDER OF EVALUATION. A same-value request on a row that is ALREADY
--        private returns the idempotent no-op instead of the Private refusal,
--        because step (6) precedes step (7). That is the SPEC's stated order
--        (§2.7 before §9); assert it deliberately so a later reordering that
--        makes a Private no-op raise is caught as a change of contract.
DO $t32$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  ev uuid; r text;
BEGIN
  ev := i2009adv.mk_event('t32_private_noop', 'private', 'scheduled');
  r := i2009adv.try_set(uA, ev, 'private', 'tester no-op ordering reason',
                        (SELECT updated_at FROM public.events WHERE id = ev));
  PERFORM i2009adv.assert('T3.2','SC-7',
    'a same-value Private request is the idempotent no-op, evaluated BEFORE the Private refusal',
    r LIKE 'OK:%' AND (substring(r from 4)::jsonb ->> 'changed') = 'false', r);
  PERFORM i2009adv.assert('T3.2','SC-7',
    'that no-op wrote no audit row',
    (SELECT count(*) FROM public.audit_log WHERE event_id = ev) = 0);
END $t32$;

-- T3.3 — a same-value no-op carrying a DELIBERATELY WRONG expected timestamp
--        must still be a no-op, and must not consume a generation.
DO $t33$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  ev uuid; r text; g0 bigint; g1 bigint;
BEGIN
  ev := i2009adv.mk_event('t33_noop_stale_ts', 'hidden', 'live');
  g0 := i2009adv.gen();
  r := i2009adv.try_set(uA, ev, 'unlisted', 'tester idempotent replay reason',
                        now() - interval '3 days');
  g1 := i2009adv.gen();
  PERFORM i2009adv.assert('T3.3','SC-7',
    'the no-op is reached even with a wrong expected timestamp',
    r LIKE 'OK:%' AND (substring(r from 4)::jsonb ->> 'changed') = 'false', r);
  PERFORM i2009adv.assert('T3.3','SC-14',
    'the no-op did NOT consume a discovery generation',
    g0 = g1, format('%s -> %s', g0, g1));
END $t33$;

-- T3.4 — the transaction-local trusted context must not leak from the Business
--        RPC to a LATER trusted writer in the SAME transaction. If it did, an
--        Admin transition following a Business one would either collide on the
--        transition-id primary key or be mis-attributed as `business`.
DO $t34$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  ev1 uuid; ev2 uuid; r text; cls text; n int;
BEGIN
  ev1 := i2009adv.mk_event('t34_biz', 'public', 'live');
  ev2 := i2009adv.mk_event('t34_admin', 'public', 'live');

  r := i2009adv.try_set(uA, ev1, 'unlisted', 'tester context-leak probe reason',
                        (SELECT updated_at FROM public.events WHERE id = ev1));
  PERFORM i2009adv.assert('T3.4','SC-9A', 'the Business transition committed',
    r LIKE 'OK:%', r);

  -- same transaction, a trusted non-Business writer.
  UPDATE public.events SET visibility = 'hidden' WHERE id = ev2;

  SELECT writer_class INTO cls FROM public.event_visibility_transition_effects WHERE event_id = ev2;
  SELECT count(*) INTO n FROM public.event_visibility_transition_effects WHERE event_id IN (ev1, ev2);

  PERFORM i2009adv.assert('T3.4','SC-9A',
    'the following trusted write is attributed admin_or_trusted, not business',
    cls = 'admin_or_trusted', coalesce(cls, '<none>'));
  PERFORM i2009adv.assert('T3.4','SC-9A',
    'two transitions in one transaction produce exactly two distinct effect rows',
    n = 2, n::text);
  PERFORM i2009adv.assert('T3.4','SC-9',
    'the trusted non-Business write wrote NO Business audit row',
    (SELECT count(*) FROM public.audit_log
      WHERE event_id = ev2 AND action = 'event.visibility_changed') = 0);
END $t34$;

-- T3.5 — the audit row's revokedShareCount is the SAME number the effect row
--        carries and the RPC returned. Not "about right" — the same integer.
DO $t35$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  ev uuid; r text; j jsonb; tid uuid; a_count int; e_count int;
BEGIN
  ev := i2009adv.mk_event('t35_counts', 'public', 'live');
  r := i2009adv.try_set(uA, ev, 'unlisted', 'tester exact cardinality reason',
                        (SELECT updated_at FROM public.events WHERE id = ev));
  PERFORM i2009adv.assert('T3.5','SC-9A', 'the transition committed', r LIKE 'OK:%', r);
  j := substring(r from 4)::jsonb;

  SELECT (after ->> 'transitionId')::uuid, (after ->> 'revokedShareCount')::int
    INTO tid, a_count
    FROM public.audit_log
   WHERE event_id = ev AND action = 'event.visibility_changed';
  SELECT revoked_share_count INTO e_count
    FROM public.event_visibility_transition_effects WHERE transition_id = tid;

  PERFORM i2009adv.assert('T3.5','SC-9A',
    'returned == audited == effect-row revokedShareCount, keyed by the same transition id',
    (j ->> 'revokedShareCount')::int = a_count AND a_count = e_count,
    format('returned=%s audited=%s effect=%s tid=%s', j ->> 'revokedShareCount', a_count, e_count, tid));
  PERFORM i2009adv.assert('T3.5','SC-9',
    'the audit row leaks no share code, token or source reference',
    NOT (after::text ILIKE '%source_reference%' OR after::text ILIKE '%share_code%'
         OR after::text ILIKE '%token%'))
    FROM public.audit_log WHERE event_id = ev AND action = 'event.visibility_changed';
END $t35$;

-- T3.6 — a rejected call leaves ZERO residue on every ledger at once.
DO $t36$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  ev uuid; r text; g0 bigint; g1 bigint; vis0 text; vis1 text; ts timestamptz;
BEGIN
  ev := i2009adv.mk_event('t36_residue', 'public', 'live');
  SELECT visibility, updated_at INTO vis0, ts FROM public.events WHERE id = ev;
  g0 := i2009adv.gen();
  -- a real change with a wrong expected timestamp
  r := i2009adv.try_set(uA, ev, 'unlisted', 'tester stale rejection reason',
                        ts - interval '1 second');
  g1 := i2009adv.gen();
  SELECT visibility INTO vis1 FROM public.events WHERE id = ev;
  PERFORM i2009adv.assert('T3.6','SC-6', 'a mismatched expected timestamp is refused',
    r = 'stale_event_visibility', r);
  PERFORM i2009adv.assert('T3.6','SC-9A',
    'the refusal left zero residue: value, generation, audit and effect all untouched',
    vis0 = vis1 AND g0 = g1
      AND (SELECT count(*) FROM public.audit_log WHERE event_id = ev) = 0
      AND (SELECT count(*) FROM public.event_visibility_transition_effects WHERE event_id = ev) = 0,
    format('vis %s->%s gen %s->%s', vis0, vis1, g0, g1));
END $t36$;

-- T3.7 — the RPC must not become an unpublish/publish path. A standard event
--        whose stored visibility is `draft` is not a Business-editable
--        visibility target, and `draft` must never be writable by Business.
DO $t37$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  ev uuid; r text; before_vis text;
BEGIN
  ev := i2009adv.mk_event('t37_draft', 'draft', 'draft');
  before_vis := 'draft';
  r := i2009adv.try_set(uA, ev, 'public', 'tester draft publish probe reason',
                        (SELECT updated_at FROM public.events WHERE id = ev));
  PERFORM i2009adv.assert('T3.7','SC-5',
    'a status=draft event is not editable through the visibility RPC',
    r = 'event_not_editable', r);
  PERFORM i2009adv.assert('T3.7','SC-4',
    'Business can never write the stored-only value `draft`',
    i2009adv.try_set(uA, ev, 'draft', 'tester stored-only value probe', now())
      = 'invalid_visibility');
  PERFORM i2009adv.assert('T3.7','SC-4',
    'nor `hidden`, which is stored-only on the Business boundary',
    i2009adv.try_set(uA, ev, 'hidden', 'tester stored-only value probe', now())
      = 'invalid_visibility');
  PERFORM i2009adv.assert('T3.7','SC-4',
    'nor `discover`',
    i2009adv.try_set(uA, ev, 'discover', 'tester stored-only value probe', now())
      = 'invalid_visibility');
  PERFORM i2009adv.assert('T3.7','SC-5',
    'the refused calls changed nothing',
    (SELECT visibility FROM public.events WHERE id = ev) = before_vis);
END $t37$;

-- T3.8 — RSVP and non-event offerings are genuinely unaffected: they still
--        cross the Private boundary in BOTH directions, produce no #2009
--        effect row, and do not move the discovery generation.
DO $t38$
DECLARE
  rs uuid; tr uuid; g0 bigint; g1 bigint; msg text;
BEGIN
  rs := i2009adv.mk_event('t38_rsvp', 'public', 'live', 'rsvp');
  tr := i2009adv.mk_event('t38_trip', 'public', 'live', 'trip');
  g0 := i2009adv.gen();
  BEGIN
    UPDATE public.events SET visibility = 'private' WHERE id IN (rs, tr);
    UPDATE public.events SET visibility = 'public'  WHERE id IN (rs, tr);
    msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM;
  END;
  g1 := i2009adv.gen();
  PERFORM i2009adv.assert('T3.8','SC-22',
    'RSVP and trip rows still cross the Private boundary in both directions',
    msg = '<no error>', msg);
  PERFORM i2009adv.assert('T3.8','SC-22',
    'and produce no #2009 transition-effect rows',
    (SELECT count(*) FROM public.event_visibility_transition_effects
      WHERE event_id IN (rs, tr)) = 0);
  PERFORM i2009adv.assert('T3.8','SC-22',
    'and do not move the discovery generation',
    g0 = g1, format('%s -> %s', g0, g1));
END $t38$;

-- =====================================================================
-- T4 — authorisation is intact. The laundering above is evasion by an
--      AUTHORISED editor, not escalation; prove the escalation door is shut.
-- =====================================================================
DO $t4$
DECLARE
  uA uuid := '00000000-2009-4ad0-8000-00000000000a';
  uB uuid := '00000000-2009-4ad0-8000-00000000000b';
  ev uuid; r_foreign text; r_unknown text; msg text; typ text;
BEGIN
  ev := i2009adv.mk_event('t4_authz', 'public', 'live');

  r_foreign := i2009adv.try_set(uB, ev, 'unlisted', 'tester cross-brand attempt reason',
                                (SELECT updated_at FROM public.events WHERE id = ev));
  r_unknown := i2009adv.try_set(uB, '00000000-0000-0000-0000-00000000dead', 'unlisted',
                                'tester unknown uuid attempt reason', now());

  PERFORM i2009adv.assert('T4','SC-5A',
    'a foreign-brand caller is refused',
    r_foreign = 'event_not_found', r_foreign);
  PERFORM i2009adv.assert('T4','SC-5A',
    'and is INDISTINGUISHABLE from an unknown UUID (non-enumerating)',
    r_foreign = r_unknown, format('foreign=%s unknown=%s', r_foreign, r_unknown));
  PERFORM i2009adv.assert('T4','SC-5A',
    'the foreign attempt changed nothing',
    (SELECT visibility FROM public.events WHERE id = ev) = 'public');

  -- and the laundering route is closed to a foreign brand by RLS.
  PERFORM i2009adv.act_as(uB);
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET event_type = 'rsvp' WHERE id = ev;
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  SELECT event_type INTO typ FROM public.events WHERE id = ev;
  PERFORM i2009adv.assert('T4','SC-5A',
    'a foreign brand cannot even begin the laundering sequence (RLS holds)',
    typ = 'event', format('error=%s event_type=%s', msg, typ));
END $t4$;

-- =====================================================================
-- Summary. Self-fails if too few assertions ran, if no real transition was
-- committed (a fixture regression must not make this vacuously green), or if
-- any assertion failed.
-- =====================================================================
DO $summary$
DECLARE
  n_total int; n_pass int; n_fail int; n_real int; r record;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE outcome = 'PASS'), count(*) FILTER (WHERE outcome = 'FAIL')
    INTO n_total, n_pass, n_fail FROM i2009adv.result;
  SELECT count(*) INTO n_real FROM public.event_visibility_transition_effects e
    JOIN public.events ev ON ev.id = e.event_id
   WHERE ev.brand_id = '00000000-2009-4ad0-8000-0000000000a1';

  IF n_total < 30 THEN
    RAISE EXCEPTION 'issue #2009 tester-adversarial: only % assertions ran; the fixture regressed', n_total;
  END IF;
  IF n_real < 1 THEN
    RAISE EXCEPTION 'issue #2009 tester-adversarial: not one real transition committed; the suite is vacuous';
  END IF;

  FOR r IN SELECT section, criterion, name, detail FROM i2009adv.result
            WHERE outcome = 'FAIL' ORDER BY id
  LOOP
    RAISE WARNING 'FAIL [%/%] % :: %', r.section, r.criterion, r.name, coalesce(r.detail, '');
  END LOOP;

  RAISE NOTICE '=== issue #2009 TESTER ADVERSARIAL: % of % assertions PASS (% real transitions) ===',
    n_pass, n_total, n_real;

  IF n_fail > 0 THEN
    RAISE EXCEPTION 'issue #2009 tester-adversarial: % of % assertions FAILED', n_fail, n_total;
  END IF;
END $summary$;

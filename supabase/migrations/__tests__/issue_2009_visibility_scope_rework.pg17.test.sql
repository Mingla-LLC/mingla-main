-- =====================================================================
-- issue #2009 — IMPLEMENTOR REWORK SUITE (pass-1 TEST REPORT).
--
-- Contract chain: AMENDMENT 3B (#issuecomment-5317545075) > 3A
-- (#issuecomment-5317431821) > AMENDMENT 3 (#issuecomment-5317187049) >
-- AMENDMENT 1 (#issuecomment-5283729259) > original SPEC SC-1..SC-24.
-- SC-31..SC-37 are HELD IN ABEYANCE and are NOT asserted here.
--
-- Closes, with EXECUTED evidence against real rows (#2113):
--   P1-1  `event_type` laundering walked past every guard. The scope was
--         evaluated as if `event_type` were immutable; it is not.
--   P2-1  the guard was UPDATE-only, so an authenticated INSERT could create a
--         standard ticketed event straight at Private.
--   P2-3  a standard event already at Private had no supported exit, because
--         Business AND Admin both refused the leaving leg.
--
-- ANGLE, relative to the two suites that already exist. The 97-assertion
-- implementor suite drives the RPC contract; the tester's adversarial sibling
-- drives the three-PATCH laundering sequence end-to-end. This file drives the
-- REPAIRED BOUNDARY ITSELF, statement class by statement class: each leg of the
-- laundering separately, both directions of the class crossing, the trusted
-- crossing that must still be allowed AND must consume a generation, the INSERT
-- path in all three of its shapes, and the full P2-3 recovery round-trip with a
-- real admin. Every assertion performs the mutation; there is no source-text
-- assertion anywhere in this file.
--
-- Run with:
--   psql -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/__tests__/issue_2009_visibility_scope_rework.pg17.test.sql
-- after applying every migration in timestamp order to
-- supabase/postgres:17.4.1.075.
--
-- RAISEs at the end if any assertion failed, so a green run is the only pass.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

DROP SCHEMA IF EXISTS i2009rw CASCADE;

DO $preclean$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.events
            WHERE brand_id = '00000000-2009-4b00-8000-0000000000c1'
  LOOP
    DELETE FROM public.audit_log                           WHERE event_id = r.id;
    DELETE FROM public.event_visibility_transition_effects  WHERE event_id = r.id;
    DELETE FROM public.event_dates                          WHERE event_id = r.id;
    DELETE FROM public.events                               WHERE id       = r.id;
  END LOOP;
  DELETE FROM public.brand_team_members WHERE brand_id = '00000000-2009-4b00-8000-0000000000c1';
  DELETE FROM public.brands             WHERE id       = '00000000-2009-4b00-8000-0000000000c1';
  DELETE FROM public.admin_users        WHERE email    = 'rw-admin@i2009rw.test';
  DELETE FROM public.profiles           WHERE id       IN ('00000000-2009-4b00-8000-00000000000c',
                                                           '00000000-2009-4b00-8000-00000000000d');
  DELETE FROM public.creator_accounts   WHERE id       IN ('00000000-2009-4b00-8000-00000000000c',
                                                           '00000000-2009-4b00-8000-00000000000d');
  DELETE FROM auth.users                WHERE id       IN ('00000000-2009-4b00-8000-00000000000c',
                                                           '00000000-2009-4b00-8000-00000000000d');
END $preclean$;

CREATE SCHEMA i2009rw;

CREATE TABLE i2009rw.result(
  id        serial primary key,
  section   text not null,
  criterion text not null,
  name      text not null,
  outcome   text not null,
  detail    text
);

CREATE FUNCTION i2009rw.assert(
  p_section text, p_criterion text, p_name text, p_ok boolean, p_detail text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO i2009rw.result(section, criterion, name, outcome, detail)
  VALUES (p_section, p_criterion, p_name, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_detail);
END $$;

CREATE FUNCTION i2009rw.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END $$;

CREATE FUNCTION i2009rw.gen() RETURNS bigint LANGUAGE sql AS $$
  SELECT generation FROM public.event_discovery_generation WHERE singleton;
$$;

CREATE FUNCTION i2009rw.try_set(
  p_user uuid, p_event uuid, p_vis text, p_reason text, p_expected timestamptz
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM i2009rw.act_as(p_user);
  BEGIN
    v := public.business_set_event_visibility(p_event, p_vis, p_reason, p_expected);
    RETURN 'OK:' || v::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END;
END $$;

-- A fresh row per probe, so no probe inherits another's residue. Seeded as
-- `postgres`, i.e. a trusted writer, which is the only context allowed to seed
-- an already-private standard event once the INSERT guard exists.
CREATE FUNCTION i2009rw.mk(p_key text, p_vis text, p_status text, p_type text DEFAULT 'event')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_ev uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.events(id, brand_id, title, slug, event_type, visibility, status,
                            timezone, published_at, currency)
  VALUES (v_ev, '00000000-2009-4b00-8000-0000000000c1', 'I2009RW ' || p_key,
          'i2009rw-' || replace(p_key, '_', '-') || '-' || substr(v_ev::text, 1, 8),
          p_type, p_vis, p_status, 'UTC', now(), 'USD');
  INSERT INTO public.event_dates(event_id, start_at, end_at, is_master, timezone)
  VALUES (v_ev, now() + interval '20 day', now() + interval '20 day 4 hour', true, 'UTC');
  RETURN v_ev;
END $$;

-- ---------------------------------------------------------------------
-- Fixtures: one brand, one event_manager, one platform admin.
-- ---------------------------------------------------------------------
DO $fx$
DECLARE
  uM uuid := '00000000-2009-4b00-8000-00000000000c';
  uAd uuid := '00000000-2009-4b00-8000-00000000000d';
  bC uuid := '00000000-2009-4b00-8000-0000000000c1';
BEGIN
  INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES (uM,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'rw-manager@i2009rw.test', 'x', now(), now()),
         (uAd, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'rw-admin@i2009rw.test', 'x', now(), now())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.creator_accounts(id) VALUES (uM), (uAd) ON CONFLICT DO NOTHING;
  INSERT INTO public.brands(id, account_id, name, slug, claim_status, pricing_currency, default_currency)
  VALUES (bC, uM, 'I2009RW Brand', 'i2009rw-brand', 'verified', 'usd', 'USD');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (bC, uM, 'event_manager', now())
  ON CONFLICT (brand_id, user_id) WHERE removed_at IS NULL
    DO UPDATE SET role = EXCLUDED.role, accepted_at = EXCLUDED.accepted_at;
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('rw-admin@i2009rw.test', 'owner', 'active')
  ON CONFLICT (email) DO UPDATE SET status = 'active', role = 'owner';
END $fx$;

-- =====================================================================
-- R0 — NON-VACUITY. Everything below is meaningless if the ordinary path
--      still works and the ordinary refusal still fires.
-- =====================================================================
DO $r0$
DECLARE
  uM uuid := '00000000-2009-4b00-8000-00000000000c';
  ev uuid; r text; g0 bigint; g1 bigint;
BEGIN
  ev := i2009rw.mk('r0_control', 'public', 'live');
  g0 := i2009rw.gen();
  r := i2009rw.try_set(uM, ev, 'unlisted', 'rework non-vacuity control reason',
                       (SELECT updated_at FROM public.events WHERE id = ev));
  g1 := i2009rw.gen();
  PERFORM i2009rw.assert('R0','SC-3',
    'CONTROL: the ordinary Public -> Unlisted RPC transition still succeeds',
    r LIKE 'OK:%', r);
  PERFORM i2009rw.assert('R0','SC-14',
    'CONTROL: and still moves the discovery generation exactly once',
    g1 = g0 + 1, format('%s -> %s', g0, g1));
  PERFORM i2009rw.assert('R0','SC-9',
    'CONTROL: and still writes exactly one Business audit row',
    (SELECT count(*) FROM public.audit_log
      WHERE event_id = ev AND action = 'event.visibility_changed') = 1);
END $r0$;

-- =====================================================================
-- R1 — P1-1. The class boundary is guarded in BOTH directions, and each leg
--      of the laundering sequence is refused ON ITS OWN.
--
--      The pass-1 guard fired only when `visibility` was NAMED and the row was
--      `event_type='event'`, so all three PATCHes slipped past. These probes
--      send each leg in isolation, so a fix that only blocks the composite
--      sequence cannot pass them.
-- =====================================================================

-- R1.1 — the DEPARTURE leg. `event_type` alone, visibility untouched, on a row
--        that is a standard event today. This is laundering step 1 and it is
--        the statement the pass-1 guard could not see at all.
DO $r11$
DECLARE
  uM uuid := '00000000-2009-4b00-8000-00000000000c';
  ev uuid; msg text; typ text; vis text;
BEGIN
  ev := i2009rw.mk('r11_depart', 'public', 'live');
  PERFORM i2009rw.act_as(uM);
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET event_type = 'rsvp' WHERE id = ev;
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  SELECT event_type, visibility INTO typ, vis FROM public.events WHERE id = ev;
  PERFORM i2009rw.assert('R1.1','SC-8',
    'an authenticated caller cannot take a standard event OUT of the guarded class',
    msg = 'event_visibility_direct_update_blocked', msg);
  PERFORM i2009rw.assert('R1.1','SC-8',
    'and the refusal left the row exactly as it was',
    typ = 'event' AND vis = 'public', format('event_type=%s visibility=%s', typ, vis));
END $r11$;

-- R1.2 — the ARRIVAL leg, carrying `private`. Seeded as an rsvp row already at
--        private (legitimate for RSVP — SC-22), then retyped into the standard
--        class. This is laundering step 3, and it is also the shape a genuinely
--        mis-created row would take.
DO $r12$
DECLARE
  uM uuid := '00000000-2009-4b00-8000-00000000000c';
  ev uuid; msg text; typ text;
BEGIN
  ev := i2009rw.mk('r12_arrive_private', 'private', 'live', 'rsvp');
  PERFORM i2009rw.act_as(uM);
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET event_type = 'event' WHERE id = ev;
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  SELECT event_type INTO typ FROM public.events WHERE id = ev;
  PERFORM i2009rw.assert('R1.2','SC-12',
    'a private row arriving INTO the standard class is refused as a Private entry',
    msg = 'private_visibility_unavailable', msg);
  PERFORM i2009rw.assert('R1.2','SC-12',
    'and the row never became a standard event',
    typ = 'rsvp', typ);
END $r12$;

-- R1.3 — the ARRIVAL leg with a NON-private visibility. This is the leg that
--        has a live consequence today even without Private at all: an arrival
--        at `hidden` is a standard event whose visibility this guard never
--        approved, and pass 1 let it through with the generation unmoved.
DO $r13$
DECLARE
  uM uuid := '00000000-2009-4b00-8000-00000000000c';
  ev uuid; msg text; typ text;
BEGIN
  ev := i2009rw.mk('r13_arrive_hidden', 'hidden', 'live', 'rsvp');
  PERFORM i2009rw.act_as(uM);
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET event_type = 'event' WHERE id = ev;
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  SELECT event_type INTO typ FROM public.events WHERE id = ev;
  PERFORM i2009rw.assert('R1.3','SC-8',
    'an authenticated arrival into the standard class is refused even when it is not Private',
    msg = 'event_visibility_direct_update_blocked', msg);
  PERFORM i2009rw.assert('R1.3','SC-8',
    'and the row never became a standard event',
    typ = 'rsvp', typ);
END $r13$;

-- R1.4 — a TRUSTED class crossing is still allowed, and it CONSUMES a discovery
--        generation and leaves an effect row. The discoverable set moved even
--        though the visibility text did not, so SC-14/SC-15 require the cache
--        namespace to move with it. Without this, the two triggers would
--        disagree about what a transition is.
DO $r14$
DECLARE
  ev uuid; msg text; g0 bigint; g1 bigint; eff int; cls text;
BEGIN
  ev := i2009rw.mk('r14_trusted_cross', 'public', 'live', 'rsvp');
  g0 := i2009rw.gen();
  BEGIN
    UPDATE public.events SET event_type = 'event' WHERE id = ev;
    msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM;
  END;
  g1 := i2009rw.gen();
  SELECT count(*) INTO eff FROM public.event_visibility_transition_effects WHERE event_id = ev;
  SELECT writer_class INTO cls FROM public.event_visibility_transition_effects WHERE event_id = ev;
  PERFORM i2009rw.assert('R1.4','SC-22',
    'a TRUSTED writer may still move a row into the standard class',
    msg = '<no error>', msg);
  PERFORM i2009rw.assert('R1.4','SC-14',
    'and that crossing consumes a discovery generation, because the discoverable set moved',
    g1 = g0 + 1, format('%s -> %s', g0, g1));
  PERFORM i2009rw.assert('R1.4','SC-9A',
    'and leaves exactly one admin_or_trusted effect row',
    eff = 1 AND cls = 'admin_or_trusted', format('rows=%s class=%s', eff, coalesce(cls,'<none>')));
END $r14$;

-- R1.5 — a trusted crossing that ENTERS Private is refused for the trusted
--        writer too. Private fails closed for EVERY writer; only the exit leg
--        was relaxed.
DO $r15$
DECLARE
  ev uuid; msg text; typ text; g0 bigint; g1 bigint;
BEGIN
  ev := i2009rw.mk('r15_trusted_cross_private', 'private', 'live', 'rsvp');
  g0 := i2009rw.gen();
  BEGIN
    UPDATE public.events SET event_type = 'event' WHERE id = ev;
    msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM;
  END;
  g1 := i2009rw.gen();
  SELECT event_type INTO typ FROM public.events WHERE id = ev;
  PERFORM i2009rw.assert('R1.5','SC-12',
    'even a TRUSTED writer cannot carry a private row into the standard class',
    msg = 'private_visibility_unavailable', msg);
  PERFORM i2009rw.assert('R1.5','SC-14',
    'and the refused crossing consumed no generation',
    typ = 'rsvp' AND g0 = g1, format('event_type=%s gen %s -> %s', typ, g0, g1));
END $r15$;

-- R1.6 — the guard did NOT widen to every offering type. A crossing that never
--        touches the standard class is untouched, which is what protects
--        `biz_update_live_rsvp` and SC-22.
DO $r16$
DECLARE
  ev uuid; msg text; typ text; g0 bigint; g1 bigint;
BEGIN
  ev := i2009rw.mk('r16_out_of_scope_cross', 'private', 'live', 'rsvp');
  g0 := i2009rw.gen();
  BEGIN
    UPDATE public.events SET event_type = 'trip' WHERE id = ev;
    msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM;
  END;
  g1 := i2009rw.gen();
  SELECT event_type INTO typ FROM public.events WHERE id = ev;
  PERFORM i2009rw.assert('R1.6','SC-22',
    'an rsvp -> trip retype at private is untouched by #2009',
    msg = '<no error>' AND typ = 'trip', format('error=%s event_type=%s', msg, typ));
  PERFORM i2009rw.assert('R1.6','SC-22',
    'and moves no discovery generation',
    g0 = g1, format('%s -> %s', g0, g1));
END $r16$;

-- R1.7 — an UPDATE that names `event_type` but does not actually change it is
--        NOT a crossing and must not be blocked. PostgREST sends whole-object
--        PATCHes; a guard that refused every statement naming the column would
--        break ordinary editing.
DO $r17$
DECLARE
  uM uuid := '00000000-2009-4b00-8000-00000000000c';
  ev uuid; msg text; rows_hit int;
BEGIN
  ev := i2009rw.mk('r17_noop_type', 'public', 'live');
  PERFORM i2009rw.act_as(uM);
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET event_type = 'event', title = 'I2009RW r17 touched'
     WHERE id = ev;
    GET DIAGNOSTICS rows_hit = ROW_COUNT;
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM; rows_hit := -1;
  END;
  PERFORM i2009rw.assert('R1.7','SC-8',
    'naming event_type without changing it is not a crossing and is not blocked',
    msg = '<no error>' AND rows_hit = 1, msg || ' rows=' || rows_hit);
END $r17$;

-- =====================================================================
-- R2 — P2-1. The INSERT path.
-- =====================================================================
DO $r2$
DECLARE
  uM uuid := '00000000-2009-4b00-8000-00000000000c';
  bC uuid := '00000000-2009-4b00-8000-0000000000c1';
  ev1 uuid := gen_random_uuid();
  ev2 uuid := gen_random_uuid();
  ev3 uuid := gen_random_uuid();
  msg text; got text;
BEGIN
  -- R2.1 the defect: an authenticated INSERT straight into Private.
  PERFORM i2009rw.act_as(uM);
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type,
                              visibility, status, timezone, currency)
    VALUES (ev1, bC, uM, 'I2009RW r21', 'i2009rw-r21', 'event',
            'private', 'scheduled', 'UTC', 'USD');
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  SELECT visibility INTO got FROM public.events WHERE id = ev1;
  PERFORM i2009rw.assert('R2.1','SC-12',
    'an authenticated INSERT cannot create a standard ticketed event at Private',
    msg = 'private_visibility_unavailable' AND got IS NULL,
    format('error=%s stored=%s', msg, coalesce(got, '<no row>')));

  -- R2.2 non-vacuity: the SAME caller can still create an ordinary event, so
  --      R2.1 is the Private boundary and not a blanket INSERT refusal.
  PERFORM i2009rw.act_as(uM);
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type,
                              visibility, status, timezone, currency)
    VALUES (ev2, bC, uM, 'I2009RW r22', 'i2009rw-r22', 'event',
            'public', 'scheduled', 'UTC', 'USD');
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  SELECT visibility INTO got FROM public.events WHERE id = ev2;
  PERFORM i2009rw.assert('R2.2','SC-12',
    'the same caller CAN still create an ordinary Public standard event',
    msg = '<no error>' AND got = 'public', format('error=%s stored=%s', msg, coalesce(got,'<no row>')));

  -- R2.3 non-vacuity: an RSVP row may still be created at Private (SC-22).
  PERFORM i2009rw.act_as(uM);
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type,
                              visibility, status, timezone, currency)
    VALUES (ev3, bC, uM, 'I2009RW r23', 'i2009rw-r23', 'rsvp',
            'private', 'scheduled', 'UTC', 'USD');
    RESET ROLE; msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; msg := SQLERRM;
  END;
  SELECT visibility INTO got FROM public.events WHERE id = ev3;
  PERFORM i2009rw.assert('R2.3','SC-22',
    'an RSVP row may still be created at Private — the INSERT guard did not widen',
    msg = '<no error>' AND got = 'private', format('error=%s stored=%s', msg, coalesce(got,'<no row>')));
END $r2$;

-- =====================================================================
-- R3 — P2-3. A standard event at Private stays MANAGEABLE.
--
--      Business still refuses the exit leg (it cannot unwind the invited-guest
--      machinery #2144 owns), so the RPC contract is unchanged and T1c stays
--      true. Admin is the supported exit, and it must still refuse ENTRY.
-- =====================================================================
DO $r3$
DECLARE
  uM  uuid := '00000000-2009-4b00-8000-00000000000c';
  uAd uuid := '00000000-2009-4b00-8000-00000000000d';
  ev uuid; ev2 uuid; biz text; adm text; adm2 text;
  g0 bigint; g1 bigint; vis text; eff int;
BEGIN
  ev  := i2009rw.mk('r3_stranded', 'private', 'scheduled');
  ev2 := i2009rw.mk('r3_entry_probe', 'public', 'scheduled');

  -- Business still refuses the exit, with the stable code the copy map splits on.
  biz := i2009rw.try_set(uM, ev, 'public', 'rework private exit attempt reason',
                         (SELECT updated_at FROM public.events WHERE id = ev));
  PERFORM i2009rw.assert('R3','SC-12',
    'Business still refuses the Private exit leg with the stable code',
    biz = 'private_visibility_unavailable', biz);

  -- Admin IS the supported exit.
  PERFORM i2009rw.act_as(uAd);
  g0 := i2009rw.gen();
  BEGIN
    PERFORM public.admin_set_offering_visibility(ev, 'public', 'rework admin recovery of a stranded event');
    adm := '<no error>';
  EXCEPTION WHEN OTHERS THEN adm := SQLERRM;
  END;
  g1 := i2009rw.gen();
  SELECT visibility INTO vis FROM public.events WHERE id = ev;
  SELECT count(*) INTO eff FROM public.event_visibility_transition_effects WHERE event_id = ev;

  PERFORM i2009rw.assert('R3','SC-29',
    'Admin CAN move a standard event out of Private, so the row is never stranded',
    adm = '<no error>' AND vis = 'public', format('admin=%s stored=%s', adm, coalesce(vis,'<none>')));
  PERFORM i2009rw.assert('R3','SC-14',
    'and that recovery moves the discovery generation and leaves an effect row',
    g1 = g0 + 1 AND eff = 1, format('gen %s -> %s effects=%s', g0, g1, eff));

  -- ...and ENTRY is still refused, so the fail-closed intent is intact.
  BEGIN
    PERFORM public.admin_set_offering_visibility(ev2, 'private', 'rework admin private entry attempt');
    adm2 := '<no error>';
  EXCEPTION WHEN OTHERS THEN adm2 := SQLERRM;
  END;
  PERFORM i2009rw.assert('R3','SC-35',
    'Admin still refuses ENTERING Private on a standard ticketed event',
    adm2 = 'private_transition_requires_business', adm2);
  PERFORM i2009rw.assert('R3','SC-35',
    'and the refused entry changed nothing',
    (SELECT visibility FROM public.events WHERE id = ev2) = 'public');

  -- ...and once recovered the event is an ordinary Business-editable event again.
  biz := i2009rw.try_set(uM, ev, 'unlisted', 'rework post-recovery normal edit reason',
                         (SELECT updated_at FROM public.events WHERE id = ev));
  PERFORM i2009rw.assert('R3','SC-3',
    'after the Admin exit the event is fully manageable from Business again',
    biz LIKE 'OK:%', biz);

  PERFORM i2009rw.act_as(NULL);
END $r3$;

-- =====================================================================
-- Summary. Self-fails if too few assertions ran, if no real transition
-- committed, or if any assertion failed.
-- =====================================================================
DO $summary$
DECLARE n_total int; n_pass int; n_fail int; n_real int; r record;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE outcome = 'PASS'), count(*) FILTER (WHERE outcome = 'FAIL')
    INTO n_total, n_pass, n_fail FROM i2009rw.result;
  SELECT count(*) INTO n_real FROM public.event_visibility_transition_effects e
    JOIN public.events ev ON ev.id = e.event_id
   WHERE ev.brand_id = '00000000-2009-4b00-8000-0000000000c1';

  IF n_total < 24 THEN
    RAISE EXCEPTION 'issue #2009 rework: only % assertions ran; the fixture regressed', n_total;
  END IF;
  -- A floor of 2, not 3. It has to be low enough that a REGRESSION reports its
  -- own assertion failures instead of tripping this guard first: reverting the
  -- Admin exit route (P2-3) removes one real transition, and a vacuity guard
  -- that fires before the failures print makes the suite harder to diagnose
  -- than it needs to be. Two is still a genuine floor — a collapsed fixture
  -- commits none.
  IF n_real < 2 THEN
    RAISE EXCEPTION 'issue #2009 rework: only % real transitions committed; the suite is vacuous', n_real;
  END IF;

  FOR r IN SELECT section, criterion, name, detail FROM i2009rw.result
            WHERE outcome = 'FAIL' ORDER BY id
  LOOP
    RAISE WARNING 'FAIL [%/%] % :: %', r.section, r.criterion, r.name, coalesce(r.detail, '');
  END LOOP;

  RAISE NOTICE '=== issue #2009 REWORK: % of % assertions PASS (% real transitions) ===',
    n_pass, n_total, n_real;

  IF n_fail > 0 THEN
    RAISE EXCEPTION 'issue #2009 rework: % of % assertions FAILED', n_fail, n_total;
  END IF;
END $summary$;

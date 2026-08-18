-- =====================================================================
-- issue #2009 — BINDING SPEC AMENDMENT 3A, Defect 1.
-- The REAL-ROW half of Ari's visibility routing.
--
-- Contract: AMENDMENT 3A (#issuecomment-5317431821, CONTROLLING) over
-- AMENDMENT 1 §B (#issuecomment-5283729259).
--
-- The routing itself lives in TypeScript and is executed by
--   supabase/functions/_shared/__tests__/issue_2009_ari_visibility_via_rpc.test.ts
-- This file proves, against REAL Postgres rows, the database half that the
-- Deno test's client double stands in for:
--
--   R1  the EXACT statement shape Ari used BEFORE this fix is refused by the
--       shipped guard — so the regression Amendment 3A describes is real;
--   R2  the EXACT arguments Ari now sends — the three Business labels and the
--       fixed 64-character reason string — are accepted by the real RPC;
--   R3  `unlisted` lands as stored `hidden` ONLY through the RPC, and the
--       literal `'unlisted'` is rejected by `events_visibility_check` (the
--       pre-existing, explicitly OUT-OF-SCOPE defect, recorded not fixed);
--   R4  a Private target refuses with private_visibility_unavailable and
--       leaves zero residue, using Ari's own reason string;
--   R5  the discovery generation really moves across a real transition — the
--       value the discover cache key is now folded on (Defect 2).
--
-- Per #2113 every assertion EXECUTES an object against real rows. There is no
-- source-text assertion in this file.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f <this file>
-- after applying every migration in timestamp order to
-- supabase/postgres:17.4.1.075.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

DROP SCHEMA IF EXISTS i2009ari CASCADE;

DO $preclean$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.events
            WHERE brand_id = '00000000-2009-4001-8000-0000000000c1'
  LOOP
    DELETE FROM public.audit_log WHERE event_id = r.id;
    DELETE FROM public.event_visibility_transition_effects WHERE event_id = r.id;
    DELETE FROM public.event_dates WHERE event_id = r.id;
    DELETE FROM public.events WHERE id = r.id;
  END LOOP;
  DELETE FROM public.brand_team_members WHERE brand_id = '00000000-2009-4001-8000-0000000000c1';
  DELETE FROM public.brands            WHERE id       = '00000000-2009-4001-8000-0000000000c1';
  DELETE FROM public.profiles          WHERE id       = '00000000-2009-4001-8000-0000000000d1';
  DELETE FROM public.creator_accounts  WHERE id       = '00000000-2009-4001-8000-0000000000d1';
  DELETE FROM auth.users               WHERE id       = '00000000-2009-4001-8000-0000000000d1';
END $preclean$;

CREATE SCHEMA i2009ari;

CREATE TABLE i2009ari.result(
  id serial primary key,
  criterion text not null,
  name      text not null,
  outcome   text not null,
  detail    text
);

CREATE FUNCTION i2009ari.assert(
  p_criterion text, p_name text, p_ok boolean, p_detail text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO i2009ari.result(criterion, name, outcome, detail)
  VALUES (p_criterion, p_name, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_detail);
END $$;

CREATE FUNCTION i2009ari.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END $$;

-- Exactly what supabase/functions/_shared/agentTools.ts sends.
CREATE FUNCTION i2009ari.ari_reason() RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'Visibility changed through Ari after explicit user confirmation.'::text;
$$;

CREATE FUNCTION i2009ari.try_set(
  p_user uuid, p_event uuid, p_vis text, p_expected timestamptz
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM i2009ari.act_as(p_user);
  BEGIN
    v := public.business_set_event_visibility(p_event, p_vis, i2009ari.ari_reason(), p_expected);
    RETURN 'OK:' || v::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------
-- Fixtures — one brand, one event_manager, four standard ticketed events.
-- ---------------------------------------------------------------------
CREATE TABLE i2009ari.fx(key text primary key, event_id uuid);

DO $fx$
DECLARE
  v_user uuid := '00000000-2009-4001-8000-0000000000d1';
  v_brand uuid := '00000000-2009-4001-8000-0000000000c1';
  r record; v_ev uuid;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
  VALUES (v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          'ari@i2009ari.test','x',now(),now())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.creator_accounts(id) VALUES (v_user) ON CONFLICT DO NOTHING;
  INSERT INTO public.brands(id,account_id,name,slug,claim_status,pricing_currency,default_currency)
  VALUES (v_brand, v_user, 'I2009ARI Brand','i2009ari-brand','verified','usd','USD');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
  VALUES (v_brand, v_user, 'event_manager', now())
  ON CONFLICT DO NOTHING;

  FOR r IN
    SELECT * FROM (VALUES
      ('ari_public'  ,'public' ,'live'),
      ('ari_hidden'  ,'hidden' ,'live'),
      ('ari_private' ,'private','scheduled'),
      ('ari_guard'   ,'public' ,'scheduled')
    ) AS t(key,vis,st)
  LOOP
    v_ev := gen_random_uuid();
    INSERT INTO public.events(id,brand_id,title,slug,event_type,visibility,status,timezone,published_at,currency)
    VALUES (v_ev, v_brand, 'I2009ARI '||r.key, 'i2009ari-'||replace(r.key,'_','-'),
            'event', r.vis, r.st, 'UTC', now(), 'USD');
    INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone)
    VALUES (v_ev, now()+interval '12 day', now()+interval '12 day 3 hour', true, 'UTC');
    INSERT INTO i2009ari.fx VALUES (r.key, v_ev);
  END LOOP;
END $fx$;

-- ---------------------------------------------------------------------
-- R1 — the regression is REAL. The exact statement agentTools.ts:369 used to
--      run (a caller-JWT `.from("events").update({ visibility })`, i.e. role
--      `authenticated`) is refused by the shipped guard, and changes nothing.
--      NON-VACUITY: the SAME caller can still update a non-visibility column,
--      so the refusal is the guard and not an RLS filter.
-- ---------------------------------------------------------------------
DO $r1$
DECLARE v_ev uuid; v_msg text; v_rows int;
BEGIN
  SELECT event_id INTO v_ev FROM i2009ari.fx WHERE key='ari_guard';
  PERFORM i2009ari.act_as('00000000-2009-4001-8000-0000000000d1');

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET visibility='hidden', updated_at=now() WHERE id=v_ev;
    RESET ROLE; v_msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM;
  END;
  PERFORM i2009ari.assert('R1','Ari''s OLD direct visibility write is refused by the guard',
    v_msg = 'event_visibility_direct_update_blocked', v_msg);
  PERFORM i2009ari.assert('R1','the refused direct write changed nothing',
    (SELECT visibility FROM public.events WHERE id=v_ev) = 'public');

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET title='I2009ARI touched' WHERE id=v_ev;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE; v_msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; v_rows := -1;
  END;
  PERFORM i2009ari.assert('R1','NON-VACUITY: the same caller CAN still write this row',
    v_msg = '<no error>' AND v_rows = 1, v_msg||' rows='||coalesce(v_rows::text,'<null>'));
END $r1$;

-- ---------------------------------------------------------------------
-- R2 / R3 — the arguments Ari NOW sends are accepted, and `unlisted` lands as
--      stored `hidden`. Both legs of Public <-> Unlisted, with the fixed
--      64-character reason string, under the caller's own identity.
-- ---------------------------------------------------------------------
DO $r2$
DECLARE
  v_ev uuid; v_res text; v_json jsonb; v_msg text;
BEGIN
  PERFORM i2009ari.assert('R2','the fixed Ari reason is inside the RPC''s bounded 10..200 range',
    char_length(i2009ari.ari_reason()) BETWEEN 10 AND 200,
    char_length(i2009ari.ari_reason())::text);

  -- Public -> Unlisted
  SELECT event_id INTO v_ev FROM i2009ari.fx WHERE key='ari_public';
  v_res := i2009ari.try_set('00000000-2009-4001-8000-0000000000d1', v_ev, 'unlisted',
                            (SELECT updated_at FROM public.events WHERE id=v_ev));
  PERFORM i2009ari.assert('R2','Ari Public -> Unlisted succeeds through the RPC',
    v_res LIKE 'OK:%', v_res);
  IF v_res LIKE 'OK:%' THEN
    v_json := substring(v_res from 4)::jsonb;
    PERFORM i2009ari.assert('R3','the Business label `unlisted` is stored as `hidden`',
      (v_json->>'storedVisibility') = 'hidden', v_json::text);
    PERFORM i2009ari.assert('R2','the echo reports a real change with a share count',
      (v_json->>'changed') = 'true' AND (v_json->>'revokedShareCount') IS NOT NULL, v_json::text);
    PERFORM i2009ari.assert('R2','the row really is stored `hidden`',
      (SELECT visibility FROM public.events WHERE id=v_ev) = 'hidden');
    PERFORM i2009ari.assert('R2','exactly one Business audit row carries Ari''s reason',
      (SELECT count(*) FROM public.audit_log
        WHERE event_id=v_ev AND action='event.visibility_changed'
          AND after->>'reason' = i2009ari.ari_reason()) = 1);
  END IF;

  -- Unlisted -> Public (the return leg)
  SELECT event_id INTO v_ev FROM i2009ari.fx WHERE key='ari_hidden';
  v_res := i2009ari.try_set('00000000-2009-4001-8000-0000000000d1', v_ev, 'public',
                            (SELECT updated_at FROM public.events WHERE id=v_ev));
  PERFORM i2009ari.assert('R2','Ari Unlisted -> Public succeeds through the RPC',
    v_res LIKE 'OK:%', v_res);
  PERFORM i2009ari.assert('R2','the row really is stored `public`',
    (SELECT visibility FROM public.events WHERE id=v_ev) = 'public');

  -- R3, the OUT-OF-SCOPE pre-existing defect, RECORDED not fixed: the literal
  -- `'unlisted'` Ari used to write is not a legal stored value at all, so the
  -- old direct path could never have worked even without the guard. Run as the
  -- table owner so the guard is out of the way and the CHECK is what speaks.
  SELECT event_id INTO v_ev FROM i2009ari.fx WHERE key='ari_guard';
  BEGIN
    UPDATE public.events SET visibility='unlisted' WHERE id=v_ev;
    v_msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM i2009ari.assert('R3','the literal `unlisted` is rejected by events_visibility_check (pre-existing, out of scope)',
    v_msg <> '<no error>', v_msg);
  PERFORM i2009ari.assert('R3','and the row was not left holding an illegal value',
    (SELECT visibility FROM public.events WHERE id=v_ev) = 'public');
END $r2$;

-- ---------------------------------------------------------------------
-- R4 — a Private target refuses with the stable code and leaves zero residue,
--      on BOTH legs of the boundary, using Ari's own reason string.
-- ---------------------------------------------------------------------
DO $r4$
DECLARE
  v_priv uuid; v_pub uuid; v_res text; v_gen bigint;
BEGIN
  SELECT event_id INTO v_priv FROM i2009ari.fx WHERE key='ari_private';
  SELECT event_id INTO v_pub  FROM i2009ari.fx WHERE key='ari_public';
  SELECT generation INTO v_gen FROM public.event_discovery_generation;

  -- Leaving Private.
  v_res := i2009ari.try_set('00000000-2009-4001-8000-0000000000d1', v_priv, 'public',
                            (SELECT updated_at FROM public.events WHERE id=v_priv));
  PERFORM i2009ari.assert('R4','leaving Private refuses with private_visibility_unavailable',
    v_res = 'private_visibility_unavailable', v_res);
  PERFORM i2009ari.assert('R4','the Private row is untouched',
    (SELECT visibility FROM public.events WHERE id=v_priv) = 'private');

  -- Entering Private.
  v_res := i2009ari.try_set('00000000-2009-4001-8000-0000000000d1', v_pub, 'private',
                            (SELECT updated_at FROM public.events WHERE id=v_pub));
  PERFORM i2009ari.assert('R4','entering Private refuses with private_visibility_unavailable',
    v_res = 'private_visibility_unavailable', v_res);

  PERFORM i2009ari.assert('R4','no Private attempt wrote an effect row',
    (SELECT count(*) FROM public.event_visibility_transition_effects
      WHERE event_id = v_priv) = 0);
  PERFORM i2009ari.assert('R4','no Private attempt wrote an audit row',
    (SELECT count(*) FROM public.audit_log
      WHERE event_id = v_priv AND action='event.visibility_changed') = 0);
  PERFORM i2009ari.assert('R4','no Private attempt moved the discovery generation',
    (SELECT generation FROM public.event_discovery_generation) = v_gen,
    v_gen::text);
END $r4$;

-- ---------------------------------------------------------------------
-- R5 — Defect 2's input is real: the discovery generation MOVES across a real
--      transition, monotonically, by exactly one. This is the value
--      discover-merged-events now folds into its cache key, so a Public ->
--      Unlisted flip cannot be served from L1, L2 or behind the build lock.
-- ---------------------------------------------------------------------
DO $r5$
DECLARE v_ev uuid; v_before bigint; v_after bigint; v_res text;
BEGIN
  SELECT event_id INTO v_ev FROM i2009ari.fx WHERE key='ari_hidden';  -- now `public`
  SELECT generation INTO v_before FROM public.event_discovery_generation;

  v_res := i2009ari.try_set('00000000-2009-4001-8000-0000000000d1', v_ev, 'unlisted',
                            (SELECT updated_at FROM public.events WHERE id=v_ev));
  SELECT generation INTO v_after FROM public.event_discovery_generation;

  PERFORM i2009ari.assert('R5','the transition committed', v_res LIKE 'OK:%', v_res);
  PERFORM i2009ari.assert('R5','a real Public -> Unlisted flip moves the discovery generation',
    v_after = v_before + 1, v_before::text || ' -> ' || v_after::text);
  PERFORM i2009ari.assert('R5','the service-only reader returns that same generation',
    public.issue_2009_event_discovery_generation() = v_after,
    v_after::text);

  RAISE NOTICE 'issue #2009 R5 — REAL discovery generation across a real Public -> Unlisted flip: % -> %',
    v_before, v_after;
END $r5$;

-- ---------------------------------------------------------------------
-- Verdict. Self-fails if fewer than 18 assertions ran, so a fixture
-- regression cannot make this suite vacuously green.
-- ---------------------------------------------------------------------
DO $verdict$
DECLARE v_total int; v_fail int; r record;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE outcome='FAIL') INTO v_total, v_fail
    FROM i2009ari.result;
  IF v_total < 18 THEN
    RAISE EXCEPTION 'issue #2009 Ari suite ran only % assertions — the fixtures regressed', v_total;
  END IF;
  IF v_fail > 0 THEN
    FOR r IN SELECT * FROM i2009ari.result WHERE outcome='FAIL' ORDER BY id LOOP
      RAISE WARNING 'FAIL [%] % — %', r.criterion, r.name, coalesce(r.detail,'');
    END LOOP;
    RAISE EXCEPTION 'issue #2009 Ari suite: % of % assertions FAILED', v_fail, v_total;
  END IF;
  RAISE NOTICE '=== issue #2009 Ari visibility routing: % of % assertions PASS ===', v_total, v_total;
END $verdict$;

DROP SCHEMA i2009ari CASCADE;

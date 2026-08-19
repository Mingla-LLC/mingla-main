-- =====================================================================
-- Issue #2353 — TESTER ADVERSARIAL suite.
--
-- Deliberately a DIFFERENT ANGLE from
-- `issue_2353_format_truth.implementor.pg17.test.sql`. That suite seeds a
-- format and asserts a single reader or a single writer inside one hop. This
-- one attacks the SEAMS:
--
--   X-1  a FIVE-hop lifecycle (publish -> Duplicate -> Unpublish -> re-publish
--        -> Ari live patch), asserting the projection invariant
--        `is_online = (format IN ('online','hybrid'))` at EVERY hop, not just
--        at the end. Corruption in this family compounds across hops; the
--        implementor's T-13 stops at two.
--   X-2  the Ari live arm with an UNRECOGNISED format and NO is_online.
--        Pre-fix that call was a no-op; S4(c) widened the guard to
--        `p_args ? 'format' OR p_args ? 'is_online'` and now resolves an
--        unrecognised value to a definite 'in_person'. T-15 never reaches this
--        shape because it always sends is_online alongside the bogus format,
--        and only on the create arm.
--   X-3  the S5 conjunct is namespace-ASYMMETRIC. It tests
--        business_event.requestedVisibility while the scope test it joins is
--        four-way over business_event AND business_draft, in NEW and OLD. A
--        draft holding a PRIVATE stored intent in business_draft only is now
--        exempt from a guard that previously refused it.
--   X-4  the S3(b) namespace gap, driven rather than described: a live row
--        whose theme carries no business_event namespace.
--   X-5  normalisation at the READ site (S2), which T-12 never covers — T-12
--        attacks the WRITE predicate only.
--   X-6  the transitional grant is reach, not authority — attacked on the
--        OTHER leaf (business_patch_event_when), against a user with NO
--        membership at all, and against the status gate.
--
-- Harness: identical to the implementor's — supabase/postgres:17.4.1.075 with
-- the full migration chain replayed in timestamp order, which places
-- 20270422001972 ahead of 20270429002353.
-- =====================================================================
\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS i2353x CASCADE;

DO $preclean$
BEGIN
  -- Fixture rows accrete dependents (dates, ticket types, admission state), so
  -- drop the dependents this suite can create before the parent rows.
  CREATE TEMP TABLE IF NOT EXISTS i2353x_gone AS
    SELECT id FROM public.events WHERE title LIKE 'I2353X %';
  DELETE FROM public.event_checkout_admission_state WHERE event_id IN (SELECT id FROM i2353x_gone);
  DELETE FROM public.event_cover_selections        WHERE event_id IN (SELECT id FROM i2353x_gone);
  DELETE FROM public.ticket_types                  WHERE event_id IN (SELECT id FROM i2353x_gone);
  DELETE FROM public.event_dates                   WHERE event_id IN (SELECT id FROM i2353x_gone);
  DELETE FROM public.agent_operation_receipts
    WHERE operation_id IN (SELECT id FROM public.agent_pending_actions
                            WHERE related_event_id IN (SELECT id FROM i2353x_gone));
  DELETE FROM public.agent_pending_actions         WHERE related_event_id IN (SELECT id FROM i2353x_gone);
  DELETE FROM public.audit_log                     WHERE event_id IN (SELECT id FROM i2353x_gone);
  DELETE FROM public.events                        WHERE id IN (SELECT id FROM i2353x_gone);
  DROP TABLE i2353x_gone;
  DELETE FROM public.agent_operation_receipts
    WHERE operation_id IN (SELECT id FROM public.agent_pending_actions
      WHERE user_id IN ('00000000-2353-4000-8000-0000000000c1',
                        '00000000-2353-4000-8000-0000000000c2',
                        '00000000-2353-4000-8000-0000000000c3'));
  DELETE FROM public.agent_pending_actions
    WHERE user_id IN ('00000000-2353-4000-8000-0000000000c1',
                      '00000000-2353-4000-8000-0000000000c2',
                      '00000000-2353-4000-8000-0000000000c3');
  DELETE FROM public.agent_conversations
    WHERE user_id IN ('00000000-2353-4000-8000-0000000000c1',
                      '00000000-2353-4000-8000-0000000000c2',
                      '00000000-2353-4000-8000-0000000000c3');
  DELETE FROM public.brand_team_members
    WHERE brand_id = '00000000-2353-4000-8000-0000000000d1';
  DELETE FROM public.brands WHERE id = '00000000-2353-4000-8000-0000000000d1';
  DELETE FROM public.creator_accounts
    WHERE id IN ('00000000-2353-4000-8000-0000000000c1',
                 '00000000-2353-4000-8000-0000000000c2',
                 '00000000-2353-4000-8000-0000000000c3');
  DELETE FROM auth.users
    WHERE id IN ('00000000-2353-4000-8000-0000000000c1',
                 '00000000-2353-4000-8000-0000000000c2',
                 '00000000-2353-4000-8000-0000000000c3');
END $preclean$;

CREATE SCHEMA i2353x;

CREATE TABLE i2353x.result(
  id serial primary key, criterion text not null, name text not null,
  outcome text not null, detail text);

CREATE FUNCTION i2353x.assert(p_criterion text, p_name text, p_ok boolean,
                              p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO i2353x.result(criterion,name,outcome,detail)
  VALUES (p_criterion,p_name,CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END,p_detail);
END $$;

CREATE FUNCTION i2353x.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_user::text,''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub',p_user,'role','authenticated')::text END, true);
END $$;

CREATE FUNCTION i2353x.exec_as(p_role text, p_user uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM i2353x.act_as(p_user);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    EXECUTE 'RESET ROLE';
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN SQLSTATE||':'||SQLERRM;
  END;
END $$;

CREATE FUNCTION i2353x.try_sql(p_user uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM i2353x.act_as(p_user);
  BEGIN EXECUTE p_sql; RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||':'||SQLERRM; END;
END $$;

-- The projection invariant, evaluated straight off the row. This is the whole
-- point of the issue: is_online is a PROJECTION of format, so the two can
-- never legitimately disagree on a row that carries a stored format.
CREATE FUNCTION i2353x.agrees(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN COALESCE(e.theme#>>'{business_event,format}',
                  e.theme#>>'{business_draft,format}')
         IN ('in_person','online','hybrid')
    THEN e.is_online = (COALESCE(e.theme#>>'{business_event,format}',
                                 e.theme#>>'{business_draft,format}')
                        IN ('online','hybrid'))
    ELSE true  -- nothing stored: nothing to disagree with
  END
  FROM public.events e WHERE e.id = p_event;
$$;

CREATE FUNCTION i2353x.fmt(p_event uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(e.theme#>>'{business_event,format}',
                  e.theme#>>'{business_draft,format}','<none>')
  FROM public.events e WHERE e.id=p_event;
$$;

CREATE TABLE i2353x.ids(k text primary key, v uuid);
INSERT INTO i2353x.ids VALUES
  ('owner'   ,'00000000-2353-4000-8000-0000000000c1'),
  ('manager' ,'00000000-2353-4000-8000-0000000000c2'),
  ('nobody'  ,'00000000-2353-4000-8000-0000000000c3'),
  ('b1'      ,'00000000-2353-4000-8000-0000000000d1');

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
SELECT v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       k||'@i2353x.test','x',now(),now()
FROM i2353x.ids WHERE k IN ('owner','manager','nobody') ON CONFLICT DO NOTHING;

INSERT INTO public.creator_accounts(id)
SELECT v FROM i2353x.ids WHERE k IN ('owner','manager','nobody') ON CONFLICT DO NOTHING;

INSERT INTO public.brands(id,account_id,name,slug,claim_status,pricing_currency,default_currency)
VALUES ((SELECT v FROM i2353x.ids WHERE k='b1'),(SELECT v FROM i2353x.ids WHERE k='owner'),
        'I2353X Brand','i2353x-brand','verified','usd','USD');

INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
VALUES ((SELECT v FROM i2353x.ids WHERE k='b1'),(SELECT v FROM i2353x.ids WHERE k='manager'),
        'event_manager',now());

CREATE TABLE i2353x.fx(key text primary key, event_id uuid);

-- Seed helper: a published business event in the shape the publish RPC leaves
-- behind, WITH a ticket type so it is re-publishable (the multi-hop tests need
-- to put the row back through the real publish owner, which refuses a
-- ticketless draft with `event_ticket_required`).
CREATE FUNCTION i2353x.seed_published(
  p_key text, p_format text, p_online boolean,
  p_with_business_event boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_ev uuid := gen_random_uuid(); v_theme jsonb; v_b1 uuid;
BEGIN
  SELECT v INTO v_b1 FROM i2353x.ids WHERE k='b1';
  IF p_with_business_event THEN
    v_theme := jsonb_build_object('coverHue',25,'business_event',
      jsonb_build_object('schemaVersion',1,'requestedVisibility','public','clientRevision',0,
        'settings',jsonb_build_object('requireApproval',false,'allowTransfers',true)));
    IF p_format IS NOT NULL THEN
      v_theme := jsonb_set(v_theme,'{business_event,format}',to_jsonb(p_format),true);
    END IF;
  ELSE
    -- No business namespace at all. The guard's own comment says such a row
    -- must stay publishable, so it is a legitimate shape, and it is the shape
    -- that exposes the jsonb_set namespace gap in S3(b).
    v_theme := jsonb_build_object('coverHue',25);
  END IF;
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,visibility,status,
    timezone,published_at,currency,is_online,theme,city,party_types,vibe_tags,music_genres)
  VALUES (v_ev,v_b1,(SELECT v FROM i2353x.ids WHERE k='owner'),
    'I2353X '||p_key,'i2353x-'||replace(p_key,'_','-'),'event','public','scheduled','UTC',
    now(),'USD',p_online,v_theme,'London',
    ARRAY['club-night']::text[],ARRAY['energetic']::text[],ARRAY['pop']::text[]);
  INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone)
  VALUES (v_ev,now()+interval '10 day',now()+interval '10 day 3 hour',true,'UTC');
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,is_unlimited,display_order)
  VALUES (v_ev,'General',0,'USD',true,true,0);
  INSERT INTO i2353x.fx VALUES (p_key,v_ev);
  RETURN v_ev;
END $$;

-- Same, but the stored `format` is written RAW so a non-canonical JSON shape
-- can be planted at the READ site (X-6). T-12 attacks the write predicate only.
CREATE FUNCTION i2353x.seed_published_raw(p_key text, p_fmt jsonb, p_online boolean)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_ev uuid; BEGIN
  v_ev := i2353x.seed_published(p_key, NULL, p_online, true);
  IF p_fmt IS NOT NULL THEN
    UPDATE public.events SET theme=jsonb_set(theme,'{business_event,format}',p_fmt,true)
     WHERE id=v_ev;
  END IF;
  RETURN v_ev;
END $$;

CREATE FUNCTION i2353x.seed_draft(p_key text, p_theme jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_ev uuid := gen_random_uuid(); v_b1 uuid;
BEGIN
  SELECT v INTO v_b1 FROM i2353x.ids WHERE k='b1';
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,visibility,status,
    timezone,currency,is_online,theme,city)
  VALUES (v_ev,v_b1,(SELECT v FROM i2353x.ids WHERE k='owner'),
    'I2353X '||p_key,'i2353x-'||replace(p_key,'_','-'),'event','draft','draft','UTC','USD',
    true,p_theme,'London');
  INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone)
  VALUES (v_ev,now()+interval '20 day',now()+interval '20 day 3 hour',true,'UTC');
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,is_unlimited,display_order)
  VALUES (v_ev,'General',0,'USD',true,true,0);
  INSERT INTO i2353x.fx VALUES (p_key,v_ev);
  RETURN v_ev;
END $$;

CREATE FUNCTION i2353x.ari(p_user uuid, p_tool text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_op uuid := gen_random_uuid(); v_conv uuid;
BEGIN
  SELECT id INTO v_conv FROM public.agent_conversations WHERE user_id=p_user LIMIT 1;
  IF v_conv IS NULL THEN
    v_conv := gen_random_uuid();
    INSERT INTO public.agent_conversations(id,user_id) VALUES (v_conv,p_user);
  END IF;
  INSERT INTO public.agent_pending_actions(id,user_id,conversation_id,tool_name,
    tool_args,status,source,server_proposed_at,execution_attested_at)
  VALUES (v_op,p_user,v_conv,p_tool,p_args,'executing','ari',now(),now());
  PERFORM i2353x.act_as(p_user);
  RETURN public.ari_execute_event_operation(v_op,p_tool,p_args);
END $$;

-- =====================================================================
-- X-1 — the FIVE-hop lifecycle. The implementor's T-13 stops at two hops
-- (publish -> live edit -> unpublish). Corruption in this family compounds,
-- and the re-publish hop is the one that puts business_draft.format back into
-- business_event, so it is the hop where a stale value would reappear.
-- Every hop asserts the projection invariant, not just the final state.
-- =====================================================================
DO $s$ BEGIN PERFORM i2353x.seed_published('x1_src','hybrid',true); END $s$;

DO $h$ DECLARE v uuid; BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x1_src';
  PERFORM i2353x.assert('X-1/hop0','seed is a published hybrid whose is_online agrees',
    i2353x.fmt(v)='hybrid' AND i2353x.agrees(v),
    i2353x.fmt(v)||'/'||(SELECT is_online FROM public.events WHERE id=v)::text);
END $h$;

DO $h$ DECLARE v uuid; d uuid; r jsonb; m uuid; BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x1_src';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  PERFORM i2353x.act_as(m);
  r := public.business_duplicate_event_as_draft(v);
  d := COALESCE((r->>'id')::uuid,(r#>>'{event,id}')::uuid);
  INSERT INTO i2353x.fx VALUES ('x1_dup',d);
  PERFORM i2353x.assert('X-1/hop1','Duplicate keeps hybrid', i2353x.fmt(d)='hybrid', i2353x.fmt(d));
  PERFORM i2353x.assert('X-1/hop1','Duplicate keeps is_online in agreement with format',
    i2353x.agrees(d), i2353x.fmt(d)||'/'||(SELECT is_online FROM public.events WHERE id=d)::text);
EXCEPTION WHEN OTHERS THEN
  PERFORM i2353x.assert('X-1/hop1','Duplicate executes', false, SQLSTATE||':'||SQLERRM);
END $h$;

DO $h$ DECLARE v uuid; m uuid; row public.events%ROWTYPE; BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x1_src';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  PERFORM i2353x.act_as(m);
  PERFORM public.business_unpublish_event_to_draft(v);
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-1/hop2','Unpublish keeps hybrid', i2353x.fmt(v)='hybrid', i2353x.fmt(v));
  PERFORM i2353x.assert('X-1/hop2','Unpublish keeps is_online in agreement',
    i2353x.agrees(v), i2353x.fmt(v)||'/'||row.is_online::text);
  PERFORM i2353x.assert('X-1/hop2','Unpublish leaves the business_draft namespace only',
    row.status='draft' AND row.theme ? 'business_draft' AND NOT (row.theme ? 'business_event'),
    row.status||'|business_event='||(row.theme ? 'business_event')::text);
EXCEPTION WHEN OTHERS THEN
  PERFORM i2353x.assert('X-1/hop2','Unpublish executes', false, SQLSTATE||':'||SQLERRM);
END $h$;

DO $h$ DECLARE v uuid; m uuid; p jsonb; rev int; rc text; row public.events%ROWTYPE; BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x1_src';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  PERFORM i2353x.act_as(m);
  p := public.business_event_draft_payload_from_graph(v);
  rev := COALESCE((p#>>'{theme,business_draft,clientRevision}')::int,0);
  rc := i2353x.try_sql(m, format(
    'SELECT public.issue_1719_publish_event_with_poster(%L::uuid,%L::jsonb,%s)', v, p, rev));
  PERFORM i2353x.assert('X-1/hop3','re-publish of the unpublished hybrid draft succeeds', rc='OK', rc);
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-1/hop3','re-published row is scheduled again', row.status='scheduled', row.status);
  PERFORM i2353x.assert('X-1/hop3','re-publish carried hybrid into the business_event namespace',
    row.theme#>>'{business_event,format}'='hybrid',
    COALESCE(row.theme#>>'{business_event,format}','<none>'));
  PERFORM i2353x.assert('X-1/hop3','re-publish kept is_online in agreement',
    i2353x.agrees(v), i2353x.fmt(v)||'/'||row.is_online::text);
EXCEPTION WHEN OTHERS THEN
  PERFORM i2353x.assert('X-1/hop3','re-publish executes', false, SQLSTATE||':'||SQLERRM);
END $h$;

DO $h$ DECLARE v uuid; m uuid; rev int; row public.events%ROWTYPE; BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x1_src';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  SELECT COALESCE((theme#>>'{business_event,clientRevision}')::int,0) INTO rev
    FROM public.events WHERE id=v;
  PERFORM i2353x.ari(m,'update_event', jsonb_build_object('event_id',v::text,'format','online',
    'reason','Adversarial hop four switches the live event to online','client_revision',rev+1));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-1/hop4','Ari live patch to online persists online',
    i2353x.fmt(v)='online', i2353x.fmt(v));
  PERFORM i2353x.assert('X-1/hop4','Ari live patch keeps is_online in agreement',
    i2353x.agrees(v), i2353x.fmt(v)||'/'||row.is_online::text);
EXCEPTION WHEN OTHERS THEN
  PERFORM i2353x.assert('X-1/hop4','Ari live patch executes', false, SQLSTATE||':'||SQLERRM);
END $h$;

DO $h$ DECLARE v uuid; m uuid; row public.events%ROWTYPE; BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x1_src';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  PERFORM i2353x.act_as(m);
  PERFORM public.business_unpublish_event_to_draft(v);
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-1/hop5','the hop-4 value online survived the second Unpublish',
    i2353x.fmt(v)='online', i2353x.fmt(v));
  PERFORM i2353x.assert('X-1/hop5','no stale hybrid survives anywhere in the theme',
    row.theme::text NOT LIKE '%hybrid%', left(row.theme::text,240));
  PERFORM i2353x.assert('X-1/hop5','is_online still agrees after five hops',
    i2353x.agrees(v), i2353x.fmt(v)||'/'||row.is_online::text);
EXCEPTION WHEN OTHERS THEN
  PERFORM i2353x.assert('X-1/hop5','second Unpublish executes', false, SQLSTATE||':'||SQLERRM);
END $h$;

-- =====================================================================
-- X-2 — Ari's LIVE arm with an unrecognised format and NO is_online.
--
-- S4(c) widened the guard from `IF p_args ? 'is_online'` to
-- `IF p_args ? 'format' OR p_args ? 'is_online'`, and its CASE resolves an
-- unrecognised format to a definite 'in_person' (because the is_online fallback
-- reads a key that is not there). Pre-fix that call wrote NOTHING. The
-- implementor's T-15 never reaches this shape: it always sends `is_online`
-- alongside the bogus format, and only on the CREATE arm.
--
-- `p_args` is forwarded verbatim from the Ari tool call
-- (`agentTools.ts:888 p_args: args`), and neither `create_event` nor
-- `update_event` declares `additionalProperties: false` at the top level, so
-- `validateBeforeAuthorization` (`agentToolAuthorization.ts:416`) neither
-- strips nor rejects an extra `format` key. A model emitting the UI's own word
-- "Hybrid" alongside a title edit reaches this.
--
-- Contract: S3's own comment promises "Unrecognised values leave both columns
-- untouched". S4(c) must not launder an unrecognised value into a recognised
-- one before S3 ever sees it.
-- =====================================================================
DO $s$ BEGIN
  PERFORM i2353x.seed_published('x2_live_hybrid','hybrid',true);
  PERFORM i2353x.seed_published('x2_live_online','online',true);
END $s$;

DO $h$
DECLARE v uuid; m uuid; rev int; row public.events%ROWTYPE; b_fmt text; b_online boolean;
BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x2_live_hybrid';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  SELECT theme#>>'{business_event,format}', is_online INTO b_fmt, b_online
    FROM public.events WHERE id=v;
  SELECT COALESCE((theme#>>'{business_event,clientRevision}')::int,0) INTO rev
    FROM public.events WHERE id=v;
  PERFORM i2353x.ari(m,'update_event', jsonb_build_object(
    'event_id', v::text, 'title','I2353X x2 live hybrid renamed', 'format','Hybrid',
    'reason','Adversarial: rename a live hybrid event, with a mis-cased format',
    'client_revision', rev+1));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-2','an unrecognised Ari format leaves the stored format UNCHANGED',
    row.theme#>>'{business_event,format}' = b_fmt,
    'before='||b_fmt||' after='||COALESCE(row.theme#>>'{business_event,format}','<none>'));
  PERFORM i2353x.assert('X-2','an unrecognised Ari format leaves is_online UNCHANGED',
    row.is_online = b_online, 'before='||b_online::text||' after='||row.is_online::text);
  PERFORM i2353x.assert('X-2','the title edit the host actually asked for still landed',
    row.title='I2353X x2 live hybrid renamed', row.title);
EXCEPTION WHEN OTHERS THEN
  PERFORM i2353x.assert('X-2','Ari live patch executes', false, SQLSTATE||':'||SQLERRM);
END $h$;

DO $h$
DECLARE v uuid; m uuid; rev int; row public.events%ROWTYPE;
BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x2_live_online';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  SELECT COALESCE((theme#>>'{business_event,clientRevision}')::int,0) INTO rev
    FROM public.events WHERE id=v;
  PERFORM i2353x.ari(m,'update_event', jsonb_build_object(
    'event_id', v::text, 'title','I2353X x2 live online renamed', 'format','virtual',
    'reason','Adversarial: rename a live online event, with a junk format value',
    'client_revision', rev+1));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-2','a junk Ari format leaves an ONLINE event online',
    row.theme#>>'{business_event,format}'='online',
    COALESCE(row.theme#>>'{business_event,format}','<none>'));
  PERFORM i2353x.assert('X-2','a junk Ari format leaves is_online true on an online event',
    row.is_online, row.is_online::text);
EXCEPTION WHEN OTHERS THEN
  PERFORM i2353x.assert('X-2','Ari junk-format patch executes', false, SQLSTATE||':'||SQLERRM);
END $h$;

-- =====================================================================
-- X-3 — S5's conjunct is namespace-ASYMMETRIC.
--
-- The scope test it joins is FOUR-way (business_event OR business_draft, in
-- NEW OR OLD). The conjunct tests ONE path: NEW.theme#>'{business_event,...}'.
-- A draft whose stored visibility intent lives in business_draft only, or a
-- statement that drops business_event from NEW.theme, is therefore now exempt
-- from a guard that previously refused it. The SPEC's safety argument — "it
-- removes NO protection ... the privacy-leak case requires that choice to be
-- PRESENT" — holds only if "present" is read across both namespaces.
-- =====================================================================
DO $s$ BEGIN
  PERFORM i2353x.seed_draft('x3_private_draftns', jsonb_build_object('coverHue',25,
    'business_draft', jsonb_build_object('schemaVersion',1,'clientRevision',0,
      'requestedVisibility','private','format','hybrid')));
  PERFORM i2353x.seed_draft('x3_theme_swap', jsonb_build_object('coverHue',25,
    'business_event', jsonb_build_object('requestedVisibility','private')));
END $s$;

DO $h$ DECLARE v uuid; rc text; row public.events%ROWTYPE; BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x3_private_draftns';
  rc := i2353x.try_sql(NULL, format(
    'UPDATE public.events SET status=''scheduled'', visibility=''public'', published_at=now() WHERE id=%L', v));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-3',
    'a draft whose PRIVATE intent lives only in business_draft is still refused a public publish',
    rc <> 'OK' AND row.visibility <> 'public',
    rc||' -> status='||row.status||' visibility='||row.visibility);
END $h$;

DO $h$ DECLARE v uuid; rc text; row public.events%ROWTYPE; BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x3_theme_swap';
  rc := i2353x.try_sql(NULL, format(
    'UPDATE public.events SET status=''scheduled'', visibility=''public'', published_at=now(), theme=''{"coverHue":25}''::jsonb WHERE id=%L', v));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-3',
    'dropping business_event from NEW.theme does not buy a public publish past a stored private intent',
    rc <> 'OK' AND row.visibility <> 'public',
    rc||' -> status='||row.status||' visibility='||row.visibility);
END $h$;

-- The one wall that survives: #2009 keeps `authenticated`/`anon` off the direct
-- UPDATE path entirely, which is what caps X-3 below a P0.
DO $s$ BEGIN
  PERFORM i2353x.seed_draft('x3_rls_private', jsonb_build_object('coverHue',25,
    'business_draft', jsonb_build_object('schemaVersion',1,'clientRevision',0,
      'requestedVisibility','private','format','hybrid')));
END $s$;
DO $h$ DECLARE v uuid; m uuid; rc text; row public.events%ROWTYPE; BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x3_rls_private';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  rc := i2353x.exec_as('authenticated', m, format(
    'UPDATE public.events SET status=''scheduled'', visibility=''public'', published_at=now() WHERE id=%L', v));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-3c',
    'a signed-in event_manager cannot reach the direct-UPDATE path at all (#2009 wall)',
    rc <> 'OK' AND row.visibility='draft',
    rc||' -> status='||row.status||' visibility='||row.visibility);
END $h$;

-- =====================================================================
-- X-4 — the S3(b) namespace gap, DRIVEN rather than described.
--
-- `jsonb_set` creates only the FINAL path element, so on a live row whose theme
-- carries no `business_event` object the format PERSIST is a silent no-op while
-- the is_online projection still fires. That is precisely the divergence this
-- issue exists to remove, reintroduced on one row shape. The implementor logged
-- it as a Discovery; this drives it and shows the user-visible end state.
-- Production exposure is currently ZERO (7/7 live business events carry the
-- namespace, measured read-only), which is what caps this below a P1.
-- =====================================================================
DO $s$ BEGIN PERFORM i2353x.seed_published('x4_no_ns',NULL,false,false); END $s$;

DO $h$
DECLARE v uuid; m uuid; rc text; row public.events%ROWTYPE; payload jsonb;
BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x4_no_ns';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  PERFORM i2353x.assert('X-4','fixture really carries no business_event namespace',
    NOT ((SELECT theme FROM public.events WHERE id=v) ? 'business_event'),
    (SELECT theme::text FROM public.events WHERE id=v));
  rc := i2353x.try_sql(m, format(
    'SELECT public.business_update_live_event(%L::uuid, jsonb_build_object(''format'',''hybrid''), ''Adversarial: switch a namespace-less live event to hybrid'', 1)', v));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-4','the live edit was accepted', rc='OK', rc);
  PERFORM i2353x.assert('X-4','is_online was projected to true for hybrid', row.is_online, row.is_online::text);
  PERFORM i2353x.assert('X-4','the hybrid format is PERSISTED even with no business_event namespace',
    row.theme#>>'{business_event,format}'='hybrid',
    COALESCE(row.theme#>>'{business_event,format}','<none>')||' theme='||left(row.theme::text,160));
  PERFORM i2353x.act_as(m);
  payload := public.business_event_draft_payload_from_graph(v);
  PERFORM i2353x.assert('X-4','payload_from_graph reports the hybrid the host just set',
    payload#>>'{theme,business_draft,format}'='hybrid',
    COALESCE(payload#>>'{theme,business_draft,format}','<none>'));
EXCEPTION WHEN OTHERS THEN
  PERFORM i2353x.assert('X-4','X-4 executes', false, SQLSTATE||':'||SQLERRM);
END $h$;

-- =====================================================================
-- X-5 — does S5 change anything on a path a real client can take?
--
-- These assertions record the CURRENT TRUTH rather than a wish, so they are
-- green; they exist so the answer is on the record and cannot drift. Every
-- product path (the client editor, Ari's publish_event, the business publish
-- owner) runs `business_assert_event_visibility` BEFORE the trigger, so a draft
-- with no stored requestedVisibility is refused earlier and never reaches the
-- conjunct S5 relaxes. The only statement class S5 actually changes is a direct
-- table UPDATE, which #2009 closes to `authenticated`/`anon` — see X-3c.
-- =====================================================================
DO $s$ BEGIN
  PERFORM i2353x.seed_draft('x5_legacy_nokey', jsonb_build_object('coverHue',25,
    'business_draft', jsonb_build_object('schemaVersion',1,'clientRevision',0,'format','hybrid')));
END $s$;

DO $h$
DECLARE v uuid; m uuid; rc text; row public.events%ROWTYPE;
BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x5_legacy_nokey';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  rc := i2353x.try_sql(m, format('SELECT public.business_event_draft_payload_from_graph(%L::uuid)', v));
  PERFORM i2353x.assert('X-5',
    'S5 does not make a key-less legacy draft loadable — the payload builder still refuses it first',
    rc LIKE '%event_visibility_invalid%', rc);
  BEGIN
    PERFORM i2353x.ari(m,'publish_event', jsonb_build_object('event_id',v::text));
    rc := 'OK';
  EXCEPTION WHEN OTHERS THEN rc := SQLSTATE||':'||SQLERRM; END;
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-5',
    'S5 does not make a key-less legacy draft publishable through Ari either',
    rc LIKE '%event_visibility_invalid%' AND row.status='draft', rc||' status='||row.status);
END $h$;

-- =====================================================================
-- X-6 — the READ site's normalisation boundary. T-12 attacks the WRITE
-- predicate only, and never with a value already sitting in the row.
--
-- [TEST-MOD-APPROVED #2353] AMENDED at rework. The three original assertions
-- here read `got IS DISTINCT FROM 'hybrid'` under the label "never reads back
-- as a fabricated hybrid". They encoded SPEC §9's bare-`IN` contract, which the
-- rework superseded on this suite's own evidence: `business_create_event_draft`
-- stores `'Hybrid'` verbatim for any `authenticated` event_manager, and under a
-- bare `IN` that row was rewritten to `'online'` by one Unpublish/re-publish and
-- then broadcast into every market by #2333's carve-out. Under
-- `lower(btrim(...))`, a stored `'Hybrid'` reading back as `hybrid` is correct
-- RECOGNITION, not FABRICATION, so the old assertion's own label no longer
-- described what it tested.
--
-- The replacement is two-sided and strictly stronger than what it replaces:
--   (1) every case/space variant of a canonical value MUST be recognised and
--       MUST read back as the exact canonical spelling;
--   (2) every genuinely unrecognised value MUST NOT be fabricated into
--       `hybrid`, MUST read back canonical, and MUST equal precisely what the
--       `is_online` fallback would produce — which pins WHICH value, not merely
--       that it is one of three, and so catches a future change that silently
--       swaps the fallback;
--   (3) the whitespace boundary is pinned on BOTH sides, measured on the
--       harness rather than assumed.
--
-- [TEST-MOD-APPROVED #2353] AMENDED AGAIN at rework 2. Leg (3) originally
-- pinned TAB/newline/CR/U+00A0 as FALLING BACK, because one-argument
-- `btrim(text)` strips ASCII space only. That was a tripwire, it fired, and the
-- widening it asked for was ordered: the migration now trims
-- `E' \t\n\r\f\v'||chr(160)`. Those four rows therefore moved from the
-- NOT-RECOGNISED list to the RECOGNISED list — they are now correct
-- recognition, not fabrication, exactly as `'Hybrid'` was at the first
-- amendment.
--
-- The boundary did not disappear, it MOVED, so the tripwire moved with it.
-- `btrim(x, <set>)` is a CHARACTER SET, not a Unicode whitespace class: it
-- closes precisely the six ASCII whitespace codepoints plus U+00A0 and nothing
-- else. Measured on the harness — U+0085 NEL, U+1680, the whole U+2000-U+200A
-- block, U+200B ZWSP, U+2028, U+202F, U+205F, U+3000 and U+FEFF are all still
-- untrimmed. Those are pinned below as FALLING BACK. If the trim is ever
-- widened again, or swapped for a regex-based normaliser, these rows are what
-- notices — and if it is narrowed, the RECOGNISED rows are.
-- =====================================================================
DO $h$
DECLARE r record; v uuid; m uuid; p jsonb; got text; expect_fallback text;
BEGIN
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';

  -- (1) RECOGNISED: case and ASCII-space variants of a canonical value.
  --     is_online is seeded FALSE throughout, so the is_online fallback would
  --     answer 'in_person'. Reading back 'hybrid' can therefore only be
  --     recognition of the stored value, never the fallback.
  FOR r IN SELECT * FROM (VALUES
      ('x6r_lower' , '"hybrid"'::jsonb    , 'hybrid'   ),
      ('x6r_cap'   , '"Hybrid"'::jsonb    , 'hybrid'   ),
      ('x6r_upper' , '"HYBRID"'::jsonb    , 'hybrid'   ),
      ('x6r_mixed' , '"HyBrId"'::jsonb    , 'hybrid'   ),
      ('x6r_padr'  , '"hybrid "'::jsonb   , 'hybrid'   ),
      ('x6r_padl'  , '" hybrid"'::jsonb   , 'hybrid'   ),
      ('x6r_padb'  , '"  HyBrId  "'::jsonb, 'hybrid'   ),
      ('x6r_online', '" Online "'::jsonb  , 'online'   ),
      ('x6r_inp'   , '"IN_PERSON"'::jsonb , 'in_person'),
      -- moved here at rework 2: the trim set now covers these.
      ('x6r_tab'   , to_jsonb(E'\thybrid\t'::text)                  , 'hybrid'),
      ('x6r_nl'    , to_jsonb(E'\nhybrid'::text)                     , 'hybrid'),
      ('x6r_cr'    , to_jsonb(E'\rhybrid'::text)                     , 'hybrid'),
      ('x6r_vt'    , to_jsonb(E'\vhybrid\v'::text)                  , 'hybrid'),
      ('x6r_ff'    , to_jsonb(E'\fhybrid\f'::text)                  , 'hybrid'),
      ('x6r_nbsp'  , to_jsonb((chr(160)||'Hybrid'||chr(160))::text)  , 'hybrid'),
      ('x6r_mixws' , to_jsonb((E'\t '||chr(160)||'HyBrId'||E' \n')::text), 'hybrid')
    ) AS t(key,fmt,want)
  LOOP
    v := i2353x.seed_published_raw(r.key, r.fmt, false);
    PERFORM i2353x.act_as(m);
    p := public.business_event_draft_payload_from_graph(v);
    got := p#>>'{theme,business_draft,format}';
    PERFORM i2353x.assert('X-6',
      'a case/space variant of '||r.want||' ('||r.fmt::text||') is RECOGNISED, not discarded',
      got = r.want, 'read back as '||COALESCE(got,'<null>')||' (is_online seeded false)');
  END LOOP;

  -- (2) and (3) NOT RECOGNISED: must fall back, must never be `hybrid`, and
  --     must equal exactly the value the is_online derivation would produce.
  --     Seeded is_online TRUE, so the fallback answer is 'online'.
  expect_fallback := 'online';
  FOR r IN SELECT * FROM (VALUES
      ('x6u_zoom'  , '"zoom"'::jsonb       , 'a junk word'),
      ('x6u_virt'  , '"virtual"'::jsonb    , 'a plausible-but-wrong word'),
      ('x6u_space' , '"in person"'::jsonb  , 'a space where an underscore belongs'),
      ('x6u_empty' , '""'::jsonb           , 'an empty string'),
      ('x6u_null'  , 'null'::jsonb         , 'a JSON null'),
      ('x6u_num'   , '5'::jsonb            , 'a number'),
      ('x6u_arr'   , '[]'::jsonb           , 'an array'),
      ('x6u_obj'   , '{}'::jsonb           , 'an object'),
      -- The boundary of the trim SET, pinned on the outside. Every codepoint
      -- below is whitespace to a human and to a Unicode-aware normaliser, and
      -- is NOT in E' \t\n\r\f\v'||chr(160). Each was measured untrimmed on
      -- the harness. They must fall back — never be fabricated into hybrid.
      ('x6u_nel'   , to_jsonb((chr(133)||'hybrid')::text)   , 'U+0085 NEL-padded hybrid — outside the trim set'),
      ('x6u_ogham' , to_jsonb((chr(5760)||'hybrid')::text)  , 'U+1680 ogham-space-padded hybrid — outside the trim set'),
      ('x6u_enq'   , to_jsonb((chr(8192)||'hybrid')::text)  , 'U+2000 en-quad-padded hybrid — outside the trim set'),
      ('x6u_em'    , to_jsonb((chr(8195)||'hybrid')::text)  , 'U+2003 em-space-padded hybrid — outside the trim set'),
      ('x6u_thin'  , to_jsonb((chr(8201)||'hybrid')::text)  , 'U+2009 thin-space-padded hybrid — outside the trim set'),
      ('x6u_zwsp'  , to_jsonb((chr(8203)||'hybrid')::text)  , 'U+200B zero-width-space-padded hybrid — outside the trim set'),
      ('x6u_lsep'  , to_jsonb((chr(8232)||'hybrid')::text)  , 'U+2028 line-separator-padded hybrid — outside the trim set'),
      ('x6u_nnbsp' , to_jsonb((chr(8239)||'hybrid')::text)  , 'U+202F narrow-NBSP-padded hybrid — outside the trim set'),
      ('x6u_mmsp'  , to_jsonb((chr(8287)||'hybrid')::text)  , 'U+205F medium-math-space-padded hybrid — outside the trim set'),
      ('x6u_ideo'  , to_jsonb((chr(12288)||'hybrid')::text) , 'U+3000 ideographic-space-padded hybrid — outside the trim set'),
      ('x6u_bom'   , to_jsonb((chr(65279)||'hybrid')::text) , 'U+FEFF BOM-padded hybrid — outside the trim set')
    ) AS t(key,fmt,label)
  LOOP
    v := i2353x.seed_published_raw(r.key, r.fmt, true);
    PERFORM i2353x.act_as(m);
    p := public.business_event_draft_payload_from_graph(v);
    got := p#>>'{theme,business_draft,format}';
    PERFORM i2353x.assert('X-6',
      r.label||' is never fabricated into hybrid',
      got IS DISTINCT FROM 'hybrid', 'read back as '||COALESCE(got,'<null>'));
    PERFORM i2353x.assert('X-6',
      r.label||' falls back to exactly the is_online derivation',
      got = expect_fallback, 'read back as '||COALESCE(got,'<null>')||', expected '||expect_fallback);
  END LOOP;
END $h$;

-- X-6b — the REPAIR property. Recognition is only worth having if the
-- wholesale theme replace then writes the CANONICAL spelling back, because
-- #2333's discovery carve-out reads the stored string. A round trip must
-- converge a variant onto its canonical form, never onto the fallback.
DO $h$
DECLARE v uuid; m uuid; row public.events%ROWTYPE;
BEGIN
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  v := i2353x.seed_published_raw('x6b_repair', to_jsonb((E'\t'||'Hybrid'||chr(160))::text), true);
  PERFORM i2353x.act_as(m);
  PERFORM public.business_unpublish_event_to_draft(v);
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-6b',
    'a whitespace+case variant of hybrid is REPAIRED to the canonical spelling by a round trip, not destroyed',
    row.theme#>>'{business_draft,format}' = 'hybrid',
    COALESCE(row.theme#>>'{business_draft,format}','<none>'));
  PERFORM i2353x.assert('X-6b','...and is_online still agrees',
    i2353x.agrees(v), i2353x.fmt(v)||'/'||row.is_online::text);
END $h$;

-- =====================================================================
-- X-7 — the transitional grant restores REACH, not AUTHORITY.
-- Different angle from T-2/T-3/T-4: the OTHER leaf (business_patch_event_when),
-- a caller with NO brand membership at all rather than a scanner, the STATUS
-- gate, and the PUBLIC pseudo-role.
-- =====================================================================
DO $h$
DECLARE ev uuid; nob uuid; mgr uuid; rc text; drafted uuid;
BEGIN
  SELECT event_id INTO ev FROM i2353x.fx WHERE key='x2_live_online';
  SELECT v INTO nob FROM i2353x.ids WHERE k='nobody';
  SELECT v INTO mgr FROM i2353x.ids WHERE k='manager';

  rc := i2353x.exec_as('authenticated', nob, format(
    'SELECT public.business_patch_event_when(%L::uuid, jsonb_build_object(''whenMode'',''single''), ''Adversarial: a total stranger tries to move the date'', 99)', ev));
  PERFORM i2353x.assert('X-7','a caller with NO brand membership is refused by business_patch_event_when',
    rc LIKE '%insufficient_event_permission%', rc);

  rc := i2353x.exec_as('anon', NULL, format(
    'SELECT public.business_patch_event_when(%L::uuid, ''{}''::jsonb, ''Adversarial anon attempt at the when leaf'', 1)', ev));
  PERFORM i2353x.assert('X-7','anon is denied at the ACL on business_patch_event_when',
    rc LIKE '42501:%', rc);

  PERFORM i2353x.assert('X-7','PUBLIC holds EXECUTE on neither patch leaf',
    NOT has_function_privilege('public','public.business_patch_event_when(uuid,jsonb,text,integer)','EXECUTE')
    AND NOT has_function_privilege('public','public.business_patch_event_taxonomy(uuid,text,text[],text[],text[],numeric,numeric,text,text)','EXECUTE'),
    'PUBLIC');
  PERFORM i2353x.assert('X-7','the demoted leaf business_update_live_event stayed server-only',
    NOT has_function_privilege('authenticated','public.business_update_live_event(uuid,jsonb,text,integer)','EXECUTE'),
    'business_update_live_event');

  SELECT event_id INTO drafted FROM i2353x.fx WHERE key='x5_legacy_nokey';
  rc := i2353x.exec_as('authenticated', mgr, format(
    'SELECT public.business_patch_event_when(%L::uuid, jsonb_build_object(''whenMode'',''single''), ''Adversarial: patch the when of a draft event'', 1)', drafted));
  PERFORM i2353x.assert('X-7','the status gate still refuses a patch on a DRAFT event',
    rc LIKE '%event_not_editable_status%', rc);
END $h$;

-- =====================================================================
-- X-8 — Ari's DRAFT arm. Added at rework, and it is where the third
-- laundering path turned out to be.
--
-- S4 taught the LIVE arm to accept a `format` and to keep `is_online` in
-- agreement with it. `ari_execute_event_operation`'s `update_event` branch has
-- TWO arms, and the DRAFT arm was never in the SPEC's five sites. It writes
-- `v_payload.is_online` straight from `p_args` and never touches
-- `v_business.format`, so it is the same "derived column written without its
-- source of truth" defect the investigation's F-9 found on the live arm —
-- on a sixth site nobody enumerated.
--
-- This needs no out-of-schema key: `is_online` is an ADVERTISED parameter of
-- the tool (`agentTools.ts:753`). A host saying "this one isn't online any
-- more" reaches it.
-- =====================================================================
DO $s$ DECLARE v uuid; m uuid; BEGIN
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  v := i2353x.seed_published('x8_draft_hybrid','hybrid',true);
  PERFORM i2353x.act_as(m);
  PERFORM public.business_unpublish_event_to_draft(v);      -- the real route to a hybrid DRAFT
  v := i2353x.seed_published('x8_draft_inperson','in_person',false);
  PERFORM i2353x.act_as(m);
  PERFORM public.business_unpublish_event_to_draft(v);
END $s$;

DO $h$
DECLARE v uuid; m uuid; rev int; row public.events%ROWTYPE;
BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x8_draft_hybrid';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  PERFORM i2353x.assert('X-8','fixture is a hybrid DRAFT whose is_online agrees',
    i2353x.fmt(v)='hybrid' AND i2353x.agrees(v),
    i2353x.fmt(v)||'/'||(SELECT is_online FROM public.events WHERE id=v)::text);
  SELECT COALESCE((theme#>>'{business_draft,clientRevision}')::int,0) INTO rev FROM public.events WHERE id=v;
  PERFORM i2353x.ari(m,'update_event', jsonb_build_object(
    'event_id', v::text, 'is_online', false,
    'reason','Adversarial: Ari turns is_online off on a hybrid DRAFT',
    'client_revision', rev+1));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-8',
    'Ari update_event(is_online=false) on a DRAFT keeps is_online and the stored format in agreement',
    i2353x.agrees(v), i2353x.fmt(v)||'/'||row.is_online::text);
EXCEPTION WHEN OTHERS THEN
  PERFORM i2353x.assert('X-8','X-8 draft is_online probe executes', false, SQLSTATE||':'||SQLERRM);
END $h$;

-- ...and the divergence must not survive publish into a live row.
DO $h$
DECLARE v uuid; m uuid; p jsonb; rev int; rc text; row public.events%ROWTYPE;
BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x8_draft_hybrid';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  PERFORM i2353x.act_as(m);
  p := public.business_event_draft_payload_from_graph(v);
  rev := COALESCE((p#>>'{theme,business_draft,clientRevision}')::int,0);
  rc := i2353x.try_sql(m, format(
    'SELECT public.issue_1719_publish_event_with_poster(%L::uuid,%L::jsonb,%s)', v, p, rev));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-8','publishing that draft does not persist a disagreeing pair',
    rc <> 'OK' OR i2353x.agrees(v),
    rc||' -> '||i2353x.fmt(v)||'/'||row.is_online::text||' status='||row.status);
END $h$;

-- X-8b — the arms must not disagree about whether `format` is a thing.
-- S4 made the LIVE arm honour it; the DRAFT arm drops it without a word, so a
-- host is told the edit succeeded and nothing changed (Constitution rule 3).
DO $h$
DECLARE v uuid; m uuid; rev int; row public.events%ROWTYPE;
BEGIN
  SELECT event_id INTO v FROM i2353x.fx WHERE key='x8_draft_inperson';
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  SELECT COALESCE((theme#>>'{business_draft,clientRevision}')::int,0) INTO rev FROM public.events WHERE id=v;
  PERFORM i2353x.ari(m,'update_event', jsonb_build_object(
    'event_id', v::text, 'format','hybrid',
    'reason','Adversarial: Ari sets a DRAFT event to hybrid explicitly',
    'client_revision', rev+1));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-8b',
    'Ari update_event(format=hybrid) on a DRAFT either applies the format or refuses — never silently drops it',
    i2353x.fmt(v)='hybrid',
    'format is '||i2353x.fmt(v)||', is_online '||row.is_online::text);
EXCEPTION WHEN OTHERS THEN
  PERFORM i2353x.assert('X-8b','X-8b draft format probe executes', false, SQLSTATE||':'||SQLERRM);
END $h$;

-- =====================================================================
-- X-9 — S6, the DRAFT arm's format/is_online precedence. Added at rework 2.
--
-- This is the third arm this issue has touched and the second time precedence
-- between `format` and `is_online` has been where it went wrong, so it is
-- attacked as a precedence TABLE rather than as a happy path.
--
-- THE ROW THAT MATTERS IS THE FIRST ONE. A correct S6 reconciles the stored
-- format from a bare `is_online` ONLY WHEN THE PAIR ACTUALLY DISAGREES. The
-- naive version — reconcile unconditionally — is a one-line difference, and it
-- is nearly invisible to everything else in both suites, because the value it
-- writes is CONSISTENT: `is_online:true` on a stored `hybrid` becomes
-- `online/true`, the projection invariant is SATISFIED, nothing crashes, and
-- every `agrees()` assertion in this file stays green. It is a lossy write that
-- looks exactly like a correct one.
--
-- What it costs is the whole point of a three-valued enum: a host asking Ari to
-- confirm a hybrid event is online-capable would have the venue silently
-- dropped from the record. Downstream that is not cosmetic — #2333's discovery
-- carve-out broadcasts on `lower(theme.business_event.format)='online'`
-- precisely because a hybrid event has a real venue and a real catchment, so a
-- flattened Lagos hybrid becomes a global broadcast. Driven and confirmed on
-- the combined stack; asserted here on the value #2333 actually reads, so this
-- file needs none of #2333's migrations to hold the line.
--
-- Each row is therefore asserted on the STORED FORMAT, not on agreement.
-- `agrees()` cannot see this defect and must not be relied on for it.
-- =====================================================================
CREATE FUNCTION i2353x.draft_arm(p_key text, p_seed_fmt text, p_extra jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid; m uuid; rev int;
BEGIN
  SELECT i.v INTO m FROM i2353x.ids i WHERE i.k='manager';
  v := i2353x.seed_published(p_key, p_seed_fmt, p_seed_fmt IN ('online','hybrid'));
  PERFORM i2353x.act_as(m);
  PERFORM public.business_unpublish_event_to_draft(v);          -- the real route to a DRAFT
  SELECT COALESCE((theme#>>'{business_draft,clientRevision}')::int,0) INTO rev
    FROM public.events WHERE id=v;
  BEGIN
    PERFORM i2353x.ari(m,'update_event',
      jsonb_build_object('event_id',v::text,
        'reason','Adversarial S6 precedence probe: '||p_key,
        'client_revision',rev+1) || p_extra);
  EXCEPTION WHEN OTHERS THEN
    PERFORM i2353x.assert('X-9','the draft-arm call for '||p_key||' is not a crash',
      SQLSTATE='22P02', SQLSTATE||':'||SQLERRM);
  END;
  RETURN v;
END $$;

DO $h$
DECLARE r record; v uuid; row public.events%ROWTYPE;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- key            seed        args                                          want_format  want_online
    ('x9_pre_hybrid' ,'hybrid'   ,'{"is_online":true}'::jsonb                  ,'hybrid'   ,true ),
    ('x9_dis_hyb_off','hybrid'   ,'{"is_online":false}'::jsonb                 ,'in_person',false),
    ('x9_dis_inp_on' ,'in_person','{"is_online":true}'::jsonb                  ,'online'   ,true ),
    ('x9_agr_onl_on' ,'online'   ,'{"is_online":true}'::jsonb                  ,'online'   ,true ),
    ('x9_agr_inp_off','in_person','{"is_online":false}'::jsonb                 ,'in_person',false),
    ('x9_fmt_wins'   ,'hybrid'   ,'{"format":"hybrid","is_online":false}'::jsonb,'hybrid'   ,true ),
    ('x9_fmt_case'   ,'in_person','{"format":"Hybrid"}'::jsonb                  ,'hybrid'   ,true ),
    ('x9_junk_noop'  ,'hybrid'   ,'{"format":"zoom"}'::jsonb                    ,'hybrid'   ,true ),
    ('x9_junk_on'    ,'hybrid'   ,'{"format":"zoom","is_online":true}'::jsonb   ,'hybrid'   ,true ),
    ('x9_junk_off'   ,'hybrid'   ,'{"format":"zoom","is_online":false}'::jsonb  ,'in_person',false),
    ('x9_jsonnull'   ,'hybrid'   ,'{"is_online":null}'::jsonb                   ,'in_person',false),
    ('x9_strbool'    ,'hybrid'   ,'{"is_online":"true"}'::jsonb                 ,'hybrid'   ,true ),
    ('x9_untouched'  ,'hybrid'   ,'{"title":"I2353X x9 untouched"}'::jsonb      ,'hybrid'   ,true )
  ) AS t(key,seed,extra,want_fmt,want_online)
  LOOP
    v := i2353x.draft_arm(r.key, r.seed, r.extra);
    SELECT * INTO row FROM public.events WHERE id=v;
    PERFORM i2353x.assert('X-9',
      'draft arm, seed '||r.seed||' + '||r.extra::text||' -> stored format '||r.want_fmt,
      row.theme#>>'{business_draft,format}' = r.want_fmt,
      'got '||COALESCE(row.theme#>>'{business_draft,format}','<none>'));
    PERFORM i2353x.assert('X-9',
      '...and is_online '||r.want_online::text,
      row.is_online IS NOT DISTINCT FROM r.want_online,
      'got '||COALESCE(row.is_online::text,'NULL'));
    PERFORM i2353x.assert('X-9','...and the pair agrees', i2353x.agrees(v),
      i2353x.fmt(v)||'/'||COALESCE(row.is_online::text,'NULL'));
  END LOOP;
END $h$;

-- X-9b — a bad boolean cast must fail closed: nothing written, draft intact.
DO $h$
DECLARE v uuid; row public.events%ROWTYPE;
BEGIN
  v := i2353x.draft_arm('x9_badcast','hybrid','{"is_online":"maybe"}'::jsonb);
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-9b','an uncastable is_online writes NOTHING and leaves the hybrid draft intact',
    row.theme#>>'{business_draft,format}'='hybrid' AND row.is_online AND row.status='draft',
    i2353x.fmt(v)||'/'||row.is_online::text||' status='||row.status);
END $h$;

-- X-9c — the discriminator must survive PUBLISH and then DUPLICATE. The naive
-- reconcile is only visible downstream, and #2333 reads the published value.
DO $h$
DECLARE v uuid; d uuid; m uuid; p jsonb; rev int; rc text; row public.events%ROWTYPE;
BEGIN
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  v := i2353x.draft_arm('x9c_chain','hybrid','{"is_online":true}'::jsonb);
  PERFORM i2353x.assert('X-9c','a hybrid draft told is_online:true is still hybrid before publish',
    i2353x.fmt(v)='hybrid', i2353x.fmt(v));
  PERFORM i2353x.act_as(m);
  p := public.business_event_draft_payload_from_graph(v);
  rev := COALESCE((p#>>'{theme,business_draft,clientRevision}')::int,0);
  rc := i2353x.try_sql(m, format(
    'SELECT public.issue_1719_publish_event_with_poster(%L::uuid,%L::jsonb,%s)', v, p, rev));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-9c','publish succeeds', rc='OK', rc);
  PERFORM i2353x.assert('X-9c',
    'the PUBLISHED theme.business_event.format is hybrid — the exact string #2333 reads to decide a global broadcast',
    row.theme#>>'{business_event,format}'='hybrid',
    COALESCE(row.theme#>>'{business_event,format}','<none>'));
  PERFORM i2353x.assert('X-9c','...and is_online is true, so a bare is_online test alone would broadcast it',
    row.is_online, row.is_online::text);
  PERFORM i2353x.act_as(m);
  p := public.business_duplicate_event_as_draft(v);
  d := COALESCE((p->>'id')::uuid,(p#>>'{event,id}')::uuid);
  PERFORM i2353x.assert('X-9c','and the Duplicate of it is hybrid too',
    i2353x.fmt(d)='hybrid', i2353x.fmt(d));
END $h$;

-- X-9d — the cross-arm chain. Draft arm and live arm, both directions, nine
-- hops, asserting the stored format at each one rather than only agreement.
DO $h$
DECLARE v uuid; d uuid; m uuid; rev int; p jsonb; rc text;
BEGIN
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  v := i2353x.seed_published('x9d_chain','hybrid',true);
  PERFORM i2353x.act_as(m); PERFORM public.business_unpublish_event_to_draft(v);
  PERFORM i2353x.assert('X-9d','hop1 unpublish keeps hybrid', i2353x.fmt(v)='hybrid', i2353x.fmt(v));

  SELECT COALESCE((theme#>>'{business_draft,clientRevision}')::int,0) INTO rev FROM public.events WHERE id=v;
  PERFORM i2353x.ari(m,'update_event', jsonb_build_object('event_id',v::text,'is_online',true,
    'reason','Chain hop2: Ari DRAFT arm confirms the hybrid is online-capable','client_revision',rev+1));
  PERFORM i2353x.assert('X-9d','hop2 Ari DRAFT is_online:true PRESERVES hybrid',
    i2353x.fmt(v)='hybrid', i2353x.fmt(v));

  PERFORM i2353x.act_as(m);
  p := public.business_event_draft_payload_from_graph(v);
  rev := COALESCE((p#>>'{theme,business_draft,clientRevision}')::int,0);
  rc := i2353x.try_sql(m, format('SELECT public.issue_1719_publish_event_with_poster(%L::uuid,%L::jsonb,%s)', v, p, rev));
  PERFORM i2353x.assert('X-9d','hop3 publish keeps hybrid', rc='OK' AND i2353x.fmt(v)='hybrid', rc||' '||i2353x.fmt(v));

  SELECT COALESCE((theme#>>'{business_event,clientRevision}')::int,0) INTO rev FROM public.events WHERE id=v;
  PERFORM i2353x.ari(m,'update_event', jsonb_build_object('event_id',v::text,'format','in_person',
    'reason','Chain hop4: Ari LIVE arm switches the event to in_person','client_revision',rev+1));
  PERFORM i2353x.assert('X-9d','hop4 Ari LIVE format:in_person applies',
    i2353x.fmt(v)='in_person' AND i2353x.agrees(v), i2353x.fmt(v));

  PERFORM i2353x.act_as(m); PERFORM public.business_unpublish_event_to_draft(v);
  PERFORM i2353x.assert('X-9d','hop5 unpublish keeps in_person', i2353x.fmt(v)='in_person', i2353x.fmt(v));

  SELECT COALESCE((theme#>>'{business_draft,clientRevision}')::int,0) INTO rev FROM public.events WHERE id=v;
  PERFORM i2353x.ari(m,'update_event', jsonb_build_object('event_id',v::text,'format','Hybrid',
    'reason','Chain hop6: Ari DRAFT arm sets a case-variant hybrid','client_revision',rev+1));
  PERFORM i2353x.assert('X-9d','hop6 Ari DRAFT format:"Hybrid" is normalised and applied',
    i2353x.fmt(v)='hybrid' AND i2353x.agrees(v), i2353x.fmt(v));

  PERFORM i2353x.act_as(m);
  p := public.business_event_draft_payload_from_graph(v);
  rev := COALESCE((p#>>'{theme,business_draft,clientRevision}')::int,0);
  rc := i2353x.try_sql(m, format('SELECT public.issue_1719_publish_event_with_poster(%L::uuid,%L::jsonb,%s)', v, p, rev));
  PERFORM i2353x.assert('X-9d','hop7 republish keeps hybrid', rc='OK' AND i2353x.fmt(v)='hybrid', rc||' '||i2353x.fmt(v));

  PERFORM i2353x.act_as(m);
  p := public.business_duplicate_event_as_draft(v);
  d := COALESCE((p->>'id')::uuid,(p#>>'{event,id}')::uuid);
  PERFORM i2353x.assert('X-9d','hop8 Duplicate keeps hybrid and agrees',
    i2353x.fmt(d)='hybrid' AND i2353x.agrees(d), i2353x.fmt(d));
END $h$;

-- =====================================================================
-- X-10 — invariant B's SCOPE, tested rather than accepted.
--
-- I-PROPOSED-2353-B scopes itself to "every writer in supabase/migrations/**
-- that DERIVES either value from the other OR FROM A CALLER ARGUMENT", and
-- names exactly two exclusions: business_create_event_draft and
-- business_update_event_draft, on the grounds that they are transport rather
-- than derivation.
--
-- Enumerating the writers that touch either value finds a THIRD of the same
-- shape that the stanza does not name. `business_publish_event_draft`, reached
-- through `issue_1719_publish_event_with_poster` — both `authenticated=X` —
-- sets `is_online = COALESCE((p_draft_payload->>'is_online')::boolean,false)`
-- from the CALLER'S payload while carrying `theme.business_draft.format`
-- through untouched, and reconciles neither. Hand it a payload whose two halves
-- contradict and it persists the contradiction onto a LIVE row.
--
-- The shipped client cannot produce that payload — `serverDraftEventMapper`
-- writes `is_online: format === "online" || format === "hybrid"` — and
-- production holds 0 disagreeing rows. So this is a REGISTRY-ACCURACY finding,
-- not a code defect: the stanza's own words are "an invariant that is false is
-- worse than no invariant", and by its own scope sentence it is currently false
-- on this writer. The fix is one line in docs/INVARIANT_REGISTRY.md — name
-- `business_publish_event_draft` / `issue_1719_publish_event_with_poster`
-- alongside the other two transport writers — BEFORE the DRAFT->ACTIVE flip.
--
-- These assertions record the MEASURED behaviour so the registry cannot drift
-- away from it unnoticed. They are green because they state what is true, not
-- what would be convenient.
-- =====================================================================
DO $h$
DECLARE v uuid; m uuid; p jsonb; rev int; rc text; row public.events%ROWTYPE;
BEGIN
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';

  -- the third transport writer, unnamed by the stanza
  v := i2353x.seed_published('x10_pub','hybrid',true);
  PERFORM i2353x.act_as(m);
  PERFORM public.business_unpublish_event_to_draft(v);
  p := public.business_event_draft_payload_from_graph(v);
  rev := COALESCE((p#>>'{theme,business_draft,clientRevision}')::int,0);
  p := jsonb_set(p,'{is_online}','false'::jsonb,true);   -- contradicts format=hybrid
  rc := i2353x.try_sql(m, format(
    'SELECT public.issue_1719_publish_event_with_poster(%L::uuid,%L::jsonb,%s)', v, p, rev));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-10',
    'the publish owner accepts a caller payload whose is_online contradicts its own format',
    rc='OK', rc);
  PERFORM i2353x.assert('X-10',
    'and persists the contradiction onto a LIVE row — so invariant B is NOT true of it as scoped',
    row.theme#>>'{business_event,format}'='hybrid' AND row.is_online IS FALSE,
    COALESCE(row.theme#>>'{business_event,format}','<none>')||'/'||row.is_online::text
    ||' agree='||i2353x.agrees(v)::text);
  PERFORM i2353x.assert('X-10',
    'it is reachable by authenticated, exactly like the two writers the stanza DOES exclude',
    has_function_privilege('authenticated',
      'public.issue_1719_publish_event_with_poster(uuid,jsonb,integer)','EXECUTE')
    AND has_function_privilege('authenticated',
      'public.business_update_event_draft(uuid,jsonb,integer)','EXECUTE'),
    'authenticated');

  -- and once a disagreeing row exists, nothing in the family repairs it
  v := i2353x.seed_published('x10_prop','hybrid',true);
  UPDATE public.events SET is_online=false WHERE id=v;
  PERFORM i2353x.act_as(m);
  p := public.business_duplicate_event_as_draft(v);
  row.id := COALESCE((p->>'id')::uuid,(p#>>'{event,id}')::uuid);
  PERFORM i2353x.assert('X-10',
    'Duplicate propagates a pre-existing disagreement rather than repairing it — no writer in the family heals one',
    i2353x.fmt(row.id)='hybrid' AND NOT (SELECT is_online FROM public.events WHERE id=row.id),
    i2353x.fmt(row.id)||'/'||(SELECT is_online FROM public.events WHERE id=row.id)::text);

  -- the two writers the stanza DOES exclude behave exactly as documented
  v := i2353x.seed_published('x10_excl','hybrid',true);
  PERFORM i2353x.act_as(m);
  PERFORM public.business_unpublish_event_to_draft(v);
  SELECT COALESCE((theme#>>'{business_draft,clientRevision}')::int,0) INTO rev FROM public.events WHERE id=v;
  p := public.business_event_draft_payload_from_graph(v);
  p := jsonb_set(p,'{is_online}','false'::jsonb,true);
  rc := i2353x.try_sql(m, format(
    'SELECT public.business_update_event_draft(%L::uuid,%L::jsonb,%s)', v, p, rev+1));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-10',
    'business_update_event_draft transports a disagreeing pair unreconciled, exactly as the stanza states',
    rc='OK' AND row.theme#>>'{business_draft,format}'='hybrid' AND row.is_online IS FALSE,
    rc||' '||COALESCE(row.theme#>>'{business_draft,format}','<none>')||'/'||row.is_online::text);

  -- the DERIVING writers the stanza does cover: the atomic owner reconciles
  v := i2353x.seed_published('x10_atomic','hybrid',true);
  rc := i2353x.try_sql(m, format(
    'SELECT public.business_update_live_event_atomic(%L::uuid, jsonb_build_object(''core'',jsonb_build_object(''format'',''in_person'')), ''Adversarial: atomic owner switches a hybrid to in_person'', 1)', v));
  SELECT * INTO row FROM public.events WHERE id=v;
  PERFORM i2353x.assert('X-10',
    'the atomic owner — a DERIVING writer — does keep the pair in agreement',
    rc='OK' AND i2353x.agrees(v) AND row.theme#>>'{business_event,format}'='in_person',
    rc||' '||i2353x.fmt(v)||'/'||row.is_online::text);
END $h$;

-- =====================================================================
-- Verdict. Non-vacuity first: a green run that proved nothing is a failure.
-- =====================================================================
DO $verdict$
DECLARE v_total int; v_fail int; r record;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE outcome='FAIL') INTO v_total, v_fail FROM i2353x.result;
  IF v_total < 110 THEN
    RAISE EXCEPTION 'issue #2353 adversarial suite ran only % assertions — it is not exercising the seams', v_total;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM i2353x.result WHERE criterion LIKE 'X-1/hop%' AND outcome='PASS') THEN
    RAISE EXCEPTION 'issue #2353 adversarial suite: no lifecycle hop was exercised';
  END IF;
  FOR r IN SELECT criterion, outcome, name, COALESCE(detail,'') AS detail
             FROM i2353x.result ORDER BY id LOOP
    RAISE NOTICE '% [%] % (%)', r.outcome, r.criterion, r.name, r.detail;
  END LOOP;
  RAISE NOTICE '=== issue #2353 adversarial: % of % assertions PASS ===', v_total - v_fail, v_total;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'issue #2353 adversarial suite: % of % assertions FAILED', v_fail, v_total;
  END IF;
END $verdict$;

DROP SCHEMA i2353x CASCADE;

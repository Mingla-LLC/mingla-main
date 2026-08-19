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
-- X-6 — normalisation at the READ site. T-12 attacks the WRITE predicate only.
-- The safety property that must hold: a non-canonical stored value can never
-- read back as a fabricated `hybrid`. (That it is then overwritten by the
-- is_online fallback on the next wholesale theme replace is a deliberate
-- consequence of bare `IN (...)`, recorded in the TEST REPORT, not asserted
-- here — no writer emits a non-canonical value and production holds none.)
-- =====================================================================
DO $h$
DECLARE r record; v uuid; m uuid; p jsonb; got text;
BEGIN
  SELECT i.v INTO m FROM i2353x.ids i WHERE k='manager';
  FOR r IN SELECT * FROM (VALUES
      ('x6_cap'  ,'"Hybrid"'  ,'Hybrid'),
      ('x6_upper','"HYBRID"'  ,'HYBRID'),
      ('x6_pad'  ,'"hybrid "' ,'trailing-space hybrid'),
      ('x6_padl' ,'" online "','padded online'),
      ('x6_null' ,'null'      ,'json null'),
      ('x6_num'  ,'5'         ,'number'),
      ('x6_arr'  ,'[]'        ,'array'),
      ('x6_obj'  ,'{}'        ,'object')
    ) AS t(key,fmt,label)
  LOOP
    v := i2353x.seed_published_raw(r.key, r.fmt::jsonb, true);
    PERFORM i2353x.act_as(m);
    p := public.business_event_draft_payload_from_graph(v);
    got := p#>>'{theme,business_draft,format}';
    PERFORM i2353x.assert('X-6',
      'a stored '||r.label||' never reads back as a fabricated hybrid',
      got IS DISTINCT FROM 'hybrid', 'read back as '||COALESCE(got,'<null>'));
    PERFORM i2353x.assert('X-6',
      'a stored '||r.label||' reads back as one of the three canonical values',
      got IN ('in_person','online','hybrid'), COALESCE(got,'<null>'));
  END LOOP;
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
-- Verdict. Non-vacuity first: a green run that proved nothing is a failure.
-- =====================================================================
DO $verdict$
DECLARE v_total int; v_fail int; r record;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE outcome='FAIL') INTO v_total, v_fail FROM i2353x.result;
  IF v_total < 35 THEN
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

-- MINGLA-INVARIANT: I-4573-NO-BARE-DELETE-UPDATE | issue #4573 | no public function body written as a static DELETE FROM or UPDATE ... SET statement lacks a top-level WHERE clause; pg-safeupdate (preloaded by hosted PostgREST sessions) refuses one with SQLSTATE 21000. Dynamic SQL (EXECUTE of a string) is NOT checked: comments and string literals are stripped first.
--
-- #4573 (20281127004573_issue_4573_form_request_safeupdate.sql): PostgreSQL 17 proof after the full
-- replay, run as supabase_admin.
--
-- T-1  catalog (SC-4, unconditional), what it checks and nothing more: in the body of every public
--      function and procedure, after comments, string literals, dollar-quoted strings and quoted
--      identifiers are blanked out, every statement that starts with DELETE FROM (with or without
--      ONLY, alias, USING, RETURNING, inside a CTE or a LANGUAGE sql body) or UPDATE <rel> SET ... has
--      the word WHERE at its own top level (a WHERE that sits only inside a parenthesised subquery
--      does not count). ON CONFLICT DO UPDATE SET and FOR UPDATE are not statements of this kind.
--      NOT checked: dynamic SQL (EXECUTE 'DELETE FROM t'; the text is a string), DO blocks (not in the
--      catalog), functions outside public, and DML issued by other means.
--      The scanner is proved on planted functions, both ways (each shape flagged; each clean shape not).
-- T-2  with LOAD 'safeupdate' (what every PostgREST session runs with in production):
--      SC-1 brand_form_request_enqueue queues an all-NG audience and a mixed NG/US audience;
--      SC-2 with texts off (over the monthly allowance) the enqueue succeeds, reason
--           monthly_allowance, and no queued row is routed by text;
--      SC-3 brand_form_auto_reminders_due() with one due attachment returns runs >= 1.
--
-- FAILS-ON-REVERT: removing any WHERE true from 20281127004573 fails T-1, and fails T-2 with
-- SQLSTATE 21000 "DELETE requires a WHERE clause" (SC-1, SC-3) or "UPDATE requires a WHERE
-- clause" (SC-2).

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4573 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.u(p_tag text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5('i4573:' || p_tag)::uuid $fn$;

CREATE OR REPLACE FUNCTION pg_temp.subj(VARIADIC p_tags text[]) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_agg(jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u(t))) FROM unnest(p_tags) t
$fn$;

-- ═══ T-1 catalog: no bare DELETE / UPDATE in any public function (SC-4) ═══════════
-- Blank out comments, string literals, dollar-quoted strings and quoted identifiers, then for each
-- DELETE FROM / UPDATE <rel> SET statement look for WHERE at the statement's own paren depth.
CREATE FUNCTION pg_temp.bare_dml(p text) RETURNS text[] LANGUAGE plpgsql AS $fn$
DECLARE
  n int := length(p); i int := 1; k int; j int; q int; c text; tag text;
  chunks text[] := '{}'; s text; found text[] := '{}';
  pos int; kind text; depth int; top text; ch text;
BEGIN
  -- 1. strip
  LOOP
    k := regexp_instr(p, '''|--|/\*|\$|"', i);
    IF k = 0 THEN chunks := chunks || substr(p, i); EXIT; END IF;
    chunks := chunks || substr(p, i, k - i);
    c := substr(p, k, 2);
    IF substr(c, 1, 1) = '''' THEN
      j := k + 1;
      LOOP
        q := strpos(substr(p, j), '''');
        IF q = 0 THEN j := n + 1; EXIT; END IF;
        j := j + q;                                   -- just past the quote
        IF substr(p, j, 1) = '''' THEN j := j + 1; ELSE EXIT; END IF;
      END LOOP;
      chunks := array_append(chunks, ' '::text); i := j;
    ELSIF substr(c, 1, 1) = '"' THEN
      j := k + 1;
      LOOP
        q := strpos(substr(p, j), '"');
        IF q = 0 THEN j := n + 1; EXIT; END IF;
        j := j + q;
        IF substr(p, j, 1) = '"' THEN j := j + 1; ELSE EXIT; END IF;
      END LOOP;
      chunks := array_append(chunks, ' q '::text); i := j;
    ELSIF c = '--' THEN
      q := strpos(substr(p, k), E'\n');
      i := CASE WHEN q = 0 THEN n + 1 ELSE k + q END; chunks := array_append(chunks, ' '::text);
    ELSIF c = '/*' THEN
      q := strpos(substr(p, k + 2), '*/');
      i := CASE WHEN q = 0 THEN n + 1 ELSE k + 2 + q + 1 END; chunks := array_append(chunks, ' '::text);
    ELSE  -- '$': a dollar-quote tag, or a parameter such as $1
      tag := substring(substr(p, k, 64) from '^\$([A-Za-z_][A-Za-z0-9_]*)?\$');
      IF tag IS NULL AND substr(p, k, 2) <> '$$' THEN
        chunks := array_append(chunks, '$'::text); i := k + 1;
      ELSE
        tag := '$' || COALESCE(tag, '') || '$';
        q := strpos(substr(p, k + length(tag)), tag);
        i := CASE WHEN q = 0 THEN n + 1 ELSE k + length(tag) + q - 1 + length(tag) END;
        chunks := array_append(chunks, ' '::text);
      END IF;
    END IF;
    EXIT WHEN i > n;
  END LOOP;
  s := array_to_string(chunks, '');
  -- 2. every DELETE FROM / UPDATE <rel> SET start
  k := 1;
  LOOP
    pos := regexp_instr(s, '\m(DELETE\s+FROM|UPDATE)\M', k, 1, 0, 'i');
    EXIT WHEN pos = 0;
    k := pos + 1;
    kind := upper(substring(substr(s, pos, 8) from '^[A-Za-z]+'));
    IF kind = 'UPDATE' THEN
      CONTINUE WHEN substr(s, pos, 400) !~* '^UPDATE\s+(ONLY\s+)?[^\s;()]+(\s+(AS\s+)?[A-Za-z_][A-Za-z0-9_]*)?\s+SET\M';
      CONTINUE WHEN substr(s, greatest(pos - 12, 1), least(pos - 1, 12)) ~* '\mDO\s*$';
    END IF;
    depth := 0; top := ''; j := pos;
    WHILE j <= length(s) LOOP
      ch := substr(s, j, 1);
      IF ch = '(' THEN depth := depth + 1;
      ELSIF ch = ')' THEN depth := depth - 1; EXIT WHEN depth < 0;
      ELSIF ch = ';' AND depth = 0 THEN EXIT;
      ELSIF depth = 0 THEN top := top || ch;
      END IF;
      j := j + 1;
    END LOOP;
    IF top !~* '\mWHERE\M' THEN
      found := found || left(regexp_replace(substr(s, pos, 80), '\s+', ' ', 'g'), 50);
    END IF;
  END LOOP;
  RETURN found;
END;
$fn$;

-- The scan over one schema (pg_temp = this session's temp schema), optionally one name prefix.
CREATE FUNCTION pg_temp.bare_fns(p_nsp text, p_prefix text DEFAULT '') RETURNS text LANGUAGE sql AS $fn$
  SELECT string_agg(DISTINCT p.proname || ' [' || array_to_string(pg_temp.bare_dml(p.prosrc), '; ') || ']', ', ')
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.oid = CASE WHEN p_nsp = 'pg_temp' THEN pg_my_temp_schema() ELSE (SELECT oid FROM pg_namespace WHERE nspname = p_nsp) END
     AND p.prokind IN ('f', 'p') AND p.proname LIKE p_prefix || '%'
     AND p.prosrc ~* '(DELETE|UPDATE)'
     AND cardinality(pg_temp.bare_dml(p.prosrc)) > 0
$fn$;

-- The real catalog.
DO $t$
DECLARE v_bad text := pg_temp.bare_fns('public');
BEGIN
  PERFORM pg_temp.ok(v_bad IS NULL,
    'T-1 SC-4 no public function has a DELETE or UPDATE without WHERE (found: ' || COALESCE(v_bad, 'none') || ')');
END;
$t$;

-- The scanner proved on planted functions (temp schema, rolled back). Each "bad" shape must be flagged
-- (the gate goes red on it); each "clean" shape must not.
BEGIN;
CREATE TEMP TABLE t2x (a int, b int);
CREATE TEMP TABLE "q2" (a int);
DO $t$
DECLARE
  r record; v text; n_bad int := 0; n_clean int := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('bad_plain',      'plpgsql', 'BEGIN DELETE FROM t2x; END;', true),
    ('bad_digits',     'plpgsql', 'BEGIN DELETE FROM pg_temp.t2x; END;', true),
    ('bad_quoted',     'plpgsql', 'BEGIN DELETE FROM pg_temp."q2"; END;', true),
    ('bad_as_alias',   'plpgsql', 'BEGIN DELETE FROM t2x AS d; END;', true),
    ('bad_bare_alias', 'plpgsql', 'BEGIN DELETE FROM t2x d; END;', true),
    ('bad_returning',  'plpgsql', 'DECLARE v int; BEGIN DELETE FROM t2x RETURNING a INTO v; END;', true),
    ('bad_cte',        'plpgsql', 'BEGIN WITH d AS (DELETE FROM t2x RETURNING a) SELECT count(*) FROM d; END;', true),
    ('bad_using',      'plpgsql', 'BEGIN DELETE FROM t2x USING q2; END;', true),
    ('bad_only',       'plpgsql', 'BEGIN DELETE FROM ONLY t2x; END;', true),
    ('bad_upd_where_in_sub', 'plpgsql', 'BEGIN UPDATE t2x SET a = (SELECT max(a) FROM q2 WHERE a > 0); END;', true),
    ('bad_del_where_in_sub', 'plpgsql', 'BEGIN DELETE FROM t2x USING (SELECT a FROM q2 WHERE a > 0) s; END;', true),
    ('bad_update',     'plpgsql', 'BEGIN UPDATE t2x SET a = 1; END;', true),
    ('bad_upd_alias',  'plpgsql', 'BEGIN UPDATE t2x AS u SET a = 1; END;', true),
    ('bad_upd_bare_alias', 'plpgsql', 'BEGIN UPDATE t2x u SET a = 1; END;', true),
    ('bad_upd_only',   'plpgsql', 'BEGIN UPDATE ONLY t2x SET a = 1; END;', true),
    ('bad_upd_from',   'plpgsql', 'BEGIN UPDATE t2x SET a = q.a FROM q2 q; END;', true),
    ('bad_upd_returning', 'plpgsql', 'DECLARE v int; BEGIN UPDATE t2x SET a = 1 RETURNING a INTO v; END;', true),
    ('bad_sql_noterm', 'sql',     'DELETE FROM t2x', true),
    ('bad_sql_update', 'sql',     'UPDATE t2x SET a = 1', true),
    ('bad_second_stmt', 'plpgsql', 'BEGIN DELETE FROM t2x WHERE a = 1; WITH d AS (UPDATE t2x SET a = 2 RETURNING a) SELECT 1; END;', true),
    ('ok_where_true',  'plpgsql', 'BEGIN DELETE FROM t2x WHERE true; UPDATE t2x SET a = 1 WHERE true; END;', false),
    ('ok_alias_where', 'plpgsql', 'BEGIN DELETE FROM t2x AS d WHERE d.a = 1; UPDATE t2x u SET a = 1 WHERE u.a = 2; END;', false),
    ('ok_using_where', 'plpgsql', 'BEGIN DELETE FROM t2x USING q2 WHERE t2x.a = q2.a; UPDATE t2x SET a = q.a FROM q2 q WHERE q.a = t2x.a; END;', false),
    ('ok_cte_where',   'plpgsql', 'BEGIN WITH d AS (DELETE FROM t2x WHERE a = 1 RETURNING a) SELECT count(*) FROM d; END;', false),
    ('ok_returning_where', 'plpgsql', 'DECLARE v int; BEGIN DELETE FROM ONLY t2x WHERE a = 1 RETURNING a INTO v; END;', false),
    ('ok_sql_where',   'sql',     'DELETE FROM t2x WHERE a > 0', false),
    ('ok_conflict',    'plpgsql', 'BEGIN INSERT INTO t2x(a) VALUES (1) ON CONFLICT DO NOTHING; INSERT INTO t2x(a) VALUES (1) ON CONFLICT (a) DO UPDATE SET b = 1; END;', false),
    ('ok_for_update',  'plpgsql', 'DECLARE v int; BEGIN SELECT a INTO v FROM t2x FOR UPDATE; END;', false),
    ('ok_comment_string', 'plpgsql', E'BEGIN -- DELETE FROM t2x;\n /* UPDATE t2x SET a = 1; */ PERFORM ''DELETE FROM t2x; UPDATE t2x SET a = 1;''; PERFORM $q$DELETE FROM t2x;$q$; END;', false),
    ('ok_semicolon_in_string', 'plpgsql', 'BEGIN DELETE FROM t2x WHERE a::text = '';''; END;', false),
    -- Stated limit: dynamic SQL is a string and is not checked.
    ('limit_execute',  'plpgsql', 'BEGIN EXECUTE ''DELETE FROM t2x''; END;', false)
  ) AS x(tag, lang, body, expect_bad)
  LOOP
    EXECUTE format('CREATE FUNCTION pg_temp.%I() RETURNS void LANGUAGE %s AS %L', 'zp_' || r.tag, r.lang, r.body);
    v := pg_temp.bare_fns('pg_temp', 'zp_' || r.tag);
    PERFORM pg_temp.ok((v IS NOT NULL) = r.expect_bad,
      'T-1 scanner ' || CASE WHEN r.expect_bad THEN 'flags ' ELSE 'passes ' END || r.tag || ' (' || COALESCE(v, 'clean') || ')');
    IF r.expect_bad THEN n_bad := n_bad + 1; ELSE n_clean := n_clean + 1; END IF;
  END LOOP;
  PERFORM pg_temp.ok(n_bad >= 20 AND n_clean >= 10, 'T-1 scanner planted ' || n_bad || ' bad and ' || n_clean || ' clean shapes');
END;
$t$;
ROLLBACK;

BEGIN;
-- What PostgREST sessions run with in hosted Supabase.
LOAD 'safeupdate';

-- The fixture: a brand, one page with six guests (NG and US phones, all with email), one live form.
DO $t$
DECLARE
  v_def jsonb := '{"schema":"mingla.brand_form.v1","title":"Guest questions","intro":"One question","questions":[{"id":"45739100-0000-4000-8000-000000000101","position":0,"type":"short_text","label":"Dietary needs","required":true}]}'::jsonb;
  v_tag text;
  v_tz text := (SELECT name FROM pg_timezone_names WHERE extract(hour FROM now() AT TIME ZONE name) BETWEEN 11 AND 18
                  AND name LIKE 'Etc/GMT%' ORDER BY name LIMIT 1);
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['owner','u1','u2','u3','u4','u5','u6'] LOOP
    INSERT INTO auth.users(id, email) VALUES (pg_temp.u(v_tag), 'i4573-' || v_tag || '@example.test');
    INSERT INTO public.profiles(id, email, display_name, first_name, last_name)
    VALUES (pg_temp.u(v_tag), 'i4573-' || v_tag || '@example.test', initcap(v_tag) || ' Person', initcap(v_tag), 'Person')
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (pg_temp.u('brand'), pg_temp.u('owner'), 'Issue 4573', 'i4573-brand', 'NGN');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (pg_temp.u('brand'), pg_temp.u('owner'), 'brand_owner', now());
  -- The page starts in 47 hours: inside the automatic reminder's 46-48 hour window.
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (pg_temp.u('e'), pg_temp.u('brand'), 'Safeupdate night', 'i4573-e', 'rsvp', 'scheduled', 'public', v_tz, 'NGN');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (pg_temp.u('e'), now() + interval '47 hours', now() + interval '51 hours', 'UTC', true);
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (pg_temp.u('r1'), pg_temp.u('e'), pg_temp.u('u1'), 'Ada One', 'i4573-r1@example.test', '+2348030000001', 'going', 'approved'),
         (pg_temp.u('r2'), pg_temp.u('e'), pg_temp.u('u2'), 'Bola Two', 'i4573-r2@example.test', '+2348030000002', 'going', 'approved'),
         (pg_temp.u('r3'), pg_temp.u('e'), pg_temp.u('u3'), 'Cy Three', 'i4573-r3@example.test', '+12025558003', 'going', 'approved'),
         (pg_temp.u('r4'), pg_temp.u('e'), pg_temp.u('u4'), 'Dayo Four', 'i4573-r4@example.test', '+2348030000004', 'going', 'approved'),
         (pg_temp.u('r5'), pg_temp.u('e'), pg_temp.u('u5'), 'Eze Five', 'i4573-r5@example.test', '+2348030000005', 'going', 'approved'),
         (pg_temp.u('r6'), pg_temp.u('e'), pg_temp.u('u6'), 'Femi Six', 'i4573-r6@example.test', '+2348030000006', 'going', 'approved');
  INSERT INTO public.brand_forms(id, brand_id, name, status, draft, created_by, updated_by)
  VALUES (pg_temp.u('F'), pg_temp.u('brand'), 'Safeupdate questions', 'draft', v_def, pg_temp.u('owner'), pg_temp.u('owner'));
  INSERT INTO public.brand_form_versions(id, form_id, version, definition, definition_sha256, published_by)
  VALUES (pg_temp.u('Fv'), pg_temp.u('F'), 1, v_def, encode(digest(v_def::text, 'sha256'), 'hex'), pg_temp.u('owner'));
  UPDATE public.brand_forms SET status = 'live', live_version_id = pg_temp.u('Fv') WHERE id = pg_temp.u('F');
  INSERT INTO public.brand_form_attachments(id, form_id, brand_id, event_id, mode, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('F'), pg_temp.u('brand'), pg_temp.u('e'), 'required_step', pg_temp.u('owner'));
  PERFORM set_config('session_replication_role', 'origin', true);
END;
$t$;

-- ═══ T-2 the calls PostgREST makes, with safeupdate loaded ════════════════════════
DO $t$
DECLARE v jsonb; v_err text;
BEGIN
  -- Prove the guard is live in this session: a bare DELETE is refused here.
  BEGIN
    EXECUTE 'CREATE TEMP TABLE i4573_probe (x int) ON COMMIT DROP';
    EXECUTE 'DELETE FROM pg_temp.i4573_probe';
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  PERFORM pg_temp.ok(v_err = '21000', 'T-2 pg-safeupdate is loaded in this session (bare DELETE: ' || v_err || ')');

  -- SC-1a: an all-NG audience.
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(pg_temp.u('owner'), pg_temp.u('F'), pg_temp.u('e'), 'ask', 'everyone',
         pg_temp.subj('r1', 'r2'), ARRAY['email', 'sms']);
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'queued')::integer = 2,
    'T-2 SC-1 under safeupdate an all-NG audience is queued (' || v::text || ')');
  -- SC-1b: a mixed NG/US audience.
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(pg_temp.u('owner'), pg_temp.u('F'), pg_temp.u('e'), 'ask', 'everyone',
         pg_temp.subj('r3', 'r4'), ARRAY['email', 'sms']);
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'queued')::integer = 2,
    'T-2 SC-1 under safeupdate a mixed NG/US audience is queued (' || v::text || ')');

  -- SC-2: one text a month and four already queued this month: texts are off for the send.
  INSERT INTO public.brand_messaging_limits (brand_id, email_monthly, sms_monthly, reason)
  VALUES (pg_temp.u('brand'), 1000, 1, 'i4573');
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(pg_temp.u('owner'), pg_temp.u('F'), pg_temp.u('e'), 'ask', 'everyone',
         pg_temp.subj('r5', 'r6'), ARRAY['email', 'sms']);
  RESET ROLE;
  PERFORM pg_temp.ok(v->'textsOff'->>'reason' = 'monthly_allowance' AND (v->>'queued')::integer = 2
      AND (v->>'textsQueued')::integer = 0,
    'T-2 SC-2 under safeupdate texts off: the send succeeds by email (' || v::text || ')');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends
                                  WHERE form_id = pg_temp.u('F') AND rsvp_id IN (pg_temp.u('r5'), pg_temp.u('r6'))
                                    AND 'sms' = ANY (route)),
    'T-2 SC-2 no row queued with texts off is routed by text');

  -- SC-3: switch the automatic reminder on; the page starts in 47 hours.
  UPDATE public.brand_form_attachments SET auto_remind = true, auto_remind_channels = ARRAY['email']
   WHERE id = pg_temp.u('a');
  -- Clear the asks so nobody is held by the 24-hour per-person throttle.
  DELETE FROM public.brand_form_request_sends WHERE form_id = pg_temp.u('F');
  SET LOCAL ROLE service_role;
  v := public.brand_form_auto_reminders_due();
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'runs')::integer >= 1 AND (v->>'queued')::integer >= 1,
    'T-2 SC-3 under safeupdate the automatic reminder runs and queues (' || v::text || ')');
END;
$t$;

ROLLBACK;

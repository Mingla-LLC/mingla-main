-- Issue #3802 (follow-up to Wave 4, second part) -- the normal form of a
-- YouTube video link and of an Argentine or Mexican mobile number, on the
-- fully replayed PG17 schema.
--
-- What it proves:
--   N-1  catalog: crm_ident_key() is the function the follow-up file writes,
--        with the same signature, attributes and grants; crm_phone_national()
--        and is_admin_user() are untouched
--   N-2  the table of examples the admin web's twin is held to (kind | value
--        | normal form, "-" = not usable): a video id keeps its case in both
--        link forms, every other profile handle is lower-cased, the mobile
--        digit after +54 and +52 is dropped only when ten digits follow it
--   N-3  pairs of phone numbers both sides match the same way (exact,
--        national_number or none), asked both ways round
--   N-4  duplicate detection: one video written two ways is one detail; two
--        ids that differ only in case are two
--   N-5  the stored forms are recomputed: rows written under the earlier
--        function are re-keyed with their id, author and time kept; a repeat
--        on one record keeps the row that already held the form (or the
--        earliest); two rows that swap forms do not collide; national and
--        tail9 follow
--   N-6  the self-check passes as shipped and objects to mistakes
--
-- Run from the repository root as `supabase_admin` (it reads two migration
-- files). One transaction, rolled back. Checks are RECORDED and reported
-- together.

\set ON_ERROR_STOP on
\set t3802c_new_file `cat supabase/migrations/20271015003802_issue_3802_normal_form_followup.sql`
\set t3802c_body `sed '/^BEGIN;$/d; /^COMMIT;$/d' supabase/migrations/20271015003802_issue_3802_normal_form_followup.sql`
\set t3802c_check `sed -n '/^DO \$nfcheck\$/,/^\$nfcheck\$;/p' supabase/migrations/20271015003802_issue_3802_normal_form_followup.sql`
\set t3802c_old_fn `sed -n '/^CREATE FUNCTION public.crm_ident_key(/,/^\$\$;/p' supabase/migrations/20270831003802_issue_3802_wave4_agent_write_setup.sql | sed '1s/^CREATE FUNCTION/CREATE OR REPLACE FUNCTION/'`
\set t3802c_old_file `cat supabase/migrations/20270831003802_issue_3802_wave4_agent_write_setup.sql`

begin;

create temp table t3802c_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t3802c_src (k text primary key, sql text) on commit drop;
insert into t3802c_src values ('new_file', :'t3802c_new_file'), ('check', :'t3802c_check'),
  ('old_fn', :'t3802c_old_fn'), ('old_file', :'t3802c_old_file');

create function pg_temp.t3802c_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3802c_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

-- The body of a function as a file writes it, between its AS $$ and $$;.
create function pg_temp.t3802c_body_of(p_sql text, p_head text) returns text
language plpgsql as $fn$
declare
  v text := substring(p_sql from position(p_head in p_sql));
begin
  v := substring(v from position(E'AS $$' in v) + 5);
  return substring(v from 1 for position(E'\n$$;' in v));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- N-1 -- catalog.
-- ---------------------------------------------------------------------------
do $n1$
begin
  perform pg_temp.t3802c_check('N-1', 'crm_ident_key() is the function the follow-up file writes',
    ((select prosrc from pg_proc where oid = 'public.crm_ident_key(text,text)'::regprocedure)
       = pg_temp.t3802c_body_of((select sql from t3802c_src where k = 'new_file'), 'CREATE OR REPLACE FUNCTION public.crm_ident_key('))::text, 'true');
  perform pg_temp.t3802c_check('N-1', 'crm_phone_national() is still the function the Wave 4 file wrote',
    ((select prosrc from pg_proc where oid = 'public.crm_phone_national(text)'::regprocedure)
       = pg_temp.t3802c_body_of((select sql from t3802c_src where k = 'old_file'), 'CREATE FUNCTION public.crm_phone_national('))::text, 'true');
  perform pg_temp.t3802c_check('N-1', 'crm_ident_key() keeps its arguments, result and attributes',
    (select format('%s|%s|%s|%s|%s|%s|%s', pg_get_function_identity_arguments(p.oid), p.prorettype::regtype, l.lanname,
                   p.provolatile, p.proisstrict, p.prosecdef, array_to_string(p.proconfig, ','))
       from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = 'public.crm_ident_key(text,text)'::regprocedure),
    'p_kind text, p_value text|text|plpgsql|i|t|f|search_path=""');
  perform pg_temp.t3802c_check('N-1', 'crm_ident_key() can be run by the trusted server role only',
    (select string_agg(distinct coalesce(g.rolname, 'PUBLIC'), ',' order by coalesce(g.rolname, 'PUBLIC'))
       from pg_proc p, aclexplode(p.proacl) a left join pg_roles g on g.oid = a.grantee
      where p.oid = 'public.crm_ident_key(text,text)'::regprocedure and a.privilege_type = 'EXECUTE'
        and coalesce(g.rolname, 'PUBLIC') <> (select r.rolname from pg_roles r where r.oid = p.proowner)),
    'service_role');
  perform pg_temp.t3802c_check('N-1', 'the signed-in and anonymous roles cannot run it',
    (has_function_privilege('authenticated', 'public.crm_ident_key(text,text)', 'EXECUTE')
       or has_function_privilege('anon', 'public.crm_ident_key(text,text)', 'EXECUTE'))::text, 'false');
  perform pg_temp.t3802c_check('N-1', 'the follow-up file never replaces is_admin_user(), the role functions or crm_phone_national()',
    (select (sql !~* 'function\s+public\.(is_admin_user|admin_team_role|admin_team_can|admin_team_role_areas|admin_team_my_access|crm_phone_national)\M')::text
       from t3802c_src where k = 'new_file'), 'true');
  perform pg_temp.t3802c_check('N-1', 'the follow-up file replaces exactly one function',
    (select count(*)::text from regexp_matches((select sql from t3802c_src where k = 'new_file'), '^CREATE (OR REPLACE )?FUNCTION', 'gn')), '1');
  perform pg_temp.t3802c_check('N-1', 'is_admin_user() has the source it had before Wave 4',
    (select md5(prosrc) from pg_proc where oid = 'public.is_admin_user()'::regprocedure), 'dc5465a20a4246c6921be0469e261a8b');
end;
$n1$;

-- ---------------------------------------------------------------------------
-- N-2 -- the normal form. The table below is the one the admin web's twin of
-- crm_ident_key is asserted against (kind | value | normal form, "-" = not
-- usable); keep the two in step. The second table is the pairs of phone
-- numbers both sides match the same way.
-- ---------------------------------------------------------------------------
create temp table t3802c_forms (kind text, value text, want text) on commit drop;
insert into t3802c_forms values
  ('phone', '+54 9 11 1234 5678', '+541112345678'),
  ('phone', '+54 11 1234 5678', '+541112345678'),
  ('phone', '+54 9 351 123 4567', '+543511234567'),
  ('phone', '0054 9 11 1234-5678', '+541112345678'),
  ('phone', '+54 (0)11 1234 5678', '+541112345678'),
  ('phone', '+54 9 11 1234 5678 ext 5', '+541112345678'),
  ('phone', 'https://wa.me/5491112345678', '+541112345678'),
  ('phone', 'https://api.whatsapp.com/send?phone=5215512345678', '+525512345678'),
  ('phone', '+52 1 55 1234 5678', '+525512345678'),
  ('phone', '+52 55 1234 5678', '+525512345678'),
  ('phone', '+52 1 33 1234 5678', '+523312345678'),
  ('phone', '00 52 1 55 1234 5678', '+525512345678'),
  ('phone', '+54 9 11 1234 567', '+549111234567'),
  ('phone', '+54 9 11 1234 56789', '+54911123456789'),
  ('phone', '+52 1 55 1234 567', '+521551234567'),
  ('phone', '+52 1 55 1234 56789', '+52155123456789'),
  ('phone', '549 11 1234 5678', '5491112345678'),
  ('phone', '521 55 1234 5678', '5215512345678'),
  ('phone', '+254 9 11 1234 5678', '+25491112345678'),
  ('phone', '+55 9 11 1234 5678', '+5591112345678'),
  ('phone', '+352 1 55 1234 567', '+3521551234567'),
  ('phone', '+1 549 111 2345', '+15491112345'),
  ('phone', '+54 9', '-'),
  ('handle', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ'),
  ('handle', 'https://youtu.be/dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ'),
  ('handle', 'youtu.be/dQw4w9WgXcQ?si=Ab12', 'youtube.com/watch?v=dQw4w9WgXcQ'),
  ('handle', 'HTTPS://YOUTU.BE/dQw4w9WgXcQ/', 'youtube.com/watch?v=dQw4w9WgXcQ'),
  ('handle', 'https://www.youtu.be/dQw4w9WgXcQ#t=1', 'youtube.com/watch?v=dQw4w9WgXcQ'),
  ('handle', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'youtube.com/watch?v=dQw4w9WgXcQ'),
  ('handle', 'https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ'),
  ('handle', 'HTTPS://WWW.YOUTUBE.COM/WATCH?V=dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ'),
  ('handle', 'https://www.youtube.com/watch?v=DQW4W9WGXCQ', 'youtube.com/watch?v=DQW4W9WGXCQ'),
  ('handle', 'https://youtu.be/dqw4w9wgxcq', 'youtube.com/watch?v=dqw4w9wgxcq'),
  ('handle', 'https://www.youtube.com/watch?v=Ab-_9', '-'),
  ('handle', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ%21', '-'),
  ('handle', 'https://youtu.be/Ab-_9', 'youtu.be/Ab-_9'),
  ('handle', 'https://youtu.be/dQw4w9WgXcQ/extra', 'youtu.be/dQw4w9WgXcQ/extra'),
  ('handle', 'https://youtu.be/', '-'),
  ('handle', 'youtu.be', '-'),
  ('handle', 'https://www.youtube.com/@AliceCooks', 'alicecooks'),
  ('handle', 'https://www.youtube.com/channel/UCabcDEF123', 'ucabcdef123'),
  ('handle', 'https://www.youtube.com/c/AliceCooks', 'alicecooks'),
  ('handle', 'https://www.instagram.com/Palm.Court/', 'palm.court'),
  ('handle', 'https://www.tiktok.com/@Some_Creator', 'some_creator'),
  ('handle', 'HTTPS://X.COM/Mingla', 'mingla'),
  ('handle', 'https://www.facebook.com/profile.php?id=ABC123', 'abc123'),
  ('handle', 'https://bit.ly/3AbC', 'bit.ly/3AbC'),
  ('handle', '@Palm.Court', 'palm.court'),
  ('email', 'Alice@Example.COM', 'alice@example.com');

create temp table t3802c_phones (a text, b text, want text) on commit drop;
insert into t3802c_phones values
  ('+54 9 11 1234 5678', '+54 11 1234 5678', 'exact'),
  ('+52 1 55 1234 5678', '+52 55 1234 5678', 'exact'),
  ('https://wa.me/5491112345678', '+54 11 1234 5678', 'exact'),
  ('0054 9 11 1234 5678', '+54 11 1234 5678', 'exact'),
  ('5491112345678', '+54 11 1234 5678', 'national_number'),
  ('5215512345678', '+52 55 1234 5678', 'national_number'),
  ('011 1234 5678', '+54 9 11 1234 5678', 'national_number'),
  ('55 1234 5678', '+52 1 55 1234 5678', 'national_number'),
  ('+54 9 11 1234 5678', '+52 1 11 1234 5678', 'none'),
  ('+54 9 11 1234 567', '+54 11 1234 567', 'none'),
  ('+55 9 11 1234 5678', '+55 11 1234 5678', 'none'),
  ('+52 1 55 1234 5678', '+52 1 55 1234 5679', 'none'),
  ('+54 9 11 1234 5678', '+54 9 11 1234 5679', 'none');

do $n2$
declare
  v text;
  v_c uuid;
  p record;
  v_bad text := '';
begin
  perform pg_temp.t3802c_check('N-2', 'every row of the normal-form table gives its documented key',
    (select coalesce(string_agg(kind || ':' || value || '=>' || coalesce(public.crm_ident_key(kind, value), '-'), '; '), 'all')
       from t3802c_forms where coalesce(public.crm_ident_key(kind, value), '-') is distinct from want), 'all');
  perform pg_temp.t3802c_check('N-2', 'the table holds at least 45 rows, of both changed kinds',
    (select (count(*) >= 45 and count(*) filter (where kind = 'phone') >= 20 and count(*) filter (where kind = 'handle') >= 20)::text
       from t3802c_forms), 'true');
  perform pg_temp.t3802c_check('N-2', 'a video written either way is one key; ids differing only in case are two',
    (public.crm_ident_key('handle', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') = public.crm_ident_key('handle', 'https://youtu.be/dQw4w9WgXcQ'))::text
      || '/' || (public.crm_ident_key('handle', 'https://youtu.be/dQw4w9WgXcQ') <> public.crm_ident_key('handle', 'https://youtu.be/dqw4w9wgxcq'))::text
      || '/' || (public.crm_ident_key('handle', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') <> public.crm_ident_key('handle', 'https://www.youtube.com/watch?v=DQW4W9WGXCQ'))::text,
    'true/true/true');
  perform pg_temp.t3802c_check('N-2', 'every other known profile handle is still the same whatever its case',
    (public.crm_ident_key('handle', 'https://www.YouTube.com/@AliceCooks') = public.crm_ident_key('handle', 'youtube.com/@alicecooks'))::text
      || '/' || (public.crm_ident_key('handle', 'https://Instagram.com/Palm.Court') = public.crm_ident_key('handle', 'instagram.com/palm.court'))::text
      || '/' || (public.crm_ident_key('handle', 'https://www.youtube.com/channel/UCabc') = public.crm_ident_key('handle', 'https://www.youtube.com/channel/ucABC'))::text,
    'true/true/true');

  for p in select * from t3802c_phones loop
    insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
    values ('creators', 'N2 phone pair ' || md5(p.a || p.b), 'identified', 'issue3802c-fixture', 'issue3802c-fixture')
    returning id into v_c;
    insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by)
    values (v_c, 'phone', p.a, public.crm_ident_key('phone', p.a), 'issue3802c-fixture');
    v := coalesce((select h.rule from public.crm_identifier_hits('creators',
           public.crm_clean_identifiers(jsonb_build_array(jsonb_build_object('kind', 'phone', 'value', p.b))), null) h
          where h.record_id = v_c), 'none');
    if v is distinct from p.want then
      v_bad := v_bad || format('[%s ~ %s: got %s want %s] ', p.a, p.b, v, p.want);
    end if;
    delete from public.crm_record_identifiers where record_id = v_c;
    insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by)
    values (v_c, 'phone', p.b, public.crm_ident_key('phone', p.b), 'issue3802c-fixture');
    v := coalesce((select h.rule from public.crm_identifier_hits('creators',
           public.crm_clean_identifiers(jsonb_build_array(jsonb_build_object('kind', 'phone', 'value', p.a))), null) h
          where h.record_id = v_c), 'none');
    if v is distinct from p.want then
      v_bad := v_bad || format('[%s ~ %s: got %s want %s] ', p.b, p.a, v, p.want);
    end if;
    delete from public.crm_records where id = v_c;
  end loop;
  perform pg_temp.t3802c_check('N-3', 'every pair of phone numbers matches as documented, both ways round',
    (select count(*)::text from t3802c_phones) || ' ' || v_bad, '13 ');
end;
$n2$;

-- ---------------------------------------------------------------------------
-- N-4 -- duplicate detection by a video link.
-- ---------------------------------------------------------------------------
do $n4$
declare
  v_c uuid;
begin
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by)
  values ('creators', 'N4 Video Creator', 'identified', 'issue3802c-fixture', 'issue3802c-fixture')
  returning id into v_c;
  insert into public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by)
  select v_c, e->>'kind', e->>'platform', e->>'value', e->>'value_key', 'issue3802c-fixture'
  from jsonb_array_elements(public.crm_clean_identifiers(
    '[{"kind": "handle", "value": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}, {"kind": "phone", "value": "+54 9 11 4321 8765"}]')) e;
  perform pg_temp.t3802c_check('N-4', 'the short link of a stored video finds it, exactly',
    (select string_agg(h.rule, ',') from public.crm_identifier_hits('creators',
       public.crm_clean_identifiers('[{"kind": "handle", "value": "https://youtu.be/dQw4w9WgXcQ?si=x"}]'), null) h where h.record_id = v_c), 'exact');
  perform pg_temp.t3802c_check('N-4', 'a video id that differs only in case is another video',
    (select count(*)::text from public.crm_identifier_hits('creators',
       public.crm_clean_identifiers('[{"kind": "handle", "value": "https://youtu.be/dqw4w9wgxcq"}]'), null) h where h.record_id = v_c), '0');
  perform pg_temp.t3802c_check('N-4', 'the number written without the mobile 9 finds it, exactly',
    (select string_agg(h.rule, ',') from public.crm_identifier_hits('creators',
       public.crm_clean_identifiers('[{"kind": "phone", "value": "+54 11 4321 8765"}]'), null) h where h.record_id = v_c), 'exact');
  perform pg_temp.t3802c_check('N-4', 'the cleaner treats both ways of writing one video, and of one number, as one detail',
    (select jsonb_agg(e->>'value_key' order by e->>'value_key')::text from jsonb_array_elements(public.crm_clean_identifiers(
       '[{"kind": "handle", "value": "https://youtu.be/dQw4w9WgXcQ"}, {"kind": "handle", "value": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
         {"kind": "phone", "value": "+52 1 55 1234 5678"}, {"kind": "phone", "value": "+52 55 1234 5678"}]')) e),
    '["+525512345678", "youtube.com/watch?v=dQw4w9WgXcQ"]');
  delete from public.crm_records where id = v_c;
end;
$n4$;

-- ---------------------------------------------------------------------------
-- N-5 -- the stored forms. The earlier function is put back for the length
-- of this block, rows are written as it wrote them, and then the follow-up
-- file runs as it will in production.
-- ---------------------------------------------------------------------------
do $n5setup$
begin
  execute (select sql from t3802c_src where k = 'old_fn');
end;
$n5setup$;

create temp table t3802c_before on commit drop as select 1 as n where false;
do $n5rows$
declare
  v_a uuid;
  v_b uuid;
  v_c uuid;
  v_d uuid;
begin
  if public.crm_ident_key('handle', 'https://www.youtube.com/watch?v=AbCdEf1') <> 'youtube.com/watch?v=abcdef1' then
    raise exception 'N-5 setup: the earlier function was not put back';
  end if;
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by) values
    ('creators', 'N5 A swap', 'identified', 'issue3802c-fixture', 'issue3802c-fixture') returning id into v_a;
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by) values
    ('creators', 'N5 B one video twice', 'identified', 'issue3802c-fixture', 'issue3802c-fixture') returning id into v_b;
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by) values
    ('hosts', 'N5 C one number twice', 'prospect', 'issue3802c-fixture', 'issue3802c-fixture') returning id into v_c;
  insert into public.crm_records (pipeline, name, stage, created_by, updated_by) values
    ('hosts', 'N5 D untouched', 'prospect', 'issue3802c-fixture', 'issue3802c-fixture') returning id into v_d;
  -- id, record, kind, value, author, time: written with the earlier key.
  insert into public.crm_record_identifiers (id, record_id, kind, platform, value, value_key, created_by, created_at)
  select x.id::uuid, x.rec, x.kind, x.platform, x.value, public.crm_ident_key(x.kind, x.value), x.who, x.at::timestamptz
  from (values
    -- A: the long link of one video already holds the key the short link of another becomes.
    ('3802c000-0000-4000-a000-000000000001', v_a, 'handle', 'youtube', 'https://www.youtube.com/watch?v=ABCdef1', 'n5-a1', '2026-01-01 10:00+00'),
    ('3802c000-0000-4000-a000-000000000002', v_a, 'handle', null,      'https://youtu.be/abcdef1',               'n5-a2', '2026-01-02 10:00+00'),
    -- B: one video written two ways, both re-keyed to one form; the earlier is kept.
    ('3802c000-0000-4000-a000-000000000003', v_b, 'handle', null,      'https://youtu.be/XyZ12345',              'n5-b1', '2026-01-03 10:00+00'),
    ('3802c000-0000-4000-a000-000000000004', v_b, 'handle', 'youtube', 'https://www.youtube.com/watch?v=XyZ12345', 'n5-b2', '2026-01-04 10:00+00'),
    -- C: one number written two ways; the row that already holds the form is kept, though it is newer.
    ('3802c000-0000-4000-a000-000000000005', v_c, 'phone',  null,      '+54 9 11 1234 5678',                     'n5-c1', '2026-01-05 10:00+00'),
    ('3802c000-0000-4000-a000-000000000006', v_c, 'phone',  null,      '+54 11 1234 5678',                       'n5-c2', '2026-01-06 10:00+00'),
    ('3802c000-0000-4000-a000-000000000007', v_c, 'phone',  null,      '+52 1 55 1234 5678',                     'n5-c3', '2026-01-07 10:00+00'),
    -- D: nothing here changes.
    ('3802c000-0000-4000-a000-000000000008', v_d, 'handle', 'instagram', 'https://www.instagram.com/Palm.Court/', 'n5-d1', '2026-01-08 10:00+00'),
    ('3802c000-0000-4000-a000-000000000009', v_d, 'phone',  null,      '+54 9 11 1234 567',                      'n5-d2', '2026-01-09 10:00+00'),
    ('3802c000-0000-4000-a000-00000000000a', v_d, 'email',  null,      'N5@Example.com',                         'n5-d3', '2026-01-10 10:00+00')
  ) as x(id, rec, kind, platform, value, who, at);
end;
$n5rows$;

drop table t3802c_before;
create temp table t3802c_before on commit drop as
  select i.id, i.record_id, i.kind, i.value, i.value_key, i.national, i.tail9, i.created_by, i.created_at
  from public.crm_record_identifiers i where i.created_by like 'n5-%';

-- The follow-up file, without its own BEGIN and COMMIT.
:t3802c_body

do $n5$
begin
  perform pg_temp.t3802c_check('N-5', 'the rows written by the earlier function had its keys',
    (select string_agg(value_key, ' ' order by created_by) from t3802c_before),
    'youtube.com/watch?v=abcdef1 youtu.be/abcdef1 youtu.be/XyZ12345 youtube.com/watch?v=xyz12345 +5491112345678 +541112345678 +5215512345678 palm.court +549111234567 n5@example.com');
  perform pg_temp.t3802c_check('N-5', 'after the file: each row and its key, in the order written',
    (select string_agg(i.created_by || '=' || i.value_key, ' ' order by i.created_by)
       from public.crm_record_identifiers i where i.created_by like 'n5-%'),
    'n5-a1=youtube.com/watch?v=ABCdef1 n5-a2=youtube.com/watch?v=abcdef1 n5-b1=youtube.com/watch?v=XyZ12345 n5-c2=+541112345678 n5-c3=+525512345678 n5-d1=palm.court n5-d2=+549111234567 n5-d3=n5@example.com');
  perform pg_temp.t3802c_check('N-5', 'a re-keyed row keeps its id, record, value, author and time',
    (select count(*)::text from public.crm_record_identifiers i join t3802c_before b on b.id = i.id
      where i.record_id = b.record_id and i.value = b.value and i.created_by = b.created_by and i.created_at = b.created_at
        and i.kind = b.kind), '8');
  perform pg_temp.t3802c_check('N-5', 'a row whose key did not change is the same row, untouched',
    (select string_agg(i.created_by, ',' order by i.created_by) from public.crm_record_identifiers i join t3802c_before b on b.id = i.id
      where i.value_key = b.value_key and i.national is not distinct from b.national and i.tail9 is not distinct from b.tail9), 'n5-c2,n5-d1,n5-d2,n5-d3');
  perform pg_temp.t3802c_check('N-5', 'national and tail9 follow the new key',
    (select string_agg(i.created_by || '=' || coalesce(i.national, '-') || '/' || coalesce(i.tail9, '-'), ' ' order by i.created_by)
       from public.crm_record_identifiers i where i.created_by in ('n5-c2', 'n5-c3')),
    'n5-c2=1112345678/112345678 n5-c3=5512345678/512345678');
  perform pg_temp.t3802c_check('N-5', 'every stored row now holds the form the function gives',
    (select count(*)::text from public.crm_record_identifiers i where i.value_key is distinct from public.crm_ident_key(i.kind, i.value)), '0');
end;
$n5$;

-- ---------------------------------------------------------------------------
-- N-6 -- the self-check, as shipped and against mistakes.
-- ---------------------------------------------------------------------------
create function pg_temp.t3802c_try_check() returns text
language plpgsql as $fn$
begin
  execute (select sql from t3802c_src where k = 'check');
  return 'passed';
exception when others then
  return sqlerrm;
end;
$fn$;

do $n6$
declare
  v_new text;
  v text;
begin
  perform pg_temp.t3802c_check('N-6', 'the self-check passes as shipped', pg_temp.t3802c_try_check(), 'passed');
  v_new := pg_get_functiondef('public.crm_ident_key(text,text)'::regprocedure);

  -- The earlier function: the documented forms are not given.
  begin
    execute (select sql from t3802c_src where k = 'old_fn');
    v := pg_temp.t3802c_try_check();
    raise exception 'n6-undo' using errcode = 'P3802';
  exception when sqlstate 'P3802' then null;
  end;
  perform pg_temp.t3802c_check('N-6', 'it objects to the earlier normal form', split_part(v, ' (', 1),
    'issue 3802 normal form follow-up self-check: crm_ident_key() does not give the normal form it is documented to give');

  -- A video id lower-cased again.
  begin
    execute replace(v_new, 'c_video  constant text := ''[A-Za-z0-9_-]{6,20}'';', 'c_video  constant text := ''[a-z0-9_-]{6,20}'';');
    v := pg_temp.t3802c_try_check();
    raise exception 'n6-undo' using errcode = 'P3802';
  exception when sqlstate 'P3802' then null;
  end;
  perform pg_temp.t3802c_check('N-6', 'it objects to a video id that loses its case', split_part(v, ' (', 1),
    'issue 3802 normal form follow-up self-check: crm_ident_key() does not give the normal form it is documented to give');

  -- The mobile digit dropped whatever follows it.
  begin
    execute replace(v_new, '^[+]549[0-9]{10}$', '^[+]549[0-9]{6,}$');
    v := pg_temp.t3802c_try_check();
    raise exception 'n6-undo' using errcode = 'P3802';
  exception when sqlstate 'P3802' then null;
  end;
  perform pg_temp.t3802c_check('N-6', 'it objects to a mobile digit dropped from a number that is too short', split_part(v, ' (', 1),
    'issue 3802 normal form follow-up self-check: crm_ident_key() does not give the normal form it is documented to give');

  -- A grant to the signed-in role.
  begin
    grant execute on function public.crm_ident_key(text, text) to authenticated;
    v := pg_temp.t3802c_try_check();
    raise exception 'n6-undo' using errcode = 'P3802';
  exception when sqlstate 'P3802' then null;
  end;
  perform pg_temp.t3802c_check('N-6', 'it objects to a grant to the signed-in role', v,
    'issue 3802 normal form follow-up self-check: crm_ident_key() grants changed');

  -- Another attribute.
  begin
    alter function public.crm_ident_key(text, text) stable;
    v := pg_temp.t3802c_try_check();
    raise exception 'n6-undo' using errcode = 'P3802';
  exception when sqlstate 'P3802' then null;
  end;
  perform pg_temp.t3802c_check('N-6', 'it objects to a changed attribute', v,
    'issue 3802 normal form follow-up self-check: crm_ident_key() lost its signature or attributes');

  -- A stored row left with a key that is not its normal form.
  begin
    alter table public.crm_record_identifiers drop constraint crm_record_identifiers_key_check;
    update public.crm_record_identifiers set value_key = 'youtube.com/watch?v=abcdef2' where created_by = 'n5-a2';
    v := pg_temp.t3802c_try_check();
    raise exception 'n6-undo' using errcode = 'P3802';
  exception when sqlstate 'P3802' then null;
  end;
  perform pg_temp.t3802c_check('N-6', 'it objects to a stored row that does not hold its normal form', v,
    'issue 3802 normal form follow-up self-check: 1 stored contact detail(s) do not hold their normal form');

  -- A re-keyed row that went missing.
  begin
    delete from public.crm_record_identifiers where created_by = 'n5-b1';
    v := pg_temp.t3802c_try_check();
    raise exception 'n6-undo' using errcode = 'P3802';
  exception when sqlstate 'P3802' then null;
  end;
  perform pg_temp.t3802c_check('N-6', 'it objects to a contact detail lost while re-keying', v,
    'issue 3802 normal form follow-up self-check: 2 contact detail(s) were lost while re-keying');

  perform pg_temp.t3802c_check('N-6', 'every mistake was undone: it passes again', pg_temp.t3802c_try_check(), 'passed');
end;
$n6$;

-- ---------------------------------------------------------------------------
-- Verdict.
-- ---------------------------------------------------------------------------
do $verdict$
declare
  v_total int;
  v_failed int;
  r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from t3802c_results;
  for r in select * from t3802c_results where not ok order by seq loop
    raise warning 'ISSUE-3802 NORMAL FORM FAILED % | % | %', r.test, r.label, r.detail;
  end loop;
  if v_failed > 0 or v_total < 30 then
    raise exception 'ISSUE-3802 NORMAL FORM FAIL: % of % checks failed (at least 30 must run)', v_failed, v_total;
  end if;
  raise notice 'ISSUE-3802 NORMAL FORM PASS: % checks across N-1..N-6, 0 failed', v_total;
end;
$verdict$;

rollback;

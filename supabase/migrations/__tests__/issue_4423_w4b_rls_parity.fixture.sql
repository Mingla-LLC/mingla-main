-- Issue #4423 Wave 4b -- shared harness for the four RLS batch suites
-- (issue_4423_w4b_rls_batch{1,2,3,4}.implementor.pg17.test.sql). Included with
-- \ir inside the caller's transaction; it creates only pg_temp objects.
--
-- MECHANICAL  w4b_expected (filled by the caller from the generator's
--             batchN.expected.sql) holds, for every rewritten policy, its
--             command, mode, roles and its original USING / WITH CHECK text
--             as production printed it. After the migration each policy must print the
--             text once the "( SELECT auth.x() AS x)" wrappers are removed,
--             and no bare per-row auth.*() / current_setting() call may remain.
--
-- PARITY      the batch's tables are seeded generically (every uuid column
--             draws from one pool, so owner, other user and shared entity ids
--             line up across tables); then, for anon, an owner, another user
--             and service_role, it records which rows SELECT returns and what
--             UPDATE, DELETE and INSERT do. The policies are then put back to
--             their original form inside the same transaction and
--             everything is recorded again. Both records must be identical.
--             "Original" is the pinned production text, not the current text,
--             so a rewrite that changed meaning shows up here as well.

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 900), '<null>'), coalesce(left(p_want, 900), '<null>')));
$fn$;

create temp table w4b_expected (
  tablename text, policyname text, cmd text, permissive text, roles text, qual text, with_check text
) on commit drop;

create temp table w4b_snap (pass text, ident text, tbl text, kind text, outcome text) on commit drop;

-- The exact inverse of the generator's wrap(): strip "( SELECT auth.x() AS x)"
-- and "( SELECT current_setting(...) AS current_setting)".
create function pg_temp.w4b_unwrap(p text) returns text language sql immutable as $fn$
  select regexp_replace(
           regexp_replace(p, '\( SELECT (auth\.(uid|jwt|role|email)\(\)) AS (uid|jwt|role|email)\)', '\1', 'g'),
           '\( SELECT (current_setting\([^()]*\)) AS current_setting\)', '\1', 'g');
$fn$;

-- true when a per-row call is left outside a sub-select
create function pg_temp.w4b_bare(p text) returns boolean language sql immutable as $fn$
  select coalesce(
           regexp_replace(
             regexp_replace(p, '\( SELECT auth\.(uid|jwt|role|email)\(\) AS (uid|jwt|role|email)\)', '', 'g'),
             '\( SELECT current_setting\([^()]*\) AS current_setting\)', '', 'g')
           ~ '(auth\.(uid|jwt|role|email)\(\)|current_setting\()', false);
$fn$;

create function pg_temp.w4b_mechanical(p_batch text, p_want integer) returns void language plpgsql as $fn$
declare v_rows integer; v_missing text; v_meta text; v_expr text; v_bare text;
begin
  select count(*) into v_rows from w4b_expected;
  perform pg_temp.chk(p_batch || ' MECH', 'the suite pins every policy the migration rewrites', v_rows::text, p_want::text);

  select coalesce(string_agg(e.tablename || '.' || e.policyname, ', ' order by 1), 'none') into v_missing
    from w4b_expected e
   where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = e.tablename and p.policyname = e.policyname);
  perform pg_temp.chk(p_batch || ' MECH', 'every rewritten policy still exists', v_missing, 'none');

  select coalesce(string_agg(e.tablename || '.' || e.policyname, ', ' order by 1), 'none') into v_meta
    from w4b_expected e join pg_policies p on p.schemaname = 'public' and p.tablename = e.tablename and p.policyname = e.policyname
   where p.cmd <> e.cmd or p.permissive <> e.permissive or array_to_string(p.roles, ',') <> e.roles;
  perform pg_temp.chk(p_batch || ' MECH', 'same command, permissive/restrictive mode and roles', v_meta, 'none');

  select coalesce(string_agg(e.tablename || '.' || e.policyname, ', ' order by 1), 'none') into v_expr
    from w4b_expected e join pg_policies p on p.schemaname = 'public' and p.tablename = e.tablename and p.policyname = e.policyname
   where pg_temp.w4b_unwrap(p.qual) is distinct from pg_temp.w4b_unwrap(e.qual)
      or pg_temp.w4b_unwrap(p.with_check) is distinct from pg_temp.w4b_unwrap(e.with_check);
  perform pg_temp.chk(p_batch || ' MECH', 'USING and WITH CHECK equal the originals except for the sub-select wrappers', v_expr, 'none');

  select coalesce(string_agg(e.tablename || '.' || e.policyname, ', ' order by 1), 'none') into v_bare
    from w4b_expected e join pg_policies p on p.schemaname = 'public' and p.tablename = e.tablename and p.policyname = e.policyname
   where pg_temp.w4b_bare(p.qual) or pg_temp.w4b_bare(p.with_check);
  perform pg_temp.chk(p_batch || ' MECH', 'no per-row auth.*() or current_setting() call is left', v_bare, 'none');
end;
$fn$;

-- deterministic pick in [0, n)
create function pg_temp.w4b_pick(p_key text, p_n integer) returns integer language sql immutable as $fn$
  select (abs(hashtext(p_key)) % greatest(p_n, 1));
$fn$;

-- a literal for one column of one generated row, or null when the type is unknown
create function pg_temp.w4b_value(p_tbl text, p_col text, p_type oid, p_row integer, p_tag text) returns text
language plpgsql stable as $fn$
declare
  v_uuids text[] := array['00000000-0000-4000-8000-000000004423', '00000000-0000-4000-8000-000000004424',
                          '00000000-0000-4000-8000-0000000044e1', '00000000-0000-4000-8000-0000000044e2',
                          '00000000-0000-4000-8000-0000000044e3'];
  v_texts text[] := array['w4b', 'active', 'owner4423@example.com', 'public', 'published', 'accepted', 'member'];
  v_key text := p_tbl || '.' || p_col || '.' || p_row || '.' || p_tag;
  v_base oid := p_type;
  v_labels text[];
begin
  select case when t.typtype = 'd' then t.typbasetype else t.oid end into v_base from pg_type t where t.oid = p_type;
  if exists (select 1 from pg_type where oid = v_base and typtype = 'e') then
    select array_agg(enumlabel order by enumsortorder) into v_labels from pg_enum where enumtypid = v_base;
    return quote_literal(v_labels[1 + pg_temp.w4b_pick(v_key, cardinality(v_labels))]) || '::' || v_base::regtype::text;
  end if;
  return case v_base
    when 'uuid'::regtype then
      case when p_col = 'id' and p_tag like 'ins%' then quote_literal(gen_random_uuid()::text) || '::uuid'
           when p_col = 'id' and p_row > 3 then quote_literal(gen_random_uuid()::text) || '::uuid'
           when p_col = 'id' then quote_literal(v_uuids[2 + p_row]) || '::uuid'
           else quote_literal(v_uuids[1 + pg_temp.w4b_pick(v_key, 5)]) || '::uuid' end
    when 'text'::regtype then quote_literal(v_texts[1 + pg_temp.w4b_pick(v_key, 7)])
    when 'varchar'::regtype then quote_literal(v_texts[1 + pg_temp.w4b_pick(v_key, 7)])
    when 'bpchar'::regtype then quote_literal('w')
    when 'bool'::regtype then (pg_temp.w4b_pick(v_key, 2) = 0)::text
    when 'int2'::regtype then (1 + pg_temp.w4b_pick(v_key, 5))::text
    when 'int4'::regtype then (1 + pg_temp.w4b_pick(v_key, 5))::text
    when 'int8'::regtype then (1 + pg_temp.w4b_pick(v_key, 5))::text
    when 'numeric'::regtype then (1 + pg_temp.w4b_pick(v_key, 5))::text
    when 'float8'::regtype then '1.5'
    when 'float4'::regtype then '1.5'
    when 'timestamptz'::regtype then format('(now() + interval ''%s days'')', pg_temp.w4b_pick(v_key, 9) - 4)
    when 'timestamp'::regtype then format('(now()::timestamp + interval ''%s days'')', pg_temp.w4b_pick(v_key, 9) - 4)
    when 'date'::regtype then format('(current_date + %s)', pg_temp.w4b_pick(v_key, 9) - 4)
    when 'jsonb'::regtype then quote_literal('{}') || '::jsonb'
    when 'json'::regtype then quote_literal('{}') || '::json'
    when 'inet'::regtype then quote_literal('127.0.0.1') || '::inet'
    when 'interval'::regtype then quote_literal('1 hour') || '::interval'
    when 'time'::regtype then quote_literal('12:00') || '::time'
    else case when exists (select 1 from pg_type where oid = v_base and typcategory = 'A')
                then quote_literal('{}') || '::' || v_base::regtype::text
              when exists (select 1 from pg_type where oid = v_base and typcategory = 'S')
                then quote_literal(v_texts[1 + pg_temp.w4b_pick(v_key, 7)]) || '::' || v_base::regtype::text end
  end;
end;
$fn$;

-- literals a single-column CHECK on this column allows ('a'::text, 'b'::text ...)
create function pg_temp.w4b_check_literals(p_tbl text, p_col text) returns text[] language sql stable as $fn$
  select array_agg(distinct m[1])
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), $re$'((?:[^']|'')*)'::(?:text|character varying)$re$, 'g') m
   where c.conrelid = ('public.' || quote_ident(p_tbl))::regclass and c.contype = 'c'
     and cardinality(c.conkey) = 1 and a.attname = p_col;
$fn$;

-- INSERT for one generated row. p_mode 1: the columns that must be filled
-- (NOT NULL, no default), every uuid column, every enum column and every
-- column with a CHECK list; 2: only the must-fill and uuid columns; 3: every
-- column this harness can fill.
create function pg_temp.w4b_insert_sql(p_tbl text, p_row integer, p_tag text, p_mode integer) returns text
language plpgsql stable as $fn$
declare r record; v_cols text[] := '{}'; v_vals text[] := '{}'; v_v text; v_lits text[]; v_must boolean;
begin
  for r in
    select a.attname, a.atttypid, a.attnotnull, (d.adbin is not null) as has_default,
           (select t.typtype = 'e' from pg_type t where t.oid = a.atttypid) as is_enum
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = ('public.' || quote_ident(p_tbl))::regclass and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attidentity <> 'a'
     order by a.attnum
  loop
    v_must := r.attnotnull and not r.has_default;
    v_lits := pg_temp.w4b_check_literals(p_tbl, r.attname);
    if not (v_must or r.atttypid = 'uuid'::regtype or p_mode = 3
            or (p_mode = 1 and (r.is_enum or v_lits is not null))) then
      continue;
    end if;
    if v_lits is not null then
      v_v := quote_literal(v_lits[1 + pg_temp.w4b_pick(p_tbl || '.' || r.attname || '.' || p_row || '.' || p_tag, cardinality(v_lits))])
             || '::' || format_type(r.atttypid, null);
    else
      v_v := pg_temp.w4b_value(p_tbl, r.attname, r.atttypid, p_row, p_tag);
    end if;
    if v_v is null then
      if v_must then return null; end if;
      continue;
    end if;
    v_cols := v_cols || quote_ident(r.attname);
    v_vals := v_vals || v_v;
  end loop;
  if cardinality(v_cols) = 0 then return format('insert into public.%I default values', p_tbl); end if;
  return format('insert into public.%I (%s) values (%s)', p_tbl, array_to_string(v_cols, ', '), array_to_string(v_vals, ', '));
end;
$fn$;

-- seed (as the suite owner, triggers and foreign keys off): up to 12 rows per
-- table, each tried in modes 1, 2 and 3 until one is accepted
create function pg_temp.w4b_seed(p_tables text[]) returns integer language plpgsql as $fn$
declare t text; i integer; m integer; v_sql text; v_n integer := 0;
begin
  set local session_replication_role = replica;
  foreach t in array p_tables loop
    for i in 1..12 loop
      foreach m in array array[1, 2, 3] loop
        begin
          v_sql := pg_temp.w4b_insert_sql(t, i, 'seed', m);
          if v_sql is not null then
            execute v_sql;
            v_n := v_n + 1;
            exit;
          end if;
        exception when others then
          null; -- this mode is refused by the table; try the next one
        end;
      end loop;
    end loop;
  end loop;
  return v_n;
end;
$fn$;

create function pg_temp.w4b_as(p_ident text) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', case p_ident when 'owner' then '00000000-0000-4000-8000-000000004423'
                                                         when 'other' then '00000000-0000-4000-8000-000000004424' else '' end, true);
  perform set_config('request.jwt.claim.role', case p_ident when 'anon' then 'anon' when 'service' then 'service_role' else 'authenticated' end, true);
  perform set_config('request.jwt.claim.email', case p_ident when 'owner' then 'owner4423@example.com'
                                                           when 'other' then 'other4423@example.com' else '' end, true);
  perform set_config('request.jwt.claims', json_build_object(
      'sub', nullif(current_setting('request.jwt.claim.sub'), ''),
      'role', current_setting('request.jwt.claim.role'),
      'email', nullif(current_setting('request.jwt.claim.email'), ''))::text, true);
  execute format('set local role %I', case p_ident when 'anon' then 'anon' when 'service' then 'service_role' else 'authenticated' end);
end;
$fn$;

-- record, per identity and table: visible rows, UPDATE, DELETE and 3 INSERTs
create function pg_temp.w4b_snapshot(p_pass text, p_tables text[]) returns void language plpgsql as $fn$
declare
  v_ident text; t text; v_out text[]; v_res text; v_n bigint; v_col text; v_sql text; k integer;
begin
  set local session_replication_role = replica;
  foreach v_ident in array array['anon', 'owner', 'other', 'service'] loop
    v_out := '{}';
    perform pg_temp.w4b_as(v_ident);
    foreach t in array p_tables loop
      begin
        execute format('select count(*)::text || '':'' || coalesce(md5(string_agg(ctid::text, '','' order by ctid)), '''') from public.%I', t) into v_res;
      exception when others then v_res := 'err:' || sqlstate;
      end;
      v_out := v_out || array[t, 'select', v_res];

      select quote_ident(a.attname) into v_col from pg_attribute a
       where a.attrelid = ('public.' || quote_ident(t))::regclass and a.attnum > 0 and not a.attisdropped
         and a.attgenerated = '' and a.attidentity = '' order by a.attnum limit 1;
      begin
        execute format('update public.%I set %s = %s', t, v_col, v_col);
        get diagnostics v_n = row_count;
        raise exception using errcode = 'P4423', message = v_n::text;
      exception when sqlstate 'P4423' then v_res := 'rows:' || sqlerrm;
                when others then v_res := 'err:' || sqlstate;
      end;
      v_out := v_out || array[t, 'update', v_res];

      begin
        execute format('delete from public.%I', t);
        get diagnostics v_n = row_count;
        raise exception using errcode = 'P4423', message = v_n::text;
      exception when sqlstate 'P4423' then v_res := 'rows:' || sqlerrm;
                when others then v_res := 'err:' || sqlstate;
      end;
      v_out := v_out || array[t, 'delete', v_res];

      for k in 1..3 loop
        begin
          v_sql := pg_temp.w4b_insert_sql(t, 20 + k, 'ins' || v_ident, case k when 2 then 2 else 1 end);
          if v_sql is null then v_res := 'nosql';
          else
            -- the generated id is random, so drop it from the comparison key
            execute v_sql;
            raise exception using errcode = 'P4423', message = 'ok';
          end if;
        exception when sqlstate 'P4423' then v_res := 'ok';
                  when others then v_res := 'err:' || sqlstate;
        end;
        v_out := v_out || array[t, 'insert' || k, v_res];
      end loop;
    end loop;
    reset role;
    insert into w4b_snap (pass, ident, tbl, kind, outcome)
    select p_pass, v_ident, v_out[i], v_out[i + 1], v_out[i + 2] from generate_series(1, cardinality(v_out), 3) i;
  end loop;
end;
$fn$;

-- put the batch's policies back to the pinned original text inside the
-- suite's transaction
create function pg_temp.w4b_revert() returns integer language plpgsql as $fn$
declare r record; v_n integer := 0;
begin
  for r in select e.tablename, e.policyname, e.qual, e.with_check from w4b_expected e loop
    execute format('alter policy %I on public.%I', r.policyname, r.tablename)
         || case when r.qual is not null then ' using (' || r.qual || ')' else '' end
         || case when r.with_check is not null then ' with check (' || r.with_check || ')' else '' end;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

create function pg_temp.w4b_parity(p_batch text) returns void language plpgsql as $fn$
declare
  v_tables text[]; v_seeded integer; v_reverted integer; v_cmp integer; v_diff text; v_bare integer;
  v_owner_rows integer; v_split integer; v_writes integer;
begin
  select array_agg(distinct tablename order by tablename) into v_tables from w4b_expected;
  v_seeded := pg_temp.w4b_seed(v_tables);
  perform pg_temp.w4b_snapshot('after', v_tables);
  v_reverted := pg_temp.w4b_revert();
  select count(*) into v_bare from pg_policies p join w4b_expected e on e.tablename = p.tablename and e.policyname = p.policyname
   where p.schemaname = 'public' and (pg_temp.w4b_bare(p.qual) or pg_temp.w4b_bare(p.with_check));
  perform pg_temp.chk(p_batch || ' PARITY', 'the original policies were restored for the comparison',
    (v_reverted = (select count(*) from w4b_expected) and v_bare = v_reverted)::text, 'true');
  perform pg_temp.w4b_snapshot('before', v_tables);

  select count(*) into v_cmp from w4b_snap a join w4b_snap b
    on b.pass = 'before' and a.pass = 'after' and a.ident = b.ident and a.tbl = b.tbl and a.kind = b.kind;
  perform pg_temp.chk(p_batch || ' PARITY', 'every table x identity x action was recorded in both passes',
    (v_cmp = cardinality(v_tables) * 4 * 6 and v_cmp = (select count(*) from w4b_snap where pass = 'before'))::text, 'true');

  select coalesce(string_agg(format('%s/%s/%s: after %s, before %s', a.ident, a.tbl, a.kind, a.outcome, b.outcome), '; '), 'none')
    into v_diff
    from w4b_snap a join w4b_snap b on b.pass = 'before' and a.pass = 'after' and a.ident = b.ident and a.tbl = b.tbl and a.kind = b.kind
   where a.outcome is distinct from b.outcome;
  perform pg_temp.chk(p_batch || ' PARITY', 'anon, owner, other user and service_role see the same rows and get the same UPDATE, DELETE and INSERT results before and after', v_diff, 'none');

  -- the comparison is not vacuous: the owner sees seeded rows somewhere, the
  -- owner and the other user are told apart somewhere, and some writes succeed
  select count(*) into v_owner_rows from w4b_snap where pass = 'after' and ident = 'owner' and kind = 'select' and outcome !~ '^(0:|err)';
  select count(*) into v_split from w4b_snap a join w4b_snap b on a.pass = 'after' and b.pass = 'after' and a.tbl = b.tbl and a.kind = b.kind
   where a.ident = 'owner' and b.ident in ('other', 'anon') and a.outcome is distinct from b.outcome;
  select count(*) into v_writes from w4b_snap where pass = 'after' and ident in ('owner', 'other') and kind <> 'select' and outcome ~ '^(ok|rows:[1-9])';
  raise notice '% PARITY: % tables, % seeded rows, % comparisons; owner sees rows in % tables; % owner-vs-other/anon differences; % non-empty user writes',
    p_batch, cardinality(v_tables), v_seeded, v_cmp, v_owner_rows, v_split, v_writes;
  perform pg_temp.chk(p_batch || ' PARITY', 'the seeded data exercises the policies (owner sees rows, users are told apart, writes land)',
    (v_owner_rows > 0 and v_split > 0 and v_writes > 0)::text, 'true');
end;
$fn$;

create function pg_temp.w4b_report(p_batch text, p_min integer) returns void language plpgsql as $fn$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < p_min then raise exception '#4423 % recorded only % checks', p_batch, v_all; end if;
  if v_fail > 0 then raise exception '#4423 %: % of % checks failed', p_batch, v_fail, v_all; end if;
  raise notice '#4423 %: % of % checks passed', p_batch, v_all, v_all;
end;
$fn$;

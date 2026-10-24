-- Issue #3872 T4: independent adversarial permutation, floor and tie-break suite.
\set ON_ERROR_STOP on
begin;

create temp table i3872a_results (
  seq bigserial primary key,label text not null,ok boolean not null,detail text not null
) on commit drop;

create function pg_temp.i3872a_check(p_label text,p_ok boolean,p_detail text default '') returns void
language sql as $fn$
  insert into i3872a_results(label,ok,detail) values(p_label,coalesce(p_ok,false),p_detail)
$fn$;

create function pg_temp.i3872a_line(p_ref text,p_list integer,p_qty integer default 1,
  p_count_scale integer default 1) returns jsonb language sql immutable as $fn$
  select jsonb_build_object(
    'lineRef',p_ref,'itemKind','ticket_type',
    'itemId',('3872f000-0000-4000-8100-'||lpad((ascii(p_ref)-96)::text,12,'0'))::uuid,
    'listingId','3872f000-0000-4000-8200-000000000001','listingKind','event',
    'listUnitMinor',p_list,'qty',p_qty,'valueScale',1,'countScale',p_count_scale,
    'allowed',true,'tz','UTC')
$fn$;

create function pg_temp.i3872a_discount(p_num integer,p_kind text,p_type text,p_value integer,
  p_combines text default 'any',p_patch jsonb default '{}'::jsonb) returns jsonb
language sql immutable as $fn$
  select jsonb_build_object(
    'id',('3872f000-0000-4000-8300-'||lpad(p_num::text,12,'0'))::uuid,
    'kind',p_kind,'code',case when p_kind='code' then 'CODE'||p_num else null end,
    'name','Adversarial '||p_num,'valueType',p_type,
    'valueBps',case when p_type='percent' then p_value else null end,
    'valueMinor',case when p_type<>'percent' then p_value else null end,
    'currency',null,'scopeKind','brand','combinesWith',p_combines,
    'startsAt','2026-01-01T00:00:00Z','endsAt',null,'schedule',null,
    'minSubtotalMinor',null,'status','active','needsAttention',null,'deletedAt',null,
    'createdAt',('2026-01-01T00:00:'||lpad((p_num%60)::text,2,'0')||'Z'),
    'targets','[]'::jsonb,'remainingTotalUses',null,'remainingBuyerUses',null,
    'remainingUnits',null,'limited',false) || p_patch
$fn$;

create function pg_temp.i3872a_run(p_lines jsonb,p_autos jsonb,p_code jsonb default null,
  p_lookup text default 'none') returns jsonb language sql stable as $fn$
  select public.issue_3872_discount_apply(jsonb_build_object(
    'currency','USD','at','2026-10-22T12:30:00Z','queued',false,
    'lines',p_lines,'automatics',p_autos,'code',p_code,'codeLookup',p_lookup))
$fn$;

do $test$
declare
  lines jsonb; autos jsonb; code_def jsonb; expected jsonb; got jsonb;
  shuffled_lines jsonb; shuffled_autos jsonb; d1 jsonb; d2 jsonb;
  i integer; negatives integer;
begin
  -- Three compatible types plus a compatible code. Both input arrays are
  -- independently shuffled ten times; the entire canonical result must match.
  lines:=jsonb_build_array(
    pg_temp.i3872a_line('a',1000,2),pg_temp.i3872a_line('b',500,1),
    pg_temp.i3872a_line('c',250,4));
  autos:=jsonb_build_array(
    pg_temp.i3872a_discount(1,'automatic','percent',1000),
    pg_temp.i3872a_discount(2,'automatic','amount',75),
    pg_temp.i3872a_discount(3,'sale_price','set_price',800));
  code_def:=pg_temp.i3872a_discount(4,'code','percent',500,'any');
  expected:=pg_temp.i3872a_run(lines,autos,code_def,'found');
  for i in 1..10 loop
    select jsonb_agg(value order by md5(value::text||':line:'||i)) into shuffled_lines
    from jsonb_array_elements(lines);
    select jsonb_agg(value order by md5(value::text||':auto:'||i)) into shuffled_autos
    from jsonb_array_elements(autos);
    got:=pg_temp.i3872a_run(shuffled_lines,shuffled_autos,code_def,'found');
    perform pg_temp.i3872a_check('permutation compatible #'||i,got=expected,
      coalesce(got->>'digest','<null>')||' / '||coalesce(expected->>'digest','<null>'));
  end loop;

  -- D37 line visitation is lineRef order, not input order.
  lines:=jsonb_build_array(pg_temp.i3872a_line('b',1000,2),pg_temp.i3872a_line('a',1000,2));
  autos:=jsonb_build_array(pg_temp.i3872a_discount(5,'sale_price','percent',2500,'any',
    '{"remainingUnits":2,"limited":true}'::jsonb));
  expected:=pg_temp.i3872a_run(lines,autos);
  perform pg_temp.i3872a_check('D37 canonical winner is line a',
    (select (x->>'netUnitMinor')::integer=750 from jsonb_array_elements(expected->'lines') x where x->>'lineRef'='a'),expected::text);
  perform pg_temp.i3872a_check('D37 canonical loser is line b',
    (select (x->>'netUnitMinor')::integer=1000 from jsonb_array_elements(expected->'lines') x where x->>'lineRef'='b'),expected::text);
  for i in 1..10 loop
    select jsonb_agg(value order by md5(value::text||':limited:'||i)) into shuffled_lines
    from jsonb_array_elements(lines);
    got:=pg_temp.i3872a_run(shuffled_lines,autos);
    perform pg_temp.i3872a_check('D37 permutation #'||i,got=expected,got::text);
  end loop;

  -- Equal standalone saving: createdAt ascending is the first tie-break.
  d1:=pg_temp.i3872a_discount(10,'automatic','percent',1000,'none',
      '{"createdAt":"2026-01-01T00:00:01Z"}'::jsonb);
  d2:=pg_temp.i3872a_discount(9,'automatic','percent',1000,'none',
      '{"createdAt":"2026-01-01T00:00:02Z"}'::jsonb);
  expected:=pg_temp.i3872a_run(jsonb_build_array(pg_temp.i3872a_line('a',1000)),jsonb_build_array(d2,d1));
  perform pg_temp.i3872a_check('createdAt tie-break',expected#>>'{applied,0,discountId}'=d1->>'id',expected::text);
  for i in 1..10 loop
    select jsonb_agg(value order by md5(value::text||':created:'||i)) into shuffled_autos
    from jsonb_array_elements(jsonb_build_array(d1,d2));
    got:=pg_temp.i3872a_run(jsonb_build_array(pg_temp.i3872a_line('a',1000)),shuffled_autos);
    perform pg_temp.i3872a_check('createdAt permutation #'||i,got=expected,got::text);
  end loop;

  -- With equal saving and createdAt, UUID ascending is the second tie-break.
  d1:=pg_temp.i3872a_discount(11,'automatic','percent',1000,'none',
      '{"createdAt":"2026-01-01T00:00:01Z"}'::jsonb);
  d2:=pg_temp.i3872a_discount(12,'automatic','percent',1000,'none',
      '{"createdAt":"2026-01-01T00:00:01Z"}'::jsonb);
  expected:=pg_temp.i3872a_run(jsonb_build_array(pg_temp.i3872a_line('a',1000)),jsonb_build_array(d2,d1));
  perform pg_temp.i3872a_check('UUID tie-break',expected#>>'{applied,0,discountId}'=d1->>'id',expected::text);
  for i in 1..10 loop
    select jsonb_agg(value order by md5(value::text||':uuid:'||i)) into shuffled_autos
    from jsonb_array_elements(jsonb_build_array(d1,d2));
    got:=pg_temp.i3872a_run(jsonb_build_array(pg_temp.i3872a_line('a',1000)),shuffled_autos);
    perform pg_temp.i3872a_check('UUID permutation #'||i,got=expected,got::text);
  end loop;

  -- Hostile values still cannot produce a negative unit, line or total.
  lines:=jsonb_build_array(pg_temp.i3872a_line('a',1,9),pg_temp.i3872a_line('b',7,3));
  autos:=jsonb_build_array(
    pg_temp.i3872a_discount(20,'sale_price','set_price',0),
    pg_temp.i3872a_discount(21,'automatic','percent',10000),
    pg_temp.i3872a_discount(22,'automatic','amount',999999));
  got:=pg_temp.i3872a_run(lines,autos);
  select count(*) into negatives from jsonb_array_elements(got->'lines') x
  where (x->>'netUnitMinor')::integer<0 or (x->>'lineNetMinor')::integer<0
     or (x->>'lineDiscountMinor')::integer<0;
  perform pg_temp.i3872a_check('no negative lines',negatives=0,got::text);
  perform pg_temp.i3872a_check('no negative subtotal',(got->>'netSubtotalMinor')::integer>=0,got::text);
  perform pg_temp.i3872a_check('floor reaches zero',got->>'netSubtotalMinor'='0',got::text);
end;
$test$;

do $report$
declare failures text; checks integer;
begin
  select count(*) into checks from i3872a_results;
  select string_agg(format('%s (%s)',label,detail),E'\n' order by seq) into failures
  from i3872a_results where not ok;
  if failures is not null then raise exception E'Issue #3872 T4 failures:\n%',failures; end if;
  raise notice 'Issue #3872 T4 passed % adversarial assertions',checks;
end;
$report$;

rollback;

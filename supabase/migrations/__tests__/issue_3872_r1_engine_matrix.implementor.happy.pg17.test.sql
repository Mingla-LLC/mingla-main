-- Issue #3872 T3: normative SQL discount-engine matrix (PostgreSQL 17).
-- More than sixty recorded assertions cover EN-2 through EN-12 and D37/D39.
\set ON_ERROR_STOP on
begin;

create temp table i3872_results (
  seq bigserial primary key,
  label text not null,
  ok boolean not null,
  detail text not null
) on commit drop;

create function pg_temp.i3872_eq(p_label text,p_got text,p_want text) returns void
language sql as $fn$
  insert into i3872_results(label,ok,detail)
  values(p_label,p_got is not distinct from p_want,
         format('got %s; want %s',coalesce(p_got,'<null>'),coalesce(p_want,'<null>')))
$fn$;

create function pg_temp.i3872_true(p_label text,p_ok boolean,p_detail text default '') returns void
language sql as $fn$
  insert into i3872_results(label,ok,detail) values(p_label,coalesce(p_ok,false),p_detail)
$fn$;

create function pg_temp.i3872_line(
  p_ref text,p_list integer,p_qty integer default 1,p_allowed boolean default true,
  p_item_kind text default 'ticket_type',p_listing_kind text default 'event',
  p_tz text default 'UTC',p_value_scale integer default 1,p_count_scale integer default 1,
  p_item_id uuid default '3872e000-0000-4000-8100-000000000001',
  p_listing_id uuid default '3872e000-0000-4000-8200-000000000001'
) returns jsonb language sql immutable as $fn$
  select jsonb_build_object(
    'lineRef',p_ref,'itemKind',p_item_kind,'itemId',p_item_id,'listingId',p_listing_id,
    'listingKind',p_listing_kind,'listUnitMinor',p_list,'qty',p_qty,
    'valueScale',p_value_scale,'countScale',p_count_scale,'allowed',p_allowed,'tz',p_tz
  )
$fn$;

create function pg_temp.i3872_discount(
  p_num integer,p_kind text,p_value_type text,p_value integer,
  p_combines text default 'any',p_patch jsonb default '{}'::jsonb
) returns jsonb language sql immutable as $fn$
  select jsonb_build_object(
    'id',('3872e000-0000-4000-8300-'||lpad(p_num::text,12,'0'))::uuid,
    'kind',p_kind,'code',case when p_kind='code' then 'CODE'||p_num else null end,
    'name','Discount '||p_num,'valueType',p_value_type,
    'valueBps',case when p_value_type='percent' then p_value else null end,
    'valueMinor',case when p_value_type<>'percent' then p_value else null end,
    'currency',null,'scopeKind','brand','combinesWith',p_combines,
    'startsAt','2026-01-01T00:00:00Z','endsAt',null,'schedule',null,
    'minSubtotalMinor',null,'status','active','needsAttention',null,'deletedAt',null,
    'createdAt',('2026-01-01T00:00:'||lpad((p_num%60)::text,2,'0')||'Z'),
    'targets','[]'::jsonb,'remainingTotalUses',null,'remainingBuyerUses',null,
    'remainingUnits',null,'limited',false
  ) || p_patch
$fn$;

create function pg_temp.i3872_run(
  p_lines jsonb,p_automatics jsonb default '[]'::jsonb,p_code jsonb default null,
  p_lookup text default 'none',p_queued boolean default false,
  p_at timestamptz default '2026-10-22T12:30:00Z'
) returns jsonb language sql stable as $fn$
  select public.issue_3872_discount_apply(jsonb_build_object(
    'currency','USD','at',p_at,'queued',p_queued,'lines',p_lines,
    'automatics',p_automatics,'code',p_code,'codeLookup',p_lookup
  ))
$fn$;

create function pg_temp.i3872_line_net(p_q jsonb,p_ref text) returns integer
language sql immutable as $fn$
  select (x->>'netUnitMinor')::integer from jsonb_array_elements(p_q->'lines') x
  where x->>'lineRef'=p_ref
$fn$;

do $matrix$
declare q jsonb; d jsonb; a jsonb; c jsonb; base_lines jsonb;
begin
  base_lines:=jsonb_build_array(pg_temp.i3872_line('a',1000,2));

  -- EN-5 percent and EN-11 totals.
  q:=pg_temp.i3872_run(base_lines,jsonb_build_array(pg_temp.i3872_discount(1,'automatic','percent',1000)));
  perform pg_temp.i3872_eq('01 percent list total',q->>'listSubtotalMinor','2000');
  perform pg_temp.i3872_eq('02 percent net total',q->>'netSubtotalMinor','1800');
  perform pg_temp.i3872_eq('03 percent discount total',q->>'discountMinor','200');
  perform pg_temp.i3872_eq('04 percent per-unit',q#>>'{lines,0,applied,0,perUnitMinor}','100');
  perform pg_temp.i3872_eq('05 percent aggregated units',q#>>'{applied,0,units}','2');
  perform pg_temp.i3872_true('06 digest shape',q->>'digest' ~ '^[0-9a-f]{32}$',q->>'digest');
  perform pg_temp.i3872_true('07 list digest shape',q->>'listDigest' ~ '^[0-9a-f]{32}$',q->>'listDigest');

  -- Amount floors at zero.
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',75,2)),
       jsonb_build_array(pg_temp.i3872_discount(2,'automatic','amount',100)));
  perform pg_temp.i3872_eq('08 amount floor unit',q#>>'{lines,0,netUnitMinor}','0');
  perform pg_temp.i3872_eq('09 amount floor total',q->>'netSubtotalMinor','0');
  perform pg_temp.i3872_eq('10 amount floor discount',q->>'discountMinor','150');
  perform pg_temp.i3872_eq('11 amount floor per-unit',q#>>'{lines,0,applied,0,perUnitMinor}','75');

  -- Set-price never raises a price.
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),
       jsonb_build_array(pg_temp.i3872_discount(3,'sale_price','set_price',650)));
  perform pg_temp.i3872_eq('12 set-price unit',q#>>'{lines,0,netUnitMinor}','650');
  perform pg_temp.i3872_eq('13 set-price amount',q#>>'{applied,0,amountMinor}','350');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',500)),
       jsonb_build_array(pg_temp.i3872_discount(3,'sale_price','set_price',650)));
  perform pg_temp.i3872_eq('14 high set-price does not raise',q#>>'{lines,0,netUnitMinor}','500');
  perform pg_temp.i3872_eq('15 high set-price not applied',jsonb_array_length(q->'applied')::text,'0');

  -- PostgreSQL numeric round is half-up for the positive money domain.
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',5)),
       jsonb_build_array(pg_temp.i3872_discount(4,'automatic','percent',1000)));
  perform pg_temp.i3872_eq('16 round-half-up unit',q#>>'{lines,0,netUnitMinor}','4');
  perform pg_temp.i3872_eq('17 round-half-up saving',q->>'discountMinor','1');

  -- EN-3 allow switch and target matching.
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000,1,false)),
       jsonb_build_array(pg_temp.i3872_discount(5,'automatic','percent',5000)));
  perform pg_temp.i3872_eq('18 disallowed line full price',q->>'netSubtotalMinor','1000');
  perform pg_temp.i3872_eq('19 disallowed line no apply',jsonb_array_length(q->'applied')::text,'0');
  d:=pg_temp.i3872_discount(6,'automatic','percent',1000,'any',jsonb_build_object(
       'scopeKind','items','targets',jsonb_build_array(jsonb_build_object(
         'targetKind','ticket_type','targetId','3872e000-0000-4000-8100-000000000001'))));
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),jsonb_build_array(d));
  perform pg_temp.i3872_eq('20 item target match',q->>'netSubtotalMinor','900');
  d:=d||jsonb_build_object('targets',jsonb_build_array(jsonb_build_object(
       'targetKind','ticket_type','targetId','3872e000-0000-4000-8100-000000000099')));
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),jsonb_build_array(d));
  perform pg_temp.i3872_eq('21 item target mismatch',q->>'netSubtotalMinor','1000');

  -- EN-2 schedule is evaluated in each line's own timezone.
  d:=pg_temp.i3872_discount(7,'automatic','amount',100,'any',jsonb_build_object(
       'schedule',jsonb_build_object('days',jsonb_build_array(4),'from','13:00','to','14:00')));
  q:=pg_temp.i3872_run(jsonb_build_array(
       pg_temp.i3872_line('lagos',1000,1,true,'ticket_type','event','Africa/Lagos'),
       pg_temp.i3872_line('london',1000,1,true,'ticket_type','event','Europe/London')),
       jsonb_build_array(d),null,'none',false,'2026-12-10T12:30:00Z');
  perform pg_temp.i3872_eq('22 Lagos schedule applies',pg_temp.i3872_line_net(q,'lagos')::text,'900');
  perform pg_temp.i3872_eq('23 London schedule excluded',pg_temp.i3872_line_net(q,'london')::text,'1000');
  perform pg_temp.i3872_eq('24 schedule total',q->>'netSubtotalMinor','1900');
  perform pg_temp.i3872_eq('25 schedule units',q#>>'{applied,0,units}','1');

  -- EN-2 liveness filters.
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),jsonb_build_array(
       pg_temp.i3872_discount(8,'automatic','percent',5000,'any','{"status":"paused"}'),
       pg_temp.i3872_discount(9,'automatic','percent',5000,'any','{"startsAt":"2027-01-01T00:00:00Z"}'),
       pg_temp.i3872_discount(10,'automatic','percent',5000,'any','{"endsAt":"2026-01-02T00:00:00Z"}'),
       pg_temp.i3872_discount(11,'automatic','amount',100,'any','{"currency":"GBP"}'),
       pg_temp.i3872_discount(12,'automatic','amount',100,'any','{"deletedAt":"2026-01-02T00:00:00Z"}'),
       pg_temp.i3872_discount(13,'automatic','amount',100,'any','{"needsAttention":"target_deleted"}')
  ));
  perform pg_temp.i3872_eq('26 non-live set full price',q->>'netSubtotalMinor','1000');
  perform pg_temp.i3872_eq('27 non-live set empty',jsonb_array_length(q->'applied')::text,'0');

  -- D37 whole-line limits and notice.
  d:=pg_temp.i3872_discount(14,'sale_price','percent',2000,'any','{"remainingUnits":3,"limited":true}');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000,4)),jsonb_build_array(d));
  perform pg_temp.i3872_eq('28 D37 qty4 full price',q->>'netSubtotalMinor','4000');
  perform pg_temp.i3872_eq('29 D37 qty4 notice type',q#>>'{notices,0,type}','sale_limited');
  perform pg_temp.i3872_eq('30 D37 qty4 remaining',q#>>'{notices,0,remaining}','3');
  perform pg_temp.i3872_eq('31 D37 qty4 no split',jsonb_array_length(q->'applied')::text,'0');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000,3)),jsonb_build_array(d));
  perform pg_temp.i3872_eq('32 D37 qty3 sale',q->>'netSubtotalMinor','2400');
  perform pg_temp.i3872_eq('33 D37 qty3 units',q#>>'{applied,0,units}','3');
  perform pg_temp.i3872_eq('34 D37 qty3 no notice',jsonb_array_length(q->'notices')::text,'0');

  -- D39 group, block, per-day and all-days scales.
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('group',1000)),
       jsonb_build_array(pg_temp.i3872_discount(15,'automatic','amount',100)));
  perform pg_temp.i3872_eq('35 group amount once',q->>'netSubtotalMinor','900');
  perform pg_temp.i3872_eq('36 group counts one',q#>>'{applied,0,units}','1');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('block',3000,1,true,'ticket_type','experience','UTC',3,3)),
       jsonb_build_array(pg_temp.i3872_discount(16,'automatic','amount',100)));
  perform pg_temp.i3872_eq('37 block amount x blocks',q->>'netSubtotalMinor','2700');
  perform pg_temp.i3872_eq('38 block counts blocks',q#>>'{applied,0,units}','3');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('per-day',1000,3,true,'ticket_type','trip','UTC',1,1)),
       jsonb_build_array(pg_temp.i3872_discount(17,'automatic','amount',100)));
  perform pg_temp.i3872_eq('39 per-day amount per stored unit',q->>'netSubtotalMinor','2700');
  perform pg_temp.i3872_eq('40 per-day counts quantity',q#>>'{applied,0,units}','3');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('all-days',1000,1,true,'ticket_type','trip','UTC',1,3)),
       jsonb_build_array(pg_temp.i3872_discount(18,'automatic','amount',100)));
  perform pg_temp.i3872_eq('41 all-days amount once',q->>'netSubtotalMinor','900');
  perform pg_temp.i3872_eq('42 all-days counts days',q#>>'{applied,0,units}','3');

  -- EN-8 minimum uses eligible list, even after another automatic reduces net.
  a:=pg_temp.i3872_discount(19,'automatic','percent',5000);
  d:=pg_temp.i3872_discount(20,'automatic','amount',100,'any','{"minSubtotalMinor":1000}');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),jsonb_build_array(a,d));
  perform pg_temp.i3872_eq('43 automatic minimum on list',q->>'netSubtotalMinor','400');
  perform pg_temp.i3872_eq('44 automatic minimum both apply',jsonb_array_length(q->'applied')::text,'2');
  d:=d||'{"minSubtotalMinor":1001}'::jsonb;
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),jsonb_build_array(a,d));
  perform pg_temp.i3872_eq('45 automatic below minimum dropped',q->>'netSubtotalMinor','500');

  -- EN-6 greedy choice by standalone saving.
  a:=pg_temp.i3872_discount(21,'automatic','percent',2000,'none');
  d:=pg_temp.i3872_discount(22,'automatic','percent',1000,'none');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),jsonb_build_array(d,a));
  perform pg_temp.i3872_eq('46 greedy best net',q->>'netSubtotalMinor','800');
  perform pg_temp.i3872_eq('47 greedy best id',q#>>'{applied,0,discountId}',a->>'id');
  perform pg_temp.i3872_eq('48 greedy only one',jsonb_array_length(q->'applied')::text,'1');

  -- EN-6 application type order: set, percent, amount.
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),jsonb_build_array(
       pg_temp.i3872_discount(25,'automatic','amount',100),
       pg_temp.i3872_discount(24,'automatic','percent',1000),
       pg_temp.i3872_discount(23,'sale_price','set_price',800)));
  perform pg_temp.i3872_eq('49 type-order net',q->>'netSubtotalMinor','620');
  perform pg_temp.i3872_eq('50 type-order first',q#>>'{lines,0,applied,0,valueType}','set_price');
  perform pg_temp.i3872_eq('51 type-order second',q#>>'{lines,0,applied,1,valueType}','percent');
  perform pg_temp.i3872_eq('52 type-order third',q#>>'{lines,0,applied,2,valueType}','amount');
  perform pg_temp.i3872_eq('53 type-order seq',q#>>'{lines,0,applied,2,seq}','3');

  -- EN-9 code reasons, in the binding order.
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),'[]',null,'not_found');
  perform pg_temp.i3872_eq('54 code not-found',q#>>'{codeOutcome,reason}','not_found');
  c:=pg_temp.i3872_discount(30,'code','percent',1000,'automatic_only','{"status":"paused"}');
  q:=pg_temp.i3872_run(base_lines,'[]',c,'found');
  perform pg_temp.i3872_eq('55 code paused',q#>>'{codeOutcome,reason}','paused');
  c:=pg_temp.i3872_discount(31,'code','percent',1000,'automatic_only','{"needsAttention":"target_deleted"}');
  q:=pg_temp.i3872_run(base_lines,'[]',c,'found');
  perform pg_temp.i3872_eq('56 code attention is paused',q#>>'{codeOutcome,reason}','paused');
  c:=pg_temp.i3872_discount(32,'code','percent',1000,'automatic_only','{"startsAt":"2027-01-01T00:00:00Z"}');
  q:=pg_temp.i3872_run(base_lines,'[]',c,'found');
  perform pg_temp.i3872_eq('57 code not-started',q#>>'{codeOutcome,reason}','not_started');
  c:=pg_temp.i3872_discount(33,'code','percent',1000,'automatic_only','{"status":"ended"}');
  q:=pg_temp.i3872_run(base_lines,'[]',c,'found');
  perform pg_temp.i3872_eq('58 code ended',q#>>'{codeOutcome,reason}','ended');
  c:=pg_temp.i3872_discount(34,'code','percent',1000,'automatic_only','{"endsAt":"2026-01-02T00:00:00Z"}');
  q:=pg_temp.i3872_run(base_lines,'[]',c,'found');
  perform pg_temp.i3872_eq('59 code expired',q#>>'{codeOutcome,reason}','ended');
  c:=pg_temp.i3872_discount(35,'code','percent',1000,'automatic_only','{"remainingTotalUses":0}');
  q:=pg_temp.i3872_run(base_lines,'[]',c,'found');
  perform pg_temp.i3872_eq('60 code used-up',q#>>'{codeOutcome,reason}','used_up');
  c:=pg_temp.i3872_discount(36,'code','percent',1000,'automatic_only','{"remainingBuyerUses":0}');
  q:=pg_temp.i3872_run(base_lines,'[]',c,'found');
  perform pg_temp.i3872_eq('61 code buyer-limit',q#>>'{codeOutcome,reason}','buyer_limit');
  c:=pg_temp.i3872_discount(37,'code','percent',1000);
  q:=pg_temp.i3872_run(base_lines,'[]',c,'found',true);
  perform pg_temp.i3872_eq('62 code queued',q#>>'{codeOutcome,reason}','queue');
  c:=pg_temp.i3872_discount(38,'code','percent',1000,'any',jsonb_build_object(
       'scopeKind','items','targets',jsonb_build_array(jsonb_build_object(
         'targetKind','ticket_type','targetId','3872e000-0000-4000-8100-000000000099'))));
  q:=pg_temp.i3872_run(base_lines,'[]',c,'found');
  perform pg_temp.i3872_eq('63 code not-applicable',q#>>'{codeOutcome,reason}','not_applicable');
  c:=pg_temp.i3872_discount(39,'code','percent',1000,'any','{"minSubtotalMinor":2500}');
  q:=pg_temp.i3872_run(base_lines,'[]',c,'found');
  perform pg_temp.i3872_eq('64 code minimum reason',q#>>'{codeOutcome,reason}','min_subtotal');
  perform pg_temp.i3872_eq('65 code minimum shortfall',q#>>'{codeOutcome,required}','500');

  -- EN-10 compatible code runs last.
  a:=pg_temp.i3872_discount(40,'automatic','percent',1000,'any');
  c:=pg_temp.i3872_discount(41,'code','percent',1000,'any');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)) ,jsonb_build_array(a),c,'found');
  perform pg_temp.i3872_eq('66 compatible code net',q->>'netSubtotalMinor','810');
  perform pg_temp.i3872_eq('67 compatible code applied',q#>>'{codeOutcome,status}','applied');
  perform pg_temp.i3872_eq('68 compatible code last',q#>>'{lines,0,applied,1,discountId}',c->>'id');

  -- EN-10 incompatible A wins, B wins, and ties stay with A.
  a:=pg_temp.i3872_discount(42,'automatic','percent',5000,'none');
  c:=pg_temp.i3872_discount(43,'code','percent',1000,'none');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),jsonb_build_array(a),c,'found');
  perform pg_temp.i3872_eq('69 A wins net',q->>'netSubtotalMinor','500');
  perform pg_temp.i3872_eq('70 A wins reason',q#>>'{codeOutcome,reason}','incompatible_better_automatic');
  perform pg_temp.i3872_eq('71 A wins with name',q#>>'{codeOutcome,with}',a->>'name');
  a:=pg_temp.i3872_discount(44,'automatic','percent',1000,'none');
  c:=pg_temp.i3872_discount(45,'code','percent',5000,'none');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),jsonb_build_array(a),c,'found');
  perform pg_temp.i3872_eq('72 B wins net',q->>'netSubtotalMinor','500');
  perform pg_temp.i3872_eq('73 B wins applied',q#>>'{codeOutcome,status}','applied');
  perform pg_temp.i3872_eq('74 B wins replaced name',q#>>'{codeOutcome,replaced,0}',a->>'name');
  a:=pg_temp.i3872_discount(46,'automatic','percent',1000,'none');
  c:=pg_temp.i3872_discount(47,'code','percent',1000,'none');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),jsonb_build_array(a),c,'found');
  perform pg_temp.i3872_eq('75 tie stays A',q#>>'{codeOutcome,reason}','incompatible_better_automatic');
  perform pg_temp.i3872_eq('76 tie net',q->>'netSubtotalMinor','900');

  -- Queues exclude limited automatics but keep unlimited ones.
  a:=pg_temp.i3872_discount(48,'automatic','percent',5000,'any','{"limited":true,"remainingTotalUses":10}');
  d:=pg_temp.i3872_discount(49,'automatic','percent',1000,'any');
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)),jsonb_build_array(a,d),null,'none',true);
  perform pg_temp.i3872_eq('77 queued limited excluded',q->>'netSubtotalMinor','900');
  perform pg_temp.i3872_eq('78 queued unlimited retained',q#>>'{applied,0,discountId}',d->>'id');

  -- Canonical output and digest change when buyer-visible truth changes.
  q:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('b',500),pg_temp.i3872_line('a',1000)));
  perform pg_temp.i3872_eq('79 lines sorted canonically',q#>>'{lines,0,lineRef}','a');
  perform pg_temp.i3872_eq('80 second line sorted',q#>>'{lines,1,lineRef}','b');
  a:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1000)));
  d:=pg_temp.i3872_run(jsonb_build_array(pg_temp.i3872_line('a',1001)));
  perform pg_temp.i3872_true('81 digest changes with price',a->>'digest'<>d->>'digest',(a->>'digest')||' / '||(d->>'digest'));
  perform pg_temp.i3872_true('82 list digest changes with price',a->>'listDigest'<>d->>'listDigest',(a->>'listDigest')||' / '||(d->>'listDigest'));
end;
$matrix$;

do $report$
declare v_fail text; v_count integer;
begin
  select count(*) into v_count from i3872_results;
  if v_count<60 then raise exception 'T3 recorded only % checks',v_count; end if;
  select string_agg(format('%s (%s)',label,detail),E'\n' order by seq) into v_fail
  from i3872_results where not ok;
  if v_fail is not null then raise exception E'Issue #3872 T3 failures:\n%',v_fail; end if;
  raise notice 'Issue #3872 T3 passed % engine assertions',v_count;
end;
$report$;

rollback;

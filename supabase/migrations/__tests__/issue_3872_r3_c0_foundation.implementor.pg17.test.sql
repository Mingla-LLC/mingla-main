-- Issue #3872 R3 C0: server comps, isolated creator media and formats.
-- MINGLA-INVARIANT: I-3872-MEDIA-FAIL-CLOSED | issue #3872 | Upload allocation is dark by default and all creator media remains owner-scoped.
-- MINGLA-INVARIANT: I-3872-GIG-COMP-IS-A-TICKET | issue #3872 | The gig comp ledger can only point at an existing ordinary order.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
  ('38720000-0000-4000-8000-000000000001','r3-media@test.local')
on conflict(id) do nothing;

do $test$
declare
  v_missing text;
  v_count integer;
  v_acl aclitem[];
begin
  select string_agg(name,', ' order by name) into v_missing
  from unnest(array['gig_formats','creator_media_jobs','guest_comp_entries']) name
  where to_regclass('public.'||name) is null;
  if v_missing is not null then raise exception 'C0 missing tables: %',v_missing; end if;

  select count(*) into v_count from public.gig_formats where active;
  if v_count<>6 then raise exception 'C0 launch formats expected 6, got %',v_count; end if;
  if (select is_enabled from public.feature_flags where flag_key='creator_gigs_enabled')
       is distinct from false
     or (select is_enabled from public.feature_flags where flag_key='creator_media_uploads_enabled')
       is distinct from false then
    raise exception 'C0 creator switches must default dark';
  end if;

  select count(*) into v_count from pg_class
  where oid=any(array[
    'public.gig_formats'::regclass,
    'public.creator_media_jobs'::regclass,
    'public.guest_comp_entries'::regclass
  ]) and relrowsecurity and relforcerowsecurity;
  if v_count<>3 then raise exception 'C0 every new table must force RLS'; end if;

  if has_table_privilege('authenticated','public.creator_media_jobs','INSERT')
     or has_table_privilege('authenticated','public.guest_comp_entries','SELECT') then
    raise exception 'C0 exposed a sensitive write or comp read to authenticated';
  end if;
  select proacl into v_acl from pg_proc
  where oid='public.biz_issue_comp(uuid,uuid,timestamptz,text,text,integer,text,uuid,uuid,text)'::regprocedure;
  if coalesce(array_to_string(v_acl,','),'') ~ '(anon|authenticated)=' then
    raise exception 'C0 comp issue function is callable by a client role';
  end if;
end;
$test$;

insert into public.creator_media_jobs(
  id,client_operation_id,owner_kind,owner_id,purpose,bytes_source,duration_s,width,height
) values(
  '38720000-0000-4000-8100-000000000001',
  '38720000-0000-4000-8200-000000000001',
  'creator','38720000-0000-4000-8000-000000000001','showcase',12000000,42,1080,1920
);

do $test$
begin
  begin
    insert into public.creator_media_jobs(
      client_operation_id,owner_kind,owner_id,purpose,contract_id,bytes_source,duration_s
    ) values(
      '38720000-0000-4000-8200-000000000002','local',
      '38720000-0000-4000-8000-000000000001','showcase',
      '38720000-0000-4000-8300-000000000001',1,1
    );
    raise exception 'C0 accepted a cross-owner purpose shape';
  exception when check_violation then null;
  end;

  begin
    perform public.biz_issue_comp(
      null,null,null,'Creator',null,null,'gig',
      gen_random_uuid(),'38720000-0000-4000-8000-000000000001','pepper'
    );
    raise exception 'C0 accepted a NULL comp quantity';
  exception when raise_exception then
    if sqlerrm='C0 accepted a NULL comp quantity' then raise; end if;
    if sqlerrm<>'invalid_comp_request' then
      raise exception 'C0 wrong NULL quantity error: %',sqlerrm;
    end if;
  end;
end;
$test$;

set local role authenticated;
select set_config('request.jwt.claim.sub','38720000-0000-4000-8000-000000000001',true);
do $test$
begin
  if (select count(*) from public.creator_media_jobs)<>1 then
    raise exception 'C0 owner cannot read own media job';
  end if;
end;
$test$;
reset role;

rollback;

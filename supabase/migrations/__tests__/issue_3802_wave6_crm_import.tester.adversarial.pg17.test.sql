-- Issue #3802 Wave 6 — adversarial CRM import safety proof.
-- MINGLA-INVARIANT: I-3802-CRM-IMPORT-IDENTITY | issue #3802 | Every imported CRM source row keeps one immutable source identity, and one source-bundle-hash receipt proves the exact completed Hosts and Creators batch.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(p_ok boolean,p_message text) returns void language plpgsql as $fn$
begin if not coalesce(p_ok,false) then raise exception 'FAIL: %',p_message; end if; end $fn$;
create function pg_temp.attempt(p_sql text) returns text language plpgsql as $fn$
begin execute p_sql; return 'OK'; exception when others then return 'ERR:'||sqlstate||':'||sqlerrm; end $fn$;

do $proof$
declare
  first_id uuid;
  second_id uuid;
  result text;
begin
  insert into public.crm_records(pipeline,name,stage,created_by,updated_by)
  values ('hosts','Issue3802 source first','prospect','import@test.local','import@test.local')
  returning id into first_id;
  insert into public.crm_records(pipeline,name,stage,created_by,updated_by)
  values ('hosts','Issue3802 source second','prospect','import@test.local','import@test.local')
  returning id into second_id;

  insert into public.crm_record_sources
    (source_system,source_id,source_scope,record_id,source_context,linked_by)
  values ('clickup','locked-source','supply-crm',first_id,'{}','import@test.local');

  result := pg_temp.attempt(format($q$
    insert into public.crm_record_sources
      (source_system,source_id,source_scope,record_id,source_context,linked_by)
    values ('clickup','locked-source','supply-crm',%L,'{}','import@test.local')
  $q$, second_id));
  perform pg_temp.ok(result like 'ERR:23505:%',
    'one source identity cannot point to two records');

  result := pg_temp.attempt(format($q$
    insert into public.crm_record_sources
      (source_system,source_id,source_scope,record_id,source_context,linked_by)
    values ('clickup','bad-context','supply-crm',%L,'[]','import@test.local')
  $q$, first_id));
  perform pg_temp.ok(result like 'ERR:23514:%', 'source context must be an object');

  result := pg_temp.attempt(format($q$
    insert into public.crm_record_sources
      (source_system,source_id,source_scope,record_id,source_context,linked_by)
    values ('clickup','big-context','supply-crm',%L,
      jsonb_build_object('x',repeat('z',70000)),'import@test.local')
  $q$, first_id));
  perform pg_temp.ok(result like 'ERR:23514:%', 'oversized source context is refused');

  result := pg_temp.attempt($q$
    insert into public.crm_import_receipts
      (source_system,source_scope,source_bundle_sha256,expected_source_count,
       imported_source_count,resulting_record_count,created_record_count,
       linked_existing_count,applied_by)
    values ('clickup','hosts-and-creators',repeat('a',64),3,2,2,2,0,'import@test.local')
  $q$);
  perform pg_temp.ok(result like 'ERR:23514:%',
    'partial source import cannot receive a success receipt');

  result := pg_temp.attempt($q$
    insert into public.crm_import_receipts
      (source_system,source_scope,source_bundle_sha256,expected_source_count,
       imported_source_count,resulting_record_count,created_record_count,
       linked_existing_count,applied_by)
    values ('clickup','bad-totals',repeat('a',64),2,2,2,2,1,'import@test.local')
  $q$);
  perform pg_temp.ok(result like 'ERR:23514:%',
    'created and linked-existing counts must explain resulting records');

  insert into public.crm_import_receipts
    (source_system,source_scope,source_bundle_sha256,expected_source_count,
     imported_source_count,resulting_record_count,created_record_count,
     linked_existing_count,applied_by)
  values ('clickup','hosts-and-creators',repeat('a',64),2,2,1,1,0,'import@test.local');
  result := pg_temp.attempt($q$
    insert into public.crm_import_receipts
      (source_system,source_scope,source_bundle_sha256,expected_source_count,
       imported_source_count,resulting_record_count,created_record_count,
       linked_existing_count,applied_by)
    values ('clickup','hosts-and-creators',repeat('b',64),2,2,1,1,0,'import@test.local')
  $q$);
  perform pg_temp.ok(result like 'ERR:23505:%',
    'one source scope cannot be rebound to another bundle');

  perform pg_temp.ok(
    has_table_privilege('authenticated','public.crm_record_sources','select')=false
      and has_table_privilege('anon','public.crm_record_sources','select')=false
      and has_table_privilege('service_role','public.crm_record_sources','update')=false
      and has_table_privilege('service_role','public.crm_record_sources','delete')=false
      and has_table_privilege('service_role','public.crm_record_sources','truncate')=false
      and has_table_privilege('service_role','public.crm_import_receipts','update')=false
      and has_table_privilege('service_role','public.crm_import_receipts','delete')=false
      and has_table_privilege('service_role','public.crm_import_receipts','truncate')=false
      and not exists(select 1 from pg_policy where polrelid in
        ('public.crm_record_sources'::regclass,'public.crm_import_receipts'::regclass)),
    'import evidence is closed to browser roles and immutable to service role');
  perform pg_temp.ok(
    (select md5(prosrc) from pg_proc where oid='public.is_admin_user()'::regprocedure)
      = 'dc5465a20a4246c6921be0469e261a8b',
    'is_admin_user remains byte-for-byte unchanged in replay');
end $proof$;

\echo 'ISSUE-3802 WAVE6 CRM IMPORT ADVERSARIAL PASS'
rollback;

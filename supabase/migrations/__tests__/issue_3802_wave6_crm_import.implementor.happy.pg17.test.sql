-- Issue #3802 Wave 6 — happy-path CRM provenance and receipt proof.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(p_ok boolean,p_message text) returns void language plpgsql as $fn$
begin if not coalesce(p_ok,false) then raise exception 'FAIL: %',p_message; end if; end $fn$;

do $proof$
declare
  record_id uuid;
  summary jsonb;
begin
  insert into public.crm_records
    (pipeline,name,stage,created_by,updated_by)
  values
    ('hosts','Issue3802 import fixture','prospect','import@test.local','import@test.local')
  returning id into record_id;

  insert into public.crm_record_sources
    (source_system,source_id,source_scope,record_id,source_context,linked_by)
  values
    ('clickup','host-001','supply-crm',record_id,
      '{"task_name":"Fixture one","original_status":"prospect","city":"Lagos","private":"not exposed"}',
      'import@test.local'),
    ('clickup','host-002','supply-crm',record_id,
      '{"task_name":"Fixture duplicate","original_status":"contacting","city":"Lagos"}',
      'import@test.local');

  summary := public.crm_record_sources_json(record_id);
  perform pg_temp.ok(jsonb_array_length(summary)=2,
    'two source cards can consolidate into one Mingla record');
  perform pg_temp.ok(summary #>> '{0,source_url}' = 'https://app.clickup.com/t/host-001',
    'detail summary carries the safe original link');
  perform pg_temp.ok(not ((summary->0) ? 'private'),
    'private source context is not exposed');

  insert into public.crm_import_receipts
    (source_system,source_scope,source_bundle_sha256,expected_source_count,
     imported_source_count,resulting_record_count,created_record_count,
     linked_existing_count,applied_by)
  values
    ('clickup','hosts-and-creators',repeat('a',64),2,2,1,1,0,'import@test.local');

  perform pg_temp.ok(
    has_table_privilege('service_role','public.crm_record_sources','select')
      and has_table_privilege('service_role','public.crm_record_sources','insert')
      and not has_table_privilege('service_role','public.crm_record_sources','update')
      and not has_table_privilege('service_role','public.crm_record_sources','delete')
      and has_table_privilege('service_role','public.crm_import_receipts','select')
      and has_table_privilege('service_role','public.crm_import_receipts','insert'),
    'service role can record and inspect immutable import evidence');
end $proof$;

\echo 'ISSUE-3802 WAVE6 CRM IMPORT HAPPY PASS'
rollback;

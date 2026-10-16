-- Issue #3802 Wave 6 — happy-path proof for import identity and receipts.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(p_ok boolean,p_message text) returns void language plpgsql as $fn$
begin if not coalesce(p_ok,false) then raise exception 'FAIL: %',p_message; end if; end $fn$;

do $proof$
declare
  first_id uuid;
  second_id uuid;
begin
  insert into public.content_calendar_items
    (title, source_system, source_id, created_by, updated_by)
  values
    ('Legacy title', 'clickup', 'card-001', 'import@test.local', 'import@test.local')
  returning id into first_id;

  insert into public.content_calendar_items
    (title, source_system, source_id, created_by, updated_by)
  values
    ('Legacy title', 'clickup', 'card-002', 'import@test.local', 'import@test.local')
  returning id into second_id;

  perform pg_temp.ok(first_id <> second_id, 'duplicate legacy titles are preserved as separate cards');
  perform pg_temp.ok(
    (select count(*) from public.content_calendar_items
      where source_system = 'clickup' and source_id in ('card-001','card-002')) = 2,
    'both immutable source identities exist'
  );

  insert into public.content_calendar_import_receipts
    (source_system, source_scope, artifact_sha256, expected_count, imported_count, applied_by)
  values
    ('clickup', 'content-production', repeat('a',64), 2, 2, 'import@test.local');

  perform pg_temp.ok(
    exists(select 1 from public.content_calendar_import_receipts
      where source_system='clickup' and source_scope='content-production'
        and artifact_sha256=repeat('a',64) and expected_count=2 and imported_count=2),
    'hash-bound exact-count receipt stored'
  );
  perform pg_temp.ok(
    has_table_privilege('service_role','public.content_calendar_import_receipts','select')
      and has_table_privilege('service_role','public.content_calendar_import_receipts','insert')
      and not has_table_privilege('service_role','public.content_calendar_import_receipts','update')
      and not has_table_privilege('service_role','public.content_calendar_import_receipts','delete')
      and not has_table_privilege('service_role','public.content_calendar_import_receipts','truncate'),
    'service role can record and inspect a receipt'
  );
end $proof$;

\echo 'ISSUE-3802 WAVE6 CLICKUP IMPORT HAPPY PASS'
rollback;

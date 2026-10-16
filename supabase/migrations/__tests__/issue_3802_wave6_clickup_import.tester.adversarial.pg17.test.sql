-- Issue #3802 Wave 6 — adversarial proof for replay and provenance safety.
-- MINGLA-INVARIANT: I-3802-CONTENT-IMPORT-IDENTITY | issue #3802 | Every imported content card keeps one immutable source identity, and one hash-bound receipt proves the exact completed batch.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(p_ok boolean,p_message text) returns void language plpgsql as $fn$
begin if not coalesce(p_ok,false) then raise exception 'FAIL: %',p_message; end if; end $fn$;
create function pg_temp.attempt(p_sql text) returns text language plpgsql as $fn$
begin execute p_sql; return 'OK'; exception when others then return 'ERR:'||sqlstate||':'||sqlerrm; end $fn$;

do $proof$
declare imported_id uuid; result text;
begin
  insert into public.content_calendar_items
    (title, source_system, source_id, created_by, updated_by)
  values ('Imported card', 'clickup', 'locked-card', 'import@test.local', 'import@test.local')
  returning id into imported_id;

  result := pg_temp.attempt(format(
    'update public.content_calendar_items set source_id=%L where id=%L',
    'changed-card', imported_id));
  perform pg_temp.ok(result like 'ERR:22023:source_identity_locked:%', 'source id cannot change');

  result := pg_temp.attempt(format(
    'update public.content_calendar_items set source_system=null,source_id=null where id=%L',
    imported_id));
  perform pg_temp.ok(result like 'ERR:22023:source_identity_locked:%', 'source identity cannot be removed');

  result := pg_temp.attempt($q$
    insert into public.content_calendar_items
      (title,source_system,source_id,created_by,updated_by)
    values ('Another card','clickup','locked-card','import@test.local','import@test.local')
  $q$);
  perform pg_temp.ok(result like 'ERR:23505:%', 'one source id cannot import twice');

  result := pg_temp.attempt($q$
    insert into public.content_calendar_items
      (title,source_system,created_by,updated_by)
    values ('Broken provenance','clickup','import@test.local','import@test.local')
  $q$);
  perform pg_temp.ok(result like 'ERR:23514:%', 'half a provenance pair is refused');

  insert into public.content_calendar_items(title,created_by,updated_by)
    values ('Manual unique','person@test.local','person@test.local');
  result := pg_temp.attempt($q$
    insert into public.content_calendar_items(title,created_by,updated_by)
    values ('Manual unique','person@test.local','person@test.local')
  $q$);
  perform pg_temp.ok(result like 'ERR:23505:%', 'manual active titles remain unique');

  result := pg_temp.attempt($q$
    insert into public.content_calendar_import_receipts
      (source_system,source_scope,artifact_sha256,expected_count,imported_count,applied_by)
    values ('clickup','content-production',repeat('b',64),2,1,'import@test.local')
  $q$);
  perform pg_temp.ok(result like 'ERR:23514:%', 'partial import cannot receive a success receipt');

  insert into public.content_calendar_import_receipts
    (source_system,source_scope,artifact_sha256,expected_count,imported_count,applied_by)
  values ('clickup','content-production',repeat('b',64),1,1,'import@test.local');
  result := pg_temp.attempt($q$
    insert into public.content_calendar_import_receipts
      (source_system,source_scope,artifact_sha256,expected_count,imported_count,applied_by)
    values ('clickup','content-production',repeat('c',64),1,1,'import@test.local')
  $q$);
  perform pg_temp.ok(result like 'ERR:23505:%', 'one source scope cannot be rebound to another artifact');

  perform pg_temp.ok(
    has_table_privilege('authenticated','public.content_calendar_import_receipts','select')=false
      and has_table_privilege('anon','public.content_calendar_import_receipts','select')=false
      and has_table_privilege('service_role','public.content_calendar_import_receipts','update')=false
      and has_table_privilege('service_role','public.content_calendar_import_receipts','delete')=false
      and has_table_privilege('service_role','public.content_calendar_import_receipts','truncate')=false
      and not exists(select 1 from pg_policy
        where polrelid='public.content_calendar_import_receipts'::regclass),
    'receipt table is closed to browser roles and immutable to service role'
  );
  perform pg_temp.ok(
    (select md5(prosrc) from pg_proc where oid='public.is_admin_user()'::regprocedure)
      = 'dc5465a20a4246c6921be0469e261a8b',
    'is_admin_user remains byte-for-byte unchanged in replay'
  );
end $proof$;

\echo 'ISSUE-3802 WAVE6 CLICKUP IMPORT ADVERSARIAL PASS'
rollback;

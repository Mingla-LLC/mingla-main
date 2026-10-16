-- Issue #3802 Wave 6 — import-safe provenance for the one-time ClickUp calendar load.
BEGIN;

-- Production and replay fixtures do not necessarily carry the same historical
-- function body. Preserve the body that exists in the environment being migrated.
SELECT set_config(
  'issue3802.wave6_admin_fn_md5',
  (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.is_admin_user()'::regprocedure),
  true
);

ALTER TABLE public.content_calendar_items
  ADD COLUMN source_system text,
  ADD COLUMN source_id text,
  ADD CONSTRAINT content_calendar_source_pair_check
    CHECK ((source_system IS NULL) = (source_id IS NULL)),
  ADD CONSTRAINT content_calendar_source_system_check
    CHECK (source_system IS NULL OR source_system ~ '^[a-z][a-z0-9_]{0,31}$'),
  ADD CONSTRAINT content_calendar_source_id_check
    CHECK (source_id IS NULL OR (
      char_length(source_id) BETWEEN 1 AND 200
      AND source_id = btrim(source_id)
      AND source_id !~ '[[:cntrl:]]'
    ));

-- Manual cards retain the original active-title guarantee. Imported cards use
-- source identity because legacy titles are not unique.
DROP INDEX public.content_calendar_items_title_key_unique;
CREATE UNIQUE INDEX content_calendar_items_manual_title_key_unique
  ON public.content_calendar_items (title_key)
  WHERE deleted_at IS NULL AND source_system IS NULL;
CREATE UNIQUE INDEX content_calendar_items_source_identity_unique
  ON public.content_calendar_items (source_system, source_id)
  WHERE source_system IS NOT NULL;

CREATE FUNCTION public.content_calendar_source_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.source_system IS DISTINCT FROM OLD.source_system
     OR NEW.source_id IS DISTINCT FROM OLD.source_id THEN
    RAISE EXCEPTION 'source_identity_locked: Imported source identity cannot be changed or removed.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_source_identity_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER content_calendar_source_identity_before_update
  BEFORE UPDATE ON public.content_calendar_items
  FOR EACH ROW EXECUTE FUNCTION public.content_calendar_source_identity_guard();

CREATE TABLE public.content_calendar_import_receipts (
  source_system  text NOT NULL,
  source_scope   text NOT NULL,
  artifact_sha256 text NOT NULL,
  expected_count integer NOT NULL,
  imported_count integer NOT NULL,
  applied_by     text NOT NULL,
  applied_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, source_scope),
  CONSTRAINT content_calendar_import_source_system_check
    CHECK (source_system ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT content_calendar_import_scope_check
    CHECK (char_length(source_scope) BETWEEN 1 AND 200
      AND source_scope = btrim(source_scope)
      AND source_scope !~ '[[:cntrl:]]'),
  CONSTRAINT content_calendar_import_hash_check
    CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT content_calendar_import_count_check
    CHECK (expected_count > 0 AND imported_count = expected_count),
  CONSTRAINT content_calendar_import_actor_check
    CHECK (char_length(btrim(applied_by)) BETWEEN 3 AND 320)
);

ALTER TABLE public.content_calendar_import_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_calendar_import_receipts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.content_calendar_import_receipts FROM service_role;
GRANT SELECT, INSERT ON public.content_calendar_import_receipts TO service_role;

COMMENT ON COLUMN public.content_calendar_items.source_system IS
  'Issue #3802. Stable provenance namespace for a service-role import; null for cards created in Mingla.';
COMMENT ON COLUMN public.content_calendar_items.source_id IS
  'Issue #3802. Immutable source record identifier paired with source_system.';
COMMENT ON TABLE public.content_calendar_import_receipts IS
  'Issue #3802. Closed, hash-bound receipts for exact one-time content calendar imports.';

DO $$
DECLARE
  v_saved text := current_setting('issue3802.wave6_admin_fn_md5', true);
BEGIN
  IF v_saved IS NULL OR v_saved = '' OR
     (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.is_admin_user()'::regprocedure) IS DISTINCT FROM v_saved THEN
    RAISE EXCEPTION 'issue 3802 wave6 self-check: is_admin_user changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.content_calendar_items'::regclass
      AND t.tgname = 'content_calendar_source_identity_before_update'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'issue 3802 wave6 self-check: source identity trigger missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.indexname = 'content_calendar_items_source_identity_unique'
      AND i.indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION 'issue 3802 wave6 self-check: source identity uniqueness missing';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
          WHERE c.oid = 'public.content_calendar_import_receipts'::regclass)
     OR has_table_privilege('authenticated', 'public.content_calendar_import_receipts', 'select')
     OR has_table_privilege('anon', 'public.content_calendar_import_receipts', 'select')
     OR has_table_privilege('service_role', 'public.content_calendar_import_receipts', 'update')
     OR has_table_privilege('service_role', 'public.content_calendar_import_receipts', 'delete')
     OR has_table_privilege('service_role', 'public.content_calendar_import_receipts', 'truncate') THEN
    RAISE EXCEPTION 'issue 3802 wave6 self-check: import receipts are not closed';
  END IF;
END;
$$;

COMMIT;

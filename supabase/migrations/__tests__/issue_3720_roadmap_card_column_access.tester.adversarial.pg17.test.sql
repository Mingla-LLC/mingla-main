-- #3720 — roadmap card column access, adversarial proof against the replayed database.
-- MINGLA-INVARIANT: I-3720-ROADMAP-INTERNAL-NOTE-ADMIN-ONLY | issue #3720 | Signed-in users read published roadmap cards without the internal_note column; only an Admin read returns the note.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('37200000-0000-4000-8000-000000000a01', 'roadmap-acl-admin@test.local', now()),
  ('37200000-0000-4000-8000-000000000a02', 'roadmap-acl-host@test.local', now());
INSERT INTO public.admin_users(email, role, status) VALUES
  ('roadmap-acl-admin@test.local', 'admin', 'active');
INSERT INTO public.community_roadmap_cards(id, public_title, public_body, internal_note, lane, status, sort_order)
VALUES
  ('37200000-0000-4000-8000-000000000b01', 'Published roadmap card', 'Visible body', 'staff-only published note', 'now', 'published', 9001),
  ('37200000-0000-4000-8000-000000000b02', 'Draft roadmap card', 'Draft body', 'staff-only draft note', 'next', 'draft', 9002);

DO $proof$
DECLARE
  v_denied boolean;
  v_rows integer;
  v_note text;
  v_title text;
BEGIN
  -- Structural: no table-wide SELECT and no internal_note column grant for client roles.
  IF has_table_privilege('authenticated', 'public.community_roadmap_cards', 'SELECT')
     OR has_column_privilege('authenticated', 'public.community_roadmap_cards', 'internal_note', 'SELECT')
     OR has_column_privilege('anon', 'public.community_roadmap_cards', 'internal_note', 'SELECT') THEN
    RAISE EXCEPTION 'internal_note_column_still_granted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.community_roadmap_cards'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'internal_note'
       AND NOT has_column_privilege('authenticated', 'public.community_roadmap_cards', a.attname, 'SELECT')
  ) THEN
    RAISE EXCEPTION 'public_columns_lost_for_authenticated';
  END IF;

  -- A signed-in host.
  PERFORM set_config('request.jwt.claim.sub', '37200000-0000-4000-8000-000000000a02', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  v_denied := false;
  BEGIN
    SELECT internal_note INTO v_note FROM public.community_roadmap_cards
     WHERE id = '37200000-0000-4000-8000-000000000b01';
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'host_read_internal_note'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.community_roadmap_cards;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'host_select_star_allowed'; END IF;

  v_denied := false;
  BEGIN
    SELECT count(*) INTO v_rows FROM public.community_roadmap_cards
     WHERE internal_note ILIKE '%staff-only%';
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'host_filtered_on_internal_note'; END IF;

  SELECT public_title INTO v_title FROM public.community_roadmap_cards
   WHERE id = '37200000-0000-4000-8000-000000000b01';
  IF v_title IS DISTINCT FROM 'Published roadmap card' THEN
    RAISE EXCEPTION 'host_lost_published_card';
  END IF;
  SELECT count(*) INTO v_rows FROM public.community_roadmap_cards
   WHERE id = '37200000-0000-4000-8000-000000000b02';
  IF v_rows <> 0 THEN RAISE EXCEPTION 'host_saw_draft_card'; END IF;
  SELECT count(*) INTO v_rows FROM public.community_roadmap_public
   WHERE id = '37200000-0000-4000-8000-000000000b01';
  IF v_rows <> 1 THEN RAISE EXCEPTION 'host_public_view_broken'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.issue_3720_admin_list_roadmap_cards();
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'host_used_admin_roadmap_read'; END IF;
  RESET ROLE;

  -- Anonymous callers cannot reach the Admin read at all.
  SET LOCAL ROLE anon;
  v_denied := false;
  BEGIN
    PERFORM * FROM public.issue_3720_admin_list_roadmap_cards();
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'anon_used_admin_roadmap_read'; END IF;
  RESET ROLE;

  -- An Admin still sees and edits internal notes, on drafts too.
  PERFORM set_config('request.jwt.claim.sub', '37200000-0000-4000-8000-000000000a01', true);
  SET LOCAL ROLE authenticated;
  SELECT internal_note INTO v_note FROM public.issue_3720_admin_list_roadmap_cards()
   WHERE id = '37200000-0000-4000-8000-000000000b02';
  IF v_note IS DISTINCT FROM 'staff-only draft note' THEN
    RAISE EXCEPTION 'admin_lost_internal_note';
  END IF;
  PERFORM public.community_upsert_roadmap_card(
    '37200000-0000-4000-8000-000000000b01', 'Published roadmap card', 'Visible body',
    'edited staff note', 'now', 'published'
  );
  SELECT internal_note INTO v_note FROM public.issue_3720_admin_list_roadmap_cards()
   WHERE id = '37200000-0000-4000-8000-000000000b01';
  IF v_note IS DISTINCT FROM 'edited staff note' THEN
    RAISE EXCEPTION 'admin_could_not_edit_internal_note';
  END IF;
  v_denied := false;
  BEGIN
    SELECT internal_note INTO v_note FROM public.community_roadmap_cards
     WHERE id = '37200000-0000-4000-8000-000000000b01';
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'direct_table_note_read_allowed_for_admin_session'; END IF;
  RESET ROLE;
END;
$proof$;

ROLLBACK;

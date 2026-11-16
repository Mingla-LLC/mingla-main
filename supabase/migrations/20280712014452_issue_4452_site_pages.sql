-- Issue #4452 M2 site_pages (spec Part 2 §1.2): placements on usemingla.com.
--
-- Pages are not a table: the site publishes site-manifest.json at build. Staff
-- content is keyed by page_key ('creators', 'locals', 'schedule', the seven
-- host ICP keys, 'host-template' for "all host pages", or any manifest key for
-- a pop-up). An unknown key or spot is harmless: the site drops it.
--
--   1. site_page_drafts, site_page_versions (immutable), site_page_live,
--      site_preview_tokens (only a sha256 of the one-hour token is stored).
--   2. site_validate_content: the PageContent rules (one block per spot, one
--      pop-up, the details step only on /schedule with a book_call_extra form,
--      plain text only, the drawn length limits).
--   3. The admin_site_page_* RPCs (PT409 page_conflict on a stale publish) and
--      the two anon reads site_public_content() and site_public_preview(token).
--   4. The site-media bucket (5 MiB, JPEG/PNG/WebP; never /render/image #1643).
--
-- ROLLBACK (manual, after M5 → M4 → M3):
--   DROP FUNCTION IF EXISTS public.site_public_preview(text), public.site_public_content(),
--     public.site_public_form(jsonb), public.admin_site_page_create_preview_token(text,jsonb),
--     public.admin_site_page_restore(text,integer,integer), public.admin_site_page_history(text,integer),
--     public.admin_site_page_mark_revalidated(text,text), public.admin_site_page_publish(text,integer,text),
--     public.admin_site_page_discard_draft(text), public.admin_site_page_save_draft(text,integer,jsonb),
--     public.admin_site_page_get(text), public.admin_site_pages_state(), public.site_content_changes(jsonb,jsonb),
--     public.site_validate_content(text,jsonb), public.site_valid_dest(jsonb), public.site_plain_ok(jsonb,integer,boolean),
--     public.forms_staff_name(uuid);
--   DROP POLICY IF EXISTS issue_4452_site_media_public_read ON storage.objects;
--   DROP POLICY IF EXISTS issue_4452_site_media_editor_insert ON storage.objects;
--   DROP POLICY IF EXISTS issue_4452_site_media_editor_delete ON storage.objects;
--   DROP TABLE IF EXISTS public.site_preview_tokens, public.site_page_live, public.site_page_versions, public.site_page_drafts;
--   (Leave the site-media bucket and its objects; delete them only with Seth's approval.)

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.site_page_drafts (
  page_key       text PRIMARY KEY CHECK (page_key ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  content        jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  rev            integer NOT NULL DEFAULT 1,
  base_version   integer NOT NULL DEFAULT 0,
  updated_by     uuid NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.site_page_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_key       text NOT NULL,
  version        integer NOT NULL CHECK (version >= 1),
  content        jsonb NOT NULL,
  note           text CHECK (note IS NULL OR length(note) <= 200),
  restored_from  integer,
  published_by   uuid NOT NULL,
  published_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_key, version)
);
CREATE TABLE public.site_page_live (
  page_key       text PRIMARY KEY,
  version_id     uuid NOT NULL REFERENCES public.site_page_versions(id) ON DELETE RESTRICT,
  version        integer NOT NULL,
  published_at   timestamptz NOT NULL,
  revalidated_at timestamptz,
  revalidate_error text CHECK (revalidate_error IS NULL OR length(revalidate_error) <= 200)
);
CREATE TABLE public.site_preview_tokens (
  token_hash  text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  page_key    text NOT NULL,
  content     jsonb NOT NULL,
  created_by  uuid NOT NULL,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_page_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_page_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_page_live ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_preview_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_page_drafts, public.site_page_versions, public.site_page_live, public.site_preview_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.site_page_drafts, public.site_page_versions, public.site_page_live, public.site_preview_tokens TO service_role;
CREATE TRIGGER site_page_versions_no_update BEFORE UPDATE OR DELETE ON public.site_page_versions
  FOR EACH ROW EXECUTE FUNCTION public.forms_versions_immutable();

-- ---------------------------------------------------------------------------
-- 2. Validation
-- ---------------------------------------------------------------------------
-- A plain-text string (no HTML, no control characters) of length [min, max];
-- p_optional allows absent/null.
CREATE FUNCTION public.site_plain_ok(p jsonb, p_max integer, p_optional boolean) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) = 'null' THEN p_optional
    WHEN jsonb_typeof(p) <> 'string' THEN false
    ELSE length(p #>> '{}') BETWEEN 1 AND p_max
      AND (p #>> '{}') !~ E'[<>\\x01-\\x1F\\x7F]'
      AND btrim(p #>> '{}') <> '' END
$$;

CREATE FUNCTION public.site_valid_dest(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT jsonb_typeof(p) = 'object' AND CASE p->>'kind'
    WHEN 'app' THEN true
    WHEN 'popup' THEN true
    WHEN 'schedule' THEN true
    WHEN 'schedule_creators' THEN true
    WHEN 'schedule_locals' THEN true
    WHEN 'form_page' THEN COALESCE(p->>'form_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
    WHEN 'url' THEN COALESCE(jsonb_typeof(p->'href') = 'string' AND length(p->>'href') <= 300
                    AND p->>'href' ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]<>"]*)?$', false)
    ELSE false END
$$;

CREATE FUNCTION public.site_validate_content(p_page_key text, p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_err   jsonb := '[]'::jsonb;
  v_b     jsonb;
  v_i     integer;
  v_p     text;
  v_spots text[] := ARRAY[]::text[];
  v_ids   text[] := ARRAY[]::text[];
  v_popups integer := 0;
  v_type  text;
  v_spot  text;
  v_tpl   text;
  v_pu    jsonb;
  v_hero  jsonb;
  v_host  boolean := p_page_key IN ('events','trips','experiences','restaurants','hotels','art','play','host-template');
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('path', '', 'code', 'not_object')));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('blocks','hero')) THEN
    v_err := v_err || jsonb_build_object('path', '', 'code', 'unknown_key');
  END IF;
  IF jsonb_typeof(p->'blocks') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'blocks') > 20 THEN
    v_err := v_err || jsonb_build_object('path', 'blocks', 'code', 'bad_blocks');
  ELSE
    FOR v_i IN 0 .. jsonb_array_length(p->'blocks') - 1 LOOP
      v_b := p->'blocks'->v_i;
      v_p := format('blocks[%s]', v_i);
      IF jsonb_typeof(v_b) <> 'object' THEN
        v_err := v_err || jsonb_build_object('path', v_p, 'code', 'bad_block'); CONTINUE;
      END IF;
      v_type := v_b->>'type';
      v_spot := v_b->>'spot';
      IF COALESCE(v_b->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR (v_b->>'id') = ANY (v_ids) THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.id', 'code', 'bad_id');
      ELSE
        v_ids := v_ids || (v_b->>'id');
      END IF;
      IF v_type IS NULL OR v_type NOT IN ('form','buttons','banner','popup') THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.type', 'code', 'bad_type'); CONTINUE;
      END IF;
      IF v_spot IS NULL OR (v_spot !~ '^[a-z0-9-]{2,48}$') THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.spot', 'code', 'bad_spot'); CONTINUE;
      END IF;
      IF (v_type = 'popup') <> (v_spot = 'popup') THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.spot', 'code', 'popup_spot');
      END IF;
      IF v_spot = 'details-step' THEN
        IF p_page_key <> 'schedule' OR v_type <> 'form' THEN
          v_err := v_err || jsonb_build_object('path', v_p || '.spot', 'code', 'details_step_schedule_only');
        END IF;
      END IF;
      IF v_spot = ANY (v_spots) THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.spot', 'code', 'spot_taken');   -- "That spot already has a block."
      ELSE
        v_spots := v_spots || v_spot;
      END IF;
      IF v_type = 'popup' THEN v_popups := v_popups + 1; END IF;
      IF v_b ? 'all_host_pages' AND (jsonb_typeof(v_b->'all_host_pages') <> 'boolean'
           OR (v_b->'all_host_pages' = 'true'::jsonb AND NOT v_host)) THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.all_host_pages', 'code', 'not_template_page');
      END IF;
      -- Fields per type.
      IF v_type IN ('form','popup') THEN
        IF COALESCE(v_b->>'form_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          v_err := v_err || jsonb_build_object('path', v_p || '.form_id', 'code', 'bad_form');
        ELSE
          SELECT f.template INTO v_tpl FROM public.forms f WHERE f.id = (v_b->>'form_id')::uuid;
          IF NOT FOUND THEN
            v_err := v_err || jsonb_build_object('path', v_p || '.form_id', 'code', 'bad_form');
          ELSIF v_spot = 'details-step' AND v_tpl IS DISTINCT FROM 'book_call_extra' THEN
            v_err := v_err || jsonb_build_object('path', v_p || '.form_id', 'code', 'details_step_form');
          ELSIF v_spot <> 'details-step' AND v_tpl = 'book_call_extra' THEN
            v_err := v_err || jsonb_build_object('path', v_p || '.form_id', 'code', 'details_form_elsewhere');
          END IF;
        END IF;
        IF NOT public.site_plain_ok(v_b->'head', 32, true) OR NOT public.site_plain_ok(v_b->'em', 24, true)
           OR NOT public.site_plain_ok(v_b->'sub', 90, true) THEN
          v_err := v_err || jsonb_build_object('path', v_p, 'code', 'bad_text');
        END IF;
      END IF;
      IF v_type = 'popup' THEN
        v_pu := v_b->'popup';
        IF jsonb_typeof(v_pu) IS DISTINCT FROM 'object'
           OR COALESCE(v_pu->>'trigger', '') NOT IN ('scroll_half','after_20s','exit_intent','button_only')
           OR COALESCE(v_pu->>'freq', '') NOT IN ('weekly','visit','every_view')
           OR COALESCE(v_pu->>'devices', '') NOT IN ('all','phone','desktop')
           OR COALESCE(v_pu->>'style', '') NOT IN ('centre','side') THEN
          v_err := v_err || jsonb_build_object('path', v_p || '.popup', 'code', 'bad_popup');
        END IF;
      END IF;
      IF v_type = 'buttons' THEN
        IF jsonb_typeof(v_b->'buttons') IS DISTINCT FROM 'array' OR jsonb_array_length(v_b->'buttons') NOT BETWEEN 1 AND 2
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_b->'buttons') x
                       WHERE NOT public.site_plain_ok(x->'text', 28, false) OR NOT public.site_valid_dest(x->'to')) THEN
          v_err := v_err || jsonb_build_object('path', v_p || '.buttons', 'code', 'bad_buttons');
        END IF;
      END IF;
      IF v_type = 'banner' THEN
        IF NOT public.site_plain_ok(v_b->'text', 60, false) OR NOT public.site_plain_ok(v_b->'btn', 24, false)
           OR NOT COALESCE(public.site_valid_dest(v_b->'to'), false)
           OR (v_b ? 'show_until' AND jsonb_typeof(v_b->'show_until') <> 'null'
               AND NOT public.forms_real_date(v_b->>'show_until')) THEN
          v_err := v_err || jsonb_build_object('path', v_p, 'code', 'bad_banner');
        END IF;
      END IF;
    END LOOP;
  END IF;
  IF v_popups > 1 THEN v_err := v_err || jsonb_build_object('path', 'blocks', 'code', 'one_popup'); END IF;

  v_hero := p->'hero';
  IF v_hero IS NOT NULL AND jsonb_typeof(v_hero) <> 'null' THEN
    IF p_page_key NOT IN ('creators','locals') THEN
      v_err := v_err || jsonb_build_object('path', 'hero', 'code', 'hero_not_editable');
    ELSIF jsonb_typeof(v_hero) <> 'object'
       OR NOT public.site_plain_ok(v_hero->'h1', 48, false) OR NOT public.site_plain_ok(v_hero->'em', 24, true)
       OR NOT public.site_plain_ok(v_hero->'lead', 200, true)
       OR jsonb_typeof(v_hero->'buttons') IS DISTINCT FROM 'array' OR jsonb_array_length(v_hero->'buttons') <> 2
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_hero->'buttons') x
                   WHERE NOT public.site_plain_ok(x->'text', 28, false) OR NOT public.site_valid_dest(x->'to')) THEN
      v_err := v_err || jsonb_build_object('path', 'hero', 'code', 'bad_hero');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', jsonb_array_length(v_err) = 0, 'errors', v_err);
END;
$fn$;

-- The number of blocks that differ between two contents (plus 1 for a hero change).
CREATE FUNCTION public.site_content_changes(p_a jsonb, p_b jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT (SELECT count(*)::integer FROM (
            (SELECT x FROM jsonb_array_elements(COALESCE(p_a->'blocks', '[]'::jsonb)) x
             EXCEPT SELECT y FROM jsonb_array_elements(COALESCE(p_b->'blocks', '[]'::jsonb)) y)
            UNION ALL
            (SELECT y FROM jsonb_array_elements(COALESCE(p_b->'blocks', '[]'::jsonb)) y
             EXCEPT SELECT x FROM jsonb_array_elements(COALESCE(p_a->'blocks', '[]'::jsonb)) x)) d)
       + CASE WHEN COALESCE(p_a->'hero', 'null'::jsonb) IS DISTINCT FROM COALESCE(p_b->'hero', 'null'::jsonb) THEN 1 ELSE 0 END
$$;

CREATE FUNCTION public.forms_staff_name(p_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(NULLIF(btrim(u.raw_user_meta_data->>'full_name'), ''), NULLIF(btrim(u.raw_user_meta_data->>'name'), ''),
                  initcap(split_part(u.email, '@', 1)), 'Someone')
    FROM auth.users u WHERE u.id = p_user
$$;

REVOKE ALL ON FUNCTION public.site_plain_ok(jsonb, integer, boolean), public.site_valid_dest(jsonb),
  public.site_validate_content(text, jsonb), public.site_content_changes(jsonb, jsonb), public.forms_staff_name(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.site_plain_ok(jsonb, integer, boolean), public.site_valid_dest(jsonb),
  public.site_content_changes(jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.site_validate_content(text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.forms_staff_name(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forms_staff_name(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Admin RPCs
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_site_pages_state() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'page_key', k.page_key,
      'live', CASE WHEN l.page_key IS NULL THEN NULL ELSE jsonb_build_object(
        'version', l.version, 'published_at', l.published_at,
        'published_by_name', public.forms_staff_name(v.published_by)) END,
      'draft', CASE WHEN d.page_key IS NULL THEN NULL ELSE jsonb_build_object(
        'rev', d.rev, 'base_version', d.base_version,
        'changes', public.site_content_changes(d.content, COALESCE(v.content, '{"blocks":[]}'::jsonb))) END,
      'revalidate_error', l.revalidate_error) ORDER BY k.page_key)
    FROM (SELECT page_key FROM public.site_page_drafts UNION SELECT page_key FROM public.site_page_live) k
    LEFT JOIN public.site_page_live l ON l.page_key = k.page_key
    LEFT JOIN public.site_page_versions v ON v.id = l.version_id
    LEFT JOIN public.site_page_drafts d ON d.page_key = k.page_key), '[]'::jsonb);
END;
$fn$;

CREATE FUNCTION public.admin_site_page_get(p_page_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_live jsonb;
  v_ver integer;
  v_d public.site_page_drafts;
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT v.content, l.version INTO v_live, v_ver FROM public.site_page_live l
    JOIN public.site_page_versions v ON v.id = l.version_id WHERE l.page_key = p_page_key;
  SELECT * INTO v_d FROM public.site_page_drafts WHERE page_key = p_page_key;
  RETURN jsonb_build_object(
    'live_content', COALESCE(v_live, '{"blocks":[]}'::jsonb),
    'live_version', COALESCE(v_ver, 0),
    'draft_content', v_d.content,
    'draft_rev', v_d.rev,
    'base_version', v_d.base_version,
    'can_edit', public.forms_can_edit());
END;
$fn$;

CREATE FUNCTION public.admin_site_page_save_draft(p_page_key text, p_expected_rev integer, p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_check jsonb;
  v_rev integer;
  v_live integer;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF p_page_key IS NULL OR p_page_key !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'bad_page' USING ERRCODE = '22023';
  END IF;
  v_check := public.site_validate_content(p_page_key, p_content);
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'invalid_content' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_page:' || p_page_key, 0));
  SELECT rev INTO v_rev FROM public.site_page_drafts WHERE page_key = p_page_key FOR UPDATE;
  IF NOT FOUND THEN
    IF COALESCE(p_expected_rev, 0) <> 0 THEN
      RAISE EXCEPTION 'page_draft_conflict' USING ERRCODE = 'PT409';
    END IF;
    SELECT version INTO v_live FROM public.site_page_live WHERE page_key = p_page_key;
    INSERT INTO public.site_page_drafts (page_key, content, rev, base_version, updated_by)
    VALUES (p_page_key, p_content, 1, COALESCE(v_live, 0), auth.uid());
    RETURN jsonb_build_object('rev', 1);
  END IF;
  IF v_rev <> p_expected_rev THEN
    RAISE EXCEPTION 'page_draft_conflict' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.site_page_drafts SET content = p_content, rev = rev + 1, updated_by = auth.uid(), updated_at = now()
   WHERE page_key = p_page_key;
  RETURN jsonb_build_object('rev', v_rev + 1);
END;
$fn$;

CREATE FUNCTION public.admin_site_page_discard_draft(p_page_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.site_page_drafts WHERE page_key = p_page_key;
  RETURN jsonb_build_object('discarded', FOUND);
END;
$fn$;

-- Shared by publish and restore: insert version n+1 with p_content as live.
CREATE FUNCTION public.site_page_put_live(p_page_key text, p_expected_live_version integer, p_content jsonb,
                                          p_note text, p_restored_from integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_cur public.site_page_live;
  v_by uuid;
  v_next integer;
  v_vid uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_page:' || p_page_key, 0));
  SELECT * INTO v_cur FROM public.site_page_live WHERE page_key = p_page_key FOR UPDATE;
  IF COALESCE(v_cur.version, 0) <> COALESCE(p_expected_live_version, 0) THEN
    SELECT published_by INTO v_by FROM public.site_page_versions WHERE id = v_cur.version_id;
    RAISE EXCEPTION 'page_conflict' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('code', 'page_conflict', 'live_version', v_cur.version,
                                  'published_by', public.forms_staff_name(v_by),
                                  'published_at', v_cur.published_at)::text;
  END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v_next FROM public.site_page_versions WHERE page_key = p_page_key;
  INSERT INTO public.site_page_versions (page_key, version, content, note, restored_from, published_by)
  VALUES (p_page_key, v_next, p_content, left(p_note, 200), p_restored_from, auth.uid())
  RETURNING id INTO v_vid;
  INSERT INTO public.site_page_live (page_key, version_id, version, published_at)
  VALUES (p_page_key, v_vid, v_next, now())
  ON CONFLICT (page_key) DO UPDATE SET version_id = EXCLUDED.version_id, version = EXCLUDED.version,
    published_at = EXCLUDED.published_at, revalidated_at = NULL, revalidate_error = NULL;
  RETURN jsonb_build_object('version', v_next);
END;
$fn$;
REVOKE ALL ON FUNCTION public.site_page_put_live(text, integer, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_page_put_live(text, integer, jsonb, text, integer) TO service_role;

CREATE FUNCTION public.admin_site_page_publish(p_page_key text, p_expected_live_version integer, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_d public.site_page_drafts;
  v_check jsonb;
  v_res jsonb;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_d FROM public.site_page_drafts WHERE page_key = p_page_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_draft' USING ERRCODE = '22023'; END IF;
  v_check := public.site_validate_content(p_page_key, v_d.content);
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'invalid_content' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;
  v_res := public.site_page_put_live(p_page_key, p_expected_live_version, v_d.content, p_note, NULL);
  DELETE FROM public.site_page_drafts WHERE page_key = p_page_key;
  RETURN v_res;
END;
$fn$;

CREATE FUNCTION public.admin_site_page_mark_revalidated(p_page_key text, p_error text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  UPDATE public.site_page_live
     SET revalidated_at = CASE WHEN p_error IS NULL THEN now() ELSE revalidated_at END,
         revalidate_error = left(p_error, 200)
   WHERE page_key = p_page_key;
END;
$fn$;

CREATE FUNCTION public.admin_site_page_history(p_page_key text, p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'version', v.version, 'published_at', v.published_at,
      'published_by_name', public.forms_staff_name(v.published_by),
      'note', v.note, 'restored_from', v.restored_from,
      'is_live', l.version_id = v.id,
      'blocks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('type', b->>'type', 'spot', b->>'spot')), '[]'::jsonb)
                   FROM jsonb_array_elements(COALESCE(v.content->'blocks', '[]'::jsonb)) b),
      'hero', v.content ? 'hero' AND jsonb_typeof(v.content->'hero') = 'object') ORDER BY v.version DESC)
    FROM (SELECT * FROM public.site_page_versions WHERE page_key = p_page_key
           ORDER BY version DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) v
    LEFT JOIN public.site_page_live l ON l.page_key = v.page_key), '[]'::jsonb);
END;
$fn$;

CREATE FUNCTION public.admin_site_page_restore(p_page_key text, p_version integer, p_expected_live_version integer)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_content jsonb;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT content INTO v_content FROM public.site_page_versions WHERE page_key = p_page_key AND version = p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'version_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN public.site_page_put_live(p_page_key, p_expected_live_version, v_content, NULL, p_version);
END;
$fn$;

CREATE FUNCTION public.admin_site_page_create_preview_token(p_page_key text, p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_check jsonb;
  v_token text;
  v_expires timestamptz := now() + interval '1 hour';
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF p_page_key IS NULL OR p_page_key !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'bad_page' USING ERRCODE = '22023';
  END IF;
  v_check := public.site_validate_content(p_page_key, p_content);
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'invalid_content' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;
  -- The #4137 blog token: 32 random bytes, url-safe base64 (43 chars); only the sha256 is stored.
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  INSERT INTO public.site_preview_tokens (token_hash, page_key, content, created_by, expires_at)
  VALUES (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_page_key, p_content, auth.uid(), v_expires);
  RETURN jsonb_build_object('token', v_token, 'expires_at', v_expires);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_site_pages_state(), public.admin_site_page_get(text),
  public.admin_site_page_save_draft(text, integer, jsonb), public.admin_site_page_discard_draft(text),
  public.admin_site_page_publish(text, integer, text), public.admin_site_page_mark_revalidated(text, text),
  public.admin_site_page_history(text, integer), public.admin_site_page_restore(text, integer, integer),
  public.admin_site_page_create_preview_token(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_site_pages_state(), public.admin_site_page_get(text),
  public.admin_site_page_save_draft(text, integer, jsonb), public.admin_site_page_discard_draft(text),
  public.admin_site_page_publish(text, integer, text), public.admin_site_page_mark_revalidated(text, text),
  public.admin_site_page_history(text, integer), public.admin_site_page_restore(text, integer, integer),
  public.admin_site_page_create_preview_token(text, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Anonymous reads for the site
-- ---------------------------------------------------------------------------
-- PublicFormDefinition: no routing (owners, pipeline), no team inboxes, no automation.
CREATE FUNCTION public.site_public_form(p_def jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'v', p_def->'v', 'audience', p_def->'audience', 'fields', p_def->'fields', 'design', p_def->'design',
    'own_page', p_def->'own_page', 'prefill', p_def->'prefill',
    'ads', jsonb_build_object('lead_on', p_def->'ads'->'lead_on', 'goal', p_def->'ads'->'goal')))
$$;
REVOKE ALL ON FUNCTION public.site_public_form(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_public_form(jsonb) TO service_role;

CREATE FUNCTION public.site_public_forms() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_object_agg(f.id, public.site_public_form(v.definition) || jsonb_build_object(
           'id', f.id, 'key', f.key, 'name', f.name, 'version', v.version, 'template', f.template,
           'slug', (SELECT s.slug FROM public.form_page_slugs s WHERE s.form_id = f.id AND s.is_current))), '{}'::jsonb)
    FROM public.forms f JOIN public.form_versions v ON v.id = f.live_version_id
   WHERE f.status = 'live'
$$;
REVOKE ALL ON FUNCTION public.site_public_forms() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_public_forms() TO service_role;

CREATE FUNCTION public.site_public_content() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'pages', COALESCE((SELECT jsonb_object_agg(l.page_key, v.content)
                         FROM public.site_page_live l JOIN public.site_page_versions v ON v.id = l.version_id), '{}'::jsonb),
    'forms', public.site_public_forms(),
    'form_pages', COALESCE((SELECT jsonb_object_agg(s.slug, jsonb_build_object(
                     'form_id', s.form_id,
                     'current_slug', (SELECT c.slug FROM public.form_page_slugs c WHERE c.form_id = s.form_id AND c.is_current)))
                     FROM public.form_page_slugs s JOIN public.forms f ON f.id = s.form_id
                    WHERE f.status = 'live'
                      AND EXISTS (SELECT 1 FROM public.form_page_slugs c WHERE c.form_id = s.form_id AND c.is_current)), '{}'::jsonb))
$$;

CREATE FUNCTION public.site_public_preview(p_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_t public.site_preview_tokens;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_t FROM public.site_preview_tokens
   WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('page_key', v_t.page_key, 'content', v_t.content, 'expires_at', v_t.expires_at,
    -- A draft form in a preview renders from its draft (staff are previewing it).
    'forms', public.site_public_forms() || COALESCE((
      SELECT jsonb_object_agg(f.id, public.site_public_form(f.draft) || jsonb_build_object(
               'id', f.id, 'key', f.key, 'name', f.name, 'version', 0, 'template', f.template, 'preview', true))
        FROM public.forms f
       WHERE f.status <> 'archived'
         AND f.id IN (SELECT (b->>'form_id')::uuid FROM jsonb_array_elements(COALESCE(v_t.content->'blocks', '[]'::jsonb)) b
                       WHERE b->>'form_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
         AND (f.status <> 'live')), '{}'::jsonb),
    'changes', public.site_content_changes(v_t.content, COALESCE((
      SELECT v.content FROM public.site_page_live l JOIN public.site_page_versions v ON v.id = l.version_id
       WHERE l.page_key = v_t.page_key), '{"blocks":[]}'::jsonb)));
END;
$fn$;

REVOKE ALL ON FUNCTION public.site_public_content(), public.site_public_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.site_public_content(), public.site_public_preview(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.site_public_content() IS '#4452: live page blocks, live forms (no routing owners, inboxes or automation) and form page slugs for usemingla.com. Anonymous read.';
COMMENT ON FUNCTION public.site_public_preview(text) IS '#4452: the content behind a one-hour preview token; NULL for an expired, unknown or malformed token.';

-- ---------------------------------------------------------------------------
-- 5. The site-media bucket (the #4137 blog-media pattern)
-- ---------------------------------------------------------------------------
DO $bucket$
DECLARE
  has_public boolean;
  has_file_size_limit boolean;
  has_allowed_mime_types boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public') INTO has_public;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit') INTO has_file_size_limit;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types') INTO has_allowed_mime_types;
  IF has_public AND has_file_size_limit AND has_allowed_mime_types THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('site-media', 'site-media', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('site-media', 'site-media', true)
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
  ELSE
    INSERT INTO storage.buckets (id, name) VALUES ('site-media', 'site-media')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  END IF;
END
$bucket$;

DROP POLICY IF EXISTS issue_4452_site_media_public_read ON storage.objects;
CREATE POLICY issue_4452_site_media_public_read
  ON storage.objects FOR SELECT
  USING (bucket_id = 'site-media');

DROP POLICY IF EXISTS issue_4452_site_media_editor_insert ON storage.objects;
CREATE POLICY issue_4452_site_media_editor_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'site-media'
    AND public.forms_can_edit()
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS issue_4452_site_media_editor_delete ON storage.objects;
CREATE POLICY issue_4452_site_media_editor_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site-media' AND public.forms_can_edit());

COMMIT;

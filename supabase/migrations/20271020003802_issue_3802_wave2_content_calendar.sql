-- Issue #3802 Wave 2 — one closed content calendar for the four team roles.
-- Calendar, Board, List, the browser and the connector all use these same
-- functions. This migration imports no legacy task data.
BEGIN;

CREATE TABLE public.content_calendar_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  title_key      text GENERATED ALWAYS AS (public.crm_name_key(title)) STORED,
  stage          text NOT NULL DEFAULT 'idea',
  owner_emails   text[] NOT NULL DEFAULT ARRAY[]::text[],
  publish_at     timestamptz,
  channels       text[] NOT NULL DEFAULT ARRAY[]::text[],
  copy_text      text,
  notes          text,
  drive_url      text,
  live_url       text,
  copy_approved_by text,
  copy_approved_at timestamptz,
  design_approved_by text,
  design_approved_at timestamptz,
  published_without_link boolean NOT NULL DEFAULT false,
  format         text,
  audience       text,
  city_id        uuid,
  revision       bigint NOT NULL DEFAULT 1,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_by     text,
  deleted_at     timestamptz,
  CONSTRAINT content_calendar_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT content_calendar_title_key_check CHECK (title_key <> ''),
  CONSTRAINT content_calendar_stage_check CHECK (stage IN ('idea','writing','design','review','scheduled','published')),
  CONSTRAINT content_calendar_owners_check CHECK (cardinality(owner_emails) <= 10),
  CONSTRAINT content_calendar_channels_check CHECK (
    cardinality(channels) <= 9 AND channels <@ ARRAY['instagram','tiktok','facebook','x','threads','youtube','linkedin','website','email']::text[]),
  CONSTRAINT content_calendar_copy_check CHECK (char_length(COALESCE(copy_text, '')) <= 20000),
  CONSTRAINT content_calendar_notes_check CHECK (char_length(COALESCE(notes, '')) <= 20000),
  CONSTRAINT content_calendar_drive_check CHECK (drive_url IS NULL OR (char_length(drive_url) <= 2000 AND drive_url ~ '^https?://')),
  CONSTRAINT content_calendar_live_check CHECK (live_url IS NULL OR (char_length(live_url) <= 2000 AND live_url ~ '^https?://')),
  CONSTRAINT content_calendar_format_check CHECK (format IS NULL OR format IN ('graphic','carousel','short_video','long_video','story','talking_head','motion_graphics','photo_ugc','blog','email','landing_page')),
  CONSTRAINT content_calendar_audience_check CHECK (audience IS NULL OR audience IN ('explorer','business','education_investor')),
  CONSTRAINT content_calendar_revision_check CHECK (revision > 0),
  CONSTRAINT content_calendar_copy_approval_pair_check CHECK ((copy_approved_by IS NULL) = (copy_approved_at IS NULL)),
  CONSTRAINT content_calendar_design_approval_pair_check CHECK ((design_approved_by IS NULL) = (design_approved_at IS NULL)),
  CONSTRAINT content_calendar_copy_gate_check CHECK (
    stage IN ('idea','writing') OR
    (NULLIF(btrim(COALESCE(copy_text,'')),'') IS NOT NULL AND copy_approved_by IS NOT NULL AND copy_approved_at IS NOT NULL)),
  CONSTRAINT content_calendar_schedule_gate_check CHECK (
    stage NOT IN ('scheduled','published') OR
    (design_approved_by IS NOT NULL AND design_approved_at IS NOT NULL AND publish_at IS NOT NULL AND cardinality(channels) > 0)),
  CONSTRAINT content_calendar_publish_gate_check CHECK (
    stage <> 'published' OR live_url IS NOT NULL OR published_without_link)
);
CREATE INDEX content_calendar_items_by_publish ON public.content_calendar_items (publish_at, id) WHERE deleted_at IS NULL;
CREATE INDEX content_calendar_items_by_stage ON public.content_calendar_items (stage, updated_at DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX content_calendar_items_title_key_unique ON public.content_calendar_items (title_key) WHERE deleted_at IS NULL;

CREATE FUNCTION public.content_calendar_item_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE v_old_stage integer; v_new_stage integer;
BEGIN
  IF TG_OP='UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    SELECT ord INTO v_old_stage FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=OLD.stage;
    SELECT ord INTO v_new_stage FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=NEW.stage;
    IF v_new_stage < v_old_stage THEN
      IF v_new_stage <= 2 THEN
        NEW.copy_approved_by:=NULL; NEW.copy_approved_at:=NULL;
        NEW.design_approved_by:=NULL; NEW.design_approved_at:=NULL;
      ELSIF v_new_stage <= 4 THEN
        NEW.design_approved_by:=NULL; NEW.design_approved_at:=NULL;
      END IF;
      NEW.published_without_link:=false;
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND OLD.stage NOT IN ('idea','writing') AND NEW.copy_text IS DISTINCT FROM OLD.copy_text THEN
    RAISE EXCEPTION 'copy_locked: Copy is read-only after Writing. Move the card back to Writing to revise it.' USING ERRCODE='22023';
  END IF;
  IF NEW.stage NOT IN ('idea','writing') AND
     (NULLIF(btrim(COALESCE(NEW.copy_text,'')),'') IS NULL OR NEW.copy_approved_by IS NULL OR NEW.copy_approved_at IS NULL) THEN
    RAISE EXCEPTION 'copy_approval_required: Design and later stages require approved copy.' USING ERRCODE='22023';
  END IF;
  IF NEW.stage IN ('scheduled','published') AND
     (NEW.design_approved_by IS NULL OR NEW.design_approved_at IS NULL OR NEW.publish_at IS NULL OR cardinality(NEW.channels)=0) THEN
    RAISE EXCEPTION 'schedule_required: Scheduled and Published require approved design, a publish date and at least one channel.' USING ERRCODE='22023';
  END IF;
  IF NEW.stage='published' AND NEW.live_url IS NULL AND NOT NEW.published_without_link THEN
    RAISE EXCEPTION 'live_link_required: Published needs a live link or the explicit without-link decision.' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_item_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER content_calendar_item_guard_before
  BEFORE INSERT OR UPDATE ON public.content_calendar_items
  FOR EACH ROW EXECUTE FUNCTION public.content_calendar_item_guard();

CREATE TABLE public.content_calendar_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES public.content_calendar_items(id) ON DELETE CASCADE,
  body         text NOT NULL,
  actor_email  text NOT NULL,
  via          text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_calendar_comment_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  CONSTRAINT content_calendar_comment_via_check CHECK (via IS NULL OR via IN ('claude','codex'))
);
CREATE INDEX content_calendar_comments_by_item ON public.content_calendar_comments (item_id, created_at, id);

CREATE TABLE public.content_calendar_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid REFERENCES public.content_calendar_items(id) ON DELETE SET NULL,
  actor_email  text NOT NULL,
  via          text,
  action       text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_calendar_audit_via_check CHECK (via IS NULL OR via IN ('claude','codex')),
  CONSTRAINT content_calendar_audit_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object' AND
    NOT (metadata ?| ARRAY['title','copy','copy_text','notes','body','comment','drive_url','live_url','before','after']))
);
CREATE INDEX content_calendar_audit_by_item ON public.content_calendar_audit (item_id, created_at DESC, id DESC);

CREATE TABLE public.content_calendar_request_keys (
  actor_email   text NOT NULL,
  request_key   text NOT NULL,
  operation     text NOT NULL,
  args_digest   text NOT NULL,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_email, request_key),
  CONSTRAINT content_calendar_request_key_format CHECK (request_key ~ '^[A-Za-z0-9_-]{8,90}$'),
  CONSTRAINT content_calendar_request_digest_check CHECK (args_digest ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.content_calendar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_calendar_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_calendar_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_calendar_request_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_calendar_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.content_calendar_comments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.content_calendar_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.content_calendar_request_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.content_calendar_items TO service_role;
GRANT ALL ON public.content_calendar_comments TO service_role;
GRANT ALL ON public.content_calendar_audit TO service_role;
GRANT ALL ON public.content_calendar_request_keys TO service_role;
COMMENT ON TABLE public.content_calendar_items IS 'Issue #3802. Closed content calendar records. Clients use content_calendar_* functions; no legacy data is imported here.';
COMMENT ON TABLE public.content_calendar_comments IS 'Issue #3802. Closed comments on content calendar records.';
COMMENT ON TABLE public.content_calendar_audit IS 'Issue #3802. Person plus optional agent attribution for every content-calendar write.';
COMMENT ON TABLE public.content_calendar_request_keys IS 'Issue #3802. Replay binding for content writes: one actor/key belongs to one operation and one full argument digest.';

-- The browser cannot claim an agent. The connector creates the request row in
-- this transaction first; only then does this context expose claude/codex.
-- Content Calendar follows the existing CRM access shared by all four roles;
-- it does not extend the stable role-area response contract.
CREATE FUNCTION public.content_calendar_ctx()
RETURNS TABLE (actor_email text, via text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_email text;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.admin_team_can('crm'), false) THEN
    RAISE EXCEPTION 'forbidden: Your account cannot use the content calendar. Ask the owner to give you team access.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'forbidden: Your account cannot use the content calendar. Ask the owner to give you team access.' USING ERRCODE = '42501';
  END IF;
  actor_email := v_email;
  via := (SELECT c.agent FROM public.team_agent_calls c
           WHERE c.xact_id = pg_current_xact_id_if_assigned()
             AND c.actor_uid = auth.uid()
           ORDER BY c.started_at DESC LIMIT 1);
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_ctx() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_calendar_ctx() TO service_role;

CREATE FUNCTION public.content_calendar_stages() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT '[{"id":"idea","label":"Idea"},{"id":"writing","label":"Writing"},{"id":"design","label":"Design"},{"id":"review","label":"Review"},{"id":"scheduled","label":"Scheduled"},{"id":"published","label":"Published"}]'::jsonb
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_stages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_calendar_stages() TO service_role;

CREATE FUNCTION public.content_calendar_item_json(r public.content_calendar_items) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'title', r.title, 'stage', r.stage, 'owners', to_jsonb(r.owner_emails),
    'publish_at', r.publish_at, 'channels', to_jsonb(r.channels), 'copy', r.copy_text,
    'notes', r.notes, 'drive_url', r.drive_url, 'live_url', r.live_url,
    'copy_approved_by', r.copy_approved_by, 'copy_approved_at', r.copy_approved_at,
    'design_approved_by', r.design_approved_by, 'design_approved_at', r.design_approved_at,
    'published_without_link', r.published_without_link,
    'format', r.format, 'audience', r.audience, 'city_id', r.city_id,
    'city_name', (SELECT c.name FROM public.seeding_cities c WHERE c.id = r.city_id),
    'revision', r.revision, 'created_by', r.created_by, 'created_at', r.created_at,
    'updated_by', r.updated_by, 'updated_at', r.updated_at,
    'comment_count', (SELECT count(*) FROM public.content_calendar_comments c WHERE c.item_id = r.id))
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_item_json(public.content_calendar_items) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_calendar_item_json(public.content_calendar_items) TO service_role;

CREATE FUNCTION public.content_calendar_audit_write(
  p_item_id uuid, p_actor text, p_via text, p_action text, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.content_calendar_audit (item_id, actor_email, via, action, metadata)
  VALUES (p_item_id, p_actor, p_via, p_action, COALESCE(p_metadata, '{}'::jsonb)) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_audit_write(uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_calendar_audit_write(uuid,text,text,text,jsonb) TO service_role;

CREATE FUNCTION public.content_calendar_request_begin(
  p_actor text, p_request_key text, p_operation text, p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_digest text; v_row public.content_calendar_request_keys;
BEGIN
  IF p_request_key IS NULL THEN RETURN NULL; END IF;
  IF p_request_key !~ '^[A-Za-z0-9_-]{8,90}$' THEN
    RAISE EXCEPTION 'request_key_required: Send 8 to 90 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  v_digest := encode(extensions.digest(convert_to(COALESCE(p_args, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.content_calendar_request_keys (actor_email, request_key, operation, args_digest)
  VALUES (p_actor, p_request_key, p_operation, v_digest)
  ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN NULL; END IF;
  SELECT * INTO STRICT v_row FROM public.content_calendar_request_keys k
   WHERE k.actor_email = p_actor AND k.request_key = p_request_key FOR UPDATE;
  IF v_row.operation IS DISTINCT FROM p_operation OR v_row.args_digest IS DISTINCT FROM v_digest THEN
    RAISE EXCEPTION 'request_key_reused: That request key already belongs to another action or different details. Use a new key.' USING ERRCODE = '22023';
  END IF;
  IF v_row.response IS NULL THEN
    RAISE EXCEPTION 'try_again: The first request did not finish. Send the same request again.' USING ERRCODE = '40001';
  END IF;
  RETURN v_row.response || jsonb_build_object('replayed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_request_begin(text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_calendar_request_begin(text,text,text,jsonb) TO service_role;

CREATE FUNCTION public.content_calendar_request_finish(
  p_actor text, p_request_key text, p_operation text, p_response jsonb
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_request_key IS NULL THEN RETURN; END IF;
  UPDATE public.content_calendar_request_keys k SET response = p_response
   WHERE k.actor_email = p_actor AND k.request_key = p_request_key
     AND k.operation = p_operation AND k.response IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'try_again: The request could not be recorded safely. Send the same request again.' USING ERRCODE = '40001';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_request_finish(text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_calendar_request_finish(text,text,text,jsonb) TO service_role;

CREATE FUNCTION public.content_calendar_config() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  RETURN jsonb_build_object(
    'me', jsonb_build_object('email', v.actor_email, 'display_name', public.crm_display_name(v.actor_email),
      'role', public.admin_team_role(), 'can_delete', public.is_admin_user()),
    'stages', public.content_calendar_stages(),
    'channels', '[{"id":"instagram","label":"Instagram"},{"id":"tiktok","label":"TikTok"},{"id":"facebook","label":"Facebook"},{"id":"x","label":"X"},{"id":"threads","label":"Threads"},{"id":"youtube","label":"YouTube"},{"id":"linkedin","label":"LinkedIn"},{"id":"website","label":"Website"},{"id":"email","label":"Email"}]'::jsonb,
    'formats', '[{"id":"graphic","label":"Graphic"},{"id":"carousel","label":"Carousel"},{"id":"short_video","label":"Reel / short video"},{"id":"long_video","label":"Long-form video"},{"id":"story","label":"Story"},{"id":"talking_head","label":"Talking head"},{"id":"motion_graphics","label":"Motion graphics"},{"id":"photo_ugc","label":"Photo dump / UGC"},{"id":"blog","label":"Blog"},{"id":"email","label":"Email"},{"id":"landing_page","label":"Landing page"}]'::jsonb,
    'audiences', '[{"id":"explorer","label":"Explorer"},{"id":"business","label":"Business"},{"id":"education_investor","label":"Education / Investor"}]'::jsonb,
    'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name, c.id) FROM public.seeding_cities c), '[]'::jsonb),
    'team', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', d.email, 'display_name', public.crm_display_name(d.email), 'role', d.role) ORDER BY (d.role='owner') DESC, d.email) FROM public.admin_team_directory() d WHERE d.status = 'active'), '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_calendar_config() TO authenticated, service_role;

CREATE FUNCTION public.content_calendar_list(p_query jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; v_q text; v_stage text; v_owner text; v_mine boolean := false; v_limit integer := 500; v_rows jsonb; v_total bigint;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_query) k WHERE k NOT IN ('q','stage','owner','mine','limit','from','to','undated')) THEN
    RAISE EXCEPTION 'invalid_query: Use q, stage, owner, mine, limit, from, to or undated.' USING ERRCODE = '22023';
  END IF;
  v_q := NULLIF(btrim(COALESCE(p_query->>'q','')), '');
  v_stage := NULLIF(p_query->>'stage','');
  v_owner := NULLIF(lower(btrim(COALESCE(p_query->>'owner',''))), '');
  IF p_query ? 'mine' THEN
    IF jsonb_typeof(p_query->'mine') <> 'boolean' THEN RAISE EXCEPTION 'invalid_query: mine must be true or false.' USING ERRCODE='22023'; END IF;
    v_mine := (p_query->>'mine')::boolean;
  END IF;
  IF p_query ? 'undated' AND jsonb_typeof(p_query->'undated') <> 'boolean' THEN
    RAISE EXCEPTION 'invalid_query: undated must be true or false.' USING ERRCODE='22023';
  END IF;
  IF p_query ? 'limit' THEN
    IF jsonb_typeof(p_query->'limit') <> 'number' OR (p_query->>'limit') !~ '^\d{1,4}$' THEN RAISE EXCEPTION 'invalid_query: limit must be a whole number.' USING ERRCODE='22023'; END IF;
    v_limit := (p_query->>'limit')::integer;
  END IF;
  IF v_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_query: limit must be from 1 to 500.' USING ERRCODE='22023'; END IF;
  IF v_stage IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.content_calendar_stages()) s WHERE s->>'id'=v_stage) THEN
    RAISE EXCEPTION 'invalid_stage: Use Idea, Writing, Design, Review, Scheduled or Published.' USING ERRCODE='22023';
  END IF;
  WITH chosen AS (
    SELECT i.* FROM public.content_calendar_items i
    WHERE i.deleted_at IS NULL
      AND (v_q IS NULL OR position(lower(v_q) IN lower(i.title || ' ' || COALESCE(i.copy_text,'') || ' ' || COALESCE(i.notes,''))) > 0)
      AND (v_stage IS NULL OR i.stage = v_stage)
      AND (v_owner IS NULL OR v_owner = ANY(i.owner_emails))
      AND (NOT v_mine OR v.actor_email = ANY(i.owner_emails))
      AND (NOT COALESCE((p_query->>'undated')::boolean, false) OR i.publish_at IS NULL)
      AND (NOT (p_query ? 'from') OR i.publish_at >= (p_query->>'from')::timestamptz)
      AND (NOT (p_query ? 'to') OR i.publish_at < (p_query->>'to')::timestamptz)
  ), page AS (
    SELECT c.* FROM chosen c ORDER BY c.publish_at ASC NULLS LAST, c.updated_at DESC, c.id LIMIT v_limit
  )
  SELECT (SELECT count(*) FROM chosen), COALESCE((SELECT jsonb_agg(public.content_calendar_item_json(p) ORDER BY p.publish_at ASC NULLS LAST, p.updated_at DESC, p.id) FROM page p), '[]'::jsonb)
    INTO v_total, v_rows;
  RETURN jsonb_build_object('items', v_rows, 'total', v_total, 'truncated', v_total > v_limit);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'invalid_query: from and to must be date-times.' USING ERRCODE='22023';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_list(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_calendar_list(jsonb) TO authenticated, service_role;

CREATE FUNCTION public.content_calendar_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; v_item public.content_calendar_items;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('item', public.content_calendar_item_json(v_item), 'comments', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'actor_email', c.actor_email,
      'display_name', public.crm_display_name(c.actor_email), 'via', c.via, 'created_at', c.created_at)
      ORDER BY c.created_at, c.id) FROM public.content_calendar_comments c WHERE c.item_id=v_item.id), '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_get(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_calendar_get(uuid) TO authenticated, service_role;

CREATE FUNCTION public.content_calendar_duplicate_check(p_title text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; v_key text; v_exact jsonb; v_similar jsonb;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_key := public.crm_name_key(regexp_replace(btrim(COALESCE(p_title,'')), '\s+', ' ', 'g'));
  IF v_key IS NULL OR v_key = '' THEN RETURN '{"exact":null,"similar":[]}'::jsonb; END IF;
  SELECT jsonb_build_object('id',i.id,'title',i.title,'stage',i.stage) INTO v_exact
    FROM public.content_calendar_items i WHERE i.deleted_at IS NULL AND i.title_key=v_key LIMIT 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'stage',s.stage) ORDER BY s.title,s.id),'[]'::jsonb)
    INTO v_similar
    FROM (SELECT i.id,i.title,i.stage FROM public.content_calendar_items i
           WHERE i.deleted_at IS NULL AND i.title_key<>v_key
             AND char_length(v_key)>=3 AND char_length(i.title_key)>=3
             AND (position(v_key IN i.title_key)>0 OR position(i.title_key IN v_key)>0)
           ORDER BY i.title,i.id LIMIT 5) s;
  RETURN jsonb_build_object('exact',v_exact,'similar',v_similar);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_duplicate_check(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_calendar_duplicate_check(text) TO authenticated, service_role;

CREATE FUNCTION public.content_calendar_create(p_title text, p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; v_item public.content_calendar_items; v_replay jsonb; v_out jsonb; v_audit uuid;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_replay := public.content_calendar_request_begin(v.actor_email, p_request_key, 'create', jsonb_build_object('title', p_title));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid_title: Title must be 1 to 160 characters.' USING ERRCODE='22023';
  END IF;
  IF public.crm_name_key(p_title) = '' THEN
    RAISE EXCEPTION 'invalid_title: Title must contain visible letters or numbers.' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.content_calendar_items i WHERE i.deleted_at IS NULL AND i.title_key=public.crm_name_key(p_title)) THEN
    RAISE EXCEPTION 'duplicate_title: That title is already on the content calendar. Open the existing card instead.' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.content_calendar_items (title, owner_emails, created_by, updated_by)
  VALUES (btrim(p_title), ARRAY[v.actor_email], v.actor_email, v.actor_email) RETURNING * INTO v_item;
  v_audit := public.content_calendar_audit_write(v_item.id, v.actor_email, v.via, 'content.created',
    jsonb_build_object('to_revision',v_item.revision,'changed_fields',jsonb_build_array('title','owners','stage')));
  v_out := jsonb_build_object('item', public.content_calendar_item_json(v_item), 'audit_id', v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email, p_request_key, 'create', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_title: That title is already on the content calendar. Open the existing card instead.' USING ERRCODE='23505';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_create(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_calendar_create(text,text) TO authenticated, service_role;

CREATE FUNCTION public.content_calendar_update(
  p_id uuid, p_changes jsonb, p_expected_revision bigint, p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v record; v_item public.content_calendar_items; v_after jsonb; v_replay jsonb; v_out jsonb;
  v_args jsonb; v_audit uuid; v_action text := 'content.updated'; v_value text; v_channels text[];
  v_fields text[]; v_before_publish timestamptz;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_args := jsonb_build_object('id', p_id, 'changes', p_changes, 'expected_revision', p_expected_revision);
  v_replay := public.content_calendar_request_begin(v.actor_email, p_request_key, 'update', v_args);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN
       ('title','publish_at','channels','copy','notes','drive_url','live_url','format','audience','city_id')) THEN
    RAISE EXCEPTION 'invalid_changes: Send at least one supported field.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR v_item.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then apply your change again.' USING ERRCODE='40001';
  END IF;
  v_before_publish := v_item.publish_at;
  SELECT array_agg(k ORDER BY k) INTO v_fields FROM jsonb_object_keys(p_changes) k;
  IF p_changes ? 'title' THEN
    IF jsonb_typeof(p_changes->'title') <> 'string' OR char_length(btrim(p_changes->>'title')) NOT BETWEEN 1 AND 160 THEN
      RAISE EXCEPTION 'invalid_title: Title must be 1 to 160 characters.' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.content_calendar_items i WHERE i.id<>p_id AND i.deleted_at IS NULL
                 AND i.title_key=public.crm_name_key(p_changes->>'title')) THEN
      RAISE EXCEPTION 'duplicate_title: That title is already on the content calendar. Open the existing card instead.' USING ERRCODE='23505';
    END IF;
    v_item.title := btrim(p_changes->>'title');
  END IF;
  IF p_changes ? 'publish_at' THEN
    IF jsonb_typeof(p_changes->'publish_at') = 'null' THEN v_item.publish_at := NULL;
    ELSIF jsonb_typeof(p_changes->'publish_at') <> 'string' THEN RAISE EXCEPTION 'invalid_publish_at: Use a date-time or null.' USING ERRCODE='22023';
    ELSE v_item.publish_at := (p_changes->>'publish_at')::timestamptz; END IF;
  END IF;
  IF p_changes ? 'channels' THEN
    IF jsonb_typeof(p_changes->'channels') <> 'array' OR jsonb_array_length(p_changes->'channels') > 9
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes->'channels') e
                   WHERE jsonb_typeof(e) <> 'string' OR e#>>'{}' NOT IN ('instagram','tiktok','facebook','x','threads','youtube','linkedin','website','email')) THEN
      RAISE EXCEPTION 'invalid_channels: Choose only supported channels.' USING ERRCODE='22023'; END IF;
    SELECT COALESCE(array_agg(DISTINCT e ORDER BY e), ARRAY[]::text[]) INTO v_channels
      FROM jsonb_array_elements_text(p_changes->'channels') e;
    v_item.channels := v_channels;
  END IF;
  IF p_changes ? 'copy' THEN
    IF v_item.stage NOT IN ('idea','writing') THEN
      RAISE EXCEPTION 'copy_locked: Copy is read-only after Writing. Move the card back to Writing to revise it.' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(p_changes->'copy') NOT IN ('string','null') OR char_length(COALESCE(p_changes->>'copy','')) > 20000 THEN
      RAISE EXCEPTION 'invalid_copy: Copy must be at most 20,000 characters.' USING ERRCODE='22023'; END IF;
    v_item.copy_text := NULLIF(p_changes->>'copy','');
  END IF;
  IF p_changes ? 'notes' THEN
    IF jsonb_typeof(p_changes->'notes') NOT IN ('string','null') OR char_length(COALESCE(p_changes->>'notes','')) > 20000 THEN
      RAISE EXCEPTION 'invalid_notes: Notes must be at most 20,000 characters.' USING ERRCODE='22023'; END IF;
    v_item.notes := NULLIF(p_changes->>'notes','');
  END IF;
  FOREACH v_value IN ARRAY ARRAY['drive_url','live_url'] LOOP
    IF p_changes ? v_value THEN
      IF jsonb_typeof(p_changes->v_value) NOT IN ('string','null') OR char_length(COALESCE(p_changes->>v_value,'')) > 2000
         OR (NULLIF(p_changes->>v_value,'') IS NOT NULL AND (p_changes->>v_value) !~ '^https?://') THEN
        RAISE EXCEPTION 'invalid_url: Links must start with http:// or https:// and be at most 2,000 characters.' USING ERRCODE='22023'; END IF;
      IF v_value='drive_url' THEN v_item.drive_url := NULLIF(p_changes->>v_value,'');
      ELSE v_item.live_url := NULLIF(p_changes->>v_value,''); END IF;
    END IF;
  END LOOP;
  IF p_changes ? 'format' THEN
    IF jsonb_typeof(p_changes->'format') NOT IN ('string','null') OR (NULLIF(p_changes->>'format','') IS NOT NULL
       AND p_changes->>'format' NOT IN ('graphic','carousel','short_video','long_video','story','talking_head','motion_graphics','photo_ugc','blog','email','landing_page')) THEN
      RAISE EXCEPTION 'invalid_format: Choose a supported format.' USING ERRCODE='22023'; END IF;
    v_item.format := NULLIF(p_changes->>'format','');
  END IF;
  IF p_changes ? 'audience' THEN
    IF jsonb_typeof(p_changes->'audience') NOT IN ('string','null') OR (NULLIF(p_changes->>'audience','') IS NOT NULL
       AND p_changes->>'audience' NOT IN ('explorer','business','education_investor')) THEN
      RAISE EXCEPTION 'invalid_audience: Choose a supported audience.' USING ERRCODE='22023'; END IF;
    v_item.audience := NULLIF(p_changes->>'audience','');
  END IF;
  IF p_changes ? 'city_id' THEN
    IF jsonb_typeof(p_changes->'city_id')='null' OR NULLIF(p_changes->>'city_id','') IS NULL THEN v_item.city_id := NULL;
    ELSIF jsonb_typeof(p_changes->'city_id') <> 'string' OR NOT EXISTS (SELECT 1 FROM public.seeding_cities c WHERE c.id=(p_changes->>'city_id')::uuid) THEN
      RAISE EXCEPTION 'invalid_city: Choose a listed city.' USING ERRCODE='22023';
    ELSE v_item.city_id := (p_changes->>'city_id')::uuid; END IF;
  END IF;
  IF v_item.stage NOT IN ('idea','writing') AND
     (NULLIF(btrim(COALESCE(v_item.copy_text,'')),'') IS NULL OR v_item.copy_approved_at IS NULL OR v_item.copy_approved_by IS NULL) THEN
    RAISE EXCEPTION 'copy_approval_required: Design and later stages require approved copy.' USING ERRCODE='22023';
  END IF;
  IF v_item.stage IN ('scheduled','published') AND
     (v_item.design_approved_at IS NULL OR v_item.design_approved_by IS NULL OR v_item.publish_at IS NULL OR cardinality(v_item.channels)=0) THEN
    RAISE EXCEPTION 'schedule_required: Scheduled and Published require approved design, a publish date and at least one channel.' USING ERRCODE='22023';
  END IF;
  IF v_item.stage='published' AND v_item.live_url IS NULL AND NOT v_item.published_without_link THEN
    RAISE EXCEPTION 'live_link_required: Add the live link, or explicitly publish without one.' USING ERRCODE='22023';
  END IF;
  UPDATE public.content_calendar_items SET title=v_item.title, publish_at=v_item.publish_at, channels=v_item.channels,
    copy_text=v_item.copy_text, notes=v_item.notes, drive_url=v_item.drive_url, live_url=v_item.live_url,
    format=v_item.format, audience=v_item.audience, city_id=v_item.city_id, revision=revision+1,
    updated_by=v.actor_email, updated_at=now() WHERE id=p_id RETURNING * INTO v_item;
  v_after := public.content_calendar_item_json(v_item);
  IF v_fields = ARRAY['publish_at']::text[] THEN v_action := 'content.rescheduled'; END IF;
  v_audit := public.content_calendar_audit_write(p_id, v.actor_email, v.via, v_action,
    jsonb_build_object('changed_fields',to_jsonb(v_fields),'from_revision',p_expected_revision,'to_revision',v_item.revision) ||
    CASE WHEN v_action='content.rescheduled' THEN jsonb_build_object('previous_publish_at',v_before_publish) ELSE '{}'::jsonb END);
  v_out := jsonb_build_object('item', v_after, 'audit_id', v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email, p_request_key, 'update', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_title: That title is already on the content calendar. Open the existing card instead.' USING ERRCODE='23505';
WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
  RAISE EXCEPTION 'invalid_changes: A date or identifier has the wrong shape.' USING ERRCODE='22023';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_update(uuid,jsonb,bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_calendar_update(uuid,jsonb,bigint,text) TO authenticated, service_role;

CREATE FUNCTION public.content_calendar_assign(
  p_id uuid, p_owner_emails text[], p_expected_revision bigint, p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; v_item public.content_calendar_items; v_owners text[]; v_replay jsonb; v_out jsonb; v_audit uuid;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_replay := public.content_calendar_request_begin(v.actor_email, p_request_key, 'assign',
    jsonb_build_object('id',p_id,'owner_emails',p_owner_emails,'expected_revision',p_expected_revision));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(x)) ORDER BY lower(btrim(x))), ARRAY[]::text[]) INTO v_owners FROM unnest(COALESCE(p_owner_emails,ARRAY[]::text[])) x WHERE btrim(x)<>'';
  IF cardinality(v_owners) > 10 OR EXISTS (SELECT 1 FROM unnest(v_owners) x WHERE NOT EXISTS
      (SELECT 1 FROM public.admin_team_directory() d WHERE d.email=x AND d.status='active')) THEN
    RAISE EXCEPTION 'invalid_owners: Choose at most 10 active team members.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR v_item.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then apply your change again.' USING ERRCODE='40001'; END IF;
  UPDATE public.content_calendar_items SET owner_emails=v_owners, revision=revision+1, updated_by=v.actor_email, updated_at=now()
    WHERE id=p_id RETURNING * INTO v_item;
  v_audit := public.content_calendar_audit_write(p_id,v.actor_email,v.via,'content.assigned',
    jsonb_build_object('changed_fields',jsonb_build_array('owners'),'from_revision',p_expected_revision,'to_revision',v_item.revision));
  v_out := jsonb_build_object('item',public.content_calendar_item_json(v_item),'audit_id',v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email,p_request_key,'assign',v_out);
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_assign(uuid,text[],bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_calendar_assign(uuid,text[],bigint,text) TO authenticated, service_role;

CREATE FUNCTION public.content_calendar_move(
  p_id uuid, p_to text, p_expected_revision bigint, p_approve_copy boolean DEFAULT false,
  p_approve_design boolean DEFAULT false, p_publish_without_link boolean DEFAULT false, p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v record; v_item public.content_calendar_items; v_replay jsonb; v_out jsonb; v_audit uuid;
  v_from_idx integer; v_to_idx integer; v_now timestamptz := clock_timestamp();
  v_previous_copy_by text; v_previous_copy_at timestamptz;
  v_previous_design_by text; v_previous_design_at timestamptz; v_previous_without_link boolean;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_replay := public.content_calendar_request_begin(v.actor_email,p_request_key,'move',jsonb_build_object(
    'id',p_id,'to',p_to,'expected_revision',p_expected_revision,'approve_copy',COALESCE(p_approve_copy,false),
    'approve_design',COALESCE(p_approve_design,false),'publish_without_link',COALESCE(p_publish_without_link,false)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR v_item.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then apply your change again.' USING ERRCODE='40001'; END IF;
  SELECT ord INTO v_from_idx FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=v_item.stage;
  SELECT ord INTO v_to_idx FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=p_to;
  IF v_to_idx IS NULL THEN RAISE EXCEPTION 'invalid_stage: Use Idea, Writing, Design, Review, Scheduled or Published.' USING ERRCODE='22023'; END IF;
  IF v_to_idx=v_from_idx THEN RAISE EXCEPTION 'no_change: That card is already in this stage.' USING ERRCODE='22023'; END IF;
  IF v_to_idx > v_from_idx + 1 THEN RAISE EXCEPTION 'stage_order: Move forward one stage at a time.' USING ERRCODE='22023'; END IF;
  v_previous_copy_by:=v_item.copy_approved_by; v_previous_copy_at:=v_item.copy_approved_at;
  v_previous_design_by:=v_item.design_approved_by; v_previous_design_at:=v_item.design_approved_at;
  v_previous_without_link:=v_item.published_without_link;
  IF v_item.stage='writing' AND p_to='design' THEN
    IF NULLIF(btrim(COALESCE(v_item.copy_text,'')),'') IS NULL THEN RAISE EXCEPTION 'copy_required: Add copy before Design.' USING ERRCODE='22023'; END IF;
    IF NOT COALESCE(p_approve_copy,false) THEN RAISE EXCEPTION 'copy_approval_required: Approve the copy before Design.' USING ERRCODE='22023'; END IF;
    v_item.copy_approved_by:=v.actor_email; v_item.copy_approved_at:=v_now;
  ELSIF v_item.stage='review' AND p_to='scheduled' THEN
    IF v_item.publish_at IS NULL OR cardinality(v_item.channels)=0 THEN RAISE EXCEPTION 'schedule_required: Add a publish date, time and at least one channel.' USING ERRCODE='22023'; END IF;
    IF NOT COALESCE(p_approve_design,false) THEN RAISE EXCEPTION 'design_approval_required: Approve the design before Scheduled.' USING ERRCODE='22023'; END IF;
    v_item.design_approved_by:=v.actor_email; v_item.design_approved_at:=v_now;
  ELSIF v_item.stage='scheduled' AND p_to='published' AND v_item.live_url IS NULL AND NOT COALESCE(p_publish_without_link,false) THEN
    RAISE EXCEPTION 'live_link_required: Add the live link, or explicitly publish without one.' USING ERRCODE='22023';
  END IF;
  IF v_to_idx<v_from_idx THEN
    IF v_to_idx<=2 THEN
      v_item.copy_approved_by:=NULL; v_item.copy_approved_at:=NULL;
      v_item.design_approved_by:=NULL; v_item.design_approved_at:=NULL;
    ELSIF v_to_idx<=4 THEN
      v_item.design_approved_by:=NULL; v_item.design_approved_at:=NULL;
    END IF;
  END IF;
  v_item.published_without_link := p_to='published' AND v_item.live_url IS NULL AND COALESCE(p_publish_without_link,false);
  UPDATE public.content_calendar_items SET stage=p_to,
    copy_approved_by=v_item.copy_approved_by,copy_approved_at=v_item.copy_approved_at,
    design_approved_by=v_item.design_approved_by,design_approved_at=v_item.design_approved_at,
    published_without_link=v_item.published_without_link,
    revision=revision+1,updated_by=v.actor_email,updated_at=now()
    WHERE id=p_id RETURNING * INTO v_item;
  v_audit := public.content_calendar_audit_write(p_id,v.actor_email,v.via,'content.stage_move',jsonb_build_object(
    'previous_stage',(SELECT stage FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE ord=v_from_idx),
    'next_stage',p_to,'from_revision',p_expected_revision,'to_revision',v_item.revision,
    'previous_copy_approved_by',v_previous_copy_by,'previous_copy_approved_at',v_previous_copy_at,
    'previous_design_approved_by',v_previous_design_by,'previous_design_approved_at',v_previous_design_at,
    'previous_published_without_link',v_previous_without_link,
    'copy_approved_by',v_item.copy_approved_by,'copy_approved_at',v_item.copy_approved_at,
    'design_approved_by',v_item.design_approved_by,'design_approved_at',v_item.design_approved_at,
    'published_without_link',v_item.published_without_link));
  v_out := jsonb_build_object('item',public.content_calendar_item_json(v_item),'audit_id',v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email,p_request_key,'move',v_out);
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_move(uuid,text,bigint,boolean,boolean,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_calendar_move(uuid,text,bigint,boolean,boolean,boolean,text) TO authenticated, service_role;

CREATE FUNCTION public.content_calendar_comment_add(p_id uuid, p_body text, p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; v_comment public.content_calendar_comments; v_replay jsonb; v_out jsonb; v_audit uuid;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_replay := public.content_calendar_request_begin(v.actor_email,p_request_key,'comment',jsonb_build_object('id',p_id,'body',p_body));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_body IS NULL OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'invalid_comment: Comment must be 1 to 4,000 characters.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL) THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.content_calendar_comments(item_id,body,actor_email,via) VALUES(p_id,btrim(p_body),v.actor_email,v.via) RETURNING * INTO v_comment;
  v_audit := public.content_calendar_audit_write(p_id,v.actor_email,v.via,'content.commented',jsonb_build_object('comment_id',v_comment.id));
  v_out := jsonb_build_object('comment',jsonb_build_object('id',v_comment.id,'body',v_comment.body,'actor_email',v_comment.actor_email,
    'display_name',public.crm_display_name(v_comment.actor_email),'via',v_comment.via,'created_at',v_comment.created_at),'audit_id',v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email,p_request_key,'comment',v_out);
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_comment_add(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_calendar_comment_add(uuid,text,text) TO authenticated, service_role;

CREATE FUNCTION public.content_calendar_undo(p_audit_id uuid, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; v_a public.content_calendar_audit; v_item public.content_calendar_items; v_new_audit uuid;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  SELECT * INTO v_a FROM public.content_calendar_audit a WHERE a.id=p_audit_id AND a.actor_email=v.actor_email
    AND a.action IN ('content.stage_move','content.rescheduled') AND a.created_at >= now()-interval '8 seconds';
  IF NOT FOUND THEN RAISE EXCEPTION 'undo_expired: Undo is only available to the person who made the change, for 8 seconds.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=v_a.item_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR v_item.revision<>p_expected_revision OR (v_a.metadata->>'to_revision')::bigint<>p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This card changed after that action, so it cannot be undone safely.' USING ERRCODE='40001'; END IF;
  IF v_a.action='content.stage_move' THEN
    v_item.stage := v_a.metadata->>'previous_stage';
    v_item.copy_approved_by := v_a.metadata->>'previous_copy_approved_by';
    v_item.copy_approved_at := (v_a.metadata->>'previous_copy_approved_at')::timestamptz;
    v_item.design_approved_by := v_a.metadata->>'previous_design_approved_by';
    v_item.design_approved_at := (v_a.metadata->>'previous_design_approved_at')::timestamptz;
    v_item.published_without_link := COALESCE((v_a.metadata->>'previous_published_without_link')::boolean,false);
  ELSE v_item.publish_at := (v_a.metadata->>'previous_publish_at')::timestamptz; END IF;
  UPDATE public.content_calendar_items SET stage=v_item.stage,publish_at=v_item.publish_at,
    copy_approved_by=v_item.copy_approved_by,copy_approved_at=v_item.copy_approved_at,
    design_approved_by=v_item.design_approved_by,design_approved_at=v_item.design_approved_at,
    published_without_link=v_item.published_without_link,revision=revision+1,
    updated_by=v.actor_email,updated_at=now() WHERE id=v_item.id RETURNING * INTO v_item;
  v_new_audit := public.content_calendar_audit_write(v_item.id,v.actor_email,v.via,'content.undo',
    jsonb_build_object('undid_audit_id',p_audit_id,'to_revision',v_item.revision,'restored_stage',v_item.stage));
  RETURN jsonb_build_object('item',public.content_calendar_item_json(v_item),'audit_id',v_new_audit);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_undo(uuid,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_calendar_undo(uuid,bigint) TO authenticated, service_role;

CREATE FUNCTION public.content_calendar_delete(p_id uuid, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; v_item public.content_calendar_items; v_audit uuid;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden: Only the owner or an admin can delete content.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR v_item.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE='40001'; END IF;
  UPDATE public.content_calendar_items SET deleted_at=now(),deleted_by=v.actor_email,revision=revision+1,updated_by=v.actor_email,updated_at=now() WHERE id=p_id RETURNING * INTO v_item;
  v_audit := public.content_calendar_audit_write(p_id,v.actor_email,v.via,'content.deleted',
    jsonb_build_object('from_revision',p_expected_revision,'to_revision',v_item.revision,'changed_fields',jsonb_build_array('deleted_at')));
  RETURN jsonb_build_object('id',p_id,'audit_id',v_audit);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.content_calendar_delete(uuid,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_calendar_delete(uuid,bigint) TO authenticated, service_role;

-- The existing CRM gateway remains byte-for-byte available. Content tools use
-- this small sibling gateway so the calendar remains a separate role area.
CREATE FUNCTION public.team_agent_content_call(p_key_hash text, p_tool text, p_args jsonb, p_client text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET statement_timeout = '25s'
AS $$
DECLARE
  c_tools constant text[] := ARRAY['list_content','add_content','update_content','assign_content','comment_content','move_content'];
  c_writes constant text[] := ARRAY['add_content','update_content','assign_content','comment_content','move_content'];
  v_auth jsonb; v_key uuid; v_owner text; v_uid uuid; v_agent text; v_me jsonb; v_args jsonb;
  v_started timestamptz := clock_timestamp(); v_day timestamptz := date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_lim jsonb := public.team_agent_limits(); v_n bigint; v_oldest timestamptz; v_retry integer; v_call uuid; v_tool text;
  v_token text; v_words text; v_match text[]; v_lock_before text; v_ok boolean := false; v_result jsonb; v_summary jsonb := '{}'::jsonb;
  v_items integer := 0; v_want integer := 0; v_list jsonb; v_one jsonb; v_idx integer; v_rk text; v_claim text; v_replay jsonb;
BEGIN
  v_auth := public.team_agent_resolve(p_key_hash);
  IF v_auth->>'auth' IS DISTINCT FROM 'ok' THEN RETURN '{"auth":"invalid"}'::jsonb; END IF;
  v_key := (v_auth->>'key_id')::uuid; v_owner := v_auth->>'owner_email'; v_uid := (v_auth->>'uid')::uuid;
  v_agent := v_auth->>'agent'; v_me := jsonb_build_object('role',v_auth->>'role','agent',v_agent);
  v_args := CASE WHEN jsonb_typeof(p_args)='object' THEN p_args ELSE '{}'::jsonb END;
  v_tool := CASE WHEN p_tool=ANY(c_tools) THEN p_tool ELSE 'unknown' END;

  v_lock_before := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout',(v_lim->>'key_wait_ms')||'ms',true);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_limit:'||v_key::text,0));
    PERFORM set_config('lock_timeout',v_lock_before,true);
  EXCEPTION WHEN lock_not_available THEN
    PERFORM set_config('lock_timeout',v_lock_before,true);
    INSERT INTO public.team_agent_calls(key_id,owner_email,actor_uid,agent,tool,xact_id,started_at,duration_ms,outcome)
      VALUES(v_key,v_owner,v_uid,v_agent,v_tool,pg_current_xact_id(),v_started,0,'limited');
    RETURN jsonb_build_object('limited',jsonb_build_object('retry_after_s',2,'token','busy','message','Another request from your agent is still running. Wait 2 seconds, then send this one again. Nothing was lost.'),'me',v_me);
  END;
  SELECT count(*),min(c.started_at) INTO v_n,v_oldest FROM public.team_agent_calls c
    WHERE c.key_id=v_key AND c.started_at>v_started-interval '60 seconds' AND c.outcome<>'limited';
  IF v_n >= (v_lim->>'requests_per_minute')::integer THEN
    v_retry := GREATEST(1,LEAST(60,ceil(60-extract(epoch FROM(v_started-v_oldest)))::integer));
    v_token := 'rate_limited'; v_words := format('Your agent has made a lot of requests in the last minute. Wait %s seconds, then carry on. Nothing was lost.',v_retry);
  ELSE
    SELECT count(*) INTO v_n FROM public.team_agent_calls c WHERE c.key_id=v_key AND c.started_at>=v_day AND c.outcome<>'limited' AND c.tool NOT LIKE 'mcp:%';
    IF v_n >= (v_lim->>'tool_calls_per_day')::integer THEN
      v_retry := GREATEST(1,ceil(extract(epoch FROM(v_day+interval '1 day'-v_started)))::integer);
      v_token := 'daily_limit'; v_words := format('Your agent reached today''s limit of %s requests. It resets at midnight UTC. Ask the owner if you need more.',v_lim->>'tool_calls_per_day');
    ELSIF v_tool=ANY(c_writes) THEN
      SELECT COALESCE(sum(c.items),0) INTO v_n FROM public.team_agent_calls c WHERE c.key_id=v_key AND c.started_at>=v_day AND c.outcome<>'limited';
      v_want := CASE WHEN v_tool='add_content' AND jsonb_typeof(v_args->'items')='array' THEN jsonb_array_length(v_args->'items') ELSE 1 END;
      IF v_n+v_want > (v_lim->>'records_written_per_day')::integer THEN
        v_retry := GREATEST(1,ceil(extract(epoch FROM(v_day+interval '1 day'-v_started)))::integer);
        v_token := 'daily_limit'; v_words := 'This request would pass your daily write limit. Send fewer items, or wait until midnight UTC.';
      END IF;
    END IF;
  END IF;
  IF v_token IS NOT NULL THEN
    INSERT INTO public.team_agent_calls(key_id,owner_email,actor_uid,agent,tool,xact_id,started_at,duration_ms,outcome)
      VALUES(v_key,v_owner,v_uid,v_agent,v_tool,pg_current_xact_id(),v_started,0,'limited');
    RETURN jsonb_build_object('limited',jsonb_build_object('retry_after_s',v_retry,'token',v_token,'message',v_words),'me',v_me);
  END IF;
  INSERT INTO public.team_agent_calls(key_id,owner_email,actor_uid,agent,tool,xact_id,started_at)
    VALUES(v_key,v_owner,v_uid,v_agent,v_tool,pg_current_xact_id(),v_started) RETURNING id INTO v_call;
  UPDATE public.team_agent_keys SET last_used_at=v_started,last_used_client=NULLIF(left(regexp_replace(COALESCE(p_client,''),'[[:cntrl:]]','','g'),120),'')
    WHERE id=v_key AND(last_used_at IS NULL OR last_used_at<v_started-interval '60 seconds');
  BEGIN
    PERFORM 1 FROM public.content_calendar_ctx();
    IF v_tool=ANY(c_writes) AND (v_args->>'request_key' IS NULL OR (v_args->>'request_key') !~ '^[A-Za-z0-9_-]{8,70}$') THEN
      RAISE EXCEPTION 'request_key_required: Send 8 to 70 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE='22023';
    END IF;
    CASE v_tool
      WHEN 'list_content' THEN
        IF v_args ? 'id' THEN
          IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_args) k WHERE k<>'id') THEN
            RAISE EXCEPTION 'invalid_arguments: Send id by itself, or filters without id.' USING ERRCODE='22023'; END IF;
          v_result := public.content_calendar_get((v_args->>'id')::uuid);
        ELSE
          v_result := public.content_calendar_list(v_args) || jsonb_build_object('config',public.content_calendar_config());
        END IF;
      WHEN 'add_content' THEN
        v_rk := v_args->>'request_key'; v_list := v_args->'items';
        IF v_rk IS NULL OR v_rk !~ '^[A-Za-z0-9_-]{8,70}$' OR jsonb_typeof(v_list)<>'array' OR jsonb_array_length(v_list) NOT BETWEEN 1 AND 50 THEN
          RAISE EXCEPTION 'invalid_arguments: Send request_key and 1 to 50 items with a title.' USING ERRCODE='22023'; END IF;
        v_claim := v_rk||'_claim';
        v_replay := public.content_calendar_request_begin(v_owner,v_claim,'agent:add_content',v_args);
        IF v_replay IS NOT NULL THEN v_result:=v_replay; v_items:=0;
        ELSE
          v_result := '[]'::jsonb;
          FOR v_one,v_idx IN SELECT value,ordinality::integer FROM jsonb_array_elements(v_list) WITH ORDINALITY LOOP
            IF jsonb_typeof(v_one)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_one) k WHERE k<>'title') THEN
              RAISE EXCEPTION 'invalid_arguments: Each item must contain only title.' USING ERRCODE='22023'; END IF;
            v_result := v_result || jsonb_build_array(public.content_calendar_create(v_one->>'title',v_rk||'_a'||v_idx));
          END LOOP;
          v_items:=jsonb_array_length(v_result); v_result:=jsonb_build_object('items',v_result,'created',v_items);
          PERFORM public.content_calendar_request_finish(v_owner,v_claim,'agent:add_content',v_result);
        END IF;
        v_summary:=jsonb_build_object('created',v_items);
      WHEN 'update_content' THEN
        v_result:=public.content_calendar_update((v_args->>'id')::uuid,v_args->'changes',(v_args->>'expected_revision')::bigint,(v_args->>'request_key')||'_u');
        v_items:=1; v_summary:='{"updated":1}'::jsonb;
      WHEN 'assign_content' THEN
        NULL;
      WHEN 'comment_content' THEN
        v_result:=public.content_calendar_comment_add((v_args->>'id')::uuid,v_args->>'body',(v_args->>'request_key')||'_c');
        v_items:=1; v_summary:='{"commented":1}'::jsonb;
      WHEN 'move_content' THEN
        v_result:=public.content_calendar_move((v_args->>'id')::uuid,v_args->>'to',(v_args->>'expected_revision')::bigint,
          COALESCE((v_args->>'approve_copy')::boolean,false),COALESCE((v_args->>'approve_design')::boolean,false),
          COALESCE((v_args->>'publish_without_link')::boolean,false),(v_args->>'request_key')||'_m');
        v_items:=1; v_summary:='{"moved":1}'::jsonb;
      ELSE RAISE EXCEPTION 'unknown_tool: That tool does not exist. Call tools/list to see what is available.' USING ERRCODE='22023';
    END CASE;
    IF v_tool='assign_content' THEN
      IF jsonb_typeof(v_args->'owner_emails')<>'array' THEN RAISE EXCEPTION 'invalid_arguments: owner_emails must be a list.' USING ERRCODE='22023'; END IF;
      v_result:=public.content_calendar_assign((v_args->>'id')::uuid,ARRAY(SELECT jsonb_array_elements_text(v_args->'owner_emails')),
        (v_args->>'expected_revision')::bigint,(v_args->>'request_key')||'_o');
      v_items:=1; v_summary:='{"updated":1}'::jsonb;
    END IF;
    v_ok:=true;
  EXCEPTION WHEN others THEN
    v_items:=0; v_summary:='{}'::jsonb;
    v_match:=regexp_match(SQLERRM,'^([a-z_]+): (.+)$');
    v_token:=CASE WHEN v_match IS NULL THEN NULL ELSE v_match[1] END;
    v_words:=CASE WHEN v_token IS NULL THEN 'Something went wrong on our side. Nothing was saved. Send the same request again.' ELSE v_match[2] END;
    IF v_token IS NULL THEN v_token:='server_error'; RAISE WARNING 'team_agent_content_call: tool % ended with unexpected error (% %)',v_tool,SQLSTATE,SQLERRM; END IF;
  END;
  UPDATE public.team_agent_calls SET outcome=CASE WHEN v_ok THEN 'ok' ELSE left(v_token,60) END,items=v_items,summary=v_summary,
    duration_ms=LEAST(2147483647,GREATEST(0,round(extract(epoch FROM(clock_timestamp()-v_started))*1000)))::integer WHERE id=v_call;
  IF v_ok THEN RETURN jsonb_build_object('ok',true,'result',v_result,'me',v_me); END IF;
  RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('token',v_token,'message',v_words),'me',v_me);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.team_agent_content_call(text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_agent_content_call(text,text,jsonb,text) TO service_role;
COMMENT ON FUNCTION public.team_agent_content_call(text,text,jsonb,text) IS
  'Issue #3802. The fixed six-tool content-calendar connector gateway. It has no delete tool and records counts only.';

NOTIFY pgrst, 'reload schema';

DO $wave2check$
DECLARE v_fn text; v_table text; v_names text; v_src text;
BEGIN
  IF public.admin_team_role_areas('owner') IS DISTINCT FROM ARRAY['admin_console','team_manage','crm','beta_leads']
     OR public.admin_team_role_areas('admin') IS DISTINCT FROM ARRAY['admin_console','crm','beta_leads']
     OR public.admin_team_role_areas('growth') IS DISTINCT FROM ARRAY['role_home','crm','beta_leads']
     OR public.admin_team_role_areas('partner') IS DISTINCT FROM ARRAY['role_home','crm','beta_leads'] THEN
    RAISE EXCEPTION 'issue 3802 wave2 self-check: role areas changed'; END IF;
  FOREACH v_table IN ARRAY ARRAY['public.content_calendar_items','public.content_calendar_comments','public.content_calendar_audit','public.content_calendar_request_keys'] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid=v_table::regclass)
       OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid=v_table::regclass)
       OR has_table_privilege('authenticated',v_table,'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('anon',v_table,'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'issue 3802 wave2 self-check: % is not closed',v_table; END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.content_calendar_config()','public.content_calendar_list(jsonb)','public.content_calendar_get(uuid)',
    'public.content_calendar_duplicate_check(text)',
    'public.content_calendar_create(text,text)','public.content_calendar_update(uuid,jsonb,bigint,text)',
    'public.content_calendar_assign(uuid,text[],bigint,text)','public.content_calendar_move(uuid,text,bigint,boolean,boolean,boolean,text)',
    'public.content_calendar_comment_add(uuid,text,text)','public.content_calendar_undo(uuid,bigint)','public.content_calendar_delete(uuid,bigint)'] LOOP
    IF NOT has_function_privilege('authenticated',v_fn,'EXECUTE') OR has_function_privilege('anon',v_fn,'EXECUTE') THEN
      RAISE EXCEPTION 'issue 3802 wave2 self-check: client grants changed for %',v_fn; END IF;
  END LOOP;
  IF has_function_privilege('authenticated','public.team_agent_content_call(text,text,jsonb,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.team_agent_content_call(text,text,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'issue 3802 wave2 self-check: connector grants changed'; END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid='public.team_agent_content_call(text,text,jsonb,text)'::regprocedure;
  SELECT string_agg(x,',' ORDER BY x) INTO v_names FROM (SELECT DISTINCT m[1] x FROM regexp_matches(v_src,'''((?:list|add|update|assign|comment|move)_content)''','g') m) s;
  IF v_names IS DISTINCT FROM 'add_content,assign_content,comment_content,list_content,move_content,update_content' OR v_src~'''delete_content''' THEN
    RAISE EXCEPTION 'issue 3802 wave2 self-check: connector tool catalog changed (%)',v_names; END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid='public.content_calendar_delete(uuid,bigint)'::regprocedure;
  IF v_src !~ 'is_admin_user' THEN RAISE EXCEPTION 'issue 3802 wave2 self-check: delete gate changed'; END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid='public.is_admin_user()'::regprocedure) <> 'dc5465a20a4246c6921be0469e261a8b' THEN
    RAISE EXCEPTION 'issue 3802 wave2 self-check: is_admin_user changed'; END IF;
END;
$wave2check$;

COMMIT;

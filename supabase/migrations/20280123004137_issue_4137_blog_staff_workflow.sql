-- #4137 wave 4 — role-guarded staff workflow for the Mingla blog.
-- Static SQL only (#1860 C7). Optimistic conflicts use PT409 (#4134).

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_my_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'can_write', public.issue_4137_blog_can_write(auth.uid()),
    'can_publish', public.issue_4137_blog_can_publish(auth.uid())
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_my_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_my_permissions() TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_my_permissions() IS '#4137: current staff member blog writer/publisher capabilities.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_list_posts(
  p_status text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset, 0), 0), 10000);
  v_posts jsonb;
  v_counts jsonb;
BEGIN
  IF NOT public.issue_4137_blog_can_write(auth.uid()) THEN
    RAISE EXCEPTION 'blog_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('draft', 'in_review', 'scheduled', 'published', 'taken_down', 'unpublished') THEN
    RAISE EXCEPTION 'blog_status_unknown' USING ERRCODE = 'P0001';
  END IF;

  WITH rows AS (
    SELECT post.id, post.slug, draft.title, post.status,
      CASE
        WHEN post.status = 'published' AND post.take_down_at IS NOT NULL AND post.take_down_at <= now() THEN 'taken_down'
        WHEN post.status = 'published' AND post.publish_at > now() THEN 'scheduled'
        ELSE post.status
      END AS derived_state,
      jsonb_build_object('slug', category.slug, 'label', category.label) AS category,
      jsonb_build_object('id', author.id, 'display_name', author.display_name) AS author,
      post.updated_at, post.publish_at,
      (post.published_version_id IS NOT NULL AND post.draft_version_id IS DISTINCT FROM post.published_version_id) AS has_unpublished_changes
    FROM public.blog_posts post
    JOIN public.blog_post_versions draft ON draft.id = post.draft_version_id
    JOIN public.blog_categories category ON category.slug = post.category_slug
    JOIN public.blog_authors author ON author.id = post.author_id
    WHERE post.deleted_at IS NULL
      AND (p_query IS NULL OR btrim(p_query) = '' OR draft.title ILIKE '%' || btrim(p_query) || '%' OR post.slug ILIKE '%' || btrim(p_query) || '%')
  ), filtered AS (
    SELECT * FROM rows WHERE p_status IS NULL OR derived_state = p_status
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.updated_at DESC, page.id), '[]'::jsonb)
  INTO v_posts
  FROM (SELECT * FROM filtered ORDER BY updated_at DESC, id LIMIT v_limit OFFSET v_offset) page;

  SELECT jsonb_build_object(
    'published', count(*) FILTER (WHERE post.status = 'published' AND post.publish_at <= now()
      AND (post.take_down_at IS NULL OR post.take_down_at > now())),
    'scheduled', count(*) FILTER (WHERE post.status = 'published' AND post.publish_at > now()),
    'in_review', count(*) FILTER (WHERE post.status = 'in_review')
  ) INTO v_counts
  FROM public.blog_posts post WHERE post.deleted_at IS NULL;

  RETURN jsonb_build_object('posts', v_posts, 'counts', v_counts);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_list_posts(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_list_posts(text, text, integer, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_list_posts(text, text, integer, integer) IS '#4137: staff post library plus published, scheduled and review counts.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_get_post(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.issue_4137_blog_can_write(auth.uid()) THEN
    RAISE EXCEPTION 'blog_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'post', to_jsonb(post),
    'draft', to_jsonb(draft),
    'published', CASE WHEN published.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', published.id, 'title', published.title, 'summary', published.summary,
      'created_at', published.created_at) END,
    'category', jsonb_build_object('slug', category.slug, 'label', category.label),
    'author', jsonb_build_object('id', author.id, 'display_name', author.display_name),
    'featured', featured.post_id IS NOT NULL,
    'link_check', link_check.payload,
    'audit', CASE WHEN public.issue_4137_blog_can_publish(auth.uid()) THEN COALESCE(audit.items, '[]'::jsonb) ELSE '[]'::jsonb END
  ) INTO v_result
  FROM public.blog_posts post
  JOIN public.blog_post_versions draft ON draft.id = post.draft_version_id
  LEFT JOIN public.blog_post_versions published ON published.id = post.published_version_id
  JOIN public.blog_categories category ON category.slug = post.category_slug
  JOIN public.blog_authors author ON author.id = post.author_id
  LEFT JOIN public.blog_featured featured ON featured.slot = 'blog_index' AND featured.post_id = post.id
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object('id', check_row.id, 'checked_at', check_row.checked_at,
      'ok', check_row.ok, 'results', check_row.results) AS payload
    FROM public.blog_post_link_checks check_row
    WHERE check_row.version_id = post.draft_version_id
    ORDER BY check_row.checked_at DESC LIMIT 1
  ) link_check ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at DESC) AS items
    FROM (SELECT id, actor, action, detail, created_at FROM public.blog_post_audit
      WHERE post_id = post.id ORDER BY created_at DESC LIMIT 30) item
  ) audit ON true
  WHERE post.id = p_post_id AND post.deleted_at IS NULL;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_get_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_get_post(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_get_post(uuid) IS '#4137: editor payload for one non-deleted post.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_create_post(p_title text, p_category text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_post_id uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();
  v_base text;
  v_slug text;
  v_suffix integer := 1;
BEGIN
  IF NOT public.issue_4137_blog_can_write(v_actor) THEN
    RAISE EXCEPTION 'blog_forbidden' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_title, ''))) NOT BETWEEN 1 AND 140 THEN
    RAISE EXCEPTION 'blog_title_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.blog_categories WHERE slug = p_category) THEN
    RAISE EXCEPTION 'blog_category_unknown' USING ERRCODE = 'P0001';
  END IF;
  v_base := trim(both '-' FROM regexp_replace(lower(btrim(p_title)), '[^a-z0-9]+', '-', 'g'));
  IF length(v_base) < 3 OR v_base IN ('category','preview','page','feed','rss','sitemap','search','tag','tags','author','authors','admin','api','new') THEN
    v_base := 'story-' || substr(replace(v_post_id::text, '-', ''), 1, 8);
  END IF;
  v_base := left(v_base, 72);
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.blog_posts WHERE lower(slug) = lower(v_slug) AND deleted_at IS NULL) LOOP
    v_suffix := v_suffix + 1;
    v_slug := left(v_base, 76 - length(v_suffix::text)) || '-' || v_suffix::text;
  END LOOP;

  INSERT INTO public.blog_posts (id, slug, category_slug, created_by)
  VALUES (v_post_id, v_slug, p_category, v_actor);
  INSERT INTO public.blog_post_versions (id, post_id, kind, title, created_by)
  VALUES (v_version_id, v_post_id, 'draft', btrim(p_title), v_actor);
  UPDATE public.blog_posts SET draft_version_id = v_version_id WHERE id = v_post_id;
  INSERT INTO public.blog_post_audit (post_id, actor, action) VALUES (v_post_id, v_actor, 'create');
  RETURN jsonb_build_object('id', v_post_id, 'revision', 1, 'slug', v_slug);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_create_post(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_create_post(text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_create_post(text, text) IS '#4137: create a draft post with a collision-safe slug and empty document.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_save_draft(
  p_post_id uuid,
  p_expected_revision integer,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_post public.blog_posts%ROWTYPE;
  v_draft public.blog_post_versions%ROWTYPE;
  v_new_draft_id uuid;
  v_document jsonb;
  v_slug text;
  v_category text;
  v_take_down_mode text;
  v_take_down_at timestamptz;
  v_take_down_event_id uuid;
  v_topics text[];
  v_allowed text[] := ARRAY['title','summary','cover_media_id','cover_alt','seo_title','seo_description','social_title','social_description','document','slug','category_slug','topics','show_in_more_stories','hide_passed_event_cards','take_down_mode','take_down_at','take_down_event_id'];
  v_unknown text[];
BEGIN
  IF NOT public.issue_4137_blog_can_write(v_actor) THEN
    RAISE EXCEPTION 'blog_forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'blog_patch_invalid' USING ERRCODE = 'P0001';
  END IF;
  SELECT array_agg(key) INTO v_unknown FROM jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) key WHERE NOT key = ANY(v_allowed);
  IF cardinality(COALESCE(v_unknown, '{}')) > 0 THEN
    RAISE EXCEPTION 'blog_patch_invalid' USING ERRCODE = 'P0001', DETAIL = array_to_string(v_unknown, ',');
  END IF;

  SELECT * INTO v_post FROM public.blog_posts WHERE id = p_post_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_post.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'blog_post_stale' USING ERRCODE = 'PT409', DETAIL = v_post.revision::text;
  END IF;
  SELECT * INTO v_draft FROM public.blog_post_versions WHERE id = v_post.draft_version_id;

  v_document := CASE WHEN p_patch ? 'document' THEN p_patch -> 'document' ELSE v_draft.document END;
  IF cardinality(public.issue_4137_blog_document_problems(v_document)) > 0 THEN
    RAISE EXCEPTION 'blog_document_invalid' USING ERRCODE = 'P0001',
      DETAIL = array_to_string(public.issue_4137_blog_document_problems(v_document), ',');
  END IF;
  v_slug := CASE WHEN p_patch ? 'slug' THEN lower(btrim(p_patch ->> 'slug')) ELSE v_post.slug END;
  IF v_post.first_published_at IS NOT NULL AND v_slug IS DISTINCT FROM v_post.slug THEN
    RAISE EXCEPTION 'blog_slug_locked' USING ERRCODE = 'P0001';
  END IF;
  IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_slug) NOT BETWEEN 3 AND 80
     OR v_slug IN ('category','preview','page','feed','rss','sitemap','search','tag','tags','author','authors','admin','api','new') THEN
    RAISE EXCEPTION 'blog_slug_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.blog_posts WHERE lower(slug) = lower(v_slug) AND id <> p_post_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'blog_slug_taken' USING ERRCODE = 'PT409';
  END IF;
  v_category := CASE WHEN p_patch ? 'category_slug' THEN p_patch ->> 'category_slug' ELSE v_post.category_slug END;
  IF NOT EXISTS (SELECT 1 FROM public.blog_categories WHERE slug = v_category) THEN
    RAISE EXCEPTION 'blog_category_unknown' USING ERRCODE = 'P0001';
  END IF;
  v_topics := CASE WHEN p_patch ? 'topics' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'topics')) ELSE v_post.topics END;
  v_take_down_mode := CASE WHEN p_patch ? 'take_down_mode' THEN p_patch ->> 'take_down_mode' ELSE v_post.take_down_mode END;
  v_take_down_at := CASE WHEN p_patch ? 'take_down_at' THEN NULLIF(p_patch ->> 'take_down_at', '')::timestamptz ELSE v_post.take_down_at END;
  v_take_down_event_id := CASE WHEN p_patch ? 'take_down_event_id' THEN NULLIF(p_patch ->> 'take_down_event_id', '')::uuid ELSE v_post.take_down_event_id END;
  IF v_take_down_mode = 'never' THEN v_take_down_at := NULL; v_take_down_event_id := NULL;
  ELSIF v_take_down_mode = 'at' THEN v_take_down_event_id := NULL;
  ELSIF v_take_down_mode = 'event_end' THEN v_take_down_at := NULL;
  ELSE RAISE EXCEPTION 'blog_take_down_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_post.draft_version_id = v_post.published_version_id THEN
    v_new_draft_id := gen_random_uuid();
    INSERT INTO public.blog_post_versions (
      id, post_id, kind, title, summary, cover_media_id, cover_alt, seo_title, seo_description,
      social_title, social_description, document, created_by)
    VALUES (
      v_new_draft_id, p_post_id, 'draft',
      CASE WHEN p_patch ? 'title' THEN p_patch ->> 'title' ELSE v_draft.title END,
      CASE WHEN p_patch ? 'summary' THEN p_patch ->> 'summary' ELSE v_draft.summary END,
      CASE WHEN p_patch ? 'cover_media_id' THEN NULLIF(p_patch ->> 'cover_media_id', '')::uuid ELSE v_draft.cover_media_id END,
      CASE WHEN p_patch ? 'cover_alt' THEN p_patch ->> 'cover_alt' ELSE v_draft.cover_alt END,
      CASE WHEN p_patch ? 'seo_title' THEN NULLIF(p_patch ->> 'seo_title', '') ELSE v_draft.seo_title END,
      CASE WHEN p_patch ? 'seo_description' THEN NULLIF(p_patch ->> 'seo_description', '') ELSE v_draft.seo_description END,
      CASE WHEN p_patch ? 'social_title' THEN NULLIF(p_patch ->> 'social_title', '') ELSE v_draft.social_title END,
      CASE WHEN p_patch ? 'social_description' THEN NULLIF(p_patch ->> 'social_description', '') ELSE v_draft.social_description END,
      v_document, v_actor);
  ELSE
    v_new_draft_id := v_post.draft_version_id;
    UPDATE public.blog_post_versions SET
      title = CASE WHEN p_patch ? 'title' THEN p_patch ->> 'title' ELSE title END,
      summary = CASE WHEN p_patch ? 'summary' THEN p_patch ->> 'summary' ELSE summary END,
      cover_media_id = CASE WHEN p_patch ? 'cover_media_id' THEN NULLIF(p_patch ->> 'cover_media_id', '')::uuid ELSE cover_media_id END,
      cover_alt = CASE WHEN p_patch ? 'cover_alt' THEN p_patch ->> 'cover_alt' ELSE cover_alt END,
      seo_title = CASE WHEN p_patch ? 'seo_title' THEN NULLIF(p_patch ->> 'seo_title', '') ELSE seo_title END,
      seo_description = CASE WHEN p_patch ? 'seo_description' THEN NULLIF(p_patch ->> 'seo_description', '') ELSE seo_description END,
      social_title = CASE WHEN p_patch ? 'social_title' THEN NULLIF(p_patch ->> 'social_title', '') ELSE social_title END,
      social_description = CASE WHEN p_patch ? 'social_description' THEN NULLIF(p_patch ->> 'social_description', '') ELSE social_description END,
      document = v_document,
      created_by = v_actor,
      created_at = now()
    WHERE id = v_new_draft_id;
  END IF;

  UPDATE public.blog_posts SET
    draft_version_id = v_new_draft_id,
    slug = v_slug,
    category_slug = v_category,
    topics = v_topics,
    show_in_more_stories = CASE WHEN p_patch ? 'show_in_more_stories' THEN (p_patch ->> 'show_in_more_stories')::boolean ELSE show_in_more_stories END,
    hide_passed_event_cards = CASE WHEN p_patch ? 'hide_passed_event_cards' THEN (p_patch ->> 'hide_passed_event_cards')::boolean ELSE hide_passed_event_cards END,
    take_down_mode = v_take_down_mode,
    take_down_at = v_take_down_at,
    take_down_event_id = v_take_down_event_id,
    revision = revision + 1,
    updated_at = now()
  WHERE id = p_post_id;
  INSERT INTO public.blog_post_audit (post_id, actor, action, detail)
  VALUES (p_post_id, v_actor, 'save', jsonb_build_object('revision', p_expected_revision + 1));
  RETURN jsonb_build_object('id', p_post_id, 'revision', p_expected_revision + 1, 'draft_version_id', v_new_draft_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_save_draft(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_save_draft(uuid, integer, jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_save_draft(uuid, integer, jsonb) IS '#4137: optimistic draft save; preserves the live version and raises PT409 on a stale revision.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_submit_for_review(p_post_id uuid, p_expected_revision integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_actor uuid := auth.uid(); v_post public.blog_posts%ROWTYPE;
BEGIN
  IF NOT public.issue_4137_blog_can_write(v_actor) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_post FROM public.blog_posts WHERE id=p_post_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE='P0001'; END IF;
  IF v_post.revision<>p_expected_revision THEN RAISE EXCEPTION 'blog_post_stale' USING ERRCODE='PT409', DETAIL=v_post.revision::text; END IF;
  IF v_post.status<>'draft' THEN RAISE EXCEPTION 'blog_workflow_invalid' USING ERRCODE='P0001'; END IF;
  UPDATE public.blog_posts SET status='in_review', submitted_by=v_actor, submitted_at=now(), review_note=NULL,
    revision=revision+1, updated_at=now() WHERE id=p_post_id;
  INSERT INTO public.blog_post_audit(post_id,actor,action) VALUES(p_post_id,v_actor,'submit');
  RETURN jsonb_build_object('id',p_post_id,'status','in_review','revision',p_expected_revision+1);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_submit_for_review(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_submit_for_review(uuid, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_submit_for_review(uuid, integer) IS '#4137: writer submits a draft for publisher review.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_request_changes(p_post_id uuid, p_expected_revision integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_post public.blog_posts%ROWTYPE;
BEGIN
  IF NOT public.issue_4137_blog_can_publish(v_actor) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(p_note,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'blog_review_note_invalid' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_post FROM public.blog_posts WHERE id=p_post_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE='P0001'; END IF;
  IF v_post.revision<>p_expected_revision THEN RAISE EXCEPTION 'blog_post_stale' USING ERRCODE='PT409', DETAIL=v_post.revision::text; END IF;
  IF v_post.status<>'in_review' THEN RAISE EXCEPTION 'blog_workflow_invalid' USING ERRCODE='P0001'; END IF;
  UPDATE public.blog_posts SET status='draft',review_note=btrim(p_note),revision=revision+1,updated_at=now() WHERE id=p_post_id;
  INSERT INTO public.blog_post_audit(post_id,actor,action,detail) VALUES(p_post_id,v_actor,'request_changes',jsonb_build_object('note',btrim(p_note)));
  RETURN jsonb_build_object('id',p_post_id,'status','draft','revision',p_expected_revision+1);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_request_changes(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_request_changes(uuid, integer, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_request_changes(uuid, integer, text) IS '#4137: publisher returns an in-review post with a required note.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_readiness_failures(p_post_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_post public.blog_posts%ROWTYPE;
  v_version public.blog_post_versions%ROWTYPE;
  v_failures text[] := '{}';
BEGIN
  SELECT * INTO v_post FROM public.blog_posts WHERE id=p_post_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN ARRAY['title','category','slug','cover_present','cover_size','links_live']; END IF;
  SELECT * INTO v_version FROM public.blog_post_versions WHERE id=v_post.draft_version_id;
  IF length(btrim(COALESCE(v_version.title,'')))=0 THEN v_failures:=array_append(v_failures,'title'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.blog_categories WHERE slug=v_post.category_slug) THEN v_failures:=array_append(v_failures,'category'); END IF;
  IF v_post.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR EXISTS(SELECT 1 FROM public.blog_posts p WHERE lower(p.slug)=lower(v_post.slug) AND p.id<>v_post.id AND p.deleted_at IS NULL) THEN v_failures:=array_append(v_failures,'slug'); END IF;
  IF v_version.cover_media_id IS NULL OR length(btrim(v_version.cover_alt))=0 THEN
    v_failures:=array_append(v_failures,'cover_present');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.blog_media media WHERE media.id=v_version.cover_media_id AND media.deleted_at IS NULL
    AND media.width>=1600 AND media.height>=900 AND media.width::numeric/media.height BETWEEN 1.5 AND 2.4) THEN
    v_failures:=array_append(v_failures,'cover_size');
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_version.document->'blocks') block
    WHERE (block->>'type'='image' AND length(btrim(COALESCE(block->>'alt','')))=0)
       OR (block->>'type'='gallery' AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(block->'items','[]'::jsonb)) item WHERE length(btrim(COALESCE(item->>'alt','')))=0))) THEN
    v_failures:=array_append(v_failures,'image_alt');
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_version.media_ids) media_id
    LEFT JOIN public.blog_media media ON media.id=media_id AND media.deleted_at IS NULL
    WHERE media.id IS NULL OR length(btrim(media.source_ref))=0) THEN
    v_failures:=array_append(v_failures,'image_source');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.blog_post_link_checks check_row WHERE check_row.version_id=v_version.id
    AND check_row.ok AND check_row.checked_at>=now()-interval '24 hours') THEN
    v_failures:=array_append(v_failures,'links_live');
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_version.ref_place_ids) place_id
    LEFT JOIN public.place_pool place ON place.id=place_id AND place.deleted_at IS NULL AND COALESCE(place.is_active,false)
      AND place.business_status IS DISTINCT FROM 'CLOSED_PERMANENTLY'
    WHERE place.id IS NULL) THEN
    v_failures:=array_append(v_failures,'places_live');
  END IF;
  IF EXISTS(
    SELECT 1
    FROM jsonb_array_elements(v_version.document->'blocks') block
    LEFT JOIN public.events event ON event.id=NULLIF(block->>'eventId','')::uuid
    LEFT JOIN public.brands brand ON brand.id=event.brand_id
    WHERE block->>'type'='offering' AND (
      event.id IS NULL OR event.deleted_at IS NOT NULL OR event.visibility<>'public' OR event.status NOT IN ('scheduled','live')
      OR NOT EXISTS(SELECT 1 FROM public.event_dates date WHERE date.event_id=event.id AND COALESCE(date.end_at,date.start_at+interval '6 hours')>now())
      OR (length(btrim(COALESCE(brand.name,'')))>0 AND lower(block->>'displayTitle') LIKE '%'||lower(btrim(brand.name))||'%')
    )
  ) THEN v_failures:=array_append(v_failures,'offerings_public'); END IF;
  RETURN v_failures;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_readiness_failures(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_readiness_failures(uuid) TO service_role;
COMMENT ON FUNCTION public.issue_4137_blog_readiness_failures(uuid) IS '#4137: server-enforced publish readiness ids; called only inside guarded workflow.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_publish(
  p_post_id uuid,
  p_expected_revision integer,
  p_publish_at timestamptz DEFAULT now(),
  p_featured boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid:=auth.uid();
  v_post public.blog_posts%ROWTYPE;
  v_draft public.blog_post_versions%ROWTYPE;
  v_published_id uuid:=gen_random_uuid();
  v_failures text[];
  v_when timestamptz:=GREATEST(COALESCE(p_publish_at,now()),now());
  v_take_down_at timestamptz;
  v_replaced jsonb;
BEGIN
  IF NOT public.issue_4137_blog_can_publish(v_actor) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_post FROM public.blog_posts WHERE id=p_post_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE='P0001'; END IF;
  IF v_post.revision<>p_expected_revision THEN RAISE EXCEPTION 'blog_post_stale' USING ERRCODE='PT409',DETAIL=v_post.revision::text; END IF;
  SELECT * INTO v_draft FROM public.blog_post_versions WHERE id=v_post.draft_version_id;
  v_failures:=public.issue_4137_blog_readiness_failures(p_post_id);
  IF cardinality(v_failures)>0 THEN RAISE EXCEPTION 'blog_not_ready' USING ERRCODE='P0001',DETAIL=to_jsonb(v_failures)::text; END IF;
  IF v_post.take_down_mode='event_end' THEN
    v_take_down_at:=public.issue_4137_blog_event_take_down_at(v_post.take_down_event_id);
    IF v_take_down_at IS NULL OR v_take_down_at<=v_when THEN RAISE EXCEPTION 'blog_take_down_event_open_ended' USING ERRCODE='P0001'; END IF;
  ELSIF v_post.take_down_mode='at' THEN v_take_down_at:=v_post.take_down_at;
  ELSE v_take_down_at:=NULL;
  END IF;
  IF v_take_down_at IS NOT NULL AND v_take_down_at<=v_when THEN RAISE EXCEPTION 'blog_take_down_invalid' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.blog_post_versions(id,post_id,kind,title,summary,cover_media_id,cover_alt,seo_title,seo_description,
    social_title,social_description,document,created_by)
  VALUES(v_published_id,p_post_id,'published',v_draft.title,v_draft.summary,v_draft.cover_media_id,v_draft.cover_alt,
    v_draft.seo_title,v_draft.seo_description,v_draft.social_title,v_draft.social_description,v_draft.document,v_actor);
  UPDATE public.blog_posts SET status='published',published_version_id=v_published_id,publish_at=v_when,
    first_published_at=COALESCE(first_published_at,v_when),published_by=v_actor,take_down_at=v_take_down_at,
    review_note=NULL,revision=revision+1,updated_at=now() WHERE id=p_post_id;
  INSERT INTO public.blog_post_audit(post_id,actor,action,detail) VALUES(p_post_id,v_actor,
    CASE WHEN v_post.status='published' THEN 'reschedule' ELSE 'publish' END,
    jsonb_build_object('publish_at',v_when,'version_id',v_published_id));
  IF p_featured THEN
    SELECT jsonb_build_object('id',old.id,'title',version.title,'since',featured.since) INTO v_replaced
    FROM public.blog_featured featured JOIN public.blog_posts old ON old.id=featured.post_id
    JOIN public.blog_post_versions version ON version.id=old.draft_version_id WHERE featured.slot='blog_index';
    INSERT INTO public.blog_featured(slot,post_id,since,set_by) VALUES('blog_index',p_post_id,now(),v_actor)
      ON CONFLICT(slot) DO UPDATE SET post_id=excluded.post_id,since=excluded.since,set_by=excluded.set_by;
    INSERT INTO public.blog_post_audit(post_id,actor,action) VALUES(p_post_id,v_actor,'feature');
  END IF;
  RETURN jsonb_build_object('post',jsonb_build_object('id',p_post_id,'slug',v_post.slug,'status','published',
    'publish_at',v_when,'revision',p_expected_revision+1),'replaced_featured',v_replaced);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_publish(uuid, integer, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_publish(uuid, integer, timestamptz, boolean) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_publish(uuid, integer, timestamptz, boolean) IS '#4137: publisher freezes the draft into a live or scheduled version after server readiness checks.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_unpublish(p_post_id uuid,p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_revision integer;
BEGIN
  IF NOT public.issue_4137_blog_can_publish(v_actor) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  SELECT revision INTO v_revision FROM public.blog_posts WHERE id=p_post_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE='P0001'; END IF;
  IF v_revision<>p_expected_revision THEN RAISE EXCEPTION 'blog_post_stale' USING ERRCODE='PT409',DETAIL=v_revision::text; END IF;
  UPDATE public.blog_posts SET status='unpublished',revision=revision+1,updated_at=now() WHERE id=p_post_id;
  DELETE FROM public.blog_featured WHERE post_id=p_post_id;
  INSERT INTO public.blog_post_audit(post_id,actor,action) VALUES(p_post_id,v_actor,'unpublish');
  RETURN jsonb_build_object('id',p_post_id,'status','unpublished','revision',p_expected_revision+1);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_unpublish(uuid, integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_unpublish(uuid, integer) TO authenticated,service_role;
COMMENT ON FUNCTION public.issue_4137_blog_unpublish(uuid, integer) IS '#4137: publisher hides a post and clears its featured slot.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_set_featured(p_post_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_replaced jsonb;
BEGIN
  IF NOT public.issue_4137_blog_can_publish(v_actor) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('id',post.id,'title',version.title,'since',featured.since) INTO v_replaced
    FROM public.blog_featured featured JOIN public.blog_posts post ON post.id=featured.post_id
    JOIN public.blog_post_versions version ON version.id=post.draft_version_id WHERE featured.slot='blog_index';
  IF p_post_id IS NULL THEN
    DELETE FROM public.blog_featured WHERE slot='blog_index';
    IF v_replaced IS NOT NULL THEN INSERT INTO public.blog_post_audit(post_id,actor,action) VALUES((v_replaced->>'id')::uuid,v_actor,'unfeature'); END IF;
    RETURN v_replaced;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.blog_posts WHERE id=p_post_id AND status='published' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'blog_featured_requires_published' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.blog_featured(slot,post_id,since,set_by) VALUES('blog_index',p_post_id,now(),v_actor)
    ON CONFLICT(slot) DO UPDATE SET post_id=excluded.post_id,since=excluded.since,set_by=excluded.set_by;
  IF v_replaced IS NOT NULL AND (v_replaced->>'id')::uuid<>p_post_id THEN
    INSERT INTO public.blog_post_audit(post_id,actor,action) VALUES((v_replaced->>'id')::uuid,v_actor,'unfeature');
  END IF;
  INSERT INTO public.blog_post_audit(post_id,actor,action) VALUES(p_post_id,v_actor,'feature');
  RETURN v_replaced;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_set_featured(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_set_featured(uuid) TO authenticated,service_role;
COMMENT ON FUNCTION public.issue_4137_blog_set_featured(uuid) IS '#4137: publisher atomically sets or clears the single blog-index featured slot.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_featured_now()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.issue_4137_blog_can_write(auth.uid()) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('post_id',post.id,'title',version.title,'since',featured.since) INTO v_result
  FROM public.blog_featured featured JOIN public.blog_posts post ON post.id=featured.post_id
  JOIN public.blog_post_versions version ON version.id=post.draft_version_id WHERE featured.slot='blog_index';
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_featured_now() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_featured_now() TO authenticated,service_role;
COMMENT ON FUNCTION public.issue_4137_blog_featured_now() IS '#4137: current featured post summary for staff placement controls.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_delete_post(p_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_actor uuid:=auth.uid();
BEGIN
  IF NOT public.issue_4137_blog_can_publish(v_actor) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.blog_posts WHERE id=p_post_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE='P0001'; END IF;
  IF EXISTS(SELECT 1 FROM public.blog_posts WHERE id=p_post_id AND first_published_at IS NOT NULL) THEN RAISE EXCEPTION 'blog_cannot_delete_published' USING ERRCODE='P0001'; END IF;
  UPDATE public.blog_posts SET deleted_at=now(),updated_at=now(),revision=revision+1 WHERE id=p_post_id;
  DELETE FROM public.blog_featured WHERE post_id=p_post_id;
  INSERT INTO public.blog_post_audit(post_id,actor,action) VALUES(p_post_id,v_actor,'delete');
  RETURN jsonb_build_object('id',p_post_id,'deleted',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_delete_post(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_delete_post(uuid) TO authenticated,service_role;
COMMENT ON FUNCTION public.issue_4137_blog_delete_post(uuid) IS '#4137: publisher soft-deletes a never-published draft only.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_create_preview_token(p_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_version uuid; v_token text; v_expires timestamptz:=now()+interval '1 hour';
BEGIN
  IF NOT public.issue_4137_blog_can_write(v_actor) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  SELECT draft_version_id INTO v_version FROM public.blog_posts WHERE id=p_post_id AND deleted_at IS NULL;
  IF v_version IS NULL THEN RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE='P0001'; END IF;
  v_token:=rtrim(translate(encode(gen_random_bytes(32),'base64'),'+/','-_'),'=');
  INSERT INTO public.blog_preview_tokens(token_hash,post_id,version_id,created_by,expires_at)
  VALUES(encode(sha256(convert_to(v_token,'UTF8')),'hex'),p_post_id,v_version,v_actor,v_expires);
  RETURN jsonb_build_object('token',v_token,'expires_at',v_expires);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_create_preview_token(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_create_preview_token(uuid) TO authenticated,service_role;
COMMENT ON FUNCTION public.issue_4137_blog_create_preview_token(uuid) IS '#4137: one-hour draft preview token; only its sha256 hash is stored.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_register_media(
  p_media_id uuid,p_storage_path text,p_mime text,p_width integer,p_height integer,p_bytes integer,
  p_alt text,p_source text,p_source_ref text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_media public.blog_media%ROWTYPE;
BEGIN
  IF NOT public.issue_4137_blog_can_write(v_actor) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  IF split_part(p_storage_path,'/',1)<>v_actor::text
     OR split_part(p_storage_path,'/',2)<>(p_media_id::text || CASE p_mime WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' WHEN 'image/webp' THEN '.webp' ELSE '' END) THEN
    RAISE EXCEPTION 'blog_media_path_invalid' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects object WHERE object.bucket_id='blog-media' AND object.name=p_storage_path) THEN
    RAISE EXCEPTION 'blog_media_object_missing' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.blog_media(id,storage_path,mime_type,width,height,bytes,alt,source,source_ref,uploaded_by)
  VALUES(p_media_id,p_storage_path,p_mime,p_width,p_height,p_bytes,COALESCE(p_alt,''),p_source,p_source_ref,v_actor)
  RETURNING * INTO v_media;
  RETURN to_jsonb(v_media);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_register_media(uuid,text,text,integer,integer,integer,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_register_media(uuid,text,text,integer,integer,integer,text,text,text) TO authenticated,service_role;
COMMENT ON FUNCTION public.issue_4137_blog_register_media(uuid,text,text,integer,integer,integer,text,text,text) IS '#4137: register a validated uploaded blog-media object in the writer own folder.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_update_media(
  p_media_id uuid,p_alt text,p_source text,p_source_ref text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_media public.blog_media%ROWTYPE;
BEGIN
  IF NOT public.issue_4137_blog_can_write(auth.uid()) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(p_alt,'')))<1 OR length(p_alt)>500
     OR p_source NOT IN ('mingla_owned','licensed_stock','partner_supplied')
     OR length(btrim(COALESCE(p_source_ref,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'blog_media_details_invalid' USING ERRCODE='P0001';
  END IF;
  UPDATE public.blog_media SET alt=btrim(p_alt),source=p_source,source_ref=btrim(p_source_ref)
  WHERE id=p_media_id AND deleted_at IS NULL RETURNING * INTO v_media;
  IF v_media.id IS NULL THEN RAISE EXCEPTION 'blog_media_not_found' USING ERRCODE='P0001'; END IF;
  RETURN to_jsonb(v_media);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_update_media(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_update_media(uuid,text,text,text) TO authenticated,service_role;
COMMENT ON FUNCTION public.issue_4137_blog_update_media(uuid,text,text,text) IS '#4137: writers may correct blog-media attribution without replacing the licensed object.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_delete_media(p_media_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_path text;
BEGIN
  IF NOT public.issue_4137_blog_can_publish(auth.uid()) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.blog_post_versions version
    WHERE version.cover_media_id=p_media_id OR p_media_id=ANY(version.media_ids)
  ) THEN RAISE EXCEPTION 'blog_media_in_use' USING ERRCODE='P0001'; END IF;
  UPDATE public.blog_media SET deleted_at=now() WHERE id=p_media_id AND deleted_at IS NULL RETURNING storage_path INTO v_path;
  IF v_path IS NULL THEN RAISE EXCEPTION 'blog_media_not_found' USING ERRCODE='P0001'; END IF;
  RETURN jsonb_build_object('id',p_media_id,'storage_path',v_path,'deleted',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_delete_media(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_delete_media(uuid) TO authenticated,service_role;
COMMENT ON FUNCTION public.issue_4137_blog_delete_media(uuid) IS '#4137: publisher-only soft delete, refused while any saved version references the media.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_list_media(p_query text DEFAULT NULL,p_limit integer DEFAULT 40,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.issue_4137_blog_can_write(auth.uid()) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.created_at DESC,item.id),'[]'::jsonb) INTO v_result
  FROM (SELECT id,storage_path,mime_type,width,height,bytes,alt,source,source_ref,uploaded_by,created_at
    FROM public.blog_media WHERE deleted_at IS NULL AND (p_query IS NULL OR btrim(p_query)='' OR alt ILIKE '%'||btrim(p_query)||'%' OR source_ref ILIKE '%'||btrim(p_query)||'%')
    ORDER BY created_at DESC,id LIMIT LEAST(GREATEST(COALESCE(p_limit,40),1),100) OFFSET LEAST(GREATEST(COALESCE(p_offset,0),0),10000)) item;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_list_media(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_list_media(text,integer,integer) TO authenticated,service_role;
COMMENT ON FUNCTION public.issue_4137_blog_list_media(text,integer,integer) IS '#4137: searchable staff media library including private source references.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_search_link_targets(p_query text,p_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.issue_4137_blog_can_write(auth.uid()) THEN RAISE EXCEPTION 'blog_forbidden' USING ERRCODE='42501'; END IF;
  IF p_kind NOT IN ('place','offering') OR length(btrim(COALESCE(p_query,'')))<2 THEN RAISE EXCEPTION 'blog_search_invalid' USING ERRCODE='P0001'; END IF;
  IF p_kind='place' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.name,item.id),'[]'::jsonb) INTO v_result FROM (
      SELECT id,name,city,primary_type_display_name,rating,review_count FROM public.place_pool
      WHERE deleted_at IS NULL AND COALESCE(is_active,false) AND name ILIKE '%'||btrim(p_query)||'%' ORDER BY name,id LIMIT 20) item;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.next_start_at,item.id),'[]'::jsonb) INTO v_result FROM (
      SELECT event.id,event.event_type,event.title,brand.name AS brand_name,event.city,
        (SELECT min(date.start_at) FROM public.event_dates date WHERE date.event_id=event.id AND COALESCE(date.end_at,date.start_at+interval '6 hours')>now()) AS next_start_at
      FROM public.events event JOIN public.brands brand ON brand.id=event.brand_id
      WHERE event.deleted_at IS NULL AND brand.deleted_at IS NULL AND event.visibility='public' AND event.status IN ('scheduled','live')
        AND (event.title ILIKE '%'||btrim(p_query)||'%' OR brand.name ILIKE '%'||btrim(p_query)||'%')
        AND EXISTS(SELECT 1 FROM public.event_dates date WHERE date.event_id=event.id AND COALESCE(date.end_at,date.start_at+interval '6 hours')>now())
      ORDER BY next_start_at,event.id LIMIT 20) item;
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_search_link_targets(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_search_link_targets(text,text) TO authenticated,service_role;
COMMENT ON FUNCTION public.issue_4137_blog_search_link_targets(text,text) IS '#4137: staff-only place/offering picker results; brand name never leaves Admin.';

COMMIT;

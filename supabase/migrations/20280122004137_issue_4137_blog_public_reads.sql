-- #4137 wave 3 — the blog's public read RPCs (spec §5.2), called by the
-- marketing site with the public anon key.
--
-- blog_public_index / blog_public_post / blog_public_sitemap are SECURITY
-- INVOKER: anon's RLS (migration 20280120004137) is the fence, and each also
-- filters on the visibility rule explicitly so a signed-in writer calling them
-- still gets only public posts.
-- blog_public_post_embeds / blog_public_preview are SECURITY DEFINER with a
-- gate first: the embeds read only the ids a PUBLIC post's published version
-- references; the preview needs the raw one-hour token.
-- Static SQL only (#1860 C7). No 40001 anywhere (#4134).

BEGIN;
SET LOCAL lock_timeout = '10s';

-- One story card. Invoker: under anon, RLS decides what exists.
CREATE OR REPLACE FUNCTION public.issue_4137_blog_card(p_post_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'slug', post.slug,
    'title', version.title,
    'summary', version.summary,
    'category', jsonb_build_object('slug', category.slug, 'label', category.label),
    'read_minutes', version.read_minutes,
    'publish_at', post.publish_at,
    'cover', CASE WHEN media.id IS NULL THEN NULL ELSE jsonb_build_object(
      'path', media.storage_path, 'width', media.width, 'height', media.height,
      'alt', COALESCE(NULLIF(btrim(version.cover_alt), ''), media.alt)) END,
    'author', jsonb_build_object('display_name', author.display_name)
  )
  FROM public.blog_posts post
  JOIN public.blog_post_versions version ON version.id = post.published_version_id
  JOIN public.blog_categories category ON category.slug = post.category_slug
  JOIN public.blog_authors author ON author.id = post.author_id
  LEFT JOIN public.blog_media media ON media.id = version.cover_media_id
  WHERE post.id = p_post_id
    AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                            post.publish_at, post.take_down_at);
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_card(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_card(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_card(uuid) IS '#4137: one public story card (null unless the post is public).';

-- The full post payload for one version. Invoker: called by blog_public_post
-- under anon (RLS shows only a public post's published version) and by the
-- definer preview (which has already checked the token).
CREATE OR REPLACE FUNCTION public.issue_4137_blog_version_payload(p_post_id uuid, p_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'slug', post.slug,
    'title', version.title,
    'summary', version.summary,
    'category', jsonb_build_object('slug', category.slug, 'label', category.label),
    'read_minutes', version.read_minutes,
    'publish_at', post.publish_at,
    'cover', CASE WHEN media.id IS NULL THEN NULL ELSE jsonb_build_object(
      'path', media.storage_path, 'width', media.width, 'height', media.height,
      'alt', COALESCE(NULLIF(btrim(version.cover_alt), ''), media.alt)) END,
    'author', jsonb_build_object('display_name', author.display_name),
    'first_published_at', post.first_published_at,
    'updated_at', version.created_at,
    'hide_passed_event_cards', post.hide_passed_event_cards,
    'topics', to_jsonb(post.topics),
    'published_version', jsonb_build_object(
      'title', version.title,
      'summary', version.summary,
      'cover', CASE WHEN media.id IS NULL THEN NULL ELSE jsonb_build_object(
        'path', media.storage_path, 'width', media.width, 'height', media.height,
        'alt', COALESCE(NULLIF(btrim(version.cover_alt), ''), media.alt)) END,
      'seo_title', version.seo_title,
      'seo_description', version.seo_description,
      'social_title', version.social_title,
      'social_description', version.social_description,
      'document', version.document,
      'read_minutes', version.read_minutes,
      -- Every image a block shows, sized from its media row (no client guess).
      -- RLS on blog_media drops deleted or non-public rows for anon.
      'media', COALESCE((
        SELECT jsonb_object_agg(item.id::text, jsonb_build_object(
          'path', item.storage_path, 'width', item.width, 'height', item.height))
        FROM public.blog_media item
        WHERE item.id = ANY (version.media_ids)
      ), '{}'::jsonb)
    )
  )
  FROM public.blog_posts post
  JOIN public.blog_post_versions version ON version.id = p_version_id AND version.post_id = post.id
  JOIN public.blog_categories category ON category.slug = post.category_slug
  JOIN public.blog_authors author ON author.id = post.author_id
  LEFT JOIN public.blog_media media ON media.id = version.cover_media_id
  WHERE post.id = p_post_id AND post.deleted_at IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_version_payload(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_version_payload(uuid, uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_version_payload(uuid, uuid) IS
  '#4137: post page payload for one version; under anon only a public post''s published version resolves.';

-- ─── blog_public_index ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.blog_public_index(
  p_category text DEFAULT NULL,
  p_limit integer DEFAULT 12,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 24);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset, 0), 0), 10000);
  v_featured uuid;
  v_posts jsonb;
  v_total integer;
BEGIN
  IF p_category IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.blog_categories WHERE slug = p_category) THEN
    RAISE EXCEPTION 'blog_category_unknown' USING ERRCODE = 'P0001';
  END IF;

  IF p_category IS NULL THEN
    SELECT featured.post_id INTO v_featured
    FROM public.blog_featured featured
    JOIN public.blog_posts post ON post.id = featured.post_id
    WHERE featured.slot = 'blog_index'
      AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                              post.publish_at, post.take_down_at);
    IF v_featured IS NULL THEN
      SELECT post.id INTO v_featured
      FROM public.blog_posts post
      WHERE public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                                post.publish_at, post.take_down_at)
      ORDER BY post.publish_at DESC, post.id
      LIMIT 1;
    END IF;
  END IF;

  SELECT count(*)::integer INTO v_total
  FROM public.blog_posts post
  WHERE public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                            post.publish_at, post.take_down_at)
    AND (p_category IS NULL OR post.category_slug = p_category)
    AND post.id IS DISTINCT FROM v_featured;

  SELECT COALESCE(jsonb_agg(public.issue_4137_blog_card(page.id) ORDER BY page.publish_at DESC, page.id), '[]'::jsonb)
  INTO v_posts
  FROM (
    SELECT post.id, post.publish_at
    FROM public.blog_posts post
    WHERE public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                              post.publish_at, post.take_down_at)
      AND (p_category IS NULL OR post.category_slug = p_category)
      AND post.id IS DISTINCT FROM v_featured
    ORDER BY post.publish_at DESC, post.id
    LIMIT v_limit OFFSET v_offset
  ) page;

  RETURN jsonb_build_object(
    'featured', CASE WHEN v_featured IS NULL THEN NULL ELSE public.issue_4137_blog_card(v_featured) END,
    'posts', v_posts,
    'total', v_total,
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('slug', slug, 'label', label, 'description', description) ORDER BY sort_order)
      FROM public.blog_categories
    ), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.blog_public_index(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.blog_public_index(text, integer, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.blog_public_index(text, integer, integer) IS
  '#4137: /blog and /blog/category/<slug>: featured card (index only), public cards newest first, total, categories.';

-- ─── blog_public_post ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.blog_public_post(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  v_post_id uuid;
  v_version_id uuid;
  v_category text;
  v_topics text[];
  v_payload jsonb;
BEGIN
  IF p_slug IS NULL OR length(p_slug) > 80 THEN
    RETURN NULL;
  END IF;
  SELECT post.id, post.published_version_id, post.category_slug, post.topics
  INTO v_post_id, v_version_id, v_category, v_topics
  FROM public.blog_posts post
  WHERE lower(post.slug) = lower(p_slug)
    AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                            post.publish_at, post.take_down_at);
  IF v_post_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_payload := public.issue_4137_blog_version_payload(v_post_id, v_version_id);
  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_payload || jsonb_build_object('more_stories', COALESCE((
    SELECT jsonb_agg(public.issue_4137_blog_card(more.id) ORDER BY more.same_category DESC, more.shares_topic DESC,
                     more.publish_at DESC, more.id)
    FROM (
      SELECT post.id, post.publish_at,
        (post.category_slug = v_category) AS same_category,
        (post.topics && v_topics) AS shares_topic
      FROM public.blog_posts post
      WHERE post.id <> v_post_id
        AND post.show_in_more_stories
        AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                                post.publish_at, post.take_down_at)
      ORDER BY (post.category_slug = v_category) DESC, (post.topics && v_topics) DESC, post.publish_at DESC, post.id
      LIMIT 3
    ) more
  ), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.blog_public_post(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.blog_public_post(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.blog_public_post(text) IS
  '#4137: one public post by slug with its published version and up to three More stories; null otherwise.';

-- ─── embeds (live place and event facts) ───────────────────────────────────
-- COLUMN ALLOW-LIST (spec §5.2, I-4137-BLOG-NO-HOST-IDENTITY). Places return
-- name, type, city, rating, review count, Google ids, an open flag and the
-- first stored photo URL (Seth, 27 Oct: blog place cards show the stored
-- place-pool thumbnail, no live Google fetch). Events return ONLY type, city,
-- visibility, status and dates. Never brand_*, cover media, organiser
-- contact, description, location text, online URL or the event's own title:
-- the public card shows the editor's displayTitle, so no host-written text
-- can reach the page.
CREATE OR REPLACE FUNCTION public.issue_4137_blog_embeds_for_version(p_version_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'places', COALESCE((
      SELECT jsonb_object_agg(place.id::text, jsonb_build_object(
        'name', place.name,
        'primary_type_display_name', place.primary_type_display_name,
        'city', place.city,
        'rating', place.rating,
        'review_count', place.review_count,
        'google_place_id', place.google_place_id,
        'google_maps_uri', place.google_maps_uri,
        'stored_photo_url', place.stored_photo_urls[1],
        'open', (place.business_status IS DISTINCT FROM 'CLOSED_PERMANENTLY'
                 AND COALESCE(place.is_active, false) AND place.deleted_at IS NULL)
      ))
      FROM public.place_pool place
      WHERE place.id = ANY (version.ref_place_ids)
    ), '{}'::jsonb),
    'offerings', COALESCE((
      SELECT jsonb_object_agg(facts.id::text, jsonb_build_object(
        'event_type', CASE WHEN facts.is_public THEN facts.event_type END,
        'city', CASE WHEN facts.is_public THEN facts.city END,
        'is_public', facts.is_public,
        'status', CASE WHEN facts.is_public THEN facts.status END,
        'next_start_at', CASE WHEN facts.is_public THEN facts.next_start_at END,
        'next_end_at', CASE WHEN facts.is_public THEN facts.next_end_at END,
        'timezone', CASE WHEN facts.is_public THEN facts.timezone END,
        'passed', (NOT facts.is_public OR facts.status IN ('ended', 'cancelled') OR facts.next_start_at IS NULL)
      ))
      FROM (
        SELECT event.id, event.event_type, event.city, event.status,
          (event.deleted_at IS NULL
            AND event.visibility = 'public'
            AND event.status IN ('scheduled', 'live', 'ended', 'cancelled')
            AND NOT public.issue_1931_event_ordinary_read_blocked(event.id)) AS is_public,
          next_date.start_at AS next_start_at,
          next_date.end_at AS next_end_at,
          COALESCE(next_date.timezone, event.timezone) AS timezone
        FROM public.events event
        LEFT JOIN LATERAL (
          SELECT date.start_at, date.end_at, date.timezone
          FROM public.event_dates date
          WHERE date.event_id = event.id
            AND COALESCE(date.end_at, date.start_at + interval '6 hours') > now()
          ORDER BY date.start_at
          LIMIT 1
        ) next_date ON true
        WHERE event.id = ANY (version.ref_event_ids)
      ) facts
    ), '{}'::jsonb)
  )
  FROM public.blog_post_versions version
  WHERE version.id = p_version_id;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_embeds_for_version(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_embeds_for_version(uuid) TO service_role;
COMMENT ON FUNCTION public.issue_4137_blog_embeds_for_version(uuid) IS
  '#4137: live place/event facts for the ids one version references. Column allow-list; never host identity. Not granted to anon: reached only through gated callers.';

CREATE OR REPLACE FUNCTION public.blog_public_post_embeds(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version_id uuid;
BEGIN
  IF p_slug IS NULL OR length(p_slug) > 80 THEN
    RETURN '{}'::jsonb;
  END IF;
  SELECT post.published_version_id INTO v_version_id
  FROM public.blog_posts post
  WHERE lower(post.slug) = lower(p_slug)
    AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                            post.publish_at, post.take_down_at);
  IF v_version_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN public.issue_4137_blog_embeds_for_version(v_version_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.blog_public_post_embeds(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.blog_public_post_embeds(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.blog_public_post_embeds(text) IS
  '#4137: live card facts for a PUBLIC post''s published version only; {} for anything else.';

-- ─── sitemap ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.blog_public_sitemap()
RETURNS TABLE (slug text, last_modified timestamptz)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT post.slug, GREATEST(post.publish_at, version.created_at) AS last_modified
  FROM public.blog_posts post
  JOIN public.blog_post_versions version ON version.id = post.published_version_id
  WHERE public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                            post.publish_at, post.take_down_at)
  ORDER BY post.publish_at DESC, post.id;
$function$;
REVOKE ALL ON FUNCTION public.blog_public_sitemap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.blog_public_sitemap() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.blog_public_sitemap() IS '#4137: one sitemap row per public post.';

-- ─── staff preview ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.blog_public_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_post_id uuid;
  v_version_id uuid;
  v_payload jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN NULL;
  END IF;
  SELECT token.post_id, token.version_id INTO v_post_id, v_version_id
  FROM public.blog_preview_tokens token
  WHERE token.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    AND token.expires_at > now();
  IF v_post_id IS NULL THEN
    RETURN NULL;
  END IF;
  v_payload := public.issue_4137_blog_version_payload(v_post_id, v_version_id);
  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_payload || jsonb_build_object(
    'more_stories', '[]'::jsonb,
    'embeds', public.issue_4137_blog_embeds_for_version(v_version_id),
    'preview', true
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.blog_public_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.blog_public_preview(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.blog_public_preview(text) IS
  '#4137: staff preview of one version by an unexpired one-hour token (43 base64url chars); null otherwise.';

-- Take-down time for "when the linked event ends" (spec §4.5). Used by the
-- wave 4 publish RPC; null when the event has no dates.
CREATE OR REPLACE FUNCTION public.issue_4137_blog_event_take_down_at(p_event_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT max(COALESCE(date.end_at, date.start_at + interval '6 hours'))
  FROM public.event_dates date
  WHERE date.event_id = p_event_id;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_event_take_down_at(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_event_take_down_at(uuid) TO service_role;
COMMENT ON FUNCTION public.issue_4137_blog_event_take_down_at(uuid) IS
  '#4137: the last end of an event''s dates, for take_down_mode = event_end.';

COMMIT;

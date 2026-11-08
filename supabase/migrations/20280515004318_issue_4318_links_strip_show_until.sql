-- #4318 follow-up — a /links strip can run for several days.
--
-- links_strips.shows_until (optional): a strip is public from creation
-- through the end of shows_until when it is set, otherwise through the end of
-- shows_on (unchanged). shows_until is never before shows_on.
--
-- Re-emits exactly the CURRENT definitions from
-- 20280508004318_issue_4318_links_page.sql with only the shows_until change:
-- links_page_strips() and admin_links_strips_list() gain a returned column
-- (DROP + CREATE, a RETURNS TABLE cannot widen in place) and
-- admin_links_strip_save gains p_shows_until DEFAULT NULL (the old 7-argument
-- signature is dropped; a 7-argument call resolves to the new one).
-- No anonymous SECURITY DEFINER signature changes, so the anon-definer
-- allowlist is untouched. Static SQL only (#1860 C7). No 40001 (#4134).

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.links_strips ADD COLUMN IF NOT EXISTS shows_until date NULL;
ALTER TABLE public.links_strips DROP CONSTRAINT IF EXISTS links_strips_shows_until_after_shows_on;
ALTER TABLE public.links_strips ADD CONSTRAINT links_strips_shows_until_after_shows_on
  CHECK (shows_until IS NULL OR shows_until >= shows_on);
COMMENT ON COLUMN public.links_strips.shows_until IS
  '#4318: optional last day the strip is public (through its end, UTC cut-off as shows_on). NULL = shows_on only.';

-- Public: shows_until joins the granted columns; the policy uses the later day.
GRANT SELECT (shows_until) ON public.links_strips TO anon, authenticated;
DROP POLICY IF EXISTS links_strips_public_read ON public.links_strips;
CREATE POLICY links_strips_public_read ON public.links_strips FOR SELECT TO anon, authenticated
  USING (is_published AND COALESCE(shows_until, shows_on) >= (now() AT TIME ZONE 'utc')::date - 1);

DROP FUNCTION IF EXISTS public.links_page_strips();
CREATE OR REPLACE FUNCTION public.links_page_strips()
RETURNS TABLE (
  id uuid, shows_on date, shows_until date, title text, label text, opens text,
  url text, blog_slug text, "position" integer
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT strip.id, strip.shows_on, strip.shows_until, strip.title, strip.label, strip.opens,
         strip.url, post.slug, strip.position
  FROM public.links_strips strip
  LEFT JOIN public.blog_posts post ON post.id = strip.blog_post_id
  WHERE strip.is_published
    AND COALESCE(strip.shows_until, strip.shows_on) >= (now() AT TIME ZONE 'utc')::date - 1
    AND (
      strip.opens <> 'blog'
      OR (post.id IS NOT NULL
          AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                                  post.publish_at, post.take_down_at))
    )
  ORDER BY strip.position, strip.id;  -- anon holds no grant on created_at
END;
$function$;
REVOKE ALL ON FUNCTION public.links_page_strips() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.links_page_strips() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.links_page_strips() IS
  '#4318: /links custom strips: published, unexpired (through shows_until when set, else shows_on), in admin order; a blog strip only while its post is public (blog_slug set).';

DROP FUNCTION IF EXISTS public.admin_links_strips_list();
CREATE OR REPLACE FUNCTION public.admin_links_strips_list()
RETURNS TABLE (
  id uuid, shows_on date, shows_until date, title text, label text, opens text, url text,
  blog_post_id uuid, blog_slug text, blog_title text, blog_is_public boolean,
  "position" integer, is_published boolean, is_expired boolean,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_support_staff(auth.uid()), false) THEN
    RAISE EXCEPTION 'links_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT strip.id, strip.shows_on, strip.shows_until, strip.title, strip.label, strip.opens, strip.url,
    strip.blog_post_id, post.slug,
    (SELECT version.title FROM public.blog_post_versions version
      WHERE version.id = COALESCE(post.published_version_id, post.draft_version_id)),
    COALESCE(public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                                 post.publish_at, post.take_down_at), false),
    strip.position, strip.is_published,
    COALESCE(strip.shows_until, strip.shows_on) < (now() AT TIME ZONE 'utc')::date - 1,
    strip.created_at, strip.updated_at
  FROM public.links_strips strip
  LEFT JOIN public.blog_posts post ON post.id = strip.blog_post_id
  ORDER BY strip.position, strip.created_at, strip.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_links_strips_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_links_strips_list() TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_links_strips_list() IS
  '#4318: every /links strip in page order with its blog post title, for Support staff.';

DROP FUNCTION IF EXISTS public.admin_links_strip_save(uuid, date, text, text, text, text, uuid);
CREATE OR REPLACE FUNCTION public.admin_links_strip_save(
  p_id uuid, p_shows_on date, p_title text, p_label text,
  p_opens text, p_url text, p_blog_post_id uuid, p_shows_until date DEFAULT NULL
)
RETURNS public.links_strips
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_title text := COALESCE(public.issue_4318_links_title_normal(p_title), '');
  v_url text := NULL;
  v_blog uuid := NULL;
  v_row public.links_strips;
BEGIN
  IF v_actor IS NULL OR NOT COALESCE(public.is_support_staff(v_actor), false) THEN
    RAISE EXCEPTION 'links_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_shows_on IS NULL OR (p_shows_until IS NULL AND p_shows_on < (now() AT TIME ZONE 'utc')::date - 1) THEN
    RAISE EXCEPTION 'links_shows_on_invalid' USING ERRCODE = 'P0001';
  END IF;
  -- An end date runs from shows_on and must not already be over.
  IF p_shows_until IS NOT NULL AND (p_shows_until < p_shows_on OR p_shows_until < (now() AT TIME ZONE 'utc')::date - 1) THEN
    RAISE EXCEPTION 'links_shows_until_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_title) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'links_title_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_label IS NULL OR p_label NOT IN ('From Mingla', 'Featured', 'New', 'Giveaway') THEN
    RAISE EXCEPTION 'links_label_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_opens IS NULL OR p_opens NOT IN ('web', 'blog', 'explorer', 'host') THEN
    RAISE EXCEPTION 'links_opens_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF p_opens = 'web' THEN
    -- Stored without its scheme: "https://usemingla.com/x" -> "usemingla.com/x".
    v_url := regexp_replace(btrim(COALESCE(p_url, '')), '^https?://', '', 'i');
    IF v_url = '' OR length(v_url) > 500
       OR v_url ~* '^[a-z][a-z0-9+.-]*://'
       OR v_url !~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' THEN
      RAISE EXCEPTION 'links_url_invalid' USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_opens = 'blog' THEN
    IF p_blog_post_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.blog_posts post
      WHERE post.id = p_blog_post_id
        AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                                post.publish_at, post.take_down_at)
    ) THEN
      RAISE EXCEPTION 'links_blog_post_invalid' USING ERRCODE = 'P0001';
    END IF;
    v_blog := p_blog_post_id;
  END IF;

  -- One ordering across every strip: saves and reorders take turns.
  PERFORM pg_advisory_xact_lock(hashtext('issue_4318_links_strips_order'));

  IF p_id IS NULL THEN
    INSERT INTO public.links_strips (shows_on, shows_until, title, label, opens, url, blog_post_id, position, created_by)
    VALUES (p_shows_on, p_shows_until, v_title, p_label, p_opens, v_url, v_blog,
      COALESCE((SELECT min(existing.position) - 1 FROM public.links_strips existing), 0), v_actor)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.links_strips strip
    SET shows_on = p_shows_on, shows_until = p_shows_until, title = v_title, label = p_label, opens = p_opens,
        url = v_url, blog_post_id = v_blog, updated_at = now()
    WHERE strip.id = p_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'links_strip_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_links_strip_save(uuid, date, text, text, text, text, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_links_strip_save(uuid, date, text, text, text, text, uuid, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_links_strip_save(uuid, date, text, text, text, text, uuid, date) IS
  '#4318: create (p_id null; the new strip goes to the top) or update a /links strip. Validates the days (shows_until optional, on or after shows_on), title, label, opens, web URL (scheme stripped) and published blog post.';

NOTIFY pgrst, 'reload schema';

COMMIT;

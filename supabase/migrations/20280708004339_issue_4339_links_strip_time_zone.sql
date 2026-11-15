-- #4339 — a /links strip shows only within its dates, in its own time zone.
--
-- Invariant I-4339-LINKS-STRIP-WINDOW: a published strip is public only while
-- now() is inside [shows_on 00:00, (COALESCE(shows_until, shows_on) + 1 day)
-- 00:00) in the strip's time_zone. public.links_strip_window() is the ONE
-- owner of that window: the public read policy, links_page_strips() and
-- admin_links_strips_list() all use it, and the website and Admin read its
-- answer (starts_at / ends_at / status) instead of recomputing it.
--
-- Replaces the #4318 end-only rule (COALESCE(shows_until, shows_on) >=
-- utc_today - 1, "public from creation"): a strip dated in the future is no
-- longer public before its first day, and the UTC-1 day grace goes because
-- the zone is now known.
--
--   - links_strips.time_zone text NOT NULL. The 7 existing strips are
--     backfilled to America/New_York (Seth, 14 Nov 2026). No default after
--     the backfill: every save names a zone.
--   - links_page_strips() and admin_links_strips_list() gain returned columns
--     (DROP + CREATE: a RETURNS TABLE cannot widen in place).
--   - admin_links_strip_save gains p_time_zone; the old 8-argument signature
--     is dropped so there is exactly one overload.
--
-- No anonymous SECURITY DEFINER signature changes (links_page_strips stays
-- SECURITY INVOKER; links_strip_window is SECURITY INVOKER), so the
-- anon-definer allowlist is untouched. Static SQL only (#1860 C7). No 40001
-- (#4134).

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ── The column ──────────────────────────────────────────────────────────────
ALTER TABLE public.links_strips ADD COLUMN IF NOT EXISTS time_zone text NULL;
UPDATE public.links_strips SET time_zone = 'America/New_York' WHERE time_zone IS NULL;
ALTER TABLE public.links_strips ALTER COLUMN time_zone DROP DEFAULT;
ALTER TABLE public.links_strips ALTER COLUMN time_zone SET NOT NULL;
COMMENT ON COLUMN public.links_strips.time_zone IS
  '#4339: IANA zone (a pg_timezone_names name) the strip''s days are read in. Its window is links_strip_window(shows_on, shows_until, time_zone).';

-- ── The one owner of the window ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.links_strip_window(p_shows_on date, p_shows_until date, p_time_zone text)
RETURNS tstzrange
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT tstzrange(
    p_shows_on::timestamp AT TIME ZONE p_time_zone,
    (COALESCE(p_shows_until, p_shows_on) + 1)::timestamp AT TIME ZONE p_time_zone,
    '[)'
  );
$function$;
REVOKE ALL ON FUNCTION public.links_strip_window(date, date, text) FROM PUBLIC;
-- The public read policy calls it as anon / authenticated.
GRANT EXECUTE ON FUNCTION public.links_strip_window(date, date, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.links_strip_window(date, date, text) IS
  '#4339 I-4339-LINKS-STRIP-WINDOW: [shows_on 00:00, (COALESCE(shows_until, shows_on) + 1) 00:00) in the strip''s zone. The only definition of when a /links strip is public.';

-- ── Public read: inside the window only ─────────────────────────────────────
GRANT SELECT (time_zone) ON public.links_strips TO anon, authenticated;
DROP POLICY IF EXISTS links_strips_public_read ON public.links_strips;
CREATE POLICY links_strips_public_read ON public.links_strips FOR SELECT TO anon, authenticated
  USING (is_published AND public.links_strip_window(shows_on, shows_until, time_zone) @> now());

DROP FUNCTION IF EXISTS public.links_page_strips();
CREATE OR REPLACE FUNCTION public.links_page_strips()
RETURNS TABLE (
  id uuid, shows_on date, shows_until date, title text, label text, opens text,
  url text, blog_slug text, "position" integer,
  time_zone text, starts_at timestamptz, ends_at timestamptz
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT strip.id, strip.shows_on, strip.shows_until, strip.title, strip.label, strip.opens,
         strip.url, post.slug, strip.position, strip.time_zone,
         lower(public.links_strip_window(strip.shows_on, strip.shows_until, strip.time_zone)),
         upper(public.links_strip_window(strip.shows_on, strip.shows_until, strip.time_zone))
  FROM public.links_strips strip
  LEFT JOIN public.blog_posts post ON post.id = strip.blog_post_id
  WHERE strip.is_published
    AND public.links_strip_window(strip.shows_on, strip.shows_until, strip.time_zone) @> now()
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
  '#4339: /links custom strips: published and inside their window (links_strip_window, in each strip''s time_zone), in admin order, with the window''s starts_at / ends_at; a blog strip only while its post is public (blog_slug set).';

-- ── Admin list: zone, window and status ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_links_strips_list();
CREATE OR REPLACE FUNCTION public.admin_links_strips_list()
RETURNS TABLE (
  id uuid, shows_on date, shows_until date, title text, label text, opens text, url text,
  blog_post_id uuid, blog_slug text, blog_title text, blog_is_public boolean,
  "position" integer, is_published boolean, is_expired boolean,
  created_at timestamptz, updated_at timestamptz,
  time_zone text, starts_at timestamptz, ends_at timestamptz, status text
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
    upper(strip_window.span) <= now(),
    strip.created_at, strip.updated_at,
    strip.time_zone, lower(strip_window.span), upper(strip_window.span),
    CASE
      WHEN now() < lower(strip_window.span) THEN 'scheduled'
      WHEN now() >= upper(strip_window.span) THEN 'ended'
      ELSE 'live'
    END
  FROM public.links_strips strip
  CROSS JOIN LATERAL (
    SELECT public.links_strip_window(strip.shows_on, strip.shows_until, strip.time_zone) AS span
  ) strip_window
  LEFT JOIN public.blog_posts post ON post.id = strip.blog_post_id
  ORDER BY strip.position, strip.created_at, strip.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_links_strips_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_links_strips_list() TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_links_strips_list() IS
  '#4339: every /links strip in page order with its blog post title, time zone, window (starts_at / ends_at) and status (scheduled | live | ended, from links_strip_window), for Support staff.';

-- ── Save: names a zone; one overload ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_links_strip_save(uuid, date, text, text, text, text, uuid, date);
CREATE OR REPLACE FUNCTION public.admin_links_strip_save(
  p_id uuid, p_shows_on date, p_title text, p_label text,
  p_opens text, p_url text, p_blog_post_id uuid, p_shows_until date DEFAULT NULL,
  p_time_zone text DEFAULT NULL
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
  IF p_shows_on IS NULL THEN
    RAISE EXCEPTION 'links_shows_on_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_shows_until IS NOT NULL AND p_shows_until < p_shows_on THEN
    RAISE EXCEPTION 'links_shows_until_invalid' USING ERRCODE = 'P0001';
  END IF;
  -- A zone Postgres knows by that exact name; the 8-argument call (no zone) is refused here.
  IF p_time_zone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names zone WHERE zone.name = p_time_zone) THEN
    RAISE EXCEPTION 'links_time_zone_invalid' USING ERRCODE = 'P0001';
  END IF;
  -- A window that has already ended in the strip's own zone cannot be saved.
  IF upper(public.links_strip_window(p_shows_on, p_shows_until, p_time_zone)) <= now() THEN
    IF p_shows_until IS NULL THEN
      RAISE EXCEPTION 'links_shows_on_invalid' USING ERRCODE = 'P0001';
    END IF;
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
    INSERT INTO public.links_strips (shows_on, shows_until, time_zone, title, label, opens, url, blog_post_id, position, created_by)
    VALUES (p_shows_on, p_shows_until, p_time_zone, v_title, p_label, p_opens, v_url, v_blog,
      COALESCE((SELECT min(existing.position) - 1 FROM public.links_strips existing), 0), v_actor)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.links_strips strip
    SET shows_on = p_shows_on, shows_until = p_shows_until, time_zone = p_time_zone, title = v_title,
        label = p_label, opens = p_opens, url = v_url, blog_post_id = v_blog, updated_at = now()
    WHERE strip.id = p_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'links_strip_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_links_strip_save(uuid, date, text, text, text, text, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_links_strip_save(uuid, date, text, text, text, text, uuid, date, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_links_strip_save(uuid, date, text, text, text, text, uuid, date, text) IS
  '#4339: create (p_id null; the new strip goes to the top) or update a /links strip. Validates the days (shows_until optional, on or after shows_on, window not already over in its zone), the time zone (a pg_timezone_names name), title, label, opens, web URL (scheme stripped) and published blog post.';

NOTIFY pgrst, 'reload schema';

COMMIT;

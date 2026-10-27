-- #4137 wave 3 — the Mingla blog: tables, predicates, RLS and grants.
-- MINGLA-INVARIANT: I-4137-BLOG-PUBLIC-READS-PUBLISHED-ONLY | issue #4137 | anon reads only public posts and only their published version; drafts, review notes and licence references never reach anon.
-- MINGLA-INVARIANT: I-4137-BLOG-WRITES-VIA-RPC-ROLE-GUARDED | issue #4137 | writer = is_support_staff, publisher = Owner/Admin or an enabled Support lead; anon and authenticated hold no table write grant.
--
-- Additive only. Touches no #3988 function: their bodies are snapshotted at
-- the start and compared before COMMIT (same proof as #3988 itself).
-- Static SQL only (#1860 C7). Conflicts raise PT409, never 40001 (#4134).

BEGIN;
SET LOCAL lock_timeout = '10s';

SELECT set_config('issue4137.is_support_staff_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.is_support_staff(uuid)'::regprocedure), true);
SELECT set_config('issue4137.capabilities_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.issue_3988_capabilities()'::regprocedure), true);
SELECT set_config('issue4137.operational_areas_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_my_operational_areas()'::regprocedure), true);

-- ───────────────────────────────────────────────────────────────────────────
-- A. Who may write and who may publish (spec §4.1, §1.6).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4137_blog_can_write(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL AND COALESCE(public.is_support_staff(p_user_id), false);
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_can_write(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_can_write(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_can_write(uuid) IS
  '#4137: blog writer = is_support_staff (the guard behind the Support area; I-3988-TAB-AREA-EQUALS-RPC-GUARD).';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_can_publish(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4137_blog_can_write(p_user_id)
    AND (
      EXISTS (
        SELECT 1
        FROM auth.users identity
        JOIN public.admin_users full_member
          ON lower(btrim(full_member.email)) = lower(btrim(identity.email))
        WHERE identity.id = p_user_id
          AND full_member.status = 'active'
      )
      OR EXISTS (
        SELECT 1 FROM public.support_staff staff
        WHERE staff.user_id = p_user_id AND staff.enabled = true AND staff.role = 'lead'
      )
    );
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_can_publish(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_can_publish(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_can_publish(uuid) IS
  '#4137: blog publisher = a writer who is an active Owner/Admin or an enabled Support lead.';

-- ───────────────────────────────────────────────────────────────────────────
-- B. Tables (spec §4.2).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blog_categories (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 40),
  description text NOT NULL CHECK (length(description) BETWEEN 50 AND 300),
  sort_order smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.blog_categories IS '#4137: the four blog categories. No city category, ever.';

INSERT INTO public.blog_categories (slug, label, description, sort_order) VALUES
  ('going-out', 'Going out', 'Where to go and what to do: plans for nights out, weekends and slow afternoons, from the people building Mingla.', 1),
  ('date-ideas', 'Date ideas', 'First dates, second dates and the ones after: easy plans for talking, laughing and finding somewhere worth going together.', 2),
  ('host-playbook', 'Host playbook', 'The playbook for hosts: pricing, selling out, marketing and running the door for events, venues, trips and experiences.', 3),
  ('product-news', 'Product news', 'What is new in Mingla and Mingla Host: features that just shipped, what they do and how to use them.', 4)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.blog_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL UNIQUE
    CHECK (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 12000),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 12000),
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
  alt text NOT NULL DEFAULT '' CHECK (length(alt) <= 500),
  source text NOT NULL CHECK (source IN ('mingla_owned', 'licensed_stock', 'partner_supplied')),
  source_ref text NOT NULL CHECK (length(btrim(source_ref)) BETWEEN 1 AND 500),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);
COMMENT ON TABLE public.blog_media IS
  '#4137: blog images Mingla owns or licensed. Never place-pool or Google photos. source_ref is admin-only.';

CREATE TABLE IF NOT EXISTS public.blog_authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
  avatar_media_id uuid NULL REFERENCES public.blog_media(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.blog_authors IS '#4137: blog bylines. One seed row, Mingla Editorial.';

INSERT INTO public.blog_authors (id, display_name)
VALUES ('41370000-0000-4000-8000-000000000001', 'Mingla Editorial')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL CHECK (
    length(slug) BETWEEN 3 AND 80
    AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND slug NOT IN ('category', 'preview', 'page', 'feed', 'rss', 'sitemap', 'search', 'tag', 'tags',
                     'author', 'authors', 'admin', 'api', 'new')
  ),
  category_slug text NOT NULL REFERENCES public.blog_categories(slug),
  author_id uuid NOT NULL DEFAULT '41370000-0000-4000-8000-000000000001' REFERENCES public.blog_authors(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'published', 'unpublished')),
  draft_version_id uuid NULL,
  published_version_id uuid NULL,
  publish_at timestamptz NULL,
  first_published_at timestamptz NULL,
  take_down_mode text NOT NULL DEFAULT 'never' CHECK (take_down_mode IN ('never', 'at', 'event_end')),
  take_down_at timestamptz NULL,
  take_down_event_id uuid NULL REFERENCES public.events(id),
  hide_passed_event_cards boolean NOT NULL DEFAULT true,
  show_in_more_stories boolean NOT NULL DEFAULT true,
  topics text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(topics) <= 5
    AND array_to_string(topics, ',') ~ '^([a-z0-9-]{2,30}(,[a-z0-9-]{2,30})*)?$'
  ),
  review_note text NULL CHECK (review_note IS NULL OR length(review_note) <= 2000),
  submitted_by uuid NULL,
  submitted_at timestamptz NULL,
  published_by uuid NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT blog_posts_published_has_version
    CHECK (status <> 'published' OR (published_version_id IS NOT NULL AND publish_at IS NOT NULL)),
  CONSTRAINT blog_posts_take_down_after_publish
    CHECK (take_down_at IS NULL OR publish_at IS NULL OR take_down_at > publish_at),
  CONSTRAINT blog_posts_take_down_shape CHECK (
    (take_down_mode = 'never' AND take_down_at IS NULL AND take_down_event_id IS NULL)
    OR (take_down_mode = 'at' AND take_down_at IS NOT NULL AND take_down_event_id IS NULL)
    OR (take_down_mode = 'event_end' AND take_down_event_id IS NOT NULL
        AND (status <> 'published' OR take_down_at IS NOT NULL))
  )
);
COMMENT ON TABLE public.blog_posts IS
  '#4137: blog post identity, workflow and placement. Written only through SECURITY DEFINER RPCs.';

CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_slug_live_key
  ON public.blog_posts (lower(slug)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS blog_posts_status_publish_idx
  ON public.blog_posts (status, publish_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS blog_posts_category_publish_idx
  ON public.blog_posts (category_slug, publish_at DESC);

CREATE TABLE IF NOT EXISTS public.blog_post_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('draft', 'published')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 300),
  cover_media_id uuid NULL REFERENCES public.blog_media(id),
  cover_alt text NOT NULL DEFAULT '' CHECK (length(cover_alt) <= 500),
  seo_title text NULL CHECK (seo_title IS NULL OR length(seo_title) <= 70),
  seo_description text NULL CHECK (seo_description IS NULL OR length(seo_description) <= 170),
  social_title text NULL CHECK (social_title IS NULL OR length(social_title) <= 90),
  social_description text NULL CHECK (social_description IS NULL OR length(social_description) <= 200),
  document jsonb NOT NULL DEFAULT '{"version":1,"blocks":[]}'::jsonb,
  read_minutes smallint NOT NULL DEFAULT 1 CHECK (read_minutes >= 1),
  media_ids uuid[] NOT NULL DEFAULT '{}',
  ref_place_ids uuid[] NOT NULL DEFAULT '{}',
  ref_event_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blog_post_versions_id_post_key UNIQUE (id, post_id)
);
COMMENT ON TABLE public.blog_post_versions IS
  '#4137: post content snapshots. The public sees only the published version of a public post.';
CREATE INDEX IF NOT EXISTS blog_post_versions_post_idx ON public.blog_post_versions (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS blog_post_versions_media_gin ON public.blog_post_versions USING gin (media_ids);
CREATE INDEX IF NOT EXISTS blog_post_versions_cover_idx ON public.blog_post_versions (cover_media_id);

-- A post's draft and published versions must be its own (composite FKs).
ALTER TABLE public.blog_posts DROP CONSTRAINT IF EXISTS blog_posts_draft_version_fk;
ALTER TABLE public.blog_posts ADD CONSTRAINT blog_posts_draft_version_fk
  FOREIGN KEY (draft_version_id, id) REFERENCES public.blog_post_versions (id, post_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.blog_posts DROP CONSTRAINT IF EXISTS blog_posts_published_version_fk;
ALTER TABLE public.blog_posts ADD CONSTRAINT blog_posts_published_version_fk
  FOREIGN KEY (published_version_id, id) REFERENCES public.blog_post_versions (id, post_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS public.blog_post_link_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.blog_post_versions(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  results jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(results) = 'array' AND jsonb_array_length(results) <= 200),
  checked_by uuid NULL
);
COMMENT ON TABLE public.blog_post_link_checks IS '#4137: link-check receipts, written by the admin-blog edge function only.';
CREATE INDEX IF NOT EXISTS blog_post_link_checks_version_idx
  ON public.blog_post_link_checks (version_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.blog_featured (
  slot text PRIMARY KEY CHECK (slot = 'blog_index'),
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  since timestamptz NOT NULL DEFAULT now(),
  set_by uuid NOT NULL
);
COMMENT ON TABLE public.blog_featured IS '#4137: the one featured slot at the top of /blog.';

CREATE TABLE IF NOT EXISTS public.blog_preview_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.blog_post_versions(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.blog_preview_tokens IS '#4137: one-hour staff preview links. Only the sha256 of the token is stored.';

CREATE TABLE IF NOT EXISTS public.blog_post_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  actor uuid NULL,
  action text NOT NULL CHECK (action IN ('create', 'save', 'submit', 'request_changes', 'publish', 'reschedule',
                                         'unpublish', 'feature', 'unfeature', 'delete')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.blog_post_audit IS '#4137: append-only blog workflow audit.';
CREATE INDEX IF NOT EXISTS blog_post_audit_post_idx ON public.blog_post_audit (post_id, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- C. The document's structure and the ids it references.
--    The save RPC and the seed both write versions; this trigger is the one
--    place that refuses an unknown block and derives media/place/event ids,
--    so the public predicates below can never drift from the document.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4137_blog_document_problems(p_document jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  WITH blocks AS (
    SELECT block, ordinality - 1 AS idx
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_document -> 'blocks') = 'array' THEN p_document -> 'blocks' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS b(block, ordinality)
  )
  SELECT COALESCE(array_agg(problem ORDER BY problem), '{}')
  FROM (
    SELECT 'document:not_object' AS problem WHERE jsonb_typeof(p_document) IS DISTINCT FROM 'object'
    UNION ALL SELECT 'document:version_invalid' WHERE (p_document -> 'version') IS DISTINCT FROM '1'::jsonb
    UNION ALL SELECT 'document:blocks_invalid' WHERE jsonb_typeof(p_document -> 'blocks') IS DISTINCT FROM 'array'
    UNION ALL SELECT 'document:too_many_blocks' WHERE jsonb_array_length(
      CASE WHEN jsonb_typeof(p_document -> 'blocks') = 'array' THEN p_document -> 'blocks' ELSE '[]'::jsonb END) > 300
    UNION ALL SELECT 'document:too_large' WHERE pg_column_size(p_document) > 524288
    UNION ALL
    SELECT format('block_%s:id_invalid', idx) FROM blocks
    WHERE jsonb_typeof(block) <> 'object' OR COALESCE(block ->> 'id', '') !~ '^[A-Za-z0-9_-]{6,40}$'
    UNION ALL
    SELECT format('block_%s:type_unsupported', idx) FROM blocks
    WHERE COALESCE(block ->> 'type', '') NOT IN ('paragraph', 'heading', 'list', 'quote', 'callout', 'image', 'gallery',
      'video', 'embed', 'divider', 'button', 'place', 'offering', 'plan', 'city')
    UNION ALL
    SELECT format('block_%s:alt_required', idx) FROM blocks
    WHERE block ->> 'type' = 'image' AND length(btrim(COALESCE(block ->> 'alt', ''))) = 0
    UNION ALL
    SELECT format('block_%s:alt_required', idx) FROM blocks
    WHERE block ->> 'type' = 'gallery' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(block -> 'items') = 'array' THEN block -> 'items' ELSE '[]'::jsonb END) item
      WHERE length(btrim(COALESCE(item ->> 'alt', ''))) = 0)
    UNION ALL
    SELECT 'document:block_id_duplicate' WHERE EXISTS (
      SELECT 1 FROM blocks GROUP BY block ->> 'id' HAVING count(*) > 1)
  ) found;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_document_problems(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_document_problems(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_document_problems(jsonb) IS
  '#4137: structural document checks mirrored from packages/blog-document validateBlogDocument.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_version_derive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_problems text[];
  v_rich text;
BEGIN
  v_problems := public.issue_4137_blog_document_problems(NEW.document);
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'blog_document_invalid' USING ERRCODE = 'P0001', DETAIL = array_to_string(v_problems, ',');
  END IF;

  -- Every rich-text string (paragraph/quote/callout html and list items).
  SELECT string_agg(value, ' ') INTO v_rich
  FROM (
    SELECT block ->> 'html' AS value FROM jsonb_array_elements(NEW.document -> 'blocks') block
    WHERE block ->> 'type' IN ('paragraph', 'quote', 'callout')
    UNION ALL
    SELECT item #>> '{}' FROM jsonb_array_elements(NEW.document -> 'blocks') block,
      jsonb_array_elements(CASE WHEN jsonb_typeof(block -> 'items') = 'array' THEN block -> 'items' ELSE '[]'::jsonb END) item
    WHERE block ->> 'type' = 'list'
  ) rich;

  NEW.media_ids := ARRAY(
    SELECT DISTINCT id::uuid FROM (
      SELECT NEW.cover_media_id::text AS id
      UNION ALL SELECT block ->> 'mediaId' FROM jsonb_array_elements(NEW.document -> 'blocks') block WHERE block ->> 'type' = 'image'
      UNION ALL SELECT block ->> 'moodMediaId' FROM jsonb_array_elements(NEW.document -> 'blocks') block WHERE block ->> 'type' = 'offering'
      UNION ALL SELECT item ->> 'mediaId' FROM jsonb_array_elements(NEW.document -> 'blocks') block,
        jsonb_array_elements(CASE WHEN jsonb_typeof(block -> 'items') = 'array' THEN block -> 'items' ELSE '[]'::jsonb END) item
        WHERE block ->> 'type' = 'gallery'
    ) ids
    WHERE id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
  NEW.ref_place_ids := ARRAY(
    SELECT DISTINCT id::uuid FROM (
      SELECT block ->> 'placeId' AS id FROM jsonb_array_elements(NEW.document -> 'blocks') block WHERE block ->> 'type' = 'place'
      UNION ALL SELECT stop #>> '{}' FROM jsonb_array_elements(NEW.document -> 'blocks') block,
        jsonb_array_elements(CASE WHEN jsonb_typeof(block -> 'stops') = 'array' THEN block -> 'stops' ELSE '[]'::jsonb END) stop
        WHERE block ->> 'type' = 'plan'
      UNION ALL SELECT block #>> '{target,placeId}' FROM jsonb_array_elements(NEW.document -> 'blocks') block
        WHERE block ->> 'type' = 'button' AND block #>> '{target,kind}' = 'place'
      UNION ALL SELECT m[1] FROM regexp_matches(COALESCE(v_rich, ''), 'data-mingla-target="place:([0-9a-f-]{36})"', 'g') m
    ) ids
    WHERE id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
  NEW.ref_event_ids := ARRAY(
    SELECT DISTINCT id::uuid FROM (
      SELECT block ->> 'eventId' AS id FROM jsonb_array_elements(NEW.document -> 'blocks') block WHERE block ->> 'type' = 'offering'
      UNION ALL SELECT block #>> '{target,eventId}' FROM jsonb_array_elements(NEW.document -> 'blocks') block
        WHERE block ->> 'type' = 'button' AND block #>> '{target,kind}' = 'offering'
      UNION ALL SELECT m[1] FROM regexp_matches(COALESCE(v_rich, ''), 'data-mingla-target="offering:([0-9a-f-]{36})"', 'g') m
    ) ids
    WHERE id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_version_derive() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.issue_4137_blog_version_derive() IS
  '#4137: refuses a structurally invalid document and derives media_ids, ref_place_ids and ref_event_ids.';

DROP TRIGGER IF EXISTS issue_4137_blog_version_derive ON public.blog_post_versions;
CREATE TRIGGER issue_4137_blog_version_derive
  BEFORE INSERT OR UPDATE OF document, cover_media_id ON public.blog_post_versions
  FOR EACH ROW EXECUTE FUNCTION public.issue_4137_blog_version_derive();

-- ───────────────────────────────────────────────────────────────────────────
-- D. Public visibility (spec §4.1, §4.5). Computed with now() at read time,
--    so "scheduled" and "taken down" need no cron.
--    The column form exists because anon holds column-level grants only, so
--    a whole-row argument would need columns anon may not read.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4137_blog_post_visible(
  p_status text, p_deleted_at timestamptz, p_published_version_id uuid,
  p_publish_at timestamptz, p_take_down_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_status = 'published'
    AND p_deleted_at IS NULL
    AND p_published_version_id IS NOT NULL
    AND p_publish_at IS NOT NULL
    AND p_publish_at <= now()
    AND (p_take_down_at IS NULL OR p_take_down_at > now());
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_post_visible(text, timestamptz, uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_post_visible(text, timestamptz, uuid, timestamptz, timestamptz)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_post_visible(text, timestamptz, uuid, timestamptz, timestamptz) IS
  '#4137: the one public-visibility rule, column form (used by RLS and the public RPCs).';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_post_is_public(p_post public.blog_posts)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4137_blog_post_visible(p_post.status, p_post.deleted_at, p_post.published_version_id,
                                             p_post.publish_at, p_post.take_down_at);
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_post_is_public(public.blog_posts) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_post_is_public(public.blog_posts) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_post_is_public(public.blog_posts) IS
  '#4137: row form of issue_4137_blog_post_visible, for service-role callers (email resolution, edge functions).';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_version_is_public(p_version_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.blog_posts post
    WHERE post.published_version_id = p_version_id
      AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                              post.publish_at, post.take_down_at)
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_version_is_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_version_is_public(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_version_is_public(uuid) IS
  '#4137: true only for the published version of a public post. A public post''s draft version is never public.';

CREATE OR REPLACE FUNCTION public.issue_4137_blog_media_is_public(p_media_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.blog_media media
    JOIN public.blog_post_versions version ON version.media_ids @> ARRAY[media.id]
    JOIN public.blog_posts post ON post.published_version_id = version.id
    WHERE media.id = p_media_id
      AND media.deleted_at IS NULL
      AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                              post.publish_at, post.take_down_at)
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4137_blog_media_is_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4137_blog_media_is_public(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.issue_4137_blog_media_is_public(uuid) IS
  '#4137: a media row is public only while a public post''s published version uses it (cover or document).';

-- ───────────────────────────────────────────────────────────────────────────
-- E. RLS and grants (spec §4.3, AC-DB2, AC-DB3). The baseline's default
--    privileges grant ALL on new tables, so everything is revoked first.
--    No anon or authenticated write grant exists on any blog table: the only
--    write path is SECURITY DEFINER RPCs (wave 4) and the service role.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.blog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_post_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_post_link_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_featured ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_preview_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_post_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.blog_categories, public.blog_authors, public.blog_media, public.blog_posts,
  public.blog_post_versions, public.blog_post_link_checks, public.blog_featured, public.blog_preview_tokens,
  public.blog_post_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.blog_categories, public.blog_authors, public.blog_media, public.blog_posts,
  public.blog_post_versions, public.blog_post_link_checks, public.blog_featured, public.blog_preview_tokens,
  public.blog_post_audit TO service_role;

-- Categories: public.
GRANT SELECT (slug, label, description, sort_order) ON public.blog_categories TO anon, authenticated;
DROP POLICY IF EXISTS blog_categories_public_read ON public.blog_categories;
CREATE POLICY blog_categories_public_read ON public.blog_categories FOR SELECT TO anon, authenticated USING (true);

-- Authors: public bylines.
GRANT SELECT (id, display_name, avatar_media_id) ON public.blog_authors TO anon, authenticated;
DROP POLICY IF EXISTS blog_authors_public_read ON public.blog_authors;
CREATE POLICY blog_authors_public_read ON public.blog_authors FOR SELECT TO anon, authenticated USING (true);

-- Posts: public rows for everyone; every row for writers. Workflow columns
-- (review notes, who did what, revision, draft pointer) are never granted.
GRANT SELECT (id, slug, category_slug, author_id, status, published_version_id, publish_at, first_published_at,
  take_down_mode, take_down_at, take_down_event_id, hide_passed_event_cards, show_in_more_stories, topics,
  created_at, updated_at, deleted_at) ON public.blog_posts TO anon, authenticated;
DROP POLICY IF EXISTS blog_posts_public_read ON public.blog_posts;
CREATE POLICY blog_posts_public_read ON public.blog_posts FOR SELECT TO anon, authenticated
  USING (public.issue_4137_blog_post_visible(status, deleted_at, published_version_id, publish_at, take_down_at));
DROP POLICY IF EXISTS blog_posts_staff_read ON public.blog_posts;
CREATE POLICY blog_posts_staff_read ON public.blog_posts FOR SELECT TO authenticated
  USING (public.issue_4137_blog_can_write());

-- Versions: only a public post's published version; writers see every version.
GRANT SELECT (id, post_id, kind, title, summary, cover_media_id, cover_alt, seo_title, seo_description,
  social_title, social_description, document, read_minutes, media_ids, ref_place_ids, ref_event_ids, created_at)
  ON public.blog_post_versions TO anon, authenticated;
DROP POLICY IF EXISTS blog_post_versions_public_read ON public.blog_post_versions;
CREATE POLICY blog_post_versions_public_read ON public.blog_post_versions FOR SELECT TO anon, authenticated
  USING (public.issue_4137_blog_version_is_public(id));
DROP POLICY IF EXISTS blog_post_versions_staff_read ON public.blog_post_versions;
CREATE POLICY blog_post_versions_staff_read ON public.blog_post_versions FOR SELECT TO authenticated
  USING (public.issue_4137_blog_can_write());

-- Media: only what a public post shows; source_ref is never granted.
GRANT SELECT (id, storage_path, width, height, alt) ON public.blog_media TO anon, authenticated;
DROP POLICY IF EXISTS blog_media_public_read ON public.blog_media;
CREATE POLICY blog_media_public_read ON public.blog_media FOR SELECT TO anon, authenticated
  USING (public.issue_4137_blog_media_is_public(id));
DROP POLICY IF EXISTS blog_media_staff_read ON public.blog_media;
CREATE POLICY blog_media_staff_read ON public.blog_media FOR SELECT TO authenticated
  USING (public.issue_4137_blog_can_write());

-- Featured slot: the post id, only while that post is public.
GRANT SELECT (slot, post_id) ON public.blog_featured TO anon, authenticated;
DROP POLICY IF EXISTS blog_featured_public_read ON public.blog_featured;
CREATE POLICY blog_featured_public_read ON public.blog_featured FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.blog_posts post
    WHERE post.id = blog_featured.post_id
      AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                              post.publish_at, post.take_down_at)
  ));
DROP POLICY IF EXISTS blog_featured_staff_read ON public.blog_featured;
CREATE POLICY blog_featured_staff_read ON public.blog_featured FOR SELECT TO authenticated
  USING (public.issue_4137_blog_can_write());

-- Link checks: writers read; only the service role writes.
GRANT SELECT ON public.blog_post_link_checks TO authenticated;
DROP POLICY IF EXISTS blog_post_link_checks_staff_read ON public.blog_post_link_checks;
CREATE POLICY blog_post_link_checks_staff_read ON public.blog_post_link_checks FOR SELECT TO authenticated
  USING (public.issue_4137_blog_can_write());

-- Audit: publishers read.
GRANT SELECT ON public.blog_post_audit TO authenticated;
DROP POLICY IF EXISTS blog_post_audit_publisher_read ON public.blog_post_audit;
CREATE POLICY blog_post_audit_publisher_read ON public.blog_post_audit FOR SELECT TO authenticated
  USING (public.issue_4137_blog_can_publish());

-- Preview tokens: no policy, no grant. Service role and definer RPCs only.

-- ───────────────────────────────────────────────────────────────────────────
-- F. #3988 functions are untouched (AC-DB13).
-- ───────────────────────────────────────────────────────────────────────────
DO $assert$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.is_support_staff(uuid)'::regprocedure)
       IS DISTINCT FROM current_setting('issue4137.is_support_staff_md5')
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.issue_3988_capabilities()'::regprocedure)
       IS DISTINCT FROM current_setting('issue4137.capabilities_md5')
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_my_operational_areas()'::regprocedure)
       IS DISTINCT FROM current_setting('issue4137.operational_areas_md5') THEN
    RAISE EXCEPTION 'issue_4137: a #3988 function body changed during the blog migration';
  END IF;
END
$assert$;

COMMIT;

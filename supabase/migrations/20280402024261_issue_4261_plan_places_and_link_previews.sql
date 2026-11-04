-- Issue #4261 Wave D-back — suggest and vote on places, and link previews.
--
--   * chat_plan_place_options / chat_plan_place_votes: members suggest another
--     place for a deciding chat plan and tap every place that works. The
--     plan's own place is seeded as the original option on the first
--     suggestion. A new suggestion posts one system line; votes post none.
--     Deck matches never take alternative places (the match is the place).
--   * plan_lock gains p_place_option_id (one function, five arguments): a
--     locked chat plan with place options takes the chosen (or leading)
--     option into its own where columns in the same UPDATE that schedules it.
--   * a Mapbox or typed place may carry its own link (website, menu, tickets);
--     a Mingla pool place never does.
--   * chat_plan_link_previews: one cache of page previews keyed by the exact
--     stored link URL, written only by the service-role store function
--     (the plan-link-preview edge function) and read by phones only through
--     chat_plans_for_conversation.
--
-- All writes go through SECURITY DEFINER RPCs; the new tables carry SELECT
-- policies only (previews: none). Application conflicts raise PT409, never
-- 40001. Static SQL only. Idempotent: safe to apply twice.

BEGIN;

-- ── chat_plan_place_options ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_plan_place_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.chat_plans(id) ON DELETE CASCADE,
  kind text NOT NULL CONSTRAINT chat_plan_place_options_kind_check CHECK (kind IN ('place', 'address', 'link')),
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  mapbox_id text NULL CONSTRAINT chat_plan_place_options_mapbox_id_length CHECK (char_length(mapbox_id) <= 256),
  place_name text NULL CONSTRAINT chat_plan_place_options_place_name_length CHECK (char_length(place_name) BETWEEN 1 AND 120),
  place_address text NULL CONSTRAINT chat_plan_place_options_place_address_length CHECK (char_length(place_address) <= 240),
  place_lat double precision NULL,
  place_lng double precision NULL,
  place_photo_url text NULL
    CONSTRAINT chat_plan_place_options_place_photo_url_shape CHECK (char_length(place_photo_url) <= 1024 AND place_photo_url ~ '^https://'),
  link_url text NULL
    CONSTRAINT chat_plan_place_options_link_url_shape CHECK (char_length(link_url) <= 2048 AND link_url ~* '^https?://[^\s/]+\.[^\s/]+'),
  link_domain text NULL,
  identity_key text NOT NULL CONSTRAINT chat_plan_place_options_identity_key_length CHECK (char_length(identity_key) BETWEEN 1 AND 2100),
  is_original boolean NOT NULL DEFAULT false,
  added_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_plan_place_options_coordinates CHECK (
    (place_lat IS NULL AND place_lng IS NULL)
    OR (place_lat BETWEEN -90 AND 90 AND place_lng BETWEEN -180 AND 180)
  ),
  CONSTRAINT chat_plan_place_options_shape CHECK (
    (
      (
        (kind = 'place' AND place_name IS NOT NULL AND (place_pool_id IS NOT NULL OR mapbox_id IS NOT NULL))
        OR (kind = 'address' AND place_name IS NOT NULL AND place_pool_id IS NULL AND mapbox_id IS NULL)
      )
      AND (link_url IS NULL OR place_pool_id IS NULL)
      AND ((link_url IS NULL) = (link_domain IS NULL))
    )
    OR (kind = 'link' AND link_url IS NOT NULL AND link_domain IS NOT NULL
        AND place_pool_id IS NULL AND mapbox_id IS NULL AND place_name IS NULL AND place_address IS NULL
        AND place_lat IS NULL AND place_lng IS NULL AND place_photo_url IS NULL)
  ),
  CONSTRAINT chat_plan_place_options_photo_needs_pool CHECK (place_photo_url IS NULL OR place_pool_id IS NOT NULL),
  CONSTRAINT chat_plan_place_options_plan_identity_key UNIQUE (plan_id, identity_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_plan_place_options_one_original
  ON public.chat_plan_place_options (plan_id) WHERE is_original;
CREATE INDEX IF NOT EXISTS chat_plan_place_options_plan_idx ON public.chat_plan_place_options (plan_id);
CREATE INDEX IF NOT EXISTS chat_plan_place_options_link_url_idx
  ON public.chat_plan_place_options (link_url) WHERE link_url IS NOT NULL;

-- ── chat_plan_place_votes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_plan_place_votes (
  option_id uuid NOT NULL REFERENCES public.chat_plan_place_options(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.chat_plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_plan_place_votes_plan_idx ON public.chat_plan_place_votes (plan_id);

-- ── chat_plan_link_previews (one cache, keyed by the stored URL) ───────────
CREATE TABLE IF NOT EXISTS public.chat_plan_link_previews (
  url text PRIMARY KEY CONSTRAINT chat_plan_link_previews_url_length CHECK (char_length(url) <= 2048),
  outcome text NOT NULL CONSTRAINT chat_plan_link_previews_outcome_check CHECK (outcome IN ('ok', 'failed')),
  title text NULL CONSTRAINT chat_plan_link_previews_title_length CHECK (char_length(title) <= 200),
  site_name text NULL CONSTRAINT chat_plan_link_previews_site_name_length CHECK (char_length(site_name) <= 80),
  image_url text NULL
    CONSTRAINT chat_plan_link_previews_image_url_shape CHECK (char_length(image_url) <= 1024 AND image_url ~ '^https://'),
  final_url text NULL CONSTRAINT chat_plan_link_previews_final_url_length CHECK (char_length(final_url) <= 2048),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 1 CONSTRAINT chat_plan_link_previews_attempts_check CHECK (attempts >= 1)
);

-- ── RLS + grants ────────────────────────────────────────────────────────────
ALTER TABLE public.chat_plan_place_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_plan_place_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_plan_link_previews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.chat_plan_place_options FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chat_plan_place_votes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chat_plan_link_previews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_plan_place_options TO authenticated;
GRANT SELECT ON public.chat_plan_place_votes TO authenticated;
GRANT ALL ON public.chat_plan_place_options TO service_role;
GRANT ALL ON public.chat_plan_place_votes TO service_role;
GRANT ALL ON public.chat_plan_link_previews TO service_role;

DROP POLICY IF EXISTS chat_plan_place_options_member_read ON public.chat_plan_place_options;
CREATE POLICY chat_plan_place_options_member_read ON public.chat_plan_place_options
  FOR SELECT TO authenticated USING (public.chat_plan_visible(plan_id));
DROP POLICY IF EXISTS chat_plan_place_votes_member_read ON public.chat_plan_place_votes;
CREATE POLICY chat_plan_place_votes_member_read ON public.chat_plan_place_votes
  FOR SELECT TO authenticated USING (public.chat_plan_visible(plan_id));

-- ── chat_plans: a Mapbox / typed place may carry its own link ──────────────
ALTER TABLE public.chat_plans DROP CONSTRAINT IF EXISTS chat_plans_where_shape;
ALTER TABLE public.chat_plans ADD CONSTRAINT chat_plans_where_shape CHECK (
  (where_kind = 'place' AND place_name IS NOT NULL AND (place_pool_id IS NOT NULL OR mapbox_id IS NOT NULL)
     AND (link_url IS NULL OR place_pool_id IS NULL) AND ((link_url IS NULL) = (link_domain IS NULL)))
  OR (where_kind = 'address' AND place_name IS NOT NULL AND place_pool_id IS NULL AND mapbox_id IS NULL
     AND ((link_url IS NULL) = (link_domain IS NULL)))
  OR (where_kind = 'link' AND link_url IS NOT NULL AND link_domain IS NOT NULL
     AND place_pool_id IS NULL AND mapbox_id IS NULL AND place_name IS NULL AND place_address IS NULL
     AND place_lat IS NULL AND place_lng IS NULL AND place_photo_url IS NULL)
  OR (where_kind = 'none' AND place_pool_id IS NULL AND mapbox_id IS NULL AND place_name IS NULL
     AND place_address IS NULL AND place_lat IS NULL AND place_lng IS NULL AND place_photo_url IS NULL
     AND link_url IS NULL AND link_domain IS NULL)
);
CREATE INDEX IF NOT EXISTS chat_plans_link_url_idx
  ON public.chat_plans (link_url) WHERE link_url IS NOT NULL;

-- ── Internal helpers (service_role only) ───────────────────────────────────
-- The dedupe key of a place option. Server-derived, never from the client.
-- An attached link does not change a place's identity.
CREATE OR REPLACE FUNCTION public.chat_plan_place_identity_key(
  p_kind text, p_pool_id uuid, p_mapbox_id text, p_name text, p_address text, p_link_url text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions, pg_temp
AS $function$
  SELECT CASE
    WHEN p_kind = 'link' THEN 'link:' || lower(regexp_replace(p_link_url, '/+$', ''))
    WHEN p_pool_id IS NOT NULL THEN 'pool:' || p_pool_id::text
    WHEN p_mapbox_id IS NOT NULL THEN 'mapbox:' || p_mapbox_id
    ELSE 'addr:' || public.mingla_normalize_place_name(p_name) || '|' || lower(btrim(COALESCE(p_address, '')))
  END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_place_identity_key(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_place_identity_key(text, uuid, text, text, text, text) TO service_role;

-- The single owner of "where" validation (plan_create, plan_add_place).
-- Pool rows: name / address / lat / lng / photo come from place_pool.
CREATE OR REPLACE FUNCTION public.chat_plan_parse_where(p_where_kind text, p_place jsonb, p_link_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_where text := COALESCE(p_where_kind, 'none');
  v_place public.place_pool%ROWTYPE;
  v_pool_id uuid;
  v_mapbox_id text;
  v_name text;
  v_address text;
  v_lat double precision;
  v_lng double precision;
  v_photo text;
  v_link text;
  v_domain text;
BEGIN
  IF v_where NOT IN ('place', 'address', 'link', 'none') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_where_kind';
  END IF;
  IF v_where IN ('place', 'address') AND (p_place IS NULL OR jsonb_typeof(p_place) <> 'object') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place';
  END IF;

  IF v_where = 'place' AND p_place ? 'poolId' AND p_place ->> 'poolId' IS NOT NULL THEN
    IF (p_place ->> 'poolId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.poolId';
    END IF;
    SELECT * INTO v_place FROM public.place_pool
     WHERE id = (p_place ->> 'poolId')::uuid AND is_active IS TRUE AND is_servable IS TRUE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.poolId';
    END IF;
    v_pool_id := v_place.id;
    v_name := left(btrim(v_place.name), 120);
    v_address := left(COALESCE(NULLIF(btrim(v_place.address), ''), NULLIF(btrim(v_place.city), '')), 240);
    v_lat := v_place.lat;
    v_lng := v_place.lng;
    v_photo := v_place.stored_photo_urls[1];
    IF v_photo IS NOT NULL AND (v_photo !~ '^https://' OR char_length(v_photo) > 1024) THEN
      v_photo := NULL;
    END IF;
  ELSIF v_where = 'place' THEN
    v_mapbox_id := NULLIF(btrim(COALESCE(p_place ->> 'mapboxId', '')), '');
    v_name := NULLIF(btrim(COALESCE(p_place ->> 'name', '')), '');
    v_address := NULLIF(btrim(COALESCE(p_place ->> 'address', '')), '');
    IF v_mapbox_id IS NULL OR char_length(v_mapbox_id) > 256 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.mapboxId';
    END IF;
    IF v_name IS NULL OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.name';
    END IF;
    IF char_length(v_address) > 240 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.address';
    END IF;
    IF jsonb_typeof(p_place -> 'lat') <> 'number' OR jsonb_typeof(p_place -> 'lng') <> 'number' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.lat';
    END IF;
    v_lat := (p_place ->> 'lat')::double precision;
    v_lng := (p_place ->> 'lng')::double precision;
    IF v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.lat';
    END IF;
  ELSIF v_where = 'address' THEN
    v_name := NULLIF(btrim(COALESCE(p_place ->> 'name', '')), '');
    v_address := NULLIF(btrim(COALESCE(p_place ->> 'address', '')), '');
    IF v_name IS NULL OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.name';
    END IF;
    IF char_length(v_address) > 240 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.address';
    END IF;
    IF jsonb_typeof(p_place -> 'lat') = 'number' AND jsonb_typeof(p_place -> 'lng') = 'number' THEN
      v_lat := (p_place ->> 'lat')::double precision;
      v_lng := (p_place ->> 'lng')::double precision;
      IF v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place.lat';
      END IF;
    END IF;
  END IF;

  -- The link: required for a link plan; optional on a Mapbox or typed place;
  -- refused on a Mingla pool place (the Mingla card has the venue's links).
  IF v_where = 'link' THEN
    v_link := btrim(COALESCE(p_link_url, ''));
  ELSIF v_where IN ('place', 'address') THEN
    v_link := NULLIF(btrim(COALESCE(p_link_url, '')), '');
    IF v_link IS NOT NULL AND v_pool_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_link_url';
    END IF;
  END IF;
  IF v_link IS NOT NULL THEN
    IF char_length(v_link) > 2048 OR v_link !~* '^https?://[^\s/]+\.[^\s/]+' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_link_url';
    END IF;
    v_domain := lower(substring(v_link from '^[A-Za-z]+://(?:[^/?#@]*@)?([^/?#:]+)'));
    v_domain := regexp_replace(COALESCE(v_domain, ''), '^www\.', '');
    IF v_domain = '' OR position('.' in v_domain) = 0 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_link_url';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'kind', v_where,
    'poolId', v_pool_id,
    'mapboxId', v_mapbox_id,
    'name', v_name,
    'address', v_address,
    'lat', v_lat,
    'lng', v_lng,
    'photoUrl', v_photo,
    'linkUrl', v_link,
    'linkDomain', v_domain,
    'identityKey', CASE WHEN v_where = 'none' THEN NULL
                        ELSE public.chat_plan_place_identity_key(v_where, v_pool_id, v_mapbox_id, v_name, v_address, v_link) END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_parse_where(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_parse_where(text, jsonb, text) TO service_role;

-- The leading place option: most votes; ties -> the original, then the
-- earliest, then id. NULL when the plan has no place options.
CREATE OR REPLACE FUNCTION public.chat_plan_place_leader(p_plan_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT o.id
    FROM public.chat_plan_place_options o
   WHERE o.plan_id = p_plan_id
   ORDER BY (SELECT count(*) FROM public.chat_plan_place_votes v WHERE v.option_id = o.id) DESC,
            o.is_original DESC, o.created_at, o.id
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_place_leader(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_place_leader(uuid) TO service_role;

-- Seeds the plan's own place as the original option (with the creator's vote
-- while the creator is still in the chat) the first time anyone suggests one.
CREATE OR REPLACE FUNCTION public.chat_plan_seed_original_place(p_plan public.chat_plans)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_option_id uuid;
BEGIN
  IF p_plan.where_kind = 'none'
     OR EXISTS (SELECT 1 FROM public.chat_plan_place_options WHERE plan_id = p_plan.id) THEN
    RETURN;
  END IF;

  INSERT INTO public.chat_plan_place_options (
    plan_id, kind, place_pool_id, mapbox_id, place_name, place_address, place_lat, place_lng,
    place_photo_url, link_url, link_domain, identity_key, is_original, added_by, created_at
  ) VALUES (
    p_plan.id, p_plan.where_kind, p_plan.place_pool_id, p_plan.mapbox_id, p_plan.place_name,
    p_plan.place_address, p_plan.place_lat, p_plan.place_lng,
    CASE WHEN p_plan.place_pool_id IS NOT NULL THEN p_plan.place_photo_url END,
    p_plan.link_url, p_plan.link_domain,
    public.chat_plan_place_identity_key(p_plan.where_kind, p_plan.place_pool_id, p_plan.mapbox_id,
                                        p_plan.place_name, p_plan.place_address, p_plan.link_url),
    true, p_plan.created_by, p_plan.created_at
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_option_id;

  IF v_option_id IS NOT NULL AND p_plan.created_by IS NOT NULL
     AND public.is_conversation_participant(p_plan.conversation_id, p_plan.created_by) THEN
    INSERT INTO public.chat_plan_place_votes (option_id, plan_id, user_id)
    VALUES (v_option_id, p_plan.id, p_plan.created_by)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_seed_original_place(public.chat_plans) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_seed_original_place(public.chat_plans) TO service_role;

-- A link with its cached preview, as phones read it.
CREATE OR REPLACE FUNCTION public.chat_plan_link_json(p_url text, p_domain text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT CASE WHEN p_url IS NULL THEN NULL ELSE jsonb_build_object(
    'url', p_url,
    'domain', p_domain,
    'title', (SELECT lp.title FROM public.chat_plan_link_previews lp WHERE lp.url = p_url AND lp.outcome = 'ok'),
    'imageUrl', (SELECT lp.image_url FROM public.chat_plan_link_previews lp WHERE lp.url = p_url AND lp.outcome = 'ok'),
    'siteName', (SELECT lp.site_name FROM public.chat_plan_link_previews lp WHERE lp.url = p_url AND lp.outcome = 'ok'),
    'fetchedAt', (SELECT lp.fetched_at FROM public.chat_plan_link_previews lp WHERE lp.url = p_url)
  ) END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_link_json(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_link_json(text, text) TO service_role;

-- ── plan_create: the Where block goes through chat_plan_parse_where ────────
CREATE OR REPLACE FUNCTION public.plan_create(
  p_conversation_id uuid,
  p_client_id uuid,
  p_title text,
  p_where_kind text,
  p_place jsonb,
  p_link_url text,
  p_when_mode text,
  p_scheduled_at timestamptz,
  p_options timestamptz[],
  p_open_times boolean,
  p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.chat_plans%ROWTYPE;
  v_parsed jsonb;
  v_where text;
  v_when text := p_when_mode;
  v_title text := NULLIF(btrim(COALESCE(p_title, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_open boolean := COALESCE(p_open_times, true);
  v_name text;
  v_domain text;
  v_options timestamptz[] := COALESCE(p_options, ARRAY[]::timestamptz[]);
  v_opt timestamptz;
  v_status text;
  v_plan_id uuid;
  v_message_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  PERFORM public.chat_plan_require_member(p_conversation_id, v_uid);

  -- Idempotency.
  IF p_client_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.chat_plans
     WHERE created_by = v_uid AND client_id = p_client_id;
    IF FOUND THEN
      RETURN jsonb_build_object('planId', v_existing.id, 'messageId', v_existing.message_id, 'created', false);
    END IF;
  END IF;

  -- Rate.
  IF (SELECT count(*) FROM public.chat_plans
       WHERE created_by = v_uid AND source = 'chat' AND created_at > now() - interval '24 hours') >= 30 THEN
    RAISE EXCEPTION 'conflict_rate_limited' USING ERRCODE = 'PT409';
  END IF;

  -- Where.
  v_parsed := public.chat_plan_parse_where(COALESCE(p_where_kind, 'none'), p_place, p_link_url);
  v_where := v_parsed ->> 'kind';
  v_name := v_parsed ->> 'name';
  v_domain := v_parsed ->> 'linkDomain';

  -- Title.
  IF v_title IS NOT NULL AND char_length(v_title) > 80 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_title';
  END IF;
  v_title := left(btrim(COALESCE(v_title, v_name, v_domain, 'New plan')), 80);

  IF v_note IS NOT NULL AND char_length(v_note) > 280 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_note';
  END IF;

  -- When.
  IF v_when IS NULL OR v_when NOT IN ('set', 'poll', 'none') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_when_mode';
  END IF;
  IF v_when = 'set' THEN
    PERFORM public.chat_plan_check_time(p_scheduled_at, 'p_scheduled_at');
    v_status := 'scheduled';
  ELSIF v_when = 'poll' THEN
    IF cardinality(v_options) > 5
       OR (SELECT count(DISTINCT x) FROM unnest(v_options) x) <> cardinality(v_options)
       OR (NOT v_open AND cardinality(v_options) < 2) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_options';
    END IF;
    FOREACH v_opt IN ARRAY v_options LOOP
      PERFORM public.chat_plan_check_time(v_opt, 'p_options');
    END LOOP;
    v_status := 'deciding';
  ELSE
    v_status := 'deciding';
  END IF;

  INSERT INTO public.chat_plans (
    conversation_id, source, created_by, client_id, title, where_kind,
    place_pool_id, mapbox_id, place_name, place_address, place_lat, place_lng, place_photo_url,
    link_url, link_domain, when_mode, open_times, status, scheduled_at, duration_minutes,
    locked_at, locked_by, note
  ) VALUES (
    p_conversation_id, 'chat', v_uid, p_client_id, v_title, v_where,
    (v_parsed ->> 'poolId')::uuid, v_parsed ->> 'mapboxId', v_name, v_parsed ->> 'address',
    (v_parsed ->> 'lat')::double precision, (v_parsed ->> 'lng')::double precision, v_parsed ->> 'photoUrl',
    v_parsed ->> 'linkUrl', NULLIF(v_domain, ''), v_when, v_open, v_status,
    CASE WHEN v_when = 'set' THEN p_scheduled_at END,
    CASE WHEN v_when = 'set' THEN 120 END,
    CASE WHEN v_when = 'set' THEN now() END,
    CASE WHEN v_when = 'set' THEN v_uid END,
    v_note
  )
  RETURNING id INTO v_plan_id;

  IF v_when = 'poll' THEN
    INSERT INTO public.chat_plan_time_options (plan_id, starts_at, added_by)
    SELECT v_plan_id, x, v_uid FROM unnest(v_options) x;
  END IF;

  INSERT INTO public.chat_plan_rsvps (plan_id, user_id, status) VALUES (v_plan_id, v_uid, 'going');

  PERFORM set_config('issue_4261.plan_write', 'on', true);
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type, card_payload, plan_id)
  VALUES (
    p_conversation_id, v_uid,
    public.issue_4114_first_name(v_uid) || ' added a plan: ' || v_title,
    'plan', jsonb_build_object('kind', 'plan', 'planId', v_plan_id), v_plan_id
  )
  RETURNING id INTO v_message_id;
  PERFORM set_config('issue_4261.plan_write', 'off', true);

  UPDATE public.chat_plans SET message_id = v_message_id WHERE id = v_plan_id;

  IF v_when = 'set' THEN
    PERFORM public.chat_plan_sync_calendar(v_plan_id);
  END IF;

  RETURN jsonb_build_object('planId', v_plan_id, 'messageId', v_message_id, 'created', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_create(uuid, uuid, text, text, jsonb, text, text, timestamptz, timestamptz[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_create(uuid, uuid, text, text, jsonb, text, text, timestamptz, timestamptz[], boolean, text) TO authenticated;

-- ── plan_add_place ──────────────────────────────────────────────────────────
-- Declared beside its pg17 suite: I-4261-PLACE-VOTES-POST-NO-LINES.
CREATE OR REPLACE FUNCTION public.plan_add_place(
  p_plan_id uuid, p_where_kind text, p_place jsonb, p_link_url text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
  v_parsed jsonb;
  v_option_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);

  IF v_plan.source = 'deck' THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF public.chat_plan_effective_status(v_plan) <> 'deciding' THEN
    RAISE EXCEPTION 'conflict_plan_not_deciding' USING ERRCODE = 'PT409';
  END IF;
  IF NOT v_plan.open_times AND v_plan.created_by IS DISTINCT FROM v_uid
     AND NOT public.chat_plan_can_lock(v_plan, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_where_kind IS NULL OR p_where_kind NOT IN ('place', 'address') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_where_kind';
  END IF;
  v_parsed := public.chat_plan_parse_where(p_where_kind, p_place, p_link_url);

  PERFORM public.chat_plan_seed_original_place(v_plan);

  SELECT id INTO v_option_id FROM public.chat_plan_place_options
   WHERE plan_id = v_plan.id AND identity_key = v_parsed ->> 'identityKey';
  IF v_option_id IS NOT NULL THEN
    INSERT INTO public.chat_plan_place_votes (option_id, plan_id, user_id)
    VALUES (v_option_id, v_plan.id, v_uid)
    ON CONFLICT (option_id, user_id) DO NOTHING;
    UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;
    RETURN jsonb_build_object('optionId', v_option_id, 'existed', true);
  END IF;

  IF (SELECT count(*) FROM public.chat_plan_place_options WHERE plan_id = v_plan.id) >= 6 THEN
    RAISE EXCEPTION 'conflict_too_many_places' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.chat_plan_place_options (
    plan_id, kind, place_pool_id, mapbox_id, place_name, place_address, place_lat, place_lng,
    place_photo_url, link_url, link_domain, identity_key, is_original, added_by
  ) VALUES (
    v_plan.id, v_parsed ->> 'kind', (v_parsed ->> 'poolId')::uuid, v_parsed ->> 'mapboxId',
    v_parsed ->> 'name', v_parsed ->> 'address',
    (v_parsed ->> 'lat')::double precision, (v_parsed ->> 'lng')::double precision,
    v_parsed ->> 'photoUrl', v_parsed ->> 'linkUrl', v_parsed ->> 'linkDomain',
    v_parsed ->> 'identityKey', false, v_uid
  )
  RETURNING id INTO v_option_id;
  INSERT INTO public.chat_plan_place_votes (option_id, plan_id, user_id)
  VALUES (v_option_id, v_plan.id, v_uid);

  UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;

  PERFORM public.chat_plan_post_event(
    v_plan.conversation_id, v_plan.id, 'place_added', v_uid,
    jsonb_build_object('placeName', v_parsed ->> 'name', 'optionId', v_option_id),
    public.issue_4114_first_name(v_uid) || ' suggested ' || (v_parsed ->> 'name') || ' for ' || v_plan.title
  );

  RETURN jsonb_build_object('optionId', v_option_id, 'existed', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_add_place(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_add_place(uuid, text, jsonb, text) TO authenticated;

-- ── plan_set_place_vote (no chat line) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plan_set_place_vote(p_option_id uuid, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_on';
  END IF;
  SELECT p.* INTO v_plan
    FROM public.chat_plan_place_options o
    JOIN public.chat_plans p ON p.id = o.plan_id
   WHERE o.id = p_option_id
   FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);
  IF public.chat_plan_effective_status(v_plan) <> 'deciding' THEN
    RAISE EXCEPTION 'conflict_plan_not_deciding' USING ERRCODE = 'PT409';
  END IF;

  IF p_on THEN
    INSERT INTO public.chat_plan_place_votes (option_id, plan_id, user_id)
    VALUES (p_option_id, v_plan.id, v_uid)
    ON CONFLICT (option_id, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.chat_plan_place_votes WHERE option_id = p_option_id AND user_id = v_uid;
  END IF;
  UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;
  RETURN jsonb_build_object('optionId', p_option_id, 'on', p_on);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_set_place_vote(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_set_place_vote(uuid, boolean) TO authenticated;

-- ── plan_lock: one function, five arguments ────────────────────────────────
-- Declared beside its pg17 suite: I-4261-LOCK-COPIES-WINNING-PLACE.
DROP FUNCTION IF EXISTS public.plan_lock(uuid, uuid, timestamptz, int);
CREATE OR REPLACE FUNCTION public.plan_lock(
  p_plan_id uuid,
  p_option_id uuid DEFAULT NULL,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_duration_minutes int DEFAULT 120,
  p_place_option_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
  v_place public.chat_plan_place_options%ROWTYPE;
  v_place_id uuid;
  v_place_count int;
  v_extra jsonb;
  v_at timestamptz;
  v_duration int := COALESCE(p_duration_minutes, 120);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);
  IF NOT public.chat_plan_can_lock(v_plan, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  IF (p_option_id IS NULL) = (p_scheduled_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_option_id';
  END IF;
  IF p_option_id IS NOT NULL THEN
    SELECT starts_at INTO v_at FROM public.chat_plan_time_options
     WHERE id = p_option_id AND plan_id = v_plan.id;
    IF v_at IS NULL THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_option_id';
    END IF;
  ELSE
    v_at := p_scheduled_at;
  END IF;
  PERFORM public.chat_plan_check_time(v_at, 'p_scheduled_at');
  IF v_duration < 15 OR v_duration > 1440 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_duration_minutes';
  END IF;

  IF v_plan.source = 'chat' THEN
    IF v_plan.status <> 'deciding' THEN
      RAISE EXCEPTION 'conflict_plan_not_deciding' USING ERRCODE = 'PT409';
    END IF;

    -- The winning place: the one named, else the leader.
    IF p_place_option_id IS NOT NULL THEN
      SELECT * INTO v_place FROM public.chat_plan_place_options
       WHERE id = p_place_option_id AND plan_id = v_plan.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place_option_id';
      END IF;
      v_place_id := v_place.id;
    ELSE
      v_place_id := public.chat_plan_place_leader(v_plan.id);
      IF v_place_id IS NOT NULL THEN
        SELECT * INTO v_place FROM public.chat_plan_place_options WHERE id = v_place_id;
      END IF;
    END IF;
    SELECT count(*) INTO v_place_count FROM public.chat_plan_place_options WHERE plan_id = v_plan.id;

    UPDATE public.chat_plans
       SET status = 'scheduled', scheduled_at = v_at, duration_minutes = v_duration,
           locked_at = now(), locked_by = v_uid, updated_at = now(),
           where_kind = CASE WHEN v_place_id IS NULL THEN where_kind ELSE v_place.kind END,
           place_pool_id = CASE WHEN v_place_id IS NULL THEN place_pool_id ELSE v_place.place_pool_id END,
           mapbox_id = CASE WHEN v_place_id IS NULL THEN mapbox_id ELSE v_place.mapbox_id END,
           place_name = CASE WHEN v_place_id IS NULL THEN place_name ELSE v_place.place_name END,
           place_address = CASE WHEN v_place_id IS NULL THEN place_address ELSE v_place.place_address END,
           place_lat = CASE WHEN v_place_id IS NULL THEN place_lat ELSE v_place.place_lat END,
           place_lng = CASE WHEN v_place_id IS NULL THEN place_lng ELSE v_place.place_lng END,
           place_photo_url = CASE WHEN v_place_id IS NULL THEN place_photo_url ELSE v_place.place_photo_url END,
           link_url = CASE WHEN v_place_id IS NULL THEN link_url ELSE v_place.link_url END,
           link_domain = CASE WHEN v_place_id IS NULL THEN link_domain ELSE v_place.link_domain END
     WHERE id = v_plan.id;
    PERFORM public.chat_plan_sync_calendar(v_plan.id);

    v_extra := jsonb_build_object('scheduledAt', v_at);
    IF v_place_id IS NOT NULL AND v_place_count >= 2 THEN
      v_extra := v_extra || jsonb_build_object(
        'placeName', COALESCE(v_place.place_name, v_place.link_domain), 'placeVoted', true);
    END IF;
    PERFORM public.chat_plan_post_event(
      v_plan.conversation_id, v_plan.id, 'locked', v_uid, v_extra,
      public.issue_4114_first_name(v_uid) || ' locked in ' || v_plan.title
    );
  ELSE
    IF p_place_option_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_place_option_id';
    END IF;
    IF public.chat_plan_effective_status(v_plan) <> 'deciding' THEN
      RAISE EXCEPTION 'conflict_plan_not_deciding' USING ERRCODE = 'PT409';
    END IF;
    PERFORM public.rpc_admin_lock_and_schedule_card(v_plan.session_id, v_plan.saved_card_id, v_at, v_duration);
    UPDATE public.chat_plans SET updated_at = now() WHERE id = v_plan.id;
  END IF;

  RETURN jsonb_build_object('planId', v_plan.id, 'scheduledAt', v_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.plan_lock(uuid, uuid, timestamptz, int, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_lock(uuid, uuid, timestamptz, int, uuid) TO authenticated;

-- ── Plan quotes carry the sender's voted places ────────────────────────────
-- votedPlaces is present only when the plan has place options, so a plan
-- nobody suggested a place on keeps the A2 quote shape.
CREATE OR REPLACE FUNCTION public.tg_4261_plan_comment_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.chat_plans%ROWTYPE;
  v_reply_plan uuid;
  v_votes jsonb;
  v_places jsonb;
  v_rsvp text;
BEGIN
  IF NEW.message_type = 'plan' THEN
    RETURN NEW;
  END IF;

  IF NEW.reply_to_id IS NOT NULL THEN
    SELECT m.plan_id INTO v_reply_plan
      FROM public.messages m
     WHERE m.id = NEW.reply_to_id AND m.message_type = 'plan'
       AND m.conversation_id = NEW.conversation_id;
  END IF;

  IF v_reply_plan IS NOT NULL THEN
    NEW.plan_id := v_reply_plan;
  ELSIF NEW.plan_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.chat_plans p
       WHERE p.id = NEW.plan_id AND p.conversation_id = NEW.conversation_id AND p.status <> 'cancelled'
    ) THEN
      NEW.plan_id := NULL;
    END IF;
  ELSE
    NEW.plan_id := NULL;
  END IF;

  NEW.plan_quote := NULL;
  IF NEW.plan_id IS NOT NULL AND NEW.sender_id IS NOT NULL AND NEW.message_type <> 'system' THEN
    SELECT * INTO v_plan FROM public.chat_plans WHERE id = NEW.plan_id;
    SELECT COALESCE(jsonb_agg(to_jsonb(o.starts_at) ORDER BY o.starts_at), '[]'::jsonb) INTO v_votes
      FROM public.chat_plan_time_votes v
      JOIN public.chat_plan_time_options o ON o.id = v.option_id
     WHERE v.plan_id = v_plan.id AND v.user_id = NEW.sender_id;
    IF v_plan.source = 'chat' THEN
      SELECT r.status INTO v_rsvp FROM public.chat_plan_rsvps r
       WHERE r.plan_id = v_plan.id AND r.user_id = NEW.sender_id;
    ELSE
      SELECT CASE r.rsvp_status WHEN 'attending' THEN 'going' WHEN 'maybe' THEN 'maybe'
                                WHEN 'not_attending' THEN 'cant' END
        INTO v_rsvp
        FROM public.board_card_rsvps r
       WHERE r.session_id = v_plan.session_id AND r.saved_card_id = v_plan.saved_card_id
         AND r.user_id = NEW.sender_id;
    END IF;
    NEW.plan_quote := jsonb_build_object('title', v_plan.title, 'votedStartsAt', v_votes, 'rsvp', v_rsvp);
    IF EXISTS (SELECT 1 FROM public.chat_plan_place_options o WHERE o.plan_id = v_plan.id) THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(COALESCE(o.place_name, o.link_domain))
                                ORDER BY o.is_original DESC, o.created_at, o.id), '[]'::jsonb)
        INTO v_places
        FROM public.chat_plan_place_votes v
        JOIN public.chat_plan_place_options o ON o.id = v.option_id
       WHERE v.plan_id = v_plan.id AND v.user_id = NEW.sender_id;
      NEW.plan_quote := NEW.plan_quote || jsonb_build_object('votedPlaces', v_places);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_4261_plan_comment_fields() FROM PUBLIC, anon, authenticated;

-- ── chat_plans_for_conversation: places, canAddPlace, link previews ────────
CREATE OR REPLACE FUNCTION public.chat_plans_for_conversation(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_from timestamptz;
  v_plans jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  PERFORM public.chat_plan_require_member(p_conversation_id, v_uid);

  SELECT cp.history_visible_from INTO v_from
    FROM public.conversation_participants cp
   WHERE cp.conversation_id = p_conversation_id AND cp.user_id = v_uid;

  WITH base AS (
    SELECT p.*,
           bsc.card_data AS deck_card_data,
           bsc.locked_at AS deck_locked_at,
           public.chat_plan_effective_status(p) AS eff_status,
           CASE WHEN p.source = 'deck' THEN (
             SELECT min(ce.scheduled_at) FROM public.calendar_entries ce WHERE ce.board_card_id = p.saved_card_id
           ) ELSE p.scheduled_at END AS eff_scheduled_at,
           public.chat_plan_can_lock(p, v_uid) AS can_lock,
           (SELECT count(*) FROM public.chat_plan_time_options o WHERE o.plan_id = p.id) AS option_count,
           (SELECT count(*) FROM public.chat_plan_place_options o WHERE o.plan_id = p.id) AS place_option_count
      FROM public.chat_plans p
      LEFT JOIN public.board_saved_cards bsc ON bsc.id = p.saved_card_id
     WHERE p.conversation_id = p_conversation_id
       AND p.status <> 'cancelled'
  ), picked AS (
    SELECT * FROM base b
     WHERE b.eff_status = 'deciding'
        OR (b.eff_status = 'scheduled'
            AND COALESCE(b.eff_scheduled_at, b.deck_locked_at, b.locked_at, b.created_at) >= now() - interval '180 days')
     ORDER BY b.created_at DESC
     LIMIT 100
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'source', b.source,
      'sessionId', b.session_id,
      'savedCardId', b.saved_card_id,
      'messageId', b.message_id,
      'messageVisible', EXISTS (
        SELECT 1 FROM public.messages m
         WHERE m.id = b.message_id AND m.deleted_at IS NULL
           AND (v_from IS NULL OR m.created_at >= v_from)
      ),
      'createdBy', b.created_by,
      'createdByName', CASE WHEN b.created_by IS NULL THEN NULL ELSE public.issue_4114_first_name(b.created_by) END,
      'title', b.title,
      'whereKind', b.where_kind,
      'place', CASE WHEN b.where_kind IN ('place', 'address') THEN jsonb_build_object(
        'poolId', b.place_pool_id, 'mapboxId', b.mapbox_id, 'name', b.place_name,
        'address', b.place_address, 'lat', b.place_lat, 'lng', b.place_lng, 'photoUrl', b.place_photo_url
      ) END,
      'link', public.chat_plan_link_json(b.link_url, b.link_domain),
      'places', CASE WHEN b.source = 'deck' THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'kind', o.kind, 'poolId', o.place_pool_id, 'mapboxId', o.mapbox_id,
          'name', o.place_name, 'address', o.place_address, 'lat', o.place_lat, 'lng', o.place_lng,
          'photoUrl', o.place_photo_url,
          'link', public.chat_plan_link_json(o.link_url, o.link_domain),
          'addedBy', o.added_by, 'isOriginal', o.is_original,
          'voterIds', COALESCE((
            SELECT jsonb_agg(v.user_id ORDER BY v.created_at, v.user_id)
              FROM public.chat_plan_place_votes v WHERE v.option_id = o.id
          ), '[]'::jsonb)
        ) ORDER BY o.is_original DESC, o.created_at, o.id)
        FROM public.chat_plan_place_options o WHERE o.plan_id = b.id
      ), '[]'::jsonb) END,
      'cardData', CASE WHEN b.source = 'deck' THEN b.deck_card_data END,
      'whenMode', b.when_mode,
      'openTimes', b.open_times,
      'status', b.eff_status,
      'scheduledAt', b.eff_scheduled_at,
      'durationMinutes', CASE WHEN b.source = 'deck' THEN (
        SELECT min(ce.duration_minutes) FROM public.calendar_entries ce WHERE ce.board_card_id = b.saved_card_id
      ) ELSE b.duration_minutes END,
      'lockedAt', CASE WHEN b.source = 'deck' THEN b.deck_locked_at ELSE b.locked_at END,
      'lockedBy', b.locked_by,
      'note', b.note,
      'createdAt', b.created_at,
      'updatedAt', b.updated_at,
      'options', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'startsAt', o.starts_at, 'addedBy', o.added_by,
          'voterIds', COALESCE((
            SELECT jsonb_agg(v.user_id ORDER BY v.created_at, v.user_id)
              FROM public.chat_plan_time_votes v WHERE v.option_id = o.id
          ), '[]'::jsonb)
        ) ORDER BY o.starts_at)
        FROM public.chat_plan_time_options o WHERE o.plan_id = b.id
      ), '[]'::jsonb),
      'rsvps', CASE WHEN b.source = 'chat' THEN jsonb_build_object(
        'going', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'going'), '[]'::jsonb),
        'maybe', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'maybe'), '[]'::jsonb),
        'cant', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'cant'), '[]'::jsonb)
      ) ELSE jsonb_build_object(
        'going', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'attending'), '[]'::jsonb),
        'maybe', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'maybe'), '[]'::jsonb),
        'cant', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'not_attending'), '[]'::jsonb)
      ) END,
      'reactions', CASE WHEN b.source = 'chat' THEN jsonb_build_object(
        'up', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.chat_plan_reactions x WHERE x.plan_id = b.id AND x.kind = 'up'), '[]'::jsonb),
        'down', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.chat_plan_reactions x WHERE x.plan_id = b.id AND x.kind = 'down'), '[]'::jsonb)
      ) ELSE jsonb_build_object(
        'up', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.board_votes x WHERE x.session_id = b.session_id AND x.saved_card_id = b.saved_card_id AND x.vote_type = 'up'), '[]'::jsonb),
        'down', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.board_votes x WHERE x.session_id = b.session_id AND x.saved_card_id = b.saved_card_id AND x.vote_type = 'down'), '[]'::jsonb)
      ) END,
      'commentCount', (
        SELECT count(*) FROM public.messages m
         WHERE m.plan_id = b.id AND m.message_type NOT IN ('plan', 'system') AND m.deleted_at IS NULL
           AND (v_from IS NULL OR m.created_at >= v_from)
      ),
      'canLock', b.eff_status = 'deciding' AND b.can_lock,
      'canEdit', b.source = 'chat' AND b.created_by IS NOT DISTINCT FROM v_uid AND b.status IN ('deciding', 'scheduled'),
      'canCancel', b.source = 'chat' AND b.can_lock,
      'canAddTime', b.eff_status = 'deciding' AND (b.open_times OR b.can_lock OR b.created_by IS NOT DISTINCT FROM v_uid)
                    AND b.option_count < 8,
      'canAddPlace', b.source = 'chat' AND b.eff_status = 'deciding'
                     AND (b.open_times OR b.can_lock OR b.created_by IS NOT DISTINCT FROM v_uid)
                     AND b.place_option_count < 6
    ) ORDER BY b.created_at DESC
  ), '[]'::jsonb) INTO v_plans
  FROM picked b;

  RETURN jsonb_build_object(
    'viewerId', v_uid,
    'memberCount', (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = p_conversation_id),
    'historyVisibleFrom', v_from,
    'plans', v_plans
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plans_for_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_plans_for_conversation(uuid) TO authenticated;

-- ── Link previews ───────────────────────────────────────────────────────────
-- Which of a plan's link URLs need a (re)fetch: never tried, ok and older
-- than 7 days, or failed and older than 6 hours. At most 7. The phone never
-- sends a URL; the edge function asks this as the user.
CREATE OR REPLACE FUNCTION public.chat_plan_link_targets(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.chat_plans%ROWTYPE;
  v_urls jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_plan FROM public.chat_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_plan_require_member(v_plan.conversation_id, v_uid);

  SELECT COALESCE(jsonb_agg(u.url ORDER BY u.url), '[]'::jsonb) INTO v_urls
    FROM (
      SELECT DISTINCT x.url
        FROM (
          SELECT v_plan.link_url AS url
          UNION
          SELECT o.link_url FROM public.chat_plan_place_options o WHERE o.plan_id = v_plan.id
        ) x
        LEFT JOIN public.chat_plan_link_previews lp ON lp.url = x.url
       WHERE x.url IS NOT NULL
         AND (lp.url IS NULL
              OR (lp.outcome = 'ok' AND lp.fetched_at < now() - interval '7 days')
              OR (lp.outcome = 'failed' AND lp.fetched_at < now() - interval '6 hours'))
       ORDER BY x.url
       LIMIT 7
    ) u;

  RETURN jsonb_build_object('planId', v_plan.id, 'urls', v_urls);
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_link_targets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_plan_link_targets(uuid) TO authenticated;

-- Declared beside its pg17 suite: I-4261-LINK-PREVIEW-SERVER-ONLY.
-- The only writer of chat_plan_link_previews (service role only). A URL that
-- is not stored on any plan or place option writes nothing.
CREATE OR REPLACE FUNCTION public.chat_plan_link_preview_store(
  p_url text, p_outcome text, p_title text, p_site_name text, p_image_url text, p_final_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_title text := NULLIF(left(btrim(regexp_replace(COALESCE(p_title, ''), '\s+', ' ', 'g')), 200), '');
  v_site text := NULLIF(left(btrim(regexp_replace(COALESCE(p_site_name, ''), '\s+', ' ', 'g')), 80), '');
  v_image text := btrim(COALESCE(p_image_url, ''));
  v_final text := NULLIF(btrim(COALESCE(p_final_url, '')), '');
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('ok', 'failed') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_outcome';
  END IF;
  IF p_url IS NULL OR NOT (
       EXISTS (SELECT 1 FROM public.chat_plans WHERE link_url = p_url)
    OR EXISTS (SELECT 1 FROM public.chat_plan_place_options WHERE link_url = p_url)
  ) THEN
    RETURN;
  END IF;
  IF v_image !~ '^https://' OR char_length(v_image) > 1024 THEN
    v_image := NULL;
  END IF;
  IF char_length(v_final) > 2048 THEN
    v_final := NULL;
  END IF;
  IF p_outcome = 'failed' THEN
    v_title := NULL;
    v_site := NULL;
    v_image := NULL;
  END IF;

  INSERT INTO public.chat_plan_link_previews (url, outcome, title, site_name, image_url, final_url, fetched_at, attempts)
  VALUES (p_url, p_outcome, v_title, v_site, v_image, v_final, now(), 1)
  ON CONFLICT (url) DO UPDATE
    SET outcome = EXCLUDED.outcome,
        title = EXCLUDED.title,
        site_name = EXCLUDED.site_name,
        image_url = EXCLUDED.image_url,
        final_url = EXCLUDED.final_url,
        fetched_at = now(),
        attempts = public.chat_plan_link_previews.attempts + 1;

  -- Realtime signal: the card refetches and shows the cover.
  UPDATE public.chat_plans SET updated_at = now()
   WHERE link_url = p_url
      OR id IN (SELECT o.plan_id FROM public.chat_plan_place_options o WHERE o.link_url = p_url);
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_link_preview_store(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_link_preview_store(text, text, text, text, text, text) TO service_role;

COMMIT;

-- issue #1023 wave 2 — any Google Fonts family as a theme font, and a
-- two-colour gradient theme.
--
-- WRITTEN, NOT APPLIED. Apply after 20280430001023 (wave 1) and BEFORE the PR
-- merges: merging ships the new pickers and Ari's wider theme schema, and a
-- save of a Google font or a gradient fails on the old CHECKs until this runs.
--
-- What changes:
--   A. two IMMUTABLE helpers, the single source for every CHECK and RPC:
--        issue_1023_is_theme_font(text)      legacy slug or a Google family name shape
--        issue_1023_is_theme_gradient(text)  '#rrggbb,#rrggbb'
--   B. brands.theme_gradient, events.theme_gradient_override (nullable text).
--      A gradient is stored as ONE value holding both stops. The app reads the
--      second stop only when the stored first stop equals the level's colour,
--      so a client that changes only the colour leaves a stale pair that reads
--      as solid. No CHECK ties the pair to the colour on purpose: an old client
--      must never fail a save.
--   C. font CHECKs widened (same names) on brands, events, venue_listings;
--      gradient CHECKs added. Widening only: every existing row stays valid.
--   D. writer RPCs carry the gradient beside the colour with the colour's own
--      semantics (unconditional writers write it unconditionally; CASE writers
--      keep it when the key is absent).
--   E. views gain the gradient columns, APPENDED at the end.
--   F. public payload RPCs gain themeGradientOverride / brand.themeGradient.
--
-- Every function and view body below is pg_get_functiondef / pg_get_viewdef of
-- a local replay of the full chain (origin/main @ 2026-11-07 plus wave 1),
-- md5-compared to production's prosrc read-only before editing. Only the
-- lines named in the comments above each block were added or changed.
-- Static SQL only: no EXECUTE of built strings (#1860 C7). Conflict paths in
-- the redefined bodies are untouched (PT409 where they raise one).

BEGIN;

-- ---------------------------------------------------------------------------
-- A. helpers
-- ---------------------------------------------------------------------------
-- I-1023-FONT-SHAPE-PARITY: this pattern equals GOOGLE_FONT_FAMILY_RE /
-- GOOGLE_FONT_FAMILY_MAX in packages/offering-rendering/designTokens.ts and the
-- font pattern in supabase/functions/_shared/agentSiteTools.ts (parity test
-- issue_1023_font_value_shape_parity.implementor.test.ts).
CREATE OR REPLACE FUNCTION public.issue_1023_is_theme_font(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p IS NULL
      OR p IN ('inter','poppins','space_grotesk','plus_jakarta_sans','manrope',
               'playfair_display','dm_serif_display','fraunces','lora',
               'bebas_neue','anton','unbounded','caveat','dancing_script')
      OR (length(p) <= 40 AND p ~ '^[A-Z0-9][A-Za-z0-9]*( [A-Za-z0-9]+)*$')
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1023_is_theme_gradient(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p IS NULL OR p ~* '^#[0-9a-f]{6},#[0-9a-f]{6}$'
$fn$;

REVOKE ALL ON FUNCTION public.issue_1023_is_theme_font(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1023_is_theme_gradient(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_1023_is_theme_font(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1023_is_theme_gradient(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.issue_1023_is_theme_font(text) IS
  'issue #1023: a theme font is one of the 14 bundled slugs or a Google Fonts family name (shape only; the app and Ari check names against the catalogue).';
COMMENT ON FUNCTION public.issue_1023_is_theme_gradient(text) IS
  'issue #1023: a stored theme gradient is two hex stops, "#rrggbb,#rrggbb".';

-- ---------------------------------------------------------------------------
-- B. columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS theme_gradient text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS theme_gradient_override text;

COMMENT ON COLUMN public.brands.theme_gradient IS
  'issue #1023: "#first,#second" gradient for the brand theme. Read only when the first stop equals theme_color.';
COMMENT ON COLUMN public.events.theme_gradient_override IS
  'issue #1023: "#first,#second" gradient override. Read only when the first stop equals theme_color_override.';

-- ---------------------------------------------------------------------------
-- C. CHECKs
-- ---------------------------------------------------------------------------
ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_theme_font_whitelist_chk;
ALTER TABLE public.brands ADD CONSTRAINT brands_theme_font_whitelist_chk
  CHECK (public.issue_1023_is_theme_font(theme_font));
ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_theme_gradient_chk;
ALTER TABLE public.brands ADD CONSTRAINT brands_theme_gradient_chk
  CHECK (public.issue_1023_is_theme_gradient(theme_gradient));

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_theme_font_override_whitelist_chk;
ALTER TABLE public.events ADD CONSTRAINT events_theme_font_override_whitelist_chk
  CHECK (public.issue_1023_is_theme_font(theme_font_override));
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_theme_gradient_override_chk;
ALTER TABLE public.events ADD CONSTRAINT events_theme_gradient_override_chk
  CHECK (public.issue_1023_is_theme_gradient(theme_gradient_override));

ALTER TABLE public.venue_listings DROP CONSTRAINT IF EXISTS venue_listings_theme_font_override_whitelist_chk;
ALTER TABLE public.venue_listings ADD CONSTRAINT venue_listings_theme_font_override_whitelist_chk
  CHECK (public.issue_1023_is_theme_font(theme_font_override));


-- ---------------------------------------------------------------------------
-- D. writer and brand-context functions
-- ---------------------------------------------------------------------------

-- business_create_event_draft: inserts theme_gradient_override from the payload key (unconditional, like the colour).
CREATE OR REPLACE FUNCTION public.business_create_event_draft(p_brand_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_title text;
  v_slug text;
  v_geo point;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id=p_brand_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  PERFORM public.business_assert_event_visibility(
    p_payload#>'{theme,business_draft,requestedVisibility}'
  );
  v_title := COALESCE(NULLIF(btrim(p_payload->>'title'), ''), 'Untitled draft');
  v_slug := 'draft-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  IF NULLIF(p_payload->>'location_geo','') IS NOT NULL THEN
    v_geo := (p_payload->>'location_geo')::point;
  END IF;
  PERFORM public.assert_cover_media_triplet(
    NULLIF(p_payload->>'cover_media_url',''), NULLIF(p_payload->>'cover_media_type',''),
    NULLIF(p_payload->>'cover_media_poster_url',''));

  INSERT INTO public.events(
    brand_id, created_by, event_type, title, slug, description, location_text,
    online_url, cover_media_url, cover_media_poster_url, cover_media_type,
    cover_media_provider, cover_media_source_url, cover_media_credit,
    cover_media_credit_url, cover_media_alt, cover_media_gallery, currency,
    is_online, is_recurring, is_multi_date, recurrence_rules, theme,
    visibility, status, timezone, party_types, vibe_tags, music_genres, city,
    location_geo, pass_tax, pass_mingla_fee, pass_service_fee,
    theme_color_override, theme_font_override, theme_animation_override,
    theme_gradient_override
  ) VALUES (
    p_brand_id, v_uid, 'event', v_title, v_slug,
    NULLIF(p_payload->>'description',''), NULLIF(p_payload->>'location_text',''),
    NULLIF(p_payload->>'online_url',''), NULLIF(p_payload->>'cover_media_url',''),
    NULLIF(p_payload->>'cover_media_poster_url',''), NULLIF(p_payload->>'cover_media_type',''),
    NULLIF(p_payload->>'cover_media_provider',''), NULLIF(p_payload->>'cover_media_source_url',''),
    NULLIF(p_payload->>'cover_media_credit',''), NULLIF(p_payload->>'cover_media_credit_url',''),
    NULLIF(p_payload->>'cover_media_alt',''), COALESCE(p_payload->'cover_media_gallery','[]'::jsonb),
    NULLIF(p_payload->>'currency','')::character(3), COALESCE((p_payload->>'is_online')::boolean,false),
    COALESCE((p_payload->>'is_recurring')::boolean,false), COALESCE((p_payload->>'is_multi_date')::boolean,false),
    p_payload->'recurrence_rules', COALESCE(p_payload->'theme','{}'::jsonb), 'draft', 'draft',
    COALESCE(NULLIF(p_payload->>'timezone',''),'UTC'),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'party_types','[]'::jsonb))),ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'vibe_tags','[]'::jsonb))),ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'music_genres','[]'::jsonb))),ARRAY[]::text[]),
    NULLIF(p_payload->>'city',''), v_geo,
    (p_payload->>'pass_tax')::boolean, (p_payload->>'pass_mingla_fee')::boolean,
    (p_payload->>'pass_service_fee')::boolean, NULLIF(p_payload->>'theme_color_override',''),
    NULLIF(p_payload->>'theme_font_override',''), NULLIF(p_payload->>'theme_animation_override',''),
    NULLIF(p_payload->>'theme_gradient_override','')
  ) RETURNING * INTO v_event;
  RETURN jsonb_build_object('event', to_jsonb(v_event), 'client_revision',
    COALESCE((p_payload#>>'{theme,business_draft,clientRevision}')::integer,0));
END;
$function$
;

-- business_update_event_draft: writes theme_gradient_override unconditionally, like the colour.
CREATE OR REPLACE FUNCTION public.business_update_event_draft(p_event_id uuid, p_payload jsonb, p_client_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_stored_revision integer;
  v_geo point;
  v_keep_cover boolean;  -- applied-cover guard
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type <> 'event' THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;
  IF v_event.status <> 'draft' THEN RAISE EXCEPTION 'event_draft_not_editable'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  v_stored_revision := COALESCE((v_event.theme#>>'{business_draft,clientRevision}')::integer,0);
  IF p_client_revision IS NULL OR p_client_revision < v_stored_revision THEN
    RAISE EXCEPTION 'stale_client_revision';
  END IF;
  PERFORM public.business_assert_event_visibility(
    p_payload#>'{theme,business_draft,requestedVisibility}'
  );
  IF NULLIF(p_payload->>'location_geo','') IS NOT NULL THEN v_geo := (p_payload->>'location_geo')::point; END IF;
  -- Applied-cover guard — a cover the server put on this row (a draft_auto
  -- cover-video job finishing after the host closed the sheet) must survive a
  -- save from a client that has not seen it. With `__coverBase` (the cover the
  -- client last received) it is a three-way merge: keep the stored cover when
  -- the client's cover is still its base and the server's has moved since. A
  -- client without the key falls back to: the stored cover is an applied
  -- draft_auto job's video and no save has landed since that job applied.
  v_keep_cover := (CASE WHEN p_payload ? '__coverBase' THEN
      NULLIF(p_payload->>'cover_media_url','') IS NOT DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
      AND v_event.cover_media_url IS DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
    ELSE
      v_event.cover_media_url IS NOT NULL
      AND NULLIF(p_payload->>'cover_media_url','') IS DISTINCT FROM v_event.cover_media_url
      AND EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
        WHERE j.event_id = p_event_id AND j.target_kind = 'event'
          AND j.apply_mode = 'draft_auto' AND j.status = 'applied'
          AND j.processed_url = v_event.cover_media_url
          AND j.applied_at >= v_event.updated_at)
    END);
  PERFORM public.assert_cover_media_triplet(NULLIF(p_payload->>'cover_media_url',''),
    NULLIF(p_payload->>'cover_media_type',''),NULLIF(p_payload->>'cover_media_poster_url',''));

  -- issue #3281 — a client that predates day lists cannot widen a ticket.
  IF jsonb_typeof(p_payload#>'{theme,business_draft,tickets}') = 'array' THEN
    p_payload := jsonb_set(p_payload, '{theme,business_draft,tickets}',
      public.issue_3281_keep_draft_day_lists(
        p_payload#>'{theme,business_draft,tickets}', v_event.theme#>'{business_draft,tickets}'));
  END IF;

  UPDATE public.events SET
    title=COALESCE(NULLIF(btrim(p_payload->>'title'),''),'Untitled draft'),
    description=NULLIF(p_payload->>'description',''), location_text=NULLIF(p_payload->>'location_text',''),
    online_url=NULLIF(p_payload->>'online_url',''), cover_media_url=CASE WHEN v_keep_cover THEN v_event.cover_media_url ELSE NULLIF(p_payload->>'cover_media_url','') END,
    cover_media_poster_url=CASE WHEN v_keep_cover THEN v_event.cover_media_poster_url ELSE NULLIF(p_payload->>'cover_media_poster_url','') END, cover_media_type=CASE WHEN v_keep_cover THEN v_event.cover_media_type ELSE NULLIF(p_payload->>'cover_media_type','') END,
    cover_media_provider=CASE WHEN v_keep_cover THEN v_event.cover_media_provider ELSE NULLIF(p_payload->>'cover_media_provider','') END, cover_media_source_url=CASE WHEN v_keep_cover THEN v_event.cover_media_source_url ELSE NULLIF(p_payload->>'cover_media_source_url','') END,
    cover_media_credit=CASE WHEN v_keep_cover THEN v_event.cover_media_credit ELSE NULLIF(p_payload->>'cover_media_credit','') END, cover_media_credit_url=CASE WHEN v_keep_cover THEN v_event.cover_media_credit_url ELSE NULLIF(p_payload->>'cover_media_credit_url','') END,
    cover_media_alt=CASE WHEN v_keep_cover THEN v_event.cover_media_alt ELSE NULLIF(p_payload->>'cover_media_alt','') END, cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN COALESCE(p_payload->'cover_media_gallery','[]'::jsonb) ELSE v_event.cover_media_gallery END,
    currency=NULLIF(p_payload->>'currency','')::character(3), is_online=COALESCE((p_payload->>'is_online')::boolean,false),
    is_recurring=COALESCE((p_payload->>'is_recurring')::boolean,false), is_multi_date=COALESCE((p_payload->>'is_multi_date')::boolean,false),
    recurrence_rules=p_payload->'recurrence_rules',
    theme=jsonb_set(COALESCE(p_payload->'theme','{}'::jsonb),
      '{business_draft,clientRevision}',to_jsonb(p_client_revision),true),
    visibility='draft', status='draft', timezone=COALESCE(NULLIF(p_payload->>'timezone',''),'UTC'),
    party_types=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'party_types','[]'::jsonb))),ARRAY[]::text[]),
    vibe_tags=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'vibe_tags','[]'::jsonb))),ARRAY[]::text[]),
    music_genres=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'music_genres','[]'::jsonb))),ARRAY[]::text[]),
    city=NULLIF(p_payload->>'city',''), location_geo=v_geo,
    pass_tax=(p_payload->>'pass_tax')::boolean, pass_mingla_fee=(p_payload->>'pass_mingla_fee')::boolean,
    pass_service_fee=(p_payload->>'pass_service_fee')::boolean,
    theme_color_override=NULLIF(p_payload->>'theme_color_override',''), theme_font_override=NULLIF(p_payload->>'theme_font_override',''),
    theme_animation_override=NULLIF(p_payload->>'theme_animation_override',''),
    theme_gradient_override=NULLIF(p_payload->>'theme_gradient_override',''), updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'client_revision',
    p_client_revision);
END;
$function$
;

-- business_duplicate_event_as_draft: copies theme_gradient_override.
CREATE OR REPLACE FUNCTION public.business_duplicate_event_as_draft(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid:=auth.uid();v_src public.events%ROWTYPE;v_new public.events%ROWTYPE;v_payload jsonb;v_title text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  SELECT * INTO v_src FROM public.events WHERE id=p_event_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR v_src.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF public.biz_brand_effective_rank(v_src.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  v_payload:=public.business_event_draft_payload_from_graph(p_event_id);
  v_title:=left(v_src.title||' (copy)',120);
  INSERT INTO public.events(brand_id,created_by,event_type,title,slug,description,location_text,location_geo,online_url,is_online,
    is_recurring,is_multi_date,recurrence_rules,cover_media_url,cover_media_poster_url,cover_media_type,cover_media_provider,
    cover_media_source_url,cover_media_credit,cover_media_credit_url,cover_media_alt,cover_media_gallery,theme,currency,
    visibility,status,timezone,party_types,vibe_tags,music_genres,city,pass_tax,pass_mingla_fee,pass_service_fee,
    theme_color_override,theme_font_override,theme_animation_override,theme_gradient_override)
  VALUES(v_src.brand_id,v_uid,'event',v_title,'draft-'||substr(replace(gen_random_uuid()::text,'-',''),1,16),v_src.description,
    v_src.location_text,v_src.location_geo,v_src.online_url,v_src.is_online,v_src.is_recurring,v_src.is_multi_date,v_src.recurrence_rules,
    v_src.cover_media_url,v_src.cover_media_poster_url,v_src.cover_media_type,v_src.cover_media_provider,v_src.cover_media_source_url,
    v_src.cover_media_credit,v_src.cover_media_credit_url,v_src.cover_media_alt,v_src.cover_media_gallery,
    jsonb_set(v_payload->'theme','{business_draft,clientRevision}','0'::jsonb,true),v_src.currency,'draft','draft',v_src.timezone,
    v_src.party_types,v_src.vibe_tags,v_src.music_genres,v_src.city,v_src.pass_tax,v_src.pass_mingla_fee,v_src.pass_service_fee,
    v_src.theme_color_override,v_src.theme_font_override,v_src.theme_animation_override,v_src.theme_gradient_override)
  RETURNING * INTO v_new;
  RETURN jsonb_build_object('event',to_jsonb(v_new),'client_revision',0);
END;$function$
;

-- business_create_rsvp_draft_graph: inserts theme_gradient_override (unconditional, like the colour).
CREATE OR REPLACE FUNCTION public.business_create_rsvp_draft_graph(p_brand_id uuid, p_payload jsonb, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_brand public.brands%ROWTYPE; v_event_id uuid;
  v_title text; v_timezone text; v_format text; v_draft jsonb; v_theme jsonb;
  v_hash text; v_prior public.rsvp_domain_operation_receipts%ROWTYPE; v_result jsonb;
  v_currency text; v_suggested integer; v_minimum integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id=p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND OR public.biz_brand_effective_rank(p_brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'rsvp_payload_invalid' USING ERRCODE='22023';
  END IF;
  v_draft:=COALESCE(p_payload#>'{theme,business_draft}','{}'::jsonb)||p_payload;
  v_title:=NULLIF(btrim(COALESCE(p_payload->>'title','')),'');
  v_timezone:=NULLIF(btrim(COALESCE(p_payload->>'timezone',v_draft->>'timezone','')),'');
  v_format:=COALESCE(NULLIF(v_draft->>'format',''),'in_person');
  IF v_title IS NULL OR v_timezone IS NULL OR v_format NOT IN ('in_person','online','hybrid') THEN
    RAISE EXCEPTION 'rsvp_payload_invalid' USING ERRCODE='22023';
  END IF;
  IF COALESCE(jsonb_array_length(COALESCE(v_draft->'tickets','[]'::jsonb)),0)<>0
     OR COALESCE(v_draft->>'isRsvp','true')<>'true' THEN
    RAISE EXCEPTION 'rsvp_ticket_wall' USING ERRCODE='22023';
  END IF;
  v_suggested:=NULLIF(v_draft->>'rsvpContributionSuggestedCents','')::integer;
  v_minimum:=NULLIF(v_draft->>'rsvpContributionMinCents','')::integer;
  IF (v_suggested IS NOT NULL AND v_suggested<=0)
     OR (v_minimum IS NOT NULL AND v_minimum<=0)
     OR (v_suggested IS NOT NULL AND v_minimum IS NOT NULL AND v_suggested<v_minimum) THEN
    RAISE EXCEPTION 'rsvp_contribution_amount_invalid' USING ERRCODE='22023';
  END IF;
  IF COALESCE((v_draft->>'rsvpContributionEnabled')::boolean,false)
     AND NOT public.pg_brand_can_collect(p_brand_id) THEN
    RAISE EXCEPTION 'stripe_charges_disabled' USING ERRCODE='42501';
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_brand_id::text||':'||p_payload::text,'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_create:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='create' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash THEN RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505'; END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  v_event_id:=gen_random_uuid();
  v_currency:=COALESCE(NULLIF(upper(p_payload->>'currency'),''),NULLIF(upper(v_draft->>'currency'),''),v_brand.default_currency);
  v_theme:=jsonb_set(COALESCE(p_payload->'theme','{}'::jsonb),'{business_draft}',
    v_draft||jsonb_build_object(
      'schemaVersion',COALESCE((v_draft->>'schemaVersion')::integer,1),'format',v_format,
      'partyTypes',COALESCE(v_draft->'partyTypes','[]'::jsonb),'vibeTags',COALESCE(v_draft->'vibeTags','[]'::jsonb),
      'musicGenres',COALESCE(v_draft->'musicGenres','[]'::jsonb),'city',v_draft->'city',
      'locationGeo',v_draft->'locationGeo','requestedVisibility',COALESCE(v_draft->>'requestedVisibility','private'),
      'currency',v_currency,'whenMode','single','when',COALESCE(v_draft->'when',jsonb_build_object('date',NULL,'doorsOpen',NULL,'endsAt',NULL,'timezone',v_timezone)),
      'location',COALESCE(v_draft->'location','{}'::jsonb),'tickets','[]'::jsonb,
      'settings',COALESCE(v_draft->'settings',jsonb_build_object('requireApproval',false,'allowTransfers',false,
        'hideRemainingCount',COALESCE((v_draft->>'hideRemainingCount')::boolean,false),'passwordProtected',false,
        'privateGuestList',COALESCE((v_draft->>'privateGuestList')::boolean,false),'inPersonPaymentsEnabled',false)),
      'isRsvp',true,'rsvpCapacity',v_draft->'rsvpCapacity',
      'rsvpAllowPlusOnes',COALESCE((v_draft->>'rsvpAllowPlusOnes')::boolean,false),
      'rsvpPlusOnesMax',COALESCE((v_draft->>'rsvpPlusOnesMax')::integer,0),
      'rsvpWaitlistEnabled',COALESCE((v_draft->>'rsvpWaitlistEnabled')::boolean,false),
      'rsvpApprovalMode',COALESCE(v_draft->>'rsvpApprovalMode','auto'),
      'rsvpDiscoverable',COALESCE((v_draft->>'rsvpDiscoverable')::boolean,false),
      'rsvpContributionEnabled',COALESCE((v_draft->>'rsvpContributionEnabled')::boolean,false),
      'rsvpContributionSuggestedCents',v_suggested,'rsvpContributionMinCents',v_minimum,
      'lastStepReached',COALESCE((v_draft->>'lastStepReached')::integer,0),
      'clientRevision',COALESCE((v_draft->>'clientRevision')::integer,0)
    ),true);
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,description,location_text,online_url,
    cover_media_url,cover_media_poster_url,cover_media_type,cover_media_provider,
    cover_media_source_url,cover_media_credit,cover_media_credit_url,cover_media_alt,
    cover_media_gallery,currency,is_online,is_recurring,is_multi_date,recurrence_rules,
    theme,visibility,status,timezone,event_type,party_types,vibe_tags,music_genres,city,
    theme_color_override,theme_font_override,theme_animation_override,theme_gradient_override
  ) VALUES(
    v_event_id,p_brand_id,v_actor,v_title,'draft-'||v_event_id::text,
    NULLIF(p_payload->>'description',''),NULLIF(p_payload->>'location_text',''),NULLIF(p_payload->>'online_url',''),
    NULLIF(p_payload->>'cover_media_url',''),NULLIF(p_payload->>'cover_media_poster_url',''),NULLIF(p_payload->>'cover_media_type',''),
    NULLIF(p_payload->>'cover_media_provider',''),NULLIF(p_payload->>'cover_media_source_url',''),NULLIF(p_payload->>'cover_media_credit',''),
    NULLIF(p_payload->>'cover_media_credit_url',''),NULLIF(p_payload->>'cover_media_alt',''),COALESCE(p_payload->'cover_media_gallery','[]'::jsonb),
    v_currency,v_format IN ('online','hybrid'),false,false,NULL,v_theme,'draft','draft',v_timezone,'rsvp',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_draft->'partyTypes','[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_draft->'vibeTags','[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_draft->'musicGenres','[]'::jsonb))),NULLIF(v_draft->>'city',''),
    NULLIF(p_payload->>'theme_color_override',''),NULLIF(p_payload->>'theme_font_override',''),
    NULLIF(p_payload->>'theme_animation_override',''),NULLIF(p_payload->>'theme_gradient_override','')
  );
  v_result:=public.issue_1977_rsvp_graph(v_event_id);
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'create',p_client_request_id,v_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$
;

-- business_update_rsvp_graph: writes theme_gradient_override when the key is present, like the colour.
CREATE OR REPLACE FUNCTION public.business_update_rsvp_graph(p_event_id uuid, p_payload jsonb, p_reason text DEFAULT NULL::text, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v public.events%ROWTYPE; v_draft jsonb; v_patch jsonb; v_merged jsonb;
  v_theme jsonb; v_result jsonb; v_hash text; v_prior public.rsvp_domain_operation_receipts%ROWTYPE;
  v_live_payload jsonb; v_update_result jsonb; v_current_revision integer; v_expected_revision integer;
  v_suggested integer; v_minimum integer;
  v_keep_cover boolean;  -- applied-cover guard
BEGIN
  IF v_actor IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'rsvp_payload_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR public.biz_brand_effective_rank(v.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_event_id::text||':'||p_payload::text||':'||COALESCE(p_reason,''),'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_update:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='update' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash THEN RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505'; END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  IF v.status='draft' AND v.visibility='draft' THEN
    IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id)
       OR EXISTS(SELECT 1 FROM public.ticket_types t WHERE t.event_id=p_event_id AND t.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'rsvp_draft_graph_invalid';
    END IF;
    v_draft:=COALESCE(v.theme#>'{business_draft}','{}'::jsonb);
    v_patch:=COALESCE(p_payload#>'{theme,business_draft}','{}'::jsonb)||p_payload;
    v_current_revision:=COALESCE((v_draft->>'clientRevision')::integer,0);
    v_expected_revision:=NULLIF(p_payload->>'__expectedClientRevision','')::integer;
    IF v_expected_revision IS NOT NULL AND v_expected_revision<v_current_revision THEN
      RAISE EXCEPTION 'rsvp_revision_conflict' USING ERRCODE='PT409';
    END IF;
    -- Applied-cover guard — a cover the server put on this row (a draft_auto
    -- cover-video job finishing after the host closed the sheet) must survive
    -- a save from a client that has not seen it. With `__coverBase` (the
    -- cover the client last received) it is a three-way merge: keep the
    -- stored cover when the client's cover is still its base and the server's
    -- has moved since. A client without the key falls back to: the stored
    -- cover is an applied draft_auto job's video and no save has landed since
    -- that job applied.
    v_keep_cover := (CASE WHEN p_payload ? '__coverBase' THEN
        NULLIF(p_payload->>'cover_media_url','') IS NOT DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
        AND v.cover_media_url IS DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
      ELSE
        v.cover_media_url IS NOT NULL
        AND NULLIF(p_payload->>'cover_media_url','') IS DISTINCT FROM v.cover_media_url
        AND EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
          WHERE j.event_id = p_event_id AND j.target_kind = 'event'
            AND j.apply_mode = 'draft_auto' AND j.status = 'applied'
            AND j.processed_url = v.cover_media_url
            AND j.applied_at >= v.updated_at)
      END);
    v_patch:=v_patch-'__expectedClientRevision'-'__coverBase';
    v_merged:=jsonb_set(v_draft||v_patch,'{clientRevision}',to_jsonb(COALESCE(v_expected_revision,v_current_revision+1)),true);
    IF v_patch?'when' THEN v_merged:=jsonb_set(v_merged,'{when}',COALESCE(v_draft->'when','{}'::jsonb)||(v_patch->'when'),true); END IF;
    IF v_patch?'settings' THEN v_merged:=jsonb_set(v_merged,'{settings}',COALESCE(v_draft->'settings','{}'::jsonb)||(v_patch->'settings'),true); END IF;
    IF COALESCE(jsonb_array_length(COALESCE(v_merged->'tickets','[]'::jsonb)),0)<>0
       OR COALESCE((v_merged->>'isRsvp')::boolean,true)<>true THEN
      RAISE EXCEPTION 'rsvp_ticket_wall' USING ERRCODE='22023';
    END IF;
    v_suggested:=NULLIF(v_merged->>'rsvpContributionSuggestedCents','')::integer;
    v_minimum:=NULLIF(v_merged->>'rsvpContributionMinCents','')::integer;
    IF (v_suggested IS NOT NULL AND v_suggested<=0)
       OR (v_minimum IS NOT NULL AND v_minimum<=0)
       OR (v_suggested IS NOT NULL AND v_minimum IS NOT NULL AND v_suggested<v_minimum) THEN
      RAISE EXCEPTION 'rsvp_contribution_amount_invalid' USING ERRCODE='22023';
    END IF;
    v_theme:=jsonb_set(COALESCE(v.theme,'{}'::jsonb),'{business_draft}',v_merged,true);
    UPDATE public.events SET
      title=COALESCE(NULLIF(btrim(p_payload->>'title'),''),v.title),
      description=CASE WHEN p_payload?'description' THEN NULLIF(p_payload->>'description','') ELSE v.description END,
      location_text=CASE WHEN p_payload?'location_text' THEN NULLIF(p_payload->>'location_text','') ELSE v.location_text END,
      online_url=CASE WHEN p_payload?'online_url' THEN NULLIF(p_payload->>'online_url','') ELSE v.online_url END,
      cover_media_url=CASE WHEN v_keep_cover THEN v.cover_media_url WHEN p_payload?'cover_media_url' THEN NULLIF(p_payload->>'cover_media_url','') ELSE v.cover_media_url END,
      cover_media_poster_url=CASE WHEN v_keep_cover THEN v.cover_media_poster_url WHEN p_payload?'cover_media_poster_url' THEN NULLIF(p_payload->>'cover_media_poster_url','') ELSE v.cover_media_poster_url END,
      cover_media_type=CASE WHEN v_keep_cover THEN v.cover_media_type WHEN p_payload?'cover_media_type' THEN NULLIF(p_payload->>'cover_media_type','') ELSE v.cover_media_type END,
      cover_media_provider=CASE WHEN v_keep_cover THEN v.cover_media_provider WHEN p_payload?'cover_media_provider' THEN NULLIF(p_payload->>'cover_media_provider','') ELSE v.cover_media_provider END,
      cover_media_source_url=CASE WHEN v_keep_cover THEN v.cover_media_source_url WHEN p_payload?'cover_media_source_url' THEN NULLIF(p_payload->>'cover_media_source_url','') ELSE v.cover_media_source_url END,
      cover_media_credit=CASE WHEN v_keep_cover THEN v.cover_media_credit WHEN p_payload?'cover_media_credit' THEN NULLIF(p_payload->>'cover_media_credit','') ELSE v.cover_media_credit END,
      cover_media_credit_url=CASE WHEN v_keep_cover THEN v.cover_media_credit_url WHEN p_payload?'cover_media_credit_url' THEN NULLIF(p_payload->>'cover_media_credit_url','') ELSE v.cover_media_credit_url END,
      cover_media_alt=CASE WHEN v_keep_cover THEN v.cover_media_alt WHEN p_payload?'cover_media_alt' THEN NULLIF(p_payload->>'cover_media_alt','') ELSE v.cover_media_alt END,
      cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE v.cover_media_gallery END,
      timezone=COALESCE(NULLIF(p_payload->>'timezone',''),v.timezone),
      is_online=CASE WHEN v_patch?'format' THEN (v_patch->>'format') IN ('online','hybrid') ELSE v.is_online END,
      theme=v_theme,
      party_types=CASE WHEN v_patch?'partyTypes' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'partyTypes')) ELSE v.party_types END,
      vibe_tags=CASE WHEN v_patch?'vibeTags' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'vibeTags')) ELSE v.vibe_tags END,
      music_genres=CASE WHEN v_patch?'musicGenres' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'musicGenres')) ELSE v.music_genres END,
      city=CASE WHEN v_patch?'city' THEN NULLIF(v_patch->>'city','') ELSE v.city END,
      -- Where-step pin: written when the save carries it (the wizard always does;
      -- an explicit null clears it with the address). Absent key keeps the row.
      location_geo=CASE WHEN p_payload?'location_geo' THEN NULLIF(p_payload->>'location_geo','')::point ELSE v.location_geo END,
      theme_color_override=CASE WHEN p_payload?'theme_color_override' THEN NULLIF(p_payload->>'theme_color_override','') ELSE v.theme_color_override END,
      theme_font_override=CASE WHEN p_payload?'theme_font_override' THEN NULLIF(p_payload->>'theme_font_override','') ELSE v.theme_font_override END,
      theme_animation_override=CASE WHEN p_payload?'theme_animation_override' THEN NULLIF(p_payload->>'theme_animation_override','') ELSE v.theme_animation_override END,
      theme_gradient_override=CASE WHEN p_payload?'theme_gradient_override' THEN NULLIF(p_payload->>'theme_gradient_override','') ELSE v.theme_gradient_override END,
      currency=COALESCE(NULLIF(upper(COALESCE(p_payload->>'currency',v_patch->>'currency')),''),v.currency),updated_at=now()
    WHERE id=p_event_id;
  ELSE
    IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 10 AND 200 THEN
      RAISE EXCEPTION 'rsvp_edit_reason_invalid' USING ERRCODE='22023';
    END IF;
    v_live_payload:=p_payload||jsonb_build_object('title',COALESCE(NULLIF(p_payload->>'title',''),v.title));
    v_update_result:=public.biz_update_live_rsvp(p_event_id,v_live_payload,p_reason);
    UPDATE public.events SET
      party_types=CASE WHEN p_payload?'partyTypes' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'partyTypes')) ELSE party_types END,
      vibe_tags=CASE WHEN p_payload?'vibeTags' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'vibeTags')) ELSE vibe_tags END,
      music_genres=CASE WHEN p_payload?'musicGenres' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'musicGenres')) ELSE music_genres END,
      city=CASE WHEN p_payload?'city' THEN NULLIF(p_payload->>'city','') ELSE city END,
      -- Where-step pin on a published RSVP: a re-picked address sends its
      -- coordinate and precision together; an unrelated edit sends neither.
      location_geo=CASE WHEN p_payload?'location_geo' THEN NULLIF(p_payload->>'location_geo','')::point ELSE location_geo END,
      coordinate_precision=CASE WHEN p_payload?'location_geo' THEN
        CASE WHEN NULLIF(p_payload->>'location_geo','') IS NOT NULL
              AND p_payload->>'coordinate_precision' IN ('exact','approximate')
             THEN p_payload->>'coordinate_precision' END
        ELSE coordinate_precision END,
      cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE cover_media_gallery END
    WHERE id=p_event_id;
  END IF;
  v_result:=public.issue_1977_rsvp_graph(p_event_id);
  IF v_update_result IS NOT NULL THEN
    v_result:=v_result||jsonb_build_object('updateResult',v_update_result);
  END IF;
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'update',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$
;

-- business_update_live_event_atomic: writes theme_gradient_override from p_patch.theme.gradient inside the existing theme branch.
CREATE OR REPLACE FUNCTION public.business_update_live_event_atomic(p_event_id uuid, p_patch jsonb, p_reason text, p_client_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_core jsonb:=COALESCE(p_patch->'core','{}'::jsonb);
  v_core_without_tickets jsonb:=COALESCE(p_patch->'core','{}'::jsonb)-'tickets';
  v_taxonomy jsonb:=p_patch->'taxonomy';
  v_when jsonb:=p_patch->'when';
  v_cover jsonb:=p_patch->'cover';
  v_selection public.event_cover_selections%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tickets jsonb;
  v_item jsonb;
  v_mode text;
  v_timezone text;
  v_local_when jsonb;
  v_pricing_patch jsonb:='{}'::jsonb;
  v_reason text;   -- issue #3827
  v_notice jsonb;  -- issue #3827 buyer email
BEGIN
  -- issue #3827 — a reason is owed to BUYERS. With none, a blank reason is
  -- recorded as the stated constant; with one or more it is still refused.
  -- The core, tier and when leaves below are unchanged and still validate
  -- what they are handed, which is now the resolved reason.
  v_reason:=public.business_resolve_edit_reason(p_event_id,p_reason);
  IF v_reason IS NULL THEN RAISE EXCEPTION 'invalid_edit_reason';END IF;
  IF v_core ? 'visibility'
     AND COALESCE(v_core->>'visibility','') NOT IN('public','unlisted','private') THEN
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;
  PERFORM public.business_update_live_event(
    p_event_id,v_core_without_tickets,v_reason,p_client_revision   -- issue #3827
  );
  IF v_core ? 'tickets' THEN
    PERFORM public.business_patch_event_ticket_tiers(
      p_event_id,v_core->'tickets',NULL,NULL,NULL,v_reason   -- issue #3827
    );
  END IF;

  IF v_taxonomy IS NOT NULL THEN
    PERFORM public.business_patch_event_taxonomy(
      p_event_id,
      v_taxonomy->>'city',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'partyTypes','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'vibeTags','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'musicGenres','[]'::jsonb))),
      NULLIF(v_taxonomy#>>'{locationGeo,lat}','')::numeric,
      NULLIF(v_taxonomy#>>'{locationGeo,lng}','')::numeric,
      NULLIF(v_taxonomy->>'locationText',''),
      COALESCE(v_taxonomy->>'coordinatePrecision','')
    );
  END IF;

  IF v_when IS NOT NULL THEN
    v_mode:=COALESCE(NULLIF(v_when->>'whenMode',''),'single');
    v_timezone:=COALESCE(NULLIF(v_when->>'timezone',''),
      (SELECT timezone FROM public.events WHERE id=p_event_id),'UTC');
    IF v_mode IN('single','recurring') THEN
      v_local_when:=v_when->'when';
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00'),v_timezone
      );
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'endsAt',''),
          COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00')),v_timezone
      );
    ELSIF v_mode='multi_date' THEN
      FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_when->'multiDates','[]'::jsonb)) LOOP
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'startTime',''),'00:00'),v_timezone
        );
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'endTime',''),
            COALESCE(NULLIF(v_item->>'startTime',''),'00:00')),v_timezone
        );
      END LOOP;
    END IF;
    PERFORM public.business_patch_event_when(
      p_event_id,v_when,v_reason,p_client_revision   -- issue #3827
    );
  END IF;

  IF p_patch ? 'theme' THEN
    UPDATE public.events SET
      theme_color_override=NULLIF(p_patch#>>'{theme,color}',''),
      theme_font_override=NULLIF(p_patch#>>'{theme,font}',''),
      theme_animation_override=NULLIF(p_patch#>>'{theme,animation}',''),
      theme_gradient_override=NULLIF(p_patch#>>'{theme,gradient}',''),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  IF p_patch ? 'pricing' THEN
    IF p_patch->'pricing' ? 'passTax' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_tax',p_patch#>'{pricing,passTax}');
    END IF;
    IF p_patch->'pricing' ? 'passMinglaFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_mingla_fee',p_patch#>'{pricing,passMinglaFee}');
    END IF;
    IF p_patch->'pricing' ? 'passServiceFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_service_fee',p_patch#>'{pricing,passServiceFee}');
    END IF;
    PERFORM public.business_patch_pricing_switches(p_event_id,v_pricing_patch);
  END IF;

  IF v_cover IS NOT NULL THEN
    IF COALESCE((v_cover->>'clear')::boolean,false) THEN
      PERFORM public.business_clear_event_cover_media(p_event_id);
    ELSE
      SELECT * INTO v_selection FROM public.event_cover_selections
      WHERE selection_ref=v_cover->>'selectionRef'
        AND user_id=auth.uid() AND event_id=p_event_id
        AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'cover_selection_unverified';END IF;
      PERFORM public.business_set_event_cover_media(
        p_event_id,v_selection.selection_ref,v_selection.media_url,
        v_selection.media_type,v_selection.poster_url,v_selection.provider,
        v_selection.source_url,v_selection.credit,v_selection.credit_url,
        v_selection.alt
      );
    END IF;
  END IF;

  -- issue #3288 — the additional photos. AFTER the cover block, so a save that
  -- removes the cover and edits the gallery keeps the new gallery. The caller
  -- is already authenticated, role-checked and revision-checked by
  -- business_update_live_event above; the column CHECK enforces the array shape.
  IF p_patch ? 'gallery' THEN
    UPDATE public.events SET
      cover_media_gallery=COALESCE(p_patch->'gallery','[]'::jsonb),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  -- issue #3281 — with each tier's extras, so the editor keeps them.
  SELECT COALESCE(jsonb_agg(to_jsonb(tt)||jsonb_build_object('extras',public.issue_3281_tier_extras_json(tt.id))
      ORDER BY tt.display_order,tt.created_at),'[]'::jsonb)
    INTO v_tickets FROM public.ticket_types tt
    WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  -- issue #3827 buyer email — every write above is done. Record this edit
  -- (who, why, what changed) and decide whether buyers are emailed. A save
  -- made with "refund all and proceed" holds the email. Never raises.
  v_notice:=public.event_edit_notice_flush(
    p_event_id,v_reason,'event',
    COALESCE((v_when->>'acknowledgeSoldImpact')::boolean,false)
  );
  RETURN jsonb_build_object(
    'event',to_jsonb(v_event),'tickets',v_tickets,
    'client_revision',p_client_revision,
    'buyer_notice',v_notice   -- issue #3827 buyer email
  );
END;$function$
;

-- admin_update_brand: writes theme_gradient when the key is present (blank clears it).
CREATE OR REPLACE FUNCTION public.admin_update_brand(p_brand_id uuid, p_patch jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  SELECT to_jsonb(b) INTO v_before FROM public.brands b WHERE b.id = p_brand_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  -- Whitelist validation (NOT NULL cols reject empty; venue_category CHECK).
  IF (p_patch ? 'name') AND btrim(COALESCE(p_patch->>'name', '')) = '' THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF (p_patch ? 'pricing_currency') AND btrim(COALESCE(p_patch->>'pricing_currency', '')) = '' THEN
    RAISE EXCEPTION 'invalid_currency';
  END IF;
  IF (p_patch ? 'venue_category') AND (p_patch->>'venue_category') IS NOT NULL
     AND (p_patch->>'venue_category') NOT IN ('restaurant', 'play', 'creative_and_arts') THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;

  UPDATE public.brands SET
    name             = CASE WHEN p_patch ? 'name'             THEN p_patch->>'name'             ELSE name END,
    description      = CASE WHEN p_patch ? 'description'      THEN p_patch->>'description'      ELSE description END,
    contact_email    = CASE WHEN p_patch ? 'contact_email'   THEN p_patch->>'contact_email'   ELSE contact_email END,
    contact_phone    = CASE WHEN p_patch ? 'contact_phone'   THEN p_patch->>'contact_phone'   ELSE contact_phone END,
    pricing_currency = CASE WHEN p_patch ? 'pricing_currency' THEN p_patch->>'pricing_currency' ELSE pricing_currency END,
    default_currency = CASE WHEN p_patch ? 'default_currency' THEN p_patch->>'default_currency' ELSE default_currency END,
    venue_category   = CASE WHEN p_patch ? 'venue_category'   THEN p_patch->>'venue_category'   ELSE venue_category END,
    theme_color      = CASE WHEN p_patch ? 'theme_color'      THEN p_patch->>'theme_color'      ELSE theme_color END,
    theme_font       = CASE WHEN p_patch ? 'theme_font'       THEN p_patch->>'theme_font'       ELSE theme_font END,
    theme_animation  = CASE WHEN p_patch ? 'theme_animation'  THEN p_patch->>'theme_animation'  ELSE theme_animation END,
    theme_gradient   = CASE WHEN p_patch ? 'theme_gradient'   THEN NULLIF(btrim(COALESCE(p_patch->>'theme_gradient','')),'') ELSE theme_gradient END,
    -- social_links / custom_links are NOT NULL jsonb; only a jsonb object/array
    -- replaces them (a stray JSON null/scalar is ignored, preserving NOT NULL).
    social_links     = CASE WHEN (p_patch ? 'social_links')
                              AND jsonb_typeof(p_patch->'social_links') IN ('object', 'array')
                            THEN p_patch->'social_links' ELSE social_links END,
    custom_links     = CASE WHEN (p_patch ? 'custom_links')
                              AND jsonb_typeof(p_patch->'custom_links') IN ('object', 'array')
                            THEN p_patch->'custom_links' ELSE custom_links END,
    updated_at       = now()
   WHERE id = p_brand_id
   RETURNING to_jsonb(brands) INTO v_after;

  PERFORM public.admin_write_audit('brand.update', 'brand', p_brand_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after), false);  -- LOW: reason optional
  RETURN v_after;
END; $function$
;

-- ari_update_brand_context: accepts theme.color2 (hex, only with a colour), checks the font with issue_1023_is_theme_font, writes theme_gradient as one unit with the colour.
CREATE OR REPLACE FUNCTION public.ari_update_brand_context(p_operation_id uuid, p_brand_id uuid, p_expected_plan_revision integer, p_expected_context_revision text, p_patch jsonb DEFAULT '{}'::jsonb, p_exceptions jsonb DEFAULT '[]'::jsonb, p_evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_plan public.brand_site_plans%ROWTYPE;
  v_current_context_revision text;
  v_begin jsonb;
  v_result jsonb;
  v_receipt_args jsonb;
  v_confirmed_args jsonb;
  v_source_type text := COALESCE(NULLIF(p_evidence->>'source_type',''),'owner');
  v_source_ref text := NULLIF(btrim(COALESCE(p_evidence->>'source_ref','')),'');
  v_source_url text := NULLIF(btrim(COALESCE(p_evidence->>'source_url','')),'');
  v_observed_at timestamptz;
  v_key text;
  v_field_key text;
  v_exception jsonb;
  v_reason text;
BEGIN
  IF v_actor IS NULL OR NOT public.biz_is_brand_admin_plus_for_caller(p_brand_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_patch) <> 'object' OR jsonb_typeof(p_exceptions) <> 'array'
    OR jsonb_typeof(p_evidence) <> 'object'
    OR NOT public.brand_site_json_keys_allowed(p_patch,ARRAY[
      'name','description','contact_email','contact_phone','address','city',
      'country_code','social_links','custom_links','theme'])
    OR NOT public.brand_site_json_keys_allowed(p_evidence,ARRAY[
      'source_type','source_ref','source_url','observed_at'])
    OR (p_patch = '{}'::jsonb AND p_exceptions = '[]'::jsonb) THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
      SELECT 1 FROM jsonb_each(p_patch) entry
      WHERE (entry.key='name' AND jsonb_typeof(entry.value)<>'string')
        OR (entry.key IN (
          'description','contact_email','contact_phone','address','city','country_code')
          AND jsonb_typeof(entry.value) NOT IN ('string','null'))
        OR (entry.key IN ('social_links','theme')
          AND jsonb_typeof(entry.value) NOT IN ('object','null'))
        OR (entry.key='custom_links'
          AND jsonb_typeof(entry.value) NOT IN ('array','null'))
    )
    OR NOT (p_evidence ? 'source_type')
    OR jsonb_typeof(p_evidence->'source_type') <> 'string'
    OR (p_evidence ? 'source_ref' AND jsonb_typeof(p_evidence->'source_ref') <> 'string')
    OR (p_evidence ? 'source_url' AND jsonb_typeof(p_evidence->'source_url') <> 'string')
    OR (p_evidence ? 'observed_at' AND jsonb_typeof(p_evidence->'observed_at') <> 'string') THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  IF v_source_type NOT IN ('mingla','owner','public_research','imported')
    OR length(COALESCE(v_source_ref,'')) > 300
    OR (v_source_url IS NOT NULL AND (length(v_source_url) > 1000 OR v_source_url !~ '^https://'))
    OR (v_source_type = 'public_research' AND v_source_url IS NULL) THEN
    RAISE EXCEPTION 'invalid_evidence' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_observed_at := COALESCE(NULLIF(p_evidence->>'observed_at','')::timestamptz,now());
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_evidence' USING ERRCODE = '22023';
  END;
  IF v_observed_at < timestamptz '2000-01-01 00:00:00+00'
    OR v_observed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid_evidence' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_exceptions) > 9 THEN
    RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
  END IF;
  FOR v_exception IN SELECT value FROM jsonb_array_elements(p_exceptions) LOOP
    IF jsonb_typeof(v_exception) <> 'object'
      OR NOT public.brand_site_json_keys_allowed(v_exception,ARRAY['field_key','reason'])
      OR jsonb_typeof(v_exception->'field_key') <> 'string'
      OR jsonb_typeof(v_exception->'reason') <> 'string' THEN
      RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
    END IF;
    v_field_key := v_exception->>'field_key';
    v_reason := NULLIF(btrim(COALESCE(v_exception->>'reason','')),'');
    IF v_field_key NOT IN (
      'venue_descriptor','contact_email','contact_phone','address','city_country',
      'social_links','profile_photo','cover_media','theme')
      OR v_reason IS NULL OR length(v_reason) > 500
      OR (v_field_key='contact_email' AND p_patch ? 'contact_email')
      OR (v_field_key='contact_phone' AND p_patch ? 'contact_phone')
      OR (v_field_key='address' AND p_patch ? 'address')
      OR (v_field_key='city_country' AND (p_patch ? 'city' OR p_patch ? 'country_code'))
      OR (v_field_key='social_links' AND (p_patch ? 'social_links' OR p_patch ? 'custom_links'))
      OR (v_field_key='theme' AND p_patch ? 'theme') THEN
      RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_exceptions)) <>
    (SELECT count(DISTINCT item->>'field_key') FROM jsonb_array_elements(p_exceptions) item) THEN
    RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
  END IF;

  -- #2830: the operation receipt binds to the EXACT proposal the owner
  -- confirmed, which also carries the readable why and its citations. The
  -- original rebuilt a partial copy without them, so agent_operation_receipt_begin
  -- refused every Ari brand-context save as operation_binding_mismatch. Every
  -- value this function writes must still equal the confirmed proposal.
  SELECT tool_args INTO v_confirmed_args
    FROM public.agent_pending_actions
   WHERE id = p_operation_id
     AND user_id = auth.uid()
     AND tool_name = 'update_brand_context';
  IF v_confirmed_args IS NULL
    OR v_confirmed_args->>'brand_id' IS DISTINCT FROM p_brand_id::text
    OR v_confirmed_args->'expected_plan_revision'
      IS DISTINCT FROM to_jsonb(p_expected_plan_revision)
    OR v_confirmed_args->>'expected_context_revision'
      IS DISTINCT FROM p_expected_context_revision
    OR COALESCE(v_confirmed_args->'patch','{}'::jsonb) IS DISTINCT FROM p_patch
    OR COALESCE(v_confirmed_args->'exceptions','[]'::jsonb)
      IS DISTINCT FROM p_exceptions
    OR COALESCE(v_confirmed_args->'evidence','{}'::jsonb) IS DISTINCT FROM p_evidence THEN
    RAISE EXCEPTION 'operation_binding_mismatch';
  END IF;
  v_receipt_args := v_confirmed_args;
  v_begin := public.agent_operation_receipt_begin(
    p_operation_id,'update_brand_context',v_receipt_args);
  IF COALESCE((v_begin->>'replay')::boolean,false) THEN RETURN v_begin->'result'; END IF;

  SELECT * INTO v_plan FROM public.brand_site_plans
  WHERE brand_id = p_brand_id FOR UPDATE;
  IF v_plan.brand_id IS NULL OR p_expected_plan_revision IS NULL
    OR p_expected_plan_revision <> v_plan.revision THEN
    RAISE EXCEPTION 'sites_revision_conflict';
  END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN RAISE EXCEPTION 'sites_plan_locked'; END IF;
  PERFORM 1 FROM public.brands
  WHERE id=p_brand_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  PERFORM 1 FROM public.brand_context_field_evidence
  WHERE brand_id=p_brand_id FOR UPDATE;
  v_current_context_revision := public.brand_context_revision(p_brand_id);
  IF p_expected_context_revision IS NULL
    OR p_expected_context_revision !~ '^[0-9a-f]{64}$'
    OR p_expected_context_revision <> v_current_context_revision THEN
    RAISE EXCEPTION 'sites_context_revision_conflict';
  END IF;

  IF p_patch ? 'name' AND length(btrim(COALESCE(p_patch->>'name',''))) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid_brand_name' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'description' AND length(COALESCE(p_patch->>'description','')) > 500 THEN
    RAISE EXCEPTION 'invalid_description' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'contact_email' AND jsonb_typeof(p_patch->'contact_email') <> 'null'
    AND COALESCE(p_patch->>'contact_email','') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_contact_email' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'contact_phone' AND jsonb_typeof(p_patch->'contact_phone') <> 'null'
    AND COALESCE(p_patch->>'contact_phone','') !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'invalid_contact_phone' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'address' AND length(COALESCE(p_patch->>'address','')) > 240 THEN
    RAISE EXCEPTION 'invalid_address' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'city' AND length(COALESCE(p_patch->>'city','')) > 120 THEN
    RAISE EXCEPTION 'invalid_city' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'country_code' AND jsonb_typeof(p_patch->'country_code') <> 'null'
    AND upper(COALESCE(p_patch->>'country_code','')) !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'invalid_country_code' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'social_links' AND jsonb_typeof(p_patch->'social_links') <> 'null' AND (
    jsonb_typeof(p_patch->'social_links') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_each(p_patch->'social_links') e
      WHERE e.key NOT IN ('website','instagram','tiktok','x','facebook','youtube','linkedin','threads')
        OR jsonb_typeof(e.value) <> 'string'
        OR length(e.value#>>'{}') > 500 OR (e.value#>>'{}') !~ '^https://'
    )) THEN RAISE EXCEPTION 'invalid_social_links' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'custom_links' AND jsonb_typeof(p_patch->'custom_links') <> 'null' AND (
    jsonb_typeof(p_patch->'custom_links') <> 'array'
    OR jsonb_array_length(p_patch->'custom_links') > 10 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_patch->'custom_links') e
      WHERE jsonb_typeof(e) <> 'object'
        OR NOT public.brand_site_json_keys_allowed(e,ARRAY['label','url'])
        OR jsonb_typeof(e->'label') <> 'string'
        OR jsonb_typeof(e->'url') <> 'string'
        OR length(btrim(COALESCE(e->>'label',''))) NOT BETWEEN 1 AND 80
        OR COALESCE(e->>'url','') !~ '^https://' OR length(e->>'url') > 1000
    )) THEN RAISE EXCEPTION 'invalid_custom_links' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'theme' AND jsonb_typeof(p_patch->'theme') <> 'null' AND (
    jsonb_typeof(p_patch->'theme') <> 'object'
    OR NOT public.brand_site_json_keys_allowed(p_patch->'theme',ARRAY['color','color2','font','animation'])
    OR ((p_patch->'theme' ? 'color') AND jsonb_typeof(p_patch->'theme'->'color') <> 'null'
      AND COALESCE(p_patch#>>'{theme,color}','') !~ '^#[0-9a-fA-F]{6}$')
    OR ((p_patch->'theme' ? 'color2') AND jsonb_typeof(p_patch->'theme'->'color2') <> 'null'
      AND (COALESCE(p_patch#>>'{theme,color2}','') !~ '^#[0-9a-fA-F]{6}$'
        OR NULLIF(p_patch#>>'{theme,color}','') IS NULL))
    OR ((p_patch->'theme' ? 'font') AND jsonb_typeof(p_patch->'theme'->'font') <> 'null'
      AND NOT public.issue_1023_is_theme_font(COALESCE(p_patch#>>'{theme,font}','')))
    OR ((p_patch->'theme' ? 'animation') AND jsonb_typeof(p_patch->'theme'->'animation') <> 'null'
      AND COALESCE(p_patch#>>'{theme,animation}','') NOT IN (
        'none','confetti','fireworks','balloons','sparkles','glitter_shower',
        'snowfall','falling_petals','hearts','shimmer_reveal',
    -- issue #1023: the 20 new theme motion slugs
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'))
    ) THEN RAISE EXCEPTION 'invalid_theme' USING ERRCODE = '22023'; END IF;

  UPDATE public.brands b SET
    name = CASE WHEN p_patch ? 'name' THEN btrim(p_patch->>'name') ELSE b.name END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(btrim(COALESCE(p_patch->>'description','')),'') ELSE b.description END,
    contact_email = CASE WHEN p_patch ? 'contact_email' THEN NULLIF(btrim(COALESCE(p_patch->>'contact_email','')),'') ELSE b.contact_email END,
    contact_phone = CASE WHEN p_patch ? 'contact_phone' THEN NULLIF(btrim(COALESCE(p_patch->>'contact_phone','')),'') ELSE b.contact_phone END,
    address = CASE WHEN p_patch ? 'address' THEN NULLIF(btrim(COALESCE(p_patch->>'address','')),'') ELSE b.address END,
    city = CASE WHEN p_patch ? 'city' THEN NULLIF(btrim(COALESCE(p_patch->>'city','')),'') ELSE b.city END,
    country_code = CASE WHEN p_patch ? 'country_code' THEN NULLIF(upper(btrim(COALESCE(p_patch->>'country_code',''))),'') ELSE b.country_code END,
    social_links = CASE WHEN p_patch ? 'social_links' THEN COALESCE(p_patch->'social_links','{}'::jsonb) ELSE b.social_links END,
    custom_links = CASE WHEN p_patch ? 'custom_links' THEN COALESCE(p_patch->'custom_links','[]'::jsonb) ELSE b.custom_links END,
    theme_color = CASE WHEN p_patch ? 'theme' THEN NULLIF(p_patch#>>'{theme,color}','') ELSE b.theme_color END,
    theme_font = CASE WHEN p_patch ? 'theme' THEN NULLIF(p_patch#>>'{theme,font}','') ELSE b.theme_font END,
    theme_animation = CASE WHEN p_patch ? 'theme' THEN NULLIF(p_patch#>>'{theme,animation}','') ELSE b.theme_animation END,
    theme_gradient = CASE WHEN p_patch ? 'theme'
      THEN CASE WHEN NULLIF(p_patch#>>'{theme,color}','') IS NOT NULL
                 AND NULLIF(p_patch#>>'{theme,color2}','') IS NOT NULL
           THEN lower(p_patch#>>'{theme,color}') || ',' || lower(p_patch#>>'{theme,color2}') END
      ELSE b.theme_gradient END,
    updated_at = now()
  WHERE b.id = p_brand_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    v_field_key := CASE v_key
      WHEN 'city' THEN 'city_country' WHEN 'country_code' THEN 'city_country'
      WHEN 'theme' THEN 'theme' WHEN 'social_links' THEN 'social_links'
      WHEN 'custom_links' THEN 'social_links' ELSE v_key END;
    INSERT INTO public.brand_context_field_evidence(
      brand_id,field_key,disposition,source_type,source_ref,source_url,
      observed_at,owner_confirmed_at,updated_at,updated_by
    ) VALUES (
      p_brand_id,v_field_key,'verified',v_source_type,v_source_ref,v_source_url,
      v_observed_at,now(),now(),v_actor
    ) ON CONFLICT (brand_id,field_key) DO UPDATE SET
      disposition='verified',source_type=EXCLUDED.source_type,
      source_ref=EXCLUDED.source_ref,source_url=EXCLUDED.source_url,
      observed_at=EXCLUDED.observed_at,owner_confirmed_at=EXCLUDED.owner_confirmed_at,
      exception_reason=NULL,evidence_candidates='[]'::jsonb,
      recheck_fingerprint=NULL,updated_at=now(),updated_by=v_actor;
  END LOOP;

  FOR v_exception IN SELECT value FROM jsonb_array_elements(p_exceptions) LOOP
    v_field_key := v_exception->>'field_key';
    v_reason := NULLIF(btrim(COALESCE(v_exception->>'reason','')),'');
    INSERT INTO public.brand_context_field_evidence(
      brand_id,field_key,disposition,source_type,source_ref,source_url,
      observed_at,owner_confirmed_at,exception_reason,recheck_fingerprint,
      updated_at,updated_by
    ) VALUES (
      p_brand_id,v_field_key,'not_applicable','owner',NULL,NULL,
      now(),now(),v_reason,
      public.brand_context_recheck_fingerprint(p_brand_id,v_field_key),
      now(),v_actor
    ) ON CONFLICT (brand_id,field_key) DO UPDATE SET
      disposition='not_applicable',source_type='owner',source_ref=NULL,source_url=NULL,
      observed_at=now(),owner_confirmed_at=now(),exception_reason=EXCLUDED.exception_reason,
      evidence_candidates='[]'::jsonb,
      recheck_fingerprint=EXCLUDED.recheck_fingerprint,
      updated_at=now(),updated_by=v_actor;
  END LOOP;

  UPDATE public.brand_site_plans SET
    revision = revision + 1,lock_holder=v_actor,
    lock_expires_at=now()+interval '10 minutes',updated_at=now(),updated_by=v_actor
  WHERE brand_id=p_brand_id;
  v_result := jsonb_build_object(
    'brand_id',p_brand_id,'plan_revision',v_plan.revision+1,
    'completeness',public.brand_context_completeness_internal(p_brand_id));
  RETURN public.agent_operation_receipt_complete(
    p_operation_id,'update_brand_context',v_receipt_args,v_result);
END;
$function$
;

-- brand_context_completeness_internal: font validity via issue_1023_is_theme_font; evidence gains 'gradient'; validity checks the gradient shape.
CREATE OR REPLACE FUNCTION public.brand_context_completeness_internal(p_brand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_plan public.brand_site_plans%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_fields jsonb := '[]'::jsonb;
  v_social_present boolean;
  v_social_valid boolean;
  v_venue_selected boolean;
  v_required_gaps integer;
  v_recommended_gaps integer;
  v_verified integer;
  v_exceptions integer;
  v_validation_checks jsonb;
  v_failed_validation integer;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;

  v_social_present :=
    CASE WHEN jsonb_typeof(COALESCE(v_brand.social_links, '{}'::jsonb)) = 'object'
      THEN EXISTS (
        SELECT 1 FROM jsonb_each_text(COALESCE(v_brand.social_links, '{}'::jsonb)) e
        WHERE NULLIF(btrim(e.value), '') IS NOT NULL
      ) ELSE false END
    OR CASE WHEN jsonb_typeof(COALESCE(v_brand.custom_links, '[]'::jsonb)) = 'array'
      THEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_brand.custom_links, '[]'::jsonb)) e
        WHERE jsonb_typeof(e) = 'object'
          AND NULLIF(btrim(COALESCE(e->>'url','')), '') IS NOT NULL
      ) ELSE false END;
  v_social_valid :=
    CASE WHEN jsonb_typeof(COALESCE(v_brand.social_links, '{}'::jsonb)) = 'object'
      THEN NOT EXISTS (
        SELECT 1 FROM jsonb_each(COALESCE(v_brand.social_links, '{}'::jsonb)) e
        WHERE e.key NOT IN ('website','instagram','tiktok','x','facebook','youtube','linkedin','threads')
          OR jsonb_typeof(e.value) <> 'string'
          OR length(e.value#>>'{}') > 500 OR (e.value#>>'{}') !~ '^https://'
      ) ELSE false END
    AND CASE WHEN jsonb_typeof(COALESCE(v_brand.custom_links, '[]'::jsonb)) = 'array'
      THEN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_brand.custom_links, '[]'::jsonb)) e
        WHERE jsonb_typeof(e) <> 'object'
          OR NOT public.brand_site_json_keys_allowed(e,ARRAY['label','url'])
          OR jsonb_typeof(e->'label') <> 'string'
          OR jsonb_typeof(e->'url') <> 'string'
          OR length(btrim(COALESCE(e->>'label',''))) NOT BETWEEN 1 AND 80
          OR COALESCE(e->>'url','') !~ '^https://' OR length(COALESCE(e->>'url','')) > 1000
      ) ELSE false END;
  v_venue_selected := EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_plan.offerings_selected, ARRAY[]::text[])) item
    WHERE item LIKE 'venue_%'
  );

  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'name','Brand name','Identity','required',to_jsonb(v_brand.name),
    NULLIF(btrim(COALESCE(v_brand.name,'')),'') IS NOT NULL,
    length(btrim(COALESCE(v_brand.name,''))) BETWEEN 1 AND 80));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'description','Brand story','Identity','required',to_jsonb(v_brand.description),
    NULLIF(btrim(COALESCE(v_brand.description,'')),'') IS NOT NULL,
    length(COALESCE(v_brand.description,'')) <= 500));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'offerings_selected','What you offer','Offer','required',to_jsonb(v_plan.offerings_selected),
    v_plan.offerings_selected IS NOT NULL,true));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'design_key','Website design','Design','required',
    to_jsonb(COALESCE(v_plan.design_key, v_site.design_key)),
    COALESCE(v_plan.design_key, v_site.design_key) IS NOT NULL,
    COALESCE(v_plan.design_key, v_site.design_key) IN ('atelier','voyage')));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'story.who','Who comes with you','Story','required',to_jsonb(v_plan.story->>'who'),
    NULLIF(btrim(COALESCE(v_plan.story->>'who','')),'') IS NOT NULL,
    length(COALESCE(v_plan.story->>'who','')) <= 300));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'story.why','Why they choose you','Story','required',to_jsonb(v_plan.story->>'why'),
    NULLIF(btrim(COALESCE(v_plan.story->>'why','')),'') IS NOT NULL,
    length(COALESCE(v_plan.story->>'why','')) <= 300));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'story.main_action','Main visitor action','Story','required',to_jsonb(v_plan.story->>'main_action'),
    NULLIF(btrim(COALESCE(v_plan.story->>'main_action','')),'') IS NOT NULL,
    length(COALESCE(v_plan.story->>'main_action','')) <= 300));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'approved_plan','Owner-approved plan','Approval','required',to_jsonb(v_plan.approved_plan),
    v_plan.approved_plan IS NOT NULL AND v_plan.approved_at IS NOT NULL,
    jsonb_typeof(v_plan.approved_plan) = 'object'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'venue_descriptor','Venue description','Offer',
    CASE WHEN v_venue_selected THEN 'recommended' ELSE 'optional' END,
    to_jsonb(v_plan.venue_descriptor),
    NULLIF(btrim(COALESCE(v_plan.venue_descriptor,'')),'') IS NOT NULL,
    length(COALESCE(v_plan.venue_descriptor,'')) <= 60));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'contact_email','Contact email','Contact','recommended',to_jsonb(v_brand.contact_email),
    NULLIF(btrim(COALESCE(v_brand.contact_email,'')),'') IS NOT NULL,
    COALESCE(v_brand.contact_email,'') ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'contact_phone','Contact phone','Contact','recommended',to_jsonb(v_brand.contact_phone),
    NULLIF(btrim(COALESCE(v_brand.contact_phone,'')),'') IS NOT NULL,
    COALESCE(v_brand.contact_phone,'') ~ '^\+[1-9][0-9]{7,14}$'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'address','Address','Location','recommended',to_jsonb(v_brand.address),
    NULLIF(btrim(COALESCE(v_brand.address,'')),'') IS NOT NULL,
    length(COALESCE(v_brand.address,'')) <= 240));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'city_country','City and country','Location','recommended',
    jsonb_build_object('city',v_brand.city,'country_code',v_brand.country_code),
    NULLIF(btrim(COALESCE(v_brand.city,'')),'') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_brand.country_code,'')),'') IS NOT NULL,
    length(COALESCE(v_brand.city,'')) <= 120
      AND COALESCE(v_brand.country_code,'') ~ '^[A-Z]{2}$'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'social_links','Public website or social link','Links','recommended',
    jsonb_build_object(
      'social_links',COALESCE(v_brand.social_links,'{}'::jsonb),
      'custom_links',COALESCE(v_brand.custom_links,'[]'::jsonb)),
    v_social_present,v_social_valid));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'profile_photo','Brand logo','Media','recommended',to_jsonb(v_brand.profile_photo_url),
    NULLIF(btrim(COALESCE(v_brand.profile_photo_url,'')),'') IS NOT NULL,
    public.brand_context_media_url_valid(v_brand.profile_photo_url),true));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'cover_media','Cover media','Media','recommended',to_jsonb(v_brand.cover_media_url),
    NULLIF(btrim(COALESCE(v_brand.cover_media_url,'')),'') IS NOT NULL,
    public.brand_context_media_url_valid(v_brand.cover_media_url),true));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'theme','Mingla page theme','Design','recommended',
    jsonb_build_object('color',v_brand.theme_color,'font',v_brand.theme_font,'animation',v_brand.theme_animation,'gradient',v_brand.theme_gradient),
    v_brand.theme_color IS NOT NULL OR v_brand.theme_font IS NOT NULL OR v_brand.theme_animation IS NOT NULL,
    (v_brand.theme_color IS NULL OR v_brand.theme_color ~ '^#[0-9a-fA-F]{6}$')
      AND public.issue_1023_is_theme_font(v_brand.theme_font)
      AND public.issue_1023_is_theme_gradient(v_brand.theme_gradient)
      AND (v_brand.theme_animation IS NULL OR v_brand.theme_animation IN (
        'none','confetti','fireworks','balloons','sparkles','glitter_shower',
        'snowfall','falling_petals','hearts','shimmer_reveal',
    -- issue #1023: the 20 new theme motion slugs
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'))));

  v_validation_checks := jsonb_build_array(
    jsonb_build_object(
      'key','field_shapes','label','Field formats and allowed values',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement' <> 'optional' AND item->>'state'='invalid'
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','evidence_freshness','label','Evidence freshness and conflicts',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement' <> 'optional'
          AND item->>'state' IN ('stale','conflict')
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','required_dependencies','label','Required plan dependencies',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement'='required' AND item->>'state'<>'verified'
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','recommended_readiness','label','Recommended Website context',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement'='recommended'
          AND item->>'state' NOT IN ('verified','not_applicable')
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','human_handoffs','label','Owner media and file handoffs',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE COALESCE((item->>'human_action_required')::boolean,false)
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','cross_field_alignment','label','Cross-field and plan alignment',
      'state',CASE WHEN
        (v_venue_selected AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_fields) item
          WHERE item->>'key'='venue_descriptor'
            AND item->>'state' IN ('verified','not_applicable')))
        OR (NULLIF(btrim(COALESCE(v_brand.address,'')),'') IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_fields) item
          WHERE item->>'key'='city_country'
            AND item->>'state' IN ('verified','not_applicable')))
        OR (v_plan.approved_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_fields) item
          WHERE item->>'key' IN (
            'offerings_selected','design_key','story.who','story.why','story.main_action')
            AND item->>'state'<>'verified'))
      THEN 'fail' ELSE 'pass' END)
  );
  SELECT count(*) INTO v_failed_validation
  FROM jsonb_array_elements(v_validation_checks) check_item
  WHERE check_item->>'state' <> 'pass';

  SELECT count(*) FILTER (
      WHERE item->>'requirement' = 'required' AND item->>'state' <> 'verified'
    ),
    count(*) FILTER (
      WHERE item->>'requirement' = 'recommended'
        AND item->>'state' NOT IN ('verified','not_applicable')
    ),
    count(*) FILTER (WHERE item->>'state' = 'verified'),
    count(*) FILTER (WHERE item->>'state' = 'not_applicable')
  INTO v_required_gaps, v_recommended_gaps, v_verified, v_exceptions
  FROM jsonb_array_elements(v_fields) item;

  RETURN jsonb_build_object(
    'revision', COALESCE(v_plan.revision, 0),
    'context_revision', public.brand_context_revision(p_brand_id),
    'design_key', COALESCE(v_plan.design_key, v_site.design_key),
    'fields', v_fields,
    'required_gap_count', v_required_gaps,
    'recommended_gap_count', v_recommended_gaps,
    'gap_count', v_required_gaps + v_recommended_gaps,
    'verified_count', v_verified,
    'exception_count', v_exceptions,
    'validation_checks', v_validation_checks,
    'failed_validation_count', v_failed_validation,
    'minimum_complete', v_required_gaps = 0,
    'context_complete', v_required_gaps = 0 AND v_recommended_gaps = 0
      AND v_failed_validation = 0,
    'checked_at', now()
  );
END;
$function$
;

-- brand_context_revision: hashes theme_gradient when set (existing revisions unchanged).
CREATE OR REPLACE FUNCTION public.brand_context_revision(p_brand_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_basis jsonb;
BEGIN
  SELECT jsonb_build_object(
    'brand',jsonb_build_object(
      'name',b.name,'description',b.description,
      'contact_email',b.contact_email,'contact_phone',b.contact_phone,
      'address',b.address,'city',b.city,'country_code',b.country_code,
      'social_links',b.social_links,'custom_links',b.custom_links,
      'profile_photo_url',b.profile_photo_url,
      'cover_media_url',b.cover_media_url,'cover_media_type',b.cover_media_type,
      'theme_color',b.theme_color,'theme_font',b.theme_font,
      'theme_animation',b.theme_animation)
      -- issue #1023: the gradient joins the hash only when set, so every
      -- existing brand keeps its current revision.
      || CASE WHEN b.theme_gradient IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('theme_gradient',b.theme_gradient) END,
    'plan',jsonb_build_object(
      'revision',p.revision,'offerings_selected',p.offerings_selected,
      'venue_descriptor',p.venue_descriptor,'story',p.story,
      'design_key',p.design_key,'approved_plan',p.approved_plan,
      'approved_at',p.approved_at),
    'site_design_key',s.design_key,
    'evidence',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'field_key',e.field_key,'disposition',e.disposition,
        'source_type',e.source_type,'source_ref',e.source_ref,
        'source_url',e.source_url,'observed_at',e.observed_at,
        'owner_confirmed_at',e.owner_confirmed_at,
        'exception_reason',e.exception_reason,
        'evidence_candidates',e.evidence_candidates,
        'recheck_fingerprint',e.recheck_fingerprint
      ) ORDER BY e.field_key)
      FROM public.brand_context_field_evidence e
      WHERE e.brand_id=p_brand_id
    ),'[]'::jsonb)
  ) INTO v_basis
  FROM public.brands b
  LEFT JOIN public.brand_site_plans p ON p.brand_id=b.id
  LEFT JOIN public.brand_sites s ON s.brand_id=b.id
  WHERE b.id=p_brand_id AND b.deleted_at IS NULL;
  IF v_basis IS NULL THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  RETURN encode(extensions.digest(convert_to(v_basis::text,'UTF8'),'sha256'),'hex');
END;
$function$
;

-- biz_create_venue_listing: font validation via issue_1023_is_theme_font (signature unchanged; unknown shapes still fail soft to NULL).
CREATE OR REPLACE FUNCTION public.biz_create_venue_listing(p_brand_id uuid, p_name text, p_slug text, p_description text, p_google_place_id text, p_lat double precision, p_lng double precision, p_city text, p_country_code text, p_address text, p_venue_category text, p_contact_email text, p_contact_phone text, p_cover_media_url text, p_cover_media_type text, p_hours jsonb, p_place_pool_id uuid DEFAULT NULL::uuid, p_coordinate_precision text DEFAULT ''::text, p_theme_color text DEFAULT ''::text, p_theme_font text DEFAULT ''::text, p_theme_animation text DEFAULT ''::text, p_cover_media_poster_url text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_venue_id uuid;
  v_idx int;
  v_hour jsonb;
  v_cover_url text;
  v_cover_type text;
  v_cover_poster text;
  v_google text;
  v_pool_google text;
  v_coordinate_precision text;
  v_stay_authoring_enabled boolean := false;
  v_theme_color text;
  v_theme_font text;
  v_theme_animation text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id AND b.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF length(trim(coalesce(p_slug, ''))) = 0 THEN
    RAISE EXCEPTION 'slug_required';
  END IF;
  IF trim(p_slug) !~ '^[a-z0-9]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array'
     OR jsonb_array_length(p_hours) <> 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;
  IF p_venue_category IS NULL OR p_venue_category NOT IN (
    'restaurant',
    'play',
    'creative_and_arts',
    'stay'
  ) THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;
  IF p_venue_category = 'stay' THEN
    SELECT COALESCE(flag.is_enabled, false)
    INTO v_stay_authoring_enabled
    FROM public.feature_flags flag
    WHERE flag.flag_key = 'STAY_VENUE_AUTHORING';
    IF NOT COALESCE(v_stay_authoring_enabled, false) THEN
      RAISE EXCEPTION 'stay_authoring_disabled';
    END IF;
  END IF;
  v_coordinate_precision := nullif(
    trim(coalesce(p_coordinate_precision, '')),
    ''
  );
  IF v_coordinate_precision IS NOT NULL
     AND v_coordinate_precision NOT IN ('exact', 'approximate') THEN
    v_coordinate_precision := NULL;
  END IF;
  -- issue #1564 — normalise each theme axis INDEPENDENTLY. A bad font must not
  -- discard a good colour: the axes inherit separately by design.
  v_theme_color := nullif(trim(coalesce(p_theme_color, '')), '');
  IF v_theme_color IS NOT NULL AND v_theme_color !~* '^#[0-9a-f]{6}$' THEN
    v_theme_color := NULL;
  END IF;
  v_theme_font := nullif(trim(coalesce(p_theme_font, '')), '');
  IF v_theme_font IS NOT NULL AND NOT public.issue_1023_is_theme_font(v_theme_font) THEN
    v_theme_font := NULL;
  END IF;
  v_theme_animation := nullif(trim(coalesce(p_theme_animation, '')), '');
  IF v_theme_animation IS NOT NULL AND v_theme_animation NOT IN (
    'none','confetti','fireworks','balloons','sparkles',
    'glitter_shower','snowfall','falling_petals','hearts','shimmer_reveal',
    -- issue #1023: the 20 new theme motion slugs
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'
  ) THEN
    v_theme_animation := NULL;
  END IF;
  v_google := nullif(trim(coalesce(p_google_place_id, '')), '');
  IF p_place_pool_id IS NOT NULL THEN
    SELECT p.google_place_id
    INTO v_pool_google
    FROM public.place_pool p
    WHERE p.id = p_place_pool_id AND p.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'place_pool_not_found';
    END IF;
    IF v_google IS NULL OR trim(v_pool_google) IS DISTINCT FROM v_google THEN
      RAISE EXCEPTION 'place_pool_google_place_id_mismatch';
    END IF;
  END IF;
  v_cover_url := nullif(trim(coalesce(p_cover_media_url, '')), '');
  v_cover_type := nullif(trim(coalesce(p_cover_media_type, '')), '');
  IF v_cover_type IS NOT NULL
     AND v_cover_type NOT IN ('image', 'video', 'gif') THEN
    RAISE EXCEPTION 'invalid_cover_media_type';
  END IF;
  IF v_cover_url IS NOT NULL AND v_cover_type IS NULL THEN
    RAISE EXCEPTION 'cover_media_type_required';
  END IF;
  IF v_cover_url IS NULL THEN
    v_cover_type := NULL;
  END IF;
  v_cover_poster := COALESCE(
    nullif(trim(coalesce(p_cover_media_poster_url, '')), ''),
    CASE WHEN v_cover_type = 'image' THEN v_cover_url END
  );
  PERFORM public.assert_cover_media_triplet(
    v_cover_url,
    v_cover_type,
    v_cover_poster
  );

  INSERT INTO public.venue_listings (
    brand_id,
    name,
    slug,
    address,
    google_place_id,
    place_pool_id,
    lat,
    lng,
    city,
    country_code,
    venue_category,
    contact_email,
    contact_phone,
    cover_media_url,
    cover_media_poster_url,
    cover_media_type,
    coordinate_precision,
    theme_color_override,
    theme_font_override,
    theme_animation_override,
    claim_status
  ) VALUES (
    p_brand_id,
    trim(p_name),
    trim(p_slug),
    nullif(trim(coalesce(p_address, '')), ''),
    v_google,
    p_place_pool_id,
    p_lat,
    p_lng,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_country_code, '')), ''),
    p_venue_category,
    nullif(trim(coalesce(p_contact_email, '')), ''),
    nullif(trim(coalesce(p_contact_phone, '')), ''),
    v_cover_url,
    v_cover_poster,
    v_cover_type,
    v_coordinate_precision,
    v_theme_color,
    v_theme_font,
    v_theme_animation,
    'pending_review'
  )
  RETURNING id INTO v_venue_id;

  FOR v_idx IN 0 .. 6 LOOP
    v_hour := p_hours -> v_idx;
    IF v_hour IS NULL THEN
      RAISE EXCEPTION 'missing_hour_index_%', v_idx;
    END IF;
    INSERT INTO public.brand_hours (
      brand_id,
      venue_id,
      weekday,
      open_time,
      close_time,
      is_closed
    ) VALUES (
      p_brand_id,
      v_venue_id,
      (v_hour ->> 'weekday')::smallint,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'open_time' IS NULL
          OR (v_hour ->> 'open_time') = '' THEN NULL
        ELSE (v_hour ->> 'open_time')::time
      END,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'close_time' IS NULL
          OR (v_hour ->> 'close_time') = '' THEN NULL
        ELSE (v_hour ->> 'close_time')::time
      END,
      coalesce((v_hour ->> 'is_closed')::boolean, false)
    );
  END LOOP;
  INSERT INTO public.brand_place_pipeline_state (
    brand_id,
    venue_id,
    place_pool_id,
    status,
    stage_status,
    readiness,
    coaching
  ) VALUES (
    p_brand_id,
    v_venue_id,
    p_place_pool_id,
    'draft',
    jsonb_build_object('tier1', 'created'),
    '{}'::jsonb,
    '[]'::jsonb
  )
  ON CONFLICT (venue_id) DO UPDATE
  SET place_pool_id = excluded.place_pool_id,
      status = excluded.status,
      stage_status =
        brand_place_pipeline_state.stage_status || excluded.stage_status,
      updated_at = now();
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_venue_id);
  RETURN v_venue_id;
END;
$function$
;


-- ---------------------------------------------------------------------------
-- E. views (new columns APPENDED; every existing column unchanged)
-- ---------------------------------------------------------------------------

-- Views keep production reloptions: an omitted WITH would reset them.
CREATE OR REPLACE VIEW public.business_public_brands_view AS
 SELECT id,
    slug,
    name,
    description,
    profile_photo_url,
    contact_email,
    contact_phone,
    social_links,
    custom_links,
    display_attendee_count,
    claim_status,
    address,
    cover_hue,
    cover_media_url,
    cover_media_type,
    profile_photo_type,
    theme_color,
    theme_font,
    theme_animation,
    created_at,
    updated_at,
    enquiries_enabled,
    issue_4111_brand_takes_enquiries(id) AS enquiries_available,
    theme_gradient
   FROM brands b
  WHERE deleted_at IS NULL;


CREATE OR REPLACE VIEW public.business_public_events_view WITH (security_invoker = false) AS
 SELECT e.id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    b.description AS brand_description,
    b.profile_photo_url AS brand_profile_photo_url,
    b.display_attendee_count AS brand_display_attendee_count,
    b.address AS brand_address,
    b.cover_media_url AS brand_cover_media_url,
    b.theme_color AS brand_theme_color,
    b.theme_font AS brand_theme_font,
    b.theme_animation AS brand_theme_animation,
    e.title,
    e.description,
    e.slug,
    e.event_type,
        CASE
            WHEN issue_2489_address_withheld(e.theme) THEN NULL::text
            ELSE e.location_text
        END AS location_text,
    e.online_url,
    e.is_online,
    e.is_recurring,
    e.is_multi_date,
    e.recurrence_rules,
    e.cover_media_url,
    e.cover_media_type,
    e.visibility,
    e.show_on_discover,
    e.status,
    e.published_at,
    e.timezone,
    e.created_at,
    e.updated_at,
    issue_2489_public_theme(e.theme) AS public_theme,
    e.theme_color_override,
    e.theme_font_override,
    e.theme_animation_override,
    e.currency,
    e.cover_media_provider,
    e.cover_media_source_url,
    e.cover_media_credit,
    e.cover_media_credit_url,
    e.cover_media_alt,
    ed.start_at AS master_start_at,
    ed.end_at AS master_end_at,
    ed.timezone AS master_timezone,
    ed.id AS master_event_date_id,
    e.city,
    e.party_types,
    e.vibe_tags,
    e.music_genres,
        CASE
            WHEN issue_2489_address_withheld(e.theme) THEN NULL::point
            ELSE e.location_geo
        END AS location_geo,
    COALESCE(e.pass_tax, b.default_pass_tax) AS pass_tax,
    COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee) AS pass_mingla_fee,
    COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region,
    b.pricing_currency,
    e.pricing_locked_at IS NOT NULL AS pricing_locked,
    ( SELECT d.display_price_cents
           FROM pg_public_event_display_prices(ARRAY[e.id]) d(event_id, display_price_cents, display_sale_price_cents, display_sale_ends_at)
          WHERE d.event_id = e.id) AS display_price_cents,
    e.rsvp_discoverable,
    e.rsvp_capacity,
    e.rsvp_allow_plus_ones,
    e.rsvp_plus_ones_max,
    e.rsvp_waitlist_enabled,
    e.rsvp_approval_mode,
        CASE
            WHEN issue_3827_private_guest_list(e.theme) THEN NULL::integer
            ELSE ( SELECT COALESCE(sum(1 + r.plus_count), 0::bigint)::integer AS "coalesce"
               FROM event_rsvps r
              WHERE r.event_id = e.id AND r.rsvp_status = 'going'::text AND r.approval_status = 'approved'::text)
        END AS rsvp_going_count,
    e.city_geo,
    e.rsvp_contribution_enabled,
    e.rsvp_contribution_suggested_cents,
    e.rsvp_contribution_min_cents,
    e.cover_media_gallery,
    sched.next_start_at,
    sched.next_end_at,
    sched.upcoming_count,
    sched.schedule_line,
    b.theme_gradient AS brand_theme_gradient,
    e.theme_gradient_override
   FROM events e
     JOIN brands b ON b.id = e.brand_id
     LEFT JOIN event_dates ed ON ed.event_id = e.id AND ed.is_master = true
     LEFT JOIN LATERAL ( SELECT n.start_at AS next_start_at,
            n.end_at AS next_end_at,
            COALESCE(c.upcoming_count, 0) AS upcoming_count,
                CASE
                    WHEN COALESCE(c.upcoming_count, 0) = 0 THEN NULL::text
                    WHEN c.upcoming_count = 1 THEN to_char((n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''::text), 'UTC'::text)), 'Dy DD Mon'::text)
                    ELSE format('%s · +%s more'::text, to_char((n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''::text), 'UTC'::text)), 'Dy DD Mon'::text), c.upcoming_count - 1)
                END AS schedule_line
           FROM ( SELECT count(*)::integer AS upcoming_count
                   FROM event_dates d
                  WHERE d.event_id = e.id AND d.end_at > now()) c
             LEFT JOIN LATERAL ( SELECT d.start_at,
                    d.end_at
                   FROM event_dates d
                  WHERE d.event_id = e.id AND d.end_at > now()
                  ORDER BY d.start_at, d.id
                 LIMIT 1) n ON true) sched ON true
  WHERE e.deleted_at IS NULL AND b.deleted_at IS NULL AND e.visibility = 'public'::text AND (e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])) AND NOT issue_1931_event_ordinary_read_blocked(e.id);


CREATE OR REPLACE VIEW public.business_management_events_view WITH (security_invoker = true) AS
 SELECT e.id,
    e.brand_id,
    e.created_by,
    b.slug AS brand_slug,
    b.name AS brand_name,
    b.profile_photo_url AS brand_profile_photo_url,
    b.display_attendee_count AS brand_display_attendee_count,
    e.title,
    e.description,
    e.slug,
    e.location_text,
    e.online_url,
    e.is_online,
    e.is_recurring,
    e.is_multi_date,
    e.recurrence_rules,
    e.cover_media_url,
    e.cover_media_type,
    e.visibility,
    e.show_on_discover,
    e.status,
    e.published_at,
    e.timezone,
    e.created_at,
    e.updated_at,
    e.theme - 'business_draft'::text AS management_theme,
    e.currency,
    e.cover_media_provider,
    e.cover_media_source_url,
    e.cover_media_credit,
    e.cover_media_credit_url,
    e.cover_media_alt,
    ed.start_at AS master_start_at,
    ed.end_at AS master_end_at,
    ed.timezone AS master_timezone,
    ed.id AS master_event_date_id,
    e.city,
    e.party_types,
    e.vibe_tags,
    e.music_genres,
    e.location_geo,
    e.theme_color_override,
    e.theme_font_override,
    e.theme_animation_override,
    e.cover_media_gallery,
    e.cover_media_poster_url,
    e.theme_gradient_override
   FROM events e
     JOIN brands b ON b.id = e.brand_id
     LEFT JOIN event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.deleted_at IS NULL AND b.deleted_at IS NULL AND (e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]));


-- ---------------------------------------------------------------------------
-- F. public payload RPCs (keys added beside the existing theme keys)
-- ---------------------------------------------------------------------------

-- pg_public_event_by_slug: adds themeGradientOverride and brand.themeGradient.
CREATE OR REPLACE FUNCTION public.pg_public_event_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$WITH issue_3281_original(payload) AS MATERIALIZED (
WITH issue_3872_original(payload) AS MATERIALIZED (

  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      e.theme_gradient_override,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      b.theme_gradient AS brand_theme_gradient,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'event'           -- standard ticketed ONLY (SPEC scope)
      AND e.visibility = 'public'::text
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
      AND COALESCE(tt.is_hidden, false) = false
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.location_geo::geometry),
          'lng', ST_X(ev.location_geo::geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.city_geo),
          'lng', ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverMediaAlt', ev.cover_media_alt,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'themeGradientOverride', ev.theme_gradient_override,
      'brand', json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation,
        'themeGradient', ev.brand_theme_gradient
      ),
      'tickets', COALESCE((
        SELECT json_agg(json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json)
    ) END
  FROM ev
)
SELECT public.issue_3872_enrich_public_ticket_payload(payload,'tickets','id',NULL) FROM issue_3872_original
)
SELECT public.issue_3281_attach_public_extras(payload) FROM issue_3281_original;$function$
;

-- pg_public_rsvp_by_slug: adds themeGradientOverride and brand.themeGradient.
CREATE OR REPLACE FUNCTION public.pg_public_rsvp_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$WITH issue_3872_original(payload) AS MATERIALIZED (

  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_alt,
      e.cover_media_provider,
      e.cover_media_credit,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      e.theme_gradient_override,
      -- RSVP host-control columns (ORCH-1150 mig 20261004000000).
      e.rsvp_capacity,
      e.rsvp_allow_plus_ones,
      e.rsvp_plus_ones_max,
      e.rsvp_waitlist_enabled,
      e.rsvp_approval_mode,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      -- issue #3827 going-box — read by the #3827 helpers only; never emitted.
      e.theme AS raw_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb). Default
      -- TRUE when absent so a legacy row never leaks the street (mirror the event RPC).
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      b.theme_gradient AS brand_theme_gradient,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'rsvp'            -- RSVP ONLY (SPEC scope)
      -- Unlisted (hidden) RSVPs open from their invite link, like #1929 did for
      -- ticketed events. Private stays closed: its access grants are not live (#2144).
      AND e.visibility IN ('public'::text, 'hidden'::text)
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      -- Same containment the ticketed exact-link reader and the public view apply.
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  going AS (
    -- Confirmed-going headcount: SUM(1 + plus_count) over going+approved rows.
    -- Byte-identical to submit_event_rsvp's capacity predicate (maybe excluded =
    -- cap-neutral, ORCH-1150).
    SELECT COALESCE(SUM(1 + r.plus_count), 0) AS going_count
      FROM public.event_rsvps r
      JOIN ev ON ev.id = r.event_id
     WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng}.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.location_geo::geometry),
          'lng', ST_X(ev.location_geo::geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.city_geo),
          'lng', ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverMediaAlt', ev.cover_media_alt,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'themeGradientOverride', ev.theme_gradient_override,
      'brand', json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation,
        'themeGradient', ev.brand_theme_gradient
      ),
      -- RSVP host-control block (REPLACES the event RPC's `tickets` aggregate).
      -- issue #3827 going-box — a private list withholds the count (NULL, never 0).
      'rsvpGoingCount', CASE WHEN public.issue_3827_private_guest_list(ev.raw_theme)
                             THEN NULL ELSE (SELECT going_count FROM going) END,
      'rsvpCapacity', ev.rsvp_capacity,
      'rsvpAllowPlusOnes', ev.rsvp_allow_plus_ones,
      'rsvpPlusOnesMax', ev.rsvp_plus_ones_max,
      'rsvpWaitlistEnabled', ev.rsvp_waitlist_enabled,
      'rsvpApprovalMode', ev.rsvp_approval_mode,
      -- The same event as ONE business_public_events_view-shaped row (every view
      -- column, same names, same values, the view's own address withholding), so the
      -- buyer-web / Business-app and Explorer row mappers that already render public
      -- RSVPs from that view render an unlisted RSVP from its link unchanged. Re-read
      -- by the id `ev` already admitted; it adds no visibility of its own.
      'publicEventRow', (
        SELECT to_json(r)
        FROM (
          SELECT e.id,
            e.brand_id,
            b.slug AS brand_slug,
            b.name AS brand_name,
            b.description AS brand_description,
            b.profile_photo_url AS brand_profile_photo_url,
            b.display_attendee_count AS brand_display_attendee_count,
            b.address AS brand_address,
            b.cover_media_url AS brand_cover_media_url,
            b.theme_color AS brand_theme_color,
            b.theme_font AS brand_theme_font,
            b.theme_animation AS brand_theme_animation,
            e.title,
            e.description,
            e.slug,
            e.event_type,
            CASE
              WHEN public.issue_2489_address_withheld(e.theme) THEN NULL::text
              ELSE e.location_text
            END AS location_text,
            e.online_url,
            e.is_online,
            e.is_recurring,
            e.is_multi_date,
            e.recurrence_rules,
            e.cover_media_url,
            e.cover_media_type,
            e.visibility,
            e.show_on_discover,
            e.status,
            e.published_at,
            e.timezone,
            e.created_at,
            e.updated_at,
            public.issue_2489_public_theme(e.theme) AS public_theme,
            e.theme_color_override,
            e.theme_font_override,
            e.theme_animation_override,
            e.currency,
            e.cover_media_provider,
            e.cover_media_source_url,
            e.cover_media_credit,
            e.cover_media_credit_url,
            e.cover_media_alt,
            ed.start_at AS master_start_at,
            ed.end_at AS master_end_at,
            ed.timezone AS master_timezone,
            ed.id AS master_event_date_id,
            e.city,
            e.party_types,
            e.vibe_tags,
            e.music_genres,
            CASE
              WHEN public.issue_2489_address_withheld(e.theme) THEN NULL::point
              ELSE e.location_geo
            END AS location_geo,
            COALESCE(e.pass_tax, b.default_pass_tax) AS pass_tax,
            COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee) AS pass_mingla_fee,
            COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
            b.pricing_region,
            b.pricing_currency,
            e.pricing_locked_at IS NOT NULL AS pricing_locked,
            ( SELECT public.compute_all_in_cents(min(tt.price_cents),
                       COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
                       COALESCE(e.pass_service_fee, b.default_pass_service_fee),
                       ( SELECT rt.effective_take_rate_bps
                           FROM public.resolve_effective_take_rate_bps(b.id) rt(effective_take_rate_bps, take_rate_source)))
                FROM public.ticket_types tt
               WHERE tt.event_id = e.id AND tt.price_cents > 0 AND tt.deleted_at IS NULL) AS display_price_cents,
            e.rsvp_discoverable,
            e.rsvp_capacity,
            e.rsvp_allow_plus_ones,
            e.rsvp_plus_ones_max,
            e.rsvp_waitlist_enabled,
            e.rsvp_approval_mode,
            -- issue #3827 going-box — NULL when the guest list is private.
            CASE WHEN public.issue_3827_private_guest_list(e.theme) THEN NULL::integer
            ELSE ( SELECT COALESCE(sum(1 + rs.plus_count), 0::bigint)::integer
                FROM public.event_rsvps rs
               WHERE rs.event_id = e.id AND rs.rsvp_status = 'going'::text AND rs.approval_status = 'approved'::text) END AS rsvp_going_count,
            e.city_geo,
            e.rsvp_contribution_enabled,
            e.rsvp_contribution_suggested_cents,
            e.rsvp_contribution_min_cents,
            e.cover_media_gallery,
            sched.next_start_at,
            sched.next_end_at,
            sched.upcoming_count,
            sched.schedule_line,
            b.theme_gradient AS brand_theme_gradient,
            e.theme_gradient_override
          FROM public.events e
          JOIN public.brands b ON b.id = e.brand_id
          LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
          LEFT JOIN LATERAL (
            SELECT
              n.start_at AS next_start_at,
              n.end_at AS next_end_at,
              COALESCE(c.upcoming_count, 0) AS upcoming_count,
              CASE
                WHEN COALESCE(c.upcoming_count, 0) = 0 THEN NULL
                WHEN c.upcoming_count = 1 THEN to_char(
                  n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''), 'UTC'), 'Dy DD Mon')
                ELSE format(
                  '%s · +%s more',
                  to_char(n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''), 'UTC'), 'Dy DD Mon'),
                  c.upcoming_count - 1)
              END AS schedule_line
            FROM (
              SELECT count(*)::integer AS upcoming_count
                FROM public.event_dates d
               WHERE d.event_id = e.id AND d.end_at > now()
            ) c
            LEFT JOIN LATERAL (
              SELECT d.start_at, d.end_at
                FROM public.event_dates d
               WHERE d.event_id = e.id AND d.end_at > now()
               ORDER BY d.start_at, d.id
               LIMIT 1
            ) n ON true
          ) sched ON true
          WHERE e.id = ev.id
        ) r
      )
    ) END
  FROM ev
)
SELECT public.issue_3872_enrich_rsvp_payload(payload) FROM issue_3872_original;$function$
;

-- pg_public_experience_by_slug: adds themeGradientOverride and brand.themeGradient.
CREATE OR REPLACE FUNCTION public.pg_public_experience_by_slug(p_brand_slug text, p_experience_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$WITH issue_3872_original(payload) AS MATERIALIZED (

  WITH ex AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug                AS event_slug,
      e.status,
      e.visibility,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.is_recurring,
      e.is_multi_date,
      e.recurrence_rules,
      COALESCE(e.capacity_scope, 'total') AS capacity_scope,
      COALESCE(e.booking_spacing_minutes, 30) AS booking_spacing_minutes,
      COALESCE(e.min_notice_minutes, 120) AS min_notice_minutes,
      e.experience_intents,
      e.pass_mingla_fee,
      e.pass_service_fee,
      e.theme               AS public_theme,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      e.theme_gradient_override,
      e.refund_policy,
      -- hideAddressUntilTicket lives in theme.business_event (jsonb); default TRUE
      -- for safety (mirror the service + venue mapper fail-closed semantics).
      public.issue_2489_address_withheld(e.theme) AS hide_address,
      b.id                  AS brand_id_b,
      b.slug                AS brand_slug,
      b.name                AS brand_name,
      b.description         AS brand_description,
      b.cover_media_url     AS brand_cover_media_url,
      b.cover_media_type    AS brand_cover_media_type,
      b.cover_hue           AS brand_cover_hue,
      b.theme_color         AS brand_theme_color,
      b.theme_font          AS brand_theme_font,
      b.theme_animation     AS brand_theme_animation,
      b.theme_gradient      AS brand_theme_gradient,
      (b.claim_status = 'verified') AS brand_is_verified
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    WHERE b.slug = p_brand_slug
      AND e.slug = p_experience_slug
      AND e.event_type = 'experience'           -- experience ONLY
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      -- issue #2117 -- the offering visibility rule is expressed ONLY through
      -- the Offering Visibility Gate. Do NOT write it locally here or anywhere
      -- else. The e.status predicate ABOVE deliberately stays local and
      -- verbatim (A-4.2): this reader admits four statuses where its family
      -- sibling admits two.
      -- NOTE: this reader EMITS the offering's own visibility value into its
      -- response. Before #2117 it did so while filtering on nothing. The gate
      -- below is what makes that emission safe.
      AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')
    LIMIT 1
  ),
  -- the ONE sellable ticket (lowest display_order, non-hidden, not deleted).
  tk AS (
    SELECT
      tt.id,
      tt.name,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.available_online,
      tt.price_basis,
      tt.block_minutes,
      tt.min_blocks,
      tt.max_blocks,
      tt.group_max,

      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ex.pass_mingla_fee,
               ex.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ex.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining (GREATEST(total - sold, 0)); NULL for unlimited. Sold formula
      -- IDENTICAL to pg_public_ticket_types_remaining (ORCH-0946).
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        -- Scoped inventory lives on day/slot chips; never lifetime-disable Reserve.
        WHEN ex.capacity_scope IN ('per_day', 'per_start') THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ex ON ex.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND COALESCE(tt.is_hidden, false) = false
    ORDER BY tt.display_order ASC NULLS LAST, tt.created_at ASC
    LIMIT 1
  )
  SELECT
    CASE WHEN ex.id IS NULL THEN NULL ELSE json_build_object(
      'id', ex.id,
      'brandId', ex.brand_id,
      'brandSlug', ex.brand_slug,
      'experienceSlug', ex.event_slug,
      'title', ex.title,
      'description', ex.description,
      'status', ex.status,
      'visibility', ex.visibility,
      'timezone', COALESCE(ex.timezone, 'UTC'),
      'currency', COALESCE(ex.currency, 'usd'),
      'coverMediaUrl', ex.cover_media_url,
      'coverMediaType', ex.cover_media_type,
      'coverMediaAlt', ex.cover_media_alt,
      'coverGallery', COALESCE(ex.cover_media_gallery, '[]'::jsonb),
      'venueText', COALESCE(
        NULLIF((ex.public_theme #>> '{experience_meta,venue_text}'), ''),
        (SELECT s.address FROM public.experience_stops s
          WHERE s.event_id = ex.id ORDER BY s.stop_order ASC LIMIT 1)
      ),
      'isRecurring', COALESCE(ex.is_recurring, false),
      'isMultiDate', COALESCE(ex.is_multi_date, false),
      'recurrenceRules', ex.recurrence_rules,
      'intents', COALESCE(to_json(ex.experience_intents), '[]'::json),
      'hideAddressUntilTicket', ex.hide_address,
      'themeColorOverride', ex.theme_color_override,
      'themeFontOverride', ex.theme_font_override,
      'themeAnimationOverride', ex.theme_animation_override,
      'themeGradientOverride', ex.theme_gradient_override,
      'brand', json_build_object(
        'id', ex.brand_id_b,
        'slug', ex.brand_slug,
        'name', ex.brand_name,
        'bio', ex.brand_description,
        'coverMediaUrl', ex.brand_cover_media_url,
        'coverMediaType', ex.brand_cover_media_type,
        'coverHue', ex.brand_cover_hue,
        'verified', COALESCE(ex.brand_is_verified, false),
        'themeColor', ex.brand_theme_color,
        'themeFont', ex.brand_theme_font,
        'themeAnimation', ex.brand_theme_animation,
        'themeGradient', ex.brand_theme_gradient
      ),
      -- itinerary stops — ADDRESS-PRIVACY-AWARE (NULL street/lat/lng when hidden).
      'stops', COALESCE((
        SELECT json_agg(json_build_object(
          'id', s.id,
          'stopOrder', s.stop_order,
          'placeName', s.place_name,
          'address', CASE WHEN ex.hide_address THEN NULL ELSE NULLIF(s.address, '') END,
          'description', NULLIF(s.ai_description, ''),
          'startTime', s.start_time,
          -- issue #3281 R3 — minutes from guest start (open-hours); null → clock startTime
          'startOffsetMinutes', s.start_offset_minutes,
          'lat', CASE WHEN ex.hide_address THEN NULL ELSE s.lat END,
          'lng', CASE WHEN ex.hide_address THEN NULL ELSE s.lng END,
          'imageUrls', COALESCE(to_json(s.image_urls), '[]'::json)
        ) ORDER BY s.stop_order ASC)
        FROM public.experience_stops s
        WHERE s.event_id = ex.id
      ), '[]'::json),
      -- the ONE sellable ticket (per-stop summed all-in, ORCH-1151).
      'ticket', (
        SELECT CASE WHEN tk.id IS NULL THEN NULL ELSE json_build_object(
          'ticketTypeId', tk.id,
          'name', tk.name,
          'priceCents', COALESCE(tk.price_cents, 0),
          'allInCents', tk.all_in_cents,
          'currency', COALESCE(tk.currency, ex.currency, 'usd'),
          'quantityTotal', tk.quantity_total,
          'isUnlimited', COALESCE(tk.is_unlimited, false),
          'isFree', COALESCE(tk.is_free, false) OR COALESCE(tk.price_cents, 0) = 0,
          'ticketsRemaining', tk.remaining,
          'availableOnline', COALESCE(tk.available_online, false),
          'priceBasis', COALESCE(tk.price_basis, 'person'),
          'blockMinutes', tk.block_minutes,
          'minBlocks', tk.min_blocks,
          'maxBlocks', tk.max_blocks,
          'groupMax', tk.group_max
        ) END
        FROM tk
      ),
      -- #3281 R2: all sellable options (ticket = default / first by display_order)
      'options', COALESCE((
        SELECT json_agg(json_build_object(
          'ticketTypeId', o.id,
          'name', o.name,
          'priceCents', COALESCE(o.price_cents, 0),
          'allInCents', CASE
            WHEN COALESCE(o.is_free, false) OR COALESCE(o.price_cents, 0) = 0 THEN 0
            ELSE public.compute_all_in_cents(
                   o.price_cents,
                   ex.pass_mingla_fee,
                   ex.pass_service_fee,
                   (SELECT r.effective_take_rate_bps
                      FROM public.resolve_effective_take_rate_bps(ex.brand_id) AS r)
                 )
          END,
          'currency', COALESCE(o.currency, ex.currency, 'usd'),
          'quantityTotal', o.quantity_total,
          'isUnlimited', COALESCE(o.is_unlimited, false),
          'isFree', COALESCE(o.is_free, false) OR COALESCE(o.price_cents, 0) = 0,
          'ticketsRemaining', CASE
            WHEN COALESCE(o.is_unlimited, false) THEN NULL
            WHEN o.quantity_total IS NULL THEN NULL
            WHEN ex.capacity_scope IN ('per_day', 'per_start') THEN NULL
            ELSE GREATEST(
              0,
              o.quantity_total - (
                SELECT COUNT(*)::integer FROM public.tickets t
                 WHERE t.ticket_type_id = o.id
                   AND t.status IN ('valid','used','transferred')
              )
            )
          END,
          'availableOnline', COALESCE(o.available_online, false),
          'priceBasis', COALESCE(o.price_basis, 'person'),
          'blockMinutes', o.block_minutes,
          'minBlocks', o.min_blocks,
          'maxBlocks', o.max_blocks,
          'groupMax', o.group_max
        ) ORDER BY o.display_order, o.created_at)
        FROM public.ticket_types o
        WHERE o.event_id = ex.id
          AND o.deleted_at IS NULL
          AND COALESCE(o.is_hidden, false) IS NOT TRUE
          AND COALESCE(o.is_disabled, false) IS NOT TRUE
      ), '[]'::json),
      -- bookable occurrences (event_dates) with per-occurrence remaining stamped
      -- from the ONE ticket's event-level remaining (Q2: no per-occurrence cap).
      'dates', COALESCE((
        SELECT json_agg(json_build_object(
          'id', d.id,
          'startAt', d.start_at,
          'endAt', d.end_at,
          'timezone', d.timezone,
          'isMaster', COALESCE(d.is_master, false),
          -- issue #3281 R3 — per_day/per_start day chips use occurrence taken;
          -- total keeps the event-level remaining (legacy).
          'ticketsRemaining', CASE
            WHEN (SELECT tk.is_unlimited FROM tk) THEN NULL
            WHEN (SELECT tk.quantity_total FROM tk) IS NULL THEN NULL
            WHEN ex.capacity_scope = 'per_day' THEN GREATEST(
              0,
              (SELECT tk.quantity_total FROM tk)
                - public.issue_3313_ticket_type_occurrence_taken(
                    (SELECT tk.id FROM tk), d.id)
            )
            WHEN ex.capacity_scope = 'per_start' THEN GREATEST(
              0,
              (SELECT tk.quantity_total FROM tk)
                - COALESCE((
                    SELECT MIN(public.issue_3281_ticket_type_slot_taken(
                      (SELECT tk.id FROM tk),
                      d.id,
                      gs,
                      gs + make_interval(mins => COALESCE(ex.booking_spacing_minutes, 30)),
                      NULL
                    ))
                    FROM generate_series(
                      d.start_at,
                      d.end_at - interval '1 microsecond',
                      make_interval(mins => COALESCE(ex.booking_spacing_minutes, 30))
                    ) AS gs
                    WHERE gs >= now() + make_interval(mins => COALESCE(ex.min_notice_minutes, 120))
                  ), 0)
            )
            ELSE (SELECT tk.remaining FROM tk)
          END
        ) ORDER BY d.start_at ASC)
        FROM public.event_dates d
        WHERE d.event_id = ex.id
      ), '[]'::json),
      -- bookable: free → always true; paid → pg_brand_can_collect.
      'bookable', CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM tk
          WHERE tk.available_online = true
            AND COALESCE(tk.price_cents, 0) > 0
        ) THEN true
        ELSE public.pg_brand_can_collect(ex.brand_id)
      END,
      'capacityScope', ex.capacity_scope,
      'spacingMinutes', ex.booking_spacing_minutes,
      'minNoticeMinutes', ex.min_notice_minutes,
      'refundPolicy', ex.refund_policy
    ) END
  FROM ex
)
SELECT public.issue_3872_enrich_public_ticket_payload(payload,'options','ticketTypeId','ticket') FROM issue_3872_original;$function$
;

-- pg_public_trip_by_slug: adds themeGradientOverride and brand.themeGradient.
CREATE OR REPLACE FUNCTION public.pg_public_trip_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tr AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.status,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.departure_text,
      e.destination_text,
      e.refund_policy,
      e.booking_deadline,
      e.bookings_closed,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      e.theme_gradient_override,
      e.theme               AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      b.id                  AS brand_id_b,
      b.slug                AS brand_slug,
      b.name                AS brand_name,
      b.description         AS brand_description,
      b.cover_media_url     AS brand_cover_media_url,
      b.cover_media_type    AS brand_cover_media_type,
      b.cover_hue           AS brand_cover_hue,
      b.theme_color         AS brand_theme_color,
      b.theme_font          AS brand_theme_font,
      b.theme_animation     AS brand_theme_animation,
      b.theme_gradient      AS brand_theme_gradient,
      (b.claim_status = 'verified') AS brand_is_verified
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'trip'             -- trip ONLY (Leg A scope)
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text])
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      -- issue #2117 -- the offering visibility rule is expressed ONLY through
      -- the Offering Visibility Gate. Do NOT write it locally here or anywhere
      -- else; a second copy is a violation of
      -- I-PROPOSED-2117-ONE-OFFERING-VISIBILITY-GATE. The e.status predicate
      -- ABOVE deliberately stays local and verbatim (A-4.2): this reader admits
      -- two statuses where its family sibling admits four, and one per-audience
      -- status set cannot preserve both.
      AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')
    LIMIT 1
  ),
  tiers AS (
    SELECT
      tpt.id,
      tpt.ticket_type_id,
      tpt.tier_name,
      tpt.tier_metadata,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      -- issue #3801 -- the authored package order and its tie-breaker, read
      -- only to sort the `tiers` array below. Neither is returned.
      tt.display_order,
      tt.created_at,
      -- remaining capacity (NULL for unlimited / no cap); sold formula IDENTICAL
      -- to pg_public_ticket_types_remaining (ORCH-0946).
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.trip_pricing_tiers tpt
    JOIN tr ON tr.id = tpt.event_id
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE tt.deleted_at IS NULL
      AND COALESCE(tt.is_hidden, false) = false
  )
  SELECT
    CASE WHEN tr.id IS NULL THEN NULL ELSE json_build_object(
      'id', tr.id,
      'brandId', tr.brand_id,
      'brandSlug', tr.brand_slug,
      'tripSlug', tr.event_slug,
      'title', tr.title,
      'description', tr.description,
      'status', tr.status,
      'timezone', tr.timezone,
      -- master dates (event_dates) first, theme business_trip mirror fallback.
      'startAt', COALESCE(
        tr.master_start_at::text,
        NULLIF((tr.public_theme #>> '{business_trip,startAt}'), '')
      ),
      'endAt', COALESCE(
        tr.master_end_at::text,
        NULLIF((tr.public_theme #>> '{business_trip,endAt}'), '')
      ),
      -- route legs: canonical column first, theme mirror fallback (rule 9 — null
      -- when neither present → that leg/pill is omitted by the body).
      'departureText', COALESCE(
        NULLIF(tr.departure_text, ''),
        NULLIF((tr.public_theme #>> '{business_trip,departureLocationText}'), '')
      ),
      'destinationText', COALESCE(
        NULLIF(tr.destination_text, ''),
        NULLIF((tr.public_theme #>> '{business_trip,destinationLocationText}'), '')
      ),
      -- destination lat/lng (theme mirror only today). The consumer payload lacks
      -- these → its §11 map silently omitted; the RPC closes that parity gap.
      'destinationLat', (tr.public_theme #>> '{business_trip,destinationLat}')::float8,
      'destinationLng', (tr.public_theme #>> '{business_trip,destinationLng}')::float8,
      'departureLat', (tr.public_theme #>> '{business_trip,departureLat}')::float8,
      'departureLng', (tr.public_theme #>> '{business_trip,departureLng}')::float8,
      'currency', COALESCE(tr.currency, 'usd'),
      'coverMediaUrl', tr.cover_media_url,
      'coverMediaType', tr.cover_media_type,
      'coverMediaAlt', tr.cover_media_alt,
      'coverGallery', COALESCE(tr.cover_media_gallery, '[]'::jsonb),
      'refundPolicy', tr.refund_policy,
      'bookingDeadline', tr.booking_deadline,
      'bookingsClosed', COALESCE(tr.bookings_closed, false),
      'installmentCapabilityAvailable', public.pg_trip_installments_supported(tr.id),
      'themeColorOverride', tr.theme_color_override,
      'themeFontOverride', tr.theme_font_override,
      'themeAnimationOverride', tr.theme_animation_override,
      'themeGradientOverride', tr.theme_gradient_override,
      'brand', json_build_object(
        'id', tr.brand_id_b,
        'slug', tr.brand_slug,
        'name', tr.brand_name,
        'bio', tr.brand_description,
        'coverMediaUrl', tr.brand_cover_media_url,
        'coverMediaType', tr.brand_cover_media_type,
        'coverHue', tr.brand_cover_hue,
        'verified', COALESCE(tr.brand_is_verified, false),
        'themeColor', tr.brand_theme_color,
        'themeFont', tr.brand_theme_font,
        'themeAnimation', tr.brand_theme_animation,
        'themeGradient', tr.brand_theme_gradient
      ),
      'days', COALESCE((
        SELECT json_agg(json_build_object(
          'id', d.id,
          'ordinal', d.ordinal,
          'title', d.title,
          'narrative', d.narrative,
          'date', d.date,
          'stops', COALESCE(d.stops, '[]'::jsonb),
          'media', COALESCE(d.media, '[]'::jsonb)
        ) ORDER BY d.ordinal ASC)
        FROM public.trip_days d
        WHERE d.event_id = tr.id
      ), '[]'::json),
      'inclusions', COALESCE((
        SELECT json_agg(json_build_object(
          'id', i.id,
          'kind', i.kind,
          'item', i.item,
          'ordinal', i.ordinal
        ) ORDER BY i.kind ASC, i.ordinal ASC)
        FROM public.trip_inclusions i
        WHERE i.event_id = tr.id
      ), '[]'::json),
      'tiers', COALESCE((
        SELECT json_agg(json_build_object(
          'id', tiers.id,
          'ticketTypeId', tiers.ticket_type_id,
          'tierName', tiers.tier_name,
          'tierMetadata', CASE
        WHEN public.pg_trip_installments_supported(tr.id)
          THEN COALESCE(tiers.tier_metadata, '{}'::jsonb)
        ELSE COALESCE(tiers.tier_metadata, '{}'::jsonb) - 'installments'
      END,
          'priceCents', COALESCE(tiers.price_cents, 0),
          'currency', COALESCE(tiers.currency, ''),
          'quantityTotal', tiers.quantity_total,
          'ticketsRemaining', tiers.remaining,
          'isUnlimited', COALESCE(tiers.is_unlimited, false),
          'isFree', COALESCE(tiers.is_free, false),
          'installments', CASE
        WHEN public.pg_trip_installments_supported(tr.id)
          THEN tiers.tier_metadata -> 'installments'
        ELSE NULL
      END
        -- issue #3801 -- packages come back in the order the host authored
        -- them. Without an ORDER BY the array followed the physical row order
        -- of trip_pricing_tiers.
        ) ORDER BY tiers.display_order ASC NULLS LAST, tiers.created_at ASC, tiers.id ASC)
        FROM tiers
      ), '[]'::json)
    ) END
  FROM tr;
$function$
;

-- pg_ticket_link_resolve: adds themeGradient from the same level as themeColor.
CREATE OR REPLACE FUNCTION public.pg_ticket_link_resolve(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_link public.ticket_type_links;
  v_state text;
  v_result jsonb;
  v_remaining integer;
  v_active boolean;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  v_state := public.issue_3827_link_state(v_link, now());

  SELECT CASE
    WHEN COALESCE(tt.is_unlimited, false) OR tt.quantity_total IS NULL THEN NULL
    ELSE GREATEST(tt.quantity_total - COALESCE(tt.sold_count, 0) - COALESCE((
      SELECT sum(i.quantity)::integer FROM public.ticket_checkout_session_items i
      JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
      WHERE i.ticket_type_id = tt.id AND s.expires_at > now()
        AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
    ), 0), 0) END INTO v_remaining
  FROM public.ticket_types tt WHERE tt.id = v_link.ticket_type_id;

  -- The state the page shows. Only an active link learns the cover media
  -- and the date-choice settings.
  v_active := v_state = 'active' AND v_remaining IS DISTINCT FROM 0;

  SELECT jsonb_build_object(
    'state', CASE WHEN v_state = 'active' AND v_remaining = 0 THEN 'sold_out' ELSE v_state END,
    'kind', v_link.kind,
    'linkId', v_link.id,
    'eventId', e.id,
    'guestsMax', GREATEST(v_link.party_max - 1, 0),
    'approvalRequired', v_link.approval_mode = 'host',
    'eventDateId', v_link.event_date_id,
    'hideRemaining', COALESCE((e.theme #>> '{business_event,settings,hideRemainingCount}')::boolean, false),
    'event', jsonb_build_object(
      'title', e.title, 'brandName', b.name, 'brandSlug', b.slug,
      'eventSlug', e.slug, 'visibility', e.visibility,
      'coverUrl', e.cover_media_url, 'startAt', ed.start_at,
      'endAt', ed.end_at, 'timezone', COALESCE(ed.timezone, e.timezone),
      'venueLine', CASE WHEN public.issue_2489_address_withheld(e.theme)
        THEN NULLIF(e.theme #>> '{business_event,location,venueName}', '')
        ELSE COALESCE(NULLIF(e.theme #>> '{business_event,location,venueName}', ''), e.location_text) END,
      'currency', COALESCE(b.pricing_currency, tt.currency, e.currency, 'GBP'),
      'themeColor', COALESCE(e.theme_color_override, b.theme_color),
      -- issue #1023: the gradient follows the colour's level as one unit.
      'themeGradient', CASE WHEN e.theme_color_override IS NOT NULL
        THEN e.theme_gradient_override ELSE b.theme_gradient END,
      'themeFont', COALESCE(e.theme_font_override, b.theme_font)
    ) || CASE WHEN v_active THEN jsonb_build_object(
      'coverMediaType', e.cover_media_type,
      'coverPosterUrl', e.cover_media_poster_url
    ) ELSE '{}'::jsonb END,
    'tier', CASE WHEN v_link.kind = 'guest_list'
      THEN jsonb_build_object('id', tt.id, 'name', tt.name)
      ELSE jsonb_build_object(
        'id', tt.id, 'name', tt.name, 'description', tt.description,
        'priceCents', tt.price_cents,
        'allInCents', CASE WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
          ELSE public.compute_all_in_cents(
            tt.price_cents, COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
            COALESCE(e.pass_service_fee, b.default_pass_service_fee),
            (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
          ) END,
        'currency', COALESCE(b.pricing_currency, tt.currency, e.currency, 'GBP'),
        'minPurchaseQty', COALESCE(tt.min_purchase_qty, 1),
        'maxPurchaseQty', tt.max_purchase_qty,
        'isUnlimited', COALESCE(tt.is_unlimited, false),
        'waitlistEnabled', COALESCE(tt.waitlist_enabled, false),
        'remaining', CASE WHEN COALESCE((e.theme #>> '{business_event,settings,hideRemainingCount}')::boolean, false)
          THEN NULL ELSE v_remaining END,
        'saleStartAt', tt.sale_start_at, 'saleEndAt', tt.sale_end_at
      ) || COALESCE(public.issue_3872_ticket_sale_json(tt.id),'{}'::jsonb)
        || COALESCE(public.issue_3281_ticket_dates_json(tt.id),'{}'::jsonb) END,
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'startAt', d.start_at, 'endAt', d.end_at, 'timezone', d.timezone
      ) ORDER BY d.start_at)
      FROM public.event_dates d
      WHERE d.event_id = e.id AND d.end_at > now()
        AND v_link.event_date_id IS NULL
        AND COALESCE((public.issue_3313_event_day_choice(e.id) ->> 'requiresChoice')::boolean, false)
    ), '[]'::jsonb)
  ) || CASE WHEN v_active THEN jsonb_build_object(
    'multiDatePricingMode', COALESCE(e.multi_date_pricing_mode, 'per_day'),
    'allDaysPass', COALESCE(e.is_multi_date, false) AND NOT COALESCE(e.is_recurring, false)
      AND COALESCE(e.multi_date_pricing_mode, 'per_day') = 'all_days'
  ) ELSE '{}'::jsonb END INTO v_result
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  JOIN public.ticket_types tt ON tt.id = v_link.ticket_type_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.id = v_link.event_id;
  RETURN COALESCE(v_result, jsonb_build_object('state', 'not_found'));
END;
$function$
;


COMMIT;

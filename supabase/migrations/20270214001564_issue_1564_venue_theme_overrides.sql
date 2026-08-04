-- ===========================================================================
-- issue #1564 [venue-colours], step 8 of 8 under #1550 — a venue can carry its
-- OWN colour, font and motion instead of being forced to wear its brand's.
-- ---------------------------------------------------------------------------
-- THE DEFECT. `venue_public_view` selects `b.theme_color, b.theme_font,
-- b.theme_animation` — from `b`, the BRANDS table
-- (`20261130000003_orch_1255_claim_rpcs_public_views.sql:996`, carried forward
-- unchanged by `20261221000000` and `20270213001562`). A group running a
-- fine-dining room and a beach bar under one brand therefore gets two
-- byte-identical pages, and no amount of client work can change that: the venue
-- has nowhere to store a different answer.
--
-- Every OTHER offering in the product already carries the override trio. This
-- migration gives a venue the same three columns, and only those three:
--   venue_listings.theme_color_override
--   venue_listings.theme_font_override
--   venue_listings.theme_animation_override
-- Same names, same types, same CHECK vocabularies as
-- `events.theme_*_override` (`20260729000002_orch_0964_brand_event_theme_columns.sql`)
-- — a venue's palette is exactly as big an idea as an event's, no bigger.
--
-- ---------------------------------------------------------------------------
-- WHERE OVERRIDE-VS-INHERIT IS RESOLVED — HERE, IN THE VIEW, ONCE
-- ---------------------------------------------------------------------------
-- The two public readers (`mingla-business/src/services/publicEventsService.ts`
-- and `app-mobile/src/services/publicVenueService.ts`) each map the view's
-- three `theme_*` columns BY NAME into one `ThemeInput`. If resolution lived in
-- the clients, that would be TWO implementations of one rule, in two languages
-- of the same repo, free to drift — and the buyer web and the consumer app
-- would eventually disagree about what colour a restaurant is.
--
-- So the SELECT list resolves it, PER AXIS, and the column names, types,
-- ordinals and count are all unchanged:
--   COALESCE(v.theme_color_override,     b.theme_color)     AS theme_color
--   COALESCE(v.theme_font_override,      b.theme_font)      AS theme_font
--   COALESCE(v.theme_animation_override, b.theme_animation) AS theme_animation
--
-- PER-AXIS is the whole point and it matches `resolveTheme`
-- (`packages/offering-rendering/themeResolver.ts`) exactly: a venue that
-- overrides only its colour keeps the brand's font and the brand's motion.
-- `COALESCE` and `resolveTheme` agree by construction because the CHECK
-- constraints below admit exactly the values `isThemeColor` / `isThemeFontSlug`
-- / `isThemeAnimationSlug` accept — an override can never be a value the client
-- would then reject and silently fall through to the MINGLA default, skipping
-- the brand. (`issue1564VenueThemeResolution.happy.test.ts` asserts the two
-- agree over the whole matrix rather than trusting that sentence.)
--
-- NOT SET IS THE DEFAULT PATH. Every venue in the pool today has three NULLs,
-- so every venue keeps rendering its brand's theme byte-for-byte. The feature
-- ships silent.
--
-- ---------------------------------------------------------------------------
-- WHY `CREATE OR REPLACE` AND NOT `DROP` + `CREATE`
-- ---------------------------------------------------------------------------
-- Identical reasoning to #1562, one migration ago, and re-verified here.
-- `ad_public_stay_destinations_view` (#1431) SELECTs from this view: a bare
-- `DROP` fails and a `DROP … CASCADE` silently deletes the ad-attribution view.
-- This change neither adds, removes nor reorders a column — it only changes
-- three expressions — which `CREATE OR REPLACE VIEW` supports directly as long
-- as name, type and position hold. They do: 29 columns before, 29 after,
-- `theme_color` at ordinal 19, `theme_font` 20, `theme_animation` 21, and
-- `iana_timezone` still last at 29.
--
-- ANON SAFETY — I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE. Unchanged.
-- `WHERE v.claim_status = 'verified'` still scopes the rows, so
-- pending_review/rejected/suspended/revoked venues stay INVISIBLE. No grant is
-- widened, no new table is joined, and the three columns published here are the
-- same three that were already published — a hex string and two slugs, from a
-- table the view already reads.
--
-- ---------------------------------------------------------------------------
-- THE CREATE RPC CARRIES THE THREE VALUES
-- ---------------------------------------------------------------------------
-- `venue_listings` has NO client INSERT/UPDATE policy by design
-- (`20261130000000:COMMENT ON TABLE` — "Writes are RPC/service-role ONLY").
-- Both authoring paths (create s4/s9 and claim c4/c9) end in
-- `biz_create_venue_listing`, so that is where the three values enter. Three
-- new params, APPENDED with defaults, exactly the shape #1363 used for
-- `p_coordinate_precision`; `DROP FUNCTION` first because Postgres cannot
-- `CREATE OR REPLACE` a changed argument list. An 18-argument named call from
-- an older deployed client still resolves — PostgREST binds by name and the
-- three new params default to '' → NULL → inherit.
--
-- FAIL-SOFT, like `p_coordinate_precision`: an unrecognised font/motion slug or
-- a malformed hex is normalised to NULL (inherit the brand) rather than raised.
-- A stale or corrupted client must never be able to block a venue submission
-- over a colour. The CHECK constraints below are the real guard; this
-- normalisation just means the RPC never trips them.
--
-- Additive-only. No data is written. No existing column changes type or
-- nullability. No grant is widened. MONOTONIC VERSION 20270214001564 —
-- strictly above the current max (20270213001562) across this worktree and
-- every sibling under ~/Desktop/mingla-orchs/*/supabase/migrations/.
--
-- NOT APPLIED TO PRODUCTION by this branch. Seth owns the apply, gated behind
-- #1586.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The three columns. Additive + nullable; NULL = inherit the brand.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_listings
  ADD COLUMN IF NOT EXISTS theme_color_override text,
  ADD COLUMN IF NOT EXISTS theme_font_override text,
  ADD COLUMN IF NOT EXISTS theme_animation_override text;

-- The vocabularies are COPIED VERBATIM from the events overrides
-- (20260729000002) so an offering and a venue can never disagree about what a
-- legal font or motion is.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_listings_theme_color_override_hex_chk'
  ) THEN
    ALTER TABLE public.venue_listings
      ADD CONSTRAINT venue_listings_theme_color_override_hex_chk
      CHECK (
        theme_color_override IS NULL
        OR theme_color_override ~* '^#[0-9a-f]{6}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_listings_theme_font_override_whitelist_chk'
  ) THEN
    ALTER TABLE public.venue_listings
      ADD CONSTRAINT venue_listings_theme_font_override_whitelist_chk
      CHECK (theme_font_override IS NULL OR theme_font_override IN (
        'inter','poppins','space_grotesk','plus_jakarta_sans','manrope',
        'playfair_display','dm_serif_display','fraunces','lora',
        'bebas_neue','anton','unbounded','caveat','dancing_script'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_listings_theme_animation_override_whitelist_chk'
  ) THEN
    ALTER TABLE public.venue_listings
      ADD CONSTRAINT venue_listings_theme_animation_override_whitelist_chk
      CHECK (theme_animation_override IS NULL OR theme_animation_override IN (
        'none','confetti','fireworks','balloons','sparkles',
        'glitter_shower','snowfall','falling_petals','hearts','shimmer_reveal'
      ));
  END IF;
END $$;

COMMENT ON COLUMN public.venue_listings.theme_color_override IS
  'issue #1564: the venue''s OWN accent seed (#rrggbb), or NULL to inherit '
  'brands.theme_color. Resolved per-axis in venue_public_view via COALESCE — '
  'the single resolution point for every anonymous surface.';
COMMENT ON COLUMN public.venue_listings.theme_font_override IS
  'issue #1564: the venue''s OWN theme font slug, or NULL to inherit '
  'brands.theme_font. Vocabulary is byte-identical to '
  'events_theme_font_override_whitelist_chk.';
COMMENT ON COLUMN public.venue_listings.theme_animation_override IS
  'issue #1564: the venue''s OWN entrance-motion slug, or NULL to inherit '
  'brands.theme_animation. Vocabulary is byte-identical to '
  'events_theme_animation_override_whitelist_chk.';

-- ---------------------------------------------------------------------------
-- 2. The view — the ONE place override-vs-inherit is decided for guests.
--    Reproduced in full from 20270213001562 with THREE expressions changed and
--    nothing else: same 29 columns, same order, same joins, same WHERE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.venue_public_view AS
SELECT
  v.id, v.brand_id, b.slug AS brand_slug, b.name AS brand_name,
  v.slug, v.name, v.address, v.city, v.country_code, v.lat, v.lng,
  v.venue_category, v.google_place_id, v.contact_email, v.contact_phone,
  v.cover_media_url, v.cover_media_type, v.place_pool_id,
  -- issue #1564 — PER AXIS. The venue's own value when it has one, the brand's
  -- otherwise. Ordinals 19/20/21 and the `theme_*` names are unchanged, which
  -- is what keeps this a legal CREATE OR REPLACE and both `select("*")`
  -- by-name mappers untouched.
  COALESCE(v.theme_color_override, b.theme_color) AS theme_color,
  COALESCE(v.theme_font_override, b.theme_font) AS theme_font,
  COALESCE(v.theme_animation_override, b.theme_animation) AS theme_animation,
  b.cover_hue,
  b.default_currency,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekday', bh.weekday,
      'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
      'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
      'is_closed', bh.is_closed) ORDER BY bh.weekday), '[]'::jsonb)
     FROM public.brand_hours bh WHERE bh.venue_id = v.id) AS hours,
  pp.stored_photo_urls AS pool_photo_urls,
  -- META-ORCH-1290 M1 (D-6): the owner-authored pitch (generative_summary),
  -- anon-safe public-directory text on the already verified-only view.
  pp.generative_summary AS pitch,
  v.created_at, v.updated_at,
  -- issue #1562: the clock the `hours` column above is expressed in. APPENDED
  -- last so CREATE OR REPLACE is legal and every prior ordinal is unchanged.
  vac.iana_timezone AS iana_timezone
FROM public.venue_listings v
JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
LEFT JOIN public.place_pool pp ON pp.id = v.place_pool_id
LEFT JOIN public.venue_availability_config vac ON vac.venue_id = v.id
WHERE v.claim_status = 'verified';

-- security_invoker stays FALSE (definer) per the 20260731000000 ruling —
-- explicit so a future default change cannot flip it, and load-bearing for the
-- availability-config join above.
ALTER VIEW public.venue_public_view SET (security_invoker = false);

GRANT SELECT ON public.venue_public_view TO anon, authenticated;

COMMENT ON VIEW public.venue_public_view IS
  'META-ORCH-1255 M4 (D-2): the ONLY anon read path for venue data '
  '(I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE). SECURITY DEFINER (20260731000000 '
  'ruling); WHERE claim_status=''verified'' + non-deleted brand scope the rows. '
  'pending_review/rejected/suspended/revoked venues are INVISIBLE here; no '
  'Stripe/account columns cross the view. Serves /b/{brandSlug}/v/{venueSlug}. '
  'META-ORCH-1290: + pitch (generative_summary), anon-safe public-directory text. '
  'issue #1562: + iana_timezone (venue_availability_config, LEFT JOIN, NULL-safe) — '
  'the clock the hours column is expressed in, so open-now can be resolved in the '
  'VENUE''s zone instead of the visitor''s device. ONE scalar crosses; no other '
  'availability-config column is exposed and no grant is widened. '
  'issue #1564: theme_color/theme_font/theme_animation are now resolved PER AXIS '
  'as COALESCE(venue_listings.theme_*_override, brands.theme_*) — this SELECT list '
  'is THE single override-vs-inherit resolution point for every anonymous surface, '
  'so the buyer web and the consumer app cannot drift. NULL overrides (every venue '
  'at migration time) inherit the brand exactly as before; column names, types, '
  'ordinals and count are unchanged.';

-- ---------------------------------------------------------------------------
-- 3. The create RPC carries the three values in. DROP first — Postgres cannot
--    CREATE OR REPLACE a function whose argument list changed.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text
);

CREATE OR REPLACE FUNCTION public.biz_create_venue_listing (
  p_brand_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_google_place_id text,
  p_lat double precision,
  p_lng double precision,
  p_city text,
  p_country_code text,
  p_address text,
  p_venue_category text,
  p_contact_email text,
  p_contact_phone text,
  p_cover_media_url text,
  p_cover_media_type text,
  p_hours jsonb,
  p_place_pool_id uuid DEFAULT NULL,
  p_coordinate_precision text DEFAULT '',
  -- issue #1564 — the venue's own theme. '' / NULL / unrecognised → NULL →
  -- inherit the brand. Appended last with defaults so an 18-arg named call
  -- from an older deployed client still resolves.
  p_theme_color text DEFAULT '',
  p_theme_font text DEFAULT '',
  p_theme_animation text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid;
  v_venue_id uuid;
  v_idx int;
  v_hour jsonb;
  v_cover_url text;
  v_cover_type text;
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
  IF v_theme_font IS NOT NULL AND v_theme_font NOT IN (
    'inter','poppins','space_grotesk','plus_jakarta_sans','manrope',
    'playfair_display','dm_serif_display','fraunces','lora',
    'bebas_neue','anton','unbounded','caveat','dancing_script'
  ) THEN
    v_theme_font := NULL;
  END IF;
  v_theme_animation := nullif(trim(coalesce(p_theme_animation, '')), '');
  IF v_theme_animation IS NOT NULL AND v_theme_animation NOT IN (
    'none','confetti','fireworks','balloons','sparkles',
    'glitter_shower','snowfall','falling_petals','hearts','shimmer_reveal'
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
$function$;

REVOKE ALL ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text
) IS 'Issue #1463: event_manager+ may create pending-review venue listings for their own brand; publication and approval remain separately gated. Issue #1564: + p_theme_color/p_theme_font/p_theme_animation — the venue''s OWN theme, normalised per axis and fail-soft to NULL (inherit the brand) so a stale client can never block a submission over a colour.';

COMMIT;

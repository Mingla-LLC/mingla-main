-- issue #1564 [venue-colours] — the venue's own colours, proven against a REAL
-- Postgres with every migration applied.
--
-- WHY THIS FILE EXISTS. The jest suite can only read the migration as TEXT; it
-- cannot execute `COALESCE`, cannot see an ordinal, and cannot prove that a
-- `pending_review` venue stays invisible. This runs inside the same
-- "Migrations apply cleanly from baseline" job that already guards the Stay
-- schema, so the resolution rule is re-proven on every push rather than
-- rehearsed once on a laptop.
--
-- What it pins:
--   T-1  NOT SET inherits the brand, per axis. (Every venue today.)
--   T-2  A partial override keeps the brand's OTHER axes — not Mingla's.
--   T-3  A full override wins on all three.
--   T-4  Restyling one venue leaves its siblings untouched.
--   T-5  Clearing an override returns the venue to inheriting.
--   T-6  `pending_review` is STILL invisible on the anon view.
--   T-7  The CHECK constraints refuse junk on each axis independently.
--   T-8  The view is still 29 columns with theme_* at ordinals 19/20/21.
--   T-9  The RPC persists a theme, and is fail-soft PER AXIS.
--
-- Transactional: BEGIN … ROLLBACK, so it writes nothing that survives.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES
  ('00000000-1564-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-1564@example.test', now(), now());

INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('00000000-1564-4000-8000-000000000001', now());

-- A brand with a theme that is NOT Mingla's default, so "inherited" and
-- "Mingla default" are distinguishable. If the brand wore #eb7825/inter/none,
-- every assertion below would pass on a broken COALESCE.
INSERT INTO public.brands (
  id, account_id, name, slug, default_currency,
  theme_color, theme_font, theme_animation
) VALUES (
  '00000000-1564-4000-8000-000000000011',
  '00000000-1564-4000-8000-000000000001',
  'Issue 1564 Group', 'issue-1564-group', 'USD',
  '#2563eb', 'lora', 'snowfall'
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status,
  theme_color_override, theme_font_override, theme_animation_override
) VALUES
  -- NOT SET — the default path, and every venue in the pool today.
  ('00000000-1564-4000-8000-000000000021', '00000000-1564-4000-8000-000000000011',
   'finedining', 'Fine Dining Room', 1, 1, 'restaurant', 'verified', NULL, NULL, NULL),
  -- FULLY OVERRIDDEN — the beach bar under the same brand.
  ('00000000-1564-4000-8000-000000000022', '00000000-1564-4000-8000-000000000011',
   'beachbar', 'Beach Bar', 1, 1, 'restaurant', 'verified',
   '#eb7825', 'bebas_neue', 'sparkles'),
  -- PARTIAL — colour only.
  ('00000000-1564-4000-8000-000000000023', '00000000-1564-4000-8000-000000000011',
   'rooftop', 'Rooftop', 1, 1, 'play', 'verified', '#16a34a', NULL, NULL),
  -- OVERRIDDEN but NOT APPROVED — must stay invisible.
  ('00000000-1564-4000-8000-000000000024', '00000000-1564-4000-8000-000000000011',
   'unapproved', 'Not Approved Yet', 1, 1, 'restaurant', 'pending_review',
   '#ff0000', 'anton', 'hearts');

-- ── T-1/T-2/T-3 — per-axis resolution ──────────────────────────────────────
DO $resolution$
DECLARE
  v_color text; v_font text; v_anim text;
BEGIN
  SELECT theme_color, theme_font, theme_animation
    INTO v_color, v_font, v_anim
  FROM public.venue_public_view WHERE slug = 'finedining';
  IF v_color IS DISTINCT FROM '#2563eb'
     OR v_font IS DISTINCT FROM 'lora'
     OR v_anim IS DISTINCT FROM 'snowfall' THEN
    RAISE EXCEPTION 'issue_1564_T1_not_set_did_not_inherit: % % %', v_color, v_font, v_anim;
  END IF;

  SELECT theme_color, theme_font, theme_animation
    INTO v_color, v_font, v_anim
  FROM public.venue_public_view WHERE slug = 'rooftop';
  -- The venue's colour wins; font and motion still come from the BRAND. If the
  -- resolution were all-or-nothing, font/motion would read 'lora'/'snowfall'
  -- only by accident — so assert they are NOT Mingla's defaults either.
  IF v_color IS DISTINCT FROM '#16a34a'
     OR v_font IS DISTINCT FROM 'lora'
     OR v_anim IS DISTINCT FROM 'snowfall'
     OR v_font = 'inter' OR v_anim = 'none' THEN
    RAISE EXCEPTION 'issue_1564_T2_partial_override_wrong: % % %', v_color, v_font, v_anim;
  END IF;

  SELECT theme_color, theme_font, theme_animation
    INTO v_color, v_font, v_anim
  FROM public.venue_public_view WHERE slug = 'beachbar';
  IF v_color IS DISTINCT FROM '#eb7825'
     OR v_font IS DISTINCT FROM 'bebas_neue'
     OR v_anim IS DISTINCT FROM 'sparkles' THEN
    RAISE EXCEPTION 'issue_1564_T3_full_override_wrong: % % %', v_color, v_font, v_anim;
  END IF;
END;
$resolution$;

-- ── T-4 — a brand with several venues ──────────────────────────────────────
DO $siblings$
DECLARE
  v_fine_before text; v_roof_before text; v_fine_after text; v_roof_after text;
BEGIN
  SELECT theme_color INTO v_fine_before FROM public.venue_public_view WHERE slug = 'finedining';
  SELECT theme_color INTO v_roof_before FROM public.venue_public_view WHERE slug = 'rooftop';

  UPDATE public.venue_listings SET theme_color_override = '#7c3aed' WHERE slug = 'beachbar';

  SELECT theme_color INTO v_fine_after FROM public.venue_public_view WHERE slug = 'finedining';
  SELECT theme_color INTO v_roof_after FROM public.venue_public_view WHERE slug = 'rooftop';

  IF v_fine_after IS DISTINCT FROM v_fine_before
     OR v_roof_after IS DISTINCT FROM v_roof_before THEN
    RAISE EXCEPTION 'issue_1564_T4_sibling_moved: % -> %, % -> %',
      v_fine_before, v_fine_after, v_roof_before, v_roof_after;
  END IF;
  -- Vacuity guard: the restyle must actually have landed, or "the siblings did
  -- not move" would be true of a no-op.
  IF (SELECT theme_color FROM public.venue_public_view WHERE slug = 'beachbar')
     IS DISTINCT FROM '#7c3aed' THEN
    RAISE EXCEPTION 'issue_1564_T4_restyle_did_not_land';
  END IF;
END;
$siblings$;

-- ── T-5 — the way back ─────────────────────────────────────────────────────
DO $clear$
DECLARE
  v_color text; v_font text; v_anim text;
BEGIN
  UPDATE public.venue_listings
  SET theme_color_override = NULL, theme_font_override = NULL,
      theme_animation_override = NULL
  WHERE slug = 'beachbar';
  SELECT theme_color, theme_font, theme_animation
    INTO v_color, v_font, v_anim
  FROM public.venue_public_view WHERE slug = 'beachbar';
  IF v_color IS DISTINCT FROM '#2563eb'
     OR v_font IS DISTINCT FROM 'lora'
     OR v_anim IS DISTINCT FROM 'snowfall' THEN
    RAISE EXCEPTION 'issue_1564_T5_clear_did_not_reinherit: % % %', v_color, v_font, v_anim;
  END IF;
END;
$clear$;

-- ── T-6 — the anon scope is untouched ──────────────────────────────────────
DO $anon_scope$
DECLARE
  v_visible integer;
BEGIN
  SELECT count(*) INTO v_visible
  FROM public.venue_public_view
  WHERE brand_slug = 'issue-1564-group';
  IF v_visible <> 3 THEN
    RAISE EXCEPTION 'issue_1564_T6_pending_review_leaked: % rows visible', v_visible;
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_public_view WHERE slug = 'unapproved') THEN
    RAISE EXCEPTION 'issue_1564_T6_unapproved_venue_is_public';
  END IF;
END;
$anon_scope$;

-- ── T-7 — the CHECK constraints, one axis at a time ────────────────────────
DO $constraints$
DECLARE
  v_caught integer := 0;
BEGIN
  BEGIN
    UPDATE public.venue_listings SET theme_color_override = 'red' WHERE slug = 'rooftop';
  EXCEPTION WHEN check_violation THEN v_caught := v_caught + 1;
  END;
  BEGIN
    UPDATE public.venue_listings SET theme_font_override = 'comic_sans' WHERE slug = 'rooftop';
  EXCEPTION WHEN check_violation THEN v_caught := v_caught + 1;
  END;
  BEGIN
    UPDATE public.venue_listings SET theme_animation_override = 'explosions' WHERE slug = 'rooftop';
  EXCEPTION WHEN check_violation THEN v_caught := v_caught + 1;
  END;
  IF v_caught <> 3 THEN
    RAISE EXCEPTION 'issue_1564_T7_constraints_allowed_junk: only % of 3 refused', v_caught;
  END IF;
END;
$constraints$;

-- ── T-8 — the view's shape did not move ────────────────────────────────────
DO $shape$
DECLARE
  v_count integer;
  v_color_pos integer; v_font_pos integer; v_anim_pos integer; v_tz_pos integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'venue_public_view';
  -- [TEST-MOD-APPROVED #1719] The public venue contract intentionally gained
  -- one append-only cover_media_poster_url column for truthful video/GIF
  -- previews. The original #1564 theme ordinals remain pinned below, while the
  -- new poster is required at position 30 so no existing consumer shifts.
  IF v_count <> 30 THEN
    RAISE EXCEPTION 'issue_1564_T8_view_column_count_moved: %', v_count;
  END IF;

  IF (SELECT ordinal_position FROM information_schema.columns
      WHERE table_schema='public' AND table_name='venue_public_view'
        AND column_name='cover_media_poster_url') <> 30 THEN
    RAISE EXCEPTION 'issue_1719_T8_poster_not_append_only';
  END IF;

  SELECT ordinal_position INTO v_color_pos FROM information_schema.columns
   WHERE table_schema='public' AND table_name='venue_public_view' AND column_name='theme_color';
  SELECT ordinal_position INTO v_font_pos FROM information_schema.columns
   WHERE table_schema='public' AND table_name='venue_public_view' AND column_name='theme_font';
  SELECT ordinal_position INTO v_anim_pos FROM information_schema.columns
   WHERE table_schema='public' AND table_name='venue_public_view' AND column_name='theme_animation';
  SELECT ordinal_position INTO v_tz_pos FROM information_schema.columns
   WHERE table_schema='public' AND table_name='venue_public_view' AND column_name='iana_timezone';
  IF v_color_pos <> 19 OR v_font_pos <> 20 OR v_anim_pos <> 21 OR v_tz_pos <> 29 THEN
    RAISE EXCEPTION 'issue_1564_T8_ordinals_moved: % % % %',
      v_color_pos, v_font_pos, v_anim_pos, v_tz_pos;
  END IF;

  -- #1431's dependent view must still exist — proof the migration REPLACED
  -- rather than dropped (a DROP CASCADE would have taken this with it).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'ad_public_stay_destinations_view'
  ) THEN
    RAISE EXCEPTION 'issue_1564_T8_dependent_view_destroyed';
  END IF;
END;
$shape$;

-- ── T-9 — the RPC carries the theme, and is fail-soft PER AXIS ─────────────
-- No brand_team_members INSERT: creating the brand already seeds the owner's
-- membership, and re-inserting it trips idx_brand_team_members_brand_user_active.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1564-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1564-4000-8000-000000000001","role":"authenticated"}', true);

DO $rpc$
DECLARE
  v_hours jsonb := '[{"weekday":0,"is_closed":true},{"weekday":1,"is_closed":true},
                     {"weekday":2,"is_closed":true},{"weekday":3,"is_closed":true},
                     {"weekday":4,"is_closed":true},{"weekday":5,"is_closed":true},
                     {"weekday":6,"is_closed":true}]'::jsonb;
  v_themed uuid; v_junk uuid; v_old uuid;
  v_c text; v_f text; v_a text;
BEGIN
  -- Good values on all three axes.
  v_themed := public.biz_create_venue_listing(
    '00000000-1564-4000-8000-000000000011', 'RPC Themed', 'rpcthemed1564', '',
    '', 1, 1, '', '', '', 'restaurant', '', '', '', '', v_hours, NULL, '',
    '#0ea5e9', 'manrope', 'confetti');
  SELECT theme_color_override, theme_font_override, theme_animation_override
    INTO v_c, v_f, v_a FROM public.venue_listings WHERE id = v_themed;
  IF v_c IS DISTINCT FROM '#0ea5e9' OR v_f IS DISTINCT FROM 'manrope'
     OR v_a IS DISTINCT FROM 'confetti' THEN
    RAISE EXCEPTION 'issue_1564_T9_rpc_did_not_persist_theme: % % %', v_c, v_f, v_a;
  END IF;

  -- Junk on TWO axes must not discard the good third one.
  v_junk := public.biz_create_venue_listing(
    '00000000-1564-4000-8000-000000000011', 'RPC Junk', 'rpcjunk1564', '',
    '', 1, 1, '', '', '', 'restaurant', '', '', '', '', v_hours, NULL, '',
    '#0ea5e9', 'comic_sans', 'explosions');
  SELECT theme_color_override, theme_font_override, theme_animation_override
    INTO v_c, v_f, v_a FROM public.venue_listings WHERE id = v_junk;
  IF v_c IS DISTINCT FROM '#0ea5e9' OR v_f IS NOT NULL OR v_a IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1564_T9_failsoft_not_per_axis: % % %', v_c, v_f, v_a;
  END IF;

  -- An 18-argument NAMED call — an older deployed client — must still resolve
  -- and must inherit. This is what the three DEFAULTs are for.
  v_old := public.biz_create_venue_listing(
    p_brand_id => '00000000-1564-4000-8000-000000000011',
    p_name => 'Old Client', p_slug => 'oldclient1564', p_description => '',
    p_google_place_id => '', p_lat => 1, p_lng => 1, p_city => '',
    p_country_code => '', p_address => '', p_venue_category => 'restaurant',
    p_contact_email => '', p_contact_phone => '', p_cover_media_url => '',
    p_cover_media_type => '', p_hours => v_hours, p_place_pool_id => NULL,
    p_coordinate_precision => '');
  SELECT theme_color_override, theme_font_override, theme_animation_override
    INTO v_c, v_f, v_a FROM public.venue_listings WHERE id = v_old;
  IF v_c IS NOT NULL OR v_f IS NOT NULL OR v_a IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1564_T9_old_client_did_not_inherit: % % %', v_c, v_f, v_a;
  END IF;
END;
$rpc$;

RESET ROLE;

ROLLBACK;

-- ORCH-1066 [admin deck score tuner + card preview]
-- Four SECURITY DEFINER, is_admin_user()-gated, search_path-pinned RPCs that let
-- an admin SET / PIN / RANK / SEED per-signal place_scores for ANY place_pool row
-- (Google-seeded OR claimed) — including a NON-servable pending venue, which the
-- run-signal-scorer never scores (it filters is_servable=true). This unblocks the
-- Lantern & Vine case (place 8b720912-…: is_servable=false, place_scores=0).
--
-- Authority / hardening (per COMMS-0003 / I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED):
--   Database Functions (SECURITY DEFINER + search_path hardening):
--     https://supabase.com/docs/guides/database/functions
--   Function search_path mutable lint (0011):
--     https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0011_function_search_path_mutable
--   RLS & SECURITY DEFINER interaction:
--     https://supabase.com/docs/guides/troubleshooting/do-i-need-to-expose-security-definer-functions-in-row-level-security-policies-iI0uOw
--   Row Level Security:
--     https://supabase.com/docs/guides/database/postgres/row-level-security
--
-- All four are CREATE OR REPLACE FUNCTION (no table mutation at migration time →
-- no abort-on-existing-rows risk; no DDL data probe required). They all UPSERT
-- place_scores with ON CONFLICT (place_id, signal_id) exactly like the
-- META-ORCH-1062 admin_apply_score_override + run-signal-scorer (Constitution #2:
-- place_scores.score has a single coordinated write shape; no divergent authority).
--
-- STICKY-THROUGH-APPROVAL (operator hard requirement): the three WRITE RPCs stamp
-- contributions with an admin-override marker (_admin_set / _admin_pin) of the
-- SAME family as 1062's _admin_override. run-signal-scorer is patched (same ORCH)
-- to SKIP any (place_id, signal_id) whose committed contributions carry one of
-- those markers — so a pinned/set score survives the approval re-score loop.
--
-- Migration version 20260904000000 is strictly greater than remote max
-- (20260902000000) and sibling ORCH-1065's 20260903000000 (verified across all
-- worktrees + anchor + linked remote on 2026-06-03).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. admin_set_place_signal_score — place-keyed manual 0–200 dial
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_place_signal_score(
  p_place_pool_id uuid,
  p_signal_id     text,
  p_score         numeric,
  p_reason        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_original numeric;
  v_version  uuid;
  v_now      timestamptz := now();
  v_veto     jsonb;
BEGIN
  -- Guard order (each RAISE EXCEPTION aborts; probed against live data §3.5).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_signal_id IS NULL OR length(trim(p_signal_id)) = 0 THEN
    RAISE EXCEPTION 'signal_id_required';
  END IF;
  IF p_score IS NULL THEN
    RAISE EXCEPTION 'score_required';
  END IF;
  -- Mirror the place_scores_score_range CHECK (0–200). Reject (not silently
  -- clamp) so the admin sees a clear error rather than a surprise value.
  IF p_score < 0 OR p_score > 200 THEN
    RAISE EXCEPTION 'score_out_of_range';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.place_pool pp WHERE pp.id = p_place_pool_id) THEN
    RAISE EXCEPTION 'place_not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.signal_definitions sd
                 WHERE sd.id = p_signal_id AND sd.is_active = true) THEN
    RAISE EXCEPTION 'unknown_or_inactive_signal';
  END IF;

  -- Current committed score for this (place, signal), if any (audit "original").
  SELECT ps.score, ps.signal_version_id
  INTO v_original, v_version
  FROM public.place_scores ps
  WHERE ps.place_id = p_place_pool_id AND ps.signal_id = p_signal_id;

  -- signal_version_id falls back to the signal's current_version_id when no prior
  -- row (mirrors admin_apply_score_override).
  IF v_version IS NULL THEN
    SELECT sd.current_version_id INTO v_version
    FROM public.signal_definitions sd WHERE sd.id = p_signal_id;
  END IF;

  -- Audit slice on place_pool.ai_signal_scores_veto (uniform with 1062 so the
  -- tuner override and the claim override are indistinguishable in audit).
  v_veto := coalesce(
    (SELECT pp.ai_signal_scores_veto FROM public.place_pool pp WHERE pp.id = p_place_pool_id),
    '{}'::jsonb);
  v_veto := v_veto || jsonb_build_object(
    p_signal_id, jsonb_build_object(
      'vetoed_score', p_score,
      'original_score', v_original,
      'reason', nullif(trim(coalesce(p_reason, '')), ''),
      'vetoed_at', v_now,
      'vetoed_by', auth.uid()
    )
  );
  UPDATE public.place_pool SET ai_signal_scores_veto = v_veto WHERE id = p_place_pool_id;

  -- UPSERT the deck-ranking place_scores.score. contributions carries the
  -- _admin_set marker → run-signal-scorer SKIPS this (place, signal) on the
  -- approval re-score loop (STICKY-THROUGH-APPROVAL). DO NOT remove _admin_set
  -- from the contributions shape — the scorer's sticky-skip predicate reads it.
  INSERT INTO public.place_scores (place_id, signal_id, score, contributions, signal_version_id, scored_at)
  VALUES (
    p_place_pool_id, p_signal_id, p_score,
    jsonb_build_object('_admin_set', 1, '_original_score', v_original,
                       '_set_by', auth.uid(),
                       '_reason', nullif(trim(coalesce(p_reason, '')), ''),
                       '_orch', '1066'),
    v_version, v_now
  )
  ON CONFLICT (place_id, signal_id) DO UPDATE
    SET score = EXCLUDED.score,
        contributions = public.place_scores.contributions || EXCLUDED.contributions,
        scored_at = EXCLUDED.scored_at;

  RETURN jsonb_build_object(
    'ok', true,
    'signal_id', p_signal_id,
    'original_score', v_original,
    'new_score', p_score,
    'direction', CASE
      WHEN v_original IS NULL THEN 'created'
      WHEN p_score > v_original THEN 'raised'
      WHEN p_score < v_original THEN 'lowered'
      ELSE 'unchanged' END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_place_signal_score(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_place_signal_score(uuid, text, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.admin_set_place_signal_score(uuid, text, numeric, text) IS
  'ORCH-1066 — admin-gated PLACE-keyed manual 0–200 score dial. Works for ANY '
  'place_pool row (Google-seeded or claimed), incl. non-servable pending venues. '
  'UPSERTs place_scores with the _admin_set marker (sticky-through-approval: '
  'run-signal-scorer skips _admin_set/_admin_pin rows on re-score). Audit slice '
  'on place_pool.ai_signal_scores_veto.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. admin_pin_place_to_top — computed pin (LEAST(200, local_max+1)); no literal 200
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_pin_place_to_top(
  p_place_pool_id uuid,
  p_signal_id     text,
  p_radius_m      double precision DEFAULT 16000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lat       double precision;
  v_lng       double precision;
  v_original  numeric;
  v_version   uuid;
  v_local_max numeric;
  v_target    numeric;
  v_now       timestamptz := now();
  v_veto      jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_signal_id IS NULL OR length(trim(p_signal_id)) = 0 THEN
    RAISE EXCEPTION 'signal_id_required';
  END IF;
  IF p_radius_m IS NULL OR p_radius_m <= 0 THEN
    RAISE EXCEPTION 'invalid_radius';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.place_pool pp WHERE pp.id = p_place_pool_id) THEN
    RAISE EXCEPTION 'place_not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.signal_definitions sd
                 WHERE sd.id = p_signal_id AND sd.is_active = true) THEN
    RAISE EXCEPTION 'unknown_or_inactive_signal';
  END IF;

  SELECT pp.lat, pp.lng INTO v_lat, v_lng
  FROM public.place_pool pp WHERE pp.id = p_place_pool_id;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RAISE EXCEPTION 'place_missing_geo';
  END IF;

  -- Local max servable score for this signal within radius, EXCLUDING this place,
  -- mirroring query_servable_places_by_signal's WHERE clause EXACTLY (is_servable
  -- + is_active + real-photo gate + Haversine). Keep in sync with that serving RPC.
  SELECT max(ps.score) INTO v_local_max
  FROM public.place_pool pp
  JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = p_signal_id
  WHERE pp.is_servable = true
    AND pp.is_active = true
    AND pp.id <> p_place_pool_id
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (array_length(pp.stored_photo_urls, 1) = 1
             AND pp.stored_photo_urls[1] = '__backfill_failed__')
    AND (
      6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - v_lat) / 2.0), 2) +
        COS(RADIANS(v_lat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - v_lng) / 2.0), 2)
      ))
    ) <= p_radius_m;

  -- LOCKED rule (I-1066-PIN-COMPUTED-NOT-HARDCODED): the ONLY path to a literal
  -- 200 is an empty radius (no other servable scored place) OR LEAST capping an
  -- incumbent already at 200. NEVER hardcode 200 as the pin target.
  v_target := CASE WHEN v_local_max IS NULL THEN 200 ELSE LEAST(200, v_local_max + 1) END;

  -- Current committed score / version for audit + version fallback.
  SELECT ps.score, ps.signal_version_id INTO v_original, v_version
  FROM public.place_scores ps
  WHERE ps.place_id = p_place_pool_id AND ps.signal_id = p_signal_id;
  IF v_version IS NULL THEN
    SELECT sd.current_version_id INTO v_version
    FROM public.signal_definitions sd WHERE sd.id = p_signal_id;
  END IF;

  v_veto := coalesce(
    (SELECT pp.ai_signal_scores_veto FROM public.place_pool pp WHERE pp.id = p_place_pool_id),
    '{}'::jsonb);
  v_veto := v_veto || jsonb_build_object(
    p_signal_id, jsonb_build_object(
      'vetoed_score', v_target,
      'original_score', v_original,
      'reason', 'pin_to_top',
      'vetoed_at', v_now,
      'vetoed_by', auth.uid()
    )
  );
  UPDATE public.place_pool SET ai_signal_scores_veto = v_veto WHERE id = p_place_pool_id;

  INSERT INTO public.place_scores (place_id, signal_id, score, contributions, signal_version_id, scored_at)
  VALUES (
    p_place_pool_id, p_signal_id, v_target,
    jsonb_build_object('_admin_pin', 1, '_local_max', v_local_max, '_radius_m', p_radius_m,
                       '_pinned_by', auth.uid(), '_orch', '1066'),
    v_version, v_now
  )
  ON CONFLICT (place_id, signal_id) DO UPDATE
    SET score = EXCLUDED.score,
        contributions = public.place_scores.contributions || EXCLUDED.contributions,
        scored_at = EXCLUDED.scored_at;

  RETURN jsonb_build_object(
    'ok', true,
    'signal_id', p_signal_id,
    'local_max', v_local_max,
    'new_score', v_target,
    -- capped: we hit the 200 ceiling because the incumbent was already ≥200.
    'capped', (v_target = 200 AND v_local_max IS NOT NULL AND v_local_max >= 200),
    -- tie_warning: serving tie-break is review_count DESC; surface it (no silent failure).
    'tie_warning', (v_target = 200 AND v_local_max IS NOT NULL AND v_local_max >= 200),
    'pinned', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_pin_place_to_top(uuid, text, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pin_place_to_top(uuid, text, double precision) TO authenticated;

COMMENT ON FUNCTION public.admin_pin_place_to_top(uuid, text, double precision) IS
  'ORCH-1066 — admin-gated computed pin: sets this place''s signal score to '
  'LEAST(200, local_max+1) where local_max is the max servable score for the '
  'signal within radius (mirrors query_servable_places_by_signal gates). Empty '
  'radius → 200; incumbent at 200 → capped+tie_warning. NEVER a hardcoded 200. '
  'Writes the _admin_pin sticky marker.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. admin_place_deck_rank — read-only projected rank readout
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_place_deck_rank(
  p_place_pool_id uuid,
  p_signal_id     text,
  p_radius_m      double precision DEFAULT 16000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lat         double precision;
  v_lng         double precision;
  v_is_servable boolean;
  v_is_active   boolean;
  v_score       numeric;
  v_n_photos    int;
  v_photo1      text;
  v_total       int;
  v_top         numeric;
  v_above       int;
  v_rank        int;
  v_gated       text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_radius_m IS NULL OR p_radius_m <= 0 THEN
    RAISE EXCEPTION 'invalid_radius';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.place_pool pp WHERE pp.id = p_place_pool_id) THEN
    RAISE EXCEPTION 'place_not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.signal_definitions sd
                 WHERE sd.id = p_signal_id AND sd.is_active = true) THEN
    RAISE EXCEPTION 'unknown_or_inactive_signal';
  END IF;

  SELECT pp.lat, pp.lng, pp.is_servable, pp.is_active,
         array_length(pp.stored_photo_urls, 1),
         (pp.stored_photo_urls)[1]
  INTO v_lat, v_lng, v_is_servable, v_is_active, v_n_photos, v_photo1
  FROM public.place_pool pp WHERE pp.id = p_place_pool_id;

  SELECT ps.score INTO v_score
  FROM public.place_scores ps
  WHERE ps.place_id = p_place_pool_id AND ps.signal_id = p_signal_id;

  -- Why the projection ≠ live: enumerate the serving gates this place FAILS.
  IF v_is_servable IS NOT TRUE THEN v_gated := array_append(v_gated, 'not_servable'); END IF;
  IF v_is_active IS NOT TRUE THEN v_gated := array_append(v_gated, 'not_active'); END IF;
  IF v_n_photos IS NULL OR v_n_photos = 0
     OR (v_n_photos = 1 AND v_photo1 = '__backfill_failed__') THEN
    v_gated := array_append(v_gated, 'no_real_photos');
  END IF;
  IF v_score IS NULL THEN v_gated := array_append(v_gated, 'unscored_for_signal'); END IF;
  IF v_lat IS NULL OR v_lng IS NULL THEN v_gated := array_append(v_gated, 'missing_geo'); END IF;

  -- total + top_score over the servable+scored+photo'd set in radius. INCLUDES
  -- this place IFF it itself passes the serving gate (so a live venue counts itself).
  SELECT count(*), max(ps.score)
  INTO v_total, v_top
  FROM public.place_pool pp
  JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = p_signal_id
  WHERE pp.is_servable = true
    AND pp.is_active = true
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (array_length(pp.stored_photo_urls, 1) = 1
             AND pp.stored_photo_urls[1] = '__backfill_failed__')
    AND v_lat IS NOT NULL AND v_lng IS NOT NULL
    AND (
      6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - v_lat) / 2.0), 2) +
        COS(RADIANS(v_lat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - v_lng) / 2.0), 2)
      ))
    ) <= p_radius_m;
  v_total := coalesce(v_total, 0);

  IF v_score IS NULL THEN
    -- Unscored for this signal → no rank to project (Constitution #9: no fake rank).
    v_rank := NULL;
  ELSE
    -- Projected rank: count OTHER servable scored places with a strictly higher
    -- score in radius, then +1. Treats THIS place as if servable (so a pending
    -- venue sees where it WOULD land the instant it's approved).
    SELECT count(*)
    INTO v_above
    FROM public.place_pool pp
    JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = p_signal_id
    WHERE pp.is_servable = true
      AND pp.is_active = true
      AND pp.id <> p_place_pool_id
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0
      AND NOT (array_length(pp.stored_photo_urls, 1) = 1
               AND pp.stored_photo_urls[1] = '__backfill_failed__')
      AND ps.score > v_score
      AND v_lat IS NOT NULL AND v_lng IS NOT NULL
      AND (
        6371000.0 * 2.0 * ASIN(SQRT(
          POWER(SIN(RADIANS(pp.lat - v_lat) / 2.0), 2) +
          COS(RADIANS(v_lat)) * COS(RADIANS(pp.lat)) *
          POWER(SIN(RADIANS(pp.lng - v_lng) / 2.0), 2)
        ))
      ) <= p_radius_m;
    v_rank := coalesce(v_above, 0) + 1;
    -- If this place is itself NOT in the servable set, it isn't counted in v_total;
    -- normalize so rank ≤ total in the projection ("would be 1 of total+1").
    IF (v_gated @> ARRAY['not_servable']
        OR v_gated @> ARRAY['not_active']
        OR v_gated @> ARRAY['no_real_photos']) THEN
      v_total := v_total + 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'rank', v_rank,
    'total', v_total,
    'score', v_score,
    'top_score', v_top,
    'is_servable', coalesce(v_is_servable, false),
    'is_active', coalesce(v_is_active, false),
    'projected', (v_is_servable IS NOT TRUE),
    'gated_reason', to_jsonb(v_gated)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_place_deck_rank(uuid, text, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_place_deck_rank(uuid, text, double precision) TO authenticated;

COMMENT ON FUNCTION public.admin_place_deck_rank(uuid, text, double precision) IS
  'ORCH-1066 — admin-gated read-only rank readout mirroring '
  'query_servable_places_by_signal gates. Returns {rank,total,score,top_score,'
  'is_servable,is_active,projected,gated_reason}. For a non-servable venue rank '
  'is PROJECTED (computed as if servable); gated_reason lists the failing gates. '
  'Unscored signal → rank null (never a fabricated number).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. admin_score_place_preview — seed all 16 active signals at neutral 100
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_score_place_preview(
  p_place_pool_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now      timestamptz := now();
  v_seeded   int := 0;
  v_existing int;
  v_total    int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.place_pool pp WHERE pp.id = p_place_pool_id) THEN
    RAISE EXCEPTION 'place_not_found';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.signal_definitions WHERE is_active = true;

  -- Rows that already exist for this place across active signals (idempotency report).
  SELECT count(*) INTO v_existing
  FROM public.place_scores ps
  JOIN public.signal_definitions sd ON sd.id = ps.signal_id AND sd.is_active = true
  WHERE ps.place_id = p_place_pool_id;

  -- Seed a neutral 100 row for each active signal with NO existing row. DO NOTHING
  -- so this NEVER overwrites a real computed score OR a prior admin tweak — safe to
  -- click twice (idempotent). MUST NOT touch is_servable/is_active
  -- (I-1066-ONDEMAND-NO-SERVABLE-FLIP) — that authority is the approval path's.
  WITH ins AS (
    INSERT INTO public.place_scores (place_id, signal_id, score, contributions, signal_version_id, scored_at)
    SELECT p_place_pool_id, sd.id, 100,
           jsonb_build_object('_admin_seed', 1, '_orch', '1066',
                              '_note', 'preview_seed_pending_score'),
           sd.current_version_id, v_now
    FROM public.signal_definitions sd
    WHERE sd.is_active = true
    ON CONFLICT (place_id, signal_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_seeded FROM ins;

  RETURN jsonb_build_object(
    'ok', true,
    'seeded_count', v_seeded,
    'existing_count', v_existing,
    'total_signals', v_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_score_place_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_score_place_preview(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_score_place_preview(uuid) IS
  'ORCH-1066 — admin-gated on-demand seed: inserts a neutral 100 place_scores row '
  'for each active signal with no existing row (ON CONFLICT DO NOTHING → idempotent, '
  'never clobbers a computed/admin score). Unblocks tuning a non-servable pending '
  'venue. MUST NOT flip is_servable/is_active (that authority is admin-review-venue-claim).';

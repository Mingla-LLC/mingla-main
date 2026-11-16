-- Issue #4453 PR 3 (content foundation): the Website setup part
-- "What guests say and where you've been" (spec v1 Part 3, spec v2 §6.7).
--
-- MINGLA-INVARIANT: I-SITES-SETUP-CONTENT-SERVICE-ONLY | issue #4453 | brand_site_setup_content
-- has no anon or authenticated grants, RLS is enabled and forced, and a
-- materialised row is immutable (pg17 test issue_4453_website_proof_part).
-- MINGLA-INVARIANT: I-SITES-NO-INVENTED-PROOF | issue #4453 | a staged review exists only
-- with the owner's "This is a real review" tick (confirmed_real_by/at NOT NULL),
-- recorded by a brand admin or owner (rank 50+); past trips must have ended.
--
-- What changes (static SQL; conflicts raise PT409, never 40001):
-- 1. brand_site_plans gains value_points (Q5), faq (Q6), process_steps (Q7) and
--    quick_facts (Q8), each with a validator CHECK; skipped_parts allows 'proof'.
-- 2. brand_sites gains design_fingerprint (stored by the Ari composition PR).
-- 3. brand_site_plan_parts() gains 'proof' after 'story' (9 parts).
-- 4. SITES_PROOF_PART (feature_flags, off): while off the plan status leaves the
--    part out, so nothing an owner sees changes.
-- 5. Re-issued from their latest bodies, changing only what is named:
--    brand_site_plan_status_internal (20280216002830): the proof part;
--    brand_site_plan_get (20280421002830): the proof answers and counts;
--    brand_site_plan_save (20280119092829): the proof answers, 'proof' skips,
--      PT409 on a stale revision;
--    brand_site_content_min_rank (20280119122829): review_status, mark_reviewed.
--    brand_site_setup_status_internal needs no change: its ELSE gives 'proof'
--    no brand-context fields.
-- 6. public.brand_site_setup_content: Q1 reviews, Q3 destinations and Q4
--    stories staged before a site exists (service role only), with
--    save/list/pending/materialise functions.
-- 7. brand_site_setup_add_past_trip: Q2, a real ended Mingla trip through
--    brand_site_import_historical_trip (wrapped, not changed).

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ── 0. The flag ────────────────────────────────────────────────────────────
INSERT INTO public.feature_flags (flag_key, is_enabled, description)
SELECT 'SITES_PROOF_PART', false,
  '#4453 Website setup part "What guests say and where you''ve been" and Draft review of composed sections.'
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_key = 'SITES_PROOF_PART');

CREATE OR REPLACE FUNCTION public.brand_site_proof_part_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((SELECT is_enabled FROM public.feature_flags
    WHERE flag_key = 'SITES_PROOF_PART' LIMIT 1), false);
$function$;
REVOKE ALL ON FUNCTION public.brand_site_proof_part_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_proof_part_enabled() TO service_role;

-- ── 1. Validators (shape, counts, lengths; no markup) ─────────────────────
-- One owner text: a string, trimmed non-empty when required, at most p_max
-- characters, and no angle brackets (plan text is never markup).
CREATE OR REPLACE FUNCTION public.brand_site_proof_text_ok(
  p_value jsonb, p_max integer, p_required boolean
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN NOT p_required
    WHEN jsonb_typeof(p_value) <> 'string' THEN false
    ELSE char_length(p_value #>> '{}') <= p_max
      AND (NOT p_required OR btrim(p_value #>> '{}') <> '')
      AND (p_value #>> '{}') !~ '[<>]'
  END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_proof_text_ok(jsonb, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_proof_text_ok(jsonb, integer, boolean) TO service_role;

-- An array of p_min..p_max objects whose keys are exactly p_keys, each text
-- within its limit (p_limits, in key order) and required (p_required).
CREATE OR REPLACE FUNCTION public.brand_site_proof_list_ok(
  p_value jsonb, p_min integer, p_max integer, p_keys text[], p_limits integer[], p_required boolean[]
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_value IS NULL OR (
    jsonb_typeof(p_value) = 'array'
    AND jsonb_array_length(p_value) BETWEEN p_min AND p_max
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_value) AS item
      WHERE jsonb_typeof(item) <> 'object'
        OR NOT public.brand_site_json_keys_allowed(item, p_keys)
        OR EXISTS (
          SELECT 1 FROM generate_subscripts(p_keys, 1) AS i
          WHERE NOT public.brand_site_proof_text_ok(item -> p_keys[i], p_limits[i], p_required[i])
        )
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.brand_site_proof_list_ok(jsonb, integer, integer, text[], integer[], boolean[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_proof_list_ok(jsonb, integer, integer, text[], integer[], boolean[]) TO service_role;

-- Q5: up to 4 × {title ≤ 120, sentence ≤ 500}, both required.
CREATE OR REPLACE FUNCTION public.brand_site_plan_value_points_ok(p_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.brand_site_proof_list_ok(p_value, 1, 4,
    ARRAY['title','sentence'], ARRAY[120,500], ARRAY[true,true]);
$function$;
-- Q6: up to 12 × {question ≤ 240, answer ≤ 1000}, both required.
CREATE OR REPLACE FUNCTION public.brand_site_plan_faq_ok(p_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.brand_site_proof_list_ok(p_value, 1, 12,
    ARRAY['question','answer'], ARRAY[240,1000], ARRAY[true,true]);
$function$;
-- Q7: 3 to 5 × {title ≤ 80, text ≤ 300, time ≤ 24 (optional)}.
CREATE OR REPLACE FUNCTION public.brand_site_plan_process_steps_ok(p_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.brand_site_proof_list_ok(p_value, 3, 5,
    ARRAY['title','text','time'], ARRAY[80,300,24], ARRAY[true,true,false]);
$function$;
-- Q8: {facts: ≤ 3 × {big ≤ 12, small ≤ 40}, use_in_ticker: boolean,
--      ticker: ≤ 12 phrases ≤ 80}. Every key present.
CREATE OR REPLACE FUNCTION public.brand_site_plan_quick_facts_ok(p_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_value IS NULL OR (
    jsonb_typeof(p_value) = 'object'
    AND public.brand_site_json_keys_allowed(p_value, ARRAY['facts','use_in_ticker','ticker'])
    AND p_value ?& ARRAY['facts','use_in_ticker','ticker']
    AND jsonb_typeof(p_value->'use_in_ticker') = 'boolean'
    AND jsonb_typeof(p_value->'facts') = 'array'
    AND jsonb_array_length(p_value->'facts') <= 3
    AND (jsonb_array_length(p_value->'facts') = 0 OR public.brand_site_proof_list_ok(p_value->'facts', 1, 3,
      ARRAY['big','small'], ARRAY[12,40], ARRAY[true,true]))
    AND jsonb_typeof(p_value->'ticker') = 'array'
    AND jsonb_array_length(p_value->'ticker') <= 12
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_value->'ticker') AS phrase
      WHERE NOT public.brand_site_proof_text_ok(phrase, 80, true))
  );
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_value_points_ok(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_plan_faq_ok(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_plan_process_steps_ok(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_plan_quick_facts_ok(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_value_points_ok(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_faq_ok(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_process_steps_ok(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_quick_facts_ok(jsonb) TO service_role;

-- ── 2. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.brand_site_plans
  ADD COLUMN IF NOT EXISTS value_points jsonb NULL,
  ADD COLUMN IF NOT EXISTS faq jsonb NULL,
  ADD COLUMN IF NOT EXISTS process_steps jsonb NULL,
  ADD COLUMN IF NOT EXISTS quick_facts jsonb NULL;
ALTER TABLE public.brand_site_plans
  DROP CONSTRAINT IF EXISTS brand_site_plans_value_points_check,
  DROP CONSTRAINT IF EXISTS brand_site_plans_faq_check,
  DROP CONSTRAINT IF EXISTS brand_site_plans_process_steps_check,
  DROP CONSTRAINT IF EXISTS brand_site_plans_quick_facts_check,
  DROP CONSTRAINT IF EXISTS brand_site_plans_skipped_parts_check;
ALTER TABLE public.brand_site_plans
  ADD CONSTRAINT brand_site_plans_value_points_check CHECK (public.brand_site_plan_value_points_ok(value_points)),
  ADD CONSTRAINT brand_site_plans_faq_check CHECK (public.brand_site_plan_faq_ok(faq)),
  ADD CONSTRAINT brand_site_plans_process_steps_check CHECK (public.brand_site_plan_process_steps_ok(process_steps)),
  ADD CONSTRAINT brand_site_plans_quick_facts_check CHECK (public.brand_site_plan_quick_facts_ok(quick_facts)),
  ADD CONSTRAINT brand_site_plans_skipped_parts_check CHECK (skipped_parts <@ ARRAY['look','proof','first_offering']);

-- #4453 §6.6 — the published composition's fingerprint (set by the Ari
-- composition PR on each successful publication; NULL until then).
ALTER TABLE public.brand_sites
  ADD COLUMN IF NOT EXISTS design_fingerprint jsonb NULL;
ALTER TABLE public.brand_sites
  DROP CONSTRAINT IF EXISTS brand_sites_design_fingerprint_check;
ALTER TABLE public.brand_sites
  ADD CONSTRAINT brand_sites_design_fingerprint_check CHECK (
    design_fingerprint IS NULL OR (jsonb_typeof(design_fingerprint) = 'object'
      AND octet_length(design_fingerprint::text) <= 4096));

-- ── 3. The 9 parts ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_plan_parts()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['offer','brand','look','story','proof','approve','build','first_offering','publish'];
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_parts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_parts() TO authenticated, service_role;

-- ── 4. Staged setup content (Q1 reviews, Q3 destinations, Q4 stories) ─────
CREATE TABLE IF NOT EXISTS public.brand_site_setup_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('review','destination','story')),
  payload jsonb NOT NULL,
  confirmed_real_by uuid NULL REFERENCES auth.users(id),
  confirmed_real_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  materialized_entry_id text NULL CHECK (materialized_entry_id IS NULL OR char_length(materialized_entry_id) BETWEEN 1 AND 80),
  materialized_at timestamptz NULL,
  CONSTRAINT brand_site_setup_content_review_confirmed_ck CHECK (
    (kind = 'review') = (confirmed_real_by IS NOT NULL AND confirmed_real_at IS NOT NULL)
  ),
  CONSTRAINT brand_site_setup_content_materialized_ck CHECK (
    (materialized_entry_id IS NULL) = (materialized_at IS NULL)
  ),
  CONSTRAINT brand_site_setup_content_payload_ck CHECK (
    CASE kind
      WHEN 'review' THEN public.brand_site_json_keys_allowed(payload, ARRAY['reviewer','quote','trip_name','review_date','source'])
        AND public.brand_site_proof_text_ok(payload->'reviewer', 80, true)
        AND public.brand_site_proof_text_ok(payload->'quote', 1200, true)
        AND public.brand_site_proof_text_ok(payload->'trip_name', 120, false)
        AND public.brand_site_proof_text_ok(payload->'source', 500, true)
        AND COALESCE(payload->>'review_date', '') ~ '^\d{4}-(0[1-9]|1[0-2])$'
      WHEN 'destination' THEN public.brand_site_json_keys_allowed(payload, ARRAY['name','country','short_line','summary'])
        AND public.brand_site_proof_text_ok(payload->'name', 120, true)
        AND public.brand_site_proof_text_ok(payload->'country', 80, false)
        AND public.brand_site_proof_text_ok(payload->'short_line', 200, false)
        AND public.brand_site_proof_text_ok(payload->'summary', 600, false)
      WHEN 'story' THEN public.brand_site_json_keys_allowed(payload, ARRAY['title','summary','story'])
        AND public.brand_site_proof_text_ok(payload->'title', 160, true)
        AND public.brand_site_proof_text_ok(payload->'summary', 400, false)
        AND public.brand_site_proof_text_ok(payload->'story', 5000, true)
      ELSE false
    END
  )
);
CREATE INDEX IF NOT EXISTS brand_site_setup_content_brand_idx
  ON public.brand_site_setup_content (brand_id, kind, created_at);
ALTER TABLE public.brand_site_setup_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_setup_content FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_setup_content FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.brand_site_setup_content TO service_role;
COMMENT ON TABLE public.brand_site_setup_content IS
  '#4453 I-SITES-SETUP-CONTENT-SERVICE-ONLY: owner-written reviews, destinations and stories staged in Website setup until Build creates them in Studio. Service role only; immutable once materialised.';

CREATE OR REPLACE FUNCTION public.brand_site_setup_content_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A brand's own removal cascades (trigger depth > 1); a direct delete of
    -- a materialised row is refused.
    IF OLD.materialized_at IS NOT NULL AND pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'sites_setup_content_materialized' USING ERRCODE = 'PT409';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.materialized_at IS NOT NULL THEN
    RAISE EXCEPTION 'sites_setup_content_materialized' USING ERRCODE = 'PT409';
  END IF;
  IF NEW.id <> OLD.id OR NEW.brand_id <> OLD.brand_id OR NEW.kind <> OLD.kind
    OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_setup_content_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brand_site_setup_content_guard ON public.brand_site_setup_content;
CREATE TRIGGER brand_site_setup_content_guard
  BEFORE UPDATE OR DELETE ON public.brand_site_setup_content
  FOR EACH ROW EXECUTE FUNCTION public.brand_site_setup_content_guard();

-- A staged row as the Business app shows it.
CREATE OR REPLACE FUNCTION public.brand_site_setup_content_json(p_row public.brand_site_setup_content)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'id', p_row.id, 'kind', p_row.kind, 'payload', p_row.payload,
    'confirmed_real', p_row.confirmed_real_at IS NOT NULL,
    'materialized', p_row.materialized_at IS NOT NULL,
    'updated_at', p_row.updated_at
  );
$function$;
REVOKE ALL ON FUNCTION public.brand_site_setup_content_json(public.brand_site_setup_content) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_setup_content_json(public.brand_site_setup_content) TO service_role;

-- The caller's rank for a setup write, or the refusal. Reviews need a brand
-- admin or owner (confirmation is theirs, §37 answer 2); destinations and
-- stories need the content rank. Once a site exists the workspace is the one
-- home for this content (USE_WEBSITE_CONTENT).
CREATE OR REPLACE FUNCTION public.brand_site_setup_content_gate(
  p_brand_id uuid, p_user_id uuid, p_kind text
) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rank integer;
BEGIN
  IF p_user_id IS NULL OR p_brand_id IS NULL THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  v_rank := public.biz_brand_effective_rank(p_brand_id, p_user_id);
  IF v_rank IS NULL OR v_rank < (CASE WHEN p_kind = 'review' THEN 50 ELSE 20 END) THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF NOT public.brand_site_entitled(p_brand_id) THEN
    RAISE EXCEPTION 'sites_not_entitled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_sites WHERE brand_id = p_brand_id) THEN
    RAISE EXCEPTION 'sites_use_website_content';
  END IF;
  RETURN v_rank;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_setup_content_gate(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_setup_content_gate(uuid, uuid, text) TO service_role;

-- Create, update or delete one staged entry. p_expected_updated_at guards an
-- update or delete against a teammate's newer save (PT409).
CREATE OR REPLACE FUNCTION public.brand_site_setup_content_save(
  p_brand_id uuid,
  p_user_id uuid,
  p_kind text,
  p_id uuid,
  p_payload jsonb,
  p_confirmed_real boolean,
  p_expected_updated_at timestamptz,
  p_delete boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.brand_site_setup_content%ROWTYPE;
  v_limit integer := CASE p_kind WHEN 'review' THEN 24 WHEN 'destination' THEN 12 WHEN 'story' THEN 12 ELSE NULL END;
BEGIN
  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  PERFORM public.brand_site_setup_content_gate(p_brand_id, p_user_id, p_kind);
  -- One writer at a time per brand: the count and the insert see the same rows.
  PERFORM 1 FROM public.brands WHERE id = p_brand_id FOR UPDATE;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.brand_site_setup_content
    WHERE id = p_id AND brand_id = p_brand_id AND kind = p_kind FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'sites_not_found';
    END IF;
    IF v_row.materialized_at IS NOT NULL THEN
      RAISE EXCEPTION 'sites_use_website_content';
    END IF;
    IF p_expected_updated_at IS NULL OR v_row.updated_at <> p_expected_updated_at THEN
      RAISE EXCEPTION 'sites_revision_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF p_delete THEN
      DELETE FROM public.brand_site_setup_content WHERE id = v_row.id;
      RETURN jsonb_build_object('deleted', true, 'id', v_row.id);
    END IF;
  ELSIF p_delete THEN
    RAISE EXCEPTION 'sites_validation_failed';
  ELSIF (SELECT count(*) FROM public.brand_site_setup_content
      WHERE brand_id = p_brand_id AND kind = p_kind) >= v_limit THEN
    RAISE EXCEPTION 'sites_setup_limit_reached';
  END IF;

  -- No review without the owner's word that it is real (Constitution rule 9).
  IF p_kind = 'review' AND p_confirmed_real IS NOT TRUE THEN
    RAISE EXCEPTION 'sites_review_not_confirmed';
  END IF;

  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.brand_site_setup_content(brand_id, kind, payload,
        confirmed_real_by, confirmed_real_at, created_by)
      VALUES (p_brand_id, p_kind, p_payload,
        CASE WHEN p_kind = 'review' THEN p_user_id END,
        CASE WHEN p_kind = 'review' THEN now() END,
        p_user_id)
      RETURNING * INTO v_row;
    ELSE
      UPDATE public.brand_site_setup_content SET
        payload = p_payload,
        confirmed_real_by = CASE WHEN p_kind = 'review' THEN p_user_id END,
        confirmed_real_at = CASE WHEN p_kind = 'review' THEN now() END
      WHERE id = v_row.id
      RETURNING * INTO v_row;
    END IF;
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END;
  RETURN public.brand_site_setup_content_json(v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_setup_content_save(uuid, uuid, text, uuid, jsonb, boolean, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_setup_content_save(uuid, uuid, text, uuid, jsonb, boolean, timestamptz, boolean) TO service_role;

-- The brand's staged entries (content rank 20+).
CREATE OR REPLACE FUNCTION public.brand_site_setup_content_list(p_brand_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rank integer;
BEGIN
  v_rank := public.biz_brand_effective_rank(p_brand_id, p_user_id);
  IF p_user_id IS NULL OR v_rank IS NULL OR v_rank < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN jsonb_build_object(
    'has_site', EXISTS (SELECT 1 FROM public.brand_sites WHERE brand_id = p_brand_id),
    'can_confirm_reviews', v_rank >= 50,
    'items', COALESCE((
      SELECT jsonb_agg(public.brand_site_setup_content_json(c) ORDER BY c.kind, c.created_at, c.id)
      FROM public.brand_site_setup_content c WHERE c.brand_id = p_brand_id
    ), '[]'::jsonb),
    'past_trips', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('event_id', i.event_id, 'title', e.title, 'imported_at', i.imported_at)
        ORDER BY i.imported_at, i.event_id)
      FROM public.brand_site_historical_trip_imports i
      JOIN public.events e ON e.id = i.event_id
      WHERE i.brand_id = p_brand_id AND i.import_key LIKE 'setup:%'
    ), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_setup_content_list(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_setup_content_list(uuid, uuid) TO service_role;

-- What Build sends to Studio: the unmaterialised rows, with who confirmed a review.
CREATE OR REPLACE FUNCTION public.brand_site_setup_content_pending(p_brand_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'payload', c.payload,
      'confirmed_real_by', c.confirmed_real_by, 'confirmed_real_at', c.confirmed_real_at)
    ORDER BY c.kind, c.created_at, c.id), '[]'::jsonb)
  FROM public.brand_site_setup_content c
  WHERE c.brand_id = p_brand_id AND c.materialized_at IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_setup_content_pending(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_setup_content_pending(uuid) TO service_role;

-- After Studio created the entries: stamp each staged row once. A row
-- already stamped with the same entry is a no-op (a rerun); a different
-- entry is a conflict (PT409).
CREATE OR REPLACE FUNCTION public.brand_site_setup_content_mark_materialized(
  p_brand_id uuid, p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb;
  v_row public.brand_site_setup_content%ROWTYPE;
  v_count integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_item) <> 'object'
      OR COALESCE(v_item->>'id', '') !~* '^[0-9a-f-]{36}$'
      OR NULLIF(v_item->>'entry_id', '') IS NULL THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    SELECT * INTO v_row FROM public.brand_site_setup_content
    WHERE id = (v_item->>'id')::uuid AND brand_id = p_brand_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'sites_not_found';
    END IF;
    IF v_row.materialized_at IS NOT NULL THEN
      IF v_row.materialized_entry_id <> v_item->>'entry_id' THEN
        RAISE EXCEPTION 'sites_setup_content_materialized' USING ERRCODE = 'PT409';
      END IF;
      CONTINUE;
    END IF;
    UPDATE public.brand_site_setup_content
    SET materialized_entry_id = v_item->>'entry_id', materialized_at = now()
    WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_setup_content_mark_materialized(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_setup_content_mark_materialized(uuid, jsonb) TO service_role;

-- ── 5. Q2: a trip the brand ran before Mingla (rank 50+) ──────────────────
-- A real ended Mingla trip, never a staged row. The wrapped import refuses a
-- trip that has not ended in its own timezone (historical_trip_not_ended).
CREATE OR REPLACE FUNCTION public.brand_site_setup_add_past_trip(
  p_brand_id uuid,
  p_user_id uuid,
  p_title text,
  p_start_date date,
  p_end_date date,
  p_timezone text,
  p_location text,
  p_description text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rank integer;
BEGIN
  v_rank := public.biz_brand_effective_rank(p_brand_id, p_user_id);
  IF p_user_id IS NULL OR v_rank IS NULL OR v_rank < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF NOT public.brand_site_entitled(p_brand_id) THEN
    RAISE EXCEPTION 'sites_not_entitled';
  END IF;
  IF NULLIF(btrim(COALESCE(p_location, '')), '') IS NULL
    OR char_length(COALESCE(p_description, '')) > 1000
    OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  PERFORM 1 FROM public.brands WHERE id = p_brand_id FOR UPDATE;
  IF (SELECT count(*) FROM public.brand_site_historical_trip_imports
      WHERE brand_id = p_brand_id AND import_key LIKE 'setup:%') >= 24 THEN
    RAISE EXCEPTION 'sites_setup_limit_reached';
  END IF;
  RETURN public.brand_site_import_historical_trip(
    p_brand_id,
    'setup:' || gen_random_uuid()::text,
    p_title, p_start_date, p_end_date, p_timezone, p_location,
    NULLIF(btrim(COALESCE(p_description, '')), ''),
    'Entered in Website setup');
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_setup_add_past_trip(uuid, uuid, text, date, date, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_setup_add_past_trip(uuid, uuid, text, date, date, text, text, text) TO service_role;

-- ── 6. Plan status: the proof part (only while SITES_PROOF_PART is on) ────
-- Re-issued from 20280216002830; changes: v_proof_on, 'proof' in v_done,
-- the part skipped while the flag is off, 'optional' for proof.
CREATE OR REPLACE FUNCTION public.brand_site_plan_status_internal(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan public.brand_site_plans%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_done jsonb;
  v_needed text[];
  v_kinds text[];
  v_first boolean;
  v_kind text;
  v_parts jsonb := '[]'::jsonb;
  v_part text;
  v_next text;
  v_count integer := 0;
  v_site_predates_plan boolean;
  v_proof_on boolean := public.brand_site_proof_part_enabled();
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  v_site_predates_plan := v_site.id IS NOT NULL AND (
    v_site.last_successful_publication_id IS NOT NULL
    OR v_plan.brand_id IS NULL
    OR v_site.created_at < v_plan.started_at);
  v_plan.offerings_selected := COALESCE(v_plan.offerings_selected,
    public.brand_site_plan_prefill_offerings(p_brand_id));
  v_needed := public.brand_site_plan_offering_pages(v_plan.offerings_selected);
  v_kinds := ARRAY(SELECT unnest(COALESCE(v_plan.offerings_selected, ARRAY[]::text[]))
    INTERSECT SELECT unnest(ARRAY['trips','events','experiences']));
  v_first := cardinality(v_kinds) > 0;
  FOREACH v_kind IN ARRAY v_kinds LOOP
    IF public.brand_site_plan_offering_count(p_brand_id, v_kind, false) = 0 THEN
      v_first := false;
    END IF;
  END LOOP;
  v_done := jsonb_build_object(
    'offer', v_plan.offerings_selected IS NOT NULL,
    'brand', NULLIF(btrim(COALESCE(v_brand.name,'')),'') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_brand.description,'')),'') IS NOT NULL,
    'look', v_plan.design_key IS NOT NULL
      OR (v_site.id IS NOT NULL AND v_site.design_key IS NOT NULL AND v_site.tokens_saved_at IS NOT NULL)
      OR 'look' = ANY (COALESCE(v_plan.skipped_parts,ARRAY[]::text[])),
    'story', v_plan.story IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_plan.story->>'who','')),'') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_plan.story->>'why','')),'') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_plan.story->>'main_action','')),'') IS NOT NULL,
    -- #4453 — any answer (Q1-Q8), or skipped. Optional: it never blocks Build.
    'proof', v_plan.value_points IS NOT NULL OR v_plan.faq IS NOT NULL
      OR v_plan.process_steps IS NOT NULL OR v_plan.quick_facts IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.brand_site_setup_content c WHERE c.brand_id = p_brand_id)
      OR EXISTS (SELECT 1 FROM public.brand_site_historical_trip_imports i
        WHERE i.brand_id = p_brand_id AND i.import_key LIKE 'setup:%')
      OR 'proof' = ANY (COALESCE(v_plan.skipped_parts,ARRAY[]::text[]))
      OR v_site_predates_plan,
    'approve', (v_plan.approved_plan IS NOT NULL AND v_plan.approved_at IS NOT NULL)
      OR v_site_predates_plan,
    'build', (v_site.id IS NOT NULL AND v_plan.built_at IS NOT NULL
      AND v_plan.offerings_selected IS NOT NULL
      AND v_needed <@ COALESCE(v_plan.built_pages,ARRAY[]::text[])) OR v_site_predates_plan,
    'first_offering', v_first
      OR 'first_offering' = ANY (COALESCE(v_plan.skipped_parts,ARRAY[]::text[])),
    'publish', v_site.last_successful_publication_id IS NOT NULL
  );
  FOREACH v_part IN ARRAY public.brand_site_plan_parts() LOOP
    CONTINUE WHEN v_part = 'proof' AND NOT v_proof_on;
    v_parts := v_parts || jsonb_build_object(
      'key',v_part,'done',(v_done->>v_part)::boolean,
      'skipped',v_part = ANY (COALESCE(v_plan.skipped_parts,ARRAY[]::text[])),
      'optional',v_part IN ('first_offering','proof'));
    IF (v_done->>v_part)::boolean THEN v_count := v_count + 1;
    ELSIF v_next IS NULL THEN v_next := v_part;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('parts',v_parts,'done_count',v_count,'next_part',v_next);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_status_internal(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_status_internal(uuid) TO service_role;

-- ── 7. Plan read: the proof answers and counts ─────────────────────────────
-- Re-issued from 20280421002830; the only changes are the four answers in
-- `plan`, `proof_enabled` and `proof_counts`.
CREATE OR REPLACE FUNCTION public.brand_site_plan_get(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_rank integer;
  v_plan public.brand_site_plans%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_lock_active boolean;
BEGIN
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_actor);
  IF v_actor IS NULL OR v_rank < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF NOT public.brand_site_entitled(p_brand_id) THEN
    RETURN jsonb_build_object('brand_id', p_brand_id, 'entitled', false, 'rank', v_rank);
  END IF;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  v_lock_active := v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now();

  RETURN jsonb_build_object(
    'brand_id', p_brand_id,
    'entitled', true,
    'rank', v_rank,
    'can_manage', v_rank >= 50,
    'site', CASE WHEN v_site.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_site.id,
      'status', v_site.status,
      'design_key', v_site.design_key,
      'published', v_site.last_successful_publication_id IS NOT NULL,
      'paused', v_site.status = 'suspended'
    ) END,
    'plan', CASE WHEN v_plan.brand_id IS NULL THEN NULL ELSE jsonb_build_object(
      'revision', v_plan.revision,
      'offerings_selected', to_jsonb(v_plan.offerings_selected),
      'venue_descriptor', v_plan.venue_descriptor,
      'story', v_plan.story,
      'value_points', v_plan.value_points,
      'faq', v_plan.faq,
      'process_steps', v_plan.process_steps,
      'quick_facts', v_plan.quick_facts,
      'approved_plan', v_plan.approved_plan,
      'approved_at', v_plan.approved_at,
      'skipped_parts', to_jsonb(v_plan.skipped_parts),
      'active_part', v_plan.active_part,
      'built_pages', to_jsonb(v_plan.built_pages),
      'built_at', v_plan.built_at,
      'started_at', v_plan.started_at,
      'started_by_me', v_plan.started_by = v_actor,
      'started_by_name', CASE WHEN v_plan.started_by IS NULL THEN NULL
        ELSE public.brand_site_plan_person_name(v_plan.started_by) END,
      'updated_at', v_plan.updated_at
    ) END,
    'status', public.brand_site_plan_status_internal(p_brand_id),
    'setup_status', public.brand_site_setup_status_internal(p_brand_id),
    'prefill_offerings', to_jsonb(public.brand_site_plan_prefill_offerings(p_brand_id)),
    'live_counts', jsonb_build_object(
      'trips', public.brand_site_plan_offering_count(p_brand_id, 'trips', true),
      'events', public.brand_site_plan_offering_count(p_brand_id, 'events', true),
      'experiences', public.brand_site_plan_offering_count(p_brand_id, 'experiences', true)
    ),
    'proof_enabled', public.brand_site_proof_part_enabled(),
    'proof_counts', jsonb_build_object(
      'reviews', (SELECT count(*) FROM public.brand_site_setup_content c
        WHERE c.brand_id = p_brand_id AND c.kind = 'review'),
      'destinations', (SELECT count(*) FROM public.brand_site_setup_content c
        WHERE c.brand_id = p_brand_id AND c.kind = 'destination'),
      'stories', (SELECT count(*) FROM public.brand_site_setup_content c
        WHERE c.brand_id = p_brand_id AND c.kind = 'story'),
      'past_trips', (SELECT count(*) FROM public.brand_site_historical_trip_imports i
        WHERE i.brand_id = p_brand_id AND i.import_key LIKE 'setup:%')
    ),
    'lock', jsonb_build_object(
      'active', v_lock_active,
      'held_by_me', v_lock_active AND v_plan.lock_holder = v_actor,
      'holder_name', CASE WHEN v_lock_active
        THEN public.brand_site_plan_person_name(v_plan.lock_holder) ELSE NULL END,
      'expires_at', CASE WHEN v_lock_active THEN v_plan.lock_expires_at ELSE NULL END
    )
  );
END;
$function$;

-- ── 8. Plan save: the proof answers ────────────────────────────────────────
-- Re-issued from 20280119092829; changes: the four answer keys, 'proof' in
-- skipped_parts, and the stale-revision refusal carries ERRCODE PT409.
CREATE OR REPLACE FUNCTION public.brand_site_plan_save(
  p_brand_id uuid, p_revision integer, p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_rank integer;
  v_plan public.brand_site_plans%ROWTYPE;
  v_keys text[];
  v_status jsonb;
  v_offerings text[];
  v_skipped text[];
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb
    OR NOT public.brand_site_json_keys_allowed(p_patch, ARRAY[
      'offerings_selected','venue_descriptor','story','approve','approved_plan',
      'skipped_parts','active_part',
      'value_points','faq','process_steps','quick_facts']) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  v_keys := ARRAY(SELECT jsonb_object_keys(p_patch));
  -- #2829 — only active_part ("Do it with Ari") is open to rank 20-49.
  v_rank := public.brand_site_plan_gate(p_brand_id,
    CASE WHEN v_keys = ARRAY['active_part'] THEN 20 ELSE 50 END);

  INSERT INTO public.brand_site_plans(brand_id, started_by, updated_by, offerings_selected)
  VALUES (p_brand_id, v_actor, v_actor, public.brand_site_plan_prefill_offerings(p_brand_id))
  ON CONFLICT (brand_id) DO NOTHING;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id FOR UPDATE;

  IF p_revision IS NULL OR p_revision <> v_plan.revision THEN
    RAISE EXCEPTION 'sites_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN
    RAISE EXCEPTION 'sites_plan_locked';
  END IF;

  IF p_patch ? 'offerings_selected' THEN
    IF jsonb_typeof(p_patch->'offerings_selected') <> 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch->'offerings_selected') value
        WHERE jsonb_typeof(value) <> 'string') THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    v_offerings := ARRAY(SELECT DISTINCT value FROM jsonb_array_elements_text(p_patch->'offerings_selected') value);
    IF NOT v_offerings <@ public.brand_site_plan_offering_keys() THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    -- Changing what the brand offers changes the plan: it needs approving again.
    IF v_plan.offerings_selected IS DISTINCT FROM v_offerings THEN
      v_plan.approved_at := NULL;
      v_plan.approved_by := NULL;
    END IF;
    v_plan.offerings_selected := v_offerings;
  END IF;
  IF p_patch ? 'venue_descriptor' THEN
    v_plan.venue_descriptor := NULLIF(btrim(p_patch->>'venue_descriptor'), '');
  END IF;
  IF p_patch ? 'story' THEN
    IF jsonb_typeof(p_patch->'story') = 'null' THEN
      v_plan.story := NULL;
    ELSIF NOT public.brand_site_plan_text_map_ok(p_patch->'story', ARRAY['who','why','main_action'], 300) THEN
      RAISE EXCEPTION 'sites_validation_failed';
    ELSE
      IF v_plan.story IS DISTINCT FROM p_patch->'story' THEN
        v_plan.approved_at := NULL;
        v_plan.approved_by := NULL;
      END IF;
      v_plan.story := p_patch->'story';
    END IF;
  END IF;
  -- #4453 Q5-Q8: the owner's own words, validated by the column CHECKs' functions.
  IF p_patch ? 'value_points' THEN
    v_plan.value_points := NULLIF(p_patch->'value_points', 'null'::jsonb);
    IF NOT public.brand_site_plan_value_points_ok(v_plan.value_points) THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
  END IF;
  IF p_patch ? 'faq' THEN
    v_plan.faq := NULLIF(p_patch->'faq', 'null'::jsonb);
    IF NOT public.brand_site_plan_faq_ok(v_plan.faq) THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
  END IF;
  IF p_patch ? 'process_steps' THEN
    v_plan.process_steps := NULLIF(p_patch->'process_steps', 'null'::jsonb);
    IF NOT public.brand_site_plan_process_steps_ok(v_plan.process_steps) THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
  END IF;
  IF p_patch ? 'quick_facts' THEN
    v_plan.quick_facts := NULLIF(p_patch->'quick_facts', 'null'::jsonb);
    IF NOT public.brand_site_plan_quick_facts_ok(v_plan.quick_facts) THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
  END IF;
  IF p_patch ? 'skipped_parts' THEN
    IF jsonb_typeof(p_patch->'skipped_parts') <> 'array' THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    v_skipped := ARRAY(SELECT DISTINCT value FROM jsonb_array_elements_text(p_patch->'skipped_parts') value);
    IF NOT v_skipped <@ ARRAY['look','proof','first_offering'] THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    v_plan.skipped_parts := v_skipped;
  END IF;
  IF p_patch ? 'active_part' THEN
    IF jsonb_typeof(p_patch->'active_part') = 'null' THEN
      v_plan.active_part := NULL;
    ELSIF NOT ((p_patch->>'active_part') = ANY (public.brand_site_plan_parts())) THEN
      RAISE EXCEPTION 'sites_validation_failed';
    ELSE
      v_plan.active_part := p_patch->>'active_part';
    END IF;
  END IF;
  IF p_patch ? 'approve' THEN
    IF jsonb_typeof(p_patch->'approve') <> 'boolean' THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    IF (p_patch->>'approve')::boolean THEN
      IF NOT public.brand_site_plan_text_map_ok(p_patch->'approved_plan',
          ARRAY['for','leads_with','main_action','look','pages','wont_do'], 300)
        OR p_patch->'approved_plan' IS NULL OR jsonb_typeof(p_patch->'approved_plan') <> 'object' THEN
        RAISE EXCEPTION 'sites_validation_failed';
      END IF;
      -- A plan is approved only once Mingla knows what the brand offers and
      -- has its name and one line about it (the edge case "skip every
      -- question": those two are the only required answers).
      IF v_plan.offerings_selected IS NULL OR NOT (
        (public.brand_site_plan_status_internal(p_brand_id)->'parts'->1->>'done')::boolean
      ) THEN
        RAISE EXCEPTION 'sites_plan_not_ready';
      END IF;
      v_plan.approved_plan := p_patch->'approved_plan';
      v_plan.approved_at := now();
      v_plan.approved_by := v_actor;
    ELSE
      v_plan.approved_at := NULL;
      v_plan.approved_by := NULL;
    END IF;
  ELSIF p_patch ? 'approved_plan' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;

  UPDATE public.brand_site_plans SET
    revision = v_plan.revision + 1,
    offerings_selected = v_plan.offerings_selected,
    venue_descriptor = v_plan.venue_descriptor,
    story = v_plan.story,
    value_points = v_plan.value_points,
    faq = v_plan.faq,
    process_steps = v_plan.process_steps,
    quick_facts = v_plan.quick_facts,
    approved_plan = v_plan.approved_plan,
    approved_at = v_plan.approved_at,
    approved_by = v_plan.approved_by,
    skipped_parts = v_plan.skipped_parts,
    active_part = v_plan.active_part,
    -- Rank 50 holds the lock while working; rank 20-49 never takes it.
    lock_holder = CASE WHEN v_rank >= 50 THEN v_actor ELSE v_plan.lock_holder END,
    lock_expires_at = CASE WHEN v_rank >= 50 THEN now() + interval '10 minutes'
      ELSE v_plan.lock_expires_at END,
    updated_at = now(),
    updated_by = v_actor
  WHERE brand_id = p_brand_id;

  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
    action, resource_kind, resource_id, metadata)
  VALUES ((SELECT id FROM public.brand_sites WHERE brand_id = p_brand_id), p_brand_id,
    v_actor, 'user', 'plan.saved', 'brand_site_plan', p_brand_id::text,
    jsonb_build_object('revision', v_plan.revision + 1, 'fields', to_jsonb(v_keys)));

  RETURN public.brand_site_plan_get(p_brand_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_save(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_save(uuid, integer, jsonb) TO authenticated, service_role;

-- ── 9. Content ranks: the Draft review actions (content rank 20) ──────────
-- Re-issued from 20280119122829; adds review_status and mark_reviewed.
CREATE OR REPLACE FUNCTION public.brand_site_content_min_rank(p_action text)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_action IN (
      'list','get','create','update','reorder','set_visibility','delete',
      'categories','create_category','rename_category','reorder_categories',
      'delete_category','media_upload_grant','media_complete','media_status',
      'media_library','offerings','past_trips','font_search','font_previews','draft_changes','pages','set_menu','cover','set_cover',
      -- #2829 W9b — "Why it looks like this" and the six design checks.
      'work_log','design_checks',
      -- #4453 — "N sections to review" and "Looks right" (spec v1 §4.3).
      'review_status','mark_reviewed'
    ) THEN 20
    -- Only brand admins and owners confirm a review is real (§37 answer 2)
    -- and hide a past trip from the website (§37 answer 3).
    WHEN p_action IN ('confirm_review','set_offering_visibility') THEN 50
    ELSE NULL
  END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_content_min_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_content_min_rank(text) TO authenticated, service_role;

COMMIT;

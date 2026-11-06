-- Issue #4276: an AI slice whose evaluated_at cannot be read as a date counts as held.
--
-- ai_slices_predate_hold cast evaluated_at straight to timestamptz, so one slice with a
-- date Postgres cannot read raised and errored the whole final-score stage. It now
-- treats that slice as held, without raising, the same as aiSliceIsHeld in
-- supabase/functions/_shared/aiScoreHold.ts (Date.parse gives NaN, so it is held). A
-- value must also start with a digit: Postgres reads words such as 'now' or 'infinity'
-- as dates and JavaScript does not, so those count as held on both sides.
--
-- Rollback: restore ai_slices_predate_hold from
-- 20280416004276_issue_4276_score_hold_and_release_only_path.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.ai_slices_predate_hold(p_ai jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(bool_or(
           CASE
             WHEN (s.slice ->> 'evaluated_at') IS NULL THEN true
             WHEN (s.slice ->> 'evaluated_at') !~ '^\s*[0-9]' THEN true
             WHEN NOT pg_input_is_valid(s.slice ->> 'evaluated_at', 'timestamptz') THEN true
             ELSE (s.slice ->> 'evaluated_at')::timestamptz < public.ai_score_hold_since()
           END
         ), false)
  FROM jsonb_each(CASE WHEN jsonb_typeof(p_ai) = 'object' THEN p_ai ELSE '{}'::jsonb END) AS s (signal_id, slice);
$$;

REVOKE ALL ON FUNCTION public.ai_slices_predate_hold(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_slices_predate_hold(jsonb) TO service_role;

COMMIT;

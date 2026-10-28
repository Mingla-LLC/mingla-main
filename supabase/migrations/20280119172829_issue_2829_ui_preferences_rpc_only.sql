-- #2829 W11 — per-user Business UI preferences become RPC-only, like every
-- other table this project ships (#1856 grant-class guard: no new direct table
-- grant to anon or authenticated). W9r granted authenticated SELECT/INSERT/
-- UPDATE/DELETE (plus Supabase's default MAINTAIN/REFERENCES/TRIGGER/TRUNCATE)
-- on the table and relied on row security; the CI replay's guard reds that.
-- Members now read and write ONLY their own row through two functions; the
-- table keeps row security and its value CHECK.
-- Do NOT apply here — orchestrator owns production apply.

BEGIN;
SET LOCAL lock_timeout = '10s';

REVOKE ALL ON public.business_user_ui_preferences FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.business_user_ui_preferences TO service_role;
DROP POLICY IF EXISTS business_user_ui_preferences_own_select ON public.business_user_ui_preferences;
DROP POLICY IF EXISTS business_user_ui_preferences_own_insert ON public.business_user_ui_preferences;
DROP POLICY IF EXISTS business_user_ui_preferences_own_update ON public.business_user_ui_preferences;
DROP POLICY IF EXISTS business_user_ui_preferences_own_delete ON public.business_user_ui_preferences;

-- The caller's own preference for one known key, or NULL.
CREATE OR REPLACE FUNCTION public.business_ui_preference_get(p_key text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_key IS NULL OR p_key NOT IN ('website.previewDevice') THEN RAISE EXCEPTION 'invalid_key'; END IF;
  RETURN (SELECT pref.value FROM public.business_user_ui_preferences pref
    WHERE pref.user_id = v_actor AND pref.key = p_key);
END;
$function$;
REVOKE ALL ON FUNCTION public.business_ui_preference_get(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_ui_preference_get(text) TO authenticated, service_role;

-- Stores the caller's own preference (the table's CHECK refuses a bad value).
CREATE OR REPLACE FUNCTION public.business_ui_preference_set(p_key text, p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_key IS NULL OR p_key NOT IN ('website.previewDevice') THEN RAISE EXCEPTION 'invalid_key'; END IF;
  INSERT INTO public.business_user_ui_preferences(user_id, key, value, updated_at)
  VALUES (v_actor, p_key, p_value, now())
  ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN p_value;
END;
$function$;
REVOKE ALL ON FUNCTION public.business_ui_preference_set(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_ui_preference_set(text, jsonb) TO authenticated, service_role;

COMMENT ON TABLE public.business_user_ui_preferences IS
  '#2829 W9r/W11 — per-user Business app UI preferences (only website.previewDevice). RPC-only: business_ui_preference_get / business_ui_preference_set read and write the caller''s own row.';

COMMIT;

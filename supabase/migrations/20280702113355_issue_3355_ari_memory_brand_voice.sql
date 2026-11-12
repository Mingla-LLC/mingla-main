-- Issue #3355 rework 2 (tester P3-21): a brand-wide Ari memory note speaks for
-- the brand only while its author may still write one.
--
-- Rework 1 stopped a removed member's brand notes reaching the brand's Ari,
-- and stopped a member below marketing manager writing or editing a brand
-- note. A note written while its author was marketing manager still reached
-- every member's context after the author was demoted to scanner. The rank
-- rule decides who speaks for the brand, so it is now applied when the notes
-- are read too: in ari_memory_list (what Ari's context loads) and in the
-- table's own read policy. The rows are kept: re-promoting the author brings
-- the note back; the author still sees their own note.
--
-- Invariant I-ARI-MEMORY-BRAND-VOICE-AT-READ (declared beside its enforcing test): A brand-scoped Ari memory note reaches another member (ari_memory_list and the table's RLS read) only while its author is on the brand's team at marketing manager rank or above; demoting or removing the author hides it without deleting it (enforced by supabase/migrations/__tests__/issue_3355_rework_2.implementor.pg17.test.sql and supabase/functions/_shared/__tests__/issue_3355_rework_2.implementor.test.ts).

-- The author may speak for the brand: on its team, at marketing manager or above.
CREATE OR REPLACE FUNCTION public.ari_memory_brand_voice(
  p_brand_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT p_brand_id IS NOT NULL AND p_user_id IS NOT NULL
    AND COALESCE(public.biz_is_brand_member_for_read(p_brand_id, p_user_id), false)
    AND COALESCE(public.biz_brand_effective_rank(p_brand_id, p_user_id), 0)
        >= public.biz_role_rank('marketing_manager');
$fn$;
REVOKE ALL ON FUNCTION public.ari_memory_brand_voice(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_brand_voice(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.ari_memory_brand_voice(uuid, uuid) IS
  '#3355 rework 2 (P3-21): true while the user may speak for the brand in Ari memory (on its team, marketing manager rank or above). Applied when brand notes are read.';

-- RLS: a user note is its author's; a brand note is every brand member's
-- while its author may still speak for the brand.
DROP POLICY IF EXISTS ari_memory_notes_scoped_read ON public.ari_memory_notes;
CREATE POLICY ari_memory_notes_scoped_read
  ON public.ari_memory_notes FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (
      scope = 'brand' AND brand_id IS NOT NULL
      AND public.biz_is_brand_member_for_read(brand_id, (SELECT auth.uid()))
      AND public.ari_memory_brand_voice(brand_id, user_id)
    )
  );

-- Every note the caller can read for this brand: their own (global, or for
-- this brand) and the brand's shared notes whose author may still speak for
-- the brand. Newest first. Same signature and shape as before.
CREATE OR REPLACE FUNCTION public.ari_memory_list(p_brand_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_admin boolean := false;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_brand_id IS NOT NULL THEN
    IF NOT public.biz_is_brand_member_for_read(p_brand_id, v_actor) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
    v_admin := COALESCE(public.biz_is_brand_admin_plus(p_brand_id, v_actor), false);
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'brand_id', n.brand_id, 'scope', n.scope, 'kind', n.kind,
      'content', n.content, 'confidence', n.confidence,
      'updated_at', n.updated_at, 'created_at', n.created_at,
      'mine', n.user_id = v_actor,
      'can_forget', n.user_id = v_actor OR (n.scope = 'brand' AND v_admin)
    ) ORDER BY n.updated_at DESC)
    FROM public.ari_memory_notes n
    WHERE n.active
      AND (
        (n.user_id = v_actor
          AND (n.brand_id IS NULL OR n.brand_id IS NOT DISTINCT FROM p_brand_id))
        -- #3355 rework 1 (P1-5) and rework 2 (P3-21): a brand note speaks for
        -- the brand only while its author is on the team at the rank that may
        -- write one.
        OR (p_brand_id IS NOT NULL AND n.scope = 'brand' AND n.brand_id = p_brand_id
            AND public.ari_memory_brand_voice(n.brand_id, n.user_id))
      )
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ari_memory_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_memory_list(uuid) TO authenticated, service_role;

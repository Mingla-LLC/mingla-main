-- #4453 milestone 11 (spec v2.1 §3) — "Add a page with Ari": the rollout flag.
--
--   1. SITES_ARI_ADD_PAGE, seeded OFF. Off = today's behaviour: Core refuses
--      propose_site_page and answer_site_page_question (ARI_ADD_PAGE_OFF), the
--      page answers route refuses, and the Host app hides "Add a page with Ari".
--   2. brand_site_flag_brands accepts the new flag (per-brand allowlist, rollout
--      D10). No brand is seeded: Seth adds Young and Stamped when he chooses.
--   3. brand_site_flag_on(flag, brand) knows the new flag. Service role only,
--      static SQL, unchanged for the two milestone 7 flags.
--   4. brand_site_content_min_rank re-issued (from 20280723004453) with the
--      owner's three Ari-page content actions at the content minimum (20):
--      ari_page_answer ("Ari needs this" -> Save), ari_page_accept ("Publish
--      this page") and ari_page_remove ("Remove"). Every other action keeps
--      its rank.
--
-- Static SQL only; no data is changed beyond the one flag row.

-- ── 1. The flag (off) ──────────────────────────────────────────────────────
INSERT INTO public.feature_flags (flag_key, is_enabled, description)
SELECT 'SITES_ARI_ADD_PAGE', false,
  '#4453 milestone 11 — owners ask Ari for a new website page: Ari proposes a plan card, the page is added as a hidden Draft by Ari with owner-only questions, and the owner reviews and publishes it. Brands in brand_site_flag_brands get it while this is off.'
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_key = 'SITES_ARI_ADD_PAGE');

-- ── 2. The allowlist accepts the flag ──────────────────────────────────────
ALTER TABLE public.brand_site_flag_brands DROP CONSTRAINT IF EXISTS brand_site_flag_brands_flag_key_check;
ALTER TABLE public.brand_site_flag_brands ADD CONSTRAINT brand_site_flag_brands_flag_key_check
  CHECK (flag_key IN ('SITES_ARI_DESIGN_PASS', 'SITES_STYLE_LIBRARY', 'SITES_ARI_ADD_PAGE'));

-- ── 3. The flag read ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_flag_on(p_flag text, p_brand_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_flag IN ('SITES_ARI_DESIGN_PASS', 'SITES_STYLE_LIBRARY', 'SITES_ARI_ADD_PAGE') AND (
    COALESCE((SELECT f.is_enabled FROM public.feature_flags f WHERE f.flag_key = p_flag LIMIT 1), false)
    OR EXISTS (SELECT 1 FROM public.brand_site_flag_brands l
               WHERE l.flag_key = p_flag AND l.brand_id = p_brand_id));
$function$;

COMMENT ON FUNCTION public.brand_site_flag_on(text, uuid) IS
  '#4453 milestones 7 and 11 — SITES_ARI_DESIGN_PASS, SITES_STYLE_LIBRARY or SITES_ARI_ADD_PAGE is on for this brand: the flag is on, or the brand is in brand_site_flag_brands. Any other key is false. Service role only.';

REVOKE ALL ON FUNCTION public.brand_site_flag_on(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_flag_on(text, uuid) TO service_role;

-- ── 4. The owner's Ari-page content actions (content minimum) ──────────────
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
      'review_status','mark_reviewed',
      -- #4453 milestone 11 — answer Ari's question, publish or remove a Draft page from Ari (spec v2.1 §3.2-§3.3).
      'ari_page_answer','ari_page_accept','ari_page_remove'
    ) THEN 20
    -- Only brand admins and owners confirm a review is real (§37 answer 2)
    -- and hide a past trip from the website (§37 answer 3).
    WHEN p_action IN ('confirm_review','set_offering_visibility') THEN 50
    ELSE NULL
  END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_content_min_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_content_min_rank(text) TO authenticated, service_role;

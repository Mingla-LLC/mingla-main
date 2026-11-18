-- Issue #3645 bundle 2A — a paid per-stop experience whose stops total 0 is
-- refused instead of silently publishing free.
--
-- biz_create_experience, biz_publish_experience and biz_update_live_experience
-- refused a paid experience whose one ticket resolves to 0 only in
-- whole-price mode. In per-stop mode, stops totalling 0 (an empty price counts
-- as 0) with is_free false went through, and
-- issue_3281_apply_experience_price_options wrote the ticket as is_free = true:
-- a paid experience became free without the host marking it free. All three
-- now raise experience_price_invalid in any pricing mode. The Host wizard
-- already words it ("Set a valid price, or mark the experience free."); Ari's
-- refusal copy gains it in the same change. Free experiences, and drafts saved
-- without publishing, are unchanged.
--
-- Each function's LIVE body is patched in place, one line each (the same
-- pattern as #4420's pg_temp.issue_4420_patch), so earlier in-place patches
-- such as #4420's stored area line are kept. CREATE OR REPLACE from the
-- function's own definition keeps grants and owners.
-- Declared patches: __tests__/issue_3645_per_stop_price_reemit_hunks.ts.
-- Proofs: __tests__/issue_3645_per_stop_paid_price.pg17.test.sql.

BEGIN;

-- Apply order. Each source migration must already be live:
-- biz_publish_experience's latest body comes from 20280625003281 (#3281
-- bundle 6) and biz_update_live_experience's from 20280428003645. Patched
-- before them, the later source migration would re-create the function and
-- silently put the old rule back. Refuse instead.
DO $precondition$
BEGIN
  IF to_regprocedure('public.issue_3281_event_date_deletable(uuid)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = to_regprocedure('public.biz_publish_experience(uuid,jsonb,boolean)')
          AND p.prosrc LIKE '%experience_dates_have_sales%'
     ) THEN
    RAISE EXCEPTION 'issue_3645_2a_requires_20280625003281'
      USING HINT = 'Apply 20280625003281_issue_3281_dates_never_orphan.sql first.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = to_regprocedure('public.biz_update_live_experience(uuid,jsonb,text)')
          AND p.prosrc LIKE '%a paid whole-price experience edited to 0%'
     ) THEN
    RAISE EXCEPTION 'issue_3645_2a_requires_20280428003645'
      USING HINT = 'Apply 20280428003645_issue_3645_sell_publish_integrity.sql first.';
  END IF;
END
$precondition$;

-- Replaces p_old with p_new in the live definition. Refuses unless p_old
-- occurs exactly p_expected times; a no-op once applied (re-apply safe).
CREATE OR REPLACE FUNCTION pg_temp.issue_3645_2a_patch(
  p_signature text,
  p_old text,
  p_new text,
  p_expected integer
) RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_def text;
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_def := pg_get_functiondef(p_signature::regprocedure);
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_old_count = 0 AND v_new_count = p_expected THEN
    RETURN;
  END IF;
  IF v_old_count <> p_expected THEN
    RAISE EXCEPTION 'issue_3645_2a_shape_mismatch: % expected % match(es), found %',
      p_signature, p_expected, v_old_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END
$function$;

-- biz_create_experience: creating straight to published refuses a paid per-stop experience at 0 too.
SELECT pg_temp.issue_3645_2a_patch(
  'public.biz_create_experience(uuid,jsonb,boolean)',
  $old$  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND p_publish AND v_resolved_total <= 0 THEN
$old$,
  $new$  -- issue #3645 bundle 2A: per-stop as well as whole price, the same rule
  -- as biz_publish_experience. Every known caller creates a draft
  -- (p_publish = false); this keeps a direct publish from turning free.
  IF (NOT v_is_free) AND p_publish AND v_resolved_total <= 0 THEN
$new$,
  1
);

-- biz_publish_experience: a paid per-stop experience whose stops total 0 is refused, not published free.
SELECT pg_temp.issue_3645_2a_patch(
  'public.biz_publish_experience(uuid,jsonb,boolean)',
  $old$  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND p_publish AND v_resolved_total <= 0 THEN
$old$,
  $new$  -- issue #3645 bundle 2A: any paid experience whose one ticket resolves to
  -- 0 is refused, per-stop as well as whole price. A per-stop experience
  -- whose stops total 0 used to publish with a free ticket while not marked
  -- free. Marking it free is the way to make it free.
  IF (NOT v_is_free) AND p_publish AND v_resolved_total <= 0 THEN
$new$,
  1
);

-- biz_update_live_experience: a live paid per-stop experience can't be saved with stops totalling 0.
SELECT pg_temp.issue_3645_2a_patch(
  'public.biz_update_live_experience(uuid,jsonb,text)',
  $old$  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND v_resolved_total <= 0 THEN
$old$,
  $new$  -- issue #3645 bundle 2A: per-stop too. Stops totalling 0 on a paid
  -- experience would rewrite its ticket as free while not marked free.
  IF (NOT v_is_free) AND v_resolved_total <= 0 THEN
$new$,
  1
);

COMMIT;

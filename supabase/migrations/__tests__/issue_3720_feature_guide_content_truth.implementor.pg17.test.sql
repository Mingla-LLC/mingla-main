-- #3720 — Feature Guide content truth after a full migration replay.
-- MINGLA-INVARIANT: I-3720-FEATURE-GUIDE-CONTENT-TRUTH | issue #3720 | Feature Guide entries carry no generated placeholder wording; content corrections never edit a human-verified Live entry, never add live proof, and never change how many entries are claimed and effectively Live.
\set ON_ERROR_STOP on
BEGIN;

DO $proof$
DECLARE
  v_bad text;
  v_count integer;
BEGIN
  IF (SELECT count(*) FROM public.product_capabilities) < 152 THEN
    RAISE EXCEPTION 'feature_guide_catalog_missing_rows';
  END IF;

  SELECT string_agg(capability_key, ', ' ORDER BY capability_key) INTO v_bad
    FROM public.product_capabilities
   WHERE concat_ws(' ', title, outcome_summary, how_to, limitations, support_wording)
         ILIKE ANY (ARRAY[
           '%follow the on-screen%',
           '%complete this job through%',
           '%Support must use the current evidence status%',
           '%Check the cited evidence before describing%'
         ]);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'template_wording_remains: %', v_bad;
  END IF;

  IF (SELECT count(*) FROM public.product_capabilities
       WHERE capability_key IN ('events-invite-people', 'trips-cancel-booking')
         AND claimed_status = 'planned'
         AND public.issue_3720_feature_guide_effective_status(id) = 'Planned') <> 2 THEN
    RAISE EXCEPTION 'planned_status_corrections_missing';
  END IF;
  IF (SELECT claimed_status FROM public.product_capabilities
       WHERE capability_key = 'staff-sites-ops') <> 'live' THEN
    RAISE EXCEPTION 'staff_sites_ops_status_changed';
  END IF;

  -- [TEST-MOD-APPROVED #4179] #3720 left these three human-verified entries
  -- untouched. Later governed reconciliations may revise their truth and
  -- invalidate stale evidence, so the durable proof is that #3720 itself did
  -- not audit a rewrite; they must still retain their claimed Live state.
  IF (SELECT count(*) FROM public.product_capabilities
       WHERE capability_key IN ('official-brand-groups', 'brand-files-and-guides', 'product-inbox-avengers')
         AND claimed_status = 'live') <> 3 THEN
    RAISE EXCEPTION 'protected_live_entries_demoted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_truth_audit a
      JOIN public.product_capabilities c ON c.id = a.capability_id
     WHERE c.capability_key IN ('official-brand-groups', 'brand-files-and-guides', 'product-inbox-avengers')
       AND a.metadata->>'source' = 'issue_3720_feature_guide_content_truth'
  ) THEN
    RAISE EXCEPTION 'protected_live_entries_audited_as_changed';
  END IF;
  IF (SELECT count(*) FROM public.product_capabilities
       WHERE claimed_status = 'live'
         AND public.issue_3720_feature_guide_effective_status(id) = 'Live'
         -- [TEST-MOD-APPROVED #3980] #3980 F1 turns the Work board and Agent log Live with their 20 Oct release evidence
         AND capability_key NOT IN ('official-brand-groups', 'brand-files-and-guides', 'product-inbox-avengers', 'staff-work-board', 'staff-agent-log')) <> 0 THEN
    RAISE EXCEPTION 'content_correction_promoted_an_entry';
  END IF;

  -- Corrected facts are present.
  IF NOT EXISTS (
    SELECT 1 FROM public.product_capabilities
     WHERE capability_key = 'marketing-contact-import'
       AND limitations ILIKE '%switched on in production%'
       AND limitations NOT ILIKE '%Off by default%'
  ) THEN
    RAISE EXCEPTION 'contact_import_fact_not_corrected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_capabilities
     WHERE capability_key = 'plus-subscription'
       AND limitations ILIKE '%promotion%'
  ) THEN
    RAISE EXCEPTION 'plus_promotion_fact_missing';
  END IF;

  -- A sample of evidence corrections is current, verified, and the old pin is retired.
  SELECT count(*) INTO v_count
    FROM public.product_capability_evidence e
    JOIN public.product_capabilities c ON c.id = e.capability_id
   WHERE e.is_current AND e.verdict = 'verified'
     AND e.evidence_url LIKE 'https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/%'
     AND (
       (c.capability_key = 'staff-people-brands' AND e.evidence_kind = 'source'
         AND e.evidence_url LIKE '%/mingla-admin/src/pages/BrandsConsolePage.jsx')
       OR (c.capability_key = 'web-download' AND e.evidence_kind = 'source'
         AND e.evidence_url LIKE '%/mingla-marketing/app/download/page.tsx')
       OR (c.capability_key = 'staff-stripe-tools' AND e.evidence_kind = 'test'
         AND e.evidence_url LIKE '%/mingla-admin/src/__tests__/orch1278_money_console_act.test.js')
       OR (c.capability_key = 'payouts-timing' AND e.evidence_kind = 'migration'
         AND e.evidence_url LIKE '%/supabase/migrations/20271107003872_issue_3872_money_truth.sql')
     );
  IF v_count <> 4 THEN RAISE EXCEPTION 'evidence_corrections_not_current: %', v_count; END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_capability_evidence e
      JOIN public.product_capabilities c ON c.id = e.capability_id
     WHERE c.capability_key = 'staff-people-brands' AND e.is_current
       AND e.evidence_url LIKE '%UserManagementPage.jsx'
  ) THEN
    RAISE EXCEPTION 'wrong_evidence_still_current';
  END IF;
  IF (SELECT count(*) FROM public.product_capability_evidence
       WHERE details = 'Corrected pinned source evidence at 52cb689.' AND is_current) < 20 THEN
    RAISE EXCEPTION 'corrected_source_evidence_missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_capability_evidence
     WHERE details LIKE 'Corrected pinned % evidence at 52cb689.'
       AND evidence_kind IN ('live_check', 'release_record', 'deployment')
  ) THEN
    RAISE EXCEPTION 'content_correction_recorded_live_proof';
  END IF;
  IF (SELECT count(*) FROM public.product_truth_audit
       WHERE metadata->>'source' = 'issue_3720_feature_guide_content_truth'
         AND action = 'evidence_recorded') < 30 THEN
    RAISE EXCEPTION 'evidence_audit_missing';
  END IF;
END;
$proof$;

ROLLBACK;

-- #4179 — Feature Guide reconciliation after a full migration replay.
-- MINGLA-INVARIANT: I-4179-FEATURE-GUIDE-EVERY-MERGE | issue #4179 | Every first-parent merge after #3982 through #4178 is classified exactly once and every referenced capability exists after reconciliation.
-- MINGLA-INVARIANT: I-4179-FEATURE-GUIDE-REWRITES-FAIL-CLOSED | issue #4179 | Rewritten truth cannot remain Live on superseded time-dependent proof.
\set ON_ERROR_STOP on
BEGIN;

DO $proof$
DECLARE v_text text;
BEGIN
  IF (SELECT count(*) FROM public.product_capabilities) <> 159 THEN
    RAISE EXCEPTION 'issue4179_catalog_count:%', (SELECT count(*) FROM public.product_capabilities);
  END IF;
  IF (SELECT count(*) FROM public.product_capabilities
       WHERE capability_key IN ('account-app-updates','brand-customer-enquiries','staff-mingla-money','web-blog')) <> 4 THEN
    RAISE EXCEPTION 'issue4179_new_entries_missing';
  END IF;
  IF (SELECT count(*) FROM public.product_truth_audit
       WHERE metadata->>'source' = 'issue_4179_feature_guide_merge_reconciliation'
         AND action = 'capability_saved') <> 32 THEN
    RAISE EXCEPTION 'issue4179_saved_audit_count';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_capabilities c
     WHERE c.capability_key IN (
       'account-settings','brand-files-and-guides','brand-profile','checkout-trips-experiences',
       'discover-events','discover-stays','discover-swipe-deck','discover-trips',
       'marketing-analytics','marketing-host-ads','official-brand-groups','programs-creators',
       'sites-brand-website','social-chat','social-collab-decide','staff-ads',
       'staff-community-support','staff-data-room','staff-drafts','staff-email','staff-health',
       'staff-offerings','staff-orders-money','staff-people-brands','staff-sites-ops',
       'staff-work-board','staff-mingla-money','trips-installments','web-blog','brand-customer-enquiries'
     )
       AND c.claimed_status = 'live'
       AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live'
  ) THEN
    RAISE EXCEPTION 'issue4179_rewritten_entry_still_live';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_capabilities
     WHERE capability_key = 'events-ticket-transfers'
       AND claimed_status = 'planned'
       AND public.issue_3720_feature_guide_effective_status(id) = 'Planned'
       AND outcome_summary ILIKE '%send an eligible extra ticket%'
  ) THEN
    RAISE EXCEPTION 'issue4179_ticket_transfer_not_planned_honestly';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_capabilities
     WHERE capability_key = 'account-app-updates'
       AND claimed_status = 'planned'
       AND required_evidence_kinds = ARRAY['source','test','app_release','live_check']
  ) THEN
    RAISE EXCEPTION 'issue4179_app_update_release_gate_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_capabilities
     WHERE capability_key = 'sites-brand-website'
       AND claimed_status = 'live'
       AND outcome_summary ILIKE '%Every active brand%'
       AND limitations ILIKE '%does not mean a site exists%'
  ) THEN
    RAISE EXCEPTION 'issue4179_sites_ga_truth_missing';
  END IF;
  IF (SELECT count(*) FROM public.product_capabilities
       WHERE capability_key IN ('discover-events','discover-stays','discover-swipe-deck','discover-trips')
         AND limitations ILIKE '%staff%test%demo%'
         AND limitations ILIKE '%excluded%') <> 4 THEN
    RAISE EXCEPTION 'issue4179_internal_brand_discovery_truth_missing';
  END IF;
  SELECT concat_ws(' ', title, outcome_summary, how_to, limitations, support_wording)
    INTO v_text FROM public.product_capabilities WHERE capability_key = 'trips-installments';
  IF v_text NOT ILIKE '%eligible Nigerian Paystack%'
     OR v_text ILIKE '%Paystack) brands cannot%'
     OR v_text ILIKE '%not available for brands paid out in Nigeria%' THEN
    RAISE EXCEPTION 'issue4179_paystack_truth_stale';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_capability_evidence e
    JOIN public.product_capabilities c ON c.id = e.capability_id
    WHERE c.capability_key IN ('sites-brand-website','programs-creators','trips-installments','web-blog')
      AND e.is_current
      AND e.evidence_kind IN ('release_record','feature_flag','deployment','app_release','live_check')
  ) THEN
    RAISE EXCEPTION 'issue4179_time_dependent_proof_carried_forward';
  END IF;
  IF (SELECT count(*) FROM public.product_capability_evidence e
      JOIN public.product_capabilities c ON c.id = e.capability_id
      WHERE c.capability_key IN ('account-app-updates','brand-customer-enquiries','staff-mingla-money','web-blog')
        AND e.is_current AND e.verdict = 'verified') <> 14 THEN
    RAISE EXCEPTION 'issue4179_static_evidence_count';
  END IF;
END;
$proof$;

ROLLBACK;
\echo 'ISSUE-4179 FEATURE GUIDE MERGE RECONCILIATION PASS'

-- #3827 — the four comp/check-in Feature Guide entries are rewritten through the
-- governed #3720 path even when a person has verified them as Live (production).
-- MINGLA-INVARIANT: I-3827-GUIDE-LIVE-REVERIFY | issue #3827 | rewriting a human-verified Live Feature Guide entry first records a current conflict so it reads Needs review; the rewrite never records verified evidence, never changes claimed status or the verification date, and only a person's new verified proof makes it Live again (A-F)
--
-- The replay leaves these entries Needs review, so this suite rebuilds the
-- production state first: each entry claimed live, every required proof current
-- and verified, verification due in the future, old phone-only wording. It then
-- re-applies 20271128053827 and checks the result. The migration is applied a
-- last time at the end so later suites see the replay's end state (Needs review).
\set ON_ERROR_STOP on

-- Production state: four human-verified Live entries with the old wording.
DO $live_like_production$
DECLARE
  v_cap record;
  v_kind text;
BEGIN
  FOR v_cap IN
    SELECT id, required_evidence_kinds FROM public.product_capabilities
     WHERE capability_key IN ('events-comp-guests','events-check-in','events-guest-list','events-reconciliation')
  LOOP
    FOREACH v_kind IN ARRAY v_cap.required_evidence_kinds LOOP
      UPDATE public.product_capability_evidence SET is_current = false
       WHERE capability_id = v_cap.id AND evidence_kind = v_kind AND is_current;
      INSERT INTO public.product_capability_evidence(
        capability_id, evidence_kind, evidence_url, verdict, details, observed_at)
      VALUES (v_cap.id, v_kind, 'https://github.com/Mingla-LLC/mingla-main/issues/3720#issuecomment-6272826950',
              'verified', 'issue-3827 suite: production-like human proof', now() - interval '1 day');
    END LOOP;
    UPDATE public.product_capabilities
       SET claimed_status = 'live', verification_due_at = now() + interval '90 days',
           how_to = 'Tap a guest and use "Mark checked in". Old phone-only wording.',
           limitations = 'Comp guests are saved only on the phone or browser where they were added. The guest gets no ticket, no QR code and no email.'
     WHERE id = v_cap.id;
  END LOOP;
END;
$live_like_production$;

CREATE TEMP TABLE issue_3827_suite_before AS
SELECT c.id, c.capability_key, c.claimed_status, c.verification_due_at,
       public.issue_3720_feature_guide_effective_status(c.id) AS effective_status
  FROM public.product_capabilities c;
CREATE TEMP TABLE issue_3827_suite_verified_before AS
SELECT count(*)::integer AS n FROM public.product_capability_evidence WHERE verdict = 'verified';

DO $precondition$
BEGIN
  IF (SELECT count(*) FROM issue_3827_suite_before
       WHERE capability_key IN ('events-comp-guests','events-check-in','events-guest-list','events-reconciliation')
         AND effective_status = 'Live') <> 4 THEN
    RAISE EXCEPTION 'suite setup: the four entries are not Live';
  END IF;
END;
$precondition$;

\ir ../20271128053827_issue_3827_guide_live_entries_reverify.sql

DO $proof$
BEGIN
  -- A: all four read Needs review, so the team assistant treats them as unverified.
  IF (SELECT count(*) FROM public.product_capabilities
       WHERE capability_key IN ('events-comp-guests','events-check-in','events-guest-list','events-reconciliation')
         AND public.issue_3720_feature_guide_effective_status(id) = 'Needs review') <> 4 THEN
    RAISE EXCEPTION 'A the rewritten entries are not Needs review';
  END IF;

  -- B: each carries one current live_check conflict citing PR #4013; the person's
  -- earlier verified live check is kept as history, not deleted.
  IF (SELECT count(*) FROM public.product_capability_evidence e
        JOIN public.product_capabilities c ON c.id = e.capability_id
       WHERE c.capability_key IN ('events-comp-guests','events-check-in','events-guest-list','events-reconciliation')
         AND e.is_current AND e.evidence_kind = 'live_check' AND e.verdict = 'conflict'
         AND e.evidence_url = 'https://github.com/Mingla-LLC/mingla-main/pull/4013') <> 4 THEN
    RAISE EXCEPTION 'B conflict proof missing';
  END IF;
  IF (SELECT count(DISTINCT e.capability_id) FROM public.product_capability_evidence e
        JOIN public.product_capabilities c ON c.id = e.capability_id
       WHERE c.capability_key IN ('events-comp-guests','events-check-in','events-guest-list','events-reconciliation')
         AND NOT e.is_current AND e.evidence_kind = 'live_check' AND e.verdict = 'verified'
         AND e.details = 'issue-3827 suite: production-like human proof') <> 4 THEN
    RAISE EXCEPTION 'B the earlier human live check was not kept as history';
  END IF;

  -- C: no verified proof added, no claim or verification date moved, no other entry changed status.
  IF (SELECT count(*)::integer FROM public.product_capability_evidence WHERE verdict = 'verified')
     <> (SELECT n FROM issue_3827_suite_verified_before) THEN
    RAISE EXCEPTION 'C verified proof count changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM issue_3827_suite_before b JOIN public.product_capabilities c ON c.id = b.id
     WHERE c.claimed_status IS DISTINCT FROM b.claimed_status
        OR c.verification_due_at IS DISTINCT FROM b.verification_due_at
        OR (b.capability_key NOT IN ('events-comp-guests','events-check-in','events-guest-list','events-reconciliation')
            AND public.issue_3720_feature_guide_effective_status(c.id) IS DISTINCT FROM b.effective_status)
  ) THEN
    RAISE EXCEPTION 'C a claim, date or another entry changed';
  END IF;

  -- D: the new wording is in place and the phone-only wording is gone.
  IF EXISTS (
    SELECT 1 FROM public.product_capabilities
     WHERE capability_key IN ('events-comp-guests','events-check-in','events-guest-list','events-reconciliation')
       AND concat_ws(' ', outcome_summary, how_to, limitations, support_wording)
           ILIKE ANY (ARRAY['%Mark checked in%', '%saved only on the phone or browser%', '%no ticket, no QR%'])
  ) THEN
    RAISE EXCEPTION 'D old phone-only wording remains';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_capabilities
                  WHERE capability_key = 'events-comp-guests'
                    AND outcome_summary ILIKE '%real free ticket with its own QR code%'
                    AND limitations ILIKE '%door staff find them by name%'
                    AND support_wording ILIKE '%never appear in revenue or payouts%')
     OR NOT EXISTS (SELECT 1 FROM public.product_capabilities
                     WHERE capability_key = 'events-check-in'
                       AND how_to ILIKE '%Find a guest by name%'
                       AND support_wording ILIKE '%stored on Mingla''s server%')
     OR NOT EXISTS (SELECT 1 FROM public.product_capabilities
                     WHERE capability_key = 'events-reconciliation'
                       AND how_to ILIKE '%Comps, TOTAL LIVE%'
                       AND limitations ILIKE '%guest-list tickets come from Mingla''s server%') THEN
    RAISE EXCEPTION 'D new wording missing';
  END IF;

  -- Both steps are audited under this migration.
  IF (SELECT count(*) FROM public.product_truth_audit
       WHERE metadata->>'source' = 'issue_3827_guide_live_entries_reverify'
         AND action = 'evidence_recorded') < 4
     OR (SELECT count(*) FROM public.product_truth_audit
          WHERE metadata->>'source' = 'issue_3827_guide_live_entries_reverify'
            AND action = 'capability_saved') < 4 THEN
    RAISE EXCEPTION 'D audit rows missing';
  END IF;
END;
$proof$;

-- E: a re-run changes nothing.
CREATE TEMP TABLE issue_3827_suite_evidence_rows AS
SELECT count(*)::integer AS n FROM public.product_capability_evidence;
\ir ../20271128053827_issue_3827_guide_live_entries_reverify.sql
DO $rerun$
BEGIN
  IF (SELECT count(*)::integer FROM public.product_capability_evidence)
     <> (SELECT n FROM issue_3827_suite_evidence_rows) THEN
    RAISE EXCEPTION 'E a re-run recorded more evidence';
  END IF;
END;
$rerun$;

-- F: a person's new verified live check (what Admin "Add evidence" records) is
-- the only thing that makes an entry Live again.
DO $person_reverifies$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.product_capabilities WHERE capability_key = 'events-comp-guests';
  UPDATE public.product_capability_evidence SET is_current = false
   WHERE capability_id = v_id AND evidence_kind = 'live_check' AND is_current;
  INSERT INTO public.product_capability_evidence(
    capability_id, evidence_kind, evidence_url, verdict, details, observed_at)
  VALUES (v_id, 'live_check', 'https://github.com/Mingla-LLC/mingla-main/issues/3827',
          'verified', 'issue-3827 suite: person re-verified the new wording', now());
  IF public.issue_3720_feature_guide_effective_status(v_id) <> 'Live' THEN
    RAISE EXCEPTION 'F a person''s verified live check did not restore Live';
  END IF;
END;
$person_reverifies$;

-- Leave the replay's end state for later suites: Needs review, new wording.
\ir ../20271128053827_issue_3827_guide_live_entries_reverify.sql
DROP TABLE issue_3827_suite_before, issue_3827_suite_verified_before, issue_3827_suite_evidence_rows;

\echo 'issue_3827_guide_live_entries.implementor.happy.pg17: PASS'

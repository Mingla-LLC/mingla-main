-- Issue #3980 — the Feature Guide entries for the Work board, the Agent log,
-- To review and the Calendar, after a full migration replay.
-- Proves: the five existing staff entries carry their new names and text,
-- each went up exactly one revision with one audit row from this change and
-- kept its status; the Work board and Agent log entries exist, planned, with
-- the evidence a later release must add; none of the seven uses template or
-- banned wording; the Agent log entry says plainly which refused changes do
-- not show in the feed; nothing became Live. Everything is rolled back.
\set ON_ERROR_STOP on
BEGIN;

DO $proof3980$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(k || '=' || coalesce(c.title, '<missing>'), '; ') INTO v_bad
    FROM (VALUES ('staff-drafts', 'To review: messages to send, spend and publish approvals'),
                 ('staff-content-calendar', 'Calendar: events, go-live deadlines, promotions and content'),
                 ('staff-crm', 'Host and creator pipelines'),
                 ('staff-my-agent', 'My agent: connect your own Claude or Codex'),
                 ('staff-team-roles', 'Invite teammates and set roles'),
                 ('staff-work-board', 'Work board: plan, assign and close team work with agents'),
                 ('staff-agent-log', 'Agent log: what every connected agent is doing')) AS w(k, t)
    LEFT JOIN public.product_capabilities c ON c.capability_key = w.k
   WHERE c.title IS DISTINCT FROM w.t;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'issue3980_guide_titles: %', v_bad; END IF;

  -- one audit row per entry from this change, at the entry's current revision
  SELECT string_agg(c.capability_key, ', ') INTO v_bad
    FROM public.product_capabilities c
   WHERE c.capability_key IN ('staff-drafts','staff-content-calendar','staff-crm','staff-my-agent','staff-team-roles','staff-work-board','staff-agent-log')
     AND (SELECT count(*) FROM public.product_truth_audit a
           WHERE a.capability_id = c.id AND a.metadata->>'source' = 'issue_3980_ops_board_feature_guide'
             AND (a.metadata->>'revision')::integer = c.revision AND a.metadata->>'issue' = '3980') <> 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'issue3980_guide_audit: %', v_bad; END IF;

  -- the five existing entries kept their status, and this change is their
  -- newest saved revision
  SELECT string_agg(c.capability_key, ', ') INTO v_bad
    FROM public.product_capabilities c
   WHERE c.capability_key IN ('staff-drafts','staff-content-calendar','staff-crm','staff-my-agent','staff-team-roles')
     AND (c.claimed_status <> 'live'
          OR (SELECT max((a.metadata->>'revision')::integer) FROM public.product_truth_audit a
               WHERE a.capability_id = c.id AND a.action = 'capability_saved') <> c.revision
          OR (SELECT a.metadata->>'source' FROM public.product_truth_audit a
               WHERE a.capability_id = c.id ORDER BY a.id DESC LIMIT 1)
             <> 'issue_3980_ops_board_feature_guide');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'issue3980_guide_revision_or_status: %', v_bad; END IF;

  -- the two new entries: planned, with the proof a release must add, not Live
  SELECT string_agg(c.capability_key, ', ') INTO v_bad
    FROM public.product_capabilities c
   WHERE c.capability_key IN ('staff-work-board','staff-agent-log')
     AND (c.claimed_status <> 'planned' OR c.revision <> 1
          OR c.required_evidence_kinds <> ARRAY['source','test','live_check','release_record']
          OR public.issue_3720_feature_guide_effective_status(c.id) = 'Live'
          OR EXISTS (SELECT 1 FROM public.product_capability_evidence e WHERE e.capability_id = c.id));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'issue3980_guide_new_entries: %', v_bad; END IF;
  IF (SELECT count(*) FROM public.product_capabilities WHERE capability_key IN ('staff-work-board','staff-agent-log')) <> 2 THEN
    RAISE EXCEPTION 'issue3980_guide_new_entries_missing';
  END IF;

  -- no template or banned wording in any of the seven
  SELECT string_agg(c.capability_key, ', ') INTO v_bad
    FROM public.product_capabilities c
   WHERE c.capability_key IN ('staff-drafts','staff-content-calendar','staff-crm','staff-my-agent','staff-team-roles','staff-work-board','staff-agent-log')
     AND concat_ws(' ', c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording)
         ILIKE ANY (ARRAY['%follow the on-screen%', '%complete this job through%', '%Support must use the current evidence status%',
                          '%Check the cited evidence before describing%', '%brand groups%', '%verified test%']);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'issue3980_guide_wording: %', v_bad; END IF;

  -- the honest limits
  IF NOT EXISTS (SELECT 1 FROM public.product_capabilities WHERE capability_key = 'staff-agent-log'
                   AND limitations LIKE '%are told only to the agent that tried them and do not appear in the feed.%') THEN
    RAISE EXCEPTION 'issue3980_guide_agent_log_limit_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_capabilities WHERE capability_key = 'staff-team-roles'
                   AND limitations LIKE 'Team and roles is Owner only;%Removing access also turns off that person''s agent keys. Every active teammate role can use the Work board, Agent log, To review and Calendar.%') THEN
    RAISE EXCEPTION 'issue3980_guide_team_roles_limit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_capabilities WHERE capability_key = 'staff-drafts'
                   AND how_to LIKE '1. In Mingla Admin, open Pipeline > To review.%' AND how_to LIKE '%"Approve spend"%') THEN
    RAISE EXCEPTION 'issue3980_guide_to_review_steps';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_capabilities WHERE capability_key = 'staff-content-calendar'
                   AND how_to LIKE '1. In Mingla Admin, open Pipeline > Calendar.%' AND how_to LIKE '%"Plan this launch"%') THEN
    RAISE EXCEPTION 'issue3980_guide_calendar_steps';
  END IF;

  -- nothing became Live: the only effectively Live entries after a replay are
  -- the three human-verified ones
  IF (SELECT count(*) FROM public.product_capabilities c
       WHERE c.claimed_status = 'live' AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live'
         AND c.capability_key NOT IN ('official-brand-groups', 'brand-files-and-guides', 'product-inbox-avengers')) <> 0 THEN
    RAISE EXCEPTION 'issue3980_guide_promoted_an_entry';
  END IF;
END;
$proof3980$;

ROLLBACK;
\echo 'ISSUE-3980 FEATURE GUIDE PASS'

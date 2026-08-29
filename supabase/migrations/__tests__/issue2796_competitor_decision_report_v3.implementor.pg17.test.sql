BEGIN;

DO $proof$
DECLARE
  evidence jsonb := '[{"id":"e1","source_id":"11111111-1111-4111-8111-111111111111","public_url":"https://example.com","checked_at":"2026-08-29T00:00:00Z","observation":"Public menu"}]';
  why jsonb := '[{"text":"This may matter.","evidence_ids":["e1"],"confidence":"interpretation"}]';
  actions jsonb := '[{"id":"a1","text":"Publish an offer.","kind":"event","confidence":"suggested_action","is_primary":true}]';
  report jsonb := '{
    "decision":{"class":"act","confidence":"medium","headline":"A visible offer is active","rationale":"Respond with a verified offer.","signal_ids":["s1"],"owner_fact_ids":["o1"]},
    "signals":[{"id":"s1","kind":"website","derivation":"deterministic","dimension":"positioning","label":"Website positioning","summary":"Public menu","source_id":"11111111-1111-4111-8111-111111111111","evidence_ids":["se1"],"metrics":{"posts_7d":null,"posts_28d":null,"images_28d":null,"videos_28d":null},"changed_paths":[]}],
    "signal_evidence":[{"id":"se1","source_id":"11111111-1111-4111-8111-111111111111","source_url":"https://example.com","observation":"Public menu","checked_at":"2026-08-29T00:00:00Z","observed_at":null}],
    "interpretation_meta":[{"index":0,"signal_type":"threat","confidence":"medium","priority":"high","signal_ids":["s1"],"owner_fact_ids":["o1"]}],
    "comparisons":[{"id":"c1","dimension":"positioning","owner_text":"No matched positioning fact","competitor_text":"Public menu","outcome":"not_comparable","confidence":"low","signal_ids":["s1"],"owner_fact_ids":[]}],
    "action_plan":[{"index":0,"action_id":"a1","timeframe":"this_week","impact":"high","confidence":"medium","order":1,"is_primary":true,"signal_ids":["s1"],"owner_fact_ids":["o1"]}],
    "owner_facts":[{"id":"o1","kind":"listing_category","entity_id":"22222222-2222-4222-8222-222222222222","dimension":"category","text":"restaurant"}]
  }';
BEGIN
  IF NOT public.issue_2796_valid_decision_report(report, '[]'::jsonb, why, actions, evidence) THEN
    RAISE EXCEPTION 'canonical issue2796 report rejected';
  END IF;
  IF public.issue_2796_valid_decision_report(report || '{"unknown":true}'::jsonb, '[]'::jsonb, why, actions, evidence) THEN
    RAISE EXCEPTION 'unknown root key accepted';
  END IF;
  IF public.issue_2796_valid_decision_report(jsonb_set(report, '{signals,0,evidence_ids}', '["missing"]'), '[]'::jsonb, why, actions, evidence) THEN
    RAISE EXCEPTION 'dangling evidence reference accepted';
  END IF;
  IF public.issue_2796_valid_decision_report(jsonb_set(report, '{comparisons,0,outcome}', '"owner_advantage"'), '[]'::jsonb, why, actions, evidence) THEN
    RAISE EXCEPTION 'owner advantage without matched owner side accepted';
  END IF;
  IF public.issue_2796_valid_decision_report(jsonb_set(report, '{signal_evidence,0,source_url}', '"javascript:alert(1)"'), '[]'::jsonb, why, actions, evidence) THEN
    RAISE EXCEPTION 'invalid source URL accepted';
  END IF;
  IF public.issue_2796_valid_decision_report(jsonb_set(report, '{signal_evidence,0,checked_at}', '"2026-99-99T00:00:00Z"'), '[]'::jsonb, why, actions, evidence) THEN
    RAISE EXCEPTION 'invalid timestamp accepted';
  END IF;
  IF has_function_privilege('anon','public.issue_2796_valid_decision_report(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_2796_valid_decision_report(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'client execute grant leaked';
  END IF;
END
$proof$;

ROLLBACK;

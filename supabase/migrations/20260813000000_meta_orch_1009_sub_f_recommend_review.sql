-- META-ORCH-1009 Sub-F — Recommend-me review: edit cap + admin score veto.
--
-- WS7. Two additive columns on place_pool:
--   business_recommend_edit_count — how many times the operator has run
--     "Recommend me" (cap: initial + 3 changes; reset to 0 on admin rejection so
--     they can fix and resubmit).
--   ai_signal_scores_veto — admin reduce-only adjustments to AI signal scores,
--     applied at go-live. Shape:
--       { "<signal_id>": { vetoed_score: int, original_score: int,
--                          reason: text, vetoed_at: timestamptz, vetoed_by: uuid } }
--
-- Go-live (is_servable=true), veto application, place_scores trigger, and the
-- reject edit-count reset are done in the admin-review-venue-claim edge function
-- (service role) after biz_review_venue_claim succeeds — NOT in the RPC — to
-- avoid changing the RPC's argument signature. Additive + idempotent.

alter table public.place_pool
  add column if not exists business_recommend_edit_count integer not null default 0;

alter table public.place_pool
  add column if not exists ai_signal_scores_veto jsonb;

comment on column public.place_pool.business_recommend_edit_count is
  'META-ORCH-1009 Sub-F — count of operator "Recommend me" runs (initial + up to 3 '
  'changes; reset to 0 on admin rejection).';
comment on column public.place_pool.ai_signal_scores_veto is
  'META-ORCH-1009 Sub-F — admin reduce-only signal-score adjustments applied at '
  'go-live: {<signal_id>:{vetoed_score,original_score,reason,vetoed_at,vetoed_by}}.';

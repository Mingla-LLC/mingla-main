-- ORCH-0634 — Deprecation comments on card_pool, card_pool_stops, query_pool_cards
--
-- Signals to anyone opening psql or reading pg_dump that these are no longer
-- on any serving path. ORCH-0640 (parallel architectural-demolition track)
-- will physically DROP them in a follow-on cutover. No schema/data changes here.
--
-- Idempotent.

COMMENT ON TABLE public.card_pool IS
  'DEPRECATED 2026-04-22 (ORCH-0634). NO serving code reads or writes to this table.
Singles + curated stops resolve through place_scores + place_pool only. Scheduled
for DROP in ORCH-0640 cleanup. Do NOT add new callers.';

COMMENT ON TABLE public.card_pool_stops IS
  'DEPRECATED 2026-04-22 (ORCH-0634). Curated cards are now assembled fresh per
request — no on-disk stop linkage. Scheduled for DROP in ORCH-0640. Do NOT add
new callers.';

COMMENT ON FUNCTION public.query_pool_cards IS
  'DEPRECATED 2026-04-22 (ORCH-0634). Replaced by query_servable_places_by_signal.
Kept callable until ORCH-0640 cleanup session, but produces no new traffic from
discover-cards or generate-curated-experiences.';

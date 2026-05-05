-- ORCH-0588 Slice 1 cleanup — delete 2 dead Raleigh Planet Fitness Romantic curated cards.
-- Per ORCH-0550.3A investigation: these cards have stops with ai_approved=false (Planet
-- Fitness rejected by Rules Filter as 'gym in fitness') and last_served_at=null (never
-- served via RPC gate). Generator built them before Rules Filter ran on the gym entries.
--
-- Pre-deploy backup tables _orch_0588_dead_cards_backup + _orch_0588_dead_stops_backup
-- created via MCP execute_sql before this migration applied. Drop those backup tables
-- 7 days post-close.
--
-- Pre-deploy MCP audit (2026-04-20):
--   raleigh_active=2912, raleigh_ai_approved=1667, dead_cards_to_delete=2,
--   defensive_sweep_target=2 (same 2 — no extra siblings).

-- Step 1 — primary delete (the 2 known dead cards)
WITH dead_cards AS (
  SELECT id FROM public.card_pool
  WHERE id IN (
    '04422427-8c15-4d9c-a56c-e68e6541883f'::uuid,
    'cec104f9-2723-4d9d-982f-c858a1e9ffed'::uuid
  )
)
DELETE FROM public.card_pool_stops
WHERE card_pool_id IN (SELECT id FROM dead_cards);

DELETE FROM public.card_pool
WHERE id IN (
  '04422427-8c15-4d9c-a56c-e68e6541883f'::uuid,
  'cec104f9-2723-4d9d-982f-c858a1e9ffed'::uuid
);

-- Step 2 — defensive sweep (any other Raleigh Romantic card whose stops include
-- ai_approved=false or NULL places)
WITH defensive_dead AS (
  SELECT cp.id FROM public.card_pool cp
  WHERE cp.card_type = 'curated'
    AND cp.experience_type = 'romantic'
    AND cp.city_id = '0ccfcf20-21a9-4d7b-805d-cbe629dcfd2b'::uuid
    AND EXISTS (
      SELECT 1 FROM public.card_pool_stops cps
      JOIN public.place_pool pp ON pp.id = cps.place_pool_id
      WHERE cps.card_pool_id = cp.id
        AND (pp.ai_approved IS NULL OR pp.ai_approved = false)
    )
)
DELETE FROM public.card_pool_stops
WHERE card_pool_id IN (SELECT id FROM defensive_dead);

WITH defensive_dead AS (
  SELECT cp.id FROM public.card_pool cp
  WHERE cp.card_type = 'curated'
    AND cp.experience_type = 'romantic'
    AND cp.city_id = '0ccfcf20-21a9-4d7b-805d-cbe629dcfd2b'::uuid
    AND EXISTS (
      SELECT 1 FROM public.card_pool_stops cps
      JOIN public.place_pool pp ON pp.id = cps.place_pool_id
      WHERE cps.card_pool_id = cp.id
        AND (pp.ai_approved IS NULL OR pp.ai_approved = false)
    )
)
DELETE FROM public.card_pool
WHERE id IN (SELECT id FROM defensive_dead);

-- Post-deploy verification (run via MCP after `supabase db push`):
--   SELECT COUNT(*) FROM card_pool cp
--   WHERE cp.card_type='curated' AND cp.experience_type='romantic'
--     AND cp.city_id='0ccfcf20-21a9-4d7b-805d-cbe629dcfd2b'
--     AND EXISTS (
--       SELECT 1 FROM card_pool_stops cps
--       JOIN place_pool pp ON pp.id=cps.place_pool_id
--       WHERE cps.card_pool_id=cp.id AND (pp.ai_approved IS NULL OR pp.ai_approved=false)
--     );
--   Expected: 0

-- ROLLBACK (data deletion — not safely reversible without backup):
-- INSERT INTO public.card_pool SELECT * FROM public._orch_0588_dead_cards_backup ON CONFLICT DO NOTHING;
-- INSERT INTO public.card_pool_stops SELECT * FROM public._orch_0588_dead_stops_backup ON CONFLICT DO NOTHING;
-- (only restores the 2 known cards + their stops — defensive-sweep cards not backed up)

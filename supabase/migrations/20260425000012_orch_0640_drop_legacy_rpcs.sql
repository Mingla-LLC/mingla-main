-- ORCH-0640 ch11 — Drop legacy RPCs (DEC-037, DEC-043)
-- All 22 RPCs that either read/write card_pool or read ai_validation_*.
-- Pre-condition: admin_rules_* RPCs rewritten to new table names (ch05 mig 20260425000013).
-- Pre-condition: admin_* place/photo RPCs rewritten (ch05 mig 20260425000014).
-- Pre-condition: edge fns deployed that stopped calling these RPCs (ch06-ch07).

BEGIN;

-- ── Legacy serving RPCs (DEC-037) ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.query_pool_cards(
  UUID, TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, TEXT, UUID[], INTEGER, TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
);
DROP FUNCTION IF EXISTS public.query_person_hero_cards(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], TEXT, INTEGER, INTEGER
);
DROP FUNCTION IF EXISTS public.query_person_hero_cards(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], TEXT, INTEGER, INTEGER, UUID[]
);
DROP FUNCTION IF EXISTS public.record_card_swipe(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.record_card_interaction(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.record_card_interaction(TEXT, TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.serve_curated_from_pool(
  UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, TIMESTAMPTZ, INTEGER
);

-- ── Admin AI validation RPCs (DEC-043) ────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_ai_category_health();
DROP FUNCTION IF EXISTS public.admin_ai_city_category_coverage();
DROP FUNCTION IF EXISTS public.admin_ai_city_overview(UUID);
DROP FUNCTION IF EXISTS public.admin_ai_city_stats();
DROP FUNCTION IF EXISTS public.admin_ai_override_place(UUID, TEXT, TEXT[], TEXT);
DROP FUNCTION IF EXISTS public.admin_ai_recent_runs(INTEGER);
DROP FUNCTION IF EXISTS public.admin_ai_review_queue(UUID, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.admin_ai_run_results(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.admin_ai_run_status(UUID);
DROP FUNCTION IF EXISTS public.admin_ai_validation_overview();
DROP FUNCTION IF EXISTS public.admin_ai_validation_preview(TEXT, TEXT, TEXT, TEXT, BOOLEAN);

-- ── Admin card-pool-intelligence RPCs (card-centric — all die) ────────────
DROP FUNCTION IF EXISTS public.admin_card_category_health(UUID, TEXT);
DROP FUNCTION IF EXISTS public.admin_card_city_overview(TEXT);
DROP FUNCTION IF EXISTS public.admin_card_country_overview();
DROP FUNCTION IF EXISTS public.admin_card_pool_intelligence(UUID, TEXT);
DROP FUNCTION IF EXISTS public.admin_city_card_stats(UUID);
DROP FUNCTION IF EXISTS public.admin_country_city_overview(TEXT);
DROP FUNCTION IF EXISTS public.admin_country_overview();
DROP FUNCTION IF EXISTS public.admin_detect_duplicate_curated_cards(UUID);
DROP FUNCTION IF EXISTS public.admin_pool_stats_overview();

COMMIT;

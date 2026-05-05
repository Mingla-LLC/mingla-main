-- ORCH-0596 Slice 4 — cohort flag for casual_food signal serving
-- Default 0 = no users on new path. Admin slider bumps via existing generic
-- admin_get/set_signal_serving_pct RPCs.

INSERT INTO public.admin_config (key, value)
VALUES ('signal_serving_casual_food_pct', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ROLLBACK:
-- DELETE FROM public.admin_config WHERE key = 'signal_serving_casual_food_pct';

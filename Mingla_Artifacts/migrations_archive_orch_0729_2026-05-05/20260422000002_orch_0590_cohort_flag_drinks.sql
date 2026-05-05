-- ORCH-0590 Slice 2 — cohort flag for drinks signal serving
-- Default 0 = no users on new path. Admin slider bumps via existing
-- admin_get/set_signal_serving_pct RPCs (generic signal_id param; no new RPC needed).
-- The RPCs were hotfixed in 20260421200008 to reference admin_users.status='active' correctly.

INSERT INTO public.admin_config (key, value)
VALUES ('signal_serving_drinks_pct', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ROLLBACK:
-- DELETE FROM public.admin_config WHERE key = 'signal_serving_drinks_pct';

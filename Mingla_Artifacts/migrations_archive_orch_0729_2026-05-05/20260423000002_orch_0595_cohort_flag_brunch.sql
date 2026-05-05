-- ORCH-0595 Slice 3 — cohort flag for brunch signal serving
-- Default 0 = no users on new path. Admin slider bumps via existing generic
-- admin_get/set_signal_serving_pct RPCs (no new RPCs needed; RPCs hotfixed
-- in migration 20260421200008 to reference admin_users.status='active').

INSERT INTO public.admin_config (key, value)
VALUES ('signal_serving_brunch_pct', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ROLLBACK:
-- DELETE FROM public.admin_config WHERE key = 'signal_serving_brunch_pct';

-- META-ORCH-1009 Sub-E — fix venue-submit failure (operator live-fire 2026-05-31).
--
-- ROOT CAUSE (proven via Postgres error logs at the submit timestamps):
--   The RPC public.biz_create_venue_brand_authoring inserts into
--   brand_place_pipeline_state the columns (brand_id, place_pool_id, status,
--   stage_status, readiness, coaching). But the live table was created by an
--   earlier apply with the spec shape (bouncer_reasons/coaching, no `readiness`).
--   Because the table's CREATE used `create table if not exists`, a later edit to
--   the shape never took effect on the existing table, while CREATE OR REPLACE
--   FUNCTION still installed the RPC that writes `readiness`. Result at runtime:
--     ERROR: column "readiness" of relation "brand_place_pipeline_state"
--            does not exist
--   → the whole create-new venue submit aborts → app shows "Could not submit".
--
-- FIX (minimal, additive, non-destructive): add the `readiness` column back as a
-- defaulted jsonb so the RPC insert succeeds. Nothing reads `readiness` (the
-- client + edge fn use `coaching`/`status`/`bouncer_reasons`), so it is a
-- harmless compatibility column. All other NOT-NULL columns the RPC omits
-- (bouncer_reasons, coaching, stage_status) already carry defaults, so the
-- insert is fully satisfied once `readiness` exists.
--
-- Idempotent: safe to re-run; safe under a later `supabase db push`.

alter table public.brand_place_pipeline_state
  add column if not exists readiness jsonb not null default '{}'::jsonb;

comment on column public.brand_place_pipeline_state.readiness is
  'META-ORCH-1009 Sub-E compatibility column for biz_create_venue_brand_authoring''s INSERT. Not read by client/edge-fn (which use coaching/status/bouncer_reasons). Added 2026-05-31 to fix the create-new venue submit failure.';

-- Issue #1537 (rework) — register `termii` as a monitored API-health service.
--
-- REQUIRED BY the Layer-C provider→tile fix in api-health-probe. This is not
-- cosmetic: `api_health_checks.service_key` is FK-constrained to
-- `api_health_services(service_key)` (migration 20261120000000 line 33), and the
-- probe inserts every check row for a tick in ONE batch. Emitting a `termii`
-- tile without this row would fail the ENTIRE insert — every service, every
-- layer — not merely the Termii row.
--
-- WHY THE TILE EXISTS AT ALL. #1537 made the delivery ledger record `termii`
-- for Nigerian SMS instead of a hardcoded `twilio`. The probe's provider ladder
-- ended in a bare `: []`, so `termii` rows fell through and were counted
-- nowhere: Nigerian SMS health went from wrong-but-visible (mislabelled under
-- the Twilio tile) to invisible, at exactly the moment Nigeria switches on.
--
-- DELIBERATELY ITS OWN TILE, not folded into `twilio`. Merging them would
-- recreate the mislabelling #1537 exists to remove, and a Termii outage would
-- read as a Twilio outage — a false page for the wrong vendor, in the wrong
-- market, on the wrong continent.
--
-- monitoring_class 'E' (passive-only): Termii health is derived from delivery
-- outcomes in notification_deliveries, exactly like the existing messaging
-- tiles. No synthetic probe and no status feed — Termii publishes no Atlassian
-- status.json, and a synthetic send would cost real money and real SMS.
--
-- Idempotent (ON CONFLICT), additive, and safe to re-apply. No data change to
-- any existing row.

INSERT INTO public.api_health_services
  (service_key, display_name, category, sort_order, monitoring_class, depletion_signal)
VALUES
  ('termii', 'Termii (SMS, Nigeria)', 'messaging', 54, 'E', '{}'::jsonb)
ON CONFLICT (service_key) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      category     = EXCLUDED.category,
      sort_order   = EXCLUDED.sort_order;

-- The alert state machine assumes one row per service (same pattern as the
-- original seed in 20261120000000).
INSERT INTO public.api_health_alert_state (service_key)
  SELECT 'termii'
ON CONFLICT (service_key) DO NOTHING;

COMMENT ON TABLE public.api_health_services IS
  'ORCH-1201 — the ONE owner of the monitored-service list. Issue #1537 added '
  '`termii` (Nigerian SMS): every value in the api-health-probe Layer-C '
  'provider->tile map (supabase/functions/api-health-probe/logic.ts, '
  'DELIVERY_PROVIDER_TILES) MUST have a row here, because api_health_checks.'
  'service_key is FK-constrained to this table and the probe inserts a tick''s '
  'rows in one batch — an unregistered tile fails the whole insert.';

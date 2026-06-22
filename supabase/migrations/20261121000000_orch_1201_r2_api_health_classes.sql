-- ORCH-1201-R2 — API-Health Hub CORRECTIVE: per-service monitoring CLASSES.
--
-- Corrects the merged ORCH-1201 hub (20261120000000) which treated every
-- service uniformly (same synthetic-probe + balance logic). Reality: services
-- fall into 6 monitoring classes (A–F), each with a DIFFERENT authoritative
-- alert signal. This migration is purely ADDITIVE + idempotent:
--   • api_health_services gains monitoring_class (A–F) + depletion_signal jsonb.
--   • api_health_observations gains error_code + error_text (nullable) so the
--     Class-B depletion fingerprint (OpenAI insufficient_quota vs
--     rate_limit_exceeded, Serper "Not enough credits", Resend *_quota_exceeded,
--     Gemini RESOURCE_EXHAUSTED) is detectable — previously a 429 was opaque.
--   • all 25 seeded services are re-classed + signalled via idempotent UPDATEs
--     (NO new service rows → SERVICE-KEY-CANONICAL stays === 25).
--   • admin_get_api_health() is re-declared (CREATE OR REPLACE) to expose
--     monitoring_class, depletion_signal, and a 24h depletion rollup.
--
-- Thresholds are the REAL live baselines (2026-06-22): Twilio WARN ≤ $25 (live
-- $14.53 ⇒ WARN), Cloudinary WARN ≥ 80% / CRIT ≥ 100% USED (live 747.88% ⇒
-- CRIT), Pexels ≤ 2500, Ticketmaster ≤ 500, Serper reactive (live DOWN). NONE
-- invented. Processors (Stripe/Paystack) carry NO balance signal — their
-- "balance" is settled customer funds, not API credit.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + UPDATE ... WHERE service_key=. Re-run
-- is a no-op. MUST run after 20261120000000 (monotonic prefix guarantees order).

-- ════════════════════════════════════════════════════════════════════════
-- 1. ALTER api_health_services — monitoring_class + depletion_signal
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.api_health_services
  ADD COLUMN IF NOT EXISTS monitoring_class text
    CHECK (monitoring_class IN ('A','B','C','D','E','F')),
  ADD COLUMN IF NOT EXISTS depletion_signal jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ════════════════════════════════════════════════════════════════════════
-- 2. ALTER api_health_observations — depletion fingerprint (fixes D3)
-- ════════════════════════════════════════════════════════════════════════
-- Additive + nullable: every existing recordApiCall (4-arg) insert keeps working;
-- only the wired Class-B call sites populate these.
ALTER TABLE public.api_health_observations
  ADD COLUMN IF NOT EXISTS error_code text,   -- vendor machine code/type e.g. 'insufficient_quota','RESOURCE_EXHAUSTED','daily_quota_exceeded'
  ADD COLUMN IF NOT EXISTS error_text text;   -- short raw snippet (<=300 chars) for forensic + substring matchers e.g. 'Not enough credits'

-- ════════════════════════════════════════════════════════════════════════
-- 3. RE-SEED all 25 services with class + signal + REAL thresholds
--    (idempotent UPDATEs — adds NO rows; count stays 25)
-- ════════════════════════════════════════════════════════════════════════

-- ── Class A: metered WITH a programmatic balance/usage read ──
UPDATE public.api_health_services
   SET monitoring_class = 'A',
       depletion_signal = jsonb_build_object(
         'status_feed','https://status.twilio.com/api/v2/status.json',
         'balance', jsonb_build_object('kind','twilio_balance','warn',25,'crit',5,'unit','USD'))
 WHERE service_key = 'twilio';

UPDATE public.api_health_services
   SET monitoring_class = 'A',
       depletion_signal = jsonb_build_object(
         'status_feed','https://status.cloudinary.com/api/v2/status.json',
         'balance', jsonb_build_object('kind','cloudinary_used_pct','warn',80,'crit',100,'unit','pct_used'))
 WHERE service_key = 'cloudinary';

-- ASSUMPTION-BUDGET ORCH-1201R2 (1): exchangerate thresholds = %-of-cap (10%/<2%
-- of the documented 30k/mo cap), NOT live-probed. No status feed exists.
UPDATE public.api_health_services
   SET monitoring_class = 'A',
       depletion_signal = jsonb_build_object(
         'status_feed', NULL,
         'balance', jsonb_build_object('kind','exchangerate_quota','warn',3000,'crit',500,'unit','requests'))
 WHERE service_key = 'exchangerate';

-- ASSUMPTION-BUDGET ORCH-1201R2 (2): sentry stats ratio needs an admin token
-- (SENTRY_AUTH_TOKEN). When absent the Class-A poll short-circuits to unknown
-- (grey) in the edge fn — never green, never alert.
UPDATE public.api_health_services
   SET monitoring_class = 'A',
       depletion_signal = jsonb_build_object(
         'status_feed','https://status.sentry.io/api/v2/status.json',
         'balance', jsonb_build_object('kind','sentry_stats','warn',0.05,'crit',0.20,'unit','rate_limited_ratio'))
 WHERE service_key = 'sentry';

-- supabase: platform (E) with a Class-A-style health read; status feed + health.
UPDATE public.api_health_services
   SET monitoring_class = 'E',
       depletion_signal = jsonb_build_object(
         'status_feed','https://status.supabase.com/api/v2/status.json',
         'balance', jsonb_build_object('kind','supabase_health','warn',NULL,'crit',NULL,'unit','status'))
 WHERE service_key = 'supabase';

-- ── Class C: payment processors — reachability+auth+restriction+webhook ONLY.
--    NEVER a balance alert (balance = settled customer funds, display-only). ──
UPDATE public.api_health_services
   SET monitoring_class = 'C',
       depletion_signal = jsonb_build_object(
         'status_feed','https://status.stripe.com/api/v2/status.json',
         'processor', jsonb_build_object(
           'restriction_fields', jsonb_build_array('charges_enabled','payouts_enabled'),
           'balance_display_only', true))
 WHERE service_key = 'stripe';

UPDATE public.api_health_services
   SET monitoring_class = 'C',
       depletion_signal = jsonb_build_object(
         'status_feed', NULL,  -- status.paystack.com is NOT an Atlassian /api/v2/status.json (404, verified 2026-06-22)
         'processor', jsonb_build_object(
           'restriction_fields', jsonb_build_array('status_bool'),
           'balance_display_only', true))
 WHERE service_key = 'paystack';

-- ── Class B: metered, NO balance API — REACTIVE depletion error on real traffic ──
-- openai: 429 type=insufficient_quota (vs rate_limit_exceeded = transient).
UPDATE public.api_health_services
   SET monitoring_class = 'B',
       depletion_signal = jsonb_build_object(
         'status_feed','https://status.openai.com/api/v2/status.json',
         'reactive', jsonb_build_object('http',429,'match','insufficient_quota','field','type'),
         'reactive_source','probe_only')  -- no server-side recordApiCall wrap for OpenAI yet (honest: no fabricated coverage)
 WHERE service_key = 'openai';

-- gemini: 429 RESOURCE_EXHAUSTED (esp. limit:0 = billing demoted). Wired in agentGemini/geminiMenuParser.
UPDATE public.api_health_services
   SET monitoring_class = 'B',
       depletion_signal = jsonb_build_object(
         'status_feed', NULL,  -- AI Studio has no Atlassian status feed
         'reactive', jsonb_build_object('http',429,'match','RESOURCE_EXHAUSTED','field','type'))
 WHERE service_key = 'gemini';

-- serper: 4xx body "Not enough credits" (live DEPLETED 2026-06-22). Wired in run-place-intelligence-trial.
UPDATE public.api_health_services
   SET monitoring_class = 'B',
       depletion_signal = jsonb_build_object(
         'status_feed', NULL,
         'reactive', jsonb_build_object('http', jsonb_build_array(400,401,402,403,429),'match','Not enough credits','field','body'))
 WHERE service_key = 'serper';

-- resend: 429 type=daily_quota_exceeded / monthly_quota_exceeded. Has a confirmed status feed.
UPDATE public.api_health_services
   SET monitoring_class = 'B',
       depletion_signal = jsonb_build_object(
         'status_feed','https://resend-status.com/api/v2/status.json',  -- verified Atlassian schema 2026-06-22
         'reactive', jsonb_build_object('http',429,'match','quota_exceeded','field','type'),
         'reactive_source','probe_only')  -- email-send path is the alert owner; no dedicated depletion wrap
 WHERE service_key = 'resend';

-- pexels: header x-ratelimit-remaining (vanishes on 429 — cache last). warn <= 2500 (10% of 25k).
UPDATE public.api_health_services
   SET monitoring_class = 'B',
       depletion_signal = jsonb_build_object(
         'status_feed', NULL,
         'header', jsonb_build_object('name','x-ratelimit-remaining','warn',2500,'cache_last_seen',true))
 WHERE service_key = 'pexels';

-- ticketmaster: header rate-limit-available (cache last). warn <= 500 (10% of 5k).
UPDATE public.api_health_services
   SET monitoring_class = 'B',
       depletion_signal = jsonb_build_object(
         'status_feed', NULL,
         'header', jsonb_build_object('name','rate-limit-available','warn',500,'cache_last_seen',true))
 WHERE service_key = 'ticketmaster';

-- mapbox: 429 (no remaining header). Wired in mapboxGeocode. Has a status feed.
UPDATE public.api_health_services
   SET monitoring_class = 'B',
       depletion_signal = jsonb_build_object(
         'status_feed','https://status.mapbox.com/api/v2/status.json',
         'reactive', jsonb_build_object('http',429,'match','429','field','status_text'))
 WHERE service_key = 'mapbox';

-- google_places: 429 / RESOURCE_EXHAUSTED. Feed is the Google incidents.json (handled separately, not Atlassian).
UPDATE public.api_health_services
   SET monitoring_class = 'B',
       depletion_signal = jsonb_build_object(
         'status_feed', NULL,  -- status.cloud.google.com/incidents.json is NOT Atlassian status.json; handled separately
         'reactive', jsonb_build_object('http', jsonb_build_array(429),'match','RESOURCE_EXHAUSTED','field','status_text'),
         'reactive_source','probe_only')
 WHERE service_key = 'google_places';

-- ── Class D: client-side SDKs — vendor status feed + event-arrival; no server probe ──
UPDATE public.api_health_services
   SET monitoring_class = 'D',
       depletion_signal = jsonb_build_object('status_feed','https://status.onesignal.com/api/v2/status.json')
 WHERE service_key = 'onesignal_consumer';

UPDATE public.api_health_services
   SET monitoring_class = 'D',
       depletion_signal = jsonb_build_object('status_feed','https://status.onesignal.com/api/v2/status.json')
 WHERE service_key = 'onesignal_business';

UPDATE public.api_health_services
   SET monitoring_class = 'D',
       depletion_signal = jsonb_build_object('status_feed','https://status.revenuecat.com/api/v2/status.json')
 WHERE service_key = 'revenuecat';

-- posthog: 301 -> posthogstatus.com which is NOT Atlassian /api/v2/status.json (HTML, verified 2026-06-22) -> no feed.
UPDATE public.api_health_services
   SET monitoring_class = 'D',
       depletion_signal = jsonb_build_object('status_feed', NULL, 'synthetic', false)
 WHERE service_key = 'posthog';

UPDATE public.api_health_services
   SET monitoring_class = 'D',
       depletion_signal = jsonb_build_object('status_feed','https://www.mixpanelstatus.com/api/v2/status.json')
 WHERE service_key = 'mixpanel';

UPDATE public.api_health_services
   SET monitoring_class = 'D',
       depletion_signal = jsonb_build_object('status_feed','https://status.appsflyer.com/api/v2/status.json')
 WHERE service_key = 'appsflyer';

-- ga4: Google Workspace dashboard, no JSON feed, no alert (status-only manual).
UPDATE public.api_health_services
   SET monitoring_class = 'D',
       depletion_signal = jsonb_build_object('status_feed', NULL, 'synthetic', false)
 WHERE service_key = 'ga4';

-- ── Class E: platform — status feed + own health/usage ──
UPDATE public.api_health_services
   SET monitoring_class = 'E',
       depletion_signal = jsonb_build_object('status_feed','https://www.vercel-status.com/api/v2/status.json')
 WHERE service_key = 'vercel';

-- ── Class F: keyless / synthetic — synthetic probe + 429 watch ──
-- giphy stays Class F (synthetic). It HAS an Atlassian feed but per the class
-- contract it is monitored synthetically, not via the status-feed poller. Kept
-- seeded + excluded from balance/depletion alerting.
UPDATE public.api_health_services
   SET monitoring_class = 'F',
       depletion_signal = jsonb_build_object('status_feed', NULL, 'synthetic', true)
 WHERE service_key = 'giphy';

UPDATE public.api_health_services
   SET monitoring_class = 'F',
       depletion_signal = jsonb_build_object('status_feed', NULL, 'synthetic', true)
 WHERE service_key = 'thumio';

-- ════════════════════════════════════════════════════════════════════════
-- 4. SELF-VERIFICATION BLOCK
-- ════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.api_health_services WHERE monitoring_class IS NULL) THEN
    RAISE EXCEPTION 'ORCH-1201R2 verify: every service must have a monitoring_class';
  END IF;
  IF EXISTS (SELECT 1 FROM public.api_health_services
             WHERE service_key IN ('stripe','paystack')
               AND (depletion_signal->'balance') IS NOT NULL) THEN
    RAISE EXCEPTION 'ORCH-1201R2 verify: processors must not carry a balance alert signal';
  END IF;
  IF EXISTS (SELECT 1 FROM public.api_health_services
             WHERE monitoring_class='B'
               AND depletion_signal->'reactive' IS NULL
               AND depletion_signal->'header' IS NULL) THEN
    RAISE EXCEPTION 'ORCH-1201R2 verify: every Class-B service needs a reactive matcher or header signal';
  END IF;
  IF (SELECT count(*) FROM public.api_health_services) <> 25 THEN
    RAISE EXCEPTION 'ORCH-1201R2 verify: service count must stay 25 (R2 adds no rows)';
  END IF;
  -- new observation columns exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='api_health_observations' AND column_name='error_code') THEN
    RAISE EXCEPTION 'ORCH-1201R2 verify: api_health_observations.error_code column missing';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- 5. RE-DECLARE admin_get_api_health() — expose class/signal + depletion_24h
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_get_api_health()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_services jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT COALESCE(jsonb_agg(svc ORDER BY (svc->>'sort_order')::int), '[]'::jsonb) INTO v_services
  FROM (
    SELECT jsonb_build_object(
      'service_key',  s.service_key,
      'display_name', s.display_name,
      'category',     s.category,
      'sort_order',   s.sort_order,
      'monitoring_class', s.monitoring_class,
      'depletion_signal', s.depletion_signal,
      'alert_state',  st.current_state,
      'consecutive_failures', st.consecutive_failures,
      'last_alert_at', st.last_alert_at,
      'last_recovery_at', st.last_recovery_at,
      -- latest check per (service_key, layer):
      'layers', (
        SELECT COALESCE(jsonb_object_agg(layer, c), '{}'::jsonb) FROM (
          SELECT DISTINCT ON (layer) layer,
            jsonb_build_object('status',status,'latency_ms',latency_ms,'mode',mode,
                               'http_status',http_status,'detail',detail,'checked_at',checked_at) AS c
          FROM public.api_health_checks
          WHERE service_key = s.service_key AND checked_at > now() - interval '7 days'
          ORDER BY layer, checked_at DESC
        ) per_layer
      ),
      -- 24h passive success rate (Layer-C):
      'passive_24h', (
        SELECT jsonb_build_object(
          'success', COUNT(*) FILTER (WHERE ok),
          'failure', COUNT(*) FILTER (WHERE NOT ok),
          'total',   COUNT(*))
        FROM public.api_health_observations
        WHERE service_key = s.service_key AND observed_at > now() - interval '24 hours'
      ),
      -- 24h reactive depletion rollup (Class-B "last error"):
      'depletion_24h', (
        SELECT jsonb_build_object(
          'depleted', bool_or(error_code IS NOT NULL AND error_code <> ''),
          'last_error_code', (array_agg(error_code ORDER BY observed_at DESC)
                                FILTER (WHERE error_code IS NOT NULL))[1],
          'last_error_text', (array_agg(error_text ORDER BY observed_at DESC)
                                FILTER (WHERE error_text IS NOT NULL))[1],
          'last_error_at',   max(observed_at) FILTER (WHERE error_code IS NOT NULL))
        FROM public.api_health_observations
        WHERE service_key = s.service_key AND observed_at > now() - interval '24 hours'
      ),
      -- 24h uptime % from checks (any non-down check counts as up):
      'uptime_24h_pct', (
        SELECT CASE WHEN COUNT(*)=0 THEN NULL
          ELSE round(100.0 * COUNT(*) FILTER (WHERE status IN ('healthy','degraded')) / COUNT(*), 1) END
        FROM public.api_health_checks
        WHERE service_key = s.service_key AND checked_at > now() - interval '24 hours'
      )
    ) AS svc
    FROM public.api_health_services s
    LEFT JOIN public.api_health_alert_state st ON st.service_key = s.service_key
  ) rows;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'services', v_services,
    'last_probe_at', (SELECT max(checked_at) FROM public.api_health_checks)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_api_health() TO authenticated, service_role;

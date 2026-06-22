-- ORCH-1199 — Admin API-Health Hub + Email Alerts.
--
-- Builds the canonical monitored-service registry + per-tick health checks +
-- passive observations + alert state machine + a small kv meta table, all
-- admin-read-only via SECURITY DEFINER RPC, written only by the service-role
-- `api-health-probe` edge fn, polled hourly via pg_cron + pg_net.
--
-- ORCHESTRATOR-DIRECTED CHANGE (overrides SPEC §1.1 on one point): the daily
-- digest cooldown is stored in a dedicated kv table `api_health_meta`
-- (key='last_digest_at'), NOT a `_digest` pseudo-row in `api_health_services`.
-- This keeps `api_health_services` pure (one owner = REAL services only) and
-- satisfies I-PROPOSED-1199-SERVICE-KEY-CANONICAL with no pseudo-row to filter.
--
-- Idempotent: IF NOT EXISTS / ON CONFLICT / unschedule-then-schedule. Vault
-- secret names are the canonical `supabase_url` + `service_role_key` (D0.4).

-- ════════════════════════════════════════════════════════════════════════
-- 1. TABLES + INDEXES
-- ════════════════════════════════════════════════════════════════════════

-- ── api_health_services: the ONE owner of the monitored-service list ──
-- (Invariant I-PROPOSED-1199-SERVICE-KEY-CANONICAL — real services only.)
CREATE TABLE IF NOT EXISTS public.api_health_services (
  service_key  text PRIMARY KEY,
  display_name text NOT NULL,
  category     text NOT NULL,          -- 'ai'|'payments'|'maps'|'discovery'|'messaging'|'media'|'platform'|'observability'
  sort_order   integer NOT NULL DEFAULT 100
);

-- ── api_health_checks: one row per service per probe tick (Layer A/B/webhook) ──
CREATE TABLE IF NOT EXISTS public.api_health_checks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_key  text NOT NULL REFERENCES public.api_health_services(service_key),
  layer        text NOT NULL CHECK (layer IN ('status_page','synthetic','passive','webhook')),
  status       text NOT NULL CHECK (status IN ('healthy','degraded','down','unknown')),
  latency_ms   integer,                       -- null when not measured (status_page parse, passive read)
  mode         text CHECK (mode IN ('test','live')),  -- only for stripe/paystack; null otherwise
  http_status  integer,                       -- vendor HTTP status when applicable
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {indicator, description, balance, currency, error, ...}
  checked_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_health_checks_service_time
  ON public.api_health_checks (service_key, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_health_checks_time
  ON public.api_health_checks (checked_at DESC);

-- ── api_health_observations: Layer-C passive append-only (written by recordApiCall) ──
CREATE TABLE IF NOT EXISTS public.api_health_observations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_key text NOT NULL,                   -- NOT FK-constrained: host calls must never fail on a bad key
  ok          boolean NOT NULL,
  latency_ms  integer,
  http_status integer,
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_health_obs_service_time
  ON public.api_health_observations (service_key, observed_at DESC);

-- ── api_health_alert_state: state machine + cooldown (one row per service_key) ──
CREATE TABLE IF NOT EXISTS public.api_health_alert_state (
  service_key           text PRIMARY KEY REFERENCES public.api_health_services(service_key),
  current_state         text NOT NULL DEFAULT 'ok' CHECK (current_state IN ('ok','alerting')),
  consecutive_failures  integer NOT NULL DEFAULT 0,
  last_alert_at         timestamptz,
  last_recovery_at      timestamptz,
  last_balance_alert_at timestamptz,           -- low-balance one-shot cooldown
  last_balance_state    text DEFAULT 'ok' CHECK (last_balance_state IN ('ok','low','unknown')),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── api_health_meta: small kv store (ORCHESTRATOR-DIRECTED) ──
-- Carries the GLOBAL daily-digest cooldown as key='last_digest_at'. Keeps
-- api_health_services pure (no _digest pseudo-row). Edge fn reads/writes it
-- via service-role; RLS deny-by-default so only the RPC/probe touch it.
CREATE TABLE IF NOT EXISTS public.api_health_meta (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Seed the canonical monitored set (25 REAL services, no pseudo-rows) ──
INSERT INTO public.api_health_services (service_key, display_name, category, sort_order) VALUES
  ('stripe',              'Stripe',                'payments',      10),
  ('paystack',            'Paystack',              'payments',      11),
  ('gemini',              'Google Gemini',         'ai',            20),
  ('openai',              'OpenAI',                'ai',            21),
  ('mapbox',              'Mapbox',                'maps',          30),
  ('google_places',       'Google Places',         'maps',          31),
  ('ticketmaster',        'Ticketmaster',          'discovery',     40),
  ('serper',              'Serper',                'discovery',     41),
  ('pexels',              'Pexels',                'discovery',     42),
  ('giphy',               'Giphy',                 'discovery',     43),
  ('onesignal_consumer',  'OneSignal (Consumer)',  'messaging',     50),
  ('onesignal_business',  'OneSignal (Business)',  'messaging',     51),
  ('resend',              'Resend (Email)',        'messaging',     52),
  ('twilio',              'Twilio (SMS)',          'messaging',     53),
  ('cloudinary',          'Cloudinary',            'media',         60),
  ('supabase',            'Supabase',              'platform',      70),
  ('vercel',              'Vercel',                'platform',      71),
  ('exchangerate',        'ExchangeRate-API',      'platform',      72),
  ('thumio',              'Thum.io',               'media',         61),
  ('revenuecat',          'RevenueCat',            'platform',      73),
  ('posthog',             'PostHog',               'observability', 80),
  ('mixpanel',            'Mixpanel',              'observability', 81),
  ('sentry',              'Sentry',                'observability', 82),
  ('appsflyer',           'AppsFlyer',             'observability', 83),
  ('ga4',                 'Google Analytics 4',    'observability', 84)
ON CONFLICT (service_key) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      category     = EXCLUDED.category,
      sort_order   = EXCLUDED.sort_order;

-- Seed one alert-state row per service (state machine always has a row).
INSERT INTO public.api_health_alert_state (service_key)
  SELECT service_key FROM public.api_health_services
ON CONFLICT (service_key) DO NOTHING;

-- Seed the digest cooldown kv row (NULL last_digest_at => digest may fire).
INSERT INTO public.api_health_meta (key, value)
  VALUES ('last_digest_at', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════
-- 2. RLS — deny-by-default. service_role bypasses; admin reads via RPC ONLY.
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.api_health_services     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_health_checks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_health_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_health_alert_state  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_health_meta         ENABLE ROW LEVEL SECURITY;
-- NO policies created → anon/authenticated are DENIED all access. service_role
-- (the probe) bypasses RLS for writes; admins read through the SECURITY DEFINER
-- RPC below.

-- ════════════════════════════════════════════════════════════════════════
-- 3. READ RPCs (SECURITY DEFINER, admin-gated — mirror admin_get_pricing_config)
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

CREATE OR REPLACE FUNCTION public.admin_get_api_health_incidents(p_service_key text, p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'layer',layer,'status',status,'latency_ms',latency_ms,'http_status',http_status,
      'detail',detail,'checked_at',checked_at) ORDER BY checked_at DESC), '[]'::jsonb)
    FROM (
      SELECT * FROM public.api_health_checks
      WHERE service_key = p_service_key AND status IN ('degraded','down')
      ORDER BY checked_at DESC LIMIT LEAST(p_limit, 200)
    ) x
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_api_health_incidents(text,int) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 4. CRON — hourly probe (D0.3). pg_cron + pg_net, vault names per D0.4.
-- ════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'ORCH-1199: pg_cron extension required — operator must enable before apply'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    RAISE NOTICE 'ORCH-1199: pg_net missing — net.http_post will fail at runtime; enable pg_net'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='orch_1199_api_health_probe')
  THEN PERFORM cron.unschedule('orch_1199_api_health_probe'); END IF;
END $$;

SELECT cron.schedule(
  'orch_1199_api_health_probe',
  '0 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/api-health-probe',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  $cron$
);

-- ════════════════════════════════════════════════════════════════════════
-- 5. SELF-VERIFICATION PROBE
-- ════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='orch_1199_api_health_probe' AND schedule='0 * * * *') THEN
    RAISE EXCEPTION 'ORCH-1199 verify: hourly probe cron not scheduled';
  END IF;
  IF (SELECT count(*) FROM public.api_health_services) <> 25 THEN
    RAISE EXCEPTION 'ORCH-1199 verify: expected 25 monitored services (no pseudo-rows)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_health_meta WHERE key='last_digest_at') THEN
    RAISE EXCEPTION 'ORCH-1199 verify: api_health_meta last_digest_at row missing';
  END IF;
END $$;

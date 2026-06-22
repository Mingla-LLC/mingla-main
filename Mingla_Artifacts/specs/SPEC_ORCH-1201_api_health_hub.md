# SPEC — ORCH-1201 Admin API-Health Hub + Email Alerts

**Phase:** SPEC (binding build contract). The implementor executes this verbatim — no guessing, no scope widening.
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1201-[api-health-hub]/` · branch `ORCH-1201-api-health-hub`
**Date:** 2026-06-21
**Inputs (authoritative, already read):**
- `Mingla_Artifacts/ORCH-1201_API_INVENTORY.md` (inventory + LOCKED DECISIONS)
- `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1201_api_health.md` (evidence, §8a-8h schema sketch, probe table, chokepoints)

**Mandate:** No assumptions, deep research, drive to completion. This is a contract — every path, signature, column, default, URL, and acceptance criterion below is binding.

---

## 0. BINDING DECISIONS (locked — do not re-open)

| # | Decision |
|---|---|
| D0.1 | Alert recipient: `seth@usemingla.com` via NEW env var `API_HEALTH_ALERT_EMAILS` (comma-list, default `seth@usemingla.com`), parsed EXACTLY like `stripe-webhook/index.ts:38-40`. |
| D0.2 | Build ALL THREE layers: A (statuspage `/api/v2/status.json` polling), B (authenticated synthetic probes), C (passive real-traffic via `recordApiCall` + reading `notification_deliveries`). |
| D0.3 | Cadence: HOURLY `'0 * * * *'` probe via pg_cron + pg_net (copy `process-booking-deadlines` exemplar). Daily digest at the `13:00` hourly tick (NOT a second cron — the hourly fn detects hour==13 UTC and sends the digest). |
| D0.4 | Vault secret names are `supabase_url` and `service_role_key` (22 uses across migrations — canonical). DO NOT use `supabase_service_role_key` (a one-off in the tr4 file). |
| D0.5 | Auth-guard: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (copy `process-scheduled-installments/index.ts:77-80`). NO `CRON_SECRET`. |
| D0.6 | Alert email path = `sendOpsAlertEmail` (`_shared/stripeOpsAlertEmail.ts`) ONLY. No new Resend path. |
| D0.7 | EXCLUDED from monitored set (dead/dormant — separate cleanup ORCH): Foursquare, Eventbrite, OpenWeatherMap edge fn, Firebase, Anthropic (dormant ref), Open-Meteo (keyless, low value — optional only, NOT built). |
| D0.8 | Resolved OQs: (1) Serper = reachability only, no balance API; (2) twilio-inbound-sms = accept gap, NO new table; (3) Google Places = cheapest single Places call hourly; (4) OneSignal = both apps surfaced separately; (5) Giphy = Layer-A statuspage tile only. |

---

## 1. MIGRATION

**File:** `supabase/migrations/<PREFIX>_orch_1201_api_health_hub.sql`

**PREFIX RULE:** Current max prefix in this worktree = `20261118000000`. **Use `20261119000000`.** RE-CHECK at implement time: run `ls supabase/migrations/ | sort | tail -5` against the LATEST origin/main (META-ORCH/COMMS collision history — see MEMORY migration-version-prefix collisions). If `20261119000000` is taken, bump to the next free `2026111Z000000` monotonic slot and note it in the implementation report.

**Single migration file** containing, in order: (1) tables + indexes, (2) RLS, (3) SECURITY DEFINER read RPCs, (4) cron schedule, (5) self-verification probe.

### 1.1 Tables

```sql
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
  service_key          text PRIMARY KEY REFERENCES public.api_health_services(service_key),
  current_state        text NOT NULL DEFAULT 'ok' CHECK (current_state IN ('ok','alerting')),
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_alert_at        timestamptz,
  last_recovery_at     timestamptz,
  last_balance_alert_at timestamptz,           -- low-balance one-shot cooldown
  last_balance_state   text DEFAULT 'ok' CHECK (last_balance_state IN ('ok','low','unknown')),
  last_digest_at       timestamptz,            -- shared across services (digest is global; only service_key='_digest' row uses it)
  updated_at           timestamptz NOT NULL DEFAULT now()
);
```

**`service_key` canonical owner table (the ONE owner of the monitored-service list — Invariant I-PROPOSED-1201-SERVICE-KEY-CANONICAL):**

```sql
CREATE TABLE IF NOT EXISTS public.api_health_services (
  service_key  text PRIMARY KEY,
  display_name text NOT NULL,
  category     text NOT NULL,          -- 'ai'|'payments'|'maps'|'discovery'|'messaging'|'media'|'platform'|'observability'
  sort_order   integer NOT NULL DEFAULT 100
);
```

Seed EXACTLY these rows (this is the finalized monitored set — every key the probe and UI reference must exist here):

```sql
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
```

Then seed `api_health_alert_state` one row per service (so the state machine always has a row) plus the `_digest` pseudo-row:

```sql
INSERT INTO public.api_health_alert_state (service_key)
  SELECT service_key FROM public.api_health_services
ON CONFLICT (service_key) DO NOTHING;
-- digest cooldown carrier (FK-exempt: add _digest to services OR drop the FK for this row).
-- DECISION: add a synthetic row to api_health_services to satisfy the FK:
INSERT INTO public.api_health_services (service_key, display_name, category, sort_order)
  VALUES ('_digest','(daily digest carrier)','platform',999) ON CONFLICT DO NOTHING;
INSERT INTO public.api_health_alert_state (service_key) VALUES ('_digest') ON CONFLICT DO NOTHING;
```
(The admin RPC and UI MUST filter out `service_key='_digest'`.)

### 1.2 RLS

```sql
ALTER TABLE public.api_health_checks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_health_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_health_alert_state  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_health_services     ENABLE ROW LEVEL SECURITY;
-- NO policies created → with RLS enabled and no policy, anon/authenticated are DENIED all access.
-- service_role bypasses RLS (probe writes). Admin reads go through SECURITY DEFINER RPC ONLY.
```
**Acceptance:** a `select * from api_health_checks` as `authenticated` (non-service-role) returns 0 rows / permission-denied. Only `service_role` (probe) writes; only the RPC reads for admins.

### 1.3 Read RPCs (SECURITY DEFINER, admin-gated — mirror `admin_get_pricing_config`)

`is_admin_user()` already exists (defined in `20260505000000_baseline_squash_orch_0729.sql`, used by `admin_get_pricing_config` at `20260802000000_orch_1006_pricing_switches.sql:438`). Reuse it verbatim.

```sql
CREATE OR REPLACE FUNCTION public.admin_get_api_health()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_services jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT COALESCE(jsonb_agg(svc ORDER BY svc->>'sort_order'), '[]'::jsonb) INTO v_services
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
    WHERE s.service_key <> '_digest'
  ) rows;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'services', v_services,
    'last_probe_at', (SELECT max(checked_at) FROM public.api_health_checks)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_api_health() TO authenticated, service_role;
```

Add a second helper for incident history (per-service drill-down, optional in UI v1 but build it):

```sql
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
```

### 1.4 Cron schedule (hourly probe) — copy `process-booking-deadlines` exemplar, vault names per D0.4

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'ORCH-1201: pg_cron extension required — operator must enable before apply'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    RAISE NOTICE 'ORCH-1201: pg_net missing — net.http_post will fail at runtime; enable pg_net'; END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='orch_1201_api_health_probe')
  THEN PERFORM cron.unschedule('orch_1201_api_health_probe'); END IF;
END $$;

SELECT cron.schedule(
  'orch_1201_api_health_probe',
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
```
- `timeout_milliseconds := 60000` (fan-out across ~20 services may exceed 30s).
- NO second cron for digest. The fn itself sends the digest on the `hour == 13 UTC` tick (D0.3).

### 1.5 Self-verification probe (end of migration)

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='orch_1201_api_health_probe' AND schedule='0 * * * *') THEN
    RAISE EXCEPTION 'ORCH-1201 verify: hourly probe cron not scheduled';
  END IF;
  IF (SELECT count(*) FROM public.api_health_services WHERE service_key <> '_digest') <> 25 THEN
    RAISE EXCEPTION 'ORCH-1201 verify: expected 25 monitored services';
  END IF;
END $$;
```

**Migration acceptance criteria:** idempotent (re-run safe via `IF NOT EXISTS` / `ON CONFLICT` / unschedule-then-schedule); RAISE-guards pg_cron/pg_net; 4 tables + 25 seeded services + 2 RPCs + 1 cron; RLS enabled with zero anon/authenticated policies; self-verify passes.

---

## 2. EDGE FUNCTION — `supabase/functions/api-health-probe/index.ts`

**Orchestration (one HTTP handler, runs per hourly tick):**

1. **CORS preflight** — return `ok` on OPTIONS (copy keep-warm `:18-20`).
2. **Auth-guard** (D0.5):
   ```ts
   const authHeader = req.headers.get("authorization") ?? "";
   if (authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
     return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: {...corsHeaders, "Content-Type":"application/json"} });
   }
   ```
3. **Build service-role Supabase client** for writes (`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`).
4. **Layer-A fan-out** (`Promise.allSettled` over `STATUS_PAGE_URLS` static map, §2.1). Each: `fetch(url, {signal: AbortSignal.timeout(5000)})` → parse `.status.indicator`. Map indicator→status: `none`→`healthy`, `minor`→`degraded`, `major`/`critical`→`down`, anything else / fetch-fail → `unknown`. Build an `api_health_checks` row `{service_key, layer:'status_page', status, latency_ms, http_status, detail:{indicator,description}}`.
5. **Layer-B fan-out** (`Promise.allSettled` over the probe list, §2.2). Each authed probe returns `{ok, latencyMs, httpStatus, status, detail}`. Wrap each in its own try/catch so one dead vendor → that service `unknown`/`down`, never throws the tick.
6. **Layer-C reads** (§2.3) — query `notification_deliveries`, `payment_webhook_events`, `twilio_message_status_events`, `event_cover_video_jobs`. Produce `passive`/`webhook` rows.
7. **Bulk insert** all collected rows into `api_health_checks` (single `.insert([...])`).
8. **Run alert state machine** (§3) reading the just-computed per-service status + balances.
9. **If `new Date().getUTCHours() === 13`** → send daily digest (§3.5).
10. **Return** `{ ok:true, ticks: <count>, alerts_sent, digest_sent, timestamp }`.

**Never throw out of the handler for a single vendor failure** — wrap the whole body in try/catch → `logError("api_health_probe failed", err, {fn:"api-health-probe"})` and return 200 with `{ok:false, error}` so pg_cron does not retry-storm. Use `structuredLog`/`logError` from `_shared/structuredLog.ts`.

### 2.1 STATUS_PAGE_URLS (Layer-A static map — confirmed feeds)

```ts
const STATUS_PAGE_URLS: Record<string,string> = {
  stripe:             "https://status.stripe.com/api/v2/status.json",
  paystack:           "https://status.paystack.com/api/v2/status.json",
  openai:             "https://status.openai.com/api/v2/status.json",
  mapbox:             "https://status.mapbox.com/api/v2/status.json",
  onesignal_consumer: "https://status.onesignal.com/api/v2/status.json",
  onesignal_business: "https://status.onesignal.com/api/v2/status.json", // same vendor page; both tiles share it
  resend:             "https://resend-status.com/api/v2/status.json",
  twilio:             "https://status.twilio.com/api/v2/status.json",
  cloudinary:         "https://status.cloudinary.com/api/v2/status.json",
  supabase:           "https://status.supabase.com/api/v2/status.json",
  vercel:             "https://www.vercel-status.com/api/v2/status.json",
  sentry:             "https://status.sentry.io/api/v2/status.json",
  posthog:            "https://status.posthog.com/api/v2/status.json",
  giphy:              "https://status.giphy.com/api/v2/status.json", // if 404/non-JSON → record status 'unknown' (D0.8 #5)
};
// No clean JSON feed (DO NOT add): gemini, google_places, ticketmaster, serper, exchangerate, thumio, mixpanel, appsflyer, ga4, revenuecat.
```
**Note:** Mixpanel/AppsFlyer/GA4/RevenueCat/ExchangeRate/Thum.io have no reliable `/api/v2/status.json`. For these, the UI shows whatever the latest row is; if no Layer-A or Layer-B signal exists, they remain `unknown` (constitutional: surface unknown, do not fabricate green).

### 2.2 Layer-B authed probes (cheapest liveness per service)

`status` per probe: HTTP 2xx → `healthy`; 429 / 5xx → `degraded`; network error / 4xx-auth → `down`; (giphy/no-probe services) → not in this list.

| service_key | Method + endpoint | Auth | OK signal | Balance capture |
|---|---|---|---|---|
| `gemini` | `GET https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}` | query key | 200 + `models[]` present | — |
| `openai` | `GET https://api.openai.com/v1/models` | `Authorization: Bearer ${OPENAI_API_KEY}` | 200 | — |
| `stripe` | `createStripeClientForRole("platform").balance.retrieve()` (see note) | resolver | resolves without throw | `detail.balance` = available[0].amount/currency (funds, not API credit — informational) ; `detail.mode` = active mode |
| `paystack` | `GET ${PAYSTACK_BASE_URL}/balance` (`PAYSTACK_BASE_URL='https://api.paystack.co'`) | `Authorization: Bearer ${resolvePaystackSecretKey()}` | 200 + `status:true` | `detail.balance` = data[0].balance/currency; `detail.mode` = active mode |
| `mapbox` | `GET https://api.mapbox.com/geocoding/v5/mapbox.places/test.json?limit=1&access_token=${MAPBOX_ACCESS_TOKEN}` | query token | 200 + `features` | — |
| `google_places` | `GET https://maps.googleapis.com/maps/api/place/textsearch/json?query=coffee&key=${GOOGLE_MAPS_API_KEY}` | query key | 200 + `status` in `OK\|ZERO_RESULTS` | — |
| `ticketmaster` | `GET https://app.ticketmaster.com/discovery/v2/events.json?size=1&apikey=${TICKETMASTER_API_KEY}` | query key | 200 | — (rate-limit headers → detail) |
| `serper` | `POST https://google.serper.dev/search` body `{"q":"mingla healthcheck","num":1}` | `X-API-KEY: ${SERPER_API_KEY}` | 200 | NO balance API (D0.8 #1) — reachability only |
| `pexels` | `GET https://api.pexels.com/v1/search?query=city&per_page=1` | `Authorization: ${PEXELS_API_KEY}` | 200 | `detail.rate_remaining`=`X-Ratelimit-Remaining`, `detail.rate_reset`=`X-Ratelimit-Reset` headers |
| `onesignal_consumer` | `GET https://api.onesignal.com/apps/${ONESIGNAL_APP_ID}` | `Authorization: Key ${ONESIGNAL_REST_API_KEY}` (CONFIRMED scheme — matches `_shared/push-utils.ts:156` `Key ${restKey}`) | 200 | — |
| `onesignal_business` | same, `${ONESIGNAL_BUSINESS_APP_ID}` + `${ONESIGNAL_BUSINESS_REST_API_KEY}` | as above | 200 | — |
| `resend` | `GET https://api.resend.com/domains` | `Authorization: Bearer ${RESEND_API_KEY}` | 200 | — |
| `twilio` | account: `GET https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}.json`; balance: `GET .../Accounts/${SID}/Balance.json` | Basic `base64(SID:AUTH_TOKEN)` | 200 | `detail.balance`=`balance`, `detail.currency`=`currency` |
| `cloudinary` | `GET https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/usage` | Basic `base64(API_KEY:API_SECRET)` | 200 | `detail.credits_used`=`credits.usage`, `detail.credits_limit`=`credits.limit` |
| `supabase` | `serviceClient.from('api_health_services').select('service_key').limit(1)` (cheap `select 1` equivalent) | service-role | no error | — |

**Mode resolvers (D0.4 / investigation §4) — DO NOT hardcode keys/mode. EXPORTS CONFIRMED in this worktree:**
- Stripe: `import { createStripeClientForRole } from "../_shared/stripe.ts";` (CONFIRMED export, `_shared/stripe.ts`) and `import { resolveStripeMode } from "../_shared/stripeMode.ts";` (CONFIRMED, `stripeMode.ts:58`; key routing via `resolveStripeKey(role)` `:73`). Set `detail.mode = resolveStripeMode()`.
- Paystack: `import { resolvePaystackSecretKey, PAYSTACK_BASE_URL, resolvePaystackMode } from "../_shared/paystack.ts";` (CONFIRMED: `PAYSTACK_BASE_URL` `:27`, `resolvePaystackMode` `:34`, `resolvePaystackSecretKey` `:46`). Set `detail.mode = resolvePaystackMode()`.

**No-probe services (Layer-A and/or passive only — NOT in §2.2 list):** `vercel`, `exchangerate`, `thumio`, `revenuecat`, `posthog`, `mixpanel`, `appsflyer`, `ga4`, `sentry`, `giphy`. These get their row from Layer-A (if in §2.1) or remain `unknown`.

### 2.3 Layer-C reads (no instrumentation needed — read existing tables)

| service_key(s) | Source query | Healthy rule |
|---|---|---|
| `resend`, `twilio`, `onesignal_consumer`/`_business` | `SELECT provider, status, count(*) FROM notification_deliveries WHERE created_at > now()-interval '24 hours' GROUP BY provider,status` — map `provider`: `resend`→resend, `twilio`→twilio, `onesignal`→**both** onesignal tiles (no per-app split in deliveries → attribute to consumer; note limitation in detail). | `passive` row `status`: failure-rate < 25% → `healthy`, 25–50% → `degraded`, >50% with ≥5 attempts → `down`, <5 attempts → `unknown` (insufficient data). `detail` = {success, failure, total}. |
| `stripe`/`paystack` (webhook freshness) | latest `payment_webhook_events.created_at`; silent > 6h → `degraded` (mirror `stripe-webhook-health-check` SIX_HOURS_MS). | `webhook` layer row. |
| (cloudinary webhook) | latest `event_cover_video_jobs.created_at` — silent is normal (low volume) → only `unknown`/`healthy`, never alert. | `webhook` layer row, informational. |
| (twilio status webhook) | latest `twilio_message_status_events.received_at`. | `webhook` layer row, informational. |

**Layer-C from `recordApiCall` table:** also fold `api_health_observations` 24h aggregates into the `passive` row for the §2.2-probed services (`gemini`, `stripe`, `paystack`, `mapbox`, `cloudinary`, etc.) so real-traffic success-rate is captured for the 6 wired clients (§4).

### 2.4 Edge fn acceptance criteria
- 401 without correct service-role Bearer.
- One dead/timeout vendor never throws the tick (allSettled isolation) — other services still get rows.
- Writes N `api_health_checks` rows (one per service per applicable layer) per tick.
- Honors active Stripe/Paystack mode via resolvers; `detail.mode` set.
- Balance captured for twilio/cloudinary/paystack/pexels; absent (not zero) for the rest.
- On hour==13 UTC, digest is attempted exactly once.

---

## 3. ALERT STATE MACHINE

Lives inside `api-health-probe/index.ts` (a function `runAlertStateMachine(serviceStatuses, balances, serviceClient)`), reading/writing `api_health_alert_state`.

### 3.1 Per-service availability state
For each monitored service, compute a single rolled-up `effectiveStatus` for this tick = worst of its layer statuses this tick, where `down` worst, then `degraded`, then `healthy`; `unknown` does NOT count as a failure (insufficient signal must never alert).

- `effectiveStatus === 'down'` → `failedTick = true`. Else `failedTick = false` (degraded does NOT enter alerting on its own — degraded is surfaced in UI but only `down` drives email, to avoid noise; **EXCEPTION:** webhook-silence `degraded` for stripe/paystack DOES count as failedTick, matching existing 6h-silence alert behavior).

### 3.2 Entry to alerting (N=2 consecutive)
```
if failedTick: consecutive_failures += 1
else:          consecutive_failures = 0
if current_state == 'ok' and consecutive_failures >= 2:
    current_state = 'alerting'; last_alert_at = now()
    SEND down-alert email
```
N=2 (~2 consecutive hourly ticks) suppresses single-tick flaps.

### 3.3 Cooldown re-alert (6h)
```
if current_state == 'alerting' and failedTick and now() - last_alert_at >= 6h:
    last_alert_at = now(); SEND down-alert email (reminder)
```

### 3.4 Recovery
```
if current_state == 'alerting' and not failedTick (effectiveStatus in healthy/degraded for ≥1 tick):
    current_state = 'ok'; consecutive_failures = 0; last_recovery_at = now()
    SEND recovery email
```

### 3.5 Low-balance one-shot (threshold-cross)
For services exposing balance, compare to threshold; on `ok`→`low` transition send one alert, set `last_balance_alert_at`, `last_balance_state='low'`. Re-alert at most once per 24h while still low. Reset to `ok` when balance recovers above threshold.

**Default thresholds (env-overridable, document in §6):**
| service | balance source | default threshold | env override |
|---|---|---|---|
| twilio | `Balance.json` balance (USD) | `< 20` | `API_HEALTH_TWILIO_MIN_BALANCE` |
| cloudinary | `usage` credits remaining (limit−usage) | `< 10%` of limit | `API_HEALTH_CLOUDINARY_MIN_CREDIT_PCT` |
| paystack | `/balance` data[0].balance (subunits) | `< 100000` (₦1,000) | `API_HEALTH_PAYSTACK_MIN_BALANCE` |
| pexels | `X-Ratelimit-Remaining` | `< 100` | `API_HEALTH_PEXELS_MIN_RATE` |

### 3.6 Email send — reuse `sendOpsAlertEmail` ONLY (D0.6, I-PROPOSED-1201-ALERT-EMAIL-SINGLE-OWNER)
```ts
import { sendOpsAlertEmail } from "../_shared/stripeOpsAlertEmail.ts";
function alertRecipients(): string[] {
  const raw = Deno.env.get("API_HEALTH_ALERT_EMAILS") ?? "seth@usemingla.com";
  return raw.split(",").map(s=>s.trim()).filter(Boolean);
}
```

**Down alert:**
- subject: `⚠️ [API HEALTH] ${display_name} is DOWN`
- paragraphs: `["${display_name} failed ${consecutive_failures} consecutive health checks.", "Layer: ${failingLayer}. Last error: ${detail.error || detail.description || 'see admin hub'}.", "Active mode: ${mode || 'n/a'}.", "Checked at ${checked_at} UTC."]`
- cta: `{ label: "Open API Health hub", url: "<ADMIN_URL>/#/api-health" }` (ADMIN base from env `API_HEALTH_ADMIN_URL`, default `https://admin.usemingla.com`).

**Recovery alert:** subject `✅ [API HEALTH] ${display_name} recovered`; one paragraph noting downtime span (`last_alert_at`→now).

**Low-balance alert:** subject `💳 [API HEALTH] ${display_name} balance low`; paragraph with current value + threshold.

**Daily digest (hour==13 UTC):** subject `📊 [API HEALTH] Daily digest — ${date}`; body = per-service line `${display_name}: ${state} · uptime ${uptime_24h_pct||'—'}% · ${balanceLine||''}`, plus a "Recent incidents" list (services with ≥1 `down`/`degraded` in 24h). Gate on `_digest` row's `last_digest_at` (skip if already sent within 20h). Set `last_digest_at=now()`.

**Idempotency:** before each send, build an idempotency key `api-health:${service_key}:${state}:${YYYY-MM-DD-HH}` (mirror `stripe-webhook-health-check:46`). Track sent keys within the tick to avoid double-send; the N=2/cooldown/state-transition logic already guarantees one email per transition. (No new idempotency table required — the state row + cooldown timestamps are the dedup.)

### 3.7 Acceptance
- Single-tick `down` (1 fail) sends NO email (N=2 gate).
- 2 consecutive `down` → exactly one down email.
- While alerting, no re-email until 6h elapsed.
- Recovery → exactly one recovery email, state back to `ok`.
- Low-balance cross → one email; no repeat within 24h.
- Digest fires once/day at 13:00 UTC tick.
- `unknown` never triggers any email.

---

## 4. SHARED HELPER — `supabase/functions/_shared/apiHealthLog.ts`

```ts
import { structuredLog } from "./structuredLog.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"; // match the version used elsewhere in _shared

/**
 * Layer-C passive recorder. Best-effort: emits a structured log line AND inserts
 * one api_health_observations row. NEVER throws — must not alter or slow the host call.
 */
export async function recordApiCall(
  serviceKey: string,
  ok: boolean,
  latencyMs: number,
  httpStatus?: number,
): Promise<void> {
  // 1) always log (Sentry-visible via structuredLog) — synchronous, cheap.
  structuredLog("info", "api_call", { service: serviceKey, ok, latencyMs, httpStatus });
  // 2) best-effort DB insert; swallow ALL errors.
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const c = createClient(url, key);
    await c.from("api_health_observations").insert({
      service_key: serviceKey, ok, latency_ms: Math.round(latencyMs), http_status: httpStatus ?? null,
    });
  } catch (_e) { /* swallow — host call must never break */ }
}
```

**Wire into EXACTLY these `_shared` api-client chokepoints (one wrap per file — measure latency around the existing fetch, call `recordApiCall` after, in a way that does not await-block the host return path materially; `void recordApiCall(...)` fire-and-forget is acceptable and preferred):**

| # | File | Wrap location | service_key |
|---|---|---|---|
| 1 | `_shared/paystack.ts` | the single shared `fetch(PAYSTACK_BASE_URL…)` used by `paystackInitializeTransaction`/`paystackVerifyTransaction` (`:83`,`:117`) — wrap the common fetch | `paystack` |
| 2 | `_shared/mapboxGeocode.ts` | the single Mapbox geocode fetch entrypoint | `mapbox` |
| 3 | `_shared/eventCoverVideo.ts` | Cloudinary upload/signature fetch helper | `cloudinary` |
| 4 | `_shared/agentGemini.ts` | the `generativelanguage.googleapis.com` fetch | `gemini` |
| 5 | `_shared/geminiMenuParser.ts` | the `generativelanguage.googleapis.com` fetch | `gemini` |
| 6 | `_shared/appsFlyerS2S.ts` | the AppsFlyer S2S fetch | `appsflyer` |

**Stripe:** SDK-wrapped; DO NOT wrap (rely on Layer-B probe + Sentry breadcrumbs) — avoids deep SDK surgery (Invariant PROBE-NO-WRITE-SIDE-EFFECTS keeps blast radius low).

**Email/SMS/Push: NOT wired.** Layer-C for `resend`/`twilio`/`onesignal_*` reads `notification_deliveries` (§2.3). Confirm zero edits to `notifyV2.ts` / adapters.

**Acceptance:** each wrapped client still returns identical values/shape; `recordApiCall` errors are swallowed; a forced insert failure does not break the host call (test by pointing at a bad table name in a unit harness → host still returns).

---

## 5. ADMIN UI — `mingla-admin`

### 5.1 Registry + nav (3 edits)
- `mingla-admin/src/App.jsx`: import `import { ApiHealthPage } from "./pages/ApiHealthPage";` and add to `PAGES`: `"api-health": ApiHealthPage,`.
- `mingla-admin/src/lib/constants.js` `NAV_GROUPS`: add `{ id: "api-health", label: "API health", icon: "Activity" }` (icon already imported pattern; `Activity` is a valid lucide icon already used). Place in the same group as `stripe-mode`/`settings` (ops group).
- **Update the sidebar count tests** (`orch1014_sidebar_post_prune.test.js` asserts `NAV_ITEMS.length === 10`; `orch1008_sidebar.test.js` asserts `16`). Adding one item changes counts → bump the expected numbers in BOTH tests (or the build's lint/test gate fails). The implementor MUST update these assertions to the new totals and note it.

### 5.2 Service file — `mingla-admin/src/services/apiHealthService.js`
```js
import { supabase } from "../lib/supabase";
export async function getApiHealth() {
  const { data, error } = await supabase.rpc("admin_get_api_health");
  if (error) throw new Error(error.message || "Could not load API health.");
  return data;
}
export async function getApiHealthIncidents(serviceKey, limit = 50) {
  const { data, error } = await supabase.rpc("admin_get_api_health_incidents", {
    p_service_key: serviceKey, p_limit: limit,
  });
  if (error) throw new Error(error.message || "Could not load incidents.");
  return data;
}
```
(Mirror `src/lib/pricing.js` shape. Place the RPC client here per the existing `src/services/` convention; `pricing.js` lives in `lib/` but new domain services go in `src/services/` — match `adminClaimsService.js`/`deckTunerService.js`.)

### 5.3 Page — `mingla-admin/src/pages/ApiHealthPage.jsx`
Reuse the existing UI kit ONLY (no new design system): `SectionCard`/`AlertCard` (`components/ui/Card`), `Badge`, `Skeleton`, `Button`, `DataTable` (for incidents drill-down), `useToast`. Match `PricingPage.jsx` structure (mountedRef, useCallback loader, loading/empty/error states).

**Layout:** a responsive grid of per-service cards, grouped by `category`. Each card shows:
- **Status dot** (green/amber/red/grey) = worst-of-layers: `healthy`→green, `degraded`→amber, `down`→red, `unknown`→grey. Dot color must reflect `alert_state==='alerting'` as red regardless.
- `display_name` + category.
- **Layer breakdown row**: small labeled chips `Status page · Synthetic · Passive · Webhook` each colored by that layer's latest status; absent layers render greyed "—".
- **Latency** (synthetic layer `latency_ms` if present).
- **Credit balance** where available (twilio/cloudinary/paystack/pexels) — from `detail`.
- **Last checked** (`max checked_at`), relative time.
- **24h uptime %** + **passive 24h** success/total.
- **Last incident** — clicking opens incidents (call `getApiHealthIncidents`).

**Auto-refresh:** poll `getApiHealth()` every 60s via `setInterval` (cleared on unmount); plus a manual "Refresh" button. Show `last_probe_at` ("Last probe: 14m ago") — if `> 90 min` ago, show an amber banner "Probe may be stalled" (the cron should run hourly).

**States (constitutional rules 3 + 9 — no fabricated data, surface errors):**
- **Loading:** `Skeleton` cards.
- **Error:** `AlertCard` with the thrown message + retry button. NEVER render fake green.
- **Empty / `unknown`:** render the card with a grey dot and explicit "No signal yet" — do NOT imply healthy.

### 5.4 Acceptance
- Non-admin (RLS/RPC `not_authorized`) → page shows error state, no data.
- A `down` service renders a red dot + appears in the digest.
- `unknown` services render grey, never green.
- Auto-refresh updates without full reload; unmount clears the interval.
- Sidebar tests updated and passing.

---

## 6. CONFIG

### 6.1 `supabase/config.toml`
Add (placement: alphabetical-ish near other function blocks):
```toml
[functions.api-health-probe]
verify_jwt = false
```
(Precedent: `config.toml` weather/events/stripe-webhook blocks all `verify_jwt = false`.)

### 6.2 New env vars (document in implementation report; operator sets in Supabase Edge secrets)
| Var | Default | Purpose |
|---|---|---|
| `API_HEALTH_ALERT_EMAILS` | `seth@usemingla.com` | comma-list alert recipients (parsed like `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS`) |
| `API_HEALTH_ADMIN_URL` | `https://admin.usemingla.com` | CTA base URL in alert emails |
| `API_HEALTH_TWILIO_MIN_BALANCE` | `20` | low-balance threshold (USD) |
| `API_HEALTH_CLOUDINARY_MIN_CREDIT_PCT` | `10` | low-credit threshold (% of limit) |
| `API_HEALTH_PAYSTACK_MIN_BALANCE` | `100000` | low-balance threshold (NGN subunits) |
| `API_HEALTH_PEXELS_MIN_RATE` | `100` | low rate-limit-remaining threshold |

### 6.3 Existing secrets the probe READS (all already provisioned; probe must tolerate any being absent → that service → `unknown`, never crash)
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `MAPBOX_ACCESS_TOKEN`, `GOOGLE_MAPS_API_KEY`, `TICKETMASTER_API_KEY`, `SERPER_API_KEY`, `PEXELS_API_KEY`, `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `ONESIGNAL_BUSINESS_APP_ID`, `ONESIGNAL_BUSINESS_REST_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `STRIPE_SECRET_KEY`/`STRIPE_RAK_*` (via `createStripeClientForRole`), `MINGLA_STRIPE_MODE`, `PAYSTACK_SECRET_KEY_TEST`/`PAYSTACK_SECRET_KEY_LIVE` (via `resolvePaystackSecretKey`), `PAYSTACK_MODE`.
**Vault (cron, not edge env):** `supabase_url`, `service_role_key`.

---

## 7. INVARIANTS (status: I-PROPOSED — flip ACTIVE on close)

| ID | Statement | Enforcement |
|---|---|---|
| **I-PROPOSED-1201-ALERT-EMAIL-SINGLE-OWNER** | The api-health hub sends operator alerts ONLY through `sendOpsAlertEmail`; no new Resend/`fetch("api.resend.com")` path in `api-health-probe`. | strict-grep: `rg "api.resend.com\|RESEND_API_URL" supabase/functions/api-health-probe` must return 0; `rg "sendOpsAlertEmail" supabase/functions/api-health-probe/index.ts` must return ≥1. |
| **I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS** | Synthetic probes are read-only against vendors (no POST that mutates vendor state) and `recordApiCall` never throws into the host call. EXCEPTION: the Serper liveness POST is a read-only search (no mutation). | grep: in `api-health-probe`, the only non-GET vendor calls allowed are `serper` search + the Stripe/Paystack SDK reads; a test asserts `recordApiCall` swallows a forced insert error. |
| **I-PROPOSED-1201-SERVICE-KEY-CANONICAL** | `public.api_health_services` is the ONE owner of the monitored-service list. Every `service_key` used by the probe and the UI must exist as a seeded row; `api_health_checks.service_key` + `api_health_alert_state.service_key` are FK-constrained to it. | DB FK constraints (migration §1.1) + a test that the probe's STATUS_PAGE_URLS/probe keys ⊆ seeded services. |
| **I-PROPOSED-1201-NO-FABRICATED-HEALTH** | The admin UI never renders a green/healthy indicator for a service with no signal; `unknown`→grey. | UI unit test: feed a service with empty `layers` → dot class is the grey/unknown variant, not healthy. |

Add the strict-grep checks to the existing gate runner pattern (e.g. a `scripts/`/`__tests__` mjs gate like the project's `orch-1130-no-buyer-tax-form.mjs` precedent). The implementor locates the gate harness and registers these.

---

## 8. TEST PLAN

### 8.1 Implementor regression tests (happy-path, MUST fail-on-revert)
**Backend (deno test or node harness against pure functions — extract pure logic so it's testable):**
1. **Status indicator mapping:** `none→healthy, minor→degraded, major→down, critical→down, garbage→unknown`.
2. **allSettled isolation:** feed a probe set where one probe rejects → all others still produce rows; tick returns 200. (fail-on-revert: removing `allSettled` and using `Promise.all` makes one rejection drop all rows.)
3. **State machine entry:** 1 fail → no email + `consecutive_failures==1`; 2nd fail → email + `state==alerting`. (fail-on-revert: changing N to 1 fires on first fail.)
4. **Recovery:** alerting → healthy tick → recovery email + `state==ok`.
5. **Cooldown:** alerting + fail within 6h → no email; after 6h → email.
6. **Low-balance cross:** balance 15 (<20) when `last_balance_state==ok` → one email; same again → no email (within 24h).
7. **Digest gating:** hour==13 & `last_digest_at` null → digest sent; hour==14 → not sent.
8. **`recordApiCall` best-effort:** forced insert error → resolves without throw; host return unaffected.
9. **Migration self-verify:** apply migration in a test DB (or assert the SQL contains the cron schedule + 25-service guard).

**Admin (vitest/node):**
10. Service file maps RPC error → thrown `Error` with message.
11. Page renders loading→data→error states; `unknown` service → grey dot (I-PROPOSED-1201-NO-FABRICATED-HEALTH).
12. Sidebar count tests updated to new totals and passing.

### 8.2 Tester adversarial tests (different angle — assume broken)
1. **Flap suppression:** alternating fail/ok/fail/ok across ticks NEVER reaches `alerting` (consecutive resets). Prove exactly-once email per real transition, not per tick.
2. **Cooldown spam:** 24h of continuous `down` ticks → emails fire at most every 6h (≤4 emails/day), not hourly.
3. **One dead vendor:** force one Layer-B probe to hang/timeout → tick still completes < timeout, other services get rows, no email for the healthy ones. (allSettled + per-probe AbortSignal.)
4. **RLS denial:** authenticated-non-admin `select` on all 3 tables → denied; `admin_get_api_health` as non-admin → `not_authorized`.
5. **Email fires exactly once per transition:** drive ok→alerting→ok→alerting and count emails (2 down + 1 recovery + 1 down). Verify idempotency key prevents same-tick duplicate.
6. **Unknown never alerts:** all probes return `unknown` (e.g. missing secrets) → zero emails, UI all grey.
7. **Low-balance reset:** balance drops below then recovers above threshold → low email once, then state resets so a future drop alerts again.
8. **Auth-guard:** POST without service-role Bearer → 401; with it → 200.
9. **Host-call non-regression (blast):** call each of the 6 `recordApiCall`-wrapped `_shared` clients with the insert path broken → returns identical result vs. unwrapped baseline; measure latency delta is negligible (fire-and-forget `void`).
10. **Digest content correctness:** digest lists every service with its real 24h uptime + balances; a `down` service appears under "Recent incidents".

### 8.3 Evidence requirements
Implementor: test output showing fail-on-revert for items 2,3,4. Tester: runtime evidence (live probe tick log + a real `api_health_checks` row dump + at least one captured alert email render or `sendOpsAlertEmail` mock-capture). Source-only reasoning capped at "suspected".

---

## 9. CROSS-SURFACE + BLAST RADIUS

- **Consumer app (`app-mobile`): ZERO changes.** No file under `app-mobile/` is touched.
- **Business app (`mingla-business`): ZERO changes.** No file under `mingla-business/` is touched.
- **Marketing (`mingla-marketing`): ZERO changes.**
- **Changed surfaces:** `supabase/migrations/`, `supabase/functions/api-health-probe/` (new), `supabase/functions/_shared/apiHealthLog.ts` (new) + 6 `_shared` client edits, `supabase/config.toml`, `mingla-admin/` (new page + service + nav + test count bumps).
- **Layer-C wrap non-regression:** the 6 `_shared` wraps MUST (a) not change the host call's return value/shape, (b) not add a blocking `await` on the host path — use fire-and-forget `void recordApiCall(...)`, (c) swallow all errors. The wrapped clients run in consumer/business/backend edge contexts, so any behavior or latency change WOULD blast to the apps indirectly — the fire-and-forget + swallow contract is what keeps blast radius zero. Tester item 9 proves this.
- **Webhooks:** no changes to any inbound receiver; the hub only READS their persistence tables.
- **No new business-app/consumer OTA, no native build** — backend + admin web only (admin is a Vercel web deploy).

---

## 10. IMPLEMENTATION ORDER (mechanical)
1. Migration (tables, RLS, RPCs, cron, self-verify) — re-check prefix vs origin/main first.
2. `_shared/apiHealthLog.ts` + 6 client wraps.
3. `api-health-probe/index.ts` (auth-guard, Layer A/B/C, state machine, digest).
4. `config.toml` block.
5. Admin: service → page → nav → sidebar test count bumps.
6. Invariant gates (strict-grep + tests).
7. Regression tests (§8.1). Prove fail-on-revert for 2/3/4.
8. Implementation report: actual prefix used, env vars to set, any export-name corrections (Stripe/Paystack resolver names, OneSignal auth scheme), test output.

**RESOLVED at SPEC time (already verified in this worktree — bound above, do not re-derive):**
- Stripe: `createStripeClientForRole` (stripe.ts), `resolveStripeMode`/`resolveStripeKey(role)` (stripeMode.ts:58,73). ✓
- Paystack: `PAYSTACK_BASE_URL` (:27), `resolvePaystackMode` (:34), `resolvePaystackSecretKey` (:46). ✓
- OneSignal REST auth scheme = `Authorization: Key ${restKey}` (push-utils.ts:156). ✓
- Vault secret names = `supabase_url` + `service_role_key` (22 uses, canonical). ✓
- Migration max prefix = `20261118000000` → use `20261119000000`. ✓
- Admin sidebar count tests assert 10 / 16 — must bump on add. ✓

**OPEN ITEMS the implementor must still resolve by reading code at implement time (do NOT guess — verify the exact symbol):**
- The `@supabase/supabase-js` esm.sh version pinned across `_shared` (match it in `apiHealthLog.ts`).
- The exact fetch entrypoint line in each of the 6 `_shared` clients (wrap the actual single fetch).
- RE-CHECK migration prefix vs latest origin/main (collision history).

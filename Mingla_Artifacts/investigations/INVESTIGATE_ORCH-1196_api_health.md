# INVESTIGATE — ORCH-1196 Admin API-Health Hub + Email Alerts

**Phase:** INVESTIGATE (read-only forensics → SPEC input)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1196-[api-health-hub]/` · branch `ORCH-1196-api-health-hub`
**Date:** 2026-06-21
**Mandate:** No assumptions. Every claim cites file:line. Resolve all 5 open verification items; document reusable infra; define the technical approach for all three health layers (A vendor status pages, B authenticated probes, C passive real-traffic), hourly cadence, single recipient via env-var list.
**Authoritative inventory read:** `Mingla_Artifacts/ORCH-1196_API_INVENTORY.md` (incl. LOCKED DECISIONS block).

---

## 1. Live / Dormant Verdicts (grep'd call sites, not env-var existence)

| Service | Verdict | Probe-relevant? | Evidence |
|---|---|---|---|
| **Foursquare** | **DORMANT / DEAD** | Drop from hub | Env var declared `mingla-business/.env.example` (`EXPO_PUBLIC_FOURSQUARE_API_KEY`); **zero call sites** — no `api.foursquare.com` fetch, no SDK import anywhere in app-mobile/mingla-business/supabase/functions/packages. Only an aspirational comment in `app-mobile/src/services/enhancedLocationService.ts` ("would integrate with… Foursquare"). |
| **Eventbrite** | **DORMANT / DEAD** | Drop from hub | Token read at `supabase/functions/events/index.ts:208` (`Deno.env.get('EVENTBRITE_TOKEN')`), fetch at `supabase/functions/events/index.ts:229-237` (`eventbriteapi.com/v3/events/search`). But the `events` edge fn is **never invoked** — no `functions.invoke("events")` in any app/service; the live Discover path is `discover-merged-events` → `ticketmaster-events`. Legacy/abandoned with seeded-mock fallback. |
| **Open-Meteo** (consumer weather) | **LIVE** | Hard to probe (client, keyless) | `app-mobile/src/services/weatherService.ts:8` (`OPEN_METEO_URL = https://api.open-meteo.com/v1/forecast`), called in shipped UI at `app-mobile/src/components/ExpandedCardModal.tsx:1591` and `:1632`. Keyless free API — low monitoring value (no credential to fail). |
| **OpenWeatherMap** (edge `weather`) | **DORMANT / LEGACY** | Drop from hub | `supabase/functions/weather/index.ts:1-2` self-documents `// DEPRECATED 2026-04-13 (ORCH-0419)`; key read `:39`, fetch `:63` (`api.openweathermap.org`). **Never invoked** internally; superseded by Open-Meteo. `OPENWEATHER_API_KEY` can be retired. |
| **Firebase** (`google-services.json`, proj `mingla-dev`) | **DORMANT — build artifact only** | Drop from hub | Referenced only as `app.json:34 "googleServicesFile"`. **Zero Firebase SDK imports/init** anywhere (no `@react-native-firebase`, no `firebase.initializeApp`). All push = OneSignal (`app-mobile/src/services/oneSignalService.ts:16 OneSignal.initialize`). The `.json` exists because the Gradle `google-services` plugin / OneSignal-FCM transport needs it at build time; the logged `W/FirebaseApp: Default FirebaseApp failed to initialize` is the expected no-op. Not a runtime credentialed dependency. |
| **SendGrid** | **DEFINITIVELY ABSENT** | N/A | `rg -i sendgrid` → zero source hits (only the inventory note recording the killed false positive). No `SENDGRID_*` env var. All transactional email = Resend (`emailAdapter.ts:57`, `stripeOpsAlertEmail.ts:71`, `admin-send-email`, `marketing-send`). |

**Net effect on hub scope:** remove Foursquare, Eventbrite, OpenWeatherMap-edge, Firebase from the *synthetic-probe* board. Open-Meteo stays "live" but is keyless/client-side → no Layer-B probe (optional Layer-A reachability ping only).

---

## 2. Reusable Infra — Alert Email + Resend Send Helper (ONE owner, do not fork)

**Canonical ops-alert email helper:** `supabase/functions/_shared/stripeOpsAlertEmail.ts`
- Export `sendOpsAlertEmail(input: { subject, paragraphs[], recipients[], cta? })` → `{ attempted, succeeded, failed }` (`:37-105`).
- Internals: normalizes/dedupes recipients (`:27-35`), reads `RESEND_API_KEY` (`:45`), renders via the shared transactional renderer `renderTransactionalEmail({ variant: "generic_notification", sender: EMAIL_SENDERS.system, … })` (`:57-67`), guards `assertNotResendSandbox` (`:68`), POSTs `https://api.resend.com/emails` (`:71-84`) with `Authorization: Bearer ${RESEND_API_KEY}`, per-recipient loop, returns success/fail counts.
- **SPEC reuses this verbatim** — do NOT create a new Resend path. `seth@usemingla.com` ops alerts go through `sendOpsAlertEmail`.

**Sender identities:** `supabase/functions/_shared/email/senders.ts:24-28` — `EMAIL_SENDERS.system = notifications@usemingla.com` (env override `RESEND_SYSTEM_FROM`). `assertNotResendSandbox` (`:30-34`) blocks `@resend.dev`. `formatSenderHeader` (`:36-38`).

**Recipient env-var-list pattern to copy** (LOCKED DECISION #1 — new var `API_HEALTH_ALERT_EMAILS`):
- `stripe-webhook/index.ts:38-40`:
  ```ts
  const raw = Deno.env.get("STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS") ?? "";
  const emails = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (emails.length === 0) return 0;   // no-op when unconfigured (fail-soft)
  ```
- Same shape at `_shared/stripeDisputeHandlers.ts:97` + missing-var warn `:175`.
- → SPEC: `API_HEALTH_ALERT_EMAILS` (comma-list, default `seth@usemingla.com`), parsed identically, passed as `recipients` to `sendOpsAlertEmail`.

**Existing webhook-silence health monitor (the closest precedent — read & mirror its shape):** `supabase/functions/stripe-webhook-health-check/index.ts`
- CRON-gated: reads `CRON_SECRET` (`:14`), checks `authorization` Bearer == secret else 401 (`:16`).
- Queries latest `payment_webhook_events.created_at` (`:21-26`), "unhealthy" = silent > `SIX_HOURS_MS` (`:9`, `:34`).
- On unhealthy: `dispatchNotification({ emailTo: "ops@mingla.app", emailVariant: "generic_notification", … idempotencyKey: ops.webhook_silence_alert:<hour> })` (`:39-48`) — note: this one uses `dispatchNotification`, NOT `sendOpsAlertEmail`. **SPEC should standardize on `sendOpsAlertEmail` for the new hub** (it is the purpose-built, recipient-list, no-push ops path) but may also fold this existing webhook-silence check into the new hourly probe as a Layer-A/webhook signal.

**`keep-warm` precedent (HTTP fan-out shape to copy for Layer-B/A probing):** `supabase/functions/keep-warm/index.ts:11-15` (`FUNCTIONS_TO_WARM` array), `:26-40` `Promise.all` of `fetch(...)` with try/catch capturing `${resp.status}` or `error: …` into a `results` map. This is the exact "probe many endpoints, collect status/error per target" loop the api-health probe should mirror.

**Structured logging + Sentry forwarding (Layer-C plumbing):** `supabase/functions/_shared/structuredLog.ts` — `structuredLog(level, message, fields)` emits one JSON line (`:22-44`); `logError` also forwards to Sentry via `captureEdgeException` (`:46-65`). A Layer-C success/failure+latency line is a `structuredLog("info", "api_call", { service, ok, latencyMs })` call — already the house style.

---

## 3. Scheduling Mechanism — Copy-This Pattern for the Hourly Probe

**Mechanism:** `pg_cron` (extension) + `pg_net` (`net.http_post`) scheduled in a migration. The cron job POSTs the function URL with a **service-role Bearer** pulled from Vault. The edge function verifies the Bearer against `SUPABASE_SERVICE_ROLE_KEY`. `config.toml` sets `verify_jwt = false` for the function. **No Supabase-native scheduled-functions; no `config.toml` cron block.**

**Precedents (verbatim shapes):**
- `notify-outbox-drain` — `supabase/migrations/20261110000003_orch_1161_outbox_drain_cron.sql:46-70`, schedule `'* * * * *'`, job `'orch_1161_notify_outbox_drain'`.
- `notification-retry-sweeper` — `supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql:104-128`, `'*/5 * * * *'`.
- `process-scheduled-installments` — `supabase/migrations/20260610000001_tr3_cron_use_vault_secrets.sql:25-38`, `'0 */6 * * *'`.
- **`process-booking-deadlines` — the HOURLY exemplar: `supabase/migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql:558-571`, schedule `'0 * * * *'`, job `'orch-0875-process-booking-deadlines'`.** ← copy this one.

**Vault secrets used (names are exact):** `supabase_url` and `service_role_key`, read as
`(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)` (per `20260610000001_tr3_cron_use_vault_secrets.sql:30,32`). Header is always `Authorization: Bearer <service_role_key>`. Body `'{}'::jsonb`. `timeout_milliseconds := 30000` (bump to 60000 if probe fan-out is slow).

**Migration template to copy (hourly):**
```sql
-- supabase/migrations/<ts>_orch_1196_api_health_probe_cron.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'ORCH-1196: pg_cron required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    RAISE NOTICE 'ORCH-1196: pg_net missing — http_post will fail at runtime'; END IF;
END$$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='orch_1196_api_health_probe')
  THEN PERFORM cron.unschedule('orch_1196_api_health_probe'); END IF;
END$$;
SELECT cron.schedule('orch_1196_api_health_probe', '0 * * * *', $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1) || '/functions/v1/api-health-probe',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$cron$);
-- verification probe: assert cron.job row exists with schedule '0 * * * *' else RAISE EXCEPTION
```

**Auth-guard in the edge function (copy `process-scheduled-installments/index.ts:77-80`):**
```ts
const authHeader = req.headers.get("authorization") ?? "";
if (authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
  return jsonResponse({ error: "unauthorized" }, 401);
}
```
**`config.toml`:** add `[functions.api-health-probe]` with `verify_jwt = false` (precedent: `config.toml:275-279` notify-outbox-drain).

**Gotchas:** `pg_cron`/`pg_net` must be enabled by operator before apply (migration RAISE-guards this); use `vault.decrypted_secrets` not `vault.secrets`; migration must be idempotent (unschedule-then-schedule). Mingla does NOT use a custom `x-cron-secret` for the service-role-Bearer pattern (only `stripe-webhook-health-check` / `stripe-kyc-stall-reminder` use the separate `CRON_SECRET` env var — a different, older convention). **Recommendation: use the service-role-Bearer pattern for consistency with the 5 batch jobs.**

---

## 4. Per-Service Probe Table (Layer-B authenticated synthetic + Layer-A status pages)

**TEST-mode caveat (LOCKED):** probe the *active* mode. Stripe: `createStripeClientForRole(role)` already resolves the key by `MINGLA_STRIPE_MODE` (`_shared/stripe.ts:67-69`, `_shared/stripeMode.ts`). Paystack: `resolvePaystackSecretKey()` resolves by `PAYSTACK_MODE` (`_shared/paystack.ts:46-57`, base `https://api.paystack.co` `:27`). Reuse these resolvers — never hardcode a mode/key.

**Status-page feeds (Atlassian Statuspage `/api/v2/*.json` — confirmed shape, no auth, free):**
- `status.json` → `{ status: { indicator: none|minor|major|critical, description } }`
- `summary.json` → components + active incidents.

| Service | Layer-B probe (cheapest authed liveness) | Credit/quota balance? | Layer-A status feed (JSON) |
|---|---|---|---|
| **Gemini** | `GET generativelanguage.googleapis.com/v1beta/models?key=GEMINI_API_KEY` (models.list, free) | No (quota via Cloud console only) | none (Google Cloud has a status dashboard, no clean per-service JSON) |
| **OpenAI** | `GET api.openai.com/v1/models` (Bearer, free) | No (usage API exists but coarse) | `https://status.openai.com/api/v2/status.json` |
| **Stripe** | `stripe.balance.retrieve()` via `createStripeClientForRole(...)` (free, active-mode) | Balance = funds, not API credits | `https://status.stripe.com/api/v2/status.json` |
| **Paystack** | `GET api.paystack.co/balance` (Bearer secret, free) | Yes — settlement balance | `https://status.paystack.com/api/v2/status.json` |
| **Mapbox** | tiny geocode `GET api.mapbox.com/geocoding/v5/mapbox.places/test.json?limit=1&access_token=…` (1 billable req) | No (usage in dashboard) | `https://status.mapbox.com/api/v2/status.json` |
| **Google Places/Maps** | minimal Text Search `maps.googleapis.com/maps/api/place/textsearch/json?query=coffee&key=…` (small cost — gate to hourly) | No | none clean |
| **Ticketmaster** | `app.ticketmaster.com/discovery/v2/events.json?size=1&apikey=…` (1-result, rate-limited) | No (rate-limit headers only) | none |
| **Serper** | a 1-result `POST google.serper.dev/search` consumes 1 credit; **no documented dedicated balance endpoint** (dashboard-only per research) → cheapest is a 1-credit search; surface remaining credits from response headers if present | Credits exist but **no public balance API** confirmed → low-balance alert is best-effort (header) or manual | none |
| **Pexels** | `GET api.pexels.com/v1/search?query=city&per_page=1` (Authorization header) — response carries `X-Ratelimit-Remaining`/`Reset` headers | Yes — rate-limit remaining via headers | none |
| **Giphy** | client-only key (`EXPO_PUBLIC_GIPHY_API_KEY`, business app); ToS forbids server proxy → **Layer-A only** (giphy status page) or skip Layer-B | No | `https://status.giphy.com` (statuspage) |
| **OneSignal** | `GET api.onesignal.com/apps/{app_id}` with REST key (free "view app") — TWO apps (consumer `ONESIGNAL_*` + business `ONESIGNAL_BUSINESS_*`) → probe both | No | OneSignal statuspage `https://status.onesignal.com/api/v2/status.json` |
| **Resend** | `GET api.resend.com/domains` (Bearer, free, confirms key + sending domain) | No | `https://resend-status.com/api/v2/status.json` (statuspage) |
| **Twilio** | `GET api.twilio.com/2010-04-01/Accounts/{SID}.json` (Basic auth, free account fetch) + **balance** `GET api.twilio.com/2010-04-01/Accounts/{SID}/Balance.json` (confirmed) | **Yes — Balance.json returns current balance + currency** → low-balance alert | `https://status.twilio.com/api/v2/status.json` (confirmed) |
| **Cloudinary** | Admin API `GET api.cloudinary.com/v1_1/{cloud}/usage` (Basic auth key:secret) — confirmed exposes credits/limits | **Yes — usage() returns credits used + limit + bandwidth/storage** → low-balance alert | `https://status.cloudinary.com/api/v2/status.json` |
| **ExchangeRate-API** | 1 rate fetch (consumer-client, free tier) — Layer-A only / low value | No | none |
| **Thum.io** | 1 screenshot fetch (business-client) — Layer-A only / low value | No | none |
| **Open-Meteo** | keyless (LIVE consumer) — optional Layer-A reachability ping only; nothing to authenticate | No | none |
| **Supabase** | `select 1` via service-role (free) — also self-evident if probe runs | No | `https://status.supabase.com/api/v2/status.json` |
| **Vercel** | hosting — Layer-A only | No | `https://www.vercel-status.com/api/v2/status.json` |
| **Sentry** (obs) | events-arriving signal + status feed | No | `https://status.sentry.io/api/v2/status.json` |
| **PostHog / Mixpanel / AppsFlyer / GA4** (Section B) | not server-creds-probeable the same way → Layer-A status + ingestion confirmation | No | PostHog `https://status.posthog.com/api/v2/status.json`; others statuspage where published |

**Confirmed credit/quota-balance probes (for low-balance email alerts):** Twilio `Balance.json`, Cloudinary `usage`, Paystack `/balance`, Pexels rate-limit headers. Serper has credits but **no confirmed public balance endpoint** (flag as OPEN — dashboard-only).

**Confirmed status-page JSON feeds:** Twilio (verified `status.twilio.com/api/v2`), Stripe, Cloudinary, Mapbox, OneSignal, Supabase, Sentry, Vercel, OpenAI, PostHog — all Atlassian Statuspage `/api/v2/status.json`. (Gemini/Google-Places/Ticketmaster/Serper have no clean public JSON feed → Layer-B/C only.)

---

## 5. Layer-C Passive Instrumentation — Chokepoints (minimal blast radius)

**No central HTTP/fetch wrapper exists** — every vendor client does its own `fetch`. So instrument at the **adapter/dispatcher chokepoints**, not per-call-site.

**The single best chokepoint for email/sms/push: `supabase/functions/_shared/notifyV2.ts`** — the one dispatcher that calls all three adapters:
- `pushAdapter.send` `:176`, `emailAdapter.send` `:188`/`:272`, `smsAdapter.send` `:198`/`:279` — all return a uniform `AdapterResult { ok, status, providerMessageId, error }` (`adapters/smsAdapter.ts:17-24`).
- **CRITICAL: passive success-rate for email/sms/push is ALREADY persisted** — `notifyV2.ts` writes `notification_deliveries` rows with `provider` (onesignal/resend/twilio), `status` (sent/delivered/failed/skipped/…), `failed_reason`, `provider_message_id`, `segments` on every attempt (`writeDelivery :349-368`, `insertGuestDelivery :306-317`, `updateGuestDelivery :337-346`). **Layer-C for these three channels = a read query against `notification_deliveries` grouped by `provider` over the last window — no instrumentation needed.** (Adapters themselves: `emailAdapter.ts:57` Resend fetch, `smsAdapter.ts:137` Twilio fetch, `pushAdapter.ts:25` → `push-utils.sendPush`.)

**Other api clients (each is the natural chokepoint for its vendor — add a one-line `structuredLog` around the fetch):**
- `_shared/stripe.ts` (client factory `:41`,`:67`; `stripeWebhook` import in `stripe-webhook/index.ts:9`) — Stripe SDK; instrument at the helper wrappers or rely on Sentry breadcrumbs.
- `_shared/paystack.ts` — every call goes through `resolvePaystackSecretKey()` + a `fetch(PAYSTACK_BASE_URL…)`; functions `paystackInitializeTransaction :83`, `paystackVerifyTransaction :117`, etc. Single file → wrap the shared fetch.
- `_shared/mapboxGeocode.ts` — single Mapbox geocode entrypoint.
- `_shared/eventCoverVideo.ts` — Cloudinary upload/signature helpers.
- `_shared/agentGemini.ts` + `_shared/geminiMenuParser.ts` — Gemini calls (two files; both hit `generativelanguage.googleapis.com`).
- `_shared/appsFlyerS2S.ts` — AppsFlyer S2S.

**Recommendation:** Layer-C ships as a tiny shared helper `recordApiCall(service, ok, latencyMs, status?)` in `_shared/` that (a) emits a `structuredLog("info","api_call",{…})` line (Sentry-visible via `structuredLog.ts`) and (b) inserts/upserts a rollup row into the new `api_health_observations` table. Insert it at: the 6 `_shared/*` api-client files above (one wrap per file = ~6 edits, every call site covered), and for email/sms/push **read `notification_deliveries` instead of instrumenting** (zero new edits). This captures real-traffic success-rate per service with ~6 surgical touch points, no per-call-site changes.

---

## 6. Webhook-Health Signals (5 inbound receivers)

"Healthy" = (a) recent receipt within an expected window (last-received timestamp), and (b) low signature-failure rate. Persistence already exists for most:

| Receiver | Persists to | Last-received signal | Signature verify (file:line) | On-failure behavior |
|---|---|---|---|---|
| **stripe-webhook** | `payment_webhook_events` (`stripe-webhook/index.ts:177-188`) | `created_at` (`migrations/20260505000000_baseline_squash_orch_0729.sql:8627`) | SDK `constructEventAsync` (`_shared/stripeWebhookSignature.ts:29-50`) | 400 + **email alert** `notifyWebhookSignatureFailure` (`index.ts:98`) → `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS` |
| **paystack-webhook** | `payment_webhook_events` (`paystack-webhook/index.ts:144-160`, idempotency `paystack:<event>:<ref>`) | `created_at` (same table) | HMAC-SHA512 (`_shared/paystack.ts:315-340`) | 401 + console warn (no email) |
| **event-cover-video-webhook** | `event_cover_video_jobs` (update `:228-237`, fail `:215-224`) | `created_at` (`migrations/20260515000012_orch_0770_event_cover_video_processing.sql:45`) | SHA-1 `sha1(rawBody+ts+secret)` (`_shared/eventCoverVideo.ts:326-391`) | 403 + console (no email) |
| **twilio-inbound-sms** | only `channel_suppressions` on STOP (`twilio-inbound-sms/index.ts:74-81`) — **no inbound event log** | none (cannot query "last inbound") | `?secret=` query param vs `TWILIO_STATUS_CALLBACK_SECRET` (`:40-46`) | 403, no log/alert |
| **twilio-message-status** | `twilio_message_status_events` (`twilio-message-status/index.ts:36-41`) + reconciles `notification_deliveries`/`marketing_messages` | `received_at` (`migrations/20260515000013_orch_0777_ticket_checkout_core.sql:184-191`) | `?secret=` query param (`:12-16`) | 403, no log/alert |

**Existing health precedent:** `stripe-webhook-health-check` already does the "silent > 6h → email" check against `payment_webhook_events` (§2). The hub generalizes this: per-receiver last-received freshness from the tables above. **Gaps to note for SPEC:** (1) Paystack/cover-video/Twilio have no sig-failure email; (2) `twilio-inbound-sms` has no receipt log → no silence signal possible without a new column/table (likely acceptable — inbound STOP is low-volume; flag as a known limitation rather than build a new table). Signature-failure *rate* is not currently counted anywhere except Stripe's per-event email — a Layer-C counter on the verify branches could capture it, but that's a larger blast radius; recommend SPEC scope sig-failure monitoring to Stripe (existing) + add a structuredLog line on the verify-fail branch of the other 4 (read via log drains), not a new table.

---

## 7. Completeness Cross-Check (final gate)

Independent re-grep of every external HTTP host / SDK / credential across app-mobile, mingla-business, mingla-admin, mingla-marketing, supabase/functions, packages.

**One historical reference found, NOT a live dependency:** `api.anthropic.com` — `supabase/functions/run-place-intelligence-trial/index.ts:64` (`ANTHROPIC_MESSAGES_URL`). Deprecated per ORCH-0733/DEC-101 (Gemini is sole AI provider); preserved as commented historical reference for cheap git-revert. **Not active → exclude from the hub, but note in the inventory so it isn't re-discovered.**

**All other extracted hosts/SDKs map to the existing inventory** (Gemini, OpenAI, Stripe, Paystack, Mapbox, Google Places, Ticketmaster, Serper, Pexels, Giphy, OneSignal, Resend, Twilio, Cloudinary, ExchangeRate, Thum.io, Open-Meteo, OpenWeatherMap, RevenueCat, Supabase, Vercel, PostHog, Mixpanel, Sentry, AppsFlyer, GA4, Google/Apple Sign-In, Firebase, plus the excluded share-intent/CDN hosts). `esm.sh`/`deno.land`/`github.com`/`npmjs.org` are build/CDN, not runtime credentialed APIs. `ai.google.dev` and `c2pa.org` are doc/metadata links only.

**Verdict: inventory is complete for active monitored dependencies. No new credentialed external dependency beyond the inventory + the dormant Anthropic reference.**

---

## 8. Recommended Technical Approach for SPEC (investigation altitude)

### 8a. Table schema sketch — `api_health` family
Two tables (probe results + passive rollups) + a small alert-state table.

- **`api_health_checks`** (one row per service per probe tick): `id`, `service_key text` (canonical enum: `stripe|paystack|gemini|openai|mapbox|google_places|ticketmaster|serper|pexels|onesignal_consumer|onesignal_business|resend|twilio|cloudinary|supabase|…`), `layer text` (`status_page|synthetic|passive|webhook`), `status text` (`healthy|degraded|down|unknown`), `latency_ms int`, `detail jsonb` (status-page indicator, balance/credit value, error message, http status), `checked_at timestamptz default now()`, `mode text null` (test/live for stripe/paystack). Index on `(service_key, checked_at desc)`.
- **`api_health_observations`** (Layer-C passive rollup, written by `recordApiCall`): `service_key`, `window_start timestamptz`, `success_count int`, `failure_count int`, `p95_latency_ms int`, or simpler: append-only `(service_key, ok bool, latency_ms, at)` and aggregate at read. For email/sms/push, the hub READS `notification_deliveries` grouped by `provider` (no new rows).
- **`api_health_alert_state`** (alert state machine + cooldown): `service_key` (PK), `current_state text` (`ok|alerting`), `last_alert_at timestamptz`, `last_recovery_at timestamptz`, `consecutive_failures int`, `last_digest_at timestamptz`.
- RLS: admin-only read via `admin_*` SECURITY DEFINER RPC (mirror `admin_get_pricing_config` pattern in `mingla-admin/src/lib/pricing.js:39`); writes only by the service-role probe fn.

### 8b. Probe-function shape — `supabase/functions/api-health-probe`
Service-role-Bearer-guarded (§3 auth-guard). Per hourly tick: (1) `Promise.allSettled` fan-out of Layer-A status-page fetches (`/api/v2/status.json`); (2) `Promise.allSettled` Layer-B authed probes using existing resolvers (`createStripeClientForRole`, `resolvePaystackSecretKey`, etc.); (3) read `notification_deliveries` + `payment_webhook_events`/`twilio_message_status_events`/`event_cover_video_jobs` freshness for Layer-C/webhook; insert `api_health_checks` rows; (4) run the alert state machine (§8e). Mirror `keep-warm`'s fan-out/collect loop (`keep-warm/index.ts:26-40`). Use `createStripeClientForRole`/`resolvePaystackSecretKey` so TEST/LIVE mode is honored.

### 8c. Status-page-poll shape
For each `{ service_key, statusUrl }` in a static map: `fetch(statusUrl)` (no auth) → parse `.status.indicator` (`none`→healthy, `minor`→degraded, `major|critical`→down) + `.status.description` into `detail`. Confirmed feeds in §4. Timeout per fetch (e.g. 5s); `allSettled` so one slow vendor can't fail the tick.

### 8d. Passive-log shape — `recordApiCall(service_key, ok, latencyMs, httpStatus?)`
New `_shared/apiHealthLog.ts`: emits `structuredLog("info","api_call",{ service: service_key, ok, latencyMs, httpStatus })` (Sentry-visible) AND inserts an `api_health_observations` row (best-effort, swallow errors — never break the host call). Wire into the ~6 `_shared` api-client files (§5). For email/sms/push, DO NOT wire — read `notification_deliveries`.

### 8e. Alert state machine (cooldown + daily digest)
Per service: track `consecutive_failures` in `api_health_alert_state`. Transition `ok→alerting` only after **N consecutive failed ticks** (recommend N=2, i.e. ~2h, to suppress single-tick flaps). On entry to `alerting`: send `sendOpsAlertEmail({ recipients: API_HEALTH_ALERT_EMAILS, subject: "⚠️ [API HEALTH] <service> <status>", … })`, set `last_alert_at`. **Cooldown:** while `alerting`, re-alert at most once per cooldown window (e.g. 6h) to avoid spam. On recovery `alerting→ok`: send a "recovered" email, set `last_recovery_at`. **Low-balance alerts** (Twilio/Cloudinary/Paystack/Pexels): threshold-cross from healthy→below-threshold triggers a one-shot alert with cooldown. **Daily digest** (LOCKED scope = full rigor): once/day (e.g. a `'0 13 * * *'` second cron, or the 13:00 hourly tick) send a summary email — per-service uptime %, current state, balances, recent incidents — via `sendOpsAlertEmail`, gated by `last_digest_at`. Idempotency: key alerts by `service_key + state + hour` like `stripe-webhook-health-check`'s `idempotencyKey` (`:46`).

### 8f. Admin UI altitude (NOT designed here — SPEC/designer owns it)
New page registered in `mingla-admin/src/App.jsx` `PAGES` registry (e.g. `"api-health": ApiHealthPage`); reads via a new `admin_get_api_health` RPC (anon-key client + SECURITY DEFINER, mirror `pricing.js`); a service in `mingla-admin/src/services/`. Board = per-service cards (status dot, latency, balance, last-checked, last incident). No design proposed (out of scope for INVESTIGATE).

### 8g. New env vars / config for SPEC
`API_HEALTH_ALERT_EMAILS` (comma-list, default `seth@usemingla.com`); `[functions.api-health-probe] verify_jwt=false` in `config.toml`; cron migration (§3). Vendor probe keys already exist as secrets. Decommission candidates (separate cleanup, not this ORCH): `EXPO_PUBLIC_FOURSQUARE_API_KEY`, `EVENTBRITE_TOKEN`, `OPENWEATHER_API_KEY`.

### 8h. Open questions to resolve in SPEC
1. Serper has no confirmed public credit-balance API (dashboard-only) → low-balance alert is best-effort/manual. Confirm with vendor or accept reach-limit-via-search-failure only.
2. `twilio-inbound-sms` has no receipt log → no inbound-silence signal without a new column. Recommend accepting the gap (low-volume STOP traffic) rather than building a table.
3. Google Places probe costs a small amount per hourly tick — confirm acceptable, or drop to a free reachability ping.
4. Two OneSignal apps (consumer + business) — confirm both probed and surfaced separately.
5. Giphy is client-key/ToS-no-proxy → Layer-A status only; confirm acceptable.

---

## Evidence index (key files)
- Alert email: `supabase/functions/_shared/stripeOpsAlertEmail.ts:37-105`; senders `_shared/email/senders.ts:24-38`; recipient-list parse `stripe-webhook/index.ts:38-40`.
- Health precedent: `stripe-webhook-health-check/index.ts:9,14,16,21-48`; warmer `keep-warm/index.ts:11-40`.
- Scheduling: hourly exemplar `migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql:558-571`; vault `migrations/20260610000001_tr3_cron_use_vault_secrets.sql:25-38`; auth-guard `process-scheduled-installments/index.ts:77-80`; `config.toml:275-279`.
- Layer-C: dispatcher `_shared/notifyV2.ts:176,188,198,272,279,306-317,349-368`; adapters `adapters/{email,sms,push}Adapter.ts`; mode resolvers `_shared/stripe.ts:67-69`, `_shared/paystack.ts:27,46-57`.
- Webhooks: §6 table.
- Logging: `_shared/structuredLog.ts:22-65`; `_shared/sentryEdge.ts`.
- Admin app: `mingla-admin/src/App.jsx` PAGES registry; client `mingla-admin/src/lib/supabase.js:14-76`; RPC pattern `mingla-admin/src/lib/pricing.js:39`; audit `mingla-admin/src/lib/auditLog.js:15`.

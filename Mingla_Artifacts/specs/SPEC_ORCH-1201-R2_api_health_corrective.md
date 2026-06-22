# SPEC — ORCH-1201-R2 · API-Health Hub CORRECTIVE rework

**Phase:** SPEC (binding build contract). **Author:** mingla-forensics.
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1201-[api-health-corrective]/` · branch `ORCH-1201-api-health-corrective`.
**Source of truth:** `Mingla_Artifacts/ORCH-1201_API_MONITORING_REQUIREMENTS.md` (research + live-proven 2026-06-22).
**Blast radius:** backend (1 migration, `api-health-probe` edge fn, `_shared/apiHealthLog.ts`) + `mingla-admin` only. **ZERO consumer/business app blast.** No app-mobile, no mingla-business runtime, no buyer-web change.
**Mandate:** no assumptions, rigorous, grounded in reality. Every value below is from the requirements doc or the merged code read this session — none invented.

---

## 0. WHAT IS WRONG (the contract this corrects)

The merged ORCH-1201 (migration `20261120000000_orch_1201_api_health_hub.sql`, `api-health-probe/{index.ts,logic.ts}`, `_shared/apiHealthLog.ts`, `mingla-admin/src/pages/ApiHealthPage.jsx` + `services/apiHealthService.js` + `lib/apiHealthStatus.js`) has the right SKELETON (tables, hourly cron, statuspage poll, state machine, `sendOpsAlertEmail`, Layer-C `recordApiCall`) but treats all services uniformly. Confirmed defects, each corrected below:

| # | Defect (verified in merged code) | Correction owner |
|---|---|---|
| D1 | No per-service monitoring class. `index.ts` runs the same synthetic-probe + balance logic for every service. | §2 migration `monitoring_class` + `depletion_signal`; §3 probe branches by class |
| D2 | `evaluateBalance()` (index.ts L834) emits `balanceLow` for **paystack** (L848) → low settled-funds would alert. `probeStripe`/`probePaystack` read `balance.retrieve` / `/balance` as a health signal. **WRONG** — that is settled customer funds. | §3.2 Class-C processor health; §4 remove processor balance alert; I-PROPOSED-1201R2-PROCESSOR-NO-BALANCE-ALERT |
| D3 | Class-B depletion is undetectable. `api_health_observations` has NO error-code column; `recordApiCall` captures only `(ok, latencyMs, httpStatus)`. OpenAI `insufficient_quota` (429) is indistinguishable from `rate_limit_exceeded` (429) — both `ok=false, httpStatus=429`. | §2 `error_code`/`error_type` columns; §5 `apiHealthLog` extension; §3.3 Class-B reactive status; §6 matcher map |
| D4 | Thresholds invented: Twilio `20` (L845), Cloudinary `10`% remaining (L859), Pexels `100` (L865). Real now: Twilio $14.53 (would NOT fire at min 20… actually fires, but baseline must be $25 per doc), Cloudinary 747.88% used, Pexels 21855/25000, Ticketmaster 4994/5000. | §2 re-seed + §3.5/§7 baseline table |
| D5 | `STATUS_PAGE_URLS` (logic.ts L16) includes `paystack`, `resend`, `giphy` feeds that are NOT in the confirmed-feed list, and omits `revenuecat`, `mixpanel`, `appsflyer`, `google_places`(incidents.json). Must be corrected to ONLY confirmed feeds. | §3.1 corrected `STATUS_PAGE_URLS` |
| D6 | Admin UI shows a "Balance" metric uniformly and a worst-of-layers red dot that would turn processors/Class-B red on the wrong signal. | §8 admin per-class rendering |

**Non-goals (explicit):** do NOT decommission/remove any seeded service (incl. `giphy`, `thumio`, `ga4`, `mixpanel`, `revenuecat`, `appsflyer`); they stay seeded and excluded from alerting per their class. No new vendor onboarding. No live-fire remediation of Cloudinary/Serper/Twilio (that is operator action, tracked separately).

---

## 1. THE 6 MONITORING CLASSES (authoritative mapping)

Each seeded service gets exactly ONE class. The class decides which signal is AUTHORITATIVE for alerting.

| Class | Meaning | Authoritative alert signal | Alerts on |
|---|---|---|---|
| **A** | Metered WITH a programmatic balance/usage read | proactive poll of the real number | balance/usage threshold |
| **B** | Metered, NO balance API | Layer-C reactive — exact depletion error on real traffic | depletion error observed |
| **C** | Payment processor | reachability + auth + account-restriction + webhook delivery | unreachable / 401 / restricted / webhook silence. **NEVER balance.** |
| **D** | Client-side SDK (fires from app, not our server) | vendor status feed + event-arrival | status feed down / no events landed (where wired) |
| **E** | Platform | status feed + our own health/usage | status down / health degraded |
| **F** | Keyless / synthetic | synthetic probe + 429 watch | probe down / 429 |

---

## 2. MIGRATION (new file)

### 2.1 Filename / prefix
Max prefix on this rebased tree today = `20261120000000` (the merged ORCH-1201 hub). New corrective migration:

```
supabase/migrations/20261121000000_orch_1201_r2_api_health_classes.sql
```

**IMPLEMENT-TIME RE-CHECK (mandatory):** before writing, run
`ls supabase/migrations | sort | tail -5` on the rebased tree. If any migration `>= 20261121000000` exists, bump this file's prefix to `max + 1` (keep `000000` second-of-day slot, increment the date). Do NOT collide. Record the chosen prefix in the implementation report.

This migration **ALTERs** the tables created by `20261120000000`; it MUST run after it. The monotonic prefix guarantees ordering.

### 2.2 ALTER `api_health_services` — add class + signal

```sql
ALTER TABLE public.api_health_services
  ADD COLUMN IF NOT EXISTS monitoring_class text
    CHECK (monitoring_class IN ('A','B','C','D','E','F')),
  ADD COLUMN IF NOT EXISTS depletion_signal jsonb NOT NULL DEFAULT '{}'::jsonb;
```

`depletion_signal` shape (per-service, all keys optional — absent = not applicable):
```jsonc
{
  "status_feed": "https://…/api/v2/status.json" | null,   // confirmed feed or null
  "balance":    { "kind": "twilio_balance"|"cloudinary_used_pct"|"exchangerate_quota"|"sentry_stats"|"supabase_health"|"header_remaining",
                  "warn": <number>, "crit": <number>|null, "unit": "USD"|"pct_used"|"requests"|"…" },  // Class A only
  "reactive":   { "http": <int>|[<int>...], "match": "<substring or type token>", "field": "type"|"body"|"status_text" }, // Class B only
  "header":     { "name": "x-ratelimit-remaining"|"rate-limit-available", "warn": <int>, "cache_last_seen": true }, // Class B header services
  "processor":  { "restriction_fields": ["charges_enabled","payouts_enabled"] | ["status_bool"], "balance_display_only": true }, // Class C only
  "synthetic":  true|false   // F/B services with no feed that still get a liveness ping
}
```

> `balance` semantics: for `cloudinary_used_pct` the number is **percent USED** (alert when `>=` warn/crit). For `twilio_balance` it is **USD remaining** (alert when `<=` warn). `header_remaining` is **requests remaining** (alert when `<=` warn). Direction is encoded by `kind`, not guessed.

### 2.3 ALTER `api_health_observations` — capture the depletion fingerprint (fixes D3)

```sql
ALTER TABLE public.api_health_observations
  ADD COLUMN IF NOT EXISTS error_code text,   -- vendor machine code/type, e.g. 'insufficient_quota', 'RESOURCE_EXHAUSTED', 'daily_quota_exceeded'
  ADD COLUMN IF NOT EXISTS error_text text;   -- short raw snippet (≤300 chars) for human/forensic + substring matchers e.g. 'Not enough credits'
```
Index unchanged (existing `idx_api_health_obs_service_time` on `(service_key, observed_at DESC)` already covers the probe's read window).

### 2.4 ALTER `api_health_checks.detail` — no schema change
`detail` is already `jsonb`; Class-A cached header values + Class-C restriction flags ride inside it (`cached_remaining`, `charges_enabled`, `payouts_enabled`, `paystack_status_ok`). No DDL.

### 2.5 Re-seed all 25 services with class + signal + REAL thresholds (idempotent UPDATEs)

> The SERVICE-KEY-CANONICAL gate counts **exactly 25** seeded INSERT tuples — this migration does NOT touch the INSERT in `20261120000000` and adds NO new service rows, so the count stays 25. These are `UPDATE … WHERE service_key=…` statements (idempotent, re-runnable).

Seed table (the implementor writes one `UPDATE` per row; columns: class, status_feed, alert-signal, threshold):

| service_key | class | status_feed (confirmed only) | alert signal | threshold (REAL baseline) |
|---|---|---|---|---|
| `twilio` | A | `https://status.twilio.com/api/v2/status.json` | balance USD remaining | **warn ≤ $25**, crit ≤ $5 (live $14.53 ⇒ WARN fires now) |
| `cloudinary` | A | `https://status.cloudinary.com/api/v2/status.json` | `credits.used_percent` (% USED) | **warn ≥ 80%, crit ≥ 100%** (live 747.88% ⇒ CRIT now) |
| `exchangerate` | A | null | `requests_remaining` of 30k/mo | warn ≤ 3000, crit ≤ 500 (not probed live; thresholds = 10%/<2% of cap, flagged ASSUMPTION-BUDGET ① below) |
| `sentry` | A | `https://status.sentry.io/api/v2/status.json` | stats_v2 `rate_limited` vs `accepted` | warn rate_limited/accepted ≥ 0.05, crit ≥ 0.20 (needs admin token — ASSUMPTION-BUDGET ②) |
| `supabase` | A/E | `https://status.supabase.com/api/v2/status.json` | Mgmt `/health` per-service status | any non-`ACTIVE_HEALTHY` ⇒ degraded; feed major ⇒ down |
| `stripe` | C | `https://status.stripe.com/api/v2/status.json` | reachable+auth+`charges_enabled`/`payouts_enabled`+webhook | NO balance threshold; balance display-only |
| `paystack` | C | null (no confirmed feed) | reachable+auth+`status:true`+webhook | NO balance threshold; balance display-only |
| `openai` | B | `https://status.openai.com/api/v2/status.json` | reactive `429 type=insufficient_quota` | depletion = that exact type only |
| `gemini` | B | null | reactive `429 RESOURCE_EXHAUSTED` (esp. `limit:0`) | depletion = that status |
| `serper` | B | null | reactive `4xx` body contains `"Not enough credits"` | depletion = substring match (live: DOWN now) |
| `resend` | B | `https://resend-status.com/api/v2/status.json` (confirmed? see D5 note) | reactive `429 type=daily_quota_exceeded`/`monthly_quota_exceeded` | depletion = those types |
| `pexels` | B | null | header `x-ratelimit-remaining` (cache last) | warn ≤ 2500 (10% of 25k); live 21855 ⇒ ok |
| `ticketmaster` | B | null | header `rate-limit-available` (cache last) | warn ≤ 500 (10% of 5k); live 4994 ⇒ ok |
| `mapbox` | B | `https://status.mapbox.com/api/v2/status.json` | reactive `429` (no remaining header) | depletion = 429 on real traffic |
| `google_places` | B | `https://status.cloud.google.com/incidents.json` (Google form) | reactive `429`/`RESOURCE_EXHAUSTED` | depletion = those |
| `foursquare` | B | — **NOT a seeded service** (not in the 25; see note) | — | — |
| `onesignal_consumer` | D | `https://status.onesignal.com/api/v2/status.json` | feed + delivery passive | feed/delivery only |
| `onesignal_business` | D | `https://status.onesignal.com/api/v2/status.json` | feed + delivery passive | feed/delivery only |
| `revenuecat` | D | `https://status.revenuecat.com/api/v2/status.json` | feed only | feed only |
| `posthog` | D | null (301→posthogstatus.com, verify path) | feed-if-resolvable + verify event-arrival | no server probe |
| `mixpanel` | D | `https://www.mixpanelstatus.com/api/v2/status.json` (confirmed feed) | feed only | feed only |
| `appsflyer` | D | `https://status.appsflyer.com/api/v2/status.json` (confirmed feed) | feed + passive S2S | feed/passive |
| `ga4` | D | null (Workspace dashboard, no JSON) | none (status-only manual) | no alert |
| `vercel` | E | `https://www.vercel-status.com/api/v2/status.json` | feed + deploy READY/usage | feed only (deploy/usage = follow-on) |
| `thumio` | F | null | synthetic image-fetch + 429 | probe down / 429 |

**Foursquare note:** the requirements doc lists Foursquare under Class B, but the merged migration's 25 seeded services do **NOT** include a `foursquare` key (verified: seed has stripe, paystack, gemini, openai, mapbox, google_places, ticketmaster, serper, pexels, giphy, onesignal_consumer, onesignal_business, resend, twilio, cloudinary, supabase, vercel, exchangerate, thumio, revenuecat, posthog, mixpanel, sentry, appsflyer, ga4). **Adding `foursquare` would break SERVICE-KEY-CANONICAL's `=== 25` assertion.** DECISION: do NOT add foursquare in R2 (the requirements doc itself flags "Confirm if still used" — Foursquare free tier was cut 2026-06-01). Record in implementation report as deferred. `giphy` IS seeded (class **F**, synthetic — keep, exclude from alerting).

**ASSUMPTION-BUDGET (must be flagged in code comments, not silently invented):**
- ① ExchangeRate-API thresholds (3000/500) are derived as 10%/<2% of the documented 30k/mo cap — NOT a live probe. Comment `// ASSUMPTION-BUDGET ORCH-1201R2 ①: exchangerate thresholds = %-of-cap, not live-probed`.
- ② Sentry stats ratio thresholds need an admin token not yet provisioned. If `SENTRY_AUTH_TOKEN` is absent, Sentry Class-A balance poll MUST short-circuit to `unknown` (grey), never green, never alert.

### 2.6 Idempotent re-seed of `depletion_signal` example (one row, pattern for all)

```sql
UPDATE public.api_health_services
   SET monitoring_class = 'A',
       depletion_signal = jsonb_build_object(
         'status_feed','https://status.twilio.com/api/v2/status.json',
         'balance', jsonb_build_object('kind','twilio_balance','warn',25,'crit',5,'unit','USD'))
 WHERE service_key = 'twilio';

UPDATE public.api_health_services
   SET monitoring_class = 'B',
       depletion_signal = jsonb_build_object(
         'status_feed','https://status.openai.com/api/v2/status.json',
         'reactive', jsonb_build_object('http',429,'match','insufficient_quota','field','type'))
 WHERE service_key = 'openai';

UPDATE public.api_health_services
   SET monitoring_class = 'C',
       depletion_signal = jsonb_build_object(
         'status_feed','https://status.stripe.com/api/v2/status.json',
         'processor', jsonb_build_object(
           'restriction_fields', jsonb_build_array('charges_enabled','payouts_enabled'),
           'balance_display_only', true))
 WHERE service_key = 'stripe';
```
…and one analogous `UPDATE` for every remaining service per the §2.5 table. All `WHERE service_key=` ⇒ idempotent.

### 2.7 Self-verification block (extend the existing one)
Append to the migration:
```sql
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
             WHERE monitoring_class='B' AND depletion_signal->'reactive' IS NULL
               AND depletion_signal->'header' IS NULL) THEN
    RAISE EXCEPTION 'ORCH-1201R2 verify: every Class-B service needs a reactive matcher or header signal';
  END IF;
END $$;
```

### 2.8 `admin_get_api_health()` RPC — surface the new fields
Extend the `jsonb_build_object` in `admin_get_api_health()` (in `20261120000000`… but the RPC is `CREATE OR REPLACE`, so **re-declare the full function in the R2 migration** with two added keys):
```sql
'monitoring_class', s.monitoring_class,
'depletion_signal', s.depletion_signal,
```
Also add a 24h **reactive depletion** rollup so the admin can render Class-B "last error":
```sql
'depletion_24h', (
  SELECT jsonb_build_object(
    'depleted', bool_or(error_code IS NOT NULL AND error_code <> ''),
    'last_error_code', (array_agg(error_code ORDER BY observed_at DESC)
                          FILTER (WHERE error_code IS NOT NULL))[1],
    'last_error_text', (array_agg(error_text ORDER BY observed_at DESC)
                          FILTER (WHERE error_text IS NOT NULL))[1],
    'last_error_at',   max(observed_at) FILTER (WHERE error_code IS NOT NULL))
  FROM public.api_health_observations
  WHERE service_key = s.service_key AND observed_at > now() - interval '24 hours')
```
Keep the existing `passive_24h`, `uptime_24h_pct`, `layers` keys. `GRANT` unchanged.

**Acceptance (migration):** applies clean on top of `20261120000000`; re-running is a no-op; all 25 services have a class; processors have no `balance` key; every Class-B has `reactive` or `header`; the two new observation columns exist; `admin_get_api_health()` returns `monitoring_class`, `depletion_signal`, `depletion_24h` per service.

---

## 3. EDGE FN `api-health-probe` — branch by class

### 3.1 `logic.ts` — corrected `STATUS_PAGE_URLS` (fixes D5)
Replace the map. **Keep ONLY confirmed `/api/v2/status.json` feeds.** Confirmed set (requirements doc §"CONFIRMED feeds"): OpenAI, Stripe, Twilio, Cloudinary, Mapbox, Sentry, Supabase, Vercel, RevenueCat, Mixpanel, AppsFlyer; Google (Places) via `incidents.json`. Plus OneSignal (its statuspage IS Atlassian-format and confirmed in merged code's auth-tested probe — retain). Remove `paystack`, `resend`, `giphy` from the **Atlassian-indicator** map IF not confirmed; the doc does not list them as confirmed. (Note: `resend-status.com/api/v2/status.json` is widely Atlassian-format; the implementor MUST `curl` it at implement-time and keep it ONLY if it returns `{status:{indicator}}`. Same for paystack/giphy. **Default = drop unless the curl proves the schema** — grounded-in-reality rule.)

Final intended map (subject to the implement-time curl gate):
```ts
export const STATUS_PAGE_URLS: Record<string,string> = {
  openai: "https://status.openai.com/api/v2/status.json",
  stripe: "https://status.stripe.com/api/v2/status.json",
  twilio: "https://status.twilio.com/api/v2/status.json",
  cloudinary: "https://status.cloudinary.com/api/v2/status.json",
  mapbox: "https://status.mapbox.com/api/v2/status.json",
  sentry: "https://status.sentry.io/api/v2/status.json",
  supabase: "https://status.supabase.com/api/v2/status.json",
  vercel: "https://www.vercel-status.com/api/v2/status.json",
  revenuecat: "https://status.revenuecat.com/api/v2/status.json",
  mixpanel: "https://www.mixpanelstatus.com/api/v2/status.json",
  appsflyer: "https://status.appsflyer.com/api/v2/status.json",
  onesignal_consumer: "https://status.onesignal.com/api/v2/status.json",
  onesignal_business: "https://status.onesignal.com/api/v2/status.json",
  // google_places handled separately (incidents.json, not Atlassian status.json)
};
```
> **Authoritative source of truth at runtime is `api_health_services.depletion_signal.status_feed`**, loaded from the DB. `STATUS_PAGE_URLS` in `logic.ts` becomes a FALLBACK/typed mirror used only when the DB value is absent. The probe MUST prefer the DB `status_feed`. This keeps feeds editable without a redeploy and keeps the §2.5 table the single owner. (Implementor: load services WITH `monitoring_class, depletion_signal` at top of handler.)

Keep `indicatorToStatus`, `computeEffectiveStatus`, `decideAvailabilityTransitions` AS-IS. **Repurpose** `decideBalanceTransition` (it stays for Class A only).

### 3.2 `index.ts` — load class + branch
At handler start, load the registry WITH the new columns:
```ts
const { data: services } = await serviceClient
  .from("api_health_services")
  .select("service_key,display_name,monitoring_class,depletion_signal");
```
Build `classByKey`, `signalByKey`, `feedByKey`. Then:

- **Layer A (status feeds):** iterate services WHERE `depletion_signal.status_feed` is non-null, `Promise.allSettled(probeStatusPage)`. Unchanged probe, but driven by DB feed list, not the hardcoded map. (allSettled isolation preserved.)
- **Class A proactive pollers** (`twilio`, `cloudinary`, `exchangerate`, `sentry`, `supabase`): keep `probeTwilio`/`probeCloudinary`; ADD `probeExchangeRate` (`GET /v6/{key}/quota` → `requests_remaining`) and `probeSentryStats` (guarded by `SENTRY_AUTH_TOKEN`; absent ⇒ `unknown`). These write a `synthetic` check row carrying the real number in `detail`.
- **Class C processors** (`stripe`, `paystack`): see §3.2.1.
- **Class B**: NO synthetic balance probe. Status is set REACTIVELY from `api_health_observations` (§3.3) + the optional status feed + cached header. The probe may still do a cheap liveness GET for `mapbox`/`google_places`/`pexels`/`ticketmaster` to refresh the cached header / catch a hard outage, but its RESULT MUST NOT alert on a 200/empty — only feed `cached_remaining` into `detail` and let §3.3 own depletion.
- **Class D/F**: status feed (D where present) + existing passive deliveries/observations. No balance, no restriction.

#### 3.2.1 Class-C processor health (fixes D2) — replaces `probeStripe`/`probePaystack` semantics
**Stripe** (`probeStripe`):
1. Reachability + auth: `client.balance.retrieve()` returning 200 ⇒ reachable+auth-ok. A thrown auth error (401/permission) ⇒ `down`.
2. Account restriction: read the connected/platform account — `client.accounts.retrieve()` (platform) or the relevant account — and inspect `charges_enabled`, `payouts_enabled`, `requirements.disabled_reason`. If `charges_enabled===false` ⇒ `down` (cannot take money). If `payouts_enabled===false` but charges ok ⇒ `degraded`.
3. Balance: read it for **display only** → `detail.balance`, `detail.currency`, **`detail.balance_display_only:true`**. NEVER set `balanceLow`.
4. Webhook delivery: existing `webhookFreshness("stripe","payment_webhook_events","created_at",true)` retained (silence>6h ⇒ degraded, alertable). This is the processor's real alert path.

**Paystack** (`probePaystack`):
1. Reachability+auth: `GET /balance` 200 AND JSON `status===true` ⇒ ok; `status===false` or non-200 ⇒ map via `httpToStatus`.
2. Restriction: Paystack exposes no `charges_enabled`; treat `status:false` / 401 as the restriction signal (`detail.paystack_status_ok:false ⇒ down`).
3. Balance display-only (same as Stripe). NEVER `balanceLow`.
4. Webhook freshness retained.

`detail` for both gains `balance_display_only:true`. **`evaluateBalance()` MUST early-return `{balanceLow:null}` for `stripe` and `paystack`** (delete the `paystack` branch at index.ts L848; never add a stripe branch). This is enforced by I-PROPOSED-1201R2-PROCESSOR-NO-BALANCE-ALERT.

### 3.3 Class-B reactive status from observations (fixes D3) — NEW probe step
After the existing "Layer C: api_health_observations" tally, add a **depletion pass** that reads `error_code`/`error_text` and, for each Class-B service, emits a `passive`-layer check row whose status reflects the DEPLETION MATCHER (not the generic fail-rate):

```ts
// For each Class-B service, scan last-24h observations for the depletion fingerprint.
const { data: depObs } = await serviceClient
  .from("api_health_observations")
  .select("service_key,ok,http_status,error_code,error_text,observed_at")
  .gt("observed_at", new Date(nowMs - 24*60*60*1000).toISOString());
// group by service; for each Class-B service apply matchClassBDepletion(signal, rows)
```
`matchClassBDepletion(signal, rows) -> { depleted, lastErrorCode, lastErrorText }`:
- `reactive` matcher: a row matches when `http` matches (int or array membership) AND the `field` value contains `match` (case-insensitive substring). `field='type'` ⇒ check `error_code`; `field='body'`/`'status_text'` ⇒ check `error_text`.
- `header` matcher: depleted when the latest cached `cached_remaining` (from the synthetic liveness probe `detail`) `<= warn`.
- If ANY matching depletion row in the window ⇒ that service's `passive` check row = `down` (quota truly exhausted; e.g. Serper now). One observation of `insufficient_quota` is sufficient — depletion does not recover within the tick. A transient `rate_limit_exceeded` (429 but NOT matching `insufficient_quota`) does NOT mark `down` — it stays `healthy`/`degraded` per generic fail-rate only. **This is the load-bearing disambiguation.**

The Class-B service's effective status then flows through `computeEffectiveStatus` (worst-of-layers) and `decideAvailabilityTransitions` (existing N=2 / 6h-cooldown availability machine) → alert fires on the reactive depletion, NOT on a balance threshold.

> **Edge case (cold start / no traffic):** a Class-B service with `total < 5` observations in 24h ⇒ `unknown` (grey), NEVER green. Existing `< 5 ⇒ unknown` rule (index.ts L686/L717) is correct and retained.

### 3.4 Cached header last-seen (Pexels/Ticketmaster) (fixes D3 header-vanish)
When the optional Class-B liveness GET returns 200 with a remaining-count header (`x-ratelimit-remaining` for Pexels, `rate-limit-available` for Ticketmaster), write it into the `synthetic` check `detail.cached_remaining`. When the response is 429 the header vanishes — the probe MUST then read the LAST `cached_remaining` from the most recent prior `api_health_checks` row for that service and carry it forward (`detail.cached_remaining_stale:true`). Threshold compare uses the freshest available value. No new table — read prior `api_health_checks`.

### 3.5 `evaluateBalance()` — Class-A only (fixes D2 + D4)
Rewrite to be DRIVEN by `signal.balance.kind` + `warn`/`crit` from the DB `depletion_signal`, not hardcoded env defaults:
- `twilio_balance`: `balanceLow = balance <= warn` (warn 25). `balanceText="$14.53 (warn ≤ $25)"`.
- `cloudinary_used_pct`: read `credits.used_percent` (NOT `usage`/`limit` math — the doc's field is `used_percent`); `balanceLow = used_pct >= warn` (warn 80, crit 100). `balanceText="747.88% used (crit ≥ 100%)"`. **Severity:** ≥crit ⇒ the synthetic check row status = `down` (so the dot goes red), not just a balance email.
- `exchangerate_quota`: `requests_remaining <= warn`.
- `header_remaining` (pexels/ticketmaster): `cached_remaining <= warn`.
- `stripe`/`paystack`: **return `{balanceLow:null}`** unconditionally.
- env overrides may REMAIN as a final fallback only if the DB warn/crit is null; DB value wins.

`decideBalanceTransition` (logic.ts) stays unchanged — still the one-shot + 24h-cooldown balance machine, now fed ONLY by Class-A services.

**Acceptance (edge fn):** processors never produce `balanceLow≠null`; Class-A balance thresholds come from DB `depletion_signal`; Class-B status comes from the reactive matcher; one dead vendor still cannot throw the tick (allSettled + per-probe abort retained); cached header carried forward on 429.

---

## 4. ALERT LOGIC

| Class | Down/availability alert | Balance/depletion alert |
|---|---|---|
| A | existing availability machine on feed/poll failure | `decideBalanceTransition` on the real number (Twilio≤$25, Cloudinary≥80%, etc.) |
| B | availability machine on `passive=down` from the reactive matcher | **no balance machine** — depletion IS the availability `down` |
| C | availability machine on unreachable/401/restricted/webhook-silence | **NO balance alert ever** |
| D | availability machine on feed `major`/delivery passive only | none |
| E | availability on feed + health | usage = follow-on, info-only now |
| F | availability on synthetic/429 | none |

- Keep `sendOpsAlertEmail` as the SOLE alert channel (I-PROPOSED-1201-ALERT-EMAIL-SINGLE-OWNER unchanged).
- Keep N=2 consecutive-fail entry, 6h re-alert cooldown, recovery email, hour-bucket idempotency, 13:00-UTC digest (now reads `monitoring_class` to label "depleted"/"balance low"/"restricted" correctly in the digest line).
- Email copy: Class-B down email says `"<svc> quota EXHAUSTED — <error_code>: <error_text>"`; Class-C restriction email says `"<svc> account restricted — charges_enabled=false"`; Class-A balance email keeps `"balance low: <text>"`. Processor low-balance produces NO email.

---

## 5. LAYER-C `_shared/apiHealthLog.ts` — capture error fingerprint (fixes D3)

### 5.1 Backward-compatible signature extension
Current: `recordApiCall(serviceKey, ok, latencyMs, httpStatus?)`. All 11 existing call sites pass ≤4 positional args (verified). **Add a 5th OPTIONAL arg** so every existing caller compiles unchanged:
```ts
export async function recordApiCall(
  serviceKey: string,
  ok: boolean,
  latencyMs: number,
  httpStatus?: number,
  err?: { code?: string; text?: string },   // NEW — optional depletion fingerprint
): Promise<void>
```
Insert now includes `error_code: err?.code ?? null, error_text: err?.text ? err.text.slice(0,300) : null`. Still fire-and-forget, still swallows all errors, still never changes host return (I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS preserved).

### 5.2 Wire the fingerprint at the Class-B call sites that can produce depletion
Only services whose depletion is a parseable error need the 5th arg. Update these existing wraps to extract the vendor error on `!ok`:
- `agentGemini.ts` (L128) + `geminiMenuParser.ts` (L274): on `response.status===429`, read the error JSON `error.status` (`RESOURCE_EXHAUSTED`) → `err:{code:'RESOURCE_EXHAUSTED', text:<message>}`.
- `mapboxGeocode.ts` (L99): on 429 → `err:{code:'429', text:'rate_limited'}`.
- **OpenAI / Serper / Resend / Pexels / Ticketmaster:** these have NO current `recordApiCall` wrap. The implementor MUST add a `recordApiCall` call at their real call sites IF they exist in the codebase. **Implement-time grep required:**
  `grep -rn "api.openai.com\|google.serper.dev\|api.resend.com\|api.pexels.com\|app.ticketmaster.com" supabase/functions`.
  For each found call site, wrap with `recordApiCall(<key>, res.ok, dt, res.status, depletionErr)` where `depletionErr` parses the documented body (OpenAI: `body.error.type==='insufficient_quota'`; Serper: body contains `"Not enough credits"`; Resend: `body.name`/`type` `*_quota_exceeded`). **If a service has no server-side call site, document it** — its depletion can only be caught by the synthetic liveness probe + cached header, and that limitation MUST be noted in `depletion_signal` (e.g. add `"reactive_source":"probe_only"`). No fabrication: do not claim reactive coverage that has no call site.

### 5.3 Mapping table (service → exact depletion fingerprint) — the matcher contract
This is the single source for §3.3 `matchClassBDepletion` and the I-PROPOSED-1201R2-CLASS-B-REACTIVE-ERROR-MATCH gate. Stored in DB `depletion_signal.reactive` AND mirrored as a typed const `CLASS_B_DEPLETION` in `logic.ts` for the unit tests:

| service | http | field | match (case-insensitive) | NOT depletion (must be excluded) |
|---|---|---|---|---|
| openai | 429 | type (`error_code`) | `insufficient_quota` | `rate_limit_exceeded` |
| gemini | 429 | code (`error_code`) | `RESOURCE_EXHAUSTED` | generic 429 w/o that status |
| serper | 4xx | text (`error_text`) | `Not enough credits` | other 4xx |
| resend | 429 | type (`error_code`) | `daily_quota_exceeded` OR `monthly_quota_exceeded` | `rate_limit_exceeded` |
| pexels | 429 | header | `cached_remaining <= 2500` | transient 429 w/ remaining > 2500 |
| ticketmaster | 429 | header/text | `cached_remaining <= 500` OR text `Quota limit exceeded` | transient 429 |
| mapbox | 429 | http | `429` | — |
| google_places | 429 | code/http | `RESOURCE_EXHAUSTED` or 429 | — |

**Acceptance (Layer-C):** all 11 existing call sites still typecheck (5th arg optional); observations carry `error_code`/`error_text` for the wired services; `matchClassBDepletion` returns `depleted=true` for an `insufficient_quota` row and `depleted=false` for a `rate_limit_exceeded` row.

---

## 6. ADMIN UI (`mingla-admin`)

### 6.1 `lib/apiHealthStatus.js`
- Keep `worstOfLayers` / `statusDotClass` AS-IS (already returns grey for no-signal, red for `alerting`).
- ADD `signalLabel(svc)` returning the per-class signal descriptor: A ⇒ `"Balance"`/`"Usage"`; B ⇒ `"Reactive — last error"`; C ⇒ `"Processor health"`; D ⇒ `"Status feed"`; E ⇒ `"Platform"`; F ⇒ `"Synthetic"`. Pure, node-testable.

### 6.2 `pages/ApiHealthPage.jsx`
- Render a small **class badge** (A–F or its label) next to the category.
- Replace the generic `balanceLine` so it is class-aware:
  - **A:** show the real metric (`$14.53 / warn $25`, `747.88% used`, `21,855 req left`).
  - **B:** show `depletion_24h.last_error_code` if present (`"insufficient_quota 2h ago"`) else `"No depletion signal (24h)"`. Do NOT show a balance.
  - **C:** show balance as **info-only** with a neutral/grey label `"Balance (settled funds) · $0.00 — informational"`; **MUST NOT** be red and MUST NOT contribute to the dot. The dot for processors reflects reachability/restriction/webhook ONLY (already true via layers, since balance no longer sets a `down`).
  - **D/E/F:** show feed status / synthetic latency; no balance row.
- The red dot for Class C/B must come from `layers` (reachability/restriction/depletion), which §3 guarantees — UI needs no special-casing beyond NOT painting the processor balance red.

**Acceptance (admin):** Cloudinary card shows `747.88% used` and a RED dot (Class-A crit drives `synthetic=down`); Stripe/Paystack show balance as grey "informational" text and a GREEN dot when reachable+unrestricted even at $0; OpenAI shows "Reactive — last error" with the last `error_code` or "No depletion signal".

---

## 7. THRESHOLDS TABLE (exact, from real baselines — single source)

| service | metric | warn | crit | live value (2026-06-22) | fires now? |
|---|---|---|---|---|---|
| twilio | USD remaining | ≤ 25 | ≤ 5 | $14.53 | WARN ✅ |
| cloudinary | % credits used | ≥ 80 | ≥ 100 | 747.88% | CRIT ✅ |
| pexels | requests remaining (cached) | ≤ 2500 | — | 21,855 / 25,000 | no |
| ticketmaster | requests remaining (cached) | ≤ 500 | — | 4,994 / 5,000 | no |
| serper | reactive "Not enough credits" | match | — | DEPLETED | DOWN ✅ |
| exchangerate | requests remaining (of 30k) | ≤ 3000 | ≤ 500 | not probed | unknown (ASSUMPTION ①) |
| sentry | rate_limited/accepted | ≥ 0.05 | ≥ 0.20 | needs admin token | unknown (ASSUMPTION ②) |
| openai/gemini/mapbox/google_places/resend | reactive depletion match | match | — | healthy now | no |
| stripe/paystack | — | — | — | reachable, $0/₦25,616 | NO balance alert |

> Cloudinary CRIT, Twilio WARN, Serper DOWN are the three known live fires the corrected system MUST surface on first probe. These are the acceptance "fire list."

---

## 8. INVARIANTS (DRAFT — `I-PROPOSED-1201R2-*`)

Add as `node` strict-grep gates under `.github/scripts/strict-grep/`, registered in `.github/workflows/strict-grep-mingla-business.yml` (same pattern as the three existing 1201 gates). Each must self-test.

1. **I-PROPOSED-1201R2-PROCESSOR-NO-BALANCE-ALERT**
   `i-proposed-1201r2-processor-no-balance-alert.mjs`. Asserts:
   - the R2 migration sets `stripe`/`paystack` rows with NO `depletion_signal->'balance'` (regex over the UPDATEs) AND the verify-block exists;
   - `index.ts` `evaluateBalance` has NO branch returning a non-null `balanceLow` for `stripe` or `paystack` (grep: no `serviceKey === "paystack"`/`"stripe"` block setting `balanceLow:` to non-null);
   - `probeStripe`/`probePaystack` `detail` includes `balance_display_only`.
   Fails-on-revert: re-adding the L848 paystack balance branch trips it.

2. **I-PROPOSED-1201R2-CLASS-B-REACTIVE-ERROR-MATCH**
   `i-proposed-1201r2-class-b-reactive-error-match.mjs`. Asserts every Class-B seed row in the migration has a `reactive` matcher OR a `header` signal in `depletion_signal`, AND the `CLASS_B_DEPLETION` const in `logic.ts` contains an entry for each of openai/gemini/serper/resend/pexels/ticketmaster/mapbox/google_places, AND the openai entry's `match` is exactly `insufficient_quota` (NOT `rate_limit_exceeded`).

3. **I-PROPOSED-1201R2-THRESHOLDS-FROM-BASELINE**
   `i-proposed-1201r2-thresholds-from-baseline.mjs`. Asserts the migration seeds the exact baseline numbers (twilio warn 25, cloudinary warn 80 / crit 100, pexels warn 2500, ticketmaster warn 500) and that NO hardcoded contradicting default survives in `index.ts` `evaluateBalance` (e.g. no `def 20` for twilio, no `def 10` cloudinary-pct-remaining). Grounds thresholds in the documented reality.

4. (Retain the 3 existing 1201 gates unchanged — they still pass: 25 services, single email owner, no-write-side-effects.) Confirm SERVICE-KEY-CANONICAL still sees exactly 25 INSERT tuples (R2 adds only UPDATEs).

---

## 9. TEST PLAN

### 9.1 Implementor happy-path (must FAIL on revert)
Extend `supabase/functions/api-health-probe/logic.test.ts` + a new `class_routing.test.ts`, and `mingla-admin/src/lib/__tests__/apiHealthStatus.test.js`:
- T1 `matchClassBDepletion`: a row `{http_status:429, error_code:'insufficient_quota'}` ⇒ `depleted=true`; a row `{http_status:429, error_code:'rate_limit_exceeded'}` ⇒ `depleted=false`. (fails if matcher keys off bare 429.)
- T2 `evaluateBalance('stripe', …)` and `('paystack', …)` ⇒ `{balanceLow:null}` for ANY balance value incl. 0. (fails if a processor balance branch returns non-null.)
- T3 `evaluateBalance('cloudinary', detail.used_percent=747.88, warn 80, crit 100)` ⇒ `balanceLow=true` AND severity `down`. (fails if it reads `usage/limit` math or warn 10.)
- T4 `evaluateBalance('twilio', balance=14.53, warn 25)` ⇒ `balanceLow=true`. T4b `balance=30` ⇒ false.
- T5 cached-header carry-forward: 429 with no header + prior `cached_remaining=21855` ⇒ uses 21855, `cached_remaining_stale=true`.
- T6 `recordApiCall` 5-arg: existing 4-arg call still typechecks; 5-arg inserts `error_code`/`error_text` (mock client).
- T7 admin `signalLabel`: A⇒Balance, B⇒"Reactive — last error", C⇒"Processor health".

### 9.2 Tester adversarial (different angle — assume broken)
- A1 Processor low-balance does NOT alert: feed Stripe `balance.available=[{amount:0}]`, account `charges_enabled:true` ⇒ status `healthy`, ZERO `sendLowBalanceAlert`, ZERO email. Then `charges_enabled:false` ⇒ `down` + restriction email (proves the alert moved to the RIGHT signal).
- A2 OpenAI disambiguation: 6 observations of `rate_limit_exceeded` (429) ⇒ NO depletion `down`, NO email. Inject ONE `insufficient_quota` ⇒ Class-B `passive=down` ⇒ availability machine after N=2 ⇒ email with `"quota EXHAUSTED — insufficient_quota"`.
- A3 Cloudinary 748% ⇒ CRIT ⇒ red dot + balance email; verify the dot is RED (not amber) and the digest labels it.
- A4 Serper "Not enough credits" single observation ⇒ `down` immediately (no 5-sample floor for an explicit depletion body) — but a Class-B with `total<5` and NO depletion match stays `unknown` (grey), proving cold-start does not fabricate green.
- A5 allSettled isolation: force `probeCloudinary` to throw and a status feed to 500 ⇒ tick still returns 200, other services still get rows, alert machine still runs. (Re-run `allsettled.test.ts` + add a throwing Class-A poller case.)
- A6 Idempotency: run the R2 migration twice ⇒ no error, 25 services, all classes set, processors still balance-free.
- A7 Backward-compat: grep proves all 11 pre-existing `recordApiCall` call sites compile; none changed return shape; no host path gained a blocking await.

### 9.3 Live-fire (post-deploy, read-only, operator-gated)
Deploy `api-health-probe` from MERGED main (per memory: deploy edge fns from merged main, not stale worktrees), trigger one manual tick, assert via `admin_get_api_health()` that: Cloudinary=down(crit), Twilio balance warn surfaced, Serper=down(reactive), Stripe/Paystack=healthy with grey informational balance. No vendor mutation (probes read-only; I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS).

---

## 10. FILE MANIFEST (exact)

| Action | Path |
|---|---|
| NEW migration | `supabase/migrations/20261121000000_orch_1201_r2_api_health_classes.sql` (re-check prefix at implement) |
| EDIT | `supabase/functions/api-health-probe/index.ts` (load class; processor health; Class-A pollers + exchangerate/sentry; Class-B reactive pass; cached-header carry-forward; `evaluateBalance` class-aware; remove paystack balance branch) |
| EDIT | `supabase/functions/api-health-probe/logic.ts` (corrected `STATUS_PAGE_URLS`; add `CLASS_B_DEPLETION` const + `matchClassBDepletion`; keep `decideBalanceTransition` for Class A) |
| EDIT | `supabase/functions/_shared/apiHealthLog.ts` (5th optional `err` arg; insert `error_code`/`error_text`) |
| EDIT | `supabase/functions/_shared/{agentGemini,geminiMenuParser,mapboxGeocode}.ts` + any OpenAI/Serper/Resend/Pexels/Ticketmaster server call sites found at implement (add depletion fingerprint to `recordApiCall`) |
| EDIT | `mingla-admin/src/lib/apiHealthStatus.js` (+ `signalLabel`) |
| EDIT | `mingla-admin/src/pages/ApiHealthPage.jsx` (class badge; class-aware signal/balance rendering; processor balance info-only) |
| EDIT | `mingla-admin/src/services/apiHealthService.js` — NO change needed (RPC shape additive) |
| NEW gates | `.github/scripts/strict-grep/i-proposed-1201r2-{processor-no-balance-alert,class-b-reactive-error-match,thresholds-from-baseline}.mjs` + 3 jobs in `strict-grep-mingla-business.yml` |
| NEW/EDIT tests | `supabase/functions/api-health-probe/class_routing.test.ts` (new) + extend `logic.test.ts`, `adversarial_statemachine.test.ts`, `allsettled.test.ts`, `_shared/apiHealthLog.test.ts`, `mingla-admin/src/lib/__tests__/apiHealthStatus.test.js` |

---

## 11. SEQUENCING & GUARDRAILS
1. Migration first (additive columns + idempotent re-seed + RPC re-declare + verify block).
2. `apiHealthLog.ts` signature (unblocks call-site wiring).
3. `logic.ts` (`STATUS_PAGE_URLS`, `CLASS_B_DEPLETION`, `matchClassBDepletion`).
4. `index.ts` class routing.
5. Call-site fingerprints (only where a real call site exists — no fabrication).
6. Admin UI.
7. Gates + tests; prove fails-on-revert.

**Hard rules carried from memory:** work on the branch (never main); deploy edge fns from merged main not the worktree; the 3 live fires (Cloudinary/Serper/Twilio) are operator remediation, NOT in scope here. Backend + admin only — zero app blast.

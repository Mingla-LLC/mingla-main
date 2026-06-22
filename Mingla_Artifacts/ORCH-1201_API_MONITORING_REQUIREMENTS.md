# ORCH-1201 — "What Must Exist": API Monitoring Requirements (research + live-proven)

Built 2026-06-22 from (a) deep vendor-documentation research across all services and (b) **live read-only
probes of the actual production accounts**. This corrects the original design, which was built from
code-inspection alone and invented thresholds for services I'd never observed.

---

## THE CORE CORRECTION: services fall into 6 monitoring CLASSES, not one

The original design wrongly assumed "synthetic-probe every API hourly + read its balance." Reality:
**most services have NO balance to read.** Each service belongs to exactly one class, and each class needs
a different signal. This is the load-bearing requirement.

### Class A — Metered WITH a programmatic balance/usage read → PROACTIVE poll (alert on real number)
Only these expose a real remaining-quota/balance number an API key can read:
| Service | Endpoint | Field to read | Real value now |
|---|---|---|---|
| Twilio | `GET /2010-04-01/Accounts/{SID}/Balance.json` | `balance` (USD) | **$14.53 — LOW** |
| Cloudinary | `GET /v1_1/{cloud}/usage` | `credits.used_percent` | **747.88% — CRITICAL** |
| ExchangeRate-API | `GET /v6/{key}/quota` | `requests_remaining` (of 30k/mo) | not probed (key only) |
| Sentry | `GET /api/0/organizations/{org}/stats_v2/?field=sum(quantity)&groupBy=outcome` | `rate_limited` vs `accepted` per project | needs admin token |
| Supabase | `GET /v1/projects/{ref}/health` (Mgmt API) | per-service status | platform-critical |

### Class B — Metered with NO balance API → REACTIVE (detect the exact depletion error on real traffic)
These CANNOT be proactively read. The ONLY truthful signal is the documented error code on real calls.
**This makes Layer-C passive instrumentation MANDATORY, not optional, for these services.**
| Service | Depletion signal (exact) | Rate headers to cache |
|---|---|---|
| OpenAI | `429` `type=insufficient_quota` (vs `rate_limit_exceeded` = transient — must disambiguate) | `x-ratelimit-remaining-requests/-tokens` |
| Gemini | `429` `RESOURCE_EXHAUSTED` (+ `limit:0` = billing demoted) | none (no headers) |
| Serper | `4xx` body `"Not enough credits"` (CONFIRMED) | none reliable |
| Resend | `429` `type=daily_quota_exceeded` / `monthly_quota_exceeded` | `ratelimit-remaining`, `x-resend-daily-quota` |
| Pexels | `429` (headers vanish on 429 — cache last) | `x-ratelimit-remaining` (21,855/25,000 now) |
| Ticketmaster | `429` "Quota limit exceeded" | `rate-limit-available` (4,994/5,000 now) |
| Mapbox | `429` | `x-rate-limit-limit/-reset` (no "remaining") |
| Google Places | `429`/`RESOURCE_EXHAUSTED` (or Cloud Monitoring quota API w/ OAuth) | none |
| Foursquare | `429` | undocumented |

### Class C — Payment processors → reachability + auth + account-restriction + webhook. NEVER a balance threshold.
Stripe & Paystack "balance" = **settled customer funds**, not API credit. A low value is normal. Monitor:
reachable (`GET /v1/balance` / `GET /balance` → 200), key valid (not 401), account not restricted
(Stripe `charges_enabled`/`payouts_enabled`/`requirements`; Paystack parse `status` boolean), webhook
delivery health (Stripe auto-disables after ~3 days of failures; Paystack retries 72h). **Display balance as
info only.** Live now: Stripe test 200 ($0 available — normal); Paystack test 200 (₦25,616 settlement).

### Class D — Client-side SDKs → vendor status page + event-arrival. A server ping proves nothing.
PostHog, Mixpanel, AppsFlyer, RevenueCat, GA4 fire from the app, not our server. Monitor: (1) status-page
poll, (2) event-arrival confirmation (query that events landed recently). **Silent-data-loss alert:** PostHog
over its 1M/mo free cap = events lost forever (alerts at 80/100%); Sentry over quota = errors dropped.

### Class E — Platform → status page + our own health/usage. Supabase (Mgmt `/health` + usage; project pauses on Free inactivity); Vercel (deploy READY state + usage API; **Hobby pauses on breach + is non-commercial → confirm prod is on Pro**).

### Class F — Keyless/synthetic → probe + 429 watch. Open-Meteo (`<10k/day`, **free tier is non-commercial — licensing flag**), Thum.io (1k/mo free, synthetic image-fetch).

---

## CONFIRMED machine-readable status feeds (`/api/v2/status.json`)
OpenAI, Stripe, Twilio, Cloudinary, Mapbox, Sentry, Supabase, Vercel, RevenueCat, Mixpanel, AppsFlyer; Google
Cloud via `status.cloud.google.com/incidents.json` (Places). **NO feed (must synthetic-probe or alt):**
Gemini/AI-Studio, Ticketmaster, Pexels, Serper, Foursquare, GA4 (Google Workspace dashboard), ExchangeRate-API,
Thum.io, Open-Meteo, PostHog (301→posthogstatus.com, verify path live).

---

## LIVE CURRENT STATE — proven by probes 2026-06-22 (this is the real fire list)
| Service | State | Evidence |
|---|---|---|
| **Cloudinary** | 🔴 CRITICAL | 186.97 / 25.0 credits = **747.88%** of Free plan → uploads + new transforms blocked/at-risk; cover-video broken; account disable-eligible |
| **Serper** | 🔴 DOWN | `"Not enough credits"` → place-intelligence review fetch broken |
| **Twilio** | 🟠 LOW | **$14.53** (auto-recharge trigger ~$10; SMS/OTP fail at $0) |
| Stripe (test) | 🟢 | 200, $0 available (normal for test/no-recent-sales) |
| Paystack (test) | 🟢 | 200, ₦25,616 settlement |
| Gemini | 🟢 | models list + real `generateContent` returned "ok" (NOT 403'd by the unrestricted-key block) |
| OpenAI | 🟢 | `/v1/models` 200, not depleted |
| Mapbox | 🟢 | geocode 200 |
| Pexels | 🟢 | 21,855 / 25,000 remaining this month |
| Ticketmaster | 🟢 | 4,994 / 5,000 remaining today |
| Resend | 🟢 | usemingla.com verified |
| OneSignal | ⚪ unverified | `/apps/{id}` needs an Org-level key (not the REST key); re-probe with org key |

---

## CONFIG-EXPIRY / LICENSING TRAPS (calendar alerts, not uptime)
- **Gemini:** unrestricted-key block began 2026-06-19; Standard→auth-key migration deadline ~Sept 2026 — silently 403s keys independent of outages. (Our key currently works.)
- **Foursquare:** free tier cut to 500 Pro calls/mo on 2026-06-01 (already in effect). Confirm if still used.
- **Vercel:** Hobby is non-commercial + pauses on breach — confirm prod is on Pro.
- **Open-Meteo:** free tier prohibits commercial use — may need paid Customer API.

---

## REQUIREMENTS — what the system MUST have (corrected vs the merged skeleton)
1. **Per-service `monitoring_class`** (A–F) on `api_health_services`, driving WHICH signal is authoritative — not a uniform synthetic probe.
2. **Proactive pollers** for Class A only (Twilio balance, Cloudinary used_percent, ExchangeRate-API /quota, Sentry stats_v2, Supabase health) — with thresholds set from REAL baselines (Twilio WARN ≤$25 so it fires now; Cloudinary WARN ≥80% / CRIT ≥100%; Pexels/TM via cached header remaining).
3. **Reactive error-detection (Layer C, MANDATORY)** for Class B — keyed on the EXACT per-service error code/type (OpenAI `insufficient_quota` ≠ `rate_limit_exceeded`; Serper "Not enough credits"; Resend `*_quota_exceeded`), plus cache last-seen rate headers (Pexels/Ticketmaster lose them on 429).
4. **Processor health** for Stripe/Paystack: reachability+auth+`charges_enabled`/restriction+webhook delivery. **Remove any balance threshold** (the original error).
5. **Status-page pollers** for the confirmed feeds; synthetic probes where none exists.
6. **Client-SDK** (Class D): status poll + event-arrival; no server probe.
7. **Config-expiry calendar alerts** (the traps above).
8. Alert thresholds **derived from real probed values**, never invented.

The merged system (ORCH-1201) has the right SKELETON (tables, hourly cron, status-page poll, `sendOpsAlertEmail`,
Layer-C `recordApiCall`) but needs a corrective pass to: encode `monitoring_class`, remove processor balance
alerts, wire the exact reactive error-codes, and re-baseline thresholds to reality. Plus the 3 live fires
(Cloudinary, Serper, Twilio) need operational action regardless of the tool.

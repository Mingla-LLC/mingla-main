# IMPLEMENT — ORCH-1201-R2 · API-Health Hub CORRECTIVE rework

**Phase:** IMPLEMENT (executes `SPEC_ORCH-1201-R2_api_health_corrective.md` exactly).
**Worktree / branch:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1201-[api-health-corrective]/` · `ORCH-1201-api-health-corrective`.
**Scope:** backend (1 migration, `api-health-probe` edge fn, `_shared` Layer-C wraps, 1 server call site) + `mingla-admin` only. ZERO consumer/business app blast.
**Status:** COMPLETE. All gates + suites green. Fails-on-revert proven. NOT merged, NOT deployed (per mandate).

---

## Migration prefix chosen
`supabase/migrations/20261121000000_orch_1201_r2_api_health_classes.sql`.
Re-verified on the rebased tree (`git fetch origin && git rebase origin/main` → already up to date; branch sits one commit ahead of `origin/main` = the COMMS-ack). Max migration prefix on the tree = `20261120000000` (the merged ORCH-1201 hub). `20261121000000` is strictly greater and unused. Idempotent (ADD COLUMN IF NOT EXISTS + `UPDATE … WHERE service_key=` + CREATE OR REPLACE). Monotonic prefix guarantees it runs AFTER the hub it ALTERs.

---

## What changed, per file

### 1. `supabase/migrations/20261121000000_orch_1201_r2_api_health_classes.sql` (NEW)
- `ALTER api_health_services ADD monitoring_class text CHECK (A–F)` + `depletion_signal jsonb NOT NULL DEFAULT '{}'`.
- `ALTER api_health_observations ADD error_code text, error_text text` (additive, nullable → existing 4-arg recordApiCall inserts unaffected; fixes D3).
- 25 idempotent `UPDATE … WHERE service_key=` statements re-classing every seeded service with class + `depletion_signal` + REAL thresholds. NO new rows (SERVICE-KEY-CANONICAL stays 25). Class map matches SPEC §2.5; `supabase` set to E, `giphy`/`thumio` to F, `foursquare` NOT added (deferred — would break the 25 gate; documented below).
- Processors (`stripe`/`paystack`) carry a `processor` block + `balance_display_only:true`, NO `balance` key.
- ASSUMPTION-BUDGET comments: ① exchangerate %-of-cap, ② Sentry token-gated grey.
- Self-verification `DO $$` block: every service has a class; processors have no balance signal; every Class-B has reactive|header; count===25; `error_code` column exists.
- `CREATE OR REPLACE FUNCTION admin_get_api_health()` re-declared with `monitoring_class`, `depletion_signal`, and a `depletion_24h` rollup (`depleted`/`last_error_code`/`last_error_text`/`last_error_at`). Existing `passive_24h`/`uptime_24h_pct`/`layers` keys retained. GRANT unchanged.
- **STATUS_PAGE_URLS feed corrections grounded by live curl 2026-06-22:** `resend-status.com/api/v2/status.json` → 200 valid Atlassian (KEPT). `status.paystack.com/api/v2/status.json` → 404 (DROPPED, Class C no feed). `status.posthog.com` → 301→posthogstatus.com HTML (DROPPED). `status.giphy.com` valid but Class F → kept synthetic, no feed.

### 2. `supabase/functions/_shared/apiHealthLog.ts`
- Added OPTIONAL 5th arg `err?: { code?; text? }` (new `ApiCallError` interface). Inserts `error_code`/`error_text` (text truncated to 300 chars). Still fire-and-forget, still swallows all errors. **All 11 existing 4-arg call sites compile unchanged** (verified: type-check + the apiHealthLog 4-arg test still passes).

### 3. `supabase/functions/api-health-probe/logic.ts`
- Corrected `STATUS_PAGE_URLS` to confirmed feeds only (14 keys: openai, stripe, twilio, cloudinary, mapbox, sentry, supabase, vercel, revenuecat, mixpanel, appsflyer, resend, onesignal_consumer, onesignal_business). DB `depletion_signal.status_feed` is the runtime owner; this map is the typed fallback.
- Added `CLASS_B_DEPLETION` typed const (the matcher contract, SPEC §5.3) — entries for openai/gemini/serper/resend/mapbox/google_places (reactive) + pexels/ticketmaster (header). openai match = exactly `insufficient_quota`.
- Added pure `matchClassBDepletion(signal, rows, cachedRemaining?)` — newest-first scan, http-set membership + case-insensitive substring on the field's column; header signal compares cached remaining ≤ warn.
- Added pure `evaluateBalanceForSignal(serviceKey, detail, balance)` — processors → null unconditionally; twilio_balance / cloudinary_used_pct / exchangerate_quota / sentry_stats with warn/crit + `severity` ('crit' breaches crit). `decideBalanceTransition`/`computeEffectiveStatus`/`decideAvailabilityTransitions` UNCHANGED.

### 4. `supabase/functions/api-health-probe/index.ts`
- Handler loads the registry WITH `monitoring_class,depletion_signal` once; builds `classByKey`/`signalByKey`/`feedByKey`. Layer-A is now DB-feed-driven (fallback to the typed map if registry empty). allSettled isolation preserved.
- `probeStripe` rewritten to Class-C health: `balance.retrieve` (reachability+auth) + `accounts.retrieve` (charges_enabled/payouts_enabled/disabled_reason, best-effort → unknown if key lacks scope, never fabricated). `charges_enabled===false`⇒down, `payouts_enabled===false`⇒degraded. `detail.balance_display_only:true`. NEVER balanceLow.
- `probePaystack`: `status:true`⇒healthy else httpToStatus; `detail.paystack_status_ok` + `balance_display_only:true`.
- `probeCloudinary` reads `credits.used_percent` (not usage/limit math); `>=100%`⇒synthetic `down` (red dot).
- `probeTicketmaster`/`probePexels` cache the remaining-count header into `detail.cached_remaining`.
- Added `probeExchangeRate` (`/v6/{key}/quota`→requests_remaining) and `probeSentryStats` (SENTRY_AUTH_TOKEN-gated; absent⇒unknown/grey, never green). Both added to the Layer-B fan-out.
- §3.4 cached-header carry-forward: header Class-B services with no fresh `cached_remaining` read the last prior `api_health_checks` synthetic row and mark `cached_remaining_stale:true`.
- Layer-C observations pass now selects `http_status,error_code,error_text,observed_at`; for Class-B services with a reactive/header signal it runs `matchClassBDepletion` → an explicit depletion ⇒ a `passive=down` row immediately (no 5-sample floor), overriding the generic fail-rate. Transient rate-limits stay on generic fail-rate. A `<5`-observation cold start stays `unknown`.
- `evaluateBalance` is now a thin class-aware wrapper over `evaluateBalanceForSignal` (env fallback only when DB warn is null; processors short-circuit to null).
- Alert email copy is class-aware: Class-B down ⇒ "quota EXHAUSTED — `<code>`: `<text>`"; Class-C ⇒ "account restricted — charges_enabled=false"; Class-A keeps balance copy. Digest line labels depleted/balance-low/balance. `sendOpsAlertEmail` stays the sole channel.

### 5. Layer-C depletion fingerprint wiring (real call sites only — no fabrication)
- `_shared/agentGemini.ts` + `_shared/geminiMenuParser.ts`: 429 ⇒ parse `error.status` (RESOURCE_EXHAUSTED) and pass as the 5th arg; split into ok-path + error-path recordApiCall.
- `_shared/mapboxGeocode.ts`: 429 ⇒ `{code:"429", text:"429 rate_limited"}`.
- `run-place-intelligence-trial/index.ts` (Serper, the live DOWN fire): added `recordApiCall` import + ok/error/network wraps; `!ok` body `/not enough credits/i` ⇒ `{code:"not_enough_credits", text}`.
- **OpenAI / Resend / Pexels / Ticketmaster:** no dedicated server-side depletion wrap added. Their `depletion_signal` carries `reactive_source:"probe_only"` (OpenAI/Resend/google_places) — honest: matcher + DB signal are ready, but coverage is via the synthetic liveness probe + cached header until traffic flows. No claimed coverage without a call site.

### 6. Admin UI
- `mingla-admin/src/lib/apiHealthStatus.js`: added pure `signalLabel(svc)` (A⇒"Balance / usage", B⇒"Reactive — last error", C⇒"Processor health", D/E/F/unknown). `worstOfLayers`/`statusDotClass` unchanged.
- `mingla-admin/src/pages/ApiHealthPage.jsx`: class badge next to the category; `balanceLine`→class-aware `signalLine` returning `{text,tone}` (metric/depletion(red)/info(grey)); processor balance rendered grey "Balance (settled funds) … — informational", never red, never on the dot; Class-B shows `depletion_24h.last_error_code` or "No depletion signal (24h)".

### 7. Gates + tests
- 3 NEW gates under `.github/scripts/strict-grep/` (`i-proposed-1201r2-{processor-no-balance-alert,class-b-reactive-error-match,thresholds-from-baseline}.mjs`) + 3 jobs appended to `strict-grep-mingla-business.yml`.
- NEW `class_routing.test.ts` (the load-bearing regression). Extended `logic.test.ts` (matcher T1/T1b/T1c, header T5, balance T2/T3/T4), `apiHealthLog.test.ts` (5-arg T6), admin `apiHealthStatus.test.js` (signalLabel T7).

---

## Gate / test results (actual output)

**Strict-grep gates — all 6 PASS:**
```
I-PROPOSED-1201-SERVICE-KEY-CANONICAL gate passed (25 services, 21 probe keys ⊆ seeded).
I-PROPOSED-1201-ALERT-EMAIL-SINGLE-OWNER gate passed.
I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS gate passed.
I-PROPOSED-1201R2-PROCESSOR-NO-BALANCE-ALERT gate passed.
I-PROPOSED-1201R2-CLASS-B-REACTIVE-ERROR-MATCH gate passed.
I-PROPOSED-1201R2-THRESHOLDS-FROM-BASELINE gate passed.
```
The 3 existing 1201 gates still pass; SERVICE-KEY-CANONICAL still sees exactly 25 INSERT tuples (R2 adds only UPDATEs).

**Deno suites — 49 passed | 0 failed** (`logic.test.ts` + `class_routing.test.ts` + `allsettled.test.ts` + `adversarial_statemachine.test.ts` + `_shared/apiHealthLog.test.ts`).

**Admin node tests — 11 passed | 0 failed** (`mingla-admin/src/lib/__tests__/apiHealthStatus.test.js`).

**Type-check — clean** (`deno check` on index.ts, logic.ts, apiHealthLog.ts, agentGemini.ts, geminiMenuParser.ts, mapboxGeocode.ts, run-place-intelligence-trial/index.ts).

**Backward-compat — confirmed:** all `recordApiCall` wrap files type-check; the legacy 4-arg shape still passes its test (5th arg optional).

---

## Fails-on-revert proof
At pre-commit HEAD `95c6e3c897f44a3c9d3db2713f354d7ef9e47790`, reverting the `matchClassBDepletion` token check (`if (hay.toLowerCase().includes(needle))` → `if (true)`, simulating the D3 "bare-429 is opaque" defect) makes the regression FAIL:
```
REGRESSION: OpenAI disambiguation — insufficient_quota depletes, rate_limit does not => class_routing.test.ts:35:6
FAILED | 3 passed | 1 failed
```
Restored immediately; full suite green again (28 passed across logic + class_routing). The processor-no-balance gate likewise trips if a `'balance', …` block is re-added to a processor UPDATE (verified during gate development — the gate caught a too-greedy block and was anchored to the per-service UPDATE).

---

## Deviations / decisions
- **Foursquare NOT added** (deferred): not in the merged 25; adding it breaks SERVICE-KEY-CANONICAL `===25`, and the requirements doc flags it for removal (free tier cut 2026-06-01). Recorded per SPEC §2.5.
- **giphy** kept Class F (synthetic) and excluded from STATUS_PAGE_URLS even though its Atlassian feed returns 200 — the class contract (F = synthetic) is the owner, and the §2.5 seed gives it no `status_feed`.
- **OpenAI/Resend/Pexels/Ticketmaster reactive wiring:** marked `reactive_source:"probe_only"` rather than fabricating a call-site wrap. The matcher + DB signal exist; depletion is caught reactively once a real server call site logs `error_code`. (Serper/Gemini/Mapbox DO have wired call sites.)
- **Sentry/exchangerate** are not live-probed in this environment (token/key gating); their pollers short-circuit to `unknown` (grey) when env is absent — never green, never alert.

## Live fire list (acceptance — surfaced by the corrected logic on first probe)
Cloudinary 747.88% ⇒ CRIT (synthetic down + red dot), Twilio $14.53 ⇒ WARN (≤$25), Serper "Not enough credits" ⇒ DOWN (reactive). Proven by the regression unit tests; full surfacing requires a live probe tick (operator-gated, §9.3).

## Deploy notes (NOT done here — per mandate)
1. Apply the migration to prod (idempotent; ALTERs the hub tables). Apply via Management API if CLI drift-wedged (per memory).
2. Deploy `api-health-probe` **from MERGED main, not this worktree** (clobber risk per memory) after merge.
3. Trigger one manual tick; assert via `admin_get_api_health()`: Cloudinary down(crit), Twilio balance warn, Serper down(reactive), Stripe/Paystack healthy + grey informational balance.
4. The 3 live fires (Cloudinary/Serper/Twilio) need operator remediation — out of scope here.

# TEST — ORCH-1201-R2 · API-Health Hub CORRECTIVE rework

**Phase:** TEST (mingla-tester, BRUTAL gatekeeper). **Assume broken until proven.**
**Worktree / branch:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1201-[api-health-corrective]/` · `ORCH-1201-api-health-corrective`.
**Implementation under test:** commit `ae3703079`. **Adversarial test commit:** `946776661`.
**Verdict:** **CONDITIONAL PASS** — all source/unit/integration behavior VERIFIED green + fails-on-revert proven; one P2 dead-feed finding (non-harmful); the live runtime (real cron tick → real vendors → admin board) is DEPLOY-GATED and unverifiable until the migration applies + the edge fn deploys.

---

## 1. WHAT I VERIFIED (source / unit / integration — provable now)

| Angle (dispatch) | Result | Evidence |
|---|---|---|
| **1. Processor NO-balance-alert** | **VERIFIED** | `evaluateBalanceForSignal` short-circuits `stripe`/`paystack` to `{balanceLow:null, severity:null, balanceText:null}` BEFORE the kind switch (logic.ts L311). My `ADV-R2 P1` forces both processors × 5 balances (incl. 0, −1, huge) × 3 crit-grade signals (twilio/cloudinary/exchangerate) ⇒ all null. `P2`: null/undefined signal ⇒ still null. The `evaluateBalance` index.ts wrapper (L1112) AND `probeStripe`/`probePaystack` set `balance_display_only:true`, status driven by `charges_enabled`/`paystack_status_ok`/webhook — never balance. Migration verify-block rejects any processor `balance` key (0 found). Gate `PROCESSOR-NO-BALANCE-ALERT` passes + trips on revert. |
| **2. The 3 live fires map to the right status** | **VERIFIED (unit) / DEPLOY-GATED (live)** | Cloudinary 747.88% ⇒ `evaluateBalanceForSignal` returns `balanceLow:true, severity:'crit'` AND `probeCloudinary` sets synthetic `status:'down'` at ≥100% (red dot) — `ADV-R2 A2` + class_routing `T3`. Twilio $14.53 ⇒ `balanceLow:true, severity:'warn'` (≤$25, above crit 5) — `ADV-R2 A1` + `T4`. Serper "Not enough credits" ⇒ `matchClassBDepletion` depleted=true on http 402/403/429 + body substring — `ADV-R2 B3` + class_routing. Surfacing in the table/board needs a live tick (gated). |
| **3. Class-B reactive AND-gate (http ∧ exact token)** | **VERIFIED** | Matcher requires `httpSet.has(http_status)` AND `field.includes(needle)` (logic.ts L112–116). `ADV-R2 B1` (right token wrong http ⇒ false), `B2` (right http wrong token: rate_limit_exceeded/server_error/""/null ⇒ false), `B3` (Serper 500 not in set ⇒ false even with body; 403 bad-key body ⇒ false), `B4` (resend quota_exceeded depletes, rate_limit_exceeded does NOT), `B5` (gemini generic 429 ⇒ false; RESOURCE_EXHAUSTED ⇒ true). |
| **4. No fabricated data** | **VERIFIED** | `ADV-R2 N1` null/undefined/`{}` signal ⇒ false; `N2` probe_only Class-B (openai/resend/google_places carry `reactive_source:probe_only`) with ZERO obs ⇒ false (handler then leaves `unknown` via the `<5`-sample floor, index.ts L968); `N3` null http_status row skipped; `A3` missing/non-numeric balance field ⇒ null (not fake low); `A5` Sentry absent ratio ⇒ null (grey, token-gated `probeSentryStats`); `H3` missing/NaN cached remaining ⇒ false. Status-feed 404 (incl. the dropped feeds) ⇒ `unknown`, never down (`probeStatusPage` L130–135). |
| **5. Backward-compat + fire-and-forget** | **VERIFIED** | 13 active `recordApiCall(...)` call sites (appsflyer×2, gemini×4, cloudinary, mapbox×2, paystack×2, serper×3) all `void`-prefixed (no blocking await, no host-return change). 4-arg legacy sites compile unchanged (5th arg optional); `deno check` clean across all wrap files. `apiHealthLog.test.ts` proves a FORCED insert failure (unroutable host) is swallowed and `recordApiCall` resolves without throwing (the throwing-insert proof the dispatch asked for). |
| **6. allSettled isolation** | **VERIFIED** | Layer A (`Promise.allSettled(probeStatusPage)` L785) + Layer B (`Promise.allSettled(bProbes)` L812) both keep only `fulfilled` results; handler wraps everything in try/catch returning HTTP 200 (no cron retry-storm). `allsettled.test.ts` (2 tests) confirms one rejecting probe doesn't drop the others; a revert-proof shows `Promise.all` would drop all. |
| **7. Canonical 25 + 3 new invariants** | **VERIFIED** | All 25 services re-classed via idempotent `UPDATE…WHERE service_key=` (24 `[a-z_]`-keys + `ga4`); foursquare ABSENT (grep exit 1) so SERVICE-KEY-CANONICAL stays `===25`; giphy Class F (synthetic, no feed). 3 R2 gates pass: PROCESSOR-NO-BALANCE (anchors per-service UPDATE, forbids `balanceLow: bal < …` processor branch), CLASS-B-REACTIVE (every Class-B has reactive\|header; openai match==`insufficient_quota`, not `rate_limit_exceeded`), THRESHOLDS-FROM-BASELINE (twilio 25, cloudinary 80/100, pexels 2500, tm 500; no old `def 20`/MIN_CREDIT_PCT/`(limit-used)/limit` math). |
| **8. STATUS_PAGE_URLS = only resolving feeds** | **MOSTLY VERIFIED — 1 P2 dead feed (stripe)** | Live-curled all 13 kept feeds 2026-06-22: 12/13 return HTTP 200 valid Atlassian `{status.indicator}`. **`stripe` → HTTP 404 HTML (Stripe is NOT on Atlassian Statuspage).** Dropped `paystack`→404 ✅, `posthog`→200 today (stale-but-harmless drop), `giphy` kept-out-as-F ✅. The stripe dead feed is **non-harmful** (404 ⇒ `unknown` ⇒ never alerts; Stripe's real health = Class-C synthetic) but it IS a residual D5-class dead feed. **Root cause = the SPEC §3.1 itself lists `stripe: status.stripe.com/api/v2/status.json`** — the implementor followed spec; this is a spec miss, not an implementor deviation. See P2-1. |

### Test runs (actual)
- **Deno: 70 passed | 0 failed** (49 implementor + my 21 adversarial) — `deno test supabase/functions/api-health-probe/ _shared/apiHealthLog.test.ts`.
- **Admin node: 11 passed | 0 failed** — `apiHealthStatus.test.js`.
- **Strict-grep gates: 6/6 pass** (3 existing 1201 + 3 new R2).
- **Type-check: clean** — `deno check` on index.ts, logic.ts, apiHealthLog.ts, agentGemini.ts, geminiMenuParser.ts, mapboxGeocode.ts, run-place-intelligence-trial/index.ts.

---

## 2. ADVERSARIAL TEST — path, angle, fails-on-revert

**Path:** `supabase/functions/api-health-probe/tester_adversarial_r2.test.ts` (NEW, append-only, 21 tests). **Commit `946776661`.**

**Different angle vs. implementor's `class_routing.test.ts`** (which covered processor-$0, openai disambig, cloudinary-crit, serper-single-obs): mine attacks the **AND-gate** (right-token-wrong-http, right-http-wrong-token, Serper-500-not-in-set), **resend/gemini disambiguation**, **no-fabrication** (null/empty signal, probe_only zero-obs, null http_status, missing balance field, Sentry token-gate), **boundary inclusivity** (header `<= warn` exact, twilio/cloudinary/exchangerate warn+crit edges, NaN/undefined cached), **mapbox/google_places status_text matchers**, and **newest-first lastError ordering**.

**Fails-on-revert proven (2 independent defect simulations against HEAD `ae3703079`):**
1. **Removed the processor short-circuit** (`return {balanceLow:null…}` for stripe/paystack) → `ADV-R2 P1` FAILS (`20 passed | 1 failed`). Proves the #1 correction (D2 processor-no-balance) is load-bearing.
2. **Disabled the substring matcher** (`if (hay…includes(needle))` → `if (true)`, simulating D3 bare-429 opacity) → `ADV-R2 B2, B3, B4, B5, G2` FAIL (5 failures). Proves the Class-B disambiguation is load-bearing.

`logic.ts` restored to clean (`git diff --stat` empty) after each; full suite re-green (70/0).

---

## 3. FINDINGS

### P0 (blockers) — NONE.

### P1 (must-fix-before-close) — NONE.

### P2 (non-harmful / spec-level)
- **P2-1 — `stripe` is a DEAD status feed (D5 residue).** `status.stripe.com/api/v2/status.json` returns HTTP 404 HTML (Stripe is not on Atlassian Statuspage); kept in both `logic.ts STATUS_PAGE_URLS` and the migration's `stripe.depletion_signal.status_feed`. **Zero false-alert blast** — `probeStatusPage` maps the 404 → `unknown` → never alerts; Stripe health comes from its Class-C synthetic probe. But it is exactly the dead-feed class the R2 set out to eliminate. **Origin = SPEC §3.1** (lists this URL), so it's a spec miss the implementor inherited. Fix: drop `stripe` from `STATUS_PAGE_URLS` + set migration `stripe.status_feed=NULL` (Stripe has no machine status feed). Optional follow-on; not a ship blocker.
- **P2-2 — `posthog` feed resolves 200 today.** Implementor dropped `status.posthog.com/api/v2/status.json` citing a 301→HTML; it currently returns 200 valid Atlassian. Harmless (posthog is Class D, feed-optional) — staleness note only.

### Informational
- **Entire hub is UNAPPLIED to prod.** Live DB's latest migration is `20261117000001`; `20261118` (1186c), `20261119` (1195), `20261120` (the ORCH-1201 hub), and `20261121` (R2) are all queued/unapplied. `public.api_health_services` does not yet exist. Consistent with the deploy-gated mandate — there is no live hub data to live-fire against until the deploy lands. The R2 migration's monotonic prefix correctly orders it after the hub.

---

## 4. VERIFIED vs DEPLOY-GATED (the honesty line)

**VERIFIED (source/unit/integration, provable now):** all 8 dispatch angles at the logic layer; 70 deno + 11 admin + 6 gates green; type-check clean; fails-on-revert proven on the 2 core corrections; migration structure (25 classes, 0 processor balance keys, 5 verify assertions, RPC re-declared, idempotent ADD-COLUMN-IF-NOT-EXISTS + UPDATE-WHERE) statically sound; 12/13 status feeds live-confirmed.

**DEPLOY-GATED (CANNOT verify until deploy — source-only is capped at "suspected" for runtime):**
- migration applies clean on top of `20261120000000` (hub not even applied yet);
- the real cron tick hitting real vendors (Twilio/Cloudinary/Serper/Stripe/Paystack auth + the live numbers);
- `admin_get_api_health()` returning `monitoring_class`/`depletion_signal`/`depletion_24h` on real rows;
- the admin board rendering class badges + grey processor balance + red Cloudinary dot;
- end-to-end alert email copy (quota EXHAUSTED / account restricted) firing through the N=2 machine on real failing ticks.

---

## 5. POST-DEPLOY LIVE-FIRE CHECKLIST (operator-gated, read-only)

Run AFTER: (a) migrations `20261118…20261121` applied in order, (b) `api-health-probe` deployed **from MERGED main** (not this worktree — clobber risk per memory).

1. **Migration apply (idempotent):** apply `20261120000000` then `20261121000000`; re-run R2 once ⇒ no-op, no error. Confirm `SELECT count(*) FROM api_health_services = 25`, all `monitoring_class` non-null, `stripe`/`paystack` have no `depletion_signal->'balance'`, `api_health_observations.error_code`/`error_text` exist.
2. **Force one tick:** invoke `api-health-probe` manually.
3. **Cloudinary CRIT:** `admin_get_api_health()` → cloudinary synthetic `used_percent≈747`, synthetic status `down`, red dot, a balance email queued (crit).
4. **Twilio WARN:** twilio synthetic `balance≈14.53`, `balanceLow` warn-grade (≤$25), balance-low email; NOT crit.
5. **Serper DOWN (reactive):** after real Serper traffic logs `not_enough_credits` (run-place-intelligence-trial), serper `passive=down` via `class_b_depletion`; "quota EXHAUSTED — not_enough_credits" email after N=2.
6. **Stripe/Paystack HEALTHY + grey balance:** both reachable+`charges_enabled`/`status:true` ⇒ GREEN dot even at $0; admin shows "Balance (settled funds) … — informational" grey; ZERO balance email; ZERO red from balance.
7. **Stripe status_page layer = `unknown`** (the P2-1 dead feed) and does NOT pull Stripe's dot off green — confirms the 404 is harmless.
8. **No-fabrication:** Sentry (no token) + exchangerate (no key) + probe_only services with no traffic render GREY/unknown, never green/0.
9. **allSettled:** confirm a tick with ≥1 unreachable vendor still returns HTTP 200 and writes rows for the rest.

---

## 6. VERDICT

**CONDITIONAL PASS.**

- Every dispatch angle is VERIFIED at the source/unit/integration layer with an independent adversarial suite on different angles, fails-on-revert proven on both core corrections (processor-no-balance + Class-B disambiguation). Gates, deno, admin, type-check all green.
- No P0/P1. One P2 (stripe dead status feed) is **non-harmful** (404 ⇒ unknown ⇒ never alerts) and **inherited from the spec** — recommend dropping `stripe` from `STATUS_PAGE_URLS` + nulling its migration `status_feed` as a clean-up, but it does not block ship.
- **Condition:** the runtime correctness (the 3 live fires actually landing in the table + admin board, processors staying green at $0, migration applying on the unapplied hub) is **DEPLOY-GATED** and MUST be confirmed via the §5 live-fire checklist post-deploy before this is graded production-proven. Until then, runtime is "suspected-correct," not verified.

**Report:** `Mingla_Artifacts/reports/TEST_ORCH-1201-R2.md`
**Commits:** implementation `ae3703079`; adversarial test `946776661`.
**Adversarial test:** `supabase/functions/api-health-probe/tester_adversarial_r2.test.ts` (21 tests, append-only, fails-on-revert proven).

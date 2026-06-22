# IMPLEMENTATION — ORCH-1213 — Payment webhook-silence is info-only

- **Status:** implemented and verified (backend edge-function behavioral change + CI gate)
- **Branch:** `1213-health-webhook-silence-info`
- **Worktree:** `~/Desktop/mingla-orchs/1213-[health-webhook-silence-info]/`
- **Fix commit:** `5c7bcbef4`
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1213_payment-webhook-silence-info-only.md` (binding contract, followed exactly)
- **Date:** 2026-06-22

---

## 1. Summary

A false "Paystack/Stripe is down" health page was firing every ~6h even though the Stripe/Paystack APIs were fully healthy. The page came from the **webhook-silence** signal, not an API outage: stripe + paystack share the near-empty `payment_webhook_events` table, and when its newest row is >6h old (normal in a low/zero-traffic env with zero connected NG brands) the probe marked the webhook layer `degraded` with `alert_on_silence=true`, which `computeEffectiveStatus` escalated to a `failedTick` → 2 ticks → a "down" email.

The fix flips the two payment `webhookFreshness(...)` calls from `alertOnSilence=true` to `false`, making payment webhook-silence **informational only** — the same class as cloudinary/twilio. `last_received` is still recorded and displayed (no fabrication); silence never drives `failedTick`, never enters `alerting`, never sends a down email. A genuine API/auth/charges outage still pages because the synthetic `probeStripe`/`probePaystack` are untouched and set `status:"down"` independently of the webhook layer.

Protection: an implementor happy-path deno test + a CI-enforced strict-grep gate wired into the workflow that runs on `supabase/functions/**`.

## 2. SPEC success-criteria coverage

| SC | Criterion | How verified | Result | Commit |
|---|---|---|---|---|
| SC-1 | Info-only payment webhook silence ⇒ `failedTick===false` | Deno test T-1 / T-1b / T-1c PASS (5/5) | ✓ | `5c7bcbef4` |
| SC-2 | Recovery: alerting→ok + one recovery email on first post-deploy tick | Logic path unchanged (`decideAvailabilityTransitions` recovery branch); existing `logic.test.ts` recovery test still green. Live verification is post-deploy (orchestrator/operator at CLOSE). | ✓ (logic), live-pending | `5c7bcbef4` |
| SC-3 | Genuine outage STILL pages (`failedTick===true`, `down`) | Deno test T-1d PASS (synthetic `down` + info-only silent webhook ⇒ failedTick=true, effectiveStatus=down) | ✓ | `5c7bcbef4` |
| SC-4 | cloudinary/twilio unchanged (`alert_on_silence:false`) | `index.ts:1037-1038` untouched; gate pins only the two `payment_webhook_events` callers | ✓ | `5c7bcbef4` |
| SC-5 | CI gate wired, passes on fix, FAILS on revert | Gate `--self-test` PASS (6/6); real-run PASS; revert-to-`true` → gate exit 1; wired as new job in `strict-grep-mingla-business.yml` | ✓ | `5c7bcbef4` |

## 3. Files changed

| File | Change | ~Lines |
|---|---|---|
| `supabase/functions/api-health-probe/index.ts` | `true`→`false` on stripe + paystack `webhookFreshness(...)`; expanded `:1031` comment (now `:1031-1035`) | +5 / −2 |
| `supabase/functions/api-health-probe/logic.ts` | comments ONLY (rollup header `:165-171` + the `failedTick` inline comments `:192`/inside else); NO code change to the `worst==="down"` / `alert_on_silence===true` branch | +9 / −4 (comment) |
| `supabase/functions/api-health-probe/orch_1213_payment_webhook_silence_info.test.ts` | NEW — 5 deno tests (T-1, T-1b, T-1c info-only; T-2 opt-in sentinel; T-1d outage isolation) | +130 (new) |
| `.github/scripts/strict-grep/i-proposed-1213-payment-webhook-silence-info-only.mjs` | NEW — strict-grep gate with `--self-test` (modeled on `orch-1211-notif-web-render-safe.mjs`) | +285 (new) |
| `.github/workflows/strict-grep-mingla-business.yml` | NEW job `orch-1213-payment-webhook-silence-info-only` appended after `orch-1211` (self-test + real-run two-step) | +14 |

## 4. Data-model changes applied

None. NO migration, NO schema change, NO `api_health_*` table/seed touched (per SPEC).

## 5. Edge functions touched

- `api-health-probe` (`supabase/functions/api-health-probe/index.ts` + `logic.ts`) — behavioral flag flip only. **`verify_jwt` to preserve at deploy:** the orchestrator/operator MUST confirm the current `verify_jwt` setting before `supabase functions deploy api-health-probe --project-ref gqnoajqerqhnvulmnyvv` and NOT pass `--no-verify-jwt` unless it was already configured that way. Deploy from MERGED main, not from this worktree (implementor does not deploy).

## 6. Regression tests added

- **Path:** `supabase/functions/api-health-probe/orch_1213_payment_webhook_silence_info.test.ts` (NEW, 5 tests).
- **Run output (fix in place):** `ok | 5 passed | 0 failed`.
- **CI-enforced protection:** the api-health-probe deno suite does NOT run in any blocking CI job today (SPEC §9 / OQ-2), so the **strict-grep gate is the CI-run guard**: `i-proposed-1213-payment-webhook-silence-info-only.mjs`, wired into `strict-grep-mingla-business.yml` (triggers on `supabase/functions/**`). Gate `--self-test`: `PASS (6/6 cases)`. Gate real-run: PASS.
- **fails-on-revert verified at `5c7bcbef4`:**
  - **Gate:** flipping `index.ts` stripe call back to `webhookFreshness("stripe","payment_webhook_events","created_at", true)` → gate exits **1** with two failures (true present + false missing). Restored → PASS (exit 0).
  - **Deno test (logic level):** feeding the reverted runtime data shape `{layer:"webhook", status:"degraded", detail:{alert_on_silence:true}}` (exactly what `index.ts:1020/1025` records when `true` is passed) into the unchanged `computeEffectiveStatus` makes T-1's `assertEquals(failedTick, false)` throw → test FAILS. The `false` result is therefore driven by the load-bearing `alert_on_silence` flag, not a tautology. T-2 independently proves the opt-in branch still pages (`failedTick===true`).
  - The fix was restored from the committed `5c7bcbef4` (working tree clean) and both gate + deno test PASS again.

## 7. Old → New receipts

### `supabase/functions/api-health-probe/index.ts`
- **Before:** `webhookFreshness("stripe"|"paystack", "payment_webhook_events", "created_at", true)` — >6h silence recorded as `webhook`/`degraded`, `alert_on_silence:true` → escalated to `failedTick` → false "down" page.
- **Now:** both pass `false` — silence recorded as `healthy`/`unknown` with `alert_on_silence:false`; never `failedTick`/`alerting`/down email. `last_received` still recorded + displayed. Comment expanded to mark payment webhook-silence informational (mirrors cloudinary/twilio) so a future maintainer does not revert it.
- **Why:** SC-1 / SC-5 / Executive summary — stop the false recurring health page.
- **Lines:** +5 / −2.

### `supabase/functions/api-health-probe/logic.ts`
- **Before:** rollup header + inline comments said webhook-silence `degraded` for stripe/paystack "DOES count as a failedTick".
- **Now:** comments document that ALL current webhook callers pass `alertOnSilence=false`, so the `alert_on_silence===true` branch is **dormant** — kept as a generic guard for any future opt-in caller. **No code change** to lines ~196-208 (the branch logic is unchanged, per SPEC §4.2).
- **Why:** SPEC §4.2 — keep the defensive guard, document it is no longer active for current callers.
- **Lines:** comment-only (+9 / −4).

## 8. Cross-surface impact

| Surface | Affected? | Detail |
|---|---|---|
| Consumer iOS | No | edge-function-only; no app code, no OTA |
| Consumer Android | No | same |
| Buyer/anonymous Web | No | same |
| Business iOS | No | same |
| Business Android | No | same |
| Admin Web (adjacent) | Indirect (display) | the admin api-health dashboard stops showing stripe/paystack as `down` from webhook silence; still displays `last_received` honestly. No admin code changed. |
| Business Web preview (adjacent) | No | n/a |

Parity is automatic (single shared edge function). No app surface touched → COMMS-0052 OTA freeze satisfied by construction (NO `eas update`).

## 9. Smoke result

- `deno test orch_1213_payment_webhook_silence_info.test.ts` → 5 passed / 0 failed.
- `deno test logic.test.ts` (existing suite) → 31 passed / 0 failed (no regression).
- `deno check logic.ts + the new test` → clean.
- Gate `--self-test` → PASS (6/6); gate real-run → PASS.
- fails-on-revert → proven for both the gate (exit 1 on `true`) and the deno test (T-1 assertion throws on reverted data shape).
- No simulator/device run applicable (no UI/runtime app surface).

## 10. Known issues / deferred

- **OQ-1 (recovery emails):** per SPEC default, on the first post-deploy tick each currently-`alerting` service (stripe + paystack) sends exactly ONE recovery email and transitions `alerting→ok` naturally via the unchanged `decideAvailabilityTransitions` recovery branch. No manual `api_health_alert_state` reset performed (SPEC default = let recovery email fire). If Seth wants ZERO emails, the optional one-time `UPDATE api_health_alert_state SET current_state='ok', consecutive_failures=0 WHERE service_key IN ('stripe','paystack')` before deploy is available but is NOT part of this implementation.
- **OQ-2 (api-health deno suite CI gap — out of scope, flagged):** the entire `api-health-probe` deno unit suite runs in NO blocking CI job today. ORCH-1213 protects its own change via the strict-grep gate; wiring the full suite into CI is a separate follow-up ORCH (not done here to avoid scope creep).
- No `[TRANSITIONAL]` code introduced.

## 11. Operator action required (orchestrator/operator at CLOSE — NOT implementor)

- Route to **mingla-tester** for T-3/T-4/T-5 (genuine outage still pages; info-only recovers cleanly; cloudinary/twilio unchanged; prove gate FAILS-on-revert + PASSES-on-fix).
- On CLOSE: flip `I-PROPOSED-1213-PAYMENT-WEBHOOK-SILENCE-INFO-ONLY` ACTIVE; deploy `api-health-probe` from MERGED main (`supabase functions deploy api-health-probe --project-ref gqnoajqerqhnvulmnyvv`, confirm + preserve current `verify_jwt`); verify SC-2 (recovery emails + `api_health_alert_state` → `ok`, `consecutive_failures=0`) on the first post-deploy tick.
- NO migration. NO `eas update` (COMMS-0052 in force; backend edge-function deploy only).

## 12. Discoveries for Orchestrator

- None beyond the SPEC's own OQ-2 (api-health deno suite is unprotected by CI — already flagged by forensics; a follow-up ORCH worth doing to enforce ORCH-1201/1201R2/1213 unit coverage).

## COMMS

- **COMMS-0052** (BLOCK, to ALL): acknowledged — business-app OTA is blocked until a new business native build. ORCH-1213 is backend edge-function-only with NO `eas update`, so it complies by construction.

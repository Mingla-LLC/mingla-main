# QA — ORCH-1213 — Payment webhook-silence is info-only (stop false "down" pages)

- **Verdict:** **PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2
- **Class:** backend / edge-function-only behavioral change + CI-enforced strict-grep gate. Source-only reasoning is SUFFICIENT (Phase 0.A exemption: edge-function-only, no UI/runtime/app surface). No simulator/device run applicable.
- **Branch:** `1213-health-webhook-silence-info` · **Worktree:** `~/Desktop/mingla-orchs/1213-[health-webhook-silence-info]/`
- **Fix commit under test:** `5c7bcbef4` · **Tester adversarial commit:** `ae77ca5c1`
- **Date:** 2026-06-22 · **Tester:** mingla-tester (adversarial)
- **COMMS acked:** COMMS-0052 (BLOCK→ALL, business-OTA freeze) — this ORCH is backend edge-function-only with NO `eas update`; complies by construction. No deploy/merge/migration/OTA performed by this skill.

---

## 1. Verdict + finding count

**PASS.** Zero P0, zero P1. The two payment `webhookFreshness(...)` calls are flipped `true→false`; payment webhook-silence is now informational only and never drives `failedTick`/`alerting`/down-email. A genuine API/auth outage STILL pages (synthetic probes untouched). The currently-alerting stripe + paystack rows recover cleanly. cloudinary/twilio unchanged. The CI strict-grep gate PASSES on the fix and FAILS on revert (independently re-proven). Both the implementor happy-path test and my adversarial test (different angle) are on-branch, in the closing diff, and fail-on-revert.

Two P4 notes (informational) below.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence (independently run) |
|---|---|---|---|
| SC-1 | Info-only payment webhook silence ⇒ `failedTick===false` | **PASS** | Implementor deno T-1/T-1b/T-1c (`computeEffectiveStatus` returns `failedTick=false` for `{webhook, healthy/unknown/degraded, alert_on_silence:false}`); my ADV T-4 pipeline confirms `failedTick=false`. Source: `logic.ts:200-215` — `worst!=="down"` + no `alert_on_silence===true` row ⇒ stays false. 5/5 + 6/6 deno PASS. |
| SC-2 | Recovery: alerting→ok + one recovery email on first post-deploy tick | **PASS (logic proven; live-pending CLOSE)** | My ADV T-4 pipeline composes `computeEffectiveStatus(failedTick=false) → decideAvailabilityTransitions({currentState:"alerting", cf:9 / cf:4})` ⇒ `nextState="ok"`, `sendRecoveryAlert=true`, `sendDownAlert=false`, `nextConsecutiveFailures=0`, `setLastRecoveryAt=true`. Source `logic.ts:264-269` (recovery branch). **Live DB confirms the premise:** `api_health_alert_state` 2026-06-22 — paystack `alerting, cf=4`; stripe `alerting, cf=9`; `last_recovery_at=null` for both (matches my test inputs exactly). Live recovery email firing is observable only post-deploy (orchestrator at CLOSE). |
| SC-3 | Genuine outage STILL pages (`failedTick===true`, `down`) | **PASS** | My ADV T-3: synthetic `{status:"down", http_status:401}` + info-only silent webhook ⇒ `failedTick=true`, `effectiveStatus="down"`, `failingLayer="synthetic"`. ADV T-3 pipeline: 2 such ticks from `ok` ⇒ `nextState="alerting"`, `sendDownAlert=true`. Source `logic.ts:200-201` (`worst==="down"` ⇒ `failedTick=true`, independent of webhook). Webhook downgrade does NOT mask a real outage. |
| SC-4 | cloudinary/twilio unchanged (`alert_on_silence:false`) | **PASS** | `index.ts:1039-1040` still pass `false` (untouched). My ADV T-5: info-only silent cloudinary+twilio rows ⇒ `failedTick=false`. Gate pins ONLY the two `payment_webhook_events` callers (table arg `payment_webhook_events`), so cloudinary (`event_cover_video_jobs`)/twilio (`twilio_message_status_events`) can never match. |
| SC-5 | CI gate wired, passes on fix, FAILS on revert | **PASS** | `--self-test` PASS (6/6); real-run on fix PASS (exit 0); flip stripe→`true` ⇒ gate exit **1** (two failures: `true` present + `false` missing); restore ⇒ PASS (exit 0), tree clean. Wired as job `orch-1213-payment-webhook-silence-info-only` in `strict-grep-mingla-business.yml:2894` (self-test + real-run two-step); workflow triggers on `supabase/functions/**` (PR + push). |

---

## 3. Findings

**No P0/P1/P2/P3 findings.**

- **P4-1 (praise):** The gate's `stripComments()` pass is correct and load-bearing — it strips the protective ORCH-1213 comment block (which mentions the old `true` call) AND the gate's own JSDoc, so the comment cannot self-trigger a false FAIL. Self-test case (e) explicitly proves a `true` mention in a comment does NOT fire. Whitespace/quote-variant tolerance (case f) is also covered. Clean defensive design.
- **P4-2 (carried, not new — already SPEC OQ-2):** The entire `api-health-probe` deno unit suite (`logic.test.ts`, `class_routing.test.ts`, `tester_adversarial_r2.test.ts`, `adversarial_statemachine.test.ts`, and BOTH ORCH-1213 test files) runs in NO blocking CI job today — `supabase-migrations-and-stripe-deno.yml` uses a `DENO_TEST_FILES` allowlist that excludes `api-health-probe/*`. The CI-RUN protection for ORCH-1213 is therefore the strict-grep gate (which IS blocking and DOES run on `supabase/functions/**`), exactly as the SPEC §9 designed. The two deno tests document intent + provide local fails-on-revert; the gate is the enforcement. This is acceptable for THIS ORCH but the suite-wide CI gap is worth a follow-up ORCH (already flagged by forensics as OQ-2). Not a blocker.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

I ran the implementor's happy-path test and independently re-proved fails-on-revert (did NOT trust the IMPLEMENT report's claim).

- **Implementor test on fix (`5c7bcbef4`):** `deno test orch_1213_payment_webhook_silence_info.test.ts` → **5 passed / 0 failed** (T-1, T-1b, T-1c, T-2, T-1d).
- **Gate fails-on-revert (source level):** copied `index.ts`, flipped `webhookFreshness("stripe", "payment_webhook_events", "created_at", false)` → `true`; gate real-run exited **1** with two failures (`true` present + `false` missing). `git checkout -- index.ts` ⇒ tree clean (`git status --porcelain` empty), stripe back to `false`, gate PASS (exit 0). **Restore confirmed.**
- **Implementor deno T-1 fails-on-revert (logic level):** fed the reverted runtime data shape `{layer:"webhook", status:"degraded", detail:{alert_on_silence:true}}` (exactly what `index.ts:1020/1025` records when `true` is passed) into the UNCHANGED `computeEffectiveStatus` and asserted T-1's verbatim `assertEquals(failedTick, false)` — it **threw** (`-true / +false`). The `false` result is driven by the load-bearing `alert_on_silence` flag, not a tautology. Throwaway proof file removed; no repo file modified.

Commit hashes run: fix `5c7bcbef4` (clean working tree), and the reverted state was applied/reverted only to a `/tmp` copy + a `git checkout`-restored `index.ts` (never committed).

---

## 5. Adversarial test added (DIFFERENT angle than T-1)

- **Path:** `supabase/functions/api-health-probe/orch_1213_tester_adversarial.test.ts`
- **Commit:** `ae77ca5c1` (on branch `1213-health-webhook-silence-info`)
- **Angle:** the implementor's T-1 only asserts `computeEffectiveStatus().failedTick`. My test composes the **full `computeEffectiveStatus → decideAvailabilityTransitions` pipeline** for the EXACT live alerting rows (stripe `cf=9`, paystack `cf=4` — confirmed against live `api_health_alert_state`), exercising the recovery state machine the implementor never touches:
  - **ADV T-3** — synthetic `down` (auth/4xx/throw) + info-only silent webhook ⇒ `failedTick=true`, `effectiveStatus="down"`, `failingLayer="synthetic"`; ADV T-3 pipeline: 2 ticks from `ok` ⇒ `sendDownAlert=true`. Real outage NOT masked.
  - **ADV T-4** — each currently-alerting payment row recovers: `nextState="ok"`, `sendRecoveryAlert=true`, `sendDownAlert=false`, `cf→0`, `setLastRecoveryAt=true`. Exactly ONE recovery, no new down page.
  - **ADV T-4 revert-shape sentinel** — proves the recovery is driven by the load-bearing flag.
  - **ADV T-5** — cloudinary/twilio info-only silent rows ⇒ `failedTick=false` (parity).
- **Result on fix:** **6 passed / 0 failed** (with deno type-check ON).
- **fails-on-revert verified at `ae77ca5c1`:** rewrote the test's webhook-row helper to the reverted runtime shape `{status:"degraded", alert_on_silence:true}` (what `index.ts` records under `alertOnSilence=true`); the two **ADV T-4 pipeline recovery assertions FAILED** (`assertEquals(tick.failedTick, false)` threw `-true / +false` → the alerting row no longer recovers). Throwaway copy in `/tmp`, removed; the committed test was never modified for the proof.
- **Both tests in the closing diff:** `git diff origin/main...HEAD --name-only` lists BOTH `orch_1213_payment_webhook_silence_info.test.ts` (implementor) AND `orch_1213_tester_adversarial.test.ts` (tester), both status `A` (Added). **Append-only respected** — no existing test file modified; my commit touched ONLY my new file (+214).

**Regression gate:** SATISFIED. Implementor happy-path (fails-on-revert) + tester adversarial (different angle, on-branch, in-diff, fails-on-revert) both present; CI-RUN enforcement = the strict-grep gate (blocking, runs on `supabase/functions/**`).

---

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No UI surface. |
| 2 | One owner per truth | **PASS** | webhook-silence signal owned solely by `webhookFreshness`; `computeEffectiveStatus` is the single failedTick rollup owner. No competing writer added. |
| 3 | No silent failures | **PASS** | `webhookFreshness` catch `structuredLog`s the error (`index.ts:1027-1029`); change is a flag flip, no new swallow. A genuine outage still pages (SC-3). |
| 4 | One query key per entity | N/A | No client query. |
| 5 | Server state stays server-side | N/A | Edge function only. |
| 6 | Logout clears everything | N/A | No auth/session. |
| 7 | Label `[TRANSITIONAL]` + exit | **PASS** | No transitional code; the dormant `alert_on_silence===true` branch is a documented generic guard, not transitional. |
| 8 | Subtract before adding | **PASS** | Mirrors the existing cloudinary/twilio info-only precedent; no parallel mechanism added. |
| 9 | No fabricated data | **PASS** | `last_received` still recorded + displayed honestly (`index.ts:1025` unchanged); silence is recorded as `healthy`/`unknown`, never a fake green/red. |
| 10 | Currency-aware | N/A | No money rendering. |
| 11 | One auth instance | N/A | No auth. |
| 12 | Validate at right time | **PASS** | `nowMs - latest > SIX_HOURS_MS` comparison unchanged; only the `alertOnSilence` gate flips. |
| 13 | Exclusion consistency | **PASS** | All four webhook callers now consistently `alertOnSilence=false`. |
| 14 | Persisted-state startup | N/A | No client hydration. |

No constitutional violation.

---

## 7. Device / parity matrix

| Surface | Verdict | Reason |
|---|---|---|
| Consumer iOS | N/A (skip) | Edge-function-only; no app code, no OTA. |
| Consumer Android | N/A (skip) | same |
| Buyer/anonymous Web | N/A (skip) | same |
| Business iOS | N/A (skip) | same |
| Business Android | N/A (skip) | same |
| Admin Web (adjacent) | **PASS (indirect, source-verified)** | The admin api-health dashboard reads `api_health_checks`/`api_health_alert_state`; post-fix it stops showing stripe/paystack `down` from webhook silence while still displaying `last_received`. No admin code changed. |
| Business Web preview (adjacent) | N/A (skip) | not applicable. |

**Live deploy state (read-only, `mcp__supabase__list_edge_functions`):** `api-health-probe` is ACTIVE at `version:10`, `verify_jwt:false`. The fix is NOT yet deployed (correct — deploy happens at CLOSE from merged main). **At deploy the orchestrator MUST preserve `verify_jwt:false`** (do NOT pass `--no-verify-jwt` as an override unless re-asserting the existing `false`; confirm the deploy command does not change it). Physical iPhone HITL: N/A (no app surface).

---

## 8. Discoveries for Orchestrator

- **OQ-2 (carried):** the `api-health-probe` deno suite (incl. both ORCH-1213 test files) runs in no blocking CI job. ORCH-1213 is protected by the strict-grep gate; a follow-up ORCH to wire the deno suite into CI would also enforce ORCH-1201/1201R2 unit coverage. Not fixed here (scope).
- **OQ-1 (recovery emails):** per SPEC default, the first post-deploy tick sends exactly ONE recovery email each for stripe + paystack and transitions both `alerting→ok, cf=0`. Live `api_health_alert_state` confirms both are still `alerting` (stripe cf=9 @ last_alert 16:00Z, paystack cf=4 @ 14:00Z, both `last_recovery_at=null`). If Seth wants ZERO emails, the optional pre-deploy `UPDATE` is available but NOT part of this ORCH.

---

## 9. Accepted conditions

None — this is a clean PASS, not a CONDITIONAL PASS.

# SPEC — ORCH-1213 — Payment webhook-silence is info-only (stop false "down" pages)

- **Status:** DRAFT (binding contract for implementor)
- **Author:** mingla-forensics (SPEC mode)
- **Date:** 2026-06-22
- **Worktree:** `~/Desktop/mingla-orchs/1213-[health-webhook-silence-info]/` on branch `1213-health-webhook-silence-info`
- **Class:** backend / edge-function behavioral change + CI-enforced regression gate. NO migration. NO OTA. NO UI.
- **Investigation source:** Orchestrator's live investigation (validated in full by this SPEC — see §0).

---

## 0. Validation of the investigation (forensics re-confirmed before speccing)

Every claim in the dispatch was re-read against live code + live DB in this worktree:

| Claim | Verified | Evidence |
|---|---|---|
| Synthetic Paystack probe is healthy (real API + auth UP) | YES | `index.ts:247-284` `probePaystack` → `${PAYSTACK_BASE_URL}/balance`, `statusOk = res.ok && json?.status === true` → `status:"healthy"`. The alert is NOT from this layer. |
| The alert is the **webhook** layer, 6h-silence on the shared table | YES | `index.ts:1031-1033`: `webhookFreshness("stripe", "payment_webhook_events", "created_at", true)` + same for `"paystack"`. `index.ts:1020`: `else if (alertOnSilence && nowMs - latest > SIX_HOURS_MS) status = "degraded"`. |
| `computeEffectiveStatus` turns webhook-silence `degraded` into a `failedTick` | YES | `logic.ts:196-208`: the `else` branch finds a row where `layer==="webhook" && status==="degraded" && detail?.alert_on_silence === true` and sets `failedTick = true`. |
| 2 consecutive failedTicks → "down" alert via `decideAvailabilityTransitions` | YES | `logic.ts:241-247`: `if (nextConsecutiveFailures >= 2) { nextState="alerting"; sendDownAlert=true; }`. |
| cloudinary/twilio are already info-only (`alertOnSilence=false`) | YES | `index.ts:1035-1036`: `webhookFreshness("cloudinary", …, false)` + `("twilio", …, false)`. This is the exact precedent to mirror. |
| Both stripe + paystack currently `alerting` in live DB | YES | `api_health_alert_state` (live, 2026-06-22 16:00 UTC): **paystack** `current_state=alerting, consecutive_failures=4`; **stripe** `current_state=alerting, consecutive_failures=9`. `last_recovery_at` NULL for both. |

The investigation is **CONFIRMED in full**. No re-investigation required. This is a ~2-line behavioral change + a CI-enforced regression gate + two deno unit tests.

---

## 1. Executive summary

A "Paystack is down" page fired even though the Paystack API is fully healthy. The page came from a **webhook-silence** signal, not an API outage: stripe + paystack share the near-empty `payment_webhook_events` table, and when its newest row is >6h old (normal in a low/zero-traffic environment) the probe marks the webhook layer `degraded` with `alert_on_silence=true`, which `computeEffectiveStatus` escalates to a `failedTick` → 2 ticks → a "down" email. With Paystack now live and zero connected NG brands, zero webhooks arrive and the false page recurs every ~6h. Stripe has the identical false alert (`consecutive_failures=9`).

**Fix (Seth's locked decision):** downgrade payment webhook-silence to **info-only**, the same class as cloudinary/twilio — flip the two payment `webhookFreshness(...)` calls from `true` to `false`. The dashboard still RECORDS and displays `last_received` (no fabrication); webhook-silence simply never drives `failedTick`, never enters `alerting`, never sends a down email. A genuine API/auth outage MUST still page — that path is untouched.

---

## 2. Scope & non-goals

### In scope
1. `index.ts:1032` — flip `webhookFreshness("stripe", "payment_webhook_events", "created_at", true)` → `false`.
2. `index.ts:1033` — flip `webhookFreshness("paystack", "payment_webhook_events", "created_at", true)` → `false`.
3. Update the two adjacent code comments (`index.ts:1031` + the `logic.ts:166-168` / `:192` comments) to state payment webhook-silence is now informational.
4. Step 0.5 regression contract: 1 implementor happy-path deno test + 1 tester adversarial deno test + 1 CI-enforced strict-grep gate (the gate is the CI-RUN protection; see §9).
5. Pre-stage invariant DRAFT `I-PROPOSED-1213-PAYMENT-WEBHOOK-SILENCE-INFO-ONLY` (§6).

### Explicit non-goals (DO NOT touch)
- **`probePaystack` / `probeStripe` synthetic probes** (`index.ts:203-284`) — a real API/auth/charges outage MUST still page. Untouched. (HARD GUARD, §4.1.)
- **`computeEffectiveStatus`'s `alert_on_silence === true` branch logic** (`logic.ts:196-208`) — see §4.2: with `false` passed, `detail.alert_on_silence` is `false`, so the branch literally cannot fire. NO logic change to this branch. (Justification + the deliberate decision to keep it as a defensive guard for any future `alertOnSilence:true` caller in §4.2.)
- **`decideAvailabilityTransitions`** (`logic.ts:231-273`) — recovery happens naturally through this unchanged code (§3). No edit.
- cloudinary/twilio webhook calls (`index.ts:1035-1036`) — already correct; do not touch.
- Any migration, any DB schema, any `api_health_*` table, any seed.
- `app-mobile/`, `mingla-business/`, `mingla-admin/`, marketing — none touched (no OTA, no web build).

### Assumptions
- Low/zero webhook traffic is the normal steady state for this environment; webhook-silence carries no actionable signal today, exactly like cloudinary/twilio.
- The dashboard reading `last_received` from the recorded `api_health_checks` row remains correct and is NOT removed.

---

## 3. Recovery trace (no manual DB reset needed — natural recovery)

After deploy, on the **first tick** (top of next hour):
- Both payment `webhookFreshness` calls now pass `alertOnSilence=false`. Per `index.ts:1018-1021`, with `latest != null` and `alertOnSilence=false`, `status = "healthy"`. The webhook row is recorded as `healthy` with `detail.alert_on_silence=false` (last_received still recorded — §4.3).
- `computeEffectiveStatus` (`logic.ts:182-208`): no `down` layer (synthetic probes healthy), and the silent-webhook `find` (`logic.ts:198-200`) returns `undefined` because no row has `alert_on_silence === true`. → `failedTick = false`.
- `decideAvailabilityTransitions` (`logic.ts:231-263`) for each currently-`alerting` service: `failedTick=false` → `nextConsecutiveFailures = 0`; `currentState==="alerting"` → the `else` (recovery) branch → `nextState="ok"`, `setLastRecoveryAt=true`, **`sendRecoveryAlert=true`**.

**Result:** exactly **one RECOVERY email per service** (stripe + paystack) on the first post-deploy tick, both rows transition `alerting → ok`, `consecutive_failures → 0`. **No manual `api_health_alert_state` reset is required** — prefer this natural recovery. (If Seth wants to suppress even the two recovery emails, an optional one-time `UPDATE api_health_alert_state SET current_state='ok', consecutive_failures=0 WHERE service_key IN ('stripe','paystack')` before deploy would do it — but this is NOT part of the SPEC; the recovery email is the correct, honest "it's fine now" signal.)

---

## 4. Layered specification

This change touches ONE layer (edge function). No DB, service, hook, component, or realtime layer.

### 4.1 Edge function — the change (HARD GUARD included)

File: `supabase/functions/api-health-probe/index.ts`

Exact edits (verbatim current → required):

```
1031:    // stripe + paystack share payment_webhook_events; silence > 6h is degraded (alertable).
1032:    await webhookFreshness("stripe", "payment_webhook_events", "created_at", true);
1033:    await webhookFreshness("paystack", "payment_webhook_events", "created_at", true);
```
→
```
1031:    // ORCH-1213: stripe + paystack share payment_webhook_events. In a low/zero-traffic
1031:    // env webhook silence carries NO actionable signal (zero connected NG brands → zero
1031:    // webhooks), so it is INFORMATIONAL only — same class as cloudinary/twilio below.
1031:    // last_received is still recorded + displayed; silence NEVER drives failedTick/alerting.
1032:    await webhookFreshness("stripe", "payment_webhook_events", "created_at", false);
1033:    await webhookFreshness("paystack", "payment_webhook_events", "created_at", false);
```

**HARD GUARD (non-negotiable):** the synthetic probes `probeStripe` (`index.ts:203-245`) and `probePaystack` (`index.ts:247-284`) are NOT touched. A genuine outage still pages because those probes set `status:"down"` independently of the webhook layer:
- `probeStripe`: `chargesEnabled === false → status="down"`; any thrown error / auth failure → `status:"down"` (`index.ts:228, 242-243`).
- `probePaystack`: `statusOk=false` (non-200 or `json.status!==true`) → `status = httpToStatus(res.status)` which maps 4xx/5xx → `"down"`/`"degraded"` (`index.ts:268-272`); thrown error → `status:"down"` (`index.ts:282`).
These `down` rows make `computeEffectiveStatus` set `failedTick=true` via `logic.ts:194-195` (the `worst === "down"` branch), wholly independent of webhook silence. Only webhook-silence is downgraded.

### 4.2 `computeEffectiveStatus` — NO change (justified)

File: `supabase/functions/api-health-probe/logic.ts:196-208`.

The `else` branch finds a webhook row with `detail?.alert_on_silence === true`. After §4.1, the payment webhook rows carry `alert_on_silence: false` (set at `index.ts:1025` from the `alertOnSilence` arg). The `find` at `logic.ts:198-200` therefore returns `undefined`, the branch body never runs, `failedTick` stays `false`. **No logic edit is needed or made here.**

**Deliberate decision: KEEP the branch as-is (a defensive guard).** Removing it would be out-of-scope churn and would discard a correct generic mechanism: if any *future* webhook service is intentionally registered with `alertOnSilence:true`, this branch correctly pages on its silence. The branch is now simply dormant for all four current webhook callers (stripe/paystack/cloudinary/twilio all pass `false`). The only edit here is a **comment** update at `logic.ts:166-168` and `:192` to reflect that no current caller is alertable:

```
166:// Worst-of-layers rollup for a service this tick. `unknown` never counts as a
167:// failure. `down` worst, then `degraded`, then `healthy`. A webhook layer with
168:// detail.alert_on_silence===true STILL counts as a failedTick — but ORCH-1213
168:// made all current payment/info webhook callers pass alertOnSilence=false, so
168:// this branch is dormant (kept as a generic guard for any future opt-in caller).
```
(Comment text is illustrative; the implementor preserves intent, exact wording at discretion. The CODE in lines 196-208 is unchanged.)

### 4.3 The final webhook-layer representation (the chosen contract)

For stripe and paystack, every tick, the `webhook` check row inserted into `api_health_checks` (`index.ts:1022-1026`) is:

```
{ service_key: "stripe" | "paystack",
  layer: "webhook",
  status: "healthy"      // when latest != null  (a row exists, regardless of age)
          | "unknown",   // when latest == null  (table genuinely empty)
  latency_ms: null, mode: null, http_status: null,
  detail: { last_received: "<ISO timestamp or null>", alert_on_silence: false } }
```

- `last_received` is STILL recorded and displayed — no fabrication, the dashboard keeps showing when the last webhook arrived (`index.ts:1025` is unchanged for this field).
- `status` is never `degraded`-from-silence anymore; the `degraded`-on-silence path (`index.ts:1020`) is gated behind `alertOnSilence` which is now `false`, so it is skipped.
- `alert_on_silence: false` is the load-bearing flag that keeps `computeEffectiveStatus` from escalating it.

---

## 5. Success criteria (observable, testable)

- **SC-1** (happy path): A tick where stripe + paystack synthetic probes are `healthy` and the `payment_webhook_events` newest row is >6h old produces, for each service, a `webhook` check row with `status` ∈ {`healthy`,`unknown`} and `detail.alert_on_silence === false`; `computeEffectiveStatus` returns `failedTick === false`. No down email.
- **SC-2** (recovery): On the first post-deploy tick, the live `alerting` stripe + paystack rows transition to `current_state="ok"`, `consecutive_failures=0`, and each sends exactly one recovery email (`decideAvailabilityTransitions` → `sendRecoveryAlert=true`). Verifiable post-deploy via the live `api_health_alert_state` table + Seth's inbox.
- **SC-3** (genuine outage STILL pages): A tick where `probePaystack` returns `status:"down"` (e.g. auth failure / non-200) yields a `down` synthetic row → `computeEffectiveStatus` `failedTick === true` (via the `worst==="down"` branch). Webhook downgrade does NOT mask a real outage.
- **SC-4** (parity/no-regression on cloudinary/twilio): cloudinary + twilio webhook rows are unchanged (`alert_on_silence:false`, never alert).
- **SC-5** (CI protection runs): the strict-grep gate `i-proposed-1213-payment-webhook-silence-info-only.mjs` is wired into `strict-grep-mingla-business.yml`, passes on the fix, and FAILS if either payment `webhookFreshness(...)` is reverted to `true`.

---

## 6. Invariants

### Preserved
- **I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS** — unaffected; this change reads only.
- **I-PROPOSED-1201R2-PROCESSOR-NO-BALANCE-ALERT** — unaffected; balance is still display-only (`evaluateBalanceForSignal` returns null for stripe/paystack, `logic.ts:332`).
- **I-PROPOSED-1201-ALERT-EMAIL-SINGLE-OWNER** — preserved; no new email-send path is added; recovery email rides the existing `sendOpsAlertEmail` path.

### NEW (DRAFT — flips ACTIVE on CLOSE; orchestrator owns the flip)
**`I-PROPOSED-1213-PAYMENT-WEBHOOK-SILENCE-INFO-ONLY`**
- **Rule:** In `api-health-probe`, the stripe and paystack `webhookFreshness(...)` calls against `payment_webhook_events` MUST pass `alertOnSilence=false`. Payment webhook-silence is informational only: it may record/display `last_received` but MUST NEVER produce a `failedTick`, enter `alerting`, or send a down alert. Genuine API/auth outages (synthetic `probeStripe`/`probePaystack` returning `down`) MUST still page (this invariant does NOT weaken outage paging).
- **Enforcement:** strict-grep gate `i-proposed-1213-payment-webhook-silence-info-only.mjs` (CI-run via `strict-grep-mingla-business.yml`, which triggers on `supabase/functions/**`). The gate asserts both payment `webhookFreshness(... , false)` calls are present and that NO `webhookFreshness("stripe"|"paystack", "payment_webhook_events", ..., true)` exists.
- **Regression:** `logic.test.ts` (or a new `orch_1213_*.test.ts`) proves `failedTick===false` for a payment webhook row with `alert_on_silence:false` even when silent, AND `failedTick===true` for a `down` synthetic row (outage still pages). Both fail-on-revert.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 (implementor, happy) | Payment webhook silent >6h, info-only | rows = `[{layer:"synthetic",status:"healthy"},{layer:"webhook",status:"healthy",detail:{alert_on_silence:false}}]` (and the silent-table case `status:"unknown"`) | `computeEffectiveStatus().failedTick === false` | logic (deno) |
| T-2 (implementor, fail-on-revert anchor) | A webhook row with `alert_on_silence:true` still fails (proves the test detects a revert) | rows = `[{layer:"webhook",status:"degraded",detail:{alert_on_silence:true}}]` | `failedTick === true` (existing test at `logic.test.ts:64` — keep it; it is the revert sentinel for the BRANCH) | logic (deno) |
| T-3 (tester, adversarial — outage still pages) | Genuine Paystack API down | rows = `[{layer:"synthetic",status:"down",detail:{}},{layer:"webhook",status:"healthy",detail:{alert_on_silence:false}}]` | `failedTick === true`, `effectiveStatus==="down"` | logic (deno) |
| T-4 (tester, adversarial — info-only is genuinely info) | Webhook layer silent + everything else healthy → NO alert + state recovers | `decideAvailabilityTransitions({currentState:"alerting", consecutiveFailures:9, failedTick:false, ...})` | `nextState==="ok"`, `sendRecoveryAlert===true`, `sendDownAlert===false` | logic (deno) |
| T-5 (tester, parity) | cloudinary/twilio unchanged | grep/code assertion both still pass `false` | unchanged behavior | gate (mjs) |

The implementor adds T-1/T-2 to a new `supabase/functions/api-health-probe/orch_1213_payment_webhook_silence_info.test.ts` (or extends `logic.test.ts`); the tester (different angle) owns T-3/T-4/T-5. Both reference `computeEffectiveStatus` / `decideAvailabilityTransitions` from `logic.ts`.

---

## 8. Implementation order

1. Edit `index.ts:1032` + `:1033` (`true` → `false`) and the `index.ts:1031` comment block (§4.1).
2. Update the `logic.ts:166-168`/`:192` comments only (NO code change to `logic.ts:196-208`) (§4.2).
3. Add the implementor happy-path deno test (T-1) proving `failedTick===false` for info-only payment webhook silence, plus the fail-on-revert assertion (T-2 already exists at `logic.test.ts:64` — keep it).
4. Add the strict-grep gate script `.github/scripts/strict-grep/i-proposed-1213-payment-webhook-silence-info-only.mjs` (with a `--self-test` path mirroring `orch-1211-notif-web-render-safe.mjs`).
5. Register the gate as a new job in `.github/workflows/strict-grep-mingla-business.yml` (append after the `orch-1201r2-*` block; the workflow already triggers on `supabase/functions/**`).
6. Hand to tester for T-3/T-4/T-5.

---

## 9. Regression prevention — Step 0.5 contract (Seth HARD-MUST: must RUN in CI)

**The CI-enforced protection is the strict-grep gate**, because the api-health-probe deno unit suite is **NOT currently wired into any CI workflow** (verified):
- `supabase-migrations-and-stripe-deno.yml` runs an explicit `DENO_TEST_FILES=(...)` allowlist that does NOT include any `api-health-probe/*.test.ts`, and its `paths:` filter only covers `supabase/functions/_shared/**`, `supabase/functions/__tests__/**`, and `migrations/**` — NOT `supabase/functions/api-health-probe/**`. So `logic.test.ts`, `class_routing.test.ts`, `tester_adversarial_r2.test.ts`, `adversarial_statemachine.test.ts` are jest/deno files that **do not run in any blocking CI job today** (same trap noted in MEMORY: "a jest/deno test CI doesn't run ≠ protection").
- The strict-grep workflow `strict-grep-mingla-business.yml` DOES run on every PR/push touching `supabase/functions/**` and is a blocking gate. Therefore the new `i-proposed-1213-*.mjs` gate is the ACTUAL CI-run protection.

**(a) Implementor happy-path (T-1)** — a deno test proving payment webhook-silence no longer produces a failedTick; fails-on-revert because flipping `alert_on_silence` back to `true` makes `computeEffectiveStatus` return `failedTick=true`, breaking the assertion. (Documents intent; the CI-run guarantee comes from the gate.)

**(b) Tester adversarial (T-3/T-4/T-5), DIFFERENT angle** — proves (i) a genuine API-down synthetic row STILL pages (`failedTick=true`), (ii) the now-silent webhook drives a clean recovery (no down alert), (iii) cloudinary/twilio unchanged.

**(c) CI gate `i-proposed-1213-payment-webhook-silence-info-only.mjs`** (the enforcement that RUNS):
- PASS-on-fix: asserts `index.ts` contains `webhookFreshness("stripe", "payment_webhook_events", "created_at", false)` AND `webhookFreshness("paystack", "payment_webhook_events", "created_at", false)`.
- FAIL-on-revert: asserts NO `webhookFreshness("stripe"|"paystack", "payment_webhook_events", ..., true)` line exists; if a reviewer flips either back to `true`, the gate fails the PR.
- Self-test: `--self-test` runs both a synthetic PASS fixture and a synthetic FAIL (true) fixture in-script (model on `orch-1211-notif-web-render-safe.mjs --self-test`).
- The HARD GUARD is protected by `i-proposed-1201-probe-no-write-side-effects` (already in CI) + the SPEC non-goal — the gate intentionally does NOT touch the synthetic probes so it cannot encourage their weakening.

**Protective comment** at `index.ts:1031`: explains payment webhook-silence is informational (zero-traffic env, mirrors cloudinary/twilio) so a future maintainer does not "fix" it back to `true`.

---

## 10. Open questions (for Seth)

- **OQ-1 (recovery emails):** the fix sends exactly ONE recovery email each for stripe + paystack on the first post-deploy tick (the honest "it's fine now" signal). If you'd rather receive ZERO emails, the implementor can run a one-time `UPDATE api_health_alert_state SET current_state='ok', consecutive_failures=0 WHERE service_key IN ('stripe','paystack')` immediately BEFORE deploy. **Default per SPEC = let the recovery email fire (no manual reset).** Confirm if you want it suppressed.
- **OQ-2 (api-health deno suite CI gap — out of scope, flagged):** the entire `api-health-probe` deno unit suite runs in NO blocking CI job today. ORCH-1213 protects its own change via the strict-grep gate, but wiring the full suite into CI is a separate follow-up ORCH worth doing (otherwise ORCH-1201/1201R2 unit coverage is unenforced). Not fixed here to avoid scope creep.

---

## 11. Downstream routing

- **Next = mingla-implementor** (this worktree/branch): apply §4.1 (the two `true→false` flips + comment), §4.2 comment-only, add the T-1/T-2 implementor deno test, add + register the strict-grep gate (§9c). NO deploy, NO merge, NO OTA.
- **Then = mingla-tester:** T-3/T-4/T-5 adversarial (genuine outage still pages; info-only recovers cleanly; cloudinary/twilio unchanged); prove the gate FAILS-on-revert and PASSES-on-fix.
- **Then = mingla-orchestrator CLOSE:** flip `I-PROPOSED-1213-...` ACTIVE; deploy from MERGED main via `supabase functions deploy api-health-probe --project-ref gqnoajqerqhnvulmnyvv` (preserve `verify_jwt` setting — do NOT pass `--no-verify-jwt` unless it was already configured that way; confirm current setting before deploy); verify SC-2 (recovery emails + `api_health_alert_state` → `ok`) on the first post-deploy tick. NO migration. NO OTA (complies with COMMS-0052 — backend edge-function deploy only, no `eas update`).

### Scoped allowlist (implementor may modify ONLY these)
- `supabase/functions/api-health-probe/index.ts` (lines 1031-1033 + comment)
- `supabase/functions/api-health-probe/logic.ts` (comments at 166-168/192 ONLY — no code change to 196-208)
- `supabase/functions/api-health-probe/orch_1213_payment_webhook_silence_info.test.ts` (NEW) or `logic.test.ts` (extend)
- `.github/scripts/strict-grep/i-proposed-1213-payment-webhook-silence-info-only.mjs` (NEW)
- `.github/workflows/strict-grep-mingla-business.yml` (append one job)

### DO-NOT-TOUCH
- `probeStripe` / `probePaystack` (`index.ts:203-284`) and any other synthetic probe.
- `computeEffectiveStatus` CODE (`logic.ts:182-211`) and `decideAvailabilityTransitions` (`logic.ts:231-273`).
- cloudinary/twilio webhook calls (`index.ts:1035-1036`).
- Any migration, any `api_health_*` table/seed, any app/web surface.
Stop-and-amend (request a SPEC amendment) before touching anything outside the allowlist.

# TEST — ORCH-1140 — Stripe detach response-contract reconciliation (honest disconnect UX)

- **ORCH-ID:** ORCH-1140
- **Phase:** TEST (mingla-tester, brutal gatekeeper)
- **Date:** 2026-06-15
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1140-[stripe-detach-contract]/` on branch `ORCH-1140-stripe-detach-contract`
- **Commits under test:** `5b7ebb853` (fix + tests), `4a6579117` (impl report). Tester adversarial test committed at `1b4c1379c`.
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1140_STRIPE_DETACH_RESPONSE_CONTRACT.md`
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1140_STRIPE_DETACH_MISSING_DETACHED_AT.md`

---

## 1. Verdict

**CONDITIONAL PASS** — 0 P0 · 0 P1 · 0 P2 · 1 P3 · 1 P4.

The fix is correct, the regression contract is binding (fails-on-revert proven on both the implementor's and the tester's tests), the constitution holds, and DO-NOT-TOUCH side effects are byte-preserved. The **only** reason this is CONDITIONAL rather than PASS is the on-device UX affordance (SC-7/SC-8) is **DEPLOY-DEFERRED runtime evidence** — the new response shape requires the edge fn redeployed from MERGED main + a business OTA, which the per-our-protocol "deploy edge fns ONLY from merged main" rule forbids pre-merge (prod still runs v187 / the OLD body). The server+client false-failure elimination (the ORCH's core) is fully proven via live-fire derivation + 12 unit tests; the visible "Disconnected" sheet step is capped at **suspected-pass pending post-deploy verification**, exactly the ORCH-1139 pattern the dispatch authorizes.

**No CLOSE blocker.** The deferred items are runtime-confirmation-only, not correctness risks.

---

## 2. SC-by-SC matrix

| SC | Statement | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | Success 200 body carries `detached_at` (ISO), `status:"detached"`, `stripe_delete_status ∈ {succeeded,rejected,skipped}` | **PASS** | `index.ts:132-138` emits all three; live-fire harness `/tmp/orch1140_derivation_livefire.ts` (4/4) inspected the REAL JSON bytes via `_shared/stripeEdgeAuth.jsonResponse`; structural Deno test passes. |
| SC-2 | `not_connected` 200 body carries string `detached_at`, `status:"not_connected"`, `stripe_delete_status:"skipped"`, `rejection_reason:null` | **PASS** | `index.ts:48-58` (verbatim match); Deno test `not_connected 200 body carries detached_at` passes. |
| SC-3 | Stripe mapping: ran+threw → `rejected`+real reason; ran+ok → `succeeded`/null; skipped → `skipped`/null | **PASS (live-fire)** | Derivation `index.ts:121-128` executed against all 3 states in the Deno harness — state A `succeeded`/null, state B `rejected`/verbatim "balance_remaining" string, state C `skipped`/null (stale error NOT surfaced). |
| SC-4 | DB soft-delete, `writeAudit` (with unchanged `after.stripe_delete_error`), `action` selection, notification loop byte-unchanged; still 200 on Stripe rejection | **PASS** | `index.ts:92-100` audit `after:{detached_at, stripe_delete_error}` intact; `action` ternary at :89-91 unchanged; notify loop :102-115 unchanged; no hard `.delete()`; Deno V3-contract test passes. |
| SC-5 | Client RESOLVES (no throw) on any 200 with `status:"detached"`/`"not_connected"`, returns real values | **PASS** | Jest T-3/T-4/T-8 pass; adversarial suite confirms rejected/not_connected resolve. |
| SC-6 | Client hardening: resolves even if success body omits `detached_at`; throws on non-2xx / null / unrecognized | **PASS** | Jest T-5 (missing detached_at resolves), T-6 (error throws), T-7 (unrecognized throws), null-body throws. Fails-on-revert proven. |
| SC-7-iOS / SC-7-Android | After success, sheet shows "Disconnected" step + "Done", NO red banner | **SUSPECTED-PASS — DEPLOY-DEFERRED** | Render is a pure deterministic fn of `stripeDeleteStatus` (`BrandStripeDetachConfirmSheet.tsx:215-252`), tsc-clean, valid props/tokens. NOT live-fired: destructive (deletes a real Stripe account, KYC-to-reverse) + new shape needs deploy+OTA. |
| SC-8-iOS / SC-8-Android | On `rejected`, "Disconnected" step shows real `rejectionReason` as a warm (not error) note | **SUSPECTED-PASS — DEPLOY-DEFERRED** | `tsx:224-238` renders the warm `warnCardWarn` + real reason; cannot reproduce a Stripe rejection without deployed edge fn + a positive-balance brand. |
| SC-9 | No input under which a server-successful detach (200, `status:"detached"`) renders the red banner | **PASS** | Client resolves on every `status:"detached"` body (with/without `detached_at`); sheet routes resolve → `"done"` step, throw → banner. Only a genuine non-2xx reaches the banner now. Jest + adversarial confirm. |

Parity (SC-7/SC-8 iOS vs Android): **automatic** — single shared RN component + shared edge fn, no platform branch (verified: no `Platform.select`/`.ios.`/`.android.` in the touched files).

---

## 3. Findings

### P3-1 — No strict-grep companion gate added (optional per SPEC, non-blocking)
- **Evidence:** SPEC §6 I-PROPOSED-1140 says "A strict-grep companion *may* assert the success block contains `detached_at:` + `stripe_delete_status:`." No `scripts/gates/orch-1140*.mjs` exists.
- **Impact:** The fails-on-revert structural Deno test (`index.test.ts`) already enforces the same invariant in CI, so the regression contract is covered. A grep gate would add a second, faster guard but is not required.
- **Required fix:** None (optional). Orchestrator may add at CLOSE if desired.
- **Retest:** n/a.

### P4-1 — Clean, spec-faithful implementation (praise)
- **Evidence:** The `attemptedStripeDelete` capture at `index.ts:63` (before the UPDATE re-stamps `detached_at`) is exactly the revert-proof derivation the SPEC §4.1 demanded; the client hardening keeps the `error`/`null` throws intact while relaxing ONLY the over-strict `detached_at` guard to an exact status gate; the audit shape is byte-preserved. Tokens reused (`semantic.success`, `accent.warm`, `Icon name="check"`), no new asset, no designer. This is a textbook minimal, contract-faithful fix.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

I checked out the fix at `5b7ebb853` (working tree), reverted each fix by true line-deletion, ran the implementor's tests, and restored. All product files restored to clean (`git status` shows only the new adversarial test untracked, now committed).

**Edge-fn structural test (T-1/T-2):**
- Reverted `index.ts` success body to the OLD `{ ok, status:"detached", stripe_delete_error }` (removed `detached_at` + `stripe_delete_status`).
- `deno test --allow-read supabase/functions/brand-stripe-detach/index.test.ts` →
  `AssertionError: success 200 body must include detached_at (else the client false-fails a completed detach)` — **1 failed / 2 passed.** ✅ Fails-on-revert confirmed.
- Restored → **3 passed / 0 failed.**

**Client behavioral test (T-3/T-5):**
- Reverted `brandStripeDetachService.ts` to the OLD strict `if (typeof data.detached_at !== "string") throw "missing detached_at in response"`.
- `npx jest …orch1140.test.ts` → **2 failed / 5 passed.** The two failures:
  - T-5 (missing `detached_at` resolves) → threw `missing detached_at in response`.
  - T-7 (unrecognized body throws) → threw `missing detached_at` instead of `unexpected response shape` (old code had no exact-status gate).
  ✅ Fails-on-revert confirmed.
- Restored → **7 passed / 0 failed.**

Hashes run: fix tree `5b7ebb853` (HEAD before my test commit). Backups `/tmp/orch1140_index.bak`, `/tmp/orch1140_service.bak` used to restore byte-exactly.

---

## 5. Adversarial test added

- **Path:** `mingla-business/src/services/__tests__/brandStripeDetachService.orch1140.adversarial.test.ts`
- **Commit:** `1b4c1379c`
- **In closing diff:** YES — `git diff origin/main...HEAD --name-only` shows both `…orch1140.test.ts` (implementor) AND `…orch1140.adversarial.test.ts` (tester) AND `index.test.ts`.
- **Different angle than T-1..T-8:** attacks the **rejection-path + missing-field boundaries** the implementor did not cover:
  1. rejected outcome missing `rejection_reason` → resolves with `null` (no fabrication, Const #9).
  2. rejected outcome missing `detached_at` → still resolves (hardening must hold on the rejection path, not only succeeded).
  3. non-null `error` carrying a success-looking `status:"detached"` body → STILL throws (a real failure is never swallowed as success).
  4. `not_connected` missing `detached_at` → resolves benignly.
  5. unknown status string (`soft_detached_v2`) with a valid `detached_at` → THROWS (exact success gate; a renamed status can't silently pass).
- **fails-on-revert verified at `1b4c1379c`:** restoring the old strict `detached_at` throw breaks **3 of 5** (cases 2, 4, 5 fail — case 2 throws "missing detached_at", cases 4/5 mis-route). PASS (5/5) on the fix. Output captured in §4 method.
- **On the fix:** 5/5 PASS.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | "Done" button wired to `handleDone` → `onDetached`+`onClose` (`tsx:113-116, 245`). |
| 2 | One owner per truth | PASS | Edge fn is sole writer of `detached_at`; response shape now matches client contract. |
| 3 | No silent failures | **PASS** | The `error` throw + `null`-body throw preserved (`service:41-43`); a genuine non-2xx STILL surfaces the red banner (adversarial case 3). The fix removes a FALSE failure, does not hide a real one. |
| 4 | One query key per entity | N/A | No query-key change; hook untouched. |
| 5 | Server state server-side | N/A | No Zustand; mutation result held in local component state only for the confirmation step. |
| 6 | Logout clears everything | N/A | No auth/persistence change. |
| 7 | `[TRANSITIONAL]` labeled | N/A | No transitional code. |
| 8 | Subtract before adding | PASS | Replaced dead `stripe_delete_error` wire field with the live `stripe_delete_status`+`rejection_reason`; over-strict guard removed, not stacked. |
| 9 | No fabricated data | **PASS** | `rejection_reason` is the REAL Stripe error string or `null` — never invented (live-fire state B verbatim; adversarial case 1 = null when absent). `detached_at` client-fallback is an honest timestamp only when the server omits it (drift guard), and the server now always sends it. |
| 10 | Currency-aware | N/A | No money formatting in scope. |
| 11 | One auth instance | N/A | Unchanged. |
| 12 | Validate at right time | N/A | No datetime validation. |
| 13 | Exclusion consistency | N/A | n/a. |
| 14 | Persisted-state startup gate | N/A | No persisted state. |

No violations → no automatic P0.

---

## 7. Device / parity matrix

| # | Surface | Verdict | Notes |
|---|---------|---------|-------|
| 1 | Consumer iOS | N/A (skip) | No detach UI on consumer (SPEC §3). |
| 2 | Consumer Android | N/A (skip) | Same. |
| 3 | Buyer/anon Web | N/A (skip) | No detach UI. |
| 4 | **Business iOS** | **SUSPECTED-PASS — DEPLOY-DEFERRED** | Dev build `com.sethogieva.minglabusiness` IS installed on booted sim `iPhone 17 Pro` (17091E60). UI live-fire NOT performed: the action permanently deletes a real Stripe connected account (KYC-to-reverse) — requires Seth's go AND the rejection path (SC-8) cannot be reproduced without the new edge fn deployed + a positive-balance brand. Render logic tsc-clean + token-verified. |
| 5 | **Business Android** | **SUSPECTED-PASS — DEPLOY-DEFERRED (auto-parity)** | No emulator booted; shared RN component + shared edge fn, no platform branch → parity automatic. |
| 6 | Admin Web | N/A (skip) | No admin detach path. |
| 7 | Business Web preview | SUSPECTED-PASS — DEPLOY-DEFERRED (auto) | Same shared component if reachable. |

**Edge-fn live deploy state (read-only via MCP `get_edge_function`):** `brand-stripe-detach` deployed **version 187**, `verify_jwt:true`, status ACTIVE, body = the OLD shape (success returns `stripe_delete_error`, no `detached_at`; `not_connected` returns no fields). The new merged code is NOT yet on prod — correct per protocol (deploy from merged main at CLOSE). **CLOSE must redeploy this fn from merged main + ship the business OTA**, then the on-device SC-7/SC-8 can be human-confirmed.

**Live-fire performed (server contract):** `/tmp/orch1140_derivation_livefire.ts` executed the EXACT derivation (`index.ts:63, 121-128`) + the REAL `_shared/stripeEdgeAuth.jsonResponse` serializer, inspecting JSON bytes across all 3 Stripe states + wire (200 + application/json). 4/4 pass. This is genuine runtime evidence for SC-1/SC-2/SC-3 (not source-only).

---

## 8. Discoveries for Orchestrator

- **D-T1 (CLOSE sequencing, not a defect):** The edge-fn change alone clears the red banner (the client hardening makes even the OLD v187 body resolve as success). The OTA delivers the *visible* "Disconnected" affordance + live Stripe-outcome reporting. So: redeploy edge fn first (or in parallel) → banner gone immediately; OTA → success step + rejection honesty. Both should ship at CLOSE per SPEC §11.
- **D-T2 (post-deploy verification ask):** After CLOSE deploy+OTA, a single human-in-the-loop on-device detach on a *disposable* test brand confirms SC-7 (success step, no banner). SC-8 (rejection note) needs a brand whose Stripe `accounts.del` rejects (positive balance) — likely only reproducible in Stripe test mode with a seeded balance; otherwise accept SC-8 as code-verified.
- **D-T3 (optional gate):** SPEC's optional strict-grep companion (I-PROPOSED-1140) was not added; the Deno structural test covers it. Orchestrator may add a gate at CLOSE for belt-and-suspenders (P3-1).

---

## 9. Accepted conditions (CONDITIONAL PASS)

The CONDITIONAL verdict rests on ONE deferred item, authorized by the dispatch (ORCH-1139 deploy-deferred pattern):

- **SC-7-iOS/Android + SC-8-iOS/Android (on-device "Disconnected" success step + rejection note):** suspected-pass, DEPLOY-DEFERRED. Cannot be live-fired pre-merge because (a) the new response shape requires edge-fn redeploy from merged main (protocol-forbidden pre-merge) + a business OTA, and (b) the detach action is destructive (real Stripe account delete, KYC-to-reverse) so it must not be fired on a real brand without Seth's go, and the rejection path needs a positive-balance brand. Render logic is tsc-clean, token-verified, and a pure deterministic function of the live-fire-verified `stripeDeleteStatus`.

**Condition to clear at CLOSE:** redeploy `brand-stripe-detach` from merged main + business OTA (per SPEC §11), then Seth (or tester HITL) confirms the "Disconnected" step renders with no red banner on a disposable test brand. This is runtime confirmation of already-proven logic, not a correctness risk — it does not block the merge/CLOSE.

---

## 10. Test command log (reproducible)

```
# implementor edge-fn structural (Deno)
deno test --allow-read supabase/functions/brand-stripe-detach/index.test.ts        # 3 passed
# implementor client (Jest)
npx jest src/services/__tests__/brandStripeDetachService.orch1140.test.ts          # 7 passed
# tester adversarial (Jest)
npx jest src/services/__tests__/brandStripeDetachService.orch1140.adversarial.test.ts  # 5 passed
# server derivation live-fire (Deno, scratch harness — not committed)
deno test --allow-read --allow-env /tmp/orch1140_derivation_livefire.ts            # 4 passed
# touched-file typecheck — zero TS errors in DetachConfirmSheet / brandStripeDetachService
npx tsc --noEmit -p tsconfig.json  (263 pre-existing repo-baseline errors, none in scope)
```

Fails-on-revert (both directions) captured in §4.

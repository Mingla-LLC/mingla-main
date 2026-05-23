# IMPLEMENTATION — ORCH-0925 [`ticket-checkout-create` does not attach Stripe Customer to payment-plan PIs]

**Author:** Claude `mingla-implementor` (Claude parity-mirror side, operator-redirected)
**Date:** 2026-05-23
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Status:** `implemented and verified` (all static + Deno gates green; live-fire Stripe verification deferred to tester)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md`
**Pre-fix commit hash (for fails-on-revert):** `0761a27c9dc0ae2172a607b5d8ca76623ba820a8`

---

## 1. Layman summary

Before: payment-plan trip checkouts saved the buyer's card but Stripe left it orphaned — no Customer attached. The cron that charges installments next month had nothing to bill against, so every payment-plan booking silently lost the remaining 75% of revenue. The previous orchestrator workaround (ORCH-0921) tried to enforce the rule downstream and instead caused HTTP 500s, then was rolled back.

After: payment-plan checkouts now force Stripe to create a real Customer at checkout time and attach the saved card to that Customer. Buyer-anonymous web (`/checkout-trip/{eventId}`) uses Stripe's `customer_creation: "always"` flag; native business iOS/Android PaymentSheet uses an explicit Customer lookup-or-create call before the PaymentIntent is created. Full-pay (non-installment) flows are unchanged. The cron can now charge installments off-session and revenue stops leaking.

---

## 2. Old → New receipts

### `supabase/functions/ticket-checkout-create/index.ts` (4 changes)

| Change | Where | What it did before | What it does now | Why |
|---|---|---|---|---|
| **Change 1** | Lines 540–557 (post-edit) inside `stripe.checkout.sessions.create()` payload | Sent `customer_email: buyerEmail` only. Stripe defaulted `customer_creation` to `"if_required"` and did NOT create a Customer for installment-plan checkouts. PM was saved orphaned. | Adds `...(isInstallmentPlan ? { customer_creation: "always" as const } : {})` conditional spread. Stripe now creates a real Customer for every installment-plan checkout and attaches the PM. Stale ORCH-0811 comment block replaced with corrected ORCH-0925 explanation. | SC-1 / SC-2 / SC-3 |
| **Change 2** | Lines 469–472 inside the ORCH-0804 / ORCH-0843 comment block | Comment said the Customer is "created from customer_email" — factually wrong (CF-1 in investigation). | Comment now says the Customer is "created when customer_creation: \"always\" is set for installment plans, per ORCH-0925". | DISC-0925-B (comment-debt fix) |
| **Change 3** | Customer/ephemeralKey block MOVED from original lines 749–830 to immediately BEFORE `let paymentIntent: {` (now at line 638→754 post-edit). Old location deleted. Catch branched on `isInstallmentPlan`. | Block ran AFTER `paymentIntents.create`, so customer was not available for `piCreateBody`. Catch was non-fatal for everyone, including installment plans → orphaned PM with no error surface. | Block runs BEFORE `paymentIntents.create`. Catch records the error in `customerProvisioningError`. For `isInstallmentPlan && customerId === null`: edge fn returns HTTP 502 `installment_customer_provisioning_failed`, updates session row to `status="failed"`, never creates the PI. For full-pay: preserves the ORCH-0844 non-fatal guest-mode fallback (one console.warn line). | SC-4 / SC-7 / SC-8 |
| **Change 4** | Inside `piCreateBody` literal, immediately below the existing `setup_future_usage` spread | `piCreateBody` had no `customer:` field even for installment plans. Stripe accepted `setup_future_usage` silently but left the PM orphaned (no Customer to attach to). | Adds `...(isInstallmentPlan && customerId !== null ? { customer: customerId } : {})` conditional spread. Native installment PIs now bind the saved PM to a real Customer. Full-pay PIs are unchanged. | SC-4 |

**Lines changed:** ~140 net (block deleted at one location ~82 lines; reinserted ~115 lines with branching; +2 spreads ~4 lines; comment rewrites ~16 lines).

### `supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts` (NEW)

| What | Lines |
|---|---|
| Implementor happy-path Deno test with 5 assertions (HP-1..HP-5) — source-string assertion pattern mirroring `orch-0843-direct-charge-shape.test.ts`. Asserts conditional `customer_creation: "always"` spread (HP-1), conditional `customer: customerId` in piCreateBody (HP-2), FATAL error code + guard for installment plans (HP-3), customer-block-precedes-PI-create ordering (HP-4), single-declaration regression guard against duplicated block (HP-5). | 106 lines |

### `.github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs` (NEW)

| What | Lines |
|---|---|
| CI gate scanning `supabase/functions/` for any `checkout.sessions.create` or `paymentIntents.create` call site with `setup_future_usage: "off_session"` + `isInstallmentPlan` in the same 30-line window. Requires `customer_creation: "always"` (Checkout Session) or `customer: <id>` (PI) within the same window. Allowlist tag `orch-strict-grep-allow orch-0925-installment-customer-attached` within 5-line window. Self-test (`--self-test`) synthesizes positive + negative + allowlist fixtures and asserts 0 / 2 / 0 violations respectively. | 244 lines |

### `.github/workflows/strict-grep-mingla-business.yml` (modified)

| What | Lines |
|---|---|
| Added registry comment line (~line 104) declaring the new invariant. Added new CI job `i-proposed-orch-0925-installment-plan-attaches-customer` between `i-proposed-finalize-callers-pass-installment-params` and `i-proposed-tr3-installment-customer-durability`. Job runs self-test step + live-scan step. | +13 lines |

---

## 3. Verification matrix (SPEC §4)

| # | Criterion | Verification | Status |
|---|---|---|---|
| SC-1 | Checkout Session payload sets `customer_creation: "always"` for installment plans | HP-1 Deno test regex match | PASS (static); live Stripe CLI deferred to tester |
| SC-2 | PI from that Checkout Session has non-null `customer` | Stripe behavior driven by SC-1 fix | UNVERIFIED-RUNTIME (tester live-fire) |
| SC-3 | Saved PM has `customer` equal to PI's customer | Stripe behavior driven by SC-1 fix | UNVERIFIED-RUNTIME (tester live-fire) |
| SC-4 | Native installment PI has non-null `customer` | HP-2 + HP-4 Deno tests + reorder confirmed by line-index assertion | PASS (static); native sim live-fire deferred to tester |
| SC-5 | Repeat installment checkouts reuse existing Customer | Existing ORCH-0844 search-then-create logic preserved verbatim; idempotency-key shape unchanged | PASS by reuse (no new code path); CLI probe in TEST phase |
| SC-6 | Full-pay checkouts unchanged | HP-1 regex is conditional-only; full-pay Checkout Session has no `customer_creation`; full-pay PI has no `customer:` | PASS (static); existing tests `orch-0843-direct-charge-shape.test.ts` + `payment_method_allowlist.test.ts` still green |
| SC-7 | Installment customer provisioning failure returns 502 + session marked failed + PI NOT created | HP-3 Deno test asserts FATAL guard + error code; early `return jsonResponse(..., 502)` ordered before `paymentIntents.create` (HP-4 ordering confirms) | PASS (static); negative-path live-fire would require deliberate failure injection (tester optional) |
| SC-8 | Full-pay customer provisioning failure preserves ORCH-0844 guest-mode | New code path explicitly branches on `!isInstallmentPlan && customerProvisioningError !== null` and logs the same `"continuing in guest mode"` warning. Response payload `customerId` + `customerEphemeralKeySecret` remain paired-or-absent | PASS (static); tester adversarial test (A-3 in SPEC §5) covers |
| SC-9 | No regression in HTTP 200 rate / response time | Deno check green; existing tests unchanged | PASS at static layer; post-deploy log monitor by orchestrator |
| SC-10 | Strict-grep gate passes | `node .github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs` returned `scanned 190 files, 1 checkout.sessions.create callers, 2 paymentIntents.create callers, 0 violations` | PASS |
| SC-11 | Happy-path test + fails-on-revert | All 5 tests PASS on fix; 4/5 FAIL on revert (HP-1, HP-2, HP-3, HP-4); HP-5 correctly stays green on revert (single-declaration regression guard) | PASS — see §4 below |
| SC-12 | Tester adversarial test | OUT OF SCOPE for implementor — tester writes per SPEC §5 | DEFERRED to tester |

---

## 4. Regression Test (mandatory per ORCH-0840)

- **Test path:** `supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts`
- **Passing run on fix:**
  ```
  running 5 tests from ./supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts
  ORCH-0925 HP-1 — Checkout Session conditionally sets customer_creation: 'always' for installment plans ... ok (0ms)
  ORCH-0925 HP-2 — piCreateBody conditionally attaches customer for installment plans ... ok (0ms)
  ORCH-0925 HP-3 — customer provisioning failure is FATAL for installment plans ... ok (2ms)
  ORCH-0925 HP-4 — customer provisioning block precedes paymentIntents.create ... ok (0ms)
  ORCH-0925 HP-5 — customer provisioning block does NOT appear twice (regression guard) ... ok (0ms)
  ok | 5 passed | 0 failed (13ms)
  ```
- **`fails-on-revert` verified at commit `0761a27c9dc0ae2172a607b5d8ca76623ba820a8`** (pre-fix `index.ts` state). With Changes 1-4 reverted via `git stash`, 4 of 5 tests FAIL:
  ```
  ORCH-0925 HP-1 — Checkout Session conditionally sets customer_creation: 'always' for installment plans ... FAIL
  ORCH-0925 HP-2 — piCreateBody conditionally attaches customer for installment plans ... FAIL
  ORCH-0925 HP-3 — customer provisioning failure is FATAL for installment plans ... FAIL
  ORCH-0925 HP-4 — customer provisioning block precedes paymentIntents.create ... FAIL
  FAILED | 1 passed | 4 failed
  ```
  HP-5 correctly stays green on revert because the pre-fix code also had only one `let customerId` declaration — HP-5 is the regression guard against a *future* botched re-application that leaves duplicates.
- **Restored fix** via `git stash pop`; all 5 tests pass again (confirmed above).

---

## 5. Static gate evidence

| Gate | Command | Result |
|---|---|---|
| Deno type check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts` | `Check supabase/functions/ticket-checkout-create/index.ts` (no errors) |
| Deno test (new) | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts` | 5 passed, 0 failed |
| Strict-grep self-test | `node .github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs --self-test` | `3 fixtures (positive=0, negative=2, allowlist=0) — PASS` |
| Strict-grep live | `node .github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs` | `scanned 190 files, 1 checkout.sessions.create callers, 2 paymentIntents.create callers, 0 violations` |

---

## 6. Spec traceability

Each of the 4 SPEC changes was applied verbatim per §2 of the SPEC:

- **SPEC §2 Change 1** → applied at `index.ts:540-557` (Edit 1 of this session)
- **SPEC §2 Change 2** → applied at `index.ts:469-472` (Edit 2)
- **SPEC §2 Change 3** → applied as Edit 3 (insert before line 638) + Edit 4 (delete old block at original lines 749-830). Verified post-edit: single `let customerId` declaration at line 646; new error-handling branches at lines 716-746; `let paymentIntent` at line 754; `paymentIntents.create` at line 818. Order is `customerId < paymentIntent.create` as required.
- **SPEC §2 Change 4** → applied at `index.ts:791` (Edit 5).

SPEC §5 happy-path test contract → satisfied with 5 assertions matching HP-1..HP-5 description.

SPEC §7 strict-grep gate → script at the spec'd path + workflow wire-up to `strict-grep-mingla-business.yml`; self-test asserts 0/2/0 violations across positive/negative/allowlist fixtures.

SPEC §9 implementation order → executed steps 1-13 in the locked sequence. Steps 14 (this report) and 15 (return) follow.

---

## 7. Invariant preservation

| Invariant | Preserved? | How |
|---|---|---|
| I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS (ORCH-0921) | YES | No edits to `ticket-checkout-confirm` or `reconcile-stuck-checkouts`; rolled-back 5-param shape unchanged. |
| I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST (ORCH-0849) | YES | `payment_method_types: [...getPaymentMethodTypes()]` literal preserved at original line; installment override via `getInstallmentPaymentMethodTypes()` unchanged. |
| ORCH-0843 direct-charge (`transfer_data:` forbidden; `stripeAccount` request-option mandatory) | YES | All Stripe calls in the relocated block pass `{ stripeAccount: stripeAccountId }`. `transfer_data:` does not appear anywhere in the file (verified by existing `orch-0843-direct-charge-shape.test.ts`). |
| ORCH-0844 paired-or-absent (`customerId` + `customerEphemeralKeySecret` both populated or both null) | YES | Full-pay catch sets both to null; installment FATAL path returns 502 before the response is built. Defensive empty-secret branch preserved. |
| ORCH-0804 Stripe Tax (`automatic_tax.enabled: true`; no `liability` block) | YES | `automatic_tax: { enabled: true }` literal unchanged at line 540; no `liability` introduced. |
| I-PROPOSED-ORCH-0925-INSTALLMENT-PLAN-ATTACHES-CUSTOMER (NEW) | ESTABLISHED | New strict-grep gate + Deno test; flips from `I-PROPOSED-*` to `I-*` at CLOSE per registry promotion rule. |

---

## 8. Cross-Surface Impact (SPEC §0 verification)

| Surface | Touched? | Status |
|---|---|---|
| Consumer iOS / Android (`app-mobile/`) | NO | Consumer app does not initiate ticket checkout. |
| Buyer/anonymous Web (`mingla-business/` `/checkout-trip/{tripEventId}`) | YES (R-1) | Behavior change: Stripe creates real Customer per installment-plan checkout. No web/UI code change. |
| Business iOS / Android (`mingla-business/` native PaymentSheet) | YES (R-2) | Behavior change: edge fn creates Customer BEFORE PI; response payload shape unchanged. No native code change. |
| Admin Web (`mingla-admin/`) | NO | No admin-side ticket-checkout creation. |
| Business Web preview | YES (R-1 parity automatic) | Shares same route + edge fn payload as production buyer-web. |

Parity is automatic across all in-scope surfaces (one edge function payload). No manual cross-surface drift risk.

---

## 9. Cache / state safety

| Layer | Impact | Action |
|---|---|---|
| React Query keys | None | No service or hook touched. |
| Zustand stores | None | No client-state mutation. |
| AsyncStorage persisted state | None | No mobile-side change. |
| DB / RLS | None | No migration. `ticket_checkout_sessions` table touched only via existing UPDATE statements (status-change to `failed` on FATAL path, same shape as existing failure handler). |
| Stripe Customer-side state | New behavior | Every installment-plan checkout now creates (or reuses) a Customer on the connected account. Existing `mingla_customer:<acct>:<sha256(email)>` idempotency key prevents duplicates. |

---

## 10. Regression surface (for tester to inspect)

1. Full-pay (non-installment) trip checkout via buyer-anonymous web (`/checkout-trip/{eventId}` with tier that has no installments) — must succeed identically to today; no `customer_creation` field; no `customer` on PI; SC-6.
2. Full-pay native business iOS PaymentSheet — must succeed identically; PaymentSheet still receives `customerId` + `customerEphemeralKeySecret` (or null/null in guest mode); SC-6.
3. Installment-plan checkout where buyer email already has a Customer on the connected account from a prior ORCH-0844 full-pay purchase — must REUSE the existing Customer (search-then-create logic unchanged); SC-5.
4. Full-pay native PaymentSheet when Stripe `customers.search` momentarily fails — must continue to guest mode (`customerId = null; customerEphemeralKeySecret = null`) with console.warn; SC-8.
5. Single-event checkout (non-trip event) — must succeed identically; no payment-plan logic engages because `isInstallmentPlan = false`.

---

## 11. Constitutional compliance scan

| Principle | Status |
|---|---|
| #1 No dead taps | N/A (no UI) |
| #2 One owner per truth | PRESERVED — Stripe Customer is the single source of truth for connected-account customer identity |
| #3 No silent failures | IMPROVED — installment customer provisioning failure now surfaces as HTTP 502 with structured error code instead of silently producing an orphaned PM |
| #4 One key per entity | N/A |
| #5 Server state server-side | PRESERVED |
| #6 Logout clears everything | N/A |
| #7 Label temporary | N/A (no `[TRANSITIONAL]` comments added) |
| #8 Subtract before adding | YES — Change 3 explicitly DELETES the old block before inserting the new one (no duplication; HP-5 enforces) |
| #9 No fabricated data | PRESERVED |
| #10 Currency-aware | PRESERVED — `currency` passed through unchanged |
| #11 One auth instance | N/A |
| #12 Validate at right time | N/A |
| #13 Exclusion consistency | PRESERVED |
| #14 Persisted-state startup | N/A |

---

## 12. Discoveries for Orchestrator

1. **DISC-0925-A — codify memory file** at `/Users/sethogieva/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_stripe_off_session_requires_customer.md` capturing the rule: `setup_future_usage: "off_session"` REQUIRES explicit Customer attachment. The orchestrator should create this memory + index it under MEMORY.md.
2. **DISC-0925-F follow-up — register ORCH-0927 [ORCH-0921 re-ship after ORCH-0925]** after ORCH-0925 CLOSE. Scope: revert the ORCH-0924 5-param rollback in `ticket-checkout-confirm` + `reconcile-stuck-checkouts`; re-deploy v34→v35 + v26→v27. Strict-grep allowlist comments `orch-strict-grep-allow finalize-no-plan-root` should be removed at the same time. Recommend dispatching this as a small, scoped ORCH because it's a pure revert + verify.
3. **DISC-0925-G — pre-existing customer block was non-fatal for installment plans**. The ORCH-0844 block (originally written 2026-05-15) treated failure as non-fatal across the board — for full-pay this was correct, for installment plans this masked the orphaned-PM bug. Adding the `isInstallmentPlan` branch retroactively fixes the contract violation. Pattern: any non-fatal Stripe call that materially affects a downstream charge path should be branched on the call's purpose.
4. **Pre-existing line 469-472 comment was rotted misinformation for ~12 days** (since ORCH-0869 Stage 1B shipped). Reinforces DISC-0925-B (comment-debt rule).
5. **No bundles found in §6 audit territory yet** — implementor did not run the §6 audit query (operator-gated post-deploy step). Orchestrator should run it after deploy + verify tester PASS; if rows exist, register ORCH-0926 [Orphaned-PM pre-ORCH-0925 backfill].

---

## 13. Deploy command (for orchestrator)

```bash
supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv
```

Expected version bump: v80 → v81. `verify_jwt` setting preserved from `supabase/config.toml` (currently `verify_jwt = false` for this function — webhook-style edge function). Verify via:

```bash
# After deploy
# Confirm version bump
```
(use `mcp__supabase__list_edge_functions`)

No migration. No `supabase db push` required.

`[deploy]` tag NOT required in commit subject (edge-function-only ORCH per `feedback_vercel_deploy_gate.md` — no Vercel-built surface touched).

---

## 14. Files touched (final list)

| Path | Type | Change |
|---|---|---|
| `supabase/functions/ticket-checkout-create/index.ts` | edit | 4 changes per SPEC §2 |
| `supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts` | new | Happy-path Deno test (5 assertions) |
| `.github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs` | new | Strict-grep gate (with `--self-test`) |
| `.github/workflows/strict-grep-mingla-business.yml` | edit | +1 registry comment line, +13 lines for new CI job |
| `Mingla_Artifacts/specs/SPEC_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md` | new (forensics-authored, this turn) | Binding SPEC contract |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md` | new (this file) | Implementation report |

No other files modified. No `Mingla_Artifacts/WORLD_MAP.md` / `MASTER_BUG_LIST.md` updates from implementor (orchestrator-owned at CLOSE).

---

## 15. Transition items

None. All changes are production-shaped; no `[TRANSITIONAL]` markers added.

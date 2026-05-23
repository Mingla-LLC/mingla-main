# QA — ORCH-0925 [`ticket-checkout-create` does not attach Stripe Customer to payment-plan PIs]

**Tester:** Claude `mingla-tester` (canonical TEST owner per `feedback_tester_canonical_and_platform_parity.md`)
**Date:** 2026-05-23
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Mode:** TARGETED (backend-only edge-function change; Phase 0.A live-fire sim gate EXEMPT per "edge-function-only" exemption — source-only reasoning sufficient for the sim gate)
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md`

---

## Verdict

**CONDITIONAL PASS** — all source-layer SCs and the regression-test gate PASS independently. Runtime SCs (SC-1, SC-2, SC-3, SC-4, SC-5) are deferred to the orchestrator's standing CLOSE pre-merge gate (SPEC §10) because Stripe-CLI live-fire requires the edge function deploy that the orchestrator owns. Operator-acceptance pattern: this is the standard back-end deploy split, NOT a UI/runtime sim-gate finding (Phase 0.A exemption applies).

**Severity counts:** P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2 (praise items)

**Regression-test gate (ORCH-0840):**
- ✅ Implementor happy-path: `supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts` — 5 passed; `fails-on-revert verified at commit 0761a27c9dc0ae2172a607b5d8ca76623ba820a8` (independently re-verified by tester via source-file swap; 4 of 5 tests FAIL on revert, HP-5 correctly stays green as the regression guard against duplicated declarations).
- ✅ Tester adversarial: `supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.adversarial.test.ts` — 5 passed; attacks 5 angles distinct from happy-path (scope correctness for Checkout Session A-1, scope correctness for PI A-2, ORCH-0844 non-fatal contract preservation A-3, FATAL early-return ordering + session closure A-4, Stripe DSL injection escape A-5).
- ✅ Both tests appear in `git status --short` as untracked → will land in the closing PR's `git diff origin/main...HEAD --name-only`. **NOTE:** if the orchestrator splits the close into multiple PRs, both test files MUST land in the SAME PR as the source fix (per ORCH-0840 §3, side-branch absorption via merge magic does not count).

**Sim evidence:** EXEMPT — backend-only / edge-function-only change. Phase 0.A live-fire sim gate does not apply (no UI, no native module, no deep link, no animation, no gesture, no keyboard input). Source-only reasoning + Deno test + Stripe DSL string-pattern probe are sufficient at this layer.

---

## SPEC §4 Success Criteria — independent verification

| ID | Criterion | Tester finding | Status |
|---|---|---|---|
| **SC-1** | Checkout Session payload sets `customer_creation: "always"` for installment plans | Source confirmed at `supabase/functions/ticket-checkout-create/index.ts:557` — `...(isInstallmentPlan ? { customer_creation: "always" as const } : {})`. Happy-path HP-1 + adversarial A-1 both PASS. Live Stripe-CLI verification deferred to post-deploy. | PASS (static); UNVERIFIED-RUNTIME pending deploy |
| **SC-2** | PI from Checkout Session has non-null `customer` | Driven by Stripe behavior given SC-1. No source-layer assertion possible. | UNVERIFIED-RUNTIME pending deploy |
| **SC-3** | Saved PM has `customer` equal to PI's `customer` | Driven by Stripe behavior given SC-1. | UNVERIFIED-RUNTIME pending deploy |
| **SC-4** | Native installment PI has non-null `customer` | Source confirmed at line 791 — `...(isInstallmentPlan && customerId !== null ? { customer: customerId } : {})`. Happy-path HP-2 + HP-4 + adversarial A-2 + A-4 all PASS. | PASS (static); UNVERIFIED-RUNTIME pending deploy |
| **SC-5** | Repeat installment checkouts reuse existing Customer | Source preserves existing ORCH-0844 `stripe.customers.search` (email-based) + `customers.create` with `mingla_customer:<acct>:<sha256(email)>` idempotency key (lines 654-679 of post-edit source). The reorder did not alter this logic. | PASS (preserved-by-reuse); UNVERIFIED-RUNTIME deferred |
| **SC-6** | Full-pay checkouts UNCHANGED | Adversarial A-1 explicitly asserts every `customer_creation:` reference is `isInstallmentPlan`-guarded (count match: 1 total = 1 guarded). Adversarial A-2 asserts `piCreateBody` contains exactly 1 `customer:` key and it is guarded. | PASS |
| **SC-7** | Installment customer provisioning failure returns 502 + session marked failed + PI NOT created | Source confirmed at lines 711-736 — FATAL guard `if (isInstallmentPlan && customerId === null)` returns `jsonResponse({error: "installment_customer_provisioning_failed", ...}, 502)` AND updates session row `status: "failed", failure_reason: "installment_customer_provisioning_failed"`. Adversarial A-4 asserts the error code index precedes `paymentIntents.create` index (no orphaned PI possible). | PASS |
| **SC-8** | Full-pay customer provisioning failure preserves ORCH-0844 guest-mode | Source confirmed at lines 737-745 — `if (!isInstallmentPlan && customerProvisioningError !== null)` logs `"customer+ephemeralKey creation failed; continuing in guest mode"` (verbatim from pre-fix). Adversarial A-3 asserts both the guard and the warning string. | PASS |
| **SC-9** | No regression in HTTP 200 rate / response time | Deno check clean. Existing tests (`orch-0843-direct-charge-shape.test.ts`, `orch_0911_success_url_branching.test.ts`, `payment_method_allowlist.test.ts`, etc.) not modified per ORCH-0840 append-only enforcement. Post-deploy log monitor by orchestrator. | PASS (static); post-deploy log monitor by orchestrator |
| **SC-10** | Strict-grep gate passes | Independently re-ran `node .github/scripts/strict-grep/i-proposed-orch-0925-installment-plan-attaches-customer.mjs --self-test` → `3 fixtures (positive=0, negative=2, allowlist=0) — PASS`. Live scan: `scanned 190 files, 1 checkout.sessions.create callers, 2 paymentIntents.create callers, 0 violations`. | PASS |
| **SC-11** | Happy-path test + fails-on-revert | Re-ran on fix: 5/5 PASS. Independently re-verified fails-on-revert by `git show 0761a27c...:supabase/functions/ticket-checkout-create/index.ts > /tmp/pre.ts && cp /tmp/pre.ts <path> && deno test ...` → HP-1, HP-2, HP-3, HP-4 FAILED, HP-5 stayed green (correct — it's the duplicate-decl guard). Restored fix; all 5 pass again. | PASS |
| **SC-12** | Tester adversarial test | Written at `supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.adversarial.test.ts` — 5 assertions (A-1..A-5), all distinct angles from happy-path. Ran against fix: 5/5 PASS (10ms). | PASS |

**Summary:** 12/12 SC at static layer. 5 SCs (SC-1, SC-2, SC-3, SC-4, SC-5) have a runtime-verification component that requires the edge function to be deployed first — deferred to orchestrator's standing CLOSE pre-merge gate (SPEC §10 lines: "Stripe CLI live-fire on Vercel preview confirms SC-1, SC-2, SC-3 (buyer-web R-1 path)" + edge function deploy bullet).

---

## Forensic source review (Step 3 of TARGETED protocol)

The implementor's 4 changes were re-read against SPEC §2 verbatim. Findings:

**Change 1 (Checkout Session payload, lines 540-557):**
- The new conditional `...(isInstallmentPlan ? { customer_creation: "always" as const } : {})` sits one line above `customer_email: buyerEmail`, matching SPEC §2 verbatim placement. ✅
- The 16-line ORCH-0925 comment block replaces the 6-line stale ORCH-0811 comment block. Content matches SPEC §2 verbatim. ✅
- `automatic_tax: { enabled: true }` literal preserved at line 541 (ORCH-0804 invariant). ✅
- All other fields (currency, line_items, payment_intent_data, success_url, cancel_url, metadata, idempotencyKey, stripeAccount) preserved verbatim. ✅

**Change 2 (comment correction, lines 469-472):**
- Replaced "created from customer_email" with "created when customer_creation: \"always\" is set for installment plans, per ORCH-0925". Matches SPEC §2 verbatim. ✅

**Change 3 (relocate + branch customer block, lines 633-745 in post-edit source):**
- Block correctly relocated to BEFORE `let paymentIntent: {` (line 754) — HP-4 line-index assertion confirms ordering. ✅
- Old location at original lines 749-830 fully deleted — HP-5 confirms single `let customerId` declaration. ✅
- Uses `const stripeForCustomer = stripeTicketCheckout()` local instance (instead of the outer `stripe` which is not yet declared at this point in the code flow). ✅
- FATAL guard at lines 711-736 updates session row + returns 502 — A-4 confirms ordering before `paymentIntents.create`. ✅
- Full-pay non-fatal branch at lines 737-745 preserves verbatim "continuing in guest mode" warning — A-3 confirms. ✅
- `customers.search` query single-quote escape preserved at line 656 (`buyerEmail.replace(/'/g, "\\'")`) — A-5 confirms. ✅
- `customers.create` idempotency-key shape preserved (`mingla_customer:${stripeAccountId}:${await sha256Hex(buyerEmail)}`) — SC-5 idempotency guarantee intact. ✅

**Change 4 (`piCreateBody`, line 791):**
- `...(isInstallmentPlan && customerId !== null ? { customer: customerId } : {})` correctly placed one line below the existing `setup_future_usage` spread. ✅
- The `customerId !== null` guard is belt-and-suspenders (Change 3's early return at 502 means this code path can only execute when `customerId !== null` OR `!isInstallmentPlan`). ✅

---

## Constitutional compliance scan (14 rules)

| # | Principle | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | Backend-only |
| 2 | One owner per truth | PASS | Stripe Customer is the single source of truth for connected-account customer identity |
| 3 | No silent failures | IMPROVED | The FATAL path now surfaces `installment_customer_provisioning_failed` as HTTP 502 instead of the pre-fix silent orphaned-PM outcome. Full-pay non-fatal path explicitly logs via `console.warn`. |
| 4 | One key per entity | N/A | No new query keys |
| 5 | Server state server-side | PASS | No client-state mutation |
| 6 | Logout clears everything | N/A | No session-bound persisted state added |
| 7 | Label temporary | PASS | No `[TRANSITIONAL]` markers introduced |
| 8 | Subtract before adding | PASS | Change 3 explicitly deletes the old block at original lines 749-830 before inserting the new branched block — HP-5 enforces single-declaration; old comment block at lines 541-546 fully replaced |
| 9 | No fabricated data | PASS | No fabricated Customer/PM IDs; Stripe creates real entities |
| 10 | Currency-aware | PASS | `currency` passed through unchanged |
| 11 | One auth instance | PASS | `stripeTicketCheckout()` is the single shared Stripe SDK factory used by both call sites |
| 12 | Validate at right time | PASS | `buyerEmail` validation at line 99 preserves precondition for customer block |
| 13 | Exclusion consistency | PASS | The fix is symmetric across both call paths (Checkout Session R-1 + native PI R-2) |
| 14 | Persisted-state startup | N/A | Edge function, no AsyncStorage |

Zero constitutional violations. No automatic P0 triggers.

---

## Cross-domain impact verification

| Downstream | Impact | Verification |
|---|---|---|
| `mingla-business` buyer-web `/checkout-trip/{tripEventId}` | Behavior change at Stripe: real Customer created per installment-plan checkout. No JS/TSX code change required in mingla-business. | Source confirmed; live-fire deferred. |
| `mingla-business` native iOS/Android PaymentSheet (deep-link return path) | Receives same response payload shape (`customerId` + `customerEphemeralKeySecret` + `clientSecret` + `paymentIntentId` + `publishableKey` + `stripeAccountId`) — no client-side change needed. | Response payload shape at lines 821-840 (post-edit) unchanged. ✅ |
| `process-scheduled-installments` cron | Now has real `customer + payment_method` to charge against for all post-ORCH-0925 installment-plan orders. | Will be validated by the first scheduled installment after deploy + a new test booking. |
| `ticket-checkout-confirm` (currently rolled-back per ORCH-0924) | Will receive correct `paymentIntent.customer` (non-null) for installment-plan PIs once deployed. ORCH-0921 re-ship (queued as ORCH-0927) becomes safe. | Out-of-scope for ORCH-0925 verification. |
| Existing tests `orch-0843-direct-charge-shape.test.ts`, `payment_method_allowlist.test.ts`, `orch_0911_success_url_branching.test.ts` | Source patterns these tests assert on are preserved verbatim. Append-only enforcement means we did not modify these. | Verified: no test files in `git diff --name-only` outside the new `orch-0925-*` paths. |

---

## P4 — Notes / praise

- **P4-1 (good pattern):** Implementor's choice to REORDER the existing ORCH-0844 customer block (rather than invent a new helper) reuses 30 days of battle-tested code (idempotency-key shape, single-quote escape, paired-or-absent invariant, EphemeralKey provisioning) with one focused branching change. Minimal blast radius; preserves I-PROPOSED-STRIPE-CONNECTED-CUSTOMER-IDEMPOTENT-LOOKUP-OR-CREATE pattern. Worth replicating when ORCH-0927 [ORCH-0921 re-ship] lands.
- **P4-2 (good pattern):** The strict-grep gate's allowlist tag `orch-strict-grep-allow orch-0925-installment-customer-attached` follows the established `orch-strict-grep-allow <tag>` convention precisely. Self-test fixtures (positive=0, negative=2, allowlist=0) are well-balanced.

---

## Conditions for orchestrator at CLOSE (SPEC §10 pre-merge gate)

The orchestrator MUST verify these post-deploy items before merge:

1. **Deploy the edge function** — `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv` (will bump v81 → v82; implementor's report predicted v80→v81 but the live state is v81, so the actual bump is v81→v82 — non-blocking documentation drift).
2. **Confirm version bump** via `mcp__supabase__list_edge_functions` (current `version: 81` should become `version: 82`).
3. **Stripe CLI live-fire on Vercel preview** for SC-1, SC-2, SC-3, SC-5:
   - Initiate an installment-plan checkout via `/checkout-trip/{tripEventId}`
   - `stripe checkout sessions retrieve cs_test_... --stripe-account=acct_1TY6UFPjlZjiLhFt | jq '.customer_creation, .customer'` — expect `"always"` and non-null `cus_xxx`
   - `stripe payment_intents retrieve pi_... --stripe-account=acct_1TY6UFPjlZjiLhFt | jq '.customer, .payment_method'` — expect both non-null
   - `stripe payment_methods retrieve pm_... --stripe-account=acct_1TY6UFPjlZjiLhFt | jq '.customer'` — expect match
   - Repeat with same buyer email; `stripe customers list --email=<email> --stripe-account=acct_1TY6UFPjlZjiLhFt --limit=5` expects 1 row
4. **Log monitor for SC-9** — `mcp__supabase__get_logs --service edge-function` for the post-deploy hour; flag any new `installment_customer_provisioning_failed` 502s outside deliberate failure tests.
5. **Optional:** native business iOS PaymentSheet smoke for SC-4. If sim unavailable, mark `unverified-runtime` with "covered by HP-2 + HP-4 + A-2 + A-4 source assertions + strict-grep gate".
6. **Run SPEC §6 backfill audit query** post-deploy. If rows exist, register follow-up ORCH-0926 [Orphaned-PM pre-ORCH-0925 backfill]. Operator decides per-row backfill-vs-refund.
7. **Queue ORCH-0927 [ORCH-0921 re-ship after ORCH-0925]** per implementor's DISC-0925-F. Scope: revert the ORCH-0924 rollback in `ticket-checkout-confirm` + `reconcile-stuck-checkouts`; remove the `orch-strict-grep-allow finalize-no-plan-root` opt-out comments at the same time.

---

## Discoveries for Orchestrator

1. **DISC-QA-0925-A** (P4 — version-prediction drift): Implementor's report §13 predicted "v80 → v81" but live state is already v81 (deploy will be v81 → v82). Not a functional issue; minor documentation drift in the implementor report. Recommend orchestrator update WORLD_MAP / banners with the actual post-deploy version.
2. **DISC-QA-0925-B** (P4 — observation): The deployed v81 source contains zero matches for `customer_creation`, `installment_customer_provisioning_failed`, or `ORCH-0925`. Confirms the fix is local-only and not yet deployed. Standard expected state for IMPLEMENT → TEST handoff before orchestrator runs deploy.
3. **DISC-QA-0925-C** (P4 — for future SPEC writers): SPEC §4 SC-1..SC-5 explicitly require post-deploy Stripe-CLI live-fire. This split (source-layer at TEST, runtime at orchestrator CLOSE) is correctly modeled in SPEC §10 pre-merge gate. Pattern worth preserving: any SPEC that touches a Stripe API call should explicitly list runtime CLI probes in the pre-merge gate section so the verification ownership is unambiguous.
4. **DISC-QA-0925-D** (P4 — process improvement): The append-only CI gate at `.github/workflows/tests-append-only.yml` and ORCH-0840 [Regression-test enforcement + append-only CI] together ensured the implementor did not touch existing test files (`orch-0843-direct-charge-shape.test.ts`, `payment_method_allowlist.test.ts`, etc.) — verified via `git status --short` showing only `??` (untracked) entries for the new `orch-0925-*` paths. ORCH-0840 working as designed.

---

## Closing posture

This CONDITIONAL PASS is unblocking for orchestrator CLOSE if and only if:
- Seth explicitly accepts the post-deploy live-fire deferral pattern (this is the standard backend deploy split; documented in `feedback_orchestrator_deploys_edge_functions.md`)
- Orchestrator executes the 7 pre-merge gate items in §"Conditions for orchestrator at CLOSE" above
- Both regression-test files (happy + adversarial) ship in the same PR as the source fix (per ORCH-0840 §3)

If Seth would rather upgrade to PASS in a single shot, the path is:
1. Seth commits the working-tree changes
2. Orchestrator deploys the edge function (will bump v81 → v82)
3. Seth runs the 4 Stripe-CLI probes against a Vercel-preview test payment
4. Tester re-runs this verification with the runtime evidence appended

Either path is supported.

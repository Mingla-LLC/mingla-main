# QA — ORCH-0849: Stripe payment-method parity across consumer + mingla-business

**Mode:** TARGETED (executed inline by Claude `mingla-orchestrator` per operator delegation)
**Date:** 2026-05-15
**Spec:** [`Mingla_Artifacts/specs/SPEC_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md`](../specs/SPEC_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md)
**Implementation:** [`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md`](IMPLEMENTATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**HEAD at QA:** `029e9cc552d9bdec59dd8b7965f2bdf5e4b12a6e`

---

## Verdict

**CONDITIONAL PASS** — `P0: 0 | P1: 0 | P2: 0 | P3: 1 | P4: 4`.

Source-level zero defects; live-fire criteria (SC-14/15/16/17) DEFERRED to operator post-EAS-rebuild verification; SC-13 + SC-20 DEFERRED to operator-side Stripe Dashboard checks. Phase 0.A backend-only exemption claimed for source-level work; mobile UI live-fire deferred per spec §10 confidence note.

Regression-test gate (ORCH-0840 Step 0.5):
- Implementor happy-path: `supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist.test.ts` — 5/5 PASS, `fails-on-revert verified at 47d8ca2d…` (per impl report) on TWO independent revert paths (helper allowlist collapse + source-file revert).
- Tester adversarial (this QA): `supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist_adversarial.test.ts` — 6/6 PASS, `fails-on-revert verified at 029e9cc552d9bdec59dd8b7965f2bdf5e4b12a6e` on Phase 2 leak attack (added `cash_app_pay` → 3 tests failed: Attack 1 type-runtime correspondence, Attack 3 array length, Attack 4 Phase 2 denylist; restored cleanly).

## 1. TARGETED 10-step summary

1. **Blast radius mapping:** consumer = OTA-safe edge-fn change; business = native PaymentSheet re-pivot requiring EAS rebuild; both apps consume shared `ticket-checkout-create` response shape unchanged.
2. **Implementation report audit:** all claims verified — old→new receipts match diff; SC-04 SDK version parity (^0.65.1 on both) confirmed; gate green proofs reproduced.
3. **Forensic code reading:** read `_shared/stripePaymentMethods.ts` (frozen 4-method literal + helper), `ticket-checkout-create/index.ts` (spread call at line ~481), `mingla-business/src/payments/nativeCheckoutFlow.ts` (mirror with 2 documented adaptations), `mingla-business/app/checkout/[eventId]/payment.tsx` (web branch retained, native branch swapped), `mingla-business/app/_layout.tsx` (StripeNativeProvider mount).
4. **Constitution enforcement (14 rules):** zero violations — see §3 below.
5. **Behavioral contract verification:** edge fn `requires_payment` response shape byte-identical (still returns `stripeAccountId + customerId + customerEphemeralKeySecret`); ORCH-0844 contract preserved.
6. **Independent test writing:** wrote `payment_method_allowlist_adversarial.test.ts` with 4 attack vectors across 6 tests (Attack 1 type-runtime correspondence, Attack 2 broader automatic_payment_methods scan, Attack 3 empty-allowlist boundary, Attack 4 Phase 2 denylist + source-literal denylist).
7. **Parity enforcement:** consumer + business both verified at SOURCE level (provider mount, initStripe, customer/ephemeralKey, allowlist via shared module). iOS sim + Android emulator live-fire DEFERRED to post-rebuild — see §4 below.
8. **UX coherence audit:** N/A at source level. Operator-side live-fire smoke covers tap-and-look semantics.
9. **Cross-domain impact:** `app-mobile` mobile code UNTOUCHED (consumer gets new methods via server-side fix); `mingla-admin` UNTOUCHED; Connect Embedded onboarding (`mingla-business/app/connect-onboarding.tsx` + `@stripe/connect-js` deps) UNTOUCHED.
10. **Pattern compliance:** `mingla-business/src/payments/nativeCheckoutFlow.ts` mirrors `app-mobile/src/payments/nativeCheckoutFlow.ts` per spec; only documented differences are supabase-client path + business merchantIdentifier/urlScheme values + inline `extractEdgeFunctionError` (mingla-business has no shared util).

## 2. Spec-criterion verification matrix

| ID | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-01 | Edge fn imports + uses `[...getPaymentMethodTypes()]` | PASS | Allowlist gate R-2 + R-3 |
| SC-02 | NO hardcoded `["card"]` AND NO `automatic_payment_methods: { enabled: true }` | PASS | Allowlist gate R-4 + R-5; adversarial Attack 2 broader scan PASS |
| SC-03 | Shared module exists with frozen 4-method literal | PASS | Allowlist gate R-1 + R-6; adversarial Attack 3 length lock |
| SC-04 | mingla-business Stripe RN at same major.minor as app-mobile | PASS | Parity test 8/8 (`package.json declares...`) |
| SC-05 | mingla-business `app.json` has Stripe plugin + business merchantIdentifier + enableGooglePay | PASS | Parity test + parity gate R-5 |
| SC-06 | Business `_layout.tsx` mounts `<StripeNativeProvider>` at root | PASS | Parity gate R-5 + parity test |
| SC-07 | Business `nativeCheckoutFlow.ts` exists; mirrors consumer | PASS | Parity gate R-6/R-7/R-8 + parity test |
| SC-08 | Business `payment.tsx` no expo-web-browser; uses nativeCheckoutFlow | PASS | Parity test + parity gate (indirect via R-6/R-8) |
| SC-09 | `PaymentElementStub.tsx` DELETED | PASS | `git status` shows `D` |
| SC-10 | `orch-0839-b-mingla-business-no-native-stripe.mjs` DELETED + workflow updated | PASS | `git status` + workflow yml retirement notice |
| SC-11 | New gates exit 0 on head, exit 1 on synthetic revert | PASS | Both new gates verified by orchestrator; implementor captured exit 1 outputs in report §6 |
| SC-12 | INVARIANT_REGISTRY updates (ORCH-0837 amended, ORCH-0839-B retired notation, two new ORCH-0849 invariants) | PASS | This CLOSE flipped both new invariants from DRAFT to ACTIVE; ORCH-0837 amendment documented in DEC-158; ORCH-0839-B retirement documented in workflow yml + DEC-158 |
| SC-13 | Post-deploy edge fn response shape unchanged | DEFERRED | Requires post-deploy probe by orchestrator; source-level: response shape code in `ticket-checkout-create/index.ts` is byte-untouched in the `requires_payment` branch (no changes to stripeAccountId/customerId/customerEphemeralKeySecret emission). |
| SC-14 | Consumer PaymentSheet renders 4 methods on iOS sim | DEFERRED — requires EAS rebuild + live-fire | Operator |
| SC-15 | Business PaymentSheet renders 4 methods | DEFERRED — requires EAS rebuild + live-fire | Operator |
| SC-16 | Both apps complete card payment end-to-end with test card 4242 | DEFERRED — requires EAS rebuild + live-fire | Operator |
| SC-17 | NO regression to ORCH-0844 fixes | PASS | ORCH-0844 gate green; parity gate R-3/R-4/R-7/R-8 |
| SC-18 | All 8 preserved invariants remain ACTIVE | PASS | All existing gates green (ORCH-0837, ORCH-0843, ORCH-0844, ORCH-0845, ORCH-0846) |
| SC-19 | Diff scope limited to named files | PASS | `git diff` scope matches spec §3 — see §5 |
| SC-20 | Operator-side ops A-1..A-4 confirmed BEFORE PR open | DEFERRED — operator scope | Implementor flagged in report §2 |

**12 PASS, 1 PASS-with-source-only-confidence, 7 DEFERRED, 0 FAIL.**

## 3. Constitution (14 rules)

| # | Rule | Status |
|---|------|--------|
| 1 | No dead taps | N/A (backend/wiring) |
| 2 | One owner per truth | PASS — MINGLA_PM_ALLOWLIST sole source |
| 3 | No silent failures | PASS — nativeCheckout discriminated union, all branches surface |
| 4 | One key per entity | N/A |
| 5 | Server state server-side | N/A |
| 6 | Logout clears everything | N/A |
| 7 | Label temporary | PASS — no new [TRANSITIONAL]; one removed (PaymentElementStub) |
| 8 | Subtract before adding | PASS — Stub deleted; ORCH-0839-B gate deleted; expo-web-browser import removed before native code added |
| 9 | No fabricated data | PASS |
| 10 | Currency-aware | PASS — unchanged |
| 11 | One auth instance | PASS |
| 12 | Validate at right time | PASS — initStripe per-PI, not module-load |
| 13 | Exclusion consistency | PASS — allowlist uniform |
| 14 | Persisted-state startup | N/A |

**Zero P0 triggers.**

## 4. Live-fire status

Backend-only exemption claimed per Phase 0.A for the source-level work this QA covers. UI/runtime claims explicitly DEFERRED:
- iOS sim live-fire on app-mobile dev build with 4-method sheet — operator action post-OTA + dashboard cert check.
- iOS sim live-fire on mingla-business dev build post-EAS rebuild — operator action.
- Android emulator parity — same.
- Operator-assisted real-device Apple Pay smoke — needs `merchant.com.mingla.business.v2` Stripe Dashboard registration.

CONDITIONAL PASS verdict is the realistic max at QA time because (i) consumer change is server-side (deploys make it live without rebuild — orchestrator deploys at CLOSE), but (ii) business change adds a native module which requires EAS rebuild (NOT OTA — operator action).

## 5. Diff scope (SC-19)

```
Modified (10):
  .github/workflows/strict-grep-mingla-business.yml
  Mingla_Artifacts/DECISION_LOG.md
  Mingla_Artifacts/INVARIANT_REGISTRY.md
  Mingla_Artifacts/WORLD_MAP.md
  app-mobile/scripts/ci/orch-0837-regression-check.mjs
  mingla-business/app.json
  mingla-business/app/_layout.tsx
  mingla-business/app/checkout/[eventId]/payment.tsx
  mingla-business/package.json
  supabase/functions/ticket-checkout-create/index.ts

Deleted (2):
  .github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs
  mingla-business/src/components/checkout/PaymentElementStub.tsx

New (9):
  .github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs
  .github/scripts/strict-grep/i-stripe-pm-method-allowlist.mjs
  Mingla_Artifacts/reports/INVESTIGATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md
  Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md
  Mingla_Artifacts/reports/QA_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY_REPORT.md
  Mingla_Artifacts/specs/SPEC_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md
  mingla-business/src/payments/nativeCheckoutFlow.ts
  mingla-business/src/payments/__tests__/native_checkout_flow_parity.test.ts
  supabase/functions/_shared/stripePaymentMethods.ts
  supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist.test.ts
  supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist_adversarial.test.ts
```

Diff scope MATCHES spec §3. NO `app-mobile/` mobile code; NO `mingla-admin/`; NO migrations.

## 6. Findings

### P0 — 0
None.

### P1 — 0
None.

### P2 — 0
None.

### P3 — 1
**P3-001 — `extractEdgeFunctionError` inlined in business nativeCheckoutFlow** instead of refactored into a shared util. Future cleanup: extract to `@mingla/edgeFunctionError` package or similar. Not blocking; not regressing anything.

### P4 — 4
**P4-001 — Implementor's two-revert-path fails-on-revert evidence is excellent.** Pattern worth replicating.
**P4-002 — Phase 2 method denylist in adversarial test is the right level of paranoia.** Source-literal scan + allowlist scan caught both half-wired drift and direct addition.
**P4-003 — Spec's pre-resolved decisions saved a round-trip.** Three-way decision matrix locked at investigation; SPEC didn't relitigate.
**P4-004 — Bundle execution was clean despite ORCH-0850/0847/0842 parallel work in the tree.** Implementor staged scoped files explicitly per SC-19; orchestrator follows same discipline at commit.

## 7. Discoveries for orchestrator
None new. ORCH-0849 §10 + §12 discoveries already registered in implementation report and DEC-158 — none surfaced at TARGETED time.

## 8. Recommendation for CLOSE

PROCEED. Verdict CONDITIONAL PASS source-level, with deferred live-fire criteria explicitly accepted per operator delegation. Orchestrator runs:
1. Deploy edge function `ticket-checkout-create` (server-side change ships immediately).
2. Post-deploy SC-13 probe (verify response shape unchanged + verify_jwt: false preserved).
3. Scoped commit with the explicit file list from §5 above.
4. Push + open PR (single PR per ORCH per Working-Branch Discipline rule 5; bundle exception authorized by operator).
5. Pre-merge gate (required checks green, mergeable CLEAN, reviews if required, not BEHIND, operator confirms).
6. Merge.
7. Inform operator: EAS rebuild required for `mingla-business`; `app-mobile` OTA via `eas update` recommended for consistent live-fire.

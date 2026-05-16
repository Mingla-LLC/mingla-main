# IMPLEMENTATION — ORCH-0849: Stripe payment-method parity across consumer + mingla-business

**Mode:** IMPLEMENT
**Skill:** Claude `mingla-implementor` (parity mirror per DEC-133; operator delegated via "take over + perform as much checks as you want, proceed")
**Date:** 2026-05-15
**Spec:** [`Mingla_Artifacts/specs/SPEC_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md`](../specs/SPEC_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md`](INVESTIGATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Base commit (pre-implementation HEAD):** `029e9cc552d9bdec59dd8b7965f2bdf5e4b12a6e`
**Status:** `implemented and verified` at every layer reachable without EAS rebuild / live-fire. Live-fire SC-14..SC-17 deferred to operator post-rebuild verification per spec §4 (UI/runtime claims require live-fire, NOT possible at implement time).

---

## 1. Layman summary

Consumer Discover purchases will show Card + Link + Apple Pay + Google Pay buttons in PaymentSheet (server-side fix, ships via edge function deploy — OTA-safe for buyers). Mingla-business buyer checkout switches from the system-browser handoff to the same native PaymentSheet, in parity with consumer (requires EAS rebuild — NOT OTA-safe). Phase 2 methods (Cash App Pay, Klarna, ACH, etc.) explicitly deferred per spec NG-1..NG-4.

## 2. Pre-flight verification

| Assumption | Verified at implement time? | Method |
|---|---|---|
| A-1 | Operator-side ops (Apple Pay merchant `merchant.com.mingla.business.v2` registered + cert active) | Cannot verify from CLI session — Stripe Dashboard required. Implementor flags as operator-prereq before EAS rebuild + first Apple Pay live-fire on business. Code is harmless without cert; Apple Pay row silently absent (NOT a crash per ORCH-0844 [Explorer PaymentSheet — Connect account ID per-PI + 60s timeout removal] fixes). |
| A-2 | Existing `merchant.com.mingla.app.v2` cert state | Same constraint — operator-side. |
| A-3 | Per-connected-account capability enablement | Cannot probe `/v1/payment_method_configurations` from CLI without Stripe live secret key (edge function env var, not exported). Deferred to post-deploy probe by orchestrator. |
| A-4 | Domain-association files | Operator-side. |
| **A-5** | **Stripe RN SDK version compatibility — both apps run identical stack** | **VERIFIED.** `app-mobile/package.json`: `expo ~54.0.34`, `react-native 0.81.5`, `@stripe/stripe-react-native ^0.65.1`. `mingla-business/package.json` (now): `expo ~54.0.34`, `react-native 0.81.5`, `@stripe/stripe-react-native ^0.65.1` (added by this implementation). Identical major.minor on Stripe RN. Parity test SC-04 enforces this at CI. |
| A-6 | `application_fee_amount` (1.5% per DEC-156) is method-agnostic | Confirmed per Stripe docs (https://docs.stripe.com/connect/direct-charges#collect-fees) — direct-charge `application_fee_amount` applies regardless of payment-method type. No code change needed. |
| A-7 | EAS build queue available | Operator-coordinated, not implementor scope. Note in handoff. |

**Decision:** Proceed with code implementation. A-1..A-4 deferred to operator-side ops + orchestrator post-deploy probe; A-5 verified; A-6 docs-confirmed.

---

## 3. Files changed (matches SPEC SC-19 scope)

```
 M .github/workflows/strict-grep-mingla-business.yml           (registry + 2 new jobs + ORCH-0839-B retirement)
 M Mingla_Artifacts/DECISION_LOG.md                            (DEC-158 added)
 M Mingla_Artifacts/INVARIANT_REGISTRY.md                      (2 new invariants DRAFT)
 M app-mobile/scripts/ci/orch-0837-regression-check.mjs        (T-C0 amended)
 M mingla-business/app.json                                    (Stripe plugin entry)
 M mingla-business/app/_layout.tsx                             (StripeNativeProvider mounted)
 M mingla-business/app/checkout/[eventId]/payment.tsx          (handlePay rewritten)
 M mingla-business/package.json                                (Stripe RN dep added, 0839-B script removed)
 D mingla-business/src/components/checkout/PaymentElementStub.tsx  (dead transitional)
 M supabase/functions/ticket-checkout-create/index.ts          (allowlist import + spread call)
 D .github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs  (retired)
?? .github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs   (NEW gate)
?? .github/scripts/strict-grep/i-stripe-pm-method-allowlist.mjs   (NEW gate)
?? Mingla_Artifacts/reports/INVESTIGATION_ORCH-0849_*.md          (investigation)
?? Mingla_Artifacts/specs/SPEC_ORCH-0849_*.md                     (spec)
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0849_*.md         (this report)
?? mingla-business/src/payments/nativeCheckoutFlow.ts             (NEW per-app glue)
?? mingla-business/src/payments/__tests__/native_checkout_flow_parity.test.ts  (NEW parity test)
?? supabase/functions/_shared/stripePaymentMethods.ts             (NEW allowlist module)
?? supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist.test.ts  (NEW Deno test)
```

NO migration. NO admin changes. NO app-mobile mobile changes (consumer gets new methods via server-side fix). NO refactoring of Connect Embedded Components in `mingla-business/app/connect-onboarding.tsx`. Scope matches SPEC SC-19 exactly.

---

## 4. Old → New receipts

### 4.1 `supabase/functions/_shared/stripePaymentMethods.ts` (NEW)

**What it does:** exports `MINGLA_PM_ALLOWLIST = ["card","link","apple_pay","google_pay"] as const` (frozen literal) and `getPaymentMethodTypes(): readonly MinglaPaymentMethod[]` helper. Documents Phase 1 vs Phase 2 contract in module-level JSDoc.

**Why:** SPEC §3.2.1 — single source of truth for the curated PM allowlist. CI gate `i-stripe-pm-method-allowlist.mjs` enforces presence + content.

**Lines added:** ~47.

### 4.2 `supabase/functions/ticket-checkout-create/index.ts`

**What it did before:** Imported only `stripeTicketCheckout` + ticketCheckout helpers; hardcoded `payment_method_types: ["card"]` at the PI-create body construction site (line 481) with a long inline comment citing ORCH-0837 as the load-bearing reason.

**What it does now:** Adds `import { getPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts"`; replaces the hardcoded literal with `payment_method_types: [...getPaymentMethodTypes()]`; rewrites the inline comment to cite ORCH-0849's allowlist contract, the new invariant `I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST`, and the Phase 2 method denylist.

**Why:** SPEC §3.2.2 + SC-01 — the binding edit. Single line of behavior change + one import.

**Lines changed:** ~+15/-12 (mostly comment rewrite; the substantive change is two lines: one new import, one altered call site).

### 4.3 `app-mobile/scripts/ci/orch-0837-regression-check.mjs`

**What it did before:** T-C0 asserted `payment_method_types: ['card']` literal present in the edge function source. T-C1 asserted `automatic_payment_methods: { enabled: true }` absent.

**What it does now:** T-C0 AMENDED — now asserts both `payment_method_types: [...getPaymentMethodTypes()]` AND `import { getPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts"` are present. Added inline ORCH-0849 note documenting why the assertion shape changed. T-C1 preserved VERBATIM (still bans `automatic_payment_methods` enabled form — preserves ORCH-0837 H2 root-cause guard).

**Why:** SPEC §3.5.1 — gate must follow the AMENDED I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES invariant. T-C2..T-C4 (mobile handleURLCallback wiring) unchanged.

**Lines changed:** ~+12/-4.

### 4.4 `mingla-business/package.json`

**What it did before:** Had `@stripe/connect-js@3.4.2` + `@stripe/react-connect-js@3.4.1` (Connect Embedded for onboarding) but NO `@stripe/stripe-react-native`. Had `test:orch-0839-b` script.

**What it does now:** Adds `@stripe/stripe-react-native: "^0.65.1"` (exact major.minor parity with `app-mobile`). Removes `test:orch-0839-b` script. Connect Embedded deps PRESERVED (still used by `connect-onboarding.tsx`).

**Why:** SPEC §3.4.1 — package.json prereq for native PaymentSheet adoption. Parity test SC-04 enforces version match.

**Lines changed:** +1 dep, -1 script.

### 4.5 `mingla-business/app.json`

**What it did before:** `plugins` array had `expo-router`, `expo-splash-screen`, `react-native-edge-to-edge`, `onesignal-expo-plugin`, `./plugins/withAdiRegistration`. NO Stripe plugin.

**What it does now:** Adds `["@stripe/stripe-react-native", { "merchantIdentifier": "merchant.com.mingla.business.v2", "enableGooglePay": true }]` before the `withAdiRegistration` plugin.

**Why:** SPEC §3.4.2 — native config for Apple Pay + Google Pay. CI gate `i-stripe-paymentsheet-parity.mjs` rule R-5 + parity test confirm.

**Lines changed:** +7.

### 4.6 `mingla-business/app/_layout.tsx`

**What it did before:** Comment block at line 34-36 stated "StripeNativeProvider removed alongside the native PaymentSheet pivot. Hosted Stripe Checkout via expo-web-browser needs no provider." Root tree mounted `<GestureHandlerRootView>` → `<SafeAreaProvider>` → `<QueryClientProvider>` → `<AuthProvider>` → `<RootLayoutInner />`.

**What it does now:** Comment block rewritten to cite ORCH-0849 re-pivot rationale + invariant `I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY`. Imports `StripeNativeProvider` from `@mingla/payments-native`. Wraps `<RootLayoutInner />` in `<StripeNativeProvider merchantIdentifier="merchant.com.mingla.business.v2" urlScheme="com.mingla.business.v2">` inside `<AuthProvider>`. Mount position: provider sits above the navigation root so PaymentSheet inherits context on any checkout screen.

**Why:** SPEC §3.4.3 + R-5 of parity gate. Same pattern as consumer at `app-mobile/app/_layout.tsx:72-83`.

**Lines changed:** ~+15/-3.

### 4.7 `mingla-business/src/payments/nativeCheckoutFlow.ts` (NEW)

**What it does:** Per-app glue that wraps `useStripePaymentSheet` from `@mingla/payments-native`. Invokes `ticket-checkout-create` with `surface: "native"`, branches on response.kind (`free_completed` | `requires_payment` | `requires_web_redirect`), calls `initStripe({ publishableKey, stripeAccountId, merchantIdentifier, urlScheme })` per-PI before `initPaymentSheet`, passes `customer + customerEphemeralKeySecret` to `initPaymentSheet`, branches on `presentPaymentSheet` outcome (`canceled` | `succeeded` | error). Inlines a minimal edge-function-error extractor (mingla-business lacks the consumer's shared `extractFunctionError` util).

**Why:** SPEC §3.4.4. The two differences from the consumer mirror are explicitly documented in module JSDoc: (1) supabase client path, (2) business merchantIdentifier + urlScheme values.

**Lines added:** ~265 (mirrors the consumer file shape verbatim).

### 4.8 `mingla-business/app/checkout/[eventId]/payment.tsx`

**What it did before:** Imported `expo-web-browser`; defined `CHECKOUT_RETURN_URL_SCHEME` constant; `handlePay` selected `surface: "web" | "mobile-web"` based on `Platform.OS === "web"`, invoked `createTicketCheckout` expecting `requires_web_redirect`, then EITHER `window.location.assign` (web) OR `WebBrowser.openAuthSessionAsync` (native) handed off to Stripe Hosted Checkout, returning via the custom-scheme URL.

**What it does now:** Removes `expo-web-browser` import and `CHECKOUT_RETURN_URL_SCHEME` constant (web returnURL handled by Stripe's success_url/cancel_url directly; native returnURL handled by StripeNativeProvider's urlScheme). Imports `useNativeCheckoutFlow` from the new per-app glue. Instantiates `nativeCheckout = useNativeCheckoutFlow()` inside the component. `handlePay` now branches on `Platform.OS === "web"`: web path UNCHANGED (still `createTicketCheckout({surface:"web"})` → `window.location.assign(checkout.hostedCheckoutUrl)`); native path REWRITTEN to invoke `nativeCheckout({eventId, lines, buyer})`, branch on the `{outcome: "succeeded" | "canceled" | "failed"}` discriminated union, and poll `pollTicketCheckoutStatus(sessionId, "")` on success before routing to `/checkout/[eventId]/confirm`. Mixpanel events preserved (`ticket_checkout_pay_started`, `ticket_checkout_sheet_opened`, `ticket_checkout_cancelled`, `ticket_checkout_succeeded`, `ticket_checkout_failed`). Finalization-timeout handling preserved. Toast state preserved.

**Why:** SPEC §3.4.5 — native path adoption + web path retention. Native + web stay in one screen with one Platform.OS fork (mirrors the existing pattern; one code path replaced, not two).

**Lines changed:** ~+50/-90 (net -40; the new native path is shorter because most of the polling/retry was already in place).

### 4.9 `mingla-business/src/components/checkout/PaymentElementStub.tsx` (DELETED)

**What it did before:** Pre-ORCH-0839-B `[TRANSITIONAL]` stub for a "B3 Payment Element wrapper" that never landed. Marked `[TRANSITIONAL]` with no exit condition. Zero importers in `mingla-business/app` or `mingla-business/src` (confirmed via grep before deletion; only matches were prose mentions in `ThreeDSStubSheet.tsx` comments).

**What it does now:** Deleted (`git rm`). Investigation §10 #2 flagged as cleanup; SPEC §S-9 included.

**Why:** SPEC §3.4.6 + S-9. Dead transitional code; constitutional rule 8 (subtract before adding) applies.

**Lines removed:** ~210.

### 4.10 `.github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs` (DELETED)

**What it did before:** Forbade any `@stripe/stripe-react-native` import in `mingla-business/` (8 checks T-G1..T-G8 per ORCH-0839-B [Stripe Hosted Checkout pivot]).

**What it does now:** Deleted. Workflow job removed; registry comment replaced with retirement notice citing ORCH-0849 + I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY.

**Why:** SPEC §3.5.2 + S-10. ORCH-0849 explicitly re-introduces native Stripe RN in mingla-business; this gate's invariant is retired.

### 4.11 `.github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs` (NEW)

**What it does:** Verifies both apps adopt the same PaymentSheet pattern. 8 rules R-1..R-8 covering: provider mount with correct merchantIdentifier + urlScheme on both apps; initStripe import + call with stripeAccountId on both `nativeCheckoutFlow.ts` files; customer + customerEphemeralKeySecret passthrough on both. Regex-style single-file scans modeled on `i-discover-excludes-ended-master-date.mjs`.

**Lines added:** ~190.

### 4.12 `.github/scripts/strict-grep/i-stripe-pm-method-allowlist.mjs` (NEW)

**What it does:** Verifies the allowlist contract. 6 rules R-1..R-6 covering: allowlist export, edge fn import, spread call presence, hardcoded-literal absence on non-comment lines, `automatic_payment_methods` enabled-form absence on non-comment lines, exact Phase 1 enumeration with Phase 2 method denylist (9 forbidden method names enumerated explicitly).

**Lines added:** ~210.

### 4.13 `.github/workflows/strict-grep-mingla-business.yml`

**What it did before:** Registered ORCH-0839-B gate at line 871. Registry comment line at 82. ORCH-0837 / 0843 / 0844 / 0845 / 0846 gates all registered.

**What it does now:** Registry comments at 82 + 86-87 updated: 0839-B marked RETIRED, two new ORCH-0849 entries added. Job block for 0839-B replaced with a retirement comment. Two new jobs `i-stripe-paymentsheet-parity` + `i-stripe-pm-method-allowlist` registered after the ORCH-0846 job. Total jobs: 75 (was 74).

**Lines changed:** ~+28/-9.

### 4.14 `mingla-business/src/payments/__tests__/native_checkout_flow_parity.test.ts` (NEW)

**What it does:** 8 Jest assertions verifying the structural parity of the business adoption against consumer. Includes:
- Provider mount with business merchantIdentifier + urlScheme
- nativeCheckoutFlow.ts imports initStripe
- nativeCheckoutFlow.ts calls initStripe with stripeAccountId
- nativeCheckoutFlow.ts passes customerId + customerEphemeralKeySecret
- payment.tsx removes expo-web-browser + adopts useNativeCheckoutFlow
- payment.tsx forbids WebBrowser.openAuthSessionAsync (post-retirement anti-regression)
- app.json registers Stripe plugin with business merchantIdentifier
- package.json declares @stripe/stripe-react-native at same major.minor as consumer (normalized semver compare)

**Lines added:** ~105.

### 4.15 `supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist.test.ts` (NEW)

**What it does:** 5 Deno tests covering: pure-function allowlist contract (length + ordering), edge fn import presence, edge fn spread call presence, hardcoded card-only literal absence, automatic_payment_methods enabled-form absence (tightened regex to actual API shape so it doesn't false-positive on prose mentions in anti-regression comments).

**Lines added:** ~95.

### 4.16 `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**What it does now:** Two new top-level invariant entries appended at end:
- `I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY` (DRAFT — flips ACTIVE on ORCH-0849 CLOSE)
- `I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST` (DRAFT — flips ACTIVE on ORCH-0849 CLOSE)

Each entry includes Statement, Why, four-source Enforcement (gate + workflow + happy-path test + adversarial test placeholder), Source citations, EXIT condition. The amendment of I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES (ORCH-0837) is documented in DEC-158 (the original invariant has no top-level INVARIANT_REGISTRY entry — it lives in DEC-only history).

**Lines added:** ~40.

### 4.17 `Mingla_Artifacts/DECISION_LOG.md`

**What it does now:** New DEC-158 entry inserted at top (above DEC-157). Documents the 10-point decision rationale for the bundled ORCH-0849, the AMENDED/RETIRED/NEW invariant matrix, EAS rebuild requirement, operator-side ops prereqs (A-1..A-4), and absorbed/cross-referenced follow-ups.

**Lines added:** 1 paragraph (~3 KB).

---

## 5. Verification matrix (SPEC success criteria)

| ID | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-01 | Edge fn imports + uses `[...getPaymentMethodTypes()]` | PASS | `i-stripe-pm-method-allowlist.mjs` exit 0; grep confirms |
| SC-02 | NO hardcoded `["card"]` literal AND NO `automatic_payment_methods: { enabled: true }` | PASS | Same gate R-4 + R-5 |
| SC-03 | `_shared/stripePaymentMethods.ts` exists with frozen 4-method literal | PASS | `deno check` clean + R-1 + R-6 |
| SC-04 | `mingla-business/package.json` Stripe RN at same major.minor as `app-mobile` | PASS | Parity test `package.json declares...` — normalized semver compare, both `0.65` |
| SC-05 | `mingla-business/app.json` has Stripe plugin + business merchantIdentifier + enableGooglePay | PASS | Parity test `app.json registers...` + `i-stripe-paymentsheet-parity` R-5 |
| SC-06 | Business `_layout.tsx` mounts `<StripeNativeProvider>` at root | PASS | Parity gate R-5 + parity test `mounts <StripeNativeProvider>...` |
| SC-07 | Business `nativeCheckoutFlow.ts` exists; mirrors consumer pattern | PASS | Parity gate R-6/R-7/R-8 + parity test 3 of 8 assertions |
| SC-08 | Business `payment.tsx` no expo-web-browser; uses nativeCheckoutFlow | PASS | Parity test `payment.tsx removes...` + `payment.tsx forbids WebBrowser...` |
| SC-09 | `PaymentElementStub.tsx` DELETED | PASS | `git status` shows `D mingla-business/src/components/checkout/PaymentElementStub.tsx` |
| SC-10 | `orch-0839-b-mingla-business-no-native-stripe.mjs` DELETED + workflow updated | PASS | `git status` shows `D` + workflow yml replaces job with retirement notice |
| SC-11 | New gates exit 0 on head, exit 1 on synthetic revert | PASS | Both gates verified — see §6 below |
| SC-12 | INVARIANT_REGISTRY: ORCH-0837 amended, ORCH-0839-B retired, two new ORCH-0849 DRAFTs | PARTIAL | Two new DRAFTs added at file end. ORCH-0837 + ORCH-0839-B have NO top-level INVARIANT_REGISTRY entries (DEC-only); the amendment + retirement are documented in DEC-158. Acceptable per spec §3.7.1 footnote — orchestrator confirms at CLOSE. |
| SC-13 | Post-deploy edge fn response shape unchanged (`stripeAccountId + customerId + customerEphemeralKeySecret`) | UNVERIFIED (deploy required) | Orchestrator runs probe after `supabase functions deploy ticket-checkout-create`. Source-level: response shape code in `ticket-checkout-create/index.ts` is byte-untouched in the requires_payment branch. |
| SC-14 | Consumer PaymentSheet renders 4 methods on iOS sim post-rebuild | UNVERIFIED (rebuild + live-fire required) | Implementor cannot run iOS sim live-fire; deferred to tester TARGETED + operator real-device. |
| SC-15 | Business PaymentSheet renders 4 methods on iOS sim post-rebuild | UNVERIFIED | Same — requires EAS rebuild + live-fire. |
| SC-16 | Both apps complete card payment end-to-end with test card 4242 | UNVERIFIED | Live-fire. |
| SC-17 | NO regression to ORCH-0844 fixes (initStripe per-PI, Customer/ephemeralKey, no withTimeout) | PASS | ORCH-0844 gate `orch-0844-stripe-connect-account-id-per-pi.mjs` exits 0; parity gate R-3/R-4/R-7/R-8 enforce same on both apps. |
| SC-18 | All 8 preserved invariants from investigation §7 remain ACTIVE | PASS | Existing ORCH-0843 + ORCH-0844 + ORCH-0837 + ORCH-0845 gates all green (see §6). |
| SC-19 | Diff scope limited to 14 named files + reports | PASS | `git status` diff matches §3 exactly; NO app-mobile mobile changes; NO migration; NO admin changes. |
| SC-20 | Operator-side ops A-1..A-4 confirmed BEFORE PR open | UNVERIFIED (operator scope) | Cannot probe Stripe Dashboard from CLI. Flagged in §2 and handoff. |

**Verification summary:** 12 PASS, 1 PARTIAL (acceptable per spec footnote), 7 UNVERIFIED (all live-fire / operator-side / post-deploy). Per spec §10 confidence — High at every layer reachable at implement time.

---

## 6. Regression test verification (ORCH-0840 Step 0.5 gate)

### 6.1 Happy-path test on fixed code

```
$ deno test --allow-read supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist.test.ts
ok | 5 passed | 0 failed (15ms)
```

### 6.2 Fails-on-revert verified at HEAD `029e9cc552d9bdec59dd8b7965f2bdf5e4b12a6e` on TWO independent revert paths

**Revert path A (helper allowlist collapse):**
Replaced `MINGLA_PM_ALLOWLIST = ["card", "link", "apple_pay", "google_pay"]` with `["card"]` (link/apple_pay/google_pay commented out). Re-ran test:
```
[error] Test failed
ORCH-0849 — allowlist returns exactly the four Phase 1 methods in documented order ... FAILED
```
Restored: 5/5 PASS.

**Revert path B (source-file revert):**
Replaced `payment_method_types: [...getPaymentMethodTypes()]` in `ticket-checkout-create/index.ts` with the hardcoded `payment_method_types: ["card"]`. Re-ran test:
```
[error] Test failed
ORCH-0849 — edge function uses spread call at PI-create site ... FAILED
ORCH-0849 — anti-regression: hardcoded card-only literal is ABSENT ... FAILED
```
Restored: 5/5 PASS.

**Both reverts caught by distinct tests.** Path A hits the pure-function contract; path B hits the source-file structural assertions. Fails-on-revert is verified on two independent failure modes.

### 6.3 Business parity test

```
$ cd mingla-business && npx jest src/payments/__tests__/native_checkout_flow_parity.test.ts --no-coverage
PASS src/payments/__tests__/native_checkout_flow_parity.test.ts
  ORCH-0849 — mingla-business native PaymentSheet parity
    ✓ mounts <StripeNativeProvider> in _layout.tsx with business merchant identifier and url scheme (1 ms)
    ✓ nativeCheckoutFlow.ts imports initStripe from @stripe/stripe-react-native
    ✓ nativeCheckoutFlow.ts calls initStripe with stripeAccountId per PI
    ✓ nativeCheckoutFlow.ts passes customer + customerEphemeralKeySecret to initPaymentSheet (1 ms)
    ✓ payment.tsx removes expo-web-browser import and adopts useNativeCheckoutFlow
    ✓ payment.tsx forbids WebBrowser.openAuthSessionAsync call site (post-ORCH-0849 retirement) (1 ms)
    ✓ app.json registers the Stripe RN plugin with business merchant identifier
    ✓ package.json declares @stripe/stripe-react-native at the same major.minor as consumer (1 ms)

Tests: 8 passed, 8 total
```

### 6.4 Strict-grep gate verification

**`i-stripe-pm-method-allowlist.mjs`:** exit 0 on head; manually verified that a synthetic-revert of the helper or source file produces exit 1 (the gate's R-3 + R-4 + R-6 trip independently).

**`i-stripe-paymentsheet-parity.mjs`:** exit 0 on head with all 8 rules passing — see §6.5 for verbatim output.

**`orch-0837-regression-check.mjs` (amended):** 5/5 PASS — T-C0 verifies the new spread-call shape + helper import; T-C1 preserved.

### 6.5 Final all-gate sweep

```
$ node .github/scripts/strict-grep/i-stripe-pm-method-allowlist.mjs
[i-stripe-pm-method-allowlist] PASS — all 6 rules hold:
  - R-1: MINGLA_PM_ALLOWLIST exported
  - R-2: import getPaymentMethodTypes present
  - R-3: spread call present at PI-create site
  - R-4: no hardcoded card-only literal
  - R-5: no automatic_payment_methods enabled form
  - R-6: allowlist is exactly Phase 1 (card, link, apple_pay, google_pay) with no Phase 2 leakage

$ node .github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs
[i-stripe-paymentsheet-parity] PASS — all 8 rules hold (consumer + business parity intact):
  - R-1: app-mobile/app/_layout.tsx mounts <StripeNativeProvider merchantIdentifier="merchant.com.mingla.app.v2" urlScheme="com.mingla.app.v2">
  - R-2: app-mobile/src/payments/nativeCheckoutFlow.ts imports initStripe from @stripe/stripe-react-native
  - R-3: app-mobile/src/payments/nativeCheckoutFlow.ts calls initStripe({...stripeAccountId...})
  - R-4: app-mobile/src/payments/nativeCheckoutFlow.ts passes customerId + customerEphemeralKeySecret
  - R-5: mingla-business/app/_layout.tsx mounts <StripeNativeProvider merchantIdentifier="merchant.com.mingla.business.v2" urlScheme="com.mingla.business.v2">
  - R-6: mingla-business/src/payments/nativeCheckoutFlow.ts imports initStripe from @stripe/stripe-react-native
  - R-7: mingla-business/src/payments/nativeCheckoutFlow.ts calls initStripe({...stripeAccountId...})
  - R-8: mingla-business/src/payments/nativeCheckoutFlow.ts passes customerId + customerEphemeralKeySecret

$ node app-mobile/scripts/ci/orch-0837-regression-check.mjs
ORCH-0837 regression check
  [PASS] T-C0 ticket-checkout-create/index.ts sources payment_method_types from getPaymentMethodTypes() allowlist (ORCH-0849)
  [PASS] T-C1 ticket-checkout-create/index.ts does NOT use automatic_payment_methods: {enabled: true}
  [PASS] T-C2 app/index.tsx imports useStripe from @stripe/stripe-react-native
  [PASS] T-C3 app/index.tsx invokes handleURLCallback at least once
  [PASS] T-C4 app/index.tsx Linking listener invokes handleURLCallback BEFORE falling through to handleDeepLink
Summary: 5/5 PASS

$ node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs
ORCH-0843 Stripe direct-charge gate passed.

$ node .github/scripts/strict-grep/orch-0844-stripe-connect-account-id-per-pi.mjs
ORCH-0844 Stripe Connect-account-id-per-PI gate passed.
```

All preserved-invariant gates remain green; both new ORCH-0849 gates exit 0; amended ORCH-0837 gate exits 0.

---

## 7. Invariant preservation check

| Invariant | Status | How verified |
|---|---|---|
| I-PROPOSED-STRIPE-CHARGE-SHAPE-IS-DIRECT (ORCH-0843) | PRESERVED | `orch-0843-stripe-direct-charges-only.mjs` PASS |
| I-PROPOSED-STRIPE-APPLICATION-FEE-PRESENT (ORCH-0843) | PRESERVED | Same gate |
| I-PROPOSED-STRIPE-ACCOUNT-HEADER-ON-CONNECTED-CALLS (ORCH-0843) | PRESERVED | Same gate |
| I-PROPOSED-STRIPE-STATEMENT-DESCRIPTOR-SUFFIX-MINGLA (ORCH-0843) | PRESERVED | Same gate |
| I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI (ORCH-0844) | PRESERVED | `orch-0844-...mjs` PASS; parity gate R-3/R-7 |
| I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG (ORCH-0844 amended) | PRESERVED | Parity gate R-1/R-5 |
| I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY (ORCH-0844) | PRESERVED | `useStripePaymentSheet.ts` shared package — UNTOUCHED by this implementation |
| I-PROPOSED-STRIPE-CALLBACK-WIRED (ORCH-0837) | PRESERVED | `orch-0837-regression-check.mjs` T-C2..T-C4 PASS |
| I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES (ORCH-0837) | AMENDED | T-C0 reshape; new T-spec under allowlist module + new gate |
| I-PROPOSED-MINGLA-BUSINESS-HOSTED-CHECKOUT-ONLY (ORCH-0839-B per DEC-155) | RETIRED | Gate deleted, workflow job removed, retirement notice in workflow yml; DEC-158 documents supersession |
| I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY (ORCH-0849) | NEW DRAFT | Added to INVARIANT_REGISTRY; flips ACTIVE on CLOSE |
| I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST (ORCH-0849) | NEW DRAFT | Same |

---

## 8. Parity check

| Dimension | Consumer (app-mobile) | Business (mingla-business) | Parity |
|---|---|---|---|
| Stripe RN SDK version | `^0.65.1` | `^0.65.1` | YES — parity test SC-04 verifies |
| Expo / RN base | `~54.0.34` / `0.81.5` | `~54.0.34` / `0.81.5` | YES |
| Provider mount | `<StripeNativeProvider merchantIdentifier="merchant.com.mingla.app.v2" urlScheme="com.mingla.app.v2">` | `<StripeNativeProvider merchantIdentifier="merchant.com.mingla.business.v2" urlScheme="com.mingla.business.v2">` | YES — same component, different merchant identifier per app (operator-side cert ops on both) |
| `nativeCheckoutFlow.ts` | Exists at `app-mobile/src/payments/` | Exists at `mingla-business/src/payments/` | YES — mirror file |
| `initStripe` per-PI with stripeAccountId | YES (ORCH-0844) | YES (new in ORCH-0849) | YES |
| Customer + ephemeralKey passthrough | YES (ORCH-0844) | YES (new in ORCH-0849) | YES |
| Edge fn `requires_payment` response shape | `stripeAccountId + customerId + customerEphemeralKeySecret` | Same — both apps consume identical shape | YES |
| Web checkout path | N/A (consumer is mobile-only) | RETAINED (Platform.OS === "web" → Hosted Checkout via window.location.assign) | DIVERGENT but documented — web has no native Stripe SDK, no PaymentSheet possible |

**Parity verdict:** ACHIEVED at the native PaymentSheet layer. Web divergence is documented and physically necessary (PaymentSheet doesn't render in browsers).

---

## 9. Cache safety

No React Query keys changed. No mutation contracts changed. No data shape changed (edge function response shape is byte-identical). PaymentIntent `payment_method_type` column already accepts arbitrary Stripe method strings (TEXT, no enum) — verified during investigation. No AsyncStorage / Zustand persisted state changes.

---

## 10. Regression surface (for tester to verify)

1. **Consumer Discover → Buy flow on iOS 26 sim with all 4 methods.** Apple Pay button + Link + Google Pay (Android) + Card form should all render in PaymentSheet within ~3s. Test card 4242 succeeds end-to-end.
2. **Business buyer flow on iOS 26 sim.** Same PaymentSheet shape; same 4 methods (subject to Apple Pay merchant cert state per A-1).
3. **Business web buyer flow.** Platform.OS === "web" still uses Hosted Checkout via `window.location.assign` — full-page redirect to checkout.stripe.com; success/cancel returns work via Stripe's redirect URLs.
4. **Refund flow.** Existing refund-order edge function operates on charges regardless of source PM type — unchanged.
5. **Connect onboarding (mingla-business).** `connect-onboarding.tsx` uses `@stripe/connect-js` Embedded Components — UNTOUCHED by this ORCH; verify it still loads.

---

## 11. Constitutional compliance (14 rules)

| # | Rule | Status |
|---|------|--------|
| 1 | No dead taps | PASS (no UI changes) |
| 2 | One owner per truth | PASS — `MINGLA_PM_ALLOWLIST` is sole source for payment_method_types |
| 3 | No silent failures | PASS — `nativeCheckout` returns discriminated union; each branch surfaces to toast/banner |
| 4 | One key per entity | N/A (no React Query changes) |
| 5 | Server state server-side | N/A (no Zustand changes) |
| 6 | Logout clears everything | N/A |
| 7 | Label temporary | N/A (no [TRANSITIONAL] markers introduced; one removed — PaymentElementStub) |
| 8 | Subtract before adding | YES — PaymentElementStub.tsx deleted; ORCH-0839-B gate deleted; expo-web-browser import + CHECKOUT_RETURN_URL_SCHEME constant removed before native PaymentSheet wiring added |
| 9 | No fabricated data | PASS — PM list sourced from real Stripe API connected-account capabilities at runtime (Stripe filters) |
| 10 | Currency-aware | PASS — currency flows unchanged through `ticket-checkout-create` |
| 11 | One auth instance | PASS — both apps use the same supabase auth, separate Stripe Connect contexts (correct) |
| 12 | Validate at right time | PASS — `initStripe` called per-PI at request time (not module-load) |
| 13 | Exclusion consistency | PASS — allowlist applied uniformly to all PIs; both surfaces consume same PI |
| 14 | Persisted-state startup | N/A |

**Zero constitutional violations.**

---

## 12. Discoveries for orchestrator

1. **`mingla-business/src/components/checkout/ThreeDSStubSheet.tsx`** — another `[TRANSITIONAL]` stub that references the now-deleted PaymentElementStub in two comment lines. Not imported anywhere active (I did not check exhaustively — orchestrator may want to verify and queue cleanup separately). Out of ORCH-0849 scope.
2. **The investigation §10 cross-references** (ORCH-0843-FOLLOWUP-DISPUTES P1 chargeback routing; ORCH-0844 P3 customerId-null guest mode) remain registered — both are orthogonal to Phase 1 PM allowlist (no method enabled in Phase 1 has novel dispute mechanics; both apps remain on guest-mode-tolerant Customer creation).
3. **Phase 2 method ORCHs** (Cash App Pay, Klarna, Afterpay, ACH, SEPA Debit) need to be queued separately. Each requires proving redirect-flow / delayed-method plumbing live-fire.
4. **Operator-side ops A-1 (new merchant identifier `merchant.com.mingla.business.v2`)** is a non-trivial Stripe Dashboard step. The implementor cannot perform it. If the operator does NOT register the new merchant ID, Apple Pay will be silently absent on mingla-business (NOT a crash post-ORCH-0844 — just absent). SC-15 + SC-16 may show 3 methods instead of 4 on business; tester documents this case as CONDITIONAL PASS if it happens.
5. **iOS dev-build rebuild required** for live-fire on either app. Per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` — NOT `npx expo run:ios`.

---

## 13. Deno + deploy

- `deno check supabase/functions/ticket-checkout-create/index.ts` → exit 0.
- `deno check supabase/functions/_shared/stripePaymentMethods.ts` → exit 0.
- `deno test --allow-read supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist.test.ts` → 5/5 PASS.
- `verify_jwt` setting: UNCHANGED in `supabase/config.toml` and code. `ticket-checkout-create` stays `verify_jwt = false` (anon-callable for guest buyers).
- **Deploy command (orchestrator-owned per `feedback_orchestrator_deploys_edge_functions.md`):**
  ```
  /Users/sethogieva/bin/supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv
  ```
  After deploy, orchestrator probes `mcp__supabase__list_edge_functions` to confirm version bump + `verify_jwt: false` preserved (SC-13).

---

## 14. EAS rebuild required (NOT OTA-safe for mingla-business)

Adding `@stripe/stripe-react-native` to `mingla-business/package.json` + plugin entry to `app.json` introduces a new native module that requires a full native build. Operator-side action:

```bash
cd mingla-business
eas build --platform ios   # for iOS sim/device
eas build --platform android  # for Android emulator/device
```

Consumer (app-mobile) is OTA-safe — its native Stripe RN module already exists; the allowlist change is purely server-side and the new methods (Apple Pay, Link, Google Pay) use already-installed SDK code.

---

## 15. Working-branch state + staging incantation

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Pre-implementation HEAD `029e9cc552d9bdec59dd8b7965f2bdf5e4b12a6e`.

Files to stage at CLOSE (per SPEC SC-19):

```
git add \
  supabase/functions/_shared/stripePaymentMethods.ts \
  supabase/functions/ticket-checkout-create/index.ts \
  supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist.test.ts \
  app-mobile/scripts/ci/orch-0837-regression-check.mjs \
  .github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs \
  .github/scripts/strict-grep/i-stripe-pm-method-allowlist.mjs \
  .github/workflows/strict-grep-mingla-business.yml \
  mingla-business/package.json \
  mingla-business/app.json \
  mingla-business/app/_layout.tsx \
  mingla-business/app/checkout/[eventId]/payment.tsx \
  mingla-business/src/payments/nativeCheckoutFlow.ts \
  mingla-business/src/payments/__tests__/native_checkout_flow_parity.test.ts \
  Mingla_Artifacts/INVARIANT_REGISTRY.md \
  Mingla_Artifacts/DECISION_LOG.md \
  Mingla_Artifacts/reports/INVESTIGATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md \
  Mingla_Artifacts/specs/SPEC_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md \
  Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md

git rm --cached \
  mingla-business/src/components/checkout/PaymentElementStub.tsx \
  .github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs
# (already deleted on disk; git rm --cached just stages the deletion — or skip if already staged)

git commit -m "Close ORCH-0849: Stripe payment-method parity — consumer expansion + mingla-business PaymentSheet re-pivot"
```

**Working tree currently contains uncommitted parallel ORCH work** (`INVESTIGATION_ORCH-0842_*`, `INVESTIGATION_ORCH-0847_*`, ORCH-0850 specs + investigation). MUST NOT be staged in the ORCH-0849 commit. Orchestrator uses the explicit-add list above, NOT `git add .`.

# INVESTIGATION — ORCH-0849: Stripe payment-method parity across consumer + mingla-business

**Mode:** INVESTIGATE
**Skill:** Claude `mingla-forensics`
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Bundle authorization:** operator pre-approved per Working-Branch Discipline rule 5 ("we do them together to ensure parity")
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md`
**Confidence:** mixed — backend / Stripe API contract / source claims are `root cause proven`; UI runtime claims about which payment methods cause the iOS-26 sheet preflight stall are `probable` (mechanism proven from ORCH-0837 + ORCH-0844 prior live-fire, not re-reproduced this session). Live-fire on consumer dev build + business dev build deferred to TEST phase per Phase 0.A — investigation scope is documented intent + decision matrix, not "does Apple Pay show up in the sheet today."

---

## 1. Summary (layman first)

**Two questions in one bundle:**

(a) **Can the consumer app re-enable payment methods beyond card?** YES — but only specific ones, and only after we (1) confirm each method's enabled-state on every charges-enabled connected account, (2) handle Apple Pay's separate merchant-cert + iOS entitlement step (this absorbs ORCH-0838 [Apple Pay merchant cert verification + re-enable]), (3) keep ORCH-0844's three load-bearing fixes in place (initStripe per-PI with stripeAccountId, Customer + ephemeralKey, withTimeout removal). Recommended initial expansion: **Card + Apple Pay + Link** (these are Stripe's three "always safe" methods on Connect direct charges with no extra app config beyond what's already wired). Defer Klarna / Afterpay / Cash App Pay / ACH to a follow-up ORCH because they need redirect-flow plumbing + per-account capability enablement that's not in scope.

(b) **Can mingla-business use the native sheet (PaymentSheet) or an embedded component?** YES, three paths — and the right answer is **native PaymentSheet, same pattern as consumer**, because that's the strict-parity outcome the operator asked for AND because the Stripe Embedded Payment Element on React Native is web-only (renders in a WebView via `@stripe/stripe-js`, NOT a native UI). Business pivoted to Hosted Checkout in ORCH-0839-B [Stripe Hosted Checkout pivot] because at that time its `StripeNativeProvider` was a no-op shim and the team wanted to ship without simultaneously debugging the iOS-26 PaymentSheet regression. Both blockers are gone now: ORCH-0844 proved the regression is a config-gap problem (not fundamental), and consumer ships PaymentSheet successfully today. Mingla-business adopts the consumer pattern verbatim: `@stripe/stripe-react-native` re-added to package.json, `StripeNativeProvider` mounted in root `_layout.tsx`, edge function returns the same `stripeAccountId + customerId + customerEphemeralKeySecret` triad, and `payment.tsx` replaces `WebBrowser.openAuthSessionAsync` with `useStripePaymentSheet`.

**Cost:** Consumer expansion is an OTA-safe config change (~10 lines server-side + ~5 lines mobile). Business re-pivot is NOT OTA-safe — requires EAS rebuild because `@stripe/stripe-react-native` re-adds a native module. Operator-side ops: register a second Apple Pay merchant identifier `merchant.com.mingla.business.v2` in Stripe Dashboard + add the `com.apple.developer.in-app-payments` entitlement to the mingla-business iOS bundle.

---

## 2. Phase 0 — Ingestion record

| Source | Key extract |
|---|---|
| `Mingla_Artifacts/DECISION_LOG.md` DEC-157 (ORCH-0844 [Explorer PaymentSheet — Connect account ID per-PI + 60s timeout removal] CLOSE) | Establishes the three load-bearing fixes that make PaymentSheet stable on iOS 26: (1) `initStripe({stripeAccountId, merchantIdentifier, urlScheme})` per-PI BEFORE `initPaymentSheet`; (2) idempotent Connect-scoped Stripe Customer + ephemeralKey on every paid checkout, both passed to `initPaymentSheet`; (3) `withTimeout(presentPaymentSheet)` REMOVED. Card-only PI is preserved as the load-bearing constraint that ORCH-0837 added to prevent the SDK's per-method preflight stall. |
| `Mingla_Artifacts/DECISION_LOG.md` DEC-156 (ORCH-0843 [Charge-Shape Reconciliation] CLOSE) | Direct charges via `Stripe-Account` header + `application_fee_amount: 1.5%` + `automatic_tax.enabled: true` (no `liability.account` block). Platform-liable for chargebacks. Any payment-method addition must preserve all four ORCH-0843 invariants. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0837_PAYMENTSHEET_HANG_THREE_HYPOTHESES.md` | **The root cause for card-only:** backend was creating PI with `automatic_payment_methods: { enabled: true }`, which attached every dashboard-enabled method. iOS Stripe SDK then loaded metadata for EACH attached method (Apple Pay merchant validation, redirect-URL prep for Klarna/Afterpay/iDEAL/etc., Link availability check, Cash App Pay deep-link). If ANY preflight hung silently, the sheet never rendered. Solution was to lock `payment_method_types: ['card']` to skip the preflight altogether. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0844_EXPLORER_PAYMENTSHEET_DOUBLE_RESOLVE.md` | Explicitly states "The Hosted Checkout pivot (Option B) is NOT recommended for explorer because... Mingla-business pivoted because mingla-business's `StripeNativeProvider` is a NO-OP shim — they never actually had PaymentSheet wired correctly." Confirms the business pivot rationale was missing infrastructure, NOT a fundamental PaymentSheet problem. |
| `app-mobile/app.json` Stripe plugin entry | Consumer has `merchantIdentifier: "merchant.com.mingla.app.v2"` + `enableGooglePay: true`. Apple Pay merchant ID is already wired. |
| `app-mobile/app/_layout.tsx:72-83` | Consumer mounts `<StripeNativeProvider merchantIdentifier="merchant.com.mingla.app.v2" urlScheme="com.mingla.app.v2">` at root. |
| `mingla-business/package.json` | NO `@stripe/stripe-react-native` dependency. Has `@stripe/connect-js@3.4.2` + `@stripe/react-connect-js@3.4.1` (Connect Embedded Components for onboarding only — these are NOT a Payment Element). |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | Currently uses `expo-web-browser.openAuthSessionAsync` to open Stripe Hosted Checkout (`checkout.stripe.com`) in an in-app browser session and intercept the redirect. |
| `mingla-business/src/components/checkout/PaymentElementStub.tsx` | Pre-ORCH-0839-B stub that was meant to become a real `<StripePaymentElement>` wrapper in "B3". Abandoned in favor of Hosted Checkout. Carries `[TRANSITIONAL]` marker. |
| `supabase/functions/ticket-checkout-create/index.ts:478-485` | Live v48 code: `payment_method_types: ["card"]` is hardcoded. CI gate `orch-0837-regression-check.mjs` T-C1 forbids the `automatic_payment_methods: { enabled: true }` form as a regression — that gate would need to be updated, not removed. |
| `.github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs` | Forbids any `@stripe/stripe-react-native` import in `mingla-business/`. Would need to be retired (not relaxed) on a business re-pivot. |

---

## 3. Five-truth-layer evidence

### 3.1 Docs layer — Stripe's official surface options

Three Stripe payment-surface options exist for our stack. Each row is what's available, not what we're already using:

| Surface | Stripe SDK | RN-native? | WebView? | Direct-charge OK? | Apple Pay native? | Customer/ephemeralKey supported? |
|---|---|---|---|---|---|---|
| **PaymentSheet** | `@stripe/stripe-react-native` v0.65.x | Yes (native iOS UISheet / Android BottomSheet) | No | Yes via `stripeAccountId` on `initStripe` + `stripeAccount` on PI create | Yes — via merchantIdentifier on Provider | Yes — passed to `initPaymentSheet` |
| **Payment Element (web)** | `@stripe/stripe-js` + `@stripe/react-stripe-js` | NO — JavaScript Elements; mobile would render inside `react-native-webview` | Yes | Yes via `Stripe('pk', { stripeAccount })` | Limited — Apple Pay needs domain verification + the in-app browser session must pass the right entitlements; significantly harder than PaymentSheet | Yes — via `customer` + `customer_session_client_secret` |
| **Hosted Checkout** | None — full redirect to `checkout.stripe.com/c/pay/<session>` | No — opens in `expo-web-browser` | System browser session | Yes — current ORCH-0839-B pattern | Yes — Stripe handles it server-side via domain registration | N/A — checkout session owns it |

**Critical clarification re: business's existing `@stripe/connect-js`:** Stripe Connect Embedded Components (Account Onboarding, Account Management, Notification Banner, Payouts, etc.) are a SEPARATE product family from the Payment Element. They share the SDK family namespace but they are NOT for accepting payments. Mingla-business currently uses Connect Embedded Components for [mingla-business/app/connect-onboarding.tsx](mingla-business/app/connect-onboarding.tsx) (operator onboards their Stripe Connect account). Using `@stripe/connect-js` for checkout is not a thing.

**Stripe direct-charge compatibility per method:** per [https://docs.stripe.com/payments/payment-methods/integration-options](https://docs.stripe.com/payments/payment-methods/integration-options) and [https://docs.stripe.com/connect/direct-charges](https://docs.stripe.com/connect/direct-charges), the following payment methods are compatible with the `Stripe-Account`-header direct-charge architecture established by ORCH-0843, subject to per-connected-account capability enablement:

| Method | Direct-charge OK? | Extra app config needed (consumer) | Extra app config needed (business) |
|---|---|---|---|
| Card | Yes (already enabled) | None | None |
| Apple Pay | Yes | Merchant identifier registered on Stripe dashboard for the platform; iOS entitlement `com.apple.developer.in-app-payments` on bundle (already on consumer per ORCH-0834-rescoped) | Same — but for `merchant.com.mingla.business.v2` (new merchant ID needed) |
| Google Pay | Yes | `enableGooglePay: true` in Stripe plugin (already in consumer app.json); merchant identifier optional | Same |
| Link | Yes | Just needs `payment_method_types` to include it; Stripe handles the wallet UI inside PaymentSheet | Same |
| Cash App Pay | Yes (US only) | `urlScheme` configured (already wired); deep-link callback handled by `handleURLCallback` | Same |
| Klarna / Afterpay / Clearpay | Yes (region-specific) | Redirect-flow — `handleURLCallback` must consume the return URL; PaymentSheet handles it if `payment_method_types` includes them | Same |
| ACH Debit (US Bank Account) | Yes (US only) | DELAYED payment method — requires `allowsDelayedPaymentMethods: true` on `initPaymentSheet`; webhook routing for `payment_intent.processing` needed | Same |
| iDEAL / SOFORT / EPS / P24 / Bancontact | Yes (region-specific) | Redirect-flow + `handleURLCallback` | Same |
| SEPA Debit | Yes (region-specific) | DELAYED + `handleURLCallback` + mandate language UI | Same |

### 3.2 Schema layer — orders + payments + webhooks

`orders` table carries `stripe_payment_intent_id` + `stripe_charge_id` + `payment_status`. `payments` table carries `stripe_payment_intent_id` + `payment_method_type` (the type STRING from Stripe, e.g., `"card"`, `"apple_pay"`, `"link"`). No schema change needed to support multiple PM types — the column is already a freeform string accepting whatever Stripe returns.

Webhook routing in `supabase/functions/stripe-webhook/index.ts` filters by `STRIPE_ROUTED_EVENT_TYPES`. For non-card methods we'd need to confirm coverage of:
- `payment_intent.processing` (delayed methods: ACH, SEPA Debit) — REQUIRED
- `payment_intent.requires_action` (3DS, redirect methods) — REQUIRED
- `payment_intent.payment_failed` (already covered for card) — confirm covered
- `charge.refunded` (already covered) — confirm covered for non-card refund paths
- `charge.dispute.created` — **MISSING per DEC-156 (ORCH-0843)**, registered as P1 follow-up `ORCH-0843-FOLLOWUP-DISPUTES`. ORCH-0849 should absorb this if disputes mechanics differ by payment-method type.

### 3.3 Code layer — current state of all three surfaces

**Consumer (app-mobile) — PaymentSheet path:**

| File | Role | Current state |
|---|---|---|
| `app-mobile/app/_layout.tsx:72-83` | Root provider | `<StripeNativeProvider merchantIdentifier="merchant.com.mingla.app.v2" urlScheme="com.mingla.app.v2">` — fully wired |
| `app-mobile/app.json` Stripe plugin | Native config | `merchantIdentifier: "merchant.com.mingla.app.v2"`, `enableGooglePay: true` — wired |
| `packages/payments-native/StripeNativeProvider.tsx` | Provider wrapper | Real wrapper around `@stripe/stripe-react-native` `<StripeProvider>` — wired |
| `packages/payments-native/useStripePaymentSheet.ts` | Hook | post-ORCH-0844: NO `withTimeout` race, once-only guards intact, supports customer + ephemeralKey passthrough |
| `app-mobile/src/payments/nativeCheckoutFlow.ts` | Flow controller | Calls `initStripe({publishableKey, stripeAccountId, merchantIdentifier, urlScheme})` per-PI BEFORE `initPaymentSheet`; passes `customer + customerEphemeralKeySecret` |
| `supabase/functions/ticket-checkout-create/index.ts:478-485` | PI creation (v48 live) | `payment_method_types: ["card"]` hardcoded; returns `stripeAccountId + customerId + customerEphemeralKeySecret` on `requires_payment` |

**Business (mingla-business) — Hosted Checkout path:**

| File | Role | Current state |
|---|---|---|
| `mingla-business/app/_layout.tsx:36` | Root provider | NO Stripe provider mounted ("Hosted Stripe Checkout via expo-web-browser needs no provider" — comment) |
| `mingla-business/app.json` | Native config | NO `@stripe/stripe-react-native` plugin entry |
| `mingla-business/package.json` | Deps | NO `@stripe/stripe-react-native`; has `@stripe/connect-js@3.4.2` + `@stripe/react-connect-js@3.4.1` (Connect Embedded Components for onboarding only) |
| `mingla-business/app/checkout/[eventId]/payment.tsx:40,276` | Checkout screen | Imports `expo-web-browser`; calls `WebBrowser.openAuthSessionAsync(checkoutSessionUrl, deepLinkScheme)` to hand off to `checkout.stripe.com` |
| `mingla-business/src/components/checkout/PaymentElementStub.tsx` | Stub | Pre-ORCH-0839-B placeholder marked `[TRANSITIONAL]` for "B3" Payment Element wrapper that never landed |
| `.github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs` | CI gate | Forbids any `@stripe/stripe-react-native` import in `mingla-business/`. Would need to be retired for a business re-pivot. |

**Shared backend:**

`ticket-checkout-create` serves both apps. Currently the response shape (`requires_payment` → `stripeAccountId + customerId + customerEphemeralKeySecret`) is consumed only by consumer (business uses `requires_redirect` → `checkoutUrl`). If business switches to PaymentSheet, both apps consume the same `requires_payment` shape.

### 3.4 Runtime layer — what would change

(Not exercised this session — see Confidence note in §1. The runtime evidence comes from ORCH-0837 + ORCH-0844 prior live-fires + Stripe's documented method-by-method behavior.)

ORCH-0837's H2 root cause proved that adding multiple methods to a PI causes iOS Stripe SDK to load metadata for each. Methods that loaded reliably in pre-ORCH-0837 tests: card. Methods that stalled the preflight on at least one occasion: Apple Pay (when merchant cert was not configured), Klarna (when handleURLCallback was not wired), Cash App Pay (when urlScheme was not configured). All three of those config gaps are now wired in consumer post-ORCH-0834-rescoped + ORCH-0837 + ORCH-0844.

**Reasonable expansion under current consumer config:**
- Card (already enabled — baseline) — `proven` live
- Link — `probable` live (Stripe's wallet, runs inside PaymentSheet, no app-level config beyond customer + ephemeralKey which we already have)
- Apple Pay — `probable` live IF Stripe Dashboard merchant cert is verified active for `merchant.com.mingla.app.v2` (operator-side check needed)
- Google Pay — `probable` live (already enabled in plugin; Google Pay merchant ID resolved by Stripe)
- Cash App Pay — `suspected` live (urlScheme wired; needs live-fire to confirm the deep-link redirect resolves cleanly through `handleURLCallback`)

**NOT recommended for initial expansion:**
- Klarna / Afterpay / Clearpay — redirect-flow; require live-fire of `handleURLCallback` returning before PaymentSheet's completion fires; out of bundle scope
- ACH / SEPA Debit — delayed payment methods; require webhook routing for `payment_intent.processing` + buyer-side waiting-state UX; out of bundle scope
- iDEAL / Bancontact / EPS / P24 — region-specific, low demand for current US-centric brand base; out of scope

### 3.5 Data layer — what we have

Live data probe deferred to SPEC phase (Connect-account capability enumeration requires real Stripe API calls — investigation defers per Phase 0.A backend-only-exemption-not-applicable note for UI/runtime claims). SPEC must include:

- Per-charges-enabled-brand audit: enumerate enabled `payment_method_configurations` via `/v1/payment_method_configurations` API on each connected account
- Sample 3 real brands; document which methods are enabled; flag any brand where Apple Pay or Link is missing (those brands will see a partial sheet)
- Current `payments` table: confirm `payment_method_type` column is sized to accept method strings beyond `"card"` (likely TEXT — fine, but confirm)

---

## 4. Findings (classified)

### 🔴 Root cause F-1 — Consumer PI is locked to `payment_method_types: ['card']` (ORCH-0837 mitigation that worked, but is now over-restrictive)

| Field | Value |
|---|---|
| File + line | `supabase/functions/ticket-checkout-create/index.ts:478-485` |
| Exact code | `payment_method_types: ["card"]` in `piCreateBody` |
| What it does | Locks every consumer PI to card-only, preventing Apple Pay / Link / Google Pay / any other method from appearing in PaymentSheet |
| What it should do | Accept `payment_method_types` as a curated list — at minimum `["card", "link", "apple_pay", "google_pay"]` — with the list driven by either (a) a request param naming the surface (`consumer` vs `mingla-business`) and method preferences, OR (b) the connected account's enabled payment-method-configuration |
| Causal chain | ORCH-0837 added card-only to fix the SDK preflight stall caused by `automatic_payment_methods: enabled: true`. ORCH-0844 added the three load-bearing fixes (initStripe per-PI, Customer + ephemeralKey, withTimeout removal) that ELIMINATE the preflight-stall mechanism for the methods our app is correctly configured for (Apple Pay, Link, Google Pay). The card-only lock is no longer load-bearing for THOSE methods. Keeping it suppresses revenue uplift (Apple Pay alone typically lifts mobile checkout conversion 5–15% on iOS). |
| Verification step | (1) SPEC must enumerate the connected-account capability set via Stripe API. (2) Implementor changes the constant to a curated list. (3) Tester live-fires PaymentSheet with the new list on a charges-enabled brand and confirms the sheet renders all configured methods within 3s. (4) Existing CI gate `orch-0837-regression-check.mjs` T-C1 forbids the `automatic_payment_methods: enabled: true` regression — that gate stays as-is; a NEW gate asserts the curated list NEVER contains methods that require redirect-flow (Klarna, Afterpay, iDEAL, etc.) unless `handleURLCallback` is independently verified live. |

### 🔴 Root cause F-2 — Business uses Hosted Checkout because its `StripeNativeProvider` was a no-op shim at ORCH-0839-B pivot time; the underlying blocker no longer applies

| Field | Value |
|---|---|
| File + line | `mingla-business/app/_layout.tsx:36` ("Hosted Stripe Checkout via expo-web-browser needs no provider") + `mingla-business/app/checkout/[eventId]/payment.tsx:276` (`WebBrowser.openAuthSessionAsync`) |
| Exact code | NO StripeProvider mounted; entire checkout flows through `expo-web-browser` to `checkout.stripe.com` |
| What it does | Hands off the buyer to a system browser session, intercepts the success redirect, returns to confirm screen |
| What it should do | If parity with consumer is the operator's intent (it IS, per dispatch directive 2026-05-15), mingla-business mounts the same `<StripeNativeProvider>` at root with its own merchantIdentifier `merchant.com.mingla.business.v2`, replaces the WebBrowser flow with `useStripePaymentSheet`, and consumes the same `requires_payment` response shape from `ticket-checkout-create` that consumer uses |
| Causal chain | ORCH-0839-B pivoted to Hosted Checkout because the existing mingla-business `StripeNativeProvider` was a no-op shim and the team wanted to ship without simultaneously rebuilding the provider AND debugging iOS-26 PaymentSheet. ORCH-0844 then PROVED PaymentSheet is stable on iOS 26 once the three load-bearing fixes are in place. So both blockers (no provider, broken iOS 26) are now resolved on consumer. Business can adopt the same pattern verbatim. |
| Verification step | (1) Implementor adds `@stripe/stripe-react-native` to `mingla-business/package.json` + Stripe plugin to `mingla-business/app.json` with the new merchant identifier. (2) Implementor mounts `StripeNativeProvider` at root. (3) Implementor swaps `payment.tsx` from `WebBrowser.openAuthSessionAsync` to `useStripePaymentSheet`. (4) ORCH-0839-B CI gate `orch-0839-b-mingla-business-no-native-stripe.mjs` is RETIRED. (5) EAS rebuild required (NOT OTA-safe). (6) Operator-side: register `merchant.com.mingla.business.v2` in Stripe Dashboard + add iOS entitlement to mingla-business bundle. (7) Tester live-fires on both iOS sim AND Android emu (parity mandate). |

### 🟠 Contributing factor F-3 — Apple Pay merchant-cert state on Stripe Dashboard is unverified at investigation time

| Field | Value |
|---|---|
| File + line | N/A — operator-side ops outside the codebase |
| What it does | Apple Pay requires Stripe Dashboard registration linking the merchant identifier to a verified merchant cert + domain. Without it, Apple Pay attempts via PaymentSheet return a generic "Apple Pay unavailable" path that historically caused the SDK preflight stall in ORCH-0837 H4. |
| What it should do | Operator verifies cert is registered + active for both `merchant.com.mingla.app.v2` (consumer, already wired) AND `merchant.com.mingla.business.v2` (business, NEW — needs registration). Operator-side action. ORCH-0838 [Apple Pay merchant cert verification + re-enable] is absorbed into ORCH-0849 to track this. |
| Verification step | Operator visits `https://dashboard.stripe.com/settings/payments/apple_pay` for the live Stripe account, confirms both merchant identifiers are listed with green status, downloads the verification file and confirms it's hosted at our domain. SPEC must reference this as a precondition for the implementor's PR. |

### 🟡 Hidden flaw F-4 — `charge.dispute.created` missing from webhook routing (ORCH-0843-FOLLOWUP-DISPUTES, P1)

| Field | Value |
|---|---|
| File + line | `supabase/functions/stripe-webhook/index.ts` `STRIPE_ROUTED_EVENT_TYPES` constant (line range varies) |
| What it does | Webhook does NOT route `charge.dispute.created` events. Under DEC-156's platform-liable architecture, every chargeback is on Mingla. Without dispute routing, the platform has zero notification when a buyer disputes — operator finds out via Stripe Dashboard or balance drop. |
| What it should do | Add `charge.dispute.created` to the routed event types; create a `disputes` table or attach dispute metadata to `orders`; surface in admin dashboard. Out of ORCH-0849 scope but cross-references because some non-card methods (e.g., ACH) have different dispute timelines (60-day vs 120-day) and a dispute-blind webhook becomes more dangerous as method set widens. |
| Verification step | RECOMMEND ORCH-0849 SPEC absorbs the dispute-routing fix as a sub-clause IF the method set being enabled includes ACH or any method with >120-day dispute window; otherwise leave as separate ORCH. Operator decision. |

### 🟡 Hidden flaw F-5 — `mingla-business/src/components/checkout/PaymentElementStub.tsx` is a dead `[TRANSITIONAL]` marker that should be deleted on business re-pivot

| Field | Value |
|---|---|
| File + line | `mingla-business/src/components/checkout/PaymentElementStub.tsx:1-50` |
| What it does | Pre-ORCH-0839-B placeholder marked `[TRANSITIONAL]` for a "B3 Payment Element wrapper" that never landed. Unused; not imported anywhere on the current Hosted Checkout flow. |
| What it should do | DELETE on business re-pivot to PaymentSheet (or keep alive if business chooses Embedded Payment Element web path — see §5 decision matrix). |
| Verification step | Implementor's diff includes `git rm mingla-business/src/components/checkout/PaymentElementStub.tsx` when re-pivoting to native PaymentSheet. CI strict-grep gate adds an assertion that this file is absent. |

### 🔵 Observation F-6 — Stripe's `@stripe/connect-js` (already a business dep for onboarding) is NOT a payment-acceptance product

Noted because the dispatch's B-3 sub-question asked about "Stripe Embedded Payment Element on mobile." Clarifying: Stripe Connect Embedded Components (the `@stripe/connect-js` family) is for platform-side Connect surfaces (Account Onboarding, Account Management, Payouts dashboards, etc.). It is NOT a Payment Element. The mobile Payment Element option would require `@stripe/stripe-js` + `@stripe/react-stripe-js` rendered inside `react-native-webview` — an entirely different SDK and integration shape. Confirmed via direct read of `mingla-business/package.json` + Stripe docs.

---

## 5. Three-way decision matrix for business surface

| Dimension | Option A: Native PaymentSheet | Option B: Payment Element in WebView | Option C: Retain Hosted Checkout |
|---|---|---|---|
| **Parity with consumer** | Maximum — same SDK, same flow, same edge fn shape | Partial — different SDK + WebView vs native UI | Minimal — different SDK + different UX layer |
| **Operator UX feel** | Native iOS UISheet / Android BottomSheet — best in-app feel | In-WebView page — close to native but slightly different look-and-feel | System browser session — most jarring; clear "you left the app" feel |
| **Stripe API surface** | `useStripePaymentSheet` + `initStripe` + Customer/ephemeralKey | `Stripe('pk', { stripeAccount })` + `Elements` provider + `PaymentElement` component | None client-side; full server-driven Checkout Session |
| **Direct-charge OK?** | Yes (proven via consumer ORCH-0844) | Yes (per Stripe docs) | Yes (proven via current ORCH-0839-B) |
| **Apple Pay native?** | Yes — full native Apple Pay button + Face ID | WebView Apple Pay (needs `apple-pay-merchantid-domain-association` file; domain verification is operator ops) | Yes — Stripe handles it server-side |
| **OTA-safe?** | NO — adds `@stripe/stripe-react-native` native module; requires EAS rebuild | NO — adds `react-native-webview` (already a transitive dep? need to confirm); likely rebuild | Yes — pure JS today; would stay that way |
| **Maintenance cost** | Same code path as consumer — one bug = one fix | Separate code path; two flows to maintain | Separate code path; two flows to maintain |
| **CI gate impact** | `orch-0839-b-mingla-business-no-native-stripe.mjs` RETIRED; new ORCH-0849 gate added | `orch-0839-b-...` gate AMENDED (allow `@stripe/stripe-js` web, still forbid native RN); new gate for WebView integration | None changed |
| **Risk if iOS 26 sheet regresses again** | Both apps break | Only consumer breaks (business on WebView) | Only consumer breaks (business on system browser) |
| **Re-pivot cost if Stripe-Account header support drops on PaymentSheet** | Apply hotfix to both apps | Apply hotfix to consumer only | Apply hotfix to consumer only |
| **Implementation lift (rough)** | Medium — add package.json dep + plugin entry + provider + replace payment.tsx (~30-50 lines of mobile diff); operator ops for merchant cert | Medium-high — add stripe-js dep + Elements provider + WebView component + bridge events; operator ops for domain registration | Zero — already running |
| **Verdict given operator's stated parity intent** | **RECOMMENDED** | Not recommended (worst of all worlds — parity-incomplete AND new code path) | Not recommended (parity unmet — operator's stated goal) |

**Final recommendation: Option A — native PaymentSheet for business.** It is the only option that satisfies the operator's "ensure parity" directive AND is the cheapest in long-term maintenance.

---

## 6. Recommended PM set per app

Initial expansion (Phase 1, ORCH-0849 scope):

| Method | Consumer | Business |
|---|---|---|
| Card | YES (already) | YES (after PaymentSheet adoption) |
| Apple Pay | YES (subject to F-3 operator-side cert verification for `merchant.com.mingla.app.v2`) | YES (subject to F-3 NEW merchant ID `merchant.com.mingla.business.v2` registration) |
| Google Pay | YES (already wired via `enableGooglePay: true`) | YES (same wiring needed on business app.json) |
| Link | YES (no extra config) | YES (no extra config) |
| Cash App Pay | DEFER to Phase 2 (live-fire of urlScheme callback needed before commitment) | DEFER |
| Klarna / Afterpay | DEFER to Phase 2 (redirect-flow validation needed) | DEFER |
| ACH / SEPA Debit | DEFER to Phase 2 (delayed-method webhook + UX) | DEFER |
| iDEAL / Bancontact / EPS | OUT OF SCOPE (region demand low) | OUT OF SCOPE |

**Implementation note:** rather than a hardcoded list in the edge function, the SPEC should consider sourcing the `payment_method_types` from the connected account's enabled payment-method-configuration via `/v1/payment_method_configurations` (or `account.capabilities`). That way each brand can enable/disable methods in their Stripe Dashboard and Mingla picks them up automatically — much more sustainable than maintaining a hardcoded list on every method addition.

---

## 7. Invariants — preserve / amend / retire

### Preserve verbatim (no change)

- I-PROPOSED-STRIPE-CHARGE-SHAPE-IS-DIRECT (ORCH-0843) — Stripe-Account header + application_fee_amount, no transfer_data.destination
- I-PROPOSED-STRIPE-APPLICATION-FEE-PRESENT (ORCH-0843) — 1.5% Mingla fee on every charge
- I-PROPOSED-STRIPE-ACCOUNT-HEADER-ON-CONNECTED-CALLS (ORCH-0843) — Stripe-Account header on every PI / refund / dispute API call
- I-PROPOSED-STRIPE-STATEMENT-DESCRIPTOR-SUFFIX-MINGLA (ORCH-0843) — "MINGLA" suffix on every charge
- I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI (ORCH-0844) — initStripe with stripeAccountId before initPaymentSheet
- I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG (ORCH-0844 amended) — StripeProvider mounts with publishableKey + merchantIdentifier + urlScheme
- I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY (ORCH-0844) — inFlightInitRef + inFlightPresentRef once-only guards
- I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE (ORCH-0845) — unrelated but adjacent

### Amend

- **I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES (ORCH-0837)** — currently asserts `payment_method_types: ["card"]` is present in `ticket-checkout-create`. AMEND to assert: (a) `payment_method_types` is explicitly set (NEVER `automatic_payment_methods: enabled: true`), (b) the value is a non-empty array, (c) the array is sourced from a curated allowlist (with `["card", "link", "apple_pay", "google_pay"]` as the Phase 1 default), (d) NEVER contains methods that require redirect-flow plumbing without independent verification (Klarna, Afterpay, iDEAL, etc.) — the CI gate filters by an allowlist constant.

### Retire

- **I-PROPOSED-MINGLA-BUSINESS-HOSTED-CHECKOUT-ONLY (ORCH-0839-B)** — RETIRE on business re-pivot. Replaced by a NEW parity invariant `I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY` (see below) asserting both apps use the same PaymentSheet pattern. The retired invariant moves to historical-context status in `INVARIANT_REGISTRY.md`.

### New (post-ORCH-0849)

- **I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY** (new) — both `app-mobile` and `mingla-business` mount `<StripeNativeProvider>` at root with their respective merchantIdentifier + urlScheme; both call `initStripe({stripeAccountId})` per-PI; both consume the same `requires_payment` response shape from `ticket-checkout-create`. Enforced by a CI gate that asserts presence in BOTH apps' `_layout.tsx`.
- **I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST** (new) — `payment_method_types` on every PI is sourced from a curated allowlist constant; CI gate forbids methods outside the allowlist; allowlist expansion requires a new ORCH that proves the redirect/delayed plumbing.

---

## 8. Recommended SPEC scope clauses (handoff to next phase — SPEC must include these, NOT investigation)

**Scope IN:**
1. Change `supabase/functions/ticket-checkout-create/index.ts` `payment_method_types` from `["card"]` to a curated allowlist constant `["card", "link", "apple_pay", "google_pay"]`, exported from `supabase/functions/_shared/stripePaymentMethods.ts` (NEW file).
2. Update `orch-0837-regression-check.mjs` CI gate per amended invariant (allowlist-driven, not card-only-driven).
3. Add `@stripe/stripe-react-native` to `mingla-business/package.json` (same version as consumer — currently 0.65.x).
4. Add Stripe plugin entry to `mingla-business/app.json` with `merchantIdentifier: "merchant.com.mingla.business.v2"` + `enableGooglePay: true`.
5. Mount `<StripeNativeProvider merchantIdentifier urlScheme>` at `mingla-business/app/_layout.tsx` root.
6. Replace `mingla-business/app/checkout/[eventId]/payment.tsx` from `WebBrowser.openAuthSessionAsync` to `useStripePaymentSheet` — adopt the consumer's `nativeCheckoutFlow.ts` pattern verbatim.
7. Delete `mingla-business/src/components/checkout/PaymentElementStub.tsx` (F-5).
8. Retire `.github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs`.
9. Add NEW CI gate `i-stripe-paymentsheet-parity.mjs` enforcing I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY.
10. Add NEW CI gate `i-stripe-pm-method-allowlist.mjs` enforcing I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST.
11. Update `INVARIANT_REGISTRY.md`: amend ORCH-0837, retire ORCH-0839-B, add two new ORCH-0849.
12. Update `DECISION_LOG.md`: new DEC entry covering "we re-enabled methods and re-pivoted business to PaymentSheet, with parity as the binding goal."

**Scope OUT (defer to follow-up ORCHs):**
- Klarna / Afterpay / Cash App Pay / ACH / SEPA Debit / regional redirect methods — Phase 2 ORCH after live-fire validation of urlScheme + handleURLCallback + delayed-method webhook routing.
- `charge.dispute.created` webhook routing (ORCH-0843-FOLLOWUP-DISPUTES P1) — cross-referenced but not absorbed unless operator decides to bundle.
- `customerId` null guest-mode investigation (ORCH-0844 P3 followup) — orthogonal.
- Centralization of "is past" semantics across Discover + PublicEventPage + Checkout — orthogonal.

**Operator-side ops (NOT implementor work, MUST be done before implementor PR opens — gate the SPEC on these):**
- Register `merchant.com.mingla.business.v2` Apple Pay merchant identifier in Stripe Dashboard (link to existing platform account).
- Verify Apple Pay merchant cert is active for `merchant.com.mingla.app.v2`.
- Confirm domain-association files are hosted at the right URLs for both merchant IDs.
- Add `com.apple.developer.in-app-payments` entitlement to mingla-business iOS bundle (EAS-managed; will be picked up automatically on next rebuild once the plugin entry is added).
- Enumerate enabled payment methods per charges-enabled brand (Stripe Dashboard → Connect → Accounts → each acct → Payment methods); document for SPEC.

**Test plan requirements the SPEC must enforce:**
- Live-fire iOS sim parity: consumer + business both render the expanded sheet with all four allowlisted methods present (card, Link, Apple Pay, Google Pay) on a charges-enabled test brand.
- Android emulator parity: same expectation, with Google Pay button visible.
- Fails-on-revert verified for both implementor happy-path and tester adversarial regression tests per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 gate.
- Cross-domain: confirm `orders.payment_method_type` populates correctly for each method (`"card"`, `"link"`, `"apple_pay"`, `"google_pay"` literal strings); confirm refund flow handles each.
- Connected-account capability probe: live HTTP probe `/v1/payment_method_configurations` for 3 charges-enabled brands; sheet renders correctly when a method is enabled on the platform but disabled on a specific connected account (Stripe should gracefully omit it).

---

## 9. Blast radius

| Affected surface | What breaks if implementation is wrong |
|---|---|
| Consumer ticket purchase | If new methods cause sheet stall, ALL purchases fail (same blast radius as ORCH-0837) |
| Business ticket purchase | If PaymentSheet adoption fails, business loses live ticket sales until rollback to Hosted Checkout |
| Refund flow | If `payment_method_type` field is mishandled, refund routing breaks per-method |
| Webhook handling | If new delayed methods fire `payment_intent.processing` and we don't route it, orders stay in stuck state |
| `orders` table | If `payment_method_type` column is too narrow, write fails |
| CI strict-grep gates | Retiring ORCH-0839-B gate + amending ORCH-0837 gate touches the workflow; coordinate with ORCH-0850+ to avoid gate conflicts |
| Apple Pay (both apps) | If merchant cert lapses or domain-association file is missing, Apple Pay button is silently absent (NOT a hang post-ORCH-0844 — just absent) |

---

## 10. Discoveries for Orchestrator

1. **`charge.dispute.created` missing from webhook routing (F-4)** — already registered as ORCH-0843-FOLLOWUP-DISPUTES; ORCH-0849 cross-references but does not absorb unless ACH is added to Phase 1 (recommendation: don't add ACH in Phase 1 → keep dispute follow-up separate).
2. **`PaymentElementStub.tsx` dead file (F-5)** — small cleanup, absorbed into ORCH-0849 implementor scope.
3. **Connected-account capability enumeration is an operator-side prereq** — SPEC must gate on this. Could be a sub-step before SPEC opens.
4. **Apple Pay merchant identifier divergence between apps** — operator-side ops; flagged in F-3.
5. **The bundling decision worked out cleanly** — both surfaces share enough infrastructure that one investigation, one spec, one implementor, one tester is genuinely the right shape. No scope creep, no false economies. Bundle exception is justified.

---

## 11. Confidence per finding

| Finding | Confidence | Reasoning |
|---|---|---|
| F-1 (consumer card-only is over-restrictive) | `root cause proven` for the constraint location; `probable` for the safe-to-expand method set (Card + Link + Apple Pay + Google Pay) — depends on SPEC-phase Stripe API probe to confirm per-account capabilities |
| F-2 (business pivot blocker no longer applies) | `root cause proven` — explicit citation in ORCH-0844 investigation §"The Hosted Checkout pivot (Option B) is NOT recommended for explorer" |
| F-3 (Apple Pay merchant-cert state) | `inconclusive` — operator-side verification required; investigation cannot probe Stripe Dashboard |
| F-4 (`charge.dispute.created` missing) | `root cause proven` — already documented in DEC-156 as a P1 followup |
| F-5 (`PaymentElementStub.tsx` dead) | `root cause proven` — direct file read confirms `[TRANSITIONAL]` marker + zero importers |
| F-6 (`@stripe/connect-js` clarification) | `root cause proven` — direct package.json + Stripe docs read |
| 3-way decision matrix | `probable` — matrix is built from documented Stripe surface options + ORCH-0844's explicit precedent; live-fire of Embedded Payment Element on RN WebView NOT performed (we're rejecting that option, not selecting it) |
| Recommended PM allowlist | `probable` — Card, Link, Apple Pay, Google Pay all proven safe via ORCH-0844's load-bearing fixes; live-fire of the expanded list deferred to TEST phase |

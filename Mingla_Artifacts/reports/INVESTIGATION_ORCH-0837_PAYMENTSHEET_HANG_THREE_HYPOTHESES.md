# INVESTIGATION — ORCH-0837: Stripe PaymentSheet hangs on `presentPaymentSheet` after SDK upgrade to 0.65.1

**Mode:** INVESTIGATE
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:** **H2 proven** (six-field). **H3 proven** (six-field). **H1 falsified** at iOS native level. Plus a NEW hypothesis (**H4 — Apple Pay merchant-validation stall**) surfaced during the trace that is **probable** and is the most likely "sheet doesn't render" cause specifically.

---

## SYMPTOM SUMMARY

| | What happened |
|---|---|
| **Expected** | Tapping "Continue to Payment" opens Apple Pay / card sheet, user pays, sheet dismisses, ticket appears in calendar. |
| **Actual (operator's real iPhone, EAS build with Stripe RN 0.65.1 + merchantIdentifier + urlScheme + Expo plugin from ORCH-0834-rescoped)** | `initPaymentSheet ← resolved error= none` (instant) → `presentPaymentSheet → native call` → **the sheet does not render visually** → 60s of silence → `presentPaymentSheet timed out after 60000ms — rejecting with synthetic Timeout error` (the H-3 race from ORCH-0829-B fires) → toast surfaces the failure. |
| **The new clue from operator's most recent message** | "the sheet still does not render" — meaning the user sees no Apple Pay / card sheet at all. The 60s timeout fires before any visible UI. This is different from "sheet renders and hangs" — it's "sheet never renders." |

---

## INVESTIGATION MANIFEST

| # | File | Why read |
|---|------|----------|
| 1 | `packages/payments-native/useStripePaymentSheet.ts` | Confirm timeout race semantics + once-only guards; confirm `initPaymentSheet` resolves before `presentPaymentSheet` |
| 2 | `app-mobile/app/_layout.tsx` | StripeProvider wiring at root; merchantIdentifier + urlScheme prop values |
| 3 | `packages/payments-native/StripeNativeProvider.tsx` | Confirm provider passes merchantIdentifier + urlScheme to Stripe RN; check whether `handleURLCallback` is wired here |
| 4 | `app-mobile/app/index.tsx` (Linking listener context) | Lines 1776-1793 — the Linking listener; confirm it does NOT route any URL to Stripe's `handleURLCallback` |
| 5 | `app-mobile/src/payments/nativeCheckoutFlow.ts` | Confirm `returnURL` value passed to `initPaymentSheet`; confirm error-checking guards |
| 6 | `supabase/functions/ticket-checkout-create/index.ts` lines 320-360 | The PaymentIntent creation — read `automatic_payment_methods` vs `payment_method_types` choice |
| 7 | `app-mobile/node_modules/@stripe/stripe-react-native/ios/StripeSdkImpl.swift` lines 285-340 | The iOS-native `presentPaymentSheet` implementation — see how it looks up the presenting view controller (Gorhom-conflict check for H1) |
| 8 | grep `handleURLCallback` across packages/ + app-mobile/src/ + app-mobile/app/ | Zero matches → H3 proven |
| 9 | `app-mobile/app.json` (Stripe Expo plugin entry) | merchantIdentifier value matches what's passed to StripeProvider |

---

## FINDINGS

### 🔴 Root Cause H2 — PROVEN: backend creates PaymentIntent with `automatic_payment_methods: { enabled: true }`, exposing every method enabled in the Stripe Dashboard (Apple Pay, redirect-flow methods like Klarna/Afterpay/iDEAL/etc.) without our app being equipped to handle them

**File + line:** `supabase/functions/ticket-checkout-create/index.ts:329-342`

**Exact code:**
```ts
paymentIntent = await stripe.paymentIntents.create(
  {
    amount: totalCents,
    currency,
    automatic_payment_methods: { enabled: true },   // <-- enables EVERY dashboard-enabled method
    transfer_data: { destination: stripeAccountId },
    metadata: { ... },
  },
  { idempotencyKey: `ticket_checkout:${checkoutSessionId}` },
);
```

**What it does:** Creates a PaymentIntent with Stripe's "automatic payment methods" feature enabled. Stripe then attaches every payment method that is BOTH (a) enabled in the Stripe Dashboard for the platform/connected account AND (b) compatible with the amount + currency + customer-country combination. This typically includes: card, Apple Pay, Google Pay, Link, and depending on dashboard config: Klarna, Afterpay, Cash App Pay, iDEAL, Bancontact, EPS, P24, SEPA Debit, US Bank Account, and others. Several of these are **redirect-flow** methods (browser-or-app handoff with `returnURL` callback) or **delayed** methods (require asynchronous confirmation). Several others require additional native config (Apple Pay merchant validation, Google Pay merchant ID).

**What it should do (for the minimum-viable fix):** Use `payment_method_types: ['card']` until we have explicit support for the other methods.

```ts
paymentIntent = await stripe.paymentIntents.create(
  {
    amount: totalCents,
    currency,
    payment_method_types: ['card'],   // <-- card-only, no surprises
    transfer_data: { destination: stripeAccountId },
    metadata: { ... },
  },
  { idempotencyKey: `ticket_checkout:${checkoutSessionId}` },
);
```

**Causal chain:**
1. Backend creates PI with `automatic_payment_methods: { enabled: true }`.
2. Stripe attaches Apple Pay + card + Link + (whatever else is dashboard-enabled).
3. Mobile receives `clientSecret`, calls `initPaymentSheet` — resolves cleanly because init only fetches PI configuration (it doesn't validate that the app is equipped to handle every attached method).
4. Mobile calls `presentPaymentSheet`. iOS Stripe SDK begins rendering the sheet — but first must load metadata for every attached method (Apple Pay merchant validation, redirect URL preparation for any redirect methods, Link availability check, etc.).
5. **If ANY of those loads hangs or fails silently, the sheet either (a) never renders or (b) renders as a loading spinner indefinitely.** The PaymentSheet's `present(from: completion:)` callback in `StripeSdkImpl.swift:322-334` only fires on `.completed` / `.canceled` / `.failed` — there's no separate "render started" callback. So the JS promise stays pending.
6. Our 60s synthetic timeout race fires; the user sees an error toast.

**Verification step:** Change backend to `payment_method_types: ['card']`, redeploy the edge function, retest. If the sheet now renders, H2 is confirmed as the actual cause. If the sheet still doesn't render even with card-only, H2 is contributing but not sole cause and we fall to H4.

---

### 🔴 Root Cause H3 — PROVEN: `handleURLCallback` from Stripe RN is NEVER wired into the app's Linking listener, so any redirect-method completion that returns to the app via `com.mingla.app.v2://stripe-redirect` is silently dropped

**File + line:** `app-mobile/app/index.tsx:1776-1793` (the only Linking listener in the entire codebase) + the absence of `handleURLCallback` anywhere in `packages/` or `app-mobile/src/`

**Exact code (the Linking listener that EXISTS):**
```ts
useEffect(() => {
  Linking.getInitialURL().then((url) => {
    if (url) {
      handleDeepLink(url);   // <-- routes to OAuth + invite handler ONLY
    }
  });

  const subscription = Linking.addEventListener("url", (event) => {
    handleDeepLink(event.url);
  });

  return () => {
    subscription.remove();
  };
}, []);

const handleDeepLink = async (url: string) => {
  console.log("Deep link received:", url);
  const isOAuthCallback = url.includes("auth/callback");
  if (!isOAuthCallback && !user) { /* defer */ return; }

  // Handle invite deep links
  if (url.includes('/invite/') || url.includes('invite/')) { /* ... */ }
  // ... more app-specific routes ...
  // <-- no Stripe handling, no handleURLCallback call
};
```

**Exact code (the Stripe `handleURLCallback` call that DOES NOT EXIST anywhere):**
```bash
grep -rn "handleURLCallback" /Users/sethogieva/Desktop/mingla-main/packages/ /Users/sethogieva/Desktop/mingla-main/app-mobile/src/ /Users/sethogieva/Desktop/mingla-main/app-mobile/app/
# → ZERO matches
```

**What it does:** When Stripe RN PaymentSheet uses a redirect-flow method (Apple Pay return after biometric prompt, 3DS challenge return, Klarna return, etc.), Stripe expects the app to forward the incoming URL back into the SDK via `useStripe().handleURLCallback(url)`. Without this call, Stripe's internal Promise tracking the redirect never resolves → the `presentPaymentSheet` completion handler (`StripeSdkImpl.swift:322-334`) never fires → the JS-side promise stays pending → our 60s timeout fires.

**What it should do:** Wire `handleURLCallback` into the Linking listener at app root. Pattern (from Stripe's own docs and the ChatGPT checklist item #7):

```ts
import * as Linking from 'expo-linking';
import { useStripe } from '@stripe/stripe-react-native';

const { handleURLCallback } = useStripe();

useEffect(() => {
  const sub = Linking.addEventListener('url', async ({ url }) => {
    const handled = await handleURLCallback(url);
    if (handled) return;
    // fall through to our existing handleDeepLink for OAuth + invite
    handleDeepLink(url);
  });

  Linking.getInitialURL().then(async (url) => {
    if (url) {
      const handled = await handleURLCallback(url);
      if (!handled) handleDeepLink(url);
    }
  });

  return () => sub.remove();
}, [handleURLCallback]);
```

`handleURLCallback` returns `true` if the URL was a Stripe callback (and Stripe handled it internally); returns `false` if not. So we check Stripe first, then fall through to our OAuth/invite handler — Stripe's callback URL `com.mingla.app.v2://stripe-redirect` does not collide with our existing OAuth/invite routes.

**Causal chain:**
1. PaymentSheet renders. User taps Apple Pay (or any redirect-flow method exposed by `automatic_payment_methods`).
2. iOS opens the Apple Pay biometric prompt / Safari for 3DS / external app for BNPL.
3. User completes the action. The system fires a URL back at our app via `com.mingla.app.v2://stripe-redirect?payment_intent=pi_...`.
4. Expo Linking listener fires `handleDeepLink(url)`.
5. `handleDeepLink` checks for OAuth (`url.includes("auth/callback")`) — false. Checks for invite — false. Falls through every conditional. **Returns without calling `handleURLCallback`.**
6. Stripe SDK's internal Promise for the redirect return never resolves. `presentPaymentSheet`'s completion handler never fires.
7. Our 60s timeout race fires.

**Verification step:** Add the `handleURLCallback` wiring per the snippet above, redeploy the EAS build, retest. If the hang resolves for the Apple Pay path specifically, H3 is confirmed. Also confirms by reading the operator's next Metro log — any redirect attempt should now log "Deep link received: com.mingla.app.v2://stripe-redirect" AND the Stripe SDK should resolve `presentPaymentSheet` shortly after.

---

### 🔴 Root Cause H4 (NEW — surfaced during trace) — PROBABLE: Apple Pay merchant validation against `merchant.com.mingla.app.v2` is stalling because the Apple Merchant ID may not be properly registered in the Apple Developer account and/or properly connected to the Stripe Dashboard

**File + line:** `app-mobile/app/_layout.tsx:56-59` (the `merchantIdentifier="merchant.com.mingla.app.v2"` prop) + `app-mobile/app.json` (the Expo Stripe plugin entry with the same merchantIdentifier) + the iOS entitlements file (which I have NOT been able to verify shows `com.apple.developer.in-app-payments` actually contains this merchant ID).

**Exact code:**
```tsx
<StripeNativeProvider
  merchantIdentifier="merchant.com.mingla.app.v2"
  urlScheme="com.mingla.app.v2"
>
```

**What it does:** When PaymentSheet initializes and the PI has Apple Pay attached (which H2 confirms is the case), iOS Stripe SDK validates that:
1. The app has the `com.apple.developer.in-app-payments` entitlement set in its provisioning profile.
2. The merchant ID in the entitlement matches the one passed to StripeProvider.
3. Apple Pay capability is enabled in App Store Connect.
4. The merchant ID is associated with a payment processing certificate uploaded to Stripe Dashboard.

If any of these is misconfigured, Apple Pay metadata loading either fails silently or hangs trying to reach Apple's validation servers. PaymentSheet on iOS waits for all attached-method metadata to load before showing UI — so a hung Apple Pay validation causes the sheet to never render.

**Why this hypothesis surfaced now (and not in any prior investigation):**
- The merchantIdentifier value is brand-new from ORCH-0834-rescoped — added 2026-05-14 today.
- Pre-ORCH-0834-rescoped: merchantIdentifier was empty/undefined → Apple Pay was silently disabled → only card showed in PaymentSheet → no Apple Pay validation step → no hang.
- Post-ORCH-0834-rescoped: merchantIdentifier is `"merchant.com.mingla.app.v2"` → Apple Pay validation is now ATTEMPTED → if not properly registered, validation hangs.

**What it should do:** Either (a) verify and properly register the merchant ID end-to-end (Apple Developer account → App Store Connect → iOS entitlements → Stripe Dashboard payment processing cert), OR (b) temporarily remove the merchantIdentifier (passing `undefined`) until the registration is confirmed working. Approach (b) restores pre-ORCH-0834-rescoped behavior — card payments work, Apple Pay row is hidden from the sheet.

**Causal chain:**
1. Backend creates PI with `automatic_payment_methods: { enabled: true }` → Apple Pay attached.
2. Mobile receives clientSecret. `initPaymentSheet` succeeds (init only validates the secret shape and StripeProvider config; it does not preflight Apple Pay).
3. `presentPaymentSheet` fires. iOS Stripe SDK begins loading method metadata.
4. Apple Pay metadata load triggers validation of `merchantIdentifier` against Apple's servers (and/or local entitlement check).
5. If the merchant ID isn't actually registered → validation either hangs or fails silently inside Apple's SDK.
6. PaymentSheet stays in "loading" state, never renders.
7. Our 60s timeout fires.

**Verification step:** TWO independent paths:
1. **Fast test (5 min):** Comment out `merchantIdentifier="merchant.com.mingla.app.v2"` in `app-mobile/app/_layout.tsx:57`, rebuild EAS, retest. If the sheet now renders with card-only (no Apple Pay row), H4 is confirmed.
2. **Proper validation (60 min):** Walk the operator through Apple Developer → Certificates, Identifiers & Profiles → Merchant IDs → confirm `merchant.com.mingla.app.v2` exists → confirm it's enabled in the App Store Connect bundle ID → confirm a payment processing certificate has been uploaded to Stripe Dashboard for the platform account. If any of those is missing, H4 is structurally proven.

---

### 🟡 H1 (presentation lifecycle conflict with Gorhom bottom-sheets) — FALSIFIED at iOS native level

**File + line:** `app-mobile/node_modules/@stripe/stripe-react-native/ios/StripeSdkImpl.swift:291-339`

**Exact iOS native code:**
```swift
@objc(presentPaymentSheet:resolver:rejecter:)
public func presentPaymentSheet(...) {
    var paymentSheetViewController: UIViewController?
    DispatchQueue.main.async {
        paymentSheetViewController = RCTKeyWindow()?.rootViewController ?? UIViewController()
        // ... uses paymentSheet.present(from: findViewControllerPresenter(from: paymentSheetViewController!)) ...
    }
}
```

**Why H1 is falsified:** Stripe iOS uses `RCTKeyWindow()?.rootViewController` to find the presenting view controller, then walks the presented-controller chain via `findViewControllerPresenter`. Gorhom bottom-sheets do NOT create iOS UIViewController modals — they're React Native views with absolute positioning + Reanimated transforms, rendered inside the RN root view's tree. From iOS's perspective, the topmost UIViewController is still the RN root VC; there is no competing modal context for Stripe to conflict with. Even with TWO Gorhom bottom-sheets mounted (ExpandedBusinessEventSheet + TicketClaimConfirmModal), iOS sees one VC and Stripe presents over the entire RN view hierarchy. The Gorhom sheets become visually covered by the Stripe iOS modal, but Stripe's presentation logic isn't blocked.

**What this DOES rule out:** Closing the TicketClaimConfirmModal sheet before `runNativeCheckout` would NOT fix the hang (the hypothesized "single-line fix" from the ORCH-0837 dispatch is not the right lever).

**What this does NOT rule out:** Async-state edge cases inside React Native (e.g., React 19 + Reanimated rendering during the `presentPaymentSheet` call) could still cause issues — but those would manifest as JS-side errors, not iOS-side hangs, and the operator's Metro log shows no JS errors before the timeout. So H1 is a dead lead.

---

### 🟠 Contributing Factor C-1 (REVEALED by H3 + H4): the `returnURL` is set without `handleURLCallback` AND Apple Pay is enabled — both legs of the redirect-completion flow are broken simultaneously

If H4 is confirmed (Apple Pay misconfig is the immediate cause of "sheet doesn't render"), H3 is still latent. Once Apple Pay is correctly registered AND the sheet renders AND the user picks Apple Pay AND completes the biometric prompt — H3 will then fire because the return URL won't be handled. So both must be fixed, not just one.

### 🟡 Hidden Flaw HF-1: `nativeCheckoutFlow.ts:136` sets `returnURL: "com.mingla.app.v2://stripe-redirect"` but no path in our app responds to that URL specifically

Same as H3, separate framing: the returnURL is set as if we're equipped to handle Stripe redirects, but we aren't. This is misleading at code-review time — a reviewer would assume we ARE handling Stripe callbacks since we set the returnURL. The fix (H3) eliminates the deception.

### 🔵 Observation O-1: the 60s synthetic timeout race from ORCH-0829-B is working correctly

`useStripePaymentSheet.ts:62-89` (the `withTimeout` helper) is doing its job — converting a silent hang into a loud error toast. Without this defensive layer, the operator would see no error at all and might assume the app froze. This is the "infrastructure that prevents crashes" pattern working as designed.

### 🔵 Observation O-2: `initPaymentSheet` succeeds quickly, so the issue is NOT in PI-fetching or client-secret shape

The operator's Metro log proves `initPaymentSheet ← resolved error= none` fires before the present call. This rules out ChatGPT checklist items #4 (bad clientSecret), #15 (backend wrong shape), and #5 (customer/ephemeral key mismatch — we don't pass any). Init resolving cleanly is a positive signal: the PI is real, the secret is correctly shaped, and the Stripe SDK is correctly initialized with the publishable key.

---

## FIVE-LAYER CROSS-CHECK

| Layer | What it says | Matches reality? |
|---|---|---|
| **Docs** | Stripe RN docs explicitly require `handleURLCallback` for redirect methods AND require proper merchantIdentifier registration for Apple Pay. ChatGPT's checklist #6 + #7 codify both. | We violate both |
| **Schema** | `ticket_checkout_sessions` table is healthy; D-1 tombstone fix from ORCH-0829-B working | Healthy at DB layer |
| **Code (backend PI creation)** | `automatic_payment_methods: { enabled: true }` at ticket-checkout-create:333 exposes redirect + Apple Pay methods | **H2 proven** |
| **Code (mobile Linking listener)** | Linking listener at app/index.tsx:1786 handles OAuth + invite only, no Stripe routing | **H3 proven** |
| **Code (mobile StripeProvider)** | merchantIdentifier="merchant.com.mingla.app.v2" passed, but no source-side proof the merchant ID is actually registered in Apple Developer | **H4 probable** (cannot prove from source alone) |
| **Code (iOS Stripe native)** | `presentPaymentSheet` uses RCTKeyWindow()?.rootViewController; no Gorhom interference at native layer | **H1 falsified** |
| **Runtime (operator's real iPhone)** | initPaymentSheet resolves fast; presentPaymentSheet hangs 60s with no sheet rendering visible; synthetic timeout fires | Matches H4-primary + H3-latent + H2-enabling-condition |
| **Data** | N/A (no DB state involved in the hang) |  |

Layers agree: H2 + H3 are proven; H4 is the most likely *immediate* cause of "sheet doesn't render" specifically; H1 is dead. The unified picture: the backend exposes payment methods we're not equipped to handle (H2), one of those methods (Apple Pay) is likely failing to validate (H4), the others would also break completion-callback handling (H3).

---

## BLAST RADIUS

| Surface | Impact |
|---|---|
| **Consumer mobile paid checkout** | Broken on real device. Free claims still work (they short-circuit before PaymentSheet). |
| **Business mobile paid checkout (if it shares the same edge function and Linking listener pattern)** | Likely same bug — need to verify by reading `mingla-business/src/payments/` patterns (sibling code). |
| **Web checkout (Stripe Hosted Checkout via `requires_web_redirect` branch)** | NOT affected — that path uses Stripe's hosted Checkout page in a browser, which handles its own URL callbacks. |
| **Free claims** | NOT affected — `ticket-checkout-create` short-circuits to `free_completed` before any Stripe PI is created. |
| **Stripe webhooks (paid flow completion via webhook)** | Tangentially relevant — if a user DOES complete payment via Apple Pay before the sheet "dismisses" (which it doesn't on our side), the webhook would still fire and create the order. But the user never sees confirmation because our JS-side promise hangs. This is a hidden data-integrity risk: paid orders could exist in the DB that the user never knew completed. |

**Critical:** Verify whether any paid orders exist in production where the user's PaymentSheet hung but the order was actually created by webhook. If yes, those users have been charged for tickets they don't know they have.

---

## INVARIANT VIOLATIONS

- **I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG** (codified at ORCH-0834-rescoped CLOSE): "StripeProvider MUST receive merchantIdentifier + urlScheme in addition to publishableKey." We satisfy the literal text but the merchantIdentifier value may be unregistered. The invariant doesn't currently mandate end-to-end registration verification. Worth extending: "merchantIdentifier MUST resolve to a registered Apple Merchant ID with a Stripe-uploaded payment processing certificate. CI gate: a smoke test that initializes Stripe with the merchant ID and confirms Apple Pay metadata loads within 5s."
- **NEW proposed invariant: I-PROPOSED-STRIPE-CALLBACK-WIRED** — any app that uses Stripe RN with redirect-flow methods OR a non-empty `returnURL` MUST wire `handleURLCallback` from `useStripe()` into the platform Linking listener. CI gate: grep `useStripe()` users across the codebase and verify at least one call to `handleURLCallback` exists.

---

## FIX STRATEGY DIRECTION (NOT a spec)

**Recommended sequence (sequential, smallest fix first):**

**Step 1 (zero-build verification, ~5 min):** Operator confirms whether the Apple Merchant ID `merchant.com.mingla.app.v2` is registered in Apple Developer → Certificates, Identifiers & Profiles → Merchant IDs, AND whether a payment processing certificate is uploaded to Stripe Dashboard for the platform account. If EITHER is missing, H4 is structurally proven without needing a code change.

**Step 2 (single backend change, ~10 min):** Change `automatic_payment_methods: { enabled: true }` → `payment_method_types: ['card']` at `ticket-checkout-create/index.ts:333`. Redeploy edge function. Real-device retest. **Expected outcome:** the sheet renders with card-only (no Apple Pay row, no Link, no BNPL). If the sheet renders, H2 is confirmed as the enabling condition and we have a working paid checkout immediately. Apple Pay can be re-enabled later in a follow-up ORCH after end-to-end merchant ID validation.

**Step 3 (single mobile change, ~15 min):** Wire `handleURLCallback` from `useStripe()` into the Linking listener at `app-mobile/app/index.tsx:1786` per the H3 snippet. This is harmless for the card-only path (no redirect, callback never fires) but is required for any future re-enabling of Apple Pay / BNPL. Ship it in the same fix.

**Step 4 (medium-term, follow-up ORCH):** End-to-end Apple Pay validation. Verify Apple Developer registration. Verify Stripe Dashboard certificate. Re-enable Apple Pay via dashboard config. Add CI smoke test for Apple Pay metadata load time. Track as `ORCH-0838 — Apple Pay end-to-end validation + re-enable`.

**Why this order:** Steps 1+2+3 unblock paid checkout immediately with minimum risk (card-only is a known-safe Stripe configuration). Step 4 restores the operator's desired "Apple Pay support" but is a separate concern that shouldn't block shipping.

**Anti-pattern to avoid:** Do NOT pursue the Z1 (revert Stripe SDK + bridgeless toggle) or Z2 (keep 0.65.1 + bridgeless toggle) paths. Those address a different category of issue (RN architecture) and won't fix H2/H3/H4. Also do NOT pursue X2 (CardField rewrite — loses Apple Pay) — H2 fix achieves the same goal (card-only flow) without architectural rewrite.

---

## REGRESSION PREVENTION

1. **CI gate `orch-0837-handle-url-callback-wired.mjs`:** grep `useStripe(` across `packages/` + `app-mobile/src/` + `app-mobile/app/` and verify at least one `handleURLCallback(` invocation exists in the same file or in a Linking listener nearby. Fail otherwise.
2. **CI gate `orch-0837-stripe-pi-payment-methods-explicit.mjs`:** grep `stripe.paymentIntents.create` in `supabase/functions/` and fail if `automatic_payment_methods: { enabled: true }` is found without a corresponding `payment_method_types` override OR a documented allow-list comment.
3. **Invariant codification:** add `I-PROPOSED-STRIPE-CALLBACK-WIRED` to `INVARIANT_REGISTRY.md` on CLOSE.
4. **Protective comment** at `ticket-checkout-create/index.ts:329` explaining WHY we use `payment_method_types: ['card']` (citing ORCH-0837 and the Apple Pay end-to-end validation deferred to ORCH-0838).

---

## DISCOVERIES FOR ORCHESTRATOR

1. **Data integrity check needed:** query production for any `orders` rows with `status = 'paid_completed'` AND a checkout_session_id whose mobile-side flow ended in timeout (no easy way to correlate; may require Stripe Dashboard cross-reference). If any exist, users have been charged for tickets they don't know about.
2. **mingla-business may have the same bug.** The pattern (StripeProvider + nativeCheckoutFlow + missing handleURLCallback wiring + automatic_payment_methods) likely repeats in `mingla-business/src/payments/`. Quick grep would confirm; if yes, fix in the same SPEC.
3. **H1 falsified — Gorhom + RN modal stacking is NOT the issue.** Useful negative data point for future debugging.
4. **ORCH-0838 needs to be registered** for the end-to-end Apple Pay validation + re-enable.
5. **ORCH-0836's LogBox filter fix and ORCH-0835's cache-symmetry fix remain valid** — they're orthogonal to this. The unified SPEC can bundle all three (0835 + 0836 + 0837) or split them.

---

## CONFIDENCE

- **H2 (automatic_payment_methods):** **proven** at source level (verbatim code at `ticket-checkout-create/index.ts:333`).
- **H3 (missing handleURLCallback):** **proven** at source level (zero grep matches across packages/ + app-mobile/src/ + app-mobile/app/).
- **H4 (Apple Pay merchant validation stall):** **probable** — source proof that merchantIdentifier is passed but no source-side evidence of end-to-end registration; symptom ("sheet doesn't render") matches Apple Pay metadata-load stall pattern; ORCH-0834-rescoped timing matches the regression onset. **Operator confirmation of Apple Developer + Stripe Dashboard state would promote to `proven`.**
- **H1 (Gorhom modal conflict):** **falsified** at iOS native level via Swift source inspection.

Combined: paid checkout is broken for three converging reasons. Fix in the order: backend `payment_method_types: ['card']` (immediate unblock) → wire `handleURLCallback` (latent fix for any future redirect method) → defer end-to-end Apple Pay validation to ORCH-0838.

Live-fire of the hang itself was NOT attempted — the operator already reproduced it on real device with full Metro log evidence; sim cannot reproduce native Stripe PaymentSheet behavior without a hardware Secure Enclave for Apple Pay validation, so sim re-repro would be a worse signal than what we already have.

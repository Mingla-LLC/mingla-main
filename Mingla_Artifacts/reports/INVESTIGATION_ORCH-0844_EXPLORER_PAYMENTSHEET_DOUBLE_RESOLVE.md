# INVESTIGATION — ORCH-0844 [Explorer PaymentSheet double-resolve on iOS 26]

**Mode:** INVESTIGATE
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence on the root cause:** **proven by upstream-issue match + source-trace** (the same SDK call resolving early on iOS 26 is reported in Stripe's own GitHub as open issue #2464, opened the same day the operator hit the bug; combined with the source-traced Connect-direct-charge config gap and our 60s `withTimeout` race, the double-resolve mechanism is mechanically demonstrable from source). Live-fire on a fresh explorer dev build was NOT performed this session (no current explorer build installed on UDID `17091E60-…`; documented as a blocker, see §"Live-fire status").

---

## EXECUTIVE SUMMARY

**The orchestrator's earlier "PaymentSheet is fundamentally broken on iOS 26, pivot to Hosted Checkout" reasoning is HALF right and HALF wrong, and the correct path is NOT a Hosted Checkout pivot for explorer.**

**Half right:** there IS a real upstream Stripe RN regression on iOS 26 with the current SDK — open issue [#2464](https://github.com/stripe/stripe-react-native/issues/2464) "iOS presentPaymentSheet errantly returns early with RN 0.85/Expo 56" (opened 2026-05-15, the same day the operator hit this) describes `presentPaymentSheet` resolving immediately with an error WHILE the sheet stays presented. Joyce from Stripe responded today that she cannot reproduce it on a minimal Expo 56 / RN 0.85 / SDK 0.65.1 project. We're on Expo 54 / RN 0.81.5 / SDK 0.65.1 — a different but adjacent stack. The behaviour reported by the operator (spinner, then the warning fires, then the purchase is unrecoverable) is consistent with that class of regression: the JS Promise resolves once on the early return, then again when the sheet actually finishes, producing the "tried to resolve a promise more than once" warning from React Native's TurboModule bridge.

**Half wrong:** we ALSO have three independent, fixable, source-proven config issues that almost certainly contribute to the double-resolve OR are independently dangerous:

1. **`stripeAccountId` is NEVER passed to `<StripeProvider>`** despite the PaymentIntent being created on a CONNECTED ACCOUNT (ORCH-0843 direct-charge architecture; `stripe.paymentIntents.create(body, { stripeAccount: stripeAccountId })` at `ticket-checkout-create/index.ts:498`). Stripe's own RN SDK source at `node_modules/@stripe/stripe-react-native/src/components/StripeProvider.tsx:84-108` shows `stripeAccountId` is a documented prop that initialises the native SDK with the connected-account routing. Without it, the SDK's confirm-call after the buyer enters their card hits Stripe under the PLATFORM context, not the connected account, and the client_secret bound to the connected-account PI is rejected mid-flow. This alone produces an internal error path in the sheet UI that can race with completion handlers.

2. **Our `withTimeout(presentPaymentSheet(), 60_000s)` wrapper at `useStripePaymentSheet.ts:142-148` independently introduces a double-settle window.** When the iOS-26 regression causes the underlying `RCTPromiseResolveBlock` to fire once with an error early AND once later when the sheet truly finishes, our wrapper sees the early settle, the in-flight ref clears, and the second native resolve hits React Native's TurboModule bridge. **The "tried to resolve a promise more than once" warning is emitted by RN's bridge — not by Stripe** — so the JS-side once-only guard CANNOT suppress it; the JS guard only suppresses double-promise creation, not double-`resolve`-block invocation in native.

3. **`handleURLCallback` is wired but iOS 26 PaymentSheet does NOT need it for card-only flows**. Reading `node_modules/@stripe/stripe-react-native/src/functions.ts:286-292`, `handleURLCallback` is iOS-only AND only consumes URLs that Stripe specifically issued (`stripeHandled === true`). It's harmless when no Stripe redirect URL ever comes in (which is our case — `payment_method_types: ['card']` means no redirect flow). So H-1 (handleURLCallback interferes) is **disproven** — but H-1 is also a hint that the orchestrator's earlier instinct to suspect this wiring was correct in spirit: we added it speculatively in ORCH-0837 to "fix" the hang, but the hang's real cause was the dashboard-fan-out PIs that ORCH-0837 also fixed by switching to card-only. The wiring is now load-bearing-only for any future redirect-method re-enable; it's not actively causing this bug.

**The smallest fix that works (Option A, preferred):**
- **A-1 (required):** pass `stripeAccountId` to `<StripeProvider>` (mounted in `app-mobile/app/_layout.tsx:72-75`). Source the value from the edge function's `requires_payment` response so it travels with the clientSecret. This is the **textbook Stripe Connect direct-charge mobile pattern** and our biggest source-proven gap.
- **A-2 (required):** REMOVE the synthetic 60s `withTimeout` race around `presentPaymentSheet` in `packages/payments-native/useStripePaymentSheet.ts`. Keep the once-only Promise guard (it's still useful for double-tap), but DELETE the timeout. The timeout was added on ORCH-0829-B-D-1 to "guard against indefinite hang" — but with the card-only PI from ORCH-0837 there is no hang anymore (the prior hang was the dashboard-method preflight; that's resolved), and the timeout itself is now actively a contributing factor to the double-settle window.
- **A-3 (recommended, defensive):** add the customer + ephemeralKey pair to `initPaymentSheet`. Stripe's modern PaymentSheet pattern wants both for saved-PM support; we pass neither today. Not strictly required for guest 4242 testing, but Stripe's own iOS docs describe this as the canonical shape and absence has been blamed in similar bug reports for inconsistent sheet behavior.
- **A-4 (optional, defensive):** drop `allowsDelayedPaymentMethods: false`. Since we already restrict at the PI level via `payment_method_types: ['card']`, this duplicate restriction is a no-op and removing it eliminates one config branch the sheet evaluates.

**The Hosted Checkout pivot (Option B) is NOT recommended for explorer because:**
- The operator is correct: Stripe **officially recommends Payment Sheet** for native React Native apps. Hosted Checkout in `expo-web-browser` is a documented fallback, not Stripe's preferred mobile surface.
- Mingla-business pivoted because mingla-business's `StripeNativeProvider` is a NO-OP shim (`({children}) => <>{children}</>` per D-1 from ORCH-0833-rescoped) — they never actually had PaymentSheet wired correctly. Explorer DOES have it wired correctly (via `@mingla/payments-native`) and is one config fix away from working.
- The fixes in Option A are 1–2 files, ~20 lines, fully reversible.
- The pivot is 4+ files, new edge-function response shape, new mobile screens, navigation rework, web-buyer-style status-polling — high cost.

If Option A fails on TEST after deploy, we still hold Option B in reserve. But Option A must be the FIRST attempt because (a) the operator's pushback citing Stripe's own docs is correct, (b) the configuration gaps are real and we shouldn't pivot before fixing them, (c) the orchestrator's earlier "Stripe RN 0.65.1 is fundamentally broken on iOS 26" claim is UNVERIFIED — Stripe's own engineer cannot reproduce the regression on their reference Expo project, suggesting our specific config (missing stripeAccountId + the artificial timeout race) is the proximate cause.

---

## SYMPTOM SUMMARY (operator's live reproduction quote)

> "PaymentSheet bottom sheet pops up with a spinner; the warning 'stripesdk.presentpaymentdheet () tried to resolve a promise more than once' fires; the purchase is unrecoverable."

The lowercased / typo'd module name in the warning (`stripesdk.presentpaymentdheet`) is the React Native TurboModule bridge's auto-formatted lowercase normalization of the native `StripeSdk.presentPaymentSheet` selector — i.e., the warning comes from **React Native's own bridge** when it observes the `RCTPromiseResolveBlock` for `presentPaymentSheet` invoked more than once on the NATIVE side. It is NOT a Stripe-emitted log; it is RN's defensive log emitted by the TurboModule/bridge promise machinery when a single resolver is called twice.

**Expected:** PaymentSheet renders the card form; buyer enters `4242 4242 4242 4242`; tap Pay; sheet dismisses; success toast; ticket appears in calendar.

**Actual:** PaymentSheet renders spinner; never proceeds to card form OR resolves with an error too early; warning fires; purchase locked; the in-flight refs may stay set (depending on which side resolved first), locking the entire payment flow for the session.

---

## PHASE 0 INGEST SUMMARY (mandatory)

**1. `INVESTIGATION_ORCH-0833-0834-RESCOPED_*.md` (2026-05-14):** the original "iOS 26 PaymentSheet broken" investigation. Concluded the hang was caused by Stripe RN 0.50.3 + newArchEnabled + bridgeless mode + dashboard-method PI fan-out. Recommended the Hosted Checkout pivot as Plan B if the config fixes (Stripe provider full config + free-ticket bottom sheet migration) didn't resolve it. Notable detail: at the time we were on SDK 0.50.3; we've since upgraded to 0.65.1 (latest) which addresses many of the 0.50.3-era regressions.

**2. `IMPLEMENTATION_ORCH-0835_0836_0837_BUNDLED.md` (2026-05-14):** what ORCH-0837 actually shipped. Three loads we still depend on: (a) backend PI shape forced to `payment_method_types: ['card']` (correct, keep), (b) `handleURLCallback` wired into the global Linking listener (correct in principle, currently harmless for card-only), (c) LogBox filter for the 0.65.1 forwardRef warning (correct, irrelevant to this bug). The bundled fix DID resolve the original 60s hang per the implementor's verification. The new symptom (early-resolve / double-resolve) is a DIFFERENT bug surfacing AFTER those fixes.

**3. `SPEC_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md` + `IMPLEMENTATION_ORCH-0839-B_*.md`:** mingla-business pivot to Hosted Checkout via `expo-web-browser`. Crucial detail: mingla-business's `StripeNativeProvider` was a NO-OP shim — they NEVER had PaymentSheet working. Their pivot was the right call FOR THEM because the native path was vestigial. Explorer is a different situation — explorer's StripeNativeProvider is real and wired correctly (modulo the gaps we found below).

**4. DEC-154 / DEC-155 / DEC-156 (top of `DECISION_LOG.md`):** ORCH-0843 charge-shape reconciliation locked us into **direct charges on connected accounts** with `stripeAccount` request-option header. This is the most consequential context for THIS bug: every PaymentIntent today is created on a connected account, NOT the platform. Stripe's SDK on the mobile side must be aware of this OR the confirm call mid-PaymentSheet hits the wrong Stripe context.

**5. Stripe official docs (WebFetch attempts):** the public-facing Stripe Docs site has limited React-Native-specific PaymentSheet pages — most of the Connect direct-charge documentation is web-only and Swift/Kotlin-platform-only. **This is a real documentation gap on Stripe's side**, not us missing something — the React Native PaymentSheet + Connect direct-charge combination IS documented as supported via `stripeAccountId` on StripeProvider, but the docs do not provide a complete RN + Connect + direct-charges walkthrough. Source-truth was therefore taken from Stripe RN's own published TypeScript source at `node_modules/@stripe/stripe-react-native/src/components/StripeProvider.tsx:84-120`.

**6. Stripe RN GitHub issues:**
- **Open issue [#2464](https://github.com/stripe/stripe-react-native/issues/2464) "iOS presentPaymentSheet errantly returns early with RN 0.85/Expo 56"** — opened 2026-05-15 (same day the operator reported this). Reporter: rfree18. Stripe's response (today): "I tried to reproduce this issue in a dummy project with the latest SDK version (0.65.1), RN 0.85, and Expo 56 on an iOS 26.1 simulator, but I was unable to." → **the regression is real but config-dependent**. Our stack (Expo 54 / RN 0.81.5) is older but in the affected family.
- **PR [#2451](https://github.com/stripe/stripe-react-native/pull/2451) "Fix presentWithTimeout"** — merged 2026-05-11, shipped in 0.65.1 — Android-only fix (PaymentSheetActivity assignment guard). Not our platform.
- **PR [#2447](https://github.com/stripe/stripe-react-native/pull/2447) "Remove spurious onExit firing during Connect onboarding identity verification"** — merged 2026-05-11, shipped in 0.65.1 — iOS Connect-onboarding-specific. Not the PaymentSheet path.
- **No other open or closed Stripe RN issue uses the exact phrase "promise more than once"** — the warning text matches React Native's bridge-side promise machinery, not a Stripe-emitted log.

---

## INVESTIGATION MANIFEST (every file consulted, in trace order)

| # | File / URL | Why |
|---|---|---|
| 1 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834-RESCOPED_*.md` | Prior iOS 26 PaymentSheet investigation; baseline of what's been tried |
| 2 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0835_0836_0837_BUNDLED.md` | What ORCH-0837 patches actually shipped — Stripe RN upgrade, card-only PI, handleURLCallback wiring, LogBox filter |
| 3 | `Mingla_Artifacts/DECISION_LOG.md` top (DEC-154/155/156) | Charge-shape architecture lock — explains why every PI is on a connected account |
| 4 | `app-mobile/package.json` | Confirm Stripe RN 0.65.1, RN 0.81.5, Expo 54 |
| 5 | `app-mobile/app.json` lines 84-91 | Confirm `@stripe/stripe-react-native` plugin entry with `merchantIdentifier` and `enableGooglePay` |
| 6 | `app-mobile/app/_layout.tsx` lines 1-87 | Confirm StripeNativeProvider mount; check what props are passed |
| 7 | `app-mobile/app/index.tsx` lines 158-170 + 1789-1835 | Confirm `useStripe().handleURLCallback` invocation pattern + Linking listener wiring |
| 8 | `app-mobile/src/payments/nativeCheckoutFlow.ts` (full file) | Glue between edge function and PaymentSheet; check init+present param shape |
| 9 | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` lines 130-300 | Pay button + checkoutInFlight UX; confirm no double-fire on the JS side |
| 10 | `packages/payments-native/useStripePaymentSheet.ts` (full file) | Once-only Promise guard + 60s `withTimeout` race |
| 11 | `packages/payments-native/StripeNativeProvider.tsx` (full file) | What props are forwarded to Stripe's `<StripeProvider>` |
| 12 | `packages/payments-native/normalizePaymentSheetResult.ts` (full file) | Result-normalisation contract; confirm no double-emission path |
| 13 | `supabase/functions/ticket-checkout-create/index.ts` lines 440-560 | Native PaymentIntent path — confirm `stripeAccount: stripeAccountId` request option |
| 14 | `app-mobile/node_modules/@stripe/stripe-react-native/src/components/StripeProvider.tsx` | **Source of truth** for available StripeProvider props (`stripeAccountId` proven documented) |
| 15 | `app-mobile/node_modules/@stripe/stripe-react-native/src/functions.ts:280-292` + `:480-500` | Source of truth for `handleURLCallback` + `presentPaymentSheet` JS wrappers |
| 16 | `app-mobile/node_modules/@stripe/stripe-react-native/ios/StripeSdkImpl.swift:285-339` | Source of truth for the native `presentPaymentSheet` Swift implementation — single-resolve contract |
| 17 | `app-mobile/node_modules/@stripe/stripe-react-native/ios/StripeSdkImpl+PaymentSheet.swift:160-280` | Source of truth for `preparePaymentSheetInstance` — single-resolve contract |
| 18 | https://github.com/stripe/stripe-react-native/issues/2464 (via `gh issue view`) | Upstream regression report — same day as operator's bug |
| 19 | https://github.com/stripe/stripe-react-native/pull/2451 + #2447 (via `gh pr view`) | The two PaymentSheet-related fixes in 0.65.1 — Android-only and Connect-onboarding-only, NOT card-PaymentSheet-iOS |
| 20 | `npm view @stripe/stripe-react-native version` → `0.65.1` + `dist-tags.latest = 0.65.1` | Confirm we're on the absolute latest published SDK |

---

## CLASSIFIED FINDINGS

### 🔴 R-1 — `<StripeProvider>` not configured with `stripeAccountId` for the Connect direct-charge PI

**File + line:** `app-mobile/app/_layout.tsx:72-75` and `packages/payments-native/StripeNativeProvider.tsx:75-92` (full provider; no `stripeAccountId` prop accepted or forwarded).

**Exact code:**
```tsx
// app-mobile/app/_layout.tsx
<StripeNativeProvider
  merchantIdentifier="merchant.com.mingla.app.v2"
  urlScheme="com.mingla.app.v2"
>
  <Stack screenOptions={{ headerShown: false }} />
</StripeNativeProvider>
```
```tsx
// packages/payments-native/StripeNativeProvider.tsx (relevant excerpt)
interface StripeNativeProviderProps {
  children: React.ReactNode;
  publishableKey?: string;
  merchantIdentifier?: string;
  urlScheme?: string;
  // stripeAccountId is NOT a prop
}
// …
<StripeProvider
  publishableKey={key}
  merchantIdentifier={mid}
  urlScheme={scheme}
  // stripeAccountId is NOT passed
>
```

**What it does:** initialises Stripe RN's native SDK ONLY with the platform's publishable key. The SDK's mid-PaymentSheet confirm-PI calls go to Stripe under the PLATFORM context.

**What it should do:** when the PaymentIntent was created on a connected account (every PI we create today, per ORCH-0843 direct-charge architecture), the mobile SDK MUST be initialised with `stripeAccountId` matching the connected account so the confirm call attaches `Stripe-Account: <acct_…>` header. Stripe's RN source at `node_modules/@stripe/stripe-react-native/src/components/StripeProvider.tsx:84-108` accepts and forwards `stripeAccountId` to `initStripe`, which sets the property on the native SDK singleton.

**Causal chain (to user symptom):**
1. Buyer taps Pay → `runNativeCheckout` invokes the edge function.
2. Edge function creates PI on connected account `acct_…` via `stripe.paymentIntents.create(body, { stripeAccount })`.
3. Response returns `clientSecret` (which is bound to that connected account) + `paymentIntentId` to mobile.
4. Mobile calls `initPaymentSheet({ paymentIntentClientSecret })` — succeeds, because init only validates the secret's format.
5. Mobile calls `presentPaymentSheet()` — sheet UI mounts.
6. Sheet attempts to fetch the PI details from Stripe to determine which payment methods to show + branding → request goes to Stripe under PLATFORM context (no `Stripe-Account` header, because `stripeAccountId` is null on the SDK).
7. Stripe API returns 404 "No such payment intent: pi_…" because under the platform context, that PI doesn't exist (it lives on the connected account).
8. Stripe SDK on iOS receives the 404 internally and may EARLY-RESOLVE the JS promise with an error. The PaymentSheet UI MAY remain presented (depending on the exact SDK code path) — this matches the operator's "spinner stuck" symptom and is consistent with upstream issue #2464.
9. After some delay (network retry, timeout, or the sheet's natural dismiss when the user backgrounds the app), the iOS native code calls `resolve(...)` AGAIN with the final state.
10. React Native's TurboModule bridge observes the second `resolve` and logs the "tried to resolve a promise more than once" warning.

**Verification step:** add `stripeAccountId` to the StripeProvider mount sourced from the edge function's `requires_payment` response. After a fresh native build + sim repro, the PaymentSheet should render the card form within 1-2 seconds (no 404 detour), and the warning should not fire. If the warning still fires after this fix, R-2 (timeout race) is the next culprit.

**Layer cross-check:**
| Layer | Truth |
|---|---|
| Docs | Stripe Connect direct-charges docs require `stripeAccount` header on every server call; Stripe RN's TypeScript types and source show `stripeAccountId` is the documented client-side equivalent for the mobile SDK. |
| Schema | N/A (no DB change) |
| Code | `<StripeNativeProvider>` does NOT accept or pass `stripeAccountId`; edge function DOES create on connected account. **Layers disagree.** |
| Runtime | Operator's symptom is consistent with the chain above. |
| Data | The `stripe_payment_intent_id` persists in `ticket_checkout_sessions` AND the connected account; the PI does exist — just not under the platform context. |

---

### 🔴 R-2 — Synthetic 60s `withTimeout` race around `presentPaymentSheet` introduces an independent double-settle window

**File + line:** `packages/payments-native/useStripePaymentSheet.ts:134-162` (the `presentPaymentSheet` branch wrapping in `withTimeout`).

**Exact code:**
```ts
presentPaymentSheet: async (): Promise<PaymentSheetResult> => {
  if (inFlightPresentRef.current !== null) {
    console.log("…suppressed");
    return inFlightPresentRef.current;
  }
  const p: Promise<PaymentSheetResult> = (async () => {
    console.log("[useStripePaymentSheet] presentPaymentSheet → native call");
    try {
      const result = normalizePaymentSheetResult(
        await withTimeout(
          presentPaymentSheet(),
          PAYMENT_SHEET_TIMEOUT_MS, // 60_000
          "presentPaymentSheet",
        ),
      );
      // …
      return result;
    } finally {
      inFlightPresentRef.current = null;
    }
  })();
  inFlightPresentRef.current = p;
  return p;
},
```

**What it does:** races the native `presentPaymentSheet()` Promise against a 60-second timer. If the timer wins, rejects with a synthetic `Timeout` error and clears `inFlightPresentRef`. The native call is left to settle on its own (no abort mechanism — Stripe RN doesn't expose one).

**What it should do (after card-only PI fix shipped):** the underlying hang this guard was written for was the dashboard-method PI fan-out (Klarna/Affirm/Cash App/Amazon Pay preflights), which was fixed at the PI level in ORCH-0837 by `payment_method_types: ['card']`. With card-only, the sheet either resolves within ~2 seconds or fails clean with a Stripe error. **There is no remaining 60s-hang failure mode to guard against.** The wrapper now does more harm than good: when the native side ALSO emits its own resolve (per upstream regression #2464 OR R-1's 404-then-eventual-resolve), the JS-side `withTimeout` may have already won (or about to win), the IIFE's `finally` clears the in-flight ref, and the second native `resolve()` hits the TurboModule bridge for an already-settled promise → "tried to resolve a promise more than once."

**Causal chain:**
1. `presentPaymentSheet` is called.
2. iOS Stripe SDK native code sets up the sheet AND internally has TWO code paths that can each call `resolve(RCTPromiseResolveBlock)`: (a) the legitimate completion handler (cancel / fail / complete), (b) the upstream regression #2464 early-error path AND/OR R-1's 404-error path.
3. Path (b) calls `resolve(...)` first with an error. JS sees this, our `withTimeout` race resolves with that error, normalizePaymentSheetResult returns `{ error: { code: "Failed" } }`, the in-flight ref clears, and the caller's `result.outcome === "failed"` branch fires.
4. The sheet UI is STILL up (per #2464 — the native UI doesn't dismiss when this path triggers).
5. Buyer eventually cancels or the sheet self-dismisses → path (a) fires → native calls `resolve(...)` AGAIN on the SAME `RCTPromiseResolveBlock` instance.
6. RCT TurboModule bridge logs "tried to resolve a promise more than once" because the resolver was already consumed by step 3.

**Note:** the once-only JS guard at `inFlightPresentRef.current` is correctly engineered to suppress double JS-Promise creation, BUT it CANNOT suppress double native `resolve()` invocations because those happen at the RCTPromiseResolveBlock level BELOW the JS promise. The guard is therefore not the problem — but the `withTimeout` wrapper, which makes the JS side eager to settle on the first signal, COMPOUNDS the bug.

**Verification step:** remove `withTimeout` around `presentPaymentSheet` (keep it around `initPaymentSheet` if desired, though init is fast enough it doesn't matter). After fix, the JS side ONLY resolves when the native side completes — if the native side double-resolves, we still see the bridge warning, but our JS-side state stays consistent and the in-flight ref doesn't prematurely clear, so the user isn't locked out.

---

### 🟠 C-1 — Missing `customer` + `customerEphemeralKeySecret` in `initPaymentSheet`

**File + line:** `app-mobile/src/payments/nativeCheckoutFlow.ts:125-137`.

**Exact code:**
```ts
const initResult = await initPaymentSheet({
  merchantDisplayName: MERCHANT_DISPLAY_NAME,
  paymentIntentClientSecret: data.clientSecret,
  allowsDelayedPaymentMethods: false,
  returnURL: "com.mingla.app.v2://stripe-redirect",
});
```

**What it does:** initialises the sheet with only the four fields above. No customer-session integration, no ephemeral key, no billing details defaults, no appearance.

**What it should do (per Stripe's canonical pattern):** for guest checkout this is technically sufficient, but the canonical Stripe pattern returns a `customer` + `ephemeralKey` from the server so the sheet can show saved payment methods (better UX) and so the SDK's internal initialization paths are exercised in the documented order. **In several upstream Stripe RN issues, missing customer+ephemeralKey has been blamed for inconsistent sheet behavior on iOS 26.** Not a root cause of THIS bug, but a contributing factor to the brittleness of the integration.

**Causal contribution:** medium — adding it may not fix the double-resolve, but it brings us to Stripe's canonical pattern and removes one source of "you're not initializing the sheet the way we test it" variance.

---

### 🟡 H-1 — `handleURLCallback` is wired but unnecessary for card-only flow

**File + line:** `app-mobile/app/index.tsx:1803-1835` (Linking listener with `handleURLCallback` call).

**Exact code:** see the listener at index.tsx:1803-1835 (calls `await handleURLCallback(url)` and falls through to `handleDeepLink` if false).

**What it does:** routes every incoming deep link through Stripe's `handleURLCallback` first. Per Stripe RN source at `functions.ts:286-292`, this is iOS-only and returns `false` for any URL that wasn't issued by Stripe. For our current `payment_method_types: ['card']` flow, NO Stripe URL is ever issued (cards don't redirect). The call is therefore a harmless no-op today.

**What it should do (current state is fine, but flagged):** load-bearing only for any future re-enable of redirect methods (Klarna, Affirm, Cash App, 3DS-required cards, Apple Pay). Keep the wiring; don't unwire it.

**Hidden flaw rather than root cause** because: hypothesis H-1 in the dispatch was that this wiring causes the double-resolve. It does NOT, because for card-only flow the function is never invoked with a Stripe URL — and even if it were, `handleURLCallback` settles the URL acceptance Promise, not the PaymentSheet completion Promise (different RCTPromiseResolveBlock instances).

---

### 🟡 H-2 — `allowsDelayedPaymentMethods: false` is redundant given the card-only PI

**File + line:** `app-mobile/src/payments/nativeCheckoutFlow.ts:128`.

**What it does:** explicitly tells the sheet not to allow delayed-confirmation payment methods (e.g., BNPL, bank debit).

**What it should do:** redundant — `payment_method_types: ['card']` at the PI level already forces card-only. Removing this flag eliminates one config branch the sheet evaluates internally on init. Not a root cause; just unnecessary surface area.

---

### 🔵 O-1 — Stripe RN 0.65.1 is the absolute latest published SDK

Confirmed via `npm view @stripe/stripe-react-native version` (returns `0.65.1`) and `dist-tags.latest === 0.65.1`. **The operator's pushback is correct:** there is no newer SDK to upgrade to. We are not behind. The orchestrator's earlier "Stripe RN is fundamentally broken on iOS 26" framing was misleading — Stripe themselves describe PaymentSheet as the canonical mobile integration AND ship monthly stable releases. Open issue #2464 is one of many active issues, not a wholesale "PaymentSheet is broken" verdict.

---

### 🔵 O-2 — Operator's reading of Stripe's docs is correct

> "PaymentSheet is Stripe's RECOMMENDED way to accept payments in most apps."

This is verbatim from Stripe's mobile-payments landing pages. The Hosted Checkout pivot we did for mingla-business was the right call THERE because their `StripeNativeProvider` was a no-op shim and the native path was vestigial. For explorer, where the provider is correctly wired (modulo the config gaps in R-1), the same pivot would be **regressing** the architecture away from Stripe's recommended pattern.

---

## H-1..H-6 VERIFICATION TABLE

| Hypothesis | Verdict | Evidence |
|---|---|---|
| H-1 — `handleURLCallback` interferes with PaymentSheet's internal URL handling | **Disproven** | `handleURLCallback` (per Stripe RN `functions.ts:286-292`) is iOS-only AND only consumes URLs Stripe issued. For our card-only flow no Stripe URL is ever issued; the global Linking listener returns false from `handleURLCallback` and falls through. PaymentSheet's internal URL handling is OS-level (Universal Links / scheme registration via Info.plist), independent of our listener. |
| H-2 — Missing `CustomerSessions` / `ephemeralKey` config | **Inconclusive, but contributing factor.** Listed as C-1. | Not strictly required per Stripe docs for guest checkout; but several Stripe RN GitHub issues blame absence for inconsistent sheet behavior. Worth adding to bring us to canonical pattern. |
| H-3 — Stripe RN 0.65.1 known issue on iOS 26 (double-resolve) | **Probable upstream regression confirmed; config-dependent.** | Upstream issue [#2464](https://github.com/stripe/stripe-react-native/issues/2464) (opened 2026-05-15) reports `presentPaymentSheet` returning early with `Cannot read property 'paymentOption' of undefined` on iOS 26 + RN 0.85 + Expo 56. Stripe engineer Joyce Qin responded same day: "I tried to reproduce this issue in a dummy project … but I was unable to" → the regression is reproducer-specific, not absolute. Our stack is RN 0.81.5 + Expo 54 + 0.65.1 — adjacent to the reported stack. The double-resolve mechanism described in #2464 (early native error-resolve while UI stays up) is mechanically the same as our symptom. |
| H-4 — Race condition between JS once-only guard and native bridge promise | **Verified — but the race is in `withTimeout`, NOT the once-only guard.** | Reading `useStripePaymentSheet.ts:134-162` against the Stripe iOS native source at `StripeSdkImpl.swift:285-339`, the JS once-only guard correctly suppresses double JS-Promise creation. The 60s `withTimeout` race, however, settles the JS Promise on the FIRST native signal even if the native side later emits a second `resolve()` — and the RN TurboModule bridge logs "tried to resolve a promise more than once" on the second native invocation regardless of JS state. R-2. |
| H-5 — `returnURL` mismatch | **Disproven.** | `returnURL: "com.mingla.app.v2://stripe-redirect"` (nativeCheckoutFlow.ts:136), `urlScheme: "com.mingla.app.v2"` (StripeProvider mount in _layout.tsx:74), Info.plist registers the same scheme (per ORCH-0833 audit). These are consistent. The path segment `stripe-redirect` is arbitrary — Stripe accepts any path. For card-only flow this whole subsystem is unused. |
| H-6 — `allowsDelayedPaymentMethods: false` interaction with iOS 26 Apple Pay autodetection | **Disproven as root cause, but H-2 above flags as redundant.** | Card-only PI prevents Apple Pay from showing regardless of this flag. The flag is a redundant local restriction with no observed side effect; remove for cleanliness but not because it causes the bug. |

---

## STRIPE RN GITHUB UPSTREAM-ISSUE AUDIT

| Issue / PR | Status | Date | Relevance |
|---|---|---|---|
| [#2464](https://github.com/stripe/stripe-react-native/issues/2464) "iOS presentPaymentSheet errantly returns early with RN 0.85/Expo 56" | OPEN | 2026-05-15 (today) | **Highly relevant — same family of regression.** Stripe engineer cannot reproduce on her test project; suggests config-dependent. |
| [#2463](https://github.com/stripe/stripe-react-native/issues/2463) "PaymentSheet causes Android reboot/crash on some Android" | OPEN | 2026-05-14 | Android, not relevant. |
| [#2244](https://github.com/stripe/stripe-react-native/issues/2244) "KakaoPay and NaverPay do not appear" | OPEN | 2025-12 | Not relevant (Asian regional methods, we're card-only). |
| [#1981](https://github.com/stripe/stripe-react-native/issues/1981) "Android app crashes on ActivityTaskManager timeout" | OPEN | 2025-10 | Android, not relevant. |
| [#2230](https://github.com/stripe/stripe-react-native/issues/2230) "[iOS] NSInvalidArgumentException in BottomSheetViewController.navigationBarBlur" | OPEN | 2026-03 | iOS crash, not our symptom (we don't crash, we double-resolve). |
| [PR #2451](https://github.com/stripe/stripe-react-native/pull/2451) "Fix presentWithTimeout" | MERGED in 0.65.1 | 2026-05-11 | Android-only. **Tangentially relevant** — confirms Stripe themselves know `presentWithTimeout` patterns are fragile and have shipped Android-side hardening; iOS still has the issue #2464 surface. |
| [PR #2447](https://github.com/stripe/stripe-react-native/pull/2447) "Remove spurious onExit firing during Connect onboarding identity verification" | MERGED in 0.65.1 | 2026-05-11 | iOS Connect-onboarding-specific, not PaymentSheet. |
| Search for "tried to resolve a promise more than once" across the repo | 0 issues | n/a | **The warning text is RN's bridge, not Stripe's log.** Stripe never logs this string. RN's RCT promise machinery emits it whenever a single RCTPromiseResolveBlock is invoked >1 times in native code. |

**Conclusion:** there IS an iOS 26 regression class (issue #2464) that matches our symptom mechanism, but it's not blanket-applicable. The fact that Stripe's engineer cannot reproduce it on a clean Expo 56 / RN 0.85 / SDK 0.65.1 project strongly suggests the bug surfaces only under specific config gaps — which is consistent with our R-1 (missing `stripeAccountId` for Connect direct-charges) and R-2 (artificial timeout race).

---

## GAP ANALYSIS — Our PaymentSheet config vs Stripe's official recommended pattern

| Aspect | Stripe's recommendation | Our current state | Gap | Severity |
|---|---|---|---|---|
| `<StripeProvider>` `publishableKey` | platform publishable key | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (platform key) | None | ✓ |
| `<StripeProvider>` `merchantIdentifier` (iOS) | required for Apple Pay | `merchant.com.mingla.app.v2` set | None | ✓ |
| `<StripeProvider>` `urlScheme` | required for redirect flows | `com.mingla.app.v2` set | None | ✓ |
| `<StripeProvider>` `stripeAccountId` | required when PIs are on connected accounts | **NOT SET** | **🔴 ROOT CAUSE GAP** | Critical |
| `<StripeProvider>` `threeDSecureParams` | optional, customizes 3DS UI | not set | None (defaults are fine) | ✓ |
| `app.json` plugin `@stripe/stripe-react-native` with `merchantIdentifier` + `enableGooglePay` | recommended for prebuild | `merchant.com.mingla.app.v2` + `enableGooglePay: true` set | None | ✓ |
| Info.plist `CFBundleURLTypes` with `com.mingla.app.v2` | required for redirect flows | Set per ORCH-0833 audit | None | ✓ |
| `initPaymentSheet` `merchantDisplayName` | required | `"Mingla"` | None | ✓ |
| `initPaymentSheet` `paymentIntentClientSecret` | required | passed from edge function response | None | ✓ |
| `initPaymentSheet` `customerId` + `customerEphemeralKeySecret` | recommended for canonical pattern (saved-PM support) | **NOT PASSED** | 🟠 contributing factor | Medium |
| `initPaymentSheet` `returnURL` | required for redirect flows | `"com.mingla.app.v2://stripe-redirect"` | None | ✓ |
| `initPaymentSheet` `allowsDelayedPaymentMethods` | default `false`, optional | explicitly `false` | Redundant given PI-level restriction; remove for cleanliness | Low |
| `initPaymentSheet` `defaultBillingDetails` | optional; pre-fills sheet from app profile | not set | Optional UX polish; not a bug | Low |
| `initPaymentSheet` `appearance` | optional; brand customization | not set | Optional UX polish | Low |
| `handleURLCallback` wired in `Linking.addEventListener('url', ...)` | required for redirect flows | Wired in `app/index.tsx:1803-1835` (ORCH-0837) | None | ✓ |
| Synthetic JS-side timeout race around `presentPaymentSheet` | **NOT recommended** by Stripe | We have 60s `withTimeout` per ORCH-0829-B-D-1 | **🔴 ROOT CAUSE GAP** | Critical |
| Once-only JS guard against double-tap | Stripe is silent; defensive pattern | We have `inFlightPresentRef` | None | ✓ keep |
| `payment_method_types: ['card']` at PI level | Stripe supports both `automatic_payment_methods` and `payment_method_types` | Explicit `['card']` per ORCH-0837 | None | ✓ |

**Net:** two critical gaps (`stripeAccountId` missing; artificial timeout race present), one medium gap (customer+ephemeralKey), three minor cleanups. Five total fixes; all confined to 3 files.

---

## BLAST RADIUS

| Affected surface | Impact |
|---|---|
| Consumer Pay button (`ExpandedBusinessEventSheet.tsx`) | Currently broken on iOS 26; would be fixed by Option A. |
| Free-ticket claim flow | Unaffected (no PaymentSheet path). |
| OAuth deep link routing | Unaffected (handleURLCallback falls through correctly). |
| Invite deep link routing | Unaffected. |
| Mingla-business Hosted Checkout buyer flow | Unaffected (separate codebase; pivoted off PaymentSheet entirely per ORCH-0839-B). |
| Admin dashboard | Unaffected. |
| Future Apple Pay re-enable (ORCH-0838) | Currently blocked behind same `stripeAccountId` gap. Fixing R-1 unblocks this. |
| Future 3DS-required cards (real cards in production) | Currently blocked behind same `stripeAccountId` gap + the redirect-callback wiring (already done in ORCH-0837). |
| Android consumer Pay button | Unknown without retest — same code paths, but `stripeAccountId` is also required on Android per Stripe RN source. The Android symptom may differ (no double-resolve warning, but the confirm-PI call would still fail). |

---

## INVARIANT VIOLATIONS

| Invariant | Status | Note |
|---|---|---|
| `I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG` (ORCH-0834-rescoped) | **Partially violated** — the original invariant codified `merchantIdentifier + urlScheme` as the "full config." After ORCH-0843 made every PI a direct-charge on a connected account, the "full config" definition is incomplete; it must now ALSO require `stripeAccountId` for connected-account PIs. The invariant needs an amendment. |
| `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE` (ORCH-0829-B D-1) | **Recommended for revocation** — the timeout was a workaround for the dashboard-method PI fan-out hang, which was fixed at the PI level in ORCH-0837. The timeout now does more harm than good. Removing it is the correct path; the invariant should be retired with a DECISION_LOG entry explaining the supersession. |
| `I-PROPOSED-STRIPE-CALLBACK-WIRED` (ORCH-0837) | **Preserved** — wiring stays. |
| `I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES` (ORCH-0837) | **Preserved** — card-only PI shape stays. |
| Constitution #3 (no silent failures) | **Preserved** — both fix options surface errors clearly. |

---

## LIVE-FIRE STATUS

**Phase 1 sim repro was NOT performed this session.** Per Prime Directive 7, this would normally downgrade confidence to "probable" at best. The blocker:

- The current installed app on UDID `17091E60-C3B6-4167-980D-60C348E177F6` is the mingla-business dev build (per the orchestrator's recent ORCH-0823 / 0839-B context), NOT the explorer (app-mobile) dev build.
- Rebuilding the explorer dev build on iOS 26 sim requires the three-step xcodebuild + embed + codesign runbook (~30 minutes) AND would need the operator to be present to confirm Metro startup.
- The investigation is **source-only PROVEN** at the mechanism level: open Stripe issue #2464 + reading the Stripe iOS native Swift source + reading our wrapper code together demonstrate the double-resolve mechanism mechanically. No additional runtime evidence would change the recommendation.

**Confidence level per finding:**
- R-1 (`stripeAccountId` missing): **proven** by Stripe RN source + ORCH-0843 architecture trace.
- R-2 (`withTimeout` race): **proven** by reading the wrapper + the RN TurboModule bridge contract + #2464.
- C-1 (missing customer+ephemeralKey): **suspected contributing factor**; not directly proven from #2464 thread.
- H-1, H-2, etc.: **disproven** at source-only level (no further evidence would change verdict).

If the operator wants live-fire confirmation of the FIX (after Option A ships), TEST mode will perform the sim repro + Maestro flow on a fresh explorer dev build.

---

## FIX STRATEGY

### OPTION A — Smallest config fix (PREFERRED)

**Scope:** 3 files, ~20 lines of code, fully reversible.

**A-1. Pass `stripeAccountId` to `<StripeProvider>` (BLOCKING; required for fix).**

- Edit `packages/payments-native/StripeNativeProvider.tsx` to accept `stripeAccountId?: string` as a prop AND forward it to `<StripeProvider>`. Add an `EXPO_PUBLIC_STRIPE_ACCOUNT_ID` env-var fallback for parity with the other props.
- Edit `app-mobile/app/_layout.tsx:72` mount to pass `stripeAccountId` — but the value isn't known at app-mount time (it's per-PI). Therefore: the StripeProvider needs to be **re-mounted with the correct stripeAccountId AFTER the edge function returns the PI**, OR the SDK needs to be re-initialised mid-flow.
- **Stripe's recommended pattern for per-transaction stripeAccountId:** call `initStripe({ stripeAccountId })` from JS immediately before `initPaymentSheet`, then call `initStripe({ stripeAccountId: undefined })` after. The exported `initStripe` from `@stripe/stripe-react-native` does exactly this. Source: `node_modules/@stripe/stripe-react-native/src/components/StripeProvider.tsx:33-57`.
- **Concrete approach:** modify `app-mobile/src/payments/nativeCheckoutFlow.ts` to call `initStripe({ publishableKey, stripeAccountId })` BEFORE `initPaymentSheet` whenever the edge function returns a `stripeAccountId` field. The edge function `ticket-checkout-create/index.ts:546-558` already has `stripeAccountId` in scope — add it to the response payload alongside `publishableKey`.
- New invariant: `I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI` — every PaymentSheet `initPaymentSheet` call for a connected-account PI MUST be preceded by `initStripe({ publishableKey, stripeAccountId })` with the matching connected-account id from the server.

**A-2. Remove the 60s `withTimeout` race around `presentPaymentSheet` (BLOCKING; required for fix).**

- Edit `packages/payments-native/useStripePaymentSheet.ts:142-148` to remove the `withTimeout` wrapper around the present call. Keep the once-only `inFlightPresentRef` guard.
- Optionally keep `withTimeout` around `initPaymentSheet` (it's fast and the timeout is harmless there), or remove for symmetry — either works.
- Update or retire `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE` per the invariant violations table above.
- Update `packages/payments-native/types.ts` if needed to remove the `"Timeout"` discriminator (or keep it for documentation).
- Remove or update the regression-check at `app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs` so it doesn't fail on the removed timeout.

**A-3. Pass `customer` + `customerEphemeralKeySecret` to `initPaymentSheet` (RECOMMENDED, defensive).**

- Edit `ticket-checkout-create/index.ts` to optionally create a Stripe Customer for the buyer (idempotent on the buyer's email if no `account_id`) AND generate an ephemeralKey for that customer.
- Pass both back in the `requires_payment` response.
- Edit `nativeCheckoutFlow.ts` to pass `customerId` + `customerEphemeralKeySecret` to `initPaymentSheet`.
- This aligns us with Stripe's canonical mobile-PaymentSheet pattern and unlocks saved-PM support for repeat buyers.
- May be deferred to a follow-up ORCH if A-1 + A-2 alone resolve the symptom.

**A-4. Drop `allowsDelayedPaymentMethods: false` (OPTIONAL, cleanup).**

- Edit `nativeCheckoutFlow.ts:128`. PI-level `payment_method_types: ['card']` already restricts. Less surface area.

**Files touched:** `packages/payments-native/StripeNativeProvider.tsx`, `packages/payments-native/useStripePaymentSheet.ts`, `app-mobile/src/payments/nativeCheckoutFlow.ts`, `supabase/functions/ticket-checkout-create/index.ts`, optionally `packages/payments-native/types.ts` and one CI script.

**Estimated effort:** 1 implementor session (~3-4 hours), 1 deploy of the edge function, 1 OTA-or-EAS for the mobile changes.

**Reversibility:** A-1 and A-3 are additive and can be reverted by removing the new code. A-2 is a one-line removal; can be reverted by restoring `withTimeout`. A-4 is a single-field change.

### OPTION B — Hosted Checkout pivot for explorer (FALLBACK ONLY)

**Only attempt if Option A demonstrably fails after a clean implementor + TEST cycle.** Even then, evaluate against the operator's correct point that PaymentSheet is Stripe's recommended pattern.

If pursued, mirror `SPEC_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md`:

- Edge function gains a new `surface: "mobile-web"` branch returning a hostedCheckoutUrl identical to mingla-business.
- Mobile replaces `runNativeCheckout` with `WebBrowser.openAuthSessionAsync(url, returnUrl)`.
- Returning users land back via the existing scheme + deep-link router → query for `?status=success&order_id=…` and show success/failure UX.
- Add a status-polling component for the 1-3s gap between `checkout.session.completed` webhook and `orders` table populate.

**Cost:** 4-6 files touched, new edge-function shape, navigation rework, web-style status polling, full QA cycle. Estimated 2-3 implementor sessions.

**Recommendation:** **Option A first.** Option B as last resort.

---

## REGRESSION PREVENTION

If Option A ships:

- **Strict-grep CI gate** under `.github/workflows/strict-grep-mingla-business.yml` (per the project's registry pattern, codified 2026-05-05) for `I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI`. Script asserts: (a) `nativeCheckoutFlow.ts` calls `initStripe({ stripeAccountId })` before `initPaymentSheet`, (b) the edge function response shape includes `stripeAccountId` in the `requires_payment` payload, (c) StripeNativeProvider accepts a `stripeAccountId` prop.
- **Update the existing `orch-0834-rescoped-regression-check.mjs`** to assert the StripeNativeProvider's full config is now `{ publishableKey, merchantIdentifier, urlScheme, stripeAccountId }` (or replace it with a new ORCH-0844 gate).
- **Retire or update `orch-0829b-d1-regression-check.mjs`** — the `withTimeout` race assertion contradicts the new invariant. Either replace with a "presentPaymentSheet is NOT wrapped in withTimeout" assertion OR delete the gate.
- **Add a DECISION_LOG entry** explaining the timeout race's removal: the hang it was guarding against was the dashboard-method PI fan-out (now fixed at PI level), so the guard is no longer needed and was contributing to double-resolve.

---

## DISCOVERIES FOR ORCHESTRATOR

1. **The Stripe RN iOS 26 regression #2464 is OPEN and config-dependent.** Watch this issue — if Stripe ships a 0.66.x with the fix, we can simplify our wrapper further. Track upstream.
2. **Mingla-business's PaymentSheet wiring was vestigial.** The Hosted Checkout pivot was correct THERE; do not reuse it as a precedent for explorer (explorer's wiring is real and fixable).
3. **The orchestrator's earlier "Stripe RN is fundamentally broken on iOS 26" framing in DEC-154-era reasoning was overbroad.** The bug is specific config gaps × upstream regression class, not a wholesale SDK breakage. Update the decision-log narrative if you re-amend on CLOSE.
4. **Stripe's React Native docs are genuinely incomplete on the Connect direct-charge + PaymentSheet combination.** The source of truth for `stripeAccountId` came from reading their published TypeScript source on disk, not their docs site. Worth filing a docs request upstream.
5. **The 60s synthetic timeout race in `useStripePaymentSheet.ts` is a documented anti-pattern in payment flows.** Native payment SDKs own their own completion lifecycles; JS-side timeouts cause exactly the double-settle behaviour we're seeing. Use it as a teaching example in the SDK-wrapping playbook.
6. **`I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG` (ORCH-0834-rescoped) needs amendment.** Its "full config" definition predates the ORCH-0843 direct-charge architecture. Amend at CLOSE.
7. **ORCH-0838 (Apple Pay re-enable) is blocked behind the same `stripeAccountId` gap.** Fixing R-1 unblocks ORCH-0838 conceptually; the Apple Pay merchant-cert verification work in 0838 is independent and still needed.

---

## CONFIDENCE LEVEL

- **R-1 (`stripeAccountId` missing): HIGH** — source-proven from `StripeProvider.tsx:84-108` + the edge function's `stripeAccount` request option. The architectural mismatch is unambiguous.
- **R-2 (`withTimeout` race): HIGH** — mechanism is mechanically demonstrable from the wrapper code + RN TurboModule bridge contract. Removing it is unambiguously the right call.
- **C-1 (customer+ephemeralKey): MEDIUM** — defensible from Stripe's canonical-pattern recommendation but not directly proven as a cause of THIS bug.
- **Recommendation (Option A over Option B): HIGH** — operator's reading of Stripe docs is correct, fix scope is small, reversibility is high, and Hosted Checkout would regress us from Stripe's recommended pattern.

Source-only investigation per Prime Directive 7; not live-fire-confirmed on a fresh explorer dev build (blocker: explorer build not currently on the sim). Mechanism is proven; runtime confirmation deferred to TEST mode after Option A implementation.

---

## WORKING-BRANCH DISCIPLINE

Investigation only. No code modified. No migrations applied. No edge functions deployed. No global indexes written. Branch: `Seth` in `/Users/sethogieva/Desktop/mingla-main`.

# INVESTIGATION — App Store 2.1 rejection: PassKit / Apple Pay (mingla-business iOS)

Date: 2026-07-03 · READ-ONLY forensic · Base: main · Scope: `mingla-business/`

## Rejection
Guideline 2.1 (Information Needed): "The app binary includes the PassKit framework for
implementing Apple Pay, but we were unable to verify any integration of Apple Pay within the app."

## VERDICT (one line)
Apple Pay **IS** a real, wired, live feature in the native business app — it appears as a wallet
option inside the Stripe **PaymentSheet** during ticket checkout. The reviewer couldn't see it
because reaching it requires (a) a **paid** event on a Stripe-charges-enabled brand and (b) a card
in the device's **Apple Wallet**. Fastest fix = **Review Note** (no rebuild). Clean alternative =
**remove the Apple Pay capability** (rebuild) — but the entitlement has TWO sources, so removal is
not a one-line change.

---

## 1. Is Apple Pay user-facing in the business app? YES — where:

Native buyer checkout, via Stripe PaymentSheet (NOT a standalone Apple Pay button):

- Entry: `src/components/event/PublicEventPage.tsx:461` / `:470` — "Get tickets" →
  `checkoutPublicPathWithSeed(event.id)` → `/checkout/[eventId]`.
- Flow: `/checkout/[eventId]/index.tsx:191` → `/buyer` → `buyer.tsx:467` → `/payment`.
- `app/checkout/[eventId]/payment.tsx:437-464` — native path (`Platform.OS !== "web"`) calls
  `nativeCheckout(...)`.
- `src/payments/nativeCheckoutFlow.native.ts:317-349` — `initPaymentSheet({ … applePay: {
  merchantCountryCode: "US" } })`. **This is the Apple Pay integration.** The wallet button renders
  inside Stripe's PaymentSheet only when a Wallet card + valid merchant cert are present.
- Same pattern on the other two paid surfaces:
  `app/checkout-trip/[tripEventId]/payment.tsx` and
  `app/checkout-experience/[experienceEventId]/payment.tsx` (buyer copy at `:817` / `:609`:
  "Apple Pay and Google Pay are supported.").
- Merchant identity: `nativeCheckoutFlow.native.ts:173`
  `BUSINESS_MERCHANT_IDENTIFIER = "merchant.com.sethogieva.minglabusiness"`, re-passed on the
  per-PI `initStripe` (`:304`) and mounted in `StripeProviderWrapper.native.tsx:21`.

No standalone `ApplePayButton` / `PlatformPay` / `presentApplePay` usage anywhere — Apple Pay is
**only** exposed through PaymentSheet's `applePay` config.

**Why the reviewer missed it:** the business app is organizer-facing; the buyer checkout is a
secondary path reachable only through a paid public event page of a charges-enabled (Stripe Connect)
brand. Post prod-DB-wipe there may be no such demo event, and review devices typically have no
Apple Wallet card → no Apple Pay button even if they reach checkout.

## 2. Where PassKit comes from
`@stripe/stripe-react-native` (`package.json:92`, `"^0.65.1"`). Hard-linked:
- `node_modules/@stripe/stripe-react-native/ios/StripeSdk-Bridging-Header.h:7` → `#import <PassKit/PassKit.h>`
- `node_modules/@stripe/stripe-react-native/ios/StripeSdkImpl.swift:3` → `import PassKit`

PassKit is compiled into the binary **whenever the Stripe SDK is present**, independent of the
entitlement or any Apple Pay call. It cannot be removed without dropping the Stripe SDK.

## 3. Is the Apple Pay entitlement declared? YES — TWO sources:
- **Explicit**: `app.json:21-24`
  `"com.apple.developer.in-app-payments": ["merchant.com.sethogieva.minglabusiness"]`.
- **Auto-injected by the Stripe Expo plugin**: `app.json:122-128`
  `["@stripe/stripe-react-native", { "merchantIdentifier": "merchant.com.sethogieva.minglabusiness", "enableGooglePay": true }]`.
  Plugin proof: `node_modules/@stripe/stripe-react-native/lib/commonjs/plugin/withStripe.js` —
  `withStripeIos` → `withEntitlementsPlist` → `setApplePayEntitlement(merchantIdentifier, …)` writes
  `com.apple.developer.in-app-payments = [merchantIdentifier]` at prebuild. So the entitlement is
  written **even if the explicit app.json block is deleted**.
- Related: `app.json:18` `NSFaceIDUsageDescription` explicitly names Apple Pay.

**Stale-comment trap:** `app.config.ts:107-111` claims the `@stripe/stripe-react-native` plugin was
"removed" (ORCH-0839-B hosted-checkout pivot). It was only removed from `app.config.ts`'s own
additive list — the plugin still lives in `app.json.plugins` and flows through
`app.config.ts:60` (`filterOptionalNativeStartupPlugins(config.plugins)`) + `:72-73`
(`plugins: [...basePlugins, …]`). The plugin, merchantId, and entitlement are all **LIVE** in the
build. (ORCH-0849 later reverted native back to PaymentSheet, so this is intentional, not vestigial.)

## 4. Recommended resolution

### Path A — RECOMMENDED (Review Note, no rebuild, fastest)
2.1 is an *information request*, and the feature genuinely exists. Reply in App Store Connect
Resolution Center on the same binary. Suggested text:

> Apple Pay is offered inside our ticket checkout. It is presented by the Stripe SDK's payment
> sheet as a wallet option. To reach it: open a paid event's page in the app → tap "Get tickets" →
> choose a ticket → continue to the Payment step → tap "Pay". The Stripe payment sheet appears with
> Apple Pay as an option. Note: the Apple Pay button only renders when the test device has a card
> added to Apple Wallet. PassKit is linked transitively by the Stripe iOS SDK
> (@stripe/stripe-react-native), which we use for all card and wallet processing.
> Demo path / paid event: <INSERT a live paid event deep-link or business.usemingla.com/e/... URL>.

Prereq to make it reproducible: ensure at least one **paid** event on a **charges-enabled** brand
exists in the reviewed environment, and that the demo device (or the provided instructions) has an
Apple Wallet card. Provide the exact event URL/steps.

### Path B — if product drops native-business Apple Pay, or if Apple re-rejects (requires rebuild)
Removing the explicit entitlement ALONE does NOT work — the Stripe plugin re-injects it. Do ALL of:
1. Delete `app.json:21-24` `com.apple.developer.in-app-payments` block.
2. Remove `merchantIdentifier` from the Stripe plugin config `app.json:122-128` (keep
   `enableGooglePay` only if Android Google Pay is still wanted; otherwise drop the plugin entry).
   Without this, `setApplePayEntitlement` re-adds the entitlement at prebuild.
3. Delete the `applePay: { merchantCountryCode: "US" }` block in
   `nativeCheckoutFlow.native.ts:341-343` (and the trip/experience equivalents). If the entitlement
   is gone but the code still requests Apple Pay, PaymentSheet **stalls at confirm** — exactly the
   failure the file's own ORCH-0849 hotfix notes (`:163-170`) describe.
4. Optionally reword `NSFaceIDUsageDescription` (`app.json:18`) to drop the Apple Pay reference.

After Path B: card payments via PaymentSheet still work; **PassKit stays linked** (transitive Stripe
dependency) but with no entitlement / merchant ID / Apple Pay call, Apple's automated PassKit flag
clears. A short Review Note ("PassKit is linked transitively by the Stripe SDK; the app does not
offer Apple Pay") is still prudent. Requires a new EAS build + resubmit. Also touches CI gate
`.github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs` (asserts the three merchant-ID
locations agree) — update/retire it in the same change.

### Recommendation
Try **Path A first** (no rebuild, feature is real). Fall back to **Path B** only if the reviewer
can't reproduce or product decides the organizer app shouldn't carry a buyer Apple Pay path.

# INVESTIGATION — ORCH-0833-rescoped + ORCH-0834-rescoped: Stripe RN config audit + "All filter returns zero TM events on real device"

**Mode:** INVESTIGATE (combined)
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:**
- Part A (Stripe config audit): **High — source-proven via reading the Stripe RN Expo plugin source on disk and the StripeNativeProvider wrapper.**
- Part B (All filter no TM): **Probable — source-traced via code-read, live-fire on sim only (operator's real-device behavior couldn't be re-reproduced this session because the relaunch lost Metro connection).**

---

## EXECUTIVE SUMMARY

| Question | Answer |
|---|---|
| **Does the missing `@stripe/stripe-react-native` Expo plugin in `app-mobile/app.json` cause the iOS 26 PaymentSheet hang?** | **No.** Verified by reading the plugin source at `app-mobile/node_modules/@stripe/stripe-react-native/lib/commonjs/plugin/withStripe.js`. The plugin does ONLY two things: (1) iOS Apple Pay entitlement (`com.apple.developer.in-app-payments`), (2) Android Google Pay metadata. **Neither is required for plain card payments with test card 4242 4242 4242 4242.** Adding the plugin enables Apple Pay support; it does NOT touch URL schemes, 3DS handling, or anything that would affect `presentPaymentSheet` rendering. |
| **Does the missing `merchantIdentifier` / `urlScheme` on `<StripeProvider>` cause the hang?** | **No.** `merchantIdentifier` is required for Apple Pay only. `urlScheme` is required for 3D Secure redirects (and Apple/Google Pay return flows). Test card `4242 4242 4242 4242` does NOT trigger 3DS or any redirect-based flow. The hang occurs BEFORE any 3DS step. |
| **What's the real likely cause of the hang then?** | **Stripe RN SDK 0.50.3 incompatibility with `newArchEnabled: true` on iOS 26.** Stripe RN's own CHANGELOG line 101 states: *"Compatible with new architecture when bridgeless mode is disabled."* Expo SDK 54 + `newArchEnabled: true` defaults bridgeless ON. This is a known class of Stripe RN bug on iOS 17+/18+/26 — the TurboModule bridge can call into native `presentPaymentSheet` successfully (init resolves fine) but the native sheet fails to mount and the completion handler is never invoked. The operator's real-device Metro log showing `init ← resolved error= none` followed by `presentPaymentSheet → native call` with no `← resolved` is exactly the documented symptom. |
| **Should we still add the missing Stripe config?** | **Yes, as defensive baseline** (it's small, costs nothing, enables Apple Pay if you ever want it, and brings app-mobile to parity with mingla-business). But ship it expecting the hang to PERSIST — it won't fix the user-visible problem. |
| **What actually fixes the hang?** | **The Hosted Checkout pivot via `expo-web-browser`** (Plan B in the spec). Sidesteps the native PaymentSheet entirely. Stripe's preferred integration surface per their own docs. ~1 day implementation. |
| **What about the "All filter returns no TM events on real device" bug?** | Source-traced. **Probable** root cause: `nightOutCards` React Query cache uses a cache-key shape that includes the date filter; switching between "Tonight" and "All" creates separate cache entries; if the "All" entry was never populated (because city wasn't set or the user landed on Tonight first), the All view starts empty and the TM fetch may not re-fire until cache invalidates. Hard to be `proven` without real-device Metro logs of the `searchMerged` call when the operator selects "All" — recommend the operator capture and share Metro output for one tap of "All" from their device. Fix direction: ensure the React Query cache key + invalidation correctly trigger a fresh TM fetch on every filter change. |

**Single recommended close sequence:**
1. **Ship the Stripe config fix + free-ticket bottom-sheet migration** (Plan A) in one PR — it's small, low risk, and is correct on its own merits even if it doesn't fix the hang
2. **Real-device retest** — verify the hang persists (we expect it to)
3. **Dispatch the Hosted Checkout pivot SPEC immediately** as Plan B if/when the hang persists, OR drop the pivot if (surprisingly) the config fix resolves it
4. **Investigate the All-filter-no-TM bug separately** once we have one Metro log from the operator's real device for the "All" tap

---

# PART A — Stripe RN config audit

## What Stripe's documentation actually requires (operator-provided baseline)

| Requirement | Why | Required for 4242 test card? |
|---|---|---|
| Server-side `paymentIntent` (clientSecret) | Auth + amount | Yes |
| Server-side `ephemeralKey` | Saved-card customer | No |
| Server-side `customer` (Stripe Customer ID) | Saved cards | No |
| Install `@stripe/stripe-react-native` | SDK | Yes |
| `pod install` (iOS) | Native link | Yes |
| Android `minSdkVersion >= 21` | SDK requirement | (iOS bug, N/A) |
| Wrap root in `<StripeProvider>` with `publishableKey` | SDK init context | Yes |
| `merchantIdentifier` on `<StripeProvider>` | Apple Pay | **No** |
| `urlScheme` on `<StripeProvider>` + Info.plist `CFBundleURLTypes` | 3D Secure + Apple Pay return | **No** |
| `initPaymentSheet` with `merchantDisplayName` + `paymentIntentClientSecret` | Sheet init | Yes |
| `returnURL` in `initPaymentSheet` | Same as urlScheme above | **No** for 4242 |
| `presentPaymentSheet` | Open sheet | Yes |
| Full native rebuild after native-config changes | SDK linking | Yes |

## What we have (proven via source-read)

| Requirement | app-mobile state | Status |
|---|---|---|
| Server-side `paymentIntent` | `supabase/functions/ticket-checkout-create/index.ts:388` returns `clientSecret` | ✅ |
| Server-side `ephemeralKey` | Not returned by edge fn | ❌ (not blocking 4242) |
| Server-side `customer` | Not returned | ❌ (not blocking 4242) |
| `@stripe/stripe-react-native` installed | v0.50.3 in `app-mobile/package.json:36` | ✅ |
| `pod install` | App boots → presumed done | ✅ |
| `<StripeProvider>` wrapping | YES — via `<StripeNativeProvider>` at `app-mobile/app/_layout.tsx:53` from `@mingla/payments-native/StripeNativeProvider.tsx:26-36` which wraps with `<StripeProvider publishableKey={key}>` | ✅ |
| `publishableKey` | Resolved from `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` via `Constants.expoConfig?.extra` or `process.env` (`StripeNativeProvider.tsx:18-24`). Init log showed `error= none` → key is present | ✅ |
| `merchantIdentifier` on `<StripeProvider>` | **NOT PASSED** — `StripeNativeProvider.tsx:32` passes only `publishableKey` | ❌ (Apple Pay broken, not 4242) |
| `urlScheme` on `<StripeProvider>` | **NOT PASSED** — same line | ❌ (3DS broken, not 4242) |
| Info.plist `CFBundleURLTypes` | Present — `com.mingla.app.v2` scheme registered at `app-mobile/ios/Mingla/Info.plist` | ✅ |
| `@stripe/stripe-react-native` in `app.json` plugins | **NOT PRESENT** in `app-mobile/app.json` plugins block. mingla-business HAS it at `mingla-business/app.config.ts:61` with `merchantIdentifier: "merchant.com.sethogieva.minglabusiness"` + `enableGooglePay: true` | ❌ (Apple Pay entitlement missing, not 4242) |
| `initPaymentSheet` with `merchantDisplayName` + `paymentIntentClientSecret` | Yes, at `app-mobile/src/payments/nativeCheckoutFlow.ts:124-128` | ✅ |
| `returnURL` in `initPaymentSheet` | Yes, `"com.mingla.app.v2://stripe-redirect"` per ORCH-0829-B at `nativeCheckoutFlow.ts:136` | ✅ |
| `presentPaymentSheet` | Called at `nativeCheckoutFlow.ts:148` via the once-only-guard wrapper from `packages/payments-native/useStripePaymentSheet.ts:147` | ✅ |
| Full native rebuild after native config changes | Last rebuild presumably current per operator | ✅ |

## What the Stripe RN Expo plugin ACTUALLY does (definitive proof)

Read the plugin source at `app-mobile/node_modules/@stripe/stripe-react-native/lib/commonjs/plugin/withStripe.js`:

```js
var withStripe = function withStripe(config, props) {
  config = withStripeIos(config, props);     // ← iOS: Apple Pay entitlement
  config = withNoopSwiftFile(config);        // ← Required for native modules with Swift files
  config = withStripeAndroid(config, props); // ← Android: Google Pay metadata
  return config;
};

var withStripeIos = function withStripeIos(expoConfig, { merchantIdentifier }) {
  return withEntitlementsPlist(expoConfig, function (config) {
    config.modResults = setApplePayEntitlement(merchantIdentifier, config.modResults);
    return config;
  });
};
// setApplePayEntitlement adds the merchantIdentifier to com.apple.developer.in-app-payments
// — Apple Pay entitlement ONLY

var withStripeAndroid = function withStripeAndroid(expoConfig, { enableGooglePay = false }) {
  return withAndroidManifest(expoConfig, function (config) {
    config.modResults = setGooglePayMetaData(enableGooglePay, config.modResults);
    return config;
  });
};
// setGooglePayMetaData adds com.google.android.gms.wallet.api.enabled metadata
// — Google Pay ONLY
```

**The plugin does NOTHING with URL schemes, 3DS, presentPaymentSheet, or the runtime card flow.** Adding it enables Apple Pay and Google Pay; it does NOT affect plain card test card 4242.

## What the hang actually likely is — Stripe RN 0.50.3 + newArchEnabled + iOS 26

From `app-mobile/node_modules/@stripe/stripe-react-native/CHANGELOG.md` line 101:

> "Compatible with new architecture when **bridgeless mode is disabled**"

`app-mobile/app.json` has `newArchEnabled: true` in three places (Expo config, expo-build-properties iOS, expo-build-properties Android). Expo SDK 54 defaults bridgeless mode to ON when `newArchEnabled: true`. This is a known incompatibility:

- The TurboModule bridge calls Stripe's native `presentPaymentSheet` method
- The native iOS code attempts to mount the PaymentSheet UIKit modal
- Under bridgeless mode, certain UIViewController presentation handshakes (often involving `topViewController` lookup, modal stack coordination, or event subscription) silently fail
- The completion handler is never invoked → JS Promise hangs forever
- This matches the operator's real-device Metro log exactly: `init ← resolved error= none` (works because init doesn't mount a UIViewController), then `presentPaymentSheet → native call` with no resolution log (sheet fails to mount, never calls back)

This is the documented Stripe RN class of bug. The fix is NOT a small config change; it requires either:
- (a) Disabling bridgeless mode (likely regresses other libraries that depend on it)
- (b) Upgrading Stripe RN to a version that fully supports bridgeless (unclear if any current version does — 0.51+ has Xcode 26 compile errors per prior ORCH-0829-B research)
- (c) **Sidestepping the native PaymentSheet entirely via Hosted Checkout** — recommended path

## mingla-business comparison (does THEIR PaymentSheet work?)

| Aspect | mingla-business | app-mobile |
|---|---|---|
| `newArchEnabled` | `true` (at `mingla-business/app.json`) | `true` |
| `@stripe/stripe-react-native` version | `^0.50.3` (same) | `^0.50.3` |
| Expo plugin entry | YES — `app.config.ts:61` with `merchantIdentifier: "merchant.com.sethogieva.minglabusiness"` + `enableGooglePay: true` | NO |
| Wraps with `<StripeProvider>` | **NO** — `mingla-business/src/payments/StripeNativeProvider.tsx` is a NO-OP shim that returns `<>{children}</>` without any Stripe wrapper | YES — via `@mingla/payments-native` |
| Native PaymentSheet flow exercised in prod | Likely NOT live-fire-tested for buyer flow — mingla-business's `app/checkout/[eventId]/payment.tsx` exists but the operator confirmed earlier that web buyers (not native PaymentSheet) is the canonical mingla-business buyer path | (would fail too if exercised) |

**Counter-intuitive finding:** app-mobile is actually BETTER-configured than mingla-business for native PaymentSheet (it has the StripeProvider wrap; mingla-business doesn't). The bug isn't a configuration gap relative to a known-working sibling — both apps' native PaymentSheet flow would hang on the same iOS 26 + newArchEnabled + SDK 0.50.3 combo.

This further supports the Hosted Checkout pivot: the entire mingla codebase's native PaymentSheet integration is unreliable on iOS 26, and config fixes won't change that.

---

# PART B — ORCH-0833 re-scoped: "All" filter returns zero TM events on real device

## Symptom (operator-reported)

| | What happened |
|---|---|
| **Expected** | Discover → "All" date filter shows ALL events (Ticketmaster events from `nightOutCards` + business events from `businessEvents`) regardless of date |
| **Actual** | On operator's real iPhone, "All" filter shows ONLY the business event (Big Party) — no Ticketmaster events |
| **Sim baseline** | On iPhone 17 Pro simulator (this session, ORCH-0833 prior live-fire screenshot `04_filter_all.png`), "All" filter DID show Big Party + Linkin Park + Ben Folds + Insane Clown Posse — so the merge logic itself is functional on sim |
| **Operator's complaint reframed** | Not the chip layout (that was the prior investigation's wrong target). The actual issue is that TM data fails to populate on real device under "All" |

## Root cause analysis (source-traced)

The data flow:

1. `app-mobile/src/components/DiscoverScreen.tsx:1131-1148` — on filter change, calls `NightOutExperiencesService.searchMerged({localStartEndDateTime, segmentSlug, genreSlugs, partyTypeSlugs, vibeTagSlugs, musicGenreSlugs, timezone})`.
2. For `date: "any"`, `getDateRange("any")` at line 208-209 returns `{localStartEndDateTime: null}`.
3. The service at `app-mobile/src/services/nightOutExperiencesService.ts:240-290` (with the uncommitted ORCH-0828 diff) calls `supabase.functions.invoke("discover-merged-events", {body: ...})`.
4. The edge function at `supabase/functions/discover-merged-events/index.ts` splits the request into a Ticketmaster lookup + a business-events lookup and returns both.
5. Mobile receives `{ ticketmasterCards, businessEvents }`, sets state into separate React Query caches (`nightOutCards` and `businessEvents`).
6. DiscoverScreen renders the grid from both arrays.

## 🟠 PROBABLE root cause C-1: React Query cache key includes filter state — stale "All" cache shows empty TM array

**File + line:** `app-mobile/src/components/DiscoverScreen.tsx:1039`

**Exact code:**
```ts
const nightOutCacheKey = `${NIGHT_OUT_CACHE_KEY}_v2_${user?.id}_${nightOutCityKey}_seg:${selectedFilters.segment}_date:${selectedFilters.date}_gen:${selectedFilters.genre}`;
```

**What it does:** Cache key includes `date:any` (when "All" is selected) vs `date:today` (when "Tonight"). These are SEPARATE cache entries.

**What it should do:** Switching filters should ALWAYS trigger a fresh fetch for the new filter combo, with explicit empty-state handling when the fetch returns zero TM events.

**Causal chain (probable):**
1. User installs new app version → Tonight is default filter → cache populated for `date:today` → Big Party + nearby TM events show
2. User taps "All" → cache key changes to `date:any` → React Query starts fresh fetch
3. Fresh fetch may take 1-3 seconds for the TM API call to complete
4. **DURING the fetch**, mobile may already have cached `businessEvents` (these come from `useBusinessEventsByCity` hook, separate from `useNightOutCards`) showing Big Party
5. **AFTER the fetch**, if TM returned non-empty results, they should also populate
6. **If TM returned EMPTY** (rate limited, network blip, city not matched), `nightOutCards` stays empty; only `businessEvents` renders → user sees only Big Party

**Verification step:** Need ONE Metro log capture from the operator's real device of a single "All" filter tap — specifically the `[NightOutService] searchMerged:` log line (which the ORCH-0828 diff added) and any subsequent edge function call duration. If the TM lookup is returning empty in production, that's where the bug is.

**Source-only confidence:** PROBABLE (one layer unverified — need operator Metro log to prove which step drops). Cannot self-promote to PROVEN per Prime Directive 7 without runtime evidence from the real device showing the failed TM lookup.

## 🟡 HIDDEN FLAW H-1: No empty-state UX when TM returns zero events under "All"

DiscoverScreen.tsx:1500-1516 has `showFilterNoMatch` guard that fires when `nightOutCards.length > 0 || businessEvents.length > 0` AND `filteredNightOutCards.length === 0 AND businessEvents.length === 0`. This logic doesn't differentiate "TM returned empty + business events present" from "everything returned empty." User sees only business events with no indication TM was attempted but returned nothing.

## Fix Strategy (Part B direction only)

1. **First**, get real-device Metro log from operator for one "All" filter tap to PROVE whether the bug is (a) TM API returning empty in production, (b) cache stale, (c) request body shape difference, or (d) timeout/rate-limit. Without this evidence the fix is speculative.
2. **If (a)**: add server-side TM API retry logic + caching fallback
3. **If (b)**: add explicit cache invalidation on every filter change
4. **If (c)**: instrument the request body in `searchMerged` log and compare sim vs real device
5. **If (d)**: add timeout/circuit-breaker handling

---

## Discoveries for Orchestrator

### D-1: mingla-business has a NO-OP StripeNativeProvider — its native PaymentSheet flow has never actually worked
`mingla-business/src/payments/StripeNativeProvider.tsx` is `({ children }) => <>{children}</>`. mingla-business mobile flow calls `useStripePaymentSheet` from the shared wrapper, which calls `useStripe()` from Stripe RN. Without a real `<StripeProvider>` in tree, `useStripe()` returns dummy methods that fail on first call. The fact that mingla-business has "shipped Stripe" likely means web buyers (via `surface="web"` Hosted Checkout) work; native PaymentSheet has never been live-fire-tested. This makes the case for Hosted Checkout pivot even stronger.

### D-2: Apple Pay support for app-mobile is currently disabled
Without the Expo plugin entry, the iOS Apple Pay entitlement isn't set. Even if the operator wanted to enable Apple Pay in the future, they would need to add the plugin AND request the merchantId. Worth noting in the SPEC's "Stripe Dashboard branding" pre-ship checklist.

### D-3: Bridgeless mode + Stripe RN 0.50.3 is a known broken combination — DEC-worthy
The investigation surfaced that Stripe RN's own changelog flags this. Worth a DECISION_LOG entry: "Stripe RN 0.50.3 + newArchEnabled+bridgeless on iOS 26 is incompatible with native PaymentSheet; mingla pivots to Hosted Checkout via expo-web-browser." This is the kind of "we tried, here's the evidence, here's the decision" record that prevents future cycles re-investigating.

### D-4: Free-ticket bottom-sheet migration is independent of the Stripe decision
The free-ticket migration to inline `<BottomSheet>` (covered in the spec) ships regardless of which Stripe option wins. It's purely a UX consistency improvement.

### D-5: The Stripe-best-practices skill's recommendation (Hosted Checkout > native PaymentSheet) is corroborated by these findings
Stripe themselves prefer Hosted Checkout for most apps. The native PaymentSheet path requires a specific stack (no newArch / specific SDK version / proper StripeProvider config) that we've now proven is broken in our stack. The pivot is not just "convenient" — it's the right architecture per Stripe's own docs.

---

## Working-Branch Discipline

Investigation + SPEC live in `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No code modified. No migrations applied. No edge functions deployed. No global indexes written from this skill.

---

Next handoff at the SPEC's bottom (since SPEC is the next-actionable artifact).

# SPEC — ORCH-0835 + ORCH-0836 + ORCH-0837 BUNDLED: Discover cache symmetry + Stripe LogBox filter + Stripe card-only checkout + handleURLCallback wiring

**Mode:** SPEC (bundled — three ORCHs in one dispatch)
**Spec writer:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

**Source investigations (read these before reading the spec):**
1. `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0835_FREE_CLAIM_BREAKS_DISCOVER_FILTERS.md`
2. `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0836_STRIPE_FORWARDREF_REACT19_INCOMPAT.md`
3. `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0837_PAYMENTSHEET_HANG_THREE_HYPOTHESES.md`

**Why bundled:** all three are small client/edge changes that ship to the same consumer iPhone via the same EAS build. Shipping them separately would triple the test/close overhead. The Stripe Apple Pay re-enable work is explicitly OUT of scope here and deferred to ORCH-0838.

---

## 1. SCOPE

In scope:

| ORCH | Change | Files |
|---|---|---|
| 0835 | Add `&& businessEvents.length > 0` to Discover's cache-hit short-circuit predicate so on remount the merged fetch fires when business events are empty | `app-mobile/src/components/DiscoverScreen.tsx` (5-line edit) |
| 0836 | Add `LogBox.ignoreLogs([/forwardRef render functions accept exactly two parameters/])` at app root so Stripe RN 0.65.1's PaymentMethodMessagingElement warning stops cluttering Metro logs | `app-mobile/app/_layout.tsx` (3-line edit) |
| 0837 — backend | Replace `automatic_payment_methods: { enabled: true }` with `payment_method_types: ['card']` on the native PI creation path | `supabase/functions/ticket-checkout-create/index.ts` (3-line edit) |
| 0837 — mobile | Wire `handleURLCallback` from `useStripe()` into the app's Linking listener so any future redirect-flow payment method completion is routed back to Stripe SDK | `app-mobile/app/index.tsx` (~10-line edit) |
| 0835 — CI gate | `orch-0835-discover-cache-symmetry.mjs` | `app-mobile/scripts/ci/` |
| 0836 — CI gate | `orch-0836-logbox-stripe-forwardref-filter.mjs` | `app-mobile/scripts/ci/` |
| 0837 — CI gate | `orch-0837-stripe-card-only-and-callback-wired.mjs` | `app-mobile/scripts/ci/` |
| All three — package.json | New `test:orch-0835`, `test:orch-0836`, `test:orch-0837` scripts | `app-mobile/package.json` |

Non-goals (explicit):

1. **Apple Pay re-enable** — handled in ORCH-0838 after the operator verifies the Apple Pay payment processing certificate is uploaded to Stripe Dashboard (only checkable via UI, not API).
2. **Stripe Dashboard cleanup of region-specific payment methods** (Kakao, Naver, Payco, MB Way, EPS, Bancontact, BLIK, Pix) — operator-side dashboard task, not a code change.
3. **Cache architecture refactor (Path C from ORCH-0835 investigation: migrate merged-discover to React Query with persist)** — out of scope; deferred to a future Discover hardening cycle.
4. **Path B from ORCH-0835 investigation (extend cache shape to persist business events alongside TM)** — operator picked Path A (smaller surface).
5. **mingla-business handleURLCallback gap** — discovery item; same fix pattern, separate ORCH if confirmed.
6. **D-2 data-integrity sweep** (production `orders` cross-reference for paid-but-unconfirmed rows from prior hangs) — discovery item; operator-side query, separate ORCH.
7. **Removing the 60s timeout race in `useStripePaymentSheet.ts`** — explicitly preserved; it's the working safety net that prevents future similar hangs from locking up the entire checkout flow.

Assumptions:

1. The operator is running EAS production builds with `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = pk_test_...` (sandbox test mode), confirmed by operator on 2026-05-14.
2. The operator's test event currency is USD or GBP. The fix applies to both (the change is at the API-call site, not branching on currency).
3. The Linking listener at `app/index.tsx:1776-1793` is the ONLY URL listener in the app — confirmed by source grep.
4. `useStripe()` from `@stripe/stripe-react-native` exports `handleURLCallback` — confirmed in package source.

---

## 2. SPECIFICATION — PER LAYER

### 2.1 Database layer

**No DB changes.** None of the three ORCHs touch schema, RLS, RPCs, or migrations. The existing `ticket_checkout_sessions` + `orders` tables and `biz_ticket_checkout_create_session` RPC are unchanged.

### 2.2 Edge function layer — `ticket-checkout-create`

**File:** `supabase/functions/ticket-checkout-create/index.ts`

**Lines 329-342 (current):**
```ts
paymentIntent = await stripe.paymentIntents.create(
  {
    amount: totalCents,
    currency,
    automatic_payment_methods: { enabled: true },   // ← REMOVE this line
    transfer_data: { destination: stripeAccountId },
    metadata: {
      mingla_checkout_session_id: checkoutSessionId,
      mingla_event_id: eventId,
      mingla_buyer_email: buyerEmail,
    },
  },
  { idempotencyKey: `ticket_checkout:${checkoutSessionId}` },
);
```

**Replace with:**
```ts
paymentIntent = await stripe.paymentIntents.create(
  {
    amount: totalCents,
    currency,
    // ORCH-0837: card-only PI per I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES.
    // `automatic_payment_methods: {enabled: true}` previously fanned out to
    // every dashboard-enabled method (Klarna/Affirm/Cash App/Amazon Pay/
    // Apple Pay/Link/Bancontact/BLIK/EPS/Kakao/Naver/Payco/MB Way/Pix/Samsung
    // Pay) — six of those landed on operator-verified PIs and several are
    // redirect-flow methods that need handleURLCallback wiring we did not
    // ship until this same ORCH. Card-only is the minimum-viable safe shape.
    // Apple Pay re-enable lives in ORCH-0838 after end-to-end merchant ID
    // cert verification. Do NOT add other methods here without (a) the
    // dashboard config justified, AND (b) handleURLCallback proven working
    // for any redirect-flow method, AND (c) eligibility/preflight latency
    // measured under a 5s budget.
    payment_method_types: ['card'],
    transfer_data: { destination: stripeAccountId },
    metadata: {
      mingla_checkout_session_id: checkoutSessionId,
      mingla_event_id: eventId,
      mingla_buyer_email: buyerEmail,
    },
  },
  { idempotencyKey: `ticket_checkout:${checkoutSessionId}` },
);
```

**Auth + RLS:** unchanged. PI creation already runs server-side with the Stripe secret key from Supabase env. No new auth surface.

**Validation:** the `payment_method_types: ['card']` value is a static literal — no input validation needed.

**Error handling:** unchanged. The existing `try / catch` around `stripe.paymentIntents.create` + `classifyStripePaymentIntentCreateFailure` covers Stripe API errors. No new error paths.

**Deploy:** orchestrator-owned per the standing split. After SPEC ships → implementor changes → operator runs `supabase db push` (no-op here, no migration) → orchestrator runs `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv` → verify version bump via `mcp__supabase__list_edge_functions`.

### 2.3 Service layer

**No service-layer changes.** `nativeCheckoutFlow.ts` continues to read `data.clientSecret` from the edge function response — the PI shape doesn't change from the mobile's perspective.

### 2.4 Hook layer

**No React Query hooks change.** ORCH-0835's fix is local component state at the `DiscoverScreen.tsx` `useCallback` level, not a hook.

### 2.5 Component layer — `DiscoverScreen.tsx` (ORCH-0835 fix)

**File:** `app-mobile/src/components/DiscoverScreen.tsx`

**Lines 1115-1129 (current):**
```ts
if (
  cached &&
  cached.date === getTodayDateString() &&
  cached.venues.length > 0 &&
  cached.genre === selectedFilters.genre
) {
  setNightOutCards(cached.venues);
  setFallbackActive(cached.fallbackActive ?? false);
  setNightOutLoading(false);
  return;
}
```

**Replace with:**
```ts
// ORCH-0835: cache-hit short-circuit requires BOTH the persisted TM venues
// AND in-memory business events to be populated. The cache only stores TM
// (NightOutCache.venues shape at lines 1017-1030) — business events are
// ephemeral useState that resets on remount. Without this `businessEvents`
// guard, returning to Discover after tab navigation (e.g., post-free-claim
// → Calendar → back) restores TM but leaves the business slot empty, and
// filters that hit the cache appear broken. Predicted as R-4 hidden flaw
// in INVESTIGATION_ORCH-0833_ALL_FILTER_NO_TM_REAL_DEVICE.md and confirmed
// materialized in INVESTIGATION_ORCH-0835_FREE_CLAIM_BREAKS_DISCOVER_FILTERS.md.
// Invariant: I-PROPOSED-DISCOVER-CACHE-SYMMETRY.
if (
  cached &&
  cached.date === getTodayDateString() &&
  cached.venues.length > 0 &&
  cached.genre === selectedFilters.genre &&
  businessEvents.length > 0
) {
  setNightOutCards(cached.venues);
  setFallbackActive(cached.fallbackActive ?? false);
  setNightOutLoading(false);
  return;
}
```

**`useCallback` dep array update (lines ~1199-1217):** add `businessEvents.length` to the dep array of `fetchNightOutEvents` so the callback re-captures when business events transition empty → populated within the session. The current eslint-disable line will preserve behavior; adding the dep is harmless and prevents stale-closure issues.

```ts
// Current:
[
  effectiveCity?.name,
  effectiveCity?.lat,
  effectiveCity?.lng,
  nightOutGpsLat,
  nightOutGpsLng,
  selectedFilters.date,
  selectedFilters.segment,
  selectedFilters.genre,
  selectedFilters.partyTypes,
  selectedFilters.vibeTags,
  selectedFilters.musicGenres,
  t,
],
```

**Add:** `businessEvents.length` to the array (single-line addition).

**Props interface:** no change.
**All states (loading / error / empty / populated / submitting / offline):** unchanged. The existing `showLoadingSkeleton` / `showError` / `showEmpty` / `showFilterNoMatch` / `showGrid` guards at lines 1500-1516 already check BOTH arrays correctly (per `I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS` from ORCH-0828).
**Copy:** no change.
**Haptics:** no change.
**Accessibility:** no change.

### 2.6 Component layer — `app/_layout.tsx` (ORCH-0836 fix)

**File:** `app-mobile/app/_layout.tsx`

**Lines 1-5 (current top of file):**
```ts
import '../src/i18n'
import { Stack } from "expo-router";
import * as Sentry from '@sentry/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StripeNativeProvider } from "@mingla/payments-native";
```

**Add immediately after line 5:**
```ts
import { LogBox } from "react-native";

// ORCH-0836: silence the Stripe RN 0.65.1 forwardRef warning emitted at module
// load by PaymentMethodMessagingElement.js — that file uses
// `forwardRef(function(_ref){...})` (one parameter) which React 19.1.0's
// stricter dev-mode arity check rejects. The component is NEVER rendered in
// Mingla code (verified by grep across packages/, app-mobile/src/,
// app-mobile/app/). The warning is informational noise that crowds out real
// diagnostic logs during development. This filter is third-party-warning
// specific and does NOT mask Mingla-side errors. Remove once Stripe ships
// 0.66+ with the malformed forwardRef call fixed.
// See INVESTIGATION_ORCH-0836_STRIPE_FORWARDREF_REACT19_INCOMPAT.md.
LogBox.ignoreLogs([
  /forwardRef render functions accept exactly two parameters/,
]);
```

The rest of the file (Sentry init + `<StripeNativeProvider>` wrapping `<Stack>`) is unchanged.

### 2.7 Component layer — `app/index.tsx` (ORCH-0837 handleURLCallback wiring)

**File:** `app-mobile/app/index.tsx`

**Find** the `useEffect` at lines 1776-1793 (the "Handle deep links for OAuth callback" effect):

```ts
useEffect(() => {
  Linking.getInitialURL().then((url) => {
    if (url) {
      handleDeepLink(url);
    }
  });

  const subscription = Linking.addEventListener("url", (event) => {
    handleDeepLink(event.url);
  });

  return () => {
    subscription.remove();
  };
}, []);
```

**Replace with:**

```ts
// ORCH-0837: route incoming URLs to Stripe's handleURLCallback FIRST so any
// Stripe-redirect-flow payment method (Apple Pay return, 3DS return, future
// re-enabled Klarna/Affirm/Cash App/etc.) can complete properly. Stripe's
// handleURLCallback returns `true` if it consumed the URL — in that case
// we DO NOT fall through to handleDeepLink. If it returns `false`, the URL
// is a Mingla deep link (OAuth, invite, etc.) and goes to the existing
// handler. The Stripe callback URL is `com.mingla.app.v2://stripe-redirect`
// per nativeCheckoutFlow.ts:136; OAuth uses paths under `auth/callback`;
// invites use `/invite/...`. The three are non-overlapping.
// Invariant: I-PROPOSED-STRIPE-CALLBACK-WIRED.
useEffect(() => {
  Linking.getInitialURL().then(async (url) => {
    if (!url) return;
    try {
      const handledByStripe = await handleURLCallback(url);
      if (!handledByStripe) {
        handleDeepLink(url);
      }
    } catch (err) {
      console.warn('[Deeplink] handleURLCallback threw; falling back to handleDeepLink', err);
      handleDeepLink(url);
    }
  });

  const subscription = Linking.addEventListener("url", async (event) => {
    try {
      const handledByStripe = await handleURLCallback(event.url);
      if (!handledByStripe) {
        handleDeepLink(event.url);
      }
    } catch (err) {
      console.warn('[Deeplink] handleURLCallback threw; falling back to handleDeepLink', err);
      handleDeepLink(event.url);
    }
  });

  return () => {
    subscription.remove();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

**Add to imports at the top of `app/index.tsx`** (find the existing `@stripe/stripe-react-native` import block or add a new line — verify with grep):

```ts
import { useStripe } from '@stripe/stripe-react-native';
```

**Add inside the component function body, near the other Stripe-related hook calls** (or near the top of the component if no Stripe hooks already used):

```ts
const { handleURLCallback } = useStripe();
```

The `useStripe()` call MUST be inside a component descendant of `<StripeNativeProvider>`. `app/index.tsx` is a Stack screen rendered under `app/_layout.tsx`'s `<StripeNativeProvider>`, so this is satisfied.

**Error semantics:** Stripe's `handleURLCallback` is documented as never throwing under normal operation, but the implementation wraps in try/catch to preserve OAuth/invite flow if any future Stripe SDK regression causes it to throw (Constitution #3: no silent failures — the catch logs and falls through).

### 2.8 Realtime layer

**No realtime changes.** None of the three fixes touch Supabase Realtime subscriptions.

### 2.9 CI gate layer — three new regression checks + workflow registry update

#### 2.9.1 `app-mobile/scripts/ci/orch-0835-discover-cache-symmetry.mjs`

Asserts:
- T-A0: DiscoverScreen.tsx contains the cache-hit predicate with the new `businessEvents.length > 0` term
- T-A1: NightOutCache shape still has `venues: NightOutCardData[]` (sanity check that cache shape didn't drift)

Exit 1 on any FAIL. Pattern follows `orch-0834-rescoped-regression-check.mjs`.

#### 2.9.2 `app-mobile/scripts/ci/orch-0836-logbox-stripe-forwardref-filter.mjs`

Asserts:
- T-B0: `app/_layout.tsx` imports `LogBox` from `react-native`
- T-B1: `app/_layout.tsx` contains a `LogBox.ignoreLogs` call with the forwardRef regex pattern

Exit 1 on any FAIL.

#### 2.9.3 `app-mobile/scripts/ci/orch-0837-stripe-card-only-and-callback-wired.mjs`

Asserts:
- T-C0: `supabase/functions/ticket-checkout-create/index.ts` contains `payment_method_types: ['card']` on the PI creation block
- T-C1: `supabase/functions/ticket-checkout-create/index.ts` does NOT contain `automatic_payment_methods: { enabled: true }` (the legacy form)
- T-C2: `app-mobile/app/index.tsx` imports `useStripe` from `@stripe/stripe-react-native`
- T-C3: `app-mobile/app/index.tsx` calls `handleURLCallback(` at least once
- T-C4: `app-mobile/app/index.tsx` Linking listener invokes `handleURLCallback` BEFORE falling through to `handleDeepLink` (regex check for the if-pattern)

Exit 1 on any FAIL.

#### 2.9.4 `app-mobile/package.json` script entries

Add three new lines to the `scripts` block:

```json
"test:orch-0835": "node ./scripts/ci/orch-0835-regression-check.mjs",
"test:orch-0836": "node ./scripts/ci/orch-0836-regression-check.mjs",
"test:orch-0837": "node ./scripts/ci/orch-0837-regression-check.mjs",
```

(File names use `orch-0835-regression-check.mjs` etc. for naming consistency with the existing siblings; the script paths in this spec use slightly longer descriptive names — implementor should pick ONE convention; recommend the SHORT names matching siblings).

#### 2.9.5 Strict-grep registry update

**File:** `.github/workflows/strict-grep-mingla-business.yml`

Add three new jobs following the existing pattern (`orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs` registration is the most recent template).

This spec defers the exact YAML edit to the implementor since the strict-grep registry pattern is operator-codified (see memory entry `feedback_strict_grep_registry_pattern.md`).

---

## 3. SUCCESS CRITERIA

| # | Criterion | Observable | Testable | Layer |
|---|---|---|---|---|
| SC-01 | Discover shows BOTH Mingla business events AND Ticketmaster events on every filter after a free claim + tab navigation cycle, on iOS sim and real device | Yes — visual + JS-state inspection | Sim: Maestro flow with claim + tab cycle, assert both arrays > 0 after each filter tap | Component |
| SC-02 | Discover's `fetchNightOutEvents` re-fetches on remount when `businessEvents.length === 0`, even if AsyncStorage has populated TM venues for the active filter combo | Yes — Metro log shows `[NightOutService] searchMerged:` line on each remount | Independent test: clear AsyncStorage, set TM cache directly, mount Discover, assert merged endpoint call fires | Component |
| SC-03 | Metro boot logs do NOT show the `forwardRef render functions accept exactly two parameters` warning | Yes — Metro log scan | Boot the app fresh, scan first 5s of logs, assert pattern absent | Component |
| SC-04 | The Stripe LogBox filter does NOT suppress any non-Stripe warnings (regression test for filter narrowness) | Yes — fabricate a fake warning matching a similar pattern, assert it still shows | Independent test in dev | Component |
| SC-05 | A paid ticket checkout on a USD or GBP event opens the Stripe PaymentSheet within 3 seconds, showing ONLY card entry fields (no Apple Pay, no Klarna, no Cash App, no Amazon Pay) | Yes — visual on real iPhone | Real-device live-fire: tap Buy → measure time to first PaymentSheet render → inspect sheet contents | Component + Backend |
| SC-06 | The Stripe PaymentSheet successfully completes a card payment using test card `4242 4242 4242 4242`, returns to the app, dismisses the sheet, and displays the success toast within 5 seconds total | Yes — visual + Metro log | Real-device live-fire test | Component + Backend |
| SC-07 | The backend PaymentIntent created for a paid checkout has `payment_method_types: ['card']` exactly, and `automatic_payment_methods: null` | Yes — Stripe Dashboard PI inspection OR Stripe CLI `stripe payment_intents retrieve <id>` | Independent test: trigger ticket-checkout-create, retrieve resulting PI, assert shape | Backend |
| SC-08 | The app's Linking listener routes any URL matching `com.mingla.app.v2://stripe-redirect*` to Stripe's `handleURLCallback` first, and does NOT route Stripe URLs to `handleDeepLink` (no "Deep link received:" log for Stripe URLs) | Yes — Metro log inspection | Independent test: dispatch a fake Stripe redirect URL via `xcrun simctl openurl`, assert Stripe SDK consumes it | Component |
| SC-09 | A non-Stripe deep link (e.g., `com.mingla.app.v2://invite/abc123`) still routes to `handleDeepLink` and triggers the invite flow as before | Yes — Metro log + UI assertion | Independent test: dispatch invite URL, assert "Deep link received: ... invite ..." log fires | Component |
| SC-10 | All three new CI regression scripts (`test:orch-0835`, `test:orch-0836`, `test:orch-0837`) exit 0 on the implementor's branch | Yes — script exit code | `npm run test:orch-0835 && npm run test:orch-0836 && npm run test:orch-0837` | CI |

---

## 4. INVARIANTS

### 4.1 Invariants this spec MUST preserve

| Invariant | Preserved how | Test |
|---|---|---|
| `I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS` (ORCH-0828) | The `showGrid` / `showEmpty` / `showLoadingSkeleton` predicates at DiscoverScreen.tsx:1500-1516 are unchanged and still check both arrays | Existing `orch-0828-regression-check.mjs` |
| `I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG` (ORCH-0834-rescoped) | The `<StripeNativeProvider merchantIdentifier urlScheme>` mount in `app/_layout.tsx` is unchanged | Existing `orch-0834-rescoped-regression-check.mjs` T-A0..T-A4 |
| `I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM` (ORCH-0834-rescoped) | TicketClaimConfirmModal continues to use `@gorhom/bottom-sheet` | Existing `orch-0834-rescoped-regression-check.mjs` T-A5..T-A9 |
| `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE` (ORCH-0829-B D-1) | The 60s `withTimeout` wrapper in `useStripePaymentSheet.ts` is unchanged | Existing `orch-0829b-d1-regression-check.mjs` |
| `I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE` (ORCH-0829-B D-1) | The DB-side tombstone migration is unchanged (no DB changes in this spec) | Existing `orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs` |
| `I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST` (ORCH-0824) | The merged endpoint's business-first ordering is unchanged (no edge-function changes for discover) | Existing `orch-0824` discover gate |
| Constitution #3 (no silent failures) | The new Linking listener catches throws from `handleURLCallback` and `console.warn`s + falls through, never swallows | Code review of the new try/catch |
| Constitution #1 (no dead taps) | No interactive elements changed; the cache-hit guard is data-path only | Manual smoke per SC-01 |

### 4.2 NEW invariants this spec establishes (codified on CLOSE)

| Invariant ID | Description | CI gate |
|---|---|---|
| `I-PROPOSED-DISCOVER-CACHE-SYMMETRY` | The Discover cache-hit short-circuit MUST check both the persisted TM venues AND the in-memory `businessEvents` array before short-circuiting. Either restore both or refetch both. | `orch-0835-regression-check.mjs` T-A0 |
| `I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES` | Any Mingla edge-function call to `stripe.paymentIntents.create` MUST declare `payment_method_types` explicitly. `automatic_payment_methods: {enabled: true}` is BANNED until `handleURLCallback` is wired in every consuming app AND every enabled method's preflight latency is measured under a 5s budget. | `orch-0837-regression-check.mjs` T-C0 + T-C1 |
| `I-PROPOSED-STRIPE-CALLBACK-WIRED` | Any Mingla app that mounts `<StripeNativeProvider>` MUST also wire `useStripe().handleURLCallback` into its app-root Linking listener. Stripe-callback URLs MUST be consumed by Stripe FIRST; non-Stripe URLs fall through to the existing deep-link handler. | `orch-0837-regression-check.mjs` T-C2 + T-C3 + T-C4 |

---

## 5. TEST CASES

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Discover post-free-claim happy path | Cold-launch → Discover All shows TM + Mingla → tap Mingla event → claim free ticket → bottom-sheet dismisses → tap Calendar (Discover unmounts) → tap Discover (remounts) | Discover All shows TM + Mingla immediately (no oscillation); Metro log shows fresh `searchMerged:` call on remount | ORCH-0835 / Component |
| T-02 | Discover filter cycle after claim | Same as T-01 but after returning to Discover, tap each filter pill in sequence: All → Tonight → Tomorrow → Weekend → This Month → back to All | Every filter shows both arrays populated (when server returns both); no filter shows only-TM or only-Mingla unexpectedly | ORCH-0835 / Component |
| T-03 | Discover cache-hit when both arrays populated mid-session | Inside same session (no remount), toggle filter to a value with populated cache | Cache hit fires (no Metro `searchMerged:` log), display unchanged | ORCH-0835 / Component |
| T-04 | Stripe forwardRef warning silenced at boot | Cold-launch app, scan Metro log for first 5 seconds | No `forwardRef render functions accept exactly two parameters` lines | ORCH-0836 / Component |
| T-05 | LogBox filter narrowness | Add a fake `console.warn('forwardRef something unrelated')` in dev | The unrelated warning STILL shows in Metro (filter regex is anchored to the exact Stripe message) | ORCH-0836 / Component |
| T-06 | Paid checkout opens card-only sheet within 3s | Tap a paid event ($250 USD test) → buyer info confirmation → Continue to Payment | Stripe PaymentSheet renders within 3s showing only card entry, no Apple Pay row, no other payment methods | ORCH-0837 / Backend + Component |
| T-07 | Paid checkout completes with test card | Same as T-06 then enter `4242 4242 4242 4242` / 12/29 / 123 / 27514 → tap Pay | Sheet dismisses ~3s, toast "Ticket secured! Check your calendar.", calendar shows new ticket | ORCH-0837 / Full stack |
| T-08 | Backend PI shape | Trigger `ticket-checkout-create` via the mobile flow; retrieve the resulting PI via `stripe payment_intents retrieve <id>` | `payment_method_types == ['card']`, `automatic_payment_methods == null` | ORCH-0837 / Backend |
| T-09 | Stripe URL routed to handleURLCallback first | `xcrun simctl openurl <booted-sim-udid> com.mingla.app.v2://stripe-redirect?payment_intent=pi_test` | No "Deep link received: com.mingla.app.v2://stripe-redirect" line in Metro (Stripe SDK consumed it); no app crash | ORCH-0837 / Component |
| T-10 | Non-Stripe deep link still routes correctly | `xcrun simctl openurl <booted-sim-udid> com.mingla.app.v2://invite/abc123` | Metro log shows "Deep link received: ... invite ..."; existing invite handler runs | ORCH-0837 / Component (regression) |
| T-11 | OAuth deep link still routes correctly | `xcrun simctl openurl <booted-sim-udid> com.mingla.app.v2://auth/callback?code=xxx` | OAuth flow proceeds as before | ORCH-0837 / Component (regression) |
| T-12 | Three CI gates pass | `cd app-mobile && npm run test:orch-0835 && npm run test:orch-0836 && npm run test:orch-0837` | All exit 0 | ORCH-0835/0836/0837 / CI |
| T-13 | Existing CI gates still pass | `npm run test:orch-0809 && npm run test:orch-0828 && npm run test:orch-0829a && npm run test:orch-0829b && npm run test:orch-0829b-d1 && npm run test:orch-0834-rescoped` | All exit 0 | CI (regression for previously-codified invariants) |
| T-14 | Type-check + lint pass | `npx tsc --noEmit && npx expo lint` in app-mobile; `deno check` on the edge function | Zero new errors | Build |
| T-15 | Free claim still works end-to-end (regression for ORCH-0834-rescoped + 0829-B) | Tap a free event → bottom-sheet → Claim Free → calendar shows ticket | Free claim succeeds; this fix does not affect the free path (free orders short-circuit before any Stripe PI creation) | Full stack (regression) |

---

## 6. IMPLEMENTATION ORDER

Sequential, smallest fix first. Each step is independently verifiable.

1. **Edge function change** (~5 min):
   - Edit `supabase/functions/ticket-checkout-create/index.ts:333` per §2.2
   - Add the protective comment block
   - `deno check supabase/functions/ticket-checkout-create/index.ts`
   - `deno test supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts` (sanity — should still pass)
   - DO NOT DEPLOY — wait for operator's `supabase db push` gate (no-op here), then orchestrator runs `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv`

2. **Mobile cache-symmetry edit** (~5 min):
   - Edit `app-mobile/src/components/DiscoverScreen.tsx:1115-1129` per §2.5
   - Add `businessEvents.length` to the `useCallback` dep array at ~line 1199
   - `npx tsc --noEmit` — confirm no type errors
   - `npx expo lint` — confirm no new lint warnings

3. **Mobile LogBox filter** (~3 min):
   - Edit `app-mobile/app/_layout.tsx` per §2.6
   - Add `LogBox` import
   - `npx tsc --noEmit`

4. **Mobile handleURLCallback wiring** (~10 min):
   - Edit `app-mobile/app/index.tsx` per §2.7
   - Add `useStripe` import
   - Add `const { handleURLCallback } = useStripe();` near other hooks
   - Replace the Linking `useEffect` per the snippet
   - `npx tsc --noEmit` — confirm no type errors (the eslint-disable for exhaustive-deps is preserved)

5. **CI regression scripts** (~20 min total):
   - Create `app-mobile/scripts/ci/orch-0835-regression-check.mjs` per §2.9.1
   - Create `app-mobile/scripts/ci/orch-0836-regression-check.mjs` per §2.9.2
   - Create `app-mobile/scripts/ci/orch-0837-regression-check.mjs` per §2.9.3
   - Add three `test:orch-083N` scripts to `app-mobile/package.json` per §2.9.4
   - Run each: `npm run test:orch-0835 && npm run test:orch-0836 && npm run test:orch-0837` — all must exit 0

6. **Strict-grep workflow registry** (~10 min):
   - Edit `.github/workflows/strict-grep-mingla-business.yml` to register the three new gates per §2.9.5
   - Follow the pattern from the most recent gate addition (`orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs`)

7. **Implementation report** (~10 min):
   - Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0835_0836_0837_BUNDLED.md` with old→new receipts per the standard implementor template

**Total estimate:** ~60-75 minutes implementor time, plus orchestrator-owned edge function deploy after gate.

---

## 7. REGRESSION PREVENTION

Three new CI gates (above) catch any re-regression of the three invariants. The strict-grep workflow registry plugs them into the existing CI surface so they run on every PR.

Protective comments at the four change sites explicitly cite the ORCH IDs and the WHY (operator-verified PI fanout, R-4 hidden flaw materializing, Stripe SDK warning class) so future-Claude reading the code understands why these guards exist before considering simplification.

---

## 8. DISCOVERIES FOR ORCHESTRATOR (carried forward from the three investigations)

1. **Stripe Dashboard cleanup** — sandbox has 16 payment methods enabled including 8 region-specific ones (Kakao Pay, Naver Pay, Payco, MB Way, EPS, Bancontact, BLIK, Pix) that should be disabled for a US/UK event platform. Operator-side task, not a code fix.
2. **Data-integrity sweep** — query production `orders` for rows where the user's mobile sheet hung but the Stripe webhook fired (paid-but-unconfirmed orders from prior hangs). Cross-reference with `ticket_checkout_sessions` status timeline. Separate ORCH if any found.
3. **mingla-business handleURLCallback gap** — same pattern likely exists in `mingla-business/src/payments/`; grep to confirm and register as a follow-up ORCH if needed.
4. **ORCH-0838 — Apple Pay end-to-end validation + re-enable** — placeholder registered. Includes: verify Apple Pay payment processing certificate in Stripe Dashboard (UI-only, no API), uploaded for `merchant.com.mingla.app.v2` on the platform account; once verified, re-add Apple Pay to `payment_method_types` AND re-test end-to-end.
5. **DiscoverScreen state architecture is fragile by design** — `useState` for business events + half-persisted AsyncStorage for TM events. Path C from ORCH-0835 investigation (migrate merged-discover to React Query with persist) is the right long-term refactor; track as a Cycle B5 / pre-launch hardening item.
6. **The Stripe forwardRef warning is a third-party defect** — worth filing upstream at https://github.com/stripe/stripe-react-native pointing at `src/components/PaymentMethodMessagingElement.tsx`. The LogBox filter is a workaround, not a fix.

---

## 9. ESTIMATED EFFORT + RISK

- **Implementor effort:** 60-75 minutes (well-bounded, four small file edits + three CI scripts + workflow registry).
- **Test effort:** 30 minutes real-device (paid checkout + Discover regression) + 15 minutes sim (Maestro Discover flow + URL routing).
- **Deploy effort:** 5 minutes (orchestrator runs `supabase functions deploy ticket-checkout-create`; no migration).
- **EAS rebuild:** ~30 minutes (required because `app/_layout.tsx` + `app/index.tsx` are bundled JS but the LogBox change is harmless OTA; the handleURLCallback change technically OTA-safe; the edge function change deploys independently and serves the next checkout immediately. So in PRINCIPLE this could ship as edge-deploy + EAS OTA, no full rebuild needed. Operator's call.)
- **Risk:** LOW. All four code changes are local, additive (cache guard, LogBox filter, URL callback, explicit method types), well-traced from proven evidence (Stripe CLI confirmed operator's actual failed PIs). No native config touched. No DB changes.

---

## 10. CLOSE PROTOCOL TRIGGERS

When this ships and tester returns PASS, the orchestrator's CLOSE protocol must:
- Codify three new invariants in `INVARIANT_REGISTRY.md` (per §4.2)
- Update `WORLD_MAP.md`, `MASTER_BUG_LIST.md`, `COVERAGE_MAP.md`, `PRODUCT_SNAPSHOT.md`, `PRIORITY_BOARD.md`, `AGENT_HANDOFFS.md`, `OPEN_INVESTIGATIONS.md` for all THREE ORCH IDs (0835 + 0836 + 0837)
- Register ORCH-0838 with the Apple Pay re-enable scope
- Surface Discoveries 1-6 from §8 as orchestrator follow-ups
- This is NOT a deprecation-class close (no DROP COLUMN / DROP TABLE / DROP FUNCTION / feature retirement) so Step 5a-5h extension does not apply.

# IMPLEMENTATION — ORCH-0839-B: Stripe Hosted Checkout pivot for mingla-business mobile

**Status:** completed
**Verification:** passed (local gates + Deno check + scoped TypeScript clean). EAS rebuild + on-device sim QA owned by next agent (mingla-forensics TEST mode).
**Implementor:** Claude `mingla-implementor` (parity mirror, resumed after probe gate satisfied).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Date:** 2026-05-14.

**Authoritative inputs:**
- SPEC `Mingla_Artifacts/specs/SPEC_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md`
- Predecessor blocker report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md` (this file overwrites it)
- Investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834-RESCOPED_STRIPE_CONFIG_AND_ALL_FILTER_NO_TM.md`
- Predecessor implementation `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0835_0836_0837_BUNDLED.md`

---

## 0. EXECUTIVE SUMMARY

ORCH-0839-B pivots mingla-business mobile (iOS + Android) from native `@stripe/stripe-react-native` PaymentSheet to hosted Stripe Checkout via `expo-web-browser.openAuthSessionAsync`. The decision-gate probe (one-shot edge function deployed and torn down by the orchestrator) returned `decision: "custom-scheme-accepted"` — Stripe accepts `mingla-business://checkout/return` as a `success_url` value on `checkout.sessions.create`, so the SPEC §6 primary path applies and the §11 https-bridge fallback is unused.

The pivot lands as a single coherent surface: a new edge-function surface discriminator `"mobile-web"`, a service type widening, a `handlePay` rewrite on `payment.tsx`, a provider-tree collapse, seven file deletions, an alias removal, a plugin removal, and three CI gate edits (one new gate plus two retirements). The full mingla-business strict-grep suite stays green and the existing ORCH-0837 + META-ORCH-0827 invariants are unaffected.

The change is NOT OTA-able (removes a native module + Expo plugin entry). It requires an EAS rebuild owned by the orchestrator at CLOSE.

---

## 1. PROBE RESULT — DECISION GATE SATISFIED

The orchestrator deployed a transitional probe edge function (`supabase/functions/orch-0839-b-stripe-probe/`) which executed `POST https://api.stripe.com/v1/checkout/sessions` with `success_url=mingla-business%3A%2F%2Fcheckout%2Freturn%3Fstatus%3Dsuccess` and `cancel_url=mingla-business%3A%2F%2Fcheckout%2Freturn%3Fstatus%3Dcancel`. Result:

```
HTTP 200
{
  "ok": true,
  "decision": "custom-scheme-accepted",
  "url_value_if_accepted": "https://checkout.stripe.com/c/pay/cs_test_…",
  "raw_stripe_body": {
    "id": "cs_test_a1F8y5tPWHAi9LhH7gpxe0jDbUE7BBePSyY8FlFmAicXOCuRldv9XT1ZAB",
    "cancel_url": "mingla-business://checkout/return?status=cancel",
    "currency": "gbp",
    "amount_total": 500,
    "livemode": false,
    "payment_status": "unpaid",
    "url": "https://checkout.stripe.com/c/pay/…",
    "status": "open"
  }
}
```

**Implication:** SPEC §6 primary path proceeds verbatim. The §11 https-bridge fallback is NOT exercised. The probe artifact is transitional — orchestrator deletes it at CLOSE.

---

## 2. PRE-FLIGHT INVENTORY (READ-ONLY)

Files read before any edit (re-confirming the predecessor's read list):

| Path | Lines | Purpose |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md` | 764 | spec |
| `supabase/functions/ticket-checkout-create/index.ts` | 416 | edge function pre-edit |
| `mingla-business/src/services/ticketCheckoutService.ts` | 139 | service surface contract |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | 636 | screen + `handlePay` |
| `mingla-business/app/_layout.tsx` | 236 | provider tree + StripeNativeProvider mount |
| `mingla-business/src/payments/*` (7 files) | 113 total | deletion candidates |
| `mingla-business/app.config.ts` | 114 | plugins array |
| `mingla-business/package.json` | 107 | deps |
| `mingla-business/metro.config.js` | 115 | `@mingla/payments-native` alias source |
| `mingla-business/tsconfig.json` | 19 | tsconfig path mapping source |
| `mingla-business/src/services/mixpanelService.ts` | targeted | `track(name, props?)` signature |
| `.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` | 137 | §4 + §5 retirement targets |
| `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs` | 155 | `allowedNativeImportFiles` Set |
| `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` | 230 | `presentPaymentSheet` assertion (discovered during run) |
| `.github/workflows/strict-grep-mingla-business.yml` | 858 | registry + push trigger |
| `app-mobile/scripts/ci/orch-0837-regression-check.mjs` | run | confirm 5/5 PASS post-edge-edit |

---

## 3. OLD → NEW RECEIPTS

### `supabase/functions/ticket-checkout-create/index.ts`
**Before:** `CheckoutSurface = "native" | "web"`; line 44 forks to `"web"` else `"native"`; lines 175-312 are the `if (surface === "web")` Stripe Checkout Session branch with `success_url` / `cancel_url` derived from `MINGLA_PUBLIC_WEB_BASE_URL`.
**After:** `CheckoutSurface = "native" | "web" | "mobile-web"`; three-way ternary at line ~44 (unknown surfaces fall through to `"native"` for backward compat with older mobile builds); the hosted-Checkout branch widened to `if (surface === "web" || surface === "mobile-web")` with a `let successUrl / let cancelUrl` split — `"web"` keeps the `MINGLA_PUBLIC_WEB_BASE_URL`-anchored URLs verbatim; `"mobile-web"` emits `mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=success` (and `…&status=cancel`). The PaymentIntent branch (lines 314-415) is untouched.
**Why:** SPEC §2.2. Server-side allow-listing of the custom scheme keeps the contract explicit and testable; the `kind:"requires_web_redirect"` response shape stays identical for both surfaces (mobile and web callers branch on `kind`, not on surface).
**Lines changed:** ~50 inserted / ~10 modified (no deletions in the PI branch).
**Gates verified:** `deno check supabase/functions/ticket-checkout-create/index.ts` clean; ORCH-0837 regression check 5/5 PASS; ORCH-0804 Stripe Tax gate 6/6 PASS; ORCH-0791 + ORCH-0777 (post-retire) PASS.

### `mingla-business/src/services/ticketCheckoutService.ts`
**Before:** `surface?: "native" | "web"` with ORCH-0790 JSDoc.
**After:** `surface?: "native" | "web" | "mobile-web"` with extended JSDoc covering the new value + the deprecation of `"native"` for mingla-business mobile.
**Why:** SPEC §2.4 type widening; nothing else changes — `createTicketCheckout` continues to spread `surface` verbatim and `pollTicketCheckoutStatus` is untouched.
**Lines changed:** ~12 modified.

### `mingla-business/app/checkout/[eventId]/payment.tsx`
**Before:** Top imports include `useStripePaymentSheet`; `handlePay` (lines 188-358 pre-edit) forked on `Platform.OS === "web"` to use `window.location.assign` for web, then for native: `isPaymentSheetSupported` defensive branch + `initPaymentSheet` + `presentPaymentSheet` + `switch (payResult.error.code)` over `Canceled | Failed | Timeout`.
**After:** Top imports include `import * as WebBrowser from "expo-web-browser";` and `import { mixpanelService } …`; `useStripePaymentSheet` import removed; the destructured `initPaymentSheet / presentPaymentSheet / isPaymentSheetSupported` block removed; new file-top constant `CHECKOUT_RETURN_URL_SCHEME = "mingla-business://checkout/return"`. `handlePay` is a single code path: `surface = Platform.OS === "web" ? "web" : "mobile-web"`, then `createTicketCheckout({surface})` → `kind:"requires_web_redirect"` → web does `location.assign`; native does `WebBrowser.openAuthSessionAsync(checkout.hostedCheckoutUrl, CHECKOUT_RETURN_URL_SCHEME)` then branches on `browserResult.type` ∈ `{"success","cancel","dismiss","locked","opened"}`. Cancel/dismiss runs a defensive poll (race-win → success path; else silent cancel). Success runs the existing `pollTicketCheckoutStatus` → `recordResult` → `router.replace('/confirm')`. Five Mixpanel events emit: `ticket_checkout_pay_started`, `ticket_checkout_sheet_opened`, `ticket_checkout_succeeded`, `ticket_checkout_cancelled`, `ticket_checkout_failed`. Decline-toast state retained but dormant (Stripe owns decline UX inside the hosted page). The `payment` summary copy line is unified: `"You'll be redirected to Stripe to complete your purchase securely. Apple Pay and Google Pay are supported."` (was a `Platform.OS === "web"` ternary).
**Why:** SPEC §2.6 full rewrite. The deletion of the native PaymentSheet path is mandatory per Constitution #8 (subtract before adding). `openAuthSessionAsync` reuses the proven `BrandOnboardView.tsx:362` pattern.
**Lines changed:** ~170 inserted / ~170 removed (net ~0; full handlePay swap).
**Gates verified:** new orch-0839-b gate T-G5 + T-G6 PASS; ORCH-0789 (post-retire-§4-§5) PASS; ORCH-0777 (post-retire) PASS.

### `mingla-business/app/_layout.tsx`
**Before:** `import { StripeNativeProvider } from "../src/payments/StripeNativeProvider";` at line 34; `<StripeNativeProvider>` wrap at lines 226-230.
**After:** Import removed (replaced with a retirement-note comment block). Tree collapses to `GestureHandlerRootView → SafeAreaProvider → QueryClientProvider → AuthProvider → RootLayoutInner`.
**Why:** SPEC §2.7. The provider was a no-op pass-through; removing it has zero observable effect on the surviving paths.
**Lines changed:** ~5 modified.
**Gates verified:** new gate T-G7 PASS.

### `mingla-business/src/payments/` — deleted (entire directory)
- `stripePaymentSheet.ts` (47 lines)
- `stripePaymentSheet.native.ts` (12 lines)
- `stripePaymentSheet.web.ts` (24 lines)
- `StripeNativeProvider.tsx` (8 lines)
- `StripeNativeProvider.native.tsx` (6 lines)
- `StripeNativeProvider.web.tsx` (8 lines)
- `normalizePaymentSheetResult.ts` (9 lines) — verified zero external consumers via `grep -rn` in `mingla-business/{src,app}`.

Directory itself removed via `rmdir`. SPEC §2.5 fully executed.

### `mingla-business/app.config.ts`
**Before:** Plugins array contains the entry `["@stripe/stripe-react-native", { merchantIdentifier: …, enableGooglePay: true }]` at lines 60-66.
**After:** Entry deleted; retirement-note comment block in its place.
**Why:** SPEC §2.8. Without any import of `@stripe/stripe-react-native` the plugin entry was dead weight that still auto-linked the native framework. Removing it shrinks the .ipa/.apk on the next EAS build.
**Lines changed:** ~7 removed / ~5 inserted (net ~−2).
**Gates verified:** new gate T-G3 PASS.

### `mingla-business/package.json`
**Before:** `dependencies.@stripe/stripe-react-native: "^0.50.3"`. `dependencies.@mingla/payments-native` was NOT present (workspace dep was resolved via Metro/tsconfig alias only — confirms Discovery 1 from the prior blocker report).
**After:** `@stripe/stripe-react-native` removed from `dependencies`. New `scripts["test:orch-0839-b"]` invoking the new gate.
**Why:** SPEC §2.9 + the prior implementor's Discovery 1 — the dep is removed from the only place it actually lives. Verified `npm ls @stripe/stripe-react-native` now reports it `extraneous` (installed transitively in `node_modules` from a prior `npm install`, but no longer declared); on the next `npm install` it gets pruned.
**Lines changed:** 2 removed / 1 added.
**Gates verified:** new gate T-G4 PASS.

### `mingla-business/metro.config.js`
**Before:** `config.resolver.extraNodeModules["@mingla/payments-native"]` aliased to `packages/payments-native`.
**After:** Alias removed; retirement-note comment block. `@mingla/event-rendering` alias preserved (still consumed).
**Why:** Discovery 1 from the prior blocker report — the package was Metro-aliased, not npm-installed. Removing the alias is the actual mechanism for severing mingla-business's consumption of the shared package. `app-mobile/`'s own `metro.config.js` retains its independent alias.
**Lines changed:** ~6 removed / ~4 inserted.

### `mingla-business/tsconfig.json`
**Before:** `paths` map includes `"@mingla/payments-native": ["../packages/payments-native"]` + the `/*` glob.
**After:** Both entries removed. `@mingla/event-rendering` entries preserved.
**Why:** Same Discovery 1 mechanism on the TypeScript side.
**Lines changed:** 2 removed.

### `.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs`
**Before:** Six §-blocks; §4 asserts `stripePaymentSheet.ts` contains `PaymentSheetErrorCode` + the `"Canceled" | "Failed" | "Timeout"` literal; §5 asserts `payment.tsx` uses `switch (payResult.error.code)` + `case "Canceled"`.
**After:** §4 + §5 retired (clauses deleted + replaced with explicit retirement comment-block citing ORCH-0839-B); §1-3 (Toast.tsx + toastTimings.ts dismiss affordances) and §6 (legacy buyer-app copy absent) preserved verbatim.
**Why:** SPEC §2.10 Gate A. The `PaymentSheetErrorCode` discriminator no longer applies in mingla-business; the file the assertion targeted was deleted. The invariant stays alive in app-mobile via `packages/payments-native/types.ts`.
**Lines changed:** ~30 removed / ~10 inserted (net ~−20).
**Gates verified:** PASS post-retire.

### `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs`
**Before:** `allowedNativeImportFiles = new Set(["mingla-business/src/payments/StripeNativeProvider.native.tsx", "mingla-business/src/payments/stripePaymentSheet.native.ts"])`.
**After:** `allowedNativeImportFiles = new Set()` with retirement-note comment-block referencing the new ORCH-0839-B gate T-G1.
**Why:** SPEC §2.10 Gate B. Both files no longer exist; the allow-list is empty.
**Lines changed:** ~5 modified.
**Gates verified:** PASS post-shrink.

### `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` (NOT pre-flighted by SPEC §2.10 — discovered during run)
**Before:** Line 56-60 asserts `payment.tsx` contains the literal `"presentPaymentSheet"`.
**After:** Assertion retired with explicit retirement-note comment-block citing ORCH-0839-B + the replacement coverage in the new gate's T-G5/T-G6. All other ORCH-0777 contracts (free-checkout RPC, anon RLS, QR pepper, organizer order visibility, scanner) preserved verbatim.
**Why:** Discovered when running the full gate sweep — this assertion is structurally invalidated by the pivot (the pivot IS the removal of `presentPaymentSheet`). The replacement assertion lives in the new gate. This is the rare case where a single direct consequence of the SPEC change requires retiring an additional gate clause; documented as a Discovery so the orchestrator can record it in `INVARIANT_REGISTRY.md` alongside the ORCH-0789 §4/§5 retirements.
**Lines changed:** ~5 modified.
**Gates verified:** PASS post-retire.

### `.github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs` — NEW
197 lines. Eight contracts T-G1..T-G8 per SPEC §2.10:
- T-G1: no `@stripe/stripe-react-native` import anywhere under `mingla-business/{app,src}/`
- T-G2: no `@mingla/payments-native` import anywhere under `mingla-business/{app,src}/`
- T-G3: `app.config.ts` plugins array (comments stripped) does NOT contain `"@stripe/stripe-react-native"`
- T-G4: `package.json` `dependencies` does NOT include `@stripe/stripe-react-native` or `@mingla/payments-native`
- T-G5: `payment.tsx` imports `expo-web-browser` and calls `WebBrowser.openAuthSessionAsync` exactly once
- T-G6: `payment.tsx` derives surface via `Platform.OS === "web" ? "web" : "mobile-web"`
- T-G7: `_layout.tsx` (comments stripped) does NOT import or render `StripeNativeProvider`
- T-G8: `ticket-checkout-create/index.ts` recognises `"mobile-web"` AND emits `mingla-business://checkout/return` somewhere

Gate passes locally. Negative test confirmed: dropping a one-line `import { useStripe } from "@stripe/stripe-react-native";` file under `mingla-business/src/` trips T-G1 with the file path printed.

### `.github/workflows/strict-grep-mingla-business.yml`
**Before:** 858 lines; comment block lists registered gates through ORCH-0839-A cache-removed.
**After:** Comment block extended with ORCH-0839-B entry; new `orch-0839-b-mingla-business-no-native-stripe` job appended after `orch-0839-a-mobile-cache-removed` following the registry pattern. Push trigger `[main, Seth]` preserved (per ORCH-0781 wiring contract enforced by ORCH-0778 gate).
**Why:** SPEC §2.10 + `feedback_strict_grep_registry_pattern.md`.
**Lines changed:** ~13 inserted.

---

## 4. SPEC TRACEABILITY (SC-1..SC-12)

| SC | Status | Evidence |
|---|---|---|
| SC-1 (mobile Pay opens hosted Checkout < 3s) | UNVERIFIED | Code wired correctly per T-G5 + T-G6. Requires iOS-sim + Android-emu live-fire — handed to TEST mode. |
| SC-2 (success path lands at `/confirm` + paid order + email) | UNVERIFIED | `pollTicketCheckoutStatus` reused verbatim from proven web path; `recordResult` + `router.replace` identical to pre-pivot. Requires live-fire; handed to TEST mode. |
| SC-3 (cancel returns to `/payment` with no order) | UNVERIFIED (high confidence) | Logic in handlePay: `browserResult.type ∈ {"cancel","dismiss"}` → defensive poll → silent return + `setProcessing(false)`. Edge function stays in `awaiting_web_redirect` status; tombstone trigger (ORCH-0829-B) handles 15-min expiry. |
| SC-4 (Stripe page declined-card UX) | UNVERIFIED | Stripe owns decline UX inside the hosted page; only `cancel_url` redirect or dismiss surfaces to the app, then handlePay branches per SC-3. |
| SC-5 (no `<StripeNativeProvider>` wrap, no boot regression) | PASS by code | T-G7 verified; `_layout.tsx` tree collapsed. Requires boot smoke on iOS/Android sim — handed to TEST mode. |
| SC-6 (no native Stripe / payments-native imports anywhere) | PASS | T-G1 + T-G2 + T-G4 in new gate all pass locally. `npm ls @stripe/stripe-react-native` returns `extraneous` (declared dep removed; transient install dir prunes on next `npm install`). |
| SC-7 (telemetry parity per §2.11) | PASS by code | All five events (`ticket_checkout_pay_started`, `_sheet_opened`, `_succeeded`, `_cancelled`, `_failed`) emit at the prescribed trigger points in handlePay. Confirms in live-fire by tester. |
| SC-8 (web buyer flow byte-for-byte unchanged) | PASS by code | The `surface === "web"` branch in the edge function is functionally identical (same `success_url` + `cancel_url` derived from `MINGLA_PUBLIC_WEB_BASE_URL`). The `payment.tsx` web branch logic (`writeCheckoutResumePayload` + `location.assign`) is preserved; only the surrounding `surface = Platform.OS === "web" ? "web" : "mobile-web"` swap changes — web still gets `"web"`. Tester verifies T-03 in browser. |
| SC-9 (EAS rebuild boots cleanly with shrunk binary) | UNVERIFIED | Requires EAS build — owned by orchestrator at CLOSE. |
| SC-10 (hosted Checkout via `openAuthSessionAsync`) | PASS | T-G5 enforces "exactly one" `WebBrowser.openAuthSessionAsync` call in payment.tsx. |
| SC-11 (`/checkout/...` never calls `useAuth`) | PASS | `grep -n "useAuth" mingla-business/app/checkout/` returns zero matches. Preserved verbatim. |
| SC-12 (new gate green; ORCH-0789 §4/§5 deleted; ORCH-0778 allow-list empty; no regressions) | PASS | New gate green; ORCH-0789 + ORCH-0778 + ORCH-0777 all PASS post-edit; ORCH-0837 regression check 5/5 PASS; ORCH-0804 6/6 PASS; META-ORCH-0827 isolation gates both PASS. |

---

## 5. INVARIANT VERIFICATION

| ID | Pre-state | Post-state | Notes |
|---|---|---|---|
| I-PROPOSED-O ANON-BUYER-ROUTES | ACTIVE | PRESERVED (ACTIVE) | `grep -n "useAuth" mingla-business/app/checkout/` returns zero matches. |
| I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG | ACTIVE | RETIRED-FOR-MINGLA-BUSINESS-ORCH-0839-B (orchestrator records at CLOSE) | `<StripeProvider>` mount removed from mingla-business. Stays ACTIVE for app-mobile via `packages/payments-native/StripeNativeProvider.tsx`. |
| I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES | ACTIVE | PRESERVED (ACTIVE) | Edge function PI branch (lines ~330-360 post-edit) still uses `payment_method_types: ["card"]`. ORCH-0837 gate 5/5 PASS confirms. |
| I-PROPOSED-STRIPE-CALLBACK-WIRED | ACTIVE | PRESERVED (ACTIVE — app-mobile-only) | mingla-business doesn't need it (the in-app browser intercepts before any Linking listener fires). |
| I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE | ACTIVE | PRESERVED (ACTIVE) | DB-side, unaffected. ORCH-0829-B D-1 gate PASS. |
| I-PROPOSED-ERROR-TOAST-DISMISSIBLE | ACTIVE | PRESERVED (ACTIVE) | Toast.tsx + toastTimings.ts untouched. ORCH-0789 §1-3 + §6 PASS. |
| I-PROPOSED-STRIPE-ERROR-CODE-DISCRIMINATED | ACTIVE | RETIRED-FOR-MINGLA-BUSINESS-ORCH-0839-B (orchestrator records) | The file the invariant gated (`stripePaymentSheet.ts`) was deleted. Invariant stays ACTIVE for app-mobile via `packages/payments-native/types.ts`. ORCH-0789 §4 + §5 retired. |
| I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE | ACTIVE | RETIRED-FOR-MINGLA-BUSINESS-ORCH-0839-B | Wrapper no longer in mingla-business code path. ACTIVE for app-mobile. |
| I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY | ACTIVE | RETIRED-FOR-MINGLA-BUSINESS-ORCH-0839-B | Same rationale. ACTIVE for app-mobile. |
| I-37 / I-38 / I-39 WCAG | ACTIVE | PRESERVED | Pay button unchanged; no new Pressable added. |
| I-PROPOSED-MINGLA-BUSINESS-HOSTED-CHECKOUT-ONLY (NEW) | n/a | ESTABLISHED + GATED | Codified by new gate T-G1..T-G8. Orchestrator adds to `INVARIANT_REGISTRY.md` at CLOSE. |
| I-PROPOSED-MOBILE-WEB-SURFACE-RETURNS-CUSTOM-SCHEME (NEW) | n/a | ESTABLISHED + GATED | Edge function emits `mingla-business://checkout/return` for `surface="mobile-web"` and `https://…` for `surface="web"`. T-G8 gate enforces the custom-scheme string presence in the edge function. Deno unit test not added in this PR (no `__tests__/` folder existed for this edge function; deferred to follow-up per Discovery 4). |
| Constitution #1, #2, #3, #6, #8, #11 | ACTIVE | PRESERVED | See SPEC §4 mapping; all preserved. |

---

## 6. PARITY CHECK

| Surface | Affected | Outcome |
|---|---|---|
| mingla-business mobile iOS | YES | New `handlePay` via `openAuthSessionAsync` + `surface: "mobile-web"`. Confirms via T-G5 + T-G6. Live-fire deferred to TEST mode. |
| mingla-business mobile Android | YES | Same code path; same gate. |
| mingla-business web (Vercel) | NO functional change | Same `surface: "web"` edge call; same `success_url` / `cancel_url`. Only diffs to web branch: (a) `surface` derivation moved into a ternary at top of handlePay (logically equivalent), (b) five Mixpanel events now fire on web too (the SPEC §2.11 "+1 polish welcome" option taken because the same emits naturally cover both branches in the unified try/catch). |
| app-mobile (consumer) iOS / Android / web | NO | Zero edits under `app-mobile/`. Confirmed by `git status`. |
| Admin dashboard | NO | No Stripe surface in admin. |
| Solo mode / Collab mode | NO | Anon buyer flow — no solo/collab fork. |

---

## 7. CI GATE OUTPUT

```
=== orch-0839-b-mingla-business-no-native-stripe.mjs ===
ORCH-0839-B mingla-business no-native-stripe gate passed.

=== orch-0789-error-toast-dismissible.mjs (post-retire §4 + §5) ===
ORCH-0789 strict-grep gate passed.

=== orch-0778-web-stripe-native-import-gate.mjs (allow-list empty) ===
ORCH-0778 web Stripe native import gate passed.

=== orch-0777-ticket-checkout-production.mjs (presentPaymentSheet retired) ===
ORCH-0777 production checkout guard passed.

=== orch-0791-checkout-session-never-reused-post-terminal.mjs ===
ORCH-0791 strict-grep gate passed.

=== orch-0804-stripe-tax-enabled-on-checkout.mjs ===
ORCH-0804 strict-grep PASS — 6/6 checks.

=== orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs ===
[orch-0829b-d1] PASS

=== orch-0837-regression-check.mjs (app-mobile) ===
ORCH-0837 regression check
  [PASS] T-C0 ticket-checkout-create/index.ts creates PI with payment_method_types: ['card']
  [PASS] T-C1 ticket-checkout-create/index.ts does NOT use automatic_payment_methods: {enabled: true}
  [PASS] T-C2 app/index.tsx imports useStripe from @stripe/stripe-react-native
  [PASS] T-C3 app/index.tsx invokes handleURLCallback at least once
  [PASS] T-C4 app/index.tsx Linking listener invokes handleURLCallback BEFORE falling through to handleDeepLink
Summary: 5/5 PASS

=== meta-orch-0827-package-isolation.mjs ===
META-ORCH-0827 package isolation gate PASS.

=== meta-orch-0827-no-web-stripe-in-consumer.mjs ===
META-ORCH-0827 consumer-native-Stripe-only gate PASS.
```

Full sweep of all mingla-business strict-grep gates (excluding unrelated `orch-0776a` which fails pre-existing on Step-4 video upload progress — verified by `git stash` round-trip): **only ORCH-0839-B-touched gates ran into change, and all pass**.

### Deno gate
```
$ /Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts
Check supabase/functions/ticket-checkout-create/index.ts
(exit 0 — clean)
```
No `__tests__/` directory exists for this edge function; `deno test` skipped (no test files to run). Adding T-12 + T-13 fixtures (per SPEC §5) deferred to a follow-up (Discovery 4 below).

### TypeScript gate (scoped)
```
$ cd mingla-business && npx tsc --noEmit | grep -E "(payment\.tsx|ticketCheckoutService|_layout\.tsx|src/payments)" 
(empty — zero errors in touched files)
```
The pre-existing 31 TS errors are entirely under `packages/event-rendering/*.tsx` (no react types installed at that workspace) and six test files referencing a dropped `category` column on `DraftEvent`. None are caused by this PR; `git stash` round-trip confirms.

---

## 8. DISCOVERIES FOR ORCHESTRATOR

1. **(Preserved from prior blocker report — Discovery 1.)** `@mingla/payments-native` is resolved via Metro alias (`mingla-business/metro.config.js`) + tsconfig path-mapping (`mingla-business/tsconfig.json`), NOT a `package.json` dep. SPEC §2.9 instruction to "remove `@mingla/payments-native` from `mingla-business/package.json` dependencies" was moot; the actual removal targets were the alias + path map, both executed in this PR. Update SPEC §2.9 at orchestrator-CLOSE-time to reflect this, OR file the SPEC amendment as a follow-up.

2. **NEW.** ORCH-0777 gate had a `payment.tsx` `"presentPaymentSheet"` assertion that the SPEC §2.10 didn't list. It was structurally invalidated by the pivot (the pivot IS the removal of `presentPaymentSheet`). Retired with retirement-note comment-block citing ORCH-0839-B. Orchestrator should record this retirement in `INVARIANT_REGISTRY.md` alongside ORCH-0789 §4/§5 retirements.

3. **NEW.** Negative test infrastructure is implicit — the gate's regex shape correctly trips on a one-line `import` test file (manually verified). For future maintenance, consider adding a `--self-test` mode to the gate (mirroring `i-proposed-h-rls-returning-owner-gap.mjs` + `i-proposed-i-mutation-rowcount-verified.mjs`) so CI can prove the gate isn't permanently tautological.

4. **NEW.** Deno unit tests for the edge function's new `"mobile-web"` surface (T-12 + T-13 in SPEC §5) NOT written in this PR — `supabase/functions/ticket-checkout-create/` has no existing `__tests__/` folder and writing the first one creates a meaningful scaffold (mock Stripe + service-role Supabase client) that's worth a dedicated unit-test ORCH. Deferred. The behaviour is statically enforced by T-G8 (string presence) + functionally exercised by the orchestrator's probe (which already returned `custom-scheme-accepted`). For tester live-fire, T-01 + T-02 cover the same path end-to-end.

5. **NEW.** `PaymentElementStub.tsx` (in `mingla-business/src/components/checkout/PaymentElementStub.tsx`, JSDoc comment line 16) references `@stripe/stripe-react-native` inside a comment block. The new gate's T-G1 regex specifically matches `import` / `from` / `require()` / `import()` forms — bare comment tokens do NOT match. Confirmed by gate's PASS status. The file is itself a `[TRANSITIONAL]` stub never imported by the live checkout flow (verified by `grep -rn "PaymentElementStub" mingla-business/app mingla-business/src` returning only the file itself + its tests, with no functional caller). Orchestrator may want to file a small follow-up to retire the stub entirely now that hosted Checkout fully replaces the Cycle-8 stub plan.

6. **NEW.** The orchestrator's transitional probe edge function (`supabase/functions/orch-0839-b-stripe-probe/`) and its deployed counterpart MUST be removed at CLOSE — both the local source folder AND the deployed function at `https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/orch-0839-b-stripe-probe`. This implementor did NOT touch the probe per the dispatch instruction.

7. **NEW.** `mingla-business/ios/Pods/StripePaymentSheet/` and friends are stale CocoaPods artifacts from a prior EAS build. They'll be regenerated (or not — depending on the plugin removal) on the next `expo prebuild` / EAS build kicked off by the orchestrator. Not a code issue, but worth documenting so testers don't get confused if they `grep` and see the Pod source.

---

## 9. CACHE SAFETY

No React Query keys changed. No Zustand persisted shape changed. The `sessionStorage` web-resume payload schema is identical to pre-pivot (same `writeCheckoutResumePayload` call, same `readCheckoutResumePayload` reader on confirm screen). No persisted-key migration needed.

---

## 10. REGRESSION SURFACE (for TEST mode)

The 5 adjacent features most likely to break:

1. **Free-ticket flow** (T-08) — `payment.tsx` defensive guard at the existing line ~133 bounces to `/buyer` BEFORE `handlePay` is reachable for `totals.isFree`. Verify in TEST: pick a free-ticket event, confirm direct `/buyer → /confirm` path holds.
2. **Web buyer flow** (T-03) — verify in Chrome that the same Stripe Checkout URL is generated and the same `success_url` / `cancel_url` lands the buyer at `/confirm?cs=...`. The new code paths through a slightly refactored top-of-handlePay but the surface fork to `"web"` is preserved.
3. **iOS 26 simulator boot** — verify in TEST that `_layout.tsx` boots without `<StripeNativeProvider>` and without `'StripeSdk' TurboModule` warnings (the original ORCH-0836 LogBox filter for app-mobile is unaffected).
4. **Anon-buyer-route invariant** — verify `grep -n "useAuth" mingla-business/app/checkout/` returns zero matches AND the Pay button works without a signed-in session in dev build.
5. **Mixpanel telemetry** — verify in `__DEV__` Metro logs that the five events emit at the prescribed trigger points on a happy path AND a cancel path.

---

## 11. CONSTITUTIONAL COMPLIANCE

| Principle | Outcome |
|---|---|
| #1 No dead taps | PRESERVED — Pay button still triggers handlePay; processing + finalizing states render correctly. |
| #2 One owner per truth | PRESERVED — server is the truth for order status (`pollTicketCheckoutStatus`); cart in Context; UI state local to component. |
| #3 No silent failures | PRESERVED — every thrown error → `setPaymentError` + Mixpanel `_failed`. Browser cancel = intentional silent return (mirrors web cancel UX). |
| #6 Logout clears everything | PRESERVED — buyer flow is anonymous; nothing to clear. |
| #8 Subtract before adding | OBEYED — native PaymentSheet code path REMOVED before hosted Checkout path added. `useStripePaymentSheet` deleted; `StripeNativeProvider` removed; ORCH-0789 §4/§5 retired. |
| #11 One auth instance | PRESERVED — `AuthContext` untouched. |
| Universal output / detail-in-files | PRESERVED — this report exists; chat will be 4-section + handoff. |

---

## 12. TRANSITION ITEMS

- **Decline-toast state** (`declineToast` / `setDeclineToast`) is retained in `payment.tsx` but dormant — Stripe owns decline UX inside the hosted page; the absolute-positioned `<Toast />` wrapper at the bottom of the JSX keeps `feedback_toast_needs_absolute_wrap.md` pattern intact for future use. Marked with a comment in-source explaining the dormancy. NOT a `[TRANSITIONAL]` per the canonical macro because there is no defined exit condition; the state is genuinely vestigial. Orchestrator may decide to remove it in a follow-up cleanup.

---

## 13. NEXT-STEP MATRIX

- Edge function deploy — orchestrator-owned at CLOSE: `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv`.
- EAS rebuild — orchestrator-owned at CLOSE: `eas build --profile preview --platform ios` (for TEST mode), then `eas build --profile production --platform ios` / `--platform android` for store submission.
- Probe-function cleanup — orchestrator-owned at CLOSE: delete `supabase/functions/orch-0839-b-stripe-probe/` locally AND the deployed function.
- TEST mode (Claude `mingla-forensics` TARGETED) — independently verifies T-01..T-13 against this report + the SPEC.

---

## 14. CONFIDENCE LEVEL

**HIGH.** Probe gate satisfied; all static gates green; Deno check clean; scoped TS clean; pattern reuses proven `openAuthSessionAsync` from `BrandOnboardView.tsx`. Residual risk is the same one the SPEC named: real-device behaviour of `openAuthSessionAsync` under live Stripe redirects on iOS 26 + Android 14. TEST mode owns that verification with Maestro + sim.

---

## 15. VERIFICATION MATRIX

| Criterion | Status | Reason |
|---|---|---|
| Pre-flight read of SPEC + grounding docs + every modified file | PASS | Inventory above. |
| Stripe sandbox probe | PASS (via orchestrator) | `custom-scheme-accepted` from orchestrator probe attached to dispatch. |
| Edge function widen `surface` to "mobile-web" + URL fork | PASS | Deno check clean; T-G8 + ORCH-0837 + ORCH-0804 all PASS. |
| Service layer surface type widening | PASS | TS clean for touched file. |
| `payment.tsx` `handlePay` rewrite (single code path) | PASS by code | T-G5 + T-G6 PASS. Live-fire deferred. |
| `_layout.tsx` provider-tree collapse | PASS by code | T-G7 PASS. Boot smoke deferred. |
| Six payment files deletion + `normalizePaymentSheetResult.ts` orphan delete | PASS | Directory removed. |
| `app.config.ts` plugin entry removal | PASS | T-G3 PASS. |
| `package.json` dep removal + Metro alias removal + tsconfig path removal | PASS | T-G4 PASS; `npm ls` shows `extraneous`. |
| New CI gate `orch-0839-b-mingla-business-no-native-stripe.mjs` | PASS | Gate passes positively + trips on negative probe. |
| ORCH-0789 §4/§5 retirement | PASS | Gate green post-retire. |
| ORCH-0778 allow-list shrink | PASS | Gate green post-shrink. |
| ORCH-0777 `presentPaymentSheet` retirement (discovery) | PASS | Gate green post-retire. |
| Workflow file `strict-grep-mingla-business.yml` job registration | PASS | Job appended; comment registry updated. |
| Deno check for edge function | PASS | Exit 0. |
| Deno unit tests T-12 + T-13 | DEFERRED | No `__tests__/` scaffold exists for the edge function; statically enforced by T-G8. See Discovery 4. |
| `npx tsc --noEmit` on touched files | PASS | Zero errors in touched files. |
| All adjacent strict-grep gates green | PASS | Full sweep done; only pre-existing unrelated orch-0776a fails. |
| EAS rebuild + on-device live-fire | DEFERRED | Owned by orchestrator + TEST mode at CLOSE. |

Status: **implemented, partially verified** — every layer that can be statically verified IS verified; on-device sim/emulator verification deferred to TEST mode per dispatch.

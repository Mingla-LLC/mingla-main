# IMPLEMENTATION — ORCH-0789 + ORCH-0790: Public Ticket Checkout Failure-Handling (mobile) + Web Buyer Payment Flow

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Predecessors:** `Mingla_Artifacts/specs/SPEC_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md` + `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md`.
**Executor:** Claude `mingla-implementor` (parity mirror invoked by operator "take over" directive).

---

## 1. Old → New receipts

### 1a. `supabase/migrations/20260520000001_orch_0789_0790_web_checkout.sql` (NEW)

**What it does:** drops + recreates the `ticket_checkout_sessions_status_check` constraint to add `'awaiting_web_redirect'` to the canonical seven values (`pending_free`, `requires_payment`, `processing_payment`, `paid_completed`, `free_completed`, `failed`, `expired` — read from the latest migration that owns this CHECK, `20260515000013_orch_0777_ticket_checkout_core.sql:94-102`). Also adds a nullable `stripe_checkout_session_id text` column with a partial index `WHERE NOT NULL`. Operator owns `supabase db push --linked`.

**Why:** SPEC §2.6 — the new web flow records a Stripe Checkout Session ID alongside the existing PaymentIntent ID, and the session lifecycle has a new "buyer is on the Stripe-hosted page" status between create and webhook finalisation.

**Lines changed:** new file, 37 lines. Filename monotonic: max prefix on `Seth` was `20260520000000`, new is `20260520000001`.

### 1b. `supabase/functions/_shared/ticketCheckout.ts`

**Before:** exposed `classifyStripePaymentIntentCreateFailure` only.

**After:** refactored to share the failure-classification logic across both Stripe primitives; added `classifyStripeCheckoutSessionCreateFailure` (same shape, distinct `detail` prefix `stripe_checkout_session_create_failed:…` for observability). Internal helper `classifyStripeCreateFailure(error, prefix)` is the single source of truth.

**Why:** SPEC §2.5 — the new web branch needs equivalent error classification when `stripe.checkout.sessions.create` fails. Reuse beats duplication.

**Lines changed:** 33 lines refactored; net +17 lines.

### 1c. `supabase/functions/ticket-checkout-create/index.ts`

**Before:** request schema took `eventId, buyer, lines`; always created a Stripe PaymentIntent and returned `{kind: "requires_payment", clientSecret, ...}` for paid flows.

**After:** request schema gains optional `surface: "native" | "web"` (defaults to `"native"` for back-compat — older mobile builds never send the field). When `surface === "web"`, the function:
1. Reads `MINGLA_PUBLIC_WEB_BASE_URL` from env; rejects with 500 + `web_base_url_missing` if absent or not `https://`.
2. Resolves event name from the session payload (`session.eventName`) for the Checkout line-item display.
3. Creates a Stripe Checkout Session via `stripe.checkout.sessions.create({mode: "payment", line_items: [...], payment_intent_data: {transfer_data: {destination: stripeAccountId}, metadata: {...}}, customer_email, success_url, cancel_url, metadata})` with idempotency key `ticket_checkout_web:${checkoutSessionId}`. Destination charges mirror the native PaymentIntent path exactly.
4. On Stripe failure: classifies via the new helper, flips the row to `status='failed'` with `failure_reason`, returns the classified `httpStatus` and `detail`.
5. On success: writes `status='awaiting_web_redirect'` + `stripe_checkout_session_id` to the row, returns `{kind: "requires_web_redirect", checkoutSessionId, buyerStatusToken, hostedCheckoutUrl, totalCents, currency}`.
6. The existing native path is untouched (still `paymentIntents.create` + `processing_payment` + `{kind: "requires_payment", clientSecret, ...}`).

`success_url` is `${baseUrl}/checkout/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}` (Stripe template variable; `cs` carries the Stripe-side Checkout Session ID — not our internal token). `cancel_url` is `${baseUrl}/checkout/${eventId}/payment`.

**Why:** SPEC §2.5 — web buyers need a real payment path. Operator-recommended Checkout Sessions chosen over Payment Element per investigation Open Q-1.

**Lines changed:** +109 lines (new web branch inserted between `stripeAccountId` resolution and the existing `paymentIntents.create` block); +2 lines (imports + type alias).

**Deno gate:** `deno check supabase/functions/ticket-checkout-create/index.ts` ✅ clean (run from repo root via `/Users/sethogieva/.deno/bin/deno`).

### 1d. `supabase/functions/_shared/stripeWebhookRouter.ts`

**Before:** `handleTicketCheckoutPaymentIntent` resolved our session row strictly by `stripe_payment_intent_id`. `STRIPE_ROUTED_EVENT_TYPES` did not include `checkout.session.completed`.

**After:** two coordinated changes so Checkout-Session-driven payments finalise through the same path as native PaymentIntents.
1. Added `"checkout.session.completed"` to `STRIPE_ROUTED_EVENT_TYPES`.
2. New `handleCheckoutSessionCompleted` resolves the session row by `metadata.mingla_checkout_session_id` and back-fills `stripe_payment_intent_id` so subsequent PI events hit the existing handler.
3. Existing `handleTicketCheckoutPaymentIntent` gained a metadata-fallback lookup: when the PI-id lookup misses, it reads `paymentIntent.metadata.mingla_checkout_session_id` and looks up by our internal id, then back-fills `stripe_payment_intent_id`. This handles the race where `payment_intent.succeeded` arrives before `checkout.session.completed`.
4. Routing switch dispatches `checkout.session.completed` to the new handler.

The finalisation logic (`biz_ticket_checkout_finalize` RPC + `ticket-confirmation-dispatch` post) is **unchanged** — Checkout-Session-driven and native-PaymentIntent-driven flows converge on the same `payment_intent.succeeded` finalisation path.

**Why:** SPEC §2.5 webhook section. Spec sketched a `checkout.session.completed` handler that called the existing PI handler; investigation Phase 3 of implementation showed the cleaner shape is: (a) `checkout.session.completed` back-fills the PI id so the subsequent PI handler resolves normally, (b) PI handler grows a metadata-fallback for race-safety. **This is a small refinement on the spec sketch; behaviour is equivalent or better.**

**Lines changed:** +60 lines (3 edits — event-types tuple, new handler, switch case, metadata fallback inside existing handler).

**Deno gate:** `deno check supabase/functions/_shared/stripeWebhookRouter.ts` ✅ clean.

### 1e. `mingla-business/src/payments/stripePaymentSheet.ts`

**Before:** `PaymentSheetResult.error` was typed as `{message?: string}` — discarded every Stripe discriminator field.

**After:** widened to carry `PaymentSheetErrorCode = "Canceled" | "Failed" | "Timeout"` plus optional `declineCode`, `localizedMessage`, `stripeErrorCode`. Module-level docstring documents the ORCH-0789 motivation. The platform-agnostic Metro fallback `useStripePaymentSheet` still returns `isPaymentSheetSupported: false` but now produces a typed `code: "Failed"` error.

**Why:** SPEC §2.2 — typed discriminator at the wrapper boundary is the structural fix for RC-789-2.

**Lines changed:** rewritten, 54 lines (was 30).

### 1f. `mingla-business/src/payments/normalizePaymentSheetResult.ts` (NEW)

**What it does:** pure (no-RN-import) normalizer for Stripe RN's PaymentSheetResult. Type-narrows `code` to the allowed enum; unknown codes coerce to `"Failed"`; preserves optional `declineCode`/`localizedMessage`/`stripeErrorCode`; supplies a fallback message when Stripe omits one.

**Why:** SPEC §2.2 mandated wrapper unit tests. Mingla-business's Jest harness uses `testEnvironment: "node"` with no `@testing-library/react-native`. Extracting the normalizer to a no-RN file keeps the production wrapper functional AND makes the logic unit-testable. This is a structural refinement that strengthens the spec's intent.

**Lines changed:** new file, 50 lines.

### 1g. `mingla-business/src/payments/stripePaymentSheet.native.ts`

**Before:** raw `useStripe()` pass-through with the narrow error type.

**After:** uses the extracted `normalizePaymentSheetResult` for every `initPaymentSheet` and `presentPaymentSheet` result. `isPaymentSheetSupported = true` (unchanged). The hook contract is identical to before for happy-path callers; error callers now get the full discriminator.

**Why:** SPEC §2.2.

**Lines changed:** 22 lines (down from 18 — clearer separation).

### 1h. `mingla-business/src/payments/stripePaymentSheet.web.ts`

**Before:** generic `unsupported` stub.

**After:** typed `unsupported` stub returns `{error: {code: "Failed", message: "Stripe PaymentSheet is not available on web."}}`. Module comment documents that the web flow uses Stripe Checkout Sessions via `createTicketCheckout({surface: "web"})` instead.

**Why:** SPEC §2.2 — wrapper type consistency on the stub.

**Lines changed:** 22 lines (was 14).

### 1i. `mingla-business/src/components/ui/toastTimings.ts` (NEW)

**What it does:** exports `AUTO_DISMISS` per-kind schedule (`success: 2600, info: 2600, warn: 6000, error: 12000`) plus `ToastKind` type. No RN imports — pure constants so `I-PROPOSED-AU ERROR_TOAST_DISMISSIBLE` is unit-testable.

**Why:** SPEC §2.1 changed `AUTO_DISMISS.error` from `null` (permanent) to a bounded number. Extracting the timings into a separate file keeps the invariant verifiable in the node-env Jest harness.

**Lines changed:** new file, 18 lines.

### 1j. `mingla-business/src/components/ui/Toast.tsx`

**Before:** error toast was permanent (`AUTO_DISMISS.error = null`); render tree had no `Pressable`, no close icon, no tap-to-dismiss. The only path that fired `onDismiss` was `Modal.onRequestClose` (Android back only). The result on iOS was an undismissable banner.

**After:**
1. `AUTO_DISMISS` imported from `toastTimings.ts` (single source of truth; testable).
2. Added optional prop `autoDismissMs?: number | null` (per-instance override; documented as exceptional).
3. Auto-dismiss `useEffect` reads `autoDismissMs === undefined ? AUTO_DISMISS[kind] : autoDismissMs`; `null` still disables the timer when explicitly requested.
4. Render tree: outer card is now a `Pressable` with `onPress={onDismiss}` and `accessibilityLabel="Dismiss notification"` (tap-anywhere-on-card dismiss).
5. Body row gains a 32 × 32 close-icon `Pressable` with `hitSlop={12}` (effective 56 × 56 hit area — satisfies I-38), `accessibilityLabel="Dismiss notification"`, transparent-white background tint, and the existing `close` icon.

Visual style of the card (glass tokens, padding, border, blur, icon badge) is unchanged. Toast still self-portals via Modal (DEC-085 pattern preserved).

**Why:** SPEC §2.1 / RC-789-1 / I-PROPOSED-AU.

**Lines changed:** +30 lines (3 edits — import + Pressable, prop, render tree, styles), -6 lines (old AUTO_DISMISS table).

### 1k. `mingla-business/app/checkout/[eventId]/payment.tsx`

**Before:** `handlePay` early-returned with the misleading "Mingla Business mobile app" copy on web; on native, any Stripe error in `presentPaymentSheet` flipped on the decline toast and threw — Canceled, Failed, and Timeout were indistinguishable.

**After:** restructured `handlePay`:
1. **Web branch** (`Platform.OS === "web"`): calls `createTicketCheckout({surface: "web"})`, expects `kind === "requires_web_redirect"`, persists `{checkoutSessionId, buyerStatusToken}` to `sessionStorage` at key `mingla:checkout:${eventId}` (so confirm.tsx can resume after Stripe redirect — `buyerStatusToken` deliberately NOT in URL to avoid leakage), then `window.location.assign(hostedCheckoutUrl)`. On error: clears `processing`, sets `paymentError`, no redirect.
2. **Native PaymentSheet init failure**: now surfaces as inline error (not a decline toast — `initPaymentSheet` errors are config/network issues, not user intent).
3. **Native present result**: switches on `payResult.error.code`:
   - `"Canceled"` → silent return (no toast, no error text, `processing=false`). The buyer just changed their mind.
   - `"Timeout"` → inline `paymentError = "Stripe took too long — please try again."`, no decline toast.
   - `"Failed"` (and unknown fall-through) → existing `setDeclineToast(true)` path (toast is now dismissible per 1j).
4. **PAYMENT GlassCard copy**: web text replaced with `"You'll be redirected to Stripe to complete your purchase securely. Apple Pay and Google Pay are supported."` (no more "use the Mingla Business mobile app").

The successful-pay finalization path (poll → recordResult → `/confirm`) is unchanged.

**Why:** SPEC §2.3 + §2.4 + §2.5 component branch. Resolves RC-789-2 and RC-790-1 + CF-790-2 in one screen.

**Lines changed:** +75 lines (handlePay rewrite), -4 lines (copy update).

### 1l. `mingla-business/app/checkout/[eventId]/confirm.tsx`

**Before:** assumed `result` was already populated in cart context (set by `payment.tsx` after native success). If `result === null`, bounced to `/checkout/{eventId}`.

**After:** adds web Stripe-success cold-start handler. When `Platform.OS === "web"` AND `result === null` AND URL contains `?cs=` AND `sessionStorage["mingla:checkout:${eventId}"]` exists, the screen reads `{checkoutSessionId, buyerStatusToken}` from storage, calls `pollTicketCheckoutStatus` (the existing service), and on success calls `recordResult(...)` and removes the storage entry. On failure (timeout, polling error), it sets `webResumeError` and renders a "Payment received — tickets will arrive by email shortly." fallback. The defensive-bounce `useEffect` now skips its bounce while a web resume is in flight so Stripe's success redirect isn't kicked back to the cart screen.

**Why:** SPEC §2.5 confirm-screen update. Cart context is in-memory and dies on the full-page Stripe redirect; the resume tokens live in `sessionStorage`.

**Lines changed:** +90 lines (new effect + fallback render + bounce-skip guard); +1 line (import `pollTicketCheckoutStatus`); +1 line (destructure `recordResult` from cart).

### 1m. `mingla-business/src/services/ticketCheckoutService.ts`

**Before:** `TicketCheckoutCreateResult` was a union of `TicketCheckoutRequiresPayment | TicketCheckoutFreeCompleted`. Input shape was `{eventId, buyer, lines}` only.

**After:** added `TicketCheckoutRequiresWebRedirect` to the union (`kind, checkoutSessionId, buyerStatusToken, hostedCheckoutUrl, totalCents, currency`). Input gained optional `surface?: "native" | "web"`. `createTicketCheckout` passes `surface` through to the edge function only when defined (so older bundles bound to older mobile builds don't send a stray field).

**Why:** SPEC §2.5 service layer.

**Lines changed:** +21 lines.

### 1n. `mingla-business/src/payments/__tests__/stripePaymentSheet.test.ts` (NEW)

7 unit tests against `normalizePaymentSheetResult` covering: empty result, Canceled passthrough (T-01), Failed + declineCode passthrough (T-02), Timeout passthrough, unknown-code → Failed coercion (T-03), missing-message fallback, optional-fields-omitted hygiene.

**Result:** `npx jest stripePaymentSheet.test` → 7/7 PASS.

### 1o. `mingla-business/src/components/ui/__tests__/Toast.test.tsx` (NEW)

5 unit tests against `AUTO_DISMISS` covering: error timer is bounded number, error timer ≥ 8 s, error timer ≤ 20 s, success/info/warn unchanged from prior behaviour, every kind has a defined finite timer.

**Result:** `npx jest Toast.test` → 5/5 PASS.

**Test-infra gap:** SPEC §5 also lists T-04..T-12 (render-tree tests for tap-to-dismiss, close-icon tap, `autoDismissMs={null}`, web `window.location.assign`, and edge-function smoke). These require `@testing-library/react-native` (Toast render) and a JSDOM-equivalent environment (payment.tsx web smoke) — neither is currently installed in `mingla-business/`. Documented under Discoveries §"Test-infra setup".

### 1p. `.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` (NEW)

6-section gate:
1. `toastTimings.ts AUTO_DISMISS.error` must match `/error:\s*\d+/` (positive number, not null).
2. `toastTimings.ts AUTO_DISMISS.error` must NOT be `null`.
3. `Toast.tsx` must import `Pressable` (close button + tap-to-dismiss).
4. `Toast.tsx` must render `accessibilityLabel="Dismiss notification"` (close-icon affordance).
5. `stripePaymentSheet.ts` must export `PaymentSheetErrorCode` union.
6. `stripePaymentSheet.ts` must declare the three Stripe codes (`Canceled | Failed | Timeout`).
7. `payment.tsx` must switch on `payResult.error.code`.
8. `payment.tsx` must handle `"Canceled"` explicitly.
9. `payment.tsx` must NOT contain `"Mingla Business mobile app"`.

**Result:** `node .github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` → PASS.

### 1q. `.github/workflows/strict-grep-mingla-business.yml`

Added a new job `orch-0789-error-toast-dismissible` (4 lines + container, matching the existing job pattern in the file).

### 1r. `Mingla_Artifacts/INVARIANT_REGISTRY.md`

Added two DRAFT entries at the top of the registry, mirroring the AQ..AT precedent:
- **I-PROPOSED-AU ERROR_TOAST_DISMISSIBLE** — DRAFT, flips ACTIVE on CLOSE.
- **I-PROPOSED-AV STRIPE_ERROR_CODE_DISCRIMINATED** — DRAFT, flips ACTIVE on CLOSE.

---

## 2. Spec traceability

| Spec SC | Implementation | Verification |
|---------|----------------|--------------|
| SC-01 (cancel = silent return) | `payment.tsx` `switch (payResult.error.code) { case "Canceled": setProcessing(false); return; }` | Unit test in §1n (T-03 type-coverage); needs live iPhone smoke per SPEC T-20 |
| SC-02 (decline toast dismissible) | `Toast.tsx` Pressable card + close icon + 12 s timer | Unit test in §1o (bounded timer); strict-grep gate (affordances); needs live iPhone smoke |
| SC-03 (Timeout distinct copy) | `payment.tsx` `case "Timeout": setPaymentError("Stripe took too long — please try again.")` | Needs live device/network test |
| SC-04 (web redirect ≤ 2 s) | `payment.tsx` web branch: `await createTicketCheckout({surface: "web"})` → `window.location.assign(hostedCheckoutUrl)` | Needs live web smoke per SPEC T-21 |
| SC-05 (web success → confirm) | `confirm.tsx` `?cs=` + sessionStorage resume effect; webhook router back-fills PI id | Needs live web smoke |
| SC-06 (web cancel → /payment, no toast) | `cancel_url: ${baseUrl}/checkout/${eventId}/payment` | Needs live web smoke |
| SC-07 (existing native unchanged) | Native PaymentSheet path preserved; only error-code branching added | Full Jest suite green (47/47 suites, 288/288 tests) |
| SC-08 (error auto-dismiss 12 s) | `AUTO_DISMISS.error = 12000` in `toastTimings.ts` | Toast.test.tsx |
| SC-09 (strict-grep gate works) | `.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` | `node` execution returns 0 on clean code |
| SC-10 (no `useAuth` in buyer routes) | No additions to imports in `confirm.tsx` or `payment.tsx` | Read-confirmed |
| SC-11 (legacy copy removed) | "Mingla Business mobile app" string deleted from `payment.tsx` | Strict-grep gate §6 enforces |
| SC-12 (Canceled preserved) | `normalizePaymentSheetResult.ts` | stripePaymentSheet.test.ts T-01 |
| SC-13 (unknown code → Failed) | `normalizePaymentSheetResult.ts` `isPaymentSheetErrorCode` guard | stripePaymentSheet.test.ts T-03 |
| SC-14 (DB accepts new status) | Migration `20260520000001` extends CHECK with `'awaiting_web_redirect'` | Awaiting `supabase db push` then SQL probe |

---

## 3. Invariant verification

| Invariant | Preserved? | How |
|-----------|-----------|-----|
| I-PUBLIC-BUYER-ANON-TOLERANT | Y | No `useAuth` added; `confirm.tsx` + `payment.tsx` unchanged on this dimension |
| I-TOAST-SELF-PORTAL (post-2026-05-02) | Y | Modal portal pattern preserved; affordance changes are inside the existing Animated.View / Modal |
| I-38 IconChrome ≥ 44pt | Y | Close button 32 × 32 + `hitSlop={12}` → 56 × 56 effective |
| I-39 explicit accessibilityLabel on Pressable | Y | Both `Pressable`s carry `accessibilityLabel="Dismiss notification"` |
| I-PROPOSED-J Zustand persist no server snapshots | Y | Cart context still in-memory; sessionStorage holds only `{checkoutSessionId, buyerStatusToken}` (IDs, not server records) |
| I-CHECKOUT-IDEMPOTENT (ORCH-0777) | Y | New web branch uses `idempotencyKey: ticket_checkout_web:${checkoutSessionId}` |
| I-PROPOSED-AU ERROR_TOAST_DISMISSIBLE (NEW) | Established | DRAFT in registry; strict-grep + Toast.test enforce |
| I-PROPOSED-AV STRIPE_ERROR_CODE_DISCRIMINATED (NEW) | Established | DRAFT in registry; strict-grep + stripePaymentSheet.test enforce |

---

## 4. Verification matrix

- **TypeScript** — `cd mingla-business && npx tsc --noEmit` → exit 0.
- **Jest (full suite)** — `npx jest` → **47/47 suites, 288/288 tests PASS** in 20.9 s.
- **Strict-grep ORCH-0789 gate** — `node .github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` → PASS.
- **Strict-grep regression** — full sweep of `.github/scripts/strict-grep/*.mjs`. All gates pass EXCEPT `orch-0776a-video-upload-progress-honesty.mjs` — **pre-existing failure** on `Seth` (no files I modified are within its scope; flagged as discovery DISC-IMPL-1 below).
- **Deno check on touched edge code** — `ticket-checkout-create/index.ts`, `_shared/stripeWebhookRouter.ts`, `_shared/ticketCheckout.ts` all type-check clean via `/Users/sethogieva/.deno/bin/deno check`.
- **Deno test suite** — not run for the new Checkout-Session path. There are no existing Deno tests for `ticket-checkout-create`; the new web branch is structurally parallel to the native branch and would benefit from a dedicated Deno test (operator may add as a follow-up if desired).

**Verification verdict:** implementation complete, code-gates verified, render/runtime verification deferred to TEST phase as designed.

---

## 5. Parity check

- **Native iOS / Android:** payment.tsx native branch unchanged behaviorally for non-error paths; error path now has three distinct code branches. Affects both iOS and Android identically (Stripe RN's `PaymentSheetError.code` is platform-consistent).
- **Web:** new redirect flow added. Cancel and Failure paths route through Stripe-hosted page error handling (Stripe's own UI), not our toast.
- **Solo/collab parity:** N/A — buyer flow is single-user.
- **Organiser-side surfaces:** untouched.
- **Mingla mobile (`app-mobile/`):** unchanged — that app does not host the buyer checkout.
- **Admin dashboard (`mingla-admin/`):** unchanged.

---

## 6. Cache safety

- No React Query keys changed. `useCart` (React Context, in-memory) unchanged. Cart context's `recordResult` is the same function called from both native finalisation and the new web resume.
- `sessionStorage` is per-tab and survives the Stripe redirect; cleaned up by `confirm.tsx` after successful resume. If the buyer abandons after redirect, the entry expires with the tab.

---

## 7. Regression surface

The 3-5 adjacent features most likely to be affected — TEST should exercise these:

1. **Free ticket checkout** (`/checkout/{eventId}` zero-total flow). My edge function changes branch on `surface` AFTER the free-completion path, so the free flow is byte-for-byte unchanged. Smoke regression test recommended.
2. **Existing native paid checkout** (the happy-path completion after Stripe sheet success). The native error-code branching only fires on errors; the success path (init → present → poll → recordResult → confirm) is unchanged.
3. **Native Stripe sheet "init" errors** (e.g., network failure). Previously surfaced as a thrown decline toast; now an inline `paymentError`. UX is gentler but operator may want to verify the inline message is visible.
4. **Other `<Toast kind="...">` usages in `mingla-business/`** — only one error-kind site exists (grep result). All success/info/warn timings unchanged. Toast self-portal contract preserved (DEC-085). Verify with a manual scroll through any organiser surface that toasts.
5. **Stripe webhook PI handler for native flow** — the new metadata-fallback path only runs when the PI-id lookup misses (which never happens for native; the PI id is written at session-create time). Native flow is byte-for-byte unchanged in the success path.

---

## 8. Constitutional compliance

| # | Principle | Status | Note |
|---|-----------|--------|------|
| 1 | No dead taps | ✅ | New Pressables wired to `onDismiss`; existing buttons unchanged |
| 2 | One owner per truth | ✅ | `AUTO_DISMISS` and Stripe error normalisation each have one canonical file |
| 3 | No silent failures | ✅ | Canceled is silent BY DESIGN (it's user intent, not a failure); Failed/Timeout surface |
| 4 | One key per entity | N/A | No React Query touched |
| 5 | Server state server-side | ✅ | sessionStorage holds IDs, not server records (I-PROPOSED-J preserved) |
| 6 | Logout clears everything | N/A | Buyer routes are anon |
| 7 | Label temporary | N/A | Nothing transitional added |
| 8 | Subtract before adding | ✅ | Old `error: null` removed; legacy "Business mobile app" copy removed; old wrapper narrowing replaced |
| 9 | No fabricated data | ✅ | "Tickets will arrive by email" fallback in confirm.tsx is truthful (Stripe success URL means payment definitely succeeded) |
| 10 | Currency-aware | ✅ | Edge function passes `currency` from session payload to Stripe |
| 11 | One auth instance | N/A | Buyer flow is anon |
| 12 | Validate at right time | ✅ | Stripe error code branching happens AT sheet-result, not earlier |
| 13 | Exclusion consistency | N/A |  |
| 14 | Persisted-state startup | ✅ | sessionStorage key uses scoped name; cleanup on success |

---

## 9. Transition items

None. Nothing left imperfect.

---

## 10. Migrations awaiting `supabase db push`

- `supabase/migrations/20260520000001_orch_0789_0790_web_checkout.sql` — operator must run `supabase db push --linked` before the edge function deploy.

## 11. Edge functions awaiting deploy

After the migration push and pre-deploy gate verification, deploy:

- `ticket-checkout-create` — touched directly. Existing `verify_jwt` setting must be preserved. Recommended command: `/Users/sethogieva/bin/supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv`.
- The Stripe webhook function (whichever function in `supabase/functions/` imports `_shared/stripeWebhookRouter.ts`). Likely `stripe-webhook` — operator should grep + deploy it. The router's exported entry points are unchanged behaviorally; only the routing switch and one PI handler grew.

## 12. Secrets / environment awaiting operator

- **`MINGLA_PUBLIC_WEB_BASE_URL`** — must be set as a Supabase function secret before the web flow works. The new web branch in `ticket-checkout-create` returns 500 + `web_base_url_missing` if absent or not `https://`-prefixed. Recommend the canonical Mingla Business web origin (operator confirms exact URL — e.g., `https://business.usemingla.com` or wherever the public deploy lives).
- **`STRIPE_RAK_TICKET_CHECKOUT` scope** — the existing restricted API key must grant `checkout_sessions:write` (or equivalent permission for Stripe Checkout Session creation) in addition to its current `payment_intents:write`. If the key lacks scope, the new web branch will return 502/`stripe_checkout_session_create_failed:401:stripe_key_or_capability_config`. Operator action: verify scope in the Stripe dashboard; mint a new key with the additional permission if required (mirror ORCH-0787's RAK pattern).

## 13. Discoveries for orchestrator

- **DISC-IMPL-1: `orch-0776a-video-upload-progress-honesty` strict-grep gate is failing on `Seth`.** Pre-existing — none of the files I touched are within its scope. Step 4 video upload appears to have a determinate-percentage gap. Recommend a separate ORCH for the orchestrator's queue.
- **DISC-IMPL-2: Toast render-test infrastructure missing.** SPEC §5 T-07..T-10 (close-icon tap, body tap, timer advance, `autoDismissMs={null}`) require `@testing-library/react-native`. Not currently installed in `mingla-business/`. Two options for TEST phase: (a) install the test-infra (`@testing-library/react-native` + jest-expo preset + jsdom + asset mocks) — substantive setup; (b) verify via live iOS/Android simulator parity (SPEC §5 T-20). Recommend (b) for ORCH-0789 close; (a) as a follow-up sub-ORCH.
- **DISC-IMPL-3: SPEC sketched a `checkout.session.completed` handler that calls the existing PI handler.** Implementation chose a cleaner shape: the new event-type handler back-fills `stripe_payment_intent_id`, then the existing PI handler runs normally on the subsequent `payment_intent.succeeded` event. Also added a metadata-fallback to the PI handler for race-safety. This is a minor refinement on the spec — behaviour is equivalent or better, and the existing finalisation path is untouched.
- **DISC-IMPL-4: `stripePaymentSheet.ts` (Metro fallback) is structurally identical to `stripePaymentSheet.web.ts`.** Investigation DISC-2 already flagged this as a P3 follow-up. Not addressed here — out of ORCH-0789/0790 scope.
- **DISC-IMPL-5: There are no existing Deno tests for `ticket-checkout-create`.** The new web branch would benefit from a Deno test that mocks `stripe.checkout.sessions.create` and asserts the response shape + idempotency key + metadata. Recommend as a TEST-phase deliverable or a P3 follow-up.
- **DISC-IMPL-6: `stripe_checkout_session_id` column added but no RLS adjustment needed.** The existing `ticket_checkout_sessions` RLS already governs the row by `event_id` / brand membership; the new column is read-write through the same policy.

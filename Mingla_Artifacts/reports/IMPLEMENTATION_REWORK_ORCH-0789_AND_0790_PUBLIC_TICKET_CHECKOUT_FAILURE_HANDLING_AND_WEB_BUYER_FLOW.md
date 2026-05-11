# IMPLEMENTATION REWORK — ORCH-0789 + ORCH-0790: cart state survives Stripe Checkout redirect

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Predecessors:** previous IMPLEMENTATION report + QA FAIL at `Mingla_Artifacts/reports/{IMPLEMENTATION_,QA_}ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md`.
**Trigger:** QA verdict FAIL on P1-A, P1-B, P1-C (shared root cause: cart context wiped by Stripe full-page redirect).
**Scope:** addresses exactly the three named P1 findings + the P2-B finding that fell out for free (`setProcessing(false)` on missing `location.assign`). Does NOT touch the migration, the edge function, the Stripe wrapper, the Toast primitive, or any pre-existing dirty-tree work from ORCH-0787.

---

## What failed in QA + how the rework fixes it

QA findings P1-A and P1-B were that the web `/confirm` screen — after a successful Stripe Checkout payment — rendered:
- Hero line `Sent to {buyer.email} and {buyer.phone}` as literally `Sent to  and ` (empty fields).
- Order summary card with the dividers but **zero** line item rows (because `lines.map(...)` iterated over an empty array).

QA finding P1-C was that the web `/payment` screen — after a Stripe Checkout cancel — bounced the buyer all the way back to the cart screen because the defensive guard at `payment.tsx:82` saw `lines.length === 0` and called `router.replace`.

All three findings share the same root cause: cart context (`mingla-business/src/components/checkout/CartContext.tsx`) is in-memory `useReducer` state by design and was wiped by the Stripe full-page redirect. The first implementation persisted only the resume tokens (`checkoutSessionId`, `buyerStatusToken`) to `sessionStorage`, not the cart `lines` or the `buyer` details.

The rework extends the persisted payload to include `{lines, buyer}`, restores them on both `/payment` (cancel return) and `/confirm` (success return) mount before any defensive guard or render fires, and only clears the storage entry on confirmed success so a buyer who cancels can retry without rebuilding the cart.

---

## Old → New receipts

### 1a. `mingla-business/src/components/checkout/checkoutPersistence.ts` (NEW)

**What it does:** canonical sessionStorage helper for the web Stripe Checkout round-trip. Exports `CheckoutResumePayload` type, storage-key builder, write/read/clear helpers, and an `isCheckoutResumePayload` shape guard. Pure data — no React, no RN — unit-testable in the node-env Jest harness.

**Why:** the previous implementation inlined `JSON.stringify`/`JSON.parse` + ad-hoc shape checking in both `payment.tsx` and `confirm.tsx`. Centralising it (a) makes the data shape canonical (one definition both sides agree on), (b) makes the validation testable, (c) preserves the I-PROPOSED-J Zustand-persist-no-server-snapshots invariant by enforcing what the payload may contain.

**Lines changed:** new file, 110 lines.

### 1b. `mingla-business/app/checkout/[eventId]/payment.tsx`

**Before:** the previous rework persisted only `{checkoutSessionId, buyerStatusToken}` to sessionStorage immediately before `window.location.assign(hostedCheckoutUrl)`. The defensive guard at lines 82-108 fired unconditionally on mount with empty cart and bounced to `/checkout/{eventId}`.

**After:**
1. Added a `restoreChecked` React state (initialized `true` on native — skip the gate; initialized `false` on web — wait for restore-check to complete).
2. Added a new web-scoped `useEffect` that runs once on mount: reads sessionStorage via the new `readCheckoutResumePayload` helper; if a payload exists AND cart is empty, restores each line via `setLineQuantity(...)` and calls `setBuyer(payload.buyer)`. Storage is NOT cleared here — only on success in `/confirm`. After the restore (or no-op if no payload), sets `restoreChecked = true`.
3. The existing defensive guard now gates on `restoreChecked` — it does nothing until the restore check has completed. After restoration, the guard's deps (`lines.length`, `buyer.*`) update and it re-evaluates against the populated cart, so no bounce fires.
4. Before `window.location.assign`, the redirect payload is now built via the helper:
   ```ts
   writeCheckoutResumePayload(storage, eventId, {
     checkoutSessionId, buyerStatusToken, lines, buyer,
   });
   ```
5. **P2-B fix (free roll-in):** if `w.location?.assign` is unavailable (test/sandbox), the code now calls `setProcessing(false)` and surfaces `"Couldn't redirect to Stripe. Please try again from a standard browser."` instead of silently leaving `processing=true` forever.

**Why:** P1-C (cart preserved on cancel return), P2-B (no-redirect-fallback surfaces error).

**Lines changed:** +48 lines (3 edits — imports, new state + restore effect, defensive-guard gating, persist + assign-fallback).

### 1c. `mingla-business/app/checkout/[eventId]/confirm.tsx`

**Before:** the resume effect read raw sessionStorage with inline JSON parse, narrow `{checkoutSessionId?, buyerStatusToken?}` type. After successful poll it called `recordResult(...)` and removed the storage entry. The buyer's `lines` and `buyer` were never restored, so the summary card and "Sent to …" hero rendered empty.

**After:**
1. Imports `readCheckoutResumePayload` + `clearCheckoutResumePayload` from the new helper, and destructures `setLineQuantity` + `setBuyer` from `useCart()`.
2. The resume effect now reads the full validated payload. If cart `lines.length === 0`, replays `setLineQuantity` for each persisted line. If `buyer.email + buyer.phone` are empty (defensive — handle the case where partial restore already happened), calls `setBuyer(payload.buyer)`.
3. Restoration runs **before** the async poll, so the summary card and hero line render with real data immediately on mount — even while the order is still finalising on the server.
4. Storage is cleared via `clearCheckoutResumePayload(storage, eventId)` only after `recordResult` succeeds. Polling failures leave the entry in place so a refresh can retry.
5. The defensive-bounce guard's web-skip predicate now uses the helper too — checks `readCheckoutResumePayload(...) !== null` instead of raw `getItem`. Also extended to skip the bounce when `webResumeError` has been set (so the "Payment received" fallback render stays visible instead of being kicked back to the cart screen).

**Why:** P1-A (hero shows real email/phone), P1-B (summary card shows real line items).

**Lines changed:** +35 lines net (resume effect rewrite + bounce-guard update).

### 1d. `mingla-business/src/components/checkout/__tests__/checkoutPersistence.test.ts` (NEW)

15 unit tests covering: storage-key construction, payload shape validation (accept fully-formed, reject null/non-objects/empty IDs/missing fields/malformed lines/malformed buyer/empty-but-typed lines accepted), round-trip (write → read returns identical payload), read-when-empty returns null, read-when-malformed-JSON returns null, read-when-wrong-shape returns null, clear removes only the targeted entry, per-eventId scoping (writing to evt_a doesn't affect evt_b), and graceful no-op when `storage === undefined` (native path).

**Why:** QA §"Required rework before re-test" item 4 — a Jest target that exercises the persist/restore helpers in isolation.

**Result:** `npx jest checkoutPersistence.test` → 15/15 PASS.

---

## Files NOT touched (per QA hard guards)

- `supabase/migrations/20260520000001_orch_0789_0790_web_checkout.sql` — already correct.
- `supabase/functions/ticket-checkout-create/index.ts` — already correct.
- `supabase/functions/_shared/stripeWebhookRouter.ts` — already correct.
- `supabase/functions/_shared/ticketCheckout.ts` — already correct (Deno check still clean).
- `mingla-business/src/components/ui/Toast.tsx` + `toastTimings.ts` — already correct.
- `mingla-business/src/payments/{stripePaymentSheet,normalizePaymentSheetResult}.{ts,native.ts,web.ts}` — already correct.
- `mingla-business/src/services/ticketCheckoutService.ts` — already correct.
- `mingla-business/src/components/checkout/CartContext.tsx` — NOT touched. Restore uses existing `setLineQuantity` + `setBuyer` actions (no new reducer action needed). Preserves I-PROPOSED-J — cart context still has zero persistence at the context level; sessionStorage is the web-scoped escape hatch for the Stripe round-trip only.
- `.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` — already correct.
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — already correct.
- The pre-existing dirty-tree files from ORCH-0787 (DISC-TEST-3) — out of scope.

---

## QA finding traceability

| QA finding | Fixed? | How |
|------------|--------|-----|
| P1-A (web /confirm hero shows blank email/phone) | YES | `confirm.tsx` resume effect calls `setBuyer(payload.buyer)` before render |
| P1-B (web /confirm summary shows zero line items) | YES | `confirm.tsx` resume effect replays `setLineQuantity` for each persisted line before render |
| P1-C (web Stripe cancel bounces to cart screen) | YES | `payment.tsx` adds restore-on-mount effect gated by `restoreChecked`; defensive guard now waits for restore-check before evaluating empty-cart |
| P2-A (Stripe Checkout line item shows "Tickets — Tickets") | DEFERRED | Out of rework scope (requires RPC change). Operator may register as a P3 sub-ORCH. |
| P2-B (`processing` stuck when `location.assign` missing) | YES | Rolled in for free — `payment.tsx` now resets `processing` and surfaces an inline error when assign is unavailable |
| P3 (Toast outer + inner Pressable double-fire on web) | NOT FIXED | Acceptable per the QA report's "leave as-is + document idempotency" option. The existing Toast.tsx comment at line 252 documents the contract. |

---

## Verification matrix (re-run)

| Gate | Result |
|------|--------|
| TypeScript (`npx tsc --noEmit` in `mingla-business`) | PASS — exit 0 |
| Jest full suite | PASS — **48/48 suites, 303/303 tests** (was 47/288 pre-rework; +1 suite / +15 tests) in 13.2 s |
| New `checkoutPersistence.test.ts` | PASS — 15/15 |
| Pre-existing `stripePaymentSheet.test.ts` + `Toast.test.tsx` | PASS — 12/12 (unchanged) |
| Deno check on `ticket-checkout-create/index.ts` | PASS (unchanged — not touched) |
| Deno check on `_shared/stripeWebhookRouter.ts` | PASS (unchanged — not touched) |
| ORCH-0789 strict-grep gate | PASS — `node .github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` exit 0 |
| ORCH-0778 strict-grep gate | PASS (cross-check — still no native Stripe imports leaking into web) |
| Full strict-grep sweep | 1 PRE-EXISTING FAIL (`orch-0776a` — flagged in initial implementation report DISC-IMPL-1; unrelated to this rework) |

---

## Invariant verification (re-check)

| Invariant | Preserved? | How |
|-----------|-----------|-----|
| I-PUBLIC-BUYER-ANON-TOLERANT | YES | No `useAuth` added to any buyer route |
| I-TOAST-SELF-PORTAL | YES | Toast.tsx not touched in rework |
| I-38 IconChrome ≥ 44pt | YES | Toast.tsx not touched |
| I-PROPOSED-J Zustand persist no server snapshots | **YES — strengthened.** Cart context retains zero persistence at the context level. The new sessionStorage payload contains IDs and the buyer's own input (their cart selections and contact details they typed in this very session). NOT server-fetched records like server-issued ticket QR payloads — those still come fresh from `pollTicketCheckoutStatus`. |
| I-CHECKOUT-IDEMPOTENT | YES | Idempotency keys unchanged |
| I-PROPOSED-AU ERROR_TOAST_DISMISSIBLE (DRAFT) | YES | Toast.tsx + gate unchanged |
| I-PROPOSED-AV STRIPE_ERROR_CODE_DISCRIMINATED (DRAFT) | YES | Stripe wrapper unchanged |
| Constitution #14 (Persisted-state startup) | **NOW FULLY MET** | sessionStorage round-trip now covers lines + buyer in addition to the tokens; both `/payment` and `/confirm` mount sequences honour the persisted state before any defensive bounce or render fires |

---

## Parity check

- **Native iOS / Android:** completely unchanged. The new `restoreChecked` state initialises `true` on native (`Platform.OS !== "web"`), so the defensive guard runs on first render exactly as before. The new restore-effect short-circuits on `Platform.OS !== "web"`. The sessionStorage helper itself is web-API-shaped (`Storage`), and on native the `globalThis.sessionStorage` is `undefined`, so the helpers are no-ops via their `if (storage === undefined) return` guards.
- **Web:** new behavior — restoration round-trips cart state across Stripe redirects.

---

## Cache safety

- No React Query keys changed.
- No new Zustand persistence.
- sessionStorage is per-tab, cleared on success, not used cross-tab. Cannot leak between buyers (one tab = one buyer session).
- I-PROPOSED-J preserved: only buyer-typed inputs (`lines`, `buyer`) + opaque tokens stored. No server-issued data.

---

## Regression surface (for retest)

1. **Native iOS PaymentSheet happy path** — verify the restore-effect short-circuits on native (does NOT poll sessionStorage, does NOT touch cart state). Native Jest suite passes.
2. **Native iOS error paths (Canceled / Failed / Timeout)** — unchanged from previous implementation. Full suite passes.
3. **Web free-checkout flow** — the free path (zero-total) short-circuits in `handlePay` before the web branch and never persists. Verify by reading payment.tsx free-path branching (`totals.isFree` defensive bounce at line 88 redirects to `/buyer`; the web persist call only fires inside `if (Platform.OS === "web")` AFTER the `createTicketCheckout({surface: "web"})` succeeds).
4. **Web cancel → /payment** — cart preserved; buyer can immediately tap Pay again. SessionStorage entry remains until success.
5. **Web success → /confirm** — hero shows correct email/phone, summary shows correct line items, QR carousel populated, sessionStorage entry cleared.
6. **Web hard refresh of /confirm after a successful poll** — `result` is null (cart context is fresh), but `lines` + `buyer` were just cleared. The retry runs `pollTicketCheckoutStatus` again, but the storage entry is gone, so resume effect short-circuits at `payload === null`. The defensive bounce fires → buyer lands on /checkout/{eventId}. **This is acceptable** — they already saw their tickets once; subsequent hard refresh after success is not a supported flow.
7. **Web tab close on Stripe page then reopen** — sessionStorage is per-tab; the new tab won't have the entry. Buyer rebuilds cart. Acceptable.

---

## Constitutional compliance (rework changes)

| # | Rule | Status |
|---|------|--------|
| 1 | No dead taps | ✅ |
| 2 | One owner per truth | ✅ `checkoutPersistence.ts` is the canonical owner of the resume payload shape |
| 3 | No silent failures | ✅ Malformed payloads return `null` from the read helper; no thrown exceptions silently swallow data |
| 8 | Subtract before adding | ✅ Replaced inline ad-hoc JSON parse + narrow type with the canonical helper |
| 14 | Persisted-state startup | ✅ NOW FULLY MET (was ⚠️ PARTIAL in QA) — sessionStorage round-trip is read on both `/payment` and `/confirm` mounts before any user-visible state |

---

## Operator deploy gates (unchanged from initial impl)

1. `supabase db push --linked` for `20260520000001_orch_0789_0790_web_checkout.sql`.
2. Set `MINGLA_PUBLIC_WEB_BASE_URL` Supabase function secret to the canonical web origin.
3. Verify `STRIPE_RAK_TICKET_CHECKOUT` has `checkout_sessions:write` scope; mint a new RAK if not.
4. Deploy `ticket-checkout-create` via `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv`.
5. Deploy `stripe-webhook` (the function importing `_shared/stripeWebhookRouter.ts`).

---

## Discoveries for orchestrator

- **DISC-REWORK-1: SPEC §SC-06 wording should be tightened on close** to require "buyer remains on /payment with cart selections + buyer details preserved" instead of just "no toast and no error message." QA already flagged this as DISC-TEST-4; the rework satisfies the tighter wording, but the spec text itself should be updated by the orchestrator at CLOSE time so future audits don't re-discover this gap.
- **DISC-REWORK-2: P2-A (`Tickets — Tickets` line item on Stripe page) remains.** Fix requires extending the `biz_ticket_checkout_create_session` RPC return shape to include `eventName`. That's a migration + edge function change — out of REWORK scope; register as a P3 sub-ORCH.
- **DISC-REWORK-3: A future hard-refresh-after-success edge case** — if a buyer hits browser-refresh on `/confirm` AFTER tickets were already shown, they bounce to the cart screen because storage is cleared and `result` is null. Acceptable; documented in §"Regression surface" item 6. Future improvement: persist the OrderResult in sessionStorage with a short TTL so refresh after success re-displays tickets. Low priority — buyers already have the QR via email/PDF and the QR carousel state is ephemeral by design.
- **DISC-REWORK-4: No new strict-grep gate added for the cart-persistence pattern.** The existing ORCH-0789 gate doesn't yet cover the rework. If the orchestrator wants structural enforcement (e.g., "any `surface: 'web'` checkout call must be paired with `writeCheckoutResumePayload`"), that's a worthwhile addition at CLOSE time. Skipped here to keep rework scope tight.

---

## Status

**Implemented and verified at code-gate level.** All three P1 findings addressed by a single coordinated change. P2-B fixed as a free roll-in. Full Jest suite green (48/48 suites, 303/303 tests including 15 new). TypeScript clean. Strict-grep ORCH-0789 gate passes. Native flow untouched. Web flow now preserves cart state across both cancel and success round-trips.

Live device + browser smoke (SPEC §5 T-20, T-21, T-22) remains for the TEST RETEST phase to verify.

# QA — ORCH-0789 + ORCH-0790: Public Ticket Checkout Failure-Handling (mobile) + Web Buyer Payment Flow

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Mode:** Claude `mingla-tester` (parity mirror) · TARGETED sub-mode.
**Predecessors:** SPEC + INVESTIGATION + IMPLEMENTATION at `Mingla_Artifacts/{specs,reports}/…_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md`.
**Disclosure:** I am also the implementor for this dispatch. Per the tester discipline rules, every implementor claim is treated as worthless until verified by direct file read. The findings below are the result of an adversarial re-read independent of the implementation report.

---

## Verdict

**FAIL** (two P1 findings affecting customer-visible UX on the web flow).

| Severity | Count |
|----------|-------|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 2 |
| P2 — MEDIUM | 2 |
| P3 — LOW | 1 |
| P4 — NOTE | 3 |

The two P1 findings share a common root cause: cart context (`lines`, `buyer`) is in-memory React state by design (`mingla-business/src/components/checkout/CartContext.tsx:8-9`: "NO AsyncStorage (cart lifetime = single tab session)"). The new Stripe Checkout Sessions redirect forces a full-page reload, which wipes that state. The implementation persists the resume tokens to `sessionStorage` but does NOT persist cart lines or buyer details — so the buyer returns from Stripe with an empty cart context. On native, this never happened because the PaymentSheet is a modal overlay, not a navigation.

The implementor (me) can fix both P1 findings in one change: extend the sessionStorage payload in `payment.tsx` to include `{lines, buyer}`, and restore them in `/payment` and `/confirm` mounts when cart context is empty and storage has data.

---

## Spec criteria traceability (SC-01..SC-14)

Read against `Mingla_Artifacts/specs/SPEC_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md` §3.

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| SC-01 | Cancel returns to summary, no toast, Pay re-enabled | **PASS (code)** | `payment.tsx:174-176` `case "Canceled": setProcessing(false); return;` — no toast, no thrown error, `processing` reset. Live device smoke owed. |
| SC-02 | Decline toast dismissible (close icon + tap + 12 s timer) | **PASS (code)** | Toast.tsx render tree has outer Pressable + close-icon Pressable + `AUTO_DISMISS.error = 12000` (verified `toastTimings.ts:13`). 5/5 Jest tests in `Toast.test.tsx` PASS. |
| SC-03 | Timeout shows distinct message | **PASS (code)** | `payment.tsx:177-180` `case "Timeout": setPaymentError("Stripe took too long — please try again.")`. |
| SC-04 | Web redirect happens on Pay tap | **PASS (code)** | `payment.tsx:142-167` web branch calls `createTicketCheckout({surface: "web"})` then `window.location.assign(hostedCheckoutUrl)`. Browser smoke owed. |
| SC-05 | Web success → /confirm with tickets recorded | **PARTIAL** | `recordResult(...)` is called and `result.tickets` renders the QR carousel correctly. **HOWEVER**: `lines` and `buyer` are not restored, so the order-summary GlassCard and the "Sent to …" hero line render empty. See P1-A + P1-B below. |
| SC-06 | Web cancel → /payment, no toast | **PARTIAL** | `cancel_url` is `/checkout/{eventId}/payment` (correct), no toast logic on that route. **HOWEVER**: empty `lines` triggers the defensive bounce at `payment.tsx:77-103` which redirects to `/checkout/{eventId}` (cart screen). Buyer loses all selections. See P1-C below. |
| SC-07 | Existing native flow unchanged | **PASS** | Full Jest suite 47/47 suites, 288/288 tests PASS. Native PaymentSheet code path only altered the error branch (Canceled/Timeout/Failed) — success path identical. |
| SC-08 | Error auto-dismiss at 12 s | **PASS** | `toastTimings.ts:13` `error: 12000`. Tested in `Toast.test.tsx`. |
| SC-09 | Strict-grep gate works | **PASS** | `node .github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` returns 0; manually verified §1–§6 checks each fail when the targeted invariant is broken. |
| SC-10 | No `useAuth` in buyer routes | **PASS** | Read-confirmed: no `useAuth` import added to `payment.tsx`, `confirm.tsx`, or `_layout.tsx`. |
| SC-11 | Legacy "Business mobile app" copy removed | **PASS** | Grep `"Mingla Business mobile app"` against `mingla-business/app/checkout/[eventId]/` returns no matches. Strict-grep gate §9 enforces. |
| SC-12 | Wrapper preserves Canceled code | **PASS** | `stripePaymentSheet.test.ts` T-01 PASS. |
| SC-13 | Unknown Stripe code coerced to Failed | **PASS** | `stripePaymentSheet.test.ts` T-03 PASS. |
| SC-14 | DB accepts `awaiting_web_redirect` | **PASS (pending push)** | Migration `20260520000001_orch_0789_0790_web_checkout.sql` extends CHECK constraint with the new value. Operator must run `supabase db push --linked`. Verified SQL by inspection; pending live SQL probe after push. |

**Summary:** 12 of 14 criteria PASS (code-side); 2 PARTIAL (SC-05, SC-06) due to the cart-state-not-persisted regression.

---

## Findings

### P1-A — Web /confirm hero line renders "Sent to  and " (empty email + empty phone)

**Severity rationale:** customer-visible incorrect data on the post-purchase confirmation screen. Buyer who paid sees an empty "Sent to …" line where their email + phone should be. Data-incorrect / UX-misleading per the P1 definition.

**File + line:** `mingla-business/app/checkout/[eventId]/confirm.tsx:204` — `Sent to {buyer.email} and {buyer.phone}.`

**Reproduction (paper-trace):**
1. Buyer on web browser opens public event page → /checkout/{eventId} → adds tickets → /buyer → enters email/phone → /payment → taps Pay.
2. `payment.tsx` web branch persists `{checkoutSessionId, buyerStatusToken}` to sessionStorage and navigates to Stripe.
3. Buyer completes payment on Stripe-hosted page.
4. Stripe returns to `${baseUrl}/checkout/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}` — full-page reload.
5. Cart context (`useReducer` from `CartContext.tsx`) re-initialises to `INITIAL_STATE` — `buyer = {name: "", email: "", phone: ""}`.
6. `confirm.tsx` resume effect polls and calls `recordResult({...})` — populates `result` but does NOT touch `buyer`.
7. Render: `Sent to {buyer.email} and {buyer.phone}` renders as `Sent to  and `.

**Root cause:** sessionStorage persistence in `payment.tsx:153-160` saves only `{checkoutSessionId, buyerStatusToken}`. Buyer details are not persisted.

**Fix:** extend the sessionStorage payload to include the `buyer` object, and restore it in `confirm.tsx` (and `payment.tsx`) before render when cart context is empty AND storage has data:

```tsx
// In payment.tsx web branch, before window.location.assign:
win.setItem(
  `mingla:checkout:${eventId}`,
  JSON.stringify({
    checkoutSessionId: checkout.checkoutSessionId,
    buyerStatusToken: checkout.buyerStatusToken,
    lines,    // NEW
    buyer,    // NEW
  }),
);

// In confirm.tsx resume effect, after parsing storage:
if (parsed.buyer) setBuyer(parsed.buyer);
// (and ditto for setLines/setLineQuantity — see P1-B below for the lines half)
```

`setBuyer` already exists on the cart context (`CartContext.tsx:200`). For `lines`, restore via repeated `setLineQuantity` calls or extend the context with a `setLines` action.

---

### P1-B — Web /confirm order-summary card renders zero rows (empty line items)

**Severity rationale:** customer-visible incorrect data on the confirmation screen — the summary card between the dividers (`confirm.tsx:223-234`) renders only the dividers and total because `lines.map(...)` iterates an empty array. Buyer sees their event name and total but no detail of what tickets they bought. Data-incorrect per the P1 definition.

**File + lines:** `mingla-business/app/checkout/[eventId]/confirm.tsx:224-234` — `{lines.map((l) => (...))}` over an empty array.

**Reproduction:** same as P1-A.

**Root cause:** same as P1-A — cart `lines` is in-memory React state wiped by the Stripe redirect.

**Fix:** same as P1-A — extend sessionStorage payload with `lines` and restore on confirm mount.

---

### P1-C — Web Stripe cancel bounces buyer through three screens, losing all cart selections

**Severity rationale:** revenue-affecting UX bug. A buyer who misclicked Pay (or who genuinely wants to change their mind on the Stripe page) returns to /payment, gets bounced to /checkout/{eventId} (cart screen), and has to rebuild their entire cart from scratch. Discourages legitimate re-purchase. Real revenue impact for a buyer-facing public flow.

**File + lines:** `mingla-business/app/checkout/[eventId]/payment.tsx:77-103` — the existing defensive guard `if (lines.length === 0) { router.replace(/checkout/${eventId}); return; }`.

**Reproduction (paper-trace):**
1. Buyer reaches /payment with cart context populated.
2. Taps Pay → web redirect to Stripe.
3. Cancels on Stripe page → `cancel_url` returns them to `${baseUrl}/checkout/${eventId}/payment` — full-page reload.
4. Cart context reinitialises with `lines = []`.
5. Defensive guard sees `lines.length === 0` → `router.replace('/checkout/${eventId}')`.
6. Buyer lands on cart screen. Selections gone. Buyer details gone (`setBuyer` was never called this session).

**Root cause:** same as P1-A/B — cart context is in-memory only.

**Fix:** same persistence strategy. On `/payment` mount, before the defensive bounce runs, restore from sessionStorage if cart is empty and the storage entry exists. The storage entry should NOT be deleted on cancel — only on confirmed success (which happens in `confirm.tsx`).

Also: on success-side cleanup in `confirm.tsx` resume effect, the sessionStorage entry is removed after `recordResult`. On cancel, the entry stays in storage (good — supports retry).

**Spec interpretation note:** SC-06 says "lands back on `/checkout/{eventId}/payment` with no toast and no error message." The implementation technically lands on `/payment` (briefly, ~1 frame) before bouncing. The spirit of SC-06 is that the buyer can immediately retry payment without rebuilding the cart. The current implementation violates that spirit even if it satisfies the literal letter.

---

### P2-A — Stripe Checkout line-item displays "Tickets — Tickets" instead of the event name

**Severity:** customer-visible cosmetic defect on the Stripe-hosted Checkout page. Buyer sees "Tickets — Tickets" as the product name. Functional (payment works) but unprofessional.

**File + line:** `supabase/functions/ticket-checkout-create/index.ts:164-166` reads `session.eventName` from the RPC response, but the RPC `biz_ticket_checkout_create_session` (`supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:467-477`) returns `{checkoutSessionId, eventId, brandId, status, totalCents, currency, stripeAccountId, orderId, items}` — `eventName` is NOT in the payload. So my line 164 fallback always returns `"Tickets"` and line 182 renders `"Tickets — Tickets"`.

**Fix options:**
1. Cleanest: change the template literal at line 182 to `eventName` (no `"Tickets — "` prefix). Result: "Tickets" for the unknown case (acceptable) or the actual event name (when we add it).
2. Better: extend the RPC to return `eventName` from the existing `v_event` lookup at migration line 351-353. Then the Stripe line item shows the real event name.

Recommend option 2 (operator may scope to a separate migration since this requires re-creating the RPC; option 1 is the in-scope fix).

---

### P2-B — `processing` state stays true forever if `window.location.assign` is unavailable

**Severity:** edge case (real browsers always have `location.assign`). Affects test/sandbox environments where `globalThis.location.assign` is undefined.

**File + lines:** `mingla-business/app/checkout/[eventId]/payment.tsx:160-167` — the `if (w.location?.assign) { w.location.assign(...) }` block silently no-ops if the assign function is missing, but the code preceding it set `processing = true` and the function returns without resetting.

**Fix:** add `setProcessing(false);` in an `else` branch when `assign` is missing, and surface an inline error message ("Couldn't redirect to Stripe — please try again from a standard browser.").

---

### P3 — Toast outer Pressable + inner close-icon Pressable may fire `onDismiss` twice on react-native-web

**Severity:** cosmetic; works in practice because consumers of Toast `onDismiss` are idempotent (`setDeclineToast(false)` etc.). Worth a doc note for future Toast callers.

**File + lines:** `mingla-business/src/components/ui/Toast.tsx:264-285` — outer `Pressable onPress={onDismiss}` wraps the body row, inner close-icon `Pressable onPress={onDismiss}` is inside it. On react-native-web (browser), click events bubble unless `event.stopPropagation()` is called. RN native Pressable's responder system generally prevents double-fire on iOS/Android, but web behavior depends on react-native-web's Pressable implementation.

**Fix options:**
1. Add `event.stopPropagation()` in the inner Pressable's onPress.
2. Restructure so the close button is OUTSIDE the outer Pressable.
3. Leave as-is and document the idempotency requirement (current state — my Toast.tsx comment at line 252 already says "onDismiss is idempotent").

The current state is acceptable per (3). Flagging P3 for future Toast consumers.

---

### P4-A — Praise: clean wrapper-extraction pattern

`normalizePaymentSheetResult.ts` is the right shape. Pure function, no RN imports, exported normalizer that both the wrapper and the test depend on. Makes the invariant testable without standing up a render harness. Worth replicating for any future wrapper that needs unit-testable error normalization.

---

### P4-B — Praise: defensive failure-classification reuse

`classifyStripeCreateFailure(error, prefix)` helper in `_shared/ticketCheckout.ts` is the right shape too — same classification logic shared between PaymentIntent and Checkout Session failures, distinct `detail` prefixes for observability. Avoids the easy mistake of duplicating the error-classification table for the new code path.

---

### P4-C — Praise: webhook metadata-fallback path is a clean defensive add

`handleTicketCheckoutPaymentIntent` falls back to metadata-based session lookup when the PI-id lookup misses, with back-fill of `stripe_payment_intent_id` so subsequent webhooks short-circuit on the fast path. Race-safe regardless of whether `checkout.session.completed` or `payment_intent.succeeded` arrives first. Better than the literal spec sketch (which assumed `checkout.session.completed` arrives first and is required) — the system works even if the operator forgets to subscribe to `checkout.session.completed` in the Stripe Dashboard webhook config.

---

## Constitution check (14 rules)

| # | Rule | Status | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | ✅ | All new Pressables wired to `onDismiss` / `onPress` |
| 2 | One owner per truth | ✅ | `AUTO_DISMISS` in `toastTimings.ts`, normalizer in `normalizePaymentSheetResult.ts` — single authoritative file each |
| 3 | No silent failures | ✅ | `payment.tsx` web branch catches and sets `paymentError`; `confirm.tsx` polling sets `webResumeError`; native handler now branches explicitly on every error code |
| 4 | One key per entity | N/A | No React Query touched |
| 5 | Server state server-side | ✅ | sessionStorage holds opaque tokens, not server records |
| 6 | Logout clears everything | N/A | Buyer flow is anon |
| 7 | Label temporary | ✅ | No `[TRANSITIONAL]` markers added |
| 8 | Subtract before adding | ✅ | Old `error: null`, old "Mingla Business mobile app" copy, old narrow wrapper type — all removed |
| 9 | No fabricated data | ✅ | Fallback message "Payment received — tickets will arrive by email shortly." is truthful; empty `lines.map` renders nothing (correct — better empty than fake) |
| 10 | Currency-aware | ✅ | Currency passed through from RPC to Stripe to client |
| 11 | One auth instance | N/A | Buyer flow is anon |
| 12 | Validate at right time | ✅ | Stripe error code branched at sheet-result, not earlier |
| 13 | Exclusion consistency | N/A |  |
| 14 | Persisted-state startup | ⚠️ PARTIAL | sessionStorage IS read on `/confirm` mount for tokens, but cart `lines`/`buyer` state is not — root cause of P1-A/B/C |

Rule #14 is the one that codifies the P1 finding. Not a flat violation (we DO read persisted state on web startup), but the coverage is incomplete.

---

## Code-gate verification (independent)

I re-ran every gate from scratch as the tester. All implementor claims about gate output verified.

| Gate | Result | Evidence |
|------|--------|----------|
| TypeScript (`cd mingla-business && npx tsc --noEmit`) | PASS | exit 0 |
| Jest full suite | PASS | 47/47 suites, 288/288 tests, 20.9 s |
| New Jest targets (`stripePaymentSheet.test`, `Toast.test`) | PASS | 12/12 |
| Deno check on `ticket-checkout-create/index.ts` | PASS | clean |
| Deno check on `_shared/stripeWebhookRouter.ts` | PASS | clean |
| Deno check on `_shared/ticketCheckout.ts` | PASS | clean |
| ORCH-0789 strict-grep gate | PASS | "ORCH-0789 strict-grep gate passed" |
| Full strict-grep sweep | 1 PRE-EXISTING FAIL | `orch-0776a-video-upload-progress-honesty.mjs` — none of my touched files are in its scope; flagged as DISC-IMPL-1 in implementation report |

---

## Cross-domain impact (independent re-trace)

1. **`app-mobile/` (Mingla consumer mobile app)** — does not host buyer checkout. Untouched.
2. **`mingla-admin/`** — does not host buyer checkout. Untouched.
3. **`mingla-business/` organiser surfaces** — `payment.tsx`, `confirm.tsx`, `Toast.tsx` are in scope but organiser routes don't render the buyer checkout. Toast primitive is shared — any organiser-side `<Toast kind="error">` now auto-dismisses at 12 s and is tap-dismissible. Verified by grep: only ONE `kind="error"` call site exists (`payment.tsx:364`), so the change is internally self-contained for now. All `kind="success"`, `kind="info"`, `kind="warn"` timings unchanged.
4. **`supabase/functions/` other functions** — only `_shared/stripeWebhookRouter.ts`, `_shared/ticketCheckout.ts`, and `ticket-checkout-create/index.ts` touched. The webhook router exports `STRIPE_ROUTED_EVENT_TYPES` — any function importing this tuple gets the new `checkout.session.completed` entry automatically. Likely consumed by the `stripe-webhook` function (which the implementor flagged for deploy). Verify there are no OTHER importers via grep:

```bash
grep -rn "STRIPE_ROUTED_EVENT_TYPES" supabase/functions/
```

Result during this QA: only one importer (the `stripe-webhook` function). No silent breakage elsewhere.

5. **DB layer** — migration is purely additive (one new constraint value, one new column). No data backfill needed. Existing rows continue to validate against the new CHECK (superset).

---

## Security audit (focused)

- **Anon-tolerance preserved** (I-PUBLIC-BUYER-ANON-TOLERANT) — no `useAuth` added; `orders.account_id` still nullable; new buyer route surface (`/confirm?cs=`) lives outside `(tabs)/`. ✅
- **buyerStatusToken in sessionStorage** — readable to any same-origin JS. If the public buyer site has XSS, the token leaks. Token lifetime is short (only useful until the order finalises). Acceptable risk; standard XSS hardening on the public site is the real defense. **P2 — not raised separately because XSS hardening is a global concern, not introduced by this change.**
- **Stripe Checkout success URL contains the Stripe-side CS ID** — this is public-by-design (Stripe stamps it). No internal token leaks via the URL. ✅
- **Idempotency keys** — new web branch uses `ticket_checkout_web:${checkoutSessionId}` (distinct from native `ticket_checkout:${checkoutSessionId}`); both scoped to the Mingla session id. Re-running the create call is safe. ✅
- **No new secrets in code** — all secret access via `Deno.env.get`. ✅
- **CORS unchanged** — `ticketCorsHeaders` reused. ✅

No security findings.

---

## Operator deploy gates (must complete before TEST can re-verify)

1. **`supabase db push --linked`** for `supabase/migrations/20260520000001_orch_0789_0790_web_checkout.sql`. Operator owns.
2. **Set Supabase function secret `MINGLA_PUBLIC_WEB_BASE_URL`** to the canonical Mingla Business web origin (operator confirms the exact URL — must start with `https://`). Without this the web flow returns 500 + `web_base_url_missing`.
3. **Verify `STRIPE_RAK_TICKET_CHECKOUT` has `checkout_sessions:write` scope.** If not, mint a new key (mirror ORCH-0787's RAK pattern).
4. **Deploy `ticket-checkout-create`** via `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv`. Orchestrator owns.
5. **Deploy `stripe-webhook`** (the function that imports `_shared/stripeWebhookRouter.ts`). Orchestrator owns.
6. **(Optional, observability)** subscribe the Stripe Dashboard webhook endpoint to `checkout.session.completed`. Functional path works without it (metadata fallback), but subscribing gives faster session-row updates.

---

## Required rework before re-test (P1 fixes)

Single coordinated change addressing P1-A + P1-B + P1-C:

1. In `payment.tsx:153-160`, extend the sessionStorage payload to include `{lines, buyer}` alongside `{checkoutSessionId, buyerStatusToken}`.
2. In `confirm.tsx` resume effect (added in this dispatch), after parsing storage, restore `setBuyer(parsed.buyer)` and replay the cart lines (either via repeated `setLineQuantity` or by extending CartContext with a `setLines` bulk-restore action).
3. In `payment.tsx` mount (new effect, or extend the existing defensive guard), check sessionStorage BEFORE the bounce-to-cart-when-empty logic fires. If storage has a valid entry for this `eventId`, restore lines + buyer instead of bouncing.
4. Update unit tests: extend `Toast.test.tsx` is N/A here; add a new Jest target (e.g. `paymentResume.test.ts`) that exercises the persistence + restore helpers in isolation (pure data — no RN).
5. Update spec's SC-06 wording so it explicitly requires cart preservation across the Stripe cancel round-trip (orchestrator owns the spec edit, not the implementor).

Estimated implementor effort: 1 focused pass; ~80 LOC across `payment.tsx`, `confirm.tsx`, and (optionally) `CartContext.tsx`. No backend changes. No new migration. No edge function re-deploy.

---

## Discoveries for orchestrator

- **DISC-TEST-1: Cart context not persisted is a structural gap that this dispatch exposed.** Pre-existing as of `Cycle 8`, but only exposed for the first time by the new web Stripe redirect. After the rework above lands, consider whether to register a follow-up sub-ORCH to add a CartContext-level persistence story (e.g. sessionStorage-backed reducer middleware) so future buyer surfaces don't have to re-discover this. P2 sub-ORCH candidate.
- **DISC-TEST-2: `orch-0776a` video-upload-progress strict-grep gate is failing on `Seth` unrelated to this dispatch.** Confirmed by reading the gate's scope — none of the files this dispatch touches are within the gate's targets. Independent surfacing needed.
- **DISC-TEST-3: The wider dirty tree contains ORCH-0787 close artifacts I did not touch** (`mingla-business/src/services/orderCancelService.ts`, `orderRefundService.ts`, `supabase/functions/cancel-order/`, `refund-order/`, etc.). My QA scope is the ORCH-0789/0790 files only; ORCH-0787 already has its own CLOSE_NOTE on `Seth`. Operator may want to confirm those changes are intended for the same commit / PR or split them.
- **DISC-TEST-4: SPEC §SC-06 phrasing is too permissive.** Strict literal reading lets the empty-cart-bounce slip through. After P1 rework, consider tightening to "buyer remains on /payment with cart selections + buyer details preserved, ready to retry."

---

## Test infrastructure gap (carried from implementor's DISC-IMPL-2)

The full render-tree tests T-04..T-12 in spec §5 (close-icon tap simulation, body-tap simulation, timer-advance with `jest.useFakeTimers`, `window.location.assign` mock, edge function smoke) require:
- `@testing-library/react-native` for Toast + payment.tsx render testing.
- `jest-environment-jsdom` or similar for `window.location.assign` mocking on web.
- Deno test fixtures for `ticket-checkout-create` (Stripe mock + DB mock).

None of these are currently installed in `mingla-business/`. The implementer (me) addressed this by:
1. Extracting the testable logic to RN-free helper files (`normalizePaymentSheetResult.ts`, `toastTimings.ts`).
2. Covering those helpers with 12 unit tests that DO pass in the node-env Jest harness.
3. Flagging the remaining matrix items for the TEST phase.

As tester I recommend **CONDITIONAL acceptance of this gap**: live-fire simulator + browser smoke (SPEC §5 T-20..T-22) is sufficient to verify the runtime behavior that the missing render tests would have asserted. A follow-up sub-ORCH should add `@testing-library/react-native` (substantive setup — ~30 min of config) so the next round of buyer-flow work has stronger CI guardrails.

---

## Next-test gate (after rework lands)

1. Re-read `payment.tsx` and `confirm.tsx` for the persistence + restore changes.
2. Re-run Jest (expect new `paymentResume.test.ts` to pass; existing tests unchanged).
3. Re-run TypeScript / Deno / strict-grep gates.
4. Re-verify the cross-domain trace.
5. Operator runs the 4 deploy gates above.
6. Operator runs live-fire smokes: SPEC §5 T-20 (iPhone simulator, full cancel + decline + success matrix), T-21 (web Safari success), T-22 (web Safari cancel — must preserve cart now).
7. On all-pass, upgrade verdict to PASS and dispatch to orchestrator for CLOSE.

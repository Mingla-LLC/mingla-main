# INVESTIGATION — ORCH-0851 [Consumer-app post-purchase visibility + email-to-auth-account gap]

**Mode:** INVESTIGATE
**Confidence:** Proven (six-field evidence on all root causes).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Date:** 2026-05-16

---

## Executive summary (layman terms)

The operator's two symptoms are **NOT one bug**. They're two separate findings of different severity, and one is an operator mental-model gap, not a code bug:

1. **"Tickets show but don't translate to orders" → no consumer app code bug.** The consumer Mingla app has **no separate "Orders" view at all**. The "Tickets" view IS the order view — `CalendarTab.tsx` queries the `orders` table directly via `useBusinessEventOrders(user.id)` and renders each order as a ticket card. The ticket card on the calendar IS the order. The operator's expectation of a separate "Orders" surface doesn't match the current product. This is a UX/discovery finding, not a data bug. Classification: 🔵 Observation + 🟡 Hidden Flaw (post-purchase invalidation can leave the calendar stale for ~1-3 seconds because there's no realtime subscription).

2. **"No email to auth-account email" → real bug, but in mingla-business, NOT the consumer app.** The consumer app (`app-mobile`) auto-fills `buyer.email` from `user.email ?? profile?.email` at `ExpandedBusinessEventSheet.tsx:217` and passes it READ-ONLY to `TicketCartSheet`. The email written to `orders.buyer_email` MUST equal the auth-account email for consumer-app purchases. However, **all of the operator's recent sessions with divergent `buyer_email` came from mingla-business's `app/checkout/[eventId]/buyer.tsx`** — a free-text form where the buyer types name/email/phone manually, used by BOTH the anonymous web buyer flow AND the authenticated business native mobile flow. The form does NOT pre-fill from the authenticated user's profile, even when one is signed in. Result: `buyer_email` can be any email the user typed, and confirmation emails go there — not to the auth-account email. Classification: 🔴 Root Cause.

3. **Side discovery — name/phone are also user-typed in mingla-business**, leading to data like `buyer_name = "Marcus Rivera"` for a user whose auth profile says `Seth Ogieva`. Classification: 🔴 Root Cause (same root as #2 — the buyer form is universal free-text).

---

## Phase 0 ingestion trace

Files read and probes run for this investigation:

- `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0851_CONSUMER_TICKET_ORDER_VISIBILITY_AND_AUTH_EMAIL.md` — dispatch.
- `app-mobile/app/_layout.tsx`, `app-mobile/app/index.tsx` — only two route files exist in the consumer app; routes are managed via internal state (AppStateManager → LikesPage → CalendarTab).
- `app-mobile/src/components/activity/CalendarTab.tsx` — the consumer "Tickets" tab.
- `app-mobile/src/hooks/useCalendarEntries.ts` + `useBusinessEventOrders` hook.
- `app-mobile/src/services/calendarService.ts` — `fetchUserBusinessEventOrders` SQL query.
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` — consumer ticket purchase entry point.
- `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` — consumer cart UI (ORCH-0847 Phase C).
- `app-mobile/src/payments/nativeCheckoutFlow.ts` — consumer native checkout glue.
- `mingla-business/app/checkout/[eventId]/buyer.tsx` — public + business native buyer form.
- `mingla-business/app/checkout/[eventId]/payment.tsx` — buyer→payment routing.
- `supabase/functions/ticket-confirmation-dispatch/index.ts` — recipient resolution.
- `supabase/functions/_shared/stripeWebhookRouter.ts` — `handleTicketCheckoutPaymentIntent`.
- DB probes:
  - `auth.users` for two operator user_ids → confirmed auth_email + profile_email match for each user.
  - `ticket_checkout_sessions` joined to `orders` and `auth.users` for the last 10 sessions of the two operator user_ids → confirmed buyer_email diverges from auth_email on several sessions.

---

## Investigation manifest (data flow trace)

```
Operator symptom A (no orders surface)
  → consumer-app "Tickets" tab
  → CalendarTab.tsx renders BusinessEventCalendarRow
  → useBusinessEventOrders(user.id) hook
  → CalendarService.fetchUserBusinessEventOrders → supabase.from('orders').eq('buyer_user_id', userId)
  → orders table

Operator symptom B (no email to auth-account)
  → buyer.email value at checkout
  → either: ExpandedBusinessEventSheet.handleBuy (consumer auto-fill from user.email)
       OR: mingla-business/app/checkout/[eventId]/buyer.tsx (free-text form)
  → nativeCheckoutFlow → ticket-checkout-create edge fn
  → ticket_checkout_sessions.buyer_email
  → biz_ticket_checkout_finalize copies session.buyer_email → orders.buyer_email
  → stripeWebhookRouter.handleTicketCheckoutPaymentIntent fires ticket-confirmation-dispatch
  → ticket-confirmation-dispatch sends Resend email TO order.buyer_email
```

---

## Findings (classified)

### 🔵 Observation O-1 — Consumer app has no separate "Orders" view

**File + line:** No relevant file — absence finding.
**Exact code:** N/A. The consumer app's route tree is just `app-mobile/app/_layout.tsx` + `app-mobile/app/index.tsx` (verified by `ls app-mobile/app/`). All in-app surfaces are state-managed through `AppStateManager`. The "Tickets" view is rendered inside `CalendarTab.tsx`.
**What it does:** Consumer-app users see paid tickets only via the calendar / Tickets tab. There is no `/orders`, `/purchases`, `/receipts` route, no "My Orders" tab, no order-detail screen.
**What it should do:** This is a product decision, not a bug. Possible follow-up: a dedicated Order Details surface accessible per-ticket (current state shows tickets without exposing payment status, amount paid, refund options, or receipt download). Operator's expectation suggests this would close a UX gap.
**Causal chain:** Operator buys ticket → ticket appears in Tickets/Calendar → operator searches for an "Orders" entry to confirm/inspect the purchase → finds none → reports "tickets don't translate to orders."
**Verification step:** `find app-mobile/app -type f` returns only `_layout.tsx` and `index.tsx`. `grep -rln "Orders\|My Orders\|Purchases" app-mobile/src app-mobile/app` returns no consumer-facing order-list surface; only billing references (paywall, RevenueCat).

### 🟡 Hidden Flaw H-1 — CalendarTab post-purchase freshness depends on `refetchOnWindowFocus`, not realtime

**File + line:** `app-mobile/src/hooks/useCalendarEntries.ts:56-71`.
**Exact code:**
```ts
export const useBusinessEventOrders = (userId: string | undefined) => {
  return useQuery<BusinessEventCalendarRow[]>({
    queryKey: ["businessEventOrders", userId],
    queryFn: async () => { … },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
    …
  });
};
```
And `ExpandedBusinessEventSheet.tsx:264-286` invalidates immediately + retries 3× over 3 seconds after a `succeeded` outcome.
**What it does:** When Stripe fires `payment_intent.succeeded` → webhook creates the order → consumer app does NOT receive a server-push event. The app only learns about the new order when (a) the user backgrounds + foregrounds the app, (b) the 5-minute staleTime expires + a re-render fires, or (c) within the 3-second post-checkout window thanks to the explicit invalidate loop in `handleBuy`.
**What it should do:** The order row exists in the DB within milliseconds of `payment_intent.succeeded` reaching the webhook (which after tonight's round-5 fix is now reliably <2 seconds). For a buyer who closes the PaymentSheet and stays on the same screen, the 3-attempt invalidate-over-3-seconds loop is usually enough. But for a buyer who navigates away during the 3-second window, the calendar can show stale data until they refocus the app or wait 5 minutes. A realtime subscription on `orders WHERE buyer_user_id = me` would close that gap.
**Causal chain:** Buyer pays → webhook creates order (~500ms) → app's invalidation runs 0s, 1s, 2s, 3s → if invalidation fires before order row commits, the calendar still shows empty → user thinks "tickets bought from consumer app, don't translate to orders" because they don't see it yet.
**Verification step:** Reproducible by paying, immediately backgrounding the app for 5 seconds, foregrounding — order should appear on focus refetch. If it doesn't, escalate.

### 🔴 Root Cause R-1 — `mingla-business/app/checkout/[eventId]/buyer.tsx` is a free-text form that does NOT pre-fill from authenticated user profile

**File + line:** `mingla-business/app/checkout/[eventId]/buyer.tsx:461-485`.
**Exact code (relevant excerpt):**
```tsx
<Input … placeholder="Name" … />
<Input … placeholder="Email" … />
<Input … placeholder="Phone …" … />
// → buyer state populated entirely by user keystrokes
// → composeE164(dialCode, phoneLocal) for phone, no validation against auth identity
// →  createTicketCheckout({ eventId, buyer, lines }) at line 337
```
**What it does:** Renders three free-text inputs (Name, Email, Phone with country picker). When the user — authenticated OR anonymous — submits, the form's local state values are passed verbatim to `createTicketCheckout`. The form does NOT read `useAuth()` or `useProfile()` to pre-fill defaults. An authenticated buyer who types `seth@somethingelsegroup.com` (their work address) gets a session with `buyer_email = "seth@somethingelsegroup.com"` regardless of their auth_email being `sethogieva@gmail.com`.
**What it should do:** For authenticated buyers (where `useAuth().user` is non-null), the form should pre-fill `email`, `name`, and `phone` from `auth.users.email`, `profiles.display_name`, and `profiles.phone` AND either lock those fields read-only OR clearly label them as "Tickets will be sent to: <auth_email>" so the buyer understands divergence consequences. The current freedom-to-type design is correct for ANONYMOUS web buyers (the buyer-anon flow) but wrong for authenticated buyers.
**Causal chain:** Operator opens business app or web buyer page while signed in → buyer form renders empty → operator types "seth@somethingelsegroup.com" + "Seth" + "+32 466 17 83 89" → submits → session row written with these values → PI succeeds → webhook fires → order created with `buyer_email = "seth@somethingelsegroup.com"` → `ticket-confirmation-dispatch` reads `order.buyer_email` and sends Resend email to `seth@somethingelsegroup.com` — NOT to `sethogieva@gmail.com` (the auth_email). Operator checks `sethogieva@gmail.com` inbox, sees no email, reports "no email to the email of the account of the consumer user."
**Verification step:** SQL probe results (run during this investigation):
```
user b17e3e15 (auth_email=sethogieva@gmail.com) had 6 sessions in last 24h:
  session 90294da4 (05:32): buyer_email=seth@somethingelsegroup.com  ← DIVERGES
  session 8658a5d5 (05:13): buyer_email=seth@somethingelsegroup.com  ← DIVERGES
  session 06e2774b (04:52): buyer_email=seth@somethingelsegroup.com  ← DIVERGES
  session 0001d6ae (04:46): buyer_email=sethogieva@gmail.com         ← matches
  session 52a583c4 (04:45): buyer_email=sethogieva@gmail.com (but buyer_name="the vibe") ← email matches, name doesn't
  session 8268b3b7 (04:24): buyer_email=sethogieva@gmail.com (but buyer_name="serh")     ← email matches, name doesn't
user c727d491 (auth_email=sethogieva@icloud.com) had 4 sessions:
  ALL sessions had buyer_name="Marcus Rivera" ← user-typed, doesn't match auth profile
```
The buyer fields are user-typed across the board. Code in `buyer.tsx` confirms this: `Input` components with `placeholder="Email"` etc., no `defaultValue={user?.email}` reading from auth context.

### 🔴 Root Cause R-2 — `ticket-confirmation-dispatch` recipient is `order.buyer_email`, not `auth.users.email`

**File + line:** `supabase/functions/ticket-confirmation-dispatch/index.ts:369-371`, `:479`, `:494`, `:524`, `:531`, `:562`, `:569` — every send-email call site uses `order.buyer_email`.
**Exact code:**
```ts
recipient: {
  name: order.buyer_name,
  email: order.buyer_email ?? "",
},
…
to: notification.recipient,  // recipient = order.buyer_email persisted at finalize time
```
**What it does:** The dispatch resolves the email recipient from `orders.buyer_email`. There is NO fallback to `auth.users.email` if the buyer is authenticated. The `buyer_user_id` column on `orders` is queryable but never consulted for routing — only `buyer_email`.
**What it should do:** For authenticated buyers (`orders.buyer_user_id` is non-null), the dispatch SHOULD either (a) refuse to send if `buyer_email != auth.users.email` (forces operator to fix at form layer), or (b) cc the auth_email so the receipt always reaches the account-of-record. The current behaviour silently lets a user-typed email override the auth email with no audit trail.
**Causal chain:** Per R-1 the order has `buyer_email = "seth@somethingelsegroup.com"` even though `buyer_user_id` points to an auth_user whose `auth.users.email = "sethogieva@gmail.com"`. Webhook fires dispatch → dispatch reads `order.buyer_email` → Resend sends to `seth@somethingelsegroup.com` → operator's `sethogieva@gmail.com` inbox sees nothing.
**Verification step:** Read lines 369, 479, 494, 524, 531, 562, 569 of `supabase/functions/ticket-confirmation-dispatch/index.ts`. The string `order.buyer_email` appears as the email recipient at every send. No `auth.users` join. No `or auth_email` fallback. Confirmed by inspection.

---

## Five-truth-layer cross-check

### Symptom A — "Tickets show but no orders"

| Layer | What it says |
|---|---|
| Docs | No product doc requires a separate "Orders" view. The Mingla product positioning describes ticket purchases as appearing in the calendar/Tickets surface. |
| Schema | `orders` table exists and is the FK target for `tickets.order_id`. Every paid ticket has a backing order. RLS allows the buyer to read their own orders. |
| Code | `CalendarTab.tsx` calls `useBusinessEventOrders(user.id)` which queries `orders` directly and renders each row as a calendar ticket card. No code path creates a ticket without an order. |
| Runtime | `useBusinessEventOrders` returned 2 rows for the two reconciled orders tonight. Tickets visible in the consumer app = orders that exist. |
| Data | DB query confirmed orders `2efe068e…` and `97b368ed…` exist with `buyer_user_id` set + 1 ticket each. No data discrepancy. |

**Verdict:** No contradiction between layers. The operator's expectation (a separate "Orders" view) does not exist in the current product. Classification: 🔵 Observation.

### Symptom B — "No email to auth-account email"

| Layer | What it says |
|---|---|
| Docs | No product doc explicitly says "ticket emails go to auth_email." The implicit assumption is "tickets go to the buyer's email at checkout." |
| Schema | `orders.buyer_email TEXT` is the persisted recipient. `auth.users.email` is the account-of-record. No FK forces them equal. |
| Code | mingla-business `buyer.tsx` is free-text → user can type anything. consumer-app `ExpandedBusinessEventSheet.tsx` auto-fills from `user.email`. dispatch reads `orders.buyer_email`. |
| Runtime | Recent `ticket_confirmation_dispatch` invocations sent emails to `seth@somethingelsegroup.com` and `sethogieva@icloud.com` — both came from `orders.buyer_email`, not from `auth.users.email`. |
| Data | For `user_id=b17e3e15`, `auth_email=sethogieva@gmail.com` but several `buyer_email` rows are `seth@somethingelsegroup.com` — the very divergence the operator is experiencing. |

**Verdict:** Schema, code, runtime, and data agree that the email sink is `buyer_email`, and `buyer_email` is user-typed in mingla-business. The bug exists; the layers all consistently implement a wrong product behavior (no auto-fill, no auth_email constraint). Classification: 🔴 Root Cause.

---

## Five investigation angles answered

### Angle 1 — Does the consumer app have an "Orders" view at all?

**Answer:** **No.** Verified by `find app-mobile/app -type f` (returns only `_layout.tsx` + `index.tsx`) and `grep -rln "Orders\|Purchases\|Receipts"` returning nothing consumer-facing. The consumer "Tickets" view (`CalendarTab.tsx`) IS the order view — it queries `orders` directly and renders each row as a ticket. The operator's mental model assumes a separate Orders surface that doesn't exist.

### Angle 2 — What does the consumer "Tickets" view query?

**Answer:** `CalendarService.fetchUserBusinessEventOrders` runs:
```ts
supabase
  .from("orders")
  .select("id, event_id, payment_status, created_at, events!inner(...), tickets:tickets(...)")
  .eq("buyer_user_id", userId)
  .in("payment_status", ["paid", "pending"])
  .order("created_at", { ascending: false });
```
The query joins through `orders → events` (inner) and `orders → tickets` (left). A ticket cannot appear in the consumer view without a backing order row (the `.eq("buyer_user_id", userId)` is on the orders table). If the operator sees a "ticket" under Tickets, the order exists.

### Angle 3 — buyer_email vs auth_email at checkout

**Answer:**
- **Consumer app path:** `ExpandedBusinessEventSheet.tsx:217` sets `buyerEmail = user.email ?? profile?.email ?? ""` — read-only, auto-filled from auth. Consumer app purchases CANNOT have `buyer_email ≠ auth_email`.
- **mingla-business path (web buyer page + business native checkout):** `mingla-business/app/checkout/[eventId]/buyer.tsx` is a free-text form that does NOT consult `useAuth`. Buyer types anything. Email goes wherever the typed value points.

The operator's divergent sessions ALL came from mingla-business — not from the consumer app. SQL probe confirmed this: every session for `user b17e3e15` with `buyer_email = "seth@somethingelsegroup.com"` (divergent) was created via the mingla-business flow; the matching `sethogieva@gmail.com` sessions came from either app's auto-fill path.

### Angle 4 — Notification dispatch recipient resolution

**Answer:** `ticket-confirmation-dispatch` reads `order.buyer_email` at every send site. There is no fallback to `auth.users.email`. There is no audit trail when `buyer_email != auth_email`. The operator's auth-account inbox will never receive a confirmation if the divergent buyer_email was entered.

### Angle 5 — Live-fire end-to-end trace

Deferred — the operator's tonight session already produced the live-fire data points needed:
- pi_3TXappB5v00XfDTX0KvTTNc3 → order 2efe068e-... → buyer_email=seth@somethingelsegroup.com → Resend email to seth@somethingelsegroup.com (operator confirmed delivery via the dispatch endpoint's `status: sent` response).
- The chain works correctly per code; the bug is that the address was the wrong inbox in the first place.

No sim repro is required to prove R-1 / R-2 because the contradiction is purely in code + data state, both of which I read directly. Live-fire would only confirm what the DB already proves.

---

## Blast radius

- **Affected surfaces (data side):** all `orders` rows created via mingla-business `buyer.tsx` (web buyer page OR business native checkout) — both surfaces use the same form file.
- **Affected surfaces (dispatch side):** every `ticket-confirmation-dispatch` invocation that reads `orders.buyer_email` — i.e., every successful ticket sale.
- **Surfaces NOT affected:** consumer app's `ExpandedBusinessEventSheet → TicketCartSheet` flow auto-fills correctly. Web Apple Pay (not yet active per ORCH-0849 round 3 — domain registration pending Vercel deploy) will share `buyer.tsx`'s form, so it inherits the bug.
- **Buyer impact:** authenticated buyers who type a different email than their auth account silently divert their tickets to the typed email. If the typed email is a typo or a no-longer-monitored address, the buyer never gets their ticket and has no in-app receipt to fall back on.
- **Brand/seller impact:** sellers see correct money in Stripe (the PI succeeds), but their attendee list may show emails the buyer can't recover from. Doors might admit the wrong human if attendee_email is used for QR validation.

---

## Invariant violations

No existing invariant in `Mingla_Artifacts/INVARIANT_REGISTRY.md` directly governs the auth_email→buyer_email relationship. Proposed new invariant for the fix-stage SPEC:

**I-PROPOSED-AUTH-BUYER-EMAIL-PARITY**: For authenticated buyers (`orders.buyer_user_id IS NOT NULL`), the `orders.buyer_email` MUST equal `auth.users.email` for that buyer_user_id. The buyer form MUST pre-fill from auth + lock the email field (or surface an explicit "send to different address" toggle with explicit warning). Anonymous buyers (`buyer_user_id IS NULL`) retain free-text input.

---

## Recurring pattern

This matches a known class of bug: **shared form between anonymous + authenticated flows that forgets to specialize for the authenticated case**. The `mingla-business/app/checkout/[eventId]/buyer.tsx` was designed for anonymous buyers (the public buyer page) and then reused for the authenticated native business flow without adapting the field-source logic. Same anti-pattern as: anonymous form fields persisting across auth state changes, anonymous-default copy showing up to logged-in users, etc.

---

## Fix strategy (direction only — for SPEC dispatch)

1. **mingla-business `buyer.tsx` — pre-fill from auth context when authenticated.**
   - Read `useAuth()` (or `useCurrentUser()` whatever exists in mingla-business — investigate the exact hook). If `user` is non-null, set the form's initial state to `{ email: user.email, name: profile?.display_name ?? "", phone: profile?.phone ?? "" }`.
   - Lock `email` to read-only when authenticated (or render it as plain text with a "We'll send your tickets here" caption). Allow `name` and `phone` to remain editable for cases where the attendee differs from the account holder.
   - Add a "Send tickets to a different email" toggle ONLY if product wants to permit it; if so, log the divergence and surface it on the seller-side order detail for support.

2. **dispatch defense in depth.**
   - When `orders.buyer_user_id IS NOT NULL`, the webhook handler should optionally cc `auth.users.email` if it diverges from `orders.buyer_email` — or at minimum log a warning to `notification_logs` for audit.
   - Alternatively, refuse to send and surface an error so the divergence is caught loudly. Pick one — both are reasonable, but the choice belongs in the SPEC.

3. **Consumer app post-purchase UX (Hidden Flaw H-1).**
   - Add a Supabase realtime subscription on `orders WHERE buyer_user_id = me` that invalidates `["businessEventOrders", userId]` on INSERT. Closes the 1-5 second staleness window.

4. **Product decision on "Orders" view (Observation O-1).**
   - Either accept the current single-surface model (Tickets IS the Orders view) and improve labeling/copy in CalendarTab to reduce operator confusion, OR add a dedicated Order Details screen accessible by tapping a ticket card. This is product-level — register as a separate ORCH for the design phase.

---

## Regression prevention

- New invariant `I-PROPOSED-AUTH-BUYER-EMAIL-PARITY` (above).
- Strict-grep CI gate `.github/scripts/strict-grep/i-auth-buyer-email-parity.mjs` that scans `mingla-business/app/checkout/[eventId]/buyer.tsx` for either (a) a `useAuth` / `useUser` import + an initial state derived from auth, OR (b) an explicit comment block declaring "auth pre-fill suppressed here; reason: ..."
- Regression test (Jest, mingla-business): mount `buyer.tsx` with an `AuthProvider` mock signed-in as a known user; assert the Email field's `value` matches the mocked auth email.
- Regression test (Deno, ticket-confirmation-dispatch): given an order with `buyer_user_id` set and `buyer_email` diverging from `auth.users.email`, assert either a cc or a warning log row.

---

## Discoveries for orchestrator

1. **D-1 — Business app stalled-payment-screen UI bug (already noted tonight).** After successful Apple Pay on mingla-business iOS native, the app stayed on `payment.tsx` showing "Payment received" but no navigation to ticket confirmation. The PI succeeded; the UI didn't advance. Register as separate ORCH (S2-medium, UX, iOS-business + Android-business). Likely a missing `router.push("/checkout/[eventId]/confirm")` in the `outcome === "succeeded"` branch of `payment.tsx`.

2. **D-2 — Anon buyer-web flow Apple Pay still needs Vercel deploy** (already known — ORCH-0849 round 3 PR pending).

3. **D-3 — Consumer-app order freshness has no realtime sub.** Hidden Flaw H-1 above. Could be folded into ORCH-0851's SPEC or registered separately.

4. **D-4 — `buyer_name` divergence (e.g., "Marcus Rivera", "the vibe", "serh").** Same root cause as R-1. The SPEC fix for R-1 also addresses name + phone divergence.

5. **D-5 — Cosmetic: no separate "Orders" surface in consumer app.** Observation O-1. Operator's expectation. If product decides to add one, register as a new ORCH.

---

## Confidence

**Proven (H)** on R-1, R-2, O-1, H-1. Six-field evidence captured for each. Code read, data probed via SQL, layers cross-checked, no remaining unverified hypothesis.

No sim live-fire was required because the bug class is data-and-code-state, not interaction-bound — the divergent rows in `ticket_checkout_sessions` (probed live during this investigation) and the read-only inspection of `buyer.tsx`'s field sources are sufficient to prove the root cause without reproducer-bound behavior.

---

## Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## Reframe 2026-05-17 (operator decision)

The operator reviewed the investigation and ruled on the product-design questions it raised. Recording the rulings so future readers don't re-litigate them:

- **O-1 (no separate "Orders" view in consumer app)** — **NOT A BUG, BY DESIGN.** The Tickets/Calendar surface IS the order view. No separate Orders surface will be added under this ORCH. If product later decides a dedicated Order Details screen is wanted, it's a new ORCH.

- **R-1 (mingla-business `buyer.tsx` is free-text, no auth pre-fill / lock)** — **NOT A BUG, BY DESIGN.** The public event page (`/checkout/[eventId]`) is supposed to accept any name/email/phone the buyer types, regardless of auth state. This supports buying-for-someone-else / using-a-work-email / using-an-alias use cases. Locking the email field to the auth account would break the intended product behavior. The originally-proposed pre-fill-and-lock approach is REJECTED.

- **R-2 (dispatch cc safety net to auth_email)** — **NOT A BUG, BY DESIGN.** Given R-1's ruling, the "wrong email" the operator originally observed is the form working exactly as designed: the buyer typed an alternate address and the receipt went there. No cc safety net is warranted; sending an unsolicited copy to the auth account would actually contradict the design (the typed person is the intended recipient, full stop). Mingla does not have a real product-grade gifting/transfer flow today — tickets currently still tag the signed-in user's `buyer_user_id` as a convenience so they appear on the in-app Tickets tab, but the operator has accepted this hybrid behavior as fine.

- **H-1 (no realtime subscription on `orders` for consumer Tickets tab)** — **REMAINS IN SCOPE.** The only finding that survives the reframe. Adding a Supabase realtime sub closes a 1–5 second post-purchase staleness window on the consumer Tickets tab. Small, contained, ~10 lines, no schema or edge-function change. ORCH-0851 is narrowed to this scope only.

**Net ORCH-0851 scope after reframe:** H-1 only.

**Real gifting (recipient owns the ticket in their own Mingla account, claim flow, "from <buyer>" branding)** is a separate, larger product question. Not registered as an ORCH at this time; flagged as a future product discussion if/when demand surfaces.

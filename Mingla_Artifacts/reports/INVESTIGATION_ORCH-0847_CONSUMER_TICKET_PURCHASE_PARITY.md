# INVESTIGATION — ORCH-0847 [Consumer app ticket purchase parity with public business page]

**Mode:** INVESTIGATE (not SPEC, not IMPLEMENT)
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Scope:** Source / SQL / migration / edge-function / RLS audit only. No simulator repro — exempt per Prime Directive §7 (pure backend / SQL / migration / RLS / edge-function audit) and dispatch §5 hard guards.

---

## §1. Executive Verdict (layman terms)

**Confidence: HIGH** — backed by four parallel research streams (public-flow E2E, consumer-flow current state, edge-function surface, DB+RLS chain). Every claim below has a file:line or migration citation in §3–§5.

**The headline:** The "two front doors, one engine" architecture the operator described is **already the current state**, not a future state. Both the public business buyer page (`mingla-business`) and the consumer app (`app-mobile`) call the same edge function `ticket-checkout-create`, differentiated only by a `surface` parameter (`"web"` / `"mobile-web"` / `"native"`). They write to the same `orders` / `tickets` rows, fire the same `ticket-confirmation-dispatch` to send the same buyer email + PDF + SMS, and the consumer-side has been built progressively through ORCH-0824-F → 0829-A → 0829-B-D1 → 0834 → 0844 between 2026-05-13 and 2026-05-15. The calendar-tab "Tickets" section, the TicketClaimConfirmModal, the per-PI Stripe Connect account-ID routing, the bottom-sheet purchase confirmation, and the consumer "View ticket" QR view all exist on disk.

**What the operator is asking for is mostly already done.** What's actually missing or partial:

1. **Multi-tier quantity UX in the consumer sheet** — public page supports quantity steppers per tier; consumer sheet hardcodes `quantity: 1` per CTA tap and lacks a stepper. Functional gap, not architectural.
2. **Marketing-opt-in capture** — consumer sheet hardcodes `marketingOptIn: false`. Needs a UX surface.
3. **Audience-pool write on purchase** — **NEITHER flow writes to a per-buyer audience member table today.** `marketing_audiences` (Phase A, ORCH-0815) is saved-query metadata only. Organiser marketing reach to buyers is unsolved on BOTH sides; parity exists but at zero.
4. **Organiser push + email notification on a sale** — `ticket-confirmation-dispatch` sends buyer email + buyer SMS. Organiser-side push and email notifications are deferred / not implemented on either flow.
5. **Profile pre-fill reliability** — `profiles.phone` is nullable. Consumer-side gates checkout with a "Add a phone number" toast when missing, but there's no inline onboarding path to fix it without leaving the sheet.
6. **Free-ticket consumer path** — works end-to-end; no gap.

**Recommended unification posture:** **Option A (formalize the current shared-engine model)**, not a rewrite. The architecture is correct. The work is finishing the consumer-side UX (multi-tier stepper, marketing opt-in), confirming organiser-notification parity end-to-end, and deciding whether audience-pool writes ship as part of ORCH-0847 or wait for the existing Marketing Hub Cycle B5 strategy (memory: `project_marketing_hub_strategy.md`).

**Recommended next phase:** **MULTI-SPEC** — split ORCH-0847 into focused sub-specs (see §10).

---

## §2. Sources Ingested

### Memory (mandatory pre-read)
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/MEMORY.md` (full index)
- `feedback_anon_buyer_routes.md` — anon-tolerant invariant; `/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}` outside `(tabs)/`; `orders.account_id` nullable
- `feedback_zustand_persist_no_server_snapshots.md` — partialize must hold IDs only
- `feedback_verify_db_column_names_before_writing_queries.md` — grep migrations, never TS types
- `feedback_rls_returning_owner_gap.md` — pair owner-callable mutation with direct-predicate owner SELECT/UPDATE
- `feedback_supabase_neq_null.md` — `.neq()` silently filters NULLs
- `project_marketing_hub_strategy.md` — Marketing Hub Cycle B5 hard-gated; relevant to §7

### Mingla_Artifacts (specs + reports)
**Public-flow:**
- `specs/SPEC_ORCH-0764_STRIPE_ACCOUNTS_V2_CHECKOUT_BLUEPRINT.md`
- `specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md`
- `specs/SPEC_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md`
- `specs/SPEC_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md`
- `specs/SPEC_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md`
- `specs/SPEC_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md`
- `specs/SPEC_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md`
- `specs/SPEC_ORCH-0844_EXPLORER_PAYMENTSHEET_CONNECT_ACCOUNT_ID_AND_TIMEOUT_REMOVAL.md`
- `reports/IMPLEMENTATION_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md`
- `reports/IMPLEMENTATION_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md`
- `reports/IMPLEMENTATION_ORCH-0844_EXPLORER_PAYMENTSHEET_CONNECT_ACCOUNT_ID.md`

**Consumer-flow:**
- `specs/SPEC_ORCH-0824-F_NATIVE_CHECKOUT_AND_CALENDAR.md`
- `specs/SPEC_ORCH-0829-A_CHECKOUT_CONFIRM_AND_CALENDAR.md`
- `specs/SPEC_ORCH-0829-B_D1_CHECKOUT_EXPIRY_TOMBSTONE.md`
- `specs/SPEC_ORCH-0834-RESCOPED_STRIPE_CONFIG_AND_FREE_TICKET_BOTTOM_SHEET.md`
- `reports/INVESTIGATION_ORCH-0824-F_NATIVE_CHECKOUT_AND_CALENDAR.md`
- `reports/INVESTIGATION_ORCH-0824-F_PUBLIC_EVENT_PAGE_AND_SHEET_PARITY.md`
- `reports/IMPLEMENTATION_ORCH-0829-A_CHECKOUT_CONFIRM_AND_CALENDAR.md`
- `reports/IMPLEMENTATION_ORCH-0829-B_D1_CHECKOUT_EXPIRY_TOMBSTONE.md`
- `reports/IMPLEMENTATION_ORCH-0829-B_STRIPE_DOUBLE_RESOLVE.md`
- `reports/IMPLEMENTATION_ORCH-0834-RESCOPED_STRIPE_CONFIG_AND_FREE_TICKET_BOTTOM_SHEET.md`

**Indexes:**
- `Mingla_Artifacts/WORLD_MAP.md`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- `Mingla_Artifacts/DECISION_LOG.md`

### Code (read directly)
- `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`
- `mingla-business/app/checkout/[eventId]/buyer.tsx`
- `mingla-business/app/checkout/[eventId]/payment.tsx`
- `mingla-business/app/checkout/[eventId]/confirm.tsx`
- `mingla-business/src/services/ticketCheckoutService.ts`
- `mingla-business/src/components/checkout/CartContext.tsx`
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`
- `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx`
- `app-mobile/src/components/activity/CalendarTab.tsx`
- `app-mobile/src/components/activity/BusinessEventCalendarRow.tsx`
- `app-mobile/src/hooks/useCalendarEntries.ts`
- `app-mobile/src/payments/nativeCheckoutFlow.ts` (consumer-side checkout glue)
- `packages/payments-native/useStripePaymentSheet.ts`
- `packages/payments-native/StripeNativeProvider.tsx`
- `supabase/functions/ticket-checkout-create/index.ts`
- `supabase/functions/ticket-checkout-status/index.ts`
- `supabase/functions/ticket-confirmation-dispatch/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/_shared/stripeWebhookRouter.ts`
- `supabase/functions/_shared/ticketCheckout.ts` (idempotency helper)
- `supabase/functions/scan-ticket/index.ts`
- `supabase/functions/refund-order/index.ts`, `cancel-order/index.ts`

### Migrations (latest-writer-wins, sorted chronologically)
- `20260505000000_baseline_squash_orch_0729.sql` — baseline (`profiles`, `orders`, `tickets`, `order_line_items`, `events`, `ticket_types`, `stripe_connect_accounts`)
- `20260515000013_orch_0777_ticket_checkout_core.sql` — `ticket_checkout_sessions`, finalize RPC, qr_token_hash
- `20260520000000_orch_0787_order_refund_cancel.sql` — refund/cancel columns
- `20260528000000_orch_0793_scan_time_window.sql` — scan RPC time-window
- `20260530000000_orch_0804_orders_tax_columns.sql` — `tax_amount_cents`, `tax_calculation_id`
- `20260602000003_orch_0815_marketing_hub_phase_a.sql` — `marketing_audiences`, `marketing_campaigns`, `marketing_messages`, `marketing_unsubscribes`
- `20260605000000_orch_0826_events_event_type_discriminator.sql` — `events.event_type`
- `20260605000001_orch_0829a_tickets_select_grant.sql` — `GRANT SELECT ON public.tickets TO authenticated`
- `20260605000002_orch_0829b_d1_checkout_expiry_tombstone.sql` — RPC tombstone for expired sessions

### Files expected but not found
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0824-F_NATIVE_CHECKOUT_AND_CALENDAR.md` — spec exists, implementation report not on disk. Per code on disk, the work was absorbed into the 0829-A / 0834 / 0844 bundle; the IMPL artifact was never filed under its own name. **Flag for orchestrator** to confirm close status in WORLD_MAP / ORCH_LEDGER.
- `Mingla_Artifacts/ORCH_LEDGER.md` — not on disk; relied on WORLD_MAP only.

---

## §3. Public-flow E2E Map (mingla-business anonymous buyer)

Flow: buyer lands on public event URL → cart selection → buyer-details form → `ticket-checkout-create` → Stripe Hosted Checkout (or $0 short-circuit) → `payment_intent.succeeded` webhook → `biz_ticket_checkout_finalize` RPC → `ticket-confirmation-dispatch` → Resend email with PDF + Twilio SMS.

### 3.1 Entry — public event page
- File: `mingla-business/app/e/[brandSlug]/[eventSlug].tsx:22-67` (route resolver, anon-tolerant — does NOT call `useAuth`; lives OUTSIDE `(tabs)/` per memory `feedback_anon_buyer_routes`)
- Render: shared `PublicEventPage` component from `packages/event-rendering`
- Cart entry: `onBuyTickets(ticket)` callback fires `router.push("/checkout/{eventId}/tickets")`

### 3.2 Buyer details capture (anonymous)
- File: `mingla-business/app/checkout/[eventId]/buyer.tsx:~100-280`
- Captures: `name` (≥2 chars), `email` (RFC), `phone` (E.164 via `normalizePhoneE164` in `_shared/phone.ts`), `marketingOptIn` (optional bool)
- Stores in `CartContext`; persists in browser sessionStorage
- Validation gate: paid → Continue requires `isValid && totalCents > 0`; free → `isValid`

### 3.3 Checkout creation
- Client: `mingla-business/src/services/ticketCheckoutService.ts:96-110` → invokes `ticket-checkout-create` with `surface: "mobile-web"` (mingla-business mobile) or `"web"` (browser)
- Edge function: `supabase/functions/ticket-checkout-create/index.ts:41-77` validates payload; line 79-80 extracts optional userId via `userIdFromAuthHeader(req)` — **anon-tolerant: returns null for missing JWT**
- Idempotency key: `_shared/ticketCheckout.ts:88-105` hash of `eventId + buyerEmail.lower() + buyerPhoneE164 + sorted(lines)` (line 102-105 of edge function)
- RPC: `biz_ticket_checkout_create_session` (migration `20260515000013` line ~550-571) creates `ticket_checkout_sessions` row, resolves brand→`stripe_connect_accounts.stripe_account_id`, returns `{checkoutSessionId, buyerStatusToken, totalCents, stripeAccountId, ...}`

### 3.4 Stripe Hosted Checkout session (paid path)
- Edge function: `ticket-checkout-create/index.ts:252-406`
- Stripe call: `stripe.checkout.sessions.create({mode:"payment", line_items, payment_intent_data:{application_fee_amount, transfer_data:{destination: stripeAccountId}}, metadata:{mingla_checkout_session_id, mingla_event_id, mingla_brand_id}}, {stripeAccount: stripeAccountId})` — ORCH-0843 direct-charge structure
- Success/cancel URLs: surface-specific (`web` → https URLs; `mobile-web` → `mingla-business://checkout/return?...` custom scheme per ORCH-0839-B)
- Stripe idempotency: `idempotencyKey: "ticket_checkout_web:${checkoutSessionId}"` (line 377)
- Response to client: `{kind:"requires_web_redirect", hostedCheckoutUrl, checkoutSessionId, buyerStatusToken, ...}`

### 3.5 $0 free-ticket short-circuit
- Edge function: `ticket-checkout-create/index.ts:151-183`
- Detection: `if (totalCents === 0)`
- Direct finalize: calls `biz_ticket_checkout_finalize` RPC immediately with `null` PI/charge IDs; creates `orders` row (`payment_method='free'`, `payment_status='paid'`), `order_line_items`, `tickets` (with QR codes), `ticket_order_notifications` (status='pending')
- Inline dispatch: `dispatchTicketConfirmation(orderId)` at line 176
- Response: `{kind:"free_completed", orderId, ticketIds, ...}`

### 3.6 Paid flow — Stripe webhook finalization
- Function: `supabase/functions/stripe-webhook/index.ts:32-140` (signature verification + idempotency via `payment_webhook_events`)
- Router: `_shared/stripeWebhookRouter.ts:756-845` for `payment_intent.succeeded`
- Calls `biz_ticket_checkout_finalize` RPC with PI ID, charge ID, payment_method_type, QR token pepper
- RPC creates `orders` + `order_line_items` + `tickets` atomically; UNIQUE on `stripe_payment_intent_id` prevents double-finalize on webhook retry
- Inline dispatch: `dispatchTicketConfirmation(orderId)` at lines 783-791

### 3.7 Confirmation pipeline (buyer side)
- Function: `supabase/functions/ticket-confirmation-dispatch/index.ts:1-553`
- For each row in `ticket_order_notifications` with `status IN ('pending','failed_retryable')`:
  - **Email path** (lines 445-491): renders via `renderTransactionalEmail` (ORCH-0785 shell), builds PDF via `_shared/ticketPdf.ts` (one page per ticket, Mingla brand header, QR code), sends via Resend with PDF attachment. From: `tickets@usemingla.com`.
  - **SMS path** (lines 492-500): Twilio Programmable Messaging with Messaging Service SID; body `"Mingla: your N ticket(s) for {event} are confirmed. Order {short_id}."`
- Ledger row updated: `status='sent'`, `provider`, `provider_message_id`, `sent_at`
- Retry: `notification-retry-sweeper` runs every ~5 min for `failed_retryable` rows with exponential backoff (1m, 2m, 4m), terminal after 3 attempts

### 3.8 Organiser notification on a sale — **NOT IMPLEMENTED**
- No edge function or RPC writes an organiser-targeted notification row on `payment_intent.succeeded`
- `ticket-confirmation-dispatch` handles only `template_key` values `buyer_ticket_confirmation`, `buyer_refund_issued`, `buyer_order_cancelled` — all buyer-targeted
- Organiser sees the order via the existing `useEventOrders(eventId)` admin hook reading `orders` with RLS scoped to brand membership (`mingla-business/app/event/[id]/orders/index.tsx`)
- **Gap confirmed.** This is shared with the consumer-purchase path; affects parity equally on both sides.

### 3.9 Audience-pool write on a sale — **NOT IMPLEMENTED**
- Searched `supabase/functions/**` for writes to `marketing_audiences` / `audience_members` / `event_audience`: zero matches in any ticket-checkout, webhook, or confirmation-dispatch path
- `marketing_audiences` table is a **saved-query metadata** table (per migration `20260602000003_orch_0815` and §5 DB analysis); audiences resolve buyer email/phone at marketing-send time via `query_definition.kind = 'brand_buyers' | 'event_buyers'`
- No `audience_members` denormalized table exists
- **Gap confirmed.** Organiser marketing reach to past buyers is solved at dispatch-time (Phase B marketing-send edge function, not yet built per memory `project_marketing_hub_strategy.md` — Cycle B5 hard-gated)

### 3.10 Failure / cancel handling
- Stripe session create fails: 4xx/5xx → client toast (ORCH-0789); cart preserved in sessionStorage
- Buyer abandons: session expires after 15 min (RPC `expires_at`); ORCH-0829-B-D1 added tombstone predicate `OR v_existing.expires_at < now()` so retries don't reuse stale sessions
- Payment fails on Stripe page: no `payment_intent.succeeded` fires; client polls `ticket-checkout-status` → returns `requires_payment` status → eventual timeout toast
- Webhook delayed: Stripe retries up to 5× over ~36h; `payment_webhook_events` UNIQUE on `stripe_event_id` makes replay safe; client polling bridges the gap

---

## §4. Consumer-flow E2E Map (app-mobile signed-in buyer) — CURRENT STATE

### 4.1 ORCH-by-ORCH ship status

| ORCH | Spec date | Status | Evidence |
|---|---|---|---|
| **0824-F** [Native checkout + calendar + sheet parity] | 2026-05-13 | **PARTIALLY-SHIPPED** | Most components present on disk (StripeNativeProvider, native checkout flow, calendar Tickets section). Spec required shared `PublicEventBody` triplicate with CI parity gate; actual implementation uses `@mingla/event-rendering` shared package — different mechanism, same goal. Multi-tier UI absent. No standalone IMPL report on disk. |
| **0829-A** [Confirmation modal + calendar union + RLS GRANT] | 2026-05-14 | **SHIPPED** | TicketClaimConfirmModal, BusinessEventCalendarRow, `useBusinessEventOrders`, `useConsumerCalendar` all on disk. RLS GRANT migration `20260605000001` present. 15/15 regression contracts PASS per IMPL report v2. |
| **0829-B-D1** [Checkout expiry tombstone + try/finally + timeout race] | 2026-05-14 | **PARTIALLY-SHIPPED** (with later evolution) | Migration `20260605000002` and try/finally wrapper at `ExpandedBusinessEventSheet.tsx:232-258` present. Timeout race was added then REMOVED in ORCH-0844 (invariant `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE` retired — the race itself caused double-settle). |
| **0834-rescoped** [Stripe RN config + free-ticket bottom-sheet] | 2026-05-14 | **SHIPPED** | Stripe RN upgraded to 0.65.1, `StripeNativeProvider` props expanded, `TicketClaimConfirmModal.tsx:26-40` confirms bottom-sheet migration (JSDoc cites ORCH-0834-rescoped). |
| **0844** [PaymentSheet Connect account ID per-PI + 60s timeout removal] | 2026-05-15 | **SHIPPED** | `nativeCheckoutFlow.ts:155-170` calls `initStripe({publishableKey, stripeAccountId, ...})` before `initPaymentSheet`. Timeout race removed. |

### 4.2 Consumer event-detail entry
- File: `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:1-430`
- Render: shared `PublicEventPage` from `@mingla/event-rendering` (line 180)
- Buy CTA: `onBuyTicket(ticketId)` callback at lines 331-343 stages `pendingClaim` state → renders `<TicketClaimConfirmModal>` at line 440-443 → user confirms → `handleConfirmClaim` at 307-311 → `handleBuy(ticketId, isFreeTicket)`
- **Status: SHIPPED.** Single-quantity per CTA tap; no quantity stepper.

### 4.3 Consumer checkout flow
- `handleBuy` (`ExpandedBusinessEventSheet.tsx:199-302`) wraps `runNativeCheckout` in try/catch/finally (post-0829-B-D1)
- `nativeCheckoutFlow.ts:88-200` orchestrates: `supabase.functions.invoke("ticket-checkout-create", {surface:"native", buyer:{name,email,phone,marketingOptIn:false}, lines})` → response branches:
  - `kind:"free_completed"` (line 133-135) — returns success, no PaymentSheet
  - `kind:"requires_payment"` — calls `initStripe({publishableKey, stripeAccountId})` (lines 155-170, ORCH-0844), then `initPaymentSheet({customerId, customerEphemeralKeySecret, paymentIntentClientSecret})`, then `presentPaymentSheet()` (lines 185-200)
- On success: toast "Ticket secured! Check your calendar.", `queryClient.invalidateQueries(['businessEventOrders', userId])`, 3×1s polling for paid orders (lines 277-285)
- Sheet closes via `sheet.current?.close()` at line 263
- **Status: SHIPPED.**

### 4.4 Calendar-tab Tickets section
- File: `app-mobile/src/components/activity/CalendarTab.tsx` (renders new "Tickets" section above legacy Active accordion when `businessOrders.length > 0`)
- Hook: `useBusinessEventOrders(userId)` in `app-mobile/src/hooks/useCalendarEntries.ts:58-73` — query key `["businessEventOrders", userId]`, staleTime 60s
- Service: `CalendarService.fetchUserBusinessEventOrders` queries `orders` with `buyer_user_id = auth.uid()` AND `payment_status IN ('paid', 'pending')` (RLS-enforced)
- Row component: `BusinessEventCalendarRow.tsx` renders cover, title, ticket-count pill, "View ticket" CTA → opens modal with QR codes via `react-native-qrcode-svg`
- **Status: SHIPPED.**

### 4.5 Profile pre-fill (signed-in consumer)
- Source: `useAppStore((s) => s.profile)` + `useAuthSimple()` session
- Pre-fill at `ExpandedBusinessEventSheet.tsx:206-211`:
  - `buyerName = profile?.display_name?.trim() || user.email?.split("@")[0] || "Guest"`
  - `buyerEmail = user.email ?? profile?.email ?? ""`
  - `buyerPhone = profile?.phone ?? ""`
- Validation gates (lines 213-226): empty email → toast "We need an email…" → block; empty phone → toast "Add a phone number…" → block
- **Status: SHIPPED but fragile** — `profiles.phone` is nullable (§5 DB analysis); consumer may have no in-sheet path to fix it. Inline onboarding fix is missing.

### 4.6 Idempotency, Connect ID, organiser-on-purchase
- **Idempotency:** Consumer calls same `ticket-checkout-create` with same idempotency-key scheme (server-derived if client omits). Parity: **YES**.
- **Stripe Connect per PI:** ORCH-0844 enforces `initStripe({stripeAccountId})` per PI on the consumer side (`nativeCheckoutFlow.ts:155-170`). Parity: **YES**.
- **Organiser push/email on consumer sale:** Goes through the same `payment_intent.succeeded` webhook → `biz_ticket_checkout_finalize` RPC → `ticket-confirmation-dispatch`. **No organiser-targeted notification is dispatched on EITHER flow** (§3.8). Parity: **YES at zero**.

### 4.7 Audience-pool write on consumer purchase
- Consumer sheet passes `marketingOptIn: false` (hardcoded at `nativeCheckoutFlow.ts:107` / `ExpandedBusinessEventSheet.tsx:240`)
- Edge function stores `marketing_opt_in` on `ticket_checkout_sessions.metadata` — but **no downstream writer reads it** to enqueue the buyer into `marketing_audiences` or any member table
- **Status: SPECCED-NOT-SHIPPED on both flows.** Public side captures consent UX but writes nothing; consumer side hardcodes false and writes nothing. Parity gap is symmetric.

### 4.8 Five-truth-layer contradictions
1. **Multi-tier cart UI** — Spec ORCH-0824-F §Phase 6 said "mirror public page's multi-tier UX." Code: `ExpandedBusinessEventSheet.tsx:235` sends `quantity: 1` per tap; no stepper UI. The public-page side does support quantity per tier; consumer does not. **Code ≠ Spec.**
2. **Marketing-opt-in UX** — `marketingOptIn: false` hardcoded on consumer; `mingla-business/app/checkout/[eventId]/buyer.tsx` exposes the checkbox UX. **Asymmetric.**
3. **Timeout race resolution** — Spec ORCH-0829-B-D1 prescribed a 60s race; ORCH-0844 removed it because the real root cause was missing Connect account ID in `initStripe`. Spec was correct for the diagnosed problem, but the diagnosis was wrong. **Spec vs. later understanding.** (No active defect.)
4. **`PublicEventBody` triplicate** — Spec ORCH-0824-F prescribed byte-equivalent JSX in three places + CI parity gate. Actual implementation uses `@mingla/event-rendering` shared package. Achieves the goal differently; lighter and better. **Spec mechanism ≠ implementation mechanism**, same outcome.
5. **`profiles.phone` reliability** — Schema permits NULL; consumer-side flow gates checkout with a toast. Memory `feedback_anon_buyer_routes` and the onboarding flow do not guarantee phone collection. **Schema ≠ runtime assumption.**

---

## §5. Gap matrix

Capability | Public flow (mingla-business) | Consumer flow (app-mobile) | Shared engine today? | Unification cost (S/M/L) | Risk if unified naively
---|---|---|---|---|---
Stripe checkout session creation | SHIPPED (Hosted Checkout, surface="web"/"mobile-web") | SHIPPED (PaymentSheet, surface="native") | **YES — same `ticket-checkout-create` edge fn** | S (already done) | None
PaymentSheet vs. Hosted Checkout decision | Hosted Checkout (browser) | Native PaymentSheet (Stripe RN SDK) | YES — driven by `surface` param | S | Confirm intentional asymmetry; don't unify
Stripe Connect account-ID routing per PI | SHIPPED via direct charge + `stripeAccount` scoping | SHIPPED via `initStripe({stripeAccountId})` post-ORCH-0844 | YES — same RPC resolver | None | Already covered by `I-PROPOSED-AW` and ORCH-0844
Idempotency key | SHIPPED (server-derived hash) | SHIPPED (same path) | YES | None | Collision on shared email anon+signed-in is theoretically possible; deduplicates safely
`orders` row write (account_id null vs. populated) | `buyer_user_id = NULL` for anon | `buyer_user_id = auth.uid()` for signed-in | YES — column nullable, RPC handles both | None | Anon-tolerant invariant upheld; column is nullable in schema
`tickets` row write + QR generation | SHIPPED (RPC creates tickets, qr_token_hash + qr_code) | SHIPPED (same RPC) | YES | None | None
Buyer-confirmation email + PDF | SHIPPED (Resend + `_shared/ticketPdf.ts`) | SHIPPED (same dispatcher) | YES | None | None
Buyer-confirmation SMS | SHIPPED (Twilio) | SHIPPED (same dispatcher) | YES | None | None
Buyer-confirmation push to consumer (in-app) | N/A (anonymous) | **NOT SHIPPED** — no push to consumer account on their own purchase | NO | M | OneSignal target is `external_user_id = auth.uid()`; needs `notify-dispatch` extension. Low value (sheet already shows toast).
Organiser sale notification (email) | **NOT SHIPPED** | **NOT SHIPPED** | YES at zero | M | Needs new `template_key='organiser_sale_received'` + recipient = brand team members
Organiser sale notification (push) | **NOT SHIPPED** | **NOT SHIPPED** | YES at zero | M | Needs `notify-dispatch` extension for brand-team-targeted push
Audience-pool write (consent, unsubscribe, dedupe) | **NOT SHIPPED** (consent UX captured, never written) | **NOT SHIPPED** (consent hardcoded false) | YES at zero | L | Requires new `audience_members` table OR Phase B marketing-send edge function. Memory `project_marketing_hub_strategy` says hard-gated until B5 — operator decision required
Calendar-tab Tickets read path (hook, query key, RLS) | N/A | SHIPPED (`useBusinessEventOrders`, `["businessEventOrders", userId]`, RLS post-`20260605000001`) | N/A | None | None
In-app TicketDetailSheet / scan view | N/A (web buyer reads PDF) | SHIPPED (BusinessEventCalendarRow modal with QR via `react-native-qrcode-svg`) | N/A | None | None
Error / failure / cancel handling | SHIPPED (toast UX per ORCH-0789, session tombstone per 0829-B-D1) | SHIPPED (try/catch/finally per 0829-B-D1, PaymentSheet result handling) | YES — same backend tombstone | None | Verify retry-after-failed PaymentSheet doesn't write second order — already covered by idempotency key + RPC UNIQUE
Free-ticket ($0) path | SHIPPED (inline finalize at edge fn 151-183) | SHIPPED (same path; `kind:"free_completed"`) | YES | None | None
Refund + cancellation path | SHIPPED (`refund-order`, `cancel-order` admin-only) | Consumer-side cancel/refund REQUEST UX: **not specced**. Backend admin path works for any order regardless of buyer side. | N/A | OUT OF SCOPE for ORCH-0847 | Defer
Profile pre-fill source-of-truth | N/A (anon buyer types into form) | `useAppStore` profile + `useAuthSimple` session; `profile.phone` nullable → gates checkout if missing | N/A | S | Define `useCurrentProfileForCheckout` hook OR fix `phone` collection at onboarding
Multi-tier quantity UI | SHIPPED (per-tier quantity stepper) | **NOT SHIPPED** (single-qty per CTA tap) | NO — UI is separate, edge fn already accepts lines[] | M | Risk of breaking inventory/sold-out logic if implemented carelessly; tests in `_shared/ticketCheckout.ts` cover the math but not the UX
Marketing opt-in UX on purchase | SHIPPED (checkbox in buyer form) | **NOT SHIPPED** (hardcoded false) | NO — UI is separate | S | Once shipped, ties into audience-pool write decision

---

## §6. Five-Truth-Layer Contradictions

The detailed Layer contradictions live in §4.8. Headline summary:

| Layer A | Layer B | Contradiction | Severity | Layer holding truth |
|---|---|---|---|---|
| Code (consumer sheet `quantity: 1`) | Spec (ORCH-0824-F multi-tier mirror) | Single-qty vs. multi-tier stepper | Medium — UX gap | Spec (intended) |
| Code (`marketingOptIn: false` hardcoded) | Spec (ORCH-0824-F captures opt-in) | No UX surface | Low — feature gap | Spec (intended) |
| Schema (`profiles.phone` nullable) | Runtime (consumer flow assumes populated) | Pre-fill gate blocks checkout if NULL | Medium — UX dead-end | Schema (truth); flow assumption wrong |
| Spec ORCH-0829-B-D1 (timeout race) | Later understanding (ORCH-0844 removed it) | Race itself caused double-settle | Resolved | Code post-ORCH-0844 |
| Spec ORCH-0824-F (triplicate JSX) | Code (@mingla/event-rendering package) | Mechanism mismatch | Resolved (better implementation) | Code (acceptable deviation) |

No runtime-or-data layer probes were performed (source-only audit per dispatch §5 hard guards). **Unblock request:** if operator wants live confirmation of organiser-notification absence and audience-pool-write absence at runtime, an operator-assisted live-fire smoke purchase + Supabase log check would prove it definitively. The source/SQL evidence is HIGH confidence on its own.

---

## §7. Sustainable Unification Architecture — three options ranked

The unification posture must respect: anon-tolerant buyer routes (memory `feedback_anon_buyer_routes`), Zustand-persist-no-server-snapshots, RLS-RETURNING-OWNER-GAP pattern, Stripe Connect account ID per-PI (ORCH-0844), idempotency discipline, and the Marketing Hub Cycle B5 gating (memory `project_marketing_hub_strategy`).

### Option A — **Formalize the current shared-engine model (RECOMMENDED)**

**Posture:** "Two front doors, one engine — same `ticket-checkout-create` edge function + same RPCs + same dispatcher, surface-discriminated only on the client side."

**What stays shared:** `ticket-checkout-create`, `ticket-checkout-status`, `stripe-webhook`, `_shared/stripeWebhookRouter.ts`, `_shared/ticketCheckout.ts`, `biz_ticket_checkout_create_session` RPC, `biz_ticket_checkout_finalize` RPC, `ticket-confirmation-dispatch`, `notification-retry-sweeper`, `_shared/ticketPdf.ts`, `orders`, `tickets`, `order_line_items`, all RLS, all webhook idempotency. **None of these change.**

**What splits (necessarily):** Client-side UX. Public uses Hosted Checkout (`surface="web"/"mobile-web"`) because anonymous browsers cannot mount the Stripe RN PaymentSheet. Consumer uses PaymentSheet (`surface="native"`) for the native UX the operator wants. Surface differentiation is the right boundary; this is not a defect.

**What ships to close the parity gap (the actual ORCH-0847 work):**
1. **Multi-tier quantity stepper** in `ExpandedBusinessEventSheet` mirroring the public-page tier UX (small UI work; edge function already accepts `lines[]` with quantities).
2. **Marketing opt-in checkbox** in the consumer purchase flow (in `TicketClaimConfirmModal` or a new step before it) — wires the existing `marketingOptIn` payload field instead of hardcoding `false`.
3. **Phone-required onboarding fix** OR an in-sheet phone-add path (decision for operator: gate-at-purchase vs. gate-at-onboarding). Currently consumer is blocked with a toast and no inline remediation.
4. **Organiser-notification parity (separate, shared across both flows)** — add `template_key='organiser_sale_received'` and dispatch to brand-team members (email always; push to brand-owner OneSignal external_user_id if available). This fixes both flows equally and lives in `ticket-confirmation-dispatch`.
5. **Decide audience-pool semantics with operator** — per memory `project_marketing_hub_strategy`, Marketing Hub Phase B is hard-gated. The buyer-to-organiser-reach gap is REAL but is the same gap on both flows; closing it for consumer parity may be premature. Either: (a) defer to Cycle B5 (recommended), (b) ship minimal write-on-purchase to `marketing_audiences.is_system_generated=true` audience now to prepare ground.

**Migration cost:** **S** (small). The architecture is correct; only the UX-completion items above need to land.
**Risk of regressing public flow:** **Very low.** Edge function changes confined to the new `organiser_sale_received` template; existing buyer templates untouched. Consumer-side UI changes are isolated to `ExpandedBusinessEventSheet` + `TicketClaimConfirmModal`.

**Operator trade-off (layman):** This option says "what you've been asking for is mostly already done. The next step is finishing the consumer UX (quantity, opt-in) and shipping organiser notifications evenly on both sides. Audience marketing — the part that lets organisers email past buyers — is a real gap on both sides, but it's part of a bigger Marketing Hub plan that's intentionally on ice until Stripe Connect + Checkout + Scanner are all stable. You can either close this gap in ORCH-0847 by writing buyers to a new audience members table on every sale, or defer it to Cycle B5 alongside the campaign composer."

### Option B — **Single unified-buyer event-page model (consumer adopts the public page directly)**

**Posture:** "Delete the consumer-side custom event sheet; embed the public business page route directly into the consumer app as an in-app browser session (the same pattern `openAuthSessionAsync` uses for Stripe Hosted Checkout)."

**What stays shared:** Everything backend (same as Option A) AND the rendered public event page itself — consumer no longer renders a separate sheet.

**What splits:** Nothing — fully unified.

**Migration cost:** **L** (large). Throws away ORCH-0824-F, ORCH-0829-A, ORCH-0834 consumer-side investment. Loses the in-app native feel for ticket browsing (forced to web view). Loses calendar-tab integration ergonomics (have to round-trip through deep-links for "view ticket"). Forces consumers through Hosted Checkout instead of PaymentSheet, which the operator explicitly wanted as a native experience.

**Risk of regressing public flow:** Zero (public flow is untouched).

**Operator trade-off (layman):** "Cheapest from a code-maintenance perspective but a downgrade for the consumer experience. The consumer app loses its native ticket browsing feel and uses web checkout instead of native PaymentSheet. Doesn't match the operator brief of 'just as though they bought it from the public event page, with the deltas we already keep on the consumer side.'"

**Disqualifier:** Operator explicitly described wanting a native consumer experience (PaymentSheet, in-app calendar, ticket viewable in app). Option B inverts that.

### Option C — **Full re-write into a single consumer-aware edge function + audience writer-on-purchase**

**Posture:** "Rewrite `ticket-checkout-create` to be account-aware first-class (accept and require `account_id`-or-null), bolt on `audience_members` denorm table + auto-trigger on `orders` INSERT to populate organiser-reachable buyers in real time, ship organiser push + email immediately, ship multi-tier UI, ship marketing opt-in UX."

**What stays shared:** Everything backend, but more deeply integrated. Audience membership becomes a first-class table populated on every purchase.

**What splits:** Nothing.

**Migration cost:** **L** (large) AND **violates memory `project_marketing_hub_strategy`** (Marketing Hub is Cycle B5, hard-gated). Doing this now front-runs the gated strategy and risks shipping audience semantics before the campaign composer is designed.

**Risk of regressing public flow:** Medium. Audience-on-INSERT trigger could fire on door sales, manual imports, and refunded orders without intended scoping unless carefully spec'd. RLS on `audience_members` must be designed before write logic.

**Operator trade-off (layman):** "Most thorough. Closes every gap including the audience marketing one. But it front-runs the gated Marketing Hub strategy and ships big new tables and semantics in the same release as a UX polish. Higher chance of needing rework when the actual marketing composer ships."

### Ranking and recommendation

1. **Option A — Formalize current shared-engine model.** RECOMMENDED.
2. **Option C — Full audience-aware rewrite.** Defer to Cycle B5.
3. **Option B — Embed public page in consumer.** DISQUALIFIED (contradicts operator brief).

**Reasoning:** The architecture the operator wants already exists. Option A finishes the small remaining UX deltas and bolts on the missing organiser notification (which improves BOTH flows in parity) without front-running a gated strategy.

---

## §8. Invariant + Memory Implications

### Existing invariants that constrain the unification
- **Anon-tolerant buyer routes** (memory `feedback_anon_buyer_routes`) — `/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}` must NOT call `useAuth`. **Upheld** by current public flow; consumer flow is a separate codebase under `(tabs)/` and does call auth (correct).
- **`I-PROPOSED-AW` checkout-session-never-reused-post-terminal** (per ORCH-0791 / 0829-B-D1) — RPC tombstones expired sessions. **Upheld** by `20260605000002_orch_0829b_d1_checkout_expiry_tombstone.sql`.
- **`I-PROPOSED-BB` SCAN_TIME_WINDOW_ENFORCED** (ORCH-0793) — scan RPC enforces ±2h/+6h around `event_dates`. **Upheld.** Applies to both flows.
- **`I-PROPOSED-AY` EVENT_DATES_SOLE_DATE_AUTHORITY** — `event_dates` is the canonical date source. **Upheld.**
- **`I-PROPOSED-AP` TICKET_PDF_PRIVACY** — PDF excludes `qr_token_hash`, pepper, Stripe IDs, buyer phone. **Upheld** by `_shared/ticketPdf.ts` per ORCH-0785 spec; assumes correct implementation.
- **`I-PROPOSED-BF` STRIPE_TAX_ENABLED_ON_CHECKOUT** — automatic_tax + webhook persistence. **Upheld** by `orders.tax_amount_cents`, `tax_calculation_id`.
- **`I-PROPOSED-CL` EVENT_UNIFIED_OFFERING_DISCRIMINATOR** — `events.event_type` enum is the only discriminator. **Upheld.**
- **Zustand-persist-no-server-snapshots** (memory `feedback_zustand_persist_no_server_snapshots`) — partialize holds IDs only. **Upheld** on consumer side: `useBusinessEventOrders` is a React Query hook, not persisted in Zustand.
- **`feedback_verify_db_column_names`** — grep migrations before queries. **Upheld** by §5 DB audit.

### New invariants the unification would establish (Option A)

- **`I-PROPOSED-CONSUMER-PURCHASE-USES-SAME-ENGINE`** (new): every consumer-app ticket purchase MUST route through `ticket-checkout-create` with `surface: "native"`; no parallel checkout function may be introduced. Codify the shared-engine architecture.
- **`I-PROPOSED-ORGANISER-NOTIFICATION-PARITY`** (new): every successful order finalization fires both a buyer-targeted AND an organiser-targeted notification row in `ticket_order_notifications`, regardless of `orders.source`. CI gate: assert dispatcher routes `template_key='organiser_sale_received'`.
- **`I-PROPOSED-MARKETING-OPT-IN-CAPTURED-NOT-WRITTEN`** (new, transitional): until Cycle B5 ships, `marketing_opt_in` is captured at purchase but is NOT a trigger for audience write. Documents the deliberate gap so future-Claude doesn't try to "fix" the missing writer.

### Memory updates needed on close
- New memory file `feedback_two_front_doors_one_engine.md` (status DRAFT until ORCH-0847 CLOSE): codifies "consumer + public business page share `ticket-checkout-create`; never write a second checkout function."
- Update `MEMORY.md` index with the new entry.

---

## §9. Open Questions for Operator (decision-blockers only)

1. **Audience-pool scope:** Defer audience-pool write to Cycle B5 (recommended per memory), OR ship a minimal `audience_members` write-on-purchase in ORCH-0847? This is the single biggest decision-fork in the spec.
2. **Multi-tier quantity stepper:** Mirror the public-page stepper exactly (matching min/max per tier from `ticket_types`), or simpler "1, 2, 3, 4, 5+" picker? Public-page UX should be the reference if "total parity" is the bar.
3. **Phone-required path:** Does ORCH-0847 fix `profiles.phone` reliability (onboarding enforcement or inline-add-phone in sheet), or do we accept the "Add a phone number" toast block as is and address it in a separate ORCH? Affects scope.
4. **Organiser notification recipients:** When a consumer (or public) buyer completes a purchase, who exactly should receive the organiser notification — brand owner only, all brand team members with finance+ role, or only members with a `notifications.sale_received_email_optin = true` preference (new column)? Push targeting needs a recipient model.
5. **Consumer-buyer in-app push on own purchase:** Do we send a push to the consumer ("Your ticket is ready in your calendar") OR rely only on the existing toast + email + SMS? Adds OneSignal target on consumer side only.
6. **Sub-ORCH split (governs §10):** If MULTI-SPEC, do you want them sequenced one-at-a-time per memory `feedback_sequential_one_step_at_a_time` (recommended), or batched?

---

## §10. Recommended Next Phase

**Verdict: MULTI-SPEC**, sequential per memory `feedback_sequential_one_step_at_a_time`.

Splitting ORCH-0847 into focused sub-specs lets each ship cleanly with its own tests and avoids one giant cross-layer change set. Recommended split:

- **ORCH-0847-A** [Multi-tier quantity stepper in consumer sheet] — UI only; reuses existing edge-function `lines[]` contract. Smallest, ships first.
- **ORCH-0847-B** [Marketing opt-in UX on consumer purchase] — adds checkbox; wires existing payload field. Tiny.
- **ORCH-0847-C** [Organiser sale-received notification — both flows] — new `template_key`, recipient model, push + email. Medium. Lives in dispatcher and webhook router; affects both sides equally.
- **ORCH-0847-D** [Phone-required onboarding or inline-add-phone] — operator decides scope from Q9.3.
- **ORCH-0847-E (deferred to Cycle B5 or operator-approved sooner)** [Audience-pool write-on-purchase] — biggest, decision-gated by Q9.1.

**Rationale:** Each sub-ORCH is independently testable, independently shippable, and respects sequential-pace memory. The current shared-engine architecture means no big-bang re-architecture is needed. The biggest decision (E) is operator-gated, which prevents the sub-spec dispatch from being blocked by Marketing Hub strategy.

**Justification for not single-SPEC:** A single mega-spec for "consumer parity" would (a) take longer to write and review, (b) couple unrelated decisions (UX polish ↔ marketing strategy ↔ phone onboarding), (c) make rollback granular harder, (d) violate the operator's stated sequential-pace preference.

**Justification for not BLOCKED:** None of the §9 questions are total blockers for the next phase; Q9.1 only gates ORCH-0847-E. A, B, C, D can all be specced as soon as the operator answers the relevant questions for those sub-specs.

---

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Investigation status:** Complete. Confidence: HIGH for §3, §4 (status tags), §5 gap matrix, §6 contradictions; MEDIUM-HIGH for §7 (architectural recommendation depends on operator answers to §9); HIGH for §8 invariants.
**No code changes were made.**

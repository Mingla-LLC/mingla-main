# INVESTIGATION ORCH-0777 — Real-Device Order Visibility + Free-Ticket Email Failure

Date: 2026-05-11
Owner: Claude `mingla-forensics` (INVESTIGATE mode)
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)
Dispatch: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_FREE_EMAIL_FAILURE.md`
Verdict: **ROOT CAUSE PROVEN — two independent bugs. Severity P0 launch-blocker.**

## Executive Summary

The operator's real-device checkouts on 2026-05-11 produced perfectly durable rows in production Supabase. Both orders, both line items, both tickets, and all four notification rows are committed. The two visible failures are NOT failures of the checkout pipeline — they are downstream of it:

1. **🔴 ROOT CAUSE A — Organizer Orders shows 0 for BOTH events.** The mingla-business `fetchEventOrders` SELECT lists a column (`orders.brand_id`) that does not exist on production. PostgREST rejects the entire request with HTTP 400 `42703: column "brand_id" does not exist`. The React Query in `useEventOrders` enters an error state, `data` is `undefined`, the Orders screen renders the "No orders yet" empty state. Affects BOTH events, BOTH order types (free and paid), and ALL organizer surfaces that read `useEventOrders` (Orders list, Order detail, Sold counts, Revenue, Guest list, Activity). RLS is NOT the cause — the request fails at column-resolution before the RLS predicate is evaluated.

2. **🔴 ROOT CAUSE B — Operator's free-ticket email for "A life in vegas" did not arrive.** The notification row for that order is `failed_terminal` with `last_error=resend_send_failed:403:config:validation_error`, written at 2026-05-11 02:59:30 UTC — **before** the operator finished the Resend `RESEND_API_KEY` + `RESEND_TICKET_FROM` repair (the next successful Resend send is 10 minutes later at 03:09:36 UTC). `ticket-confirmation-dispatch` classifies HTTP 403 as `config` (auth/permission) and marks the row terminal. The dispatcher's retry loop only picks up rows in `pending` or `failed_retryable`, so a 403-class row is dead permanently. The paid email at 03:48:20 succeeded because by that time both Resend and Twilio were operating.

Both root causes are bounded code/state issues, not architecture defects. Neither one requires a SPEC rewrite. Recommend a narrow Forensics SPEC for the smallest correct fix to (A) and a state-repair runbook for (B), then a single Codex implementor dispatch.

## Operator Real-Device Report Recap

- Operator (`b17e3e15-218d-475b-8c80-32d4948d6905`, account_owner of brand `22a18413-bfbf-4087-9ba7-45f70deba0f3` "leggothis") completed two real-device checkouts on 2026-05-11.
- Free ticket for **"A life in vegas"** (`b1ab659e-358d-41f3-a56d-76f7b273bddd`, USD, scheduled, public). Buyer did not receive the Resend email. Organizer Orders screen for the event shows zero.
- Paid ticket for **"The party block"** (`a3f71d85-33a5-4149-be8c-a1c1e33b3f7e`, USD, scheduled, public). Buyer received the email. Organizer Orders screen for the event also shows zero.
- The two events share the same brand → same Stripe-Connect destination → same RLS scope. Both organizer Orders views are wrong in the same way.

## Evidence Inventory Read

- `Mingla_Artifacts/prompts/FORENSICS_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_FREE_EMAIL_FAILURE.md`
- `Mingla_Artifacts/reports/QA_ORCH-0777_TICKET_CHECKOUT_IOS_ANDROID_WEB_PARITY.md`
- `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`
- `Mingla_Artifacts/reports/QA_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md`
- `mingla-business/src/services/eventOrdersService.ts`
- `mingla-business/src/hooks/useEventOrders.ts`
- `mingla-business/src/hooks/useManagedEventRoute.ts`
- `mingla-business/app/event/[id]/orders/index.tsx`
- `mingla-business/app/checkout/[eventId]/buyer.tsx`
- `mingla-business/app/checkout/[eventId]/confirm.tsx`
- `supabase/functions/ticket-checkout-create/index.ts`
- `supabase/functions/ticket-confirmation-dispatch/index.ts`
- `supabase/functions/_shared/ticketCheckout.ts`
- `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql`
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (orders / RLS helpers section)
- Production schema introspection on `gqnoajqerqhnvulmnyvv` via Supabase Management API (read-only).
- Production edge-function inventory (read-only).

## Live DB / Order Trace — "A life in vegas" (free)

Order produced by the operator's real-device free checkout:

| field | value |
|---|---|
| order_id | `c1d35ae6-49dc-4bfc-9586-1b22f6f93fca` |
| event_id | `b1ab659e-358d-41f3-a56d-76f7b273bddd` ("A life in vegas") |
| buyer_user_id | `b17e3e15-218d-475b-8c80-32d4948d6905` (operator) |
| buyer_name / buyer_email | "Seth" / `sethogieva@gmail.com` |
| buyer_phone_e164 | `+19843822876` |
| total_cents / currency | 0 / USD |
| payment_method / payment_status | `free` / `paid` |
| source / notification_status | `online_checkout` / `sent` *(rollup; underlying rows are failed_terminal — see Notification Trace below)* |
| checkout_session_id | `dbc9e56f-ec0b-48f6-82c9-7eacc6ab116d` |
| stripe_payment_intent_id | NULL (correct for free) |
| confirmed_at / created_at | 2026-05-11 02:59:30.295706 UTC |

Line items + ticket: 1× "Free ticket" (`ticket_type_id 5b75ca8c-...`) at $0.00, ticket `e7a4ef8b-7074-49f9-ae1b-efcf871e8dc2` with `qr_token_hash` and `qr_code` both populated, status `valid`. Total orders for `b1ab659e-...` in production: **8** (none of which the organizer screen can see). Conclusion: the DB write path succeeded. The order is durable.

## Live DB / Order Trace — "The party block" (paid)

Order produced by the operator's real-device paid checkout:

| field | value |
|---|---|
| order_id | `3ed6ee30-1a61-4fde-836d-2086c2bced13` |
| event_id | `a3f71d85-33a5-4149-be8c-a1c1e33b3f7e` ("The party block") |
| buyer_user_id | `b17e3e15-218d-475b-8c80-32d4948d6905` (operator) |
| buyer_name / buyer_email | "Seth" / `sethogieva@gmail.com` |
| buyer_phone_e164 | `+19843822876` |
| total_cents / currency | 5000 / USD |
| payment_method / payment_status | `online_card` / `paid` |
| stripe_payment_intent_id | `pi_3TVkn0PjlZyAYA4009D2jDnI` (redacted in artifacts; PaymentIntent ID only) |
| stripe_payment_intent_status | `succeeded` |
| source / notification_status | `online_checkout` / `sent` |
| checkout_session_id | `2c2ef190-daa5-48a2-a216-b03060c46e7c` |
| confirmed_at / created_at | 2026-05-11 03:48:20.957615 UTC |

Line items + ticket: 1× "The basic" (`ticket_type_id a76ba25f-...`) at $50.00, ticket `88ac4572-0251-4136-935e-e33ac52c7206` with `qr_token_hash` and `qr_code` populated, status `valid`. Total orders for `a3f71d85-...` in production: **2**. Conclusion: the paid DB write path succeeded; Stripe webhook finalization succeeded; ticket issuance succeeded.

## Notification Trace

The `ticket_order_notifications` rows for both operator orders and the live-fire neighbors during the 02:50–04:00 UTC window (privacy-safe; raw provider message ids redacted in this report):

| created_at (UTC) | order | channel | status | last_error |
|---|---|---|---|---|
| 02:55:27 | `869bee74` ORCH0777 Live Free | email | failed_terminal | `resend_send_failed:403:config:validation_error` |
| 02:55:27 | `869bee74` ORCH0777 Live Free | sms | failed_terminal | `twilio_send_failed:400:config` |
| **02:59:30** | **`c1d35ae6` operator free — A life in vegas** | **email** | **failed_terminal** | **`resend_send_failed:403:config:validation_error`** |
| **02:59:30** | **`c1d35ae6` operator free — A life in vegas** | **sms** | **failed_terminal** | **"The Messaging Service contains no phone numbers"** |
| 03:09:36 | `e8958375` ORCH0777 Resend Probe | email | **sent** (provider=resend) | — |
| 03:09:36 | `e8958375` ORCH0777 Resend Probe | sms | failed_terminal | `twilio_send_failed:400:config` |
| 03:11:20 | `8f31dfb4` ORCH0777 Twilio Probe | email | **sent** | — |
| 03:13:01 | `c68807d8` ORCH0777 SMS Probe | email | **sent** | — |
| 03:13:01 | `c68807d8` ORCH0777 SMS Probe | sms | failed_terminal | `undelivered` (post-callback) |
| 03:24:29 | `6ad119af` ORCH0777 Webhook E2E | email/sms | **sent / sent** | — |
| **03:48:20** | **`3ed6ee30` operator paid — The party block** | **email/sms** | **sent / sent** | — |

Key interpretation:

- The first successful Resend send post-repair is **03:09:36 UTC**. The operator's free real-device checkout fired at **02:59:30 UTC — roughly 10 minutes before the Resend repair completed**. Their free email row therefore captured the pre-repair `403:config:validation_error` and was marked `failed_terminal` (HTTP 400/401/403 → `retryable=false` in `_shared/ticketCheckout.ts:134-153`, then `terminal = !retryable || attempt_count >= 3` in `ticket-confirmation-dispatch/index.ts:169`).
- The dispatcher's WHERE clause at `ticket-confirmation-dispatch/index.ts:119-123` is `.in("status", ["pending", "failed_retryable"])`. `failed_terminal` rows are **never** picked up again — so even after Resend was repaired, the operator's free email will never auto-send.
- The operator's free SMS also failed terminal at 02:59:30 — Twilio HTTP 400 carrying "The Messaging Service contains no phone numbers", which is the symptom of the toll-free sender not yet being attached to the Messaging Service at that minute (the operator attached it in the same window per the live-fire matrix). Same dead-row condition.
- The paid checkout at 03:48:20 was 49 minutes after the provider repairs settled — both Resend and Twilio worked end-to-end on that order, which is why the operator received the paid email.
- The `orders.notification_status` rollup on row `c1d35ae6` reads `sent`, but the underlying notification rows are both `failed_terminal`. This is a stale rollup — `ticket-confirmation-dispatch/index.ts:181-184` recomputes the rollup from `outcomes`, but in this case the function later re-ran the row history when the orchestrator did its email-only repair work; the rollup field is **not** a reliable display signal for the organizer. Treat it as informational only; the ledger row is authoritative.

## Organizer Orders UI / Data-Flow Trace

Route → component → hook → service → PostgREST → schema mismatch:

1. `mingla-business/app/event/[id]/orders/index.tsx:81-89` reads `eventId` from `useLocalSearchParams`, asks `useManagedEventRoute(eventId)`, then calls `useEventOrders(eventId)`.
2. `useManagedEventRoute` (`src/hooks/useManagedEventRoute.ts:22-29`) only returns `replacementEventId !== null` when `localEvent.id.startsWith("le_")`. Both operator events are real server UUIDs, so `replacementEventId === null` — **no route redirect occurs**.
3. `useEventOrders` (`src/hooks/useEventOrders.ts:30-44`) builds query key `["event-orders", eventId]`, enabled when `!loading && session !== null && eventId !== null`, with `staleTime = 15s`. `queryFn` calls `fetchEventOrders(eventId)`.
4. `fetchEventOrders` (`src/services/eventOrdersService.ts:61-91`) issues this PostgREST request:
   ```ts
   .from("orders")
   .select(`
     id,
     event_id,
     brand_id,            // ← does NOT exist on public.orders
     buyer_email,
     buyer_name,
     buyer_phone,
     buyer_phone_e164,
     total_cents,
     currency,
     payment_method,
     payment_status,
     confirmed_at,
     created_at,
     order_line_items (
       ticket_type_id,
       quantity,
       unit_price_cents,
       total_cents,
       ticket_types (name, is_free)
     )
   `)
   .eq("event_id", eventId)
   .order("created_at", { ascending: false });
   ```
5. PostgREST rejects the request at column resolution with `ERROR: 42703: column "brand_id" does not exist` (verified by running the exact column list against the production DB through the Management API).
6. `fetchEventOrders` throws (line 91 `if (error) throw error;`). React Query enters error state, `ordersQuery.data === undefined`, `orders = useMemo(... ordersQuery.data ?? [], ...)` is `[]`.
7. Component renders the "No orders yet" `EmptyState` (`index.tsx:291-307`) because `totalCount === 0`. The Loading branch (`ordersQuery.isLoading`) is also false because the query has fully completed with error; React Query distinguishes `isLoading` from `isError` and the UI does not render an error-specific branch.
8. Net effect for the operator: a perfectly seated row in `public.orders` is invisible to the organizer surface, because the SELECT cannot even reach the RLS predicate — it fails at the schema level inside PostgREST.

Static evidence that `orders.brand_id` was renamed/removed at some point: the baseline squash `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` and migration `20260515000013_orch_0777_ticket_checkout_core.sql` together leave `public.orders` with the column set `(id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone, total_cents, currency, payment_method, payment_status, stripe_payment_intent_id, stripe_charge_id, is_door_sale, created_by_scanner_id, metadata, created_at, updated_at, checkout_session_id, buyer_phone_e164, confirmed_at, failed_at, source, notification_status, stripe_payment_intent_status, stripe_application_fee_amount_cents, stripe_transfer_destination, stripe_payment_method_type)`. There is no `brand_id`. Brand identity for an order is reached transitively via `events.brand_id`. The `OrderRecord.brandId` field that the mobile mapper writes (`eventOrdersService.ts:96 brandId: order.brand_id ?? ""`) is a holdover from the previous local-Zustand schema. Tests `ticketCheckoutMigrationGuards.test.ts` mock the supabase client, so they don't catch the schema mismatch.

## RLS / Auth / Team Permission Proof

Operator is `account_owner` of brand `22a18413-bfbf-4087-9ba7-45f70deba0f3` (verified by direct read of `public.brand_team_members`, `accepted_at=2026-05-07 08:11:03 UTC`, `removed_at=null`). RLS chain for `SELECT` on `orders`:

- Policy: `Buyer or brand team can select orders` (`baseline:14200`) — `USING public.biz_can_read_order_for_caller(id)`.
- `biz_can_read_order_for_caller` → `biz_can_read_order(p_order_id, auth.uid())` (baseline 3111-3119) → succeeds when `o.buyer_user_id IS NOT DISTINCT FROM auth.uid() OR biz_is_brand_member_for_read(e.brand_id, auth.uid())`.
- `biz_is_brand_member_for_read(brand_id, auth.uid())` returns true for account_owner.

Even ignoring brand-member status, `orders.c1d35ae6` and `orders.3ed6ee30` both have `buyer_user_id = b17e3e15-...` (the operator themselves) — they have direct buyer access. RLS would let them read the rows immediately. RLS is **not the blocker**. The SELECT never gets that far.

Furthermore, the prior live-fire orders (`869bee74-...`, `c68807d8-...`, etc.) have `buyer_user_id = null` (anonymous buyers). The same brand-team predicate applies for the operator-as-brand-member path. All 10 surveyed orders for the two events are RLS-readable by the operator under the current policies.

## Build / Version / OTA Risk Check

| Surface | State |
|---|---|
| Edge function `ticket-checkout-create` | ACTIVE v12 — matches working tree |
| Edge function `ticket-confirmation-dispatch` | ACTIVE v11 — matches working tree (or one ahead) |
| Edge function `ticket-checkout-status` | ACTIVE v11 |
| Edge function `stripe-webhook` | ACTIVE v16 |
| Edge function `twilio-message-status` | ACTIVE v11 |
| Edge function `scan-ticket` | ACTIVE v11 |
| Migration `20260515000013` | applied |
| Migration `20260515000015` | applied |
| Migration `20260515000016` | applied |
| Migration `20260515000017` | applied |
| Operator's installed mingla-business build | Hits new `ticket-checkout-create` v12 successfully — order rows include `checkout_session_id`, `buyer_phone_e164`, `qr_token_hash`, `qr_code`. Confirms the buyer device is NOT running an older local-Zustand stub. The phone build is current. |
| `mingla-business/src/services/eventOrdersService.ts` schema mismatch | Present on current `main` (commit `ca69de38` "Clean tree", introduced 2026-05-10 along with the rest of the eventOrdersService). The file's net-new SELECT is the regression. |

There is **no stale build risk** on either side. The buyer path is on the new contract. The organizer-orders path is also on the new contract — but the new code itself contains the column-mismatch bug.

## Root Causes

### 🔴 ROOT CAUSE A — `fetchEventOrders` selects a non-existent column `orders.brand_id`

| field | proof |
|---|---|
| file + line | `mingla-business/src/services/eventOrdersService.ts:67-89` (SELECT list with `brand_id` at line 69, repeated in `OrderRow` interface line 7 and in mapper line 96) |
| exact code | `.from("orders").select(\`id, event_id, brand_id, buyer_email, ...\`)` |
| what it does | PostgREST 400 `42703: column "brand_id" does not exist`; React Query throws; UI renders "No orders yet" empty state |
| what it should do | Either drop `brand_id` from the SELECT and set `brandId` from a joined `events(brand_id)` embed, or accept that the mobile `OrderRecord.brandId` field is no longer load-bearing and drop it from the mapping/type entirely |
| causal chain | operator opens `/event/[id]/orders` → `useEventOrders(eventId)` enabled with the operator's auth session → `fetchEventOrders(eventId)` → PostgREST GET `/rest/v1/orders?event_id=eq.<uuid>&select=id,event_id,brand_id,...` → 400 → `useQuery` rejects → `data` is undefined → orders array `[]` → `totalCount === 0` → "No orders yet" rendered. The bug is layer-3 (service), not RLS/route/UI. |
| verification step | Reproduced live by sending the exact column list to the production DB via Supabase Management API: returns `ERROR: 42703: column "brand_id" does not exist`. Same column dropped from the SELECT returns 8 rows for "A life in vegas" and 2 rows for "The party block". |

Confidence: **PROVEN**.

Blast radius: every organizer surface that consumes `useEventOrders` or its derivatives — Orders list, Order detail, Sold count, Revenue card, Activity feed, Guest list, Reconciliation, Sold-counts grid, Web purchases flag. All of these silently render zero. The recent live-fire matrix's "Organizer Orders truth within 15s (free/paid) PASS" verdict was based on **direct DB reads through service-role**, never through the mingla-business app's actual SELECT path. The matrix's PASS row is technically true at the DB layer but does NOT reflect the user-facing surface.

### 🔴 ROOT CAUSE B — Operator's free notification rows are `failed_terminal` and unreachable by retry

| field | proof |
|---|---|
| file + line | `supabase/functions/_shared/ticketCheckout.ts:134-153` (`classifyNotificationProviderFailure`) classifies HTTP 403 as `retryable=false`. `supabase/functions/ticket-confirmation-dispatch/index.ts:167-176` marks `failed_terminal` when `!retryable`. Same file lines 119-123 filter on `.in("status", ["pending", "failed_retryable"])` — `failed_terminal` rows are never reprocessed. |
| exact code | `const retryable = status === 429 \|\| status >= 500;` + `const terminal = !retryable \|\| attemptCount >= 3;` + `status: terminal ? "failed_terminal" : "failed_retryable"`. |
| what it does | Locks the operator's free email row for `c1d35ae6` in `failed_terminal` permanently. Even after Resend was repaired ~10 minutes later, the row is never picked up by any dispatch. |
| what it should do | Either (i) revive failed_terminal rows post-config-repair via an operator-issued resend RPC, or (ii) treat a Resend 403 with `validation_error` as a recoverable transient when a later send to the same domain succeeds, or (iii) accept terminal classification but expose a per-order "resend" action in the organizer UI. The SPEC §6.4 already says "authenticated organizer resend action from order detail" — that path needs to exist post-launch. |
| causal chain | 02:59:30 UTC: operator submits free checkout from real device → `ticket-checkout-create` v12 → `biz_ticket_checkout_finalize` writes order/tickets/notifications → invokes `ticket-confirmation-dispatch` → dispatch calls Resend POST `/emails` → Resend returns HTTP 403 with `{name|code|type: 'validation_error'}` (sender domain/key not yet repaired) → classifier returns `retryable=false`, `detail='resend_send_failed:403:config:validation_error'` → dispatch updates row to `failed_terminal` → operator's mailbox never sees a Resend send. |
| verification step | `ticket_order_notifications` row for `order_id=c1d35ae6-...` channel=`email` has `status=failed_terminal`, `provider=null`, `last_error=resend_send_failed:403:config:validation_error`, `attempt_count=1`, `sent_at=null`, `updated_at=2026-05-11 02:59:30.997 UTC`. Successive Resend probes succeeded starting `2026-05-11 03:09:36.553 UTC` (order `e8958375-...`, same dispatch code, same provider). The dispatch code change is not needed to reproduce — the rule is in the existing classifier. |

Confidence: **PROVEN**.

Blast radius: every free-ticket order finalized during the provider-config-repair window (`869bee74-...`, `c1d35ae6-...`, `16c6339e-...`, `f3393adc-...`, `2c25c503-...`, `8f31dfb4-...`, `e8958375-...` and any other 02:55–03:10 UTC free orders) carries a `failed_terminal` email or SMS row. Same shape for any future operator-config gap (e.g., a Resend key rotation that briefly returns 403). The free order at `c68807d8-...` (03:13:01 UTC, "ORCH0777 SMS Probe") has the email row already `sent` — the cutover is between 02:59 and 03:09. So the operator's row is the latest free-checkout row to be caught in the dead window.

### 🟡 HIDDEN FLAW — `orders.notification_status` rollup can lie

The orders table's `notification_status` field for `c1d35ae6-...` reads `sent`, but both child notification rows are `failed_terminal`. The dispatch recomputes the rollup at `ticket-confirmation-dispatch/index.ts:181-184`:

```ts
notification_status: failed ? (sent ? "partial" : "failed") : "sent",
```

The recompute only considers rows touched in this call. The operator's row probably had the rollup field set to `sent` by a later passing iteration (or the SMS-only path) that did not re-touch the failed email row but still updated the parent. This makes the parent rollup unreliable; any UI that displays "notification status" should query the child rows directly. Not the cause of today's symptom, but worth flagging.

### 🔵 OBSERVATION — `Confirm` screen tells the buyer the email was sent unconditionally

`mingla-business/app/checkout/[eventId]/confirm.tsx:203-205` always renders `"Sent to {buyer.email} and {buyer.phone}."` — regardless of `result.notificationStatus`. For the operator's free order, the dispatch ledger says terminal failure, yet the UI says "Sent." Not a fault of this dispatch — the buyer device cannot easily poll for terminal-fail without status fetch. But product-side it should at minimum branch on `notificationStatus !== "queued"` to soften the wording. Out of scope for this investigation but worth logging.

## Five-Layer Cross-Check

| layer | what it says |
|---|---|
| Docs (SPEC §3.5 / §6.4) | "Organizer surfaces must read server orders/tickets for server-backed events." Resend action is required. The current `eventOrdersService` violates this. |
| Schema (live `public.orders`) | No `brand_id` column. Has `event_id` and the events table holds `brand_id`. The SELECT is unsatisfiable. |
| Code (`eventOrdersService.ts`) | Selects `brand_id`. Maps `brandId: order.brand_id ?? ""`. |
| Runtime (PostgREST) | 400 `42703`. Confirmed via Management API SQL. |
| Data (`public.orders` and `ticket_order_notifications`) | Operator rows exist and are correct. Notification rows are `failed_terminal` per the timeline. |

Layers Docs/Schema/Runtime/Data agree on the truth (no brand_id; failed_terminal rows); Code disagrees on both. Classic schema-drift + state-fence bug.

## Blast Radius

| surface | risk | basis |
|---|---|---|
| `/event/[id]/orders` (Orders list) | 100% empty for all events | direct dependence on `useEventOrders` |
| `/event/[id]/orders/[oid]` (Order detail) | 100% empty for all events | derives `getEventOrderById` from `fetchEventOrders` |
| `/event/[id]/guests` (Guest list) | 100% empty | derives `getEventGuestList` from `fetchEventOrders` |
| Event card sold-count badges | always 0 | `useEventSoldCounts` runs `fetchEventOrders` per event id |
| Event revenue widget | always 0 | `useEventOrderRevenue` |
| Event activity feed | empty | `useEventOrderActivity` |
| Scanner | unaffected | scanner reads server tickets directly via `scan-ticket` RPC, not via `fetchEventOrders` |
| Confirmation screen for buyer | unaffected | buyer reads `useCart`, not orders SELECT |
| Stripe webhook / paid finalization | unaffected | server-side path; webhook writes orders successfully |
| Free notifications | currently dead for ~7 orders in the 02:55–03:09 dead window | scoped to provider-config-repair window |
| Future provider-config gaps (key rotation, sender re-attach) | will produce more `failed_terminal` notification rows that never auto-recover | structural |

## Smallest Safe Fix Direction

This is a fix-direction sketch for the SPECer, not a contract.

### Fix A — Organizer orders SELECT

The minimum correct shape is to remove `brand_id` from the column list and drop the `brandId` mapping field if it is not actually consumed, or replace it with an `events!inner(brand_id)` embed if it is.

Audit pass: grep `OrderRecord.brandId` consumers in `mingla-business/src`. If nothing reads it for routing, badges, payouts, etc., simplest fix is to:

1. Delete `brand_id` from the `select(...)` string in `eventOrdersService.ts:67`.
2. Delete `brand_id: string \| null` from the `OrderRow` interface line 7.
3. Either remove `brandId` from `OrderRecord` mapping and the `OrderRecord` type, **or** keep `brandId` on the mapped record but derive it from `events.brand_id` via embed: `.select(... events!inner(brand_id) ...)`.

If `brandId` is load-bearing for cross-event surfaces (e.g., payout routing), prefer the embed. If it's a vestige of the previous local-Zustand shape, prefer deletion.

Add a regression test: `ticketCheckoutMigrationGuards.test.ts` should snapshot the `select(...)` string against the actual production columns, OR a Deno integration test should hit a known-empty event id through PostgREST and assert HTTP 200 (not 400). The current Jest mock makes the test green even when the column list is wrong.

### Fix B — Notification revival path

Two minimum-correct options:

1. **State-repair runbook for the operator** — write a one-line Management-API SQL to flip the relevant `failed_terminal` rows back to `pending` with `attempt_count=0` and re-invoke `ticket-confirmation-dispatch` for each affected order. This unblocks the operator's free email immediately without code changes.
2. **Organizer "Resend ticket" CTA** — implement SPEC §6.4 invocation mode 3 ("authenticated organizer resend action from order detail"). The dispatcher already has the invocation surface; it just needs the UI and a new idempotency-key suffix per resend cycle so the unique `(order_id, channel, recipient)` constraint can be satisfied with a fresh row.

The SPEC explicitly anticipated (2). The hidden flaw in the rollup field (`orders.notification_status` = `sent` while children are terminal) should be addressed when option (2) lands: recompute the rollup from all child rows, not just touched ones.

## Regression Tests Required

| test id | covers | shape |
|---|---|---|
| RT-1 | `fetchEventOrders` column shape matches real schema | Deno or Jest integration test: spin up against a known event id, assert query returns array (not throws). Or a static-analysis test that diffs the SELECT column list against `information_schema.columns WHERE table_name='orders'` at build time. **Would fail before Fix A, pass after.** |
| RT-2 | `useEventOrders` renders > 0 when the DB has > 0 rows for that event | RTL test with mock supabase that returns one OrderRow → expect `OrderListCard` rendered, not `EmptyState`. (Indirectly covered today via mock; would not have caught the schema bug because mocks don't validate columns.) |
| RT-3 | Confirmation dispatcher revives a terminal row when forced | Deno test: insert a terminal row, call dispatcher with a `forceResend=true` or via a new `ticket-confirmation-resend` function, assert child rows transition to `sent`. |
| RT-4 | Notification rollup is always derived from all child rows | SQL probe / Deno test: create an order with one sent and one failed_terminal child, run dispatch, assert `orders.notification_status='partial'` (not `sent`). |
| RT-5 | `mingla-business` strict-grep CI gate | Add a strict-grep rule: any `select("...brand_id...")` against `from("orders")` must fail CI (per memory rule on strict-grep registry pattern). |

## Manual Retest Gates (post-fix)

1. Operator opens `/event/b1ab659e-358d-41f3-a56d-76f7b273bddd/orders` — expects 8 rows visible (or however many exist at retest time), headline counts > 0 within < 15s.
2. Operator opens `/event/a3f71d85-33a5-4149-be8c-a1c1e33b3f7e/orders` — expects ≥ 2 rows visible.
3. Operator taps order `c1d35ae6-...` — expects detail to load, ticket QR rendered (already valid in DB).
4. Operator runs the state-repair runbook (or "Resend ticket" CTA when implemented) on order `c1d35ae6-...` — expects email to arrive at `sethogieva@gmail.com` within 60s and the notification ledger row to transition to `sent`.
5. Operator opens `/event/<event>/scanner` and scans the paid ticket — expects existing `wrong_event` / `success` / `duplicate` behavior (covered by the live-fire matrix's migration 17 SQL evidence and unchanged by this fix).

## Discoveries for Orchestrator

- **`OrderRecord.brandId` field is vestigial** in the post-ORCH-0777 server-truth orders flow. Either prune from the type or backfill from `events.brand_id`. The choice has ripple effects (the entire `OrderRecord` type comes from `mingla-business/src/store/orderStore.ts` — a legacy local-Zustand shape). The SPEC explicitly allows the local store to remain as a transitional fallback (§3.5); the production read path should not depend on that store's column assumptions.
- **The live-fire matrix's "Organizer Orders truth within 15s" PASS row is misleading.** It tested the DB layer directly via service-role queries, never the mingla-business client SELECT. Recommend amending the matrix to test the mingla-business client path explicitly (or add a Deno test that runs the exact PostgREST request the client would send with an authenticated anon JWT).
- **The notification dispatcher is missing a UI-driven resend surface.** SPEC §6.4 names it; no edge-function or component implements invocation mode 3. The state-repair runbook is a stopgap; the launch contract calls for a real "Resend ticket" CTA.
- **Confirmation screen unconditional copy.** The current `"Sent to {email} and {phone}"` text in `confirm.tsx:203-205` is a known UX risk when notification status is not `queued`/`sent`. Out of scope here; tag for a follow-up Cycle 8 UX polish.
- **Twilio notification row mixed shape.** Some rows have provider=null on failure, some have provider="twilio". Indicates a brief older-version dispatch ran for ~one minute around the rollout — explore `supabase/functions/ticket-confirmation-dispatch` deploy history if forensic clarity is needed; not a launch blocker.

## Recommended Next Lifecycle Route

**SPEC** — root cause is proven, scope is narrow, and the fix direction is clear but needs a binding contract:

- the exact column-list change for `fetchEventOrders` and any embed needed for `OrderRecord.brandId`;
- the precise `OrderRecord` type edit (delete vs. backfill);
- the regression test contract (RT-1 / RT-5 strict-grep) so this class of schema-drift bug cannot recur;
- the notification-revival strategy (state-repair runbook only vs. dispatcher CTA in the same cycle);
- the success criteria for the manual retest gates.

This is **not** a direct implementor route because the `OrderRecord.brandId` field has cross-cutting consumers and the dispatcher CTA decision is product-shaped, not narrowly engineering-shaped. The SPECer should resolve those before code lands.

Confidence on routing: **HIGH**.

## Hard-Guard Compliance

- No raw Resend API key, Twilio auth token, Stripe restricted key, Stripe secret key, Stripe client secret, PaymentIntent client_secret, full provider message id, full email body, QR payload string, buyer status token, QR pepper value, or pepper digest body is printed or artifacted in this report.
- Order IDs, event IDs, brand IDs, and PaymentIntent IDs are reused from existing ORCH-0777 artifacts and represent test-mode infrastructure already cited.
- No mutation was performed against the production DB. All Management-API SQL was read-only (one schema introspection, two count queries, one read of `public.orders`, one read of `public.tickets`, one read of `public.order_line_items`, one read of `public.ticket_order_notifications`, one read of `public.brand_team_members`, one read of `pg_class`, plus one reproduction-of-failure SELECT that surfaced the same 42703 the client gets).
- No database migration was applied, no edge function was deployed, no code was edited.

## Failure-Honesty Label

`root cause proven` — six-field evidence on both root causes. Five-layer cross-check holds. Manual reproduction of the schema mismatch matches the symptom exactly. Notification timeline pins the dead-window precisely (10-minute span between operator free checkout and first successful Resend send).

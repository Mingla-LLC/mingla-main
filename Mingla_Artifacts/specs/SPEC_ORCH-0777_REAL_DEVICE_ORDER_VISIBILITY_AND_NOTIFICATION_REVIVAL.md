# SPEC ORCH-0777 — Real-Device Order Visibility and Notification Revival

Date: 2026-05-11
Owner: Claude `mingla-forensics` (SPEC mode)
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)
Dispatch: `Mingla_Artifacts/prompts/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
Status: READY FOR ORCHESTRATOR REVIEW
Priority: P0 launch blocker — ORCH-0777 cannot CLOSE until both Fix A and Fix B are proven independently.

## 1. Plain-English Goal

Two unrelated production defects survived the prior ORCH-0777 backend live-fire pass and are blocking real-device launch:

- **A. Organizer Orders is permanently empty for every event.** The mingla-business client asks Supabase for a column on `orders` that does not exist on production (`orders.brand_id`). PostgREST rejects the entire SELECT with HTTP 400; React Query enters error state; every organizer surface (Orders list, Order detail, Revenue, Sold counts, Guest list, Activity) renders "No orders yet" even when durable rows exist.
- **B. Free-checkout buyer notifications written during the operator's provider-config repair window are stuck as `failed_terminal` and will never auto-recover.** The dispatcher's retry loop only polls `pending` and `failed_retryable`, so the operator's free email at 02:59:30 UTC on 2026-05-11 (and the other free orders inside the 02:55–03:09 dead window) will never be sent.

This spec defines the smallest correct fix for each defect, on independent code paths and with independent verification gates. They MUST NOT be collapsed into a single fix or a single retest gate.

## 2. Inputs Read

- `Mingla_Artifacts/prompts/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_FREE_EMAIL_FAILURE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md` (§3.5 organizer truth, §6.4 resend contract)
- `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`
- `Mingla_Artifacts/reports/QA_ORCH-0777_TICKET_CHECKOUT_IOS_ANDROID_WEB_PARITY.md`
- `mingla-business/src/services/eventOrdersService.ts` (the file under repair for Fix A)
- `mingla-business/src/hooks/useEventOrders.ts`
- `mingla-business/app/event/[id]/orders/index.tsx`
- `mingla-business/src/store/orderStore.ts` (`OrderRecord` shape — `brandId: string` at line 111)
- `mingla-business/src/components/orders/RefundSheet.tsx:145` — consumer of `order.brandId`
- `mingla-business/app/o/[orderId].tsx:174` — consumer of `order.brandId`
- `mingla-business/app/event/[id]/guests/[guestId].tsx:192` — consumer of `order.brandId`
- `supabase/functions/ticket-confirmation-dispatch/index.ts` (retry-loop status filter and rollup recompute)
- `supabase/functions/_shared/ticketCheckout.ts` (`classifyNotificationProviderFailure` 134-153)
- `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` (registry pattern host)
- `.github/workflows/strict-grep-mingla-business.yml` (registry pattern host)
- `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts` (Jest harness this spec extends)

## 3. Scope, Non-Goals, Hard Guards

### 3.1 In Scope (split A / B)

**Fix A — Organizer order visibility repair** (mingla-business client only):

- The PostgREST SELECT in `eventOrdersService.fetchEventOrders` and any related local types/mappers in the same file.
- A new CI strict-grep gate that fails the build if `mingla-business` ever again selects `brand_id` from `from("orders")`.
- An extension to the existing Jest migration-guards harness that asserts the SELECT no longer names `brand_id` on `orders` and that the file does not declare `brand_id` on its `OrderRow` interface.
- The Tester surface contract for proving the post-fix Orders/Order detail/Revenue/Sold-count/Guest list/Activity rendering against the real production DB on the operator's leggothis brand events.

**Fix B — Failed-terminal notification revival** (Supabase state-repair runbook + dispatcher contract clarification; no product-UI work this cycle):

- A privacy-safe state-repair runbook for already-`failed_terminal` ORCH-0777 free-window rows.
- A clarification, not a behavior change, of how the dispatcher's existing retry filter interacts with `failed_terminal` rows so the operator can issue an authorized revival without duplicating tickets or spamming buyers.
- An explicit handoff of the SPEC §6.4 organizer "Resend ticket" CTA to a follow-up ORCH (deferred, not delivered, in this cycle) with the contract sketched below so the next dispatch starts from a defined surface.
- The Tester verification gates for proving (i) targeted terminal rows transition to `sent` post-revival, (ii) ledger child-row state is authoritative, (iii) no duplicate tickets/order rows are created.

### 3.2 Non-Goals

- No broad checkout rewrite. Free and paid checkout durability is already proven by the live-fire matrix on the operator's real-device transactions.
- No Stripe webhook, PaymentIntent, scanner, B2 ticket-credential RLS, QR pepper, Connect onboarding, application-fee, or refund-flow changes. Those surfaces are intact per the prior spec and live-fire matrix.
- No change to the dispatcher's existing `retryable` vs `config` classification rules in `_shared/ticketCheckout.ts:134-153`. The dead-window rows are a state problem, not a classification problem.
- No new product code for an organizer "Resend ticket" CTA in this cycle. That CTA's contract is sketched in §7.2 and explicitly deferred to a follow-up ORCH.
- No change to `orders.notification_status` rollup semantics. The investigation flagged this as a hidden flaw; deferred to the same follow-up that lands the Resend CTA.
- No Twilio toll-free verification, RCS sender approval, or Resend delivery webhook registration. Those are operator-side / external-provider items outside this spec.

### 3.3 Hard Guards

- **SPEC ONLY.** This document does not implement code, does not modify product code, does not push migrations, does not deploy edge functions, does not mutate provider/dashboard state.
- **No PII / secrets in artifacts.** No raw Resend API key, Twilio auth token, Stripe restricted key, Stripe secret key, Stripe client secret, PaymentIntent client_secret, full provider message id, full email body, raw QR payload, buyer status token, QR pepper value, pepper digest, buyer email address, or buyer phone number is reproduced in any spec, implementor, or tester artifact tied to this dispatch. Order IDs, event IDs, brand IDs, and PaymentIntent IDs may be reused from prior ORCH-0777 artifacts where already cited, since they are test-mode infrastructure.
- **No collapsing.** Fix A and Fix B have different owners, different files, different verification gates, and different evidence shapes. Reports that lump them under one "checkout still broken" verdict are non-conforming.
- **No Supabase DB push, no Edge Function deploy, no provider mutation** at SPEC or implementor time. Fix A requires no migration. Fix B's state-repair runbook is an operator-or-implementor-authorized one-shot DML against `ticket_order_notifications` plus a re-invocation of the existing `ticket-confirmation-dispatch` ACTIVE function — no new function deploy, no migration, no provider configuration mutation.
- **Independent CLOSE gate.** ORCH-0777 cannot CLOSE until BOTH Fix A and Fix B verification gates pass independently. A single combined "everything works" verdict is non-conforming.

## 4. Assumptions

| # | Assumption | Verification path if challenged |
|---|---|---|
| A1 | Production `public.orders` does not have a `brand_id` column. | Already reproduced live by the investigation via Supabase Management API; re-confirm with a read-only `information_schema.columns` query against `gqnoajqerqhnvulmnyvv` if Codex needs to re-verify before edits. |
| A2 | `OrderRecord.brandId` (declared at `mingla-business/src/store/orderStore.ts:111`) is load-bearing for production organizer flows. | Codex consumers grep across mingla-business confirms three runtime callers: `RefundSheet.tsx:145` (brand-role gating for refunds), `app/o/[orderId].tsx:174` (resolving brand for the order-detail brand-card), `app/event/[id]/guests/[guestId].tsx:192` (cross-order brand-matching predicate). The field cannot be silently dropped without breaking these surfaces. |
| A3 | `events.brand_id` is the authoritative source for an order's brand. | Schema-level: `orders.event_id → events.id → events.brand_id`. Used today by every server flow (RLS predicates, payouts, dispatcher). |
| A4 | The 02:55–03:09 UTC 2026-05-11 dead window is bounded by the seven rows enumerated in the investigation. | Investigation enumerates them by `order_id` prefix; re-confirm with a privacy-safe read on `ticket_order_notifications` filtered by `created_at BETWEEN 2026-05-11 02:55Z AND 2026-05-11 03:10Z AND status = 'failed_terminal'`. |
| A5 | The dispatcher's `ticket-confirmation-dispatch` ACTIVE v11 retry loop is correct for the normal case (HTTP 4xx config → `failed_terminal`; HTTP 429/5xx → `failed_retryable`). | Live-fire matrix proved both classifications on the rerun day's evidence; no change needed. |
| A6 | The strict-grep registry pattern requires one script + one job per gate, hosted at `.github/scripts/strict-grep/` and `.github/workflows/strict-grep-mingla-business.yml`. | Codified per memory `feedback_strict_grep_registry_pattern.md`. The existing `orch-0777-ticket-checkout-production.mjs` script is the host for Fix A's new assertions; its workflow job entry must also be ensured (see §5.A.4). |

If any assumption is challenged at implementor time, the implementor must escalate to the orchestrator before editing code.

## 5. Required Specification

### Fix A. Organizer Order Visibility

#### A.1 Files Modified (exact)

| File | Change shape |
|---|---|
| `mingla-business/src/services/eventOrdersService.ts` | Remove `brand_id` from the `OrderRow` interface and from the PostgREST `select(...)` literal; replace the brand-id source by an `events!inner(brand_id)` embed; remap `brandId` from `order.events?.brand_id ?? ""` instead of `order.brand_id ?? ""`. Add an honest error pass-through (see A.3). |
| `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts` | Add a new `describe("ORCH-0777 organizer order visibility repair", …)` block with three assertions: (i) `eventOrdersService.ts` source does not contain `brand_id` inside the `from("orders")` select literal, (ii) does not declare a `brand_id` field on its `OrderRow` interface, (iii) DOES contain `events!inner(brand_id)` or `events(brand_id)` embed (whichever the implementor uses — both are equivalent for column-resolution). |
| `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` | Add `assertRegexAbsent` rules on `mingla-business/src/services/eventOrdersService.ts` for the patterns documented in A.4. Add an `assertRegex` for the embed pattern. |
| `.github/workflows/strict-grep-mingla-business.yml` | Ensure a workflow job entry exists for the ORCH-0777 strict-grep script (the script is on disk but not yet listed in `jobs:`; if a job entry does not exist, add one named `orch-0777-ticket-checkout-production` following the existing `orch-0776d-cancelled-at-schema` pattern, running `node .github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`). |

#### A.2 PostgREST Select Contract (binding)

The implementor MUST replace the current SELECT string in `fetchEventOrders` with the following shape (whitespace-tolerant, but the column list is binding):

```ts
.from("orders")
.select(`
  id,
  event_id,
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
  events!inner ( brand_id ),
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

`events!inner(brand_id)` is required (not `events(brand_id)`) so PostgREST emits an INNER JOIN, which (i) prevents NULL `brandId` on `OrderRecord` when the embed is unexpectedly empty and (ii) matches the existing RLS contract that orders can only be selected when the event row is also selectable. The `!inner` form is supported by PostgREST and matches the standard pattern used elsewhere in the codebase.

#### A.3 Type and Mapper Contract (binding)

`OrderRow` (line 4-25 of `eventOrdersService.ts`) MUST be updated as follows:

- Remove `brand_id: string | null;` (line 7).
- Add a new field `events: { brand_id: string | null } | null;` to model the embed.
- Update the mapper at line 96: replace `brandId: order.brand_id ?? "",` with `brandId: order.events?.brand_id ?? "",`.

The downstream `OrderRecord.brandId` type at `mingla-business/src/store/orderStore.ts:111` remains `brandId: string` (unchanged). The empty-string fallback is the same conservative default the file already uses for missing-name and missing-phone fields and is what the three consumers (`RefundSheet`, `app/o/[orderId]`, `app/event/[id]/guests/[guestId]`) already tolerate today.

#### A.4 Honest Error / Empty-State Behavior (binding inside narrow blast radius)

`fetchEventOrders` already throws on error (`if (error) throw error;` line 91). `useEventOrders` already exposes `isError` as a distinct state from `isLoading`. The narrow-blast-radius improvement required by this fix:

- Update `mingla-business/app/event/[id]/orders/index.tsx` to branch on `ordersQuery.isError === true` and render an honest error `EmptyState` (illustration "ticket", title "Couldn't load orders", description "Something went wrong loading orders. Pull to retry.") instead of falling through to the "No orders yet" empty state.
- DO NOT change any other organizer surface in this cycle. The same regression class on Order detail / Revenue / Sold count / Guest list / Activity is fixed by Fix A.1 making the SELECT actually return rows; an honest error branch on each of those is queued for a follow-up Cycle 8 polish ORCH and is explicitly out-of-scope here.

The implementor MUST NOT introduce React Query `retry` overrides, custom backoff, or refetch interval changes — the existing defaults are correct and changing them risks blast outside the narrow scope.

#### A.5 Strict-Grep Gate Rules (binding)

Append the following assertions to `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` (using the existing `assertNotIncludes` / `assertRegex` helpers in that script):

| # | Helper | File | Rule | Failure message |
|---|---|---|---|---|
| G-A1 | `assertNotIncludes` | `mingla-business/src/services/eventOrdersService.ts` | `brand_id: string \| null` | "eventOrdersService must not declare an orders.brand_id field on the local OrderRow type" |
| G-A2 | `assertRegexAbsent` | `mingla-business/src/services/eventOrdersService.ts` | `/\.from\(["']orders["']\)[\s\S]{0,400}brand_id/` | "eventOrdersService must not select brand_id from the orders table" |
| G-A3 | `assertRegex` | `mingla-business/src/services/eventOrdersService.ts` | `/events!?inner?\s*\(\s*brand_id/` | "eventOrdersService must source brand_id transitively from events embed" |
| G-A4 | `assertNotIncludes` | `mingla-business/src/services/eventOrdersService.ts` | `order.brand_id ?? ""` | "eventOrdersService must map brandId from order.events.brand_id, not order.brand_id" |

These four rules together prove the SELECT shape on this file. They will fail before the fix is applied and pass after it. They also lock the file against the class of bug (any future contributor accidentally re-adding `orders.brand_id` to the SELECT).

The workflow job entry (§A.1, last row) is required so the gate actually runs in CI; the script being on disk without a workflow job is the current gap.

#### A.6 Jest Migration-Guards Extension (binding)

Append the following `describe` block to `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts`:

```ts
describe("ORCH-0777 organizer order visibility repair", () => {
  const ordersService = fs.readFileSync(
    path.resolve(__dirname, "../../services/eventOrdersService.ts"),
    "utf8",
  );

  it("does not select orders.brand_id (column does not exist on production)", () => {
    const fromOrdersBlock = ordersService.match(
      /\.from\(["']orders["']\)[\s\S]+?\.eq\(["']event_id["']/,
    );
    expect(fromOrdersBlock).not.toBeNull();
    expect(fromOrdersBlock?.[0] ?? "").not.toMatch(/\bbrand_id\b/);
  });

  it("does not declare orders.brand_id on the OrderRow interface", () => {
    expect(ordersService).not.toMatch(/brand_id:\s*string\s*\|\s*null/);
  });

  it("sources brandId transitively from events embed", () => {
    expect(ordersService).toMatch(/events!?inner?\s*\(\s*brand_id/);
    expect(ordersService).toMatch(/order\.events\?\.brand_id\s*\?\?\s*""/);
  });
});
```

Why both strict-grep and Jest: the strict-grep gate locks the regex shape in CI without needing any test harness; the Jest assertions also run inside the existing migration-guards suite (which the live-fire matrix already runs as part of the `ticketCheckoutMigrationGuards.test.ts` GREEN evidence). Two independent gates reduce regression risk to near-zero.

#### A.7 What Is Explicitly NOT Required For Fix A

- No change to `mingla-business/src/store/orderStore.ts` (`OrderRecord.brandId: string` stays).
- No change to `RefundSheet.tsx`, `app/o/[orderId].tsx`, or `app/event/[id]/guests/[guestId].tsx` — they consume `order.brandId` already and the embed preserves that contract.
- No change to React Query keys, stale time, or cache invalidation in `useEventOrders.ts`.
- No change to `useManagedEventRoute`, `useEventOrderRevenue`, `useEventOrderActivity`, `useEventSoldCounts`, or any other consumer hook — they all derive from the same `OrderRecord[]` and benefit transitively.
- No Supabase migration, no edge function deploy.

### Fix B. Failed-Terminal Notification Revival

Fix B has TWO discrete deliverables, both in this cycle. The follow-up CTA (B.3) is sketched but explicitly deferred to a separate ORCH.

#### B.1 State-Repair Runbook (binding, operator-authorized)

This runbook is a one-shot, privacy-safe, operator-authorized DML + re-invoke procedure that revives the seven free-window terminal rows enumerated by the investigation (and any peer rows discovered by the live read in step 1 below) without code changes.

**Step 1 — Enumerate the dead window (read-only).**

The implementor (or operator, under implementor authorization) MUST issue the following privacy-safe read via the Supabase Management API direct-SQL endpoint (per memory `reference_supabase_management_api.md`). The output is to be saved as the "candidate set" for the revival run; the result columns are id-only and counts-only, no PII.

```sql
SELECT
  id,
  order_id,
  channel,
  status,
  attempt_count,
  -- intentionally NO recipient, NO last_error body, NO provider_message_id
  created_at,
  updated_at
FROM public.ticket_order_notifications
WHERE status = 'failed_terminal'
  AND created_at >= '2026-05-11 02:55:00+00'
  AND created_at <  '2026-05-11 03:10:00+00'
ORDER BY created_at ASC;
```

Expected row count per investigation: approximately 7-8 rows across email+sms channels for orders `869bee74-...`, `c1d35ae6-...`, `16c6339e-...`, `f3393adc-...`, `2c25c503-...`, `8f31dfb4-...`, `e8958375-...` (plus any not enumerated in the investigation that fall in the same window). Live count is authoritative.

**Step 2 — Privacy-safe revival DML.**

For each row in the candidate set, the implementor (or operator) MUST issue the following one-shot UPDATE through the Management API direct-SQL endpoint. The WHERE clause MUST use the row `id` (PK) — do NOT use buyer email, buyer phone, or any other PII as predicate. The clause MUST include the explicit `status = 'failed_terminal'` re-check so a concurrently-updated row is not flipped.

```sql
UPDATE public.ticket_order_notifications
SET
  status        = 'failed_retryable',
  attempt_count = 0,
  last_error    = NULL,
  updated_at    = now()
WHERE id = '<notification_id>'
  AND status = 'failed_terminal'
  AND created_at >= '2026-05-11 02:55:00+00'
  AND created_at <  '2026-05-11 03:10:00+00';
```

Why `failed_retryable` (not `pending`): the dispatcher's existing WHERE clause at `supabase/functions/ticket-confirmation-dispatch/index.ts:119-123` (`.in("status", ["pending", "failed_retryable"])`) accepts both. `failed_retryable` is the more honest historical record — these rows DID fail once at provider level, were classified terminal during the dead window, and are now being re-armed for one more attempt now that the provider config is repaired. `attempt_count = 0` ensures the dispatcher's `terminal = !retryable || attemptCount >= 3` rule (line 169) does not immediately re-terminalize them on the next pass.

The UPDATE MUST NOT delete the row, MUST NOT create a new row, MUST NOT alter `order_id`, `channel`, `recipient`, `provider`, `provider_message_id`, or any unique-constraint field. The dispatcher's idempotency model assumes child-row identity is stable across attempts.

**Step 3 — Invoke the existing dispatcher (no deploy).**

For each affected `order_id` (deduplicated from step 1), the implementor (or operator) MUST issue one POST to the already-ACTIVE `ticket-confirmation-dispatch` v11 function using the service-role key in the Authorization header (the function's existing contract at lines 83-86). No new function, no new deploy.

```
POST https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/ticket-confirmation-dispatch
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json

{"orderId": "<order_id>"}
```

Expected per-order response shape (per `index.ts:186`): `{ orderId, outcomes: [{ channel, status: "sent" | "failed_retryable" | "failed_terminal" }] }`. Healthy revival → both child rows transition to `status='sent'` with `provider='resend'` / `provider='twilio'` and a non-null `provider_message_id`, no `last_error`.

**Step 4 — Verify with a privacy-safe read.**

After the dispatcher run completes for the full candidate set, re-issue the step-1 read but with `status IN ('sent', 'failed_terminal', 'failed_retryable')`. Expected: every row from the candidate set is now `status='sent'`. Any row still `failed_terminal` indicates a provider response not in the dead-window class (e.g., a real bounce post-repair) and requires a separate ad-hoc judgment by the operator — DO NOT loop the runbook on those rows automatically.

**Step 5 — Confirm no duplicate tickets/orders.**

For each affected `order_id`, the implementor MUST issue:

```sql
SELECT
  o.id                                              AS order_id,
  o.payment_status,
  o.notification_status                             AS rollup_status,
  COUNT(DISTINCT oli.id)                            AS line_item_count,
  COUNT(DISTINCT t.id)                              AS ticket_count,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status='valid') AS valid_ticket_count,
  COUNT(DISTINCT n.id) FILTER (WHERE n.channel='email') AS email_notification_count,
  COUNT(DISTINCT n.id) FILTER (WHERE n.channel='sms')   AS sms_notification_count
FROM public.orders o
LEFT JOIN public.order_line_items oli ON oli.order_id = o.id
LEFT JOIN public.tickets t            ON t.order_id   = o.id
LEFT JOIN public.ticket_order_notifications n ON n.order_id = o.id
WHERE o.id = '<order_id>'
GROUP BY o.id;
```

Expected for every operator free order: `line_item_count=1`, `ticket_count=1`, `valid_ticket_count=1`, `email_notification_count=1`, `sms_notification_count=1`. ANY value > 1 on the notification counts indicates the dispatcher created a duplicate child row — that is a regression and must be escalated to the orchestrator (it has not been observed in the existing live-fire matrix evidence, but the runbook MUST verify before claiming success).

#### B.2 Dispatcher Contract Clarification (no behavior change)

The investigation flagged that `_shared/ticketCheckout.ts:134-153` classifies HTTP 400/401/403 as `config` (non-retryable) and `index.ts:119-123` only polls `pending` / `failed_retryable`. Both rules are correct and remain unchanged by this spec. The runbook in B.1 deliberately re-arms rows via UPDATE rather than relaxing the classifier, because:

- The classifier is correct for the steady state: a Resend 403 `validation_error` from an unverified domain genuinely is a config failure, not a network blip; auto-retrying it would burn the provider quota.
- The runbook is a one-shot recovery for a known provider-config-repair window. It is operator-authorized, scoped to a 15-minute UTC window, and uses the row PK as the only buyer-identifying predicate — buyer PII is never read or written by the procedure.

If a future regression produces another dead window (e.g., a Resend key rotation), the same runbook applies. The dispatcher does NOT need new logic this cycle.

#### B.3 Deferred — Organizer "Resend Ticket" CTA (sketched, NOT delivered)

Per the prior SPEC §6.4, the long-term contract is an authenticated organizer "Resend ticket" CTA on the order-detail screen. This spec EXPLICITLY DEFERS that deliverable to a follow-up ORCH because:

- The CTA's safe idempotency contract requires either a new `ticket_order_notifications` row per resend (with a per-resend idempotency suffix on the `(order_id, channel, recipient)` unique constraint) OR a state-machine rule that flips an existing row back to `pending` only under organizer authorization. The decision between those two shapes is product-shaped, not narrowly engineering-shaped — it affects audit history, "resend count" UX, and the SPEC §6.4 audit-fields contract.
- The CTA also requires deciding the eligible-status predicate (resend on `failed_terminal` only? on `sent` too? for partial-success orders only?), the authorization boundary (brand team rank ≥ event_manager? account_owner only?), the success/failure UX (toast vs. inline-banner vs. confirmation screen branch), and the cool-down/rate-limit per order.
- None of those decisions are unblocking the operator's free-email gap today — the B.1 runbook delivers that recovery.

**Future CTA contract sketch (for the next ORCH dispatch, NOT this one):**

| Concern | Default proposal (subject to forensics SPEC in the follow-up ORCH) |
|---|---|
| Surface | New button on the organizer order-detail screen (`mingla-business/app/event/[id]/orders/[oid]/index.tsx`), gated behind brand-role rank ≥ `event_manager`. |
| Authorization | Server-side check inside a new edge function `ticket-confirmation-resend` or an extension of `ticket-confirmation-dispatch` that requires the caller's JWT to satisfy `biz_is_brand_member_for_read(event.brand_id, auth.uid())`. |
| Eligible statuses | Any order whose at-least-one child `ticket_order_notifications` row is `status IN ('failed_retryable', 'failed_terminal')`. Resend on `sent` is opt-in only and gated behind a confirmation modal. |
| Idempotency | Per-click resend writes a new `ticket_order_notifications` row keyed by `(order_id, channel, recipient, resend_attempt_seq)` where `resend_attempt_seq` increments per click. The existing unique constraint `(order_id, channel, recipient)` is replaced with `(order_id, channel, recipient, resend_attempt_seq)` in a new migration. |
| Audit | New columns `resend_attempt_seq integer not null default 0` on `ticket_order_notifications`, `resend_initiated_by uuid not null references auth.users(id)` on each per-click row, `resend_initiated_at timestamptz not null`. |
| Rate limit | Brand-team rate-limit of 3 manual resends per order per 24h. Returns HTTP 429 with a privacy-safe `retry_after_seconds`. |
| Rollup recompute | Replace the rollup recompute at `ticket-confirmation-dispatch/index.ts:181-184` with a query that reads ALL child rows for the order, not just touched ones, so the rollup is durable across multiple dispatcher invocations. |
| Provider failure handling | New errors are classified by the existing `classifyNotificationProviderFailure`; the CTA's UX surfaces "Couldn't resend. Try again in a moment." on `retryable=true` and "Sender configuration issue. Contact support." on `retryable=false`. |

This sketch is informational for the orchestrator. The implementor MUST NOT begin work on the CTA in this cycle — the orchestrator opens a follow-up ORCH for it after this cycle CLOSES.

#### B.4 What Is Explicitly NOT Required For Fix B

- No new edge function, no new migration, no edge function redeploy, no provider configuration mutation in this cycle.
- No change to `classifyNotificationProviderFailure` classification logic in `_shared/ticketCheckout.ts:134-153`.
- No change to the dispatcher's retry filter at `index.ts:119-123` or the terminal rule at line 169.
- No change to the rollup recompute at lines 181-184 (deferred to the follow-up ORCH along with the CTA).
- No buyer-side UI change to `mingla-business/app/checkout/[eventId]/confirm.tsx` (the unconditional "Sent to {email} and {phone}" copy is a separately tracked Cycle 8 polish item per the investigation observation; not this spec).

## 6. Success Criteria

### 6.A Fix A — Organizer Order Visibility

| # | Criterion | Observable evidence |
|---|---|---|
| SC-A1 | The mingla-business client SELECT against `public.orders` returns HTTP 200 for any event ID. | Tester opens organizer Orders for both leggothis events on a real device and observes the response in the React Query devtools / network panel (no HTTP 400, no `42703` PostgREST error). |
| SC-A2 | The Orders list for event `b1ab659e-...` ("A life in vegas") renders ≥ 8 rows (or the live count at retest time, whichever is greater). | Tester counts rendered `OrderListCard` instances on the screen and matches against a privacy-safe `SELECT COUNT(*) FROM public.orders WHERE event_id = 'b1ab659e-...'` taken at retest time. |
| SC-A3 | The Orders list for event `a3f71d85-...` ("The party block") renders ≥ 2 rows. | Same as SC-A2 with `event_id = 'a3f71d85-...'`. |
| SC-A4 | The Order detail screen for order `c1d35ae6-...` renders, shows the buyer name, total $0.00, payment method "Free", and the issued ticket QR. | Tester taps the row and verifies the detail screen renders without crash and shows the ticket carousel. (QR rendering is already proven by the live-fire matrix; this gate is about Order detail not regressing.) |
| SC-A5 | Revenue card, Sold-count badge, Guest list, and Activity feed on each event's main organizer screen show non-zero values consistent with the underlying rows. | Tester reads each surface and compares against the underlying counts derived from the same orders array. |
| SC-A6 | On simulated query failure (e.g., implementor swaps `event_id` for a fake non-UUID), the screen renders the new "Couldn't load orders" empty state, NOT "No orders yet". | Tester can verify this by passing a non-UUID `id` route param in a dev build OR by mocking the supabase client to throw. Optional — the primary regression-prevention path is the strict-grep + Jest gates. |
| SC-A7 | Strict-grep gate `orch-0777-ticket-checkout-production` runs in CI and contains assertions G-A1, G-A2, G-A3, G-A4 from §A.5. | Tester reads the workflow run log for the PR. |
| SC-A8 | Jest suite `ticketCheckoutMigrationGuards.test.ts` includes a `describe("ORCH-0777 organizer order visibility repair", …)` block with three assertions and the suite is GREEN. | Tester runs `npm run test -- ticketCheckoutMigrationGuards` from `mingla-business/` and reads the run output. |

### 6.B Fix B — Failed-Terminal Notification Revival

| # | Criterion | Observable evidence |
|---|---|---|
| SC-B1 | The state-repair runbook (B.1 steps 1-4) has been executed against the dead window. | Tester reads the implementation report's evidence section: the step-1 candidate-set count, the dispatcher response bodies (per order), and the step-4 verification result. Privacy-safe: only IDs, statuses, and counts are reproduced. |
| SC-B2 | Every notification row in the candidate set transitions from `status='failed_terminal'` to `status='sent'` after the dispatcher run, with `provider IN ('resend', 'twilio')` and a non-null `provider_message_id` and `sent_at`. | Tester re-issues the step-4 read and confirms the row-level state. Email-channel rows MUST be `sent`. SMS-channel rows MAY remain in a provider-callback chain (`sent` → `queued` → `undelivered ErrorCode 30032` per the live-fire matrix's toll-free verification in flight) — that is the carrier-verification gap already tracked outside ORCH-0777, not a Fix B regression. The Fix B gate is "Mingla-side ledger row reached `sent` at dispatch time," which is what the operator can act on. |
| SC-B3 | No duplicate `tickets`, `order_line_items`, or `ticket_order_notifications` rows were created for any order in the candidate set. | Tester re-issues the step-5 read for each affected `order_id` and confirms `line_item_count=1`, `ticket_count=1`, `valid_ticket_count=1`, `email_notification_count=1`, `sms_notification_count=1` for the operator orders (and the matching live-fire-row expected counts for the other six). |
| SC-B4 | The operator confirms receipt of the previously-stuck free-ticket email for their personal real-device order `c1d35ae6-...` ("A life in vegas"). | Tester captures the operator's verbal/text confirmation in the QA report. Privacy-safe: do NOT reproduce the email body, sender headers, or any user-identifying text — record only "operator confirmed receipt at <UTC time>". |
| SC-B5 | The `ticket-confirmation-dispatch` ACTIVE version is unchanged (still v11 or whatever is current at retest time) and `classifyNotificationProviderFailure` source is unchanged (no `git diff` against the touched files between the dispatch ACTIVE source and `main`). | Tester reads `mcp__supabase__list_edge_functions` and compares against `supabase/functions/_shared/ticketCheckout.ts` + `supabase/functions/ticket-confirmation-dispatch/index.ts` on the implementor's branch. |
| SC-B6 | No production migration was applied as part of Fix B. | Tester reads `supabase_migrations.schema_migrations` and confirms the four ORCH-0777 migrations (`20260515000013`, `20260515000015`, `20260515000016`, `20260515000017`) are the latest ORCH-0777 entries, with no `20260515000018+` entry tied to this spec. |
| SC-B7 | The deferred organizer "Resend ticket" CTA is filed as a follow-up ORCH in the orchestrator's queue. | Tester reads `Mingla_Artifacts/PRIORITY_BOARD.md` or `Mingla_Artifacts/AGENT_HANDOFFS.md` post-CLOSE and confirms the next-ORCH entry exists. (Process gate, not code gate.) |

## 7. Invariants

### 7.1 Invariants This Fix Must Preserve

| ID | Invariant | How preserved |
|---|---|---|
| Existing (SPEC §3.5) | Organizer surfaces read server orders/tickets, not local Zustand. | Fix A keeps the React Query / `fetchEventOrders` path; only the column list changes. |
| Existing (RLS chain `biz_can_read_order_for_caller`) | Brand-member or buyer-self can SELECT an order. | Fix A's `events!inner(brand_id)` embed sits inside the same RLS-gated query; the embed adds an INNER JOIN against `events` (already RLS-readable by the same brand-member) — no escalation. |
| Existing (idempotency, dispatcher) | Each `(order_id, channel, recipient)` notification row is unique and re-attempted in place. | Fix B revives existing rows in place — no new rows, no PK collision, no constraint violation. |
| Existing (`tickets.qr_token_hash` uniqueness) | One ticket → one QR token hash → one issued ticket. | Fix B does not touch `tickets` at all; dispatcher does not issue new tickets on re-attempt. |
| Existing (no PII in artifacts) | No raw buyer email, phone, secret, raw QR payload, or pepper in any spec/implementation/QA artifact. | Spec §3.3 enforced; B.1 read query intentionally omits `recipient`, `last_error` body, and `provider_message_id`. |
| I-PROPOSED-I (MUTATION-ROWCOUNT-VERIFIED) | Per-row UPDATE chains `.select` to verify row count in mingla-business services. | The B.1 UPDATE happens server-side via the Management API direct-SQL endpoint, not through the mingla-business client — strictly out of the I-PROPOSED-I scope. No client mutation is added by this spec. |
| Strict-grep registry pattern | One script + one workflow job per gate; never a parallel workflow file. | §A.1 + §A.5 extend the existing `orch-0777-ticket-checkout-production.mjs` script and (if absent) add ONE job entry to `strict-grep-mingla-business.yml`. No new workflow file. |

### 7.2 New Invariants This Fix Establishes

| ID | Invariant | Enforcement |
|---|---|---|
| I-ORCH-0777-ORDERS-SELECT-PARITY | The mingla-business `fetchEventOrders` SELECT column list MUST be a subset of the live `public.orders` column set, with `brand_id` sourced transitively via an `events` embed. | Strict-grep G-A1..G-A4 + Jest migration-guards `describe("ORCH-0777 organizer order visibility repair")`. |
| I-ORCH-0777-NOTIFICATION-REVIVAL-RUNBOOK | Failed-terminal `ticket_order_notifications` rows from a known provider-config-repair window MAY be revived by a one-shot, privacy-safe, operator-authorized UPDATE + dispatcher re-invoke procedure that uses row PK as the only buyer-identifying predicate and never reads or writes buyer PII. | Process invariant — documented here and in the implementor's report. No code gate (the runbook is a one-shot procedure, not a long-lived path). If a similar dead window recurs, the same runbook applies. |
| I-ORCH-0777-DUAL-CLOSE-GATE | ORCH-0777 CLOSE requires INDEPENDENT evidence for organizer-order-visibility AND notification-revival. A single combined verdict is non-conforming. | Spec §3.3 + §6 + the Manual Retest Gates split in §10. |

These three invariants land in the orchestrator's registry at CLOSE time (Step 5 of the META-ORCH-0755 close protocol). The spec does NOT write to `INVARIANT_REGISTRY.md` here — that is the orchestrator's job at CLOSE.

## 8. Test Cases

### 8.A Fix A Test Cases (automated regression + manual surface)

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-A1 | Strict-grep regression — `brand_id` in `from("orders")` select | Reintroduce `brand_id` to the SELECT in `eventOrdersService.ts` | CI strict-grep gate fails with assertion message G-A2 | Static / CI |
| T-A2 | Strict-grep regression — `brand_id` field on `OrderRow` | Add `brand_id: string \| null` back to the `OrderRow` interface | CI gate fails with G-A1 | Static / CI |
| T-A3 | Strict-grep regression — missing `events!inner(brand_id)` embed | Remove the embed | CI gate fails with G-A3 | Static / CI |
| T-A4 | Strict-grep regression — wrong mapper source | Map `brandId: order.brand_id ?? ""` instead of `order.events?.brand_id ?? ""` | CI gate fails with G-A4 | Static / CI |
| T-A5 | Jest migration guards GREEN | Run `ticketCheckoutMigrationGuards.test.ts` against the post-fix file | All three new assertions pass; pre-existing assertions remain GREEN | Jest |
| T-A6 | PostgREST integration sanity | Live read against production with the post-fix SELECT for `event_id='b1ab659e-...'` | HTTP 200; rows returned; each row has `events.brand_id` matching `22a18413-bfbf-4087-9ba7-45f70deba0f3` | Runtime / DB |
| T-A7 | UI render — non-empty Orders list | Operator real-device opens `/event/b1ab659e-.../orders` | Orders list renders ≥ 8 rows newest-first; "No orders yet" empty state NOT shown | UI / Mobile |
| T-A8 | UI render — Order detail | Operator taps order `c1d35ae6-...` | Detail screen renders without crash; buyer name, total $0.00, ticket QR shown | UI / Mobile |
| T-A9 | UI render — Revenue / Sold count / Guest list / Activity | Operator opens each surface on each event | All show non-zero values consistent with the underlying rows | UI / Mobile |
| T-A10 | UI error branch | Force `fetchEventOrders` to throw (dev-only path: stub supabase client, or pass non-UUID `id`) | "Couldn't load orders" empty state renders; "No orders yet" empty state NOT shown | UI / Mobile |

### 8.B Fix B Test Cases (state repair + ledger verification)

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-B1 | Candidate-set enumeration | Step-1 read query against production | Returns the dead-window rows; row count matches the live count at runbook time; no PII columns returned | DB read |
| T-B2 | Single-row revival idempotency | Re-run the B.1 step-2 UPDATE on a row that was already flipped to `failed_retryable` by a prior run | UPDATE affects 0 rows (the `AND status = 'failed_terminal'` predicate re-checks); no duplicate state-machine transition | DB write |
| T-B3 | Dispatcher re-invocation per order | POST `{"orderId": "<id>"}` to `ticket-confirmation-dispatch` after step-2 | Response 200 with `outcomes` array of `{ channel, status }`; both channels reach `status='sent'` on the happy path | Edge function |
| T-B4 | Post-revival ledger state | Step-4 read after the dispatcher run | Every candidate row is `status='sent'` (email) or `status='sent'` at dispatch time (sms) | DB read |
| T-B5 | No duplicate child rows | Step-5 read for each affected order | All counts are 1; no row was added or split | DB read |
| T-B6 | Operator email receipt | Operator inbox at `sethogieva@gmail.com` (privacy-safe: do not reproduce subject/body in artifact) | Operator confirms one ticket-confirmation email received from `tickets@usemingla.com` for order `c1d35ae6-...` | Manual / external |
| T-B7 | Twilio status callbacks (informational, not a fail gate) | SMS rows after revival | `provider_message_id` populated; `twilio_message_status_events` rows captured for each attempt; carrier final delivery gated on toll-free verification (external) | Edge function + DB |
| T-B8 | No production migration applied | Read `supabase_migrations.schema_migrations` | No `20260515000018+` entry attributed to this spec | DB read |
| T-B9 | No dispatcher source change | `git diff` `_shared/ticketCheckout.ts` and `ticket-confirmation-dispatch/index.ts` between implementor branch and `main` | No diff in the dispatcher classification or retry filter | Static |

## 9. Implementation Order (binding)

The implementor MUST work in this order. The order is chosen so each step's evidence is independently checkable before the next step begins, and so Fix A and Fix B do not interleave their evidence trails.

**Phase 1 — Fix A code + gates (single commit or single PR, no Fix B work):**

1. Edit `mingla-business/src/services/eventOrdersService.ts` per §A.2 + §A.3.
2. Edit `mingla-business/app/event/[id]/orders/index.tsx` per §A.4 (error-branch only; no other surface).
3. Append the four assertions to `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` per §A.5.
4. If absent, append the workflow job entry to `.github/workflows/strict-grep-mingla-business.yml` per §A.1.
5. Append the `describe("ORCH-0777 organizer order visibility repair", …)` block to `ticketCheckoutMigrationGuards.test.ts` per §A.6.
6. Run `npm run test` from `mingla-business/` locally and confirm GREEN. Run the strict-grep script locally (`node .github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`) and confirm exit 0.
7. Produce evidence rows for SC-A1 (privacy-safe Management API read for one event ID, expect HTTP 200 with rows) and stop. Do NOT touch any Fix B file.

**Phase 2 — Fix B state-repair runbook execution (separate evidence trail):**

8. Execute B.1 step 1 (candidate-set enumeration).
9. Execute B.1 step 2 (revival DML) for each row in the candidate set.
10. Execute B.1 step 3 (dispatcher re-invocation) for each affected order.
11. Execute B.1 step 4 (verification read).
12. Execute B.1 step 5 (no-duplicates read) for each affected order.
13. Produce evidence rows for SC-B1 through SC-B6 in the implementor report. Privacy-safe: IDs + statuses + counts only.

**Phase 3 — Report and handoff:**

14. Write the implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md` with TWO clearly separated sections (Fix A and Fix B), each with its own old→new receipts, file diffs, and evidence rows.
15. Return to the orchestrator with the report path. Do NOT mark CLOSE.

The implementor MUST NOT bundle Fix A and Fix B into a single commit or single evidence block. They are independent fixes on independent code/data paths and the orchestrator will route them through tester verification independently.

## 10. Manual Retest Gates (post-fix)

The downstream tester (Claude `mingla-tester`) MUST execute these gates in order. Each gate has its own PASS/FAIL row in the QA report and ORCH-0777 cannot CLOSE until both Gate A1-A10 AND Gate B1-B7 (independent) PASS.

### Gate A — Organizer Order Visibility (executed after Phase 1 evidence is in)

| # | Action | Expected |
|---|---|---|
| Gate A.1 | Pull the implementor branch, run `npm install`, run `npm run test -- ticketCheckoutMigrationGuards` in `mingla-business/`. | All assertions GREEN, including the new `describe("ORCH-0777 organizer order visibility repair")` block. |
| Gate A.2 | Run `node .github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` from the repo root. | Exit code 0; stdout "ORCH-0777 production checkout guard passed." |
| Gate A.3 | Inspect `.github/workflows/strict-grep-mingla-business.yml`. | A `jobs:` entry exists for the ORCH-0777 strict-grep script. |
| Gate A.4 | Issue a privacy-safe read via Supabase Management API: `SELECT id, brand_id FROM public.events WHERE id = 'b1ab659e-358d-41f3-a56d-76f7b273bddd'`. | Returns one row with `brand_id = '22a18413-bfbf-4087-9ba7-45f70deba0f3'`. (Confirms the embed source is valid.) |
| Gate A.5 | Issue the exact post-fix PostgREST request shape against production for `event_id='b1ab659e-...'` (using the operator's anon JWT or the tester's authenticated leggothis JWT). | HTTP 200; ≥ 8 rows; each row has `events.brand_id` populated. |
| Gate A.6 | iOS Simulator (or operator real device): open the leggothis brand → "A life in vegas" event → Orders. | Orders list renders ≥ 8 rows newest-first. |
| Gate A.7 | Same surface: tap order `c1d35ae6-...`. | Order detail renders; buyer name, $0.00 total, payment method "Free", and the issued ticket QR are visible. |
| Gate A.8 | Same event: check Revenue card, Sold-count badge, Guest list, and Activity feed. | All show non-zero values consistent with the rendered Orders list. |
| Gate A.9 | Repeat Gates A.6 and A.8 for event `a3f71d85-...` ("The party block"). | Orders list ≥ 2 rows; revenue ≥ $50; sold count ≥ 1; guest list ≥ 1; activity ≥ 1 purchase entry. |
| Gate A.10 | Android Emulator: repeat Gates A.6 and A.9 to confirm platform parity. | Same evidence as iOS. |

If any Gate A.X fails, route back to Codex `implementor-mingla` with the failing gate cited. Do NOT proceed to Gate B until Gate A is fully GREEN — this is what "do not collapse" means in practice.

### Gate B — Failed-Terminal Notification Revival (executed after Phase 2 evidence is in, independent of Gate A)

| # | Action | Expected |
|---|---|---|
| Gate B.1 | Read the implementation report's Phase 2 evidence section. | Step-1 candidate set (IDs only), step-3 dispatcher response bodies (per order), step-4 ledger state read (IDs + statuses only) are all present. No PII in any row. |
| Gate B.2 | Re-issue the step-4 read independently. | Every candidate row is `status='sent'` (email channel mandatory; sms channel sent at dispatch time, downstream Twilio toll-free verification gap separately tracked). |
| Gate B.3 | For each affected `order_id`, re-issue the step-5 no-duplicates read. | All counts = 1; no duplicate rows; `payment_status='paid'`; `notification_status` rollup reflects the new state. (Note: the rollup recompute fix is deferred to a follow-up ORCH; the rollup MAY still read stale on the parent row. This is informational, not a Gate B fail.) |
| Gate B.4 | Confirm with the operator that the previously-stuck free-ticket email for order `c1d35ae6-...` ("A life in vegas") has arrived in the operator's inbox. | Operator verbal/text confirmation captured as "operator confirmed receipt at <UTC time>" in the QA report. No email body, headers, or attachments reproduced. |
| Gate B.5 | Read `mcp__supabase__list_edge_functions`. | `ticket-confirmation-dispatch` ACTIVE version is the same as on `main` immediately before Phase 2 (no deploy). |
| Gate B.6 | Read `supabase_migrations.schema_migrations`. | No `20260515000018+` entry attributed to this spec. |
| Gate B.7 | Read `Mingla_Artifacts/PRIORITY_BOARD.md` (post-CLOSE) or the orchestrator's handoff notes. | A follow-up ORCH entry exists for the deferred organizer "Resend ticket" CTA (per §B.3). (Process gate; tester confirms entry exists, orchestrator owns its content.) |

If any Gate B.X fails (other than B.7, which is a process gate the orchestrator owns), route back to Codex `implementor-mingla` with the failing gate cited. Do NOT collapse a Gate B fail into a Gate A pass.

## 11. Regression Prevention

| Class | Prevention | Owner |
|---|---|---|
| Schema-drift in client SELECTs against `orders` | Strict-grep G-A1..G-A4 + Jest migration-guards assertions. Future drift on `orders.brand_id` is caught at PR time before reaching production. | CI |
| Same class on other client SELECTs against production tables | Out of scope for this spec but logged as discovery for orchestrator: consider extending the strict-grep to also check `from("events")`, `from("tickets")`, `from("ticket_types")` SELECTs. Filed as a follow-up META-ORCH process item. | Orchestrator (post-CLOSE) |
| Future provider-config dead window producing more `failed_terminal` rows | The B.1 runbook is reusable as-is. Codified as I-ORCH-0777-NOTIFICATION-REVIVAL-RUNBOOK. | Orchestrator (process invariant) |
| Confusion between "dispatcher sent successfully" and "carrier delivered" | The QA gate B.2 explicitly distinguishes Mingla-side `status='sent'` from downstream carrier delivery. The follow-up ORCH that lands the resend CTA also lands the rollup recompute. | Follow-up ORCH |
| Live-fire matrix claiming "Organizer Orders truth within 15s" as PASS while the client SELECT is broken | The investigation flagged this as misleading. Process change: future live-fire matrices for organizer surfaces MUST include the mingla-business client path (a Deno test that runs the exact PostgREST request the client would send with an authenticated anon JWT, OR a screenshot of the rendered surface). Filed as a follow-up META-ORCH process item. | Orchestrator (post-CLOSE) |

## 12. Hard Guards Compliance (self-attestation)

- This spec edits no product code, runs no migration, deploys no edge function, mutates no provider state, and reads no PII in any quoted query, code block, or evidence row.
- All buyer-identifying values are referenced only via stable opaque IDs (order IDs, event IDs, brand IDs) already cited in prior ORCH-0777 artifacts.
- Fix A and Fix B are separated at every layer: scope (§3.1), success criteria (§6.A vs §6.B), test cases (§8.A vs §8.B), implementation phases (§9 Phase 1 vs Phase 2), and retest gates (§10 Gate A vs Gate B). The CLOSE gate (§3.3) is dual.
- No collapse is permissible at any stage. A single combined "checkout works" verdict from implementor, tester, or orchestrator is non-conforming.

## 13. Downstream Implementor Prompt Outline

The orchestrator (Codex `orchestrator-mingla`) will produce the canonical dispatch text. The expected shape:

```
Target: Codex implementor-mingla
Goal: Implement Fix A and Fix B per SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md.
Inputs:
  - Mingla_Artifacts/specs/SPEC_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md (this spec)
  - Mingla_Artifacts/reports/INVESTIGATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_FREE_EMAIL_FAILURE.md
  - mingla-business/src/services/eventOrdersService.ts (file under repair for Fix A)
  - .github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs (file under extension for Fix A)
  - .github/workflows/strict-grep-mingla-business.yml (ensure ORCH-0777 job entry exists)
  - mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts (file under extension for Fix A)
  - supabase/functions/ticket-confirmation-dispatch/index.ts (READ-ONLY for Fix B — no edit)
  - supabase/functions/_shared/ticketCheckout.ts (READ-ONLY for Fix B — no edit)
Hard guards:
  - SPEC compliance: do not implement out-of-scope code; specifically, do NOT build the organizer "Resend ticket" CTA in this cycle.
  - No supabase db push; no edge function deploy; no provider configuration mutation.
  - No new migration; no source edit to ticket-confirmation-dispatch or _shared/ticketCheckout.
  - No PII in artifacts; the B.1 read query template intentionally omits recipient/last_error/provider_message_id and MUST be used verbatim.
  - Phase 1 (Fix A) and Phase 2 (Fix B) commits and evidence trails MUST be separated.
Expected output: Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md
  - Section 1: Fix A old→new diff for each touched file, plus SC-A1..SC-A8 evidence rows.
  - Section 2: Fix B B.1 step-1..step-5 evidence rows, plus SC-B1..SC-B6 confirmation.
  - Section 3: Hard-guard self-attestation.
Downstream routing: Claude mingla-forensics → mingla-tester (per 2026-05-10 reversal) executes Manual Retest Gates §10 Gate A and Gate B independently. After dual PASS, Codex orchestrator-mingla CLOSE.
```

## 14. Discoveries for Orchestrator (process items, not in this implementor's scope)

- File a follow-up ORCH for the organizer "Resend ticket" CTA per the §B.3 contract sketch, including the rollup recompute fix (`ticket-confirmation-dispatch/index.ts:181-184`).
- File a META-ORCH process item to extend the strict-grep registry to other production-table client SELECTs (`from("events")`, `from("tickets")`, `from("ticket_types")`) and to require live-PostgREST-shape evidence in future live-fire matrices for organizer surfaces.
- File a Cycle 8 polish ORCH for the confirmation-screen unconditional "Sent to {email} and {phone}" copy in `mingla-business/app/checkout/[eventId]/confirm.tsx:203-205` to branch on `notificationStatus !== "queued" / "sent"`.
- Note: the live-fire matrix's "Organizer Orders truth within 15s" PASS row is technically true at the DB layer but did NOT exercise the mingla-business client SELECT path. The fix here closes that gap; the orchestrator may consider amending the matrix retroactively in CLOSE notes.

## 15. Confidence

- **Fix A:** HIGH. Root cause is six-field proven; the column-list change is mechanical; consumer audit is complete (three callers, all preserved by the embed); strict-grep + Jest gates lock the regression class.
- **Fix B:** HIGH on the runbook (privacy-safe, idempotent, uses existing dispatcher); MEDIUM on the long-term contract because the CTA's product shape (audit columns, rate limits, eligible-status rules) is intentionally deferred to a follow-up ORCH and could land differently than the §B.3 sketch.

End of spec.

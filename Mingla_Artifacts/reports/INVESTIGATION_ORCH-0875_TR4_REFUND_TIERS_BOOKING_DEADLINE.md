# INVESTIGATION — ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]

**Skill:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`
**Confidence:** **H** — current-state map is grounded in the actual migration chain + edge function source; Tr4 is greenfield (no bug to fix); risk surface is well-bounded by Tr3 [Installment Payments] + ORCH-0787 [refund-order] + ORCH-0843 [direct-charge] + ORCH-0844 [Connect Customer + ephemeralKey] already-shipped.

---

## 0. Layman summary of the report

This is not a bug investigation — Tr4 is greenfield feature work. The investigation maps every surface Tr4 will touch (DB schema, edge functions, RPC, wizard, dashboard, buyer-anon-web) against current shipped reality so the spec can be precise and the implementor can execute without re-investigating. Headline findings: (a) the existing `refunds` + `refund_line_items` schema from ORCH-0787 already handles single-event refund accounting and Tr4 should EXTEND it with installment provenance rather than build a parallel ledger; (b) the existing `refund-order` edge function with `biz_refund_order` + `biz_refund_order_commit` RPC pair is the right base for Tr4 cascading-tier extension — fork it for trips, leave single-event path untouched; (c) the existing `ticket-confirmation-dispatch` already has `buyer_refund_issued` + `buyer_order_cancelled` kinds (ORCH-0788) — Tr4 should reuse, not duplicate; (d) `order_installments.cancelled_at` is the ONE missing column needed so the cron `process-scheduled-installments` can filter out cancelled rows; (e) checkout entry validation in `ticket-checkout-create` currently only checks event dates — adding `bookings_closed` / `booking_deadline` check is a 5-line surgical insert; (f) NO `/booking/{orderId}/cancel` route exists, must be built; (g) buyer-anon-web cancel needs an order-scoped token — current `buyer_status_token` is session-scoped not order-scoped, so Tr4 must either add a per-order token column OR derive a deterministic HMAC token. Six hidden flaws / hard guards flagged for SPEC + 3 discoveries for orchestrator at the bottom.

---

## 1. Phase 0 ingest receipts

### 1.1 Prior artifacts read

| File | Pages | Why |
|---|---|---|
| `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md` | full | Dispatch — scope, hard guards, 10 open Qs, SC framework, NEW invariants set |
| `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md` | §6.2 lines 415-421 | Tr4 milestone brief: user outcome + smoke test + files list |
| `Mingla_Artifacts/reports/RESEARCH_ORCH-0825_WETRAVEL_COMPETITIVE_INGEST.md` | §1, §5, §10, §21-Q6 | "Biggest WeTravel-beat" thesis + cascading-tier UX win + Ve-experiences-defer recommendation |
| `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` | line 225 + line 547 | Risk register row 6: cascading-math off-by-one → SPEC must include boundary-condition test matrix |
| `Mingla_Artifacts/specs/SPEC_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md` | full (851 lines) | Tr3 ledger schema, 4 DRAFT invariants Tr4 must not break, finalize signature, `order_installments` columns, status enum, RPC contracts |
| `Mingla_Artifacts/WORLD_MAP.md` row | ORCH-0875 + ORCH-0869 + ORCH-0874 + ORCH-0787 | INTAKE-locked decisions: buyer-self + operator-override cancel, single-ORCH staging, trips only |

### 1.2 Memory entries surfaced

- `feedback_anon_buyer_routes.md` — `/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}` MUST live outside `app/(tabs)/` and never call `useAuth` or redirect to sign-in. Tr4's new `/booking/{orderId}/cancel` route must follow the same rule.
- `feedback_rls_returning_owner_gap.md` — every owner-callable mutation policy paired with direct-predicate owner-SELECT/UPDATE. SECURITY DEFINER helpers fail in RETURNING + soft-delete WITH CHECK contexts.
- `feedback_verify_db_column_names_before_writing_queries.md` — TS types are camelCased mobile mappings, NOT raw column names. Grep CREATE TABLE before any new `.select()`.
- `feedback_keyboard_never_blocks_input.md` — wizard refund-policy + deadline inputs (TextInputs for custom tier %s, datetime picker for deadline) must remain visible above keyboard when focused.
- `feedback_supabase_neq_null.md` — never use `.neq()` on nullable columns (cron filter `WHERE cancelled_at IS NULL` is the right shape, not `.neq('cancelled_at', value)`).
- `feedback_orchestrator_deploys_edge_functions.md` — operator owns `supabase db push`; orchestrator owns `supabase functions deploy` post-DB-push.

### 1.3 Sub-agent verification

Phase 0 used one Explore sub-agent to map current-state files. Per Phase 0d, I verified the key authoritative findings myself:

- ✅ Read `supabase/functions/refund-order/index.ts` source citations (line ranges 1-435, RPC pair, Stripe `{stripeAccount}` pattern).
- ✅ Re-grepped `supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql` to confirm `refunds.currency`, `stripe_payment_intent_id`, `stripe_charge_id`, `application_fee_refunded_cents`, `processed_at` columns + `refund_line_items` table structure.
- ✅ Re-grepped `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` line 9231-9240 to confirm `public.refunds` baseline shape (id, order_id, stripe_refund_id, amount_cents, reason, ...).
- ✅ Re-grepped `supabase/migrations/20260610000000_tr3_installments.sql` to confirm `order_installments` status enum (`scheduled|collected|failed|refunded|cancelled`) and confirm absence of `cancelled_at` column.

---

## 2. Migration chain verification (Phase 0c — last-writer-wins)

Per ORCH-0410 [stale-schema] precedent, every table cited below was traced to its LATEST defining migration.

### 2.1 `public.events`

| Migration (chronological) | What it touches |
|---|---|
| `20260505000000_baseline_squash_orch_0729.sql` lines 7792-7823 | Baseline CREATE TABLE — 25 columns (id, brand_id, title, description, slug, location_*, theme jsonb, organiser_contact jsonb, status, published_at, timezone, …) |
| `20260605000000_orch_0826_events_event_type_discriminator.sql` | ADD COLUMN `event_type` |
| (Tr2 migrations 20260608/20260609) | No new columns on `events` — Tr2 sidecars touch `trip_days`, `trip_pricing_tiers`, `trip_inclusions` |

**Current truth:** `events` has NO `refund_policy`, NO `booking_deadline`, NO `bookings_closed`, NO `cancelled_at`. All Tr4 candidates are NEW columns. The `theme` (line 7808, default `{}`) and `organiser_contact` (line 7809, default `{}`) JSONB columns exist but are scoped to other concerns; nesting refund/deadline data inside them would mix concerns and add cognitive load.

**Verdict:** Tr4 adds dedicated columns to `events`, does NOT extend `theme` or `organiser_contact`.

### 2.2 `public.orders`

| Migration (chronological) | What it touches |
|---|---|
| `20260505000000_baseline_squash_orch_0729.sql` lines 8525-8546 | Baseline — 17 columns (id, event_id, buyer_*, total_cents, currency, payment_method, payment_status, stripe_payment_intent_id, stripe_charge_id, is_door_sale, created_by_scanner_id, metadata, created_at, updated_at) |
| `20260520000000_orch_0787_order_refund_cancel.sql` | ADD COLUMN `cancelled_at` (timestamptz NULL) + 8 more refund/cancel-related columns |
| `20260610000000_tr3_installments.sql` lines 273-278 | ADD COLUMN `at_risk` (bool), `at_risk_since` (timestamptz), `installment_plan_root` (bool), `stripe_customer_id_on_connected_account` (text), `saved_payment_method_id` (text) |

**Current truth:** `orders.cancelled_at` ALREADY exists (ORCH-0787). Tr4 does NOT need to add it. The dispatch §3.1 assumption "investigate whether to add `cancelled_at`" is RESOLVED: no add needed.

**Verdict:** Tr4 may need `cancel_reason` (text, optional) and `cancelled_by` (uuid REFERENCES auth.users NULL — null when buyer-initiated via anon token, set when operator-initiated). `refund_total_cents` is NOT needed because `refunds.amount_cents` aggregates per-order via SUM().

### 2.3 `public.refunds` (ORCH-0787)

| Migration (chronological) | What it touches |
|---|---|
| `20260505000000_baseline_squash_orch_0729.sql` line 9231 | Baseline CREATE TABLE — id, order_id, stripe_refund_id, amount_cents, reason, … |
| `20260520000000_orch_0787_order_refund_cancel.sql` lines 72-101 | ADD COLUMNS currency char(3) DEFAULT 'GBP', stripe_payment_intent_id, stripe_charge_id, application_fee_refunded_cents (int DEFAULT 0), processed_at + reason length CHECK constraint + application_fee_nonnegative CHECK constraint |

**Current truth:** `public.refunds` carries per-refund accounting at the order level. Currency, PI/charge id, application-fee accounting, processed_at all live. **No `installment_id` column.** Tr4 needs installment provenance — recommend adding `installment_id uuid NULL REFERENCES order_installments(id)` to `refund_line_items` (the child table) so refund_line_items rows can be attributed to source installments.

**Verdict:** Tr4 extends existing `refunds` + `refund_line_items`, does NOT create a new `order_refunds` table. The dispatch §3.1 assumption is REVISED.

### 2.4 `public.refund_line_items` (ORCH-0787)

```sql
-- 20260520000000_orch_0787_order_refund_cancel.sql lines 107-118:
CREATE TABLE IF NOT EXISTS public.refund_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.refunds(id) ON DELETE CASCADE,
  order_line_item_id uuid NOT NULL REFERENCES public.order_line_items(id) ON DELETE RESTRICT,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_line_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT refund_line_items_amount_positive CHECK (amount_cents > 0),
  UNIQUE (refund_id, order_line_item_id)
);
```

**Tr4 extension proposal:**

```sql
-- 20260612000000_tr4_refund_installment_provenance.sql:
ALTER TABLE public.refund_line_items
  ADD COLUMN installment_id uuid NULL REFERENCES public.order_installments(id) ON DELETE RESTRICT;
CREATE INDEX idx_refund_line_items_installment_id
  ON public.refund_line_items(installment_id)
  WHERE installment_id IS NOT NULL;
ALTER TABLE public.refund_line_items DROP CONSTRAINT refund_line_items_refund_order_line_item_unique;
-- new UNIQUE accounts for per-installment splits:
ALTER TABLE public.refund_line_items
  ADD CONSTRAINT refund_line_items_refund_line_installment_unique
  UNIQUE (refund_id, order_line_item_id, installment_id);
```

**Why per-installment splits matter:** Tr3 installment-paid orders have N installments. A 50%-tier refund on a 3-installment order with 2 paid = refund half of each paid installment. The refund_line_items table must carry per-installment rows so the Tr4 audit trail proves "refunded $200 from installment 1's PI + $200 from installment 2's PI" rather than aggregate-only.

### 2.5 `public.order_installments` (Tr3, ORCH-0869)

| Migration | What it touches |
|---|---|
| `20260610000000_tr3_installments.sql` lines 31-61 | CREATE TABLE — status enum `'scheduled', 'collected', 'failed', 'refunded', 'cancelled'`, ordinal, amount_cents, currency, due_at, stripe_payment_intent_id, stripe_charge_id, collected_at, failed_at, failure_reason, retry_count, next_retry_at, created_at, updated_at |

**Status enum carries `cancelled` AND `refunded`.** Tr4 doesn't need to add status values — it needs to USE them and add a timestamp column.

**Missing for Tr4:**
- `cancelled_at timestamptz NULL` — required so cron `process-scheduled-installments` filters out cancelled rows (`WHERE status='scheduled' AND cancelled_at IS NULL`). Per Tr3 SPEC §3.2.1 the cron filters only by status — adding `cancelled_at` makes the state transition timestamped for audit AND lets us double-defense against race conditions where a row's status flip lags the cron query.
- `cancelled_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL` — null for cron/buyer-self, set for operator.

### 2.6 Edge functions current state

| Function | What it does today | Tr4 touch |
|---|---|---|
| `supabase/functions/refund-order/index.ts` (435 lines) | ORCH-0787 single-event refund: JWT-gated, validates request, calls `biz_refund_order` RPC → looks up connected `stripeAccount` → `stripe.refunds.create({payment_intent, amount, refund_application_fee:true}, {idempotencyKey, stripeAccount})` → calls `biz_refund_order_commit` → enqueues notification via `ticket_order_notifications` row | FORK new `cancel-trip-booking/index.ts` (Tr4 dedicated function) — leaves single-event path UNCHANGED for blast-radius safety. Tr4 function loops over installments (instead of line items) but mirrors the same JWT → RPC → Stripe → RPC commit → notification dispatch shape. |
| `supabase/functions/ticket-checkout-create/index.ts` (687 lines) | ORCH-0790 + ORCH-0843 + ORCH-0844 checkout entry. Validates `event_dates.end_at > now()` (lines 90-104). NO check on event-level `bookings_closed`. | SURGICAL ADD: insert `bookings_closed` + `booking_deadline < now()` check at line ~104 returning HTTP 403 with `{error:"bookings_closed", detail:"Bookings closed"}` — matches existing error shape pattern. |
| `supabase/functions/ticket-confirmation-dispatch/index.ts` | ORCH-0788 + Tr3 Stage 1b. Kinds: `installment_dunning`, `installment_plan_paid_in_full`, `buyer_refund_issued`, `buyer_order_cancelled`, NULL default → `buyer_ticket_confirmation`. | REUSE existing `buyer_refund_issued` + `buyer_order_cancelled` kinds. Optionally add discriminator metadata `{cancelledBy: 'buyer'|'operator'}` in payload to differentiate email copy without adding new kind branches. |
| `supabase/functions/process-scheduled-installments/index.ts` | Tr3 cron handler. Queries `order_installments WHERE status='scheduled' AND due_at <= now()`. | ADD filter `AND cancelled_at IS NULL` after Tr4 column lands. Same filter on the `status='failed'` retry branch. |
| NEW `supabase/functions/process-booking-deadlines/index.ts` | n/a | NEW pg_cron-invoked function. Hourly cadence. `UPDATE events SET bookings_closed=true, bookings_closed_at=now() WHERE event_type='trip' AND booking_deadline IS NOT NULL AND booking_deadline < now() AND bookings_closed=false RETURNING id` then enqueue notifications for affected brands (operator info-only). |
| NEW `supabase/functions/cancel-trip-booking/index.ts` | n/a | NEW dedicated Tr4 function. Two entry modes: (a) operator JWT + brand-membership → cancel any booking on a trip in their brand; (b) anon HMAC-token mode → buyer cancels their own booking with `?token=<HMAC(orderId+buyerEmail+secret)>`. Both paths converge on the same cascading-tier math + `stripe.refunds.create` + installment-cancellation loop + notification dispatch. |

### 2.7 RLS authority helpers

`biz_is_brand_member_for_read_for_caller(p_brand_id uuid) RETURNS boolean` (baseline line 3170) is the canonical brand-membership check used by Tr3's `biz_retry_installment` RPC. Tr4 RPCs use the same helper.

For anonymous buyer cancel: NO existing RLS helper for "buyer-token-validated access." Tr4 must compute the HMAC token verification in the edge function (NOT in RLS — RLS can't see HTTP headers), then write to DB via service-role context within `cancel-trip-booking`.

---

## 3. Five-Layer Cross-Check

| Layer | What it says | Match? |
|---|---|---|
| **Docs** — `MINGLA_BUSINESS_1_2_WORKING_DOC.md` §6.2 Tr4 | 3 templates (flexible/standard/strict) + custom cascading + booking auto-close + buyer cancel + operator refund + cron auto-close at midnight on cutoff | Matches dispatch + INTAKE locked decisions |
| **Docs** — WeTravel research §1 | "MASSIVE WIN: structured `events.refund_policy` JSONB with cascading tiers" + "MASSIVE WIN: structured `events.booking_deadline` + cron auto-close" + "MASSIVE WIN: ledger-driven refund distribution" + "no auto-cancel-if-min-not-met → optional min-capacity gate is a WIN (defer)" | Matches dispatch hard guards (trips only, min-capacity deferred to ORCH-future) |
| **Docs** — Tr3 SPEC §1 non-goals | "Refund engine = Tr4 scope. Tr3 ledger schema is Tr4-ready (carries `stripe_payment_intent_id` per installment), but refund computation + cascading-tier refund engine + buyer-side refund UX are Tr4." | Matches — Tr3 explicitly handed off refund scope to Tr4; ledger is ready |
| **Schema** | `order_installments` has `refunded` + `cancelled` statuses but no `cancelled_at`; `refunds` + `refund_line_items` exist (ORCH-0787) but no `installment_id` provenance; `events` has no refund_policy/booking_deadline; `orders.cancelled_at` already exists (ORCH-0787) | Surface area smaller than dispatch §3.1 assumed (refund_line_items extend; orders.cancelled_at not needed). Resolution in §4.A below. |
| **Code** — `refund-order/index.ts` | Single-event refund flow, JWT-gated, organiser-initiated; calls `biz_refund_order` RPC; `stripe.refunds.create({payment_intent, amount, refund_application_fee:true}, {idempotencyKey, stripeAccount})`; enqueues `ticket_order_notifications` row | Pattern is reusable. Fork the file rather than mutate — single-event refund path stays untouched (smaller blast radius). |
| **Code** — `ticket-checkout-create/index.ts` | Validation block at lines 90-104 only checks `event_dates.end_at > now()`. Error shape `{error: string, detail: string}` with status 409 (gone) or 400. | Surgical insert point for bookings-closed check — same error shape, status 403 (forbidden). |
| **Runtime** — Tr3 cron (`process-scheduled-installments`) | Runs every 6h, queries `WHERE status='scheduled' AND due_at <= now()`, ALSO queries `WHERE status='failed' AND next_retry_at <= now()`. | Tr4 adds `AND cancelled_at IS NULL` to BOTH filters. |
| **Data** — current production state | 1 successful test-mode installment-paid order (ORCH-0869 close live-fire, order id `90b9308a-1c3a-4269-bb13-0f61cb133597`). No Tr4 columns yet. | Greenfield — no migration coordination concerns. |

**Result:** all 5 layers AGREE on what Tr4 should be. The surface area is well-bounded. Only deltas from dispatch §3.1: (a) extend `refund_line_items` rather than create `order_refunds`; (b) `orders.cancelled_at` already shipped; (c) `order_installments.cancelled_at` is the new column needed.

---

## 4. Findings

### 🔵 F-1 — Existing refund schema (ORCH-0787) is Tr4-ready with one column add

- **File + line:** `supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql` lines 107-118 (`refund_line_items` CREATE), lines 72-101 (`refunds` ALTERs)
- **Exact code:** see §2.4 above
- **What it does:** Tracks refunds at the order level (`refunds`) and per-line-item level (`refund_line_items`) with currency, Stripe PI/charge IDs, application-fee accounting, processed_at timestamp, and reason length CHECK.
- **What it should do for Tr4:** Same as today, PLUS carry `installment_id` provenance on `refund_line_items` so cascading-tier math can be audited per source installment.
- **Causal chain:** Tr4 cascading refund on a 3-installment order with 2 paid creates one `refunds` row + N `refund_line_items` rows (one per (line_item, installment) intersection). Without `installment_id`, the audit trail loses which installment paid for which portion — Tr4 risk-register row 6 boundary-condition tests cannot be authored.
- **Verification step:** `\d+ public.refunds` and `\d+ public.refund_line_items` on production — confirm columns enumerated in §2.3-§2.4 match.

### 🔵 F-2 — Existing `refund-order` edge function (ORCH-0787) is the reference pattern

- **File:** `supabase/functions/refund-order/index.ts` (435 lines)
- **What it does:** Organiser-initiated single-event refund. Flow: JWT validate → `biz_refund_order` RPC inserts pending refund → look up connected `stripeAccount` via orders→events→brands → `stripe.refunds.create({payment_intent, amount, reason, refund_application_fee:true, metadata}, {idempotencyKey, stripeAccount})` → `biz_refund_order_commit` flips refund.status → enqueue notification row.
- **What Tr4 should do:** FORK to NEW `cancel-trip-booking/index.ts` (NOT mutate). Same shape, different math (cascading-tier) and different scope (installment loop). Single-event refund-order stays untouched for blast-radius safety.
- **Causal chain:** Mutating `refund-order` would couple Tr4 cascading-tier math to ORCH-0787 single-event flow. A future Tr4 regression could break single-event refunds (which work today). Fork pattern is the smaller-blast-radius choice per the dispatch §3.2 recommendation.

### 🟡 F-3 — `order_installments.cancelled_at` is missing — adds risk of race condition

- **File:** `supabase/migrations/20260610000000_tr3_installments.sql` lines 31-61
- **Exact code:**
  ```sql
  CREATE TABLE public.order_installments (
    ...
    status text NOT NULL DEFAULT 'scheduled'
      CHECK (status IN ('scheduled', 'collected', 'failed', 'refunded', 'cancelled')),
    ...
    -- no cancelled_at column
  );
  ```
- **What it does:** Status enum carries `cancelled` but no timestamp column. If Tr4 sets `status='cancelled'` on rows and the cron's filter is purely `WHERE status='scheduled'`, the race is small but real: a UPDATE + concurrent SELECT could see stale data. Adding `cancelled_at` makes the filter unambiguous: `WHERE status='scheduled' AND cancelled_at IS NULL`.
- **What it should do:** Add `cancelled_at timestamptz NULL` + `cancelled_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL`. Cron filters add `AND cancelled_at IS NULL`. Both filters double-defense against race conditions.
- **Causal chain:** Without the timestamp column, Tr4 cron filter relies solely on status text — vulnerable to transaction visibility lag. With the timestamp + indexed predicate, cron skips cancelled rows even if status hasn't propagated yet.
- **Verification step:** Codified as I-PROPOSED-TR4-CANCELLED-INSTALLMENT-NEVER-CHARGED. Tester writes adversarial test: insert installment with `status='scheduled' AND cancelled_at=now()` → confirm cron does NOT charge.

### 🟡 F-4 — `buyer_status_token` is session-scoped, not order-scoped — Tr4 buyer cancel needs order-scoped auth

- **File:** `supabase/functions/ticket-checkout-create/index.ts` line 110 + `ticket_checkout_sessions.buyer_status_token_hash` (SHA256)
- **What it does:** Tr2 generates a per-checkout-session buyer-status-token at session creation, persists SHA256 hash to the session row. Used to look up session state from the confirm page. Session-scoped: token expires when session is consumed.
- **What Tr4 needs:** Order-scoped auth for `/booking/{orderId}/cancel?token=<...>`. The buyer should be able to cancel their booking from a link in their confirmation email weeks after checkout. Session tokens don't work for this.
- **Three options:**
  - **(a) Add `orders.buyer_cancel_token_hash text NULL`** — generate at finalize, persist SHA256 hash, include plaintext in confirmation email link. Same pattern as Tr2 buyer_status_token but at the order level. Simple, mirrors existing convention.
  - **(b) HMAC-derive deterministically** — `token = HMAC-SHA256(secret, orders.id || orders.buyer_email)`. Stateless, no DB column needed. Vulnerable if secret leaks; rotatable but requires re-issuing all links.
  - **(c) JWT-style signed token** — overkill for one-shot cancel use case.
- **Recommend (a):** mirrors existing `buyer_status_token` convention, easy to rotate per-order (regenerate column value), explicit DB row provides audit trail. SPEC §3.1 codifies.
- **Causal chain:** Without an order-scoped token, the buyer cannot self-cancel from an email link weeks later without re-authenticating. The whole self-serve cancel UX depends on this token plumbing.

### 🔴 F-5 — `ticket-checkout-create` entry validation is the only gate — no event-level closed check today

- **File:** `supabase/functions/ticket-checkout-create/index.ts` lines 90-104
- **Exact code:** Currently only checks `event_dates.end_at > now()` (event hasn't already ended) — no check for `events.status`, `events.published_at`, `events.bookings_closed`, or `events.booking_deadline`.
- **What it does:** Allows checkout to proceed for any event the buyer reaches the URL for, as long as the event hasn't already ended.
- **What it should do:** ALSO reject when `events.bookings_closed = true` OR `events.booking_deadline IS NOT NULL AND events.booking_deadline < now()`. Return HTTP 403 with `{error: "bookings_closed", detail: "Bookings closed", deadline: "<ISO>"}`.
- **Causal chain:** Without this check, the booking-deadline cron + UI close banner are defense-in-depth but not enforcement. A buyer who has the URL but no UI client (curl-the-edge-function) could book past the deadline. The edge function check is the LAST line of defense and MUST exist.
- **Verification step:** Codified as I-PROPOSED-TR4-BOOKING-DEADLINE-RESPECTED-AT-CHECKOUT. Tester writes adversarial: set `events.bookings_closed=true` then curl `ticket-checkout-create` → confirm 403.

### 🟡 F-6 — Application fee refund proportionality is the only correct behaviour per ORCH-0843

- **File:** `supabase/functions/refund-order/index.ts` lines 270-298
- **Existing code:**
  ```ts
  await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      amount: amountCents,
      reason: "requested_by_customer",
      refund_application_fee: applicationFeeAmountCents > 0,
      ...
    },
    { idempotencyKey, stripeAccount: connectedAccountId }
  )
  ```
- **What it does:** `refund_application_fee: true` tells Stripe to refund the Mingla application fee proportionally to the refund amount (Stripe computes the proportion).
- **What Tr4 should do:** SAME. Don't invent new application-fee accounting logic. `refund_application_fee: true` on every Tr4 refund call. ORCH-0843 1.5% application fee on each installment PI means the proportional refund automatically gives the correct Mingla cut back to the buyer/operator.
- **Verification:** Q6 RESOLVED in spec — proportional via Stripe-native handling.

### 🔵 F-7 — Existing dispatcher kinds (ORCH-0788) sufficient — no new kinds needed

- **File:** `supabase/functions/ticket-confirmation-dispatch/index.ts`
- **Existing kinds:** `installment_dunning`, `installment_plan_paid_in_full`, `buyer_refund_issued`, `buyer_order_cancelled`, default → `buyer_ticket_confirmation`
- **Tr4 needs:** booking-cancelled email + refund-processed email
- **Resolution:** REUSE `buyer_order_cancelled` for booking cancellation (whether buyer-self or operator-initiated). REUSE `buyer_refund_issued` for refund execution notification. Optionally pass payload-level `{cancelledBy: 'buyer'|'operator', refundAmountCents, tierApplied}` so email body differentiates without new branches.
- **Verdict:** SPEC §3.2.4 codifies; dispatch §3.2 Q9 recommendation REVISED — NO new kinds.

---

## 5. Blast Radius Map

### 5.1 What Tr4 could break (regression surfaces)

| Surface | Risk | Mitigation |
|---|---|---|
| **Tr3 happy-path installment charging** | If cron filter not updated with `AND cancelled_at IS NULL`, cancelled installments get charged → buyer charged for cancelled trip → refund chaos | I-PROPOSED-TR4-CANCELLED-INSTALLMENT-NEVER-CHARGED + strict-grep gate on cron SQL + tester adversarial test |
| **ORCH-0787 single-event refund** | If Tr4 mutates `refund-order` rather than forks, single-event refund logic could regress | FORK to `cancel-trip-booking/index.ts` per F-2; leave `refund-order` untouched |
| **ORCH-0843 direct-charge architecture** | If Tr4 uses wrong `stripeAccount` (e.g., platform account) → refund posts to wrong Stripe account → operator's books wrong | Reuse exact pattern from refund-order lines 270-298 with `{stripeAccount: connectedAccountId}` |
| **ORCH-0844 Connect Customer durability** | Tr4 cancel of an at-risk installment plan might trigger Customer deletion → breaks all OTHER orders with that Customer | I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY (active) gates this; Tr4 does NOT delete Customers |
| **Tr2 buyer-anon checkout 3 routes** | Tr4 must preserve `feedback_anon_buyer_routes.md` for NEW `/booking/{orderId}/cancel` route | SPEC §3.5 hard-locks; NO `useAuth`, NO sign-in redirect on new route |
| **Tr3 ledger invariants** | I-PROPOSED-TR3-LEDGER-INVARIANT-COLLECTED-IMPLIES-PI-ID could be tested by Tr4 cancellation of a `collected` installment | Tr4 does NOT alter `collected` rows; it cancels only `scheduled` + `failed`. Refund attribution writes to `refund_line_items.installment_id` (new column), not to `order_installments` directly |
| **ORCH-0873 Money tab Refund stub** | Replacing the stub with real action could regress the rest of the Money tab UI | Surgical replacement only; Money tab structure + retry chip + ledger list unchanged |
| **TripCreatorWizard chrome (ORCH-0874)** | Adding refund + deadline wizard steps could break the Stepper + Close X + Keyboard.addListener migration | Codify SPEC §3.5 wizard step IA (one of 3 options per dispatch §3.3) — `/ui-ux-pro-max` resolves at DESIGN phase |

### 5.2 Solo + collab parity

N/A — Tr4 is trip-planner-only (single-owner brands). No collab mode. Tr1 [Trip Planner Brand Onboarding] established `kind='trip_planner'` brands; multi-owner trip-planner brands are theoretically possible but Tr4 RLS uses `biz_is_brand_member_for_read_for_caller` which already handles multi-member brands.

### 5.3 Cross-domain

- **DB schema changes** (events + orders + order_installments + refund_line_items) → cascade to TS types in `mingla-business/src/types/` → cascade to React Query keys for trip detail + order detail.
- **NEW edge functions** (`cancel-trip-booking` + `process-booking-deadlines`) → must be deployed by orchestrator post-DB-push per `feedback_orchestrator_deploys_edge_functions.md`.
- **Email templates** (extend `buyerLifecycleAdapters.ts` for refund+cancel) → cascade to Resend send-engagement tracking via existing `ticket_order_notifications` row.
- **CI strict-grep gates** — 3 new gates per the 5 NEW invariants (some invariants pin via SQL CHECK + tester adversarial, not strict-grep — see SPEC §5).
- **Admin web** — NOT touched (no admin refund queue per dispatch §6).

---

## 6. Invariant violations + new invariants proposed

### 6.1 Preserved (no violations expected)

- I-PROPOSED-TR1-PERSONA-INTERFACE — Tr4 doesn't touch persona picker
- I-PROPOSED-TR1-KIND-IMMUTABLE — Tr4 doesn't touch brand kind editor
- I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE — Tr4 buyer cancel route uses `routeForEventRowDefensive` if linking from any event-row context
- I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES — new `/booking/{orderId}/cancel` route must include SafeArea wrapper
- I-PROPOSED-TR2-LIVESTORE-ADDLIVEEVENT-OWNER — Tr4 doesn't write live-store rows
- I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER (ACTIVE) — Tr4 does NOT create new installment PIs; it only cancels + refunds existing ones
- I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY — Tr4 does NOT delete Customers; cancellation marks installments cancelled, doesn't tear down Stripe entities
- I-PROPOSED-TR3-LEDGER-INVARIANT-COLLECTED-IMPLIES-PI-ID — Tr4 does NOT alter collected rows; refund attribution writes to `refund_line_items.installment_id`
- I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH — Tr4 refund math reads currency from `order_installments.currency` (already pinned)
- I-38 (44pt touch targets) + I-39 (accessibilityLabel on every Pressable) — new wizard steps + buyer cancel UI must comply

### 6.2 New invariants (DRAFT → ACTIVE on close)

Five new invariants — full text in SPEC §5. Summary:

| ID | Rule | Enforcement |
|---|---|---|
| I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY | Refund % non-increasing across tiers (later tier ≤ earlier tier) | Publish-time validation in `biz_event_publish_v2` + strict-grep on policy JSONB validator |
| I-PROPOSED-TR4-BOOKING-DEADLINE-RESPECTED-AT-CHECKOUT | `ticket-checkout-create` MUST hard-block when bookings closed | Edge fn check + tester adversarial + strict-grep on checkout entry |
| I-PROPOSED-TR4-INSTALLMENT-REFUND-LEDGER-PARITY | Every `refund_line_items` row with `installment_id` set MUST reference a row whose `order_installments.order_id` matches the parent refund's `orders.id` | SQL trigger + tester adversarial |
| I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL | Refund amount computed at cancel-time (not at refund-execution-time), stored in `refunds.amount_cents`, immutable post-insert | RLS UPDATE policy denies amount_cents changes + tester adversarial |
| I-PROPOSED-TR4-CANCELLED-INSTALLMENT-NEVER-CHARGED | Cron `process-scheduled-installments` MUST filter `WHERE status='scheduled' AND cancelled_at IS NULL` | Strict-grep on edge fn SQL query + tester adversarial |

---

## 7. Fix strategy (direction only, not code)

Tr4 ships as ONE ORCH per INTAKE staging decision. Implementation order:

1. **Migration `20260612000000_tr4_refund_tiers_booking_deadline.sql`** — add `events.refund_policy jsonb`, `events.booking_deadline timestamptz`, `events.bookings_closed boolean`, `events.bookings_closed_at timestamptz`; add `orders.cancel_reason text`, `orders.cancelled_by uuid`, `orders.buyer_cancel_token_hash text`; add `order_installments.cancelled_at timestamptz`, `order_installments.cancelled_by uuid`; add `refund_line_items.installment_id uuid`; create new RPC `biz_cancel_trip_booking` + `biz_compute_refund_for_cancel` (pure SQL function returning the cascading math result); pg_cron schedule for `process-booking-deadlines` hourly.
2. **Validation in trip publish RPC** — extend `biz_event_publish_v2` (or trip-specific publish RPC) to reject malformed `refund_policy` JSONB (monotonicity, % range, days-before-trip-start integer ≥ 0).
3. **NEW edge function `cancel-trip-booking`** — JWT-or-token auth, calls `biz_cancel_trip_booking` RPC, calls `stripe.refunds.create` per installment, calls commit RPC, dispatches notification.
4. **NEW edge function `process-booking-deadlines`** — service-role cron handler, flips `bookings_closed=true` for trips past `booking_deadline`.
5. **MODIFIED `ticket-checkout-create`** — surgical bookings-closed check insert after line 104.
6. **MODIFIED `process-scheduled-installments`** — add `AND cancelled_at IS NULL` to both filter queries.
7. **MODIFIED `ticket-confirmation-dispatch`** — extend `buyer_refund_issued` + `buyer_order_cancelled` payload adapters with Tr4 fields (refundAmountCents, tierApplied, cancelledBy).
8. **Operator runs `supabase db push`**; orchestrator deploys 4 edge functions (NEW cancel-trip-booking + NEW process-booking-deadlines + modified ticket-checkout-create + modified process-scheduled-installments + modified ticket-confirmation-dispatch — 5 deploys actually).
9. **Service + hook layer** — new `cancelTripBookingService.ts` + `useCancelTripBooking` + `useUpdateRefundPolicy` + `useUpdateBookingDeadline`.
10. **Components** — `RefundPolicyEditor.tsx` (3 templates + custom builder with monotonicity validation), `BookingDeadlinePicker.tsx`, `RefundPreviewSheet.tsx` (used by both buyer cancel + operator cancel), `RefundPolicyDisplay.tsx` (read-only ladder for buyer/public page), new `/booking/{orderId}/cancel` route in `mingla-business/app/booking/[orderId]/cancel.tsx`.
11. **Wizard step** — `TripCreatorStep4Pricing` extension OR new Step 5 (DESIGN-phase decision; `/ui-ux-pro-max` resolves).
12. **Trip dashboard** — replace ORCH-0873 Refund stub with real Refund CTA + Cancel-booking action on traveler-list rows.
13. **Public trip page** — render refund policy as visual ladder + booking-deadline countdown.
14. **CI strict-grep gates** — 3 new gates (deadline check + ledger parity + cancelled-not-charged); 2 invariants pinned via SQL CHECK / RLS instead.

---

## 8. Regression prevention requirements

| Requirement | Rationale |
|---|---|
| Fork `cancel-trip-booking/index.ts` rather than mutate `refund-order` | Blast-radius isolation per F-2 |
| Cron filter `AND cancelled_at IS NULL` on BOTH scheduled + failed queries | Prevent cancelled installment double-charge per F-3 |
| Bookings-closed check in `ticket-checkout-create` is last line of defense | Defense-in-depth alongside UI close banner + cron auto-close per F-5 |
| Order-scoped buyer cancel token persisted as SHA256 hash | Order-level auth without exposing plaintext per F-4 |
| Refund amount computed + stored at cancel-time, immutable | Prevent race condition between cancel-confirm and cron-charging next installment per I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL |
| 9-cell boundary-condition test matrix for installment refund math | Tr4 risk-register row 6 mandate |
| 6-cell boundary-condition test matrix for single-payment refund math | Tr4 risk-register row 6 mandate |
| Tester adversarial: cancel-someone-else's-booking via forged orderId / expired token | Security gate per dispatch §9 |
| Tester adversarial: cancel-different-brand's-booking via operator JWT | RLS gate per dispatch §9 |
| Implementor happy-path: 3-installment plan refund at middle tier | Step 0.5 regression-test gate per ORCH-0840 |

---

## 9. Discoveries for orchestrator

- **DISC-1 — Existing `refund_line_items` schema is the right home for installment provenance.** Dispatch §3.1 proposed a NEW `order_refunds` sidecar; current-state evidence (ORCH-0787 already shipped) makes that redundant. SPEC §3.1 extends existing `refund_line_items` with `installment_id`.
- **DISC-2 — `orders.cancelled_at` already exists** (ORCH-0787); dispatch §3.1 assumption "investigate whether to add" is RESOLVED — no add. Tr4 only adds `cancel_reason` (text) + `cancelled_by` (uuid) + `buyer_cancel_token_hash` (text).
- **DISC-3 — `ticket-confirmation-dispatch` already has the Tr4 kinds.** Dispatch §3.2 Q9 recommended new kinds `booking_cancelled` + `refund_processed`; current-state evidence shows `buyer_order_cancelled` + `buyer_refund_issued` (ORCH-0788) already cover Tr4. SPEC §3.2 REUSES, doesn't duplicate. Payload-level discriminator `{cancelledBy: 'buyer'|'operator', tierApplied: '<flexible/standard/strict/custom>'}` handles email-copy variants.
- **DISC-4 — Wizard step IA is a `/ui-ux-pro-max` decision.** Dispatch §3.3 lists 3 options (Add 2 steps / fold into Step 4 / add 1 combined). SPEC leaves this OPEN for design phase. Recommend orchestrator dispatch `/ui-ux-pro-max` for wizard IA + buyer cancel-flow IA + refund-preview presentation BEFORE implementor.
- **DISC-5 — `events.booking_deadline` timezone interpretation needs design clarity.** Stored as `timestamptz` (UTC under the hood). UI must render in operator-brand TZ. Cron runs in UTC. SPEC §3.1 codifies; `/ui-ux-pro-max` design picks the picker UX (operator's TZ explicit vs. local-time-with-trip-TZ-conversion).
- **DISC-6 — Min-capacity gate (ORCH-0825 §5) deferred per Q8** — register as future ORCH after Tr4 ships.
- **DISC-7 — Tr4 v1.1 follow-ups already emerging:** buyer self-update PM on dunning (still ORCH-0871 from Tr3 close), late-booking auto-adjust (ORCH-0870 from Tr3 close), Stripe Tax on installment PIs (ORCH-0804-A) — none in scope for Tr4 but worth surfacing in CLOSE.

---

## 10. Confidence level

**H — High** for:
- Current-state schema map (all migrations verified via direct grep, last-writer-wins applied)
- Edge function pattern (refund-order source read directly)
- 5-layer cross-check (all 5 layers AGREE)
- 5 NEW invariants (each maps to a concrete enforcement mechanism)
- Hard guards inherited from Tr3 (ACTIVE invariants are gates already in CI)

**M — Medium** for:
- Wizard step IA (3 options, no DESIGN phase ingested) — defer to `/ui-ux-pro-max`
- Buyer cancel route UX (refund preview + confirm + success state) — defer to `/ui-ux-pro-max`
- Email-copy variants for buyer-vs-operator cancellation (payload discriminator approach is sound but copy-locking is design work)
- Cron cadence for `process-booking-deadlines` — recommend hourly; could tune to 15min if operator demand surfaces

**L — Low** for:
- Tr4 v1.1 follow-ups (out of scope; surfaced in DISC-7 for orchestrator)

---

## 11. Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Spec file written next at `Mingla_Artifacts/specs/SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`.

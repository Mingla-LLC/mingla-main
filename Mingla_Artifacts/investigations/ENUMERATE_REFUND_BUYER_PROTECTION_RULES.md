# ENUMERATE — Refund / Buyer-Protection Rules (ORCH-1120 context)

**Mode:** INVESTIGATE / enumerate existing behavior. **No bug hunt, no proposed changes.**
**Question (Seth):** "We already have buyer-protection rules that determine refunds when there are sales or no sales — what are they?" Needed to decide whether published-trip refund-tier / booking-deadline edits should be gated when bookings exist.
**Scope:** TRIPS specifically; event/experience parity noted where it shares the engine.
**Confidence key:** `proven` = source/migration/edge-fn confirmed verbatim; `suspected` = inferred, not run live. (No simulator was driven — this is a backend/SQL enumeration, exempt from the live-fire directive.)

---

## TL;DR — the "sales exist vs no sales" rule, in one line

When a published trip has **paid, non-cancelled orders**, the edit RPC **hard-blocks** (returns `ok:false`) on: dropping the start/end date, dropping a day, removing an inclusion, deleting a pricing tier, or changing a tier's price, and on shrinking capacity below the sold count. With **no sales**, all of those edits go through freely. **BUT** the **refund policy (tiers) and the booking deadline are NOT part of that gate at all** — they are written through a *separate* direct-table service that has **zero sales-awareness**, so a brand can change refund tiers or the booking deadline on a trip with active bookings with no warning and no block today. That gap is the heart of Seth's policy decision.

---

## (a) What a "refund tier" and "booking deadline" are

### Refund tier model — `proven`
- **Where it lives:** `events.refund_policy` jsonb column, **trips only** (`event_type='trip'`). Added in `supabase/migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql:27-36` (ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]).
- **Shape:** `{ kind: "flexible"|"standard"|"strict"|"custom", tiers: [{ days_before_start: int>=0, refund_pct: int 0-100 }] }` — tiers sorted **descending** by `days_before_start`; `refund_pct` must be **non-increasing** as the days count down. (`mingla-business/src/services/refundPolicyService.ts:19-32`.)
- **What a tier means in plain English:** "If the buyer cancels **N or more days before** the trip starts, they get **P%** back." The longest-notice tier that the buyer still qualifies for wins.
- **Built-in templates** (`refundPolicyService.ts:36-60`):
  - **Flexible** — 30d→100%, 14d→50%, 0d→0%.
  - **Standard** — 60d→100%, 30d→50%, 0d→0%.
  - **Strict** — 90d→100%, 0d→0%.
  - **Custom** — operator builds 1–8 tiers (`RefundPolicyEditor.tsx:52`, max 8), validated client-side (`RefundPolicyEditor.tsx:78-112`) AND by a DB CHECK constraint `events_refund_policy_valid` → `validate_refund_policy()` (`...tr4...sql:491-514`). DB CHECK is authoritative.
- **Validation invariant:** `I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY` — refund_pct non-increasing; days strictly descending; 1–8 tiers; pct 0–100. Bad JSON raises Postgres 23514, mapped to friendly errors (`refundPolicyService.ts:93-139`).
- **Default when a brand sets nothing — `proven`:** `refund_policy` is **NULL** → compute treats it as **0% at every time** (no refund). `...tr4...sql:227-228` resolves `COALESCE(refund_policy,'{}')` and `:508` `validate_refund_policy(NULL)` returns true ("NULL is no policy = no refund at any time"). The editor even labels clearing it "Clear policy (no refunds)" (`RefundPolicyEditor.tsx:438`). **So the silent default is buyer-unfriendly: no policy = no refund.**

### Booking deadline + `bookings_closed` — `proven`
- **Columns:** `events.booking_deadline timestamptz NULL`, `events.bookings_closed boolean NOT NULL DEFAULT false`, `events.bookings_closed_at timestamptz NULL` (`...tr4...sql:31-33`). Trips only.
- **`booking_deadline`** = absolute timestamp after which new bookings are rejected. NULL = no deadline; bookings stay open until the trip starts (`BookingDeadlinePicker.tsx:198-202`).
- **`bookings_closed`** = the hard switch. When true, checkout is blocked.
- **Two enforcement points (both `proven`):**
  1. **Cron `process-booking-deadlines`** runs hourly and flips `bookings_closed=true` + `bookings_closed_at=now()` for every trip where `booking_deadline <= now() AND bookings_closed=false` (`supabase/functions/process-booking-deadlines/index.ts:101-123`). Idempotent.
  2. **`ticket-checkout-create` gate** (`supabase/functions/ticket-checkout-create/index.ts:336-369`): blocks with **HTTP 403 `bookings_closed`** when `bookings_closed === true` **OR** the live `booking_deadline` timestamp is already `<= Date.now()` (lines 359-361). The deadline is enforced **even before** the cron flips the flag, so there is no gap between the deadline passing and the cron run.
- **Clearing the deadline** also resets `bookings_closed=false` + `bookings_closed_at=null` so the operator can re-open bookings (`refundPolicyService.ts:241-243` / `updateBookingDeadline`).

---

## (b) THE "sales exist vs no sales" behavioral differences (the core of Seth's question)

There are **two completely separate write paths** for editing a published trip, and only ONE of them is sales-aware.

### Path 1 — `biz_update_live_trip` RPC: the sales-aware "affected-orders refund-gate" — `proven`

Authoritative current definition: re-emitted verbatim in `supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql` (carries forward from ORCH-0876 → ORCH-0950). Original gate logic readable at `supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql:160-352`.

**How "affected orders" is counted:**
- `biz_trip_sold_count_by_tier(event_id)` returns `{ticket_type_id: sold_count}` for **confirmed** orders, where confirmed = `orders.payment_status NOT IN ('failed','cancelled')` (`orch_0876...sql:76-100`). `v_total_sold` = sum across tiers (`:209-211`).
- The trip_edit_log also records `affected_order_ids` = all `orders` for the event where `payment_status NOT IN ('failed','cancelled')` (`:458-462`).

**What it HARD-BLOCKS when `v_total_sold > 0` (returns `{ok:false, reason, affected_order_count}` — the mutation does NOT apply):**

| Edit attempted | Block reason (only when sales > 0) | File:line (0876) |
|---|---|---|
| Capacity set below sold count | `capacity_below_sold` | `:222-229` |
| Start/end date shifted (any change) | `dates_shifted_with_sales` | `:244-256` |
| A trip day dropped | `days_dropped_with_sales` | `:278-285` |
| An inclusion removed | `inclusions_removed_with_sales` | `:307-314` |
| A pricing tier deleted | `tier_delete_with_sales` | `:333-339` |
| A pricing tier's price changed | `tier_price_change_with_sales` | `:343-349` |

**Important nuance — these are BLOCKS, not warnings.** There is **no "warn but allow" tier**. When sales exist and the edit touches one of the protected fields, the RPC refuses and returns the reason + affected_order_count for the UI to surface. **Additive edits are always allowed** (title, description, cover, adding days/inclusions, raising capacity) regardless of sales; severity is logged as `material` vs `additive` (`:443-449`).
- The 1075 version adds two MORE blocks that fire on a **paid** trip regardless of the sales count: `stripe_charges_disabled` (brand can't take money) and `offering_date_past` (latest occurrence already ended) — these are publish-integrity guards, not sales-gates.

### Path 2 — `refundPolicyService` direct-table writes: NO sales-awareness — `proven`

This is the gap. **Refund policy and booking deadline are NOT edited through `biz_update_live_trip`.** They are written by `mingla-business/src/services/refundPolicyService.ts` directly to `public.events` via supabase-js:
- `updateRefundPolicy()` → `UPDATE events SET refund_policy=... WHERE id=? AND event_type='trip'` (`refundPolicyService.ts:196-202`).
- `updateBookingDeadline()` → `UPDATE events SET booking_deadline=... WHERE id=? AND event_type='trip'` (`:235-248`).

**Proof of the gap:** I grepped the authoritative current `biz_update_live_trip` body (1075 migration) for `refund_policy`, `booking_deadline`, and `bookings_closed` — **zero matches**. The RPC's gate has no branch for either field, and the patch shape it accepts (`title/description/theme/days/inclusions/pricing_tiers/intake_schemas/cover_*`) never carries them. The only protection on the direct writes is:
- RLS by brand membership (operator must own the brand).
- The DB CHECK constraint validating the policy's internal monotonicity.
- `event_type='trip'` scoping.

**There is NO check for active bookings, no warning, no block.** A brand with 50 paid bookings can today switch a trip from Flexible (100% refund) to a no-policy / Strict tier, or pull the booking deadline forward, with zero friction and zero buyer notification. **This is exactly the policy hole ORCH-1120 is weighing.**

### Edit-after-publish immutability summary — `proven`
- Status gate: edits only allowed when `status IN ('scheduled','live')` (`orch_0876...sql:197-199`).
- With-sales immutability applies ONLY to the 6 protected fields above, ONLY via Path 1.
- Refund tiers + booking deadline are **mutable at any time, sales or not**, via Path 2.

---

## (c) What actually happens to buyer money on a refund

### Trip cancellation (the tier engine) — `proven`
Owner: `supabase/functions/cancel-trip-booking/index.ts` (sole owner of trip cancel + Tr4 refund execution).

1. **Amount is computed by `biz_compute_refund_for_cancel`** (`...tr4...sql:172-319`), deterministically, pinned at cancel time:
   - `days_remaining = FLOOR((trip_start - cancel_at)/86400)` (whole days; negative after start) — `:225`. Trip start = `MIN(event_dates.start_at)` (`:217`).
   - **Tier selection:** pick the tier with the **largest** `days_before_start` that is still `<= days_remaining` → that tier's `refund_pct` wins (`:232-236`). No matching tier (or no policy) → **0%** (`:230,237`).
   - **Money:** `refund_cents = FLOOR(paid_cents * tier_pct / 100)` per payment (`:263,274,286`). Installment orders refund each collected installment + the deposit proportionally; single-payment orders refund the one charge. Total = sum of per-row refunds (`:292-293`).
2. **Execution to Stripe** (`cancel-trip-booking/index.ts:447-513`): one `stripe.refunds.create` **per source PaymentIntent**, `amount = entry.refund_cents`, `reason: requested_by_customer`, `refund_application_fee: true` (so Mingla's ~1.5% fee is refunded proportionally), on the brand's connected account (`stripeAccount: connectedAccountId`). Per-PI idempotency key. **0% tiers skip Stripe entirely** (`:448-454`) but still record the cancel.
3. **Freshness guard (SC-22):** the client passes `expectedRefundTotalCents` from the preview; if the policy changed between preview and confirm, the begin RPC recomputes and the edge fn returns **HTTP 409 `policy_updated`** with the new amount, rolling back the begin (`:375-390`). This is the ONLY place a mid-flight policy change is caught — and only within a single cancel transaction, NOT a guard on the policy edit itself.
4. **Booking still cancels even if the Stripe refund fails** — `orders.cancelled_at` stays set; refund row goes `failed` for operator retry (`index.ts:20-23,515-539`).

### Who can trigger it — `proven`
- **Buyer-initiated:** SHA256 token from the confirmation email (`cancel-trip-booking/index.ts:147-179`). Buyer gets the tiered amount.
- **Operator-initiated:** JWT + brand membership + a 10–200-char reason (`:274-282`). Same tier math.
- **Auto refunds:** none on cancellation — there is no automatic refund cron. (The only automated money-time job is the booking-deadline **closer**, which does not refund.)

### Event / experience refunds (parity note) — `proven`
- Events and experiences do **NOT** use refund tiers. They go through `supabase/functions/refund-order/index.ts`, which refunds an **operator-specified amount** (full or partial, `is_full_refund` flag, `amount_cents` chosen by the operator) — `refund-order/index.ts:391-395,186`. No `refund_policy` reference anywhere in that function.
- So: **tiered, time-based, buyer-self-serve refunds are a TRIPS-ONLY feature.** Events/experiences are operator-discretion refunds.

---

## (d) Policy-vs-enforcement reconciliation (gaps flagged)

| Buyer is promised… | Is it enforced? | Verdict |
|---|---|---|
| The displayed refund tier (e.g. "100% if 30+ days out") | YES — the same `refund_policy` jsonb both renders in `RefundPolicyDisplay`/`RefundPreviewBody` AND drives `biz_compute_refund_for_cancel`. Single source of truth. | `proven` — aligned |
| The tier they saw **at checkout** can't be silently worsened after they book | **NO** — `refund_policy` is mutable at any time via Path 2 with no sales-gate, no versioning, no buyer notice. The compute always reads the **current** policy, not the policy at purchase time. A brand can change Flexible→no-refund after a sale; the buyer's refund silently drops. The only catch is the in-transaction 409 during an active cancel. | **GAP — `proven`. This is the ORCH-1120 question.** |
| Booking deadline they relied on stays put | **NO** — `booking_deadline` is mutable at any time via Path 2 with no sales-gate. Pulling it forward immediately blocks new checkouts (and, after cron, sets `bookings_closed`). Existing bookings aren't harmed, but the listing's terms shift unannounced. | **GAP — `proven`** |
| Structural trip terms (dates/days/inclusions/price/capacity) stay put once they've paid | YES — Path 1's affected-orders gate hard-blocks all six with sales. | `proven` — aligned |

**Bottom line for the decision:** the precedent already in the codebase is that **money-material, buyer-relied-upon fields are frozen once paid orders exist** (Path 1). Refund tiers and the booking deadline are arguably the *most* buyer-relied-upon fields of all, yet they are the two that **escaped the gate** because they ship on a separate direct-write service. Gating their edits when bookings exist would make them consistent with the dates/inclusions/pricing precedent that's already live.

---

## Five-truth-layer reconciliation
- **Docs/spec:** ORCH-0875 spec defines tiers + deadline; ORCH-0876 spec defines the affected-orders gate. Neither spec wired refund_policy/booking_deadline INTO that gate. (consistent with code)
- **Schema:** `events.refund_policy / booking_deadline / bookings_closed` + CHECK `events_refund_policy_valid`. (proven)
- **Code:** Path 1 RPC gates 6 fields on sales; Path 2 service gates none. (proven, grep-confirmed in the authoritative 1075 migration)
- **Runtime:** not driven live (backend enumeration); compute + checkout logic read verbatim.
- **Data:** not queried (read-only enumeration; no live row inspection needed to state the rules).

## Discoveries for Orchestrator
- **D-1 (`proven`):** Refund-tier and booking-deadline edits on a live trip bypass the affected-orders gate entirely (Path 2 direct writes). Directly relevant to ORCH-1120; no other ORCH owns it.
- **D-2 (`suspected`):** `biz_compute_refund_for_cancel` always uses the **current** policy, so there is no "policy at time of purchase" snapshot. If ORCH-1120 wants buyers protected at their *booked* terms, a per-order policy snapshot (not just an edit-gate) may be the stronger lever. Flagged, not designed.

## Confidence
**proven** for the entire ruleset (a)-(d): every claim is backed by the verbatim migration / edge-function / service source, and the absence of a refund_policy/booking_deadline branch in the authoritative `biz_update_live_trip` (1075) was grep-confirmed. The only `suspected` item is D-2's framing of a snapshot remedy (a design idea, not a current rule).

## Recommended next phase
Policy decision by Seth, then (if he wants the gap closed) SPEC for ORCH-1120 to extend the sales-aware gate to refund_policy + booking_deadline — either routing those writes through `biz_update_live_trip` or adding an equivalent affected-orders guard to `refundPolicyService`. **No fix proposed here.**

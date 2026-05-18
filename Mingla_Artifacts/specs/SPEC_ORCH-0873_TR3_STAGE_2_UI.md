# SPEC — ORCH-0873 [Tr3 Installment Payments Stage 2 UI]

**Skill:** Claude `mingla-forensics` (SPEC mode)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Pre-CLOSE state:** ORCH-0869 [Tr3 Installment Payments] backend Stages 1 + 1b merged to main 2026-05-18 (squash `824d0c97`); ORCH-0872 [Tr3 Stage 1c] open; ORCH-0867 + ORCH-0868 carryovers open.
**Dispatch:** orchestrator handoff after `ui-ux-pro-max` returned `Mingla_Artifacts/design/DESIGN_ORCH-0873_TR3_STAGE_2_UI.md`
**Authority:** SPEC_ORCH-0869 §3.5 + §3.6 (functional contract); DESIGN_ORCH-0873 (visual + interaction layer, Mockup A + sticky validation footer recommendation). This SPEC promotes design selections into formal success criteria, resolves the 8 open questions in DESIGN §9, expands SC-5a/5b/5c per-route, declares cross-surface impact, and names 2 new CI strict-grep gates for the remaining DRAFT invariants.
**Author confidence:** H — design + functional contract already in place; this SPEC is a thin layer that converts design selections into testable contracts.

---

## 0. Layman summary

This SPEC tells the implementor (and the tester) exactly what to build for the buyer-facing + planner-facing UI of trip installment payments. The functional shape is already locked in SPEC_ORCH-0869 §3.5; the visual shape is locked in DESIGN_ORCH-0873 (Mockup A inline editor + sticky validation footer); this SPEC fills in the precise component contracts, file paths, copy strings, success criteria per-surface, regression-test plan, and the 2 CI gates needed to flip the remaining DRAFT invariants to ACTIVE on close.

---

## 1. Scope

### In scope (this SPEC, Stage 2)

- NEW component `mingla-business/src/components/trip/PaymentPlanEditor.tsx` per DESIGN §3 Mockup A + sticky footer.
- NEW component `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx` per DESIGN §4.
- NEW service `mingla-business/src/services/orderInstallmentsService.ts` per SPEC_ORCH-0869 §3.3.1.
- NEW hook `mingla-business/src/hooks/useOrderInstallments.ts` per SPEC_ORCH-0869 §3.4.
- NEW shared copy constant `mingla-business/src/copy/installmentReassurance.ts` (per DESIGN §10 discovery #4).
- MODIFIED `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` — add Payment plan toggle + render PaymentPlanEditor below.
- MODIFIED `mingla-business/src/components/trip/TripCheckoutFlow.tsx` — render InstallmentScheduleDisplay above line items when schedule present (planner preview).
- MODIFIED `mingla-business/app/checkout/[eventId]/index.tsx` — render InstallmentScheduleDisplay above subtotal row (buyer Step 1).
- MODIFIED `mingla-business/app/checkout/[eventId]/buyer.tsx` — render InstallmentScheduleDisplay above order summary (buyer Step 2).
- MODIFIED `mingla-business/app/checkout/[eventId]/payment.tsx` — render InstallmentScheduleDisplay; **CTA copy changes from `Pay $X` to `Pay $X deposit`** when schedule present (buyer Step 3 — Q1 resolution).
- MODIFIED `mingla-business/app/trip/[id]/index.tsx` — extend `TabKey` to `"overview" | "travelers" | "money"`; add Money tab branch per DESIGN §5; tab label includes at-risk count when > 0 (Q3 resolution).
- NEW Jest tests for service + hook + components per SPEC_ORCH-0869 §6 test cases.
- NEW CI strict-grep gate `i-proposed-tr3-installment-customer-durability.mjs`.
- NEW CI strict-grep gate `i-proposed-tr3-schedule-currency-pinned-at-publish.mjs`.
- Regression-test gate per ORCH-0840 [Regression-test enforcement] — implementor happy-path test + tester adversarial test, both fails-on-revert.

### Non-goals (deferred)

- **Edit-existing-plan after first booking:** trip pricing schedule LOCKED at first installment-plan booking (Q6 resolution). When the editor mounts on a published trip that already has an `orders.installment_plan_root=true` row, render read-only-with-banner state: "Payment plan locked — at least one buyer has booked under this schedule. To change pricing, create a new trip." NO interactive controls in this state. Banner copy in §3.5.1 v3.
- **Drag-reorder of installments** — explicitly NOT in v1 per SPEC_ORCH-0869 §3.5.1 (ordinal auto-assigned by array position).
- **Buyer self-update payment method when an installment fails** — out of scope; ORCH-0871 (renumber needed — original ORCH-0871 ID was named in SPEC_ORCH-0869 §11 but the ORCH-ID may have been taken; orchestrator to renumber at registration time). Stage 2 dunning email still uses the "Contact organizer" CTA via mailto.
- **Realtime subscription on `order_installments`** — explicitly NOT in v1 per SPEC_ORCH-0869 §3.6. React Query polling + webhook-driven cache invalidation only.
- **Money tab grouping by date / by status** — v1 ships grouping by booking only with at-risk filter chip.
- **Refund engine** — disabled stub only per Q5 resolution. Tr4 scope.
- **Stage 1c (secondary finalize callers)** — separate ORCH-0872. Stage 2 ships independently; ORCH-0872 should ship before Stage 2 UI launches to operators to avoid a brief window where stuck-checkout recovery loses installment-plan-root state, but it's not a hard blocker.
- **`TripCreatorWizard` step deep-link support** for Q2 (Money tab empty-state CTA → wizard Step 4) — investigate at implementor time; if wizard does NOT support `?step=` deep-link today, ship Stage 2 with CTA pointing to wizard root (Step 1) instead. Adding step deep-link is a separate small ORCH if needed.

### Assumptions

- ORCH-0869 backend Stages 1 + 1b are live in production (verified via `gqnoajqerqhnvulmnyvv` post-merge probe).
- ORCH-0840 [Regression-test enforcement] CI gate `tests-append-only.yml` is active.
- I-38 (IconChrome touch ≥ 44pt) + I-39 (Pressable accessibilityLabel) gates from Cycle 17c are active and Stage 2 components must pass them.
- `trip.currency` is available at PaymentPlanEditor mount point as a passed prop (verified at `TripCreatorStep4Pricing.tsx:41` — Q7 resolution).
- Existing `Toast` primitive wrapped per `feedback_toast_needs_absolute_wrap.md` is available for `useRetryInstallment` `onError` callback.
- Lucide icons are available (or a near-future ORCH-0870 ships them); if Lucide is not yet installed, implementor uses existing icon set and notes the upgrade as a future swap.
- `react-native` `Switch` primitive is available for the Payment plan toggle (or existing toggle component if mingla-business has one).

---

## 2.5. Cross-Surface Impact (MANDATORY per `feedback_cross_surface_impact_inspection.md`)

| # | Surface | In scope | Files touched | Parity | User-visible behaviour |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` iOS) | **NO** | none | n/a | Trips not on consumer app per Tr2 [Minimum Viable Trip] scope. |
| 2 | Consumer Android (`app-mobile/` Android) | **NO** | none | n/a | Same. |
| 3 | Buyer/anonymous Web (`mingla-business/app/checkout/[eventId]/{index,buyer,payment}.tsx`) | **YES** | 3 separate files | **Manual** per route | Buyer sees `<InstallmentScheduleDisplay>` above line-item summary on all 3 routes when trip has `installment_schedule`. On `payment.tsx` the Stripe CTA copy changes from "Pay $X" to "Pay $X deposit" (Q1 resolution). |
| 4 | Business iOS (`mingla-business/` iOS) | **YES** | New `PaymentPlanEditor.tsx`, `InstallmentScheduleDisplay.tsx`, new Money tab branch on `app/trip/[id]/index.tsx`, modified `TripCreatorStep4Pricing.tsx` + `TripCheckoutFlow.tsx` | **Automatic** (shared RN source) | Planner sees Payment plan toggle on trip wizard Step 4 Pricing → can configure deposit % + N installments. Trip dashboard gains Money tab showing per-traveler installment status with status pills + manual Retry button on failed rows. |
| 5 | Business Android (`mingla-business/` Android) | **YES** | Shared RN source with iOS | **Automatic** | Same as Business iOS. |
| 6 | Admin Web (`mingla-admin/`) | **NO** | none | n/a | Admin doesn't render trip-ops dashboards yet — future admin-side trip-ops surface is a separate ORCH. |
| 7 | Business Web preview (`mingla-business/` dev/web) | **YES** | Shared RN-Web bundle from Business iOS/Android | **Automatic** | Same as Business iOS/Android (preview parity already proven by Tr2). One caveat: `payment.tsx` Stripe CTA copy change uses local CTA label override; Stripe-side Hosted Checkout button is Stripe's own UI and not touched. |

### Per-surface success criteria (manual parity = separate SCs)

The 3 buyer-anon-web routes are SEPARATE files. SPEC §4 uses sub-numbered criteria SC-5a / SC-5b / SC-5c so the implementor can't ship one and skip another and the tester has unambiguous per-surface gates.

---

## 3. Per-Layer Specification

### 3.1 Database layer

**No new migrations.** Stage 2 is UI-only. The `order_installments` ledger + `ticket_checkout_sessions.installment_schedule jsonb` + 5 new `orders` columns + `biz_retry_installment` RPC + cron schedule + `trip_pricing_tiers.tier_metadata.installments` JSONB key are all live from ORCH-0869 backend Stages 1 + 1b.

**Read-only DB shape consumed by Stage 2:**
- `trip_pricing_tiers.tier_metadata.installments` — read on trip-load, written on trip-publish per SPEC_ORCH-0869 §3.1.
- `order_installments` — service-role-write-only; service reads via RLS (brand-member SELECT policy + buyer SELECT policy from ORCH-0869).
- `orders.installment_plan_root + at_risk + at_risk_since + stripe_customer_id_on_connected_account + saved_payment_method_id` — read by Money tab.

### 3.2 Edge function layer

**No new edge functions.** Stage 2 calls existing:
- `biz_retry_installment(p_installment_id uuid)` RPC from ORCH-0869 Stage 1 — invoked by `useRetryInstallment` mutation.
- Existing `ticket-checkout-create` (Stage 1 already injects `setup_future_usage: 'off_session'` when `session.installmentSchedule != null`).
- Existing `stripe-webhook` (Stage 1b already passes 3 new finalize params).
- Existing `ticket-confirmation-dispatch` (Stage 1b new kind branches `installment_dunning` + `installment_plan_paid_in_full`).

**One trip publish RPC amendment (out of strict Stage 2 scope, deferred to backend-side follow-up):** Currently `trip_pricing_tiers.tier_metadata.installments` is validated at CHECKOUT (in `biz_ticket_checkout_create_session`, per ORCH-0869 Stage 1b). For Stage 2 the operator may configure invalid schedules in PaymentPlanEditor and only discover the error at publish or first buyer attempt. Stage 2 UI does client-side validation that catches the same conditions BEFORE save — but a defense-in-depth backend validation at trip publish is a follow-up. NOT in this SPEC's scope; flagged as Discovery #1 for orchestrator.

### 3.3 Service layer

#### 3.3.1 NEW: `mingla-business/src/services/orderInstallmentsService.ts`

```ts
export type OrderInstallmentStatus =
  | "scheduled"
  | "collected"
  | "failed"
  | "refunded"
  | "cancelled";

export type OrderInstallment = {
  id: string;
  orderId: string;
  ordinal: number;
  amountCents: number;
  currency: string;
  dueAt: string;            // ISO 8601 UTC
  status: OrderInstallmentStatus;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  collectedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  nextRetryAt: string | null;
};

export type OrderInstallmentForBrand = OrderInstallment & {
  buyerName: string;
  buyerEmail: string;
  orderTotalCents: number;
  orderAtRisk: boolean;
  orderAtRiskSince: string | null;
};

// Throws on error per services contract.
// Reads via brand-member RLS policy from ORCH-0869.
export async function fetchInstallmentsForOrder(
  orderId: string,
): Promise<OrderInstallment[]>;

// Reads via brand-member RLS policy; joins orders + auth.users (via auth.users_brand_member view if it exists, otherwise via separate buyer-name lookup).
// Returns 1 row per order_installment, with order-level + buyer-level fields joined for the Money tab row render.
export async function fetchInstallmentsForBrandTrips(
  brandId: string,
  opts?: { atRiskOnly?: boolean; tripEventId?: string },
): Promise<OrderInstallmentForBrand[]>;

// Calls biz_retry_installment RPC. Returns the RPC's jsonb response shape.
// Error contract: throws on transport/RLS/unknown errors; returns {ok: false, reason} for business-logic rejections (installment_not_found, installment_not_failed, unauthorized, order_not_found, event_not_found).
export async function retryInstallment(
  installmentId: string,
): Promise<{ ok: true; installmentId: string; scheduledForImmediateRetry: true } | { ok: false; reason: string; currentStatus?: string }>;
```

**Error contract per Mingla services rule:** services throw on transport / RLS / unknown errors. The `retryInstallment` function returns `{ok: false, reason}` for biz-logic rejections because the RPC itself returns this shape (per SPEC_ORCH-0869 §3.1 `biz_retry_installment` definition); preserving the shape lets the hook differentiate "RPC said no, here's why" from "the network is broken."

**Currency:** every returned `currency` value flows from the DB row; service does NOT format.

### 3.4 Hook layer

#### 3.4.1 NEW: `mingla-business/src/hooks/useOrderInstallments.ts`

```ts
// Query keys via existing query-key factory pattern.
// File: mingla-business/src/services/marketing/queryKeys.ts pattern (one factory per domain).
export const orderInstallmentKeys = {
  all: ["orderInstallments"] as const,
  byOrder: (orderId: string) =>
    [...orderInstallmentKeys.all, "byOrder", orderId] as const,
  byBrand: (brandId: string, opts?: { atRiskOnly?: boolean; tripEventId?: string }) =>
    [...orderInstallmentKeys.all, "byBrand", brandId, opts ?? {}] as const,
};

export function useInstallmentsForOrder(orderId: string | null): UseQueryResult<OrderInstallment[]>;
// staleTime: 30_000 (per SPEC_ORCH-0869 §3.4.1)
// enabled: orderId !== null
// queryKey: orderInstallmentKeys.byOrder(orderId ?? '')

export function useInstallmentsForBrandTrips(
  brandId: string | null,
  opts?: { atRiskOnly?: boolean; tripEventId?: string },
): UseQueryResult<OrderInstallmentForBrand[]>;
// staleTime: 30_000
// enabled: brandId !== null
// queryKey: orderInstallmentKeys.byBrand(brandId ?? '', opts)

export function useRetryInstallment(): UseMutationResult<
  Awaited<ReturnType<typeof retryInstallment>>,
  Error,
  string
>;
// onSuccess: queryClient.invalidateQueries({ queryKey: orderInstallmentKeys.all })
// onError: showToast({ kind: 'error', message: "Couldn't trigger retry. Try again." })
// onSuccess + result.ok === true: showToast({ kind: 'success', message: "Retry queued — next cron run will attempt it." })
// onSuccess + result.ok === false: showToast({ kind: 'warning', message: humanizeReason(result.reason) })
```

`humanizeReason` is a small inline mapper:
- `installment_not_found` → "Installment not found. Refresh and try again."
- `installment_not_failed` → "This installment doesn't need a retry right now."
- `unauthorized` → "You don't have access to retry this installment."
- `order_not_found` / `event_not_found` → "Couldn't load the booking. Refresh and try again."
- default → "Couldn't queue retry. Try again."

### 3.5 Component layer

#### 3.5.1 NEW: `mingla-business/src/components/trip/PaymentPlanEditor.tsx`

**Props:**
```ts
export type TripInstallmentSchedule = {
  deposit_pct: number;
  installments: Array<{
    ordinal: number;
    pct: number;
    days_after_booking?: number;
    fixed_date?: string;       // ISO date "YYYY-MM-DD" — UTC midnight semantics
  }>;
};

export interface PaymentPlanEditorProps {
  value: TripInstallmentSchedule | null;     // null when toggle is off
  onChange: (next: TripInstallmentSchedule | null) => void;
  totalAmountCents: number;                  // trip full price
  currency: string;                          // 3-letter code from trip
  /**
   * v1 only: locked=true renders read-only-with-banner state when at
   * least one buyer has booked under the current schedule. Implementor
   * resolves this from the parent (TripCreatorStep4Pricing reads
   * tripQuery.data.installmentBookingsCount or equivalent).
   */
  locked: boolean;
}
```

**Visual:** Mockup A inline form per DESIGN §3 Mockup A + sticky validation footer inside the editor card (borrowed from Mockup B per DESIGN §8 recommendation).

**States:**
- `locked === true` AND `value !== null` → render read-only banner state v3 (see Locked banner below) + collapsed schedule preview (Date | Amount rows, no controls).
- `locked === true` AND `value === null` → render disabled toggle with caption "Payment plan can be added only on trips before they're booked."
- `value === null` AND `!locked` → render toggle row only ("Payment plan" + native Switch off).
- `value !== null` AND `!locked` → render full editor: deposit row + N installment rows + "+ Add installment" + sticky validation footer.

**Locked banner copy (v3):**
> "Payment plan locked — at least one buyer has booked under this schedule. To change pricing, create a new trip."

**Interactions:**
- Toggle (native `Switch` or existing mingla-business toggle primitive): tap toggles. Toggle-on initial state: `{ deposit_pct: 25, installments: [{ ordinal: 1, pct: 50, days_after_booking: 30 }, { ordinal: 2, pct: 25, days_after_booking: 60 }] }` (3-installment default, sum=100). Toggle-off opens `ConfirmDialog` ("Remove payment plan? This trip will revert to single payment.") before destroying.
- Deposit % stepper: 5% increments (10..95 range), `accessibilityRole="adjustable"`, `accessibilityValue={{text: "${pct}%", min: 10, max: 95, now: pct}}`.
- Per-installment pct stepper: 5% increments (5..(95 - depositPct - otherInstallmentsTotal) range), `accessibilityRole="adjustable"`.
- Date-mode toggle: segmented control (2 segments: "Days after booking" | "Fixed date"), `accessibilityRole="tablist"`, per-segment `accessibilityRole="tab"` + `accessibilityState={{selected}}`.
- Days input (when mode="days_after_booking"): numeric input bounded 1..365, default 30 on first add, default `prev.days_after_booking + 30` on subsequent adds.
- Fixed-date input (when mode="fixed_date"): native date picker via `@react-native-community/datetimepicker` or equivalent already in mingla-business. Min date = today + 1 day. Default = today + 30 days (or `prev.fixed_date + 30 days`).
- Trash button per row: 44×44pt, `accessibilityLabel="Remove installment ${ordinal}"`, `accessibilityHint="Removes this installment; remaining installments will be re-numbered"`. Tap removes row, re-numbers remaining ordinals 1..N-1.
- "+ Add installment" button: full-width ghost button with `accent.warm` border + text. Disabled when `installments.length >= 11` (label changes to "Maximum 11 installments after deposit").
- Save action: NO explicit save button inside editor. Changes propagate live to `onChange` per stepper change. Parent's existing "Save and continue" Step 4 CTA persists.

**Validation (live, all 5%-step locked per Q8 resolution):**
- Sum check: `deposit_pct + sum(installments[].pct) === 100`. Error copy (in sticky footer): "Percentages must add to 100% (currently ${pctSum}%). ${'Add' if under else 'Remove'} ${|100 − pctSum|}% to balance." (red, `semantic.error`).
- Date monotonicity (when `fixed_date` mode used): `installments[i].dueAt < installments[i+1].dueAt`. Error copy (inline below offending row): "Installment ${i+2} due before installment ${i+1} — fix dates."
- Future-date check (when `fixed_date` mode): `installments[i].fixed_date > today`. Error copy: "Date must be in the future."
- `days_after_booking >= 1` check (when `days_after_booking` mode). Error copy: "Days after booking must be at least 1."
- Min installment count: 1 (toggle-on default is 1 installment minimum; can't delete last installment, trash button on the only remaining row is disabled with `accessibilityHint="At least one installment required"`).
- Max installment count: 11.

**Sticky validation footer (inside editor card, NOT screen-bottom):**
- When all validations pass: green check + "Adds to 100% · Total ${totalFormatted}" (`semantic.success`).
- When sum mismatch: red alert + sum-mismatch copy above.
- When date monotonicity error: red alert + first-error copy.
- Footer always visible inside card (uses `position: 'sticky'` on web; on RN native a regular bottom-of-card View).
- `accessibilityLiveRegion="polite"` so screen readers announce changes.

**Color tokens used:** per DESIGN §3 Mockup A — `accent.warm` for primary; `semantic.error` + `semantic.success` for validation; `glass.tint.profileElevated` for card surface; `text.primary` / `text.secondary` for labels; `radius.lg: 16` on card, `radius.md: 12` on inputs.

**File location:** `mingla-business/src/components/trip/PaymentPlanEditor.tsx`. Approx 280 LOC per DESIGN §8 estimate.

#### 3.5.2 NEW: `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx`

**Props:**
```ts
export interface InstallmentScheduleDisplayProps {
  /**
   * From session.installmentSchedule (computed by biz_ticket_checkout_create_session
   * per SPEC_ORCH-0869 §3.2.2). Null when trip has no installment plan.
   */
  schedule: {
    fullPriceCents: number;
    depositCents: number;
    currency: string;     // 3-letter code
    installments: Array<{ ordinal: number; pct: number; amountCents: number; dueAt: string }>;
  } | null;
  /**
   * "buyer" renders the buyer-facing layout per DESIGN §4 (reassurance copy below).
   * "planner" renders the same layout WITHOUT the reassurance copy (planner already knows).
   */
  variant: "buyer" | "planner";
}
```

**Visual:** Per DESIGN §4 mockup. 2-col layout (date label left, dollar amount right). Glass card container. Divider above Total row.

**Reassurance copy (variant="buyer" only, locked text):**
> "You're paying ${depositFormatted} today. The remaining ${remainingFormatted} will charge automatically on the dates above. We'll email you before each charge."

Centralized in `mingla-business/src/copy/installmentReassurance.ts` (new file) so the copy stays consistent across the 3 buyer-anon-web routes + can be enforced single-source by a strict-grep gate.

**States:**
- `schedule === null` → returns `null` (renders nothing).
- `schedule !== null` → renders the card.

**Date formatting:** `Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(installment.dueAt))` → "Jan 15, 2026". Deposit row uses literal "Deposit today" (not a formatted date).

**Currency formatting:** `Intl.NumberFormat(undefined, { style: "currency", currency: schedule.currency }).format(cents / 100)` per Constitution #10.

**File location:** `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx`. Approx 90 LOC.

#### 3.5.3 NEW: `mingla-business/src/copy/installmentReassurance.ts`

```ts
/**
 * ORCH-0873 [Tr3 Stage 2 UI] — single source of truth for the buyer-facing
 * installment-plan reassurance copy. Used by InstallmentScheduleDisplay
 * (variant="buyer") on all 3 buyer-anon-web checkout routes
 * (`/checkout/[eventId]/{index,buyer,payment}.tsx`).
 *
 * Locked at SPEC time. Future copy iteration → new ORCH.
 */
export function installmentReassuranceText(input: {
  depositFormatted: string;     // e.g. "$275.00"
  remainingFormatted: string;   // e.g. "$825.00"
}): string {
  return (
    `You're paying ${input.depositFormatted} today. ` +
    `The remaining ${input.remainingFormatted} will charge automatically ` +
    `on the dates above. We'll email you before each charge.`
  );
}
```

A new CI strict-grep gate `i-installment-reassurance-single-source.mjs` (DISC-1 follow-up; NOT shipped in this Stage 2 — register as polish ORCH if drift surfaces post-launch) would forbid any other file from containing the literal "will charge automatically on the dates above" substring.

#### 3.5.4 MODIFIED: `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx`

**Changes:**
- Add new props: `paymentPlan: TripInstallmentSchedule | null` + `onChangePaymentPlan: (next: TripInstallmentSchedule | null) => void` + `paymentPlanLocked: boolean` (parent resolves from trip data).
- Render `<PaymentPlanEditor value={paymentPlan} onChange={onChangePaymentPlan} totalAmountCents={priceCents} currency={currency} locked={paymentPlanLocked} />` below the existing single-price input section, in the same card or as a sibling card per existing layout convention.
- Existing currency display + price input untouched.
- Step 4 form submission: include `paymentPlan` in the wizard's `pricingState` shape (parent reducer extension).

#### 3.5.5 MODIFIED: `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (planner preview)

**Changes:**
- Add new prop: `installmentSchedule: InstallmentScheduleDisplayProps["schedule"]` (null when trip has no plan).
- Render `<InstallmentScheduleDisplay schedule={installmentSchedule} variant="planner" />` above the existing line-item summary section header.
- Empty case (schedule=null): component returns null, layout unchanged.

#### 3.5.6 MODIFIED: 3 buyer-anon-web routes (manual parity)

Each of `mingla-business/app/checkout/[eventId]/index.tsx`, `buyer.tsx`, `payment.tsx` gets its OWN render of `<InstallmentScheduleDisplay variant="buyer" schedule={session.installmentSchedule} />`. The `session.installmentSchedule` field is already returned by `biz_ticket_checkout_create_session` per SPEC_ORCH-0869 §3.2.2 Stage 1b amendment.

**Per-route placement:**
- `index.tsx` (Step 1 — ticket pick): above the Subtotal row, below the QuantityRow for the selected ticket type.
- `buyer.tsx` (Step 2 — buyer info): above the Order summary section header.
- `payment.tsx` (Step 3 — Stripe payment): above the existing Total line; **AND the Stripe-redirect CTA copy changes from "Pay ${totalFormatted}" to "Pay ${depositFormatted} deposit"** when `session.installmentSchedule !== null` (Q1 resolution). The Stripe Hosted Checkout button itself (Stripe's UI) is not touched — only the local app-side CTA label that triggers the Stripe redirect changes.

#### 3.5.7 MODIFIED: `mingla-business/app/trip/[id]/index.tsx` — Money tab

**Changes:**
- Extend `TabKey` type to `"overview" | "travelers" | "money"`.
- Add Money tab button in the tab bar between Travelers and the right edge: same `Pressable` pattern, `accessibilityRole="tab"`, `accessibilityState={{selected: tab === "money"}}`. Label: `Money` when `atRiskCount === 0`; `Money (${atRiskCount})` in `semantic.error` red when `atRiskCount > 0` (Q3 resolution).
- Add `tab === "money"` branch rendering per DESIGN §5.
- Use `useInstallmentsForBrandTrips(brandId, { tripEventId: eventId })` for the data.
- `atRiskCount` derived as `installments.filter(i => i.orderAtRisk).reduce(unique-by-orderId).length` (count of distinct AT-RISK bookings, not installments).

**Money tab states:**
- `installments === undefined` (loading): skeleton — 3 placeholder booking rows.
- `installments === null` OR query.isError: error state — "Couldn't load installments" + Retry button (refetch).
- `installments.length === 0`: empty state per DESIGN §5 empty-state: "No bookings on payment plans yet" + secondary copy + single CTA "Edit trip pricing" → deep-links to wizard (Q2 resolution — see §3.5.8).
- `installments.length > 0`: per-booking rows per DESIGN §5 collapsed/expanded states.
- Filter chip state: `filter === "all" | "atRisk"`; default "all".

**Per-booking row interactions:**
- Tap collapsed row → expand. `accessibilityState={{expanded}}`.
- Tap "Retry now" on a failed installment row → fires `useRetryInstallment(installmentId)` (NO confirm dialog per Q4 resolution). On success: success toast. On `{ok: false}`: warning toast. On error: error toast.
- Tap "Refund · coming in Tr4" (disabled stub per Q5 resolution): no action; tooltip "Refunds coming in Tr4" via accessibility-hint on platforms that support it (RN doesn't have a native tooltip; on touch the disabled button focuses and a sibling 12pt text "(Refunds coming in Tr4)" renders below it).

#### 3.5.8 Money tab empty-state CTA — Q2 resolution

The CTA "Edit trip pricing" deep-links to `router.push('/trip/[id]/edit?step=pricing')` ONLY IF `TripCreatorWizard` supports the `?step=` query param. The implementor's first action on this CTA is to grep `TripCreatorWizard.tsx` for `useLocalSearchParams<{step}>` — if NOT present, ship the CTA pointing to `/trip/[id]/edit` (wizard root, Step 1) and add a TODO comment `// [TRANSITIONAL] step=pricing query param NOT supported by TripCreatorWizard yet — register polish ORCH if operators ask`. The exit condition: a future small ORCH adds step deep-linking and updates this CTA target.

### 3.6 Realtime

Not in scope per SPEC_ORCH-0869 §3.6 — UNCHANGED for Stage 2. Money tab uses React Query polling (`staleTime: 30_000`) + pull-to-refresh + webhook-driven cache invalidation only.

---

## 4. Success Criteria

| # | Criterion |
|---|---|
| SC-1 | Trip wizard Pricing step shows a "Payment plan" toggle row below the single-price input. Toggle off = single full-price (current Tr2 behavior). Toggle on = `PaymentPlanEditor` renders below with default schedule (25% deposit + 2 installments at 50%/25% at 30/60 days). |
| SC-2 | `PaymentPlanEditor` accepts: deposit % (10–95, 5% steps), 1–11 future installments, each with pct (5% steps) + due-date mode (`days_after_booking` 1–365 OR `fixed_date` today+1..). Sum-validation: `deposit_pct + sum(installments[].pct) === 100`. Live error copy on violation (per §3.5.1 verbatim list). |
| SC-3 | Date-monotonicity validation (when ALL installments use `fixed_date` mode): each `installments[i+1].dueAt > installments[i].dueAt`. Live error copy on violation. **Stage 2 UI enforces monotonicity even though backend only checks first-past-due (QA-P3-1 follow-up).** |
| SC-4 | PaymentPlanEditor sticky validation footer always visible inside the editor card (NOT screen-bottom). Shows green check + "Adds to 100% · Total $X" when valid; red alert + sum-mismatch copy when invalid. `accessibilityLiveRegion="polite"`. |
| SC-5 | When `value !== null` AND `locked === true`, PaymentPlanEditor renders read-only banner state v3 ("Payment plan locked — at least one buyer has booked under this schedule. To change pricing, create a new trip.") with collapsed Date \| Amount preview rows and NO interactive controls. |
| SC-5a | Buyer on `/checkout/[eventId]/index.tsx` sees `<InstallmentScheduleDisplay variant="buyer">` above the Subtotal row when the session has `installmentSchedule !== null`. Reassurance copy renders below the card. |
| SC-5b | Buyer on `/checkout/[eventId]/buyer.tsx` sees the same display above the Order summary section header. |
| SC-5c | Buyer on `/checkout/[eventId]/payment.tsx` sees the same display above the Total line AND the Stripe-redirect CTA copy reads "Pay ${depositFormatted} deposit" (not "Pay ${totalFormatted}"). |
| SC-6 | `TripCheckoutFlow.tsx` planner preview renders `<InstallmentScheduleDisplay variant="planner">` above the line-item summary when trip has installment plan. Reassurance copy NOT shown in planner variant. |
| SC-7 | Trip dashboard `app/trip/[id]/index.tsx` tab bar shows 3 tabs: Overview \| Travelers (N) \| Money. Money tab label includes at-risk count in `semantic.error` red when > 0: "Money (1)". |
| SC-8 | Money tab loading state: skeleton with 3 placeholder booking rows. Error state: "Couldn't load installments" + Retry button. Empty state: per §3.5.8 empty-state copy + CTA "Edit trip pricing". |
| SC-9 | Money tab populated state: per-booking rows grouped by `orders` row where `installment_plan_root=true`. Sorted by `orderAtRisk DESC, nextDueAt ASC` (at-risk on top, soonest-due next). Collapsed row shows traveler name + "${paid}/${total} installments paid · $${collected}" + expand caret. At-risk bookings get leading red `⚠ At risk` pill. |
| SC-10 | Money tab expanded row: full installment ledger with 4-col layout (label, amount, status pill, due date). Status pills: `scheduled` (gray Clock), `collected` (green Check `semantic.success`), `failed` (red X `semantic.error`), `refunded` (blue ArrowLeft `semantic.info`), `cancelled` (gray Minus). Failed rows get a sub-row with `failure_reason` (humanized) + "Retry now" button. |
| SC-11 | "Retry now" button visible ONLY on `status='failed'` rows. Tap calls `useRetryInstallment(installmentId)` mutation immediately (NO confirm dialog). On success: toast "Retry queued — next cron run will attempt it." On `{ok:false}`: warning toast humanized per §3.4.1. On error: toast "Couldn't trigger retry. Try again." Row re-renders after mutation invalidates cache. |
| SC-12 | "Refund" CTA on every expanded row is disabled with "Refunds coming in Tr4" sub-text. Tapping does nothing. `accessibilityState={{disabled: true}}`. |
| SC-13 | Money tab filter chips: "All bookings · ${count}" + "At risk · ${atRiskCount}" (the latter only renders when `atRiskCount > 0`, with `accent.warm` border + text). Tapping toggles the filter. Filter state local to the Money tab; resets on tab switch. |
| SC-14 | All currency formatting uses `Intl.NumberFormat(undefined, {style: 'currency', currency: schedule.currency})`. No hardcoded `$`. No fallback locale assumption (per Constitution #10). |
| SC-15 | All date formatting uses `Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric', year: 'numeric'})`. |
| SC-16 | Existing non-installment trip checkout flow unchanged: `<InstallmentScheduleDisplay schedule={null}>` returns `null`; `<PaymentPlanEditor value={null}>` renders only the toggle row (off); no `order_installments` rows created (verified at backend, unchanged from ORCH-0869). |
| SC-17 | Existing non-installment event checkout flow unchanged: events have no `trip_pricing_tiers` entry; `session.installmentSchedule` is always `null`; both checkout flows render their pre-Stage-2 layouts. |
| SC-18 | PaymentPlanEditor in `locked=true` state: zero interactive controls; preview rows show "${dateLabel}  ${amount}" pattern; banner copy verbatim per §3.5.1 v3. `accessibilityRole="region"` on the container. |
| SC-19 | All interactive elements pass I-38 (44pt touch min) + I-39 (accessibilityLabel coverage). `accessibilityValue` on every stepper. Validation copy `accessibilityLiveRegion="polite"`. |
| SC-20 | Two new CI strict-grep gates (§5 invariants) report 0 violations on the closing PR. |

---

## 5. Invariants

### Preserved (no violations expected)

- `I-PROPOSED-J` (Zustand persist no server snapshots) — `useInstallmentsForOrder` + `useInstallmentsForBrandTrips` are React Query; no Zustand storage of installment ledger rows.
- `I-PROPOSED-K` (require-cycles baselined) — new files do not introduce import cycles.
- `I-PROPOSED-M` (persist-key whitelist sync) — no persist keys added.
- `I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES` — Money tab inherits SafeArea from `app/trip/[id]/index.tsx` parent route; PaymentPlanEditor inherits from `TripCreatorWizard` parent route. No new full-screen routes added.
- `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` — no route changes.
- `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` (ACTIVE from ORCH-0869 close) — no new PaymentIntent creation sites.
- `I-PROPOSED-TR3-LEDGER-INVARIANT-COLLECTED-IMPLIES-PI-ID` (DRAFT, enforced by SQL CHECK from ORCH-0869) — preserved; UI reads ledger, doesn't write.
- `I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES` (ORCH-0837) — no PI creation; preserved.
- `I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST` (ORCH-0849) — same.
- `I-CHECKOUT-IDEMPOTENT` — no checkout-session creation; preserved.

### New invariants flipping DRAFT → ACTIVE on this CLOSE

#### I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY

**Rule.** No code path may delete a connected-account Stripe Customer that has any `order_installments` rows with `status='scheduled'` for orders bound to that Customer. No code path may revoke a saved PaymentMethod that's the active PM for an order with pending installments.

**Why.** Installment auto-charges depend on the saved Customer + PaymentMethod persisting for the full schedule duration (could be 6+ months). Deleting the Customer mid-schedule breaks every future installment for that order — silent state divergence between Stripe (no customer) and Mingla (still expecting to charge).

**Enforcement (new CI gate, this CLOSE):** `.github/scripts/strict-grep/i-proposed-tr3-installment-customer-durability.mjs`.

Gate logic:
1. Scan `supabase/functions/**` for `stripe.customers.del(` and `stripe.paymentMethods.detach(` calls.
2. For each call site, verify ONE of:
   - (a) A precheck comment within 10 lines above documenting "verified no scheduled order_installments for this Customer" with the exact SQL probe shown (e.g., `// orch-strict-grep-allow tr3-installment-customer-durability — precheck: SELECT count(*) FROM order_installments WHERE order_id IN (SELECT id FROM orders WHERE stripe_customer_id_on_connected_account = ${cust}) AND status='scheduled' = 0 (verified at file:line)`).
   - (b) An allowlist comment within 5 lines above: `// orch-strict-grep-allow tr3-installment-customer-durability — <reason>`.
3. If neither, FAIL the gate.

Exit codes: 0 clean, 1 violation. Wire into `.github/workflows/strict-grep-mingla-business.yml` as a new job `i-proposed-tr3-installment-customer-durability`.

**Initial scan result expected:** 0 violations (no existing call sites match this pattern in the codebase as of 2026-05-18).

#### I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH

**Rule.** All `order_installments` rows for a given `order_id` MUST share the same `currency`. Stage 1b finalize RPC (live in production from ORCH-0869) writes all rows with `v_inst_currency := COALESCE((v_schedule->>'currency')::char(3), v_session.currency)` — single source per finalize call. The rule is preserved by the existing migration; this gate prevents a future code path from violating it.

**Why.** Per investigation O-5 — no currency mixing within one schedule; matches WeTravel behavior; simplifies Tr4 refund math (one currency per order).

**Enforcement (new CI gate, this CLOSE):** `.github/scripts/strict-grep/i-proposed-tr3-schedule-currency-pinned-at-publish.mjs`.

Gate logic (source-assertion, since SQL-level constraints are already in place via the finalize RPC):
1. Scan `supabase/migrations/**` and `supabase/functions/**` for any `INSERT INTO order_installments` or `INSERT INTO public.order_installments` statement.
2. For each, verify the currency column value is sourced from ONE OF:
   - (a) `v_session.currency` or `session.currency` (single source per finalize call).
   - (b) `(v_schedule->>'currency')` cast / `schedule.currency` (single source per schedule).
   - (c) An allowlist comment within 5 lines above: `// orch-strict-grep-allow tr3-schedule-currency-pinned — <reason>`.
3. If the INSERT uses a per-row varying currency (e.g., `v_inst_item->>'currency'` inside a loop), FAIL the gate.

Exit codes: 0 clean, 1 violation. Wire into `.github/workflows/strict-grep-mingla-business.yml` as new job `i-proposed-tr3-schedule-currency-pinned-at-publish`.

**Initial scan result expected:** 0 violations. The Stage 1b migration uses `v_inst_currency` (single source) inside the loop — passes.

---

## 6. Test Cases

| # | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Toggle on default schedule | Tap Payment plan toggle | Editor renders with 25%/50%/25% default at 30/60 days; sticky footer shows green check + Total | Component |
| T-02 | Sum mismatch — under | Set deposit=20, inst1=50, inst2=25 (sum=95) | Sticky footer red + "Add 5% to balance" | Component (validation) |
| T-03 | Sum mismatch — over | Set deposit=30, inst1=40, inst2=40 (sum=110) | Sticky footer red + "Remove 10% to balance" | Component (validation) |
| T-04 | Date monotonicity violation | inst1 fixed_date=Jan 30; inst2 fixed_date=Jan 15 | Inline error below inst2: "Installment 2 due before installment 1 — fix dates." | Component (validation) |
| T-05 | Past-date fixed_date | inst1 fixed_date=yesterday | Inline error below inst1: "Date must be in the future." | Component (validation) |
| T-06 | Max installments reached | Add 11 installments | "+ Add installment" disabled with label "Maximum 11 installments after deposit." | Component |
| T-07 | Min installments enforced | Try to delete the only remaining installment | Trash button disabled, `accessibilityHint="At least one installment required"` | Component |
| T-08 | Toggle off with confirm | Toggle off when value !== null | ConfirmDialog "Remove payment plan? This trip will revert to single payment." Confirm destroys schedule, Cancel preserves. | Component |
| T-09 | Locked state v3 banner | Render with `locked=true value!==null` | Read-only banner + preview rows, zero interactive controls | Component |
| T-10 | Buyer schedule render — index.tsx | Trip has installment plan; buyer lands on Step 1 | `<InstallmentScheduleDisplay variant="buyer">` above subtotal; reassurance copy below | Route SC-5a |
| T-11 | Buyer schedule render — buyer.tsx | Trip has plan; buyer on Step 2 | Same display above order summary | Route SC-5b |
| T-12 | Buyer schedule render — payment.tsx + CTA copy | Trip has plan; buyer on Step 3 | Display rendered AND Stripe-redirect CTA reads "Pay $X deposit" | Route SC-5c |
| T-13 | Non-installment buyer unchanged | Trip has NO installment plan | All 3 routes render pre-Stage-2 layout; no schedule card; CTA copy "Pay $X" unchanged | Regression |
| T-14 | Planner preview schedule | Trip has plan; TripCheckoutFlow renders | `variant="planner"` displays schedule WITHOUT reassurance copy | Component |
| T-15 | Money tab visible | Brand member opens /trip/{id} | Tab bar shows Overview \| Travelers \| Money | Component |
| T-16 | Money tab at-risk badge in label | 1 order is `at_risk=true` | Tab label "Money (1)" in `semantic.error` red | Component |
| T-17 | Money tab loading state | First mount, query pending | 3 skeleton booking rows | Component |
| T-18 | Money tab error state | Force RLS denial | "Couldn't load installments" + Retry button refetches | Component (error) |
| T-19 | Money tab empty state | Brand with zero installment-plan bookings | Empty-state copy + CTA "Edit trip pricing" | Component (empty) |
| T-20 | Money tab populated + sort | 5 bookings, 1 at-risk | At-risk on top; others sorted by `nextDueAt ASC` | Component |
| T-21 | Money tab booking row expand | Tap collapsed row | Row expands to show full installment ledger | Component |
| T-22 | Retry button on failed row | Tap "Retry now" on failed row | Mutation fires; success toast "Retry queued — next cron run will attempt it."; row stays expanded; refetch invalidates | Component + Hook |
| T-23 | Retry button on non-failed row | Inspect scheduled/collected rows | NO Retry button rendered | Component |
| T-24 | Retry error handling | Mock mutation rejects | Error toast "Couldn't trigger retry. Try again." | Hook |
| T-25 | Retry biz-logic rejection | Mock returns `{ok:false, reason:"installment_not_failed"}` | Warning toast "This installment doesn't need a retry right now." | Hook |
| T-26 | Refund stub disabled | Inspect every expanded row | Refund button rendered disabled; sub-text "(Refunds coming in Tr4)" | Component |
| T-27 | Filter chip toggle — At risk | Tap "At risk" chip | List filters to at-risk bookings only; chip styled selected | Component |
| T-28 | Currency formatting | Trip in GBP | All amounts render with £; no hardcoded $ anywhere | Component (currency) |
| T-29 | Date formatting | Trip in en-US locale | "Jan 15, 2026" format; in en-GB "15 Jan 2026" | Component (date) |
| T-30 | I-38 + I-39 gate | Run existing strict-grep gates against Stage 2 files | 0 violations | CI |
| T-31 | New CI gate — customer durability | Run new gate against current tree | 0 violations | CI |
| T-32 | New CI gate — schedule currency pinned | Run new gate against current tree | 0 violations | CI |
| T-33 | Cross-surface parity — iOS sim | Run Maestro flow on iOS sim | PaymentPlanEditor + Money tab render identically | Cross-platform |
| T-34 | Cross-surface parity — Android emu | Run Maestro flow on Android emu | Same as iOS | Cross-platform |
| T-35 | Cross-surface parity — Web preview | Open business-web preview, navigate | Same renders; native Switch fallback to web checkbox | Cross-platform |
| T-36 | End-to-end with Stripe test clock | Configure trip with installments via UI → buyer purchases → fast-forward 30d → installment fires | order_installments rows created via finalize (Stage 1b); cron charges installment 1 via Stripe test clock; status flips to `collected`; Money tab shows updated status after refresh | E2E |

---

## 7. Implementation Order

1. **Shared copy constant** `mingla-business/src/copy/installmentReassurance.ts` (NEW).
2. **Service** `mingla-business/src/services/orderInstallmentsService.ts` (NEW) with the 3 exports + Jest test.
3. **Hook** `mingla-business/src/hooks/useOrderInstallments.ts` (NEW) with the 3 hooks + Jest test (mock service).
4. **InstallmentScheduleDisplay component** (NEW) + Jest test (snapshot for buyer + planner variants).
5. **PaymentPlanEditor component** (NEW) + Jest test (validation paths + locked state + max/min count).
6. **MODIFIED TripCreatorStep4Pricing.tsx** — add toggle + render editor + wire `paymentPlan` into wizard reducer.
7. **MODIFIED TripCheckoutFlow.tsx** — render planner preview display.
8. **MODIFIED 3 buyer-anon-web checkout routes** — render buyer display + (on payment.tsx) Stripe CTA copy change.
9. **MODIFIED app/trip/[id]/index.tsx** — extend `TabKey`, add Money tab branch.
10. **2 new CI strict-grep gates** (`i-proposed-tr3-installment-customer-durability.mjs` + `i-proposed-tr3-schedule-currency-pinned-at-publish.mjs`) + wire into `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern.md`.
11. **Implementor regression test** (1 happy-path Jest covering SC-1 + SC-2 + SC-5a + SC-10 + SC-11, fails-on-revert verified).
12. **Implementation report** with old→new receipts per ORCH-0840 requirement.

---

## 8. Regression Prevention

**Bug class being prevented:** silent state divergence between Stripe (charged) and Mingla (no ledger), AND mid-schedule currency mixing.

| Structural safeguard | What it prevents |
|---|---|
| `I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY` CI gate | Future code path that deletes a Stripe Customer or detaches a saved PM without checking for pending installments |
| `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH` CI gate | Future code path that inserts order_installments rows with per-row currency from JSONB (instead of session-level pinned currency) |
| Centralized `installmentReassuranceText` copy | Drift across the 3 buyer-anon-web routes when copy iterates |
| `PaymentPlanEditor.locked=true` read-only banner | Operator-side schema mutation that would invalidate already-booked schedules |
| SPEC-locked 5% step on % steppers | Floating-point edge cases at backend QA P3-2 tolerance boundary |
| SPEC-locked date monotonicity at UI layer | UI shipping past-due ordinal-2+ schedules that backend's first-only check would silently accept |

---

## 9. Cross-Skill Notes

### For Codex `implementor-mingla` (or Claude `mingla-implementor`)

- Cite `Mingla_Artifacts/design/DESIGN_ORCH-0873_TR3_STAGE_2_UI.md` in the implementation report (per `feedback_implementor_uses_ui_ux_pro_max.md`).
- Compose from existing mingla-business primitives only: `Button`, `Input`, `Pill`, `Modal` (for ConfirmDialog), `GlassCard`, `IconChrome`, `Toast` (wrapped per `feedback_toast_needs_absolute_wrap.md`), `EmptyState`.
- Use Lucide icons (Plus, Trash2, ChevronDown, AlertCircle, Clock, Check, X, Minus, ArrowLeft) IF Lucide is already installed in mingla-business; otherwise use existing icon set + note swap as a follow-up.
- All currency formatting via `Intl.NumberFormat` per Constitution #10.
- All date formatting via `Intl.DateTimeFormat`.
- `accessibilityLabel` on every interactive element per I-39.
- 44pt min touch per I-38.
- 5%-step steppers (Q8 locked).
- NO `?step=pricing` query param in TripCreatorWizard CTA UNLESS the wizard already supports it (TODO comment + [TRANSITIONAL] marker if not).
- NO `os.uname` / `process.env` / native module additions — pure JS only.

### For Claude `mingla-tester` (canonical TEST owner)

- 36 test cases mapped above (T-01 → T-36).
- Cross-surface parity MANUAL on 3 buyer-anon-web routes per SC-5a/5b/5c — verify each route renders InstallmentScheduleDisplay correctly via Playwright on web preview (the SAME pattern as ORCH-0869 Stage 1b implementor smoke).
- Money tab IA on iOS sim + Android emu via Maestro flow (`mingla-business/maestro/orch-0873-money-tab.yaml` — implementor produces, tester runs).
- Stripe test clock end-to-end (T-36): configure trip → buy → fast-forward 30d → installment fires → verify ledger + Money tab + cron probe.
- Adversarial test angle: pin the SHARED copy constant (drift detector), pin the 5%-step lock at component layer (prevent operator-elected drift to 1% in a future polish PR without spec amendment), pin the Stripe CTA copy literal "${depositFormatted} deposit" on payment.tsx.
- Per ORCH-0840 regression-test gate: implementor ships happy-path test (T-22 retry button + T-10/T-11/T-12 cross-route render); tester ships adversarial test (different angle — copy drift + step-size lock + at-risk-count sort order).

### For Codex `orchestrator-mingla` (CLOSE)

- One PR per CLOSE rule applies. Stage 2 ships independently of ORCH-0872 [Stage 1c] unless operator pre-authorizes a bundle.
- 2 new CI gates flip 2 DRAFT invariants to ACTIVE on close.
- EAS OTA REQUIRED on close — Stage 2 ships JS-only mobile/business changes. iOS + Android both. EAS OTA-eligible (no native module added).
- Update `INVARIANT_REGISTRY.md` with the 2 ACTIVE flips.
- Update `WORLD_MAP.md` ORCH-0873 row to `closed | A`.
- Carry-forward deferrals: ORCH-0867 [View public page button], ORCH-0868 [forwardRef RedBox], ORCH-0872 [Stage 1c] remain open after this close.

---

## 10. Open Questions Resolution (from DESIGN §9)

All 8 open questions resolved per the design's recommendations + this SPEC's confirmations. Operator may override any of these before implementor dispatch by replying with override note; otherwise implementor builds per SPEC.

| Q# | Design recommendation | SPEC resolution |
|---|---|---|
| Q1 | YES — Stripe CTA copy changes on `payment.tsx` to "Pay $X deposit" | **Locked.** SC-5c codifies. |
| Q2 | Money tab empty-state CTA deep-links to `/trip/[id]/edit?step=pricing` | **Conditional lock.** §3.5.8 — if wizard supports step deep-link, use it; otherwise wizard root + `[TRANSITIONAL]` marker. |
| Q3 | YES — at-risk count shows in Money tab label red | **Locked.** SC-7 codifies. |
| Q4 | NO confirm dialog on Retry button | **Locked.** SC-11 codifies (immediate fire + toast). |
| Q5 | KEEP Refund stub visible-but-disabled | **Locked.** SC-12 codifies. |
| Q6 | YES — pricing schedule locked after first booking | **Locked.** §1 non-goals + SC-5 + SC-18 codify the read-only-banner state. |
| Q7 | `trip.currency` available at PaymentPlanEditor mount | **Verified.** TripCreatorStep4Pricing already receives `currency` prop (existing code at line 41). |
| Q8 | 5%-step lock at v1 | **Locked.** SC-2 codifies. Operator-requested finer steps → future ORCH. |

---

## 11. Discoveries for Orchestrator

1. **Defense-in-depth backend validation at trip publish** (deferred): Currently `trip_pricing_tiers.tier_metadata.installments` is validated at CHECKOUT in `biz_ticket_checkout_create_session` (per ORCH-0869 Stage 1b). Stage 2 UI client-side validation catches the same conditions BEFORE save, so the production gap is small — but a defense-in-depth backend validation at trip publish (in `biz_event_publish_v2` or trip-specific publish RPC) would catch operator SQL-direct mutations that bypass the UI. Register as future polish ORCH if operators ever direct-mutate `tier_metadata.installments` via SQL post-launch.

2. **TripCreatorWizard step deep-link support** (Q2 conditional): may be missing today. Implementor should grep `useLocalSearchParams<{step}>` on `TripCreatorWizard.tsx` during Stage 2 work. If missing, ship the `[TRANSITIONAL]` marker per §3.5.8 and register a small polish ORCH "TripCreatorWizard step deep-link" that adds `?step=pricing` support.

3. **`installmentReassuranceText` single-source CI gate** (DISC-1 in design): not shipped in Stage 2 (the copy is centralized in `installmentReassurance.ts`); a strict-grep gate forbidding the literal "will charge automatically on the dates above" elsewhere is a polish ORCH if drift surfaces post-launch.

4. **Travelers tab filter pattern**: design §10 discovery #2 — the at-risk filter-chip pattern from Money tab could generalize to a Travelers tab "show all unpaid" or "show door-sales only" filter. Register as polish ORCH if operators ask.

5. **DatePicker primitive consolidation**: Trip Wizard Step 1 uses one date picker; Pricing's `fixed_date` mode introduces another. Implementor should reuse the Step 1 component if shape allows; otherwise audit + consolidate is a separate polish ORCH.

6. **Stage 1c (ORCH-0872) should ship BEFORE Stage 2 UI launches to operators** (soft order). Stage 2 makes installment plans configurable in-product; Stage 1c closes the secondary-finalize-callers gap that creates silent state divergence on rare recovery paths. If Stage 2 ships first and a buyer hits a `reconcile-stuck-checkouts` or `ticket-checkout-confirm` recovery on an installment-plan deposit, the order is created without ledger rows. Operator should sequence the CLOSEs: ORCH-0872 → ORCH-0873.

7. **2 new invariants flipping ACTIVE on this CLOSE** + 1 invariant (`I-PROPOSED-TR3-LEDGER-INVARIANT-COLLECTED-IMPLIES-PI-ID`) remaining DRAFT (enforced at SQL CHECK from ORCH-0869, no CI mirror needed). Track in `INVARIANT_REGISTRY.md` at CLOSE.

8. **EAS OTA-eligible** (no native module added). Pure JS mobile/business changes. Standard EAS update post-close.

---

## 12. Confidence Level

**H — High** for the core success criteria (SC-1..SC-20), the 2 new CI gates, and the test plan (T-01..T-36). All grounded in DESIGN_ORCH-0873 visual contract + SPEC_ORCH-0869 functional contract.

**M — Medium** for:
- Q2 wizard step deep-link (conditional on TripCreatorWizard support — implementor will discover at build time).
- Money tab filter chip count semantics (count distinct at-risk bookings vs at-risk installments — SPEC locks at distinct bookings; tester should verify on Stripe test clock).
- Date picker shared primitive vs new picker (implementor decision).

**L — Low** for: nothing in this SPEC.

---

## 13. Pipeline next

Per Canonical Pipeline Routing + this SPEC §9:

1. **Codex `implementor-mingla`** (default — UI work) implements per SPEC §7 order. Cites DESIGN_ORCH-0873 in the implementation report. Produces `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0873_TR3_STAGE_2_UI.md`.
2. **Operator** runs no DB push (no migration); reviews the implementation; Codex deploys no edge functions (UI-only).
3. **Claude `mingla-tester`** runs 36-test matrix + cross-surface parity per `feedback_tester_canonical_and_platform_parity.md`. Produces `Mingla_Artifacts/reports/QA_ORCH-0873_TR3_STAGE_2_UI_REPORT.md`.
4. **Codex `orchestrator-mingla`** OR **Claude `mingla-orchestrator`** CLOSE per One-PR-per-CLOSE rule. Flip 2 invariants DRAFT → ACTIVE. Update WORLD_MAP, CLOSE note. Operator runs EAS OTA post-merge for iOS + Android.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

End of spec.

# SPEC — ORCH-0914 [Trip Money tab redesign — organiser visibility into each traveller's payment-plan progress]

**Author:** Claude `mingla-orchestrator` operating as forensics (operator delegation via "take over"; full Claude/Codex parity)
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0914_TRIP_MONEY_TAB_REDESIGN.md`
**Operator decisions Q1–Q7:** LOCKED (see §2.3 below)
**Severity:** S1-high · **Classification:** `missing-feature` + `ux`

---

## 1. Layman summary

Redesigns `mingla-business/app/trip/[id]/money/index.tsx` from a stack of expandable per-traveller cards into a responsive 5-column table (Plan / Paid-to-date / Outstanding / Next installment / Last-charge status) with two new operator actions ("Charge now" — immediate Stripe charge; "Send reminder" — email + best-effort push to traveller). Phone renders each row as a card-with-labels grid; tablet/web renders true horizontal table. Pay-in-full buyers (post-ORCH-0915) included with `Plan = "Paid in full"`. Two new edge functions + 1 new migration + 3 new hooks; ZERO schema change to `order_installments`. Single-owner installment-PI invariant from ORCH-0869 preserved via shared `_shared/installments/createInstallmentPI.ts` helper that BOTH the existing cron AND the new on-demand endpoint invoke.

---

## 2. Scope + Non-goals + Assumptions + Operator decisions

### 2.1 Scope (IN)

1. Redesign per-traveller row layout in `mingla-business/app/trip/[id]/money/index.tsx` to responsive 5-column table.
2. Add explicit columns: Plan, Paid-to-date, Outstanding, Next installment (date + amount), Last-charge status.
3. Preserve existing: per-traveller drill-in (expand to installment grid), filter chips (All bookings / At-risk), Cancel & refund flow, `RefundPreviewSheet`.
4. Add **"Charge now"** action — immediate Stripe charge on `scheduled` OR `failed` installments.
5. Add **"Send reminder"** action — Resend email primary + OneSignal push best-effort, rate-limited 1 per buyer per 24h.
6. Pre-handle pay-in-full row variant (`Plan = "Paid in full"`) so ORCH-0915 lands cleanly without further redesign.
7. Extract cron's per-installment PI-creation block into `_shared/installments/createInstallmentPI.ts` shared helper (single-owner invariant preservation).
8. NEW edge function `manual-charge-installment` invoking the shared helper.
9. NEW edge function `send-installment-reminder` enforcing rate-limit + delivering via Resend + OneSignal.
10. NEW migration creating `manual_buyer_reminders` table (rate-limit ledger) + 2 audit_log slug additions.
11. NEW Resend template `_shared/email/installmentReminderEmail.ts`.
12. NEW strict-grep gate `i-proposed-manual-installment-action-via-shared-helper.mjs`.
13. Implementor happy-path tests + tester adversarial tests + new gate functional test (per ORCH-0840 Step 0.5).

### 2.2 Non-goals (OUT)

- **NOT redesigning the Money tile on the trip dashboard.** ORCH-0913 + ORCH-0913-A already shipped that. Money TILE behaviour unchanged.
- **NOT touching the cron `process-scheduled-installments` LOGIC.** Only EXTRACTING the per-installment block into a shared helper; the cron continues to invoke the helper exactly as it does today.
- **NOT changing `order_installments` or `orders` schema.** Every column needed is derivable from existing fields.
- **NOT touching RLS on `order_installments` or `orders`.** Reads continue via existing brand-team-member predicate.
- **NOT shipping admin-web parity.** DISC-0914-2 — admin support tooling deferred to a future ORCH if needed.
- **NOT shipping pay-in-full buyer-side opt-out** — that's ORCH-0915. This SPEC only handles the ROW VARIANT in the Money table so the table is ready when 0915 lands.
- **NOT changing `useRetryInstallment` semantics** — the existing "Retry now" button on FAILED installments stays as-is (queues for cron). "Charge now" is a different action with different mechanics.
- **NOT changing automatic dunning emails fired by the cron** — those keep firing on automatic failure-detection. "Send reminder" is operator-initiated and orthogonal.

### 2.3 Operator decisions LOCKED (Q1–Q7)

| ID | Decision |
|---|---|
| Q1 | Last-charge status = **At-risk → most-recent-attempted → scheduled** |
| Q2 | Charge-now on at-risk buyers = **Allowed with second-confirm dialog** (`"Buyer is at-risk — proceeding anyway?"`) |
| Q3 | Send-reminder rate-limit = **1 per buyer per 24h** via `manual_buyer_reminders` table |
| Q4 | Reminder channel = **Email primary (Resend) + best-effort push (OneSignal)** |
| Q5 | Reminder template = **New dedicated template** at `supabase/functions/_shared/email/installmentReminderEmail.ts` |
| Q6 | Phone layout = **Responsive — card-with-labels on phone, true table on tablet/web** |
| Q7 | Pay-in-full buyers = **Include in same table** with `Plan = "Paid in full"` row variant |

### 2.4 Assumptions

- A1. `OrderInstallmentForBrand` shape (`orderInstallmentsService.ts:44–50`) is the canonical contract; no field additions needed for any column or action.
- A2. `process-scheduled-installments` cron's per-installment PI-creation block is extractable into a single `_shared/installments/createInstallmentPI.ts` function with signature `createInstallmentPI({ installmentId, brandId, override?: { atRisk?: boolean } }) => Promise<{ ok: boolean; chargeId?: string; error?: string }>`. Implementor confirms during Phase 1.
- A3. Resend integration per ORCH-0785 covers the new `installmentReminderEmail.ts` template — same `_shared/email/types.ts` pattern + same Resend client.
- A4. OneSignal integration is available for push best-effort via existing notification dispatch substrate (per ORCH-0788).
- A5. `audit_log` table accepts new slugs `INSTALLMENT_CHARGED_MANUALLY` + `INSTALLMENT_REMINDER_SENT` per ORCH-0806 slug-resolver pattern.
- A6. `brand_team_members` permission `MANAGE_INSTALLMENTS` (or fallback to existing `EDIT_EVENT` if no installment-specific permission exists) gates the two new actions.

---

## 3. Layer-by-layer specification

### 3.1 Database layer

#### 3.1.1 NEW table `manual_buyer_reminders`

**Migration file:** `supabase/migrations/<timestamp>_orch_0914_manual_buyer_reminders.sql`

```sql
-- ORCH-0914 [Trip Money tab redesign] — operator-initiated reminder ledger.
-- Enforces rate-limit of 1 reminder per buyer per 24h via the unique partial index
-- on (order_id) WHERE sent_at > now() - interval '24 hours'. Brand-team-member
-- RLS read predicate mirrors order_installments policy.

CREATE TABLE public.manual_buyer_reminders (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by_user_id uuid NOT NULL REFERENCES auth.users(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  delivery_results jsonb NOT NULL DEFAULT '{}'::jsonb, -- {"email": "sent" | "failed" | "skipped", "push": "sent" | "failed" | "skipped"}
  CONSTRAINT manual_buyer_reminders_order_brand_fk CHECK (true) -- placeholder, see RLS below
);

-- Index supporting the rate-limit lookup
CREATE INDEX idx_manual_buyer_reminders_order_recent
  ON public.manual_buyer_reminders (order_id, sent_at DESC);

-- RLS: brand-team-members of the order's brand can read; only the service
-- role + the edge function (via SECURITY DEFINER RPC) can insert
ALTER TABLE public.manual_buyer_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY manual_buyer_reminders_brand_member_read ON public.manual_buyer_reminders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_team_members btm
      WHERE btm.brand_id = manual_buyer_reminders.brand_id
      AND btm.user_id = auth.uid()
      AND btm.accepted_at IS NOT NULL
      AND btm.removed_at IS NULL
    )
  );

-- INSERT only via the SECURITY DEFINER RPC below; no direct policy for INSERT.

-- RPC: enforces rate-limit + brand-team-member auth + audit-log write
CREATE OR REPLACE FUNCTION public.biz_send_installment_reminder(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_brand_id uuid;
  v_recent_count int;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Resolve brand from order + verify brand-team-member
  SELECT e.brand_id INTO v_brand_id
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  WHERE o.id = p_order_id;

  IF v_brand_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.brand_team_members
    WHERE brand_id = v_brand_id AND user_id = v_user_id
    AND accepted_at IS NOT NULL AND removed_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  -- Rate-limit: 1 per buyer per 24h
  SELECT COUNT(*) INTO v_recent_count
  FROM public.manual_buyer_reminders
  WHERE order_id = p_order_id
  AND sent_at > now() - interval '24 hours';

  IF v_recent_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  -- Insert ledger row (delivery_results filled later by edge function)
  INSERT INTO public.manual_buyer_reminders (order_id, sent_by_user_id, brand_id)
  VALUES (p_order_id, v_user_id, v_brand_id);

  -- Audit log
  INSERT INTO public.audit_log (actor_user_id, action_slug, target_table, target_id, metadata)
  VALUES (
    v_user_id,
    'INSTALLMENT_REMINDER_SENT',
    'orders',
    p_order_id,
    jsonb_build_object('brand_id', v_brand_id)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.biz_send_installment_reminder(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_send_installment_reminder(uuid) TO authenticated;
```

#### 3.1.2 NEW RPC `biz_manual_charge_installment`

Similar shape to `biz_retry_installment` (per ORCH-0869 pattern) but adds:
- `p_atrisk_override boolean` — when `true`, allows charge on at-risk orders (operator second-confirm sets this)
- Auth: brand-team-member of the order's brand
- Returns: `jsonb { ok, reason?, installment_status? }`
- Inserts `audit_log` row with `action_slug = 'INSTALLMENT_CHARGED_MANUALLY'` + `metadata = { brand_id, installment_id, atrisk_override }`
- Does NOT itself create the Stripe PI — sets `next_retry_at = now() - interval '1 second'` (so the on-demand edge function's helper-call picks it up immediately) AND returns success; the edge function (§3.2.1) calls the shared helper next

Migration filename: `supabase/migrations/<later-timestamp>_orch_0914_manual_charge_installment.sql`

#### 3.1.3 NEW audit_log slugs

Per ORCH-0806 slug-resolver pattern, register human-label resolvers for:
- `INSTALLMENT_CHARGED_MANUALLY` → "Installment charged manually by {operator}"
- `INSTALLMENT_REMINDER_SENT` → "Reminder sent to traveller by {operator}"

### 3.2 Edge function layer

#### 3.2.1 NEW edge function `manual-charge-installment`

**File:** `supabase/functions/manual-charge-installment/index.ts`

**HTTP:** POST `/manual-charge-installment`
**Request:** `{ installmentId: string, atRiskOverride?: boolean }`
**Response:** `{ ok: boolean, chargeId?: string, error?: string }`
**Auth:** Bearer JWT required (`verify_jwt: true`)
**External API:** Stripe (via shared helper)

**Behaviour:**
1. Validate JWT + extract `user_id`.
2. Invoke RPC `biz_manual_charge_installment(p_installment_id, p_atrisk_override)` — RPC handles brand-team-member auth + at-risk override + audit log.
3. If RPC returns `{ ok: false }`, return same shape to caller.
4. If RPC returns `{ ok: true }`, invoke shared helper `createInstallmentPI({ installmentId, brandId, override: { atRisk: p_atrisk_override } })`.
5. Return `{ ok, chargeId, error? }` from helper.

#### 3.2.2 NEW shared helper `_shared/installments/createInstallmentPI.ts`

**Extracted from cron** per OBS-2 of investigation. Both `process-scheduled-installments` AND `manual-charge-installment` invoke this helper. Single-owner invariant preserved.

**Signature:**
```ts
export async function createInstallmentPI(input: {
  installmentId: string;
  brandId: string;
  override?: { atRisk?: boolean };
}): Promise<{ ok: boolean; chargeId?: string; error?: string }>
```

**Behaviour:** loads the installment + order + brand Stripe-Account; computes idempotency key including `retry_count`; creates Stripe PI with mandated metadata (`mingla_installment_id` + `mingla_installment_ordinal` + `mingla_order_id` + `mingla_brand_id`); honors at-risk halt unless `override.atRisk === true`; updates `order_installments` status on success/failure; fires dunning email on failure if not at-risk; returns `{ ok, chargeId, error }`.

#### 3.2.3 NEW edge function `send-installment-reminder`

**File:** `supabase/functions/send-installment-reminder/index.ts`

**HTTP:** POST `/send-installment-reminder`
**Request:** `{ orderId: string }`
**Response:** `{ ok: boolean, deliveredVia: ('email' | 'push')[], error?: string }`
**Auth:** Bearer JWT required (`verify_jwt: true`)
**External APIs:** Resend (email), OneSignal (push)

**Behaviour:**
1. Validate JWT + extract `user_id`.
2. Invoke RPC `biz_send_installment_reminder(p_order_id)` — RPC handles rate-limit + brand-team-member auth + ledger insert + audit log.
3. If RPC returns `{ ok: false, reason: 'rate_limited' }` → return `{ ok: false, error: "Rate limited: 1 reminder per buyer per 24h." }`.
4. If RPC returns `{ ok: false, reason: 'forbidden' }` → return `{ ok: false, error: "Not authorised to send reminders for this brand." }`.
5. If RPC returns `{ ok: true }`, load order + next-due installment + brand context.
6. Send email via Resend using template `installmentReminderEmail.ts` (§3.4). Capture `{ email: "sent" | "failed" }`.
7. Best-effort push via OneSignal if buyer has consumer-app device tokens. Capture `{ push: "sent" | "failed" | "skipped" }`.
8. UPDATE `manual_buyer_reminders.delivery_results` with the results JSON.
9. Return `{ ok: true, deliveredVia: [...] }`.

### 3.3 Service layer

NEW: `mingla-business/src/services/manualInstallmentChargeService.ts`
```ts
export async function manualChargeInstallment(input: {
  installmentId: string;
  atRiskOverride?: boolean;
}): Promise<{ ok: boolean; chargeId?: string; error?: string }>
```
Posts to `manual-charge-installment` edge function. Throws on transport error.

NEW: `mingla-business/src/services/installmentReminderService.ts`
```ts
export async function sendInstallmentReminder(input: {
  orderId: string;
}): Promise<{ ok: boolean; deliveredVia: ('email' | 'push')[]; error?: string }>
```
Posts to `send-installment-reminder` edge function. Throws on transport error.

### 3.4 Email template

NEW: `supabase/functions/_shared/email/installmentReminderEmail.ts`

**Shape (mirrors `_shared/email/types.ts` pattern):**
```ts
export interface InstallmentReminderEmailInput {
  buyerName: string | null;
  buyerEmail: string;
  tripTitle: string;
  brandDisplayName: string;
  nextInstallmentAmount: string; // formatted: "€250"
  nextInstallmentDueAt: string; // formatted: "Sat, 21 Jun 2026"
  bookingId: string;
  unsubscribeUrl: string;
}

export function renderInstallmentReminderEmail(input: InstallmentReminderEmailInput): {
  subject: string;
  htmlBody: string;
  textBody: string;
}
```

**Copy template:**
- Subject: `"Heads up — your next {tripTitle} installment of {amount} is due {date}"`
- Body: friendly reminder; one-line CTA "Update your card if needed"; deep-link to consumer-app buyer-tickets surface; footer with brand name + unsubscribe.

### 3.5 Hook layer

NEW hooks:
- `useChargeInstallmentNow` — mirrors `useRetryInstallment` shape but with `atRiskOverride` arg.
- `useSendInstallmentReminder` — mirrors same shape; invalidates the reminders ledger query on success.
- `useRecentReminderForOrder(orderId)` — queries the new `manual_buyer_reminders` table for the most-recent reminder in the past 24h to gate the "Send reminder" button (disabled if recent reminder exists).

All three invalidate `orderInstallmentKeys.all` on success per ORCH-0869 cache pattern.

### 3.6 Component layer — Money route redesign

**File:** `mingla-business/app/trip/[id]/money/index.tsx`

#### 3.6.1 Layout — responsive split per Q6

Use `useResponsiveLayout` hook (existing per `feedback_mingla_business_desktop_web_contracts.md`) to switch rendering at the tablet breakpoint:

- **Phone (<= 480pt wide):** each traveller renders as a card with the 5 fields in a 2-column grid:
  ```
  ┌─────────────────────────────────┐
  │ Buyer Name                  ▼   │
  │ ┌─Plan───────┬─Paid-to-date──┐  │
  │ │ 3 × €125   │ €250 / €500   │  │
  │ └────────────┴───────────────┘  │
  │ ┌─Outstanding┬─Next inst─────┐  │
  │ │ €250 left  │ 21 Jun · €250 │  │
  │ └────────────┴───────────────┘  │
  │ [Last-charge: COLLECTED (chip)]  │
  │ [Charge now]   [Send reminder]   │
  └─────────────────────────────────┘
  ```
- **Tablet/Desktop (> 480pt):** true horizontal table with header row + body rows:
  ```
  ┌─Buyer──┬─Plan────┬─Paid──┬─Outstanding┬─Next inst──┬─Last status─┬─Actions────────┐
  │ Priya  │ 3 × €125│ €250  │ €250 left  │21 Jun €250 │ Collected   │ [Charge][Remind]│
  │ Marcus │ 3 × €125│ €250  │ €250 left  │21 Jun €250 │ Failed      │ [Charge][Remind]│
  └────────┴─────────┴───────┴────────────┴────────────┴─────────────┴────────────────┘
  ```

#### 3.6.2 Column definitions (LOCKED)

| Column | Source | Format |
|---|---|---|
| Buyer | `buyerLabel(head)` (existing helper pattern) | `head.buyerName ?? head.buyerEmail ?? "Anonymous"` |
| Plan | `InstallmentScheduleDisplay variant="cell"` (new variant; OR `<Text>${rows.length} × ${formatCurrency(rows[0].amountCents, currency)}</Text>` if equal-amount; OR pay-in-full string per Q7) | For pay-in-full: `"Paid in full"` |
| Paid-to-date | `formatCurrency(SUM(collected.amountCents), currency)` + " / " + `formatCurrency(orderTotalCents, currency)` | e.g., `"€250 / €500"` |
| Outstanding | `formatCurrency(orderTotalCents - SUM(collected.amountCents), currency)` + `" left"` | e.g., `"€250 left"`. Zero when all collected. |
| Next installment | Find lowest `dueAt` where `status IN ('scheduled', 'failed')`; format `"${date} · ${amount}"`. Show `"—"` when fully paid OR cancelled. | e.g., `"21 Jun · €250"` |
| Last-charge status | Q1 LOCKED: `orderAtRisk ? "At risk" : (mostRecentAttempted?.status ?? "Scheduled")` where `mostRecentAttempted = installments.filter(i => i.collectedAt \|\| i.failedAt).sort by max(collectedAt, failedAt) desc)[0]` | Status pill colors: At risk = `semantic.error`; Collected = `semantic.success`; Failed = `semantic.error`; Refunded = `textTokens.tertiary`; Cancelled = `textTokens.tertiary`; Scheduled = `textTokens.secondary` |
| Actions | `[Charge now]` + `[Send reminder]` Pressables | "Charge now" disabled when `head.orderAtRisk && !atRiskOverrideConfirmed`; "Send reminder" disabled when `useRecentReminderForOrder(orderId).data` is non-null (rate-limit window active) |

#### 3.6.3 Action handlers

- **Charge now tap:**
  1. If `head.orderAtRisk === true`, open `ConfirmDialog` with copy `"Buyer is at-risk (${head.retryCount} failed attempts). Proceeding will create a new Stripe charge attempt anyway. Are you sure?"` + "Confirm" / "Cancel" buttons.
  2. On confirm (or non-at-risk path), call `chargeNowMutation.mutate({ installmentId: nextInstallment.id, atRiskOverride: head.orderAtRisk })`.
  3. On success → toast `"Charge attempt sent. Status will refresh shortly."` + query invalidate.
  4. On failure → toast with friendly error from `humanizeChargeNowReason()`.

- **Send reminder tap:**
  1. Call `sendReminderMutation.mutate({ orderId: head.orderId })`.
  2. On success → toast `"Reminder sent via {deliveredVia.join(' + ')}."` + invalidate reminders query.
  3. On `rate_limited` → toast `"Already sent a reminder in the past 24h. Try again later."`.
  4. On `forbidden` → toast `"Not authorised."` (shouldn't happen in normal flow but defensive).

#### 3.6.4 Drill-in (expand) — UNCHANGED

Tap row → expand existing installment grid + retry-failed + cancel-and-refund. Same code path as today; preserved.

### 3.7 Strict-grep gate

NEW: `.github/scripts/strict-grep/i-proposed-manual-installment-action-via-shared-helper.mjs`

```js
// Fails CI if any file outside _shared/installments/createInstallmentPI.ts
// contains `stripe.paymentIntents.create` AND `mingla_installment_id`
// (i.e., direct Stripe PI creation for installments bypassing the shared helper).
```

Register in `.github/workflows/strict-grep-mingla-business.yml`.

---

## 4. Cross-Surface Impact (Phase 2.5 mandatory)

### 4.1 In scope

| Surface | User-visible behaviour | Files touched | Parity |
|---|---|---|---|
| Business iOS | Money tile opens redesigned table; phone responsive card layout per row; Charge-now + Send-reminder buttons with confirm dialogs + toast feedback | `mingla-business/app/trip/[id]/money/index.tsx`, NEW services/hooks, NEW migrations + edge fns (shared with web) | Automatic with Android (shared RN) |
| Business Android | Same as iOS | Same files | Automatic with iOS |
| Business web preview | Tablet/desktop true table layout per row; same Charge-now + Send-reminder | Same files (responsive split via useResponsiveLayout) | Automatic within bundle |

### 4.2 NOT in scope

| Surface | Reason |
|---|---|
| Consumer iOS | No organiser surface |
| Consumer Android | No organiser surface |
| Buyer-anonymous web | No organiser surface (buyer-side reminder RECEIPT is via email + push, not a buyer-web UI surface) |
| Admin Web | No equivalent admin tooling exists — flagged as DISC-0914-2 for future ORCH if support team requests |

### 4.3 Parity verdict

All 3 in-scope surfaces share the same mingla-business RN bundle. Manual parity required where the responsive split fires (phone vs tablet/web) — per-surface success criteria SC-N-iOS / SC-N-Android / SC-N-web below.

---

## 5. Success criteria

### 5.1 Column rendering

| ID | Criterion |
|---|---|
| SC-01 | Each traveller renders all 5 columns: Buyer / Plan / Paid-to-date / Outstanding / Next installment / Last-charge status |
| SC-02 | Plan column uses `InstallmentScheduleDisplay` (or text for equal-amount fallback); pay-in-full buyers show `"Paid in full"` |
| SC-03 | Outstanding column = `orderTotalCents - SUM(collected.amountCents)` formatted; zero shown as `"€0 left"` not negative |
| SC-04 | Next installment column shows lowest-dueAt scheduled-or-failed installment as `"${date} · ${amount}"`; shows `"—"` when fully paid |
| SC-05 | Last-charge status pill colors: At-risk red / Collected green / Failed red / Refunded muted / Cancelled muted / Scheduled neutral |
| SC-06 | Phone (≤480pt wide) renders card-with-labels grid; tablet/web (>480pt) renders true horizontal table |
| SC-07 | Drill-in (expand) preserves existing installment grid + retry + refund preview |

### 5.2 Charge-now action

| ID | Criterion |
|---|---|
| SC-08 | "Charge now" button visible on every traveller row; gated on brand-team-member permission |
| SC-09 | Tap on at-risk buyer opens ConfirmDialog with at-risk warning + Confirm/Cancel |
| SC-10 | Confirm → `chargeNowMutation` fires with `atRiskOverride: true` |
| SC-11 | Non-at-risk tap → mutation fires directly (no dialog) |
| SC-12 | Success toast + query invalidate |
| SC-13 | Failure toast with humanized reason |
| SC-14 | Audit log row written with `action_slug = 'INSTALLMENT_CHARGED_MANUALLY'` |

### 5.3 Send-reminder action

| ID | Criterion |
|---|---|
| SC-15 | "Send reminder" button visible on every traveller row; gated on brand-team-member permission |
| SC-16 | Button disabled with tooltip when recent reminder exists (rate-limit window active) |
| SC-17 | Tap → `sendReminderMutation` fires |
| SC-18 | Rate-limit response → toast `"Already sent a reminder in the past 24h."` |
| SC-19 | Success response → toast `"Reminder sent via {channels}."` |
| SC-20 | Reminder email body matches template (subject + greeting + amount + due date + brand footer + unsubscribe) |
| SC-21 | Push best-effort: when buyer has consumer-app device tokens, push fires; when not, `delivery_results.push = "skipped"` (no error) |
| SC-22 | `manual_buyer_reminders` row written with `delivery_results` populated |
| SC-23 | Audit log row written with `action_slug = 'INSTALLMENT_REMINDER_SENT'` |

### 5.4 Backend invariant preservation

| ID | Criterion |
|---|---|
| SC-24 | `process-scheduled-installments` cron continues to invoke shared `createInstallmentPI` helper (no behaviour change to scheduled-cron path) |
| SC-25 | Strict-grep gate `I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER` PASSES — no other file calls `stripe.paymentIntents.create` with `mingla_installment_id` metadata |
| SC-26 | ORCH-0882 disclosure invariant continues to PASS — `InstallmentScheduleDisplay` import + `installmentSchedule` token still present in money route |
| SC-27 | RLS preserved — non-brand-team-members cannot read `manual_buyer_reminders` for orders they don't own |

### 5.5 Pay-in-full row variant (Q7)

| ID | Criterion |
|---|---|
| SC-28 | Pay-in-full orders render with `Plan = "Paid in full"`, `Paid-to-date = full amount`, `Outstanding = "€0 left"`, `Next installment = "—"`, `Last-charge status = "Collected"` |
| SC-29 | Pay-in-full rows have NO "Charge now" button (nothing to charge) but DO have "Send reminder" disabled with copy `"No reminder needed — paid in full"` |

---

## 6. Invariants

### 6.1 Preserved

| Invariant | Preservation |
|---|---|
| `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` (ORCH-0869) | Replaced by §6.2 NEW invariant — shared helper is now the single owner |
| `I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT` (ORCH-0882) | Money route still imports `InstallmentScheduleDisplay`; gate continues to PASS |
| Constitution #2 one-owner-per-truth | All installment data via `useInstallmentsForBrandTrips`; reminder data via `useRecentReminderForOrder` |
| Constitution #3 no-silent-failures | Both new mutations have `onError` + toast; rate-limit + auth errors humanized |
| Constitution #9 no-fabricated-data | "Last-charge status" derived from real `collected_at`/`failed_at`; outstanding computed from real cents |
| Constitution #11 one-auth-instance | Both new edge fns use `supabase.auth.getUser()` via JWT; RPCs gate on `auth.uid()` |

### 6.2 NEW invariant proposed

| ID | Description | Enforcement |
|---|---|---|
| `I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER` | All installment PI creation paths invoke `_shared/installments/createInstallmentPI.ts` helper. No file outside the helper itself calls `stripe.paymentIntents.create` with `mingla_installment_id` metadata. SUPERSEDES `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` (the cron's role shifts from "single owner" to "one of N callers of the single-owner helper"). | Strict-grep gate `.github/scripts/strict-grep/i-proposed-manual-installment-action-via-shared-helper.mjs` failing CI on violation. |

---

## 7. Test cases

### 7.1 Implementor happy-path tests (T-01..T-18, REQUIRED)

**File:** `mingla-business/app/trip/[id]/money/__tests__/money-redesign.test.tsx`

| Test | Scenario |
|---|---|
| T-01 | All 5 columns render for a fixture with 3 buyers in 3 different plan states |
| T-02 | Plan column uses `InstallmentScheduleDisplay` for installment buyers |
| T-03 | Plan column shows `"Paid in full"` for pay-in-full buyer |
| T-04 | Outstanding = `orderTotalCents - SUM(collected.amountCents)` |
| T-05 | Outstanding shows `"€0 left"` when all installments collected (not negative) |
| T-06 | Next installment shows lowest-dueAt scheduled-or-failed |
| T-07 | Next installment shows `"—"` when fully paid |
| T-08 | Last-charge status pill = at-risk red for at-risk buyer |
| T-09 | Last-charge status pill = most-recent-attempted status for non-at-risk buyer |
| T-10 | Last-charge status pill = `"Scheduled"` when no attempts yet |
| T-11 | Phone layout (< 480pt wide) renders card grid |
| T-12 | Tablet/web layout (> 480pt) renders true table |
| T-13 | Drill-in expand still renders installment grid (preservation) |
| T-14 | Charge-now button visible + tappable on non-at-risk buyer |
| T-15 | Charge-now on at-risk buyer opens ConfirmDialog |
| T-16 | Send-reminder button disabled when recent reminder exists |
| T-17 | Send-reminder button enabled when no recent reminder |
| T-18 | Pay-in-full row: no Charge-now button, Send-reminder disabled with "Paid in full" copy |

Plus `fails-on-revert verified at <commit-hash>` per Step 0.5 gate.

### 7.2 Tester adversarial tests (T-A01..T-A14, REQUIRED — different angles)

**File:** `mingla-business/app/trip/[id]/money/__tests__/money-redesign-adversarial.test.tsx`

| Test | Attack angle |
|---|---|
| T-A01 | Charge-now without at-risk confirm on at-risk buyer → mutation NOT fired (gated by dialog) |
| T-A02 | Charge-now with at-risk confirm → mutation fired with `atRiskOverride: true` |
| T-A03 | Send-reminder within 24h → mutation NOT fired (gated by `useRecentReminderForOrder`) |
| T-A04 | Send-reminder of currently-charging order → behaviour TBD (likely allowed, since reminder ≠ charge) |
| T-A05 | Outstanding rendering when ALL installments cancelled (status='cancelled') → outstanding = original total OR 0? Lock in test |
| T-A06 | Outstanding when one refunded → outstanding accounts for refund correctly |
| T-A07 | Last-charge status precedence: at-risk supersedes most-recent-attempted |
| T-A08 | Last-charge status when buyer has 0 collected + 0 failed → "Scheduled" not "Unknown" |
| T-A09 | Phone responsive at exactly 480pt → which layout fires? Lock the boundary |
| T-A10 | Pay-in-full row Send-reminder button → MUST be disabled with copy "Paid in full" |
| T-A11 | Strict-grep gate fires on injected `stripe.paymentIntents.create` outside helper |
| T-A12 | RPC `biz_send_installment_reminder` rejects rate-limited call with `{ ok: false, reason: 'rate_limited' }` (not 500) |
| T-A13 | RPC `biz_manual_charge_installment` rejects non-brand-team-member with `forbidden` (not 403 leak) |
| T-A14 | Audit log row written for both Charge-now + Send-reminder; slugs match SPEC §3.1.3 |

### 7.3 Backend integration tests (Deno)

NEW: `supabase/functions/manual-charge-installment/__tests__/manual_charge_test.ts`
NEW: `supabase/functions/send-installment-reminder/__tests__/send_reminder_test.ts`

Cover happy path + rate-limit + auth-rejection + Stripe-error-handling. Mock Stripe + Resend; assert helper invocation + RPC return shapes.

---

## 8. Implementation order (LOCKED — 18 phases)

| Phase | Step | Notes |
|---|---|---|
| 1 | NEW migration `manual_buyer_reminders` + RLS + `biz_send_installment_reminder` RPC | Operator runs `supabase db push` |
| 2 | NEW migration audit_log slug additions + `biz_manual_charge_installment` RPC | Operator runs `supabase db push` |
| 3 | Extract `_shared/installments/createInstallmentPI.ts` helper from cron | Verify cron still passes its existing Deno tests after extraction |
| 4 | NEW edge function `manual-charge-installment` | Operator-deployed via `supabase functions deploy` (orchestrator owns deploy per `feedback_orchestrator_deploys_edge_functions.md`) |
| 5 | NEW Resend template `installmentReminderEmail.ts` | |
| 6 | NEW edge function `send-installment-reminder` | Same deploy ownership |
| 7 | NEW services `manualInstallmentChargeService.ts` + `installmentReminderService.ts` | |
| 8 | NEW hooks `useChargeInstallmentNow` + `useSendInstallmentReminder` + `useRecentReminderForOrder` | |
| 9 | Redesign `money/index.tsx` per §3.6 — 5-column responsive layout | |
| 10 | Add `useResponsiveLayout` split between phone card layout and tablet/web table layout | |
| 11 | Wire Charge-now action handlers per §3.6.3 + ConfirmDialog for at-risk path | |
| 12 | Wire Send-reminder action handlers + rate-limit gating | |
| 13 | Pay-in-full row variant rendering per Q7 (stub for non-installment orders) | |
| 14 | Strict-grep gate `i-proposed-manual-installment-action-via-shared-helper.mjs` + workflow registration | |
| 15 | Implementor happy-path tests T-01..T-18 with fails-on-revert verification | |
| 16 | Tester adversarial tests T-A01..T-A14 + Deno integration tests | (TEST phase — separate dispatch) |
| 17 | Run TypeScript + lint + jest + Deno tests | |
| 18 | Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0914_TRIP_MONEY_TAB_REDESIGN.md` | Old → new receipts per file |

**Hard guards:**
- DO NOT change `order_installments` or `orders` schema or RLS.
- DO NOT change the cron's per-installment LOGIC (only EXTRACT it into the shared helper that the cron continues to call).
- DO NOT bypass the rate-limit on send-reminder.
- DO NOT bypass the at-risk halt on charge-now without explicit `atRiskOverride: true` arg.
- DO NOT add new database tables beyond `manual_buyer_reminders`.
- DO NOT touch admin-web, consumer iOS/Android, or buyer-anon-web.
- DO NOT change existing Retry-now or Cancel-and-refund behaviour.

---

## 9. Regression prevention

- **Structural:** strict-grep gate enforcing `I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER`. Future code cannot bypass the shared helper.
- **Behavioural:** T-A01, T-A02, T-A03, T-A12, T-A13, T-A14 lock the dialog-required + rate-limit + auth + audit-log contracts.
- **Disclosure:** ORCH-0882 invariant (`InstallmentScheduleDisplay` import) continues to PASS via existing gate.
- **Append-only:** new test files become immutable post-merge.

---

## 10. Confidence

**HIGH for data-layer + presentation contract** (column derivations all from existing fields; no schema change). 

**MEDIUM for backend extraction architecture** — the cron's per-installment block extraction needs careful PR-time validation that the cron continues to behave identically (existing cron Deno tests must still PASS post-extraction).

**MEDIUM for at-risk override UX** — operator behavior under the confirm-dialog flow needs to be re-validated at TEST time on a real sim with a fixture at-risk traveller to confirm the dialog copy lands well.

---

## 11. Spec handoff

SPEC complete with all 7 operator decisions LOCKED. Ready for orchestrator REVIEW. If APPROVED, dispatch to Codex `implementor-mingla` (canonical IMPLEMENT owner) per the 18-phase order in §8.

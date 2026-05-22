# INVESTIGATION — ORCH-0914 [Trip Money tab redesign — organiser visibility into each traveller's payment-plan progress]

**Investigator:** Claude `mingla-orchestrator` operating as forensics (operator delegation via "take over"; full Claude/Codex parity)
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Severity:** S1-high · **Classification:** `missing-feature` + `ux`
**Confidence:** HIGH for current-state audit; MEDIUM for "Charge now" + "Send reminder" backend gap (one open question per action)

---

## 1. Layman summary

The Money page ORCH-0913 just shipped is already a per-traveller installment ledger — it's not a placeholder. Every traveller on a payment plan appears as an expandable row showing name, paid count, total collected, next-due date, at-risk pill if overdue. Tap a row → see the installment grid + retry-failed button + cancel-and-refund. **The "doesn't make sense" feedback is not about missing data — it's about presentation.** The operator wants a TABLE with explicit columns (plan / paid-to-date / outstanding / next-installment / last-charge status) instead of a stack of expandable cards, plus two NEW manual actions ("Charge now" — immediate, not next-cron-cycle — and "Send reminder" — operator-triggered email/push to the traveller) that don't exist today. Backend: every column the operator named is derivable from existing `order_installments` + `orders` data with ZERO schema changes. Two NEW backend endpoints needed for the new actions. Spec scope is "redesign content INSIDE the existing route + add two actions" — not "rewrite the data layer."

---

## 2. Symptom summary

| | Expected (operator's stated requirements 2026-05-22) | Actual (post-ORCH-0913 Money route) |
|---|---|---|
| Layout | TABLE with explicit columns | Stack of expandable cards (one per traveller) |
| Plan column | `"3 installments: €125 / €250 / €125"` | Not shown at row level (visible only after expand → installment grid) |
| Paid-to-date column | Total collected for this traveller | Shown: `"${paidCount} / ${total} paid · ${collectedCents formatted}"` (combined cell) |
| Outstanding balance column | Total outstanding for this traveller | NOT shown — derivable but not surfaced |
| Next-installment column | Next due date + amount | Shown: `"Next due ${formatMoneyDate(nextDue)}"` (date only, no amount) |
| Last-charge status column | succeeded / failed / retried / cancelled badge | Not shown at row level (visible only after expand) |
| Per-traveller drill-in | Full installment history detail | Already present (expand → installment grid with status pills + retry + refund preview) |
| "Charge now" action | Operator-triggered IMMEDIATE Stripe charge attempt on a scheduled installment | NOT shown — closest is "Retry now" which only flips `next_retry_at` for the cron (next charge in up-to-6-hours, not immediate); also retry only works on `failed` status, not `scheduled` |
| "Send reminder" action | Operator-triggered email/push to traveller about upcoming/overdue installment | NOT shown — only AUTOMATIC dunning emails fire from the cron on `failed` attempts |

---

## 3. Investigation manifest

| # | File | Why read | Layer |
|---|---|---|---|
| 1 | [money/index.tsx](../../mingla-business/app/trip/[id]/money/index.tsx) | Current Money route render — what's shown today | Component |
| 2 | [orderInstallmentsService.ts](../../mingla-business/src/services/orderInstallmentsService.ts) | `OrderInstallmentForBrand` shape — what data is available | Service |
| 3 | [useOrderInstallments.ts](../../mingla-business/src/hooks/useOrderInstallments.ts) | `useInstallmentsForBrandTrips` + `useRetryInstallment` — query/mutation contract | Hook |
| 4 | [process-scheduled-installments/index.ts](../../supabase/functions/process-scheduled-installments/index.ts) | Single-owner cron contract per `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` — informs how "Charge now" must integrate | Edge fn |
| 5 | ORCH-0869 [Tr3 Installment Payments] + ORCH-0873 [Tr3 Stage 2 UI] CLOSE banners in WORLD_MAP | Pipeline + invariant context | Docs |
| 6 | ORCH-0882 [Payment Plan Disclosure] CLOSE banner + `I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT` invariant | Disclosure invariant scope — already shifted to this Money route by ORCH-0913-A | Docs + CI gate |
| 7 | [RefundPreviewSheet.tsx](../../mingla-business/src/components/trip/RefundPreviewSheet.tsx) (skim only) | Existing cancel-and-refund flow we must preserve | Component |

---

## 4. Findings

### 🔴 RC-1 — Money route renders cards-not-table; columns operator wants are hidden behind expand

| Field | Value |
|---|---|
| File + line | [money/index.tsx:380–440](../../mingla-business/app/trip/[id]/money/index.tsx#L380-L440) (collapsed-row header render) |
| What it shows today | Per-buyer card with `<Text>${name}</Text>` + `<Text>${paidCount} / ${rows.length} paid · ${collectedCents}</Text>` + `<Text>Next due ${nextDue}</Text>` + at-risk pill if overdue. Tap toggles `expandedOrders` Set; expanded view renders installment grid. |
| What it should show | Tabular row with 5 explicit columns the operator named: **Plan** (e.g., `"3 × €125"` or full schedule), **Paid-to-date** (e.g., `"€250 / €500"`), **Outstanding** (e.g., `"€250 left"`), **Next installment** (date + amount, e.g., `"21 Jun · €250"`), **Last-charge status** badge (`Collected` / `Failed` / `Retried` / `Refunded` / `Cancelled` / `Scheduled`). Drill-in via tap remains for full installment history. |
| Causal chain | ORCH-0913 lifted the MoneyTabBody verbatim from the dashboard's Money tab; ORCH-0913 was scoped to "tile-grid + section-beneath parity" NOT to content redesign (explicitly per SPEC §2.2 non-goals). Operator's "doesn't make sense" feedback is now in scope as ORCH-0914. → Operator sees a sea of expandable cards and can't get a glanceable per-traveller status without tapping each row. |
| Verification step | Operator screenshots from ORCH-0913 dispatch (DC Adventure Money tab) show the collapsed card view with name + paid/total + next-due — same as what's in the code at money/index.tsx:380–440. |

### 🔴 RC-2 — "Charge now" action does not exist; "Retry now" only re-queues for cron (up to 6h delay) and only works on `failed` status

| Field | Value |
|---|---|
| File + line | [money/index.tsx:474–497](../../mingla-business/app/trip/[id]/money/index.tsx#L474-L497) — "Retry now" Pressable gated on `inst.status === "failed"` only |
| What it does | When tapped, calls `retryMutation.mutate(inst.id)` → `retryInstallment()` service → `biz_retry_installment` RPC → DB sets `next_retry_at`. The actual Stripe PI creation happens on the next `process-scheduled-installments` cron run (every 6 hours per migration `20260610000000_tr3_installments.sql` schedule). Hint text: `"Queues a charge attempt on the next cron run"` (money/index.tsx:485). |
| What it should do | Operator wants a "Charge now" action that triggers an IMMEDIATE Stripe PI creation + capture for any `scheduled` OR `failed` installment, not queued for cron. Bypasses the 6-hour cron window for operator-initiated debt collection. |
| Causal chain | ORCH-0869 [Tr3 Installment Payments] codified `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` — the cron edge function is the SINGLE OWNER of installment PI creation. Operator-initiated immediate charge would either need (a) the cron's PI-creation logic refactored into a shared helper invoked by both the cron AND a new on-demand edge function, OR (b) a new edge function that mirrors the cron logic for one installment. Either path preserves the single-owner invariant by making the new endpoint a peer of the cron, not a bypass. |
| Verification step | Grep `mingla-business/src/` for `chargeNow|charge-now|chargeInstallment|invokeInstallment` returns zero matches. Grep `supabase/functions/` for any function with `process|invoke|trigger` AND `installment` returns only `process-scheduled-installments` (the cron). |

### 🔴 RC-3 — "Send reminder" action does not exist; automatic dunning emails are cron-driven only

| Field | Value |
|---|---|
| File + line | (absence) — grep `mingla-business/src/` for `sendReminder|reminder|notifyBuyer.*installment` returns zero matches for this surface |
| What it does today | The cron `process-scheduled-installments` fires dunning emails AUTOMATICALLY on each failed attempt until success or at-risk threshold (per the file's contract header). Operator has no way to trigger an early/extra reminder before a scheduled installment is due, or to nudge an at-risk traveller outside the cron cycle. |
| What it should do | Operator-initiated "Send reminder" button on any traveller row → sends an email (Resend-shaped per ORCH-0785) and/or push notification (OneSignal-shaped) to the traveller with copy like "Your next installment for {trip} (€{amount}) is due {date} — confirm your card is up to date" (template TBD). Should be rate-limited (e.g., max one operator-sent reminder per traveller per day) to prevent spam. |
| Causal chain | ORCH-0869 + Tr3 stage emails were scoped to AUTOMATIC dunning (cron-fired). The "operator manually nudges a specific traveller" surface was not in Tr3 scope. → Operator has no glanceable way to chase a specific traveller from the Money tab. |
| Verification step | Grep `supabase/functions/` for `reminder|nudge|operator.*notify` returns only `notify-birthday-reminder`, `notify-calendar-reminder`, `notify-holiday-reminder`, `stripe-kyc-stall-reminder` — none are buyer-installment reminders. |

### 🟠 CF-1 — Outstanding-balance computation is missing from the data exposed to the UI, but trivially derivable

| Field | Value |
|---|---|
| Source | `OrderInstallmentForBrand.orderTotalCents` exists at the row level. Outstanding = `orderTotalCents - SUM(collected installments amountCents)` per buyer. |
| Today | The current row header computes `collectedCents` already ([money/index.tsx:368](../../mingla-business/app/trip/[id]/money/index.tsx#L368)) but does NOT compute outstanding. |
| Fix | Add `outstandingCents = head.orderTotalCents - collectedCents` to the per-buyer aggregation. Render as new column. No backend change. |
| Classification | Contributing factor — trivial client-side derivation, no schema/RLS/edge-fn touch. |

### 🟠 CF-2 — "Last-charge status" needs derivation rules + ordering disambiguation

| Field | Value |
|---|---|
| Source | The full installment list per order is available. Status of each row is `scheduled | collected | failed | refunded | cancelled`. |
| Decision needed in SPEC | What's the "last charge status" for a buyer? Candidate definitions: (a) status of the MOST RECENT installment by `dueAt` desc, regardless of status; (b) status of the most recent ATTEMPTED installment (i.e., latest `collected_at` OR `failed_at` non-null); (c) AT-RISK if `orderAtRisk`, else most-recent-attempted, else `scheduled`. Operator should pick. |
| Today | At-risk is shown via pill but "last-charge status" as a discrete column doesn't exist. |
| Fix | Add derivation + render as a status pill column. No backend change. Constitution #9 honored — only real installment statuses surface. |
| Classification | Contributing factor — definition + render only. |

### 🟡 HF-1 — "Charge now" and "Send reminder" must respect `at_risk` halt + per-buyer rate-limit to prevent abuse

| Field | Value |
|---|---|
| Why | Current cron contract: "At-risk flag flips on retry_count >= 3 + cron halts further retries." If operator can "Charge now" forever via UI, they bypass the at-risk halt and rack up Stripe declines (which Stripe penalizes via increased decline-rate-monitoring) + spam the buyer's bank. Same for "Send reminder" — without rate-limit, operator could trigger 50 emails in a minute. |
| Fix | SPEC must require: (a) "Charge now" blocked when `orderAtRisk === true` UNLESS operator passes an explicit override (e.g., second-confirm dialog "Buyer is at-risk — proceeding anyway?"); (b) "Send reminder" rate-limited to max 1 per buyer per 24h via a `reminder_sent_at` column on `orders` or a `manual_buyer_reminders` table; (c) Both actions audited via `audit_log` so operator-initiated state changes are traceable. |
| Classification | Hidden flaw — won't break today (actions don't exist yet) but will become a P0 incident if shipped without these guards. |

### 🟡 HF-2 — Plan-column rendering must match ORCH-0882 disclosure invariant exactly

| Field | Value |
|---|---|
| Why | `I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT` requires `InstallmentScheduleDisplay` (the canonical plan-disclosure component) on every plan-active trip buyer + planner surface. The Money route is already in the gate's SCOPED_FILES list per ORCH-0913-A. The new "Plan" column should use `InstallmentScheduleDisplay` in compact-row variant (or a new `variant="cell"` if one doesn't exist) — not roll its own `${N} × ${amount}` text-rendering. |
| Fix | SPEC must specify either (a) use existing variant if it fits a table-row width, OR (b) extend `InstallmentScheduleDisplay` with a new `variant="cell"` for tight horizontal contexts. Either way the gate's regex check (`InstallmentScheduleDisplay` import + `installmentSchedule` token) must continue to PASS on the new route file. |
| Classification | Hidden flaw — won't break today (the lift in ORCH-0913 preserved the import) but would break if the redesign rolls its own plan-text rendering and the gate fires red. |

### 🔵 OBS-1 — Backend data layer is FULLY READY; no migration or RPC schema change needed for any column

| Field | Value |
|---|---|
| Source | `OrderInstallmentForBrand` exposes: `id`, `orderId`, `ordinal`, `amountCents`, `currency`, `dueAt`, `status`, `stripePaymentIntentId`, `stripeChargeId`, `collectedAt`, `failedAt`, `failureReason`, `retryCount`, `nextRetryAt`, `buyerName`, `buyerEmail`, `orderTotalCents`, `orderAtRisk`, `orderAtRiskSince`. |
| Notes | Every operator-requested column (Plan / Paid-to-date / Outstanding / Next installment / Last-charge status) is computable from these fields. Zero schema migration, zero RLS change, zero RPC change for the table redesign. The two NEW actions (Charge now + Send reminder) need backend endpoints — those are additive, not data-layer changes. |
| Classification | Observation — confirms scope: redesign is presentation + 2 backend additions; not a data-platform overhaul. |

### 🔵 OBS-2 — Cron contract `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` is the structural guard for "Charge now" architecture

| Field | Value |
|---|---|
| Source | `supabase/functions/process-scheduled-installments/index.ts:6–24` (cron file header) — "This file is the SINGLE OWNER of installment PI creation. No other code path may create a PaymentIntent that carries metadata `mingla_installment_id`." |
| Notes | "Charge now" must NOT independently create PIs. The architecturally clean shape: extract the cron's per-installment PI-creation block into a shared `_shared/installments/createInstallmentPI.ts` helper; both the cron AND a new operator-facing edge function (`manual-charge-installment`) call the helper. Maintains single-owner invariant by definition. SPEC will lock the helper signature + the new endpoint's request/response contract. |
| Classification | Observation — informs SPEC architecture choice. |

### 🔵 OBS-3 — Existing UI patterns the redesign can reuse (zero new primitives needed for the table layout)

| Field | Value |
|---|---|
| Source | `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx` (canonical plan disclosure), `mingla-business/src/components/event/EventDetailKpiCard.tsx` (2-column layout pattern), `mingla-business/src/components/event/EventDetailActivityRow.tsx` (compact row pattern). |
| Notes | The redesigned per-traveller TABLE row can be built as a new `TripMoneyTravelerRow` component using existing tokens (`spacing`, `radius`, `typography`, `accent`, `semantic`). Status pills already exist via `statusPillStyle()` helper inline in money/index.tsx — could lift to shared. |
| Classification | Observation — implementor freedom; SPEC names the contract, implementor picks primitive structure. |

---

## 5. Five-layer cross-check

| Layer | What it says | Contradiction? |
|---|---|---|
| **Docs** | Operator stated requirements (per-traveller table with 5 columns + 2 new actions) | No — operator is the source of truth here |
| **Schema** | `order_installments` + `orders` tables fully expose every needed field via `OrderInstallmentForBrand` shape (OBS-1) | No — schema is ready |
| **Code** | Current Money route renders cards-not-table; missing 2 actions (RC-1, RC-2, RC-3) | YES — code today does not satisfy operator's stated requirements; THIS IS THE BUG |
| **Runtime** | Operator's 2026-05-22 screenshots confirm the cards-not-table render | No — matches code |
| **Data** | No data issue — every column derivable | No |

**Verdict:** Code-vs-operator-requirements is the only gap. Pure presentation-layer + 2 new backend endpoints.

---

## 6. Blast radius map

| Surface / system | Impact |
|---|---|
| `mingla-business/app/trip/[id]/money/index.tsx` | Redesigned per-traveller row layout. ORCH-0882 disclosure invariant gate must remain PASS — `InstallmentScheduleDisplay` import + `installmentSchedule` token MUST stay (see HF-2). |
| Per-traveller drill-in (expanded installment grid) | Preserved as-is — operator already has this and it works. |
| `RefundPreviewSheet` cancel-and-refund flow | Preserved as-is — Tr4 ORCH-0875 invariant unchanged. |
| `useInstallmentsForBrandTrips` + `useRetryInstallment` hooks | Unchanged. New "Charge now" needs a new mutation hook (`useChargeInstallmentNow`); new "Send reminder" needs a new mutation hook (`useSendInstallmentReminder`). |
| `supabase/functions/process-scheduled-installments/index.ts` (cron) | Optional refactor: extract per-installment PI-creation into `_shared/installments/createInstallmentPI.ts` helper invoked by both the cron AND a new on-demand edge function. Single-owner invariant preserved by making both the cron + new endpoint call the SAME helper (helper becomes the single owner). |
| NEW edge function `manual-charge-installment` | Operator-initiated; auth-gated to brand-team-member with `MANAGE_INSTALLMENTS` permission; honors at-risk halt with explicit override per HF-1. |
| NEW edge function `send-installment-reminder` (or new template in `marketing-send` / `ticket-confirmation-dispatch` reusing existing email substrate per ORCH-0785) | Operator-initiated; rate-limited per-buyer-per-day per HF-1; auth-gated same as above. |
| Buyer-anonymous web (`/checkout/{eventId}` / `/e/...`) | NOT touched — this is organiser surface only. |
| Consumer iOS/Android | NOT touched — no organiser dashboard. |
| Admin web (`mingla-admin/`) | NOT touched — no equivalent surface yet (could be a future ORCH if admin needs the same visibility). |
| ORCH-0915 [Buyer pay-in-full opt-out] coupling | Once ORCH-0915 lands, the per-traveller table also shows buyers who paid in full as "Paid in full" instead of an installment plan. SPEC should pre-think this row variant (e.g., "Plan" column shows `"Paid in full"` for non-installment orders, with all other columns reading from the order itself). |

---

## 7. Invariants

### 7.1 Preserved

| Invariant | How preservation is enforced |
|---|---|
| `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` | "Charge now" extracts shared PI-creation helper invoked by both cron + new endpoint (OBS-2). Single owner = the helper. |
| `I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT` (ORCH-0882) | "Plan" column uses `InstallmentScheduleDisplay` primitive (HF-2). Strict-grep gate continues to PASS. |
| Constitution #2 one-owner-per-truth | Installment data sourced only from `useInstallmentsForBrandTrips`. New action mutations invalidate the same query keys. |
| Constitution #3 no-silent-failures | New actions need `onError` + visible toast (existing pattern at money/index.tsx via the toast prop). |
| Constitution #9 no-fabricated-data | "Last-charge status" derived from real `collected_at`/`failed_at` timestamps. "Outstanding" computed from real `orderTotalCents - SUM(collected amountCents)`. |
| Cron at-risk halt | HF-1 — "Charge now" respects `orderAtRisk` with explicit operator override. |

### 7.2 NEW invariant proposed for SPEC

| ID | Description | Enforcement |
|---|---|---|
| `I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER` | "Charge now" and "Send reminder" both invoke shared backend helpers (NOT one-off API call paths). The cron + new endpoints all read/write through the same helper modules so the single-owner contract for installment side-effects holds. | Strict-grep CI gate failing on any direct `stripe.paymentIntents.create({metadata: {mingla_installment_id: ...}})` outside `_shared/installments/createInstallmentPI.ts`. |

---

## 8. Open questions for SPEC (operator decisions)

- **Q1 — "Last-charge status" definition.** Pick: (a) latest installment by `dueAt`, (b) latest ATTEMPTED installment (any `collected_at` or `failed_at` non-null), (c) at-risk → most-recent-attempted → scheduled-fallback. **Recommendation: (c)** — most informative; matches operator's mental model "is this buyer paying or not?"
- **Q2 — "Charge now" override behaviour on at-risk buyers.** Allowed (with second-confirm dialog "Buyer is at-risk; proceed anyway?"), or fully blocked? **Recommendation: allowed-with-confirm** — operator may have outside-system reason (e.g., buyer paid via bank transfer and operator wants to clear the failed retry record); fully blocking removes operator agency.
- **Q3 — "Send reminder" rate-limit.** 1 per buyer per 24h? Per 12h? Per installment (max 1 reminder per scheduled installment per traveller)? **Recommendation: 1 per buyer per 24h** with a `manual_buyer_reminders` table tracking `(order_id, sent_at, sent_by_brand_member_id)`.
- **Q4 — Reminder delivery channel.** Email only? Push only? Both? **Recommendation: email primary (Resend per ORCH-0785), push best-effort secondary (OneSignal) if buyer has the consumer app installed and notification preferences allow.**
- **Q5 — Reminder copy template.** New Resend template or extend `ticket-confirmation-dispatch` shape? **Recommendation: new template at `supabase/functions/_shared/email/installmentReminderEmail.ts` mirroring the existing email-template scaffold.**
- **Q6 — Table layout vs card layout on small screens.** True table (horizontal columns) gets cramped on iPhone SE-class screens (375pt wide). Two options: (a) responsive — table on tablets/desktop-web, cards on phone with explicit cell labels; (b) horizontal scroll on phone with frozen Name column. **Recommendation: (a) responsive** — phone-side card has the 5 columns rendered as a 2-column grid inside each card with explicit field labels, matching iOS Human Interface Guidelines for narrow-viewport tables.
- **Q7 — Pay-in-full coupling (ORCH-0915 dependency).** Show buyers who paid in full as a row in this table or filter them out? **Recommendation: include them with `Plan = "Paid in full"`, other columns reading from the order itself** — operator wants ONE view of all travellers, not "installment buyers only + go elsewhere for full-pay buyers."

---

## 9. Fix strategy (direction only — SPEC will formalize)

Three buckets:

**Bucket A — Presentation redesign (no backend touch):**
- Replace current expandable-card layout with responsive table-row layout per Q6 recommendation
- Add 5 explicit columns: Plan (via `InstallmentScheduleDisplay variant=...`) / Paid-to-date / Outstanding (new derivation per CF-1) / Next installment (date + amount) / Last-charge status (per CF-2 + Q1 derivation)
- Preserve expand-to-drill-in (existing installment grid) AS-IS
- Preserve existing Cancel & refund CTA AS-IS
- Preserve existing at-risk pill AS-IS (or fold into Last-charge status column — Q1 picks)
- All-bookings / At-risk filter chips AS-IS

**Bucket B — "Charge now" action (1 new edge fn + 1 new RPC + 1 new hook):**
- Extract `_shared/installments/createInstallmentPI.ts` helper from cron (OBS-2)
- NEW edge function `manual-charge-installment` POST `{ installmentId }` → invokes helper → returns `{ ok, chargeId, error? }`
- NEW RPC `biz_manual_charge_installment` for auth + audit-log + at-risk override flag
- NEW hook `useChargeInstallmentNow` mirroring `useRetryInstallment` shape
- UI: per-row "Charge now" button gated on `inst.status IN ('scheduled', 'failed')` AND brand-team-member permission; second-confirm dialog when `orderAtRisk === true` (HF-1)

**Bucket C — "Send reminder" action (1 new table + 1 new edge fn + 1 new template + 1 new hook):**
- NEW migration: `manual_buyer_reminders (id, order_id, sent_at, sent_by_brand_member_id)` with RLS allowing brand-team-member reads and rate-limit constraint
- NEW Resend email template `installmentReminderEmail.ts` per `_shared/email/` pattern
- NEW edge function `send-installment-reminder` POST `{ orderId }` → enforces rate-limit → sends email + optional push → returns `{ ok, deliveredVia: ['email', 'push'] }`
- NEW hook `useSendInstallmentReminder` mirroring `useRetryInstallment` shape
- UI: per-row "Send reminder" button; disabled with tooltip when rate-limit window not yet expired

---

## 10. Regression prevention (SPEC must include)

- Happy-path regression test for the 5-column render contract (verify each column renders for a fixture with 3 buyers in 3 different plan states)
- Adversarial regression test attacking: (a) "Charge now" on at-risk buyer WITHOUT confirm → mutation blocked, (b) "Send reminder" within 24h of prior → mutation blocked with rate-limit error, (c) outstanding-balance computation when all installments collected → renders "€0 remaining" not negative, (d) ORCH-0882 disclosure gate still PASS post-refactor
- New strict-grep gate enforcing `I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER` (no direct Stripe PI creation outside the shared helper)
- Manual "Charge now" + "Send reminder" both go through audit_log per Constitution #11 (sort of — adapting from "one auth instance" to "operator-initiated state changes are auditable")

---

## 11. Discoveries for orchestrator

- **DISC-0914-1 — ORCH-0915 [Buyer pay-in-full opt-out] coupling:** the Money tab redesign should be designed with the pay-in-full row variant in mind (Q7). If 0914 ships first and 0915 ships later, the table needs a small extension to handle the new row type. Recommend: SPEC 0914 with a stubbed "pay-in-full" branch that just renders `Plan = "Paid in full"` and reads other columns from the order itself — costs almost nothing now, saves a follow-up touch later.
- **DISC-0914-2 — Admin-web parity gap (future ORCH):** if Mingla support/admin team eventually needs the same per-traveller visibility (to help organisers troubleshoot a stuck installment), the admin-web has no equivalent surface today. Out of 0914 scope; flag for follow-up if admin-side feedback surfaces.
- **DISC-0914-3 — `audit_log` integration:** "Charge now" + "Send reminder" + at-risk override are all operator-initiated state changes that should be audit-logged. ORCH-0806 [audit log slug → human label resolver] established the resolver pattern; new audit-log entries for these actions need slugs added to the resolver. Confirm during SPEC.

---

## 12. Confidence

**HIGH for current-state audit + gap matrix** (code-truth read of money/index.tsx + service shape + cron contract).

**MEDIUM for "Charge now" + "Send reminder" backend architecture** — the shape is clear (shared helper invoked by both cron + new endpoint; rate-limited reminder table) but SPEC must lock the request/response schemas + RPC signatures + RLS predicates + audit-log slugs. Open questions Q1–Q7 are SPEC-time operator decisions, not investigation gaps.

**LOW for cross-surface impact beyond business-iOS/Android/web-preview** — admin-web parity is a DISC, not a blocker.

---

## 13. SPEC handoff

Investigation complete. Ready for operator REVIEW + decisions on Q1–Q7. After REVIEW + decisions, SPEC follows at `Mingla_Artifacts/specs/SPEC_ORCH-0914_TRIP_MONEY_TAB_REDESIGN.md` with locked column inventory, locked action contracts, Cross-Surface Impact Phase 2.5, per-surface success criteria, 18+ happy-path + 12+ adversarial test seeds, implementation order.

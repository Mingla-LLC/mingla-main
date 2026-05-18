# DESIGN — ORCH-0873 [Tr3 Installment Payments Stage 2 UI]

**Skill:** `ui-ux-pro-max`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Pre-CLOSE state:** ORCH-0869 [Tr3 Installment Payments] backend Stages 1 + 1b merged to main 2026-05-18 (squash `824d0c97`)
**Dispatch:** `Mingla_Artifacts/prompts/DESIGNER_ORCH-0873_TR3_STAGE_2_UI.md`
**Authority:** SPEC_ORCH-0869 §3.5 (component layer) + §3.6 (no realtime in v1) — this design doc is the visual + interaction layer; the functional contract is the SPEC.

---

## §1 Layman summary

Trip planners can today configure payment plans via SQL only because ORCH-0869's backend is live but the UI isn't built. This design produces three new surfaces: (a) a **PaymentPlanEditor** the planner uses inside the trip wizard's Pricing step to configure a deposit + N future installments; (b) an **InstallmentScheduleDisplay** that shows the buyer (and the planner during preview) exactly what they'll pay and when; (c) a **Money tab** on the trip operator dashboard listing every booking's installment ledger with a Retry button on failed installments and an "At risk" badge on bookings the cron has given up on. All three render in mingla-business's existing dark-canvas + glass-surface design language (no design-system shift, no new dependencies). Three competing PaymentPlanEditor directions are explored side-by-side with a tradeoff matrix and one recommendation.

---

## §2 Inputs reviewed

| File | What I extracted |
|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md` §3.5.1–§3.5.6 | Functional contract: deposit % stepper 10–95 in 5% steps; 1–11 installments; per-installment {pct, days_after_booking ⟷ fixed_date} schema; live sum-100 validation; "+ Add installment" max 11; trash icon per row; drag-reorder NOT in v1; native date pickers; `accessibilityLabel` + `accessibilityValue` mandatory. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md` §3.6 | NO realtime in v1 — React Query polling at `staleTime: 30_000` + pull-to-refresh + webhook-driven cache invalidation suffices. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md` §4 SC-5a/5b/5c | The 3 buyer-anon-web checkout routes are SEPARATE files (`index.tsx`, `buyer.tsx`, `payment.tsx`); manual parity; each gets its own success criterion. |
| `Mingla_Artifacts/reports/QA_ORCH-0869_TR3_INSTALLMENT_PAYMENTS_STAGE_1B_REPORT.md` §6 | P3-1: backend only verifies FIRST installment past-due — UI should enforce monotonic increasing dates at editor layer. P3-2: pct sum tolerance 0.01 — UI should use integer % steps (or 0.5% at finest) to avoid floating-point edge cases. |
| `Mingla_Artifacts/reports/RESEARCH_ORCH-0825_WETRAVEL_COMPETITIVE_INGEST.md` §4 (referenced via WORLD_MAP) | WeTravel parity baseline: 1–24 installments (Mingla v1 caps at 11), deposit-on-booking, auto-billing. Mingla beats them on (a) operator awareness of failed installments via at-risk flag + dunning, (b) manual-retry button on operator dashboard. Design must surface these advantages visibly — at-risk badge + Retry button are competitive differentiators. |
| `Mingla_Artifacts/design/DESIGN_ORCH-0863_MARKETING_HUB_PHASE_B.md` | Recent design language anchor: FAB philosophy for floating CTAs; tab IA pattern (50/50 split bottom border on active); sticky validation banner pattern; dark-canvas + glass-surface base; warm orange accent `#eb7825` for primary CTAs. |
| `mingla-business/src/constants/designSystem.ts` | Tokens: spacing xxs/xs/sm/md/lg/xl/xxl (2/4/8/16/24/32/48); radius sm/md/lg/xl (8/12/16/24); semantic.success #22c55e / .warning #f59e0b / .error #ef4444; canvas.profile #141113; accent.warm #eb7825; text.primary rgba(255,255,255,0.96); blurIntensity.cardElevated 34; durations + easings. |
| `mingla-business/app/trip/[id]/index.tsx` | Existing tab IA: `[tab === "overview"|"travelers"]` with `setTab` state; `accessibilityRole="tab"` + `accessibilityState={selected}`; `styles.tab` + `styles.tabActive` border-bottom toggle. Money tab MUST adopt this exact pattern for visual continuity. |
| `mingla-business/src/components/ui/` inventory | Existing primitives available: `Button`, `Input`, `Pill`, `Modal`, `GlassCard`, `IconChrome`, `BottomNav`, `EmptyState`, `ConfirmDialog`, `KpiTile`, `ActionTile`. PaymentPlanEditor can compose from these — no new primitives required. |
| `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` | Where PaymentPlanEditor lands. Existing layout has a single-price input section; the toggle + editor sit below it. |
| `mingla-business/src/components/trip/TripCheckoutFlow.tsx` | Where InstallmentScheduleDisplay lands on planner side (preview only). |
| `mingla-business/app/checkout/[eventId]/{index,buyer,payment}.tsx` | Three buyer-anon-web checkout pages where InstallmentScheduleDisplay also lands — each above the line-item summary. |

Live data context (from prior ORCH-0859 + ORCH-0869 work): zero trips have `tier_metadata.installments` populated yet — Stage 2 is the moment planners get the ability to configure them. Smoke order `90b9308a-…` is the only Stage 1b live-fire artifact (no installment plan, just non-installment regression proof).

---

## §3 PaymentPlanEditor mockups — 3 directions explored

The operator-facing component that appears on `TripCreatorStep4Pricing.tsx` below the existing single-price input, gated behind a toggle "**Payment plan**" (off by default → planner ships single-payment trip like Tr2; on → renders editor). Default-on state on toggle: deposit 25%, ONE installment at 50% pct + `days_after_booking: 30`.

All three mockups inherit:
- Dark canvas `#141113` background.
- Glass elevated card surfaces (`blurIntensity.cardElevated: 34`) for grouping.
- Warm orange `#eb7825` for primary actions (Add installment button, Done CTA).
- `radius.md: 12` on inputs + `radius.lg: 16` on cards.
- `text.primary: rgba(255,255,255,0.96)` for headings, `text.secondary: rgba(255,255,255,0.72)` for helper copy, `text.tertiary: rgba(255,255,255,0.52)` for placeholders.
- `semantic.error: #ef4444` on validation copy + `semantic.success: #22c55e` on the "Adds to 100%" confirmation.
- 44pt min touch targets per I-38 + every interactive element has `accessibilityLabel` per I-39.
- No emoji-as-icons — Lucide icons (Plus, Trash2, ChevronDown, AlertCircle, Calendar, Clock — pending ORCH-0870 final icon set).

---

### Mockup A — **Inline form (vertical stack)**

```
┌──────────────────────────────────────────────────────────────┐
│ Pricing                                                       │
│ ───────────────────────────────                              │
│ Price per traveler                                            │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │  $  1,100.00                                              │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                               │
│ Payment plan                              [ ⚪  off ]         │
│ ───────────────────────────────                              │
│  When toggle is ON:                                           │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Deposit at booking          [ −  25 %  + ]              │ │
│ │ Buyer pays $275.00 today                                  │ │
│ │                                                            │ │
│ │ ─────────────────────────────                             │ │
│ │ Installment 1                              [ 🗑 Remove ]  │ │
│ │   Amount       [ −  50 %  + ]    → $550.00               │ │
│ │   Due          ( Days after booking ⟷ Fixed date )       │ │
│ │                ┌────────────────┐                          │ │
│ │                │  30  days       │                         │ │
│ │                └────────────────┘                          │ │
│ │                                                            │ │
│ │ ─────────────────────────────                             │ │
│ │ Installment 2                              [ 🗑 Remove ]  │ │
│ │   Amount       [ −  25 %  + ]    → $275.00               │ │
│ │   Due          ( Days after booking ⟷ Fixed date )       │ │
│ │                ┌────────────────┐                          │ │
│ │                │  60  days       │                         │ │
│ │                └────────────────┘                          │ │
│ │                                                            │ │
│ │ [ + Add installment ]                                     │ │
│ │                                                            │ │
│ │ Totals                                                     │ │
│ │   Deposit + installments adds to 100% ✓                  │ │
│ │   $275 + $550 + $275 = $1,100.00                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                               │
│ [ Save and continue ]                                         │
└──────────────────────────────────────────────────────────────┘
```

**Layout & interaction:**
- Toggle is a flat row at the top (matches mingla-business existing toggle row pattern from Step 4). Tap toggles → editor expands in-place with the existing card animation (`durations.medium`).
- Each row is a labeled `Input.variants.stepper` (existing primitive — 5% increments enforced at component layer per QA P3-2).
- Below each percentage stepper, a live `→ $XYZ.YZ` preview computed against the trip price.
- Date-mode toggle is a **segmented control** (2 segments: "Days after booking" | "Fixed date") that swaps the input below.
- Days input is a numeric stepper (1–365 range; default 30).
- Fixed date opens native date picker on tap.
- "Remove" is a small text button + Trash2 icon — destructive treatment (`semantic.error` text, no background).
- "+ Add installment" is a full-width ghost button with `accent.warm` border + text; tap appends a row with `pct: floor(remaining/2)` defaults.
- Totals section is sticky-bottom inside the card: green check + dollar breakdown when sum=100, red alert + "Add $X more" copy when sum≠100.
- Validation errors render inline BELOW each violating row in red 14pt text. Inline-only (no toasts, no modals).
- Card is NOT collapsible mid-config — toggle-off destroys the schedule entirely (with confirm dialog to avoid accidental wipe).

**Accessibility:**
- Toggle: `accessibilityLabel="Payment plan toggle"` + `accessibilityState={{checked: isOn}}` + `accessibilityRole="switch"`.
- Each stepper: `accessibilityLabel="Deposit percentage stepper"` + `accessibilityValue={{text: "${pct}%", min: 10, max: 95, now: pct}}` + `accessibilityRole="adjustable"`.
- Segmented control: `accessibilityRole="tablist"` + per-segment `accessibilityRole="tab"` + `accessibilityState={{selected}}`.
- "+ Add installment" button: `accessibilityLabel="Add another installment"` + `accessibilityHint="Up to 11 installments after deposit"`.
- Trash row: `accessibilityLabel="Remove installment ${ordinal}"` + `accessibilityHint="Removes this installment; remaining installments will be re-numbered"`.
- Date picker: native picker inherits OS accessibility.
- Validation copy: `accessibilityLiveRegion="polite"` so screen readers announce sum changes as the user adjusts steppers.

**Tap targets:** every stepper + / − button is 44×44pt (existing `Input.variants.stepper` default). Date input is the full row (≥44pt). Trash button is 44×44pt.

**Validation copy (verbatim):**
- "Percentages must add to 100% (currently ${pctSum}%). ${'Add' if under else 'Remove'} ${|100−pctSum|}% to balance." (red, below totals row)
- "Installment ${i+1} due before installment ${i} — fix dates." (red, below offending row, when `fixed_date` mode AND dates non-monotonic)
- "Date must be in the future." (red, below row, when `fixed_date <= today`)
- "Maximum 11 installments after deposit." (red, replaces "+ Add installment" button label when at cap)
- "${day count} days after booking" → live preview text in `text.secondary` below `days_after_booking` input

**Color tokens used:**
- Card surface: `glass.tint.profileElevated` (#ffffff 0.06 alpha over `canvas.profile`)
- Card border: `glass.border.profileElevated` (#ffffff 0.12 alpha)
- Primary CTA ("Save and continue"): `accent.warm` background, `text.inverse` foreground
- Add-installment button: `accent.warm` border + text, transparent fill
- Stepper + / − chips: `glass.tint.chrome` background, `text.primary` foreground
- Validation error: `semantic.error` (#ef4444) text + 0.18 alpha left-border accent
- Validation success: `semantic.success` (#22c55e) check + text
- "Buyer pays $X today": `text.secondary` (rgba 0.72) — informational only

**Pros:**
- Maximum discoverability — everything visible in one scroll, no hidden state.
- Easy to scan total at glance — sticky totals row is always visible.
- Simplest implementation — composes existing primitives, no new modal/sheet plumbing.
- Best for first-time configuration — planner sees the full shape upfront.

**Cons:**
- Vertical real estate on a tall trip wizard step — adds ~400pt to the Pricing step at full config.
- On business-web-preview, the long form can push the "Save and continue" CTA below the fold.
- Mid-config validation errors require scrolling up to find the offending row.

---

### Mockup B — **Sheet (bottom modal)**

```
TripCreatorStep4Pricing (parent screen)
┌──────────────────────────────────────────────────────────────┐
│ Pricing                                                       │
│ Price per traveler  $1,100.00                                │
│                                                               │
│ Payment plan      Configured · 3 payments · $275 deposit     │
│ [ Edit plan ]   [ Remove plan ]                              │
│                                                               │
│ [ Save and continue ]                                         │
└──────────────────────────────────────────────────────────────┘

When [ Edit plan ] tapped → 80%-height sheet from bottom:
┌──────────────────────────────────────────────────────────────┐
│                  ──                                           │
│  Payment plan                                       [ Done ] │
│  ──────────────────────────────                              │
│  Trip price                            $1,100.00              │
│                                                               │
│  Deposit at booking          [ −  25 %  + ]   $275.00       │
│  ───────────────────────────                                  │
│                                                               │
│  Installments                                                 │
│  ┌─ Installment 1 ──── 50 % · $550 · 30 days ──── 🗑 ─┐    │
│  │  Amount  [ − 50% + ]    Due ( Days | Fixed )         │    │
│  │  [  30  days after booking  ]                         │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌─ Installment 2 ──── 25 % · $275 · 60 days ──── 🗑 ─┐    │
│  │  Amount  [ − 25% + ]    Due ( Days | Fixed )         │    │
│  │  [  60  days after booking  ]                         │    │
│  └────────────────────────────────────────────────────┘    │
│                                                               │
│  [ + Add installment (1 of 11 used) ]                        │
│                                                               │
│  ─────────────────────────────────────                       │
│  Sticky validation footer (always visible bottom of sheet):   │
│  Adds to 100% ✓     Total $1,100.00                          │
│                                                               │
│ ────────────────────────────────────                          │
│ [             Save and close             ]                    │
└──────────────────────────────────────────────────────────────┘
```

**Layout & interaction:**
- Parent screen shows a compact summary after configuration: "Configured · N payments · $deposit deposit" with two CTAs (Edit / Remove).
- "Edit plan" opens a sheet from bottom (80% height, drag-to-dismiss disabled while validation errors present).
- Sheet uses `Modal` primitive with `presentationStyle="pageSheet"` (iOS native).
- Sticky validation footer ALWAYS visible at sheet bottom — sum/total render even while user is editing.
- Sheet has a "Save and close" sticky bottom CTA disabled until validation passes.
- "Remove plan" on parent opens a `ConfirmDialog` ("Remove payment plan? This trip will revert to single payment.") before destroying.
- Each installment card is collapsed by default after creation (shows the row summary `50 % · $550 · 30 days`); tap expands the row to reveal steppers + date controls. This keeps the sheet scannable.

**Accessibility:** Same patterns as Mockup A. Sheet `accessibilityViewIsModal={true}` to scope screen reader focus. Sticky footer `accessibilityLiveRegion="polite"`.

**Pros:**
- Parent Step 4 stays compact — only a single-line summary after configuration.
- Sticky validation footer is always visible — no scroll-up to find errors.
- Sheet IA matches mingla-business existing modal sheets (BrandSwitcherSheet pattern).
- Collapsed installment cards keep sheet scannable even at 11-installment max.
- Better fit for the Trip Wizard's already-tall flow.

**Cons:**
- "Hidden" — planner has to tap Edit to discover what's configurable, adding 1 step.
- More implementation complexity — Modal mount + animation + drag-to-dismiss + sticky footer.
- On business-web-preview, sheet renders as a stacked modal (RN-Web Modal limitation) — less native feel than iOS.
- Discoverability lower than inline — first-time users may not realize how much is configurable.

---

### Mockup C — **Cards (per-installment as standalone glass cards)**

```
TripCreatorStep4Pricing
┌──────────────────────────────────────────────────────────────┐
│ Pricing                                                       │
│ Price per traveler  $1,100.00                                │
│                                                               │
│ Payment plan                              [ ⚪  off ]         │
│ ───────────────────────────────                              │
│  When toggle is ON:                                           │
│                                                               │
│  ┌─ Deposit ─────────────────────────────┐                   │
│  │ 25 %                                   │                   │
│  │ ─────                                  │                   │
│  │ $275.00 at booking                     │                   │
│  │ ──────────────────                     │                   │
│  │ Adjust:  ( - )   25 %   ( + )         │                   │
│  └────────────────────────────────────────┘                   │
│                                                               │
│  ┌─ Installment 1 ──────────────────  🗑 ┐                   │
│  │ 50 %                                   │                   │
│  │ ──────                                 │                   │
│  │ $550.00 on Jan 15, 2026                │                   │
│  │ ──────────────────                     │                   │
│  │ Adjust amount: ( - ) 50 % ( + )       │                   │
│  │ Due:    ⦿ 30 days after booking       │                   │
│  │         ⦾ Fixed date                   │                   │
│  └────────────────────────────────────────┘                   │
│                                                               │
│  ┌─ Installment 2 ──────────────────  🗑 ┐                   │
│  │ 25 %                                   │                   │
│  │ ──────                                 │                   │
│  │ $275.00 on Feb 15, 2026                │                   │
│  │ ──────────────────                     │                   │
│  │ Adjust amount: ( - ) 25 % ( + )       │                   │
│  │ Due:    ⦿ 30 days after booking       │                   │
│  │         ⦾ Fixed date                   │                   │
│  └────────────────────────────────────────┘                   │
│                                                               │
│  [ + Add installment ]                                        │
│                                                               │
│  ┌──────────────────────────────────────┐                    │
│  │ Sticky banner (always visible while  │                    │
│  │ editor mounted):                       │                    │
│  │ ✓ Adds to 100% · Total $1,100.00     │                    │
│  └──────────────────────────────────────┘                    │
│                                                               │
│ [ Save and continue ]                                         │
└──────────────────────────────────────────────────────────────┘
```

**Layout & interaction:**
- Each row is its OWN glass card with a big % readout at top + secondary copy + adjust controls.
- Cards are vertically stacked with `spacing.md: 16` gap.
- Date-mode toggle is a radio-like list (⦿ ⦾) below the amount stepper rather than a segmented control — feels more "discoverable" but takes more space.
- Sticky validation banner is fixed at bottom of the screen (NOT the card) — uses `position: "absolute"` with `bottom: insets.bottom + spacing.lg`.
- Sheet pattern NOT used — stays inline like Mockup A.

**Accessibility:** Same patterns. Each card has `accessibilityLabel="Installment ${ord}, ${pct}%, due ${dueDate}"` as the card-level summary. Inner steppers and radio inherit their own labels.

**Pros:**
- Most visually appealing — each installment is its own beautiful glass card.
- Strongest "this is real money on a real date" framing — the big % readout + dollar amount + date pattern matches how planners think.
- Best for ≤3 installments — feels premium and clear.

**Cons:**
- At 11 installments → massive vertical scroll. Card pattern doesn't scale.
- Most vertical real estate consumed of all three mockups.
- Radio-list date-mode toggle takes 2 lines vs segmented control's 1.
- Sticky banner at screen-bottom risks colliding with bottom-tab nav (existing pattern on Trip Wizard).
- Most implementation overhead — per-card hover/focus states + arrange logic.

---

## §4 InstallmentScheduleDisplay (read-only) — single mockup

Renders inside (a) `TripCheckoutFlow.tsx` planner-side preview, (b) all 3 buyer-anon-web checkout routes `index.tsx` + `buyer.tsx` + `payment.tsx`. Same component, four placements (manual parity — three buyer-web files each get their own render per SC-5a/5b/5c).

```
Order summary
┌─────────────────────────────────────────────┐
│  Whistler Adventure                          │
│  3-day private guide                         │
│  ──────────────────                          │
│  1 × Standard                    $1,100.00   │
│  ────────────                                │
│  Subtotal                        $1,100.00   │
│                                              │
│  Payment plan                                │
│  ┌────────────────────────────────────┐    │
│  │  Deposit today           $275.00    │    │
│  │  Jan 15, 2026            $412.50    │    │
│  │  Feb 15, 2026            $412.50    │    │
│  │  ─────────────────                  │    │
│  │  Total                   $1,100.00  │    │
│  └────────────────────────────────────┘    │
│                                              │
│  You're paying $275.00 today. The remaining │
│  $825.00 will charge automatically on the   │
│  dates above. We'll email you before each   │
│  charge.                                     │
│                                              │
│  [ Continue to payment ]                     │
└─────────────────────────────────────────────┘
```

**Layout & interaction:**
- Rendered ABOVE the line-item subtotal row (replaces the "Subtotal" row position when present).
- Container: `radius.lg: 16` glass card with `glass.tint.profileBase` surface + `glass.border.profileBase` border.
- Internal rows: 2-column layout — date label left-aligned, dollar amount right-aligned (Intl.NumberFormat per locale).
- Divider line (1px, `glass.border.profileElevated`) above the Total row.
- Reassurance copy ("You're paying $X today...") below the card in `text.secondary` 14pt — explicit + calming. Tested copy framing — buyers worry about being charged surprise amounts; this kills the surprise.
- Empty state: when `installmentSchedule` is `null`, the component returns null (renders nothing — buyer sees the original single-payment summary unchanged).
- Past-due rows: would render in `semantic.error` red — but Stage 2 v1 rejects past-due plans at the RPC so this state is not user-reachable. Component handles the visual code path defensively.
- NO interactions on this component — pure presentation.

**Placement recommendation across the 4 surfaces:**
| Surface | Placement | Rationale |
|---|---|---|
| `TripCheckoutFlow.tsx` (planner preview) | Above the "Line items" section header | Planner is previewing what buyer sees; same order |
| `app/checkout/[eventId]/index.tsx` (Step 1 — ticket pick) | Above the "Subtotal" row, BELOW the QuantityRow for the selected ticket type | Buyer sees the plan as soon as they add 1 ticket; no surprises later |
| `app/checkout/[eventId]/buyer.tsx` (Step 2 — buyer info) | Above the "Order summary" section header | Reinforces the plan during info entry — friction-reducing |
| `app/checkout/[eventId]/payment.tsx` (Step 3 — Stripe payment) | Replaces the "Total" line with the schedule card; the Stripe CTA copy below changes from "Pay $1,100" to "Pay $275 deposit" | Last-chance visibility before the Stripe redirect — buyer KNOWS exactly what they're agreeing to today |

**Accessibility:**
- Container: `accessibilityLabel="Payment plan schedule"` + `accessibilityRole="list"`.
- Each row: `accessibilityLabel="${dateLabel}, ${amount}"` + `accessibilityRole="listitem"`.
- Total row: `accessibilityLabel="Total ${amount} across ${N} payments"`.
- Reassurance copy: `accessibilityLiveRegion="off"` (static; no need to re-announce).

**Color tokens used:**
- Card surface: `glass.tint.profileBase`
- Card border: `glass.border.profileBase`
- Date labels: `text.primary`
- Dollar amounts: `text.primary` + `fontWeights.semibold`
- Divider: `glass.border.profileElevated`
- Reassurance copy: `text.secondary`

---

## §5 Money tab (operator dashboard) — IA + visual mockup

Joins the existing `[tab === "overview"|"travelers"]` IA on `app/trip/[id]/index.tsx` as a third option. Tab bar becomes 3-segment: Overview · Travelers · Money. State extends to `TabKey = "overview" | "travelers" | "money"`.

```
Trip dashboard /trip/[id]
┌──────────────────────────────────────────────────────────────┐
│ ←  Whistler Adventure                              [ ⋮ ]     │
│                                                               │
│ Overview │ Travelers (12) │ Money ●                          │
│                                                               │
│ ┌── Filter ─────────────────────────────────────────────┐   │
│ │ [ All bookings · 12 ]  [ ⚠ At risk · 1 ]              │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Casey Smith ────────────────── 1 / 3 paid · $275 · ▼ ┐   │
│ │ ⚠ At risk                                              │   │
│ │ Next due Jan 18 (3 days)                               │   │
│ └────────────────────────────────────────────────────────┘   │
│ ┌─ Robin Tanaka ──────────────── 2 / 3 paid · $687 · ▼ ┐    │
│ │ Next due Feb 15                                        │    │
│ └────────────────────────────────────────────────────────┘   │
│ ┌─ Alex Lin ─────────────────── 3 / 3 paid · $1,100 · ▶ ┐   │
│ │ Fully paid · Jan 30                                    │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                               │
│ When ▼ tapped on Casey Smith → row expands:                  │
│ ┌─ Casey Smith ─────────────────── ⚠ At risk · 1 / 3 paid ─┐│
│ │   Deposit          $275.00     ✓ Collected   Jan 1       ││
│ │   Installment 1    $412.50     ✕ Failed       Jan 15      ││
│ │                     Card declined · retry 3/3 · auto-charge stopped││
│ │                     [   Retry now   ]                      ││
│ │   Installment 2    $412.50     ⏱ Scheduled   Feb 15      ││
│ │                                                            ││
│ │   ──────────────────                                       ││
│ │   Total committed              $1,100.00                   ││
│ │   Total collected              $275.00                     ││
│ │                                                            ││
│ │   [ Refund · coming in Tr4 ] (disabled, tooltip)          ││
│ └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

**Layout & interaction:**

- **Tab IA:** extends existing `app/trip/[id]/index.tsx` 2-tab bar to 3 tabs. `tab === "money" && styles.tabActive` toggle, `accessibilityRole="tab"`, `accessibilityState={{selected}}`, `accessibilityLabel="Money tab, ${atRiskCount} ${atRiskCount === 1 ? "at risk" : "at risk"}"`.
- **Filter row:** two pill chips at the top — "All bookings · N" and "At risk · N" (the latter only renders when count > 0, accent.warm border + text). Tap toggles which list is shown.
- **Grouping:** by booking (one row per `orders` row where `installment_plan_root=true`). Sorted by `at_risk DESC, next_due_at ASC` (at-risk on top, soonest-due next).
- **Collapsed row:** shows traveler name (from `orders.buyer_name`), short status line (`N / M paid · $collected`), expand caret. At-risk bookings get a leading `⚠ At risk` red pill. Fully-paid bookings get a subtle gray "Fully paid" label.
- **Expanded row:** full installment ledger. Each installment renders as a 4-col row: (label, dollar amount, status pill, due date). Failed rows get a sub-row with the `failure_reason` translated into friendly copy + a "Retry now" button.
- **Retry button:** inline on failed rows only. `accent.warm` background. Calls `useRetryInstallment(installmentId)` mutation. On success → toast "Retry queued — next cron run will attempt it" (per Constitution #3 + existing `Toast` primitive wrapped per `feedback_toast_needs_absolute_wrap.md`). On error → toast "Couldn't queue retry. Try again."
- **Refund CTA:** disabled with tooltip "Refunds coming in Tr4" — replaces existing destructive-action treatment per ORCH-0862's pattern. Stays in the row for layout continuity even though it can't be tapped.
- **Empty state:** "No bookings on payment plans yet" + helpful copy "When buyers book this trip with a payment plan, their installment schedule shows up here. Configure plans on the Pricing step of your trip wizard." + a single CTA "Edit trip pricing" that deep-links to `TripCreatorWizard` at Step 4.

**Status pills:**
- `scheduled` → gray pill, `⏱` Clock icon, label "Scheduled"
- `collected` → green pill (`semantic.success`), `✓` Check icon, label "Collected"
- `failed` → red pill (`semantic.error`), `✕` X icon, label "Failed"
- `refunded` → blue pill (`semantic.info`), `↩` ArrowLeft icon, label "Refunded" (Tr4 only — not in v1)
- `cancelled` → gray pill, `−` Minus icon, label "Cancelled"

**At-risk visual treatment (DECISION):**
The mockup uses BOTH a leading row pill (`⚠ At risk` red) AND a filter chip at the top. Reasoning:
- The pill on the row gives at-a-glance scanning in the collapsed view.
- The filter chip lets operators jump to the at-risk bookings without scanning.
- A red banner across the entire row was rejected as too alarmist — at-risk does NOT mean the booking is cancelled, just that auto-charge gave up. The booking is still valid; operator just needs to contact the buyer.

**Realtime: NOT in v1 (per SPEC §3.6).** React Query polling at `staleTime: 30_000` + pull-to-refresh (`useRefreshOnFocus`) + the dispatcher's webhook handler invalidates `orderInstallmentKeys.all` on the next mount. Sufficient for v1; realtime subscription on `order_installments` changes is a future ORCH if operators need it.

**Accessibility:**
- Filter chips: `accessibilityRole="button"` + `accessibilityState={{selected: filter === "atRisk"}}` + `accessibilityLabel="Show ${count} at-risk bookings"`.
- Collapsed booking row: `accessibilityRole="button"` + `accessibilityState={{expanded}}` + `accessibilityLabel="${name}, ${paid}/${total} installments paid, ${atRisk ? 'at risk, ' : ''}next due ${dueLabel}"` + `accessibilityHint="Tap to see installment ledger"`.
- Expanded installment rows: `accessibilityRole="listitem"` + `accessibilityLabel="Installment ${ord}, ${amount}, ${statusLabel}, due ${dueLabel}"`.
- Retry button: `accessibilityLabel="Retry installment ${ord} for ${name}"` + `accessibilityHint="Queues a charge attempt on the next cron run"`.
- Refund stub: `accessibilityState={{disabled: true}}` + `accessibilityLabel="Refund · coming in Tr4"`.

**Color tokens used:**
- Tab active border: `accent.warm` 2px bottom border
- Filter chip selected: `accent.warm` background, `text.inverse` text
- Filter chip unselected: `glass.tint.chrome` background, `text.secondary` text
- Booking row card: `glass.tint.profileBase` (collapsed) → `glass.tint.profileElevated` (expanded, after tap)
- Status pills: `semantic.{success|error|info|warning}` background with 18% alpha tint
- At-risk row pill: `semantic.error` text on `semantic.errorTint` background, AlertCircle icon
- Retry button: `accent.warm` background, `text.inverse` foreground
- Refund disabled: `text.quaternary` (rgba 0.32) foreground, no background

---

## §6 Cross-surface impact declaration

Per `feedback_cross_surface_impact_inspection.md` MANDATORY format.

| # | Surface | In scope (this dispatch) | What user sees | Files touched | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` iOS) | **NO** | No change | none | n/a — trips not on consumer app per Tr2 scope |
| 2 | Consumer Android (`app-mobile/` Android) | **NO** | No change | none | n/a — same |
| 3 | Buyer/anonymous Web (`mingla-business/app/checkout/[eventId]/*`) | **YES** | InstallmentScheduleDisplay renders above line items on all 3 routes | `index.tsx`, `buyer.tsx`, `payment.tsx` (3 separate files) | **Manual** per SPEC §4 SC-5a/5b/5c — each route gets its own render call + own success criterion |
| 4 | Business iOS (`mingla-business/` iOS) | **YES** | PaymentPlanEditor on Trip Wizard Step 4; Money tab on Trip dashboard; InstallmentScheduleDisplay in TripCheckoutFlow preview | New `PaymentPlanEditor.tsx`, `InstallmentScheduleDisplay.tsx`; modified `TripCreatorStep4Pricing.tsx`, `TripCheckoutFlow.tsx`, `app/trip/[id]/index.tsx` | **Automatic** — shared RN source |
| 5 | Business Android (`mingla-business/` Android) | **YES** | Same as Business iOS | Same files | **Automatic** — shared RN source |
| 6 | Admin Web (`mingla-admin/`) | **NO** | No change | none | n/a — admin doesn't render trip-ops |
| 7 | Business Web preview (`mingla-business/` web bundle) | **YES** | Same as Business iOS/Android | Same files | **Automatic** via RN-Web bundle. Specific caveats: Modal sheet (Mockup B) renders as stacked overlay on web vs native sheet on iOS — Mockup B less native-feeling on web. Date picker on web uses the browser's `<input type="date">` instead of the iOS wheel picker. |

**Per-route success criteria** (carried into SPEC §4 expansion):
- SC-5a: Buyer on `/checkout/{eventId}/index.tsx` sees InstallmentScheduleDisplay above line items when trip has installment_schedule.
- SC-5b: Buyer on `/checkout/{eventId}/buyer.tsx` sees the same display.
- SC-5c: Buyer on `/checkout/{eventId}/payment.tsx` sees the display AND the Stripe CTA reads "Pay $X deposit" not "Pay $X total".
- SC-10 (Money tab): Brand member on `/trip/{id}` sees Money tab joining Overview + Travelers; tab renders per-traveler installment list with status pills + at-risk badge.
- SC-11 (Retry): "Retry now" button visible only on failed installment rows; calls `biz_retry_installment` RPC; success toast surfaces; row flips back to `scheduled` next render.

---

## §7 Accessibility model — per interactive element

| Element | accessibilityLabel | accessibilityRole | accessibilityState/Value | Min touch | Color contrast |
|---|---|---|---|---|---|
| Payment plan toggle | "Payment plan toggle" | `switch` | `{checked: isOn}` | 44×44pt | toggle thumb vs track ≥ 4.5:1 |
| Deposit % stepper | "Deposit percentage stepper" | `adjustable` | `{text: "${pct}%", min: 10, max: 95, now: pct}` | 44×44pt per +/− chip | accent.warm on dark canvas ≥ 4.5:1 |
| Installment % stepper | "Installment ${ord} percentage stepper" | `adjustable` | same shape | 44×44pt | same |
| Date-mode segmented control | "Due date mode selector" | `tablist` (segments are `tab`) | per-segment `{selected}` | 44×44pt per segment | active segment text on accent.warm ≥ 4.5:1 |
| Days-after-booking input | "Days after booking" | `adjustable` | `{text: "${n} days", min: 1, max: 365, now: n}` | full row ≥ 44pt | text.primary on glass ≥ 7:1 |
| Fixed date picker | "Due date" | none (native picker inherits) | n/a | full row ≥ 44pt | n/a (native) |
| Trash icon row | "Remove installment ${ord}" + hint about re-numbering | `button` | n/a | 44×44pt | semantic.error on glass ≥ 4.5:1 |
| + Add installment button | "Add another installment" + hint "Up to 11" | `button` | `{disabled: count >= 11}` | full-width ≥ 44pt | accent.warm border + text ≥ 4.5:1 |
| Validation copy | (live region only) | `text` | `accessibilityLiveRegion="polite"` | n/a | semantic.error on glass ≥ 4.5:1 |
| Save and continue | "Save and continue to next step" | `button` | `{disabled: !isValid}` | 56pt height | text.inverse on accent.warm ≥ 4.5:1 |
| Money tab | "Money tab, ${atRiskCount} at risk" | `tab` | `{selected: tab === 'money'}` | 44pt height | active border accent.warm ≥ 4.5:1 |
| Filter chip "All bookings" | "All bookings, ${count}" | `button` | `{selected: filter === 'all'}` | 44pt height | active chip text ≥ 4.5:1 |
| Filter chip "At risk" | "Show at-risk bookings, ${count}" | `button` | `{selected: filter === 'atRisk'}` | 44pt height | semantic.error text ≥ 4.5:1 |
| Booking row (collapsed) | "${name}, ${paid}/${total} paid, at risk, next due ${date}" | `button` | `{expanded}` | full-width row ≥ 60pt | text.primary on glass ≥ 7:1 |
| Installment row (expanded) | "Installment ${ord}, ${amount}, ${statusLabel}, due ${dueLabel}" | `listitem` | n/a | full-width row | per status — all ≥ 4.5:1 |
| Retry button | "Retry installment ${ord} for ${name}" + hint "Queues a charge attempt on next cron run" | `button` | `{disabled: loading}` | 44pt height | text.inverse on accent.warm ≥ 4.5:1 |
| Refund stub | "Refund coming in Tr4" | `button` | `{disabled: true}` | 44pt height | text.quaternary on glass ≥ 3:1 (disabled state acceptable) |
| InstallmentScheduleDisplay container | "Payment plan schedule" | `list` | n/a | n/a | n/a |
| InstallmentScheduleDisplay row | "${dateLabel}, ${amount}" | `listitem` | n/a | n/a | text.primary on glass ≥ 7:1 |
| InstallmentScheduleDisplay total | "Total ${amount} across ${N} payments" | `text` | n/a | n/a | text.primary semibold ≥ 7:1 |

**Keyboard navigation order (business-web-preview only):**
PaymentPlanEditor → toggle → deposit stepper (− / value / +) → Installment 1 amount stepper → Installment 1 date-mode segment 1 → segment 2 → Installment 1 date input → Installment 1 trash → Installment 2 ... → + Add installment → Save and continue.

Money tab → tab bar (Overview / Travelers / Money) → filter chips (All / At risk) → first booking row → (when expanded: installment rows → Retry button) → next booking row → end.

---

## §8 Tradeoff matrix + recommendation

| Criterion | Mockup A: Inline | Mockup B: Sheet | Mockup C: Cards |
|---|---|---|---|
| Discoverability | **Highest** — all controls visible | Lowest — hidden behind "Edit plan" | High — each installment is its own visual unit |
| Edit friction (3-installment config) | 1 tap toggle + 3 stepper sequences = ~12 taps | 1 tap toggle + 1 tap Edit + same stepper work + 1 tap Done = ~14 taps | Same as A = ~12 taps |
| Error recovery (sum mismatch) | Scroll up to find offending row | Sticky footer always shows error; in-context | Same as A — scroll required |
| Vertical real estate at 3 installments | ~400pt | ~120pt (parent) + 600pt (sheet) | ~520pt |
| Vertical real estate at 11 installments | ~1200pt → very long scroll | Same as A inside sheet, but sticky footer helps | ~1800pt → severe scroll |
| Code complexity (LOC estimate) | ~280 LOC | ~380 LOC (Modal + sticky footer) | ~340 LOC (per-card layout) |
| Cross-surface complexity | Lowest — pure inline render | High — Modal renders differently on RN-Web | Medium |
| Onboarding clarity for first-time use | **Best** — planner sees what's possible | Worst — hidden | Good but verbose |
| Mid-config validation visibility | Bottom of card after scroll | **Best** — sticky footer always shows | Bottom of screen (sticky banner) |
| Parity with mingla-business design language | High — composes existing primitives | Medium — adds Modal sheet pattern not yet established in trip wizard | High — matches GlassCard pattern |
| Future extensibility (operator-requested additions) | Easy — append rows inline | Easy — same | Hard — cards already feel "done" |

### Recommendation: **Mockup A (Inline form)** with one borrowed element from Mockup B

**Why:**
1. **Discoverability wins for first-time use.** Stage 2 is the FIRST time planners can configure installments in-product. Hidden-behind-Edit (Mockup B) means planners may not realize how flexible the feature is. The 1-tap-fewer cost of inline is real every-day, and the visibility cost of hiding is paid every time.
2. **Code complexity is lowest** (280 LOC) — composes existing `Input.variants.stepper`, `GlassCard`, `ConfirmDialog`, `Button`, `Pill`. No new modal animation, no new sticky-footer plumbing. Faster to ship, smaller bundle, fewer cross-surface risk surfaces.
3. **Cross-surface parity is best** — pure inline RN render works identically on iOS sim, Android emu, and web preview. Mockup B's Modal sheet has a known web-vs-native rendering divergence (`presentationStyle="pageSheet"` is iOS-only; on web it's a stacked overlay).
4. **Borrow Mockup B's sticky validation footer.** Mockup A's biggest weakness is "scroll up to find the error." Solve it by adding a sticky validation banner at the BOTTOM of the inline editor card (not the screen — within the card itself). Best of both: visible always, but no Modal complexity.
5. **The 11-installment vertical real-estate problem is theoretical.** SPEC enforces max 11; in practice operators will use 2–4 installments (matches WeTravel usage patterns per §RESEARCH-0825). 11-installment edge case can be addressed with a `ScrollView` inside the editor card if it ever materializes.

**Mockup C rejected because:**
The cards pattern is visually appealing but doesn't scale, costs more LOC, and the verbose date-mode radio list adds height for no functional gain over Mockup A's segmented control. The aesthetic gain is real for ≤3 installments but lost at the 5+ installment range.

**Mockup B rejected for the primary direction because:**
Discoverability is the dominant requirement for Stage 2's first launch. Once installment plans are well-established (≥6 months post-launch), a future polish ORCH could move PaymentPlanEditor into a sheet for the compactness benefit — but that's a polish iteration, not the initial design.

---

## §9 Open questions for SPEC phase to resolve

1. **InstallmentScheduleDisplay placement on `payment.tsx`** — does the Stripe CTA copy ALSO change ("Pay $X deposit" vs "Pay $X total")? I propose YES (SC-5c reflects this) but it requires touching the Stripe Hosted Checkout URL params or the local CTA label. SPEC should confirm + name the file modification.
2. **Money tab empty-state CTA "Edit trip pricing" deep-link target** — exact route + state-restore behavior. Does it open the wizard at Step 4 directly, or at Step 1 with the trip pre-selected? Per existing wizard pattern, I propose Step 4 with `?step=pricing` URL param. SPEC should confirm + check whether `TripCreatorWizard` supports step deep-linking today (it probably doesn't — minor scope add).
3. **At-risk count badge on the tab label itself** — should the Money tab show "Money (1)" when 1 booking is at-risk (mirroring `Travelers (12)` count pattern), or stay clean as "Money"? Recommendation: SHOW the at-risk count in red — operator awareness is the competitive advantage over WeTravel. SPEC should confirm + name the threshold (every at-risk booking, or only newly-at-risk in last 7 days).
4. **Retry button confirm dialog** — should "Retry now" prompt a ConfirmDialog ("Retry $X charge for ${name}?") before queuing, or fire immediately with toast feedback? Recommendation: NO confirm dialog (the action is reversible — buyer can decline, cron just retries later). One tap is cleaner. SPEC should confirm.
5. **Refund stub** — keep visible-but-disabled, OR hide entirely until Tr4 ships? Recommendation: KEEP visible-but-disabled — sets the expectation that refund tooling is coming and prevents operators from asking "where's refund?". SPEC should confirm + lock the copy "Refunds coming in Tr4" (or pick a friendlier alternative).
6. **PaymentPlanEditor on edit of an existing published trip** — Tr2 ships trip-edit lock-out on certain fields after first booking. Does pricing schedule fall under that lock? Probably YES (once buyers have committed to a plan, the planner can't shift the schedule mid-trip). SPEC should confirm + the editor should render read-only-with-banner state in that case.
7. **Currency display in PaymentPlanEditor** — the trip already has a fixed currency at this step. Use `Intl.NumberFormat(locale, {style: 'currency', currency: trip.currency})` per Constitution #10. SPEC should confirm `trip.currency` is available at the PaymentPlanEditor mount point.
8. **Floating-point pct sum tolerance** — design uses integer % steps in 5% increments. SPEC should confirm 5% step is the v1 lock (not 1% or 0.5%) so the QA P3-2 edge case never materializes in product. If operators want finer control later, that's a follow-up ORCH.

---

## §10 Discoveries for orchestrator

1. **PaymentPlanEditor + InstallmentScheduleDisplay are RE-USABLE.** The same primitives could power future ORCHs: e.g., refund-engine UI in Tr4 (different layout, same data model); subscription-plan UI for a future creator-membership product (different defaults, same stepper pattern). Worth filing a `@mingla/installment-ui` future-package consideration — not a near-term action, just a note.
2. **The Money tab's at-risk filter chip pattern could generalize.** Travelers tab today has no filter affordance; if operators want "show all unpaid bookings" or "show all door-sale bookings," the same chip pattern from Money tab fits cleanly. Worth registering as a polish-ORCH "Travelers tab filters" if operators request.
3. **Date picker fragmentation across the wizard** — Trip Wizard Step 1 uses one date picker; Pricing's `fixed_date` mode here introduces another. Audit + consolidate to a single shared `<DatePicker>` primitive recommended. Not in scope here but flag for future.
4. **The InstallmentScheduleDisplay's reassurance copy ("You're paying $275.00 today...") is the kind of buyer-facing text Stage 2 ships in 4 places at minimum**. Worth establishing a `_shared/copy/installmentReassurance.ts` constant so the wording is centralized and not drifted across 4 files. Strict-grep gate could enforce single source. Minor — flag for implementor.
5. **The "Edit plan / Remove plan" parent-row pattern from Mockup B could still ship in Mockup A** as the COLLAPSED state after configuration. Trade-off worth re-examining at implementor time: show the full editor by default, or collapse to summary after Save? Recommendation: keep the editor expanded (Mockup A as-is) — simpler. But operator may want collapsed-after-save behavior; defer to implementor + first-real-use feedback.
6. **WCAG AA invariants from ORCH-0863 Cycle 17c (I-38 IconChrome touch ≥ 44pt, I-39 accessibilityLabel coverage) apply directly to PaymentPlanEditor.** Implementor should run the existing `app-mobile/scripts/ci/i-37` + `i-38` + `i-39` gate variants against mingla-business too (or register a mingla-business-side mirror). Worth flagging.

---

## §11 Cross-skill notes for downstream

### For Claude `mingla-forensics` (SPEC phase)
- Most of SPEC_ORCH-0869 §3.5 + §3.6 content already covers the functional contract. This SPEC pass should be LIGHT — promote design selections (Mockup A + Mockup B's sticky footer) into formal success criteria; resolve §9 open questions; expand SC-5a/5b/5c into per-route validation criteria; declare cross-surface impact per §6; name regression-test surfaces.
- The 2 remaining DRAFT invariants (`I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY`, `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH`) become enforceable here — SPEC must specify the new CI strict-grep gates for both.

### For Codex `implementor-mingla` (or Claude `mingla-implementor`)
- Use this design doc + the SPEC's success criteria. Don't re-design.
- Compose from existing primitives (`Input.variants.stepper`, `GlassCard`, `ConfirmDialog`, `Button`, `Pill`, `Modal` for the Confirm dialog, `Toast`).
- Lucide icons (Plus, Trash2, ChevronDown, AlertCircle, Clock, Check, X, Minus) — coordinate with ORCH-0870 [icons replacement] if that's still in flight; otherwise use existing icon set.
- Currency formatting via `Intl.NumberFormat` per Constitution #10.
- Toast usage MUST wrap per `feedback_toast_needs_absolute_wrap.md`.
- `accessibilityLabel` on every interactive element per I-39.
- 44pt min touch per I-38.

### For Claude `mingla-tester`
- Cross-surface parity is MANUAL on 3 buyer-anon-web routes per SC-5a/5b/5c — verify each route renders InstallmentScheduleDisplay correctly via Playwright on web preview.
- Money tab tab-order + filter chips + Retry mutation flow via Maestro on iOS sim + Android emu.
- Stripe test clock end-to-end: configure trip → buy → fast-forward 30d → installment fires → verify Money tab updates.
- The 20 test cases from SPEC §6 should map directly to test files; tester adversarial test should attack a different angle (e.g., what if `installment_schedule` is mid-mutation when the buyer hits checkout; what if 11 installments stacked render correctly; what if at-risk badge mid-update during cron run).

### For Claude OR Codex `mingla-orchestrator` (CLOSE)
- One PR per CLOSE rule applies. Bundle Stage 2 with Stage 1c (ORCH-0872) only if operator pre-approves.
- 2 new CI strict-grep gates from SPEC §11 (the 2 remaining DRAFT invariants).
- EAS OTA REQUIRED on close — Stage 2 ships JS-only mobile/business changes. iOS + Android both.

---

End of design doc.

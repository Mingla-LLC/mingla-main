# DESIGN — ORCH-1130 [public trip page payment-structure + installments UX redesign]

**Phase:** DESIGN (pixel-precise contract). No product-code edits.
**Skill:** mingla-designer (Direction 2, Seth-confirmed).
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1130-[trip-pay-structure]/` on `ORCH-1130-trip-pay-structure`.
**Companion:** `SPEC_ORCH-1130_PUBLIC_TRIP_PAYMENT_UX.md` (build contract) + `INVESTIGATE_ORCH-1130_PUBLIC_TRIP_PAYMENT_UX.md` (evidence).
**Date:** 2026-06-12.

Comms ledger read on entry. COMMS-0029 / COMMS-0030 are active WARNs scoped to `biz_update_live_trip` (trip **authoring** RPC) — zero overlap with the buyer-checkout path this design touches. FYI-grade for this ORCH; no ack required (not directed at designer or ORCH-1130). The authoring `variant="planner"` sites are DO-NOT-TOUCH.

---

## 0. North Star (the moment we are designing for)

A buyer is looking at a trip they might book. Right now the page **tells them how the money works only after they have typed their name, email and phone** (web), or **never tells them at all and silently charges 25% (consumer)**. Both feel like a bait. The redesigned moment: **before any commitment, the buyer sees the price once, sees plainly "pay it all now" vs "pay a deposit and the rest over time", picks, and the schedule for the chosen option appears.** No surprise at the end. No hero repeated three times. No passive "here is a plan you did not ask for" card.

Design pillars:
1. **One price anchor, stated once.** The floating bar is the price; the body stops re-printing the title/brand/price.
2. **The choice is the hero of the decision, not a step-3 afterthought.** Pay-full and pay-over-time are two equal, legible options at consideration time.
3. **Schedule on demand, for the selected option only.** The full installment ladder is progressive disclosure — it appears under "pay over time" when that is chosen, never as a standalone fait-accompli.
4. **Consent is non-negotiable (consumer).** A consumer on a plan trip must see and pick the structure before the charge. No `'auto'`.

---

## 1. IA & FLOW

### 1.1 Path A — business-web / business iOS / Android (`/t/[…]` → `/checkout-trip/*`)

**Current IA (broken):** `TripPreview` hero → countdown/closed → refund ladder → `TripCheckoutFlow` (re-prints `by Brand` + title + a tier card + a passive plan projection + helper) → floating bar. Then a 3-step funnel: step 1 tier+qty (+plan projection), step 2 buyer details (+plan projection), step 3 payment (the ONLY real choice + 2 more plan surfaces).

**New IA (Direction 2):**

```
PUBLIC TRIP PAGE  /t/[brandSlug]/[tripSlug]
┌──────────────────────────────────────────────┐
│  HERO (TripPreview, unchanged)                │  ← title + brand + cover live HERE, once
│  · cover · title · by Brand · date · location │
├──────────────────────────────────────────────┤
│  COUNTDOWN PILL  or  CLOSED BANNER (existing)  │
├──────────────────────────────────────────────┤
│  REFUND POLICY LADDER (existing, if set)       │
├──────────────────────────────────────────────┤
│  ── "How payment works" MODULE ──  (NEW)       │  ← replaces TripCheckoutFlow's hero-dupe + passive projection
│   [Pay in full]      [Pay over time]           │     two equal option cards (segmented selector)
│   <schedule for the SELECTED option only>      │     full → "one charge of €500 today"
│                                                 │     over-time → InstallmentScheduleDisplay ladder
│   (ENTIRE module renders only if a plan exists; │
│    no-plan trip shows a single quiet price line)│
└──────────────────────────────────────────────┘
   FLOATING BAR:  "From €500"  ·  [Reserve my spot →]   (price anchor; see §1.4)
```

Tapping Reserve carries the chosen `payment_plan_choice` into the **collapsed 2-step funnel** (see §1.3). On a no-plan trip the module is a single price recap line (no selector) and Reserve behaves exactly as today.

**`TripCheckoutFlow` is gutted of its hero dupe.** Lines 98–99 (`by {brand.name}` + `{trip.title}`) are removed. The single auto-selected tier card collapses into the new module's price line. The passive standalone `InstallmentScheduleDisplay` projection is replaced by the selector-gated schedule.

### 1.2 Decision & action

- **The decision:** pay-full vs pay-over-time (only on plan trips). Single-tier reality means there is NO tier decision — the sole tier is implicit.
- **The action:** Reserve → checkout.
- **Progressive disclosure ladder:** price (always) → choice (plan trips) → schedule (over-time selected) → checkout review → pay.

### 1.3 Collapsed funnel (3 → 2 steps)

```
TODAY (3 steps):  [1 Tier+Qty] → [2 Buyer details] → [3 Payment + the choice]
NEW (2 steps):    [1 Your details] → [2 Review & pay]
                   (intake step is conditional, unchanged — only when a tier has a schema)
```

- **Tier-select step (old step 1) is removed for single-tier trips.** 45/45 trips are single-tier; the sole tier auto-selects (qty defaults to 1) when Reserve fires. A buyer who needs qty > 1 adjusts it on the **Review & pay** step (a compact stepper on the order-summary line). A `>1 tier` trip (none in prod, but contract-safe) falls back to the legacy tier-select step 1.
- **Step 1 "Your details"** = today's `buyer.tsx` (name/email/phone/marketing). The plan projection cards are REMOVED from this step (the choice already happened on the public page; this step is pure data entry). `CheckoutHeader` reads **"1 OF 2"**.
- **Step 2 "Review & pay"** = today's `payment.tsx`, now also the home of the **qty stepper** + the **order summary** + the **payment-choice selector (pre-filled from the public-page choice, still editable here)** + the selected schedule + tax preview (native) + Pay button. `CheckoutHeader` reads **"2 OF 2"**.
- The choice **lives on the public page first** and is **re-confirmable on Review & pay** (the selector persists in `CartContext`). This satisfies "move the choice earlier" without removing the buyer's last-chance edit.

### 1.4 FloatingOfferingBar price anchor (disambiguated)

The bar's `From €500` is ambiguous today (is it full? deposit? per-person?). New contract:

- **No-plan trip:** `€500` (no "From" — single tier, exact). Sublabel none. Button `Reserve my spot`.
- **Plan trip, nothing chosen yet (public page default):** `€500 total` with the button `Reserve my spot`. The word **"total"** makes it unambiguous this is the full trip price, not a deposit. (The deposit number lives inside the module, never on the bar.)
- **Per-person:** trips are priced per spot; the bar shows the per-spot price. Add a micro caption under the price ONLY when capacity semantics are per-person and qty default is 1 → `€500 · per spot`. (Single source: `tier.priceCents`; never recompute.)
- `From` prefix is retained ONLY for the theoretical multi-tier trip (cheapest tier). Single-tier uses the exact price with no `From`.

### 1.5 Path B — consumer app-mobile (`ConsumerTripDetailScreen` → `ExpandedBusinessEventSheet` → `nativeCheckoutFlow`)

**Current IA (broken + consent bug):** trip detail sheet (hero → meta → bands → refund → about → itinerary → inclusions → **Pricing tier rows**) → Reserve → `ExpandedBusinessEventSheet` cart → tax preview → PaymentSheet. NO installment surface anywhere; `nativeCheckoutFlow` sends no `payment_plan_choice` → server `'auto'` → silent 25%-deposit charge.

**New IA:** insert a **"How payment works" module** into the trip detail sheet, directly under the existing **Pricing** section (the natural money zone), and thread the chosen `payment_plan_choice` from there → `setReserveSheetVisible` → `ExpandedBusinessEventSheet` → `runNativeCheckout` → `nativeCheckoutFlow` body → edge fn body key `payment_plan_choice`.

```
CONSUMER TRIP DETAIL SHEET (BaseBottomSheet, scrollMode="scroll")
  … hero · meta · deadline band · refund ladder · about · itinerary · inclusions …
  ┌─ PRICING (existing section) ─────────────────┐
  │  Standard spot                      €500      │
  ├─ HOW PAYMENT WORKS (NEW, plan trips only) ────┤
  │   [Pay in full]      [Pay over time]          │  ← mirrors Path A selector
  │   <selected schedule / one-charge line>       │
  └───────────────────────────────────────────────┘
  RESERVE FOOTER (pinned 2nd child):  From €500  · [Reserve]
```

- **No-plan trip:** the module does NOT render (null-on-null), detail screen is byte-identical to today.
- **Plan trip:** the module renders; the buyer MUST have an active selection before Reserve. Default selection is **"Pay in full"** (the deliberate, non-surprising default — matches web's `useState("full")`, and a buyer who does nothing pays the whole price, never a silent partial). The buyer opts INTO the plan; opting in is explicit consent.
- Because the consumer cart auto-derives buyer info from the auth profile (no buyer form, no extra step), the choice is collected HERE on the detail screen — there is no later screen to host it. The choice value is stashed and passed straight through `ExpandedBusinessEventSheet` → `runNativeCheckout`.
- The native PaymentSheet shows only the charged-today amount; a **pre-Reserve disclosure line** under the module states the deposit-today + auto-charge reality (WYSIWYP, Constitution #3) — mirroring web's pre-Stripe banner.

---

## 2. THE PAYMENT-CHOICE MODULE (shared visual contract, both paths)

### 2.1 Chosen pattern — TWO-CARD VERTICAL SELECTOR (radiogroup)

This is the **recommended** pattern and is a direct evolution of the selector already shipped in `payment.tsx:574–636` (two stacked `Pressable` radios inside a `GlassCard`, `accessibilityRole="radiogroup"`). We KEEP that exact anatomy and MOVE it earlier. See §7 FORK for the alternatives and trade-offs.

#### ASCII wireframe — plan trip, "Pay in full" selected (default)

```
┌───────────────────────────────────────────────────────┐  GlassCard variant="base" radius="lg" pad=md(16)
│  HOW YOU PAY                                           │  labelCap: 11/700/ls1.4  text.tertiary
│                                                       │
│ ┌───────────────────────────────────────────────────┐ │  option card SELECTED
│ │ ● Pay in full                          €500       │ │  ← radio dot accent.warm; title 15/700 primary
│ │   One charge today. Nothing scheduled later.      │ │  ← body 12/400 secondary
│ └───────────────────────────────────────────────────┘ │  border accent.warm 0.75 / fill warm 0.12
│ ┌───────────────────────────────────────────────────┐ │  option card UNSELECTED
│ │ ○ Pay over time             €125 today + 2 more   │ │  ← title 15/700; trailing summary 13/600 secondary
│ │   25% deposit now, then 2 scheduled payments.     │ │  ← body 12/400 tertiary
│ └───────────────────────────────────────────────────┘ │  border white 0.08 / fill white 0.03
│                                                       │
│  You'll be charged €500 today. No future bills for    │  termsCopy 12/400 text.tertiary  (full selected)
│  this booking. Refunds follow the organizer's policy. │
└───────────────────────────────────────────────────────┘
```

#### ASCII wireframe — plan trip, "Pay over time" selected → schedule revealed

```
┌───────────────────────────────────────────────────────┐
│  HOW YOU PAY                                           │
│ ┌───────────────────────────────────────────────────┐ │
│ │ ○ Pay in full                          €500       │ │  unselected
│ │   One charge today. Nothing scheduled later.      │ │
│ └───────────────────────────────────────────────────┘ │
│ ┌───────────────────────────────────────────────────┐ │
│ │ ● Pay over time             €125 today + 2 more   │ │  SELECTED (accent border/fill)
│ │   25% deposit now, then 2 scheduled payments.     │ │
│ └───────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │  ← InstallmentScheduleDisplay variant="buyer"
│  │  Deposit today                         €125.00  │  │     isProjection={true}  (UNCHANGED component)
│  │  Jul 12, 2026                          €250.00  │  │     GlassCard variant="elevated"
│  │  Aug 11, 2026                          €125.00  │  │
│  │  ──────────────────────────────────────────────  │  │
│  │  Total                                 €500.00  │  │
│  └─────────────────────────────────────────────────┘  │
│  You're paying €125.00 today. The remaining €375.00   │  ← installmentReassuranceText (UNCHANGED)
│  will charge automatically on the dates above. We'll  │     + projection clarifier
│  email you before each charge. Dates assume you book  │
│  today; they lock when you pay.                       │
└───────────────────────────────────────────────────────┘
```

#### ASCII wireframe — NO-PLAN trip (selector suppressed)

```
┌───────────────────────────────────────────────────────┐  (Path A public page only — a quiet recap)
│  Standard spot                              €500      │  tierName 14/400 secondary · price 24/700 primary
│  One secure payment. Stripe handles it; we never      │  helper caption 12/500 tertiary, centered
│  see your card.                                       │
└───────────────────────────────────────────────────────┘
   (Consumer path renders NOTHING extra — Pricing rows already show €500.)
```

### 2.2 Anatomy & exact tokens

Reuse the already-shipped `payment.tsx` style values verbatim (they are the design source of truth and already pass the Android glass policy via `GlassCard`):

| Element | Token / value | Source |
|---|---|---|
| Module container | `GlassCard variant="base" radius="lg" padding={spacing.md}` (16) | payment.tsx `paymentChoiceCard` |
| Section label "HOW YOU PAY" | `fontSize 11 · weight 700 · letterSpacing 1.4 · color text.tertiary · marginBottom spacing.sm(8)` | `summaryLabel` |
| Option card gap | `gap: spacing.sm (8)` | `choiceSegment` |
| Option card (unselected) | `borderRadius 12 · borderWidth 1 · borderColor rgba(255,255,255,0.08) · bg rgba(255,255,255,0.03) · padH spacing.md(16) · padV spacing.sm(8)` | `choiceOption` |
| Option card (selected) | `borderColor rgba(235,120,37,0.75) · bg rgba(235,120,37,0.12)` | `choiceOptionSelected` |
| Option title | `fontSize 15 · lineHeight 19 · weight 700 · color text.primary` (bumped from 14→15 for hierarchy at consideration time) | evolves `choiceTitle` |
| Option body | `marginTop 3 · fontSize 12 · lineHeight 17 · weight 400 · color text.secondary(full)/tertiary(plan)` | `choiceBody` |
| Trailing amount summary (NEW) | right-aligned in the title row: `fontSize 13 · weight 600 · color text.secondary` — `€500` (full) / `€125 today + 2 more` (plan) | new, mirrors `summaryTotal` |
| Terms copy | `marginTop spacing.sm(8) · fontSize 12 · lineHeight 18 · weight 400 · color text.tertiary` | `paymentTermsCopy` |
| Schedule card | `<InstallmentScheduleDisplay variant="buyer" isProjection>` — UNCHANGED | component |
| Radio dot (NEW, optional reinforcement) | 18×18, `borderWidth 1.5`; unselected `borderColor white 0.28`; selected `borderColor accent.warm` + inner 8×8 `accent.warm` dot | new micro; color is NOT the only selected signal (border + fill also change) |

The **selected state is signaled by THREE redundant channels** (border color, fill tint, radio dot) so it is never color-alone — satisfies the a11y "color is not the only indicator" rule.

### 2.3 Copy (plain, WYSIWYP, currency-formatted via `Intl.NumberFormat`, no fabricated numbers)

| Slot | Copy |
|---|---|
| Module label | `HOW YOU PAY` |
| Full option title | `Pay in full` · trailing `{fullPrice}` |
| Full option body | `One charge today. Nothing scheduled later.` |
| Over-time option title | `Pay over time` · trailing `{deposit} today + {N} more` |
| Over-time option body | `{depositPct}% deposit now, then {N} scheduled payment{s}.` |
| Terms (full selected) | `You'll be charged {fullPrice} today. No future bills for this booking. Refunds follow the organizer's policy.` |
| Terms (over-time selected) | reuse `installmentReassuranceText({ depositFormatted, remainingFormatted, isProjection:true })` UNCHANGED, shown under the schedule card. |
| No-plan helper | `One secure payment. Stripe handles it; we never see your card.` |
| Consumer pre-Reserve disclosure (over-time) | `Reserve charges {deposit} today. The rest auto-charges from this card on the dates above.` |

`{depositPct}` is read from the schedule template (`deposit_pct`), never hardcoded; for the live test trip it renders `25%` / `€125 today + 2 more` / dates `Jul 12` + `Aug 11`.

---

## 3. PATH A — PUBLIC PAGE + COLLAPSED FUNNEL (detailed states)

### 3.1 Public page module — `TripCheckoutFlow.tsx` rebuild

States the module must render:

| State | What renders |
|---|---|
| **No-plan trip** | the quiet price recap line (§2.1 wireframe 3). NO selector. Reserve carries `payment_plan_choice` UNSET (web today already omits it when no plan). |
| **Plan trip, full selected (default)** | selector, "Pay in full" active, terms line. NO schedule card. |
| **Plan trip, over-time selected** | selector, "Pay over time" active, `InstallmentScheduleDisplay` ladder + reassurance. |
| **Bookings closed** | module is HIDDEN; the existing closed banner + non-tappable floating strip own the surface (no point choosing a payment for a closed trip). |
| **Free trip** | module HIDDEN; floating bar shows `Reserve my spot` (free). |
| **Tier undefined / not bookable** | existing error text ("This trip isn't bookable yet"); no selector. |

The chosen value is held in a new `CartContext` field (`paymentPlanChoice`) so it survives navigation into the funnel. Default `"full"`.

### 3.2 Step 1 "Your details" — `buyer.tsx`

- Header `CheckoutHeader stepIndex={0} totalSteps={2}` → renders "1 OF 2".
- REMOVE the standalone `InstallmentScheduleDisplay` projection (line 461–469) — the schedule already lives on the public page / Review step; this is a pure data-entry step.
- Order-summary recap card stays (it is useful context), but its "Edit" affordance now routes back to the public page (or Review's qty stepper), not a dead tier step.
- Everything else (validation, phone, marketing opt-in, free-path) unchanged.

### 3.3 Step 2 "Review & pay" — `payment.tsx`

- Header `stepIndex={1} totalSteps={2}` → "2 OF 2".
- The existing selector (574–636) is RETAINED here as the **last-chance editor**, pre-filled from `CartContext.paymentPlanChoice`. (It is the same component as the public-page module — single implementation.)
- ADD a compact **qty stepper** on the order-summary line (replaces the deleted tier step's qty control). Default 1; `−`/`+` are ≥44pt. The schedule + totals recompute live (the projection util already takes `quantity`).
- Keep the schedule card (640–648), the pre-Stripe banners (700–748), the Pay-button deposit/full label logic (756–787), tax preview (native). All UNCHANGED in behavior; they now read the choice the buyer already made.

### 3.4 Per-state Pay-button label (unchanged logic, restated)

| State | Web label | Native label |
|---|---|---|
| Full | `Pay {fullPrice}` | `Pay {displayTotal}` |
| Over-time | `Pay {deposit} deposit` | `Pay {displayTotal}` (native total is venue-tax-inclusive; deposit framing in the banner) |

---

## 4. PATH B — CONSUMER MODULE (detailed)

### 4.1 Placement & data

- The module mounts in `ConsumerTripDetailScreen` `detailBody`, immediately AFTER the existing **Pricing** `section` (line 589–603).
- The screen currently has NO plan data. The SPEC plumbs `installmentSchedule` from `trip_pricing_tiers.tier_metadata.installments` (already SELECTed by `useConsumerTripDetail`'s `tiersResp` at line 235 — only the nested `ticket_types` is mapped today; the jsonb is present). `TripDetailTier` gains `installmentSchedule: TripInstallmentScheduleData | null`. The same `projectInstallmentSchedule(tier, new Date())` util produces the display schedule. Null-on-null → module suppressed.

### 4.2 Visual deltas vs Path A

The consumer detail sheet uses **literal hex values** (not the `designSystem` tokens) — e.g. `WARM = "#eb7825"`, `ACCENT = "#FF6B35"`, white-alpha text. The module MUST match the surrounding consumer styles, not import the business tokens:

| Element | Consumer value |
|---|---|
| Section label "HOW YOU PAY" | `fontSize 13 · weight 700 · letterSpacing 0.5 · color WARM(#eb7825) · textTransform uppercase` (matches `sectionLabel`) |
| Option card unselected | `borderRadius 12 · borderWidth 1 · borderColor rgba(255,255,255,0.10) · bg rgba(255,255,255,0.04) · padH 14 · padV 10` |
| Option card selected | `borderColor rgba(235,120,37,0.7) · bg rgba(235,120,37,0.14)` (matches the `bandCountdown` accent family) |
| Option title | `15/700 #FFFFFF` |
| Option body | `13/400 rgba(255,255,255,0.65)` |
| Schedule | reuse `@mingla/event-rendering`'s buyer schedule render if exported there; else a local mirror of the row layout with consumer hex. (SPEC resolves which; the component is the same null-on-null contract.) |

Selected-state again uses border + fill + radio dot (3 channels).

### 4.3 Consumer states

| State | Render |
|---|---|
| **No-plan trip** | module not mounted. Detail screen byte-identical to today. |
| **Plan trip, full (default)** | selector full-active; pre-Reserve disclosure line: `Reserve charges {fullPrice} today.` Reserve passes `payment_plan_choice="full"`. |
| **Plan trip, over-time** | selector over-time-active; schedule ladder + reassurance; pre-Reserve disclosure: `Reserve charges {deposit} today. The rest auto-charges from this card on the dates above.` Reserve passes `payment_plan_choice="installments"`. |
| **Bookings closed** | module HIDDEN (Reserve already disabled → "Bookings closed"). |
| **Booking unavailable (brand can't charge)** | module HIDDEN (non-tappable strip owns the footer). |
| **Free trip** | module not mounted. |

### 4.4 The consent fix (DISC-1130-A) — exact value passed

`nativeCheckoutFlow` body gains `...(input.paymentPlanChoice ? { payment_plan_choice: input.paymentPlanChoice } : {})`. The value originates from the detail-screen selector (default `"full"`), flows through `ExpandedBusinessEventSheet.handleBuy`'s `runNativeCheckout({...})` call. **The server NEVER receives `'auto'` from the consumer path again** — a plan trip always carries an explicit `"full"` or `"installments"` the buyer chose. A no-plan trip omits the key (byte-identical request), so the edge-fn default path is untouched for the 99% case.

---

## 5. MOTION

| Trigger | Property | Curve | Duration | Reduced-motion |
|---|---|---|---|---|
| Tap an option card | border/fill cross-fade + radio dot scale-in | `easings.out` (cubic-bezier .33,1,.68,1) | `durations.fast` 120ms | instant swap (no fade), state still flips |
| Over-time selected → schedule appears | height + opacity reveal of the schedule card | `LayoutAnimation.easeInEaseOut` (consumer already wires this for About) / `durations.normal` 200ms | render with no animation (the `reduceMotion` flag already read in `ConsumerTripDetailScreen`) |
| Press feedback on option | `opacity 0.85 + scale 0.99` while pressed | `easings.press` | `durations.instant` 80ms | opacity only |
| Reserve haptic | `Haptics.impactAsync(Light)` on tappable (existing) | — | — | unaffected (haptic, not motion) |

No decorative motion. Every animation communicates "you picked this" or "here's the consequence of that pick."

---

## 6. ACCESSIBILITY

- **Radiogroup preserved + extended.** The module's option list is `accessibilityRole="radiogroup"` with `accessibilityLabel="How you pay"`; each card `accessibilityRole="radio"` + `accessibilityState={{ selected }}` (the exact pattern already in `payment.tsx:582–614`). Public-page + consumer modules adopt the SAME roles.
- **Labels read the money:** full → `"Pay full {fullPrice} now"`; over-time → `"Pay over time, {deposit} deposit today plus {N} future payments"` (verbatim from the shipped labels).
- **Schedule** keeps its `accessibilityRole="list"` + per-row labels + the `"Total {x} across {N} payments"` summary (unchanged).
- **Touch targets ≥44pt:** each option card padV gives ≥44pt height (title+body+pad). The qty stepper `−`/`+` are explicit 44×44 hit areas. Radio dot is decorative; the whole card is the tap target.
- **Reading order** = visual order: label → full option → over-time option → terms/schedule → (Reserve).
- **Color never sole indicator:** selected = border + fill + dot + (VoiceOver) `selected` state.
- **Dynamic Type / large text:** titles and bodies use scalable RN `Text`; the trailing amount wraps below the title if the row would overflow (no truncation of price).
- **Pre-Reserve disclosure (consumer)** is `accessibilityRole="alert"`-equivalent text so a screen reader announces the deposit reality before the buyer taps Reserve (mirrors web's `accessibilityRole="alert"` banner).

---

## 7. PER-PLATFORM DELTAS

| Concern | Web (business) | iOS (business + consumer) | Android (business + consumer) |
|---|---|---|---|
| Module surface | `GlassCard` (business) renders as a translucent card; DOM | translucent blur glass | **opaque ≥0.92 fallback** — `GlassCard` already applies `ANDROID_GLASS_USES_OPAQUE_FALLBACK` (opaque fill, `overflow:'hidden'`, no Android shadow). Consumer module uses solid `rgba(255,255,255,0.04)`→ on Android composite to an opaque `#16181b`-family fill, no elevation. |
| Selected fill `rgba(235,120,37,0.12/0.14)` | fine | fine | translucent accent tint over the opaque card is acceptable (it sits ON an opaque surface, nothing bleeds through) — KEEP. Do NOT add Android shadow to the option card. |
| Schedule card | `InstallmentScheduleDisplay` uses `GlassCard variant="elevated"` — already Android-safe | translucent | opaque fallback inside the component (unchanged) |
| Pay button | hosted-Stripe redirect; deposit label | native PaymentSheet; full label | same as iOS |
| Tax preview | omitted on web (hosted handles it) | `CartTaxPreview` required before Pay | same |
| Haptics | none | `expo-haptics` on Reserve/select | same |
| Back gesture | browser | swipe-back / sheet pan-down | system back / pan-down |

**Android glass statement (required):** every glass surface in this design = iOS translucent (`GlassCard` default blur + `rgba(255,255,255,0.04–0.06)` fills) / Android opaque ≥0.92 frosted fill via the `GlassCard`'s existing `Platform.select`, `overflow:'hidden'` clip, NO Android elevation under the rounded fill. No NEW translucent Android fills are introduced. The accent selected-tints are layered on top of an already-opaque card and are retained.

---

## 8. BUILD-READY HANDOFF (tokens + primitives)

- **Existing tokens used:** `spacing.{xs,sm,md,lg}`, `radius.{md,lg}`, `text.{primary,secondary,tertiary}`, `accent.warm`, `glass.*`, `typography.labelCap`, `semantic.error`, `durations.{instant,fast,normal}`, `easings.{out,press}`. All already in `mingla-business/src/constants/designSystem.ts`.
- **Consumer hex (match surrounding screen, do NOT import business tokens):** `WARM #eb7825`, `ACCENT #FF6B35`, white-alpha text, `rgba(235,120,37,0.14)` selected fill — already defined in `ConsumerTripDetailScreen`.
- **Reused components (do not fork):** `InstallmentScheduleDisplay` (null-on-null), `GlassCard`, `Button`, `CheckoutHeader`, `FloatingOfferingBar`, `projectInstallmentSchedule`, `installmentReassuranceText`.
- **New shared component proposed:** `TripPaymentChoice` (business) — the two-card radiogroup + terms, extracted from `payment.tsx`'s inline block so the public page (`TripCheckoutFlow`) and Review step render ONE implementation. Props: `{ schedule: InstallmentScheduleDisplaySchedule | null; fullPriceCents; currency; value: "full"|"installments"; onChange; depositPct }`. Returns null when `schedule===null` (no-plan trip → caller shows the quiet recap line instead).
- **Consumer counterpart:** a thin consumer-styled mirror (or `TripPaymentChoice` with a `theme="consumer"` prop) — SPEC decides extract-vs-mirror; the visual contract here is the source of truth either way.
- **New `CartContext` field:** `paymentPlanChoice: "full" | "installments"` (default `"full"`), set by the public-page module, read by Review step.
- **No new design tokens required.** Everything maps to existing values.

---

## 9. What is explicitly OUT (scope discipline)

- Authoring (`EditPublishedTripScreen`, `trip/[id]/money`) `variant="planner"` surfaces — DO-NOT-TOUCH (COMMS-0029/0030 zone).
- Post-purchase lifecycle emails (reminder/dunning/paid-in-full).
- Multi-tier UI affordances (45/45 single-tier; the tier picker only survives as a contract fallback, never built out).
- A "deposit paid · N remaining" confirmation-email line (DISC-1130-B — follow-on, not this ORCH).
- Any change to the refund ladder / countdown / closed banner beyond coexistence.

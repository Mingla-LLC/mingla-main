# DESIGN — ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]

**Owner:** `/ui-ux-pro-max`
**Date:** 2026-05-18
**Inputs:**
- `Mingla_Artifacts/specs/SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md` (locked)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`
- `Mingla_Artifacts/design/DESIGN_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md` (visual vocabulary anchor)
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` (live chrome — Stepper + Close X + GlassCard floating dock + Keyboard.addListener)
- `mingla-business/src/components/trip/PaymentPlanEditor.tsx` (sibling editor pattern — toggle + stepper rows + monotonicity validation)
- `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx` (read-only sibling display pattern)
- `mingla-business/src/constants/designSystem.ts` (canonical token authority — unchanged)
- `Mingla_Artifacts/reports/RESEARCH_ORCH-0825_WETRAVEL_COMPETITIVE_INGEST.md` §1+§5+§10+§15 (cancellation-policy visualisation reference)

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 0. Layman summary

Locked the 4 visual + IA decisions ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] spec deliberately deferred. **A:** wizard gets ONE new combined step "Cancellation & deadline" (5 steps → 6) — refund + deadline live together because operators decide them as one policy. **B:** buyer cancel route is a FULL-SCREEN route at `/booking/{orderId}/cancel?token=<...>` (not a sheet) because buyer arrives cold from an email link with no parent context; hero-number refund preview + tier explanation + type-to-confirm friction on $0-refund cases. **C:** booking-deadline picker uses operator's brand TZ with explicit label ("Closes Sat, Jan 15 at 11:59 PM in Asia/Bangkok — your brand timezone") — removes the worst-case operator confusion of "what timezone did I pick that in?". **D:** RefundPolicyEditor = 3 template pill chips + custom builder with monotonicity errors inline; RefundPolicyDisplay = vertical timeline with marker dots (Airbnb-style, but better — Mingla highlights "You're here →" when shown on buyer cancel preview); 4 email templates locked (cancelled + refund × buyer-self vs operator). No new visual primitives — everything reuses the ORCH-0874 vocabulary (Stepper, IconChrome, GlassCard, Sheet, ConfirmDialog, ActionTile). Discoveries flag 3 patterns the spec didn't catch (countdown pill refresh cadence on public page, refund-preview cache invalidation when policy edited mid-flight, deposit-only orders edge case).

---

## 1. Cross-Surface Impact Declaration

| # | Surface | In scope for this design | What ships here |
|---|---|---|---|
| 1 | Consumer iOS | NO | Not in scope, no analog needed (no trips on consumer app — C1 milestone) |
| 2 | Consumer Android | NO | Not in scope, no analog needed |
| 3 | **Buyer/anon Web** | **YES** | Decision B (full-screen cancel route mockups × 7 states), Decision C (public-page deadline countdown + closed-banner display variants), Decision D (RefundPolicyDisplay read-only ladder + 4 email templates as plain-text HTML body) |
| 4 | **Business iOS** | **YES** | Decision A (wizard Step 5 IA + body mockup), Decision C (picker UX + saved-state chip), Decision D (RefundPolicyEditor — template chips + custom builder), plus operator-cancel sheet (RefundPreviewSheet on trip dashboard traveler row) |
| 5 | **Business Android** | **YES** | Parity automatic — shared RN source with Business iOS. Native DateTimePicker delegates to Android dialog UI. |
| 6 | Admin Web | NO | Not in scope, no admin trip-ops surface exists yet (future ORCH if demand surfaces) |
| 7 | **Business Web preview** | **YES** | Parity automatic via RN-Web bundle. RefundPolicyDisplay + RefundPolicyEditor render correctly on web; DateTimePicker delegates to browser-native datetime picker (acceptable degradation per Tr2 precedent). |

**Parity model:** All operator-facing surfaces (Decisions A, C-picker, D-editor, operator-RefundPreviewSheet) are PARITY-AUTOMATIC via shared RN source (Business iOS + Android + Web preview). All buyer-facing surfaces (Decision B route, C-public-page, D-display, D-emails) ship to mobile web only (no native consumer client). No platform-specific code branches needed unless implementor finds a divergence at build time (call out as P1).

---

## 2. Decision A — Wizard step IA (refund policy + booking deadline)

### 2.1 Recommendation: **A3 — One combined new step "Cancellation & deadline"**

Wizard grows from 5 steps to 6: Basics / Day by day / What's included / Pricing / **Cancellation & deadline** / Review.

### 2.2 Why A3 (not A1 or A2)

**A2 (fold into Pricing — REJECTED).** The Pricing step already carries 3 mental concepts: single price, payment plan toggle, currency display. Adding refund policy (template chips + custom builder = 6+ inline interactive elements) plus a datetime picker overflows the cognitive surface. A single "Continue" validation gate that needs to assess price + payment plan completeness + refund-policy monotonicity + deadline-min-validation becomes a complex error surface — buyer sees "Fix 3 things above" and has to hunt them. Pricing step is already the heaviest in the wizard post-Tr3; this would tip it past usable density.

**A1 (two separate steps — REJECTED).** Refund policy and booking deadline are tightly coupled in operator mental model — both are "what happens around the close of bookings". A buyer who reads the public trip page sees them adjacent ("Bookings close Sat Jan 15 · Cancellation: 100% refund before 60 days, 50% before 30, none after"). Separating them across two wizard steps creates an artificial seam, padding the wizard to 7 steps when 6 is sufficient. Operator's "Continue" tap pattern doesn't benefit from the split — there's no scenario where they'd want to save refund policy but skip deadline (or vice versa).

**A3 (one combined — RECOMMENDED).** Semantically coherent ("Cancellation & deadline" = "policies around closing this trip"). Single Continue gate validates both. Wizard length 6 ≤ event wizard length (which is 7 post-ORCH-0874 patterns), preserves operator-cadence familiarity. Refund-policy section + deadline section render as 2 stacked GlassCard sections within Step 5 body — clear visual divider, each section independently scannable.

### 2.3 Mockup — Step 5 layout (iPhone 17 Pro Max 430×932)

```
┌──────────────────────────────────────────────┐
│ [×]  ● Stepper:  ◯─◯─◯─◯─●─◯               │ ← chrome row
│ Lonely Moth · Step 5 of 6     Saved 11:42a  │ ← subtitle row
│                                              │
│                                              │
│  STEP 5 OF 6                                │ ← eyebrow (accent.warm)
│                                              │
│  Cancellation & deadline                    │ ← 26pt title
│                                              │
│  Refund tiers and when bookings close       │ ← 14pt subtitle (text.secondary)
│                                              │
│  ╔══════════════════════════════════════╗   │ ← GlassCard variant=base
│  ║ REFUND POLICY                        ║   │   eyebrow 11pt accent.warm
│  ║                                      ║   │
│  ║ [Flexible●] [Standard] [Strict]      ║   │ ← template chips (pill row)
│  ║                                      ║   │   ●=selected, accent.tint bg
│  ║ Cancel 30+ days before start         ║   │
│  ║   You'll refund 100%                 ║   │ ← preview-as-text under chips
│  ║ Cancel 14–29 days before             ║   │
│  ║   You'll refund 50%                  ║   │
│  ║ Cancel within 14 days                ║   │
│  ║   No refund                          ║   │
│  ║                                      ║   │
│  ║ → Build custom tiers                 ║   │ ← link to enter custom mode
│  ╚══════════════════════════════════════╝   │
│                                              │
│  ╔══════════════════════════════════════╗   │ ← GlassCard variant=base
│  ║ BOOKING DEADLINE  ▢ optional         ║   │   eyebrow + toggle right
│  ║                                      ║   │
│  ║ (toggle off — no scheduled close)    ║   │ ← copy when toggle off
│  ║                                      ║   │
│  ║ Bookings stay open until the trip    ║   │ ← explainer (text.secondary)
│  ║ starts. Toggle on to set a cutoff.   ║   │
│  ╚══════════════════════════════════════╝   │
│                                              │
│                              ↑↑              │ ← (scrollable body)
│                                              │
│  ╔══════════════════════════════════════╗   │ ← GlassCard variant=elevated
│  ║  [ Back ]              [ Continue ]  ║   │   floating dock (existing pattern)
│  ╚══════════════════════════════════════╝   │
└──────────────────────────────────────────────┘
```

When custom mode active OR deadline toggle on, sections expand inline:

```
│  ╔══════════════════════════════════════╗   │
│  ║ REFUND POLICY                        ║   │
│  ║                                      ║   │
│  ║ [Flexible] [Standard] [Strict] [Custom●]│
│  ║                                      ║   │
│  ║ If they cancel:                      ║   │
│  ║ ┌─────────────────────────────────┐ │   │
│  ║ │ [60] days before → [100]% refund [⌫]│ │   │ ← tier row 1
│  ║ ├─────────────────────────────────┤ │   │
│  ║ │ [30] days before → [50]% refund  [⌫]│ │   │ ← tier row 2
│  ║ ├─────────────────────────────────┤ │   │
│  ║ │ [ 0] days before → [ 0]% refund  [⌫]│ │   │ ← tier row 3 (last allowed)
│  ║ └─────────────────────────────────┘ │   │
│  ║                                      ║   │
│  ║ [+ Add tier]   (max 8 tiers)         ║   │
│  ╚══════════════════════════════════════╝   │
│                                              │
│  ╔══════════════════════════════════════╗   │
│  ║ BOOKING DEADLINE          [● on  ]   ║   │ ← toggle on
│  ║                                      ║   │
│  ║ Closes Saturday, Jan 15 at 11:59 PM  ║   │ ← read-back chip
│  ║ in Asia/Bangkok — your brand timezone║   │   tap to change
│  ║                                      ║   │
│  ║ → Edit deadline                      ║   │ ← link to picker
│  ╚══════════════════════════════════════╝   │
```

Monotonicity error state (visible inline below the offending row):

```
│  ║ │ [30] days before → [80]% refund  [⌫]│ │   │
│  ║ │ ⚠ Refund % must be the same or lower  │
│  ║ │   than the row above (you have 50% → 80%)│
│  ║ └─────────────────────────────────┘ │   │
```

### 2.4 Interaction notes

- **Template chip tap** — applies preset; switches to that chip's selected state; if planner was in custom mode, prompts ConfirmDialog "Replace your custom tiers with the Standard template? Your custom edits will be lost" before applying.
- **"Build custom tiers" link** — switches to custom mode; pre-populates tier rows with whichever template was last selected (so planner edits from a starting point, not blank); Custom chip becomes selected.
- **Tier row inputs** — both `days_before_start` and `refund_pct` are numeric `<TextInput keyboardType="number-pad">`. On blur, live validation: monotonicity check fires + inline error if violated.
- **Trash icon per tier** — 32×32 IconChrome with `trash` icon, `glass.tint.chrome.idle` bg. Disabled (visually dimmed) when only 1 tier remains (can't have zero tiers).
- **"+ Add tier" button** — secondary CTA; disabled when 8 tiers reached; auto-inserts a new row with `days_before_start` = (lowest current) - 1 and `refund_pct` = (lowest current).
- **Toggle off → on for deadline** — opens DateTimePicker immediately (saves a tap).
- **Read-back chip "Edit deadline"** — tappable; reopens picker prefilled with current value.
- **Continue button (floating dock)** — disabled when (a) any tier row has invalid input OR (b) any monotonicity error OR (c) deadline toggle on but no value set. Disabled state has `accessibilityHint="Complete refund policy and deadline before continuing"`.

### 2.5 Accessibility

- Template chips: `accessibilityRole="radiogroup"`, each chip `accessibilityRole="radio"` with `accessibilityState={{selected: isActive}}`. Touch targets 44pt × ≥80pt width.
- Tier inputs: `accessibilityLabel="Days before trip start"` + `accessibilityLabel="Refund percentage"`. Error text linked via `accessibilityLabelledBy`.
- Trash icons: `accessibilityLabel="Remove tier N"` + `accessibilityHint="Removes this refund tier"`. 32pt + 8pt hitSlop = 48pt effective (I-38 compliant).
- Deadline toggle: `accessibilityRole="switch"` with `accessibilityState={{checked: enabled}}`.
- Continue button: `accessibilityState={{disabled: !isValid}}` + `accessibilityHint` explaining why disabled.

### 2.6 Edge cases

- **Empty state (first entry to Step 5):** template chips visible, no chip selected, "Pick a template or build custom" copy under the chip row. Deadline section has toggle off.
- **Editing existing trip with already-saved policy:** chips render with the matching template selected; if `kind='custom'`, Custom chip selected and tier rows pre-populated.
- **Editing while bookings already exist:** no warning at Step 5 (refund policy applies to NEW cancellations only — already-cancelled bookings used the policy at cancel-time per I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL). Implementor adds a tooltip on Continue: "Policy changes apply to future cancellations only" — small caption under Continue button when `bookings_count > 0`.
- **Keyboard open on tier-row input:** wizard's existing Keyboard.addListener pattern shifts the body up so the active input stays above the keyboard. No special handling needed.
- **Slow autosave:** existing wizard autosave handles the policy + deadline persists as part of Step 5 patch via existing wizard autosave plumbing.

---

## 3. Decision B — Buyer cancel-flow IA at `/booking/{orderId}/cancel?token=<...>`

### 3.1 Recommendation: full-screen route (not a sheet)

**Why full-screen.** Buyer arrives cold from an email link with no parent page context — there's nothing to sheet over. The action is deliberate and consequential (cancellation + refund); it deserves dedicated full-screen focus, not a translucent layer over a brand or trip page they didn't navigate to. Operator-cancel (RefundPreviewSheet) uses a sheet because operator IS on the trip dashboard (already-present context); buyer-cancel needs a route with its own URL + header chrome + back-navigation chain.

### 3.2 Mockups — 5 states (430×932)

#### State 1 — Loading (skeleton)

```
┌──────────────────────────────────────────────┐
│ [×]                                          │ ← X top-left only;
│                                              │   back navigates to public trip page
│  ┌──────────────────────────────────────┐   │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │   │ ← trip cover skeleton
│  └──────────────────────────────────────┘   │
│                                              │
│  ░░░░░░░░░░░░░░░░░░░░░░░                    │ ← title skeleton (24pt h)
│  ░░░░░░░░░░░░░░                              │
│                                              │
│  ░░░░░░░░░░░░░░░░                            │ ← refund hero number skeleton
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░     │   │ ← breakdown rows skeleton
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░     │   │
│  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

Skeleton uses existing `Skeleton` primitive (or React Native's `Animated` shimmer per ORCH-0859 pattern). Fades in over 200ms to avoid jank.

#### State 2 — Preview loaded, refund > $0

```
┌──────────────────────────────────────────────┐
│ [×]                                          │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │   │ ← trip cover 140pt
│  │ ▓ Marbella Summer Retreat          ▓ │   │ ← title overlay 18pt
│  │ ▓ Aug 16–22 · Marbella, Spain      ▓ │   │ ← dates 13pt text.secondary
│  └──────────────────────────────────────┘   │
│                                              │
│  CANCELLATION PREVIEW                       │ ← 11pt eyebrow accent.warm
│                                              │
│  You'll receive back                        │ ← 14pt text.secondary
│                                              │
│  £600.00                                    │ ← 40pt h0 text.primary
│                                              │
│  100% refund applies because you're         │ ← 14pt text.secondary
│  cancelling 80 days before the trip starts. │
│  Standard cancellation policy.              │
│                                              │
│  ╔══════════════════════════════════════╗   │ ← GlassCard variant=base
│  ║ PAYMENT BREAKDOWN                    ║   │   eyebrow
│  ║                                      ║   │
│  ║ Deposit (Aug 10)        £300         ║   │
│  ║   Refund                +£300        ║   │ ← +amount in semantic.success
│  ║                                      ║   │
│  ║ Installment 1 (Sep 10)  £300         ║   │
│  ║   Refund                +£300        ║   │
│  ║                                      ║   │
│  ║ Installment 2 (Oct 10)  £300         ║   │ ← upcoming (text.tertiary)
│  ║   Won't be charged      Cancelled    ║   │
│  ║ ──────────────────────────────────── ║   │
│  ║ Total refund            £600         ║   │ ← bold 16pt
│  ╚══════════════════════════════════════╝   │
│                                              │
│  Refunds typically appear on your card      │ ← 12pt text.tertiary caption
│  ending in •••• 4242 within 5–10 business   │
│  days.                                      │
│                                              │
│                              ↑↑              │ ← scrollable
│                                              │
│  ╔══════════════════════════════════════╗   │ ← floating dock
│  ║  [ Keep my spot ]  [ Cancel & refund ]║   │   primary=destructive variant
│  ╚══════════════════════════════════════╝   │
└──────────────────────────────────────────────┘
```

#### State 3 — Preview loaded, refund = $0 (past refund window)

```
┌──────────────────────────────────────────────┐
│ [×]                                          │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ ▓ Marbella Summer Retreat          ▓ │   │ ← cover + title overlay
│  └──────────────────────────────────────┘   │
│                                              │
│  CANCELLATION PREVIEW                       │
│                                              │
│  You'll receive back                        │
│                                              │
│  £0.00                                      │ ← 40pt h0 — but text.tertiary
│                                              │   (muted, not warning red — neutral)
│                                              │
│  ╔══════════════════════════════════════╗   │ ← GlassCard variant=elevated
│  ║ ⓘ No refund applies                  ║   │   semantic.warning tint bg
│  ║                                      ║   │
│  ║ You're cancelling 10 days before the ║   │
│  ║ trip starts. The Standard policy     ║   │
│  ║ doesn't offer a refund within 30     ║   │
│  ║ days of departure.                   ║   │
│  ║                                      ║   │
│  ║ → See full cancellation policy       ║   │ ← link to public trip page
│  ╚══════════════════════════════════════╝   │
│                                              │
│  ╔══════════════════════════════════════╗   │
│  ║ PAYMENT BREAKDOWN                    ║   │
│  ║                                      ║   │
│  ║ Total paid              £900         ║   │
│  ║ Total refund             £0          ║   │
│  ╚══════════════════════════════════════╝   │
│                                              │
│  If you still want to cancel, type CANCEL   │ ← type-to-confirm friction
│  below to confirm.                          │   per ORCH-0862 destructive-action
│                                              │   divergence pattern
│  ┌──────────────────────────────────────┐   │
│  │ Type CANCEL to confirm               │   │ ← TextInput
│  └──────────────────────────────────────┘   │
│                                              │
│  ╔══════════════════════════════════════╗   │
│  ║  [ Keep my spot ]  [ Cancel anyway ] ║   │ ← Cancel disabled until input matches
│  ╚══════════════════════════════════════╝   │
└──────────────────────────────────────────────┘
```

**Friction justification:** $0 refund means buyer loses everything. Single-tap "Cancel" is too easy to mis-tap. Type-to-confirm pattern mirrors the ORCH-0862 destructive-action divergence policy and matches industry pattern (Airbnb, Stripe Dashboard) for "are you really sure?" cases.

#### State 4 — Success (after confirm)

```
┌──────────────────────────────────────────────┐
│ [×]                                          │ ← X navigates to public trip page
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │      ✓ semantic.success large        │   │ ← 64pt circle, success.tint bg
│  └──────────────────────────────────────┘   │
│                                              │
│  Cancelled · refund on its way              │ ← 24pt title text.primary
│                                              │
│  £600 refund sent to your card ending in    │ ← 14pt text.secondary
│  •••• 4242. Refunds typically appear        │
│  within 5–10 business days.                 │
│                                              │
│  We've sent a confirmation to               │ ← 13pt text.tertiary
│  maria@example.com                          │
│                                              │
│  Reference: RFD-7a3b9c                      │ ← 12pt mono text.tertiary
│                                              │
│                                              │
│                                              │
│  ╔══════════════════════════════════════╗   │
│  ║  [ Back to trip page ]               ║   │ ← single secondary CTA
│  ╚══════════════════════════════════════╝   │
└──────────────────────────────────────────────┘
```

#### State 5 — Error on confirm (Stripe refund failed)

```
┌──────────────────────────────────────────────┐
│ [×]                                          │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │      ⚠ semantic.warning large        │   │ ← warning circle
│  └──────────────────────────────────────┘   │
│                                              │
│  Refund couldn't be processed               │ ← 24pt title
│                                              │
│  Something went wrong sending your refund.  │
│  Your reservation is still active — nothing │
│  has been cancelled. Try again, or contact  │
│  the organizer at hello@lonelymoth.com.     │
│                                              │
│  Error: card_declined                       │ ← 12pt mono text.tertiary
│  Reference: RFD-7a3b9c-attempt-1            │   for support escalation
│                                              │
│                                              │
│  ╔══════════════════════════════════════╗   │
│  ║ [ Try again ]   [ Contact organizer ]║   │
│  ╚══════════════════════════════════════╝   │
└──────────────────────────────────────────────┘
```

Refund preview cache is NOT invalidated on error — same refund amount on retry per I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL.

#### State 6 — Token invalid (text-only)

```
┌──────────────────────────────────────────────┐
│ [×]                                          │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │      ⓘ text.tertiary large            │   │ ← info circle (neutral, not error)
│  └──────────────────────────────────────┘   │
│                                              │
│  This cancel link isn't valid               │ ← 24pt title
│                                              │
│  The link may have expired, been used       │
│  already, or copied incorrectly.            │
│                                              │
│  Contact the organizer to cancel:           │
│  hello@lonelymoth.com                       │ ← mailto link
│                                              │
│  ╔══════════════════════════════════════╗   │
│  ║  [ Visit trip page ]                 ║   │
│  ╚══════════════════════════════════════╝   │
└──────────────────────────────────────────────┘
```

#### State 7 — Already cancelled (text-only)

```
┌──────────────────────────────────────────────┐
│ [×]                                          │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │      ✓ semantic.success large        │   │ ← already success
│  └──────────────────────────────────────┘   │
│                                              │
│  Your reservation is cancelled              │ ← 24pt title
│                                              │
│  This reservation for Marbella Summer       │
│  Retreat was cancelled on Aug 15.           │
│                                              │
│  £600 refund was sent to your card ending   │
│  in •••• 4242.                              │
│                                              │
│  Reference: RFD-7a3b9c                      │
│                                              │
│  ╔══════════════════════════════════════╗   │
│  ║  [ Back to trip page ]               ║   │
│  ╚══════════════════════════════════════╝   │
└──────────────────────────────────────────────┘
```

### 3.3 Interaction notes

- **X-close (top-left)** — `IconChrome` 36pt + hitSlop. Tapped → navigates to `/t/{brandSlug}/{tripSlug}` if `brandSlug` known from preview response, else `/` (root). Always non-destructive (no preview state to lose).
- **"Keep my spot" CTA** — secondary variant. Same navigation as X-close.
- **"Cancel & refund" CTA** — destructive variant (semantic.error tint border). Single tap when refund > $0. Disabled until type-to-confirm validates when refund = $0.
- **Type-to-confirm input** — `<TextInput autoCapitalize="characters">`. Validation: trimmed value === "CANCEL". Enables button on match. Hint: "Type CANCEL exactly to confirm".
- **Confirming state** — button changes to spinner + "Processing your refund…" copy. Button disabled. X-close stays enabled (lets buyer escape before commit fires — but harmless since UI doesn't reflect commit until success).
- **Error state retry** — "Try again" button refires the cancel mutation with the same `refund_id` (idempotency-key in edge function ensures Stripe doesn't double-refund — same idempotency-key returns existing refund attempt's terminal state).

### 3.4 Accessibility

- `accessibilityRole="alert"` on error + success state containers (screen readers announce on mount).
- Hero refund number: `accessibilityLabel="You'll receive £600 back"` (avoid screen-reader reading "600.00").
- Type-to-confirm input: `accessibilityLabel="Type CANCEL to confirm"` + `accessibilityHint="Cancellation requires explicit confirmation because no refund applies"`.
- All CTAs ≥ 44pt height. Destructive CTA has `accessibilityRole="button"` + `accessibilityLabel="Cancel reservation and process refund"`.
- Focus order: hero number → tier explanation → breakdown rows → CTAs. NO autofocus on type-to-confirm input (would hijack screen reader announcement of the warning copy).

### 3.5 Edge cases

- **Buyer on slow network:** loading skeleton shows for >2s → small "Still loading…" caption appears under skeleton at 3s mark.
- **Buyer offline:** error state with "You're offline — connect to the internet to cancel" + retry CTA that retries the preview fetch.
- **Buyer revisits link after cancelling** (state 7 case): preview endpoint returns 409 already_cancelled → render state 7. NEVER show "process refund again" CTA — refund already processed.
- **Trip already past start date:** allow cancel anyway (tier engine will likely yield 0%, state 3 renders). Operator could still want this for ledger cleanup.
- **Multiple line items in order** (rare — current Tr2 single-ticket-type pattern):
 breakdown rows show per-line-item; total refund sums correctly.
- **Currency mismatch within installments:** can't happen per I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH. If somehow it does (data corruption), preview endpoint returns 500 → render state 5 error with reference for support.

---

## 4. Decision C — Booking-deadline picker UX

### 4.1 Recommendation: **C1 — Operator's brand TZ explicit**

Picker shows TZ context inline ("Closes Saturday, Jan 15 at 11:59 PM in Asia/Bangkok — your brand timezone"). Operator picks in their brand TZ; display always renders in operator's brand TZ.

### 4.2 Why C1 (not C2 or C3)

**C3 (trip-destination TZ — REJECTED).** Trip-planner brands that run trips across destinations (LA-based operator with Bali AND Iceland trips) would have a different picker TZ per trip. Operator's mental model of "Sunday at midnight" would silently change between trips. Increases the chance of operator-confusion-driven mis-set deadlines. Also requires destination → TZ lookup (place_pool join) which adds complexity for negligible buyer benefit.

**C2 (local-time-pick + brand-TZ-display — REJECTED).** "Local time" is ambiguous — browser TZ on web preview, device TZ on iOS sim, operator's actual TZ in production. If operator is travelling, the picker silently uses their travel TZ; saved value is correct-but-confusing later. Worse, the "what did I pick that in?" mental retrace is impossible from the display alone.

**C1 (brand TZ explicit — RECOMMENDED).** Brand TZ is a stable per-brand attribute (set at brand creation, rarely changed). Operator always knows "my brand is in Asia/Bangkok". Picker label + display label both show TZ explicitly — zero ambiguity. Same value renders identically across iOS / Android / Web. Trip-destination TZ shown to BUYERS in a separate line on the public trip page (so a buyer in NYC sees "Bookings close Jan 16 at 11:59 AM your time · Jan 16 at 11:59 PM in Bangkok").

### 4.3 Mockups (430×932)

#### Picker open (iOS native sheet)

```
┌──────────────────────────────────────────────┐
│       Picker translucent over Step 5         │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │  Booking deadline                    │   │ ← header
│  │                                      │   │
│  │  In Asia/Bangkok — your brand TZ     │   │ ← TZ context (text.tertiary)
│  │                                      │   │
│  │  ┌──────┬──────┬──────┬──────┬──────┐│   │ ← native picker wheels
│  │  │ Jan  │  15  │ 2026 │  11  │  59  ││   │
│  │  │      │      │      │      │      ││   │
│  │  └──────┴──────┴──────┴──────┴──────┘│   │
│  │       PM                              │   │
│  │                                      │   │
│  │  ⚠ Trip starts Jan 17 — deadline     │   │ ← inline validation
│  │    must be before trip start         │   │   (if invalid)
│  │                                      │   │
│  │  ┌────────┐  ┌────────────────────┐ │   │
│  │  │ Cancel │  │ Set deadline       │ │   │
│  │  └────────┘  └────────────────────┘ │   │
│  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

Uses existing `@react-native-community/datetimepicker` per ORCH-0859 Step 1 pattern. Min date enforced via `minimumDate={new Date()}`. Max date enforced via prop comparison to `trip.startAt` (cleared in onChange handler with toast if violated).

#### Saved-state chip (Step 5 body)

```
│  ╔══════════════════════════════════════╗   │
│  ║ BOOKING DEADLINE          [● on  ]   ║   │
│  ║                                      ║   │
│  ║ Closes Saturday, Jan 15 at 11:59 PM  ║   │ ← 14pt text.primary, fontWeight 500
│  ║ in Asia/Bangkok — your brand timezone║   │ ← 12pt text.tertiary
│  ║                                      ║   │
│  ║ → Edit deadline                      ║   │ ← 14pt accent.warm link
│  ╚══════════════════════════════════════╝   │
```

Empty state (toggle on, no value set yet):

```
│  ╔══════════════════════════════════════╗   │
│  ║ BOOKING DEADLINE          [● on  ]   ║   │
│  ║                                      ║   │
│  ║ ┌──────────────────────────────────┐ ║   │
│  ║ │  Pick a deadline                 │ ║   │ ← primary CTA opens picker
│  ║ └──────────────────────────────────┘ ║   │
│  ║                                      ║   │
│  ║ Bookings will auto-close at this     ║   │ ← explainer
│  ║ moment in your brand's timezone.     ║   │
│  ╚══════════════════════════════════════╝   │
```

### 4.4 Public trip page display variants

#### Future deadline (countdown pill)

```
│  ┌──────────────────────────────────────┐   │
│  │ ▓ Marbella Summer Retreat          ▓ │   │
│  │ ▓ Aug 16–22 · Marbella, Spain      ▓ │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  [Bookings close in 12 days]                │ ← Pill primitive
│                                              │   accent.warm bg, accent.border
│                                              │   12pt fontWeight 600
```

Countdown refresh cadence: re-derived from `events.booking_deadline - now()` on every render. NOT a setInterval ticker (avoids unnecessary re-renders). Buyer reload / focus refreshes. Acceptable precision (1-day granularity, no need to show hours/minutes until last 24h).

When < 24h remaining, pill shows hour-granularity: "Bookings close in 6 hours". When < 1h, minute-granularity: "Bookings close in 23 minutes" — visual urgency cue (pill border thickens, optional accent.warm pulse animation via durations.normal).

#### Closed banner (deadline past)

```
│  ┌──────────────────────────────────────┐   │
│  │ ▓ Marbella Summer Retreat          ▓ │   │
│  │ ▓ Aug 16–22 · Marbella, Spain      ▓ │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ╔══════════════════════════════════════╗   │ ← GlassCard variant=base
│  ║ ⚠ Bookings closed                    ║   │   semantic.error tint bg
│  ║                                      ║   │   12pt eyebrow accent
│  ║ This trip stopped accepting new      ║   │
│  ║ bookings on Jan 15.                  ║   │
│  ║                                      ║   │
│  ║ Have questions?                      ║   │
│  ║ → hello@lonelymoth.com               ║   │ ← mailto link
│  ╚══════════════════════════════════════╝   │
│                                              │
│  [Reserve now] disabled / hidden            │ ← reserve CTA hidden or disabled
```

Reserve CTA: hide entirely (cleaner than disabled — clear "this isn't an option"). Replace with the contact banner.

### 4.5 Edge cases

- **Operator changes brand TZ after setting deadline:** stored value is timestamptz (UTC under the hood) — wall-clock display shifts. Display copy says "in (new TZ) — your brand timezone" so operator notices the shift. Future ORCH if this causes operator confusion.
- **Picker on web preview (mobile browser):** `@react-native-community/datetimepicker` on RN-Web delegates to browser-native `<input type="datetime-local">`. TZ context label still rendered above; browser input doesn't show TZ but the stored value uses brand TZ.
- **Cron runs at hour-boundary minute 0:** if operator sets deadline at "11:59 PM in Bangkok" (= 16:59 UTC), and cron runs at 17:00 UTC, deadline is past → `bookings_closed=true` flips on next cron tick (within 1h max). Acceptable per Q4 hourly cadence resolution.

---

## 5. Decision D — RefundPolicyEditor + RefundPolicyDisplay + Email copy

### 5.1 RefundPolicyEditor (operator-facing)

Already mockup'd in §2.3. Key visual decisions:

- **Template chip row** = 3 chips horizontal pill row at top, mirrors ORCH-0874 filter-pills pattern. 34pt height, `accent.tint` bg + `accent.border` when selected, `glass.tint.profileBase` + `glass.border.profileBase` when idle. 4th "Custom" chip appears AS-A-PILL only after planner enters custom mode (via "Build custom tiers" link OR by editing a template's tiers).
- **Template chip tap** → applies preset. If transitioning from custom-with-edits → template, fires ConfirmDialog "Replace your custom tiers with the {Template} template? Your custom edits will be lost."
- **Tier rows** = vertical stack with explicit separators (1pt `glass.border.profileBase`). Each row has 2 numeric inputs + days/percent label inline + trash icon right.
- **Live validation** = monotonicity check on `refund_pct` between adjacent rows. Inline error below offending row in `semantic.error` color, 12pt caption. Continue button in floating dock stays disabled until all errors clear.
- **"+ Add tier" button** = secondary outline button below the last tier row. Disabled at 8 tiers (max per spec). Auto-inserts new row with `days_before_start = lowest_current_days - 7` (defaults to `lowest - 7` to give operator a reasonable starting offset) and `refund_pct = lowest_current_pct` (start equal to allow operator to lower).

### 5.2 RefundPolicyDisplay (buyer-facing)

**Vertical timeline pattern** — visual win that WeTravel doesn't have. Marker dots on left, time-range label center, refund% right. Time-sorted (longest notice first, descending). Past-the-refund-window tier rendered in `text.tertiary` muted style with explicit "No refund" wording.

#### Standard render (public trip page)

```
┌──────────────────────────────────────────────┐
│                                              │
│  CANCELLATION POLICY                        │ ← 11pt eyebrow accent.warm
│                                              │
│  ●─────  Cancel 60+ days before start       │ ← 14pt text.primary
│  │       100% refund                        │ ← 14pt text.primary fontWeight 600
│  │                                          │
│  ●─────  Cancel 30 to 59 days before        │ ← 14pt text.primary
│  │       50% refund                         │ ← 14pt text.primary fontWeight 600
│  │                                          │
│  ●─────  Cancel within 30 days              │ ← 14pt text.tertiary (muted)
│          No refund                          │ ← 14pt text.tertiary
│                                              │
└──────────────────────────────────────────────┘
```

Marker dots = `accent.warm` for refund > 0 tiers; `text.quaternary` for "No refund" tier. Vertical connecting line = `glass.border.profileBase` 1pt between dots.

#### Buyer cancel preview render (with "You're here" callout)

```
┌──────────────────────────────────────────────┐
│                                              │
│  CANCELLATION POLICY                        │
│                                              │
│  ●─────  Cancel 60+ days before start       │
│  │       100% refund                        │
│  │                                          │
│  ●─────  Cancel 30 to 59 days before        │
│  │       50% refund                         │
│  │                                          │
│  ▶─────  Cancel within 30 days              │ ← ▶ marker (accent.warm) +
│          No refund                          │   left border accent.warm 3pt
│   You're here — cancelling 10 days before   │ ← 12pt accent.warm caption
│                                              │
└──────────────────────────────────────────────┘
```

"You're here →" callout shown ONLY when the display is rendered on the buyer cancel-preview screen (not on the public trip page where there's no per-buyer cancel context). Driven by an optional prop `currentTierIndex: number | undefined`.

### 5.3 Email copy — 4 templates

All four extend existing ORCH-0788 `buyer_order_cancelled` + `buyer_refund_issued` kinds via payload discriminator `cancelledBy: 'buyer' | 'operator'`. Subject + body strings locked below. Variables in `{curly braces}` are template substitutions.

#### Template D-1 — `buyer_order_cancelled` × `cancelledBy='buyer'`

**Subject:**
```
Your reservation for {tripName} is cancelled
```

**Body (renders via existing `_shared/email/shell.ts` + `genericBody.ts`):**
```
Hi {firstName},

Your reservation for {tripName} ({startDate} – {endDate}) has been cancelled.

A refund of {refundAmount} is on its way to your card ending in •••• {last4}.
Refunds typically appear within 5–10 business days.

{if refundIssued=false:}
No refund applies because the cancellation policy doesn't cover refunds at
this time. If you have questions, contact the organizer.
{/if}

{if installmentBreakdown present:}
Breakdown:
  Deposit (charged {depositDate}):      {depositAmount} → refunded {depositRefund}
  Installment 1 (charged {inst1Date}):  {inst1Amount} → refunded {inst1Refund}
  {... per collected installment ...}
  Future installments cancelled — you won't be charged.
{/if}

Reference: {refundId}

If you didn't request this cancellation, contact {organizerEmail} immediately.

— Mingla
```

#### Template D-2 — `buyer_order_cancelled` × `cancelledBy='operator'`

**Subject:**
```
{brandName} cancelled your reservation for {tripName}
```

**Body:**
```
Hi {firstName},

{brandName} has cancelled your reservation for {tripName} ({startDate} – {endDate}).

{if cancelReason present:}
Their reason: "{cancelReason}"
{/if}

A refund of {refundAmount} is on its way to your card ending in •••• {last4}.
Refunds typically appear within 5–10 business days.

{if installmentBreakdown present, same as D-1}

Reference: {refundId}

Questions? Contact the organizer at {organizerEmail}.

— Mingla
```

#### Template D-3 — `buyer_refund_issued` × `cancelledBy='buyer'`

Fires AFTER D-1 (separate dispatcher kind = separate email). Shipping logic per Tr3 notifications pattern — sometimes both arrive seconds apart, sometimes D-3 lags by minutes if Stripe is slow.

**Subject:**
```
Refund of {refundAmount} is on its way
```

**Body:**
```
Hi {firstName},

Following your cancellation of {tripName}, we've issued a refund of {refundAmount}
to the original payment method (card ending in •••• {last4}).

It typically appears within 5–10 business days.

{if installmentBreakdown present, condensed:}
Refund breakdown:
  Deposit refund:        {depositRefund}
  Installment 1 refund:  {inst1Refund}
  {... per refunded installment ...}
{/if}

Reference: {refundId}

— Mingla
```

#### Template D-4 — `buyer_refund_issued` × `cancelledBy='operator'`

**Subject:**
```
Refund of {refundAmount} from {brandName}
```

**Body:**
```
Hi {firstName},

Following the cancellation of {tripName} by {brandName}, we've issued a refund
of {refundAmount} to the original payment method (card ending in •••• {last4}).

It typically appears within 5–10 business days.

{if installmentBreakdown present, condensed as D-3}

Reference: {refundId}

If you have questions, contact the organizer at {organizerEmail}.

— Mingla
```

**Locked copy decisions:**

- Use `card ending in •••• {last4}` everywhere (not "your saved card" — be specific so buyer recognizes).
- "5–10 business days" is the locked refund-timing copy — matches industry-standard Stripe refund SLA.
- Subject lines stay under 60 chars (mobile preview truncation guard).
- NO marketing copy ("we hope to see you again", "follow us") — refund emails are transactional, keep it clean.
- Reference ID format: `RFD-{first-6-chars-of-refund_id}` (short, human-typeable for support escalation).
- Brand contact email rendered as plain `{organizerEmail}` string (NOT mailto link in body — `genericBody.ts` doesn't auto-linkify; clients that auto-detect will handle it; clients that don't = buyer copy-pastes).

### 5.4 Accessibility — RefundPolicyDisplay

- `accessibilityRole="list"` on the container; `accessibilityRole="listitem"` per tier row.
- Each tier row: `accessibilityLabel="Tier {N}: Cancel {timeRange}, {refundPct}% refund"`.
- "No refund" tier announces `accessibilityLabel="Tier {N}: Cancel {timeRange}, no refund"`.
- "You're here" callout: `accessibilityLabel="Your current refund tier: {refundPct}% if you cancel now"`; `accessibilityLiveRegion="polite"` (announces on screen-reader focus).

---

## 6. Reuse vs new component inventory

### 6.1 Components reused (no net-new visual primitives)

| Primitive | Used by Tr4 surfaces | Source |
|---|---|---|
| `Stepper` | Wizard step row | ORCH-0826 [Hub Foundation + universal-plus creator] |
| `IconChrome` | Close X + share + back icons | ORCH-0826 |
| `GlassCard` | All card surfaces in editor + display + preview | ORCH-0826 |
| `Sheet` | Operator RefundPreviewSheet on dashboard | Existing primitive |
| `ConfirmDialog` | Template-replacement confirm; wizard discard | ORCH-0874 |
| `ActionTile` | Trip dashboard action grid (no Tr4 changes — existing tile pattern carries through) | ORCH-0874 |
| `Pill` | Status pills, deadline countdown pill | ORCH-0874 |
| `Button` (primary / secondary / destructive variants) | All CTAs | Existing primitive |
| `EventCoverMedia` | Trip cover in cancel route hero | ORCH-0874 |
| `DateTimePicker` (`@react-native-community`) | Booking deadline picker | ORCH-0859 [Tr2 Minimum Viable Trip] |
| `Toast` (absolute wrapped per `feedback_toast_needs_absolute_wrap.md`) | Cancel route error toasts | Existing |
| `Skeleton` (Animated shimmer) | Cancel route loading state | ORCH-0859 |

### 6.2 Net-new components (introduced by spec §3.5, visual design locked here)

| Component | File path | Visual basis |
|---|---|---|
| `RefundPolicyEditor.tsx` | `mingla-business/src/components/trip/RefundPolicyEditor.tsx` | Mirrors `PaymentPlanEditor.tsx` toggle + stepper rows pattern; net-new = template chip row |
| `BookingDeadlinePicker.tsx` | `mingla-business/src/components/trip/BookingDeadlinePicker.tsx` | Wraps `DateTimePicker` + TZ context label + saved-state chip |
| `RefundPreviewSheet.tsx` | `mingla-business/src/components/trip/RefundPreviewSheet.tsx` | Operator-mode wrapper around shared refund-preview body component |
| `RefundPolicyDisplay.tsx` | `mingla-business/src/components/trip/RefundPolicyDisplay.tsx` | NEW vertical-timeline-with-marker-dots pattern; net-new visual idiom for Mingla |
| Refund preview body (shared between operator sheet + buyer route) | `mingla-business/src/components/trip/RefundPreviewBody.tsx` | NEW shared composition: hero amount + tier explanation + payment breakdown |
| `/booking/[orderId]/cancel.tsx` | `mingla-business/app/booking/[orderId]/cancel.tsx` | NEW anon-buyer-web route; composes RefundPreviewBody + state machine |

### 6.3 What's intentionally NOT a net-new primitive

- The "You're here →" callout in RefundPolicyDisplay is a STYLE VARIANT of the existing display, not a new primitive. Implementor handles via prop, not new component.
- The "No refund applies" banner in cancel preview state 3 is a GlassCard variant=elevated + semantic.warning tint, not a new alert primitive.
- The type-to-confirm pattern is just a `<TextInput>` + button enable predicate, not a new "TypeToConfirm" primitive.

---

## 7. Discoveries for implementor

- **DISC-D-1 — Countdown pill refresh cadence on public trip page.** Spec §3.5.9 says "refreshes on focus" but design needs explicit refresh strategy for < 24h cases (when minute-level urgency matters). Recommendation: use `setInterval` with 60s cadence ONLY when remaining time < 24h (cheap; user is engaged); skip the interval when remaining > 24h (just re-derive on focus). Implementor verifies React Native's `AppState` `change → 'active'` event for focus-trigger refresh.

- **DISC-D-2 — Refund-preview cache invalidation when operator edits policy mid-flight.** Edge case: buyer opens `/booking/{orderId}/cancel?token=<...>` while operator is editing refund_policy in the wizard. Buyer's preview computes against current policy at preview-load time. If operator publishes a new policy 5 minutes later, buyer's tap "Cancel & refund" computes AGAINST NEW POLICY (because spec §3.1.E `biz_compute_refund_for_cancel` reads current policy from DB at begin-time). This is correct per I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL but creates a UX surprise — buyer expects the previewed amount. Recommendation: render a small caption under the refund hero amount: "Quoted at {timestamp}. Confirm within 15 minutes for this amount." Plus implementor invalidates the preview cache on commit-API call and re-computes server-side; if amount diverges by >£0.01 from preview, return a soft error "Policy was updated — refresh to see your new refund amount" and re-render preview. Spec §3.1 doesn't require this; flag for orchestrator decision.

- **DISC-D-3 — Deposit-only orders edge case.** Tr3 installment-paid orders include a deposit (= `orders.total_cents`) AND scheduled installments. If buyer has paid ONLY the deposit (no installments collected yet), the breakdown UI in cancel preview should still show "Deposit (charged {date}) → Refund {amount}" + "Installment 1 (scheduled {date}) → Won't be charged" rows. Current breakdown design in §3.2 mockup already handles this. Implementor should NOT collapse "Won't be charged" rows visually — they're informative.

- **DISC-D-4 — Brand TZ when brands.timezone is NULL.** Public trip page + email rendering assume `brand.timezone` exists for the "in {TZ} — your brand timezone" copy. If NULL, fall back to UTC + render copy "in UTC". Implementor verifies `brands.timezone` is required at brand-create time (per Tr1 [Trip Planner Brand Onboarding]) — if not, register a follow-up ORCH for null-safety polish.

---

## 8. Open questions for orchestrator

- **OQ-D-1 — Should DISC-D-2 (refund-preview cache invalidation + "Quoted at" caption) be spec-amended, or shipped as part of build phase?** Recommendation: spec-amend now to a sub-criterion under SC-06a (preview UI), so tester has a clear contract to verify. Alternative: ship build phase with implementor judgment; tester catches if implementation drifts. Operator decides.

- **OQ-D-2 — Should email reference IDs use `RFD-` prefix (refund reference) or `BKG-` (booking reference)?** Recommendation: `RFD-` because the email IS about the refund, not the booking. Buyer who calls support quotes RFD-7a3b9c which the operator can grep against `refunds.id`. Consistent across D-1/D-2/D-3/D-4.

- **OQ-D-3 — Operator-cancel RefundPreviewSheet polish.** Spec §3.5.3 defines props but doesn't lock the visual fidelity vs the buyer route. Recommendation: operator sheet uses the SAME RefundPreviewBody component as the buyer route — single source of visual truth. Difference is only the wrapping container (sheet vs route) + reason field visible/required for operator. Implementor builds `RefundPreviewBody` as the shared composition.

---

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Design artifact written; ready for orchestrator review + implementor dispatch.

# SPEC — ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer + Planner Surfaces]

**Author:** Claude `mingla-forensics` (single-session INVESTIGATE+SPEC per ORCH-0875/0877/0880 pattern)
**Date:** 2026-05-19
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER.md`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER.md`
**Authority:** SPEC_ORCH-0873 §3.5.4 + §3.5.5 (deferred SCs ORCH-0882 inherits) + SPEC_ORCH-0876 V2 §8.3-8.5 (route-fork context) + SPEC_ORCH-0869 §3.1 (schedule schema) + operator decisions D1/D2/D3 locked 2026-05-19

---

## 0. Layman summary

This SPEC tells the implementor how to wire the existing `InstallmentScheduleDisplay` component (built ORCH-0873, currently unused) onto every trip buyer + planner surface so buyers see the deposit + future-installment schedule before they pay, planners see what their buyers will see, and the Pay button on the final pre-Stripe screen tells the truth ("Pay $X deposit") instead of lying ("Pay $X" full price). No DB or backend changes. Pure JS wiring + 1 new mapper utility + 1 new CI gate + 2 regression tests. EAS OTA-eligible. ~13 files total. Wait for ORCH-0880 [Tr5 Traveler Intake Forms] Phase 4 CLOSE before dispatching implementor (3 file overlaps).

---

## 1. Scope

### In scope

- New mapper utility `mingla-business/src/utils/installmentScheduleProjection.ts` translating `TripPricingTier × anchorDate → InstallmentScheduleDisplaySchedule` with explicit projection labeling for pre-purchase contexts.
- Modify `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx`: add optional `isProjection?: boolean` prop; update header comment to canonical ORCH-0882 wiring targets (supersedes stale ORCH-0873 list).
- Wire `<InstallmentScheduleDisplay variant="buyer">` on 4 (or 5 post-ORCH-0880) buyer-side surfaces:
  - `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (rendered by public trip page)
  - `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` (qty picker)
  - `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` (buyer details)
  - `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` (Stripe handoff)
  - **CONDITIONAL on ORCH-0880 status at implementor dispatch:** if ORCH-0880 [Tr5 Traveler Intake Forms] Phase 4 has CLOSED by then, also wire `mingla-business/app/checkout-trip/[tripEventId]/intake.tsx`
- Wire `<InstallmentScheduleDisplay variant="planner">` on 2 planner-side surfaces:
  - `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` (Pricing accordion — below PaymentPlanEditor)
  - `mingla-business/app/trip/[id]/index.tsx` (trip dashboard Money tab body — above filter chip row)
- Pre-Stripe disclosure banner on `payment.tsx` above the Pay button (in addition to the schedule card above).
- CTA copy change on `payment.tsx` from `Pay $X` to `Pay $X deposit` when `installmentSchedule !== null` (inherits ORCH-0873 SPEC §3.5.4 Q1 deferred resolution).
- New strict-grep CI gate `.github/scripts/strict-grep/i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint.mjs` registered in `.github/workflows/strict-grep-mingla-business.yml`.
- 1 implementor happy-path regression test + 1 tester adversarial regression test (per ORCH-0840 Step 0.5 gate).

### Non-goals

- No database schema changes. `trip_pricing_tiers.tier_metadata.installments` and `orders.installment_plan_root` are already live (ORCH-0869 backend).
- No edge function changes. `ticket-checkout-create` v66 + `ticket-confirmation-dispatch` v60 already correct.
- No service-layer extension to `ticketCheckoutService`/`tripCheckoutService` response shapes — the originally-cited ORCH-0873 deferral blocker is bypassed via the trip-data path (`usePublicTripById`).
- No new icons or chrome additions (ORCH-0870 [App-wide icon replacement] gating preserved).
- No trip discovery card badge ("Payment plan available") — deferred per operator D3.
- No email surface changes — out per operator INTAKE; H-4 follow-up TBD.
- No consumer-app changes — no trips on consumer app.
- No admin-web changes — no admin trip-purchase or trip-edit surface.

### Assumptions

- `usePublicTripById` is the canonical hook for buyer-side trip reads and is already called by `TripCheckoutFlow`, `app/checkout-trip/[tripEventId]/index.tsx`, `buyer.tsx`, `payment.tsx`. Verified during investigation Phase 3.
- `TripPricingTier.installmentSchedule: TripInstallmentScheduleData | null` is typed and populated by `publicEventsService.ts:722-740`. Verified.
- The `EditPublishedTripScreen` Pricing accordion mounts `PaymentPlanEditor` via `TripCreatorStep4Pricing` (line 120-122) and the planner edit state holds `pricing.paymentPlan: TripInstallmentSchedule | null` (line 223). Verified.
- ORCH-0880 Phase 4 will close on Seth before ORCH-0882 implementor dispatches. Operator confirms or overrides at SPEC review.

---

## 2. Cross-Surface Impact (mandatory per Phase 2.5)

| # | Surface | In scope? | Files | Parity |
|---|---------|-----------|-------|--------|
| 1 | **Consumer iOS** (`app-mobile/`) | NO | none | No trips on consumer app today; C1 [Consumer Discover Trips Tab] unbuilt |
| 2 | **Consumer Android** | NO | none | Same as #1 |
| 3 | **Buyer/anonymous Web** (`mingla-business/` web bundle) | **YES — PRIMARY** | `app/t/[brandSlug]/[tripSlug].tsx` (via TripCheckoutFlow), `app/checkout-trip/[tripEventId]/{index,buyer,payment,intake?}.tsx` | Shared RN code; **automatic** parity with #4 + #5 via RN-Web bundle |
| 4 | **Business iOS** (`mingla-business/` on iOS) | **YES** | Buyer-anon routes (reachable from app shell — anon-tolerant), planner: `app/trip/[id]/index.tsx` Money tab + `src/components/trip/EditPublishedTripScreen.tsx` | Shared RN code |
| 5 | **Business Android** | **YES** | Same as #4 | Shared RN code (auto-parity with #4) |
| 6 | **Admin Web** (`mingla-admin/`) | NO | none | No admin trip-purchase or trip-edit surface; planners self-serve from business app |
| 7 | **Business Web preview** (mingla-business dev/web) | **YES (adjacent)** | Same as #3 + #4 RN-Web entry points | Automatic via RN-Web bundle |

**Manual parity required:** None — all 4 in-scope surfaces share the same RN component tree. Implementor delivers one set of file changes and all 4 platforms inherit. Tester verifies platform parity per Prime Directive #11 (TARGETED protocol Step 7).

**Per-surface SCs in §4 are platform-agnostic** because parity is automatic, but tester THREE-SURFACE PARITY enforces verification on iOS sim + Android emu + Web browser separately.

---

## 3. Q1–Q11 resolutions (locked per dispatch)

### Q1 — public-trip-page render site

**RESOLVED: inside `TripCheckoutFlow.tsx` reserve panel, above the Reserve CTA, below the tier card.**

Reasoning: TripCheckoutFlow is the existing trip-specific entry component (per its file header). It already owns the buyer-conversion context (tier display + Reserve CTA + helper copy about Stripe). The schedule card belongs in this conversion-focused panel so the buyer sees "tier price + plan + Reserve" together. Alternative (placing it above TripCheckoutFlow in `app/t/[brandSlug]/[tripSlug].tsx`) would scatter the conversion context across two components.

### Q2 — pre-Stripe banner exact copy

**RESOLVED:** banner appears above the Pay button on `payment.tsx`, inside the sticky bottom bar (or directly above it):

> **Payment plan active**
> You'll be charged **${depositFormatted}** today. The remaining **${remainingFormatted}** auto-charges in **${installmentCount}** payments on ${dateList}, from the card you enter next.

Where:
- `depositFormatted` = `formatCurrency(schedule.depositCents, schedule.currency)`
- `remainingFormatted` = `formatCurrency(schedule.fullPriceCents - schedule.depositCents, schedule.currency)`
- `installmentCount` = `schedule.installments.length`
- `dateList` = installment dates joined with locale-appropriate separators, e.g. "Jun 10, Jul 10, and Aug 10" (Intl-aware via the existing `formatDate` helper in `InstallmentScheduleDisplay.tsx`)

Banner styling: GlassCard variant="elevated", `accent.warm` tint border (existing token), inline above the `<Button label={...}>`. Touch target N/A (non-interactive text). `accessibilityRole="alert"` + `accessibilityLabel` matching the visible copy.

### Q3 — schedule signal per render

**RESOLVED:**

| Surface | Source signal | Anchor for projection |
|---------|---------------|------------------------|
| `TripCheckoutFlow.tsx` | `trip.pricingTiers[0].installmentSchedule` (single-tier per ORCH-0859) | `new Date()` (projection) |
| `app/checkout-trip/[tripEventId]/index.tsx` | per-tier `trip.pricingTiers[i].installmentSchedule` where cart has `qty ≥ 1` on that tier | `new Date()` (projection) |
| `app/checkout-trip/[tripEventId]/intake.tsx` (conditional) | `trip.pricingTiers[i].installmentSchedule` for the FIRST plan-active tier in cart | `new Date()` (projection) |
| `app/checkout-trip/[tripEventId]/buyer.tsx` | FIRST plan-active tier in cart (`cart.lines.find(l => tierForLine(l).installmentSchedule !== null)`) | `new Date()` (projection) |
| `app/checkout-trip/[tripEventId]/payment.tsx` | Same as buyer.tsx | `new Date()` (projection) |
| `EditPublishedTripScreen.tsx` Pricing accordion preview | `state.pricing.paymentPlan` (edit-buffer, live) | `new Date()` (projection) |
| `app/trip/[id]/index.tsx` Money tab header | `trip.pricingTiers[0].installmentSchedule` (single-tier template) | `new Date()` (projection — header is template preview, per-buyer Money tab body uses existing real `order_installments` ledger query) |

Multi-tier cart handling on qty picker: per-tier display below each `QuantityRow` that has both `installmentSchedule !== null` AND `cart.lines[i].quantity ≥ 1`. Single tier render on buyer/payment screens (the FIRST plan-active line — operator-acceptable per O-3 since multi-tier-with-plan carts are not in current production reality).

### Q4 — empty-state collapse

**RESOLVED:** component already returns `null` when `schedule === null` (line 105 of `InstallmentScheduleDisplay.tsx`). Each render site SHOULD wrap the render in a conditional that short-circuits BEFORE evaluating the mapper — pattern:

```tsx
const scheduleDisplay = useMemo(
  () => projectInstallmentSchedule(tier, new Date()),
  [tier],
);
{scheduleDisplay !== null ? (
  <InstallmentScheduleDisplay schedule={scheduleDisplay} variant="buyer" isProjection={true} />
) : null}
```

This ensures no orphan whitespace or container styling on trips without plans. Layout collapse tested on each render-site in regression test § 6.

### Q5 — variant copy split

**RESOLVED:** preserve existing behavior — buyer-variant renders the reassurance copy from `installmentReassuranceText` (line 142–149); planner-variant renders nothing below the GlassCard. No new copy needed.

### Q6 — responsive layout

**RESOLVED:** component is row-based with `flex: 1` on the date label column (line 167-172 of `InstallmentScheduleDisplay.tsx`) and right-aligned amount column. Already responsive. Tester verifies on:
- iPhone SE (320 × 568 logical, smallest iOS sim)
- Pixel small (360 × 640)
- Web browser narrow viewport at 320px width

No changes required.

### Q7 — loading state

**RESOLVED:** hide-until-loaded. The render-site mounts `usePublicTripById` which has its own loading state. When loading, `trip === null` and the entire route shows its loading shell. When loaded, the schedule is available synchronously off `trip.pricingTiers[i]`. No skeleton inside `InstallmentScheduleDisplay` itself.

### Q8 — planner edit-published refresh loop

**RESOLVED:**

1. **In-screen preview reflects edit buffer:** `EditPublishedTripScreen.tsx` planner-variant preview reads from `state.pricing.paymentPlan` (NOT from `trip.pricingTiers[0].installmentSchedule`) so it shows what the planner is currently editing.
2. **After Save:** `EditPublishedTripScreen` already calls `biz_update_live_trip` RPC per ORCH-0876 V2 + ORCH-0880 unified RPC extension. The existing onSuccess invalidation chain MUST include the `["public-trip", tripId]` key family. Implementor verifies the existing handler invalidates this key; adds the invalidation if absent.
3. **Buyer-side staleness:** any in-progress buyer viewing the trip page during a planner edit will see the OLD schedule until they navigate or pull-to-refresh. This is consistent with all other trip edits (price changes, tier name changes — see ORCH-0876 V2 invariants); no additional realtime push required.

### Q9 — buyer-anon-web SSR/SSG

**RESOLVED:** Expo Router on Web is CSR (client-side rendered). The schedule renders client-side after hydration. No SSR concerns. Verified by reviewing existing public trip page rendering pattern.

### Q10 — multi-tier visual placement

**RESOLVED:**

- `index.tsx` qty picker: per-tier render BELOW each `QuantityRow` when that tier has `installmentSchedule !== null` AND `cart.line.quantity ≥ 1`. If quantity is 0, no schedule shown for that tier (avoid clutter).
- `buyer.tsx` + `payment.tsx`: aggregate render — show the FIRST plan-active tier in the cart. If the cart has multiple plan-active tiers (rare; not in current production), only the first is shown with the pre-Stripe banner referencing that tier specifically.
- `intake.tsx` (conditional on ORCH-0880 close): same as buyer.tsx — FIRST plan-active tier aggregate.
- Future multi-tier-with-multiple-plans support: register follow-up ORCH when (and only when) a multi-tier-with-multiple-plans trip is published. No current production case.

### Q11 — ORCH-0880 coordination

**RESOLVED: WAIT for ORCH-0880 [Tr5 Traveler Intake Forms] Phase 4 CLOSE before dispatching ORCH-0882 implementor.**

Reasoning:
- ORCH-0880 Phase 4 is actively in flight; `intake.tsx` is untracked + `buyer.tsx` and `payment.tsx` are modified locally on Seth (verified via `git status`).
- Both ORCHs touch `buyer.tsx` and `payment.tsx`. Concurrent implementor passes guarantee merge conflicts.
- ORCH-0880 Phase 4 has its own regression-test gate per ORCH-0840; landing ORCH-0882 mid-flight muddies the test traceability.
- ORCH-0882 is not blocking any production trip today (zero plan-configured trips in production); the wait cost is operator-tolerable.

**Sub-component carve-out fallback:** if operator chooses to dispatch ORCH-0882 implementor in parallel, implementor MUST extract the disclosure logic into a stable sub-component `<TripPaymentPlanDisclosure tripId={...} variant="buyer-checkout" />` (or similar) that ORCH-0880 Phase 4 can import as-is from any of its modified files. Default = wait-for-CLOSE; sub-component carve-out only on operator override.

---

## 4. Success Criteria

All SCs are observable, testable, and unambiguous. Per-platform parity is automatic via shared RN code.

### Buyer-side (5 sub-criteria; SC-5e gated on ORCH-0880 Phase 4 status)

| SC | Statement |
|----|-----------|
| **SC-1a** | When `usePublicTripById(tripId).data.trip.pricingTiers[0].installmentSchedule !== null`, the buyer on `/t/{brandSlug}/{tripSlug}` sees `<InstallmentScheduleDisplay variant="buyer" isProjection={true}>` rendered inside `TripCheckoutFlow.tsx`, above the Reserve CTA, below the tier card. Reassurance copy renders below the schedule card. |
| **SC-1b** | When the trip has no payment plan, `TripCheckoutFlow.tsx` renders identically to its current state. Component returns null; no orphan whitespace. |
| **SC-2a** | When the buyer reaches `/checkout-trip/{tripEventId}/` qty picker and adds quantity ≥ 1 of any tier with `installmentSchedule !== null`, `<InstallmentScheduleDisplay variant="buyer" isProjection={true}>` renders below that tier's `QuantityRow`. Reassurance copy renders below the schedule. |
| **SC-2b** | Tiers with `installmentSchedule === null` or `cart.line.quantity === 0` render no schedule card. |
| **SC-3** | When the buyer reaches `/checkout-trip/{tripEventId}/buyer.tsx` and the cart contains ≥1 plan-active tier, `<InstallmentScheduleDisplay variant="buyer" isProjection={true}>` renders above the existing order summary block, using the FIRST plan-active tier as the source. |
| **SC-4a** | When the buyer reaches `/checkout-trip/{tripEventId}/payment.tsx` and the cart contains ≥1 plan-active tier, `<InstallmentScheduleDisplay variant="buyer" isProjection={true}>` renders inside the ScrollView between the existing Order Summary card and the Payment card. |
| **SC-4b** | The pre-Stripe disclosure banner (Q2 copy) renders inside or directly above the sticky bottom bar, above the Pay button, when cart has plan-active lines. |
| **SC-4c** | Pay button label changes from `Pay {totals.total}` to `Pay {schedule.depositCents} deposit` when cart has plan-active lines. Constitution #3 silent-failure resolved. |
| **SC-5a** | When `installmentSchedule === null` for all cart lines, payment.tsx renders identically to its current state (no schedule, no banner, original CTA copy). |
| **SC-5e** (conditional on ORCH-0880 Phase 4 closed) | `/checkout-trip/{tripEventId}/intake.tsx` renders `<InstallmentScheduleDisplay variant="buyer" isProjection={true}>` above the intake form when cart has plan-active lines. |

### Planner-side (2 sub-criteria)

| SC | Statement |
|----|-----------|
| **SC-6** | On `EditPublishedTripScreen.tsx` Pricing accordion (`section: pricing`), when `state.pricing.paymentPlan !== null`, `<InstallmentScheduleDisplay variant="planner" isProjection={true}>` renders directly below the existing `<PaymentPlanEditor>` instance, inside the same accordion section, reading from `state.pricing.paymentPlan` (the edit-buffer, not the persisted trip value). Preview live-updates as the planner edits. |
| **SC-7** | On `app/trip/[id]/index.tsx` Money tab body (`MoneyTabBody` component, lines 1088–1146), when `trip.pricingTiers[0].installmentSchedule !== null`, `<InstallmentScheduleDisplay variant="planner" isProjection={true}>` renders above the filter chip row (above the `<View style={styles.moneyFilterRow}>` at line 1149). When the trip has no plan, MoneyTabBody renders identically to its current state. |

### Cross-cutting

| SC | Statement |
|----|-----------|
| **SC-8** | Mapper utility `installmentScheduleProjection.ts` exports `projectInstallmentSchedule(tier: TripPricingTier, anchorDate: Date): InstallmentScheduleDisplaySchedule | null` and satisfies: returns null when `tier.installmentSchedule === null`; computes `depositCents = Math.round(tier.priceCents * tier.installmentSchedule.deposit_pct / 100)`; per installment, computes `amountCents = Math.round(tier.priceCents * inst.pct / 100)` and `dueAt = inst.fixed_date ? inst.fixed_date + 'T00:00:00Z' : addDays(anchorDate, inst.days_after_booking).toISOString()`. Constitution #9: no fabricated data. |
| **SC-9** | `InstallmentScheduleDisplay` accepts new optional prop `isProjection?: boolean` (defaults to `false`). When `isProjection === true` and `variant === "buyer"`, the reassurance copy includes a clarifier ("dates assume you book today") OR the schedule itself prefixes a note "(projected)". Exact copy passed to implementor pre-flight `/ui-ux-pro-max` invoke. Component header comment updated to canonical ORCH-0882 wiring targets. |
| **SC-10** | New strict-grep CI gate `i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint` asserts: each of the 4 (or 5 post-ORCH-0880) buyer-route files contains a literal `installmentSchedule` reference AND imports `InstallmentScheduleDisplay`. Gate fails if any file is missing either. Registered in `.github/workflows/strict-grep-mingla-business.yml`. |
| **SC-11** | Implementor happy-path regression test at `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring.test.ts` asserts each render site imports the component (structural-grep on source) AND tests `projectInstallmentSchedule` mapper math on 3 canonical inputs (25/50/25 split, fixed-date variant, edge `days_after_booking: 0`). `fails-on-revert verified at <commit hash>` line in implementation report. |
| **SC-12** | Tester adversarial regression test at `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring_adversarial.test.ts` attacks DIFFERENT angles than implementor: (a) projection date math under DST cross + year boundary + leap-year + `days_after_booking: 0`; (b) multi-tier cart with mixed plan + no-plan tiers; (c) Pay-button CTA copy contract (must say "deposit" when plan-active); (d) component-level fabrication contract (rendered amounts must equal mapper output 1-to-1; assert via Node-level mechanism test reading the source file's render math); (e) `feedback_anon_buyer_routes.md` preservation (zero `useAuth` import in any of the 4-5 buyer routes touched). Fails-on-revert proof required. |

### Per-platform parity SCs (automatic via shared RN code)

| SC | Surface | Statement |
|----|---------|-----------|
| **SC-PAR-iOS** | Business-iOS sim | All SC-1a..SC-7 verified by tester running flow on iOS sim with a manually-published plan-configured trip (operator creates test trip pre-TEST dispatch) |
| **SC-PAR-Android** | Business-Android emu | Same as SC-PAR-iOS |
| **SC-PAR-Web** | Buyer-anon-web browser | Same as SC-PAR-iOS executed in Chrome at the dev server URL |

---

## 5. Invariants

### Inherited (preserve)

- **Constitution #3** (no silent failures) — disclosure visible on every plan-active touchpoint, Pay button says "deposit" not full price.
- **Constitution #9** (no fabricated data) — projected dates explicitly labeled as projections; mapper math 1-to-1 with stored `tier_metadata.installments`.
- **Constitution #10** (currency + locale aware) — `Intl.NumberFormat` + `Intl.DateTimeFormat` already in component; preserved.
- **Constitution #13** (exclusion consistency) — same disclosure on every buyer touchpoint via CI gate.
- **ORCH-0869 invariants** — deposit-PI `mingla_installment_plan_root` metadata, `setup_future_usage: 'off_session'`, `orders.installment_plan_root` flag. Read-only consumed; no backend change.
- **ORCH-0876 V2 invariants** — `business_patch_*` RPC pattern preserved on planner Save; no Zustand-only writes for the schedule (PaymentPlanEditor already writes via the patch path).
- **ORCH-0880 invariants** (post-Phase-4 close) — intake form gate preserved; ORCH-0882 wires disclosure ALONGSIDE intake form on intake.tsx without changing intake gating.
- **ORCH-0859 invariants** — single-tier trip model (`trip.pricingTiers[0]` canonical); ORCH-0882 codes defensively for future multi-tier per Q10.
- **ORCH-0873 invariants** — `I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY` + `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH` (both ACTIVE) — no Stripe customer/PM operations in ORCH-0882; no currency-mixing.
- `feedback_anon_buyer_routes.md` — no `useAuth`, no sign-in redirect on any of the 4-5 buyer routes touched.
- `feedback_rn_color_formats.md` — hex/rgb/hsl/hwb only; no oklch/lab/color-mix in new banner styles.
- `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md` — pre-Stripe banner sets explicit `flexGrow: 0, flexShrink: 0` if siblings any ScrollView.
- `feedback_rn_sub_sheet_must_render_inside_parent.md` — pre-Stripe banner does NOT live inside a sub-sheet; renders as a normal child of `payment.tsx` JSX tree above the bottom bar.
- `feedback_keyboard_never_blocks_input.md` — pre-Stripe banner static text, no keyboard concern; payment.tsx existing keyboard pattern preserved.
- `feedback_toast_needs_absolute_wrap.md` — no new toasts.
- `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` (ORCH-0859) — disclosure renders only on trip routes; component no-ops on non-trip events (already enforced by component-level null schedule).
- `I-PROPOSED-TR2-EVENTS-TYPE-FILTER` — preserved at data layer.

### New DRAFT → ACTIVE on close

| Invariant ID | Description |
|--------------|-------------|
| **I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT** | Every buyer-facing trip checkout file that references `installmentSchedule` MUST also import `InstallmentScheduleDisplay`. Enforced by strict-grep CI gate scanning `mingla-business/app/checkout-trip/[tripEventId]/*.tsx` + `mingla-business/src/components/trip/TripCheckoutFlow.tsx`. Adding a new buyer route without the disclosure import fails CI. |
| **I-PROPOSED-TR3-PLAN-DISCLOSURE-NO-FABRICATION** | Rendered schedule amounts and dates MUST equal mapper output 1-to-1; component does no transformation. Enforced by adversarial regression test (a Node-level mechanism test reading the component source file and asserting no other formatting helpers wrap the prop values besides `Intl.NumberFormat` and `Intl.DateTimeFormat`). |
| **I-PROPOSED-TR3-PLAN-DISCLOSURE-PRE-STRIPE-BANNER-RENDERS-WHEN-PLAN-ACTIVE** | The pre-Stripe disclosure banner on `payment.tsx` MUST render whenever the active cart contains ≥1 line with `installmentSchedule !== null`, AND the Pay button label MUST say "deposit" not the full price. Enforced by adversarial regression test asserting both conditions on a fixture cart. |

---

## 6. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Mapper happy path 25/50/25 | tier priceCents=110000 currency=USD installmentSchedule={deposit_pct:25, installments:[{ordinal:1,pct:50,days_after_booking:30},{ordinal:2,pct:25,days_after_booking:60}]}; anchor=2026-06-01 | depositCents=27500; installments[0].amountCents=55000, dueAt=2026-07-01T00:00:00.000Z; installments[1].amountCents=27500, dueAt=2026-07-31T00:00:00.000Z; fullPriceCents=110000 | Mapper util |
| T-02 | Mapper null schedule | tier with installmentSchedule=null | returns null | Mapper util |
| T-03 | Mapper fixed_date variant | tier installments=[{ordinal:1,pct:50,fixed_date:"2026-07-04"},{ordinal:2,pct:25,fixed_date:"2026-08-04"}] | dueAt strings = "2026-07-04T00:00:00Z" and "2026-08-04T00:00:00Z" regardless of anchor | Mapper util |
| T-04 | Mapper edge days_after_booking=0 | installments=[{ordinal:1,pct:50,days_after_booking:0}] | dueAt = anchor.toISOString() | Mapper util |
| T-05 | Mapper DST cross (US Spring forward) | anchor=2026-03-08T12:00:00Z (day before DST in US); days_after_booking=7 | dueAt = 2026-03-15T12:00:00Z (UTC math is DST-agnostic; display layer respects user locale) | Mapper util |
| T-06 | TripCheckoutFlow renders schedule when plan-active | trip.pricingTiers[0].installmentSchedule !== null | InstallmentScheduleDisplay imported + rendered above Reserve CTA | Component + integration |
| T-07 | TripCheckoutFlow renders nothing when no plan | trip.pricingTiers[0].installmentSchedule === null | no InstallmentScheduleDisplay render; identical to pre-ORCH-0882 | Component |
| T-08 | Qty picker per-tier disclosure | cart line qty=1 on tier with plan | InstallmentScheduleDisplay below that QuantityRow | Component |
| T-09 | Qty picker qty=0 no disclosure | cart line qty=0 on tier with plan | no render | Component |
| T-10 | Buyer details aggregate | cart has plan-active + no-plan tiers | InstallmentScheduleDisplay renders for FIRST plan-active tier only, above order summary | Component |
| T-11 | Payment screen schedule | cart has plan-active line | InstallmentScheduleDisplay renders between Order Summary and Payment cards | Component |
| T-12 | Payment screen pre-Stripe banner | cart has plan-active line | Banner with Q2 copy renders above Pay button | Component |
| T-13 | Payment screen Pay-button copy | cart has plan-active line | Button label = "Pay $X deposit" (X = depositCents formatted), NOT "Pay $X" (full price) | Component |
| T-14 | Payment screen no-plan no banner | cart with only no-plan tiers | No banner; Pay button = "Pay $X" with full price | Component |
| T-15 | EditPublishedTripScreen planner preview live | planner toggles PaymentPlanEditor on, edits deposit_pct 25→30 | preview re-renders with new depositCents within 1 frame; reads from edit-buffer not persisted state | Component + state |
| T-16 | Money tab planner header | trip.pricingTiers[0].installmentSchedule !== null | planner-variant render above filter chip row | Component |
| T-17 | Money tab no plan | trip.pricingTiers[0].installmentSchedule === null | no planner header; existing empty-state preserved | Component |
| T-18 | Adversarial Pay-button regression | cart with plan-active line | Pay button copy contains literal "deposit" substring | Adversarial regression |
| T-19 | Adversarial no-fabrication | rendered DOM | every $-amount in component matches `formatCurrency(schedule.X, schedule.currency)` output exactly | Adversarial regression |
| T-20 | Adversarial anon preservation | grep imports on 4 (or 5) buyer routes | zero `useAuth` imports, zero sign-in redirect | Adversarial regression |
| T-21 | Adversarial multi-tier mixed | cart with 1 plan tier + 1 no-plan tier | disclosure appears for plan tier only on qty picker; aggregate uses plan tier on buyer/payment | Adversarial regression |
| T-22 | Strict-grep CI gate | run gate on PR diff | gate passes; modifying a buyer route to drop the import would fail | CI |
| T-PAR-iOS | iOS sim full flow | published plan trip; iOS sim flows public → reserve → qty → buyer → payment | all renders correct; Pay button copy correct | Live-fire |
| T-PAR-Android | Android emu full flow | same as T-PAR-iOS | identical behavior | Live-fire |
| T-PAR-Web | Web browser full flow | same as T-PAR-iOS in Chrome | identical behavior | Live-fire |

---

## 7. Implementation Order

Implementor pre-flight: invoke `/ui-ux-pro-max` per `feedback_implementor_uses_ui_ux_pro_max.md` for:
- The pre-Stripe banner visual treatment (GlassCard variant, accent.warm border vs base, copy hierarchy)
- The planner-preview `variant="planner"` layout treatment in EditPublishedTripScreen (same card as PaymentPlanEditor, or sibling)
- The "isProjection" copy clarifier exact text + placement
- Layout-collapse confirmation on the 4 buyer routes (no orphan whitespace)

Pre-flight scope: pixel-precision (spacing, copy, color); no new components.

Then in order:

1. **Mapper utility** — `mingla-business/src/utils/installmentScheduleProjection.ts` (new, ~40 LOC). Pure function. Easy first step. T-01..T-05.
2. **Component prop addition** — `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx`: add `isProjection?: boolean` prop; update header comment; add the projection clarifier copy when `isProjection === true && variant === "buyer"`. Update `installmentReassuranceText` signature to accept optional `isProjection` flag.
3. **TripCheckoutFlow.tsx** — wire `variant="buyer" isProjection={true}` inside reserve panel above CTA. SC-1a/SC-1b. T-06/T-07.
4. **checkout-trip index.tsx** — per-tier disclosure below each QuantityRow with qty ≥ 1 + plan. SC-2a/SC-2b. T-08/T-09.
5. **checkout-trip buyer.tsx** — aggregate disclosure above existing order summary. SC-3. T-10. Wait for ORCH-0880 Phase 4 CLOSE before touching.
6. **checkout-trip payment.tsx** — schedule card in ScrollView + pre-Stripe banner + CTA copy change. SC-4a/4b/4c/5a. T-11/T-12/T-13/T-14. Wait for ORCH-0880 Phase 4 CLOSE.
7. **checkout-trip intake.tsx** (conditional) — only if ORCH-0880 Phase 4 has closed by implementor dispatch time. SC-5e.
8. **EditPublishedTripScreen.tsx** — planner-variant preview below PaymentPlanEditor in Pricing accordion. SC-6. T-15.
9. **app/trip/[id]/index.tsx** — Money tab header above filter chip row. SC-7. T-16/T-17.
10. **Strict-grep CI gate** — `.github/scripts/strict-grep/i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint.mjs` (new). Register in workflow. SC-10. T-22.
11. **Implementor happy-path regression test** — `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring.test.ts` (new). T-01..T-05 mapper + T-06..T-17 structural-grep. `fails-on-revert verified at <commit hash>` line in implementation report. SC-11.
12. **Update component header comment + tsc strict pass + Implementation report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER.md` with file-by-file old→new receipts, SC traceability table, hard-guard checklist, deviations + discoveries, verification status, fails-on-revert commit hash.

---

## 8. Regression Prevention

- **CI gate** `I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT` (DRAFT → ACTIVE on close): scans 4 (or 5) buyer-route files for both `installmentSchedule` reference + `InstallmentScheduleDisplay` import. Future ORCH adding a buyer route without disclosure fails the gate at PR time.
- **CI gate** `I-PROPOSED-TR3-PLAN-DISCLOSURE-NO-FABRICATION` (test-enforced, not strict-grep): adversarial test reads the component source file and asserts no formatting helper wraps the prop values other than `Intl.NumberFormat` + `Intl.DateTimeFormat`.
- **CI gate** `I-PROPOSED-TR3-PLAN-DISCLOSURE-PRE-STRIPE-BANNER-RENDERS-WHEN-PLAN-ACTIVE` (test-enforced): adversarial test asserts banner renders + Pay-button copy contains "deposit" substring when cart has plan-active line, using a Node-level fixture.
- **Protective comment** in `InstallmentScheduleDisplay.tsx` header lists the canonical ORCH-0882 wiring targets so future ORCHs see "this component MUST appear on these N files."
- **Append-only test contract** per ORCH-0840 [Regression-test enforcement + append-only CI] — implementor + tester regression tests immutable post-CLOSE except via `[TEST-MOD-APPROVED ORCH-NNNN]` token.

---

## 9. Discoveries for Orchestrator (re-cited from INVESTIGATION §9)

- DISC-0882-1: ticket-purchase confirmation email schedule display verification (probably missing; out of ORCH-0882 scope; follow-up ORCH candidate).
- DISC-0882-2: process improvement for orchestrator REVIEW — verify deferral-blocker claims hold across BOTH session-response AND trip-data paths.
- DISC-0882-3: process improvement for mirror-and-substitute ORCHs (ORCH-0876 V2 pattern) — enumerate inherited deferred SCs in §Cross-Surface Impact.
- DISC-0882-4: trip discovery card "Payment plan available" badge — revisit post-C1 [Consumer Discover Trips Tab].
- DISC-0882-5: multi-tier-with-multiple-plans support — register follow-up ORCH when first such trip publishes.
- DISC-0882-6: PaymentPlanEditor + planner-variant preview layout decision in EditPublishedTripScreen passed to implementor pre-flight `/ui-ux-pro-max`.

---

## 10. EAS OTA eligibility

**YES — EAS OTA-eligible.**

- No native modules added.
- No native config changes (Info.plist, AndroidManifest, expo plugins).
- No new npm package dependencies (component already in bundle; mapper utility uses standard JS Date math).
- All changes are JSX wiring + 1 new TS utility + 1 modified component + 1 new strict-grep CI script.

Operator publishes after merge via:

```bash
cd mingla-business && eas update --branch production --platform ios,android --message "ORCH-0882: payment plan disclosure on trip buyer + planner surfaces"
```

---

## 11. Coordination

| Coordination | Status | Action |
|--------------|--------|--------|
| **ORCH-0880 [Tr5 Traveler Intake Forms] Phase 4** | IN FLIGHT (uncommitted on Seth — intake.tsx untracked, buyer.tsx + payment.tsx modified) | **WAIT FOR ORCH-0880 PHASE 4 CLOSE** before dispatching ORCH-0882 implementor. Operator overrides only via explicit sub-component carve-out instruction (Q11 fallback). |
| **ORCH-0870 [App-wide icon replacement]** | GATED (waits for ORCH-0864 close) | No icon additions in ORCH-0882; no conflict. |
| **ORCH-0840 [Regression-test enforcement + append-only CI]** | ACTIVE | ORCH-0882 implementor + tester regression tests must satisfy Step 0.5 gate with fails-on-revert proof. |
| **ORCH-0859 [Tr2 Minimum Viable Trip]** | CLOSED | Single-tier `trip.pricingTiers[0]` assumption preserved; defensive code for multi-tier future. |
| **ORCH-0873 [Tr3 Stage 2 UI]** | CLOSED | Inherits SC-5a/5b/5c/6 deferred work; supersedes header-comment wiring targets. |
| **ORCH-0876 V2 [Trip CRUD]** | CLOSED | Inherits trip-route fork; re-targets to `checkout-trip/*`. |

---

## 12. Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

Implementor dispatches AFTER ORCH-0880 Phase 4 closes (or with operator-authorized sub-component carve-out). All scoped artifacts produced under `Mingla_Artifacts/` + `mingla-business/` + `.github/scripts/strict-grep/` on Seth. Operator owns DB migration push (none required for ORCH-0882). Orchestrator owns edge function deploy (none required for ORCH-0882). PR Seth→main per one-PR-per-CLOSE rule, with 5-condition pre-merge gate.

---

## 13. Hard guards (mandatory implementor + tester checklist)

| Guard | Status check at implementor return |
|-------|------------------------------------|
| `feedback_anon_buyer_routes.md` | grep all 4-5 buyer routes — zero `useAuth` import |
| `feedback_rn_color_formats.md` | grep new banner styles — zero oklch/lab/color-mix/hwb |
| `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md` | pre-Stripe banner explicit `flexGrow: 0, flexShrink: 0` if siblings any ScrollView |
| `feedback_rn_sub_sheet_must_render_inside_parent.md` | pre-Stripe banner NOT inside a Sheet (rendered as normal JSX child) |
| `feedback_keyboard_never_blocks_input.md` | payment.tsx keyboard pattern preserved; banner doesn't overlap keyboard |
| `feedback_toast_needs_absolute_wrap.md` | no new toasts; existing toast pattern preserved |
| `feedback_implementor_uses_ui_ux_pro_max.md` | implementor pre-flight `/ui-ux-pro-max` invoked + cited in implementation report |
| Constitution #3 | Pay-button CTA says "deposit" when plan-active |
| Constitution #9 | mapper math 1-to-1 with `tier_metadata.installments`; projection clarifier visible |
| Constitution #10 | `Intl.NumberFormat` + `Intl.DateTimeFormat` preserved |
| Constitution #13 | disclosure on every plan-active buyer touchpoint (CI gate enforced) |
| ORCH-0840 Step 0.5 | implementor happy-path test + tester adversarial test, both with fails-on-revert proof |
| ORCH-0859 single-tier | `trip.pricingTiers[0]` canonical; multi-tier defensive |
| ORCH-0873 invariants | `I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY` + `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH` (no Stripe customer/PM ops; no currency mixing) |
| ORCH-0876 V2 invariants | `business_patch_*` RPC pattern preserved on planner Save |
| ORCH-0880 invariants (post-Phase-4) | intake form gate preserved alongside disclosure |
| Touch + accessibility | any new interactive element ≥44pt + `accessibilityLabel`; banner is text-only `accessibilityRole="alert"` |
| TypeScript strict | zero new tsc errors; exhaustive switches if any switch added |
| EAS OTA | no native deps; ready for `eas update` post-merge |

---

End of SPEC ORCH-0882.

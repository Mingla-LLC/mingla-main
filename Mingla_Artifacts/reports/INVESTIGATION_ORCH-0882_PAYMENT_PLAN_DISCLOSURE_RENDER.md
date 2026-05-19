# INVESTIGATION — ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer + Planner Surfaces]

**Author:** Claude `mingla-forensics` (INVESTIGATE+SPEC single-session per ORCH-0875/0877/0880 pattern)
**Date:** 2026-05-19
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER.md`

---

## 0. Layman summary of the report

- The `InstallmentScheduleDisplay` component exists (built ORCH-0873 [Tr3 Installment Payments Stage 2 UI]) but is imported by exactly **zero** files in the live app. A buyer on a trip with a payment plan completes the entire checkout flow today with no in-product disclosure of the deposit-vs-full-price split or the future installment schedule — Stripe shows only the deposit amount and a reasonable buyer can mistake that for the full trip price.
- The gap was **not a miss** — ORCH-0873 explicitly deferred the 3 buyer-route render SCs (SC-5a/5b/5c) and the planner-preview render SC (SC-6) at TEST dispatch, operator-pre-accepted. The recorded deferral reason was "blocked on extending `ticketCheckoutService`/`tripCheckoutService` response-shape mappers to surface `installmentSchedule` from Stage 1b RPC response."
- That reasoning is **now obsolete.** The schedule template is already typed and exposed on every `usePublicTripById` consumer via `TripPricingTier.installmentSchedule` (`mingla-business/src/services/tripsService.ts:50`). No service-layer extension is required. The Implementor can read the schedule directly off the trip pricing tier on every render target.
- ORCH-0876 V2 then forked the trip checkout flow to `app/checkout-trip/[tripEventId]/*` after ORCH-0873, so the original SC-5a/5b/5c wiring targets (event-side `/checkout/[eventId]/*`) are stale; ORCH-0882 re-targets to the trip-side routes plus 3 new targets (public trip page + 2 planner surfaces + pre-Stripe banner) per operator Comprehensive scope.
- **CRITICAL coordination:** ORCH-0880 [Tr5 Traveler Intake Forms] Phase 4 is actively in progress in the uncommitted Seth working tree — `app/checkout-trip/[tripEventId]/intake.tsx` is a NEW 722-line untracked file plus `buyer.tsx` and `payment.tsx` are modified. ORCH-0882 implementor pass MUST wait for ORCH-0880 Phase 4 CLOSE before touching the 3 shared files, OR carve disclosure into a stable `<TripPaymentPlanDisclosure>` sub-component ORCH-0880 imports as-is. SPEC §11 recommends the wait-for-CLOSE path.
- **Constitution #3 silent-failure consequence:** `payment.tsx:496` `Pay $X` CTA shows `totals.total` (full price) regardless of plan state — buyer sees full price on the Pay button then Stripe charges only the deposit. SPEC mandates the CTA copy change to `Pay $X deposit` when plan-active (matching the never-shipped ORCH-0873 Q1 resolution).
- Estimated implementor scope: **9 product files + 1 new mapper utility + 1 new CI gate + 2 regression tests = 13 files**; **EAS OTA-eligible** (pure JS, no native deps).
- 3 new DRAFT invariants (`I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT`, `I-PROPOSED-TR3-PLAN-DISCLOSURE-NO-FABRICATION`, `I-PROPOSED-TR3-PLAN-DISCLOSURE-PRE-STRIPE-BANNER-RENDERS-WHEN-PLAN-ACTIVE`). All three flip to ACTIVE on close.
- Confidence: `proven` (structural — five-layer cross-check complete; no runtime repro required since this is a missing-feature investigation not a behavior bug; grep evidence is definitive).

---

## 1. Symptom + Expected vs Actual

**Expected:** Buyer on a trip with a payment plan sees the deposit + installment schedule at every checkout touchpoint (public trip page → Reserve → qty → buyer details → payment → Stripe). Pay button reflects the deposit amount, not the full trip price. Planner sees the same schedule preview when editing the trip in EditPublishedTripScreen + on the trip dashboard Money tab.

**Actual:** Buyer sees `totals.total` (full trip price) on every screen. `InstallmentScheduleDisplay` component exists but is imported nowhere. Stripe charges only the deposit (correct per server-side branch in `ticket-checkout-create` v66), creating buyer surprise: "I thought I was paying $1,000 — why did Stripe only charge $200?"

**Reproduction conditions:** any trip with `trip_pricing_tiers.tier_metadata.installments` configured. Today there are zero such trips in production (operator confirmed), so the surprise has not occurred in the wild yet — but it is guaranteed the moment the first planner uses the PaymentPlanEditor (built ORCH-0873) to configure a plan on a published trip.

**When it started:** never worked. ORCH-0873 shipped the component file + the planner-side PaymentPlanEditor + the trip dashboard Money tab + the strict-grep CI gates — but explicitly deferred SC-5a/5b/5c/6 (the four render-site wirings). ORCH-0876 V2 mirrored the buyer routes to trip-side without carrying the deferred wiring forward. The gap has stood since 2026-05-18 ORCH-0873 close.

---

## 2. Investigation Manifest

Read in trace order, source → render → coordination:

| # | File | Why |
|---|------|-----|
| 1 | `Mingla_Artifacts/specs/SPEC_ORCH-0873_TR3_STAGE_2_UI.md` | Original spec listing SC-5a/5b/5c/6 |
| 2 | `Mingla_Artifacts/WORLD_MAP.md` ORCH-0873 close row | Deferral context (operator-pre-accepted) |
| 3 | `Mingla_Artifacts/specs/SPEC_ORCH-0876_V2_FULL_PARITY.md` §8.3-8.5 | Trip-route fork context |
| 4 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md` | Phase 4 in-progress coordination |
| 5 | `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx` | Component contract: `InstallmentScheduleDisplaySchedule` shape, `variant` prop, return-null logic |
| 6 | `mingla-business/src/copy/installmentReassurance.ts` | Buyer-variant copy |
| 7 | `mingla-business/src/services/tripsService.ts:34-66` | `TripPricingTier.installmentSchedule: TripInstallmentScheduleData \| null` typed signal |
| 8 | `mingla-business/src/services/publicEventsService.ts:722-740` | Where `installmentSchedule` is extracted from `tier_metadata.installments` into `TripPricingTier` |
| 9 | `mingla-business/src/services/ticketCheckoutService.ts:39-86` | `TicketCheckoutCreate*Result` response types — confirmed DO NOT carry `installmentSchedule` (the deferred ORCH-0873 blocker — still true today but irrelevant given trip-data path) |
| 10 | `mingla-business/app/t/[brandSlug]/[tripSlug].tsx:171,211` | Public trip page — renders `TripPreview` + `TripCheckoutFlow`; trip data available |
| 11 | `mingla-business/src/components/trip/TripCheckoutFlow.tsx` | Reserve panel — single tier today (`trip.pricingTiers[0]`); clean insertion point above CTA at line 99 |
| 12 | `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | Qty picker — `usePublicTripById` line 120; insertion above `Select your tier` label line 320 |
| 13 | `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` (MODIFIED) | Buyer info — usePublicTripById already imported line 59; ORCH-0880 Phase 4 in-flight |
| 14 | `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` (MODIFIED) | Order summary + Pay CTA; insertion above payment card + pre-Stripe banner above Pay button; CTA copy change at line 496 |
| 15 | `mingla-business/app/checkout-trip/[tripEventId]/intake.tsx` (NEW, UNTRACKED) | ORCH-0880 Phase 4 buyer-fill — 5th buyer touchpoint to wire when (and only when) ORCH-0880 closes |
| 16 | `mingla-business/app/trip/[id]/index.tsx:1088-1146` | Trip dashboard Money tab body — insertion above filter chip row |
| 17 | `mingla-business/src/components/trip/EditPublishedTripScreen.tsx:189-224, 364-393` | Pricing accordion — `PaymentPlanEditor` already renders here; insertion below for `variant="planner"` live preview |
| 18 | `supabase/migrations/20260610000000_tr3_installments.sql` | Schema: `orders.installment_plan_root`, `order_installments` ledger, RLS |
| 19 | `supabase/functions/ticket-checkout-create/index.ts:308-664` | Read-only: server-side deposit branch on `session.installmentSchedule !== null` |
| 20 | `mingla-business/src/components/checkout/CartContext.tsx` | Cart shape — multi-tier consideration |

---

## 3. Five-Layer Cross-Check

| Layer | Truth |
|-------|-------|
| **Docs** | `SPEC_ORCH-0873_TR3_STAGE_2_UI.md` §3.5.4 + §3.5.5 + SC-5a/5b/5c/6 explicitly mandate render on the buyer + planner-preview surfaces. Component header comment (`InstallmentScheduleDisplay.tsx:5-9`) lists the original 4 event-side render targets. Documentation says the wiring exists. |
| **Schema** | `trip_pricing_tiers.tier_metadata.installments` (JSONB) carries `{ deposit_pct, installments: [{ ordinal, pct, days_after_booking?, fixed_date? }] }` per ORCH-0869 §3.1. `orders.installment_plan_root: boolean NOT NULL DEFAULT false`, `order_installments` ledger present. All live since 2026-05-15 ORCH-0869 backend close. |
| **Code** | `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx` exists (192 LOC, prop shape per §1 above). `mingla-business/src/services/tripsService.ts:50` types `installmentSchedule: TripInstallmentScheduleData \| null` on every `TripPricingTier`. `mingla-business/src/services/publicEventsService.ts:724-738` extracts it from `tier_metadata.installments` on every public-trip read. **Zero import sites in any render target.** Confirmed by `grep -rn "InstallmentScheduleDisplay" mingla-business/{app,src}` returning only the component file itself plus 2 test files. |
| **Runtime** | A buyer purchasing a plan-active trip would see `Pay {totals.total}` (full price) on payment.tsx line 496 sticky bottom bar. Server-side `biz_ticket_checkout_create_session` correctly creates a Stripe PaymentIntent for `depositCents` only with `setup_future_usage: 'off_session'` + `mingla_installment_plan_root: 'true'` metadata. The Stripe PaymentSheet / hosted checkout displays the deposit amount. **The UI lies about the price; Stripe tells the truth.** Constitution #3 violation in the wild. |
| **Data** | Zero production trips have payment plans configured today (operator-confirmed in 2026-05-19 brainstorm session). `SELECT COUNT(*) FROM trip_pricing_tiers WHERE tier_metadata ? 'installments'` would return 0 if probed. Blast radius is currently zero, but the gap is structurally guaranteed to surface the moment a planner uses the PaymentPlanEditor (which is live and accessible). |

**Contradictions found:**
- Docs ↔ Code: spec mandates wiring; code has zero call sites. (Reconciled by ORCH-0873 close-row deferral acknowledgment.)
- Code ↔ Runtime: UI displays full price; Stripe charges deposit. (This IS the bug — Constitution #3 silent failure once data populates.)
- Docs ↔ Docs: ORCH-0873 component header lists 4 event-side targets; ORCH-0876 V2 forked trip checkout to a separate route family. (Documentation drift — header comment update is part of ORCH-0882 scope.)

---

## 4. Findings (classified)

### R-1 🔴 ROOT CAUSE — `InstallmentScheduleDisplay` has zero call sites in any buyer or planner render target

| Field | Evidence |
|-------|----------|
| **File + line** | `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx` (component, fully built); zero importers across `mingla-business/app/**` and `mingla-business/src/**` |
| **Exact code** | `export const InstallmentScheduleDisplay: React.FC<InstallmentScheduleDisplayProps>` at line 78–152 |
| **What it does** | Nothing — orphan export |
| **What it should do** | Render on 4 buyer touchpoints (public trip page via TripCheckoutFlow, checkout-trip index/buyer/payment) + pre-Stripe banner on payment.tsx + 2 planner touchpoints (EditPublishedTripScreen Pricing accordion preview, trip dashboard Money tab header), per operator decisions D1 + D2 locked at INTAKE 2026-05-19 |
| **Causal chain** | Component built ORCH-0873 → ORCH-0873 deferred SC-5a/5b/5c/6 (operator-pre-accepted at TEST dispatch) → ORCH-0876 V2 forked trip checkout to new route family without carrying the deferred wiring → ORCH-0880 Phase 4 added a new intake.tsx step → no follow-up ORCH wired the disclosure → buyer of any plan-active trip sees full-price UI, Stripe shows deposit, mismatch creates surprise |
| **Verification step** | `grep -rn "InstallmentScheduleDisplay" mingla-business/app mingla-business/src | grep -v __tests__ | grep -v "InstallmentScheduleDisplay.tsx"` returns zero lines (verified) |

### C-1 🟠 CONTRIBUTING — ORCH-0873 close-row deferral rationale obsolete

The ORCH-0873 WORLD_MAP close-row deferred SC-5a/5b/5c/6 with this reason: "blocked on extending `ticketCheckoutService`/`tripCheckoutService` response-shape mappers to surface `installmentSchedule` from Stage 1b RPC response. Estimated ~1 hour follow-up implementor pass."

The reasoning assumed the schedule had to flow through the checkout SESSION response. The trip-data path was overlooked: `usePublicTripById` already exposes `trip.pricingTiers[i].installmentSchedule` as a typed signal on every public-trip consumer. The Implementor can read the schedule template off the trip without touching the checkout-session response shape. The "1 hour blocker" therefore does not block ORCH-0882.

This finding is a contributing factor (not a root cause) because the deferral was rational given the SPEC's framing — the SPEC fed the schedule from `session.installmentSchedule` per §3.5.4. The trip-data path is an architectural simplification ORCH-0882 introduces.

### C-2 🟠 CONTRIBUTING — ORCH-0876 V2 mirror-and-substitute propagated the deferral structurally

`SPEC_ORCH-0876_V2_FULL_PARITY.md` §8.3 specifies: "Mirror `app/checkout/[eventId]/index.tsx` end-to-end with these substitutions." Since the source files never had `InstallmentScheduleDisplay` wired (the deferred work), the mirror inherited the absence. No SPEC §8 sub-section mentioned the InstallmentScheduleDisplay because the mirror was scoped to literal-line substitution.

### H-1 🟡 HIDDEN FLAW — Pay-button CTA on `payment.tsx:496` shows full price not deposit when plan-active

```tsx
<Button
  label={`Pay ${formatCurrency(totals.total, totals.currency)}`}
```

`totals.total` is the cart subtotal (full trip price). When `trip.pricingTiers[i].installmentSchedule !== null`, Stripe will charge only the deposit, but the local CTA tells the buyer they're about to pay the full amount. Buyer taps "Pay $1,000"; Stripe says "$200 due now." Constitution #3 silent failure once a plan-active trip exists.

ORCH-0873 SPEC §3.5.4 Q1 resolution mandated CTA copy `Pay ${depositFormatted} deposit` when `installmentSchedule !== null`. This was part of the deferred SC-5c. ORCH-0882 inherits this requirement.

### H-2 🟡 HIDDEN FLAW — Pre-purchase render is a PROJECTION, not an anchored schedule

The `InstallmentScheduleDisplay` component expects `dueAt: string` (ISO 8601 UTC) absolute timestamps. The schedule template stored in `trip_pricing_tiers.tier_metadata.installments` has only relative offsets:

```jsonc
{ "deposit_pct": 25, "installments": [
  { "ordinal": 1, "pct": 50, "days_after_booking": 30 },
  { "ordinal": 2, "pct": 25, "days_after_booking": 60 }
] }
```

For pre-purchase render (public trip page, qty picker, buyer details, payment screen, pre-Stripe banner), the buyer has NOT booked yet — there is no booking anchor. Dates must be **projected** from `now()`: "if you book today, dates will be Jun 10, Jul 10, Aug 10."

This requires a new mapper utility `installmentScheduleProjection.ts` that takes `(tier: TripPricingTier, anchorDate: Date) => InstallmentScheduleDisplaySchedule | null`. The mapper:
- Returns null if `tier.installmentSchedule === null`
- Computes `depositCents = Math.round(tier.priceCents * tier.installmentSchedule.deposit_pct / 100)`
- For each installment, computes `amountCents = Math.round(tier.priceCents * inst.pct / 100)` and `dueAt = inst.fixed_date ? inst.fixed_date + 'T00:00:00Z' : addDays(anchorDate, inst.days_after_booking).toISOString()`
- Returns `{ fullPriceCents: tier.priceCents, depositCents, currency: tier.currency, installments: [...] }`

Constitution #9 (no fabricated data) requires honest projection — Implementor pass MUST add a `isProjection?: boolean` prop to `InstallmentScheduleDisplay` and append "(projected from today)" or similar to the copy when `isProjection === true`. The dashboard / Money-tab planner-variant rendering uses `isProjection={true}` because there is no buyer anchor; the per-buyer Money tab row already has actual order anchors and uses the existing per-order installment query (out of ORCH-0882 scope).

### H-3 🟡 HIDDEN FLAW — Planner edit-published refresh loop

`EditPublishedTripScreen.tsx:189-224` constructs the initial pricing state from `trip.pricingTiers[0].installmentSchedule`. `handlePricingChange` mutates local Zustand-backed state. When the planner edits the plan in `PaymentPlanEditor`, the planner-variant preview render below MUST reflect the CURRENT EDIT BUFFER (not the persisted trip value) so the planner sees what they're about to save before saving.

After Save fires `biz_update_live_trip` RPC (ORCH-0876 V2), React Query invalidation must hit `usePublicTripById` so any in-progress buyer's cached schedule view refetches. The existing ORCH-0876 V2 invalidation in `EditPublishedTripScreen` Save handler likely already covers `usePublicTripById` via the `["public-trip", tripId]` key family — implementor verifies.

### H-4 🟡 HIDDEN FLAW (out of ORCH-0882 scope; flagged for follow-up) — Ticket confirmation email may not show schedule for deposit-paid orders

`supabase/functions/_shared/email/buyerLifecycleAdapters.ts` already has `InstallmentBreakdownRow` typed and renders breakdown lines on cancel emails. The **ticket-purchase confirmation email** for an initial deposit payment (kind `ticket_paid` / similar) was not verified — if it doesn't include the future schedule, that is a separate Constitution #3 silent-failure gap on the email surface.

**Out of ORCH-0882 scope per operator INTAKE decision** (operator scoped to in-product disclosure surfaces). Register follow-up ORCH if confirmed missing.

### O-1 🔵 OBSERVATION — ORCH-0880 Phase 4 in-flight coordination

`git status` shows `app/checkout-trip/[tripEventId]/intake.tsx` as untracked (new, 722 lines), and `buyer.tsx` + `payment.tsx` as modified. `IMPLEMENTATION_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md` lists Phase 4 as "Pending" but the work is clearly in progress in the local Seth tree.

If ORCH-0882 dispatches its implementor pass before ORCH-0880 Phase 4 commits, merge conflicts on `buyer.tsx` and `payment.tsx` are guaranteed. SPEC §11 recommends ORCH-0882 wait for ORCH-0880 close.

Once ORCH-0880 closes, `intake.tsx` becomes the 5th buyer touchpoint — ORCH-0882 must wire `<InstallmentScheduleDisplay variant="buyer">` there too when the trip has a payment plan (the intake step itself is unrelated to payment plans, but it's part of the buyer's pre-Stripe journey).

### O-2 🔵 OBSERVATION — Component header comment cites stale wiring targets

`InstallmentScheduleDisplay.tsx:5-9` lists targets `app/checkout/[eventId]/{index,buyer,payment}.tsx` + `TripCheckoutFlow.tsx`. The event-side `app/checkout/[eventId]/*` routes have been event-only since ORCH-0876 V2; they no longer serve trips. The header comment should be updated to the canonical ORCH-0882 wiring sites in the SPEC's implementor checklist.

### O-3 🔵 OBSERVATION — Multi-tier rendering decision

Today every trip has exactly one tier (ORCH-0859 [Tr2 Minimum Viable Trip] single-tier model: `trip.pricingTiers[0]`). The Implementor pass should code-defensively for the future multi-tier world: render one schedule per tier-in-cart-with-plan on the qty picker, but a single aggregate schedule on payment.tsx for the "first plan-active tier" in the cart (or stack them when cart has 2+ plan-active tiers, which is rare). SPEC §3 Q10 resolution: per-tier render on `index.tsx` (qty picker, below each `QuantityRow` when that tier has a schedule + qty ≥ 1), single aggregate on `buyer.tsx` + `payment.tsx` for the dominant plan tier.

---

## 5. Blast Radius Map

| File / surface | Impact | Action |
|----------------|--------|--------|
| Buyer-anon-web public trip page (`app/t/[brandSlug]/[tripSlug].tsx`) | Buyer first sees trip; needs disclosure pre-Reserve | Render inside `TripCheckoutFlow.tsx` reserve panel (Q1 resolution: inside TripCheckoutFlow, scrolls with CTA) |
| Buyer-anon-web qty picker (`app/checkout-trip/[tripEventId]/index.tsx`) | Tier selection screen | Render per-tier under each QuantityRow when tier.installmentSchedule !== null |
| Buyer-anon-web intake (`app/checkout-trip/[tripEventId]/intake.tsx`) — IF ORCH-0880 closes first | New ORCH-0880 step | Render above intake form when trip has plan |
| Buyer-anon-web buyer details (`app/checkout-trip/[tripEventId]/buyer.tsx`) | Buyer info collection | Render above the existing order summary block |
| Buyer-anon-web payment (`app/checkout-trip/[tripEventId]/payment.tsx`) | Final pre-Stripe screen | Render in ScrollView between Order Summary card and Payment card + pre-Stripe banner above Pay button + CTA copy `Pay $X deposit` when plan-active |
| Business-iOS / -Android planner Pricing edit (`src/components/trip/EditPublishedTripScreen.tsx`) | Planner edits plan | Render `variant="planner"` preview below PaymentPlanEditor; reflects edit buffer not persisted state |
| Business-iOS / -Android planner dashboard Money tab (`app/trip/[id]/index.tsx`) | Planner views buyer ledger | Render `variant="planner"` schedule template header above MoneyTabBody filter chip row |
| Mapper utility (`src/utils/installmentScheduleProjection.ts`) — NEW | Translates DB shape → component shape with anchor-date projection | New file |
| Component (`src/components/trip/InstallmentScheduleDisplay.tsx`) | Add `isProjection?: boolean` prop + update header comment to canonical targets | Modified |
| Strict-grep CI gate — NEW | Enforces I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT | New file `.github/scripts/strict-grep/i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint.mjs` |
| Workflow registry | Register new gate | Modified `.github/workflows/strict-grep-mingla-business.yml` |
| Regression test (implementor) | Pin all 6 render targets import InstallmentScheduleDisplay | New `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring.test.ts` |
| Adversarial test (tester) | Different-angle attack on projection math, multi-tier carts, plan-changes-mid-checkout | Tester writes during TEST phase |

**Coordination conflicts:**
- ORCH-0880 Phase 4 (in flight): `buyer.tsx`, `payment.tsx`, `intake.tsx` overlap. RECOMMENDATION: wait for ORCH-0880 CLOSE.
- ORCH-0870 (gated behind ORCH-0864 close): app-wide icon replacement. No icons added by ORCH-0882 — no conflict.

**Surfaces NOT touched:**
- Consumer-iOS/Android (`app-mobile/`): no trips on consumer app today; ORCH-0882 leaves untouched.
- Admin-web (`mingla-admin/`): no admin trip-purchase or trip-edit; untouched.
- Email surfaces (`supabase/functions/*/email/*`): out of ORCH-0882 scope per operator INTAKE; H-4 registered as follow-up candidate.
- Database / migrations / edge functions: zero schema or backend change. Reads existing `tier_metadata.installments` + `TripPricingTier.installmentSchedule`.

---

## 6. Invariant Violations

**Existing invariant violations once a plan-active trip exists in production:**

- **Constitution #3 (no silent failures):** Pay button shows full price; Stripe charges deposit. Buyer is silently misled about the immediate charge amount. SEVERE if not addressed before first plan-active trip publishes.
- **Constitution #9 (no fabricated data):** Today, no rendering — so no fabrication. But once ORCH-0882 lands, the implementor MUST ensure projected dates are honestly labeled per H-2.
- **Constitution #13 (exclusion consistency):** the absence of disclosure varies by surface — Stripe shows deposit, app shows full. ORCH-0882 unifies the disclosure across every buyer touchpoint.

**ORCH-0873 SPEC §SC unfulfilled:** SC-5a, SC-5b, SC-5c, SC-6 deferred and unaddressed. ORCH-0882 closes those four SCs + adds 4 more (public trip page + 2 planner surfaces + pre-Stripe banner).

---

## 7. Fix Strategy (direction only, NOT spec)

The fix is purely structural:
1. **Build a mapper utility** (`installmentScheduleProjection.ts`) that translates `TripPricingTier` × anchorDate → `InstallmentScheduleDisplaySchedule`, with explicit projection labeling for pre-purchase contexts.
2. **Wire the component on 7 render sites** (5 buyer-side once ORCH-0880 closes + 2 planner-side).
3. **Update the Pay-button CTA copy** on `payment.tsx` to `Pay $X deposit` when plan-active (inherited from ORCH-0873 Q1 deferred resolution).
4. **Add the pre-Stripe banner** above the Pay button on `payment.tsx` as a final "no surprise" reminder.
5. **Add a strict-grep CI gate** enforcing every buyer-route file references both `installmentSchedule` and imports `InstallmentScheduleDisplay`, preventing regression where a future ORCH adds a buyer route and forgets the disclosure.
6. **Update the component header comment** to reflect canonical ORCH-0882 wiring targets and supersede the stale ORCH-0873 list.

No DB changes. No edge function changes. No native module additions. EAS OTA-eligible.

---

## 8. Regression Prevention Requirements

- **Strict-grep CI gate** `i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint` MUST list the 4 (or 5 post-ORCH-0880) buyer-route file paths explicitly and assert each contains both `installmentSchedule` (data signal reference) AND `InstallmentScheduleDisplay` (component import). Append-only test contract per ORCH-0840 [Regression-test enforcement + append-only CI].
- **Regression test (implementor):** structural-grep assertion that the 6 render targets import `InstallmentScheduleDisplay`; happy-path projection-math test for the mapper utility. Fails-on-revert proof required.
- **Adversarial test (tester):** different-angle attacks — projection date math edge cases (DST cross, year boundary, leap-year, `days_after_booking: 0`), multi-tier carts (plan + no-plan mix), planner edit-published refresh-loop verification, no-fabrication contract enforcement.
- **Component-level dev-mode `__DEV__` warn** if `schedule.installments.length === 0` but `schedule !== null` (malformed input).
- **TypeScript prop-shape contract** preserves `variant: "buyer" | "planner"` discriminated union — Implementor MUST NOT widen to `string`.

---

## 9. Discoveries for Orchestrator

- **DISC-0882-1:** Confirm ticket-purchase confirmation email shows the future installment schedule for deposit-paid orders. Out of ORCH-0882 scope; register follow-up ORCH if missing (probable miss given ORCH-0869 backend close-row enumerated paid-in-full + dunning email renderers but not deposit-paid initial confirmation).
- **DISC-0882-2:** ORCH-0873 deferred SC-5a/5b/5c/6 with a service-layer blocker rationale that turns out to be irrelevant because the trip-data path bypasses the checkout-session response. Process improvement for orchestrator REVIEW phase: when implementor cites a service-layer blocker, REVIEW should verify the blocker holds across BOTH the session-response path AND the trip-data path before accepting deferral.
- **DISC-0882-3:** ORCH-0876 V2 mirror-and-substitute pattern silently inherits any deferred SCs from the source files. Future mirrors should explicitly enumerate inherited deferred SCs in §Cross-Surface Impact so the next ORCH knows what to fix when forking.
- **DISC-0882-4:** Trip discovery card "Payment plan available" badge deferred per operator decision D3 — revisit post-C1 [Consumer Discover Trips Tab] which is still unbuilt. No tracking ORCH today; orchestrator should add to Priority Board as a watch-item.
- **DISC-0882-5:** Multi-tier trip support (when `trip.pricingTiers.length > 1`) is not exercised in production today (ORCH-0859 single-tier model), but ORCH-0880 [Tr5 Traveler Intake Forms] introduced per-tier intake schemas — opening the door for true multi-tier trips. ORCH-0882 SPEC §3 Q10 codes defensively for this.
- **DISC-0882-6:** Implementor should consider whether `EditPublishedTripScreen` Pricing accordion's PaymentPlanEditor and the new `variant="planner"` preview should sit in the SAME GlassCard or as siblings. Layout decision passed to implementor's pre-flight `/ui-ux-pro-max` invoke per `feedback_implementor_uses_ui_ux_pro_max.md`.

---

## 10. Confidence

**proven** — structural investigation; five-layer cross-check complete; grep evidence definitive; no UI/runtime behavior reproduction required because the bug is a missing-feature absence, not a behavior bug. The Prime Directive #7 live-fire requirement applies to UI/runtime reproducer-bound bugs; this is a code-audit-only investigation per dispatch scope. Recommendation to operator: optional <60s live-fire promotion path is `cd mingla-business && npm run dev && open http://localhost:8082/t/<any-brand-slug>/<any-trip-slug>` to confirm the public trip page renders no schedule disclosure — confirms code finding visually. Not required for `proven` here because grep is the truth layer for "this import does not exist."

---

## 11. Next Step

Spec at `Mingla_Artifacts/specs/SPEC_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER.md` (this single session). Q1-Q11 from the dispatch resolve as follows (full reasoning per question in SPEC §3):

| Q | Resolution |
|---|------------|
| Q1 (public-page render site) | Inside `TripCheckoutFlow.tsx` — scrolls with CTA, sees price-tier context |
| Q2 (pre-Stripe banner copy) | "You'll be charged **${depositFormatted}** today. The remaining **${remainingFormatted}** auto-charges on ${dateList}, from the same card." |
| Q3 (schedule signal per render) | `trip.pricingTiers[i].installmentSchedule` (via `usePublicTripById`); multi-tier per-line on qty picker, dominant-tier on buyer/payment |
| Q4 (empty-state collapse) | Component already returns null; no parent layout changes required |
| Q5 (variant copy split) | Buyer-variant uses `installmentReassuranceText`; planner-variant emits no reassurance (current behavior preserved) |
| Q6 (responsive layout) | Component is row-based with `flex: 1` on labels — already responsive; smoke-test on 320px Web + iPhone SE |
| Q7 (loading state) | Hide-until-loaded (`schedule === null` returns null) — host route shows its own loading state |
| Q8 (planner edit-published refresh) | Preview reads from edit-buffer; Save invokes existing `biz_update_live_trip` invalidation; verify `["public-trip", tripId]` key invalidation exists |
| Q9 (SSR/SSG) | Expo Router on Web is CSR; no SSR concerns |
| Q10 (multi-tier visual) | Per-tier on qty picker; dominant-tier on payment screen + pre-Stripe banner aggregates |
| Q11 (ORCH-0880 coordination) | WAIT for ORCH-0880 Phase 4 CLOSE; ORCH-0882 implementor dispatches after Phase 4 closes |

Forensics SPEC fully locks all 11 with per-route success criteria, mapper utility contract, CI gate spec, regression test paths, and implementor pre-flight design invoke trigger.

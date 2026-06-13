# SPEC — ORCH-1130 [public trip page payment-structure + installments UX redesign]

**Phase:** SPEC (binding build contract). No product-code edits this phase.
**Skill:** mingla-forensics (SPEC side), design embedded from `DESIGN_ORCH-1130_PUBLIC_TRIP_PAYMENT_UX.md`.
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1130-[trip-pay-structure]/` on `ORCH-1130-trip-pay-structure` (rebased on origin/main).
**Evidence base:** `INVESTIGATE_ORCH-1130_PUBLIC_TRIP_PAYMENT_UX.md` (F-1…F-6 proven source + live-data).
**Direction:** DIRECTION 2 (Seth-confirmed) + DISC-1130-A consent fix. Scope frozen here; do not widen.

> ## RESOLVED FORKS (Seth, 2026-06-12 — BINDING, override any conflicting design-doc default)
> **Fork 1 — Selector pattern = SEGMENTED TOGGLE** (NOT the two-card radiogroup the design doc recommended). Build a prominent two-segment control ("Pay in full" | "Pay over time"). CRITICAL execution note so it does not read as a minor setting: render the price + terms copy (deposit/full amounts, "charged today / nothing scheduled later", and — for the plan segment — the `InstallmentScheduleDisplay` ladder) in a full-width block BELOW the toggle, not cramped inside the segments. The toggle is the control; the supporting copy block sells the decision. Preserve the existing `radiogroup`/`radio` a11y semantics (a segmented control is still an accessible single-select group). Apply on BOTH Path A and Path B for parity.
> **Fork 2 — Placement = PUBLIC PAGE + re-editable at REVIEW.** The choice is visible on the public trip page (Path A) / consumer trip detail (Path B) at consideration time, persists into checkout, AND is re-editable on the final "Review & pay" step. Not public-page-only; not first-step-only.

Comms ledger read on entry. COMMS-0029/0030 (active WARN) scope `biz_update_live_trip` (authoring RPC) — **zero overlap** with this ORCH's `ticket-checkout-create` + `biz_ticket_checkout_create_session` (checkout RPC) + buyer surfaces. No ack required.

---

## 0. Goal (binding)

Two independent surfaces, one shared semantic:

- **Path A** (business-web + business iOS/Android): public trip page `/t/[…]` → collapsed **2-step** funnel `/checkout-trip/*`. Pay-full vs pay-over-time becomes a **first-class choice at consideration time** (on the public page), persists into checkout, schedule revealed only for the selected option, hero no longer repeated.
- **Path B** (consumer app-mobile): `ConsumerTripDetailScreen` gains a payment-choice module before Reserve; `nativeCheckoutFlow` sends an explicit `payment_plan_choice` (fixing the silent-`'auto'` deposit-only consent bug, DISC-1130-A).

Pay-in-full is ALWAYS allowed (RPC `<> 'full'` bypass). No mandatory deposit. Single-tier reality (45/45) — collapse the tier step. Currency-aware (EUR+GBP live) via existing `Intl.NumberFormat`. Reuse `InstallmentScheduleDisplay` (null-on-null). Preserve refund ladder + countdown/closed banner. Honor Android opaque-glass policy (via existing `GlassCard`). No dead taps — runtime/device proof required at TEST.

---

## 1. Shared contract change (the ONE backend-adjacent change)

### 1.1 `ticket-checkout-create` body key — already supported, consumer just needs to send it

**File:** `supabase/functions/ticket-checkout-create/index.ts`
- **No edge-fn change required.** The body already reads `body.payment_plan_choice` (line 246), validates it against `"full" | "installments"` (line 248–251, else HTTP 400 `payment_plan_choice_invalid`), and forwards `paymentPlanChoice` to `biz_ticket_checkout_create_session` `p_payment_plan_choice` (line 502). Default `"auto"` (line 245) is preserved for any caller that omits the key.
- **No RPC change required.** `biz_ticket_checkout_create_session` is unchanged: `'full'` bypasses the plan; `'installments'` builds the schedule + reduces total to deposit; the guard `NOT IN ('auto','full','installments')` stands. **DO NOT migrate the RPC.**

### 1.2 Consumer `nativeCheckoutFlow` MUST send the key

**File:** `app-mobile/src/payments/nativeCheckoutFlow.ts`
- Extend `NativeCheckoutInput` with `paymentPlanChoice?: "full" | "installments"`.
- In the `supabase.functions.invoke("ticket-checkout-create", { body: {...} })` call (line 176–201), add:
  ```
  ...(input.paymentPlanChoice ? { payment_plan_choice: input.paymentPlanChoice } : {}),
  ```
- **Contract invariant:** when the trip has a plan, the caller MUST pass an explicit `"full" | "installments"` (never omit → never `'auto'`). When the trip has no plan, omit the key (byte-identical request → unchanged path). This is the DISC-1130-A consent fix.

---

## 2. Path A — files to change

### 2.1 `CartContext` — carry the choice across navigation
**File:** `mingla-business/src/components/checkout/CartContext.tsx`
- Add state `paymentPlanChoice: "full" | "installments"` (default `"full"`) + setter `setPaymentPlanChoice`.
- Expose via `useCart()`. (Survives `/t/` → `/checkout-trip/buyer` → `/payment` because the cart provider wraps the checkout group.)
- Reset to `"full"` whenever the cart is cleared / a new trip's lines replace the old (mirror existing line-reset semantics).

### 2.2 New shared component `TripPaymentChoice`
**File (new):** `mingla-business/src/components/trip/TripPaymentChoice.tsx`
- Extract the two-card radiogroup + terms-copy block currently inlined in `payment.tsx:574–636` into a reusable component.
- **Props:** `{ schedule: InstallmentScheduleDisplaySchedule | null; fullPriceCents: number; currency: string; depositPct: number; value: "full" | "installments"; onChange: (v) => void; showScheduleWhenInstallments?: boolean }`.
- **Returns `null` when `schedule === null`** (no-plan trip → caller renders the quiet price recap instead). Null-on-null parity with `InstallmentScheduleDisplay`.
- Anatomy + tokens per DESIGN §2.2 (verbatim reuse of `payment.tsx` style values; titles bumped 14→15; add the trailing amount summary + radio dot; selected = border+fill+dot, 3 channels).
- Renders `<InstallmentScheduleDisplay variant="buyer" isProjection>` + `installmentReassuranceText(...)` under the over-time option when selected and `showScheduleWhenInstallments` (default true).
- `accessibilityRole="radiogroup"` + per-card `radio` + `selected` state (DESIGN §6).

### 2.3 `TripCheckoutFlow.tsx` — public-page rebuild
**File:** `mingla-business/src/components/trip/TripCheckoutFlow.tsx`
- **REMOVE** `brandByline` (`by {brand.name}`, line 98) + `tripTitle` (line 99) — hero dupe killed.
- **REMOVE** the standalone passive `InstallmentScheduleDisplay` projection block (116–124).
- Replace the tier card + projection with:
  - if `projectedSchedule === null` (no-plan): the **quiet price recap line** (tierName + price + "One secure payment…" helper) — DESIGN §2.1 wireframe 3.
  - else: `<TripPaymentChoice schedule={projectedSchedule} fullPriceCents={tier.priceCents} currency={tier.currency} depositPct={schedule.deposit_pct} value={paymentPlanChoice} onChange={setPaymentPlanChoice} />` driven by `useCart()`.
- Keep the `tier === undefined` error branch.
- The `brand` prop may become unused → keep the prop (callers still pass it) or drop it (SPEC permits either; prefer keeping the signature stable to avoid touching `[tripSlug].tsx` props).
- **Bookings-closed / free** states: module is suppressed by the parent route (see 2.4); `TripCheckoutFlow` itself renders the recap/selector only for bookable paid trips.

### 2.4 `[tripSlug].tsx` — floating bar price anchor + closed gating
**File:** `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`
- Floating bar `tripCta` price label (line 177–212): for a **plan trip with a price**, set the buy `price` to `{exactPrice} total` (no `From`) to disambiguate full-vs-deposit (DESIGN §1.4). Single-tier uses exact price + no `From`; retain `From` only if `>1` tier exists (none in prod).
- When `isClosed === true`, the rebuilt `TripCheckoutFlow` should NOT show the selector — pass through the existing closed banner; `TripCheckoutFlow` already only mounts the selector for bookable trips, so ensure the closed/`!bookable` precedence still hides it (no regression to the existing banner stack 235–263).
- No change to refund ladder / countdown / share / anon-route handling.

### 2.5 Funnel collapse — `buyer.tsx` (step 1 of 2)
**File:** `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx`
- `CheckoutHeader stepIndex={0} totalSteps={2}` (was `totalSteps={3}` → renders "1 OF 2").
- **REMOVE** the standalone plan-disclosure block (459–469) — the choice/schedule live on the public page + Review step now.
- Order-summary "Edit" affordance (`handleBack`) is unchanged (routes back). Validation, phone, marketing, free-path: unchanged.
- Continue still routes to `/payment` (or `/intake` when a schema exists — unchanged).

### 2.6 Tier-step collapse — `index.tsx`
**File:** `mingla-business/app/checkout-trip/[tripEventId]/index.tsx`
- **Single-tier auto-skip:** when the trip has exactly one bookable tier (the prod-universal case), this screen should NOT be the entry. The Reserve nav from `[tripSlug].tsx` (`tripCheckoutPath`) currently lands on `index.tsx`. Change: on mount, if `tickets.length === 1` and not free-gated, auto-add the sole tier (qty 1) to the cart and `router.replace('/checkout-trip/{id}/buyer')` — making "Your details" the visible first step. Keep all empty/closed/sold-out/past guards BEFORE the auto-skip (a sold-out single tier still shows the EmptyState, never auto-advances).
- If `tickets.length > 1` (contract fallback, no prod data): render the legacy tier-select exactly as today (`stepIndex` then reads as a 3rd implicit step; acceptable — no prod trip hits this).
- Remove the per-tier passive `InstallmentScheduleDisplay` (363–371) — schedule now lives behind the choice on the public page + Review.

### 2.7 Review & pay — `payment.tsx` (step 2 of 2)
**File:** `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx`
- `CheckoutHeader stepIndex={1} totalSteps={2}` ("2 OF 2").
- Replace the inline selector block (574–636) with `<TripPaymentChoice … value={paymentPlanChoice} onChange={setPaymentPlanChoice} />` reading `useCart()` (pre-filled from the public-page choice). Local `useState` for the choice is REMOVED in favor of the CartContext value.
- ADD a compact **qty stepper** on the order-summary card (`−`/`+`, 44×44, default 1) calling `setLineQuantity`. Schedule + totals recompute live (projection util already takes quantity).
- Keep: schedule card (640–648), pre-Stripe banners (700–748), Pay-button deposit/full label (756–787), tax preview, fire-and-forget confirm. The `...(isPlanActive ? { paymentPlanChoice } : {})` forwarding (305, 376) now reads the CartContext value — unchanged shape.

### 2.8 `confirm.tsx` — optional (LOW priority, in scope only if cheap)
**File:** `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx`
- OPTIONAL: when the order was a plan deposit, add a one-line "First payment of {deposit} received · {N} more scheduled" recap. If it requires reading data the screen doesn't already have, DEFER (DISC-1130-B territory). Do not block the ORCH on it.

---

## 3. Path B — files to change

### 3.1 `useConsumerTripDetail.ts` — surface the plan template
**File:** `app-mobile/src/hooks/useConsumerTripDetail.ts`
- `TripDetailTier` (72–80) gains `installmentSchedule: TripInstallmentScheduleData | null` (import the type from the shared trips service / mirror it locally — it is `{ deposit_pct: number; installments: {pct,ordinal,days_after_booking|fixed_date}[] }`).
- The `tiersResp` query (line 235, `.from("trip_pricing_tiers")`) already returns the row; ensure `tier_metadata` is in the `select(...)` column list. In the tier mapper (263–289), extract `tier_metadata.installments` with the SAME shape-guard the business `extractInstallmentSchedule` uses (null on missing/malformed). Anon-readable (no `.from('brands')`; consistent with the screen's anon-read constraint).
- Add a derived `ConsumerTripDetail.hasPlan: boolean` (any tier has a non-null schedule) for cheap gating.

### 3.2 `ConsumerTripDetailScreen.tsx` — the choice module
**File:** `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx`
- Add state `const [paymentPlanChoice, setPaymentPlanChoice] = useState<"full"|"installments">("full")`.
- Compute the projected schedule from the sole/first plan tier via `projectInstallmentSchedule(tier, new Date())` (import the business util OR a shared copy — the projection logic is pure; SPEC permits importing from `mingla-business` shared utils if the monorepo path resolves, else mirror it minimally in app-mobile). Null when no plan.
- Render the **"HOW YOU PAY" module** in `detailBody`, immediately after the Pricing `section` (after line 603), ONLY when the schedule is non-null AND `!closed` AND `detail.bookable !== false`. Consumer hex styling per DESIGN §4.2; selected = border+fill+dot (3 channels); `accessibilityRole="radiogroup"`.
- Under the over-time option (when selected) render the schedule ladder + reassurance (reuse a consumer-styled schedule render; DESIGN §4.2 — SPEC decides reuse-vs-mirror; the component MUST keep null-on-null).
- Add the **pre-Reserve disclosure line** (DESIGN §4.3 copy), `accessibilityRole`-text alert, under the module.
- Pass the choice into the reserve flow: thread `paymentPlanChoice` (and the `hasPlan` flag) into `<ExpandedBusinessEventSheet … paymentPlanChoice={hasPlan ? paymentPlanChoice : undefined} />`.

### 3.3 `ExpandedBusinessEventSheet.tsx` — forward the choice
**File:** `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`
- Add optional prop `paymentPlanChoice?: "full" | "installments"`.
- In `handleBuy`'s `runNativeCheckout({...})` call (327–354), forward:
  ```
  ...(paymentPlanChoice ? { paymentPlanChoice } : {}),
  ```
- No other behavior change. Non-trip callers (events/experiences) never pass the prop → byte-identical.

### 3.4 `nativeCheckoutFlow.ts` — already covered in §1.2.

---

## 4. State matrix (acceptance — every state must be built + provable)

| # | Surface | State | Expected |
|---|---|---|---|
| A1 | Public page | no-plan paid trip | quiet price recap, NO selector; bar `{price}`; Reserve omits plan key |
| A2 | Public page | plan trip, default | selector, "Pay in full" selected, terms line, NO schedule; bar `{price} total` |
| A3 | Public page | plan trip, over-time picked | selector over-time, schedule ladder + reassurance |
| A4 | Public page | bookings closed | NO selector; existing closed banner + non-tappable bar |
| A5 | Public page | free trip | NO selector; "Reserve my spot" free bar |
| A6 | Funnel | single-tier trip | tier step auto-skipped → lands on "1 OF 2 Your details" |
| A7 | Funnel | Review & pay | header "2 OF 2"; selector pre-filled from public choice; qty stepper present; Pay label = full/deposit per choice |
| A8 | Funnel | qty=2 plan trip | schedule + deposit + Pay label scale ×2 (projection util qty) |
| B1 | Consumer | no-plan trip | module not mounted; screen byte-identical to today |
| B2 | Consumer | plan trip default | module "Pay in full"; pre-Reserve "charges {full} today"; Reserve → `payment_plan_choice="full"` |
| B3 | Consumer | plan trip over-time | module over-time; schedule + disclosure "charges {deposit} today, rest auto-charges"; Reserve → `"installments"` |
| B4 | Consumer | bookings closed / unavailable | module HIDDEN; existing footer states intact |
| B5 | Consumer (edge fn) | plan trip | server receives EXPLICIT `full`/`installments`, NEVER `'auto'` |

---

## 5. Invariants (preserve) + DRAFT new ones

**Preserve (regression-fail if broken):**
- `InstallmentScheduleDisplay` null-on-null (non-plan layout unchanged).
- Anon-route `/t/` (no `useAuth` on public page) + `PUBLIC_BUYER_ROUTE_PREFIXES`.
- Trip-specific `/checkout-trip/{id}` routing (never `/checkout/{id}`) — `eventType.filter.audit.test.ts` stays green.
- Single-ticket lock (ORCH-1117) — no multi-tier affordance built.
- Currency-awareness (EUR+GBP via `Intl.NumberFormat`; never hardcode £/$/€).
- No dead taps (ORCH-1103) — every option card + qty stepper + Reserve fires at runtime (device proof at TEST).
- Android opaque-glass (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`) via existing `GlassCard`; no new translucent Android fills.
- Authoring `variant="planner"` sites untouched (COMMS-0029/0030 zone).

**DRAFT (stage, do not register until CLOSE):**
- `DRAFT-I-ORCH-1130-CONSUMER-EXPLICIT-PLAN-CHOICE` — the consumer native trip checkout MUST send an explicit `payment_plan_choice` (`full`|`installments`) for any plan trip; it MUST NEVER omit the key on a plan trip (which would resolve to server `'auto'` deposit-only). Grep gate: `nativeCheckoutFlow` body includes `payment_plan_choice` plumbing + `ExpandedBusinessEventSheet` forwards `paymentPlanChoice`.
- `DRAFT-I-ORCH-1130-CHOICE-AT-CONSIDERATION` — the pay-full/installments choice is presented on the public trip page / consumer detail (consideration time), not solely at the terminal payment step. Gate: `TripPaymentChoice` (or the consumer module) is rendered by `TripCheckoutFlow` + `ConsumerTripDetailScreen`.
- `DRAFT-I-ORCH-1130-FUNNEL-2-STEP` — the trip checkout funnel for single-tier trips is 2 steps; `CheckoutHeader` on buyer/payment reads `totalSteps={2}`.

---

## 6. Regression-test obligations

**Happy-path (must add/extend):**
1. `TripPaymentChoice` unit: null-on-null (no schedule → renders nothing); full-selected hides schedule; over-time-selected shows schedule + reassurance; currency formats EUR + GBP; a11y radiogroup roles + selected state.
2. `TripCheckoutFlow`: no hero dupe (no `by {brand}`/title text); no-plan trip = recap line; plan trip = selector.
3. Funnel routing: single-tier Reserve lands on "1 OF 2"; `CheckoutHeader` totals = 2; qty stepper changes total + schedule.
4. `nativeCheckoutFlow`: body includes `payment_plan_choice` when `paymentPlanChoice` passed; omits when absent (byte-identical snapshot for the no-plan request).
5. `ExpandedBusinessEventSheet`: forwards `paymentPlanChoice` to `runNativeCheckout`; events/experiences (no prop) unchanged.
6. `useConsumerTripDetail`: maps `tier_metadata.installments` → `installmentSchedule`; `hasPlan` derived; malformed metadata → null (no crash).
7. `eventType.filter.audit.test.ts` still green (trip routing intact).

**Adversarial (must add):**
1. **Consent regression guard:** a test proving a consumer plan-trip checkout sends `payment_plan_choice !== undefined` (fails if anyone reverts to the silent-`'auto'` path). This is the DISC-1130-A teeth.
2. **No-plan no-leak:** a no-plan trip's consumer request body is asserted to NOT contain `payment_plan_choice` (so the edge-fn default path is provably untouched).
3. **Closed/unavailable suppression:** selector/module is NOT rendered when `bookings_closed` or `!bookable` (no choosing a payment for an unbuyable trip).
4. **qty=2 scaling:** deposit + schedule rows + Pay-button label all reflect ×2 (projection util quantity), not the per-unit list price.
5. **Currency non-hardcode grep:** no new `£`/`$`/`€` literal in the changed files (formatting must flow through `Intl.NumberFormat` / `formatCurrency`).
6. **Hero-dupe grep:** assert `TripCheckoutFlow` no longer references `brand.name` byline + `trip.title` heading.

**Device proof (TEST phase, not source-only):**
- Business-web anon: `https://business.usemingla.com/t/travelbrand/the-sone` — selector on public page, "Pay in full" default, switch to over-time reveals €125 + Jul 12 €250 + Aug 11 €125 ladder, Reserve → 2-step funnel, Pay-full label `Pay €500` vs over-time `Pay €125 deposit`.
- Consumer app-mobile: open the same trip; module under Pricing; pick over-time; on a sandbox card confirm the charge equals €125 (deposit) and picking full charges €500; confirm NO silent `'auto'` (server receives explicit choice). Stripe TEST mode (safe).
- Android: confirm option cards render opaque (no bleed-through), no square shadow halo, selected accent tint visible.

---

## 7. Funnel-collapse summary (3 → 2)

| | Today | After |
|---|---|---|
| Step 1 | Tier + qty (+passive plan projection) | **(removed for single-tier — auto-selected)** |
| Step 1' | — | **Your details** (`buyer.tsx`, "1 OF 2") |
| Step 2 | Buyer details (+passive plan projection) | folded into Step 1' |
| Step 3 | Payment + the ONLY choice (+2 plan surfaces) | **Review & pay** (`payment.tsx`, "2 OF 2"): qty stepper + selector (pre-filled) + schedule + Pay |
| Choice location | step 3 only | **public page (primary) + Review (editable)** |
| Intake step | conditional (schema present) | conditional (unchanged) |

Net: 3 visible steps → 2; the decision moves from terminal to consideration-time; the passive projection (shown ~4×) collapses to one selector-gated schedule per surface.

---

## 8. Recommended next phase

IMPLEMENT (mingla-implementor) — but ONLY after Seth resolves the §FORK in the DESIGN summary (selector pattern + choice-placement). Pass both this SPEC and the DESIGN doc as the binding contract; worktree + branch above; expected output = working code + implementation report + the regression suite in §6; downstream → mingla-tester for the device proofs in §6.

# INVESTIGATE — ORCH-1130 [public trip page payment-structure + installments UX redesign]

**Phase:** INVESTIGATE (read-only). No fix proposed.
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1130-[trip-pay-structure]/` on branch `ORCH-1130-trip-pay-structure` (rebased on origin/main).
**Date:** 2026-06-12
**Skill:** mingla-forensics
**Project ref:** `gqnoajqerqhnvulmnyvv` (Supabase MCP, read-only)

Seth's verbatim intent: *"the public trip page does not let users pay in full at once or use the installments. The way the installments is positioned is also weird and not very clear. Make the general structure of the public trip page better and more user-friendly."* Chosen fix = **DIRECTION 2** (surface pay-in-full AND installments as first-class + visible at consideration time; collapse the 3-step funnel toward 2; clean the pricing/IA so it stops repeating the hero). Scope = THREE surfaces: buyer/anon web, business iOS+Android, consumer app-mobile.

---

## Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK` directed at forensics or ORCH-1130. Active `WARN`s **COMMS-0029 / COMMS-0030** concern `biz_update_live_trip` (trip **authoring** RPC) for ORCH-1118/1119/1120/1122 — see §Concurrency (§7); **zero overlap** with the buyer-page files Direction 2 touches. No ack required (not directed at this ORCH/skill; FYI-grade for buyer work).

---

## Q-scorecard

- **Q1 — Does consumer app-mobile reuse the mingla-business `/checkout-trip` screens, or have its own flow?**
  **Verdict (CONFIRMED, source+data):** SEPARATE. The consumer app has its OWN trip detail + checkout path that NEVER touches `/checkout-trip/*`. Direction 2 is **TWO distinct redesigns**, not one. See F-1.

- **Q2 — Is "pay in full" ALWAYS allowed when an organizer configured an installment plan, or can a plan be mandatory (deposit-only)?**
  **Verdict (CONFIRMED, live-RPC-introspected):** Pay-in-full is **ALWAYS allowed**. The RPC gates installments behind `IF p_payment_plan_choice <> 'full'` — passing `'full'` unconditionally bypasses the plan and charges the full price. There is NO mandatory-deposit / deposit-only path anywhere (schema, RPC, or UI). See F-2.

- **Q3 — How does `payment_plan_choice='auto'` resolve?**
  **Verdict (CONFIRMED, live-RPC):** `'auto'` resolves to **installments** (it satisfies `<> 'full'`, so the schedule is built and total is reduced to the deposit). The consumer native path sends NO choice → defaults to `'auto'` server-side → would charge only the deposit silently if a plan exists. See F-2, F-6.

- **Q4 — Single-tier vs multi-tier reality (ORCH-1117 locked single-ticket)?**
  **Verdict (CONFIRMED, data):** 100% single-tier. 45/45 trips with any tier are single-tier; ZERO multi-tier trips exist in prod. The tier-select step is a near-no-op (always one tier, auto-selected). See F-3.

- **Q5 — Count of trips with installment plans + does a real testable trip exist?**
  **Verdict (CONFIRMED, data):** 4 trips have a plan configured; **3 are LIVE (`scheduled`)**. A real testable trip exists: `/t/travelbrand/the-sone`. See F-3.

- **Q6 — Full inventory of every buyer-facing installment surface?**
  **Verdict (CONFIRMED, source):** 7 buyer/planner render sites of `InstallmentScheduleDisplay` + the payment.tsx radio group + 3 post-purchase lifecycle emails. See F-4 + §Surface inventory.

- **Q7 — Concurrency overlap with COMMS-0029/0030 + ORCH-1118/1119/1120/1122?**
  **Verdict (CONFIRMED):** No live overlap. Those sessions edit `biz_update_live_trip` (authoring). ORCH-1119's already-MERGED commit touched `ConsumerTripDetailScreen.tsx` — that is the current baseline, not a live conflict. See §Concurrency.

---

## Findings (six-field evidence)

### F-1 — Consumer app-mobile uses a SEPARATE trip checkout path; `/checkout-trip/*` is business-web only
- **Symptom:** Seth's complaint targets "the public trip page". Two physically distinct trip surfaces exist; the redesign must hit both.
- **Layer:** Code.
- **Probe:** Read `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx`, `app-mobile/src/payments/nativeCheckoutFlow.ts`; `find app-mobile -type f | xargs grep -l checkout-trip` (empty).
- **Evidence:**
  - `ConsumerTripDetailScreen.tsx:658` — Reserve button: `onPress={() => setReserveSheetVisible(true)}` → opens `ExpandedBusinessEventSheet` (`:697-707`), the proven business-event cart → tax-preview → `runNativeCheckout` path. Header comment `:37-43`: *"Reserve opens the proven ExpandedBusinessEventSheet (tier select → cart → tax-preview address → runNativeCheckout)."*
  - `nativeCheckoutFlow.ts:173-203` — body sent to `ticket-checkout-create` has keys `eventId, surface, buyer, lines, intake_form_data?, taxCalculationId?, eventDateId?, idempotencyKey?` — **NO `payment_plan_choice`**. `grep -n "installment\|payment_plan" nativeCheckoutFlow.ts` → ZERO matches.
  - `grep -n "installment\|InstallmentSchedule" ExpandedBusinessEventSheet.tsx` → ZERO matches.
  - `find app-mobile … | xargs grep -l "checkout-trip"` → ZERO matches. The `/checkout-trip/[tripEventId]/*` chain lives ONLY under `mingla-business/app/`.
- **Mechanism:** The consumer trip detail (`ConsumerTripDetailScreen`) → `ExpandedBusinessEventSheet` → `runNativeCheckout` → `ticket-checkout-create` with NO plan choice → server default `'auto'`. The business-web public page (`/t/[brandSlug]/[tripSlug]`) → `FloatingOfferingBar` → `/checkout-trip/{id}` 3-step chain. They share only the edge function + RPC, not a single UI.
- **Severity:** CONFIRMED ROOT CAUSE (scope-defining).

### F-2 — Pay-in-full is ALWAYS available; the ONLY pay-full-vs-installments CHOICE lives at step 3 (payment.tsx); consumer path has NONE
- **Symptom:** "does not let users pay in full at once or use the installments" — on web the choice is buried at the last step; on consumer it does not exist at all.
- **Layer:** Code + Schema/Runtime (live RPC).
- **Probe:** `pg_get_functiondef('public.biz_ticket_checkout_create_session'::regproc)` (live prod); read `payment.tsx:146-149, 574-636`; `ticket-checkout-create/index.ts:245-253`.
- **Evidence:**
  - Live RPC body (verbatim): `IF p_payment_plan_choice <> 'full' THEN … v_deposit_cents := … ; v_total := v_deposit_cents::integer; END IF;` — installments are built for ANY value that is not literally `'full'`. Signature default: `p_payment_plan_choice text DEFAULT 'auto'::text`. Guard: `IF COALESCE(p_payment_plan_choice,'') NOT IN ('auto','full','installments') THEN RAISE EXCEPTION 'payment_plan_choice_invalid'`. **There is NO branch that forces a deposit / forbids full pay.**
  - `payment.tsx:147-148` — `const [paymentPlanChoice, setPaymentPlanChoice] = useState<PaymentPlanChoice>("full");` → default is FULL.
  - `payment.tsx:574-636` — the radio group (`accessibilityRole="radiogroup"`, "PAYMENT OPTION") with "Pay full … now" vs "Use payment plan" renders ONLY `if (isPlanActive && projectedSchedule !== null)` — i.e. only on step 3, and only when a plan exists.
  - `payment.tsx:305,376` — `...(isPlanActive ? { paymentPlanChoice } : {})` — choice forwarded only when a plan exists; otherwise the edge fn never receives it.
  - `ticket-checkout-create/index.ts:245-253` — defaults `paymentPlanChoice = "auto"`, validates only `full`/`installments` overrides.
- **Mechanism:** On business-web, the buyer cannot decide pay-full-vs-plan until AFTER name/email/phone (step 3 of 3), and the public page implies installments are the structure. On consumer, no choice is ever sent → server `'auto'` → if the trip has a plan, the buyer is silently put on the DEPOSIT-ONLY total with no full-pay option and no disclosure. Full pay is technically always allowed by the RPC — the UI just never surfaces it early (web) or at all (consumer).
- **Severity:** CONFIRMED ROOT CAUSE.

### F-3 — Data reality: 100% single-tier; 4 trips have plans (3 live); a real testable trip exists
- **Symptom:** Need to ground the redesign in actual trip shapes.
- **Layer:** Data.
- **Probe:** SQL on `events`, `trip_pricing_tiers`, `ticket_types`, `ticket_checkout_sessions` (read-only).
- **Evidence:**
  - `events WHERE event_type='trip'` → 48 total; **status: 45 `draft`, 3 `scheduled`** (none `published` — trips go live at `scheduled`/`live`, never `published`; the public RPC + checkout RPC gate on `status IN ('scheduled','live')`).
  - `trip_pricing_tiers` grouped by event: **45 trips with ≥1 tier; single_tier=45, multi_tier=0** (zero multi-tier in prod).
  - **4 trips have `tier_metadata->'installments'` configured; 3 are `scheduled` (LIVE).**
  - Real configured `installments` JSONB (from live trip `the-sone`, brand `travelbrand`, ticket €500 EUR):
    ```json
    {"deposit_pct":25,"installments":[
      {"pct":50,"ordinal":1,"days_after_booking":30},
      {"pct":25,"ordinal":2,"days_after_booking":60}]}
    ```
    (25% deposit today, 50% at +30d, 25% at +60d. All 3 live plan-trips share this exact shape.)
  - Live plan-trips: `/t/travelbrand/the-sone` (EUR 500), `/t/travelbrand/the-dc-adventure` (EUR 500), `/t/testtttt/untitled-trip` (GBP 20,000).
  - `ticket_checkout_sessions WHERE installment_schedule IS NOT NULL` → 42 rows (20 `paid_completed`) — installments are exercised in real data.
- **Mechanism:** The redesign can assume one tier (the tier-select step is a near-no-op per ORCH-1117 single-ticket lock) and must be currency-aware (EUR + GBP both present in live plan-trips).
- **Severity:** CONFIRMED (data baseline).

### F-4 — Buyer-facing installment surfaces are repeated on EVERY checkout step + the public page
- **Symptom:** "positioned … weird and not very clear" + hero repetition.
- **Layer:** Code.
- **Probe:** `grep -rln InstallmentScheduleDisplay --include=*.tsx`; per-step counts.
- **Evidence:** `InstallmentScheduleDisplay` (the SHARED component, `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx`, variants `"buyer"|"planner"|"cell"`, prop `isProjection?:boolean`, returns `null` on null schedule) is rendered as `variant="buyer"` projection at:
  - `TripCheckoutFlow.tsx:116-124` (public page) — **also repeats hero**: `:98` `by {brand.name}` + `:99` `{trip.title}` (already shown by `TripPreview` above it in `[tripSlug].tsx:225-229`).
  - `checkout-trip/[tripEventId]/index.tsx:365-368` (qty step), `intake.tsx`, `buyer.tsx`, `payment.tsx:642-647` (+ the radio group + pre-Stripe banner `:700-755`).
  - `EditPublishedTripScreen.tsx` + `trip/[id]/money/index.tsx` use `variant="planner"` (AUTHORING — out of buyer scope, do not touch).
- **Mechanism:** A passive projection card is shown ~4× across the funnel as a fait-accompli (no pay-full counterpart, no "optional" framing) until the actual choice appears at step 3. This is the "weird/unclear positioning" Seth describes.
- **Severity:** CONFIRMED ROOT CAUSE (IA).

### F-5 — Public page hero repetition + 3-step funnel structure
- **Symptom:** "Make the general structure better."
- **Layer:** Code.
- **Probe:** Read `[tripSlug].tsx`, `TripCheckoutFlow.tsx`, the 3 funnel steps.
- **Evidence:**
  - `[tripSlug].tsx:225-265` renders, in order: `TripPreview` (full hero) → closed/countdown banner → `RefundPolicyDisplay` → `TripCheckoutFlow`. `FloatingOfferingBar` (`:307-312`) is the ONLY Reserve CTA (inline CTA removed by ORCH-1117).
  - `TripCheckoutFlow.tsx:98-99` re-prints `by {brand}` + `{trip.title}` (hero dupe); `:101-111` a single auto-selected tier card; `:116-124` the projection; `:126-129` helper copy.
  - Funnel: `index.tsx` (tier+qty + projection) → `buyer.tsx` (name/email/phone + projection) → `payment.tsx` (the only real choice, step 3). `confirm.tsx` has NO installment content (grep ZERO).
- **Mechanism:** The public block duplicates the hero and front-loads a passive plan projection, then a 3-step funnel re-shows the projection twice more before the actual choice. Net effect: installments feel mandatory; pay-full is invisible until the end.
- **Severity:** CONFIRMED ROOT CAUSE (IA/structure).

### F-6 — Consumer path silently defaults to `'auto'` (deposit-only) for plan trips
- **Symptom:** Consumer reserving a plan-trip is put on the deposit total with no choice + no disclosure.
- **Layer:** Code + Runtime (would-require-device to observe the charge).
- **Probe:** `nativeCheckoutFlow.ts:176-201` body keys; RPC `'auto'` branch (F-2).
- **Evidence:** body omits `payment_plan_choice` → edge fn `paymentPlanChoice="auto"` (`index.ts:245`) → RPC `'auto' <> 'full'` TRUE → `v_total := v_deposit_cents`. The consumer detail screen has NO `InstallmentScheduleDisplay`, NO payment-option control, NO deposit disclosure (`ConsumerTripDetailScreen.tsx` greps clean for "installment").
- **Mechanism:** A consumer who books a plan-trip pays only the 25% deposit by default and never sees the schedule or a pay-full option pre-purchase. **Source-confirmed; the actual charged amount on device is WOULD-REQUIRE-DEVICE (see Runtime).**
- **Severity:** CONFIRMED ROOT CAUSE (consumer parity gap) — charge-amount runtime claim labelled SUSPECTED pending device.

---

## Five-Truth-Layer reconciliation

| Layer | What it says about the payment choice | Contradiction |
|-------|----------------------------------------|---------------|
| **Docs** | InstallmentScheduleDisplay header (`:1-29`) names 7 canonical wiring targets, all `variant="buyer"` projections "so buyers know the actual booking moment locks the schedule." Implies installments are a disclosure, not the only option. | Docs frame plan as disclosure; the public page (Code) makes it look like the default structure with no pay-full counterpart. |
| **Schema** | `trip_pricing_tiers.tier_metadata.installments` JSONB (deposit_pct + ordinal/pct/days array). `ticket_checkout_sessions.installment_schedule` JSONB. No NOT-NULL / mandatory-deposit constraint. | None — schema allows but never mandates a plan. |
| **Code** | Public page + steps 1-2 show a passive projection; the real choice (default `'full'`) is at step 3 payment.tsx only. Consumer path sends no choice. | **Public page implies installments-mandatory; checkout default is actually `'full'` (pay-full). Direct contradiction — the page's framing disagrees with what checkout does.** |
| **Runtime** | RPC `IF p_payment_plan_choice <> 'full'` (live introspected). `'auto'`→installments, `'full'`→full pay. | Consumer `'auto'` default contradicts a buyer who expects to pay in full. |
| **Data** | 45/45 single-tier; 4 plan-trips (3 live); 42 sessions w/ schedule (20 paid); plan shape = 25% deposit + 50%@30d + 25%@60d. | Multi-tier UI affordances would be dead code (zero multi-tier data). |

**Load-bearing contradiction (flagged, not fixed):** the public trip page **implies installments are the payment structure** (passive projection, no pay-full sibling, hero-dupe framing), while **checkout actually defaults to pay-in-full and always allows it**. Direction 2 must reconcile by surfacing BOTH choices at consideration time on BOTH surfaces.

---

## Surface inventory — every buyer-facing installment render site

**In Direction-2 scope (consideration-time + checkout decision):**
1. **Business-web public page** — `mingla-business/src/components/trip/TripCheckoutFlow.tsx:116-124` (`variant="buyer"`, projection) — also hero-dupe `:98-99`. Mounted by `mingla-business/app/t/[brandSlug]/[tripSlug].tsx:265`.
2. **Funnel step 1 (qty)** — `mingla-business/app/checkout-trip/[tripEventId]/index.tsx:365-368`.
3. **Funnel step intake** — `mingla-business/app/checkout-trip/[tripEventId]/intake.tsx` (installment refs ×7).
4. **Funnel step buyer-details** — `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` (installment refs ×5).
5. **Funnel step 3 payment** — `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` — the radio group `:574-636` (THE choice), in-scroll schedule `:640-647`, pre-Stripe banner `:700-755`, Pay-button copy `:758-790`. Default `paymentPlanChoice="full"` `:147-148`.
6. **Consumer app-mobile trip detail** — `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` — **currently NO installment surface at all** (gap). Reserve → `ExpandedBusinessEventSheet` → `nativeCheckoutFlow.ts` (no `payment_plan_choice`).
7. **Confirmation screen** — `checkout-trip/[tripEventId]/confirm.tsx` — **NO installment content** (grep ZERO). Candidate to add a "first payment of N" confirmation.

**Out of Direction-2 scope (authoring / post-purchase — DO NOT TOUCH):**
- `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` + `mingla-business/app/trip/[id]/money/index.tsx` — `variant="planner"` AUTHORING. (Also the COMMS-0029/0030 contention zone.)
- Post-purchase lifecycle emails — `supabase/functions/_shared/email/installmentReminderEmail.ts`, `installmentDunningEmail.ts`, `installmentPlanPaidInFullEmail.ts`, dispatched via `ticket-confirmation-dispatch/index.ts:46-49,575+` (routed by `body.kind` from `process-scheduled-installments` + `installmentWebhookHandlers.ts`). These fire AFTER a plan is chosen; not part of the consideration-time decision. **No initial order-confirmation email renders the schedule** (the buyer receipt email path does not include installment content) — noted for completeness; redesign need not touch it unless Seth wants a "deposit paid, N to go" receipt.

**Shared component contract (must honor):** `InstallmentScheduleDisplay` — props `{ schedule: {fullPriceCents, depositCents, currency, installments:[{ordinal,pct,amountCents,dueAt}]} | null; variant:"buyer"|"planner"|"cell"; isProjection?:boolean }`. Returns `null` on `schedule===null` (layout unchanged for non-plan trips). Currency-aware via `Intl.NumberFormat`. Projection copy lives in `mingla-business/src/copy/installmentReassurance.ts`. Schedule projected by `mingla-business/src/utils/installmentScheduleProjection.ts` (`projectInstallmentSchedule(tier, anchorDate, qty)`).

---

## Repro evidence / runtime note

**Source-confirmed** (read every line of the files cited): F-1, F-2, F-4, F-5, the surface inventory, the RPC choice logic.
**Data-confirmed** (live read-only SQL on prod `gqnoajqerqhnvulmnyvv`): F-2 (live `pg_get_functiondef`), F-3 (all counts + the real JSONB), the 42 sessions / 20 paid.
**Would-require-device** (NOT fabricated): the actual charged amount on the consumer path for a plan-trip (F-6), the visual "weird positioning" on each surface, and the 3-step tap flow. No sim/browser was driven in this environment; these are explicitly NOT claimed as runtime-proven.

### Device verification checklist (for mingla-tester, next phases)
A real live plan-trip already exists — no seeding needed:
- **Business-web (anon):** open `https://business.usemingla.com/t/travelbrand/the-sone` (EUR 500; 25% deposit + 50%@+30d + 25%@+60d). Expect: TripPreview hero → (no closed/countdown banner unless deadline set) → RefundPolicyDisplay (if set) → `TripCheckoutFlow` repeating "by Travel Brand" + "The Sone" + single tier card + passive projection + helper. Floating "Reserve my spot · From €500" bar is the only CTA → `/checkout-trip/{id}`. **Confirm:** no pay-full-vs-installments choice is visible until you reach payment.tsx (step 3, after name/email/phone). At step 3 confirm the radio group defaults to "Pay full €500 now".
- **Consumer app-mobile:** open the trip via the consumer deck or deep-link `app/t/travelbrand/the-sone`. Reserve → `ExpandedBusinessEventSheet` cart → tax-preview → Pay. **Confirm:** NO installment schedule and NO pay-full-vs-deposit choice appears anywhere pre-purchase; on a sandbox card, confirm the charged amount equals the 25% deposit (€125), i.e. `'auto'` silently selected installments. (Stripe TEST mode per memory — safe.)
- **Business iOS/Android:** same `/checkout-trip` chain inside the business app (same code paths as web step 1-3).

---

## Blast radius / cross-surface map

| Surface | In scope? | Why |
|---------|-----------|-----|
| Consumer iOS (`app-mobile`) | YES | `ConsumerTripDetailScreen` + `ExpandedBusinessEventSheet` + `nativeCheckoutFlow` — separate path, no choice today. |
| Consumer Android (`app-mobile`) | YES | Same RN code as iOS; Android glass opaque-fallback policy applies to any new cards. |
| Buyer/anon Web (`mingla-business` `/t/…` + `/checkout-trip/*`) | YES | Public page + 3-step funnel. |
| Business iOS | YES | Same `/checkout-trip/*` RN screens. |
| Business Android | YES | Same. |
| Admin Web | NO | No trip checkout surface. |
| Business Web preview | NO | Authoring preview, not buyer checkout. |

Shared backend (`ticket-checkout-create` + `biz_ticket_checkout_create_session` RPC) is touched by BOTH consumer and business surfaces; any change to the choice contract (e.g. consumer sending `payment_plan_choice`) is a shared-contract change — flag for the SPEC.

## Invariant impact (flagged, not pre-decided)
- **ORCH-1117 single-ticket lock** — trips are single-tier (data-confirmed 45/45). Any redesign must NOT reintroduce a multi-tier picker affordance.
- **Anon-tolerant public route** (`PUBLIC_BUYER_ROUTE_PREFIXES`, ORCH-1115) — `/t/` must stay logged-out-reachable; no `useAuth` on the public page.
- **Trip-specific checkout chain** (ORCH-0876) — trip Reserve must route to `/checkout-trip/{id}`, never `/checkout/{id}` (audit `eventType.filter.audit.test.ts`).
- **`InstallmentScheduleDisplay` returns-null-on-null contract** — non-plan trips must keep identical layout.
- **Currency-awareness** (Constitution #10) — EUR + GBP both live; never hardcode £/$.
- **No dead taps / runtime-proof** (ORCH-1103) — any new pay-full/installments control must actually fire on device.

## Discoveries for orchestrator
- **DISC-1130-A:** The consumer native checkout silently defaults plan-trips to the **deposit-only** total with no disclosure (F-6). This is arguably a money-integrity / consent issue independent of the UX redesign — a buyer pays 25% expecting (or not knowing about) a plan. Worth flagging to Seth as a potential P-bump even before the redesign.
- **DISC-1130-B:** No initial buyer order-confirmation email renders the installment schedule; only post-purchase reminder/dunning/paid-in-full emails do. If Seth wants WYSIWYP parity, a "deposit paid · N payments remaining" line on the confirmation could be a follow-on (out of current scope).
- **DISC-1130-C:** `trip_pricing_tiers` has no `price_cents` column (price lives on `ticket_types`); the projection reads the tier's linked ticket_type. Minor schema note for the implementor.

## Concurrency (§7)
- **COMMS-0029 / COMMS-0030 (active WARN):** ORCH-1118/1119/1120/1122 re-emit `biz_update_live_trip` (trip **AUTHORING** RPC). Direction 2 touches buyer pages + `ticket-checkout-create` + `biz_ticket_checkout_create_session` (checkout RPC) — **a different function**. **Zero overlap.**
- **ORCH-1119 (already MERGED, commit `276fbd900`)** touched `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` (+78 lines, per-day media gallery) and `useConsumerTripDetail.ts`. That is the current rebased baseline in this worktree, NOT a live conflict. The Direction-2 consumer redesign WILL edit `ConsumerTripDetailScreen.tsx` — coordinate only if another in-flight session re-opens it; none is currently registered against it.
- Authoring `variant="planner"` sites (`EditPublishedTripScreen.tsx`, `trip/[id]/money/index.tsx`) are the COMMS-0029/0030 contention zone and are **DO-NOT-TOUCH** for this ORCH.

---

## INPUTS THE DESIGNER + SPEC MUST HONOR
1. **TWO redesigns, not one.** Business-web/iOS/Android share the `/checkout-trip/*` chain + `TripCheckoutFlow` public block; consumer app-mobile is a SEPARATE path (`ConsumerTripDetailScreen` → `ExpandedBusinessEventSheet` → `nativeCheckoutFlow`). Both must surface pay-full + installments at consideration time.
2. **Pay-in-full is ALWAYS allowed** (RPC `<> 'full'` bypass). No mandatory-deposit mode exists. Both options are always first-class; default behavior must be deliberate (today: web defaults `'full'`, consumer defaults `'auto'`→deposit — inconsistent, must be reconciled).
3. **Consumer parity is a real gap, possibly a consent bug** (DISC-1130-A): consumer currently sends NO `payment_plan_choice`. The SPEC must decide whether the consumer sends an explicit choice (shared-contract change to `ticket-checkout-create`).
4. **Single-tier reality** (45/45). Do NOT build multi-tier affordances; the tier-select step is a near-no-op (ORCH-1117 lock).
5. **Currency-awareness** mandatory — live plan-trips are EUR and GBP. Use the existing `Intl.NumberFormat` path; never hardcode currency.
6. **Refund-policy ladder + booking-deadline countdown/closed banner already on the public page** (`RefundPolicyDisplay`, `[tripSlug].tsx:235-263`) and consumer (`ConsumerTripDetailScreen.tsx:423-442`) — the new pricing/IA must coexist with these blocks, not duplicate or displace them.
7. **Shared `InstallmentScheduleDisplay` contract** — props `{schedule|null, variant:"buyer"|"planner"|"cell", isProjection?}`, returns null on null schedule, currency-aware, projection copy in `installmentReassurance.ts`. Reuse it; don't fork it. `variant="planner"` sites are authoring — DO-NOT-TOUCH.
8. **Stop repeating the hero** — `TripCheckoutFlow.tsx:98-99` duplicates `TripPreview`'s title + brand byline. Clean the IA so the pricing block does not restate the hero.
9. **Collapse the 3-step funnel toward 2** — the real choice currently lives at step 3 (`payment.tsx`); single-tier means step 1's tier-select adds little. The redesign should move the pay-full-vs-installments decision earlier.
10. **Surfaces to cover (exhaustive):** public `TripCheckoutFlow`; `checkout-trip` steps index/intake/buyer/payment; consumer `ConsumerTripDetailScreen` (+ `ExpandedBusinessEventSheet`/`nativeCheckoutFlow` for the choice plumbing); optionally `confirm.tsx` for a "deposit paid" line. DO NOT touch authoring (`EditPublishedTripScreen`, `trip/[id]/money`) or the post-purchase lifecycle emails.
11. **Invariants to preserve:** anon-route `/t/`, trip-specific `/checkout-trip` routing, single-ticket lock, InstallmentScheduleDisplay null-contract, currency-awareness, no-dead-taps runtime proof.
12. **A real testable trip exists:** `/t/travelbrand/the-sone` (live, EUR 500, 25%+50%+25% plan) — the tester does not need to seed.

---

## Confidence
**Root cause PROVEN (source + live-data):** F-1, F-2, F-3, F-4, F-5. The consumer charged-amount on device (F-6) is **source-confirmed / runtime-SUSPECTED** (no device driven here — flagged for tester). The IA/UX "weird positioning" judgments are source-confirmed structurally; the visual feel is device-verifiable.

## Recommended next phase
**SPEC** (via mingla-designer for the pixel-precise design contract, embedded into the SPEC) — but the SPEC must explicitly resolve the consumer-path payment-choice plumbing (DISC-1130-A / input #3), which is a shared-contract change. Direction only; no fix proposed here.

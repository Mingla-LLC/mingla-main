# SPEC — ORCH-1138 [trip-page-redesign] · Reserve goes STRAIGHT TO CART (+ arrow-bleed fix)

- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign` (HEAD `9e220c58f`)
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1138_RESERVE_OPENS_SECOND_SHEET.md` (read it first — this SPEC honors its scope and addresses every finding F-1..F-4).
- **Mode:** SPEC (contract only; illustrative snippets ≤3 lines, never an implementation).

---

## 1. Executive summary

On the redesigned consumer trip detail (`ConsumerTripDetailScreen`), tapping **"Reserve my spot"** currently opens `ExpandedBusinessEventSheet` (EBES) — a SECOND, full event detail page — and only a second Buy tap inside it reaches the cart. This SPEC rewires the trip Reserve to open the **cart (`TicketCartSheet`) directly**, skipping the duplicate detail. EBES is shared by events + experiences in three other surfaces and is NOT deleted — only the **trip-only** EBES mount (and its now-dead adapter) is removed from the trip screen. In the same pass we fix the docked Reserve CTA whose `→` arrow bleeds out of the button when "Pay over time" is selected (F-4).

---

## 2. Scope & non-goals

**In scope (TRIP path only, `app-mobile`):**
- Rewire `ConsumerTripDetailScreen` Reserve → mount `TicketCartSheet` directly (seeded at the sole/first sellable tier), owning the cart + checkout hooks EBES currently owns.
- DELETE the trip-only redundant code: the `<ExpandedBusinessEventSheet>` mount in `ConsumerTripDetailScreen.tsx:1285-1311`, the `import { ExpandedBusinessEventSheet }` (`:111`), and the now-dead `tripToBusinessEventCard()` adapter (`:262-297`) + its `card` memo (`:364-365`).
- Fix F-4: constrain the docked Reserve CTA row so the label+arrow never overflow.

**Non-goals (do NOT touch):**
- `ExpandedBusinessEventSheet.tsx` — SHARED by events + experiences (F-2). Not modified, not deleted.
- `TicketCartSheet.tsx`, `nativeCheckoutFlow`, `ticket-checkout-create` edge fn — the checkout REQUEST stays byte-identical; only the mounting component changes. No backend/edge/SQL change.
- `ExpandedCardModal.tsx`, `MessageInterface.tsx` — the event/experience EBES mounts; untouched.
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` + `TripCheckoutFlow` — the WEB trip page; separate surface, untouched.
- Multi-tier UX redesign — out. The cart already supports multi-tier (its own per-tier rows); Reserve simply seeds it at the first sellable tier. 45/45 prod trips are single-tier (ORCH-1130), so this is a near-no-op today.

**Assumptions:** the trip detail payload already carries `detail.tiers[].ticketTypeId`, `detail.hasPlan`, `detail.currency`, `detail.hasFreeTier`, and the projected `planSchedule` (`useConsumerTripDetail.ts`; `ConsumerTripDetailScreen.tsx:418-433`). The cart fetches its own tickets/intake by `eventId === tripId` exactly as EBES does today.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files touched | Parity |
|---|---------|---------|----------------------|---------------|--------|
| 1 | Consumer iOS (`app-mobile`) | YES | Reserve → cart directly (no 2nd detail); arrow no longer bleeds | `ConsumerTripDetailScreen.tsx`, `ConsumerTripReserveBar.tsx` | — |
| 2 | Consumer Android (`app-mobile`) | YES | Same | same | Automatic (shared RN) |
| 3 | Buyer/anon Web (`mingla-business` `/t/...`) | NO | unchanged | none | Separate web trip page + `TripCheckoutFlow` |
| 4 | Business iOS | NO | unchanged | none | No business trip-detail change |
| 5 | Business Android | NO | unchanged | none | — |
| 6 | Admin Web | NO | unchanged | none | — |
| 7 | Business Web preview | NO | unchanged | none | — |
| — | Consumer EVENTS + EXPERIENCES (deck modal + chat) | MUST NOT REGRESS | still open EBES → PublicEventPage → cart | EBES untouched | F-2 guard |

---

## 4. Layered specification

Only the **Component** layer changes. No DB / edge / service / realtime change.

### 4.1 Component — `ConsumerTripDetailScreen.tsx`

The trip screen takes over the cart+checkout responsibilities EBES held, scoped to the trip.

**Add hooks (declared with the other top-level hooks, BEFORE the early returns — Rules of Hooks):**
- `usePublicEventTickets(detail !== null ? detail.tripId : null)` → `ticketsQuery` (the same hook EBES uses; `eventId === tripId`).
- `useTripIntakeSchemas(detail !== null ? detail.tripId : null)` → `intakeSchemasQuery`.
- `useNativeCheckoutFlow()` → `runNativeCheckout`.
- `useQueryClient()` if needed for the post-checkout invalidation EBES performs (mirror EBES `handleBuy`'s success-branch invalidations — calendar/circle keys — so a trip purchase still refreshes the same caches; see `ExpandedBusinessEventSheet.tsx:313-432`).
- Buyer prefill from `useAppStore`: `user`, `profile` (the screen may already read `accountPreferences`; add `user`/`profile` reads as EBES does at `:229-230`).

**New cart state:**
- `const [cartVisible, setCartVisible] = useState(false);`
- `const [initialTicketTypeId, setInitialTicketTypeId] = useState<string | null>(null);`
- `const [checkoutInFlight, setCheckoutInFlight] = useState(false);`

**Rewire Reserve onPress (replaces `setReserveSheetVisible(true)` at `:1131` and `:1145`):**
- `onPress={openCart}` where `openCart` selects the seed tier and opens the cart:
  - Seed = the first SELLABLE tier from `detail.tiers` (not free-hidden, capacity>0 or unlimited). Prefer `detail.tiers[0].ticketTypeId` for the single-tier case; for multi-tier pick the first sellable, mirroring EBES `handleFloatingBarPress` (`ExpandedBusinessEventSheet.tsx:496-508`).
  - `setInitialTicketTypeId(seedTicketTypeId); setCartVisible(true);`
  - Free trips: same path — `TicketCartSheet` already handles the free branch (its CTA becomes "Get free"), so no separate code path.
- DELETE `reserveSheetVisible` state (`:313`) — replaced by `cartVisible`.

**Replace the EBES sibling (`:1285-1311`) with a `TicketCartSheet` sibling** in the SAME `<>` fragment (preserve `feedback_rn_sub_sheet_must_render_inside_parent` — sibling BaseBottomSheet root). Props:
```
<TicketCartSheet
  visible={cartVisible}
  eventId={detail.tripId}
  tickets={ticketsQuery.data}
  intakeSchemasByTier={intakeSchemasQuery.data}
  fallbackCurrency={detail.currency}
  initialTicketTypeId={initialTicketTypeId}
  buyerName={…} buyerEmail={…} buyerPhone={…}   // same derivation as EBES handleBuy :320-323
  isSubmitting={checkoutInFlight}
  clearFloatingNav={false}
  dueTodayCents={detail.hasPlan && paymentPlanChoice === "installments" && planSchedule !== null ? planSchedule.depositCents : undefined}
  onCancel={() => { setCartVisible(false); setInitialTicketTypeId(null); }}
  onCheckout={handleCartCheckout}
/>
```

**`handleCartCheckout(payload: TicketCartCheckoutPayload)`** — port EBES `handleBuy` (`ExpandedBusinessEventSheet.tsx:313-432`) verbatim in behavior, scoped to the trip:
- Guard `checkoutInFlight`; guard `user === null` (toast "Please sign in…"); guard empty email/phone (same toasts).
- `setCartVisible(false)` first (mirror EBES `handleCartCheckout` at `:446-449`), then `runNativeCheckout({ eventId: detail.tripId, lines: payload.lines, buyer: {…, marketingOptIn: payload.marketingOptIn}, ...(payload.intakeFormData.length>0 ? {intakeFormData} : {}), ...(paymentPlanChoice && detail.hasPlan ? {paymentPlanChoice} : {}) })`.
  - **paymentPlanChoice:** pass `detail.hasPlan ? paymentPlanChoice : undefined` — IDENTICAL to the current EBES prop forwarding (`ConsumerTripDetailScreen.tsx:1294`). NEVER let a plan trip resolve to silent 'auto' (DISC-1130-A).
  - **NO `address`, NO `taxCalculationId`** — venue-sourced tax (ORCH-1025/1130). Byte-identical request.
- Toggle `checkoutInFlight` around the call; replicate EBES's success/failure toasts + cache invalidations exactly.

**The Reserve CTA copy/visuals (`reserveCta`, `barPriceLabel`, `barKicker` at `:1067-1100`) are UNCHANGED** — only the onPress target changes.

### 4.2 Component — `ConsumerTripReserveBar.tsx` (F-4 arrow-bleed)

Constrain the docked `reserve` row so the label+arrow can never overflow when the left price/kicker block is long ("From {deposit} today" + "Due today · deposit"):
- `rLeft` (`:372-374`): add `flexShrink: 1` and `minWidth: 0` so the price/kicker block yields space first.
- `rCta` (`:386-389`): add `flexShrink: 0` (the label+arrow keep their intrinsic width) AND wrap the price `<Text>` (`:165-167`) with `numberOfLines={1}` so a long price truncates rather than pushing the CTA off-screen.
- Keep `gap: 12` and `justifyContent: "space-between"`.
- Apply the same `flexShrink:0` discipline to the floating `floatCta` text (`:243-245`, style `:325-328`) defensively, though the floating pill has no price block.

Implementor note: do NOT change the strings, the accent color, or the kicker logic — this is a pure layout-overflow fix.

---

## 5. Success criteria

- **SC-1 (iOS+Android):** From a trip detail, tapping "Reserve my spot" opens the **cart** (`TicketCartSheet`, qty stepper + pay CTA) directly — NO intermediate event/detail page (no `PublicEventPage` cover/description renders between Reserve and cart).
- **SC-2:** On a single-tier trip, the cart opens pre-seeded at that tier at quantity 1.
- **SC-3:** On a plan trip with "Pay over time" selected, the cart's sticky bar leads with **"Due today"** = the deposit (the same `planSchedule.depositCents`), identical to today's behavior via the `dueTodayCents` prop.
- **SC-4:** Completing the cart checkout charges via `runNativeCheckout`/`ticket-checkout-create` with a request body byte-identical to the pre-rewire flow (same `paymentPlanChoice`, `intakeFormData`, no `address`/`taxCalculationId`); a successful purchase invalidates the same caches (calendar/circle) the EBES path did.
- **SC-5:** A free trip's Reserve opens the cart with the free ("Get free") branch — no payment sheet, ticket claimed.
- **SC-6:** Events and experiences (deck modal + chat) STILL open EBES → PublicEventPage → cart, unchanged (no regression). `ExpandedBusinessEventSheet.tsx` is unmodified.
- **SC-7 (F-4):** With "Pay over time" selected, the docked "Reserve my spot →" button renders the label AND the `→` fully inside the button bounds at all supported widths (the arrow never clips/bleeds out); the price truncates with ellipsis if space-constrained.
- **SC-8:** Cancelling the cart returns to the trip detail (not a blank screen); the trip detail is still the only detail surface in the stack.

---

## 6. Invariants

- **I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED** (ref `ExpandedBusinessEventSheet.tsx:540`): PRESERVED — `TicketCartSheet` remains the confirmation step; Reserve must NOT auto-charge. Verified by SC-1/SC-4 (cart shown before charge).
- **WYSIWYP / all-in / venue-sourced tax (ORCH-1025/1130):** PRESERVED — the checkout request is unchanged (SC-4). Verified by a request-shape assertion (test T-4).
- **feedback_rn_sub_sheet_must_render_inside_parent:** PRESERVED — `TicketCartSheet` is a sibling BaseBottomSheet root in the trip screen's `<>` fragment (same rule EBES followed).
- **DISC-1130-A (explicit pay choice for plan trips):** PRESERVED — `paymentPlanChoice` forwarded only for `detail.hasPlan`, never silent 'auto' (SC-3, test T-3).
- No NEW invariant proposed.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | Reserve opens cart, not EBES (happy) | tap Reserve on a single-tier paid trip | `TicketCartSheet` visible; `ExpandedBusinessEventSheet`/`PublicEventPage` NOT mounted | component (render assertion) |
| T-2 | EBES no longer imported by trip screen (structural) | grep `ConsumerTripDetailScreen.tsx` | no `ExpandedBusinessEventSheet` import or JSX; `tripToBusinessEventCard` removed | static / strict-grep gate |
| T-3 | Pay-over-time forwards choice + dueToday | installments selected, checkout | request carries `payment_plan_choice:"installments"`; cart bar shows deposit "Due today" | component + flow |
| T-4 | Checkout request byte-identical (no address/taxCalc) | pay-in-full checkout | `runNativeCheckout` called with no `address`/`taxCalculationId`; same lines/buyer shape as legacy EBES path | component (mock runNativeCheckout) |
| T-5 | Free trip path | free trip, tap Reserve → claim | cart free branch; no PaymentSheet | component |
| T-6 | Events/experiences unaffected (regression) | open an event from deck modal + an experience from chat | EBES still renders PublicEventPage → cart | component (existing EBES tests stay green) |
| T-7 | Arrow does not bleed (F-4) | docked CTA, installments price `From €4,500 today`, kicker `Due today · deposit` | label `Reserve my spot →` (incl. arrow) within button bounds; price truncates if needed | component layout / snapshot |
| T-8 | Cancel returns to detail | open cart, cancel | trip detail visible; no blank screen | component |

---

## 8. Implementation order

1. **`ConsumerTripReserveBar.tsx`** — F-4 layout fix (`rLeft`/`rCta` flexShrink + price `numberOfLines={1}`). Smallest, independent. Add test T-7.
2. **`ConsumerTripDetailScreen.tsx`** — add the cart+checkout hooks + state; add `openCart` + `handleCartCheckout` (port EBES `handleBuy` behavior); rewire both Reserve `onPress`; replace the EBES sibling with `TicketCartSheet`.
3. **`ConsumerTripDetailScreen.tsx`** — DELETE dead trip-only code: EBES import (`:111`), `tripToBusinessEventCard` (`:262-297`), `card` memo (`:364-365`), `reserveSheetVisible` state (`:313`).
4. Add/adjust tests T-1..T-8; run the ORCH-1130 consumer-payment-choice CI check (`app-mobile/scripts/ci/orch-1130-consumer-payment-choice-check.mjs`) — it asserts the trip screen threads the pay choice; keep it green.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard + gate:** add a strict-grep CI test (e.g. `orch-1138-trip-reserve-straight-to-cart`) asserting that `ConsumerTripDetailScreen.tsx` contains **no** reference to `ExpandedBusinessEventSheet` and **does** mount `TicketCartSheet`. This test FAILS if the EBES mount is restored (revert) and PASSES once the direct-cart wiring is in place (T-2).
- **Request-shape test (T-4):** mock `runNativeCheckout`, drive a checkout, assert the body has no `address`/`taxCalculationId` and carries the correct `paymentPlanChoice`. FAILS if a future change reintroduces an address step or drops the choice.
- **Protective comment:** at the `TicketCartSheet` mount in the trip screen, leave a comment: *"ORCH-1138: Reserve opens the cart DIRECTLY. Do NOT route trips through ExpandedBusinessEventSheet — that showed buyers a duplicate detail page (Seth, 2026-06-15). EBES stays for events/experiences only."*
- **Regression guard for events/experiences:** existing EBES test suites must stay green (T-6) — proves the shared sheet was not touched.

---

## 10. Open questions

- **OQ-1 (cache invalidation parity):** EBES `handleBuy` performs specific post-success cache invalidations (calendar/circle keys) and a polling loop (`ExpandedBusinessEventSheet.tsx` success branch; `useCalendarEntries.ts:60-172`). The implementor must port these EXACTLY for the trip path so a trip purchase refreshes the same surfaces. If any invalidation is EBES-event-specific and not trip-relevant, flag it rather than guessing. (Not a blocker — port verbatim, then trim only what is provably event-only.)
- **OQ-2 (multi-tier seed):** today all prod trips are single-tier, so "seed at first sellable tier" is unambiguous. If/when a multi-tier trip ships, confirm with Seth whether Reserve should open the cart at the first tier (current SPEC) or open a tier picker first. Documented, not blocking.

---

## 11. Downstream routing

- **Next = `mingla-implementor` (consumer/app-mobile side).** Inputs: this SPEC + `INVESTIGATION_ORCH-1138_RESERVE_OPENS_SECOND_SHEET.md`. Working tree: `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign`. Output: implementation report under `Mingla_Artifacts/reports/`.
- **Then `mingla-tester`** — live-fire SC-1..SC-8 on iOS sim + (Seth) physical device, with the events/experiences no-regression gate (SC-6/T-6).
- **Then orchestrator CLOSE** — World Map + ledger sync.

---

## Scoped allowlist (implementor MAY change ONLY these)
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx`
- `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx`
- New test files under `app-mobile/src/**/__tests__/` + a CI gate under `app-mobile/scripts/ci/`.

## DO-NOT-TOUCH (stop-and-amend before any change)
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (SHARED — F-2)
- `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` (consumed as-is)
- `app-mobile/src/components/ExpandedCardModal.tsx`, `app-mobile/src/components/MessageInterface.tsx`
- `app-mobile/src/payments/nativeCheckoutFlow.ts`, `supabase/functions/ticket-checkout-create/*`
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`, `mingla-business/src/components/trip/*`

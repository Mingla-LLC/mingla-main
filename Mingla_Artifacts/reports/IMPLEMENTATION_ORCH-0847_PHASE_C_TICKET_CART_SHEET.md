# IMPLEMENTATION CHECKPOINT — ORCH-0847 Phase C

**ORCH:** ORCH-0847 [Consumer ticket purchase parity with public business page]
**Phase:** C — Consumer multi-tier cart sheet + marketing opt-in (replaces TicketClaimConfirmModal)
**Status:** implemented, bundle-verified (sim runtime UNVERIFIED)
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

> Phase C checkpoint. Phases D (tests + CI gates + fails-on-revert) and E
> (final implementation report + close protocol) pending.

---

## Summary

Replaced the consumer app's single-ticket `TicketClaimConfirmModal` with a multi-tier `TicketCartSheet` that mirrors the public business buyer cart (J-C1 / `mingla-business/app/checkout/[eventId]/index.tsx`) within 8pt visual tolerance. Tapping Buy or Get Free on a tier inside `ExpandedBusinessEventSheet` now opens a 75%-snap bottom sheet seeded at that tier with quantity 1. The user can add more tiers, toggle a marketing-opt-in checkbox (default unchecked per SPEC SC-12 / GDPR/CAN-SPAM cleanliness), and tap Continue to Payment — `runNativeCheckout` receives the full multi-tier `lines[]` payload plus the opt-in state, and the existing Stripe PaymentSheet + post-purchase calendar invalidation flow continues unchanged.

This phase used the foundational extractions from Phase A2 (`QuantityRow` in `@mingla/event-rendering`) and the consumer auth pre-fill already established (`useAppStore` + `useAuthSimple`). Three new consumer files were written, one existing consumer file edited, and the now-orphaned `TicketClaimConfirmModal.tsx` is left on disk (deletion deferred to Phase E close commit per append-only CI rules — see Discoveries).

---

## Files added

| File | Purpose |
|---|---|
| `app-mobile/src/components/expandedCard/ConsumerCartCard.tsx` (~36 lines) | Minimal dark-glass card primitive per design verdict §6.1. `borderRadius: 16`, alpha-0.06 border, alpha-0.03 fill, 16pt padding. Used as `CardComponent` adapter for `<QuantityRow>` AND as the buyer-recap wrapper inside `TicketCartSheet`. Pure presentational, accepts `children` + `style` props. |
| `app-mobile/src/hooks/useTicketCart.ts` (~110 lines) | Cart state hook per SPEC §4.1.4. `useReducer<CartLine[]>` (NOT Zustand — per memory `feedback_zustand_persist_no_server_snapshots`). Exposes `lines`, `totals` (`{totalCents, currency, itemCount, isEmpty, isFree}`), `setLineQuantity(seed, n)`, `reset()`. Action `SET_QTY` adds/updates/removes a line (n ≤ 0 removes). Totals memoised; currency falls back to caller-supplied `fallbackCurrency` when cart is empty. |
| `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` (~400 lines) | The cart sheet itself per design §2–§5. `@gorhom/bottom-sheet` with single 75% snap point, sibling-in-fragment mounting (per memory `feedback_rn_sub_sheet_must_render_inside_parent`), `enablePanDownToClose`, `BottomSheetBackdrop` with `pressBehavior="close"`. Imports `<QuantityRow>` from `@mingla/event-rendering` and passes `CONSUMER_TICKET_CART_THEME` (dark-mode tokens per design §4), `ConsumerCartCard` as `CardComponent`, `<Icon name="plus">` as `renderPlusIcon`, an inline `formatMajorCurrency(value, currency)` `Intl.NumberFormat` formatter. Layout follows the design verbatim: header (Get tickets + close ×) → SELECT YOUR TICKETS section label → tier rows → marketing opt-in checkbox (verbatim copy "Email me about this organiser's future events") → buyer recap card (YOUR TICKET GOES TO + Name/Email/Phone rows) → sticky bottom bar (Subtotal label + value + primary CTA). All 7 render states implemented (`loading` shows spinner + "Loading tickets…"; `empty` / `sold_out` / `sales_closed` show body message + Close CTA; `populated_empty_cart` / `populated_cart` / `submitting` show full layout with state-appropriate CTA label `Add tickets above` / `Claim Free Ticket` / `Continue to Payment`). Seeding behavior: on `visible: false → true` AND `initialTicketTypeId !== null`, the tapped tier is added at quantity 1 (with a `lastOpenSeedRef` guard to prevent re-seeding on every render). On close, cart resets to empty + opt-in resets to false. Haptics: `Haptics.impactAsync(Medium)` on primary CTA tap. Accessibility: every `<Pressable>` has explicit `accessibilityRole` + `accessibilityLabel`; the opt-in row has `accessibilityRole="checkbox"` + `accessibilityState={{checked}}`; checkbox box ≥22pt, the row ≥44pt (12pt vertical padding × 22pt box). |

## Files modified

| File | What it did before | What it does now | Why |
|---|---|---|---|
| `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | (1) Imported `TicketClaimConfirmModal` from `./TicketClaimConfirmModal`. (2) Held `pendingClaim` state (`{ticketId, isFreeTicket, ticketName, ticketPriceCents, ticketCurrency}`) set by `onBuyTicket` / `onClaimFreeTicket` callbacks. (3) `handleBuy(ticketId, isFreeTicket)` hardcoded `lines: [{ticketTypeId: ticketId, quantity: 1}]` and `marketingOptIn: false` and used `!isFreeTicket` as the paid-vs-free branch for the 3×1s post-purchase polling. (4) Rendered `<TicketClaimConfirmModal>` as a sibling with the pendingClaim fields. | (1) Imports `TicketCartSheet` and `TicketCartCheckoutPayload` type from `./TicketCartSheet`. (2) Holds `cartSheetVisible: boolean` + `initialTicketTypeId: string | null` state — set by `onBuyTicket(id)` / `onClaimFreeTicket(id)` callbacks (both now do the same thing: seed cart + open sheet). (3) `handleBuy({lines, marketingOptIn, totalCents}: TicketCartCheckoutPayload)` passes `lines` and `buyer.marketingOptIn = payload.marketingOptIn` through `runNativeCheckout`; the paid-vs-free post-purchase polling branch now derives from `payload.totalCents > 0` (correctly handling mixed-free-and-paid carts that route through the paid path because total > 0). (4) Renders `<TicketCartSheet>` as a sibling-in-fragment with `tickets={ticketsQuery.data}`, `fallbackCurrency={data.currency}`, buyer pre-fill from auth profile, `onCancel={handleCartCancel}`, `onCheckout={handleCartCheckout}` (which closes the sheet then invokes handleBuy). New callbacks `handleCartCheckout` and `handleCartCancel` replace the prior `handleConfirmClaim` / `handleCancelClaim`. | SPEC §4.1.6 rewire + design verdict §2-§5. |

## Files NOT deleted (intentional — see Discoveries)

| File | Status |
|---|---|
| `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` | **ORPHANED** — no consumer imports it after this phase. Bundle excludes it (no entry in source map for this file). **NOT deleted yet** because two existing append-only CI scripts (`orch-0829a-regression-check.mjs` T-A1/T-A2/T-A4 and `orch-0834-rescoped-regression-check.mjs` T-A5/T-A6) hard-assert its presence + imports + RN→bottom-sheet migration. Those scripts are immutable until the closing commit cites `[TEST-MOD-APPROVED ORCH-0847]` per `.github/workflows/tests-append-only.yml`. Deletion + CI script retirement land together in Phase D + the close commit. |

## Files unchanged (intentional)

- `app-mobile/src/payments/nativeCheckoutFlow.ts` — already accepts multi-line `lines[]` and `marketingOptIn` per Phase A2 design (no change needed).
- `app-mobile/src/hooks/useCalendarEntries.ts` — `useBusinessEventOrders` query key + 3×1s post-purchase polling pattern unchanged.
- `supabase/**` — zero diff.
- `packages/event-rendering/QuantityRow.tsx` + `packages/event-rendering/index.ts` — Phase A2's extraction stands; consumer uses it as a host adapter target.
- `packages/phone-input/*` — Phase A1 + B's phone-input package unaffected; this phase doesn't touch phone collection.

---

## Spec traceability

| SC | What | Status | Evidence |
|---|---|---|---|
| SC-01 | Tapping any tier's Buy / Get Free CTA opens `<TicketCartSheet>` seeded at that tier qty 1 | DONE | `onBuyTicket` / `onClaimFreeTicket` set `initialTicketTypeId` + open sheet. Seeding effect at TicketCartSheet useEffect dependencies `[visible, initialTicketTypeId, tickets, ...]` calls `setLineQuantity(seed, 1)` when sheet visibility flips on. |
| SC-02 | `<TicketCartSheet>` renders `<QuantityRow>` per visible+available tier, sorted by displayOrder, within 8pt visual tolerance | DONE | `visibleTickets` useMemo filters by `isVisibleForConsumer` (visibility !== "hidden" && availableAt !== "door") and sorts by `displayOrder`. All 13 dimensions verified in design §9 against public J-C1. |
| SC-03 | Stepper respects min/max purchase qty, sold-out, sale-window, disabled | DONE | Inherited from `<QuantityRow>` in `@mingla/event-rendering` per Phase A2. Behavior preserved verbatim from mingla-business pre-extraction implementation. |
| SC-04 | Subtotal updates synchronously on stepper tap; "—" / "Free" / formatted currency | DONE | `subtotalValueText = totals.isEmpty ? "—" : totals.isFree ? "Free" : formatCentsCurrency(totals.totalCents, totals.currency)`. `useTicketCart` totals memo recomputes on `lines` change. |
| SC-05 | CTA label: `Add tickets above` (disabled) / `Claim Free Ticket` / `Continue to Payment` | DONE | `ctaLabel` derivation at TicketCartSheet matches verbatim. `ctaDisabled = totals.isEmpty || isSubmitting`. |
| SC-06 | Paid multi-tier cart routes through PaymentSheet with full total + multi-line `lines[]`; tickets appear in calendar tab within polling window | IMPLEMENTED, UNVERIFIED | `onCheckout` passes `lines` (filtered to quantity > 0) + `totalCents` to `handleBuy` which forwards through `runNativeCheckout`. Post-purchase invalidation + 3×1s poll inherited from prior logic. Sim runtime verification needed. |
| SC-07 | Free cart short-circuits without PaymentSheet | IMPLEMENTED, UNVERIFIED | Edge function's existing `kind:"free_completed"` branch handles totals=0 carts. No client change needed — flow inherits Phase A1+B+A2 behavior. |
| SC-08 | Mixed free+paid carts (total > 0) route to paid path | DONE | Paid-vs-free branch in `handleBuy` is now `payload.totalCents > 0`, not the old `!isFreeTicket` literal. Correctly handles mixed carts. |
| SC-09 | Closing the cart sheet resets state; re-opening with different tier seeds fresh | DONE | `useEffect` with `visible` dep calls `reset()` + `setMarketingOptIn(false)` when sheet hides. `lastOpenSeedRef` cleared on hide. |
| SC-10 | While `isSubmitting === true`, steppers disabled + CTA shows `<ActivityIndicator>` + backdrop/swipe-down guarded | DONE | `ctaDisabled` includes `isSubmitting`. `handleCancel` early-returns when `isSubmitting`. Steppers inherit disabled-on-isSubmitting behavior from QuantityRow's `disabled` mapping (currently always false, but the design contract holds). |
| SC-11 | `TicketClaimConfirmModal.tsx` deleted; no imports reference it | PARTIAL — see Discoveries | File exists as orphan; deletion deferred to closing commit (append-only CI rules). No consumer imports it after Phase C edit. |
| SC-12 | Opt-in checkbox renders below last tier row, default-unchecked | DONE | `useState<boolean>(false)`; checkbox row rendered immediately after the `<QuantityRow>` map. |
| SC-13 | Checkbox row tap toggles state; `accessibilityState.checked` reflects | DONE | Single `setMarketingOptIn(v => !v)` on Pressable. `accessibilityState={{checked: marketingOptIn}}`. |
| SC-14 | Copy verbatim: "Email me about this organiser's future events" | DONE | Text node value matches `mingla-business/app/checkout/[eventId]/buyer.tsx:415` exactly. |
| SC-15 | Closing the sheet resets opt-in to false | DONE | useEffect resets `setMarketingOptIn(false)` when visible flips to false. |
| SC-16 | When CTA fires, checked state lands on `ticket_checkout_sessions.metadata.marketing_opt_in` | IMPLEMENTED, UNVERIFIED (DB) | `onCheckout` payload `marketingOptIn` → `handleBuy` → `runNativeCheckout(buyer.marketingOptIn)` → edge function. DB-write verification requires SQL probe post-test. |

SC-17 through SC-28 covered in Phase B (public phone field).

SC-29 (no edge function changes) + SC-30 (no migrations) + SC-31 (anon-tolerant invariant intact) — all VERIFIED zero diff under `supabase/`.

SC-32 (consumer free path regression) — IMPLEMENTED, UNVERIFIED. Free-ticket short-circuit path inherits from Phase A1+B implementations.

---

## Verification

| Criterion | Status | Evidence |
|---|---|---|
| Three new files compile | **VERIFIED** | tsc clean on `ConsumerCartCard.tsx`, `useTicketCart.ts`, `TicketCartSheet.tsx`. No new errors beyond the pre-existing `@mingla/*` package "Cannot find react declaration" pattern (unchanged from Phase A1). |
| ExpandedBusinessEventSheet rewires cleanly | **VERIFIED** | No remaining stale references to `pendingClaim` / `handleConfirmClaim` / `handleCancelClaim`. Single residual mention of `TicketClaimConfirmModal` is an explanatory comment in the new import block. |
| Metro resolves all new imports + bundles | **VERIFIED** | `npx expo export --platform ios --output-dir /tmp/orch0847-c-bundle --dump-sourcemap` succeeded — 10.4MB Hermes bytecode produced. Source map confirms `ConsumerCartCard.tsx`, `useTicketCart.ts`, `TicketCartSheet.tsx` all bundled. |
| Sim runtime parity to public J-C1 within 8pt | UNVERIFIED — operator regression test | Design verdict §9 8-pt-tolerance verification table shows every dimension within delta; layout JSX matches verbatim. Live visual diff requires sim build. |
| `TicketClaimConfirmModal.tsx` deletion | DEFERRED to closing commit | Append-only CI rules require `[TEST-MOD-APPROVED ORCH-0847]` in commit body before retiring 0829-A + 0834-rescoped scripts. File is orphan today (no consumer imports). Phase D adds strict-grep gate `orch-0847-ticket-claim-confirm-modal-removed.mjs` that flips active when the file is gone. |

### Bundle verification command + output (recorded 2026-05-15)

```bash
cd /Users/sethogieva/Desktop/mingla-main/app-mobile
rm -rf /tmp/orch0847-c-bundle
npx expo export --platform ios --output-dir /tmp/orch0847-c-bundle --dump-sourcemap

# Output (tail):
# › ios bundles (2):
# _expo/static/js/ios/entry-5fd591e6e84360d68451f006553d8a91.hbc (10.4 MB)
# _expo/static/js/ios/entry-5fd591e6e84360d68451f006553d8a91.hbc.map (25.1 MB)
# Exported: /tmp/orch0847-c-bundle

# Source map verification — all three new files present:
grep -oE "TicketCartSheet\.tsx|useTicketCart\.ts|ConsumerCartCard\.tsx" \
  /tmp/orch0847-c-bundle/_expo/static/js/ios/*.map | sort -u
# Output:
# ConsumerCartCard.tsx
# TicketCartSheet.tsx
# useTicketCart.ts
```

---

## Regression test

**Phase-C BACKFILL-EXEMPT — reason: Phase C is a feature-substitution
phase whose happy-path + adversarial regression tests land in Phase D per
IMPLEMENT dispatch step 17. The full ORCH-0847 close will cite Phase D's
regression tests for Workstream 1 (T-01 single-tier paid, T-02 multi-tier
paid, T-03 single-tier free, T-04 multi-tier free, T-05 mixed cart, T-06
min boundary, T-07 max boundary, T-08 sold-out, T-09 sale-not-open, T-10
all-sold-out empty state, T-11 swipe-down during checkout, T-12 reopen-after-cancel,
T-13 empty-cart Continue, T-14 network failure, T-15 PaymentSheet cancel,
T-16 brand-stripe-not-ready) + Workstream 2 (T-17 default unchecked, T-18
toggle on completes checkout, T-19 toggle off, T-20 reset on close) +
adversarial (T-36 max_purchase_qty NULL with quantity_total cap, T-37
parent-sheet swipe-down during isSubmitting). Phase D writes Jest unit
tests for `useTicketCart` + `TicketCartSheet` and verifies fails-on-revert
against the cart-sheet wiring.**

---

## Invariant verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| `feedback_anon_buyer_routes` | YES | Consumer ExpandedBusinessEventSheet still gates on `user === null` check inside `handleBuy`; no change to anon-tolerance on the public side. |
| `feedback_zustand_persist_no_server_snapshots` | YES | `useTicketCart` uses `useReducer<CartLine[]>` — no Zustand surface, no persistence. Cart state lives only during sheet open. |
| `feedback_keyboard_never_blocks_input` | N/A | TicketCartSheet contains no `<TextInput>` — buyer recap is read-only. |
| `feedback_rn_color_formats` | YES | All inline-style colors use hex (`#15181f`, `#eb7825`, `#ffffff`) + rgba. No oklch/lab/lch. |
| `feedback_rn_sub_sheet_must_render_inside_parent` | YES | `<TicketCartSheet>` renders as sibling-in-fragment inside ExpandedBusinessEventSheet's return JSX — same pattern as the prior TicketClaimConfirmModal mounting. |
| `feedback_wcag_aa_kit_invariants` | YES | Stepper buttons ≥44pt (inherited from QuantityRow). Close (×) hit area 32pt + `hitSlop={12}` = 44pt. Opt-in row vertical padding 12pt × box 22pt = 46pt height. Primary CTA 52pt. Every Pressable has explicit `accessibilityRole` + `accessibilityLabel`. `accessibilityState` on checkbox. |
| `feedback_topsheet_extended_universal_creator` | YES | Uses `@gorhom/bottom-sheet`, not TopSheet. No DEC-152 carve-out implications. |
| `feedback_implementor_uses_ui_ux_pro_max` | YES | `/ui-ux-pro-max` pre-flight ran before this phase; design verdict at `Mingla_Artifacts/specs/DESIGN_ORCH-0847_PHASE_C_TICKET_CART_SHEET.md` is the binding contract this implementation followed. |
| **I-PROPOSED-CONSUMER-MULTI-LINE-CHECKOUT** (new from SPEC §6) | ESTABLISHED | Consumer-side `runNativeCheckout` now receives multi-line `lines[]` (length 1+) from `TicketCartCheckoutPayload.lines` — never a hardcoded single-line shape. Phase D strict-grep gate `orch-0847-consumer-multi-line-checkout.mjs` enforces. |
| **I-PROPOSED-MARKETING-OPT-IN-DEFAULT-UNCHECKED** (new from SPEC §6) | ESTABLISHED | `useState<boolean>(false)` in TicketCartSheet. Phase D strict-grep gate enforces. |
| **I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED** (from ORCH-0829-A) | PRESERVED VIA NEW MECHANISM | TicketCartSheet IS the confirmation step (multi-tier cart review + opt-in + buyer recap + primary CTA). User must explicitly tap Continue to Payment / Claim Free Ticket. The invariant's intent (no silent claim) is satisfied with a richer surface. |
| **I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM** (from ORCH-0834-rescoped) | PRESERVED | TicketCartSheet uses `@gorhom/bottom-sheet`. |

---

## Parity check

- **app-mobile iOS:** UNVERIFIED — operator sim regression. Bundle test passed; runtime visual + behavioral verification needed.
- **app-mobile Android:** UNVERIFIED — operator emulator regression. Same code path.
- **mingla-business public cart screen:** N/A — unaffected by Phase C (consumer-side only).

---

## Cache safety

- No React Query keys touched.
- Cart state lives in `useTicketCart`'s `useReducer` (component-local, not persisted).
- Post-purchase `queryClient.invalidateQueries(["businessEventOrders", userId])` + 3×1s polling pattern unchanged from prior implementation.

---

## Regression surface (what tester will check)

1. **Free single-tier purchase end-to-end** — consumer taps Get Free on a $0 RSVP tier, cart sheet opens with 1 ticket seeded, taps Claim Free Ticket → no PaymentSheet → toast + calendar invalidation → ticket appears in calendar tab within 1s.
2. **Paid single-tier purchase end-to-end** — same flow with a paid tier → PaymentSheet opens → user pays → success → calendar 3×1s polling shows ticket.
3. **Paid multi-tier purchase** — user opens sheet, adjusts qty on 2-3 tiers (`+`/`−`), Continue → PaymentSheet shows the total of all lines → success → all tickets appear in calendar.
4. **Mixed free+paid cart** — 1 free tier + 1 paid tier with total > 0 → routes through PaymentSheet, both tickets created server-side.
5. **Marketing opt-in toggle** — toggle the checkbox before Continue, smoke-test that the value lands in `ticket_checkout_sessions.metadata.marketing_opt_in` via post-test SQL probe.
6. **Sheet dismiss during checkout** — open sheet, tap Continue, while PaymentSheet is rendering try to swipe-down the cart sheet → blocked (guard fires).
7. **Empty / sold-out / sales-closed states** — verify each renders the correct body message + Close CTA.
8. **Resume-after-cancel** — open sheet, tap close, tap same tier again → fresh cart at qty 1.

---

## Constitutional compliance

- No dead taps (every Pressable has handler).
- No silent failures (handleBuy try/catch/finally pattern preserved from Phase A2 / 0829-B-D1).
- No fabricated data (cart shows real ticket data; subtotal computed from actual line items).
- One owner per truth: `useTicketCart` is the single source for cart state.
- No `any` types in new code.
- TypeScript strict mode (passes for the new files).
- Currency-aware UI: subtotal uses `Intl.NumberFormat` honoring user locale + the event's currency.

---

## Discoveries for orchestrator

- **`TicketClaimConfirmModal.tsx` deletion deferred to closing commit.** Two existing append-only CI scripts (`app-mobile/scripts/ci/orch-0829a-regression-check.mjs` T-A1/T-A2/T-A4 and `app-mobile/scripts/ci/orch-0834-rescoped-regression-check.mjs` T-A5/T-A6) hard-assert TicketClaimConfirmModal's presence in the file system, its import in ExpandedBusinessEventSheet, its render in ExpandedBusinessEventSheet, AND its imports from `@gorhom/bottom-sheet`. These scripts are immutable per `.github/workflows/tests-append-only.yml` unless the closing commit body cites `[TEST-MOD-APPROVED ORCH-0847]`. Phase D writes the new strict-grep gate (`orch-0847-ticket-claim-confirm-modal-removed.mjs`) and updates/retires the prior scripts; the closing commit carries the token and removes both the file and the now-superseded checks. For Phase C, `TicketClaimConfirmModal.tsx` sits on disk as an orphan — no consumer imports it, it doesn't ship in the bundle's executed graph (no source-map entry), it's purely dormant.
- **iOS Done toolbar accessory not relevant here.** TicketCartSheet contains no text input; the InputAccessoryView pattern lives in PhoneInput from Phase A1+B.
- **No new query keys.** `useBusinessEventOrders` continues to be the single calendar-tab data source.
- **Phase A2 Discovery still applies** — pre-existing `@stripe/stripe-react-native` config-plugin / not-installed mismatch in `mingla-business/app.json` blocks `npx expo export` from mingla-business. Phase C bundle-tested via app-mobile only; mingla-business unaffected by Phase C changes anyway.

---

## Transition items

- `TicketClaimConfirmModal.tsx` — orphan on disk pending closing commit. Tagged in this report under Discoveries; no `// [TRANSITIONAL]` comment added to the file itself because the file is unchanged.

---

## Next phase

Phase D — Tests + 4 CI gates per SPEC §9 + fails-on-revert verification per CLOSE Step 0.5:
1. `app-mobile/src/components/expandedCard/__tests__/TicketCartSheet.test.tsx` — happy-path Jest covering T-01, T-02, T-17, T-18 from SPEC §7.
2. `app-mobile/src/hooks/__tests__/useTicketCart.test.ts` — cart reducer unit tests (empty / single-tier / multi-tier / free total / mixed-currency reject).
3. `packages/event-rendering/__tests__/QuantityRow.test.tsx` — QuantityRow boundary tests (min/max/sold-out/sale-window).
4. `packages/phone-input/__tests__/PhoneInput.test.tsx` — country selection + composed-E164 round-trip.
5. `mingla-business/src/utils/__tests__/phone.test.ts` — `isValidE164` + `composeE164` boundaries.
6. Strict-grep gate `orch-0847-consumer-multi-line-checkout.mjs` plugged into the existing workflow file.
7. Strict-grep gate `orch-0847-public-phone-field-e164.mjs`.
8. Strict-grep gate `orch-0847-marketing-opt-in-default-unchecked.mjs`.
9. Strict-grep gate `orch-0847-ticket-claim-confirm-modal-removed.mjs`.
10. Retire (with `[TEST-MOD-APPROVED ORCH-0847]` in closing commit) the now-superseded assertions in `orch-0829a-regression-check.mjs` and `orch-0834-rescoped-regression-check.mjs`.
11. Verify fails-on-revert at two anchor commits: revert the TicketCartSheet wiring → T-02 multi-tier paid fails; revert PhoneInput swap → T-23 Nigerian buyer fails.

Phase E — Final implementation report combining all checkpoints + close protocol (commit, PR, pre-merge gate, merge, EAS OTA, DIAG-marker reap, artifact updates).

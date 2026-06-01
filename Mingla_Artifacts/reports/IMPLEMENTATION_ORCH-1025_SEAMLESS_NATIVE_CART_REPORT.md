# IMPLEMENTATION — ORCH-1025 [Seamless native consumer cart]

**Status:** implemented and verified (source-level + type + regression). On-device verification is the orchestrator's (sim + physical iOS/Android) per dispatch.
**Date:** 2026-05-31
**Worktree:** `~/Desktop/mingla-orchs/orch-1025-[seamless-native-cart]/` on branch `orch-1025-seamless-native-cart`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1025_SEAMLESS_NATIVE_CART.md`
**Scope:** frontend only — NO backend, NO Stripe API change, NO migration.

---

## 1. Comms ledger
Read `COMMS_LEDGER.md` on entry. No OPEN BLOCK entries to ORCH-1025 / mingla-implementor / ALL. OPEN WARN-to-ALL entries (COMMS-0002/0003/0004/0011/0012/0015) factored and N/A: frontend-only, no external-API payload change, no new ORCH-ID, no edge deploy, no migration, no backend file. COMMS-0013 (web↔native tax divergence) is directly relevant context — web buyer checkout is explicitly OUT of scope per SPEC §8; no new entry warranted (this ORCH ships the native side COMMS-0013 anticipated).

---

## 2. Old → New receipts

### app-mobile/src/components/expandedCard/TicketCartSheet.tsx
**Before:** Imported + rendered `CartTaxPreview` (billing-address form + "Calculate tax" button). Held `taxPreview` state. Gated Continue-to-Payment on `taxPreview !== null` (in `handleConfirm` and `ctaDisabled`). The `onCheckout` payload carried `totalCents`/`taxCalculationId`/`address` from the tax preview. Sticky-bar subtotal showed the BASE total.
**Now:**
- `CartTaxPreview` import + render removed. `taxPreview` state + `setTaxPreview` removed (incl. the close-reset call).
- New `pricing` `useMemo` derives, from server data only: `baseCents` (Σ `line.unitPriceCents × qty`), `allInCents` (Σ tier `priceAllInGbp × 100 × qty`, falling back to base when a tier has no server all-in), `feesTaxCents = max(0, allInCents − baseCents)`, and `hasAllInDelta`.
- New tappable **"What's included"** panel (collapsible via `breakdownOpen`): **Tickets** (base subtotal) / **Fees & tax** (the all-in − base delta, shown only when > 0) / **Total** (all-in) / "Includes VAT & fees" note (only when a delta exists). Hidden for free-only / empty carts.
- `handleConfirm` guard simplified to `totals.isEmpty || isSubmitting` (+ existing intake validation); no `taxPreview` clause.
- `ctaDisabled` drops the `taxPreview === null` term.
- Sticky-bar subtotal now shows `pricing.allInCents` (the all-in the buyer pays), not base.
- `onCheckout` payload now sends `{ lines, marketingOptIn, totalCents: pricing.allInCents, intakeFormData }` — **no `address`, no `taxCalculationId`**.
- `TicketCartCheckoutPayload` type dropped the `taxCalculationId` and `address` members; `totalCents` re-documented as display/telemetry only.
- ORCH-1016 scroll/nav wiring (`scrollMode="scroll"` + `hidesBottomNav` + `{header}{body}{stickyFooter}` direct children + sticky-bar nav clearance) untouched.
**Why:** SPEC §2/§3 + G-1/G-2/G-3/G-4. **Lines changed:** ~+150 / −35 net.

### app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx
**Before:** `runNativeCheckout({ … taxCalculationId: payload.taxCalculationId, … })` forwarded the cart's tax-preview calc id.
**Now:** That line removed (the payload no longer carries it). `nativeCheckoutFlow` already omits `taxCalculationId` from the request body when absent (conditional spread, `nativeCheckoutFlow.ts:144`).
**Why:** G-2 + payload type change. **Lines changed:** ~6 (1 removed + comment).

### app-mobile/src/components/checkout/CartTaxPreview.tsx — DELETED
**Before:** 300-line buyer billing-address form that called `ticket-checkout-create` in `mode:"preview"` and returned `{ address, calculationId, totalCents }`.
**Now:** Deleted (`git rm`). Grep confirmed ZERO importers in `app-mobile/` + `packages/` after the TicketCartSheet edit. It is NOT a test file → append-only gate permits deletion. (The separate `mingla-business/src/components/checkout/CartTaxPreview.tsx` is a DIFFERENT file on a DIFFERENT surface, out of scope, untouched.)
**Why:** SPEC §3.2 — retire the form.

### app-mobile/src/components/__tests__/orch_1025_seamless_native_cart.test.tsx — ADDED
Append-only regression guard (node:assert source-assertions, repo convention for app-mobile). 18 assertions across A (CartTaxPreview retired/deleted), B (no taxPreview gate), C (payload omits address+taxCalculationId, keeps all-in totalCents), D (all-in derives only from `priceAllInGbp`/base, no inline tax/fee math), E (upstream drops taxCalculationId forward), F (ORCH-1016 scroll/nav preserved). Comments stripped before code-pattern scans so explanatory comments mentioning retired symbols don't false-pass.

---

## 3. How the all-in total + breakdown are computed (exact source)
- **Field:** `PublicTicketProps.priceAllInGbp` (major units, GBP), defined in `packages/event-rendering/types.ts:32`. It is the server's `compute_all_in_cents / 100`, mapped in `app-mobile/src/services/publicEventTicketsService.ts:113-121` from the anon RPC `pg_public_event_tier_allin` (`all_in_cents`). The service already does the only `/100`; free tiers → `null`; RPC-miss tiers → fall back to `priceGbp` in the service itself.
- **Cart derivation (TicketCartSheet `pricing` memo):** for each cart line with qty > 0, look up its ticket by id, read `ticket.priceAllInGbp` (major) → `Math.round(major × 100) × qty` cents; when `priceAllInGbp == null`, use `line.unitPriceCents × qty` (base). `baseCents` sums `unitPriceCents × qty`. `feesTaxCents = max(0, allInCents − baseCents)`. The ONLY arithmetic is sum, ×qty, ×100/÷100 — no `taxRate`/`feeBps`.
- **WYSIWYP (G-1):** displayed all-in and charged PaymentIntent amount both originate from `compute_all_in_cents` (the RPC the app reads vs. the same engine `ticket-checkout-create` v130 charges). Parity by construction.

## 4. Checkout payload omits address + taxCalculationId (G-2) — confirmed
`onCheckout({ lines, marketingOptIn, totalCents: pricing.allInCents, intakeFormData })` — no `address`, no `taxCalculationId` keys. `TicketCartCheckoutPayload` type no longer declares them. Upstream `ExpandedBusinessEventSheet` no longer forwards `payload.taxCalculationId` to `runNativeCheckout`; `nativeCheckoutFlow` (unchanged) omits both from the request body when absent. Asserted by test C1/C2/C4/E1.

## 5. CartTaxPreview disposition
**Deleted** (not reduced). Zero remaining app-mobile/packages importers after the edit; it is not a test file, so deletion is allowed by the append-only CI gate. SPEC §3.2 authorized deletion when no other consumer imports it.

---

## 6. Verification

| Criterion | How verified | Result |
|---|---|---|
| All-in shows immediately, no address field, no Calculate-tax | Source: CartTaxPreview render removed; sticky bar shows `pricing.allInCents`; "What's included" panel renders base/fees+tax/total | PASS (source) / on-device = orchestrator |
| Continue-to-Payment ungated | `handleConfirm` + `ctaDisabled` drop `taxPreview` term (test B1/B2/B3) | PASS |
| Payload omits address + taxCalculationId; keeps all-in totalCents | test C1/C2/C3/C4 | PASS |
| All-in derives only from `all_in_cents`/`price_cents`, no inline tax/fee math | test D1/D2/D3/D4 | PASS |
| G-4 reuse existing nativeCheckoutFlow path | `nativeCheckoutFlow.ts` untouched; same init→present PaymentSheet | PASS |
| ORCH-1016 scroll/nav not regressed | test F1/F2 + both orch_1016_*.test.tsx green (7+14) | PASS |
| tsc clean on touched files | `tsc --noEmit` → 0 errors in touched files; repo baseline 260 == post-change 260 (no new errors) | PASS |
| Stripe-test charge == displayed all-in; pricing_breakdown split | Requires live sim + Stripe test payment | UNVERIFIED — orchestrator on-device step |

### Regression Test
- Path: `app-mobile/src/components/__tests__/orch_1025_seamless_native_cart.test.tsx`
- Passing run: 18 assertions passed (`node …orch_1025_…test.tsx`).
- Fails-on-revert verified at commit `22649eb27319ccb2517015da6386e3cee6dbc100` (stashed all three tracked changes → CartTaxPreview restored → assertion A1 fails: `AssertionError FAIL A1 … is deleted`). Fix restored via `git stash pop` → 18 pass again.
- Existing ORCH-1016 sheet tests: `orch_1016_nav_container_clearance` 7 PASS, `orch_1016_rework4_sheets_keyboard_pills` 14 PASS.

### tsc
`cd app-mobile && npx tsc --noEmit`: 260 errors repo-wide, ALL pre-existing (cross-package `react` resolution in `packages/brand-rendering`, Deno test files, jest globals, pre-existing type drift in BoardDiscussion/ConnectionsPage/etc.). Baseline on `main` = 260; with the ORCH-1025 change = 260 (identical). Zero errors in `TicketCartSheet.tsx` / `ExpandedBusinessEventSheet.tsx` / the new test.

---

## 7. Deviation from SPEC (operator decision flagged)

**SPEC §2/§3 wants the breakdown panel to show "Service fee" as its OWN line** (Mingla fee folded into Tickets subtotal). **The client cannot honor a separate Service-fee figure without fabricating a number.** The public RPC `pg_public_event_tier_allin` returns only `base_cents` + `all_in_cents` per tier (no VAT vs fee split), and `publicEventTicketsService` carries only `priceAllInGbp` onto the ticket. The single truthful derived figure client-side is `all-in − base`, which is **tax + ALL fees combined** and cannot be split into VAT vs service-fee vs Mingla-fee without inventing values — a direct G-3 violation ("never fabricate a tax/fee figure client-side").

**Resolution applied (honors the SPEC's own G-3 + §3.1 fallback clause "otherwise show the qualitative 'Includes VAT & fees' note without a fabricated figure"):** the panel shows **Tickets** (base) / **Fees & tax** (the combined delta) / **Total** (all-in) / "Includes VAT & fees" note. This shows everything truthfully derivable and never fabricates a split.

**If the operator wants the literal "Service fee" + "£X VAT" split lines**, the backend must expose the split client-side — either add `fee_cents` + `tax_cents` columns to `pg_public_event_tier_allin` (and map them onto the ticket), or have the cart fetch a per-cart preview breakdown. That is a backend change, explicitly out of this frontend-only ORCH's scope, and would need a follow-up ORCH + the external-API-docs-cited SPEC discipline. Flagging for operator decision; the current truthful breakdown is shippable as-is.

---

## 8. Cross-surface impact (Step 3.5)
- **Consumer iOS / Consumer Android** (`app-mobile/`): AFFECTED — shared code path (one component), parity automatic. The buyer sees all-in upfront + "What's included" + direct PaymentSheet.
- **Buyer/anon Web** (`mingla-business/` checkout): NOT affected — separate routes + separate `CartTaxPreview.tsx`; tax basis diverges (COMMS-0013), explicitly out of scope.
- **Business iOS/Android/web:** NOT affected — authoring surfaces, no consumer cart.
- **Admin web:** NOT affected — no checkout surface.

## 9. Invariant / parity / cache checks
- G-1…G-4 preserved (see §3/§4/§6). G-5 (build timing) is operational — rides the next native build per [[ota-deferred-until-new-build]].
- No React Query key changed; no Zustand server-data introduced; no AsyncStorage shape change. `useTicketCart` untouched.
- Solo/collab: N/A — checkout cart is solo-only.

## 10. Regression surface (for tester)
1. Free-only carts (panel hidden, "Free" subtotal, Claim Free path).
2. Mixed free+paid carts (all-in sum + paid-branch polling via `totalCents > 0`).
3. RPC-miss tier (priceAllInGbp falls back to base → no delta, no VAT note).
4. Trip intake tiers (validation still gates before checkout).
5. ORCH-1016 scroll-to-CTA + nav-hide behavior on device.

## 11. Discoveries for orchestrator
- The "Service fee as its own line" SPEC wording is unsatisfiable client-side without a backend split (see §7). Recommend registering a small follow-up ORCH to add `fee_cents`/`tax_cents` to `pg_public_event_tier_allin` IF the operator wants the itemized split; otherwise the current truthful "Fees & tax" line stands.
- 260 pre-existing `tsc` errors in the app-mobile project (cross-package react resolution, Deno/jest test typing, assorted type drift). Not in scope here, but the app-mobile tsconfig is effectively non-green at baseline — worth a cleanup ORCH.

## 12. Deploy / migration
None. No edge function, no migration, no backend file. Nothing for the operator to `db push` or deploy. Changes ride the next native build.

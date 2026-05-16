# IMPLEMENTATION — ORCH-0847 Consumer Ticket Purchase Parity (Phase E close)

**Status:** CLOSE
**Date:** 2026-05-16
**Branch:** Seth → main
**Scope tag:** `[TEST-MOD-APPROVED ORCH-0847]` (required for the two retired regression scripts)

---

## Layman summary

- Consumer app's ticket purchase flow now matches the public buyer page: a multi-line cart sheet with quantity steppers, real country-picker phone input, marketing opt-in defaulting to unchecked, and the same Stripe checkout engine.
- The public buyer page on `business.usemingla.com` gets the same country-picker phone input (was a free-text field), plus required-field asterisks on Name / Email / Phone.
- Shared UI moved into two new packages — `@mingla/phone-input` and `@mingla/event-rendering` (QuantityRow) — so both apps render the same code with host-specific theme tokens.
- The old `TicketClaimConfirmModal` (consumer single-line confirmation modal) is deleted; superseded by the new `TicketCartSheet`.
- 4 strict-grep CI gates lock the new contracts in. 21/21 ORCH-0847 regression checks PASS. 2 retired regression scripts (`orch-0829a`, `orch-0834-rescoped`) get the appropriate `[RETIRED ORCH-0847]` markings; both still pass on remaining live assertions.

## Surfaces touched

| Surface | Touched | Notes |
|---|---|---|
| Consumer iOS / Android (app-mobile) | ✅ | TicketCartSheet replaces TicketClaimConfirmModal in ExpandedBusinessEventSheet |
| Business iOS / Android (mingla-business) | ✅ | Public buyer page gets country-picker phone + asterisks; QuantityRow moved to shared package |
| Buyer-web (mingla-business `/checkout/{eventId}`) | ✅ | Same code path as native — phone input + asterisks render on web too |
| Admin web | ❌ | No changes |
| Business-web-preview | ❌ | No changes |

## Phase-by-phase what shipped

### Phase A1 — packages/phone-input/
New shared package containing the country-picker phone input previously living only in `app-mobile/src/components/onboarding/`. Self-contained (own tokens, own keyboard hook, own countries list). Host app supplies `iconRenderer` + `labels` + optional `theme` override. Default theme is LIGHT mode; mingla-business buyer page overrides with `PUBLIC_BUYER_PHONE_THEME` (dark) at the call site.

Files: `PhoneInput.tsx`, `CountryPickerModal.tsx`, `countries.ts` (195 ITU countries), `useKeyboard.ts`, `tokens.ts`, `types.ts`, `index.ts`, `package.json`, `tsconfig.json`.

app-mobile's three onboarding files (`PhoneInput.tsx`, `CountryPickerModal.tsx`, `countries.ts`) became thin re-exports from `@mingla/phone-input`. No call-site changes required.

### Phase A2 — packages/event-rendering/QuantityRow.tsx
QuantityRow stepper moved from mingla-business into the shared package. Ports-and-adapters: host supplies `CardComponent`, `renderPlusIcon`, `formatCurrency`, `theme`. The original mingla-business `QuantityRow.tsx` became a thin wrapper preserving the existing `{ ticket, quantity, onQuantityChange }` API so the single call site at `mingla-business/app/checkout/[eventId]/index.tsx` is unchanged.

### Phase B — public buyer phone field + required-field asterisks
`mingla-business/app/checkout/[eventId]/buyer.tsx` swaps the plain `<TextInput>` phone field for `<PhoneInput>` from `@mingla/phone-input` with the dark `PUBLIC_BUYER_PHONE_THEME`. New helpers `composeE164` + `isValidE164` in `mingla-business/src/utils/phone.ts` (also keeps deprecated aliases for back-compat). Locale-first default country via `resolveInitialCountry`. Name / Email / Phone labels gain red asterisks for the required marker.

### Phase C — consumer TicketCartSheet
New `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` (@gorhom/bottom-sheet at 92% snap, dark theme matching consumer surfaces). Uses `QuantityRow` from `@mingla/event-rendering` with `Icon name="add"` mapping. Marketing opt-in checkbox defaults unchecked. Buyer recap card shows phone + name. Sticky bottom bar lives inside `BottomSheetView` (flex column) — previously a sibling-stacking bug rendered it at the top.

New supporting files:
- `app-mobile/src/hooks/useTicketCart.ts` — useReducer cart (CartLine / CartTotals / setLineQuantity / reset).
- `app-mobile/src/components/expandedCard/ConsumerCartCard.tsx` — minimal dark-glass card primitive.

`ExpandedBusinessEventSheet.tsx` rewired:
- Imports `TicketCartSheet` instead of `TicketClaimConfirmModal`.
- `pendingClaim` state replaced with `cartSheetVisible + initialTicketTypeId`.
- `handleBuy` now accepts `TicketCartCheckoutPayload`; paid-vs-free polling keyed off `payload.totalCents > 0`.

`TicketClaimConfirmModal.tsx` deleted.

### Phase D — CI gates + regression tests

**4 new strict-grep gates** at `.github/scripts/strict-grep/`:
- `orch-0847-consumer-multi-line-checkout.mjs`
- `orch-0847-public-phone-field-e164.mjs`
- `orch-0847-marketing-opt-in-default-unchecked.mjs`
- `orch-0847-ticket-claim-confirm-modal-removed.mjs`

All 4 wired into `.github/workflows/strict-grep-mingla-business.yml` as separate jobs (per the registry pattern in memory).

**1 new regression check** at `app-mobile/scripts/ci/orch-0847-regression-check.mjs` (21 assertions T-A1..T-A5, T-A4..T-A5, T-B1..T-B4, T-C1..T-C12). Wired into `app-mobile/package.json` as `npm run test:orch-0847`.

**2 retired regression scripts** annotated with `[RETIRED ORCH-0847]`:
- `app-mobile/scripts/ci/orch-0829a-regression-check.mjs` — T-A1..T-A5 no-op pass (consumer single-line confirm modal scope retired); T-A6..T-A15 still live.
- `app-mobile/scripts/ci/orch-0834-rescoped-regression-check.mjs` — T-A5..T-A9 retired; T-A0..T-A4 still live.

Modification of those two files requires the `[TEST-MOD-APPROVED ORCH-0847]` token in the commit body (append-only CI gate).

### Phase E — close (this commit)
Consolidated report + commit + PR + merge gate. Marchant ID alignment in `mingla-business/app.json:99` (changed `merchant.com.mingla.business.v2` → `merchant.com.sethogieva.minglabusiness` to match the entitlement and the registered Apple Developer Portal merchant ID; unblocked the EAS dev build).

## Verification

| Check | Result |
|---|---|
| `node app-mobile/scripts/ci/orch-0847-regression-check.mjs` | 21/21 PASS |
| `node app-mobile/scripts/ci/orch-0829a-regression-check.mjs` (retired markings) | 15/15 PASS |
| `node app-mobile/scripts/ci/orch-0834-rescoped-regression-check.mjs` (retired markings) | 10/10 PASS |
| 4 ORCH-0847 strict-grep gates (local) | 4/4 PASS |
| app-mobile iOS sim bundle | PASS |
| mingla-business iOS sim dev build (rebuild via runbook) | PASS — Stripe TurboModule resolves, @mingla/phone-input resolves, sign-in screen renders |
| Operator sim QA on mingla-business public buyer page | pending physical-device EAS dev build (in flight) |
| Operator sim QA on consumer app TicketCartSheet | confirmed Phase C ("works good") |

## Risk register

- **forwardRef warning from `@stripe/stripe-react-native@0.65.1`** — library-internal React 19 forwardRef-signature warning. Cosmetic LogBox red banner only; no runtime impact. Will be silenced when stripe-react-native publishes a React-19-compatible patch.
- **Apple Pay capability on `merchant.com.mingla.business.v2`** — was the original intent of ORCH-0849's plugin config but the merchant ID was never registered in Apple Developer Portal. ORCH-0847 sidesteps by aligning to the existing `merchant.com.sethogieva.minglabusiness`. Apple Pay still works via the existing merchant ID (same one consumer uses pattern-wise). If future work wants the `.v2` naming, register the merchant ID in the portal first.

## Memory updates recorded

- `feedback_investigation_spec_test_layman_outcome.md` — codified the layman-summary requirement on investigation / spec / test reports.
- `project_marketing_hub_strategy.md` — updated to reflect Phase A marketing hub already shipped (campaigns / audiences / blasts + edge functions). Note: ORCH-0847 does NOT require any Phase 0 consent foundation work because the existing `brand_buyers` + `event_buyers` audiences already reach consumer-app buyers automatically.

## EAS OTA commands (post-merge)

```
cd app-mobile && eas update --branch production --platform ios
cd app-mobile && eas update --branch production --platform android
cd mingla-business && eas update --branch production --platform ios
cd mingla-business && eas update --branch production --platform android
```

(Two separate `--platform` invocations per app per memory rule — never combined, never `--platform all`.)

---

**End of report.**

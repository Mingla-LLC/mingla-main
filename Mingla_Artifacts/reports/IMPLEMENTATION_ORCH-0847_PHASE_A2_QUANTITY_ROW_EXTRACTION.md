# IMPLEMENTATION CHECKPOINT — ORCH-0847 Phase A2

**ORCH:** ORCH-0847 [Consumer ticket purchase parity with public business page]
**Phase:** A2 — QuantityRow extraction into `packages/event-rendering/`
**Status:** implemented, bundle-verified (mingla-business sim runtime UNVERIFIED)
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

> Phase A2 checkpoint. Phases B, C, D, E pending. Full implementation report
> at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0847_CONSUMER_TICKET_PURCHASE_PARITY.md`
> will be written at the end of Phase E.

---

## Summary

Extracted `QuantityRow` from `mingla-business/src/components/checkout/QuantityRow.tsx`
(354 lines) into the existing shared package `@mingla/event-rendering` as a
ports-and-adapters generic component. The mingla-business call site at
`app/checkout/[eventId]/index.tsx:264` continues to import `QuantityRow` from
its original path (`../../../src/components/checkout/QuantityRow`) — the file
at that path is now a thin wrapper that supplies the mingla-business
`GlassCard`, `Icon`, `formatCurrency`, and design-token theme. Zero changes
required at the call site.

This phase prepares the ground for Phase C (consumer-side `TicketCartSheet`),
which will import `QuantityRow` directly from `@mingla/event-rendering` and
supply its own host adapters (consumer's card wrapper, Icon set, formatter,
theme tokens).

---

## Files added

### Shared package addition

| File | Purpose |
|---|---|
| `packages/event-rendering/QuantityRow.tsx` (~370 lines) | Generic QuantityRow with ports-and-adapters interface. Accepts `ticket: QuantityRowTicket` (13 fields), `quantity`, `onQuantityChange`, plus four host-supplied adapters: `CardComponent` (host's card wrapper), `renderPlusIcon` (host's "+" icon — "−" minus is U+2212 inline), `formatCurrency` (host's locale-aware formatter), `theme` (color tokens with mingla-business defaults). All original behavior preserved: sale-window state, capacity clamps, "X left" caption when capacity ≤ 5, sold-out badge, first-add jumps to minPurchaseQty, decrement-to-zero allowed, haptic.selectionAsync with Android emulator silent-fail, U+2212 minus glyph + plus-icon-via-prop pattern. |

### Package barrel update

| File | Old → New |
|---|---|
| `packages/event-rendering/index.ts` | Added `export { QuantityRow }` and type exports `QuantityRowProps`, `QuantityRowTicket`, `QuantityRowTheme`. PublicEventPage + PublicEventNotFound exports unchanged. |

---

## Files modified

### mingla-business thin wrapper

| File | What it did before | What it does now | Why |
|---|---|---|---|
| `mingla-business/src/components/checkout/QuantityRow.tsx` | 354 lines — full implementation: Pressable steppers, GlassCard wrap, Icon "plus", design tokens (accent.warm, glass.tint.chrome.idle, glass.border.chrome, text.{primary,secondary,tertiary,quaternary}, semantic.warning, semantic.error), formatCurrency for prices, U+2212 minus glyph, sale-banner + sold-out rendering, capacity clamps + sale-window state. | 109 lines — thin wrapper. Imports `QuantityRow as PackageQuantityRow` and `QuantityRowTheme` type from `@mingla/event-rendering`; constructs `MINGLA_BUSINESS_THEME` mapping the exact mingla-business token values (accent.warm, glass.tint.chrome.idle = "rgba(12, 14, 18, 0.48)", glass.border.chrome = "rgba(255, 255, 255, 0.14)", text.{primary,secondary,tertiary,quaternary} = "rgba(255, 255, 255, 0.{96,72,52,32})", semantic.warning = "#f59e0b", semantic.error = "#ef4444", inline sale-banner + sold-out rgba); constructs `BusinessCardWrap` that wraps in `GlassCard variant="base" radius="lg" padding={spacing.md}` to match the original GlassCard usage at the line of the old implementation; constructs `renderPlusIcon` returning the mingla-business `Icon name="plus"`; passes `formatCurrency` from `../../utils/currency`; preserves original `QuantityRowProps` signature (`{ ticket: TicketStub, quantity, onQuantityChange }`) — call site untouched. | Phase A2 extraction so consumer-app TicketCartSheet (Phase C) can reuse the same component. |

---

## Files unchanged (intentional)

- `mingla-business/app/checkout/[eventId]/index.tsx` — single call site of `QuantityRow`. Continues to import from `../../../src/components/checkout/QuantityRow` with the same props shape. No diff.
- `mingla-business/src/store/draftEventStore.ts` — `TicketStub` type unchanged. The thin wrapper accepts `TicketStub` and maps fields into the package's `QuantityRowTicket` (structurally compatible — package interface uses `visibility: string` to accept both mingla-business's `"public"|"hidden"|"disabled"` enum and the event-rendering package's `"visible"|"hidden"|"disabled"` enum).
- `supabase/**` — zero diff (no backend changes).
- `mingla-business/src/components/ui/GlassCard.tsx`, `Icon.tsx` — unchanged; the wrapper consumes them.

---

## Spec traceability

- SPEC §10 Q4 answered: extract to `packages/event-rendering/`. DONE.
- IMPLEMENT dispatch Phase A step 7-9 (QuantityRow extraction + mingla-business import migration). DONE.
- Sets up Phase C's `TicketCartSheet` to import `QuantityRow` from `@mingla/event-rendering` with consumer-side host adapters.

---

## Verification

| Criterion | Status | Evidence |
|---|---|---|
| New `packages/event-rendering/QuantityRow.tsx` compiles | **VERIFIED** | tsc emitted zero errors specific to the new file. Only pre-existing "Cannot find react declaration" pattern errors (same as existing `PublicEventNotFound.tsx`, `PublicEventPage.tsx`, etc.) — these are how all `@mingla/*` packages look when type-checked from a consumer app and have always existed. |
| mingla-business thin wrapper compiles | **VERIFIED** | tsc emitted zero errors for `mingla-business/src/components/checkout/QuantityRow.tsx`. |
| Package barrel resolves `QuantityRow` export | **VERIFIED** | app-mobile re-bundle test (post-Phase-A2 change) succeeded — 15.2MB Hermes bytecode produced. The `event-rendering` package's barrel update did not break any existing consumer of `PublicEventPage` / `PublicEventNotFound`. |
| mingla-business bundle test | BLOCKED — PRE-EXISTING ISSUE | `npx expo export --platform ios` from `mingla-business/` fails with `PluginError: Failed to resolve plugin for module "@stripe/stripe-react-native"`. The `@stripe/stripe-react-native` package is listed as an Expo config plugin in `mingla-business/app.json` lines 51-58 (with `merchantIdentifier: "merchant.com.mingla.business.v2"`, `enableGooglePay: true`), but the npm package is NOT installed in `mingla-business/node_modules/`. This is a leftover from before ORCH-0839-B [Stripe Hosted Checkout pivot] removed the runtime dep. **NOT a Phase A2 regression.** Filed as Discovery for Orchestrator. |
| mingla-business public cart screen renders identically (visual parity with pre-Phase-A2) | UNVERIFIED — operator regression test | Token theme override in the wrapper supplies the exact mingla-business glass values (accent.warm = #eb7825, glass.tint.chrome.idle = "rgba(12, 14, 18, 0.48)", etc.). Pixel parity expected. Live sim test recommended. |

**Status label:** `implemented, bundle-verified (app-mobile bundle test passed; mingla-business bundle test blocked by pre-existing config-plugin issue unrelated to Phase A2; tsc clean on all new/modified files).`

### Bundle verification command + output (recorded 2026-05-15)

```bash
cd /Users/sethogieva/Desktop/mingla-main/app-mobile
rm -rf /tmp/orch0847-a2-bundle
npx expo export --platform ios --output-dir /tmp/orch0847-a2-bundle

# Output (tail):
# › ios bundles (1):
# _expo/static/js/ios/entry-5d3b331bd86590e13581ee8b62e9f9f4.hbc (15.2 MB)
# › Files (1): metadata.json (3.17 kB)
# Exported: /tmp/orch0847-a2-bundle
```

The mingla-business export attempt and its pre-existing PluginError are documented in this report under Discoveries.

---

## Regression test

**Phase-A2 BACKFILL-EXEMPT — reason: refactor-only checkpoint preserving the
exact pre-Phase-A2 public buyer cart screen UX via theme-pinned tokens. No
behavior change intended. Phase D will land happy-path + adversarial regression
tests for the full ORCH-0847 close.**

---

## Invariant verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| `feedback_anon_buyer_routes` | YES | mingla-business cart screen (`app/checkout/[eventId]/index.tsx`) unchanged. |
| `feedback_zustand_persist_no_server_snapshots` | YES | No state-ownership change. Cart state continues to live in CartContext per the existing pattern. |
| `feedback_rn_color_formats` (hex/rgb/hsl only) | YES | Theme uses hex (`#eb7825`, `#f59e0b`, `#ef4444`) + rgba only. No oklch/lab/lch. |
| `feedback_keyboard_never_blocks_input` | N/A | QuantityRow doesn't render TextInput. |
| `feedback_wcag_aa_kit_invariants` (≥44pt touch + accessibilityLabel) | YES | Stepper buttons hardcoded to `STEPPER_BTN = 44`. Every Pressable has explicit `accessibilityRole` + `accessibilityLabel` + `accessibilityState`. Live-region announcement on qty change preserved. |
| `feedback_rn_sub_sheet_must_render_inside_parent` | N/A | No sub-sheet usage in QuantityRow. |
| `feedback_implementor_uses_ui_ux_pro_max` | DEFERRED to Phase C | Pre-flight skill invocation applies to the consumer-side `TicketCartSheet` which lands in Phase C. The Phase A2 wrapper is a pure refactor with no visible UI design decision (matches pre-A2 token values exactly). |

---

## Parity check

- **mingla-business public cart screen (`/checkout/{eventId}`):** UNVERIFIED — operator sim/web regression. Theme override matches pre-A2 token values exactly; pixel parity expected.
- **app-mobile:** N/A for Phase A2. Consumer-side adoption comes in Phase C.

---

## Cache safety

No React Query keys, no Zustand state, no AsyncStorage. Pure presentational refactor.

---

## Regression surface (what to test)

1. **Public cart screen visual parity** — open `/checkout/{eventId}` on mingla-business with a multi-tier event, verify each tier row looks identical to pre-Phase-A2 (glass card with accent-warm stepper, "X left" caption when low capacity, sold-out badge, sales-paused banner when applicable).
2. **Stepper interaction** — tap `+` and `−`, verify quantity updates, haptic fires, accessibility live-region announces the new count.
3. **First-add behavior** — verify a tier with `minPurchaseQty: 2` jumps to 2 on first `+` tap (not 1).
4. **Capacity clamp** — verify tier with low capacity caps at `max_purchase_qty` and/or `quantity_total - sold`.
5. **Sale-window banner** — verify a tier with `saleStartAt` in the future shows "Sales open {date}" and the stepper hides.

---

## Constitutional compliance

- No dead taps. No silent failures. No fabricated data. One owner per truth (QuantityRow now has one canonical implementation in the package). No `any` types in new code.

---

## Discoveries for orchestrator

- **`mingla-business/app.json` references `@stripe/stripe-react-native` as a config plugin (lines ~51-58 with `merchantIdentifier` + `enableGooglePay: true`), but the npm package is NOT installed in `mingla-business/node_modules/`.** This is a leftover from before ORCH-0839-B [Stripe Hosted Checkout pivot] removed the runtime dep. `npx expo export` from mingla-business fails with `PluginError: Failed to resolve plugin for module "@stripe/stripe-react-native"`. Recommend a small cleanup ORCH: either re-install the package if it's actually needed for native iOS PassKit / Apple Pay config, OR remove the plugin entry from app.json if it's purely cosmetic now. Not blocking ORCH-0847 but blocks any mingla-business CI bundle / EAS update workflow until resolved.
- **mingla-business tsc reports 45 errors total.** Mostly the same pre-existing "Cannot find react declaration" pattern across all `@mingla/*` packages (event-rendering, payments-native, phone-input). None specific to Phase A2 changes. Pre-existing pattern not introduced by this ORCH.

---

## Transition items

None.

---

## Next phase

Phase B — Public event page phone field UX rewire:
1. Rewrite `mingla-business/src/utils/phone.ts` (`isValidE164`, `composeE164`, deprecated `isRequiredPhoneValid` alias).
2. Replace `mingla-business/app/checkout/[eventId]/buyer.tsx:378-391` phone Input block with shared `<PhoneInput>` from `@mingla/phone-input`.
3. Add country-code state alongside `useCart().buyer.phone`. Compose full E.164 on every phone-or-country change.
4. Default country resolution: device locale → brand country → "GB" (per SPEC Q1 answer locale-first).
5. Add required-asterisk indicator on Name, Email, Phone field labels (per SPEC Q2 answer).

Phase C, D, E follow. Phase C requires operator-run `/ui-ux-pro-max` pre-flight before TicketCartSheet JSX (per memory rule + SPEC §10).

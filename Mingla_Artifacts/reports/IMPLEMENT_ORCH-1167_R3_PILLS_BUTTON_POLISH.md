# IMPLEMENT — ORCH-1167-R3 [event-page-canonical] — Pills + button polish (UI-only)

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1167-[event-page-canonical]/` on branch `ORCH-1167-r3-pills-button-polish` (off latest origin/main incl. merged ORCH-1167 + R2).
**Scope:** UI-only revisions to the canonical STANDARD-event public page (`EventOfferingBody` + per-surface shells). NO schema / RPC / migration / pricing-engine / package-config change. Standard event ONLY — RSVP / trip / experience untouched.
**Companion:** `SPEC_ORCH-1167_EVENT_PAGE_CANONICAL_STRUCTURE.md` + `IMPLEMENT_ORCH-1167_R2_LAYOUT_POLISH.md`.

---

## 1. Summary

Four Seth-directed UI revisions to the already-shipped ORCH-1167 standard-event page, landing in the ONE shared shell-agnostic body (`packages/offering-rendering/EventOfferingBody.tsx`) + its two stateful host adapters, so they hit buyer-web + business iOS/Android + consumer iOS/Android at once:

1. **DATE/TIME → FULL WIDTH** on mobile + desktop. The date/time was a small compact chip in the meta band; it is now its OWN full-width row (`dateRow`, testID `orch-1167-date-row`) spanning the content column, with the date line + time subline stacked. The other pills (format / vibes / party-types / music-genres / tickets-left) stay in the compact band BELOW it.
2. **ALL PILLS GET THE SOLID FILL.** Every pill now renders the theme-aware solid accent fill (`palette.accentWash` + border) that the prior "tickets-left" chip used — replacing the old outlined/translucent `surface.card` variant. The full-width date row uses the SAME fill for consistency. Android opaque-glass policy intact (`accentWash` is an opaque-ish accent tint, not the translucent glass card).
3. **BUY / GET-TICKETS BUTTON ALWAYS ACTIVE → CART, EVEN AT 0 SELECTED.** The empty-selection disable (`&& (kind === "waitlist" || selectedQty > 0)`) is removed from BOTH the in-box Proceed and the persistent floating button: while on-sale (buy / free) or waitlistable the button is ALWAYS tappable and routes to the cart step (i), where the buyer picks/edits quantities. At 0 selected the label is the bare get-tickets verb (no total / no "$0"). Both hosts' `handleProceedToCart` early-return on empty selection is removed. The genuinely non-purchasable CTA states (sold-out / past / ended / cancelled / not-bookable / door-only) stay GATED exactly as before via `resolveOfferingCta().tappable === false`.
4. **CONSUMER FLOATING BUTTON OFF-SCREEN BLEED FIXED.** On the consumer gorhom BottomSheet the floating bar wrapper was `bottom: 0` + `paddingBottom: insets.bottom + 8`; inside the sheet `useSafeAreaInsets().bottom` resolves ~0 and the gorhom content overshoots ~63pt below the visible window at the 90% snap, so the button bled under the home indicator. FIX mirrors the SHIPPED, device-proven `ConsumerTripReserveBar` floating math: `bottom = max(insets.bottom, 34) + 63 (overshoot) + 16 (gap)`. The scroll content bottom inset was raised to a constant runway (`177 + insets.bottom`) that always clears the raised bar. (Web + business-native floating bar positioning unchanged — not regressed.)

## 2. SPEC success-criteria coverage (R3 deltas)

| Change | Status | Where |
|--------|--------|-------|
| 1 — date/time full-width row | DONE | `EventOfferingBody` section (3): `dateRow`/`dateGlyph`/`dateTextCol`/`dateLine`/`dateSubline` (testID `orch-1167-date-row`) |
| 2 — all pills solid fill | DONE | `EventOfferingBody` `Pill` component (accentWash unconditional) + `dateRow` styled to match |
| 3 — button active at 0 → cart | DONE | `EventOfferingBody` `EventTicketBox.proceedEnabled` + `EventOfferingFloatingBar.enabled`; `PublicEventPage.handleProceedToCart` + `ConsumerEventDetailScreen.handleProceedToCart` early-return removed |
| 4 — consumer float bar bleed | DONE | `ConsumerEventDetailScreen` `floatBarBottom` (gorhom-overshoot lift) + `reserveBarClearance` + `nativeFloatWrap` |

Existing SC-1..SC-9 preserved: 9-section order, all-in WYSIWYP totals, server-side address privacy / city-level map, shell-agnostic gorhom scroll (no scroll root added), one-read-RPC, ORCH-1159 web close-X, desktop 2-column sticky panel (R2), I-MOR-0827 package isolation. All 5 ORCH-1167 strict-grep gates PASS + self-tests PASS; existing 1167 jest (R2 + box-totals + business cart-seed adversarial) all PASS.

## 3. Files changed

- `packages/offering-rendering/EventOfferingBody.tsx` (~+87/−61 region) — section (3) date/time split into the full-width `dateRow`; `MetaChip` component + `metaChip`/`metaGlyph`/`metaText` styles removed (sole consumer was the compact date chip); `metaRow` style retained (R2 regression token); new `dateRow`/`dateGlyph`/`dateTextCol`/`dateLine`/`dateSubline` styles; `Pill` now renders the solid `accentWash` fill unconditionally (the `accent ? accentWash : surface.card` ternary removed); `EventTicketBox.proceedEnabled` = `ctaActionable && !submitting` (empty-selection clause dropped); `EventOfferingFloatingBar.enabled` = `cta.tappable && !submitting`.
- `mingla-business/src/components/event/PublicEventPage.tsx` (+7/−2) — `handleProceedToCart` empty-selection early-return removed (waitlist branch + not-bookable toast guards preserved); pushes to the cart step (i) at 0 selected (empty seed → bare checkout path).
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (+~40/−12) — `handleProceedToCart` empty-selection early-return removed (cart opens to the tier list at 0); `floatBarBottom` gorhom-overshoot lift; `reserveBarClearance = 177 + insets.bottom`; `nativeFloatWrap` `bottom: 0` removed (now set inline to `floatBarBottom`).
- `packages/offering-rendering/__tests__/orch_1167_r3_pills_button_polish.test.ts` (new) — 14 assertions (9 runtime-logic for change 3 + 5 source-structural for changes 1/2/3-host/4).

NOT touched (no edit needed, minimal footprint): `FoundationEventPreview.tsx` (forwards props unchanged), `packages/offering-rendering/index.ts` (exports unchanged — no additive export needed).

## 4. Data-model / RPC / edge functions

NONE. UI-only — no migration, no RPC, no view, no RLS, no edge function, no pricing-engine, no package-config change.

## 5. Regression tests added

`packages/offering-rendering/__tests__/orch_1167_r3_pills_button_polish.test.ts` — run: `cd mingla-business && npx jest --roots=../packages --testPathPattern="orch_1167_r3"` → **14/14 PASS**.

- **Change 3 (runtime-logic, 9 tests):** uses the PURE `resolveOfferingCta` (imported directly from `../../event-rendering/offeringCta` to avoid the RN barrel under node-env) + the exact post-R3 enable predicate. Proves: on-sale buy + free are tappable/enabled at 0 selected; submitting still disables; not-bookable / cancelled / past / pre-sale / sold-out(no-waitlist) / door-only stay GATED at 0 selected; sold-out-with-waitlist stays tappable.
- **Changes 1/2/3-host/4 (source-structural, 5 tests):** date row is full-width (`width: "100%"`, testID present, no `<MetaChip`); every pill uses `accentWash` (no `accent ? accentWash : surface.card` ternary); the body predicate dropped `selectedQty > 0`; neither host has `if (!anySelected) return;`; the consumer float wrapper uses `floatBarBottom` (gorhom-overshoot math), not flat `bottom: 0`.

### Fails-on-revert (proven by TRUE LINE-LEVEL REVERT)

| Change | Revert applied | Result |
|--------|----------------|--------|
| 2 | restore `accent ? accentWash : surface.card` Pill branch | "all pills solid fill" assertion FAILS → restore PASS |
| 3 (box/bar) | re-add `&& (kind === "waitlist" \|\| selectedQty > 0)` | "empty-selection gate removed" assertion FAILS → restore PASS |
| 1 | rename/remove `orch-1167-date-row` testID | "date row full-width" assertion FAILS → restore PASS |
| 4 | restore flat `bottom: 0` / `paddingBottom` wrapper | "consumer float bar lifted" assertion FAILS → restore PASS |

All four restored to 14/14 PASS after each revert experiment.

## 6. Gate + test results

- **5 ORCH-1167 strict-grep gates:** `allin-price-in-ticket-box`, `canonical-9-section-order`, `one-read-rpc`, `shell-agnostic-body`, `city-level-map-no-exact-pin-when-hidden` — ALL PASS + ALL `--self-test` PASS.
- **9-section gate anchors:** all 7 in-body anchors present + in order (verified) — the date-row split kept the `(3) Date & time meta chips` comment + `orch-1167-pills-row` testID order intact.
- **jest:** `orch_1167_r2_layout_polish` (6) + `orch_1167_event_box_totals` (4) + `orch_1167_r3_pills_button_polish` (14) = **24/24 PASS**; business `orch_1167_cart_seed.adversarial` **10/10 PASS** (incl. "empty selection → bare checkout path").
- **typecheck:** the `offering-rendering` package's own tsconfig → **0 errors** (`EventOfferingBody.tsx` clean); `ConsumerEventDetailScreen.tsx` → **0 errors** under app-mobile tsconfig; business adapter files (`PublicEventPage.tsx`, `FoundationEventPreview.tsx`) → **0 errors** under business tsconfig. (The cross-package "Cannot find module 'react'" cascades seen when typechecking `packages/*` via the BUSINESS tsconfig are pre-existing monorepo config behavior — the packages aren't in the business tsconfig's module resolution — NOT introduced here; the package's own tsconfig resolves react and is clean.)

## 7. Cross-surface impact

| # | Surface | Affected | Parity |
|---|---------|----------|--------|
| 1 | Consumer iOS | YES — date row full-width, solid pills, button-at-0, float bar bleed fix | shared body + consumer shell |
| 2 | Consumer Android | YES — same (opaque-glass intact) | shared body + consumer shell |
| 3 | Buyer/anon Web | YES — date row full-width, solid pills, button-at-0 (float bar unchanged) | shared body + web adapter |
| 4 | Business iOS | YES — date row full-width, solid pills, button-at-0 | shared body + web adapter |
| 5 | Business Android | YES — same | shared body + web adapter |
| 6 | Admin Web | NO | n/a |
| 7 | RSVP / trip / experience | NO — standard-event branch only | n/a |

## 8. Smoke result

No simulator/device run this turn (UI-only structural/style change). Verified via: 5 strict-grep gates + self-tests PASS, 24/24 package jest + 10/10 business cart-seed adversarial PASS, package + consumer + business tsc clean on the touched files, and fails-on-revert proven for all 4 changes. Device/sim verification (consumer notched-device float-bar full visibility + last-section clearance, solid-pill render under a light + dark brand theme, button-at-0 → cart on every surface, desktop ≥1024px unaffected) is for the tester.

## 9. Known issues / deferred

- No `[TRANSITIONAL]` code added.
- `FoundationEventPreview` deliberately untouched (props forwarded; R2 contract preserved).
- The 9 "failed" offering-rendering jest suites are pre-existing Deno test files (`Deno.test`) jest cannot run — RSVP/close-X, unrelated to standard-event; flagged in R2, unchanged here.

## 10. Operator action required

- NONE for DB / edge (UI-only).
- Route to mingla-tester for the 5 primary surfaces (esp. consumer notched-device float-bar visibility + button-at-0 → cart + solid-pill theme contrast). Then orchestrator REVIEW/CLOSE. Do NOT deploy / merge / OTA from this worktree.

## 11. Discoveries for Orchestrator

- COMMS-0040 (RSVP page standardization, WARN) acknowledged: my edits touch ONLY the standard-event (`event_type==='event'`) branch of `ConsumerEventDetailScreen` + the shared `EventOfferingBody` — NOT `RsvpPublicBody`, NOT the RSVP branch, NOT any RSVP/experience/trip body. No conflict with the imminent `RsvpPublicBody`→`packages/` move.
- The cross-package react-resolution tsc cascade (packages typechecked via the business tsconfig report `Cannot find module 'react'` → every binding becomes `any`) is a pre-existing monorepo tsconfig nuance, not a regression. Typecheck packages with their own tsconfig (`packages/offering-rendering/tsconfig.json`) to get a true read.

# IMPLEMENTATION — ORCH-1117 · Public Offering Page UX/Design Polish

**Status:** implemented and verified (gates green; native runtime dead-tap / scroll proof deferred to TEST per spec §7)
**Author:** mingla-implementor
**Date:** 2026-06-12
**Branch:** `ORCH-1117-offering-page-polish` @ `9e1fafcfc`
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1117-[offering-page-polish]`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1117_OFFERING_PAGE_POLISH.md`
**HARD merge gate:** MUST merge AFTER ORCH-1116 (RLS for `pg_brand_can_charge`), then rebase. Orchestrator owns ordering.

---

## 1. Summary

Shipped the four buyer-facing polish changes + trip `bookable` plumbing across the six concrete surfaces, exactly to the spec's §8 order and §11 allowlist:

1. **White-theme legibility (#1)** — the date eyebrow and recurrence "Show all" pill on the shared `PublicEventPage` now read from the luminance-aware palette (`palette.accent` / `palette.primaryText`) instead of raw `#ffffff`, so they no longer vanish white-on-near-white on a light brand theme.
2. **Collapsible About (#2)** — collapsed-by-default (3-line peek + chevron + "Read more") on all six surfaces; ≤160-char copy renders full with no toggle; reduce-motion aware.
3. **Floating Buy CTA (#3)** — a persistent bottom bar on every surface, driven by ONE hoisted state machine (`resolveOfferingCta`). Tappable Buy routes to the existing checkout/cart; every non-buyable state is a NON-tappable info strip (no dead taps). On single-ticket trips/experiences the inline Reserve/Get-spot CTA was removed (locked rule) so the bar is the only CTA.
4. **Title shadow removal (#4)** — the heavy `0,2 / r10 / 28%-black` `titleLine` shadow is gone.
5. **Trip `bookable` plumbing** — `resolveTripBookable` (fail-open `pg_brand_can_charge`) added to the web trip hook AND (OQ-C) the native trip-detail hook.

No money/checkout/DB/edge-function code changed — the bars reuse existing navigation and the existing `pg_brand_can_charge` RPC.

---

## 2. SPEC success-criteria coverage

| SC | Verified how | Result | Commit |
|----|--------------|--------|--------|
| SC-1-WEB (legibility) | Date eyebrow → `palette.accent`, pill → `palette.primaryText`; unit proves near-white page resolves a dark foreground ≥4.5:1; R1 grep guard green | ✓ | `e30eb8f32` |
| SC-1-NATIVE (exp inherit) | Same shared file; EXP-NATIVE renders via the package | ✓ (inherits) | `e30eb8f32` |
| SC-2-ALL (collapsed default) | Package `aboutCollapsed=useState(true)` + 3-line clamp + 160-char exception (EVT-WEB/EXP-NATIVE); `CollapsibleDescription` (TRIP-WEB/EXP-WEB); inline collapsible (TRIP-NATIVE); copy/chevron standardized (EVT-NATIVE) | ✓ | `e30eb8f32` (pkg), `119f0ccff` (web), `777cb3987` (native) |
| SC-3-WEB-BUY (event) | Adapter bar reuses `onBuyTicket` → `router.push(checkoutPublicPath(event.id))` (`/checkout/{eventId}`) | ✓ | `119f0ccff` |
| SC-3-WEB-TRIP / -EXP | Inline Reserve/Get-spot Pressables removed; route floating bars own `tripCheckoutPath` / `experienceCheckoutPath` | ✓ | `119f0ccff` |
| SC-3-UNAVAIL-WEB | `FloatingOfferingBar` unavailable branch is a `accessibilityRole="text"` strip with NO `onPress` | ✓ | `119f0ccff` |
| SC-3-NATIVE-NODEADTAP | Native bar non-tappable strips fire nothing; tappable Buy → `beginBooking` → cart/409-toast (never dead-ends). **Runtime/device proof = TEST.** | ✓ source / RUNTIME-deferred | `777cb3987` |
| SC-3-ANDROID | Every bar fill `Platform.select` opaque ≥0.92 (`#16181b`/`#f4f6f9`/`rgba(16,18,22,0.98)`), `overflow:hidden`/clipped, `elevation:0` on Android | ✓ | `119f0ccff`, `777cb3987` |
| SC-4-WEB (shadow) | `titleLine` style has no `textShadow*`; unit asserts | ✓ | `e30eb8f32` |
| SC-5 (trip bookable) | `usePublicTripBySlug` returns `bookable`; paid+RPC-false → false; free → true (no RPC); RPC error → true | ✓ | `dadc2ecd0` |

---

## 3. Files changed (commit hashes)

| Surface / layer | File | Commit |
|---|---|---|
| Package | `packages/event-rendering/offeringCta.ts` (NEW) | `e30eb8f32` |
| Package | `packages/event-rendering/PublicEventPage.tsx` (#1/#2/#4 + `contentBottomInset` + delegate computeVariant + `resolveOfferingSurface`) | `e30eb8f32` |
| Package | `packages/event-rendering/index.ts` (exports) | `e30eb8f32` |
| Package | `packages/event-rendering/types.ts` (`contentBottomInset?`) | `e30eb8f32` |
| Business service | `mingla-business/src/constants/publicUrls.ts` (`experienceCheckoutPath/Url`) | `dadc2ecd0` |
| Business hook | `mingla-business/src/hooks/usePublicTripBySlug.ts` (`resolveTripBookable` + `bookable`) | `dadc2ecd0` |
| Business web | `mingla-business/src/components/offering/FloatingOfferingBar.tsx` (NEW) | `119f0ccff` |
| Business web | `mingla-business/src/components/offering/CollapsibleDescription.tsx` (NEW) | `119f0ccff` |
| Business web | `mingla-business/src/components/trip/TripPreview.tsx` | `119f0ccff` |
| Business web | `mingla-business/src/components/experience/ExperiencePreview.tsx` | `119f0ccff` |
| Business web | `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (inline CTA removed) | `119f0ccff` |
| Business web | `mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx` (inline CTA removed) | `119f0ccff` |
| Business web | `mingla-business/src/components/event/PublicEventPage.tsx` (mount bar) | `119f0ccff` |
| Business web | `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | `119f0ccff` |
| Business web | `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` | `119f0ccff` |
| App-mobile | `app-mobile/src/components/offering/FloatingOfferingBar.tsx` (NEW) | `777cb3987` |
| App-mobile | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (scroll-sibling bar) | `777cb3987` |
| App-mobile | `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` (reserveFooter upgrade + collapsible) | `777cb3987` |
| App-mobile | `app-mobile/src/hooks/useConsumerTripDetail.ts` (OQ-C bookable) | `777cb3987` |
| App-mobile | `app-mobile/src/components/expandedCard/EventDetailLayout.tsx` (#2 copy/chevron only) | `777cb3987` |
| CI | `.github/scripts/strict-grep/orch-1117-no-raw-white-on-palette-surface.mjs` (NEW) + workflow job | `9e1fafcfc` |
| Tests | `mingla-business/src/components/offering/__tests__/offeringCta.orch1117.test.ts` (NEW) | `9e1fafcfc` |
| Tests | `mingla-business/src/components/offering/__tests__/offeringLegibility.orch1117.test.ts` (NEW) | `9e1fafcfc` |
| Tests (append-only) | `mingla-business/src/components/event/__tests__/PublicEventPage.closeButton.adversarial.test.tsx` (mock additions, 0 deletions) | `9e1fafcfc` |

---

## 4. Data-model changes applied

None. No migration, no edge function, no RLS change. The trip `bookable` resolvers (web hook + native hook) only CONSUME the existing anon-granted `pg_brand_can_charge` RPC (ORCH-1116 owns its RLS).

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- `mingla-business/src/components/offering/__tests__/offeringCta.orch1117.test.ts` — 11 tests (resolveOfferingCta buy/unavailable/sold-out/waitlist/free/past + custom verb; computeOfferingVariant).
- `mingla-business/src/components/offering/__tests__/offeringLegibility.orch1117.test.ts` — 8 tests (WCAG contrast on a near-white page; raw-white-is-below-AA; render body has no raw white; titleLine has no textShadow*; About collapsed-by-default + 3-line clamp + 160 threshold).
- CI guard `orch-1117-no-raw-white-on-palette-surface.mjs` — self-test PASSED + gate PASSED.

**fails-on-revert verified at `e30eb8f32`** by TRUE LINE DELETION of the `if (!bookable) { return unavailable }` gate at the top of `resolveOfferingCta` → `offeringCta.orch1117.test.ts` went `1 failed, 10 passed` (T-CTA-UNAVAIL failed: a not-bookable paid event resolved to "buy"). Restored → `11 passed`. The R1 guard's `--self-test` independently proves it flags an injected body-level `color:"#ffffff"`.

Passing run (restored): `Test Suites: 3 passed` / `Tests: 25 passed` (offeringCta + legibility + publicUrls).

---

## 7. Old → New receipts (per surface)

### packages/event-rendering/PublicEventPage.tsx
- **Before:** date line + recurrence pill hardcoded `color:"#ffffff"`; `titleLine` carried a heavy textShadow; About always fully expanded; `computeVariant` was a private copy of the variant logic.
- **Now:** date → `palette.accent`, pill → `palette.primaryText` (both AA-safe via the existing palette); textShadow deleted; About collapsed-by-default (text-glyph chevron, 160-char exception, reduce-motion); `computeVariant` delegates to the shared `computeOfferingVariant`; `PublicTicketRow` reuses the shared sub-predicates; new `contentBottomInset` prop + exported `resolveOfferingSurface`.
- **Why:** SC-1/#1, SC-4/#4, SC-2/#2, single-owner state machine (§4.0).
- **Lines:** ~130 changed/added.

### packages/event-rendering/offeringCta.ts (NEW)
- **New:** `resolveOfferingCta` (the single buy/unavailable state machine), `computeOfferingVariant`, and the shared `ticketSaleEnded/ticketIsSoldOut/ticketIsDoorOnly` sub-predicates.
- **Why:** §4.0 — both the inline row and every host floating bar consume ONE owner.

### mingla-business/src/components/event/PublicEventPage.tsx
- **Before:** rendered the shared page + chrome + waitlist sheet; no bar.
- **Now:** mounts `FloatingOfferingBar` (state from `resolveOfferingCta`, surface from `resolveOfferingSurface`), reuses `onBuyTicket`'s `/checkout/{eventId}` nav + the `!bookable` toast guard, reserves `contentBottomInset`.
- **Lines:** ~55 added.

### TripCheckoutFlow.tsx / ExperienceCheckoutFlow.tsx
- **Before:** each rendered an inline Reserve/Get-spot Pressable + owned the `router.push` to its checkout chain.
- **Now:** the inline Pressable + its styles are REMOVED; the tier/ticket recap + helper stay; the route floating bar owns the nav. The ORCH-0876 trip-chain invariant (never the events `/checkout/{id}`) is documented in a comment and preserved by the route's `tripCheckoutPath`.
- **Lines:** ~30 removed each.

### app-mobile ExpandedBusinessEventSheet.tsx / ConsumerTripDetailScreen.tsx
- **Before:** EBES had no bar (only the cart on row tap); the trip screen had a hand-built `reserveFooter` (Reserve / "Bookings closed").
- **Now:** EBES renders `FloatingOfferingBar` as the LAST in-flow child of the bare scroll (F-B scroll sibling, not stickyFooter); the trip `reserveFooter` is upgraded to the standardized contract + a non-tappable "Booking unavailable" strip when `detail.bookable===false`; the trip description is collapsible.
- **Lines:** ~70 added across both.

### EventDetailLayout.tsx (external, F-A)
- **Before:** "More"/"Less" i18n toggle, no chevron.
- **Now:** "Read more"/"Show less" + chevron Icon + a11y `expanded` state. No floating Buy bar (external ticket URL).

---

## 8. Cross-surface impact

| Surface | Affected | What / parity |
|---|---|---|
| Consumer iOS | YES | #1/#2/#4 via shared pkg; #3 bar on brand-event/exp sheet + trip screen (scroll siblings). MANUAL native bar. |
| Consumer Android | YES | Same + opaque ≥0.92 bar fill, no shadow. MANUAL `Platform.select`. |
| Buyer/anon Web | YES | #1 + #2 + #3 + #4; inline single CTAs removed on trip/exp. Event body via shared pkg automatic; trip/exp web bars MANUAL. |
| Business iOS | NOT directly | Inherits shared public components when previewing. Automatic. |
| Business Android | NOT directly | Same + inherited Android opaque fallback. Automatic. |
| Admin Web | NOT covered | Admin has no public offering page. |
| Business Web preview | YES (inherited) | Sees the polished page + bar; bar bookable state reflects own brand readiness. Automatic. |

---

## 9. Smoke result

- Jest (business): `offeringCta.orch1117` 11/11, `offeringLegibility.orch1117` 8/8, `publicUrls` PASS. fails-on-revert proven by line-deletion.
- R1 strict-grep guard: self-test PASSED + gate PASSED. `i-bottomsheet-inline-scroll-binding` gate PASSED.
- TypeScript: `tsc --noEmit` shows ZERO errors in any ORCH-1117 file (business + app-mobile). Remaining repo-wide tsc errors are pre-existing and unrelated (cross-package react resolution, marketing composer, checkout buyer `any` params, `category` test types).
- App-mobile node:assert source tests (ORCH-1016 trip detail rework + adversarial + intake renderer): 21 + 18 + 14 checks PASS — my native edits don't regress them.
- No actual `stickyFooter` prop usage anywhere I touched (only NEVER-constraint comments).
- **NOT run by me (deferred to TEST per spec §7):** device runtime proof for T-DEADTAP (tap every non-buyable bar state on device — Constitution #1) + T-NATIVE-SCROLL (sheet scrolls fully with the bar pinned, swipe-down dismisses) + T-ANDROID-OPAQUE (visual no-ghosting). Source wiring is in place; runtime proof is the tester's gate.

---

## 10. Known issues / deferred

- **OQ-B (deferred per orchestrator scope call):** the native brand-event/exp `bookable===false` pre-emptive info-strip is NOT shipped — the `BusinessEventCard` discover supply lacks `bookable` and threading it would pull the discover-cards path into scope. The native brand sheet bar ships its tappable states; a not-ready paid brand relies on the existing checkout 409 → cart toast (never dead-ends). Web surfaces DO render the full unavailable state. Flag to orchestrator: confirm deferral or authorize a follow-on.
- **OQ-C (resolved — implemented):** the native trip-detail hook DID lack `bookable`; added `resolveTripBookable` there (it's the hook's own anon-direct fetch + `ev.brand_id`, NOT the discover supply).
- Native dead-tap / scroll / Android-opaque runtime proof is the tester's (spec §7/§9).

---

## 11. Operator action required

- **Migration:** none.
- **Edge deploy:** none.
- **Merge ordering (HARD):** do NOT merge this branch until **ORCH-1116** is on `main`; then rebase this branch onto it. Before ORCH-1116, the trip/event/exp `bookable` boolean is unreliable for anon/non-owner buyers (resolvers fail-open, so it degrades to "always bookable" + the checkout-409 backstop — safe but the unavailable state won't fire correctly).
- **At CLOSE:** flip `I-PROPOSED-NO-RAW-WHITE-ON-PALETTE-SURFACE` to ACTIVE (the R1 guard + workflow job are already in place).

---

## 12. Discoveries for Orchestrator

1. **STOP-AND-AMEND — ORCH-0876 adversarial test conflict (needs `[TEST-MOD-APPROVED ORCH-1117]`).** `mingla-business/src/components/trip/__tests__/ORCH-0876.adversarial.test.ts` A2 pins `router.push(\`/checkout-trip/${trip.id}\` as never)` as a SOURCE grep inside `TripCheckoutFlow.tsx`. ORCH-1117's LOCKED decision (§4.5) removes that inline nav (it moved to the route's floating bar via `tripCheckoutPath`). I restored a comment so the SECOND assertion (cites ORCH-0876 + `eventType.filter.audit.test.ts`) passes again, but the FIRST `router.push` grep can only pass if the inline nav is re-added — which contradicts the spec. **The trip-chain INVARIANT is preserved** (the route now does `router.push(tripCheckoutPath(trip.id))` → `/checkout-trip/{id}`, never the events chain). The ORCH-0876 assertion must be re-pointed at `app/t/[brandSlug]/[tripSlug].tsx`; that is a cross-ORCH test edit requiring orchestrator `[TEST-MOD-APPROVED]`. I did NOT touch the ORCH-0876 test.

2. **Pre-existing RED test (NOT introduced by ORCH-1117): `PublicEventPage.closeButton.adversarial.test.tsx`** was already 6/6 failing on the origin/main baseline (verified by stashing all my changes — still 6/6 red on `useThemeFont` from ORCH-1083 + an incomplete `designSystem` mock). My append-only mock additions (FloatingOfferingBar case + new package-export stubs + a useThemeFont stub) are necessary for my change but do not fully repair the unrelated pre-existing `semantic`/`text` mock gap. Recommend a small follow-on to complete that test's `designSystem` mock.

3. **Pre-existing RED test (NOT introduced by ORCH-1117): `OfferingParity.test.ts`** asserts `<OfferingManageSheet` in `app/(tabs)/hub/trips.tsx` / `hub/experiences.tsx` — files I never touched. Pre-existing failure unrelated to this ORCH.

# IMPLEMENTATION — ORCH-1138 Leg 1C: Consumer Trip Surface → Direction-A Parity

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on `ORCH-1138-trip-page-redesign` (lands on the SAME branch/PR as Leg 1 — the trip page now ships "done on ALL surfaces": web + business iOS/Android + consumer app).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1138_LEG1C_CONSUMER_TRIP_PARITY.md`
**INVESTIGATION:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1138_LEG1C_CONSUMER_TRIP_PARITY.md`
**Status:** implemented and verified (source + gates + fails-on-revert); the floating-bar-no-scroll-freeze + bold-on-native render are **device-owed to Seth on the consumer dev OTA** (see §9 — not source-decidable).

---

## 1. Summary

The consumer app's trip detail (`ConsumerTripDetailScreen`, rendered in the gorhom bottom sheet) was a bespoke dark, un-themed body with a Reserve bar that scrolled off. It now renders the **same Direction-A look as the business/web public trip page** by REUSING the shared `@mingla/offering-rendering` primitives (NOT forking, NOT importing the business `TripPreview`): an immersive parallax cover + body-level chrome, a brand-themed palette (resolved via the EXISTING `useEventTheme`), meta chips reading real columns, the leaving-from→destination route block, the per-day itinerary with count-aware galleries, ✓/✗ chips, a palette-themed refund ladder, and the native bold-font resolver. The **"Reserve my spot" CTA now FLOATS** stuck to the sheet bottom (Seth's explicit ask), wired to the EXISTING consumer native checkout unchanged. No business/web edit, no shared-package edit, no consumer-checkout change, **no schema/edge change**.

**Map decision (OQ-1):** DEFERRED on consumer (decision A) — the consumer trip data carries NO destination lat/lng (INVESTIGATION F-4, re-confirmed: `useConsumerTripDetail` selects a fixed `events` column list with no geo / no `theme.business_trip` JSON). The "Where you'll be" section is omitted (rule 9 — no fabricated tile). Flagged as a data-path parity gap vs the business/web page (§10).

**Refund ladder (OQ-2):** PORTED the palette-themed ladder (decision: port for parity) — new app-local `ConsumerRefundLadder` mirrors the business FOUNDATION `RefundLadder` off the consumer's real `refundPolicy.tiers`, themed to the brand palette (the old shared `RefundPolicyDisplay` hardcoded warm-orange).

**Floating bar (OQ-3):** implemented the SPEC-mandated absolute-overlay-inside-shell approach (NOT `stickyFooter`) — see §4. Device verification of no-scroll-freeze is owed to Seth (§9).

---

## 2. SPEC success-criteria coverage

| SC | Status | How verified |
|----|--------|--------------|
| SC-1 (`@mingla/offering-rendering` resolves in app-mobile) | ✓ | `metro.config.js` + `tsconfig.json` aliases added (mirror event-rendering verbatim); the screen imports `ParallaxCoverShell`/`ChipGroup`/`CountAwareGallery`; package entry resolves via Node (`packages/offering-rendering/index.ts`, `main: index.ts`). Tests T1a/T1b/T1c. |
| SC-2-iOS / SC-2-Android (immersive parallax cover + brand-palette body + chips + route + galleries + refund; no raw `#FF6B35`/`#eb7825` in the foundation body) | ✓ source / device-owed | The populated body composes `ParallaxCoverShell` fed `palette` from `createThemePalette(theme)` + `offeringSurfaceStyles(palette)`; all themed text/surfaces use `palette.*`/`surface.*` (no literal accent in the foundation body — `ACCENT`/`WARM` remain ONLY for the loading/error state bodies + the unchanged HOW-YOU-PAY module). Tests T2a/T2b/T2c. Visual device check owed (§9). |
| SC-3 (consumer palette == business palette for the same trip) | ✓ | Both resolve via the same brand theme columns through `createThemePalette(theme)`; the consumer reads them via `useEventTheme(card)` → `business_public_events_view` (anon view, the SAME columns the business page resolves). Test T2b. |
| SC-4-iOS / SC-4-Android (Reserve CTA PINNED/floats, does not scroll off; body still scrolls; pan-down dismisses) | ✓ source / **device-owed** | `ConsumerTripReserveBar` is a `position:"absolute" bottom:0` overlay sibling of the shell inside a `flex:1` host; the shell gets `ScrollComponent={BottomSheetScrollView}` so gorhom owns the single registered scrollable (no nesting, no freeze). Tests T3a/T3b/T3c + R1f/R1f-2. **Scroll-not-frozen + pan-down dismiss MUST be device-checked (§9).** |
| SC-5 (tap floating Reserve → `ExpandedBusinessEventSheet` → `runNativeCheckout`; plan trip forwards `paymentPlanChoice`; byte-identical checkout) | ✓ | The bar's `onPress` calls the SAME `setReserveSheetVisible(true)`; the `ExpandedBusinessEventSheet` block (incl. `paymentPlanChoice={detail.hasPlan ? … }` + `dueTodayCents`) is UNCHANGED. Tests T4a/T4b. |
| SC-6 (every state renders without crash; sold-out/closed/unavailable → correct disabled bar; theme-absent → MINGLA default) | ✓ source | Loading/error/not-found bodies kept as-is; populated states map to `CtaState` (`unavailable` for closed/sold-out/booking-unavailable; `free`/`buy` otherwise); theme-absent → `resolveTheme(null,null)` → MINGLA default palette (never a crash). |
| SC-7 (bold text renders bold on native — weighted family loaded + applied) | ✓ source / **device-owed** | `useConsumerThemeFont(theme.fontFamilyValue)` + `useConsumerThemeFont(boldFontFamily(theme))` load the medium + 700-weight families on demand; every themed-bold element sets `fontFamily: boldFamily`. Tests T5a/T5b. **Bold-renders-bold device check owed (§9).** |
| SC-8 (rule 9 — sparse trip renders zero nodes for absent sections; map absent) | ✓ | The adapter returns null/[] for absent fields; the JSX guards every section; `CountAwareGallery` renders zero nodes for empty media; the map is omitted. Tests T6c/T6d + behavioral replicas T7/T8. |

---

## 3. Files changed

| File | Type | Δ (approx) |
|------|------|-----------|
| `app-mobile/metro.config.js` | M | +9 (offering-rendering `extraNodeModules` alias) |
| `app-mobile/tsconfig.json` | M | +2 (offering-rendering `paths`) |
| `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | M | populated body re-rendered onto the foundation + floating bar; net ≈ −120 (removed bespoke hero/meta/refund/reserve render + dead styles, added foundation composition) |
| `app-mobile/src/hooks/useConsumerTripFoundation.ts` | A (new) | +210 (pure data-adapter: `mapConsumerTripToFoundation`, `deriveTripDuration`, seats/route/chips mapping) |
| `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` | A (new) | +245 (the FLOATING absolute-overlay reserve bar; `CtaState`-driven; ANDROID opaque fill) |
| `app-mobile/src/components/offering/ConsumerRefundLadder.tsx` | A (new) | +210 (palette-themed refund ladder — OQ-2 port) |
| `app-mobile/src/theme/consumerThemeFonts.ts` | A (new) | +110 (consumer-local theme-font module thunks — 14 medium + 11 bold) |
| `app-mobile/src/theme/useConsumerThemeFont.ts` | A (new) | +88 (consumer-local on-demand expo-font loader, mirrors business `useThemeFont`) |
| `app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts` | A (new) | +260 (26-check regression test) |
| `app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx` | M (retarget) | R1f/R1f-2/R1f-2b/R1f-3/R1f-4 retargeted to the foundation+floating-bar shape (SPEC §9, allowlisted) |
| `app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx` | M (retarget) | T-14e/T-NULL-a/T-NULL-b/T-NULL-c/T-19a retargeted to the adapter/shell shape ([TEST-MOD-APPROVED ORCH-1138]) |
| `app-mobile/src/screens/Trip/__tests__/orch1119_trip_day_media_gallery.test.tsx` | M (retarget) | T3/T4 source assertions retargeted to the shared `CountAwareGallery` delegation ([TEST-MOD-APPROVED ORCH-1138]) |

---

## 4. The floating reserve + scroll-freeze mitigation (the central runtime concern)

**Mechanism (SPEC §4.5, mandated approach):**
- The populated sheet runs `scrollMode="view"` and mounts a single `flex:1` host (`styles.foundationHost`) containing `<ParallaxCoverShell>` + `<ConsumerTripReserveBar>`.
- `ParallaxCoverShell` is given **`ScrollComponent={BottomSheetScrollView}`** (the gorhom scroll host re-exported from `BaseBottomSheet`). The shell's native branch uses that as its single internal scrollable → **gorhom owns the SINGLE registered scrollable**. No raw RN `<ScrollView>` is nested in the sheet (the exact ORCH-1016 trap), and there is no second scrollable.
- The floating bar is a **`position:"absolute" bottom:0` overlay SIBLING** of the shell (mirror of the business `TripReserveBar.styles.wrapper`), layered above the scroll via `zIndex:6` (below the shell's `CHROME_Z=70`). It is NOT BaseBottomSheet's `stickyFooter` prop — `stickyFooter` would route gorhom into the nested-`BottomSheetView` viewport==content config that froze the trip detail in ORCH-1016 (and the shell's `nativeHost` would become the single `stickyBody`, nesting gorhom's scroll inside the shell's own ScrollComponent → re-freeze). The absolute-overlay path avoids both nestings.
- `contentBottomInset={96 + safeBottom}` on the shell reserves scroll clearance so the last content row clears the floating bar.

**Why this preserves the ORCH-1016/1043 invariants:** the gorhom scrollable stays the single registered scrollable as the shell's `ScrollComponent`; the `BaseBottomSheet` primitive is UNTOUCHED (the `i-bottomsheet-inline-scroll-binding` + `orch-1043-sheet-scroll-viewport-check` gates both PASS — they scope to the primitive). The retargeted `R1f-3` + the new T3b/T3c lock the no-`stickyFooter` + `ScrollComponent={BottomSheetScrollView}` shape so a revert re-fails.

**Device verification owed (OQ-3):** the no-scroll-freeze + pan-down-dismiss on BOTH the in-app overlay path and the cold deep-link route is the one runtime unknown the SPEC named as `probable`, not `proven`. It is NOT source-decidable. See §9.

---

## 5. Data-model changes applied

**NONE.** No migration, no schema change, no RLS change. Theme/brand resolve via the existing anon-safe `useEventTheme` → `business_public_events_view` (🔒 COMMS-0009 — no `.from('brands')` added anywhere; gate-tested T6a).

---

## 6. Edge functions touched

**NONE.** The consumer checkout (`ExpandedBusinessEventSheet` → `runNativeCheckout` → `ticket-checkout-create`) is unchanged. No edge function to deploy for this leg.

---

## 7. Regression tests added + fails-on-revert

**New (append-only):** `app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts` — 26 checks PASS (foundation import wiring, brand-themed render via useEventTheme, floating-bar absolute-overlay + ScrollComponent gorhom binding, checkout-unchanged, bold-on-native resolver, anon-safe + package-isolated adapter, rule-9 omission incl. deferred map, + behavioral replicas of `deriveTripDuration` and the seats-label derivation, + the 3-surface DRAFT-invariant check).

**fails-on-revert verified at the working tree (true LINE DELETION, NOT comment-out):** deleting the JSX line `ScrollComponent={BottomSheetScrollView}` from `ConsumerTripDetailScreen.tsx` → **T3c FAILS** in `orch_1138_consumer_trip_foundation.test.ts` AND **R1f-2 FAILS** in `orch_1016_consumer_trip_detail.rework_sheet.test.tsx`; restoring the line → both PASS again. (The screen's doc comment was reworded so the literal appears only at the JSX prop, defeating a comment-match false-positive.)

**Retargeted (allowlisted / [TEST-MOD-APPROVED ORCH-1138]):**
- `orch_1016_consumer_trip_detail.rework_sheet.test.tsx` — 21 checks PASS (R1f* now guard the foundation + floating-bar shape; SPEC §9).
- `orch_1016_consumer_trip_detail.adversarial.test.tsx` — 18 checks PASS (T-14e/T-NULL/T-19a retargeted to the adapter/shell shape; behaviors preserved).
- `orch1119_trip_day_media_gallery.test.tsx` — 11 checks PASS (T3/T4 source assertions retargeted to the `CountAwareGallery` delegation; behavioral replicas of zero-nodes + one-playing intact).

**Other Trip/nav tests (regression, unchanged-and-green):** `orch_1016_nav_container_clearance.test.tsx` — 7 checks PASS.

---

## 8. Old → New receipts

### ConsumerTripDetailScreen.tsx
- **Before:** populated body = bespoke flat 320px hero + `EventCoverMedia` + hardcoded `ACCENT="#FF6B35"`/`WARM="#eb7825"` dark body (title, meta rows, refund via shared `RefundPolicyDisplay`, hand-rolled day-media `ScrollView` gallery, tiers list, HOW-YOU-PAY); Reserve bar = the second child of a bare `scrollMode="scroll"` sheet (scrolls off, doesn't float).
- **After:** populated body = `ParallaxCoverShell` (immersive parallax cover + OfferingChrome + brand palette) composed inside a `scrollMode="view"` sheet, with the adapter-mapped sections (lead/title, meta chips, brand chip, route block, about, day-by-day via `CountAwareGallery`, ✓/✗ via `ChipGroup`, palette-themed `ConsumerRefundLadder`, the UNCHANGED HOW-YOU-PAY module); the Reserve CTA is the absolute-overlay `ConsumerTripReserveBar` that FLOATS. Loading/error/not-found states kept as-is. Theme resolved via `useEventTheme(card)` + `createThemePalette` + `offeringSurfaceStyles` + `boldFontFamily` + the consumer font loader.
- **Why:** SPEC §4.2–§4.5 — full Direction-A parity by converging on the shared primitives + the floating reserve (Seth's explicit ask).
- **Lines:** ~−120 net (subtract bespoke render + dead styles; add foundation composition).

### useConsumerTripFoundation.ts (new) / ConsumerTripReserveBar.tsx (new) / ConsumerRefundLadder.tsx (new) / consumerThemeFonts.ts (new) / useConsumerThemeFont.ts (new)
- **Before:** did not exist.
- **After:** the pure data-adapter, the floating absolute-overlay reserve bar, the palette-themed refund ladder, and the consumer-local on-demand theme-font loader.
- **Why:** SPEC §4.2/§4.3/§4.5 + OQ-2; reuse the shared primitives at the package layer (no business import).
- **Lines:** ~+863 combined.

---

## 9. Smoke result + device verification (HONEST)

- **Static/build:** `@mingla/offering-rendering` resolves via Node (`packages/offering-rendering/index.ts`); Metro is running on :8081 (from the active worktree session — NOT restarted to avoid disrupting the parallel session). My `metro.config.js` alias takes effect on a Metro restart in THIS worktree.
- **Typecheck:** all 6 touched app files typecheck CLEAN under `app-mobile/tsconfig.json`. (Package-internal `react`-resolution errors for `packages/offering-rendering/*` are a PRE-EXISTING baseline class — `packages/event-rendering/*` produces the identical errors through the same app config; the packages have their own `tsconfig.json` for standalone checking. Not introduced here, not CI-gated.)
- **Lint:** zero warnings on the touched files; the only remaining errors are `import/no-unresolved` for `@mingla/event-rendering` AND `@mingla/offering-rendering` — a PRE-EXISTING baseline (every `@mingla/event-rendering` importer in app-mobile, e.g. `useEventTheme.ts`, produces the identical error; the eslint config has no `@mingla/*` resolver; no CI eslint gate for app-mobile).
- **Tests:** all affected node:assert source+behavioral tests PASS (26 + 21 + 18 + 11 + 7); fails-on-revert proven by true line-deletion.
- **DEVICE — NOT DONE (owed to Seth on the consumer dev OTA):** the **floating-bar-no-scroll-freeze + pan-down-dismiss (SC-4, OQ-3)** and the **bold-renders-bold-on-native (SC-7)** are NOT source-decidable and were NOT driven on the sim this pass (a full interactive flow — login → discover → tap a brand trip → scroll/dismiss — was out of scope for a single implementor pass, and a Metro restart risked the parallel session). The SPEC named OQ-3 as the one `probable` runtime unknown with a production precedent (TicketCartSheet's sticky-footer works; the absolute-overlay path used here is even less risky — it nests nothing). **Seth must device-verify the floating-bar scroll on the consumer dev OTA; if it freezes, the SPEC §10 fallback (stickyFooter with the shell body restructured) is a SPEC amendment.**

---

## 10. Known issues / deferred

1. **Destination map DEFERRED on consumer (OQ-1A) — data-path parity gap.** The consumer trip data has no destination lat/lng (`useConsumerTripDetail` selects a fixed `events` column list; no geo / no `theme.business_trip` JSON). The business/web page shows the "Where you'll be" map; the consumer omits it (rule 9). Closing this would need OQ-1(B): widen the consumer hook's `events` select to pull the geo from `events.theme.business_trip` JSON (anon-readable — likely NO migration) + share/duplicate `mapboxStaticImage` + wire `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` into `app-mobile/app.config.ts` `extra` + the EAS build env (F-5 confirmed the token is NOT currently in app-mobile `extra`). That is a real add, gated behind Seth re-opening OQ-1(B) via amendment.
2. **No native build / OTA this pass** — pure-JS change; ships via `eas update` (consumer dev OTA) at CLOSE per the OTA policy. Bold-font + floating-bar device proof rides on that OTA.

---

## 11. Operator action required

- **None for migration/edge** (no schema/edge change).
- **Device-verify on the consumer dev OTA** (SC-4 floating-bar scroll + SC-7 bold) — see §9.
- **Commit body must cite `[TEST-MOD-APPROVED ORCH-1138]`** (3 existing tests retargeted — the append-only CI gate requires it; the SPEC §9 + §11 allowlist authorize the rework_sheet retarget, and the adversarial/orch1119 retargets are documented in §12 as a SPEC gap the foundation migration unavoidably forced).

---

## 12. Discoveries for Orchestrator

1. **SPEC §9 named only the rework_sheet test for retargeting, but TWO more existing green tests source-asserted the OLD hand-rolled consumer trip render** and broke as a direct, unavoidable consequence of the mandated foundation migration: `orch_1016_consumer_trip_detail.adversarial.test.tsx` (T-14e reserve-disabled wiring, T-NULL-a/b route legs, T-NULL-c cover, T-19a verified badge) and `orch1119_trip_day_media_gallery.test.tsx` (T3/T4 hand-rolled day gallery). I retargeted ONLY the stale source assertions to their behavior-preserving equivalents (adapter/shell shape; `CountAwareGallery` delegation), keeping all behavioral replicas intact, and cited `[TEST-MOD-APPROVED ORCH-1138]`. Flagging so CLOSE recognizes these retargets as deliberate (the underlying behaviors — rule-9 gating, no fabricated data, verified-badge gating, no-event-taxonomy-leak, zero-nodes, one-playing — are all PRESERVED, just relocated into the shared primitives). Recommend the SPEC §9 / §11 allowlist be read as covering the full set of consumer-trip-render guards, not just rework_sheet.
2. **Pre-existing strict-grep + lint baseline failures in this worktree** (16 strict-grep gates exit≠0 standalone — e.g. `i-proposed-tr2-route-by-event-type`, `tr2-safearea`, `a-brands-deleted-filter`, `orch-0756a`, env-needing `.test.mjs` TAP files; + the `@mingla/*` `import/no-unresolved` eslint errors). Confirmed IDENTICAL on HEAD without my changes (stash-compared). My change introduces ZERO new strict-grep/lint failures; the load-bearing gates (bottomsheet-scroll, package-isolation, no-web-stripe) PASS. Noted so CLOSE doesn't attribute the baseline noise to this leg.
3. **DRAFT invariant ready to flip ACTIVE at CLOSE:** `I-PROPOSED-TRIP-PAGE-SHARED-FOUNDATION-ALL-SURFACES` — the trip page now renders via `@mingla/offering-rendering`'s `ParallaxCoverShell` on web (`mingla-business /t/`), business native (TripPreview FOUNDATION), AND consumer native (`ConsumerTripDetailScreen`). Test T9 asserts the consumer + business call sites both import the shared shell. Orchestrator owns the flip.
4. **COMMS-0029/0030 (WARN, ALL):** read + factored — this leg produces NO migration/edge/deploy, so neither the `biz_update_live_trip` clobber risk (0029) nor the GIPHY-key reachability (0028) nor the iOS-build break (0030, already RESOLVED) bears on it. Not acked (not addressed to this skill/ORCH; FYI-factored).

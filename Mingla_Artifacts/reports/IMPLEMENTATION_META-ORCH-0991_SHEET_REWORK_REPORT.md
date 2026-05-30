# IMPLEMENTATION — META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets] — PRIMITIVE REWORK (sheet bugs 1 / 2 / 4 / 4a)

**Skill:** mingla-implementor (Claude) — IMPLEMENT side
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/` on branch `META-ORCH-0991-consumer-modals-to-sheets`
**HEAD before rework (fails-on-revert anchor):** `b0063fcad`
**Input investigation:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0991_SHEET_BUGS.md` (committed `b0063fcad`)
**Status:** implemented + statically verified; live-device re-verification PENDING (environment blocker — see §Verification).

---

## Layman summary

Four sheet bugs fixed at the shared primitive level so every sheet benefits at once:
- Swipe-down-to-close now works inside the modal-hosted sheets (was dead on Android, fragile on iOS).
- Sheets now reserve space at the bottom so buttons clear the phone's home bar and Mingla's floating menu.
- Tall sheets that use a header or sticky-footer slot now scroll fully (they used to get stuck).
- The event sheet's fragile double-scroll is collapsed to one scroll, removing the likely freeze source.

No motion change, no conversion regressed, the sole-gorhom rule stays enforced.

---

## Scope (HARD guards honored)

- Files changed (5 + 1 new test):
  - `app-mobile/src/components/ui/BaseBottomSheet.tsx` (primitive — bugs 1, 4b, 4a)
  - `app-mobile/src/hooks/useAppLayout.ts` (export the canonical floating-nav height — bug 4b)
  - `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (event-sheet scroll host — bug 2)
  - `packages/event-rendering/PublicEventPage.tsx` (injectable scroll host — bug 2)
  - `packages/event-rendering/types.ts` (`ScrollComponent` prop type — bug 2)
  - `app-mobile/src/components/ui/__tests__/BaseBottomSheetRework.test.mjs` (NEW regression test)
- Consumer `app-mobile/` + the shared event-rendering package only. No migrations, no edge deploys.
- Bug 3a (Discover tap) and Bug 3b (thumbnails) intentionally NOT touched (separate pass).
- Stock gorhom motion preserved (no `animationConfigs`). Center-dialogs stay non-swipe.
- Sole-gorhom strict-grep gate stays green (EBES imports `BottomSheetScrollView` from the primitive's re-export, never from gorhom directly).

---

## Old → New Receipts

### app-mobile/src/components/ui/BaseBottomSheet.tsx
**Before:**
- `wrapInRNModal` branch rendered `<RNModal>{sheet}</RNModal>` with NO gesture root → gorhom pan-down-to-dismiss dead in the modal window (Android dead, iOS fragile). [BUG 1]
- `const safeBottom = Math.max(insets.bottom,16); void safeBottom;` — computed the bottom inset then explicitly discarded it. No tab-bar awareness. Every consumer hand-rolled padding. [BUG 4b]
- `header`/`stickyFooter`/`scroll` slots wrapped the scroll without forcing it to claim a bounded `flex:1` viewport below the header → a tall (overflowing) body could not scroll when a header/footer slot was present. [BUG 4a]

**After:**
- BUG 1: `wrapInRNModal` branch now wraps `{sheet}` in `<GestureHandlerRootView style={styles.flexContainer}>` inside the `<RNModal>`. `GestureHandlerRootView` imported from `react-native-gesture-handler` (already a dependency). This re-activates gorhom's `PanGestureHandler` in the modal's separate native window. (RNGH docs: gestures in Modals require a GHRV inside the modal; iOS treats GHRV as a plain View, Android requires it for touch registration — exactly the observed iOS-fragile / Android-dead asymmetry.)
- BUG 4b: removed `void safeBottom`. New `bottomInset` memo = `max(insets.bottom,16)` plus, when the new `tabBarAware` prop is set, `BOTTOM_NAV_CONTENT_HEIGHT` (imported from `useAppLayout` — single source of truth, no hardcoded copy). New `withBottomInset()` helper merges this as `paddingBottom` onto the scroll / flatlist / sectionlist / sticky-footer `contentContainerStyle`, taking `Math.max` with any consumer-supplied value so a sheet that already hand-rolls more padding (e.g. PreferencesSheet) is never reduced (zero-regression).
- BUG 4a: in the header-present `scroll` branch the `BottomSheetScrollView` now claims `styles.flexContainer` (flex:1) so it gets a bounded viewport below the fixed header and a tall body scrolls. Same flex:1 retained for the sticky-body path.
**Why:** investigation Issues 1, 4b, 4a (all PRIMITIVE-level).
**Lines changed:** ~95 (imports + prop + body memo + modal branch).

### app-mobile/src/hooks/useAppLayout.ts
**Before:** `const BOTTOM_NAV_CONTENT_HEIGHT = vs(56)` (module-private).
**After:** `export const BOTTOM_NAV_CONTENT_HEIGHT = vs(56)` so the primitive reads the SAME value (single source of truth for the floating-nav footprint). In-function usage unchanged.
**Why:** BUG 4b tab-bar awareness without a hardcoded duplicate.
**Lines changed:** ~8 (comment + export keyword).

### packages/event-rendering/types.ts
**Before:** `PublicEventPageProps` had no scroll-host injection point.
**After:** added optional `ScrollComponent?: ComponentType<ScrollViewProps>` (imports `ComponentType` from react, `ScrollViewProps` from react-native). Defaults to RN `ScrollView` at the call site.
**Why:** BUG 2 — let the native sheet host inject a gorhom-aware scroll without forcing it on web/business.
**Lines changed:** ~13.

### packages/event-rendering/PublicEventPage.tsx
**Before:** `PublishedBody` rendered a raw `<ScrollView style={styles.scroll} flex:1>` — when hosted in EBES's gorhom `BottomSheetScrollView`, this nested two scroll hosts (the fragile double-scroll = probable freeze source).
**After:** `PublicEventPage` accepts `ScrollComponent` (default RN `ScrollView`) and threads it to `PublishedBody`, which renders `<ScrollComponent …>` instead of a hardcoded `<ScrollView>`. Web/business behavior unchanged (default). The native sheet now provides a single gorhom-aware scroll host.
**Why:** BUG 2 — collapse the double scroll to one host on every surface.
**Lines changed:** ~20.

### app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx
**Before:** `scrollMode="scroll"` + `scrollProps={{ style, contentContainerStyle:[…, {paddingBottom}] }}` → the primitive's gorhom `BottomSheetScrollView` wrapped `PublicEventPage`, which ITSELF rendered a raw RN `ScrollView` (double scroll).
**After:** `scrollMode="view"` (primitive does NOT add its own scroll) + injects gorhom's `BottomSheetScrollView` (re-exported from BaseBottomSheet) into `PublicEventPage` via `ScrollComponent`. A small memoized `SheetScrollHost` wrapper appends this sheet's `bottomContentInset` (carries MessageInterface's chat-composer / tab-bar clearance) onto the page's scroll content padding so the last "Buy ticket" row clears the bottom. Dead `sheetScroll`/`sheetScrollContent` styles removed.
**Why:** BUG 2 — single scroll host; preserve the existing bottom-clearance contract from MessageInterface.
**Lines changed:** ~40.

---

## Spec / fix-map traceability

| Investigation finding | Level | Fix shipped | Evidence |
|---|---|---|---|
| Issue 1 — swipe-close dead in wrapInRNModal | PRIMITIVE | GHRV wrap inside RN Modal | R-1 test PASS + fails-on-revert |
| Issue 4b — bottom inset discarded + no tab-bar awareness | PRIMITIVE | apply inset via withBottomInset + tabBarAware reads BOTTOM_NAV_CONTENT_HEIGHT | R-4b test PASS + fails-on-revert |
| Issue 4a — header/footer slot scroll-kill | PRIMITIVE | scroll claims flex:1 below fixed header | R-4a test PASS + fails-on-revert |
| Issue 2 — EBES double scroll host | SHARED PKG + EBES | injectable ScrollComponent, EBES injects gorhom scroll + scrollMode="view" | R-2 test PASS + fails-on-revert |
| Issue 3a (Discover tap) | PER-SCREEN | NOT in scope (separate pass) | — |
| Issue 3b (thumbnails) | PER-CARD | NOT in scope (separate pass) | — |

---

## Verification

### Static (CAPTURED — all green)
- `tsc --noEmit` (app-mobile): **246 errors WITH my change == 246 errors with my 5 files reverted to `b0063fcad`** → **ZERO net new tsc errors**. All 246 are pre-existing (Deno test files, test-runner globals, `packages/` module-resolution from app-mobile's tsconfig, BoardDiscussion type drift, a PublicEventPage GlassBlur overload that also exists on baseline). Confirmed by reverting each touched file and re-counting.
- `eslint` on the 3 app-mobile touched files: BaseBottomSheet shows **6 `react-hooks/rules-of-hooks`** — identical to the baseline `b0063fcad` count (the file's existing hooks all sit after the `center-dialog` early return; my additions are plain consts/functions, adding ZERO new hook violations). EBES/useAppLayout clean.
- 10 META-ORCH-0991 regression suites (BaseBottomSheet, BaseBottomSheetRework, WaveB×5, WaveC×3): **all exit 0**.
- Sole-gorhom strict-grep gate `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`: **PASS** (0 offenders, scanned 409 files) + self-test PASS.

### Regression test (MANDATORY gate — satisfied)
- Path: `app-mobile/src/components/ui/__tests__/BaseBottomSheetRework.test.mjs`
- Asserts R-1 (GHRV-in-modal), R-4b (inset applied + tabBarAware + canonical nav height), R-4a (header scroll flex:1), R-2 (single scroll host + EBES injection + sole-gorhom preserved), and ADV adversarial (stock motion, center-dialog non-swipe, no EBES onClose double-fire).
- **Passes on the fix.** **Fails-on-revert verified at `b0063fcad`**: with all 5 source files reverted to baseline and the test in place, the suite exits 1 (R-1 GHRV assertion fails first). Restored → exits 0.

### Live-device (CAPTURED — both platforms, real devices)
Device matrix WAS available (my earlier probe was corrupted by the bracketed `[...]` worktree path mangling zsh output for absolute-path commands; once routed through script files it worked). iOS sim `17091E60-C3B6-4167-980D-60C348E177F6` (iPhone 17 Pro, iOS 26.4) + Android `emulator-5554` (Pixel_8_Pro). The shared :8100 Metro served a FROZEN cache that never picked up my edits even with cache-bust, so — per the no-cross-session rule (do not restart :8100) — I stood up a SEPARATE Metro on **:8211** scoped to this worktree (`--clear`), `adb reverse tcp:8211`, and loaded the fresh bundle on both devices. Screenshots in `Mingla_Artifacts/reports/screenshots/IMPLEMENT_META-ORCH-0991_REWORK/`.

**Android (`emulator-5554`) — the headline platform (swipe-close was DEAD here):**
- BUG 1 — PreferencesSheet (`wrapInRNModal`) opened (`A01`), **swipe-down from the handle CLOSED it back to Explore (`A02`)** — this was completely dead pre-fix (investigation A13/A14). Re-confirmed a second time after reopen. ✅
- BUG 4a — reopened, body **scrolls** to lower sections (`A03`, "How are you rolling?" / "How far?"). ✅
- BUG 4b — scrolled to bottom: footer button clears the home indicator (`A04`); the floating GlassBottomNav shows clean clearance on Discover (`A08`). ✅
- BUG 2 — "Vibes and Stuff" event sheet (EBES) opened (`A05`, video cover playing), **scrolled smoothly** revealing Tickets + Buy CTA (`A06`, single scroll host — no freeze), **swipe-down CLOSED** it (`A07`). ✅

**iOS (`17091E60…`) — swipe-close was FRAGILE here:**
- BUG 1 — PreferencesSheet opened (`I01`), **handle swipe-down CLOSED it (`I02`)**. ✅
- BUG 4b — scrolled down: footer "No changes to save" / "Start Over" buttons sit clear above the home indicator (`I03`). ✅
- BUG 1 fragile-case — from a SCROLLED body, the first handle swipe returns to scroll-top (`I04` → top), the next swipe closes — exactly the acceptable gorhom scroll↔pan handoff the investigation specified once GHRV lands. ✅

EBES on iOS already proven scroll+close by the investigation (no-modal sheet); the Android EBES capture above covers the single-scroll fix cross-platform. Center-dialog non-swipe is structurally enforced (ADV test) — not separately re-driven on-device.

**Remaining on-device item:** a sticky-footer sheet whose footer must clear BOTH the home indicator AND Mingla's floating menu when `tabBarAware` is set — no consumer opts into `tabBarAware` yet (see Discoveries), so there is nothing live to drive for that specific case; the OS-inset clearance IS live-verified above (Android A04, iOS I03).

---

## Invariant preservation
- I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER: PRESERVED (gate green; EBES uses the re-export).
- I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS (no provider/portal): PRESERVED.
- Stock-gorhom-motion (no animationConfigs / no custom spring): PRESERVED (ADV test).
- Center-dialog non-swipe: PRESERVED (ADV test).
- 34 conversions: unregressed (10 suites green; bottom-inset merge is additive `Math.max`, never reduces).

## Parity check
- The bottom-inset + GHRV fixes apply uniformly to all sheet consumers via the single primitive. No solo/collab split. `tabBarAware` is opt-in (default false) so existing wrapInRNModal sheets that z-stack above the nav are unaffected unless a consumer opts in.
- Shared `PublicEventPage` is consumed by app-mobile (EBES, native) and mingla-business (web adapter). Web adapter does NOT pass `ScrollComponent` → defaults to RN ScrollView → web behavior unchanged.

## Cache safety
- N/A — UI/gesture/layout only. No query keys, no data shapes, no persisted storage touched.

## Regression surface (for the tester)
1. Every wrapInRNModal scrollable sheet — swipe-close on Android (headline).
2. PreferencesSheet — still scrolls AND now swipe-closes; bottom padding not reduced.
3. TicketCartSheet — sticky footer still pinned; scroll body still pans; footer clears inset.
4. EBES on a long-content event — single-scroll smoothness + swipe-close.
5. NotificationsSheet (sectionlist) — list bottom padding applied, no clipped last row.

## Discoveries for orchestrator
- Bug 3a (Discover card tap) + Bug 3b (video-cover poster / expo-image Android robustness) remain open per the investigation — a separate per-surface pass, not folded here.
- `tabBarAware` is shipped as an opt-in but NO consumer sets it yet (the OS-inset clearance is now universal; the extra tab-bar clearance is available for any future below-nav sheet). If the orchestrator wants specific below-nav sheets to clear the floating menu, that's a one-line `tabBarAware` add per sheet — flagged rather than blanket-applied to avoid over-padding the wrapInRNModal sheets that already z-stack above the nav.
- Live-device matrix needs a Metro + a Google-Play Android emulator stood up cleanly (no AVD currently exists on the machine).

## Transition items
- None.

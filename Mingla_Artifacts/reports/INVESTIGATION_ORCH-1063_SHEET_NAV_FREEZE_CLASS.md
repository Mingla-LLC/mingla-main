# INVESTIGATION — ORCH-1063 [Sheet/nav lifecycle freeze class]

Status: ROOT CAUSE — notifications CONFIRMED; deck-after-close LIKELY (suspect D primary, A secondary) — pending on-sim confirmation.
Affected Surfaces: iOS-consumer, Android-consumer (app-mobile only). NOT in scope: business app, admin, buyer-web (no deck/notifications sheet there).
Date: 2026-06-03

## Symptoms (operator-reported)
1. Notifications sheet opens BEHIND the floating nav menu and the list appears frozen.
2. The SOLO deck on Home freezes the **entire app** after closing the expanded-card sheet opened from a card. (Operator corrected: NOT the collab deck — the Home solo deck. Collab parity must still be verified.)

## Bug 1 — Notifications sheet (CONFIRMED)
- `app-mobile/src/components/NotificationsSheet.tsx:776-817` renders an INLINE `BaseBottomSheet` (`wrapInRNModal={false}`) that WRAPS its scroll via `header={header}` + `bodyContainerStyle={styles.sheetContent}`.
- Per invariant `i-bottomsheet-inline-scroll-binding` (ORCH-1016): gorhom sizes the sheet to the wrapper's content height → scroll viewport == content → `maxScroll == 0` → frozen list.
- Inline (no RN Modal) → renders below the app-root `GlassBottomNav` (zIndex 50, `app/index.tsx`) → "opens behind the menu."
- FIX: `wrapInRNModal={true}` (drop `tabBarAware`). Z-stacks above nav (ORCH-0908) + bounded gorhom parent so the wrapped scroll binds + working swipe-to-dismiss.

### Gate hole (must fix)
`.github/scripts/strict-grep/i-bottomsheet-inline-scroll-binding.mjs:85` exempts a file if `/^\s*wrapInRNModal\b/m` matches — which ALSO matches `wrapInRNModal={false}`. So NotificationsSheet (inline + wrapped scroll) was never flagged. Tighten the regex to require `={true}` / bare-true.

## Bug 2 — Solo-deck expanded-card freeze-after-close (deep investigation)
The Home solo deck (`SwipeableCards`) is always-on; the "closed" surface is the expanded-card sheet (`ExpandedCardModal` mounted at `SwipeableCards.tsx:2083`, inside a `switch(effectiveUIState.type)`), or `ExpandedBusinessEventSheet` for business-event cards.

Five hypotheses tested against source:
- (A) bottomNavStore ref-count leak — LIKELY (secondary). `BaseBottomSheet.tsx:349-353` push/pop on `hidesBottomNav`. A stuck `hideCount>0` UNMOUNTS the whole nav (`app/index.tsx:2514`). Symptom "whole app froze" (not just missing tab bar) makes this secondary, but it is a real latent leak (stacked sheets; switch-cased unmount of an open sheet).
- (D) Orphaned `wrapInRNModal` modal — LIKELY (PRIMARY). `ExpandedCardModal.tsx:1421-1429` `handleRootSheetClose` (ORCH-1022) SWALLOWS the close while a child modal is open (`anyChildModalOpen` = browser/ticketBrowser/nightOutShare/schedulePicker/curatedLightbox). RN Modal is `animationType="none"`; gorhom's internal `close()` can settle to index −1 while parent `visible` stays true → invisible full-screen `accessibilityViewIsModal` window keeps capturing ALL touches → total app freeze. ORCH-1022 patched a sibling ("DM shared card freeze") — residual remains.
- (B) Stuck pointerEvents overlay — RULED OUT independently (inline sheet returns bare sheet when `!visible`; nav gate is a small capsule). Only live overlay path is the wrapInRNModal Modal under D.
- (C) Gesture/reanimated leak — RULED OUT. Deck uses legacy `PanResponder`, not RNGH; releases on unmount.
- (E) Realtime/state storm — CONTRIBUTOR (jank), not the dead-tap freeze.

Prior art: ORCH-1022 (`b4ffab557`) anyChildModalOpen/handleRootSheetClose; ORCH-1016 (`31e6c39e0`) bottomNavStore + inline-scroll gate; META-ORCH-0991 sheet migration.

## Confirmation plan (no assumptions)
On iOS sim, Home solo deck: expand a card → open a child (venue link / photo lightbox / schedule) → close. Instrument `useBottomNavStore.getState().hideCount` after close.
- hideCount>0 with no sheet open → A confirmed.
- hideCount==0 but taps dead → D confirmed (orphaned wrapInRNModal modal still mounted; check ExpandedCardModal RN Modal `visible` stuck true).

## Fix design (solve-for-once)
1. NotificationsSheet → `wrapInRNModal={true}`.
2. bottomNavStore → make leak-proof: token/owner-keyed hide registry (Set of ids) instead of a bare counter, with a hard reset on Home-deck focus so a leaked hide can never permanently unmount the nav.
3. ExpandedCardModal wrapInRNModal teardown → guarantee the RN Modal cannot remain mounted with gorhom index −1 after onClose is suppressed (reconcile `visible` with child-modal lifecycle; close children before/with the root, or gate the RN Modal `visible` on the actual sheet index).
4. Strict-grep gate regex fix (require true).
5. Regression tests: (impl) inline-wrapped-scroll gate catches `wrapInRNModal={false}`; (impl) bottomNavStore registry self-heals on reset; (tester adversarial) orphaned-modal: close-while-child-open leaves no touch-capturing window + hideCount==0.
6. Verify collab-deck parity (CollabDeckSheet raw RN Modal + nested PreferencesSheet) for the same class.

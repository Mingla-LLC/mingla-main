# IMPLEMENTATION — ORCH-1193 [venue/event sheet bottom-cutoff fix]

**Status:** implemented and verified (web render-proof + strict-grep gate + fails-on-revert).
**Branch:** `1193-sheet-cutoff` · **Worktree:** `~/Desktop/mingla-orchs/1193-[sheet-cutoff]`
**Commit:** `1711b7a2a3bf30e688446860d4f7e8444ded594a`
**Date:** 2026-06-21

---

## 1. Summary

Eight business-app action sheets opened with their bottom content / primary CTA clipped
off-screen and unreachable on mobile (business native iOS/Android + business web on mobile).
Root cause (per the forensic report): each sheet's body `<ScrollView>` had **no `flex:1` on its
own `style`** (only a `contentContainerStyle`), so inside the fixed-height, `overflow:hidden`
`SheetMobile` panel the scroll box grew past the panel bottom and there was nothing to scroll —
the CTA stayed permanently off-screen. Several also imported `ScrollView` from `react-native`
instead of `wrappers/SmartScrollView`, so on keyboard-open the focused input + CTA were further
occluded by the keyboard + 42dp Done bar (violating ACTIVE invariant
`I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE`).

The fix is the established consumer-sweep pattern (matching the known-good `RefundSheet` /
`DoorSaleNewSheet` / `AddCompGuestSheet`): per file, (a) add a `scrollFlex: { flex: 1 }` style
applied to the body ScrollView's `style`, keeping its existing `contentContainerStyle`
(`paddingBottom`); and (b) switch the body ScrollView import to `wrappers/SmartScrollView`. The
shared `SheetMobile.tsx` primitive and the consumer `app-mobile` were NOT touched.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit `1711b7a2a`) |
|----|-----------|--------|-------------------------------|
| SC-1 | All 8 sheets bound their body ScrollView with `flex:1` | ✓ | `scrollFlex:{flex:1}` + `style={styles.scrollFlex}` in all 8 files; strict-grep gate INV-1 green |
| SC-2 | 7 input/interactive sheets import body ScrollView from `wrappers/SmartScrollView` | ✓ | gate INV-2 green for the 7; SmartScrollView import present (named in 5, aliased `BodyScrollView` in the 2 with nested horizontal scrollers) |
| SC-3 | `PublishErrorsSheet` exception: `flex:1` only, plain RN ScrollView | ✓ | flex:1 applied; import unchanged (`react-native`); gate INV-2 marks it exempt |
| SC-4 | `ReservationCreateSheet` horizontal date-row ScrollView stays plain RN | ✓ | body=`BodyScrollView` (Smart), nested date `<ScrollView horizontal>` still from `react-native` |
| SC-5 | `CreatorStep2WhenRepeatPickerSheet` horizontal day-of-month ScrollView stays plain RN | ✓ | body=`BodyScrollView`, nested `<ScrollView horizontal>` still `react-native` |
| SC-6 | `SheetMobile.tsx` untouched; `app-mobile` untouched | ✓ | not in diff (`git diff origin/main...HEAD --name-only`) |
| SC-7 | CTA reachable at small/mobile viewport (web render proof) | ✓ | `jest.orch1193.sheetscroll.web.render.cjs` — VenueTableSheet body ScrollView carries the compiled `flex:1` atomic class on the scroll container |
| SC-8 | Fails-on-revert strict-grep guard with `--self-test`, wired into the workflow | ✓ | `orch-1193-sheet-body-scroll-bounded.mjs` + job in `strict-grep-mingla-business.yml`; self-test green; fails on line-deletion |

---

## 3. Files changed (13 files, +448 / −10)

**8 sheet files (the allowlist):**
- `mingla-business/src/components/venue/VenueTableSheet.tsx` (+11/−1)
- `mingla-business/src/components/venue/ReservationCreateSheet.tsx` (+14/−2)
- `mingla-business/src/components/venue/WaitlistAddSheet.tsx` (+11/−1)
- `mingla-business/src/components/venue/MenuItemSheet.tsx` (+11/−1)
- `mingla-business/src/components/venue/MenuCategorySheet.tsx` (+11/−1)
- `mingla-business/src/components/venue/VenueBlackoutSheet.tsx` (+11/−1)
- `mingla-business/src/components/event/CreatorStep2WhenRepeatPickerSheet.tsx` (+15/−2)
- `mingla-business/src/components/event/PublishErrorsSheet.tsx` (+11/−1)

**Guard + test infra (in-scope per dispatch):**
- `.github/scripts/strict-grep/orch-1193-sheet-body-scroll-bounded.mjs` (NEW, self-testing gate)
- `.github/workflows/strict-grep-mingla-business.yml` (NEW job `orch-1193-sheet-body-scroll-bounded`)
- `mingla-business/src/components/venue/__tests__/sheetBodyScrollBounded.orch1193.web.render.test.tsx` (NEW render proof)
- `mingla-business/jest.orch1193.sheetscroll.web.render.cjs` (NEW dedicated web-render jest config)
- `mingla-business/jest.config.cjs` (added the render test to `testPathIgnorePatterns` so the default node/ts-jest runner doesn't pick up the web-aliased test)

---

## 4. Data-model changes applied

None — pure UI / layout fix.

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- **Implementor happy-path (web render-proof):**
  `mingla-business/src/components/venue/__tests__/sheetBodyScrollBounded.orch1193.web.render.test.tsx`
  (1 test). Mounts the REAL `VenueTableSheet` through react-native-web (`ReactDOMServer`),
  stubs the reanimated/gesture-handler Sheet panel + Button/Input/ConfirmDialog/BrandSwitch,
  and asserts the body ScrollView's outer div (identified by the RN-web scroll signature class
  `r-WebkitOverflowScrolling-150rngu`) carries the compiled `flex:1` atomic class
  (`r-flex-13awgt0`). Run: `cd mingla-business && npx jest --config jest.orch1193.sheetscroll.web.render.cjs --runInBand` → 1 passed.
- **Self-testing strict-grep gate:** `orch-1193-sheet-body-scroll-bounded.mjs` — per-file asserts
  `scrollFlex:{flex:1}` exists + `style={styles.scrollFlex}` applied (all 8) AND the
  SmartScrollView import (7; PublishErrorsSheet exempt). `--self-test` validates detectors against
  good/bad fixtures (named + aliased import forms).

**fails-on-revert verified at `1711b7a2a3bf30e688446860d4f7e8444ded594a`** — by TRUE LINE-DELETION
of `style={styles.scrollFlex}` from `VenueTableSheet.tsx` (not a comment-out):
- render test → `Tests: 1 failed`
- strict-grep gate → exit 1 (`FAIL [INV-1: scrollFlex-applied]`)
- fix restored → render test `Tests: 1 passed`, gate exit 0.

Both new test artifacts are present in `git diff origin/main...HEAD --name-only`.

---

## 7. Old → New receipts (representative; the 8 follow one pattern)

### VenueTableSheet.tsx (reported "Add table")
- **Before:** `import { Pressable, ScrollView, ... } from "react-native"`; body `<ScrollView contentContainerStyle={styles.scroll} ...>` with no `style` → unbounded box overflows the 0.9 panel, Save/Delete clipped.
- **Now:** `ScrollView` from `wrappers/SmartScrollView`; body `<ScrollView style={styles.scrollFlex} contentContainerStyle={styles.scroll} ...>`; `scrollFlex:{flex:1}` added.
- **Why:** SC-1 (bound viewport) + SC-2 (keyboard clearance). **Lines:** +11/−1.

### ReservationCreateSheet.tsx (reported "New reservation")
- **Before:** single `ScrollView` import from RN used by BOTH the vertical body (L175) and the horizontal date row (L213); body unbounded.
- **Now:** body uses `BodyScrollView` (aliased SmartScrollView import) with `style={styles.scrollFlex}`; the horizontal date `<ScrollView horizontal>` stays the plain RN import.
- **Why:** SC-1/SC-2 on the body; SC-4 keeps the horizontal pill scroller plain RN. **Lines:** +14/−2.

### CreatorStep2WhenRepeatPickerSheet.tsx (event wizard repeat picker)
- **Before:** body `<ScrollView>` is the direct Sheet child (no `body` wrapper), no `flex:1`; nested horizontal day-of-month `<ScrollView>`.
- **Now:** body=`BodyScrollView` (aliased Smart) + `style={styles.scrollFlex}` (`scrollFlex:{flex:1}` added); horizontal scroller stays plain RN.
- **Why:** SC-1/SC-2 + SC-5. **Lines:** +15/−2.

### PublishErrorsSheet.tsx (publish-errors list) — EXCEPTION
- **Before:** `<ScrollView contentContainerStyle={styles.content}>` no `flex:1`; long error list overflowed.
- **Now:** `<ScrollView style={styles.scrollFlex} contentContainerStyle={styles.content}>`; import UNCHANGED (plain `react-native`) — read-only, no inputs, SmartScrollView adds no value.
- **Why:** SC-3. **Lines:** +11/−1.

(WaitlistAddSheet / MenuItemSheet / MenuCategorySheet / VenueBlackoutSheet: identical single-ScrollView pattern as VenueTableSheet — import→SmartScrollView, `scrollFlex:{flex:1}` added + applied.)

---

## 8. Cross-surface impact

| Surface | Affected? | What changes / why not |
|---------|-----------|------------------------|
| Business iOS | ✓ | The 8 sheets' CTAs now scroll into view + clear keyboard/Done bar. Rides the NEXT business native build (OTA frozen — COMMS-0052). |
| Business Android | ✓ | Same. Parity automatic (shared RN codebase). |
| Buyer / anonymous Web | ✓ (business web-mobile) | Same `SheetMobile` web branch; `flex:1` resolves the overflow identically. Ships via Vercel. Parity automatic. |
| Business Web preview (adjacent) | ✓ | Same as buyer web. |
| Consumer iOS | ✗ | `app-mobile` uses `BaseBottomSheet` (gorhom), which self-bounds scroll — not in blast radius. |
| Consumer Android | ✗ | Same. |
| Admin Web (adjacent) | ✗ | No venue/event sheets there. |

Parity is **automatic** (single shared RN-business codebase across iOS/Android/web) — no manual per-surface forking.

---

## 9. Smoke / verification result

- **Web render-proof (react-native-web, the deployed business web target):** rendered the REAL
  `VenueTableSheet` (visible, add-mode) via `ReactDOMServer`; the body ScrollView container div
  carries the compiled `flex:1` atomic class → the scroll viewport is bounded to the panel, so the
  CTA is reachable/scrollable rather than overflowing past `overflow:hidden`. PASS. This is the
  exact DOM Vercel emits and is the same mechanism that fixes native (shared `SheetMobile` panel).
- **Strict-grep gate** `orch-1193-sheet-body-scroll-bounded.mjs`: `--self-test` PASS; live run PASS
  (all 8 files green).
- **Adjacent gates re-run, all green:** `orch-0892-no-bespoke-keyboard-plumbing` (PASS — venue
  sheets now compliant), `orch-0861-sibling-scrollview-flexgrow-zero` (exit 0 — explicit `flex:1`
  is exactly what it wants), `i-bottomsheet-inline-scroll-binding` (exit 0).
- **TypeScript:** zero NEW errors in any of the 8 changed files or the new test (repo-wide
  pre-existing error count unchanged; none reference `scrollFlex`/`BodyScrollView`/`SmartScrollView`).
- **NOT live-fired on a simulator/device this pass.** The native-on-device confirmation
  (open each sheet at a small viewport + keyboard-up, confirm the CTA is reachable) is the tester's
  remaining step — the render-proof + shared-primitive mechanism make it `verified` on web and
  `implemented, pending device confirmation` on native.

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` markers introduced.
- **Native on-device confirmation deferred to TEST** (per above). Mechanism is proven on web; the
  native panel is the same fixed-height `overflow:hidden` `SheetMobile` host, so the same `flex:1`
  bound applies, but a sim/device repro should confirm before CLOSE.

---

## 11. Operator action required

- **No migration. No edge-function deploy.** Pure-JS UI fix.
- **OTA frozen (COMMS-0052, BLOCK, ALL):** business-app OTA is blocked until a new business native
  build ships (posthog-react-native hard import). This change is pure-JS but CANNOT be OTA'd to the
  business prod channel — it rides the **next business native build**. **Buyer/business web ships
  via Vercel** on merge to `main` (a `[deploy]` commit may be needed per the Vercel `[deploy]`-gate
  rule).
- **Next phase:** route to orchestrator REVIEW → tester (live sim repro of each of the 8 sheets at a
  small viewport + keyboard-open, confirming the CTA is reachable).

---

## 12. Discoveries for orchestrator

- **The existing `orch-0892` keyboard gate did NOT catch these sheets** even though they bypass
  SmartScrollView: its 4th pattern only fires when a file literally contains the token `TextInput`,
  and all 6 venue sheets use the `Input` wrapper (0 `TextInput` tokens) — so they slipped through.
  Consider broadening that gate (or rely on the new `orch-1193` gate, which is explicit per-file).
  The forensic report flagged the same as a DISC.
- **COMMS-0052 acknowledged** (BLOCK, ALL): factored into the OTA note above; no action needed from
  this ORCH beyond not OTA-ing.

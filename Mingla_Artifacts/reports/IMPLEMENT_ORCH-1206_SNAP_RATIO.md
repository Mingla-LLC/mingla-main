# IMPLEMENT ORCH-1206 — sheet snapPoint ratio fix

**Status:** implemented and verified (logic-level + unit/gate evidence). Native rides next business build; web ships via Vercel.
**Worktree:** `~/Desktop/mingla-orchs/1206-[sheet-snap-ratio]/` on branch `1206-sheet-snap-ratio`
**Commit:** see §Regression / commit hash below.

---

## 1. Summary

The 8 venue sheets (VenueTableSheet, MenuItemSheet, MenuCategorySheet, ReservationCreateSheet,
ReservationDetailSheet, WaitlistAddSheet, WaitlistConvertSheet, VenueBlackoutSheet) pass a
**fractional numeric `snapPoint`** (0.7–0.92) intending a RATIO of the screen. Both Sheet variants
(`SheetNative` and `SheetWeb` in `SheetMobile.tsx`) treated EVERY numeric `snapPoint` as absolute
pixels and clamped it UP to `MIN_SNAP_PX = 120`. Because 0.7–0.92 < 120, every venue sheet rendered
a **120px-tall panel** with `overflow:hidden` → the form and CTA were clipped below the visible area.
(This is the true cause behind the "venue sheets bleed/cut off at the bottom" reports; ORCH-1193/1197/1199
were treating symptoms.)

**Fix:** a numeric `snapPoint` in `(0, 1]` is now interpreted as a RATIO of `screenHeight`; values
`> 1` remain absolute pixels (backward-compatible — every real pixel caller passes values well above 1).
The height math was extracted into a single pure owner, `sheetSnapHeight.ts`, used by BOTH variants.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | Numeric `snapPoint` in (0,1] = RATIO in BOTH variants | ✓ | `computeSheetHeight` ratio branch; both `SheetNative`/`SheetWeb` call it; test T-1206-01 |
| SC-2 | Numeric `snapPoint` > 1 = absolute pixels (clamped) — backward-compatible | ✓ | test T-1206-02 (520→520, 40→120, 99999→760) + caller audit (§Verification) |
| SC-3 | String presets unchanged (peek/half/full) | ✓ | test T-1206-03 |
| SC-4 | JSDoc documents "0–1 = ratio; >1 = absolute pixels" | ✓ | `SheetSnapValue` JSDoc in SheetMobile.tsx + `sheetSnapHeight.ts` header |
| SC-5 | No change to SNAP_RATIOS / MIN_SNAP_PX / MAX_SNAP_RATIO / viewport logic / venue sheets | ✓ | constants moved verbatim to helper; ORCH-1197/1199 viewport code untouched; zero venue-sheet edits |
| SC-6 | Regression test, fails-on-revert | ✓ | §Regression |

---

## 3. Files changed

| File | Δ | Note |
|------|---|------|
| `mingla-business/src/components/ui/SheetMobile.tsx` | +30 / −46 (net −16) | both variants use `computeSheetHeight`; types/constants now imported; JSDoc updated |
| `mingla-business/src/components/ui/sheetSnapHeight.ts` | NEW (+50) | pure single-owner height math + constants + types |
| `mingla-business/src/components/ui/__tests__/sheetSnapHeight.orch1206.test.ts` | NEW (+95) | 8-assertion regression test |

No migrations. No edge functions. No analytics.

---

## 4. The fix (core logic, in `sheetSnapHeight.ts`)

```ts
const requested =
  typeof snapPoint === "number"
    ? snapPoint > 0 && snapPoint <= 1
      ? screenHeight * snapPoint                                   // RATIO
      : Math.min(Math.max(snapPoint, MIN_SNAP_PX),                 // PIXELS
                 screenHeight * MAX_SNAP_RATIO)
    : screenHeight * SNAP_RATIOS[snapPoint];                       // string preset
return Math.min(requested, screenHeight * MAX_SNAP_RATIO);         // 95% cap
```

Both `SheetNative` (was line ~187) and `SheetWeb` (was line ~637) now call
`computeSheetHeight(snapPoint, screenHeight)` — identical logic, single owner.

---

## 5. Old → New receipt — `SheetMobile.tsx`

**Before:** both variants inline-computed panel height treating every numeric `snapPoint` as pixels,
clamping with `Math.max(snapPoint, MIN_SNAP_PX)`; SNAP_RATIOS/MIN_SNAP_PX/MAX_SNAP_RATIO and the
SheetSnapPoint/SheetSnapValue types were declared locally.
**Now:** both variants call the shared pure `computeSheetHeight`; a numeric (0,1] snapPoint resolves
to `screenHeight * snapPoint`; constants + types live in `sheetSnapHeight.ts` and are re-exported from
SheetMobile so all existing `./Sheet` / `./SheetMobile` consumers keep working.
**Why:** SC-1..SC-5 — fractional venue ratios collapsed the panel to 120px and clipped the form/CTA.
**Lines:** net −16 in SheetMobile.tsx; +50 new helper.

---

## 6. Verification (numbers)

`computeSheetHeight` at `screenHeight = 800`:

- `0.9` → **720px** (= 0.9 × 800), NOT 120px. (was 120 pre-fix)
- venue ratios `0.7/0.75/0.8/0.85/0.92` → 560/600/640/680/736px respectively (all > 120).
- `1.0` → **760px** (ratio 800, capped at 95%).
- `520` → **520px** (pixels, unchanged).
- `40` → **120px** (pixel floor, unchanged).
- `99999` → **760px** (95% cap, unchanged).
- `"half"` → **400px** (50%), `"peek"` → 200 (25%), `"full"` → 720 (90%) — all unchanged.

**Caller audit (backward-compat boundary > 1 is safe):** every numeric `snapPoint` caller in
`mingla-business/` was inspected. Fractional callers = the 8 venue sheets only (0.7–0.92, all ratios).
Pixel callers all produce values ≫ 1: `IntakeFilePickerChooserSheet`=360, `IntakeQuestionEditor`=720,
`IntakeTypePickerSheet`=640, `OfferingManageSheet` `44 + n*52 + lg`, `EventManageMenu`
`32 + 28 + n*52 + md`, `ShareModal` (measured content height + 44 + insets, or `"half"`).
`ExperienceReservePicker`/`MultiDateOverrideSheet` = `"full"` (string). **No caller passes a
fractional pixel value**, so none is misinterpreted.

**Gates run (all PASS):**
- `npx jest sheetSnapHeight.orch1206 Sheet.web` → 15 passed.
- strict-grep: `orch-1193-sheet-body-scroll-bounded`, `i-proposed-1136-web-sheet-css-transition`,
  `orch-1105-web-gesture-safe`, `orch-1105-web-glass-opaque-fallback` → all PASS.
- `tsc --noEmit`: no new errors on touched files. (One pre-existing `Sheet.web.tsx:312` cursor-style
  TS error exists identically on origin/main — untouched by this ORCH; flagged as a discovery.)

---

## 7. Regression test + fails-on-revert

Path: `mingla-business/src/components/ui/__tests__/sheetSnapHeight.orch1206.test.ts` (8 assertions).

- Fix in place → **8 passed**.
- Fails-on-revert: deleted the `snapPoint > 0 && snapPoint <= 1 ? screenHeight * snapPoint :` ratio
  branch (true line deletion) → **3 failed** (the ratio assertions; e.g. `1.0` returned 120 not 760).
- Restored → **8 passed**.

`fails-on-revert verified` (fix committed at `676ad832a3887dc89256f29b7f32366e33533992`).

---

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Business iOS | YES — venue sheets render at intended ratio | automatic (shared SheetNative) |
| Business Android | YES — same (this is the Samsung-measured bug) | automatic (shared SheetNative) |
| Buyer/anon Web | YES — SheetWeb fixed identically | automatic (shared `computeSheetHeight`) |
| Business Web preview | YES — same as buyer web | automatic |
| Consumer iOS / Android | NO — `app-mobile` has its own sheet primitives; this file is mingla-business only | n/a |
| Admin Web | NO — does not use this component | n/a |

Parity is **automatic** across the 3 affected business surfaces (one shared helper).

---

## 9. Known issues / deferred

- Pre-existing TS error `Sheet.web.tsx:312` (cursor-style union) is unrelated and identical on
  origin/main — not touched here.

## 10. Operator action required

- No migration, no edge-fn deploy.
- **Web:** ships via Vercel at CLOSE.
- **Native (business iOS/Android):** rides the NEXT business native build — **NO `eas update`**
  (COMMS-0052 BLOCK: business OTA is unsafe until a new native build compiles
  posthog-react-native + expo-tracking-transparency). This ORCH adds no native deps, so it is purely
  queued for that build.

## 11. Discoveries for Orchestrator

- ORCH-1193/1197/1199 were treating downstream symptoms of this single root cause; their fixes remain
  valid (body-scroll bounding, viewport logic) and are untouched, but the venue-sheet "cut off"
  reports should resolve with THIS fix.
- Pre-existing `Sheet.web.tsx:312` TS error (unrelated) — candidate for a tiny cleanup ORCH.
- COMMS-0052 acknowledged (no business `eas update`).

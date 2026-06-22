# IMPLEMENT ORCH-1207 — business-web sheet opaque panel + pointer drag-to-dismiss

**Status:** implemented and verified (real Chromium, mobile viewport).
**Commit:** `f9985408f567a7d3fa3b17f7a3dabfaa84736c8f`
**Working tree:** `~/Desktop/mingla-orchs/1207-[sheet-web-dismiss-opaque]/` on branch `1207-sheet-web-dismiss-opaque`
**Scope:** web-only. File: `mingla-business/src/components/ui/SheetMobile.tsx` (the `SheetWeb` variant + `SheetMobilePanelInner`). Native `SheetNative` variant + ORCH-1206 snap-ratio + ORCH-1197/1199 viewport metrics UNCHANGED.

---

## 1. Summary

Two business-web sheet bugs fixed, both web-only:

1. **Sheets were too transparent.** On web the panel painted the native glass stack (BlurView when blur is allowed, else a 0.92-alpha fallback fill PLUS a translucent `glass.tint.profileElevated` layer) — page content ghosted through the open sheet. Now `SheetWeb` paints a single fully-opaque elevated-surface fill (`#16181b`, the dark-glass tone at full alpha), so nothing bleeds through (Android opaque-glass policy). The brand `panelBackground` override path is untouched.

2. **Swipe-down did not close the sheet on web.** `SheetWeb` only closed via a scrim tap (it calls zero reanimated hooks and had no drag gesture). Added a pointer/touch drag-to-dismiss: a transparent drag-catch band over the handle/header translates the panel 1:1 with the finger (transition disabled mid-drag, pointer-captured), and on release calls `onClose()` past 25% of panel height OR a downward flick velocity, else springs back to the open rest position. Scrim-tap dismissal is retained. Works with mouse on desktop too.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified | Commit |
|----|-----------|----------|--------|
| SC-1 | Open SheetWeb panel is effectively opaque (alpha ≥ 0.97, no page content visible behind) | ✓ real Chromium: panel fill `rgb(22,24,27)` alpha **1.0**; pixel under panel center = CTA blue, NOT the magenta page-behind → no bleed-through | `f9985408f` |
| SC-2 | Brand `panelBackground` override + rounded top + handle preserved | ✓ `panelBackground` branch in `SheetMobilePanelInner` untouched; handle + rounded `bodyClip` retained in the webOpaque branch | `f9985408f` |
| SC-3 | Downward drag past threshold (>25% height OR downward velocity) calls `onClose()` | ✓ real Chromium: 300px drag → `closed:1` | `f9985408f` |
| SC-4 | Drag below threshold springs back (no close) | ✓ real Chromium: 40px slow drag → `closed:0`, panel returns to open rest | `f9985408f` |
| SC-5 | Scrim-tap dismissal still works | ✓ real Chromium: top-of-screen tap → `closed:1` | `f9985408f` |
| SC-6 | Drag does not interfere with body scroll | ✓ drag only initiates from the 52px top handle/header band, never overlaps the scrollable body | `f9985408f` |
| SC-7 | Existing CSS open/close transform animation preserved; reduce-motion still works | ✓ ORCH-1136 R3 + Sheet.web jest suites green; transition restored on drag release | `f9985408f` |
| SC-8 | Native variant + ORCH-1206/1197/1199 logic unchanged | ✓ `SheetNative` untouched; `sheetSnapHeight.orch1206` + 1136 hook-purity suites green; SheetWeb still reanimated-hook-free | `f9985408f` |

---

## 3. Files changed

| File | Δ |
|------|---|
| `mingla-business/src/components/ui/SheetMobile.tsx` | +~210 / −3 (WEB_OPAQUE_BACKGROUND const, `webOpaque` branch in SheetMobilePanelInner, drag state/handlers/catch-band in SheetWeb, panel transform + touchAction) |
| `mingla-business/src/components/ui/__tests__/orch1207WebSheetDismissOpaque.test.ts` | +102 (jest static regression, 7 tests) |
| `mingla-business/playwright/orch1207/*` (bundle.mjs, entry.tsx, index.html, globalSetup.mjs, 3 stubs, spec) | +427 (real-Chromium probe harness) |
| `mingla-business/playwright.orch1207.config.ts` | +15 |
| `mingla-business/.gitignore` | +2 (ignore orch1207 bundle.js + test-results) |

Build artifacts (`playwright/orch1207/bundle.js`, `test-results/`) are gitignored, not committed (mirrors ORCH-1197).

---

## 4. Data-model changes applied

None. UI-only, web-only.

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- **Jest (CI-runnable static guard):** `mingla-business/src/components/ui/__tests__/orch1207WebSheetDismissOpaque.test.ts` — 7 tests (opaque-fill alpha ≥ 0.97, webOpaque branch fills WEB_OPAQUE_BACKGROUND, per-variant opt-in, pointer-handler wiring, 25%-OR-velocity threshold, drag transform + transition-off, scrim-tap retained).
- **Playwright (real-Chromium runtime proof, load-bearing):** `mingla-business/playwright/orch1207/sheet-web-dismiss-opaque.spec.ts` — 4 tests, all PASS: opacity (no bleed-through), drag-past-threshold closes, drag-below springs back, scrim-tap closes.

**fails-on-revert verified at `f9985408f`** by TRUE LINE DELETION (not comment-out):
- Deleted `{ backgroundColor: WEB_OPAQUE_BACKGROUND }` (line 428) → jest "webOpaque branch paints WEB_OPAQUE_BACKGROUND" FAILS. Restored → PASS.
- Deleted `{...dragHandlers}` (line 958) → jest "wires pointer drag handlers" FAILS. Restored → PASS.

Both tests ship in the same branch/commit as the fix (visible in `git diff origin/main...HEAD --name-only`).

---

## 7. Old → New receipts

### SheetMobile.tsx — `SheetMobilePanelInner`
- **Before:** non-brand path always rendered the translucent glass stack (BlurView/0.92-fallback + translucent tint) on BOTH web and native.
- **Now:** accepts `webOpaque`; when true (web only) renders a single fully-opaque `#16181b` fill (no blur, no translucent tint) + decorative highlight/hairline + handle + body. Native passes `false` → unchanged glass stack.
- **Why:** Bug 1 — page content must not ghost through on web (opaque-glass policy).
- **Lines:** ~+45.

### SheetMobile.tsx — `SheetWeb`
- **Before:** closed only via scrim tap; panel transform was the static open/closed translateY; no opaque opt-in.
- **Now:** passes `webOpaque` to the inner; adds pointer drag state (`dragY`/`dragging` + refs), `handleDragStart/Move/End` + `endDrag` with 25%-height-OR-velocity threshold + pointer capture; panel transform adds the live `dragY` and sets `transition:none` while dragging + `touchAction:none`; a transparent 52px `webDragCatch` band over the handle/header carries the pointer handlers (testID `<testID>-drag-handle`).
- **Why:** Bug 2 — swipe-down dismissal; keep the CSS animation + scrim tap intact.
- **Lines:** ~+120.

---

## 8. Cross-surface impact

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Business Web (Vercel) | YES | both fixes; opaque panel + drag-to-dismiss |
| Business iOS | NO | `Platform.OS==='web'` dispatches `SheetWeb`; native renders `SheetNative` (untouched) |
| Business Android | NO | same — native path untouched |
| Buyer/anon Web | YES (automatic) | shares the same `Sheet`/`SheetWeb` primitive; parity automatic |
| Consumer iOS/Android | NO | different app (`app-mobile`), different sheet primitives |
| Admin Web | NO | not a consumer of this primitive |

Parity is automatic across the two web surfaces (one shared component). No manual parity work.

---

## 9. Smoke result

Real Chromium (Playwright, Desktop Chrome profile @ 390×844 mobile viewport), metro-bundled real `SheetWeb` through react-native-web with the same web shims as the deployed bundle:
- Opacity: panel strongest-fill alpha **1.0** (`rgb(22,24,27)`); element under panel center = `rgb(91,108,255)` (the in-sheet CTA), NOT `#ff00ff` page-behind → confirmed no bleed-through.
- Drag past threshold (300px down on handle): `onClose` fired once (`closed:1`).
- Drag below threshold (40px slow): no close (`closed:0`), panel sprang back into the viewport.
- Scrim tap: `onClose` fired (`closed:1`).

Also: SheetWeb body confirmed reanimated-hook-free (ORCH-1136 R3 contract held); jest sheet regression = 56/56 across 5 suites; typecheck clean for SheetMobile + the new test; strict-grep gates `i-proposed-1136-web-sheet-css-transition`, `orch-1193-sheet-body-scroll-bounded`, `i-bottomsheet-inline-scroll-binding`, `i-proposed-topsheet-web-viewport-anchor` all PASS.

---

## 10. Known issues / deferred

None. No `[TRANSITIONAL]` code added.

---

## 11. Operator action required

- No migration, no edge-fn deploy.
- **Deploy = Vercel web only** (business + buyer web). Web-only JS change; native is unaffected, so COMMS-0052 (business-app OTA freeze) does NOT apply to this path — do NOT `eas update`.
- Route back to orchestrator for REVIEW → tester dispatch. Do NOT merge/deploy from here (implementor does not deploy).

---

## 12. Discoveries for Orchestrator

- The drag-to-dismiss could be extended to TopSheet.web / Modal.web (same scrim-tap-only limitation) — out of scope here; flag if Seth wants web swipe-dismiss kit-wide.
- The opaque-fill color `#16181b` is hardcoded in SheetMobile (matches the existing `chrome.ariBubbleAndroid` token). A future token consolidation could promote a shared `surface.sheetOpaque` token; left as-is to keep scope tight.

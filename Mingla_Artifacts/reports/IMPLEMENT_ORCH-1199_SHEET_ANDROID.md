# IMPLEMENT — ORCH-1199 [venue action sheets bleed below the visible viewport on Android Chrome / Samsung]

Commit: `4ae504b8b` · branch `1199-sheet-android-viewport` · worktree `~/Desktop/mingla-orchs/1199-[sheet-android-viewport]`
Status: implemented and verified (real Chromium, Android + iOS profiles). Web/JS only — ships via Vercel; NO OTA.

---

## 1. Summary

On a Samsung/Android phone the venue action sheets (Add table, New reservation, Add category, Add blackout, Add to waitlist) opened with the panel bleeding below the bottom of the screen — the primary CTA off-screen. ORCH-1197 already fixed this for iOS Safari but it did not hold on Android Chrome / Samsung Internet. Root cause: 1197's anchor model is iOS-Safari-shaped and ignores `window.visualViewport.offsetTop`. The fix anchors the panel to the TRUE visible bottom (`offsetTop + visualViewport.height`) instead of the layout-vs-visual height gap alone, and tracks the visualViewport `scroll` event. Proven in real Chromium at an Android (Samsung UA + touch) profile and re-verified on the iOS profile (no regression).

---

## 2. Deterministic root cause

`SheetWeb` renders inside a React-Native-Web `Modal` whose `StyleSheet.absoluteFill` fills the **LAYOUT viewport** (`window.innerHeight`). The bottom dock is `position:absolute; bottom:0`, so it anchors to the LAYOUT bottom. The panel is then lifted up by a transform so its bottom lands at the visible bottom.

ORCH-1197 computed that lift as:
```
toolbarOffset = innerHeight − visualViewport.height
```
This assumes the ONLY difference between the layout bottom and the visible bottom is a dynamic **bottom toolbar** (true on iOS Safari, where `visualViewport.offsetTop == 0`).

On **Android Chrome / Samsung Internet** the on-screen keyboard scrolls the page UP to keep the focused field visible, so the visual viewport shifts DOWN: `visualViewport.offsetTop > 0`. With Chrome's resizes-content keyboard behaviour `innerHeight` also resizes to equal `visualViewport.height`, so `toolbarOffset == 0` → **NO lift**. But the true visible band in `getBoundingClientRect` coordinates is `[offsetTop, offsetTop + height]`, BELOW the layout bottom the dock anchors to. The panel and CTA therefore sit outside the visible band — the bleed Seth saw. (Measured directly: dock `bottom:0` resolves to `innerHeight`; the panel's `getBoundingClientRect` is in layout-viewport coordinates while `visualViewport` carries its own `offsetTop` that 1197 never reads.)

The correct lift is the gap between the layout bottom and the TRUE visible bottom:
```
visibleBottomGap = innerHeight − (offsetTop + visualViewport.height)
```
which equals 1197's `(innerHeight − height)` exactly when `offsetTop == 0` (iOS / desktop — no regression) and additionally absorbs the Android `offsetTop` shift.

Secondary gap: 1197 listened only to the visualViewport `resize` event. `offsetTop` changes on visualViewport **scroll**, so the panel kept a stale anchor while the page scrolled under the keyboard. Now both `resize` and `scroll` are tracked.

---

## 3. The cross-browser fix

`mingla-business/src/components/ui/SheetMobile.tsx`:

- `useWebViewportMetrics` now returns `{ visibleHeight, layoutHeight, offsetTop, visibleBottomGap }`. `visibleBottomGap = max(innerHeight − (offsetTop + visibleHeight), 0)` replaces the old `toolbarOffset = max(innerHeight − visibleHeight, 0)`. It reads `visualViewport.offsetTop` and adds a `scroll` listener alongside `resize`.
- `SheetWeb` destructures `visibleBottomGap` (was `toolbarOffset`) and uses `openTranslateY = -visibleBottomGap` for the panel's open resting transform. The panel is still height-bounded to `visibleHeight` and still pads `env(safe-area-inset-bottom)` for the Android system nav bar.

This is robust on iOS Safari (offsetTop=0, gap = bottom toolbar), Android Chrome / Samsung Internet (offsetTop>0, gap absorbs the scroll shift), and desktop (gap=0, no-op). The NATIVE variant (`SheetNative`) is untouched.

---

## 4. Before / after measured numbers (real Chromium, NO jsdom)

Harness: `mingla-business/playwright/orch1199/` — metro-bundled REAL `SheetWeb` through react-native-web, loaded in real Chromium with a Samsung UA + touch + deviceScaleFactor (`playwright.orch1199.config.ts`, Galaxy descriptor). Reuses the proven ORCH-1197 web stubs. `visualViewport` is installed with working listeners so the resize/scroll re-track path is honestly exercised. The assertion target is the TRUE visible band `[visualViewport.offsetTop, visualViewport.offsetTop + visualViewport.height]`.

### Android — Condition A: keyboard open + page scrolled (`innerHeight=800, visualViewport.height=460, offsetTop=120` → true visible band [120, 580])

| metric | BEFORE (1197 model) | AFTER (1199 fix) | visible band |
|---|---|---|---|
| panel top | 46 (clipped ABOVE visible top) | 166 | ≥ 120 |
| panel bottom | 460 (120px short of the keyboard, content cut) | 580 | ≤ 580 |
| CTA bottom | 388 | 508 | ≤ 580 |
| result | FAIL (panelTop 46 < 119) | PASS | — |

### Android — Condition B: keyboard appears AFTER the sheet opens (`innerHeight=800`, visualViewport shrinks 800→360 post-mount, offsetTop=0)

| metric | AFTER (1199 fix) | visible band |
|---|---|---|
| panel bottom | 360 | ≤ 360 |
| CTA bottom | 302 | ≤ 360 |
| result | PASS | — |

(Condition B passed both before and after because, with offsetTop=0, the new formula is identical to 1197's — it confirms the resize re-track still works and the fix did not break the symmetric case.)

### iOS regression — ORCH-1197 test (`innerHeight=844, visualViewport.height=730, offsetTop=0`)

| metric | AFTER (1199 fix) | visible viewport |
|---|---|---|
| panel bottom | 730 | = 730 |
| CTA bottom | 415 | ≤ 730 |
| result | PASS (unchanged from 1197 baseline) | — |

---

## 5. Files changed

| file | delta |
|---|---|
| `mingla-business/src/components/ui/SheetMobile.tsx` | ~+30 / −12 (hook metrics + SheetWeb lift) |
| `mingla-business/playwright/orch1199/sheet-android-viewport.spec.ts` | +200 (new regression test) |
| `mingla-business/playwright/orch1199/{bundle.mjs,entry.tsx,index.html,globalSetup.mjs}` | new harness (not shipped) |
| `mingla-business/playwright.orch1199.config.ts` | new (Android profile) |

No migrations, no edge functions, no native-variant change.

---

## 6. Regression test + fails-on-revert

- Test: `mingla-business/playwright/orch1199/sheet-android-viewport.spec.ts` (2 assertions: Condition A offsetTop, Condition B post-open keyboard). Both PASS on the fix.
- **fails-on-revert verified at `4ae504b8b`**: reverting the fix line `visibleBottomGap: Math.max(inner - (offsetTop + visible), 0)` back to the 1197 formula `Math.max(inner - visible, 0)` makes Condition A FAIL (panel top 46 < visible top 119) while Condition B still passes — proving the test exercises the exact Android `offsetTop` bug. Fix restored, both green.
- iOS guard: `playwright.orch1197.config.ts` re-run green (no regression).
- Existing jest `orch1136R3WebSheetCloseTimingAndHookPurity.test.ts`: 14/14 pass (hook-purity + close-timing intact).

No existing test was modified — append-only. No `[TEST-MOD-APPROVED]` token needed.

---

## 7. Cross-surface impact

| surface | affected | parity |
|---|---|---|
| Buyer/anon Web (Android Chrome / Samsung) | YES — the fix | the bug surface |
| Buyer/anon Web (iOS Safari) | re-verified, unchanged | shared SheetWeb |
| Business Web preview (desktop) | NO — desktop uses the centered-card path (`Sheet.web.tsx` wide branch), gap=0 | automatic |
| Business iOS / Android (native app) | NO — SheetNative untouched, web-only hook | automatic |
| Consumer iOS / Android | NO — different codebase (app-mobile) | n/a |
| Admin Web | NO | n/a |

All venue action sheets (`VenueTableSheet`, `ReservationCreateSheet`, `MenuCategorySheet`, `VenueBlackoutSheet`, `WaitlistAddSheet`, etc.) import `Sheet` from `../ui/Sheet` → narrow-web → `SheetWeb`, so they all inherit the fix automatically.

---

## 8. Gates run

- `playwright.orch1199.config.ts` — 2 passed (Android).
- `playwright.orch1197.config.ts` — 1 passed (iOS, no regression).
- jest `orch1136R3WebSheetCloseTimingAndHookPurity` — 14 passed.
- strict-grep: `i-proposed-1136-web-sheet-css-transition`, `i-bottomsheet-inline-scroll-binding`, `meta-orch-0991-base-bottom-sheet-sole-consumer`, `orch-1193-sheet-body-scroll-bounded`, `i-proposed-topsheet-web-viewport-anchor` — all OK.
- `tsc --noEmit`: 721 pre-existing repo-wide errors, ZERO in `SheetMobile.tsx` (no new errors introduced).

---

## 9. Comms

Read `COMMS_LEDGER.md` on entry. No BLOCK/WARN row addressed to ORCH-1199 or mingla-implementor for this work. COMMS-0052 (business-app OTA blocked) is an FYI — this fix is web/JS only and ships via Vercel, so the OTA block does not apply.

---

## 10. Operator action required

- Merge to `main` via PR; the `[deploy]` commit forces a fresh Vercel build for buyer web. NO `eas update` (web-only; business OTA remains blocked per COMMS-0052).
- Smoke on a real Samsung/Android phone: open a venue → Tables → Add table; tap a field so the keyboard opens; confirm the panel + "Save" CTA stay fully on screen above the keyboard.

## 11. Discoveries for orchestrator

- None. The fix is a strict generalization of ORCH-1197's model (offsetTop-aware), confined to the web variant.

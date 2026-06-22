# IMPLEMENT ORCH-1197 — SheetWeb panel bleeds below the visible viewport (iOS Safari)

Status: **implemented and verified** (real Chromium, mobile viewport).
Commit: `ad18fc7523d2ee230416c2458a9122efa69727a6`
Worktree: `~/Desktop/mingla-orchs/1197-[sheet-web-viewport]/` on branch `1197-sheet-web-viewport`

---

## 1. Summary (plain English)

On the business web app opened in iPhone Safari, the venue action sheets (Add
category, Add to waitlist, New reservation, Add blackout, Add table) opened as a
bottom sheet whose **panel ran off the bottom of the screen** — the title sat low
and the form fields + the primary button were cut off behind Safari's bottom
toolbar, making the sheets practically unusable. The shared web sheet now sizes
and anchors itself to the **visible** part of the screen (the area above Safari's
toolbar) instead of the full layout height, so the whole panel and its button sit
on-screen. Because ~40 web sheets share this one primitive, they are all fixed at
once. Native iOS/Android is unaffected and untouched.

---

## 2. Root cause (MEASURED, not assumed)

`SheetWeb` (in `mingla-business/src/components/ui/SheetMobile.tsx`) computed
`screenHeight = Dimensions.get("window").height` and docked the panel with
`styles.bottomDock` = `position:absolute; bottom:0` inside the Modal's
`StyleSheet.absoluteFill`.

Measured facts in real Chromium (iPhone 390×844 layout, `window.visualViewport`
reduced to 730 to mimic Safari's ~114px dynamic toolbar):

- The Modal `absoluteFill` (the dock's positioning ancestor) fills
  `window.innerHeight` = **844px** (the LAYOUT viewport).
- `Dimensions.get("window").height` under react-native-web 0.21 returns the
  VISUAL height (**730px**), so the panel HEIGHT was already 730×0.9 = 657px.
- But the dock's `bottom:0` anchors to the **layout** bottom (844), so the panel
  sat at top 187 / **bottom 844** — i.e. **114px below the visible bottom (730)**,
  exactly behind Safari's toolbar. The title/fields/CTA were pushed off-screen.

So the bug was the **anchor** (dock pinned to the layout bottom), compounded by
the layout-vs-visual viewport gap iOS Safari introduces. The earlier ORCH-1193
fix addressed the inner ScrollView flex; this is a different layer (the panel
shell itself).

---

## 3. The fix (SheetWeb only — SheetNative untouched)

`mingla-business/src/components/ui/SheetMobile.tsx`:

1. **`useWebViewportMetrics(fallback)`** — new web-only hook returning
   `{ visibleHeight, layoutHeight, toolbarOffset }`:
   - `visibleHeight` = `window.visualViewport.height` (toolbar excluded).
   - `layoutHeight` = `window.innerHeight` (the dock's actual container height).
   - `toolbarOffset` = `max(layoutHeight − visibleHeight, 0)` (the dynamic toolbar
     height; 0 on desktop / Android web / no toolbar).
   - Re-reads on the `visualViewport` `resize` event so it tracks the toolbar
     showing/hiding. On native it returns the fallback unchanged (the hook is
     `Platform.OS === "web"`-gated end to end).
2. `SheetWeb` sizes the panel off `visibleHeight` and **lifts the panel by
   `toolbarOffset`** via its OPEN resting transform (`translateY(-toolbarOffset)`
   instead of `translateY(0)`), so the panel bottom aligns to the visible bottom.
   This rides the existing CSS-transition transform pipeline (open/close animation
   unchanged) and avoids the react-native-web atomic-class `bottom` merge conflict
   that made a direct `dock { bottom: offset }` override silently no-op.
3. Adds `paddingBottom: "env(safe-area-inset-bottom, 0px)"` to the web panel so
   the CTA clears the iOS home indicator. Resolves to 0 where there is no inset.

No `position:fixed` was introduced (banned for web overlays by
`I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED` — it gets captured by transformed
ancestors). The native `SheetNative` `screenHeight = Dimensions.get("window").height`
and its reanimated open/close are byte-identical to before.

---

## 4. Before / after numbers (real Chromium, Playwright)

Harness: iPhone layout 390×844, `window.visualViewport.height` overridden to 730
(Safari toolbar steals 114px). The REAL `Sheet`/`SheetWeb` is metro-bundled with
react-native-web (native-only deps mapped to the same web shims the deployed
bundle uses) and measured with `getBoundingClientRect()`.

| Metric | Visible bottom | Panel bottom Y | CTA bottom Y | Verdict |
|---|---|---|---|---|
| BEFORE (origin) | 730 | **844** (114px off-screen) | n/a (panel off-screen) | BLEEDS |
| AFTER (fix) | 730 | **730** (at visible bottom) | 415 (on-screen) | FITS |
| Desktop 1280×800 (no toolbar) | 800 | 800 (unchanged) | on-screen | NO-OP |

fails-on-revert: deleting the lift (`openTranslateY = -toolbarOffset` →
`openTranslateY = 0`) restores panel bottom = **844** and the spec FAILS;
restoring it returns to 730 and PASS. Verified at commit
`ad18fc7523d2ee230416c2458a9122efa69727a6`.

---

## 5. Native assessment (mandate item 4)

`SheetNative` uses `Dimensions.get("window").height` + `insets.bottom`. On native
iOS/Android there is **no browser chrome and no layout-vs-visual viewport gap** —
`Dimensions.get("window").height` IS the visible height, the Modal fills it, and
the inner body already pads `spacing.lg + insets.bottom` (the real home-indicator
safe area). The panel + CTA therefore fit within the screen; the toolbar-bleed
bug is **web-only**. Seth's original native cut-off was the inner-scroll issue
already fixed by ORCH-1193 (`scrollFlex` flex:1 bound), pending a native build.
**Verdict: native is NOT affected; no native change warranted; SheetNative
deliberately not touched.**

---

## 6. Files changed

| File | Δ | What |
|---|---|---|
| `mingla-business/src/components/ui/SheetMobile.tsx` | +93/−3 | `useWebViewportMetrics` hook; SheetWeb sizes off visibleHeight, lifts by toolbarOffset, env() safe-area pad |
| `mingla-business/.gitignore` | +1 | ignore generated `playwright/orch1197/bundle.js` |
| `mingla-business/playwright.orch1197.config.ts` | new | Playwright config (self-bundling globalSetup) |
| `mingla-business/playwright/orch1197/sheet-web-viewport.spec.ts` | new | the real-Chromium regression measurement |
| `mingla-business/playwright/orch1197/{entry.tsx,bundle.mjs,index.html,globalSetup.mjs}` | new | metro harness that bundles the worktree SheetWeb for the browser |
| `mingla-business/playwright/orch1197/{safe-area,gesture-handler,keyboard-controller}-stub.cjs` | new | web shims for native-only deps in SheetMobile's import graph (same role as the deployed web bundle's shims) |

---

## 7. Regression test

- Path: `mingla-business/playwright/orch1197/sheet-web-viewport.spec.ts`
- Run: `cd mingla-business && npx playwright test -c playwright.orch1197.config.ts`
  (globalSetup metro-bundles the harness first; no manual build).
- Real Chromium, no jsdom. Asserts panel bottom Y and CTA bottom Y ≤
  `visualViewport.height` (the visible bottom).
- **fails-on-revert verified at `ad18fc7523d2ee230416c2458a9122efa69727a6`** by
  true line-deletion of the lift (`-toolbarOffset` → `0`): panel bottom returns to
  844, spec fails; restored → passes.
- Append-only: all new files; no existing test modified or deleted.

---

## 8. Cross-surface impact

| Surface | Affected | Notes |
|---|---|---|
| Buyer/anonymous Web (iOS Safari) | YES — the fix | panel + CTA now on-screen |
| Business Web (desktop) | NO-OP | toolbarOffset = 0; panel bottom unchanged |
| Business Web (Android Chrome) | NO-OP / benign | toolbarOffset ≈ 0; safe-area env() = 0 |
| Business iOS | NO | SheetNative untouched |
| Business Android | NO | SheetNative untouched |
| Consumer iOS / Android | NO | different codebase (`app-mobile`) |
| Admin Web | NO | different stack |

Parity: automatic — single shared primitive `SheetMobile.tsx` (web variant).

---

## 9. Self-verify / gates

- Real-Chromium spec: PASS (before/after numbers above).
- Existing Sheet-web jest tests: 41/41 PASS (`orch1136R3WebSheetCssTransition`,
  `orch1136R3WebSheetCloseTimingAndHookPurity`, `Sheet.web`).
- ORCH-1193 inner-scroll web render test: PASS (coexists with this fix).
- strict-grep gates: `i-proposed-1136-web-sheet-css-transition`,
  `orch-1193-sheet-body-scroll-bounded`, `i-bottomsheet-inline-scroll-binding`,
  `i-proposed-topsheet-web-viewport-anchor` all exit 0.
- `tsc --noEmit`: 0 errors in `SheetMobile.tsx` and the harness.

---

## 10. Operator action required

- None for DB/edge (no migration, no edge function). This is a pure-JS web change.
- It IS a real source change to `mingla-business`, so it forces a fresh Vercel
  build of buyer/business web on merge (the desired outcome). Buyer-web cannot be
  OTA'd — it deploys from merged `main`.
- Note COMMS-0052 (BLOCK): the business-app NATIVE OTA channel is frozen pending a
  new native build; this change is web-only and does not need the business app OTA.

---

## 11. Discoveries for orchestrator

- react-native-web 0.21 `Dimensions.get("window").height` returns the VISUAL
  viewport height, while `window.innerHeight` (the Modal absoluteFill container)
  returns the LAYOUT height. Any future bottom-anchored web overlay must anchor
  against the visual viewport / lift by the `innerHeight − visualViewport.height`
  gap, never trust `bottom:0` alone. Candidate for a shared invariant alongside
  `I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED`.
- A direct react-native-web `style={[registeredStyle, { bottom: N }]}` override of
  a registered atomic `bottom` did NOT win (silent no-op); the transform pipeline
  is the reliable lever for web sheet positioning.

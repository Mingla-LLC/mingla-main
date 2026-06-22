# IMPLEMENT — ORCH-1208 [sheet drag-catch touch-action]

**Status:** implemented and verified (static + gates + fails-on-revert). Live-Chromium computed-style check: unverified (no Playwright/built web bundle in this session; orchestrator re-verifies on the real Samsung after deploy, per dispatch).
**Worktree:** `~/Desktop/mingla-orchs/1208-[sheet-dragcatch-touchaction]` on branch `1208-sheet-dragcatch-touchaction`
**Commit:** `06af1443399338d8110ea83104a06dbcd33bb045`

## 1. Summary

ORCH-1207 added the business-web swipe-down-to-dismiss but it does not work on real touch devices. The drag-catch band (`styles.webDragCatch` on the `<View>` carrying `accessibilityLabel="Drag to dismiss sheet"` + `{...dragHandlers}`) computed `touch-action: auto` on Seth's real Samsung (orchestrator measurement via adb+CDP: panel=`none`, dragCatch=`auto`). With `auto`, Android Chrome / Samsung Internet interpret the downward drag as a page scroll and fire `pointercancel`, so the pointer-drag handler never completes and the sheet never dismisses. (Mouse/desktop and the Chromium pointer test were immune because `touch-action` only gates touch input.) ORCH-1207 had set `touchAction:"none"` on the panel style only, and it does not inherit to the drag-catch.

**Fix (one line + cast):** add `touchAction: "none"` to the `styles.webDragCatch` style object (web-only string-cast, mirroring the existing `cursor` web-style handling), so the browser routes the vertical drag on the handle band to the pointer handler. Nothing else changed — panel touch-action, body ScrollView scrolling, the native variant, and all ORCH-1206/1207 behavior are untouched.

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | `styles.webDragCatch` includes `touchAction:"none"` | ✓ `06af144` | diff §7; reaches DOM as `touch-action:none` via RN-web's existing mapping (same mechanism the panel already relies on) |
| SC-2 | Compiles (cast appropriately) | ✓ `06af144` | `tsc --noEmit` reports zero errors for `SheetMobile.tsx` / the new test |
| SC-3 | Panel touch-action, body ScrollView, native variant, ORCH-1206/1207 unchanged | ✓ `06af144` | only the `webDragCatch` block changed (diff §7); ORCH-1207 test suite still 7/7 green |
| SC-4 | Regression test asserts drag-catch carries `touchAction:"none"`; fails-on-revert | ✓ `06af144` | §6 — fails-on-revert by true line deletion |

## 3. Files changed

| File | Δ |
|------|---|
| `mingla-business/src/components/ui/SheetMobile.tsx` | +9 / −1 (8-line comment + `touchAction:"none"` + cast on the style object) |
| `mingla-business/src/components/ui/__tests__/orch1208WebDragCatchTouchAction.test.ts` | +57 (new) |

## 4. Data-model changes applied

None.

## 5. Edge functions touched

None.

## 6. Regression tests added

- **Path:** `mingla-business/src/components/ui/__tests__/orch1208WebDragCatchTouchAction.test.ts` (2 tests).
- **Passing run:**
  ```
  PASS src/components/ui/__tests__/orch1208WebDragCatchTouchAction.test.ts
    ✓ styles.webDragCatch sets touchAction:"none" ...
    ✓ keeps the panel's own touch-action:none (ORCH-1207) — both layers, not a swap
  Tests: 2 passed, 2 total
  ```
- **fails-on-revert verified at `06af1443399338d8110ea83104a06dbcd33bb045`** — by TRUE LINE DELETION (not comment-out) of the `touchAction:"none"` line + cast from the `webDragCatch` block: both assertions failed (`matches.length` 1 vs expected ≥ 2; drag-catch-block regex no match). Restored the fix → 2/2 pass again.
- Existing `orch1207WebSheetDismissOpaque.test.ts` re-run alongside: 7/7 still green (no regression).
- Append-only honored: NEW test file; no existing test modified or deleted. (No `[TEST-MOD-APPROVED]` needed.)

## 7. Old → New receipt

### mingla-business/src/components/ui/SheetMobile.tsx
**Before:** `styles.webDragCatch` = `{ position:'absolute', top:0, left:0, right:0, height:52 }` — no `touch-action`, so the element computed `touch-action:auto` on touch devices and the browser stole the downward drag as a page scroll (pointercancel → dismiss never fired).
**Now:** the same block adds `touchAction: "none"` and the object is cast `as unknown as ViewStyle` (web-only string-style, like the existing `cursor` inline style); the browser now routes the vertical drag on the handle band to the pointer handler → swipe-down-to-dismiss completes on Android/Samsung.
**Why:** ORCH-1208 root cause — panel `touch-action:none` does not inherit to the drag-catch.
**Lines changed:** +9 / −1.

```diff
     height: 52,
-  },
+    // ORCH-1208: the panel's `touchAction:"none"` does NOT inherit to this
+    // element, so on real touch devices (Samsung/Android Chrome) the browser
+    // computes `touch-action:auto` here and interprets the downward drag as a
+    // page scroll → pointercancel → the dismiss gesture never completes. Pin
+    // `touch-action:none` directly on the drag-catch so the vertical pan is
+    // routed to the pointer handler. Web-only string-cast (never reaches the
+    // native ViewStyle surface); the scrollable body keeps its own scrolling.
+    touchAction: "none",
+  } as unknown as ViewStyle,
```

## 8. Cross-surface impact table

| Surface | Affected | Detail |
|---------|----------|--------|
| Business Web (mingla-business on web) | YES | swipe-down-to-dismiss now works on touch (Android/Samsung); desktop mouse drag unchanged |
| Business iOS | NO | `touchAction` is a web-only string style; never reaches the native ViewStyle/variant |
| Business Android (native) | NO | same — native sheet uses PanGesture, not the web drag-catch |
| Consumer iOS / Consumer Android / Buyer Web | NO | different codebase (`app-mobile`); not touched |
| Admin Web (adjacent) | NO | not touched |
| Business Web preview (adjacent) | YES | same shared file; parity automatic (single shared style) |

Parity is automatic (one shared style object; no manual per-surface paths).

## 9. Smoke result

- `npx jest` ORCH-1208 + ORCH-1207 suites: 9/9 pass.
- `tsc --noEmit`: zero errors attributable to the change.
- Strict-grep gates touching `SheetMobile.tsx` all PASS: `orch-1105-web-gesture-safe`, `orch-1193-sheet-body-scroll-bounded`, `i-proposed-1136-web-sheet-css-transition`, `orch-1105-web-glass-opaque-fallback`.
- Live-Chromium computed-`touch-action` check on the rendered DOM: NOT run (Playwright not installed + no built web bundle in this session). The RN-web → DOM `touch-action` mapping is the exact mechanism ORCH-1207 already depends on for the panel; the orchestrator re-verifies on the real Samsung after deploy (per dispatch).

## 10. Known issues / deferred

None. No `[TRANSITIONAL]` code introduced.

## 11. Operator action required

- No migration, no edge-fn deploy, no OTA.
- **COMMS-0052 (BLOCK, OPEN) acknowledged:** business-app OTA is blocked. This change is web-only and does NOT require `eas update`; it ships via **Vercel** and rides the next business native build for the bundled web preview. No `eas update` performed or requested.
- Ships via the existing web deploy path (Vercel `[deploy]`) at CLOSE, orchestrator/operator-owned. Implementor did NOT deploy/merge/PR.

## 12. Discoveries for Orchestrator

None.

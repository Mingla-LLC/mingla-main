# IMPLEMENT — ORCH-1210 (dispatched as ORCH-1209) — TopSheet WEB swipe-up-to-dismiss

> **ID COLLISION (see COMMS-0059):** this work was dispatched as ORCH-1209, but
> ORCH-1209 is already CONSUMED on `main` by the cover-video bandwidth fix
> (commit `e3e98b82e`, PR #629, itself "ex-1208" per COMMS-0058). Per
> shipped-first-keeps-the-number, this work is **renumbered ORCH-1210**. All
> in-code / test / probe references are relabeled ORCH-1210. Branch + worktree are
> still `1209-[topsheet-web-swipeup]` — orchestrator renames at CLOSE.

Status: **implemented and verified** (real Chromium, mobile viewport).

## 1. Summary (plain English)

On business web the brand-switcher TopSheet (and the "Create" + menu) could only
be closed by tapping outside — there was no swipe-up-to-dismiss, even though the
phone (native) version has one. This adds swipe-up-to-dismiss to the WEB variant
of the TopSheet: drag the handle at the bottom of the panel upward and the sheet
closes; a small drag springs back. Tapping outside (scrim) and Escape still work.
Native is untouched. Web-only — ships via Vercel, no app update needed.

## 2. SPEC success-criteria coverage

All criteria verified at commit recorded in the Regression section below.

| SC | Criterion | Verified how | Result |
|----|-----------|--------------|--------|
| SC-1 | WEB variant gains swipe-up-to-dismiss (was scrim-tap + Escape only) | Playwright real-Chromium: upward drag past threshold on the drag-catch -> `closed:1` | OK |
| SC-2 | Mirrors SheetWeb pointer pattern (onPointerDown/Move/Up/Cancel, setPointerCapture, clientY tracking, threshold ~25% / flick -> onClose else spring back) | jest static contract + Playwright runtime | OK |
| SC-3 | Inverted direction — drag-catch at BOTTOM edge over handle; UPWARD drag dismisses; DOWNWARD clamps to 0 / springs back | jest (`delta < 0 ? delta : 0`, `bottom:0`) + Playwright below-threshold spring-back | OK |
| SC-4 | During drag, panel translates with finger, clamped (no rubber-band below open rest), transition disabled while dragging | jest (`openWithDrag = dragY`, `transition: dragging ? "none"`) | OK |
| SC-5 | `touchAction:"none"` ON the drag-catch element itself (ORCH-1208 lesson) | Playwright reads computed `touch-action` = `none`; fails-on-revert -> `auto` | OK |
| SC-6 | Scrim-tap + Escape dismissal still work | Playwright scrim-tap -> `closed:1`; jest Escape-handler present | OK |
| SC-7 | Existing CSS open/close transform animation preserved (compositor transition, no position:fixed) | strict-grep `i-proposed-topsheet-web-viewport-anchor.mjs` OK; invariant preserved | OK |
| SC-8 | TopSheetNative untouched (already has reanimated upward PanGesture) | jest asserts native block has `Gesture.Pan()` and NO `touchAction` | OK |
| SC-9 | Body scroll not hijacked (drag-catch is a short bottom band) | drag-catch height = handle area + 28px; never overlaps body | OK |

## 3. Files changed

| File | Delta |
|------|---|
| `mingla-business/src/components/ui/TopSheet.tsx` | +172 / -5 |
| `mingla-business/src/components/ui/__tests__/orch1210TopSheetWebSwipeUp.test.ts` | new (8 jest tests) |
| `mingla-business/playwright/orch1210/topsheet-web-swipeup.spec.ts` | new (4 Chromium tests) |
| `mingla-business/playwright/orch1210/{index.html,entry.tsx,bundle.mjs,globalSetup.mjs,*-stub.cjs}` | new harness |
| `mingla-business/playwright.orch1210.config.ts` | new |

`bundle.js` is a generated build artifact — NOT committed (matches the orch1207 precedent).

## 4. Data-model changes
None — pure client UI.

## 5. Edge functions touched
None.

## 6. Regression tests added

- **Happy-path (implementor-owned):** `mingla-business/src/components/ui/__tests__/orch1210TopSheetWebSwipeUp.test.ts` — 8 jest tests over the TopSheetWeb source contract (pointer handlers, inverted upward-threshold close logic, upward-only clamp, finger-tracking transform, transition-off-while-dragging, scrim+Escape retained, drag-catch `touch-action:none`, drag-catch anchored `bottom:0`, native untouched). The test strips comments before matching so the assertions exercise REAL code, not the ORCH-1208-lesson comment text.
- **Runtime proof (real Chromium):** `mingla-business/playwright/orch1210/topsheet-web-swipeup.spec.ts` — 4 tests in real Chromium at 390x844 mobile viewport: (a) measures the drag-catch computed `touch-action` = `none`; (b) upward drag past threshold -> `closed:1`; (c) small upward drag below threshold -> `closed:0` + panel sprang back to open rest; (d) scrim tap -> `closed:1`.

**fails-on-revert verified (true line-DELETION, not comment-out):**
- Deleting the `touchAction:"none"` style line -> jest touch-action test FAILS AND real Chromium measures `touch-action = auto` (the exact ORCH-1208 device bug) -> Playwright test FAILS.
- Deleting the upward-threshold close logic (`-dragged > panelHeight * RATIO || velocity < -VELOCITY`) -> jest threshold test FAILS.
- Restored -> jest 8/8 + Playwright 4/4 green.
- `fails-on-revert verified at <COMMIT_HASH>`.

## 7. Old -> New receipt — `TopSheet.tsx`

**Before:** `TopSheetWeb` closed ONLY via scrim-tap + Escape + Android hardware-back. It calls zero reanimated hooks and had no pointer/pan gesture, so a finger swipe-up did nothing — the user had to tap outside. (`TopSheetNative` already had a reanimated `Gesture.Pan()` upward-drag dismiss.)

**Now:** `TopSheetWeb` has a pointer-driven swipe-UP-to-dismiss mirroring `SheetWeb` (ORCH-1207/1208), INVERTED for the top-anchored sheet. A transparent drag-catch band at the BOTTOM of the panel (over the handle) carries `{...dragHandlers}` (onPointerDown/Move/Up/Cancel + setPointerCapture, clientY tracking, velocity). An UPWARD drag translates the panel up via a `dragY` offset added to the open resting transform (0); release past 25% of panel height OR an upward flick velocity calls `onClose()`, else springs back. A DOWNWARD drag is clamped to 0. The drag rides the SAME CSS transform pipeline (transition disabled only while dragging), preserving the compositor-transition + no-position:fixed invariants. `touch-action:none` is pinned directly on the drag-catch (ORCH-1208 lesson — the panel's does not inherit) so Android/Samsung don't steal the drag as a page scroll.

**Why:** SC-1..SC-9 — Seth: business-web TopSheet can't be swiped up to dismiss.

**Lines changed:** +172 / -5.

## 8. Cross-surface impact

| Surface | Affected | Notes |
|---------|----------|-------|
| Business Web (buyer + authed) | YES | TopSheetWeb gains swipe-up dismiss — this is the fix. |
| Business Web preview (adjacent) | YES | same code path |
| Business iOS | NO | renders TopSheetNative (already has reanimated swipe) |
| Business Android | NO | renders TopSheetNative |
| Consumer iOS / Android | NO | TopSheet is a `mingla-business` primitive only |
| Buyer/anonymous Web | NO | TopSheet not used on buyer routes (it's authed chrome) |
| Admin Web | NO | separate Vite app |

Parity: AUTOMATIC within business web (single dispatcher; native branch byte-unchanged).

## 9. Smoke result

Real Chromium (Playwright, 390x844 mobile viewport), `npx playwright test -c playwright.orch1210.config.ts`:
```
ORCH-1210 DRAG-CATCH touch-action = none
  PASS touch-action — drag-catch computes touch-action:none
ORCH-1210 SWIPE-UP-PAST-THRESHOLD closed-count = closed:1
  PASS swipe UP PAST threshold dismisses (onClose fires)
ORCH-1210 SWIPE-UP-BELOW-THRESHOLD closed-count = closed:0
  PASS small UP drag BELOW threshold springs back (no close)
ORCH-1210 SCRIM-TAP closed-count = closed:1
  PASS scrim tap still dismisses
  4 passed
```
jest: `8 passed, 8 total`. Adjacent sheet tests (orch1207 + orch1208): `9 passed`. strict-grep no-fixed gate: OK.

## 10. Known issues / deferred
- Existing `src/__tests__/orch1136r2TopSheetOverlayNoFixed.gate.test.ts` T-4 fails on baseline (asserts a `[ORCH-1136-DIAG]` marker already reaped from EventDetailScreen at ORCH-1136 close). PRE-EXISTING, unrelated.
- `tsc` reports 721 pre-existing baseline errors across the business project; ZERO in `TopSheet.tsx`.
- No `[TRANSITIONAL]` code introduced.

## 11. Operator action required
- **None for DB/edge** (pure client UI; no migration, no edge fn).
- **Deploy:** web-only via Vercel `[deploy]` from MERGED main. NO `eas update` (COMMS-0052 in force; rides next business native build for parity but the WEB fix is live on deploy).
- **Renumber at CLOSE:** rename branch `1209-topsheet-web-swipeup` -> `1210-...`, worktree dir, and (optionally) this report's twin (see COMMS-0059).

## 12. Discoveries for Orchestrator
- **ORCH-ID 1209 COLLISION** — dispatched as 1209 but 1209 is taken by cover-video (PR #629). Renumbered to ORCH-1210; COMMS-0059 filed + pushed to main. Branch/worktree rename is an orchestrator CLOSE task.
- **Pre-existing baseline test failure** — `orch1136r2TopSheetOverlayNoFixed.gate.test.ts` T-4 fails because the `[ORCH-1136-DIAG]` marker it asserts was reaped from `EventDetailScreen.tsx`; the gate test was not updated. Candidate cleanup ORCH (append-only — needs `[TEST-MOD-APPROVED]`).

# INVESTIGATE — Swipe-to-dismiss blast radius across all sheets (WEB path)

**Date:** 2026-06-22
**Mode:** INVESTIGATE (read-only; no product code, no fix written)
**Anchor read:** `origin/main` @ `f052aec81` (latest; "ORCH-1208 ... touch-action:none on sheet drag-catch [deploy] (#628)")
**Bug class (root-caused by ORCH-1206/1207/1208):** business-WEB sheets animate via CSS `transform` and implement swipe-to-dismiss with React `onPointerDown/Move/Up` handlers. On REAL touch devices the dismiss FAILS if the **gesture element's** computed CSS `touch-action` is not `none` — Android Chrome / Samsung Internet steal the vertical drag as a page scroll and fire `pointercancel`, so the pointer-drag handler never completes. Mouse/desktop is immune (touch-action only gates touch). Measured on Seth's real Samsung via adb+CDP (per ORCH-1208 commit + test gate).

---

## Headline result

- **Only ONE component in the entire monorepo implements pointer-drag-to-dismiss on web:** `mingla-business/src/components/ui/SheetMobile.tsx` (the `SheetWeb` variant). It is the sole user of `onPointerDown` / `setPointerCapture` anywhere under `mingla-business/src`, `app-mobile/src`, or `packages/` (proven by repo-wide `git grep`).
- **That one component is ALREADY FIXED and the fix is COMPLETE.** ORCH-1208 (`f052aec81`, PR #628, on `origin/main`) added `touchAction:"none"` directly to the `webDragCatch` gesture element (line 1018), on top of the panel-level `touchAction:"none"` (line 889). Both the gesture element and its parent now carry it. A fails-on-revert test gate guards it.
- **No other AFFECTED sheet exists.** Every other sheet/drawer/modal on the web path either (a) wraps SheetMobile/Sheet and inherits its now-correct behavior, (b) has NO swipe-dismiss on web at all (scrim-tap / Escape only — a PARITY observation, not the touch-action bug), or (c) is native-only via reanimated/gesture-handler (NOT subject to the CSS bug).
- **The blast radius of the touch-action bug is therefore CLOSED with the merge of ORCH-1208.** There are no additional files needing the touch-action fix.
- **One parity GAP worth flagging (not this bug):** `TopSheet.tsx` (swipe-UP-to-dismiss) and its consumer `UniversalCreatorSheet` have NO drag-dismiss on the web variant — web users can only dismiss via scrim-tap / Escape, while native users swipe up. This is an intentional ORCH-1173 R2 decision (web `dismissGesture={undefined}`), not a regression. If swipe-up-to-dismiss parity on web is desired, it would be a NEW pointer-drag implementation that MUST ship with `touch-action:none` (likely `none`; `pan-x` if horizontal scroll inside the panel ever needs to coexist).

---

## Investigation manifest (every file read, in trace order)

| # | File (origin/main) | Why |
|---|---|---|
| 1 | `COMMS_LEDGER.md` | Mandatory entry read. COMMS-0052 (BLOCK, OTA-frozen), COMMS-0056/0057 (ORCH-1206 ID collision; sheet-snap renumbers to 1207+). All WARN/BLOCK relate to OTA, not to read-only investigation. |
| 2 | `mingla-business/src/components/ui/SheetMobile.tsx` (1025 lines) | Primary — the ORCH-1208-fixed swipe-down sheet. Confirm fix completeness. |
| 3 | `mingla-business/src/components/ui/TopSheet.tsx` (863 lines) | Swipe-UP sheet — does the WEB variant drag-dismiss? touch-action? |
| 4 | `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` (526) | Wraps TopSheet? own drag? |
| 5 | `mingla-business/src/components/ui/GlobalSearchSheet.tsx` (435) | Wraps Sheet/SheetMobile? own drag? |
| 6 | `mingla-business/src/components/ui/Sheet.tsx` + `Sheet.web.tsx` | Web routing of `Sheet` → narrow web = SheetMobile; wide desktop = centered card. |
| 7 | `mingla-business/src/components/ui/CoverPickerSheet.tsx` | Wraps Sheet. |
| 8 | `mingla-business/src/components/marketing/ComposerV2/TemplatePreviewDrawer.web.tsx` | The only other sheet/drawer `.web.tsx`. |
| 9 | `app-mobile/src/components/ui/BaseBottomSheet.tsx` (1073) | Consumer — gorhom/reanimated; any web variant? |
| 10 | repo-wide `git grep onPointerDown / setPointerCapture / touchAction / onTouchMove / PanResponder` | Prove SheetMobile is the ONLY pointer-drag-dismiss on web. |
| 11 | `mingla-business/src/components/ui/__tests__/orch1208WebDragCatchTouchAction.test.ts` | Confirm the regression gate exists + is fails-on-revert. |

---

## Q-scorecard

**Q1 — Is the ORCH-1208 fix on SheetMobile complete (drag-catch carries touch-action:none) and is anything else in SheetMobile affected?**
Verdict: **COMPLETE / OK.** `proven` (source-confirmed on origin/main HEAD `f052aec81`; mechanism measured on real Samsung per the 1208 commit + test). The gesture element (`webDragCatch`, where `dragHandlers` attach) carries `touchAction:"none"` (line 1018) AND the panel carries it (line 889). No other gesture surface exists in the component.

**Q2 — Does TopSheet.tsx's WEB variant implement swipe-up drag-dismiss, and if so does the gesture element have touch-action:none?**
Verdict: **N/A (no web drag) + PARITY GAP.** `proven`. `TopSheetWeb` (lines 600-821) implements only scrim-tap (`handleScrimPress`) + Escape. It passes `dismissGesture={undefined}` to the shared `TopSheetPanelInner` (line 475-477, 562-564) — no `onPointer*`, no `GestureDetector` on web. Native variant has the upward `Gesture.Pan()` (line 343) attached to the handle only. So there is NOTHING for the touch-action bug to break on web; but web has no swipe-up-to-dismiss at all (gap).

**Q3 — UniversalCreatorSheet & GlobalSearchSheet: own drag, or wrap a primitive?**
Verdict: **Wrap; no own drag.** `proven`. `UniversalCreatorSheet` renders `<TopSheet heightMode="compact">` (line 264) — inherits TopSheet web (no swipe-dismiss → same parity gap; N/A for touch-action). `GlobalSearchSheet` renders `<Sheet>` (line 30, used in body) → `Sheet` re-exports `SheetMobile` (narrow web) → inherits the now-fixed swipe-down. Neither defines `onPointer*`/`touchAction`/`GestureDetector`.

**Q4 — BaseBottomSheet (consumer app-mobile): web variant with pointer-drag-dismiss?**
Verdict: **N/A (native-only).** `proven`. No `.web.tsx` variant exists; the file uses `@gorhom/bottom-sheet` `<BottomSheet>` + reanimated PanGestureHandler for swipe-down (lines 45-50, 795-796). No `onPointer*`, no `touchAction`. app-mobile has react-native-web installed (`expo start --web`) but ZERO `.web.tsx` files under `app-mobile/src` and no production web surface (the buyer/anon web is `mingla-business`). gorhom's pan on RN-web does not route through the CSS-pointer/touch-action path this bug class concerns. NOT subject to the bug.

**Q5 — Any OTHER `*.web.tsx` sheet/modal/drawer or other drag pattern (onTouchMove/PanResponder) with drag-dismiss lacking touch-action?**
Verdict: **None.** `proven`. Repo-wide `git grep` on origin/main: `onPointerDown` and `setPointerCapture` appear ONLY in `SheetMobile.tsx` (+ its test). `onTouchStart`/`onTouchMove`/`PanResponder` in a web sheet context: none in `mingla-business/src` or `packages`. The only other sheet/drawer `.web.tsx` is `TemplatePreviewDrawer.web.tsx` — a positionless inline pane / absolute overlay with NO Modal and only `onPress={onClose}` affordances (no drag). `Sheet.web.tsx` wide-desktop path is a centered `Modal` card with backdrop-tap only (desktop = mouse; touch-action irrelevant).

---

## Findings (six-field evidence)

### F-1 — SheetMobile.tsx swipe-down drag-catch: FIX COMPLETE (the one place the bug lived)
- **Symptom:** Pre-1208, swipe-down-to-dismiss dead on real Samsung/Android Chrome; pointer gesture cancelled mid-drag.
- **Layer:** code (CSS/web).
- **Probe:** `git show origin/main:mingla-business/src/components/ui/SheetMobile.tsx` lines 816-963 (handlers + render) and 1000-1019 (`webDragCatch` style); `git log -S 'ORCH-1208: the panel' origin/main`.
- **Evidence (verbatim):** Gesture element is the `webDragCatch` View with `{...dragHandlers}` (lines 949-959). Its style block:
  ```
  webDragCatch: {
    position: "absolute", top: 0, left: 0, right: 0, height: 52,
    // ORCH-1208: the panel's `touchAction:"none"` does NOT inherit to this element ...
    touchAction: "none",
  } as unknown as ViewStyle,        // line ~1011-1019
  ```
  Panel also carries `touchAction: "none"` (line 889). Carried by origin/main HEAD commit `f052aec81` (PR #628).
- **Mechanism:** With `touch-action:none` on the actual pointer-capturing element, Android Chrome/Samsung route the vertical drag to the pointer handler instead of consuming it as a page scroll → the drag completes → `handleDragEnd` runs → sheet dismisses.
- **Severity:** `RULED OUT` (already fixed; documented here as the closed root cause of the bug class).

### F-2 — TopSheet.tsx web variant: NO swipe-up dismiss on web (parity gap, NOT the touch-action bug)
- **Symptom:** On web, a TopSheet (e.g. brand switcher, UniversalCreatorSheet) cannot be swiped up to close; only scrim-tap / Escape close it. Native users can swipe up.
- **Layer:** code.
- **Probe:** `git show origin/main:.../TopSheet.tsx`; `grep -nE "onPointer|GestureDetector|dismissGesture|Gesture\.Pan" `.
- **Evidence (verbatim):** `TopSheetPanelInner` doc: "Native variant passes the `Gesture.Pan()`; **web passes `undefined` (web has no pan** — dismiss is via scrim-tap / Escape ...)" (lines 473-477). Web render path (`TopSheetWeb`, 600-821) has only `handleScrimPress` + an Escape `keydown` listener; no `onPointer*`. Native path attaches `panGesture = Gesture.Pan()` (line 343) via `WebSafeGestureDetector` to the handle only.
- **Mechanism:** The web variant deliberately omits the drag gesture (ORCH-1173 R2 decision to keep the Android brand list a plain ScrollView). There is no gesture element, so touch-action is irrelevant; the gap is missing-feature, not broken-feature.
- **Severity:** `RULED OUT` for the touch-action bug; logged as a **parity discovery** (see Discoveries).

### F-3 — UniversalCreatorSheet / GlobalSearchSheet / CoverPickerSheet: wrappers, inherit primitive behavior
- **Symptom:** n/a.
- **Layer:** code.
- **Probe:** grep for `TopSheet`/`Sheet`/`onPointer`/`GestureDetector` in each.
- **Evidence:** `UniversalCreatorSheet.tsx:264` `<TopSheet ... heightMode="compact">`; `GlobalSearchSheet.tsx:30` imports `Sheet` (→ `SheetMobile` on narrow web per `Sheet.tsx:20` re-export + `Sheet.web.tsx` narrow path); `CoverPickerSheet.tsx:95` `<Sheet ... snapPoint="full">`. None define their own pointer/touch handlers.
- **Mechanism:** They inherit: TopSheet-based → no web swipe (parity gap, F-2); Sheet/SheetMobile-based → fixed swipe-down (F-1).
- **Severity:** `RULED OUT`.

### F-4 — BaseBottomSheet (consumer): native-only via gorhom/reanimated; not subject to CSS bug
- **Symptom:** n/a.
- **Layer:** code.
- **Probe:** grep for gorhom/onPointer/touchAction/.web variant; `git ls-tree` app-mobile.
- **Evidence:** `import BottomSheet, { ... } from '@gorhom/bottom-sheet'` (lines 45-50); swipe-down via gorhom PanGestureHandler (lines 795-796 comment). No `.web.tsx` sibling; zero `.web.tsx` files under `app-mobile/src`. No `onPointer*`/`touchAction`.
- **Mechanism:** Consumer app ships native iOS/Android; its swipe is the reanimated/gesture-handler system, not CSS pointer events. Not exposed to the production web path and not gated by CSS `touch-action`.
- **Severity:** `RULED OUT` (N/A).

### F-5 — No other web drag-dismiss surface anywhere
- **Probe/Evidence:** repo-wide `git grep onPointerDown origin/main -- mingla-business/src app-mobile/src packages` → only `SheetMobile.tsx` (+ its test). `setPointerCapture` → only SheetMobile. `onTouchStart|onTouchMove|PanResponder` in web sheets → none. Only other sheet/drawer `.web.tsx` = `TemplatePreviewDrawer.web.tsx` (no Modal, no drag, `onPress={onClose}` only).
- **Severity:** `RULED OUT` (confirms the bug class is contained to F-1).

---

## Per-sheet result table

| Sheet / primitive | Web swipe-dismiss? | Direction | Gesture element `touch-action` (web) | VERDICT | Fix |
|---|---|---|---|---|---|
| `SheetMobile.tsx` (SheetWeb) | YES (pointer-drag) | DOWN | `none` on both `webDragCatch` gesture el (L1018) + panel (L889) | **OK** (ORCH-1208 fix complete, `f052aec81`) | None — already fixed; guarded by `orch1208WebDragCatchTouchAction.test.ts` |
| `TopSheet.tsx` (TopSheetWeb) | NO (scrim-tap + Escape only) | UP (native only) | N/A (no gesture element on web) | **N/A** (parity gap, not the bug) | None required for the bug. *If swipe-up parity wanted (NEW work):* add a pointer-drag handle band with `touchAction:"none"` (or `pan-x` if horizontal panning must coexist). |
| `UniversalCreatorSheet.tsx` | NO (inherits TopSheet) | — | N/A | **N/A** (inherits TopSheet gap) | None |
| `GlobalSearchSheet.tsx` | YES (inherits Sheet→SheetMobile, narrow web) | DOWN | inherits SheetMobile `none` | **OK** | None |
| `Sheet.web.tsx` (narrow <1024px) | YES (delegates to SheetMobile) | DOWN | inherits SheetMobile `none` | **OK** | None |
| `Sheet.web.tsx` (wide ≥1024px desktop card) | NO (backdrop-tap Modal) | — | N/A (desktop = mouse) | **N/A** | None |
| `CoverPickerSheet.tsx` | YES (inherits Sheet→SheetMobile) | DOWN | inherits SheetMobile `none` | **OK** | None |
| `TemplatePreviewDrawer.web.tsx` | NO (inline pane / overlay, onPress close) | — | N/A | **N/A** | None |
| `BaseBottomSheet.tsx` (app-mobile consumer) | NO web variant; native gorhom/reanimated | DOWN (native) | N/A (no CSS pointer path) | **N/A** (native-only) | None |

---

## Five-Truth-Layer reconciliation

| Layer | Finding |
|---|---|
| Docs | Memory + COMMS-0052/0056/0057 + ORCH-1207/1208 commits describe the swipe-down web sheet + the touch-action root cause. Consistent. |
| Schema | N/A (pure client CSS/gesture concern). |
| Code | SheetMobile is the only pointer-drag-dismiss; fix present on origin/main HEAD. TopSheet web intentionally omits drag. No contradictions. |
| Runtime | Mechanism measured by ORCH-1208 on Seth's real Samsung (adb+CDP): pre-fix `touch-action:auto` on drag-catch → `pointercancel`; post-fix dismiss works. Not re-run here (already device-proven; would be redundant). |
| Data | N/A. |

No cross-layer contradictions. (One transient artifact during this investigation: a `/tmp` extract of SheetMobile was taken a moment before the re-fetch and lacked the L1018 line; re-reading `origin/main` HEAD `f052aec81` confirmed the fix IS present — corrected, no impact on conclusions.)

---

## Repro evidence

Not independently re-run on a device this turn: the exact mechanism (drag-catch computed `touch-action:auto` → `pointercancel` → no dismiss) was already MEASURED by the orchestrator on Seth's physical Samsung via adb+CDP and is documented verbatim in the ORCH-1208 commit message and the `orch1208WebDragCatchTouchAction.test.ts` header. Re-measuring the same surface would be redundant. Source confirmation of the post-fix state on origin/main HEAD is `proven`. For the OTHER sheets, no web drag-dismiss gesture element exists (TopSheet/UCS) or they inherit the fixed primitive (Sheet/SheetMobile chain) — so there is no separate touch device repro to run.

---

## Blast radius / cross-surface map

- **In-scope surface for the bug class:** Buyer/anonymous Web + Business Web preview (the `mingla-business` web build, narrow touch viewport). This is where SheetMobile's `SheetWeb` runs.
- **Affected files (the whole blast radius):** exactly ONE — `mingla-business/src/components/ui/SheetMobile.tsx` — and it is **already fixed** (ORCH-1208, `f052aec81`). All Sheet-based consumers (GlobalSearchSheet, CoverPickerSheet, any `<Sheet>` on a public page) inherit the fix automatically (shared primitive).
- **Not affected:** Consumer iOS / Consumer Android / Business iOS / Business Android (native gesture systems, not CSS). Admin Web (no Mingla sheet primitive). Wide-desktop card path (mouse).
- **Recurring-pattern note:** the lesson — *`touch-action:none` must sit on the actual pointer-capturing element, not merely a transformed ancestor* — applies to ANY future web pointer-drag gesture. The TopSheet web-swipe-up parity gap (if ever built) is the next place this lesson would need to be applied proactively.

---

## Invariant impact

- ORCH-1208's fix is guarded by `orch1208WebDragCatchTouchAction.test.ts` (fails-on-revert; asserts `touchAction:"none"` inside the `webDragCatch` block). Keep it.
- Candidate (NOT created here — flag only): a strict-grep/jest invariant of the form "every web sheet gesture element that attaches `onPointerDown` MUST declare `touch-action:none` on that same element." Today the population is exactly one element, but it would catch a regression if a future sheet adds web drag. Decision belongs to the orchestrator.

---

## Discoveries for Orchestrator

1. **PARITY GAP (not a bug):** `TopSheet.tsx` web variant (and therefore `UniversalCreatorSheet`) has NO swipe-to-dismiss on web — only scrim-tap + Escape. Native swipes UP to dismiss. This is the intentional ORCH-1173 R2 design (`dismissGesture={undefined}` on web). If web swipe-up parity is desired it is a NEW ORCH; the implementation MUST put `touch-action:none` (or `pan-x`) on the new gesture handle band from day one.
2. **Hardening candidate:** a generalized "pointer-drag element must carry touch-action:none" gate (see Invariant impact). Low urgency (population = 1) but cheap insurance.
3. **ID-space (from COMMS-0056/0057):** ORCH-1206 collides (rsvp-pass keeps it); sheet-snap renumbers to 1207+. Next free ID for any follow-on ≈ ORCH-1209+ (1206/1207/1208 consumed). Confirm via `git fetch` + WORLD_MAP scan before claiming.

---

## Confidence

**proven** — for the central conclusions: (a) SheetMobile is the sole web pointer-drag-dismiss surface (repo-wide grep), (b) its ORCH-1208 fix is complete on origin/main HEAD `f052aec81` (both gesture element + panel carry `touch-action:none`, guarded by a fails-on-revert test), and (c) every other sheet is either a wrapper inheriting the fixed primitive, has no web drag (TopSheet family — parity gap), or is native-only (BaseBottomSheet). The runtime mechanism is device-proven (ORCH-1208 on Seth's Samsung); not re-measured this turn as it would be redundant.

## Recommended next phase + scope

**No fix needed for the touch-action bug class — it is CLOSED with ORCH-1208 (#628, on main).** No further INVESTIGATE or SPEC is required for the bug. The only optional follow-on is a product decision (orchestrator/Seth): whether to (1) build TopSheet web swipe-up-to-dismiss parity, and/or (2) add the generalized touch-action gate. Both are NEW scope, not part of this bug class.

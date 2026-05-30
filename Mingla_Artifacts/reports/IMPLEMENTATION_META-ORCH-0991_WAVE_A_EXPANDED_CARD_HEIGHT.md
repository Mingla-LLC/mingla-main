# IMPLEMENTATION / INVESTIGATION — META-ORCH-0991 Wave A: expanded-card sheet "height regression"

**Status:** investigated only — NO code change shipped. The reported regression does not
exist at the sheet-position level (proven on the iPhone 17 Pro simulator). The prescribed
fix (`enableDynamicSizing` default → `true`) was applied as a probe, proven to be a no-op
for the symptom, and reverted. The actual operator desire ("ride all the way to the top")
is a SPEC-locked snap-point/index product decision affecting all 5 sheets — escalated to
the orchestrator/operator rather than changed silently.

**Verdict:** NO REGRESSION between `ExpandedCardModal` and `ExpandedBusinessEventSheet`.
They render at the IDENTICAL top position today (y=262 px = 10% from top = the 90% snap).

---

## 1. What was reported

Operator (Seth) via orchestrator dispatch: the expanded card (`ExpandedCardModal`) "used to
open all the way up to the top (like `ExpandedBusinessEventSheet`), but after the
BaseBottomSheet migration it no longer rides up to the top."

Orchestrator prime suspect: original `ExpandedCardModal <BottomSheet>` set NO
`enableDynamicSizing` → gorhom v5.2.8 default `true`; migrated `BaseBottomSheet` defaults it
to `false` → divergence.

## 2. Live reproduction (iPhone 17 Pro `17091E60-...`, iOS 26.4, Metro :8100)

Had to rebuild the dev binary first: the installed `Mingla.app` predated the `expo-video`
native add (COMMS-0007), so JS crashed at launch with `Cannot find native module 'ExpoVideo'`.
Ran `pod install` in the anchor (`~/Desktop/mingla-main/app-mobile/ios`, shared node_modules
now carries `expo-video ~3.0.16`), built Debug via the runbook `xcodebuild` + embed-frameworks
+ codesign sequence, reinstalled. ExpoVideo verified statically linked (5447 symbols in
`Mingla.debug.dylib`). Connected to the worktree's Metro :8100 (which had died mid-session —
restarted from this worktree, never global-killed; port 8100 owned by this ORCH).

Screenshots captured (in `/tmp/`):
- `m0991_card_expanded_BEFORE.png` — expanded card (Sky Zone, deck path, WITH review-nav header)
- `m0991_event_sheet_REF.png` — `ExpandedBusinessEventSheet` (R&B Soul Session)
- `m0991_card_AFTER.png` — expanded card (Wye Hill Kitchen, Saved path, NO header) with probe
- `m0991_event_sheet_AFTER.png` — events sheet with probe

## 3. Pixel measurement (pure-Python PNG decode, center-column brightness profile)

Screen 1206×2622. Backdrop dim = rgb(6,7,9) down to y≈235.

| Surface | Sheet top edge (handle row) | % from top | Snap |
|---|---|---|---|
| Card BEFORE (`false`) | y=262 | 10.0% | 90% |
| Card AFTER probe (`true`) | y=262 | 10.0% | 90% |
| Events sheet REF (`false`) | y=262 | 10.0% | 90% |

All three land on **y=262 (10% from top)** — the 90% snap point. Card and events sheet are
pixel-identical. The `enableDynamicSizing` flag flip moved the card 0 px.

## 4. Root cause of the (non-)effect — gorhom v5.2.8 mechanics

`@gorhom/bottom-sheet` `useAnimatedDetents` (lib/module/hooks/useAnimatedDetents.js):
- With `enableDynamicSizing=false`: returns the provided normalized detents as-is → for
  `['50%','90%']` the detents are `[pos(50%), pos(90%)]` = `[0.5H, 0.1H]`. `index=1` → `0.1H`
  = the 90% position.
- With `enableDynamicSizing=true`: computes a dynamic content detent
  `containerHeight - min(content+handle, containerHeight)`, **pushes** it, and **re-sorts
  descending**. For tall content (both these sheets), the dynamic detent ≈ 0 (top) and lands
  at **index 2**, an entry NOT reached at `initialIndex=1`. The 90% explicit snap stays at
  index 1. → `index=1` still resolves to 90%. Identical render.

Therefore `enableDynamicSizing` does not change the open position for either sheet. The
migration's `false` default is behaviourally equivalent to the original `true` for these
two index-1 consumers.

## 5. Original behaviour (git archaeology — confirms no prior "to the top")

- Pre-migration `ExpandedCardModal` (`42bc0d336^`): `<BottomSheet index={visible ? 1 : -1}
  snapPoints={glass.bottomSheet.snapPoints /* ['50%','90%'] */}>`, no `enableDynamicSizing`
  (→ default true). Opened at 90%.
- Pre-migration `ExpandedBusinessEventSheet` (`4e113a3c8^`): `SHEET_INITIAL_INDEX = 1` ("open
  at the 90% snap (full view)"), same snap points, no `enableDynamicSizing` (→ default true).
  Inline comment literally references "the prior portal-based approach with
  `enableDynamicSizing=true`."

Both sheets always opened at the 90% snap. There was never a sheet-level "rides all the way
to the top" state — 90% inherently leaves a ~10% top gap. The migration preserved this exactly.

## 6. Decision — why no code shipped

- Spec is law (Prime Directive #2): `snapPoints` (`['50%','90%']`) and `initialIndex` (1) are
  the locked Wave-A contract; the regression suite asserts the index-(-1)/onClose routing.
- The prescribed `enableDynamicSizing=true` is a proven no-op for the symptom AND would make
  the dynamic top-detent reachable for SHORT-content sheets (changing their behaviour) — a
  silent side effect, not a fix. Reverted.
- Making the sheets "ride to the top" requires changing the open snap (e.g. a top-anchored
  `'92%'`/`topInset` snap or `initialIndex` change), which affects ALL 5 migrated sheets and
  is a product/UX decision. Per Prime Directive #7 + diagnose-first, escalated rather than
  guessed.

## 7. Verification matrix

| Item | Result |
|---|---|
| Reproduced on sim before fixing | YES — card + events sheet captured, measured |
| True cause pinned (not assumed) | YES — gorhom detent sort + pixel measurement + git archaeology |
| Card opens like events sheet | ALREADY TRUE — both y=262 (10%), pixel-identical |
| Probe (`true`) effect | no-op (y=262 → y=262), reverted |
| Other 4 sheets regressed by probe | events sheet verified unchanged; probe reverted so moot |
| Regression suite | PASS (`node src/components/ui/__tests__/BaseBottomSheet.test.mjs`) |
| Working tree | clean (no diff; node_modules untracked only) |
| tsc | unaffected (zero source change) |

## 8. Discoveries for orchestrator

- **No regression exists.** If Seth still wants both sheets higher than 90%, that is a new
  scope item: change the open snap for the shared `glass.bottomSheet.snapPoints` and/or
  `initialIndex`, design-reviewed, applied across all 5 Wave-A consumers, with the regression
  suite extended to assert the new snap. This is a product/UX call, not a bug fix.
- The installed sim binary was stale (no ExpoVideo); the anchor `ios/Pods` was also stale.
  Anyone testing app-mobile on sim after COMMS-0007 must `pod install` + rebuild first.
- Worktree Metro on :8100 had died before this session; restarted from the worktree.

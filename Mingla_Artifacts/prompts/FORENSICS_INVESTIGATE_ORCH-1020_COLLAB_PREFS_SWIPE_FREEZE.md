# FORENSICS — INVESTIGATE — ORCH-1020

**[Collab group-chat deck — preferences sheet swipe-down freezes the app]**

Invoke the `mingla-forensics` skill in **INVESTIGATE** mode. This is investigation only — prove what is broken with evidence. Do NOT propose or write fixes (that is the SPEC phase that follows).

`cd ~/Desktop/mingla-orchs/ORCH-1020-[collab-deck-prefs-swipe-freeze]` — branch `ORCH-1020-collab-deck-prefs-swipe-freeze`, Metro port `8088`.

## Symptom (operator, 2026-05-30)
In a **collaboration-session group-chat deck**, the user opens the preferences sheet (the gear/settings icon in the deck header) and then **swipes it down to dismiss** — the app **freezes** (unresponsive, requires force-quit). Reported generically; platform not specified.

## Scope
- **Affected Surfaces:** Consumer iOS, Consumer Android.
- NOT in scope: buyer-web, business iOS/Android, admin-web, business-web-preview. Collab decks exist only in the consumer-app group chat.

## Orchestrator's source-level lead (treat as a HYPOTHESIS to prove or refute — NOT a conclusion)
- `app-mobile/src/components/connections/CollabDeckSheet.tsx` renders an RN `<Modal animationType="slide" presentationStyle="fullScreen">` (the deck) and mounts `<PreferencesSheet visible={showPrefsSheet} … />` inside it (lines ~71-150). Swipe-down → gorhom `onChange(-1)` → `onClose` → `setShowPrefsSheet(false)`.
- `app-mobile/src/components/PreferencesSheet.tsx`: when the `visible` prop is supplied (the collab path), it renders via `<BaseBottomSheet … wrapInRNModal …>` (lines ~1478-1519). This path was introduced by **META-ORCH-0991 Wave C** (commit `ccf848aaa`, PR #266). Before that, the collab `visible` path was a hand-rolled RN-Modal sheet.
- `app-mobile/src/components/ui/BaseBottomSheet.tsx`: with `wrapInRNModal` (lines ~608-636) the gorhom `<BottomSheet>` is wrapped in a SECOND RN `<Modal transparent animationType="none" statusBarTranslucent>` plus an inner `GestureHandlerRootView`.
- **Net nesting unique to the collab deck:** `fullScreen RN Modal (CollabDeckSheet) → transparent RN Modal (BaseBottomSheet wrapInRNModal) → GestureHandlerRootView → gorhom BottomSheet`. Grep confirms `CollabDeckSheet.tsx` is the ONLY `presentationStyle="fullScreen"` RN Modal in `app-mobile/src/`. The **solo** `PreferencesSheet` is mounted from `app/index.tsx` NOT inside a fullScreen Modal, so it does not reproduce — matching the collab-only symptom.
- Hypothesised mechanism: iOS racing `UIViewController` modal dismissal animations, and/or the pan-gesture callback flipping the inner Modal's `visible=false` (via `setShowPrefsSheet(false)`) while gorhom's own close animation + `sheetRef.current?.close()` (BaseBottomSheet `useEffect` on `visible`) also run — a known nested-modal freeze class on iOS.

## Mandatory method (per operator memory — non-negotiable)
1. **Reproduce on the iOS simulator before claiming anything above "suspected."** A booted iPhone 17 Pro Max (`2C3312D9-EE52-4EBD-9704-15811D49A2EC`) is available. Source-only reasoning maxes at "suspected"; a sim repro is required for "probable"/"confirmed" (`feedback_always_simulator_repro_described_behaviour.md`). Use Maestro as the default driver (`~/.maestro/bin/maestro --device <UDID>`); never osascript keystrokes (`feedback_sim_test_drivers_maestro_default.md`). If a sim/Metro/worktree-node_modules blocker appears, RESOLVE it (full machine trust) — "blocked" is not a terminal verdict (`feedback_sim_boot_blocker_must_resolve_not_note.md`). Load the latest bundle on the booted sim before testing (`feedback_sim_load_latest_bundle_before_test.md`).
2. Getting into a real collaboration group-chat deck requires a session with ≥2 accepted participants (see `feedback_collab_deck_lives_in_group_chat.md`). Establish that state (existing seed session, deep-link, or minimal scaffolding) so the gear → swipe-down repro runs against the genuine `CollabDeckSheet` mount, not the solo path. Document exactly how you got there.
3. Confirm or deny the **same gesture on the SOLO preferences sheet** (from Home Explore via `app/index.tsx`) does NOT freeze — this isolates the nested-modal stack as the differentiator.
4. Confirm/deny Android (emulator) behavior; note the platform asymmetry the `BaseBottomSheet` Bug-1 comment predicts ("swipe-down dead on Android, fragile on iOS").
5. Trace the dismissal control flow end-to-end with six-field evidence (file:line, what fires, in what order, on which thread, observed runtime state, and what stalls). Capture Metro / device logs around the freeze (look for stuck JS thread, unfinished animation, gesture-handler warnings, `Modal`/`RCTModalHostView` errors).

## Constraints / guards
- INVESTIGATE only — no source fixes, no scope expansion. The SPEC phase decides the fix.
- Honor the load-bearing `BaseBottomSheet` architecture invariants (do not propose adding `BottomSheetModalProvider` / `@gorhom/portal` — those are explicitly locked out; ORCH-0828). If the right fix touches that, flag it for the SPEC to reconcile against the invariant, don't pre-decide.
- No anchor-checkout edits; all work under this worktree. Do not run `reset --hard`/`checkout --`/`add -A` on the shared anchor (`feedback_shared_anchor_checkout_staging_hazard.md`).
- Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry; no open BLOCK entries target ORCH-1020 (COMMS-0002/0003/0004 are ALL-WARN and informational here — no external API / new backend file / ID-claim work in an INVESTIGATE).

## Success criteria (`/goal`)
Investigation is complete when the report: (a) states a sim-proven repro of the freeze in the collab group-chat preferences sheet on swipe-down (with the exact steps + captured evidence), (b) proves the root-cause mechanism with the dismissal control-flow trace and confirms/denies the nested-modal hypothesis above, (c) shows the solo prefs sheet does NOT freeze under the same gesture (isolation), (d) records Android behavior, (e) maps blast radius (any other `wrapInRNModal`-inside-a-Modal call sites — grep says only CollabDeckSheet, confirm), and (f) classifies severity + invariant impact. No fix proposed.

## Output
Write the report to `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1020_COLLAB_PREFS_SWIPE_FREEZE.md` in this worktree. Return a 1-paragraph summary (root cause + repro status + recommended next phase) as your final message.

## Downstream routing
After the report returns, the orchestrator runs its REVIEW gate, then dispatches SPEC (same `mingla-forensics` skill) → IMPLEMENT → TEST (sim re-repro) → CLOSE.

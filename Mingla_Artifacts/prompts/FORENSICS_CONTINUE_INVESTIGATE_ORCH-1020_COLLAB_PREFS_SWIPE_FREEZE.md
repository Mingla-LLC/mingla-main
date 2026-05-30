# FORENSICS — CONTINUE INVESTIGATE — ORCH-1020

**[Collab group-chat deck — preferences sheet swipe-down freezes the app]**

Invoke the `mingla-forensics` skill in **INVESTIGATE** mode. Continue ORCH-1020 from the existing worktree and produce the final investigation report. This is investigation only. Do **not** propose fixes and do **not** write source code.

`cd ~/Desktop/mingla-orchs/ORCH-1020-[collab-deck-prefs-swipe-freeze]` — branch `ORCH-1020-collab-deck-prefs-swipe-freeze`.

## Required intake

Read these files first:

1. `Mingla_Artifacts/prompts/FORENSICS_INVESTIGATE_ORCH-1020_COLLAB_PREFS_SWIPE_FREEZE.md` — original dispatch and source-level hypothesis.
2. `Mingla_Artifacts/reports/PARTIAL_INVESTIGATION_ORCH-1020_COLLAB_PREFS_SWIPE_FREEZE.md` — partial runtime evidence from the interrupted prior run.
3. `Mingla_Artifacts/WORLD_MAP.md` ORCH-1020 banner.
4. `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` — read on entry and act on any open BLOCK/WARN entries that target you, ORCH-1020, or ALL.

## Important correction from the partial run

The nested-modal source hypothesis is **not proven**. A prior partial iOS run reached a real `Fly Group` `CollabDeckSheet`, opened collab preferences, and tried several swipe-down gestures. It did **not** freeze; the deck remained responsive and the sheet could be reopened. Treat that as partial evidence to explain or overturn, not as a PASS and not as a completed investigation.

## Investigation goal

Prove one of these outcomes with evidence:

1. **Confirmed freeze:** reproduce the operator-reported freeze on a real collab group-chat preferences sheet, isolate the trigger, and trace the control flow/root cause.
2. **Conditional/non-deterministic freeze:** reproduce only under narrower preconditions, then document exactly which preconditions matter.
3. **Not reproduced after controlled attempts:** state plainly that runtime evidence does not currently support the freeze report, preserve the source-level risk, and recommend whether ORCH-1020 should stay open for operator repro capture or be downgraded.

Do not force a root cause just because the source hypothesis is elegant. Evidence wins.

## Mandatory runtime coverage

### iOS

- Use the available iPhone 17 Pro Max sim if still booted: `2C3312D9-EE52-4EBD-9704-15811D49A2EC`.
- Load the latest bundle before testing. If port `8088` is unavailable, either free it or use another port, but document the exact Metro process and prove the tested code matches the ORCH-1020 branch for the suspect files.
- Use Maestro as the default driver; no osascript keystrokes.
- Test a genuine collaboration group-chat deck, not solo prefs. At minimum test `Fly Group`; also try `Testing stuff` if available because prior navigation proved it exists in the chat list.
- Test the solo preferences sheet with the same gesture as the control path.
- Record screenshots or video for each decisive pass/fail attempt.
- Capture Metro/device logs around the gesture. If no logs are emitted, record that explicitly.

### Android

- Finish the Android check that the partial run did not complete.
- Use emulator `emulator-5554` if still available, or another installed Android target with `com.mingla.app.v2`.
- Open the same real collab group-chat deck path, open preferences, perform the same gesture, and record whether it freezes, dismisses, scrolls, or is inert.

## Source trace requirements

Trace these flows with file:line evidence:

- `CollabDeckSheet` full-screen RN Modal mount and `PreferencesSheet` mount.
- `PreferencesSheet` `visible`-prop path through `BaseBottomSheet wrapInRNModal`.
- `BaseBottomSheet` `onChange(-1)` / `onClose` / visible-close control flow.
- Any parent or child state transitions that could unmount the inner transparent Modal while gorhom is animating.
- Every other `wrapInRNModal` inside an RN Modal or modal-like parent. If `CollabDeckSheet` remains unique, prove it with grep output.

## Constraints

- Investigation only. No source edits.
- Do not propose `BottomSheetModalProvider`, `@gorhom/portal`, or any fix that violates ORCH-0828 without explicitly routing it as an invariant conflict for SPEC.
- No lifecycle compression. The next phase after this report is orchestrator REVIEW, then SPEC only if the report proves a fixable bug.
- If login, seed data, a second participant, or operator-specific repro data is required, stop and ask Seth exactly what you need. Do not fabricate a repro.

## Output

Write the final report to:

`Mingla_Artifacts/reports/INVESTIGATION_ORCH-1020_COLLAB_PREFS_SWIPE_FREEZE.md`

The report must include:

- Repro verdict: confirmed, conditional, or not reproduced.
- Exact iOS steps and evidence.
- Exact Android steps and evidence.
- Solo-control result.
- Root-cause or risk assessment, clearly separating facts from inference.
- Blast radius.
- Severity recommendation.
- Recommended next lifecycle phase: SPEC, operator repro capture, downgrade/defer, or close as not reproduced.

Return a one-paragraph summary to the orchestrator after writing the report.

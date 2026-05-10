# Review Runtime QA ORCH-0772 Event Cover Native Player Disposed Pause Exception

Date: 2026-05-09
Mode: ORCHESTRATOR REVIEW
Reviewed report: `Mingla_Artifacts/reports/RUNTIME_QA_ORCH-0772_EVENT_COVER_NATIVE_PLAYER_DISPOSED_PAUSE_EXCEPTION.md`

## Plain-English Outcome

The scary red iOS native video error is no longer reproduced in the tester's available runtime pass. The code-level fix is also present and guarded by tests.

This is still not a full close because tester could not exercise the exact public-event close/unmount path that originally mattered most. So the right program state is not "failed" and not "closed"; it is **conditional pass with one runtime route-unmount confirmation still required**.

## Evidence Accepted

- Static Jest gate passed: `eventCoverMedia.test.ts` and `serverDraftLifecycleGuards.test.ts`, 26 tests passed.
- TypeScript passed with `npx tsc --noEmit`.
- Targeted ESLint passed for `EventCoverMedia.tsx`, `eventCoverMedia.test.ts`, and `PublicEventPage.tsx`.
- Source verification confirms `EventCoverMedia.tsx` now routes native play/pause/replay calls through `callNativeVideoPlayer`.
- Source verification confirms only disposed native shared-object errors are suppressed; unknown media/player errors are rethrown.
- iOS simulator log query after relaunch and foreground/background cycles did not find `NativeSharedObjectNotFoundException`, `FunctionCallException`, `Calling the 'pause' function`, or `Unable to find the native shared object`.
- Runtime logs showed CoreMedia activity, so tester did exercise a native media runtime surface rather than a purely inert screen.

## Remaining Gap

Tester could not prove the public event page Close/unmount path. That matters because the original failure was a teardown/lifecycle race, and route close/unmount is the riskiest path.

The next check does not need a new implementation prompt unless the error returns. It needs a focused runtime confirmation:

1. Open a public event page or event-cover video surface.
2. Confirm the current bundle is the patched bundle.
3. Close/navigate away so `EventCoverMedia` unmounts or becomes inactive.
4. Pull logs immediately.
5. Confirm no `NativeSharedObjectNotFoundException` / disposed native shared object / `pause()` red error appears.

## Relationship To Other Open Items

- ORCH-0772 is narrower than ORCH-0771. ORCH-0772 is about suppressing a disposed native player teardown exception safely.
- ORCH-0771 remains runtime-blocked because tester still needs an audible public event video fixture to prove audio stops after close and does not resume.
- ORCH-0770 remains runtime-blocked because the full phone-video-to-processed-public-MP4 journey still lacks real job/browser playback proof.
- ORCH-0773 is separate and should be dispatched next because draft autosave `PGRST116` can lose organiser edits and contaminate media runtime testing.

## Verdict

**CONDITIONAL PASS / KEEP OPEN.**

No implementor rework is recommended for ORCH-0772 right now. The next evidence needed is a focused public-event route-unmount runtime confirmation. If that pass stays clean, ORCH-0772 can be closed independently of ORCH-0770 and ORCH-0771.


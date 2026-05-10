# Review Hotfix ORCH-0772 - Event Cover Native Player Disposed Pause Exception

> Date: 2026-05-09  
> Mode: Orchestrator REVIEW  
> Reviewed inputs: operator iOS log, current diff in `EventCoverMedia.tsx`, updated `eventCoverMedia.test.ts`, and local verification output from the hotfix pass  
> Decision: Accept as scoped hotfix candidate; do not close.

## Plain-English Verdict

The red iOS error is real and launch-relevant: Mingla cannot fix leaked public-event audio by introducing repeated native runtime exceptions during normal event-cover teardown.

The current hotfix is directionally correct and narrow. It keeps ORCH-0771's active-playback/silence contract intact, but guards Expo native-player `play` / `pause` / `replay` calls against the specific disposed shared-object failure shown in the operator log:

```text
NativeSharedObjectNotFoundException: Unable to find the native shared object associated with given JavaScript object
```

This is not close-ready. It still needs independent tester retest on the running iOS app, including log inspection after close/unmount/AppState cycles.

## Evidence Accepted

Current source shape in `mingla-business/src/components/ui/EventCoverMedia.tsx`:

- Adds `isDisposedNativeVideoPlayerError(error)` matching only:
  - `NativeSharedObjectNotFoundException`
  - `Unable to find the native shared object`
- Adds `callNativeVideoPlayer(action)` that catches only that disposed-player condition.
- Leaves unknown native/player exceptions visible by rethrowing them.
- Routes native `nextPlayer.play()`, `player.play()`, `player.pause()`, and replay/play sequences through the guard.
- Preserves ORCH-0771 `shouldPlay = autoplay && playbackActive`.
- Preserves AppState inactive/background pause behavior.
- Preserves cleanup pause behavior instead of deleting it.
- Preserves public-page autoplay/auto-resume intent while the page remains active.

Updated automated guard in `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` now asserts:

- `isDisposedNativeVideoPlayerError`
- `callNativeVideoPlayer`
- `NativeSharedObjectNotFoundException`
- guarded play/pause source shape
- existing ORCH-0771 playback-active contract remains present

Verification reported from the hotfix pass:

- `cd mingla-business && npm run test:orch-0771 -- --runInBand` - PASS, 26 tests.
- `cd mingla-business && npx tsc --noEmit` - PASS.
- `cd mingla-business && npx eslint src/components/ui/EventCoverMedia.tsx src/components/ui/__tests__/eventCoverMedia.test.ts` - PASS.

Watchman emitted the existing recrawl warning during Jest. It did not block the run.

## Process Note

ORCH-0772 was registered for forensics after the operator log, but the narrow code hotfix was applied before a separate forensics/spec report returned. This review records that reality rather than rewriting history.

Because the fix is small and directly targets the thrown native exception while preserving the already-approved ORCH-0771 contract, the next best gate is not more blind implementation. It is independent tester retest against the exact runtime failure and the original ORCH-0771 audio lifecycle.

If tester still sees the native exception, stale audio, or swallowed unrelated media errors, ORCH-0772 must go back through `$forensics` using `prompts/FORENSICS_ORCH-0772_EVENT_COVER_NATIVE_PLAYER_DISPOSED_PAUSE_EXCEPTION.md`.

## Remaining Close Blockers

- iOS runtime must prove the repeated `NativeSharedObjectNotFoundException` no longer appears after reload/rebundle.
- Closing public event pages must still stop video audio immediately.
- AppState inactive/background must still pause video.
- AppState/share-sheet active resume must occur only while the same public event page remains open.
- Unknown/native media errors must not be hidden by the disposed-player guard.
- A true audible public event video fixture is still required to close ORCH-0771's audio claim; the prior runtime report was blocked because the available video had no audio track.

## Lifecycle Decision

Keep ORCH-0772 **OPEN - HOTFIX CANDIDATE / TESTER RETEST NEXT**.

Next handoff:

`Mingla_Artifacts/prompts/TESTER_RUNTIME_ORCH-0772_EVENT_COVER_NATIVE_PLAYER_DISPOSED_PAUSE_EXCEPTION.md`

Expected output:

`Mingla_Artifacts/reports/RUNTIME_QA_ORCH-0772_EVENT_COVER_NATIVE_PLAYER_DISPOSED_PAUSE_EXCEPTION.md`

ORCH-0771 also remains open until runtime audio verification passes with an audible fixture.

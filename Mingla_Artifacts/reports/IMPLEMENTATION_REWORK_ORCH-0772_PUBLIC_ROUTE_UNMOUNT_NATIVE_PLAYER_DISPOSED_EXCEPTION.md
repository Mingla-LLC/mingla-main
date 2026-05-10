# Implementation Rework ORCH-0772 Public Route Unmount Native Player Disposed Exception

Date: 2026-05-09
Role: `$implementor`
Status: implemented and verified

## Plain-English Outcome

The public event video teardown path no longer calls native `player.pause()` during route-unmount cleanup.

The previous guard caught disposed-player exceptions in JavaScript, but the iOS native layer still logged the scary Expo `NativeSharedObjectNotFoundException` when cleanup invoked `pause()` after the native shared object had already been released. This rework removes that cleanup-time native pause call and keeps pause behavior in mounted lifecycle paths where the Expo player is still expected to be valid.

## Files Changed

- `mingla-business/src/components/ui/EventCoverMedia.tsx`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`

## Lifecycle Change

Old behavior:

- `EventCoverNativeVideo` cleanup removed listeners and called `player.pause()`.
- On public event route-unmount, Expo could already have disposed the native shared object, so the cleanup call itself produced `FunctionCallException` / `NativeSharedObjectNotFoundException`.

New behavior:

- Cleanup for the play-to-end/AppState effect only removes listeners:
  - `playToEndSub.remove()`
  - `appStateSub.remove()`
- Mounted playback transitions still pause:
  - `shouldPlay === false` calls guarded `player.pause()`.
  - AppState `inactive` / `background` calls guarded `player.pause()`.
- Mounted active playback still plays/resumes:
  - initial setup plays only when `shouldPlay`.
  - `readyToPlay` plays only when `shouldPlay`.
  - AppState `active` resumes only when `shouldPlay`.
  - loop replay remains gated by `loop && shouldPlay`.

## Why ORCH-0771 Active Playback Still Works

The active-page contract is unchanged:

- `const shouldPlay = autoplay && playbackActive` still owns native and web playback intent.
- Public event close still sets `mediaPlaybackActive(false)` before route replacement in `PublicEventPage`.
- Web video behavior is unchanged.
- Audio control state, mute wiring, looping, reduced-motion still/video fallback, and `showAudioControl` remain untouched.

This means active public pages can still autoplay and auto-resume, while inactive/background surfaces pause while mounted. Route unmount then disposes/removes the video surface without making an additional unsafe native pause call.

## Regression Test Added

Added a focused source guard in `eventCoverMedia.test.ts`:

- proves the native cleanup block removes `playToEndSub` and `appStateSub`;
- proves that cleanup block does not contain `player.pause`;
- proves that cleanup block does not contain `callNativeVideoPlayer`;
- still requires mounted pause behavior and AppState inactive/background pause behavior to exist.

This test fails on the pre-rework cleanup pattern and passes after this change.

## Verification

From `mingla-business`:

```bash
npm run test:orch-0771 -- --runInBand
```

Result: PASS

- 2 test suites passed.
- 29 tests passed.
- Watchman emitted its existing recrawl warning, but Jest completed successfully.

```bash
npx tsc --noEmit
```

Result: PASS

```bash
npx eslint src/components/ui/EventCoverMedia.tsx src/components/ui/__tests__/eventCoverMedia.test.ts src/components/event/PublicEventPage.tsx
```

Result: PASS

From repo root:

```bash
git diff --check
```

Result: PASS

## Runtime Smoke

Ran the exact ORCH-0772 public route-unmount smoke on the booted iPhone 17 Pro simulator.

Start timestamp:

```text
2026-05-09 19:40:24+0000
```

Steps:

1. Terminated and relaunched `com.sethogieva.minglabusiness`.
2. Opened `mingla-business://e/leggothis/a-life-in-vegas`.
3. Waited for the public event page to render.
4. Captured `/tmp/orch0772-rework-public-video-page.png`.
5. Routed away to `mingla-business://(tabs)/events`.
6. Captured `/tmp/orch0772-rework-after-route-away.png`.
7. Queried simulator logs for ORCH-0772 failure signatures.

Screenshots confirmed:

- `A life in vegas` public event page rendered.
- Events tab rendered after route-away.

Log query:

```bash
xcrun simctl spawn booted log show --style compact \
  --start '2026-05-09 19:40:24+0000' \
  --predicate 'process == "minglabusiness"' |
  rg -n "NativeSharedObjectNotFoundException|FunctionCallException|Calling the 'pause' function|Unable to find the native shared object|EventCoverNativeVideo" || true
```

Result: PASS

- Zero matching ORCH-0772 disposed-player signatures.
- The only emitted line in the command output was the simulator `getpwuid_r did not find a match for uid 501` noise line, not a Mingla/native-player match.

## Risks / Follow-Up

- Runtime smoke passed on the simulator/dev-client path used for the failing reproduction. Tester should still independently rerun the same route-unmount gate before orchestrator close.
- This does not close ORCH-0771 audible audio-after-close by itself; it preserves that contract but does not replace its independent runtime QA.
- This does not touch ORCH-0770 video processing/transcode/browser playback.

## Worktree Note

The worktree already contained many unrelated modified and untracked files from adjacent ORCH tracks. I changed only the scoped `EventCoverMedia` cleanup, its focused regression test, and this implementation report, and left unrelated dirty files untouched.

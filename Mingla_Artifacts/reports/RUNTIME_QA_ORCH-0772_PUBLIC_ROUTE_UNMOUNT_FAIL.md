# Runtime QA ORCH-0772 Public Route Unmount Fail

Date: 2026-05-09
Mode: ORCHESTRATOR-RUN SMOKE
Verdict: FAIL - do not close ORCH-0772

## Plain-English Outcome

The focused public-event route-unmount smoke reproduced the exact native video teardown error ORCH-0772 was supposed to clear.

The earlier conditional pass remains useful for static coverage and basic runtime relaunch/background checks, but the remaining close blocker is not cleared. When a public event page with a video cover was opened and then routed away to Events, simulator logs emitted:

```text
FunctionCallException: Calling the 'pause' function has failed
NativeSharedObjectNotFoundException: Unable to find the native shared object associated with given JavaScript object
```

ORCH-0772 must stay open and go back to focused rework. Do not treat this as ORCH-0771 audio proof or ORCH-0770 video-processing proof.

## Smoke Fixture

Public event queried from `business_public_events_view`:

- Event: `A life in vegas`
- Public route: `/e/leggothis/a-life-in-vegas`
- Event id: `b1ab659e-358d-41f3-a56d-76f7b273bddd`
- `cover_media_type`: `video`
- `cover_media_url`: Supabase public `event_covers/.../moyi4tna-i1yha1au.mov`

The smoke used the native deep link:

```bash
mingla-business://e/leggothis/a-life-in-vegas
```

Then routed away with:

```bash
mingla-business://(tabs)/events
```

## Runtime Steps

1. Confirmed a booted iPhone 17 Pro simulator.
2. Confirmed Mingla Business app bundle `com.sethogieva.minglabusiness` was installed.
3. Confirmed `mingla-business` Expo dev server was already running.
4. Terminated and relaunched `com.sethogieva.minglabusiness`.
5. Opened public event route `mingla-business://e/leggothis/a-life-in-vegas`.
6. Waited for public page render.
7. Captured screenshot: `/tmp/orch0772-public-video-page.png`.
8. Routed away to `mingla-business://(tabs)/events`.
9. Captured screenshot: `/tmp/orch0772-public-video-after-route-away.png`.
10. Queried simulator logs from start timestamp `2026-05-09 19:32:23+0000`.

Screenshots proved:

- Public event page opened for `A life in vegas`.
- Route-away landed on the Events tab.

## Failure Evidence

Command:

```bash
xcrun simctl spawn booted log show --style compact \
  --start '2026-05-09 19:32:23+0000' \
  --predicate 'process == "minglabusiness"' |
  rg -n "NativeSharedObjectNotFoundException|FunctionCallException|Calling the 'pause' function|Unable to find the native shared object|EventCoverNativeVideo" || true
```

Result:

```text
2026-05-09 15:32:44.770 E minglabusiness[...] FunctionCallException: Calling the 'pause' function has failed (at ExpoModulesCore/SyncFunctionDefinition.swift:137)
2026-05-09 15:32:44.770 E minglabusiness[...] → Caused by: NativeSharedObjectNotFoundException: Unable to find the native shared object associated with given JavaScript object (at ExpoModulesCore/DynamicSharedObjectType.swift:58)
2026-05-09 15:32:44.771 E minglabusiness[...] FunctionCallException: Calling the 'pause' function has failed (at ExpoModulesCore/SyncFunctionDefinition.swift:137)
2026-05-09 15:32:44.771 E minglabusiness[...] → Caused by: NativeSharedObjectNotFoundException: Unable to find the native shared object associated with given JavaScript object (at ExpoModulesCore/DynamicSharedObjectType.swift:58)
```

The UTC/local timestamp mismatch is expected from `log show` display style; the entries fall inside the smoke window.

## Media Runtime Evidence

The same smoke window showed native player/CoreMedia activity, so this was not a no-media route:

```text
2-channel audiovisual content is NOT eligible for spatialization
FigAudioQueueTimingShimPause
FigFilePlayer ... new playback state: Playing
FigFilePlayer ... new playback state: Paused
AVPlayerViewController ... ExpoVideo.OrientationAVPlayerViewController
```

## Current Source Context

Current `mingla-business/src/components/ui/EventCoverMedia.tsx` contains the hotfix guard:

- `isDisposedNativeVideoPlayerError`
- `callNativeVideoPlayer`
- guarded `player.play()`
- guarded `player.pause()`
- guarded cleanup pause at the native video effect return

But this smoke proves the JS `try/catch` guard is not sufficient as a close criterion: the native module still logs the disposed shared-object failure during route teardown.

Likely failure area for rework:

- `EventCoverNativeVideo` cleanup still calls `player.pause()` while the native shared object may already be disposed.
- The rework should prevent the native disposed-object call from being made on teardown, not merely catch its JS exception after Expo logs it.

## Relationship To Other ORCHs

- ORCH-0772: failed public route-unmount close gate; rework required.
- ORCH-0771: still separate. This smoke does not prove audible audio-after-close behavior; it only proves the disposed native-player error still appears.
- ORCH-0770: still separate. This smoke used an existing public video route and did not test phone-video processing/transcode/compression.
- ORCH-0773: separate stale draft autosave lifecycle issue; not implicated by this smoke.

## Required Next Action

Dispatch `$implementor` with:

`Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`

Expected output:

`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`

After implementation, tester must rerun this exact public-route smoke and confirm zero matching disposed-player signatures.

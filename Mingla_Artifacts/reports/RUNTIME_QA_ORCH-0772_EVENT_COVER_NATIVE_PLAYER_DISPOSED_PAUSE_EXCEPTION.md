# Runtime QA ORCH-0772 Event Cover Native Player Disposed Pause Exception

Date: 2026-05-09
Tester mode: TARGETED + RETEST + RUNTIME QA
Prompt: `Mingla_Artifacts/prompts/TESTER_RUNTIME_ORCH-0772_EVENT_COVER_NATIVE_PLAYER_DISPOSED_PAUSE_EXCEPTION.md`
Verdict: CONDITIONAL PASS

## Plain-English Outcome

The ORCH-0772 hotfix passes static gates and the available iOS simulator runtime did not reproduce the red `NativeSharedObjectNotFoundException` / `pause()` failure after app relaunch and foreground/background cycles with video media active.

This is not a full close-ready PASS because I could not reach and exercise a true public event page Close/unmount path from the current app state. ORCH-0771 audio-after-close also remains blocked for the separate reason recorded previously: no verified audible public event video close journey was completed in this pass.

## Static Verification

### Command: `npm run test:orch-0771 -- --runInBand`

Result: PASS.

Summary:

```text
PASS src/components/ui/__tests__/eventCoverMedia.test.ts
PASS src/utils/__tests__/serverDraftLifecycleGuards.test.ts

Test Suites: 2 passed, 2 total
Tests: 26 passed, 26 total
```

Watchman emitted the existing recrawl warning. It did not block the test run.

### Command: `npx tsc --noEmit`

Result: PASS.

Output: no output.

### Command: targeted ESLint

Command:

```bash
cd mingla-business
npx eslint src/components/ui/EventCoverMedia.tsx src/components/ui/__tests__/eventCoverMedia.test.ts src/components/event/PublicEventPage.tsx
```

Result: PASS.

Output: no output.

## Source Verification

Verified in `mingla-business/src/components/ui/EventCoverMedia.tsx`:

- `isDisposedNativeVideoPlayerError(error)` matches only:
  - `NativeSharedObjectNotFoundException`
  - `Unable to find the native shared object`
- `callNativeVideoPlayer(action)` catches only that disposed-player condition.
- Unknown errors are rethrown with `if (!isDisposedNativeVideoPlayerError(error)) throw error;`.
- Native initial `nextPlayer.play()` is guarded.
- Native `readyToPlay` `player.play()` is guarded.
- Native `shouldPlay=false` `player.pause()` is guarded.
- Native AppState inactive/background `player.pause()` is guarded.
- Native cleanup still attempts `callNativeVideoPlayer(() => player.pause())` before listener removal.
- ORCH-0771's `const shouldPlay = autoplay && playbackActive` contract remains present.

Verified in `mingla-business/src/components/event/PublicEventPage.tsx` by source search:

- `usePathname` remains imported/used.
- `eventPublicPath` remains used for route identity.
- `publicHeroPlaybackActive` remains present.
- `handleClose` calls `setMediaPlaybackActive(false)` before `router.replace("/(tabs)/events" as never)`.
- Public hero bodies still receive `playbackActive={publicHeroPlaybackActive}`.

Verified in `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`:

- The ORCH-0771/0772 source guard checks for `isDisposedNativeVideoPlayerError`.
- The test checks for `callNativeVideoPlayer`.
- The test checks for `NativeSharedObjectNotFoundException`.
- The test still checks playback-active gating and close-before-replace ordering.

## Runtime Environment

- Simulator: booted iPhone 17 Pro, device `17091E60-C3B6-4167-980D-60C348E177F6`.
- App bundle: `com.sethogieva.minglabusiness`.
- App process after relaunch: `minglabusiness` PID `61819`.
- Metro/Expo process observed: `mingla-business/node_modules/.bin/expo start --clear`.
- Test window start timestamp: `2026-05-09T17:27:21Z`.

Screenshots captured:

- `/tmp/orch0772-after-launch.png`
- `/tmp/orch0772-after-bgfg.png`
- `/tmp/orch0772-events-tab.png`
- `/tmp/orch0772-account-tab.png`
- `/tmp/orch0772-home-return.png`

The app rendered the Mingla Business Home screen for `Leggo This`, with event cards visible. Logs during the run showed active CoreMedia video/audio activity, including `2-channel audiovisual content` and `FigAudioQueue` entries, so the runtime did exercise native media playback rather than a blank/no-media surface.

## Runtime Actions Performed

1. Terminated and relaunched `com.sethogieva.minglabusiness`.
2. Waited for the app to render Home.
3. Captured screenshot evidence after launch.
4. Launched Safari, then relaunched Mingla Business.
5. Repeated Safari -> Mingla Business foreground/background cycle.
6. Captured screenshot evidence after foreground/background cycles.
7. Attempted bottom-tab navigation via the Simulator window to exercise route change/unmount. Screenshots still showed Home, so I do not count this as proven navigation/unmount coverage.
8. Queried simulator logs from the test-window start timestamp.

## Runtime Log Evidence

Exact disposed-player signature query:

```bash
xcrun simctl spawn booted log show --style compact \
  --start '2026-05-09 17:27:21+0000' \
  --predicate 'process == "minglabusiness"' |
  rg -n "NativeSharedObjectNotFoundException|FunctionCallException|Calling the 'pause' function|Unable to find the native shared object|EventCoverNativeVideo" || true
```

Result: no matching app log lines. The only emitted line was the simulator/log utility warning:

```text
getpwuid_r did not find a match for uid 501
```

Media activity evidence query:

```bash
xcrun simctl spawn booted log show --style compact \
  --start '2026-05-09 17:27:21+0000' \
  --predicate 'process == "minglabusiness"' |
  rg -n "AudioQueue|2-channel audiovisual|FigAudioQueuePause|timeControlStatus|FigFilePlayer" | tail -n 80
```

Representative evidence:

```text
2-channel audiovisual content is NOT eligible for spatialization
FigAudioQueueTimingShimPause
FigFilePlayer ... new playback state: Paused
FigFilePlayer ... new playback state: Playing
```

I also saw unrelated Apple framework noise such as `VisionKit.ImageAnalyzer Code=-2 "Request Cancelled"` and `NSURLErrorDomain Code=-999`; those did not match the ORCH-0772 disposed-player exception and are not attributed to this hotfix.

## ORCH-0771 Preservation Check

Source preservation: PASS.

Runtime audio close proof: still not passed.

The hotfix did not remove ORCH-0771's pause/cleanup/AppState contract. However, this pass did not prove the original audible public-event close path because I could not complete a public event Close journey with a verified audible fixture.

Keep the distinction:

- ORCH-0772: native disposed-player red error. This pass is conditionally cleared by static gates plus available iOS log evidence.
- ORCH-0771: audible audio-after-close behavior. Still requires a public event page with a real audio-track video and a completed Close/background/share-sheet runtime check.

## Audio Fixture Availability

The current runtime did show native audio/video pipeline activity in system logs. I did not prove that the media was the public event hero, nor did I complete the public-page Close action. Therefore I am not upgrading ORCH-0771 from its prior `BLOCKED/UNVERIFIED` runtime-audio state.

## Scope Bleed Check

No evidence in this pass touched or tested:

- ORCH-0770 Cloudinary processing/webhook/transcode/compression.
- Giphy/Pexels/provider media.
- Brand/profile/ticket media.
- Supabase migrations/RLS/functions.
- Stripe.
- Admin or consumer app.

No product code was changed by tester.

## Verdict

CONDITIONAL PASS for ORCH-0772.

No P0/P1 blocker was found in static gates or in the available iOS runtime log evidence. The remaining condition is runtime coverage depth: tester/orchestrator should not close ORCH-0772 until a route-unmount or public-page Close path is exercised after reload/rebundle and still shows no disposed-player exception.

## Recommendation

Keep ORCH-0772 open as `CONDITIONAL PASS / ROUTE-UNMOUNT RUNTIME CONFIRMATION REMAINING`.

Next retest should use either:

1. An operator-assisted manual path that opens an event-cover video surface, navigates away or closes the public event page, then immediately captures logs; or
2. A reliable automation/deep-link path into and out of a public event page with video media.

If that route-unmount pass also shows no `NativeSharedObjectNotFoundException` / `FunctionCallException: Calling the 'pause' function has failed`, ORCH-0772 can go back to orchestrator for close consideration. ORCH-0771 still needs its separate audible-fixture runtime gate.

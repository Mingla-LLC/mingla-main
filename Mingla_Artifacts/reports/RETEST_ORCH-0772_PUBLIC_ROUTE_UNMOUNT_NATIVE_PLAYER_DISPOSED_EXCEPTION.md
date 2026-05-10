# Retest ORCH-0772 Public Route Unmount Native Player Disposed Exception

Date: 2026-05-09
Role: `$tester`
Mode: RETEST
Verdict: PASS

## Plain-English Outcome

ORCH-0772 passes independent retest.

The public event video page can be opened and routed away without the iOS native disposed-player `pause()` exception returning. Static review confirms cleanup no longer calls native `pause()` on teardown, while mounted pause/play behavior remains in place for active playback lifecycle control.

This is close-ready for `$orchestrator` review. This PASS is only for ORCH-0772; it does not close ORCH-0771 audible audio-after-close or ORCH-0770 video processing/transcode/browser-safe playback.

## Files / Evidence Reviewed

- `Mingla_Artifacts/reports/RUNTIME_QA_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_FAIL.md`
- `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`
- `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`
- `mingla-business/src/components/ui/EventCoverMedia.tsx`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/src/utils/eventCoverMediaRules.ts`

## Contract Verification

| Requirement | Result | Evidence |
| --- | --- | --- |
| Native route-unmount cleanup does not call `player.pause()` directly or through `callNativeVideoPlayer`. | PASS | `EventCoverNativeVideo` play-to-end/AppState cleanup now only calls `playToEndSub.remove()` and `appStateSub.remove()`. |
| Mounted native pause paths still exist. | PASS | `shouldPlay === false` still calls `callNativeVideoPlayer(() => player.pause())`; AppState `inactive` / `background` still pauses while mounted. |
| Active playback remains gated by `const shouldPlay = autoplay && playbackActive`. | PASS | Source still computes `shouldPlay` from autoplay plus active surface intent; ready-to-play, active AppState resume, and loop replay are gated by `shouldPlay`. |
| Unknown native player failures remain visible. | PASS | `callNativeVideoPlayer` only suppresses disposed native shared-object signatures and rethrows other errors. |
| Web path is not regressed by this rework. | PASS | Web video path remains separate in `EventCoverWebVideo`; no teardown cleanup change was made there. |
| Runtime public route-unmount produces zero disposed-player signatures. | PASS | Simulator smoke grep returned zero matching ORCH-0772 native-player signatures. |

## Automated Gates

From `mingla-business`:

```bash
npm run test:orch-0771 -- --runInBand
```

Result: PASS

- `eventCoverMedia.test.ts`: PASS
- `serverDraftLifecycleGuards.test.ts`: PASS
- 2 suites passed.
- 30 tests passed.
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
python3 scripts/docs/check_artifact_placement.py
```

Result: PASS

Artifact placement output:

- no tracked files under root `outputs/` or `clade transfer/`
- no tracked existing `dist` / `build` / `web-build` artifacts
- private prompt/tool roots remain ignored
- deprecated queues remain breadcrumbs
- Mingla skills avoid stale `outputs/*` current destinations
- Mingla roadmap system paths remain present

## Runtime Smoke

Environment:

- Booted simulator: `iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)`
- Installed app bundle: `com.sethogieva.minglabusiness`
- Active dev server: `node /Users/sethogieva/Desktop/mingla-main/mingla-business/node_modules/.bin/expo start --clear`

Start timestamp:

```text
2026-05-09 22:57:19+0000
```

Steps performed:

1. Terminated `com.sethogieva.minglabusiness`.
2. Relaunched `com.sethogieva.minglabusiness`.
3. Opened:

```bash
mingla-business://e/leggothis/a-life-in-vegas
```

4. Waited for public event page render.
5. Captured screenshot:

```text
/tmp/orch0772-tester-public-video-page.png
```

6. Routed away to:

```bash
mingla-business://(tabs)/events
```

7. Captured screenshot:

```text
/tmp/orch0772-tester-after-route-away.png
```

Screenshots confirmed:

- Public event page rendered for `A life in vegas`.
- Events tab rendered after route-away.

Failure-signature query:

```bash
xcrun simctl spawn booted log show --style compact \
  --start '2026-05-09 22:57:19+0000' \
  --predicate 'process == "minglabusiness"' |
  rg -n "NativeSharedObjectNotFoundException|FunctionCallException|Calling the 'pause' function|Unable to find the native shared object|EventCoverNativeVideo" || true
```

Result: PASS

- Zero matching ORCH-0772 disposed-player signatures.
- Command output included only simulator `getpwuid_r did not find a match for uid 501` noise, not a Mingla/native-player failure.

Additional media sanity query:

```bash
xcrun simctl spawn booted log show --style compact \
  --start '2026-05-09 22:57:19+0000' \
  --predicate 'process == "minglabusiness"' |
  rg -n "FigFilePlayer|CoreMedia|ExpoVideo|AVPlayer|playback state|audiovisual|EventCoverMedia|media render failed" || true
```

Result: PASS / sanity evidence

- Logs contained AVPlayer / CoreMedia / ExpoVideo activity and playback-state changes in the smoke window.
- This supports that the runtime pass exercised a native media surface, not just an inert route.

## Playback Regression Probe

- Public event page rendered with no red native player error.
- Native media activity appeared in simulator logs during the active page window.
- Route-away landed on Events.
- No disposed-player error appeared after route-away.
- No evidence appeared that old public-page media resumed after route-away.

Note: this was not an audible ORCH-0771 audio QA session. It verifies that ORCH-0772 did not regress the basic active playback surface while removing cleanup-time native pause.

## Findings

No P0/P1 blockers found.

P4 note: the public hero screenshot displays the fallback/pattern cover rather than an obvious visible video frame, because public page code still applies `isLegacyUnsafeEventCoverVideoUrl` for legacy `.mov` cover URLs. The simulator media logs nevertheless show native AVPlayer/ExpoVideo activity in the smoke window, and the ORCH-0772 failure signature stayed absent. This does not block ORCH-0772; browser-safe/legacy video processing remains ORCH-0770 scope.

## Close Readiness

ORCH-0772 is close-ready for `$orchestrator`.

Required close caveat: keep the close scoped to native player disposed-object route-unmount error only. Do not treat this as closure for:

- ORCH-0771: audible video audio after close / active-page auto-resume runtime QA.
- ORCH-0770: full phone-video processing, compression, and public browser-safe playback.

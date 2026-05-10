# Review Implementation Rework ORCH-0772 Public Route Unmount Native Player Disposed Exception

Date: 2026-05-09
Mode: ORCHESTRATOR REVIEW
Reviewed implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`

## Verdict

**PASS -> TESTER RETEST NEXT.**

Plain-English impact: the scary iOS native disposed-player red error has a credible fix now. The implementation removed the cleanup-time `player.pause()` call that reproduced the native shared-object exception, while keeping mounted pause/play behavior for active public event playback.

Do not close ORCH-0772 yet. The implementor smoke is accepted as strong evidence, but Mingla lifecycle still needs independent `$tester` retest before orchestrator close/commit.

## Evidence Accepted

- `EventCoverMedia` native play-to-end/AppState cleanup now only removes listeners:
  - `playToEndSub.remove()`
  - `appStateSub.remove()`
- Mounted pause behavior remains:
  - `shouldPlay === false` still calls guarded `player.pause()`.
  - AppState `inactive` / `background` still calls guarded `player.pause()`.
- Active playback behavior remains:
  - `shouldPlay = autoplay && playbackActive`.
  - ready-to-play and active AppState resume are still gated by `shouldPlay`.
  - loop replay remains gated by `loop && shouldPlay`.
- Unknown native player errors are still not blanket-swallowed; `callNativeVideoPlayer` rethrows anything that is not the disposed native shared-object signature.
- Web path was not reworked for this ORCH-0772 patch.
- Regression guard added in `eventCoverMedia.test.ts` proves cleanup does not contain `player.pause` or `callNativeVideoPlayer`, while mounted pause/AppState pause still exist.

## Verification Accepted

Implementation report records:

- `npm run test:orch-0771 -- --runInBand`: PASS, 2 suites / 29 tests.
- `npx tsc --noEmit`: PASS.
- targeted ESLint for `EventCoverMedia.tsx`, `eventCoverMedia.test.ts`, and `PublicEventPage.tsx`: PASS.
- `git diff --check`: PASS.
- artifact placement check: PASS.

Runtime smoke accepted:

- Opened `mingla-business://e/leggothis/a-life-in-vegas`.
- Confirmed public event page rendered.
- Routed away to `mingla-business://(tabs)/events`.
- Confirmed Events tab rendered.
- Log grep from `2026-05-09 19:40:24+0000` found zero matches for:
  - `NativeSharedObjectNotFoundException`
  - `FunctionCallException`
  - `Calling the 'pause' function`
  - `Unable to find the native shared object`
  - `EventCoverNativeVideo`

## Scope Review

Accepted scope:

- `mingla-business/src/components/ui/EventCoverMedia.tsx`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- implementation report

No Supabase, Stripe, checkout, admin, consumer app, Cloudinary/transcode, Giphy/Pexels, or ORCH-0773 draft lifecycle scope is required for ORCH-0772.

## Remaining Gate

Dispatch `$tester` with:

`Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`

Expected output:

`Mingla_Artifacts/reports/RETEST_ORCH-0772_PUBLIC_ROUTE_UNMOUNT_NATIVE_PLAYER_DISPOSED_EXCEPTION.md`

Close only if tester independently confirms:

- source/test contract still matches the implementation;
- automated gates pass or any deviations are justified;
- the same public route-unmount smoke returns zero disposed-player signatures;
- active-page autoplay/auto-resume and sound control are not regressed at a basic runtime level.

## Relationship To Other ORCHs

- ORCH-0772 is close to closure after tester retest.
- ORCH-0771 remains separate: audible audio-after-close still needs its own runtime QA.
- ORCH-0770 remains separate: phone-video processing/transcode/browser-safe playback remains open.
- ORCH-0773 remains separate: draft autosave stale lifecycle and route recovery are not affected by this media teardown patch.

# ORCH-0771 Implementation Report - Event Video Audio Close Lifecycle

## Status

Implemented and automated verification passed.

Runtime/manual QA is still deferred to tester because this turn did not launch the app and physically exercise the close/back navigation path.

## Scope Implemented

### Files changed

- `mingla-business/src/components/ui/EventCoverMedia.tsx`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- `mingla-business/package.json`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`

No Supabase, Stripe, admin, consumer app, checkout/order, provider media, Cloudinary processing, storage, or ORCH-0770 media-processing code was changed.

## Implementation Details

### EventCoverMedia playback lifecycle

`EventCoverMedia` now accepts `playbackActive?: boolean`, defaulting to `true`.

Native and web video playback now use a shared intent:

```ts
const shouldPlay = autoplay && playbackActive;
```

Playback is allowed only when `shouldPlay` is true.

Native video now:

- Plays during player setup only when `shouldPlay` is true.
- Plays on `readyToPlay` only when `shouldPlay` is true.
- Pauses when `autoplay` or `playbackActive` makes `shouldPlay` false.
- Replays looped media only when `loop && shouldPlay`.
- Pauses when app state becomes `inactive` or `background`.
- Resumes on app state `active` only when `shouldPlay` is true.
- Pauses during cleanup before removing listeners.

Web video now:

- Uses a real `videoRef`.
- Sets `autoPlay` from `shouldPlay`.
- Calls `play()` only when `shouldPlay` is true.
- Calls `pause()` when `shouldPlay` is false.
- Loops/replays only when `loop && shouldPlay`.

### Public event page close behavior

`PublicEventPage` now tracks whether the public hero media is still allowed to play:

- `mediaPlaybackActive` starts as `true`.
- `handleClose()` sets `mediaPlaybackActive(false)` before `router.replace("/(tabs)/events")`.
- `usePathname()` plus `eventPublicPath(...)` confirms the current route is still the public event route.
- The hero receives `playbackActive={mediaPlaybackActive && isCurrentPublicEventPath}`.

This stops video/audio as soon as the public event page is intentionally closed, while also stopping playback if the route changes away from the event page by another path.

### Autoplay and auto-resume preserved

Public event autoplay remains intact:

- `EventCoverMedia` still defaults `autoplay` to `true`.
- `playbackActive` defaults to `true`.
- The public hero passes `playbackActive=true` while the route is still the current public event path and the page has not been closed.
- Native app-state auto-resume still plays on `active` when `autoplay && playbackActive`.
- Looping still works while the public event page is active.
- The existing public page sound-control behavior is preserved: controlled `coverVideoMuted`, `onMutedChange`, and `showAudioControl={safeCoverMediaType === "video"}` are still in place.

## Tests Added

Updated `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` with a source-level regression test proving:

- `EventCoverMedia` exposes `playbackActive`.
- Native and web video compute `shouldPlay` from `autoplay && playbackActive`.
- Native ready/play/replay/resume paths are gated by `shouldPlay`.
- Native inactive/background and cleanup paths pause video.
- Web autoplay/play/replay paths are gated by `shouldPlay`.
- Public event close sets media playback inactive before route replacement.
- Public event hero passes the playback-active intent to `EventCoverMedia`.
- Existing public video sound controls remain wired.

Added package script:

```json
"test:orch-0771": "npx jest eventCoverMedia.test serverDraftLifecycleGuards.test"
```

## Verification

### `npm run test:orch-0771`

Result: PASS

- 2 test suites passed.
- 26 tests passed.
- Watchman emitted a recrawl warning, but Jest completed successfully.

### `npm run test:orch-0758a -- --runInBand`

Result: PASS

- 6 test suites passed.
- 59 tests passed.
- Watchman emitted a recrawl warning, but Jest completed successfully.

### `npx tsc --noEmit`

Result: PASS

- No TypeScript errors emitted.

### `npx eslint src/components/ui/EventCoverMedia.tsx src/components/ui/__tests__/eventCoverMedia.test.ts src/components/event/PublicEventPage.tsx`

Result: PASS

- No lint errors emitted.
- `serverDraftLifecycleGuards.test.ts` was not included because this implementation did not modify that file.

### `git diff --check`

Result: PASS

- No whitespace errors emitted.

## Deferred Runtime QA

Tester should still manually verify:

- Open public event page with video.
- Confirm autoplay still starts while visible.
- Confirm sound can be enabled and remains controlled while visible.
- Close the event page and confirm audio stops immediately.
- Navigate away using a non-close route path and confirm audio stops.
- Background and foreground the app while still on the public page and confirm valid auto-resume still works.

## Notes

The worktree already contained unrelated changes from other ORCH tracks before this implementation. Those changes were not reverted or intentionally altered.

# TEST REPORT ORCH-0771 - Event Video Audio Close Lifecycle

> Date: 2026-05-09  
> Tester mode: TARGETED + SPEC-COMPLIANCE  
> Prompt: `Mingla_Artifacts/prompts/TESTER_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`  
> Verdict: **CONDITIONAL PASS**

## Verdict

**CONDITIONAL PASS.**

No P0/P1 implementation blocker found in code, static checks, or automated gates. The implementation matches the approved ORCH-0771 active-playback contract at source level.

This is **not close-ready** because the user-observed runtime symptom is audio behavior after closing the public event page, and this tester pass did not exercise a native iOS/dev-client or browser runtime with an audible public event video.

## Findings

### P2-1 Runtime audio-after-close proof is still unverified

The core user pain is audible runtime behavior: after closing the event page, video sound may keep playing. Static/code proof is strong, but it does not replace device/browser verification.

Required before orchestrator close:

- Native iOS public event with video still autoplays while visible.
- Native sound/mute control still works.
- Native Close stops audio immediately and it does not resume.
- Native share-sheet dismiss may resume only while still on the same event page.
- Native background/foreground resumes only while still on the same event page.
- Native background/foreground after close does not resume old audio.
- Web unmuted public event video stops after navigate away/close.
- Adjacent surfaces do not become newly audible or visually regressed.

Severity rationale: not a code failure, but the original defect is runtime-observable and cannot be closed from source-level gates alone.

### P4-1 Automated guard is source-level, not a mounted player behavior test

`eventCoverMedia.test.ts` now checks the required lifecycle contract through source-level assertions. This is acceptable for this narrowly scoped Expo video/player behavior because the approved spec explicitly allowed source-level Jest guards and optional strict-grep. It is still weaker than a mounted player mock test that would assert `play()`/`pause()` calls directly.

No rework required for this pass, but future media-player lifecycle fixes should prefer direct component/mocked-player behavior tests when practical.

## Static / Code Verification

### `EventCoverMedia`

Verified in `mingla-business/src/components/ui/EventCoverMedia.tsx`:

- `EventCoverMediaProps` includes `playbackActive?: boolean`.
- `EventCoverMedia` defaults `playbackActive = true`.
- Native and web renderers receive `playbackActive`.
- Both native and web compute `const shouldPlay = autoplay && playbackActive`.
- Native setup calls `nextPlayer.play()` only under `shouldPlay`.
- Native `readyToPlay` calls `player.play()` only under `shouldPlay`.
- Native play/pause effect calls `player.pause()` when `shouldPlay` is false.
- Native `playToEnd` returns unless `loop && shouldPlay`.
- Native AppState `active` resumes only under `shouldPlay`.
- Native AppState `inactive` / `background` calls `player.pause()`.
- Native cleanup calls `player.pause()` before listener removal.
- Web video uses `videoRef`, `autoPlay: shouldPlay`, guarded `onCanPlay`, guarded `onEnded`, and pauses when `shouldPlay` is false.
- Reduced-motion `video_still` path still passes `autoplay={false}` and `loop={false}` while retaining the shared pause contract.

### `PublicEventPage`

Verified in `mingla-business/src/components/event/PublicEventPage.tsx`:

- `usePathname` and `eventPublicPath` are used to derive current public-event route identity.
- `mediaPlaybackActive` defaults to `true`.
- `publicHeroPlaybackActive` is `mediaPlaybackActive && isCurrentPublicEventPath`.
- `handleClose` calls `setMediaPlaybackActive(false)` before `router.replace("/(tabs)/events")`.
- Published/past public hero paths receive `playbackActive={publicHeroPlaybackActive}` through `PublishedBody`.
- Public hero still passes `muted={coverVideoMuted}`, `onMutedChange={setCoverVideoMuted}`, and `showAudioControl={safeCoverMediaType === "video"}`.
- Native default remains audible for public video because `coverVideoMuted` starts false on non-web platforms.
- Web remains muted initially through `Platform.OS === "web"`, preserving browser autoplay policy.

### Adjacent Surface Static Sweep

Inspected current `EventCoverMedia` call sites in:

- `mingla-business/app/(tabs)/home.tsx`
- `mingla-business/src/components/event/EventListCard.tsx`
- `mingla-business/src/components/brand/PublicBrandPage.tsx`
- `mingla-business/app/checkout/[eventId]/index.tsx`
- `mingla-business/app/o/[orderId].tsx`
- `mingla-business/src/components/event/PreviewEventView.tsx`
- `mingla-business/src/components/event/CreatorStep7Preview.tsx`
- `mingla-business/app/event/[id]/index.tsx`
- `mingla-business/src/components/event/CreatorStep4Cover.tsx`

These call sites do not need broad `playbackActive` wiring for ORCH-0771 because `EventCoverMedia` defaults `playbackActive=true`, and non-public public-event callers continue inheriting the default muted behavior unless they explicitly wire sound controls.

## Scope-Bleed Check

No ORCH-0771 tester evidence shows changes to:

- Supabase migrations/RLS/functions.
- Cloudinary webhook/transcode/compression/storage.
- Stripe.
- Admin or consumer app.
- Checkout/order business logic.
- Giphy/Pexels/provider media.

The broader worktree is dirty with unrelated ORCH tracks, including ORCH-0770 media-processing files, but those are separate and were not judged as ORCH-0771 behavior.

## Automated Verification

### `npm run test:orch-0771`

Command:

```bash
cd mingla-business
npm run test:orch-0771
```

Result: **PASS**

Output summary:

```text
PASS src/components/ui/__tests__/eventCoverMedia.test.ts
PASS src/utils/__tests__/serverDraftLifecycleGuards.test.ts

Test Suites: 2 passed, 2 total
Tests:       26 passed, 26 total
Snapshots:   0 total
Time:        1.555 s, estimated 7 s
Ran all test suites matching /eventCoverMedia.test|serverDraftLifecycleGuards.test/i.
```

Watchman emitted an existing recrawl warning before the Jest result. It did not block the test run.

### `npm run test:orch-0758a -- --runInBand`

Command:

```bash
cd mingla-business
npm run test:orch-0758a -- --runInBand
```

Result: **PASS**

Output summary:

```text
PASS src/utils/__tests__/serverDraftLifecycleGuards.test.ts
PASS src/components/ui/__tests__/eventCoverMedia.test.ts
PASS src/services/__tests__/eventCoverMediaService.test.ts
PASS src/utils/__tests__/serverDraftEventMapper.test.ts
PASS src/utils/__tests__/draftEventPristine.test.ts
PASS src/utils/__tests__/publishedEventEditGuards.test.ts

Test Suites: 6 passed, 6 total
Tests:       59 passed, 59 total
Snapshots:   0 total
Time:        0.905 s, estimated 3 s
Ran all test suites matching /serverDraftEventMapper.test|serverDraftLifecycleGuards.test|eventCoverMediaService.test|eventCoverMedia.test|publishedEventEditGuards.test|draftEventPristine.test/i.
```

Watchman emitted an existing recrawl warning before the Jest result. It did not block the test run.

### `npx tsc --noEmit`

Command:

```bash
cd mingla-business
npx tsc --noEmit
```

Result: **PASS**

Output: no output.

### Targeted ESLint

Command:

```bash
cd mingla-business
npx eslint src/components/ui/EventCoverMedia.tsx src/components/ui/__tests__/eventCoverMedia.test.ts src/components/event/PublicEventPage.tsx
```

Result: **PASS**

Output: no output.

`src/utils/__tests__/serverDraftLifecycleGuards.test.ts` was not included in the targeted lint because ORCH-0771 did not modify that file. It was still included in both required Jest gates.

### `git diff --check`

Command:

```bash
git diff --check
```

Result: **PASS**

Output: no output.

## Runtime QA

Runtime QA was **not executed** in this tester pass. No native iOS dev-client, physical device, simulator audio test, or browser public-event video session was launched from this run.

Therefore:

- Native close-to-silence: **UNVERIFIED**
- Native no-resume-after-close: **UNVERIFIED**
- Native active-page autoplay: **UNVERIFIED**
- Native sound/mute control: **UNVERIFIED**
- Native share-sheet resume while still visible: **UNVERIFIED**
- Native AppState foreground resume while still visible: **UNVERIFIED**
- Web unmuted navigate-away silence: **UNVERIFIED**
- Visual/no-audio adjacent regression sweep: **STATIC ONLY**

## Recommendation

Return **CONDITIONAL PASS** to orchestrator. Do not close ORCH-0771 yet.

Next required step: operator/tester runtime verification using a public event with an audible video cover. If all runtime gates pass, ORCH-0771 can move to orchestrator close. If audio persists after close, old audio resumes after close on AppState active, or active-page autoplay/sound controls break, send back to `$implementor` as rework.

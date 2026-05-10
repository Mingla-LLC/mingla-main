# Review Implementation ORCH-0771 - Event Video Audio Close Lifecycle

> Date: 2026-05-09  
> Mode: Orchestrator REVIEW  
> Reviewed input: `reports/IMPLEMENTATION_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`  
> Next lifecycle gate: `$tester` with `prompts/TESTER_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`

## Plain-English Verdict

The implementation is ready for independent tester verification.

It appears to solve the exact trust problem: a public event cover video may still autoplay, loop, expose sound control, and resume after valid interruptions while the public event page is visible, but inactive/closed media now has an explicit pause/silence contract.

Do not close ORCH-0771 yet. Runtime proof is still missing for the user-observed symptom: close the event page and confirm the audio stops immediately and never resumes.

## Evidence Reviewed

- Spec: `specs/SPEC_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`
- Spec review: `reports/REVIEW_SPEC_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`
- Implementation report: `reports/IMPLEMENTATION_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`
- Code surfaces inspected:
  - `mingla-business/src/components/ui/EventCoverMedia.tsx`
  - `mingla-business/src/components/event/PublicEventPage.tsx`
  - `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
  - `mingla-business/package.json`

## Contract Check

| Requirement | Review result | Evidence |
|---|---:|---|
| Add default-true active playback prop | PASS | `EventCoverMediaProps` includes `playbackActive?: boolean`; component default is `playbackActive = true`. |
| Gate native play paths on `autoplay && playbackActive` | PASS | Native renderer computes `shouldPlay = autoplay && playbackActive`; setup, ready, play-to-end, and AppState active play paths use `shouldPlay`. |
| Pause native player on inactive intent/background/cleanup | PASS | Native autoplay effect pauses when `shouldPlay` is false; AppState inactive/background pauses; cleanup pauses before listener removal. |
| Gate web video on same contract | PASS | Web renderer uses `videoRef`, `autoPlay: shouldPlay`, guarded `onCanPlay`, guarded `onEnded`, and pauses when `shouldPlay` is false. |
| Public close disables playback before navigation | PASS | `handleClose` calls `setMediaPlaybackActive(false)` before `router.replace("/(tabs)/events")`. |
| Public route drives active playback intent | PASS | `usePathname` plus `eventPublicPath` derive `isCurrentPublicEventPath`; public hero receives `mediaPlaybackActive && isCurrentPublicEventPath`. |
| Preserve autoplay/sound controls while visible | PASS | Defaults stay `autoplay=true`, `loop=true`; public hero still passes controlled `muted={coverVideoMuted}`, `onMutedChange`, and `showAudioControl={safeCoverMediaType === "video"}`. |
| Avoid ORCH-0770 scope bleed | PASS | No reviewed evidence of Supabase, Cloudinary, transcode/compression/storage, Stripe, admin, consumer, checkout/order, or provider-media edits for ORCH-0771. |

## Automated Verification Reported By Implementor

- `cd mingla-business && npm run test:orch-0771` - PASS, 2 suites / 26 tests.
- `cd mingla-business && npm run test:orch-0758a -- --runInBand` - PASS, 6 suites / 59 tests.
- `cd mingla-business && npx tsc --noEmit` - PASS.
- `cd mingla-business && npx eslint src/components/ui/EventCoverMedia.tsx src/components/ui/__tests__/eventCoverMedia.test.ts src/components/event/PublicEventPage.tsx` - PASS.
- `git diff --check` - PASS.

Note: the implementation report correctly explains that `serverDraftLifecycleGuards.test.ts` was omitted from the targeted ESLint command because it was not modified.

## Residual Risk

Runtime behavior still needs a tester pass. The code-level lifecycle is aligned, but the original complaint was observable in-app audio after close, so close readiness requires device/browser verification.

The highest-risk runtime edge is navigation retention: if Expo Router keeps the public event route mounted briefly, the state/route gate must still cause the existing player to pause before the user hears residual audio.

## Decision

Approve progression to testing.

Next prompt written:

`Mingla_Artifacts/prompts/TESTER_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`

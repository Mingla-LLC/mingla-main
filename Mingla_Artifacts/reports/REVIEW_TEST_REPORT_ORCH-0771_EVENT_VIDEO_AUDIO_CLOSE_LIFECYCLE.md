# Review Test Report ORCH-0771 - Event Video Audio Close Lifecycle

> Date: 2026-05-09  
> Mode: Orchestrator REVIEW  
> Reviewed input: `reports/TEST_REPORT_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`  
> Decision: Accept tester **CONDITIONAL PASS**; do not close.

## Plain-English Verdict

ORCH-0771 is code-cleared but not runtime-cleared.

The implemented playback lifecycle now has independent tester evidence for the source contract and automated regression gates. That is enough to stop reworking code blindly. It is not enough to close, because the original user pain was audible video after leaving the public event page.

## Evidence Accepted

Tester independently verified:

- `EventCoverMedia` exposes default-true `playbackActive`.
- Native and web video playback computes `shouldPlay = autoplay && playbackActive`.
- Native setup, ready, replay, and AppState-active play paths are gated by `shouldPlay`.
- Native `shouldPlay=false`, AppState inactive/background, and cleanup paths pause the player.
- Web video pauses when `shouldPlay` is false.
- `PublicEventPage` disables playback before route replacement on close.
- Public-page video sound controls remain wired and native public page video is not forcibly muted.
- No ORCH-0770 processing/transcode/compression/storage scope bleed was found for ORCH-0771.

Tester reran and passed:

- `npm run test:orch-0771`
- `npm run test:orch-0758a -- --runInBand`
- `npx tsc --noEmit`
- targeted ESLint for ORCH-0771 files
- `git diff --check`

## Remaining Close Blocker

Runtime proof is missing:

- Native iOS/dev-client public event video autoplays while visible.
- Sound/mute control works.
- Close stops audio immediately and it does not resume.
- Share-sheet dismissal resumes only while still on the same page.
- App background/foreground resumes only while still on the same page.
- Background/foreground after close does not resume old audio.
- Web unmuted public event video stops after navigate away/close.
- Adjacent cover-media surfaces do not become newly audible or visually regressed.

## Lifecycle Decision

Keep ORCH-0771 **OPEN - CONDITIONAL STATIC PASS / RUNTIME VERIFY NEXT**.

Next handoff:

`Mingla_Artifacts/prompts/TESTER_RUNTIME_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`

If runtime gates pass, return to orchestrator for close. If any audio persists after close, send to implementor rework with exact reproduction steps.

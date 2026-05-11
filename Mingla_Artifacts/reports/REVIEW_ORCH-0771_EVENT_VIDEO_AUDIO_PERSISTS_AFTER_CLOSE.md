# REVIEW ORCH-0771 - Event Video Audio Persists After Page Close

> Date: 2026-05-09  
> Mode: Orchestrator review of returned forensics  
> Input: `reports/INVESTIGATION_ORCH-0771_EVENT_VIDEO_AUDIO_PERSISTS_AFTER_CLOSE.md`  
> Decision: **APPROVED FOR NARROW SPEC**

## Plain-English Impact

The problem is not that Mingla videos autoplay. The problem is that a video the user has left can keep making sound.

Public event video should still feel alive: autoplay on the public event page is wanted, looping is wanted, and auto-resume is wanted when the same public event page is still visible after a valid interruption such as foregrounding the app or closing a share sheet. The fix must only stop playback when the public event video is no longer the active visible surface.

## Review Findings

### Accepted Evidence

The forensics report proves a credible static root-cause class:

- `EventCoverMedia` starts/restarts native video through several `player.play()` paths.
- `PublicEventPage` intentionally renders the public hero unmuted with `muted={false}` and sound controls.
- AppState `active` replay is not gated by screen/page visibility.
- There is no explicit pause/stop contract on close, route blur, AppState inactive/background, cleanup start, or `autoplay=false`.
- Existing tests pass while not asserting the close/silence lifecycle.

The report also correctly separates ORCH-0771 from ORCH-0770. ORCH-0770 remains the larger public-video asset processing/transcode/compression track. ORCH-0771 is a smaller playback lifecycle trust bug.

### Operator Constraint Added

The operator clarified on 2026-05-09:

> Solve only the audio-after-close problem without causing regressions. Public-page autoplay and auto-resume are still desired.

That means the next spec must not solve this by:

- disabling public event autoplay;
- forcing the public hero to stay muted on native;
- removing loop/replay while the page is visible;
- removing AppState/share-sheet resume for the currently visible public page;
- broadening into ORCH-0770 upload/transcode/compression work;
- changing unrelated event-card, Home, checkout, order, brand, Stripe, or Supabase behavior.

## Lifecycle Decision

Proceed to a **separate ORCH-0771 spec** instead of merging into ORCH-0770.

Reason: the operator wants a bounded regression-safe fix for the exact symptom. ORCH-0770 is broad and already owns phone-video processing, trim, transcode, compression, and browser-safe public derivatives. Combining the two risks making a simple lifecycle leak wait behind a larger media pipeline.

## Required Spec Shape

The spec should define a minimal active-media contract:

- public event hero may autoplay and loop when its page is focused/visible;
- public event hero may auto-resume after foreground/share-sheet return only if still focused/visible and not explicitly stopped by close/navigation;
- close/back/navigation away must silence the video immediately before or during route transition;
- AppState inactive/background must pause, not wait for eventual unmount;
- AppState active must only replay if the same media surface remains active;
- cleanup should pause before listener removal/release;
- web should receive equivalent pause-on-inactive behavior without changing browser autoplay policy.

## Verdict

**APPROVED FOR SPEC.**

Next prompt: `prompts/SPEC_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`

Expected output: `specs/SPEC_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`


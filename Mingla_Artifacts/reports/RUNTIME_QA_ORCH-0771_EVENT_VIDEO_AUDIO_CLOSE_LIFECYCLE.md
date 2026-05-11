# RUNTIME QA ORCH-0771 Event Video Audio Close Lifecycle

Date: 2026-05-09
Verdict: BLOCKED/UNVERIFIED

## Scope

Runtime QA for the ORCH-0771 fix: closing the public event page must stop cover-video audio immediately and must not allow stale audio to resume after the page is closed. The requested preserved behavior is autoplay and auto-resume while the public event page remains open.

## Blocking Reason

I could not find or create an audible public event video fixture in the current runtime environment. The simulator has a running Mingla Business app and a video-capable event/draft fixture, but the available video asset appears to contain no audio track, so it cannot prove the reported bug is fixed.

This report is therefore not a pass. ORCH-0771 should remain open until an audio-capable public event video can be exercised on-device.

## Runtime Environment Observed

- Simulator: booted iPhone 17 Pro, device `17091E60-C3B6-4167-980D-60C348E177F6`.
- App process: `minglabusiness` running under bundle id `com.sethogieva.minglabusiness`.
- Screenshot captured: `/tmp/orch0771-sim.png`.
- Visible app state: Mingla Business Home screen for brand `Leggo This`, with event cards rendered and no obvious home-screen visual crash.

## Fixture Evidence

AsyncStorage inspection found:

- `mingla-business.liveEvent.v1`: `events: []`.
- Current brand id: `22a18413-bfbf-4087-9ba7-45f70deba0f3`.
- One draft event:
  - id: `98e880f3-43ef-47ab-a530-deaa117b21a7`
  - name: `Runtime Share Test FreetA throwaway free-ticket QA event for testing public links and share buttons.`
  - status: `draft`
  - visibility: `public`
  - cover media type: `video`
  - cover media URL: `https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event_covers/22a18413-bfbf-4087-9ba7-45f70deba0f3/98e880f3-43ef-47ab-a530-deaa117b21a7/moy413ux-dbgw0n0w.mp4`

The draft video URL responded successfully:

- HTTP status: `200`
- content-type: `video/mp4`
- content-length: `8367682`

However, the video did not appear audio-capable:

- Simulator media logs for `minglabusiness` included `hasAudio: NO`, `doesCurrentAssetHaveAudio: NO`, and `can't apply volume, no audio render pipeline`.
- Downloaded asset string inspection found video codec marker `avc1` but no `mp4a`, `soun`, `SoundHandler`, `aac`, or equivalent audio markers.
- Local `ImagePicker` cached `.mp4` files also showed no audio markers.

## Native Runtime Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Public event video autoplays visibly | BLOCKED/UNVERIFIED | App rendered video-capable event/draft media, but no confirmed public event page with audible video was available. |
| Audio can be enabled/disabled from the public page sound control | BLOCKED/UNVERIFIED | Available video had no audio render pipeline, so sound control behavior could not prove audible state. |
| Close stops video audio immediately | BLOCKED/UNVERIFIED | No audible video fixture existed, so the reported audio-after-close defect could not be reproduced or disproven. |
| Audio does not resume 10 seconds after close | BLOCKED/UNVERIFIED | Blocked by lack of audible fixture. |
| Share sheet close/resume preserves playback only while still on public page | BLOCKED/UNVERIFIED | Blocked by lack of audible public page fixture. |
| Background/foreground resumes only while public page remains open | BLOCKED/UNVERIFIED | Blocked by lack of audible public page fixture. |
| After close, background/foreground does not resurrect old audio | BLOCKED/UNVERIFIED | Blocked by lack of audible fixture. |

## Web Runtime Gate

Not executed as a release-quality gate. The core blocker is fixture availability: no browser-safe, audio-capable public event video fixture was available to exercise the close lifecycle. Browser autoplay policy would also need to be recorded explicitly if audible playback is blocked.

## Adjacent Smoke

- Home screen rendered in the running Mingla Business simulator app.
- No product code was changed during this tester pass.
- No static test rerun was performed in this runtime-only pass; prior static tester report already recorded passing targeted Jest, TypeScript, ESLint, and whitespace checks.

## Recommendation

Do not close ORCH-0771 from runtime QA yet.

To complete the gate, provide or create a public event page with a video cover that has a real audio track. Then rerun the native close lifecycle checks:

1. Open the public event page with audible video.
2. Enable sound and confirm audio is playing.
3. Tap Close.
4. Confirm audio stops immediately.
5. Wait at least 10 seconds and confirm audio does not resume.
6. Repeat with share sheet open/close and app background/foreground while still on-page.
7. Repeat close, then background/foreground, and confirm old audio never resumes.

If ORCH-0770 is still blocking creation of a proper public video fixture, keep ORCH-0771 marked runtime-gated by fixture availability rather than release-ready.

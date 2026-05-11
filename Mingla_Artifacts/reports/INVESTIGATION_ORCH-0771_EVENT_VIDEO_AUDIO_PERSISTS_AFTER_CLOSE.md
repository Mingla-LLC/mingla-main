# INVESTIGATION ORCH-0771 - Event Video Audio Persists After Page Close

> Date: 2026-05-09  
> Mode: Forensics / Static lifecycle trace + targeted test check  
> Surface: `mingla-business` event-cover video playback lifecycle  
> Verdict: **FAIL - static root cause class proven; runtime reproduction still needs device confirmation**

## Plain-English Summary

The report is credible: Mingla has no explicit "closing/leaving this event page must stop the video player" contract.

The public event hero is intentionally audible on native because `PublicEventPage` passes `muted={false}` into `EventCoverMedia`. The native video component then calls `player.play()` in four separate lifecycle paths and also replays on `AppState` returning to `active`. But the same component never explicitly pauses when the app goes inactive, when the route loses focus, when `autoplay` becomes false, or when the close button is tapped.

`expo-video`'s `useVideoPlayer` promises cleanup on component unmount, so if Expo Router always fully unmounts the public event route before navigation completes, the player should eventually release. The gap is that Mingla relies entirely on eventual unmount/release while also using a root `<Stack>` that does not define a route-focus media policy. If a route remains mounted or a close/share/AppState transition races before release, audio can keep playing.

## Investigation Manifest

| Layer | Files / artifacts read | Why |
|---|---|---|
| History | `ROOT_CAUSE_REGISTER.md`, ORCH-0770 investigation/spec/review, ORCH-0758A retest, ORCH-0766D/E reports | Establish whether this is already owned by the video asset contract |
| Code - shared media | `mingla-business/src/components/ui/EventCoverMedia.tsx` | Player creation, autoplay, AppState, mute, cleanup |
| Code - public event | `mingla-business/src/components/event/PublicEventPage.tsx`, `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` | Audible hero and close navigation path |
| Code - blast radius | Home, Event Detail, Event List Card, Preview, Step 4, Step 7, Public Brand event cards, checkout/order mini-cards | Find every `EventCoverMedia` consumer and default props |
| Runtime library | `mingla-business/node_modules/expo-video/src/VideoPlayer.tsx`, `VideoPlayer.types.ts` | Confirm hook cleanup and available `pause()` API |
| App navigation | `mingla-business/app/_layout.tsx` | Determine route stack policy |
| Tests | `eventCoverMedia.test.ts`, `serverDraftLifecycleGuards.test.ts`, `npm run test:orch-0758a -- --runInBand` | Prove current tests miss close/silence behavior |

## Historical Context

ORCH-0770 is adjacent but not the same root cause.

- `ROOT_CAUSE_REGISTER.md:8-21` says RC-0770 is raw QuickTime/HEVC public media. Its symptoms include black browser hero, playback failure/recovery issues, and overlapping sound controls.
- `SPEC_ORCH-0770_BROWSER_SAFE_EVENT_COVER_VIDEO_PIPELINE.md:53-58` requires public visitors to get reliable video playback, reachable mute, and loop/resume after share/app visibility return.
- `REVIEW_SPEC_ORCH-0770_BROWSER_SAFE_VIDEO_PIPELINE_FULL_FIX_AMENDMENT.md:24-29` keeps public page chrome and reliable browser/app playback in scope, while superseding rejection-only video handling.

Conclusion: ORCH-0770 owns processed browser-safe video assets and public chrome. ORCH-0771 adds a separate player lifecycle contract: **when a video surface is no longer active/visible, it must stop producing audio immediately.**

## Current Happy Path

Public event route:

`/e/[brandSlug]/[eventSlug] -> usePublicEventBySlug -> PublicEventPage -> PublishedBody -> EventCoverMedia -> EventCoverNativeVideo -> useVideoPlayer -> VideoView`

Expected negative behavior:

- tapping close/back or navigating away silences cover media immediately;
- opening share/app backgrounding should not let an inactive or closed page continue audible playback;
- returning to active state should only resume playback for the currently visible active media surface.

Current code does not enforce those negative behaviors.

## Findings

### F1 - Confirmed Bug: Native Event-Cover Video Has Play Triggers But No Explicit Stop-On-Leave Contract

**Classification:** confirmed bug / production-hardening gap  
**Severity:** S1 candidate if reproducible, because it creates audible playback after dismissal.

Six-field proof:

- **File/line:** `mingla-business/src/components/ui/EventCoverMedia.tsx:96-139`
- **Exact code:** native setup sets `staysActiveInBackground = false`, `showNowPlayingNotification = false`, and calls `nextPlayer.play()` when `autoplay` is true. Later effects call `player.play()` on `readyToPlay`, on every truthy `autoplay` effect, on loop `playToEnd`, and on `AppState` `active`.
- **Current behavior:** The component has four play paths and two listener cleanup paths, but no explicit `player.pause()` on inactive/background, route blur, close, or `autoplay=false`. Cleanup only removes listeners.
- **Expected behavior:** An audible media component must pause or mute before/during route deactivation, when the app goes inactive/background, and when the screen is no longer focused or the component is about to be removed.
- **Causal chain:** public event hero starts unmuted -> player starts and restarts from multiple effects -> user closes/navigates/share-sheets/backgrounds -> no explicit pause runs -> if component remains mounted or unmount/release races, native audio can continue after the page appears closed.
- **Verification step:** Add lifecycle instrumentation around `play`, `pause`, route focus/blur, AppState, and unmount; reproduce public event video -> close -> confirm current code logs no pause before navigation and that the fix logs pause before audio stops.

Important nuance: `expo-video`'s `useVideoPlayer` does auto-clean on unmount (`node_modules/expo-video/src/VideoPlayer.tsx:36-51`). That does not close the bug class because Mingla does not prove close/blur immediately unmounts the route, and it does not call `pause()` before waiting for release.

### F2 - Confirmed Bug: Public Event Hero Is The Only Proven Audible Autoplay Surface

**Classification:** confirmed bug / blast-radius finding

`PublicEventPage.tsx:408-419` renders:

- `mediaUrl={event.coverMediaUrl}`
- `mediaType={event.coverMediaType}`
- `height={380}`
- `muted={false}`
- `showAudioControl`
- `audioControlPosition="topLeft"`

Because `EventCoverMedia` defaults `autoplay=true` and `loop=true` (`EventCoverMedia.tsx:175-177`), this public hero creates an audible native autoplay video when `coverMediaType === "video"` and reduced motion is false.

Most other consumers omit `muted`, so they inherit `muted=true` and play silently:

| Surface | Evidence | Props | Audio risk |
|---|---|---|---|
| Public event hero | `PublicEventPage.tsx:408-419` | `muted={false}`, `showAudioControl` | High |
| Draft public preview hero | `PreviewEventView.tsx:196-203` | default muted/autoplay/loop | Silent playback risk |
| Creator Step 4 preview | `CreatorStep4Cover.tsx:296-304` | default muted/autoplay/loop | Silent playback risk |
| Creator Step 7 mini card | `CreatorStep7Preview.tsx:115-122` | default muted/autoplay/loop | Silent playback risk |
| Public brand event cards | `PublicBrandPage.tsx:677-684` | default muted/autoplay/loop | Silent playback risk |
| Home event rows | `home.tsx:475-483`, `521-529` | default muted/autoplay/loop | Silent playback risk |
| Event detail hero | `app/event/[id]/index.tsx:589-596` | default muted/autoplay/loop | Silent playback risk |
| Checkout/order mini-cards | `checkout/[eventId]/index.tsx:240-247`, `app/o/[orderId].tsx:321-328` | default muted/autoplay/loop | Silent playback risk |

The operator's audible symptom points most strongly at the public event hero because it is the only statically proven unmuted event-cover video surface.

### F3 - Confirmed Bug: AppState Resume Is Unscoped To Screen Visibility

**Classification:** confirmed bug / lifecycle ownership gap

Six-field proof:

- **File/line:** `mingla-business/src/components/ui/EventCoverMedia.tsx:126-139`
- **Exact code:** `AppState.addEventListener("change", (state) => { if (state === "active" && autoplay) player.play(); });`
- **Current behavior:** Any mounted `EventCoverMedia` video resumes when app state becomes active, regardless of whether its route is currently visible or whether the user had just closed/navigated away.
- **Expected behavior:** AppState resume must be gated by screen focus/visibility and by the component's effective active playback intent.
- **Causal chain:** user opens a share sheet or backgrounds the app while an unmuted event video is playing -> AppState returns `active` -> any mounted media player calls `play()` -> if route close/replace did not unmount or if a hidden stack screen is still mounted, the old page resumes audio.
- **Verification step:** Instrument a public event video, open/close share sheet or background/foreground, then close/navigate. Current code should show `player.play()` on active with no focus guard; fix should suppress replay when route/surface is inactive.

This directly matches ORCH-0770's historical symptom line that video playback can fail or not resume after share-sheet/app visibility changes, but here the failure mode is the opposite: it can resume when it should not.

### F4 - Confirmed Test Gap: Existing Media Tests Encode Playback Props, Not Playback Lifecycle

**Classification:** production-hardening gap

`eventCoverMedia.test.ts:79-101` asserts that `AppState.addEventListener`, `playToEnd`, `readyToPlay`, sound controls, and public page audio-control props exist. It does not assert:

- `player.pause()` exists anywhere in `EventCoverMedia`;
- close/back route handlers pause before navigation;
- AppState inactive/background pauses;
- AppState active replay is focus-gated;
- `autoplay=false` causes pause;
- reduced-motion flip pauses an already-created player.

`serverDraftLifecycleGuards.test.ts:258-264` only asserts reduced-motion renders through video and passes `autoplay=false` / `loop=false`.

The focused media suite currently passes:

```text
npm run test:orch-0758a -- --runInBand
PASS 6 suites / 58 tests
```

So the repo-running media tests are green while the stop/silence contract is unguarded.

### F5 - Production Readiness Gap: No Telemetry Or Dev Log Can Prove Player Lifecycle

**Classification:** production-hardening gap

ORCH-0766D already found a renderer observability gap: `EventCoverMedia` dropped `expo-video` error payloads before logging. ORCH-0771 adds a lifecycle observability gap: no log or test hook records player create/play/pause/unmount/focus/AppState events. That makes intermittent audio leaks hard to prove from logs.

Instrumentation should be dev-only or test-only, not permanent noisy production logging.

## Runtime Reproduction Status

Runtime reproduction was **not independently rerun** in this pass. Limitations:

- No device/dev-client session was started from this investigation.
- No safe live event fixture with audible cover video was opened.
- The operator's symptom is accepted as runtime signal, but the report's root-cause proof is static plus historical media evidence.

Confidence is still high enough to fail the current contract because the code lacks explicit stop-on-leave behavior and the tests do not guard it.

## Web vs Native

Native is the primary risk:

- Public event hero passes `muted={false}`.
- `EventCoverNativeVideo` owns the AppState replay handler.
- Native stack routes can remain mounted during transitions or hidden screen retention, and Mingla has no route-focus media gate.

Web risk is lower:

- `EventCoverMedia` forces initial web autoplay to muted via `Platform.OS === "web" && autoplay ? true : muted` (`EventCoverMedia.tsx:189-190`, `211-213`), even when `PublicEventPage` passes `muted={false}`.
- Web uses a React-created `<video>` element, and DOM removal should stop playback.

Remaining web gap: if a user taps Sound to unmute and the route remains mounted/hidden rather than removed, there is still no explicit pause-on-route-change contract in the web branch either.

## Relationship To ORCH-0770

ORCH-0771 should be treated as an **amendment to ORCH-0770's public event video reliability contract**, not as a blocker to the media processing investigation itself.

Why:

- ORCH-0770 already owns public event video playback, share-sheet/app visibility recovery, sound/mute chrome, and app/browser playback reliability.
- ORCH-0771 proves the current player lifecycle contract is incomplete even after assets are made browser-safe.
- Fixing transcoding/compression alone will not stop audible native playback after close.

However, the implementation may be a separate bounded code change inside `EventCoverMedia` plus public event close/focus handling. The orchestrator should decide whether to merge this into the pending ORCH-0770 full processing spec or issue a separate ORCH-0771 spec if ORCH-0770 is already in flight.

## Required Fix Direction

This is not implementation, but the eventual spec must require:

1. `EventCoverMedia` / `EventCoverNativeVideo` accepts an explicit active/visible playback contract or derives one safely.
2. Native video calls `player.pause()` when:
   - AppState becomes `inactive` or `background`;
   - effective `autoplay` becomes false;
   - route/screen focus is lost;
   - component cleanup begins, before listener removal/release;
   - public event close/back begins, if needed for immediate silence.
3. AppState `active` replay must require both `autoplay === true` and active screen/media visibility.
4. The public event close path must silence media before `router.replace("/(tabs)/events")`.
5. Reduced-motion runtime flip must pause an already-created player, preserving the ORCH-0758A follow-up note.
6. Web video should also pause when the route/surface is no longer active, even if initial autoplay is muted.

## Required Tests And Gates

Automated tests to add or update:

- Extend `eventCoverMedia.test.ts` or add a focused static guard that fails unless `EventCoverMedia.tsx` contains explicit `player.pause()` behavior for inactive/background, cleanup, and `autoplay=false`.
- Add a static guard that fails if `AppState active` replay exists without a focus/visibility guard.
- Add a public event page guard that the unmuted hero either passes an active/focus signal or that the close handler invokes a media stop path before route replacement.
- Update reduced-motion guard to require pause when reduced motion flips after mount.

Manual/runtime gates:

1. Native iOS dev-client: open public event page with audible video, tap Close, verify audio stops immediately and does not resume.
2. Native iOS: open audible video, open share sheet, dismiss share sheet, close page, verify no audio continues.
3. Native iOS: background/foreground while event page is visible, verify video only resumes when still visible.
4. Native iOS: background/foreground after close/navigation, verify old event audio does not resume.
5. Web: unmute the public video, navigate away/close, verify audio stops.
6. Regression sweep on silent cards: Home/Event List/Public Brand/Checkout/order surfaces should not audibly autoplay and should not wastefully replay when hidden.

## Verdict

**FAIL.**

The app lacks an explicit media lifecycle/silence contract for event-cover videos. The code depends on eventual unmount cleanup while also starting/restarting playback in several effects and replaying on AppState active without screen-focus gating. This can explain the operator report that video audio sometimes keeps playing after the events page has been closed.

Next lifecycle recommendation: orchestrator should amend the pending ORCH-0770 full phone-video processing spec with ORCH-0771's playback lifecycle requirements, or dispatch a narrow ORCH-0771 spec if ORCH-0770 is already too broad to safely absorb it.


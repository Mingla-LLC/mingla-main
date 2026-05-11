# SPEC ORCH-0771 - Event Video Audio Close Lifecycle

> Date: 2026-05-09  
> Mode: Forensics SPEC  
> Input: `reports/INVESTIGATION_ORCH-0771_EVENT_VIDEO_AUDIO_PERSISTS_AFTER_CLOSE.md` and `reports/REVIEW_ORCH-0771_EVENT_VIDEO_AUDIO_PERSISTS_AFTER_CLOSE.md`  
> Output for next gate: `reports/IMPLEMENTATION_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`

## Summary

Fix only the audio-after-close bug for event-cover videos.

The public event page should still feel alive. Public event cover video may autoplay, loop, be audible on native, expose the sound control, and auto-resume after foreground/share-sheet return **when the user is still on the same visible public event page**.

The new contract is narrower: when the event page is closed, route-inactive, backgrounded, reduced-motion-stilled, cleaned up, or otherwise no longer an active playback surface, the video player must pause immediately and must not restart from AppState or loop callbacks.

## Accepted Evidence

### Proven Current Behavior

- `mingla-business/src/components/ui/EventCoverMedia.tsx:96-103` creates the native `expo-video` player and calls `nextPlayer.play()` when `autoplay` is true.
- `EventCoverMedia.tsx:105-111` calls `player.play()` again on `readyToPlay` when `autoplay` is true.
- `EventCoverMedia.tsx:122-124` calls `player.play()` whenever `autoplay` is true.
- `EventCoverMedia.tsx:126-139` replays on `playToEnd` and calls `player.play()` when AppState becomes `active`.
- `EventCoverMedia.tsx:175-177` defaults `autoplay=true`, `muted=true`, and `loop=true`.
- `mingla-business/src/components/event/PublicEventPage.tsx:205-207` closes the public event page with `router.replace("/(tabs)/events")`.
- `PublicEventPage.tsx:408-419` renders the public hero as `EventCoverMedia` with `muted={false}`, `showAudioControl`, and no active/visible playback signal.
- `mingla-business/app/_layout.tsx:199` renders a root `<Stack>` without a media lifecycle policy.
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts:79-101` asserts browser-safe playback props and AppState/play listeners, but does not assert any pause/silence lifecycle.
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts:258-264` proves reduced-motion video uses `video_still` with `autoplay=false` and `loop=false`, but does not prove an already-created player pauses when autoplay becomes false.

### Blast Radius

The public event hero is the only proven audible autoplay event-cover surface because it passes `muted={false}`. Other `EventCoverMedia` consumers omit `muted` and inherit `muted=true`:

- `src/components/event/EventListCard.tsx:135-143`
- `app/(tabs)/home.tsx:475-483` and `app/(tabs)/home.tsx:521-529`
- `src/components/brand/PublicBrandPage.tsx:677-684`
- `src/components/event/PreviewEventView.tsx:196-203`
- `src/components/event/CreatorStep4Cover.tsx:296-304`
- `src/components/event/CreatorStep7Preview.tsx:115-122`
- `app/checkout/[eventId]/index.tsx:240-247`
- `app/o/[orderId].tsx:321-328`
- `app/event/[id]/index.tsx:589-596`

These surfaces still need the shared lifecycle guard so hidden/reduced-motion videos do not wastefully replay, but the fix must not make them audible or require broad caller rewrites.

### Product Constraint

The operator explicitly clarified:

> Solve only the audio-after-close problem without causing regressions. Public-page autoplay and auto-resume are still desired.

This spec treats that as binding.

## Scope

### In Scope

- `mingla-business/src/components/ui/EventCoverMedia.tsx`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`, only if the implementor chooses to add public-route/static lifecycle guards there
- `.github/scripts/strict-grep/orch-0771-event-cover-playback-lifecycle.mjs`, if needed for a source-level guard that Jest alone cannot express cleanly
- `mingla-business/package.json`, only to add a focused `test:orch-0771` script if the strict-grep gate is added

### Out Of Scope

- Disabling public event autoplay.
- Forcing the public event native hero to remain muted.
- Removing public event loop/replay while the page is visible.
- Removing AppState/share-sheet auto-resume for the still-visible public event page.
- ORCH-0770 video upload, trim, transcode, compression, codec, public derivative, storage, or safe-area chrome work.
- Supabase migrations, RLS, edge functions, Stripe, admin, consumer app, social preview, checkout/order business logic, or provider media expansion.

## Implementation Contract

### 1. Add An Explicit Active Playback Intent To `EventCoverMedia`

In `EventCoverMediaProps`, add a narrowly named boolean prop such as:

```ts
playbackActive?: boolean;
```

Rules:

- Default `playbackActive` to `true`.
- Use it only as playback intent, not visibility styling.
- Do not change the existing default `autoplay=true`, `muted=true`, `loop=true`.
- Do not require all existing silent/card callers to pass it.
- Propagate it into `EventCoverVideo`, `EventCoverNativeVideo`, and `EventCoverWebVideo`.

Define effective playback intent inside video renderers:

```ts
const shouldPlay = autoplay && playbackActive;
```

All existing play/replay paths must gate on `shouldPlay`, not only `autoplay`.

### 2. Native Video Must Pause On Inactive Intent

In `EventCoverNativeVideo`:

- Initial `useVideoPlayer` setup may call `play()` only if `shouldPlay` is true.
- `statusChange` `readyToPlay` may call `play()` only if `shouldPlay` is true.
- The autoplay effect must become a play/pause effect:
  - if `shouldPlay`, call `player.play()`;
  - otherwise call `player.pause()`.
- `playToEnd` must replay only when both `loop` and `shouldPlay` are true.
- AppState handling must:
  - call `player.pause()` on `inactive` and `background`;
  - call `player.play()` on `active` only when `shouldPlay` is true.
- Cleanup must call `player.pause()` before or alongside listener removal.
- `muted`, `volume`, and `loop` updates must remain unchanged except where the active contract requires a pause.

This preserves active-page autoplay/resume while preventing hidden or closed media from restarting.

### 3. Web Video Must Obey The Same Active Contract

Refactor `EventCoverWebVideo` from a purely callback-created `<video>` element to a component that can hold a `ref` to the HTML video element.

Rules:

- Render `autoPlay={shouldPlay}` rather than raw `autoplay`.
- `onCanPlay` may call `play()` only when `shouldPlay` is true.
- `onEnded` may loop/replay only when both `loop` and `shouldPlay` are true.
- A `useEffect` must pause the element when `shouldPlay` becomes false.
- If `shouldPlay` becomes true and browser policy allows play, it may call `play().catch(() => undefined)`.
- Preserve the current web browser policy that initial autoplay is muted when needed. Do not force unmuted web autoplay.

### 4. Public Event Page Must Drive Active Playback

In `PublicEventPage`, derive a public-page playback-active boolean that is true only when:

- the route is still the current public event route for this event;
- the user has not pressed close/back/navigation away;
- the page is mounted and rendering the public event hero.

Recommended low-risk implementation:

- Import `usePathname` from `expo-router`, matching existing local Expo Router usage in `app/(tabs)/_layout.tsx`.
- Import or use `eventPublicPath` from `src/constants/publicUrls`.
- Add local state such as `const [mediaPlaybackActive, setMediaPlaybackActive] = useState(true);`.
- Compute:

```ts
const pathname = usePathname();
const isCurrentPublicEventPath =
  pathname === eventPublicPath({ brandSlug: event.brandSlug, eventSlug: event.eventSlug });
const publicHeroPlaybackActive = mediaPlaybackActive && isCurrentPublicEventPath;
```

- In `handleClose`, set `mediaPlaybackActive` to `false` before `router.replace("/(tabs)/events")`.
- Pass `playbackActive={publicHeroPlaybackActive}` to the public hero `EventCoverMedia`.

The implementor may choose `useIsFocused` / `useFocusEffect` from React Navigation instead if it is already safely available in the Expo Router version, but the final implementation must prove focus/visibility is route-scoped and must not rely on eventual unmount alone.

### 5. Other Callers Should Usually Stay Unchanged

Do not touch every `EventCoverMedia` consumer just to pass `playbackActive`.

Because the prop defaults to `true` and most non-public-event consumers are muted, a broad caller sweep would raise regression risk without solving the operator symptom. The shared renderer pause-on-AppState/background/autoplay-false behavior should protect those surfaces without unrelated UI changes.

If the implementor finds a route-hidden silent-video performance issue, record it as a follow-up unless it is necessary to satisfy ORCH-0771's audible close bug.

## Layer Contract

| Layer | Required change |
|---|---|
| Database / RLS / migrations | None. No schema or policy change is authorized. |
| Edge functions / RPC | None. |
| Services / hooks / cache | None, except optional use of Expo Router path/focus utilities inside the UI layer. |
| Shared UI | Add `playbackActive` and enforce `shouldPlay = autoplay && playbackActive` across native and web video. |
| Public event page | Turn playback inactive before close navigation and pass route-active playback intent to the hero. |
| Tests / strict grep | Add focused lifecycle guards that fail on the current play-without-pause implementation. |
| Deployment | Native OTA/web bundle update only if the implementation touches JS/TS only; no native dependency or DB deploy expected. |

## Required Tests And Guards

### Automated Tests

Add or update source-level Jest assertions in `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` so they fail against the current implementation and pass after the fix.

Minimum assertions:

1. `EventCoverMediaProps` contains `playbackActive?: boolean`.
2. `EventCoverNativeVideo` computes `shouldPlay` from both `autoplay` and `playbackActive`.
3. Native player setup, `readyToPlay`, `playToEnd`, and AppState `active` replay gate on `shouldPlay`.
4. AppState `inactive` and `background` call `player.pause()`.
5. `autoplay=false` or `playbackActive=false` after mount calls `player.pause()`.
6. Cleanup calls `player.pause()` before or with listener cleanup.
7. Web video pauses when `shouldPlay` becomes false.
8. Public event hero passes `playbackActive={...}`.
9. `handleClose` sets playback inactive before `router.replace("/(tabs)/events")`.
10. Public event hero still passes `muted={false}` and `showAudioControl`, preserving audible autoplay controls.

Add or update `serverDraftLifecycleGuards.test.ts` only if the implementor wants the public-route lifecycle contract to live beside existing surface guards. If so, keep the test focused on the public hero close/active signal and reduced-motion pause behavior.

### Optional Strict-Grep Gate

If source-level lifecycle assertions become too brittle for Jest readability, add:

`/.github/scripts/strict-grep/orch-0771-event-cover-playback-lifecycle.mjs`

The gate should fail when:

- `EventCoverMedia` has AppState `active` replay without `shouldPlay` or equivalent active intent;
- native video lacks any `player.pause()` on inactive/background;
- cleanup removes listeners without a pause;
- public event close navigates before setting playback inactive;
- public hero loses `muted={false}` or `showAudioControl`.

If added, wire it into `mingla-business/package.json`:

```json
"test:orch-0771": "node ../.github/scripts/strict-grep/orch-0771-event-cover-playback-lifecycle.mjs && npx jest eventCoverMedia.test serverDraftLifecycleGuards.test"
```

If no strict-grep script is added, still add:

```json
"test:orch-0771": "npx jest eventCoverMedia.test serverDraftLifecycleGuards.test"
```

### Required Commands

The implementor must run and report exact output:

```bash
cd mingla-business
npm run test:orch-0771
npm run test:orch-0758a -- --runInBand
npx tsc --noEmit
npx eslint src/components/ui/EventCoverMedia.tsx src/components/ui/__tests__/eventCoverMedia.test.ts src/components/event/PublicEventPage.tsx src/utils/__tests__/serverDraftLifecycleGuards.test.ts
git diff --check
```

If `serverDraftLifecycleGuards.test.ts` is not modified, omit it from the targeted ESLint command and explain why.

## Manual Runtime Gates

Tester must verify on the current native/dev-client build after the implementation lands:

1. Native iOS: open a public event with audible cover video. Confirm autoplay still starts.
2. Native iOS: tap the public event sound control. Confirm sound/mute still works.
3. Native iOS: tap Close. Confirm audio stops immediately and does not resume.
4. Native iOS: open audible public event video, open and dismiss share sheet. Confirm playback may resume only while still on the public event page.
5. Native iOS: background/foreground while still on the public event page. Confirm auto-resume still works.
6. Native iOS: close/navigate away, then background/foreground. Confirm old event audio does not resume.
7. Web: unmute public event video, navigate away/close, confirm audio stops.
8. Regression sweep: Home rows, Event List cards, Public Brand cards, checkout/order mini-cards, creator previews, and Event Detail do not audibly autoplay and do not show new visual regressions.

## Risk Notes

- `expo-video` `useVideoPlayer` auto-cleans on unmount, but ORCH-0771 must not rely on eventual unmount because navigation and AppState transitions can race.
- Pausing on AppState `inactive` can briefly pause when a share sheet opens. That is acceptable only if AppState `active` resumes when the same public event page remains visible.
- Web autoplay policy still controls whether play can start with sound. Do not fight browser policy.
- Broadly passing route state into every card would increase regression risk. Keep public route active-state explicit and shared renderer pause semantics generic.
- Reduced-motion remains a related safety contract: when presentation becomes `video_still` and `autoplay=false`, an existing player must pause.

## Acceptance Criteria

Implementation is acceptable only if all are true:

1. Public event hero still autoplays when active/visible.
2. Public event hero still loops/replays when active/visible.
3. Public event hero can still be audible on native and keeps sound control behavior.
4. AppState/share-sheet return still resumes only for the active visible public event page.
5. Closing/navigating away pauses/silences before or during route transition.
6. AppState inactive/background pauses.
7. AppState active never replays a closed, hidden, or inactive event-cover video.
8. `autoplay=false` and reduced-motion `video_still` pause existing players.
9. Existing silent card surfaces do not become audible.
10. Required automated gates pass and manual runtime gates are assigned to tester.

## Expected Implementor Report

The implementor should write:

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`

The report must include:

- files changed;
- exact lifecycle contract implemented;
- proof that public-page autoplay and valid auto-resume were preserved;
- proof that close/inactive/background cleanup pauses;
- exact test command output;
- any runtime gates not executed and why;
- explicit confirmation that no ORCH-0770 upload/transcode/compression work was touched.


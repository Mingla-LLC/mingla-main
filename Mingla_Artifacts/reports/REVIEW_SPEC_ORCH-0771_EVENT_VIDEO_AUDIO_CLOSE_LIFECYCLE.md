# REVIEW SPEC ORCH-0771 - Event Video Audio Close Lifecycle

> Date: 2026-05-09  
> Mode: Orchestrator review of returned forensics spec  
> Input: `specs/SPEC_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`  
> Decision: **APPROVED FOR IMPLEMENTATION**

## Plain-English Impact

This spec solves the right problem: public event video may stay lively while the user is on the public event page, but it must stop making sound when the user leaves.

The important regression guard is preserved. The spec does **not** mute the public hero, disable autoplay, remove looping, or remove valid auto-resume after a share sheet / foreground return while the public event page is still visible.

## Evidence Review

### Accepted

The spec is grounded in the proven ORCH-0771 evidence:

- `EventCoverMedia` has multiple `player.play()` paths and AppState-active replay.
- `PublicEventPage` intentionally passes `muted={false}` and `showAudioControl` to the public hero.
- Existing tests assert playback props but do not assert pause/silence behavior.
- The public event hero is the only proven audible autoplay surface; other event-cover consumers default to muted.

### Scope Check

Approved scope is narrow:

- `mingla-business/src/components/ui/EventCoverMedia.tsx`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- focused tests / optional strict-grep guard
- `mingla-business/package.json` only for `test:orch-0771`

Explicitly out of scope:

- ORCH-0770 video processing/transcode/compression/storage
- Supabase migrations/RLS/functions
- Stripe
- admin / consumer app
- share-preview or checkout rewrites
- broad caller rewrites across every silent card surface

### Regression Guard

Implementation must preserve:

- public event hero autoplay;
- public event loop/replay while visible;
- native audible public hero behavior and sound control;
- AppState/share-sheet resume only for the still-visible public event page;
- muted behavior for cards, Home rows, brand cards, checkout/order mini cards, creator previews, and Event Detail.

## Approval Notes For Implementor

The safest implementation direction is the spec's explicit `playbackActive` / `shouldPlay` contract:

1. `EventCoverMedia` gets a default-true active playback prop.
2. Native and web video play/replay paths gate on `shouldPlay = autoplay && playbackActive`.
3. Inactive/background/cleanup/autoplay-false paths pause.
4. `PublicEventPage` passes route-active playback intent and turns it off before close navigation.

Do not substitute a simpler fix that only changes `staysActiveInBackground`, only removes AppState resume, or only changes the close handler. Those would either miss the proven replay paths or regress desired resume behavior.

## Required Implementation Evidence

The implementation report must include exact output for:

```bash
cd mingla-business
npm run test:orch-0771
npm run test:orch-0758a -- --runInBand
npx tsc --noEmit
npx eslint src/components/ui/EventCoverMedia.tsx src/components/ui/__tests__/eventCoverMedia.test.ts src/components/event/PublicEventPage.tsx src/utils/__tests__/serverDraftLifecycleGuards.test.ts
git diff --check
```

If `serverDraftLifecycleGuards.test.ts` is untouched, the implementor may omit it from targeted ESLint and must say why.

## Verdict

**APPROVED FOR IMPLEMENTATION.**

Next prompt: `prompts/IMPLEMENTOR_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`

Expected output: `reports/IMPLEMENTATION_ORCH-0771_EVENT_VIDEO_AUDIO_CLOSE_LIFECYCLE.md`


# IMPLEMENTATION REWORK ORCH-0758A — Event/Public Ticket Cover Media

Date: 2026-05-08  
Implementor: Codex `$implementor`  
Status: **implemented and verified**

## Summary

Reworked only the tester FAIL findings from `TEST_REPORT_ORCH-0758A_EVENT_PUBLIC_TICKET_COVER_MEDIA.md`.

Changed files:

- `mingla-business/src/utils/publishedEventEditGuards.ts` — new side-effect-free published edit validator.
- `mingla-business/src/store/liveEventStore.ts` — reuses the validator before applying local published event edits.
- `mingla-business/src/components/event/EditPublishedScreen.tsx` — validates the whole published edit before any canonical cover-media server write.
- `mingla-business/src/utils/draftEventPristine.ts` — new draft pristine helper including media fields.
- `mingla-business/src/components/event/EventCreatorWizard.tsx` — uses the pristine helper.
- `mingla-business/src/utils/eventCoverMediaRules.ts` — rejects supported videos when duration metadata is missing.
- `mingla-business/src/components/ui/EventCoverMedia.tsx` — renders reduced-motion video through paused `expo-video`, not React Native `Image`.
- `mingla-business/src/utils/__tests__/publishedEventEditGuards.test.ts` — new atomicity guard coverage.
- `mingla-business/src/utils/__tests__/draftEventPristine.test.ts` — new pristine/media coverage.
- `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts` — adds missing-duration video rejection coverage.
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts` — adds static guard for server-write ordering and video-still rendering.
- `mingla-business/package.json` — expands `test:orch-0758a` to include the new regression tests.

## Tester Findings Resolved

### P1: published edit atomicity

Resolved by extracting `validateLiveEventFieldUpdate` as a pure validator and running it before `updatePublishedEventCoverMedia`.

Evidence:

- `publishedEventEditGuards.ts:20-133` validates reason, event existence, schedule drops, tier delete, capacity floor, price changes, and free/paid toggles without side effects.
- `EditPublishedScreen.tsx:471-483` validates the full patch before the media branch.
- `EditPublishedScreen.tsx:493-502` performs the canonical `events.cover_media_url/type` update only after validation passes.
- `liveEventStore.ts` now reuses the same validator before applying local edits, preserving one validation contract.
- `publishedEventEditGuards.test.ts:72-91` proves a media patch paired with rejected sold-ticket capacity returns `capacity_below_sold`.
- `serverDraftLifecycleGuards.test.ts` asserts the validator appears before `updatePublishedEventCoverMedia`.

### P2: reduced-motion video behavior

Resolved by keeping `video_still` as the presentation state but rendering it through `EventCoverVideo` with autoplay disabled and loop disabled.

Evidence:

- `EventCoverMedia.tsx:136-142` renders `video` and `video_still` through `expo-video`.
- `video_still` passes `autoplay={false}` and `loop={false}`.
- Static regression guard added in `serverDraftLifecycleGuards.test.ts`.

Runtime note: tester/device QA still needs to confirm `expo-video` paused-frame behavior on the target native build.

### P2: missing video duration enforcement

Resolved by rejecting supported video assets when `durationMs` is missing.

Evidence:

- `eventCoverMediaRules.ts:85-93` throws `video_too_long` when media type is video and duration is not numeric.
- `eventCoverMediaService.test.ts` now covers missing-duration video rejection and over-duration rejection.

### P2: uploaded-cover-only pristine drafts

Resolved by moving pristine detection into `isDraftEventPristine` and including `coverMediaUrl` / `coverMediaType`.

Evidence:

- `draftEventPristine.ts:3-22` includes `coverMediaUrl === null` and `coverMediaType === null`.
- `EventCreatorWizard.tsx:325-327` uses the helper.
- `draftEventPristine.test.ts:48-57` proves uploaded cover media makes the draft non-pristine.

## Verification

Run from `mingla-business/`:

```bash
npm run test:orch-0758a
```

Result: PASS. 6 suites passed, 29 tests passed. Watchman recrawl warning only.

```bash
npm run test:orch-0756b
```

Result: PASS. 2 suites passed, 18 tests passed. Watchman recrawl warning only.

```bash
npx tsc --noEmit
```

Result: PASS with no output.

```bash
npx eslint src/store/liveEventStore.ts src/utils/publishedEventEditGuards.ts src/utils/draftEventPristine.ts src/utils/__tests__/publishedEventEditGuards.test.ts src/utils/__tests__/draftEventPristine.test.ts src/utils/eventCoverMediaRules.ts src/services/__tests__/eventCoverMediaService.test.ts src/components/ui/EventCoverMedia.tsx src/components/event/EditPublishedScreen.tsx src/components/event/EventCreatorWizard.tsx src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result: PASS with no warnings or errors.

Additional read-only checks:

```bash
ls supabase/migrations | sort | tail -5
```

Result includes `20260515000002_orch_0758a_event_cover_storage.sql` and later local `20260515000003_orch_0759_public_event_contract.sql`. No migration was created or renamed during this rework.

```bash
/Users/sethogieva/bin/supabase migration list --linked
```

Result: remote still has no entry for local `20260515000002`; remote also has no entry for local `20260515000003`.

```bash
rg -n "GIPHY|Pexels|PEXELS|GIPHY|giphy|pexels|EXPO_PUBLIC.*GIPHY|EXPO_PUBLIC.*PEXELS" src app app.config.ts package.json ../supabase/functions ../supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql
```

Result: no ORCH-0758A provider code or keys found. Only pre-existing `src/types/brand.ts` comment mentions Giphy/Pexels.

## Scope Guard Confirmation

No GIPHY/Pexels provider UI, API calls, keys, edge functions, or fake provider results were added. No brand media, profile media, admin moderation, per-ticket-tier imagery, or unrelated product cleanup was added. No `supabase db push` was run.

## Residual Gates for Tester / Operator

- Operator must still apply `20260515000002_orch_0758a_event_cover_storage.sql` with `supabase db push` before real storage/RLS upload QA.
- Because `expo-video` is a native module, production validation still requires a native/EAS build or proof the deployed runtime already includes it.
- Device/runtime QA still needs to verify image/GIF/video upload, removal, public/event/checkout/order rendering, failed media fallback, and reduced-motion video behavior on device.

## Recommendation

Return to `$tester` for focused retest of the four fixed findings plus the existing DB-push/native-build/runtime gates. ORCH-0758A is not closed by this report.

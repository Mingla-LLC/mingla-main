# RETEST ORCH-0758A Event/Public Ticket Cover Media

Date: 2026-05-08  
Tester verdict: CONDITIONAL PASS

## 1. Verdict

CONDITIONAL PASS.

The prior P1 published-edit atomicity defect is resolved in code and covered by targeted regression tests/static lifecycle guards. The prior P2 findings for missing video duration and uploaded-cover-only pristine drafts are resolved. Reduced-motion video no longer renders MP4/WebM URLs through React Native `Image`, but final reduced-motion playback behavior remains native-runtime-gated.

This is not ready for production runtime close until:

- The operator applies the pending Supabase migration(s) intentionally. `20260515000002_orch_0758a_event_cover_storage.sql` is still local-only on the linked DB.
- A native/dev-client build containing `expo-video` is available.
- Runtime QA verifies upload/RLS, GIF/video playback, removal, publish persistence, public/ticket rendering, and reduced-motion behavior on device.

No P0/P1 blockers were found in this retest.

## 2. Prior Finding Retest Matrix

| Prior finding | Retest result | Evidence |
|---|---:|---|
| P1 published edit atomicity: media could be written before full published edit acceptance | PASS | `validateLiveEventFieldUpdate` is pure and rejects missing/invalid reason, missing event, sold-ticket unsafe ticket edits, and sold-ticket unsafe schedule drops before side effects (`mingla-business/src/utils/publishedEventEditGuards.ts:20-133`). `EditPublishedScreen` builds the patch, validates it, returns on rejection, and only then calls `updatePublishedEventCoverMedia` (`mingla-business/src/components/event/EditPublishedScreen.tsx:466-519`). `liveEventStore.updateLiveEventFields` reuses the same validator before mutating local live event state (`mingla-business/src/store/liveEventStore.ts:329-340`). Regression tests cover a media patch paired with rejected sold-ticket capacity edit (`mingla-business/src/utils/__tests__/publishedEventEditGuards.test.ts:72-105`) and a static lifecycle guard proves validation precedes server media write (`mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts:111-119`). |
| P2 reduced-motion video rendered MP4/WebM through `Image` | PASS with native runtime condition | `video_still` now renders `EventCoverVideo`, not `Image`; the `Image` branch is only used for image/GIF presentations (`mingla-business/src/components/ui/EventCoverMedia.tsx:136-150`). Static regression guard checks this path and that `video_still` passes `autoplay=false`, `loop=false` (`mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts:121-127`). Native runtime still must prove no brief autoplay while `AccessibilityInfo.isReduceMotionEnabled()` resolves (`mingla-business/src/components/ui/EventCoverMedia.tsx:83-98`) and while `expo-video` player props update (`mingla-business/src/components/ui/EventCoverMedia.tsx:33-65`). |
| P2 missing video duration accepted | PASS | `validateEventCoverAsset` rejects video when `durationMs` is not a number and rejects videos over 15 seconds (`mingla-business/src/utils/eventCoverMediaRules.ts:85-103`). Upload path validates before fetch and after blob read (`mingla-business/src/services/eventCoverMediaService.ts:71-85`). Tests cover missing duration and over-duration videos (`mingla-business/src/services/__tests__/eventCoverMediaService.test.ts:34-50`). |
| P2 uploaded-cover-only pristine draft silently discardable | PASS | `isDraftEventPristine` now requires `coverMediaUrl === null` and `coverMediaType === null` (`mingla-business/src/utils/draftEventPristine.ts:3-22`). Wizard close flow uses that helper (`mingla-business/src/components/event/EventCreatorWizard.tsx:325-340`). Test proves uploaded cover media is non-pristine (`mingla-business/src/utils/__tests__/draftEventPristine.test.ts:43-57`). |

## 3. Spec Regression Check

| Contract | Result | Evidence |
|---|---:|---|
| Canonical event media owner remains `events.cover_media_url/type` | PASS | Draft/server mapper writes and hydrates `cover_media_url/type` (`mingla-business/src/utils/serverDraftEventMapper.ts` matched by `npm run test:orch-0758a`). Published edit server update targets `events.cover_media_url/type` (`mingla-business/src/services/eventCoverMediaService.ts:111-130`). |
| `coverHue` fallback remains intact | PASS | `EventCoverMedia` returns `EventCover` fallback on missing media or media error (`mingla-business/src/components/ui/EventCoverMedia.tsx:111-124`). Hue remains in pristine and creator cover UI as fallback (`mingla-business/src/utils/draftEventPristine.ts:14`; `mingla-business/src/components/event/CreatorStep4Cover.tsx:189-213`). |
| `LiveEvent.serverEventId = draft.id` remains intact | PASS | Static lifecycle guard asserts `serverEventId: draft.id` and event cover media preservation (`mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts:70-77`). ORCH-0758A and ORCH-0756B test bundles passed. |
| ORCH-0756B publish ordering remains intact | PASS | `npm run test:orch-0756b` passed 2 suites / 18 tests, including lifecycle ordering guards. |
| No GIPHY/Pexels provider UI/API/key/fake-result work added | PASS | `rg -n "giphy|GIPHY|pexels|Pexels|PEXELS|EXPO_PUBLIC_.*(GIPHY|PEXELS)|api\\.giphy|api\\.pexels" src app app.config.ts package.json` found only an older `src/types/brand.ts` comment mentioning "Giphy/Pexels"; no provider UI, API calls, env keys, or fake results were present. |
| No brand media/profile media/admin moderation/per-ticket-tier imagery added in ORCH-0758A | PASS | ORCH-0758A implementation is scoped to event cover upload/display/edit surfaces. Existing brand mapping/comment residue is pre-existing and not wired to provider pickers. No per-ticket-tier imagery surfaced in changed test gates or event cover search results. |

## 4. Command Evidence

Commands run from `mingla-business/` unless noted:

```bash
npm run test:orch-0758a
```

Result: PASS. 6 suites passed, 29 tests passed. Watchman emitted a recrawl warning, but Jest exited 0.

```bash
npm run test:orch-0756b
```

Result: PASS. 2 suites passed, 18 tests passed. Watchman emitted the same recrawl warning, but Jest exited 0.

```bash
npx tsc --noEmit
```

Result: PASS. Exit 0.

```bash
npx eslint src/store/liveEventStore.ts src/utils/publishedEventEditGuards.ts src/utils/draftEventPristine.ts src/utils/__tests__/publishedEventEditGuards.test.ts src/utils/__tests__/draftEventPristine.test.ts src/utils/eventCoverMediaRules.ts src/services/__tests__/eventCoverMediaService.test.ts src/components/ui/EventCoverMedia.tsx src/components/event/EditPublishedScreen.tsx src/components/event/EventCreatorWizard.tsx src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result: PASS. Exit 0.

```bash
/Users/sethogieva/bin/supabase migration list --linked
```

Result: PASS as a read-only check, but deployment gate remains. Linked output shows:

```text
20260515000001 | 20260515000001
20260515000002 |
20260515000003 |
```

So ORCH-0758A storage migration `20260515000002` is still not remote-applied. The later ORCH-0759 migration `20260515000003` is also pending; an ordinary `supabase db push` from the current workspace may apply both unless the operator intentionally coordinates deployment.

## 5. Migration / Native Build / Runtime Gate

- DB gate: still open. `supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql` creates the public `event_covers` bucket and event-manager storage policies (`supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql:4-97`). Until applied, real uploads/RLS cannot be production-verified.
- Native gate: still open. `mingla-business/package.json` includes `expo-video` (`~3.0.16`), which requires a native/dev-client build for real playback verification.
- Runtime QA: not performed in this retest because the linked DB still lacks the storage migration and no verified native build/device session was available in this tester pass.

Required runtime checks after DB push and native build:

1. Upload image, GIF, MP4, and WebM covers from the event creator.
2. Reject unsupported files, oversize files, missing video duration metadata, and videos over 15 seconds.
3. Remove uploaded cover and verify hue fallback.
4. Publish a draft and verify media persists into local `LiveEvent` and server event row.
5. Edit a published event with a valid media-only patch.
6. Attempt a published media patch bundled with a sold-ticket unsafe ticket/schedule edit and verify no server media write and no local media mutation.
7. Verify event/public/checkout/order/home/list/preview/brand event cards render media or fallback correctly.
8. Enable reduced motion and verify video covers do not autoplay and do not animate unexpectedly.

## 6. Findings

### P2: Runtime/deploy validation is still required before production close

The code retest is clean, but the feature depends on a local-only storage/RLS migration and a native `expo-video` runtime. This blocks real upload, storage policy, and playback validation. This is an expected deployment/runtime gate, not a code regression.

Evidence:

- `20260515000002` is local-only in linked migration status.
- `event_covers` bucket/RLS is defined only in the pending migration (`supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql:4-97`).
- `expo-video` dependency is present in `mingla-business/package.json`.

Required action:

- Operator applies the intended pending migrations.
- Build/run a native dev client or EAS build with `expo-video`.
- Re-run the runtime QA checklist above.

### P2: Reduced-motion no-Image fix is verified, but no-autoplay behavior needs device proof

The original bug of rendering MP4/WebM through `Image` is fixed. However, the current component initializes `reduceMotion` as `false`, then updates it asynchronously from `AccessibilityInfo.isReduceMotionEnabled()` (`mingla-business/src/components/ui/EventCoverMedia.tsx:83-98`). Static tests prove `video_still` passes `autoplay=false`, but they do not prove an already-created `expo-video` player pauses if reduced motion flips after initial render.

Required action:

- On device/native build, enable reduced motion before opening event cards and verify videos never visibly autoplay.
- Also toggle reduced motion while a video cover is mounted and verify playback pauses or stays still.
- If runtime shows any autoplay, rework `EventCoverVideo` with an effect that explicitly updates `player.loop`, `player.muted`, and calls `player.pause()` when `autoplay` becomes false.

## 7. Recommendation to Orchestrator

Move ORCH-0758A from code-rework failure to conditional QA pass.

Do not close as production-ready yet. Next step is an operator-coordinated DB push decision followed by native runtime QA. Be careful that the current workspace has both ORCH-0758A `20260515000002` and ORCH-0759 `20260515000003` pending remotely.

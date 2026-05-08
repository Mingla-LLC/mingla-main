# TEST REPORT: ORCH-0758A Event/Public Ticket Cover Media

Date: 2026-05-08  
Tester: Codex `$tester`  
Verdict: **FAIL**

## 1. Verdict

**FAIL.** The core draft upload/persist/publish/render plumbing is mostly present and the claimed automated gates pass, but QA found one P1 data-integrity blocker in published-event edit saving plus several P2 release/runtime gaps. This should return to `$implementor` before orchestrator closeout.

## 2. Findings

### P1 HIGH — Published cover media can be saved to Supabase even when the overall published edit is rejected

`EditPublishedScreen.handleConfirmSave` writes `events.cover_media_url/type` through `updatePublishedEventCoverMedia` before the local published-edit guardrails run. Evidence:

- `mingla-business/src/components/event/EditPublishedScreen.tsx:470-500` builds the patch and updates the canonical server event cover first.
- `mingla-business/src/components/event/EditPublishedScreen.tsx:501-506` calls `updateLiveEventFields` only after that server write.
- `mingla-business/src/store/liveEventStore.ts:366-448` can reject the same patch for buyer-protection guardrails before applying local changes.
- `mingla-business/src/store/liveEventStore.ts:451-457` applies the local patch only after those rejection checks.
- `mingla-business/src/components/event/EditPublishedScreen.tsx:520-521` then opens a rejection dialog, but the canonical media write may already have committed.

Impact: a user can change cover media and also make an invalid sold-ticket/schedule edit, see the save rejected, but still mutate the promoted Supabase event row. This creates server/local divergence and violates the no-silent-partial-save expectation for published edits.

Required rework: validate the published edit patch before any Supabase cover-media mutation, or split `updateLiveEventFields` into a side-effect-free validation step plus an apply step. The canonical cover update must only happen after the full save is accepted, or it must be rolled back on local rejection.

### P2 MEDIUM — Reduced-motion video “still” path tries to render an MP4/WebM URL as a React Native Image

The pure rule returns `video_still` under reduced motion:

- `mingla-business/src/utils/eventCoverMediaRules.ts:112-114`

But `EventCoverMedia` renders any non-`video` presentation through `<Image source={{ uri: mediaUrl }}>`:

- `mingla-business/src/components/ui/EventCoverMedia.tsx:136-150`

For an MP4/WebM URL, React Native `Image` should not be expected to decode a first frame. The likely runtime behavior is image error followed by hue fallback. That avoids a blank hero, but it does not satisfy the intended video first-frame/reduced-motion behavior.

Required rework: either use a real thumbnail/still URL, render a paused non-autoplay video under reduced motion, or intentionally fall back to hue and update tests/spec wording accordingly.

### P2 MEDIUM — 15-second video limit is not enforceable when the picker omits duration

The validator only rejects videos when `durationMs` is a number and exceeds the limit:

- `mingla-business/src/utils/eventCoverMediaRules.ts:85-89`

`CreatorStep4Cover` passes `null` when `asset.duration` is missing:

- `mingla-business/src/components/event/CreatorStep4Cover.tsx:120-121`

Impact: if the platform/picker omits duration metadata, a video over 15 seconds can pass service validation as long as it is under 30 MB. The test covers over-duration only when a duration is supplied (`mingla-business/src/services/__tests__/eventCoverMediaService.test.ts:34-40`).

Required rework: reject supported video assets with unknown duration, or add a proven runtime/native enforcement path and test it.

### P2 MEDIUM — Uploaded-cover-only drafts are still treated as pristine

`isDraftPristine` includes `coverHue` but omits `coverMediaUrl` and `coverMediaType`:

- `mingla-business/src/components/event/EventCreatorWizard.tsx:324-345`

Impact: in create mode, a blank draft with only an uploaded cover can be closed as “pristine,” which discards the server draft without the normal confirmation. That can silently lose the uploaded cover association and leave an orphaned storage object.

Required rework: include `liveDraft.coverMediaUrl === null` and `liveDraft.coverMediaType === null` in the pristine check.

### P2 MEDIUM — Runtime upload/RLS remains deployment-gated

Local migration ordering is correct, but linked remote migration status shows `20260515000002` has no remote entry:

- Local tail includes `20260515000002_orch_0758a_event_cover_storage.sql`.
- `supabase migration list --linked` shows `Local 20260515000002 | Remote [blank]`.

Impact: real storage uploads/RLS cannot be accepted in the linked environment until the operator runs `supabase db push`.

### P2 MEDIUM — Feature is native-build-gated, not OTA-only

`expo-video` was added to dependencies/config:

- `mingla-business/package.json:50`
- `mingla-business/app.config.ts:59`

Impact: production devices need a new native/EAS build containing `expo-video`; this is not safe to ship as an OTA-only JS update unless the deployed runtime already contains that native module.

## 3. Spec Compliance Matrix

| Area | Result | Evidence |
|---|---:|---|
| Draft model fields for media | PASS | `draftEventStore.ts:250-253`; persisted v7 migration at `draftEventStore.ts:505-518`. |
| Live event `serverEventId` and media fields | PASS | `liveEventStore.ts:130-160`; persisted v3 migration at `liveEventStore.ts:273-300`. |
| Canonical server draft columns | PASS | `eventDrafts.ts:12-13`; mapper insert/update/hydrate at `serverDraftEventMapper.ts:282-305` and `:361-364`. |
| Upload service validates type/size and uploads to `event_covers` | PARTIAL | `eventCoverMediaService.ts:61-109`; duration gap above. |
| Upload failures avoid state mutation | PASS by code path | Step 4 updates draft only after upload returns (`CreatorStep4Cover.tsx:113-127`). |
| Step 4 upload/replace/remove UI | PASS by static review | `CreatorStep4Cover.tsx:79-146`, preview at `:153-161`. |
| Publish preserves media and server id | PASS | `EventCreatorWizard.tsx:451-473`; `liveEventConverter.ts:73-103`. |
| Published edit media parity | FAIL | P1 partial canonical save before guardrail acceptance. |
| Event/public/ticket surfaces render media with hue fallback | PASS/PARTIAL | Surfaces use `EventCoverMedia`; reduced-motion video still path is partial. |
| No GIPHY/Pexels/provider implementation in ORCH-0758A | PASS | Search found no ORCH-0758A provider code or keys; only a pre-existing brand type comment mentions “Giphy/Pexels.” |
| No brand/profile media implementation in this slice | PASS | No hidden brand/profile upload work found. |

## 4. Verification Commands

Run from `mingla-business/` unless noted:

```bash
npm run test:orch-0758a
```

Result: PASS. 4 suites passed, 21 tests passed. Watchman recrawl warning only.

```bash
npm run test:orch-0756b
```

Result: PASS. 2 suites passed, 15 tests passed. Watchman recrawl warning only.

```bash
npx tsc --noEmit
```

Result: PASS with no output.

```bash
npx eslint app.config.ts ... src/components/ui/__tests__/eventCoverMedia.test.ts
```

Result: PASS with warnings only. 0 errors, 13 warnings. Warnings were unused values and array-type style issues in existing/touched files.

```bash
npx eslint 'app/event/[id]/index.tsx'
```

Result: FAIL with 10 `react-hooks/rules-of-hooks` errors and 5 warnings. `git diff` shows ORCH-0758A only swapped `EventCover` for `EventCoverMedia` on this file, so the hook-order failures appear pre-existing and not introduced by this slice.

```bash
ls supabase/migrations | sort | tail -20
/Users/sethogieva/bin/supabase migration list --linked
```

Result: local migration prefix is monotonic after `20260515000001`; linked remote has not applied `20260515000002`.

## 5. Migration/RLS Review

Static review of `supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql`:

- Bucket id/name is `event_covers` (`:4-8`).
- Public read is limited to `bucket_id = 'event_covers'` (`:30-33`).
- File size limit is 30 MB and allowed MIME types are JPEG/PNG/WEBP/GIF/MP4/WEBM (`:9-17`).
- Insert/update/delete policies require bucket match, two folder segments plus non-empty filename, matching `events.brand_id` and `events.id`, non-deleted event row, and `event_manager` or higher rank (`:35-97`).
- The policy is not the broad avatar/user-owned media pattern.

Static RLS shape is acceptable. Runtime RLS is unverified until the remote migration is applied.

## 6. Runtime / Manual QA Evidence

No device/runtime QA was completed in this tester pass. Reasons:

- The linked Supabase project has not applied `20260515000002`, so real uploads to `event_covers` are not deploy-ready.
- `expo-video` is newly added and requires a native/dev-client build gate before reliable runtime validation.

Manual QA still required after rework and deploy/build:

- Upload image/GIF/video cover in Step 4 on a server-backed draft.
- Remove cover and verify hue fallback.
- Attempt unsupported, oversize, and overduration media.
- Publish and verify local live event plus promoted server row retain media.
- Verify public event, event detail, checkout, order, home, event list, preview, and public brand event cards.
- Verify reduced-motion behavior for videos on device.

## 7. Deployment Notes

- Operator must run `supabase db push` before upload/RLS runtime QA.
- A new EAS/dev-client/native build is required for `expo-video`.
- The event detail hook-order lint blocker remains outstanding but is not caused by ORCH-0758A.

## 8. Residual Risks / Required Rework

Required before retest:

1. Fix published edit save atomicity so canonical cover media is not written before the full published edit is accepted.
2. Fix or explicitly redefine reduced-motion video behavior.
3. Enforce the 15-second video limit when duration metadata is missing.
4. Include media fields in the create-mode pristine draft check.
5. After operator DB push and native build, perform runtime QA on real device/dev client.

## 9. Recommendation to Orchestrator

Do not close ORCH-0758A. Return to `$implementor` with the P1/P2 rework list above, then dispatch `$tester` for a focused retest after code changes, DB push confirmation, and native build/runtime evidence.

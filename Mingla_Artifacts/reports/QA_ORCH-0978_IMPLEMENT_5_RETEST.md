# QA ORCH-0978 IMPLEMENT-5 RETEST

Date: 2026-05-28  
Tester: Codex tester-mingla  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]`  
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`  
Dispatch HEAD: `524be01f5`

## Verdict

**PASS for IMPLEMENT-5 RETEST, with one simulator-native caveat.**

The core customer-risk path passed live: a published/scheduled event that started with `events.cover_media_url = null` accepted a 12-second video cover, saved through the published-event reason modal, returned to the event detail screen with the video cover visible, and Supabase now stores the processed Cloudinary MP4 URL. T-AMEND7-08 was added as a tester-owned adversarial regression and proven fail-on-revert.

Caveat: the iOS simulator's native video picker intercepted the over-29-second selection with Apple's own "Video Too Long to Send" sheet before Mingla's app-level toast could render. I verified the scoped Mingla 29-second copy in the live cover editor, and strict-grep C9 proves the old "30 seconds" literal is dead in the two scoped files.

## Scope And Guardrail Result

| Guard | Result | Evidence |
| --- | --- | --- |
| Client-only / no edge source change | PASS | No tester edits under `supabase/`; no edge deploy command run. |
| No Supabase DB push / migration | PASS | Supabase access was read-only SQL only; live mutation happened only through the Business app save flow. |
| No product code change | PASS | Tester changed only `mingla-business/src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx` plus this report. |
| No PR opened | PASS | No PR command or GitHub tool call used. |
| Existing dirty worktree respected | PASS | Pre-existing dirty/untracked files were left alone. |

## Live-Fire Evidence

### Device And Bundle

| Item | Result |
| --- | --- |
| Simulator | iPhone 17, UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752` |
| Dev-client bundle | Deep-linked to `https://l4ur-4g-sethogieva-8090.exp.direct` after the stale cached HTTP tunnel red screen |
| Maestro target | PASS after shutting down the unrelated booted iPhone 17 Pro so Maestro selected the requested iPhone 17 |

### Precondition

Read-only Supabase query before live-fire identified a null-cover target:

| Event | ID | Status | Initial `cover_media_url` |
| --- | --- | --- | --- |
| A life in vegas | `b1ab659e-358d-41f3-a56d-76f7b273bddd` | `scheduled` | `null` |

### Successful Save Path

Actions completed on iOS simulator via Maestro:

1. Opened Business app and `A life in vegas`.
2. Opened event menu -> Edit details.
3. Expanded Cover.
4. Selected the 0:12 rainbow video from the native picker.
5. Tapped Save changes.
6. Entered reason: `ORCH 0978 simulator cover retest`.
7. Confirmed Save changes.
8. Returned to the event detail screen with the video cover visible.

Post-save read-only Supabase confirmation:

```text
id: b1ab659e-358d-41f3-a56d-76f7b273bddd
title: A life in vegas
status: scheduled
cover_media_type: video
cover_media_provider: upload
cover_media_alt: Uploaded video cover
updated_at: 2026-05-28 06:55:45.174814+00
cover_media_url: https://res.cloudinary.com/dhza7d54o/video/upload/c_limit,w_1280,h_720,du_12,vc_h264,ac_aac,br_9000k,f_mp4,q_auto:good/v1779951122/event-covers/raw/22a18413-bfbf-4087-9ba7-45f70deba0f3/b1ab659e-358d-41f3-a56d-76f7b273bddd/f964215f-c61a-4e91-ada9-6b2510b1a1a6.mp4
```

Cloudinary HEAD check:

```text
HTTP/2 200
content-type: video/mp4;codecs=avc1
server-timing: ... width=1280,height=720,...du=12.0,vc="h264",bytes=305373,format="mp4" ...
```

### Over-29-Second Path

I selected a 1:00 video in the iOS native picker. The picker displayed Apple's native rejection sheet:

```text
Video Too Long to Send
Please select a smaller clip from this video.
```

Because the native picker blocked the long clip before returning an asset to Mingla, the app-level `Please trim to 29 seconds first.` toast did not render in this simulator path. Live cover-editor copy still showed:

```text
Use your phone's trim screen to keep video covers to 29 seconds.
```

Strict-grep C9 passed and proves the scoped stale copy is gone:

```text
OK   [C9] "30 seconds" literal is dead in eventCoverNativeVideo.ts + eventCoverMediaRules.ts
```

## Tester Regression Added

File:

```text
mingla-business/src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx
```

Added T-AMEND7-08 coverage:

1. The edit-screen catch block explicitly maps `persist_mismatch` to:
   `Save succeeded but the cover did not persist. Refresh and try again.`
2. A mocked mismatched `setEventCover` echo path rejects with `persist_mismatch`, and the edit-screen source contract contains the same exact toast.

Why source-text coverage is used: the existing Jest config compiles TSX with `jsx: react-native`, which leaves React Native JSX uncompiled for the Node test environment. I kept the regression repo-running and fail-on-revert without changing product code or Jest config.

## Verification Commands

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/mingla-business
npx jest src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx --runInBand
```

Result:

```text
PASS src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx
Tests: 5 passed, 5 total
```

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/mingla-business
npx jest src/services/__tests__/eventCoverMediaService.setClearSplit.test.ts src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx --runInBand
```

Result:

```text
PASS src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx
PASS src/services/__tests__/eventCoverMediaService.setClearSplit.test.ts
Tests: 9 passed, 9 total
```

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]
node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs
```

Result:

```text
OK   [C1] CoverPicker client picker cap is 29 seconds
OK   [C2] Cloudinary-pipeline constant is 29_000
OK   [C3] Storage-pipeline constant is 29_000
OK   [C4] DB migration pins both video duration constraints to 29000
OK   [C5] Upload-intent public_id template and webhook public_id parser remain aligned
OK   [C6] Webhook duration fallback remains tied to job trim columns
OK   [C7] Processed-duration validation uses discrete codes and the old literal is dead
OK   [C8] eventCoverMediaService exports setEventCover + clearEventCover; old symbol is dead
OK   [C9] "30 seconds" literal is dead in eventCoverNativeVideo.ts + eventCoverMediaRules.ts
```

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/mingla-business
npx jest src/utils/__tests__/serverDraftLifecycleGuards.test.ts --runInBand -t "published cover media server write"
```

Result:

```text
PASS src/utils/__tests__/serverDraftLifecycleGuards.test.ts
Tests: 1 passed, 20 skipped, 21 total
```

## T-AMEND7-08 Fails-On-Revert Proof

Revert probe:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]
patch_file="/tmp/orch0978-tester-editpublished-$$.patch"
git diff 4bd141ff7~1..4bd141ff7 -- mingla-business/src/components/event/EditPublishedScreen.tsx > "$patch_file"
git apply -R "$patch_file"
(cd mingla-business && npx jest src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx --runInBand -t "T-AMEND7-08")
test_status=$?
git apply "$patch_file"
rm -f "$patch_file"
if [ "$test_status" -eq 0 ]; then
  echo "UNEXPECTED_PASS: T-AMEND7-08 passed with EditPublishedScreen rewrite reverted"
  exit 1
fi
echo "EXPECTED_FAIL: T-AMEND7-08 failed with EditPublishedScreen rewrite reverted (status $test_status)"
```

Expected failure observed:

```text
FAIL src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx
Tests: 2 failed, 3 skipped, 5 total
EXPECTED_FAIL: T-AMEND7-08 failed with EditPublishedScreen rewrite reverted (status 1)
```

Restore proof:

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]
git diff --exit-code -- mingla-business/src/components/event/EditPublishedScreen.tsx
cd mingla-business
npx jest src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx --runInBand -t "T-AMEND7-08"
```

Result:

```text
EditPublishedScreen restored clean
PASS src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx
Tests: 2 passed, 3 skipped, 5 total
```

## Downstream Gate

Tester live-fire RETEST is complete enough to pause for Seth's physical iPhone re-validation. After physical iPhone PASS, route to orchestrator for CLOSE with `[deploy]` tag, EAS OTA iOS+Android, PR, squash merge, and worktree reap.

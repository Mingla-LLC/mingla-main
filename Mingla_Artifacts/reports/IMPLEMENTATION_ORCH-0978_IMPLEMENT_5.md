# Implementation Report: ORCH-0978 IMPLEMENT-5 Video Upload Save-Cover Persistence

> Date: 2026-05-28
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` §SPEC AMENDMENT 7
> Status: implemented and verified

## 1. Layman Summary

Published-event video covers now save through an explicit set path or an explicit clear path. A normal video upload can no longer silently write NULL to every cover column, and any future persistence mismatch throws a truthful error instead of showing a false "Saved" state.

## 2. Request And Context

- **Request:** Execute IMPLEMENT-5 for ORCH-0978 per SPEC AMENDMENT 7, with two local commits and fails-on-revert proof.
- **Source:** Spec commit `f6e9fb9d5`, review approval `6ba560902`.
- **Affected surfaces:** `mingla-business` shared client bundle for Business iOS, Android, and web preview.
- **Related issues/artifacts:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_SAVE_COVER_PERSISTENCE.md`, `Mingla_Artifacts/reports/REVIEW_ORCH-0978_INVESTIGATION_SAVE_COVER_PERSISTENCE.md`.

## 3. Scope

- **In scope:** Items 1-7 from AMENDMENT 7: service split, save-flow rewrite, trim-value wiring, copy fixes, strict-grep C8/C9, server guard update, and Jest regressions T-AMEND7-01 through T-AMEND7-07.
- **Out of scope:** Edge function source, edge deploy, Supabase DB push, migration, PR creation, draft/trip/brand cover save audits, T-AMEND7-08.
- **Assumptions:** Existing event-cover video backend v122 remains the source of processed URLs; this client commit only persists or clears published-event cover fields.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | Binding contract | AMENDMENT 7 requires client-only service split and save-flow guard. |
| `eventCoverMediaService.ts` | Service owner | Old `updatePublishedEventCoverMedia` accepted `string | null` and used null ternaries. |
| `EditPublishedScreen.tsx` | Published save owner | Old block read through to `liveEvent.coverMediaUrl`, which can be null. |
| `CoverPicker.tsx` | Remove-cover chain | `handleRemoveCover` still emits all cover fields as null, matching the new clear path. |
| `useEventCoverVideoUpload.ts` | Upload-intent hook | Intent call omitted explicit trim fields even though the service type accepts them. |
| `serverDraftLifecycleGuards.test.ts` | Existing guard | Assertion referenced the deleted symbol and needed the new set/clear names. |
| `orch-0978-video-cap-29s.mjs` | CI guard | Existing checks ended at C7; C8/C9 were missing. |

## 5. Blast Radius

- **Direct changes:** Published event cover save, cover service API, event-cover video upload intent payload, 29-second copy.
- **Cascade changes:** Imports and source guards updated for deleted `updatePublishedEventCoverMedia`.
- **Parity surfaces:** Automatic across Business iOS/Android/web because the shared bundle owns the flow.
- **Cache impact:** No query-key changes. Existing cache invalidation remains unchanged.
- **State boundaries:** React component patch state still owns pending edits; Supabase `events` row remains persisted truth.
- **Auth/RLS/security:** No auth/RLS changes.
- **Deploy path:** Business client deploy/OTA only; no backend deploy.

## 6. Old To New Receipts

### `mingla-business/src/services/eventCoverMediaService.ts`

- **Before:** One nullable `updatePublishedEventCoverMedia(serverEventId, mediaUrl: string | null, ...)` wrote null cover columns when `mediaUrl` was null.
- **After:** `setEventCover` requires `mediaUrl: string`, writes all cover columns, selects cover fields back, and throws `persist_mismatch` if the echoed URL differs. `clearEventCover` is the only null-writing path.
- **Why:** Makes implicit null writes structurally impossible.
- **Approx lines changed:** +76/-26.

### `mingla-business/src/components/event/EditPublishedScreen.tsx`

- **Before:** Any cover metadata patch called the nullable writer with a possible null URL.
- **After:** `explicitCoverSet` calls `setEventCover`, `explicitCoverClear` calls `clearEventCover`, metadata-only patches skip the cover service and warn, and `persist_mismatch` shows the required toast.
- **Why:** Prevents "Saved" after a silent null write.
- **Approx lines changed:** +75/-49.

### `mingla-business/src/hooks/useEventCoverVideoUpload.ts`

- **Before:** Upload intent omitted `trimStartMs`/`trimEndMs`.
- **After:** Intent passes `trimStartMs: 0` and `trimEndMs: compressed.durationMs`.
- **Why:** Keeps the backend trim contract explicit.
- **Approx lines changed:** +2.

### `mingla-business/src/utils/eventCoverNativeVideo.ts`

- **Before:** Trim rejection said "30 seconds".
- **After:** Trim rejection says "29 seconds".
- **Why:** Matches the actual picker and backend cap.
- **Approx lines changed:** +1/-1.

### `mingla-business/src/utils/eventCoverMediaRules.ts`

- **Before:** Error union lacked `persist_mismatch`; two copy strings still said "30 seconds".
- **After:** `persist_mismatch` is a typed cover error; both scoped strings say "29 seconds".
- **Why:** Supports truthful persistence failure and closes stale copy.
- **Approx lines changed:** +4/-3.

### `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`

- **Before:** C1-C7 only.
- **After:** C8 enforces set/clear exports and dead old symbol; C9 enforces no "30 seconds" literal in the two scoped utils.
- **Why:** Prevents the bug class and stale copy from returning.
- **Approx lines changed:** +31.

### Tests

- **Before:** No AMENDMENT 7 set/clear or save-flow regression coverage.
- **After:** New service test file covers T-AMEND7-01..04; new save-flow contract file covers T-AMEND7-05..07.
- **Why:** Locks the physical-iPhone repro class before tester adds T-AMEND7-08.
- **Approx lines changed:** +230.

## 7. Implementation Details

- **Architecture decisions:** Deleted the nullable writer instead of aliasing it. Kept remove-cover ownership in `CoverPicker` and persistence ownership in `EditPublishedScreen`.
- **Data flow:** Video-ready `emitChange` produces a non-null cover URL, save calls `setEventCover`, Supabase returns the echoed cover URL, and mismatch throws.
- **Mutation/query behavior:** Existing cache invalidation paths unchanged.
- **State handling:** Metadata-only patches no longer manufacture a cover service write.
- **Error handling:** `persist_mismatch` gets the required user toast; other cover service errors keep existing friendly copy.
- **Copy/accessibility:** Three scoped user-facing "30 seconds" strings now say "29 seconds".
- **Analytics/notifications/realtime:** No changes.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Item 1 save guard | Yes | T-AMEND7-05/06/07; fails-on-revert | PASS |
| Item 2 service split | Yes | T-AMEND7-01/02/03; C8 | PASS |
| Item 3 round-trip verification | Yes | T-AMEND7-04 | PASS |
| Item 4 trim values | Yes | Source diff; existing type accepts fields | PASS |
| Item 5 copy strings | Yes | C9; source diff | PASS |
| Item 6 strict-grep C8/C9 | Yes | `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | PASS |
| Item 7 Jest regressions | Yes | 7/7 targeted tests pass | PASS |
| Item 8 optional DIAG | No | Intentionally skipped | N/A |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-PROPOSED-NO-COVER-NULL-IMPLICIT-WRITE | Yes | Yes | `setEventCover` requires a non-null string; clear is separate. |
| COMMS-0002 backend strict-grep context | Yes | Yes | No `supabase/functions` source touched. |
| COMMS-0003 external API docs rule | Low | Yes | No new external API behavior or provider claims. |
| META-ORCH-0744 two-commit pattern | Yes | Yes | Commits `4bd141ff7` and `6a8bdb50b`. |

## 10. Parity Check

- **Mobile:** Business iOS/Android share the same React Native code path.
- **Business app:** Primary surface fixed.
- **Admin:** Not touched.
- **Public/web:** Read-only render paths unaffected.
- **Solo/collab:** No collaboration logic touched.
- **Gaps:** Tester still owns T-AMEND7-08 and live-fire validation.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None; existing `events.cover_media_*` columns used.
- **AsyncStorage/Zustand impact:** No storage schema changes.
- **Cold start behavior:** No changes.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Strict-grep C1-C9 | `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | PASS | Includes new C8/C9. |
| AMENDMENT 7 Jest tests | `cd mingla-business && npx jest src/services/__tests__/eventCoverMediaService.setClearSplit.test.ts src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx --runInBand` | PASS | 7 tests passed. |
| Existing guard slice | `cd mingla-business && npx jest src/utils/__tests__/serverDraftLifecycleGuards.test.ts --runInBand -t "published cover media server write"` | PASS | 1 targeted test passed. |
| Fails-on-revert proof | Temporarily reverse-applied the `EditPublishedScreen.tsx` product diff, ran the two AMENDMENT 7 Jest files, then restored the patch | EXPECTED FAIL | T-AMEND7-05, T-AMEND7-06, and T-AMEND7-07 failed; service tests still passed. |
| Restored PASS proof | Re-ran the two AMENDMENT 7 Jest files after restoring | PASS | 7/7 passed. |
| Full `serverDraftLifecycleGuards.test.ts` | `cd mingla-business && npx jest src/utils/__tests__/serverDraftLifecycleGuards.test.ts --runInBand` | FAIL, unrelated | Pre-existing stale assertions/routes fail outside this scope. |
| Full typecheck | `cd mingla-business && npx tsc --noEmit --pretty false` | FAIL, unrelated | Existing repo-wide TS errors in checkout, marketing editor, package typings, and fixture drift. No AMENDMENT 7-specific TS error observed in targeted Jest compilation. |

## 13. Regression Surface

1. Published-event cover save after video upload: now locked by T-AMEND7-05.
2. Published-event remove cover: now locked by T-AMEND7-07.
3. Metadata-only cover patch: now locked by T-AMEND7-06.
4. Service-level null-write bug class: now locked by C8 and T-AMEND7-01..04.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| T-AMEND7-08 not implemented here | Persist-mismatch toast needs independent adversarial tester coverage | Tester RETEST commit adds T-AMEND7-08 | Tester scope per spec |
| Full repo checks red | Broad stale guard/typecheck failures could obscure unrelated CI signal | Orchestrator/tester decides whether these are already tracked or need separate cleanup | Verification notes above |

## 15. Discoveries For Orchestrator

- The per-ORCH worktree already contained unrelated dirty files before IMPLEMENT-5: `app-mobile/tsconfig.json`, `mingla-business/package-lock.json`, `mingla-business/tsconfig.json`, prior untracked reports/runtime artifacts, node_modules folders, and simulator screenshots. They were not staged or modified by IMPLEMENT-5.
- Full `serverDraftLifecycleGuards.test.ts` has stale route/source assumptions unrelated to this amendment.
- Full `mingla-business` typecheck is already red from unrelated surfaces.

## 16. Deploy Notes

- **Migrations:** None. Do not run `supabase db push`.
- **Edge functions:** None. Do not redeploy event-cover-video functions.
- **Mobile OTA/native:** Business client code changed; route through orchestrator CLOSE with deploy tag and EAS OTA after review/tester/live-fire approval.
- **Business/admin web:** `mingla-business/src/` changed; web build/deploy belongs to close/deploy routing.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
ORCH-0978 IMPLEMENT-5: fix published cover persistence

Resolves: ORCH-0978 AMENDMENT 7 client save-cover persistence
Evidence: strict-grep C1-C9 PASS; 7/7 targeted Jest PASS; fails-on-revert verified
Deploy: client-only; no migration, no edge deploy
```

## Ready-To-Test Checklist

1. In the business app, open a published event with no cover, upload a video shorter than 29 seconds, tap Save changes, enter a reason, and confirm.
2. Reopen the event and verify the video cover is still present.
3. Remove the cover, save again, and verify the cover clears.
4. Tester adds T-AMEND7-08 for the persist-mismatch toast before close.

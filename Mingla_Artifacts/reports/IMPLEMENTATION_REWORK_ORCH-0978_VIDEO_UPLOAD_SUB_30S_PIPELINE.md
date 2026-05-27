# Implementation Rework Report: Video Upload Sub-30s Pipeline (ORCH-0978)

> Date: 2026-05-27
> Mode: Rework
> Source: `Mingla_Artifacts/reports/QA_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`
> Status: implemented, partially verified

## 1. Layman Summary

The branch is now rebased onto current `origin/main`, the shared event-rendering/package collisions are resolved, and the red video-service timeout regression is green without weakening the timeout contract. The new adversarial Cloudinary cancel cleanup tests remain in place. Runtime evidence was prepared with Maestro/device probes, but the mandatory T-11/T-12 proof still needs targeted tester live-fire because no physical iPhone is attached and the live database has no video-cover/job fixture to render.

## 2. Request And Context

- **Request:** Rework ORCH-0978 from the FAIL QA report.
- **Source:** `Mingla_Artifacts/reports/QA_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`
- **Affected surfaces:** `packages/event-rendering`, `app-mobile` and `mingla-business` package/tsconfig resolution, event-cover video service tests, Supabase event-cover video helper tests, strict-grep backend allowlist.
- **Related issues/artifacts:** `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`, `Mingla_Artifacts/reports/qa-orch-0978-runtime/`.

## 3. Scope

- **In scope:** P1-001 rebase and collision resolution; P1-002 service Jest pass; preserve T-05 Deno tests; strict-grep allowlist fix; simulator/runtime evidence capture attempts for P1-003.
- **Out of scope:** Mutating production data, creating a new video-cover fixture, deploying edge functions, running full EAS builds, claiming physical iPhone evidence without an attached device.
- **Assumptions:** Tester will run the real Android upload -> iOS native + Safari iOS playback path once a physical iPhone and a valid upload fixture are available.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `QA_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | Rework contract | P1-001/P1-002/P1-003 were required blockers. |
| `SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | Runtime gate contract | T-11/T-12 require Android upload and iOS playback/cold-load proof. |
| `mingla-business/src/services/eventCoverVideoProcessingService.ts` | Timeout contract | `waitForEventCoverVideoReady` still throws typed `processing_timeout` with `lastStatus`. |
| `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts` | P1-002 test | Timeout test is unchanged in contract and now passes. |
| `mingla-business/__tests__/services/eventCoverVideoProcessingService.compression.test.ts` | Compression regression | Happy path used a 5ms wall-clock timeout; raised to 1000ms so it does not race under machine load. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | Backend allowlist | Added the new T-05 Deno test file to ORCH-0978 allowlist. |

## 5. Blast Radius

- **Direct changes:** Rebase conflict resolution in package/rendering metadata; strict-grep allowlist; compression happy-path test timeout.
- **Cascade changes:** ORCH-0863 strict-grep now accepts ORCH-0978's helper test file while still blocking unrelated backend files.
- **Parity surfaces:** Shared `EventCoverMedia` remains exported alongside ORCH-0964 theme exports.
- **Cache impact:** None.
- **State boundaries:** No persisted state changes.
- **Auth/RLS/security:** No schema or RLS changes.
- **Deploy path:** Full EAS build warning remains because native modules changed; edge deploy remains downstream.

## 6. Old To New Receipts

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

- **Before:** ORCH-0978 allowlist covered helper/source function files but not `supabase/functions/_shared/eventCoverVideo.test.ts`.
- **After:** The T-05 Deno test file is explicitly allowlisted.
- **Why:** Preserve the adversarial cleanup tests and keep global backend strict-grep green.
- **Approx lines changed:** 1.

### `mingla-business/__tests__/services/eventCoverVideoProcessingService.compression.test.ts`

- **Before:** Happy-path ready polling used `timeoutMs: 5`, which could time out under parallel CPU load before consuming the mocked applied status.
- **After:** Happy-path ready polling uses `timeoutMs: 1_000`.
- **Why:** The test proves compress -> upload -> applied, not timeout behavior; the separate service timeout contract test remains strict.
- **Approx lines changed:** 1.

### Rebase conflict resolution

- **Before:** Branch was not descended from `origin/main`; package/rendering conflicts existed with ORCH-0964.
- **After:** `git merge-base --is-ancestor origin/main HEAD` exits `0`; event-rendering exports and peer deps union both ORCH-0964 theme work and ORCH-0978 video renderer work.
- **Why:** P1-001 required post-rebase production-shape code.
- **Approx lines changed:** Resolved during rebase in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`, `app-mobile/tsconfig.json`, `mingla-business/tsconfig.json`, `packages/event-rendering/index.ts`, and `packages/event-rendering/package.json`.

## 7. Implementation Details

- **Architecture decisions:** Kept main's brand/theme rendering additions and ORCH-0978's shared `EventCoverMedia` additions together.
- **Data flow:** No runtime data-flow change beyond preserving existing upload/compression flow.
- **Mutation/query behavior:** No changes.
- **State handling:** No changes.
- **Error handling:** Timeout error contract remains typed and tested.
- **Copy/accessibility:** No user-facing copy change.
- **Analytics/notifications/realtime:** No changes.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| P1-001 rebase onto current `origin/main` | Yes | `git merge-base --is-ancestor origin/main HEAD` returned `0` | PASS |
| Resolve event-rendering/package collisions | Yes | Conflict files have no markers; JSON parse passed for tsconfigs/package | PASS |
| P1-002 service Jest green | Yes | `npx jest src/services/__tests__/eventCoverVideoProcessingService.test.ts --runInBand --no-cache` | PASS |
| Preserve timeout contract | Yes | Timeout test still expects `processing_timeout` + `lastStatus` | PASS |
| Preserve adversarial T-05 Deno tests | Yes | `deno test --allow-env supabase/functions/_shared/eventCoverVideo.test.ts` 10/10 | PASS |
| T-11/T-12 runtime proof | Evidence prepared only | Maestro/device probes and screenshots captured; physical iPhone and video fixture unavailable | NEEDS TARGETED RETEST |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-PROPOSED-VIDEO-UPLOAD-OPTIMISTIC-PREVIEW | Yes | Yes | ORCH-0978 strict-grep passed. |
| I-PROPOSED-VIDEO-CANCEL-ABORTS-UPLOAD | Yes | Yes | ORCH-0978 strict-grep passed. |
| I-PROPOSED-VIDEO-AUTOPLAY-MUTED-CONTRACT | Yes | Yes | ORCH-0978 strict-grep passed. |
| I-COMMS-LEDGER-ENTRY-STANZA | Yes | Yes | COMMS-0002/0003/0004 acknowledged in anchor main commit `2886dbe1a`. |
| Backend allowlist discipline | Yes | Yes | ORCH-0863 strict-grep passed after adding the ORCH-0978 helper test file. |

## 10. Parity Check

- **Mobile:** Static/test coverage green; native runtime still needs EAS/dev-client evidence.
- **Business app:** Service and compression tests green; iOS simulator launch smoke captured.
- **Admin:** N/A.
- **Public/web:** No live video-cover fixture exists in remote DB, so public render was not live-fired.
- **Solo/collab:** N/A.
- **Gaps:** T-11/T-12 still require physical iPhone + Android upload fixture.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None in this rework.
- **Invalidations added:** None in this rework.
- **Data shape changes:** None in this rework.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** T-12 cold-load is still a manual runtime gate.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Branch freshness | `git merge-base --is-ancestor origin/main HEAD; echo $?` | PASS | Exit `0`. |
| Service Jest | `npx jest src/services/__tests__/eventCoverVideoProcessingService.test.ts --runInBand --no-cache` | PASS | 13/13 tests, includes timeout contract. |
| Compression Jest | `npx jest __tests__/services/eventCoverVideoProcessingService.compression.test.ts --runInBand --no-cache` | PASS | 1/1 test. |
| ORCH-0978 + ORCH-0863 strict-grep | `node ...orch-0978... && node ...orch-0863...` | PASS | All checks PASS, 45 changed files in diff. |
| Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-cancel/index.ts supabase/functions/event-cover-video-upload-intent/index.ts supabase/functions/event-cover-video-source-uploaded/index.ts supabase/functions/event-cover-video-webhook/index.ts supabase/functions/event-cover-video-status/index.ts supabase/functions/event-cover-video-apply/index.ts` | PASS | Command exited 0. |
| Deno tests | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/eventCoverVideo.test.ts` | PASS | 10/10 tests. |
| Diff hygiene | `git diff --check` | PASS | No whitespace errors. |
| iOS simulator Maestro smoke | `maestro --device F7ECAC25-2A98-4002-AD17-85AED17AB752 test ...` | PARTIAL | App launched; screenshot at `qa-orch-0978-runtime/screenshots/orch-0978-ios-business-launch-smoke.png`. Dev client showed no active server, so not T-11/T-12 proof. |
| Android emulator Maestro smoke | `maestro --device emulator-5554 test ...` | BLOCKED | Emulator booted and package installed, but System UI/Messages ANR dialogs made screenshots unusable for video proof. |
| Physical iPhone discovery | `xcrun xctrace list devices` | BLOCKED | No physical iPhone listed; only Mac + simulators. |
| Remote video fixture probe | Supabase read-only SQL | BLOCKED | `events` has 0 video covers; `event_cover_video_jobs` has 0 rows. |

## 13. Regression Surface

1. Shared event rendering exports: tester should verify ORCH-0964 theme exports and ORCH-0978 `EventCoverMedia` export both resolve.
2. Global backend strict-grep: tester should rerun ORCH-0863 gate because this rework changed the allowlist.
3. Compression happy path: tester should rerun the compression Jest test under normal load.
4. Native video runtime: tester must still run real T-11/T-12.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| T-11 not complete | Android-compressed Cloudinary output may still fail iOS playback | Android upload -> Cloudinary URL -> physical iPhone native + Safari iOS web evidence | Tester targeted retest |
| T-12 not complete | Android cold-load could still show first-frame black | Android cold-load screenshot/video proves poster/first frame paints | Tester targeted retest |
| Android emulator ANR | Local emulator could not provide meaningful screen evidence | Fresh emulator/dev build or tester device session | `qa-orch-0978-runtime/screenshots/` |
| Native module build | OTA alone cannot ship `expo-video` / `react-native-compressor` native changes | Full EAS build installed for QA/release | `app-mobile/package.json`, `mingla-business/package.json` |

## 15. Discoveries For Orchestrator

- No new cross-ORCH ledger entry needed. The strict-grep allowlist gap was ORCH-0978-local and fixed here.
- Remote production-like data currently has no video cover rows and no `event_cover_video_jobs` rows, so tester needs to create/run a fresh upload fixture rather than rely on existing data.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** Event-cover video function deploy remains downstream after tester PASS/close routing.
- **Mobile OTA/native:** Keep the full EAS warning: native module additions require full EAS builds; OTA alone is insufficient.
- **Business/admin web:** Business web may need deploy after close; admin unaffected.
- **Env vars/secrets:** No new secrets.

## Suggested Commit Message

```text
event-cover-video: rework video upload QA blockers

Resolves: ORCH-0978 rework P1-001 and P1-002
Evidence: service Jest, compression Jest, strict-grep, Deno check/test, runtime probe report
Deploy: full EAS build required for native module changes
```

## Ready-To-Test Checklist

1. Run `git merge-base --is-ancestor origin/main HEAD` and require exit `0`.
2. Run service Jest, compression Jest, strict-grep, Deno check, and Deno test commands from §12.
3. Create/upload an Android video cover using a fresh dev build and record job ID + Cloudinary URL.
4. Open that Cloudinary-backed event cover on a physical iPhone native app and Safari iOS web; capture playback evidence for T-11.
5. Cold-load the Android event cover screen and capture screenshot/video proving no first-frame black for T-12.

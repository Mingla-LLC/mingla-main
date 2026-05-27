# QA Retest Report: ORCH-0978 Video Upload Sub-30s Pipeline

> Date: 2026-05-27
> Mode: RETEST
> Verdict: FAIL
> Findings: P0:0 P1:1 P2:0 P3:0 P4:7

## 1. Layman Summary

ORCH-0978 is still not ready to close. The code rework fixed the stale-branch and red-test blockers: the branch is now rebased onto current `origin/main`, the video service timeout suite is green, the compression happy path is green, strict-grep is green, and Deno gates are green. Release still fails because the required real runtime proof was not provided or reproducible here: Android upload -> Cloudinary URL -> physical iPhone native playback -> Safari iOS playback, plus Android cold-load screenshot/video.

## 2. Inputs Reviewed

- Prior QA report: `Mingla_Artifacts/reports/QA_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`
- Rework report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`
- Runtime evidence folder: `Mingla_Artifacts/reports/qa-orch-0978-runtime/`
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
- Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
- Commit under retest: `f275e6244795a32740355d83af7d04353e7a1cd9`
- Anchor comms-ledger WARN acks: COMMS-0002, COMMS-0003, COMMS-0004 in pushed anchor commit `aec5ee1c6`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `event_cover_video_jobs` runtime fixture claims | Rework says remote has zero existing video covers/jobs; tester did not mutate live data to create one. |
| Edge/RPC/Webhooks | `supabase/functions/event-cover-video-*`, `_shared/eventCoverVideo.ts`, `_shared/eventCoverVideo.test.ts` | Deno check/test, Cloudinary destroy helper, T-05 adversarial preservation. |
| Services | `mingla-business/src/services/eventCoverVideoProcessingService.ts` | Timeout contract and full service Jest suite. |
| Hooks/State/Cache | `mingla-business/src/hooks/useEventCoverVideoUpload.ts` | Static trace through tested service methods; no cache key changes in rework. |
| Components/Screens | `CoverPicker.tsx`, shared `EventCoverMedia.tsx` | Picker 30s guard, poster/first-frame static guard, shared export. |
| Business/Admin/Public | Business mobile/web, app-mobile read surfaces | Static and launch-smoke evidence only; mandatory playback parity not proven. |
| Tests/Build | Jest, Deno, strict-grep, JSON parse, device discovery | Focused automated gates passed; runtime gate failed due missing proof/devices. |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| P1-001 rebase blocker fixed | `git fetch origin main --prune`; `git rev-parse HEAD origin/main`; `git merge-base --is-ancestor origin/main HEAD` | VERIFIED | `HEAD=f275e6244`, `origin/main=2886dbe1`, exit `0`. |
| Rebase/package collisions resolved | JSON parse of app/business/package tsconfig files; `packages/event-rendering/index.ts` exports `EventCoverMedia` | VERIFIED | All parsed successfully; shared export present. |
| P1-002 service timeout regression fixed without weakening timeout contract | Service code and Jest command | VERIFIED | `waitForEventCoverVideoReady` still throws `processing_timeout` with `lastStatus`; 13/13 service tests passed. |
| Compression happy path remains green | `npx jest __tests__/services/eventCoverVideoProcessingService.compression.test.ts --runInBand --no-cache` | VERIFIED | 1/1 test passed. |
| T-05 adversarial Cloudinary tests preserved | `supabase/functions/_shared/eventCoverVideo.test.ts:154-180`; Deno test | VERIFIED | Both `not found` and HTTP 503 destroy cases remain and pass. |
| Timeout contract not weakened | `mingla-business/src/services/eventCoverVideoProcessingService.ts:936-964`; service test at `src/services/__tests__/eventCoverVideoProcessingService.test.ts:423-434` | VERIFIED | Default timeout remains 120s; test still asserts typed timeout and last status. |
| Full EAS native-module warning preserved | Rework report sections 14/16; package deps in both apps | VERIFIED | `expo-video` and `react-native-compressor` are present; rework report states full EAS build is required and OTA is insufficient. |
| T-11 real evidence exists | Runtime folder, rework report, device probe | REFUTED | No Android upload, no job ID, no Cloudinary URL, no physical iPhone native playback, no Safari iOS playback evidence. |
| T-12 real evidence exists | Runtime screenshots, rework report, device probe | REFUTED | Android screenshots are launch/ANR screens, not cold-load event-cover video proof. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Branch freshness | `git merge-base --is-ancestor origin/main HEAD; echo $?` | PASS | Exit `0` after fetch. |
| Changed file scan | `git diff --name-status origin/main...HEAD` | PASS | ORCH-0978 files plus runtime/report artifacts are present. |
| Service Jest | `npx jest src/services/__tests__/eventCoverVideoProcessingService.test.ts --runInBand --no-cache` from `mingla-business/` | PASS | 13/13 tests passed, including timeout contract. |
| Compression Jest | `npx jest __tests__/services/eventCoverVideoProcessingService.compression.test.ts --runInBand --no-cache` from `mingla-business/` | PASS | 1/1 test passed. |
| Strict-grep | ORCH-0978 optimistic preview, cancel cleanup, autoplay muted, plus ORCH-0863 backend allowlist | PASS | All checks passed; ORCH-0863 C7 reports all checks PASS. |
| Deno check | `/Users/sethogieva/.deno/bin/deno check` across six event-cover-video functions | PASS | Command exited `0`. |
| Deno tests | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/eventCoverVideo.test.ts` | PASS | 10/10 tests passed; live column-shape subcheck skipped because Supabase env is missing. |
| JSON/package parse | Node JSON parse of app/business/package tsconfig files | PASS | All seven JSON files parsed. |
| Diff hygiene | `git diff --check` | PASS | Exit `0`. |
| Physical iPhone discovery | `xcrun xctrace list devices` | FAIL GATE | Only Mac plus iOS simulators listed; no physical iPhone. |
| Android device discovery | `adb devices`; `emulator -list-avds` | FAIL GATE | No connected/running Android device; AVDs exist but are not T-11/T-12 evidence. |
| Runtime artifact inspection | `qa-orch-0978-runtime/` JSON/screenshots plus image review | FAIL GATE | iOS screenshot is Expo dev-client "No development servers found"; Android screenshots are ANR/home/launch smoke, not video-cover playback. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | UNVERIFIED | Upload cancel and audio controls were not live-fired. |
| One owner per truth | PASS | Shared renderer export is centralized in `packages/event-rendering/EventCoverMedia.tsx` and `packages/event-rendering/index.ts`. |
| No silent failures | PASS STATIC | Timeout and Cloudinary destroy failure paths are typed/tested; runtime UI failure surfacing not live-fired. |
| One key per entity | PASS | No query-key rework beyond prior ORCH-0978 key owner. |
| Server state server-side | PASS | Edge functions continue to own job/apply/cancel state. |
| Logout clears everything | N/A | Auth/session persistence not changed. |
| Label temporary | PASS | No untracked temporary code marker found in scoped files. |
| Subtract before adding | PASS | Cloudinary eager chain has no `so_`/`du_` trim params; native picker owns final 30s cap. |
| No fabricated data | PASS STATIC | Upload progress and status are driven by bytes/job status in tested service paths. |
| Currency-aware | N/A | No money logic touched. |
| One auth instance | PASS | No new auth client introduced. |
| Validate at right time | PASS STATIC | Picker 30s guard and edge max-duration defenses remain. |
| Exclusion consistency | N/A | No deck/exclusion behavior touched. |
| Persisted-state startup | FAIL GATE | Android cold-load video rendering proof is missing. |

## 7. Findings

### P0 Critical

None.

### P1 High

**P1-001: Mandatory T-11/T-12 runtime gates still have no real proof.**
- **Evidence:** `Mingla_Artifacts/reports/qa-orch-0978-runtime/` contains only launch smoke command JSON and screenshots. `orch-0978-ios-business-launch-smoke.png` shows Expo dev-client with "No development servers found"; Android screenshots show ANR dialogs/home state, not event-cover video playback. Current `xcrun xctrace list devices` lists no physical iPhone; current `adb devices` lists no connected/running Android device. The rework report itself states T-11/T-12 "NEEDS TARGETED RETEST" and "T-11/T-12 still require physical iPhone + Android upload fixture."
- **What is wrong:** The hard guard required real T-11/T-12 evidence: Android upload -> Cloudinary URL -> physical iPhone native playback + Safari iOS playback, plus Android cold-load screenshot/video. That evidence does not exist in the worktree.
- **Impact:** The two highest-risk platform-specific bugs remain unproven: Android-compressed output may still fail iOS playback, and Android `expo-video` may still show the first-frame-black bug during cold load.
- **Required fix:** Produce a fresh runtime evidence packet with Android upload job ID, Cloudinary processed URL, physical iPhone native playback screenshot/video, Safari iOS playback screenshot/video, and Android cold-load screenshot/video of the actual event-cover video surface.
- **Retest:** Re-run this retest after the evidence is added under `Mingla_Artifacts/reports/qa-orch-0978-runtime/` and referenced from the rework/implementation report.

### P2 Medium

None.

### P3 Low

None.

### P4 Notes

- **P4-001:** P1-001 from prior QA is fixed: branch is now descended from current `origin/main`.
- **P4-002:** P1-002 from prior QA is fixed: the service suite passes 13/13 and retains the typed `processing_timeout` + `lastStatus` contract.
- **P4-003:** Compression happy path passes 1/1.
- **P4-004:** T-05 adversarial Cloudinary cleanup tests are preserved and pass.
- **P4-005:** ORCH-0978 strict-grep and ORCH-0863 backend allowlist gates pass.
- **P4-006:** Deno check/test gates pass for the event-cover-video edge surface.
- **P4-007:** Full EAS warning remains correct and must stay in CLOSE/release notes: native modules `expo-video` and `react-native-compressor` cannot ship through OTA alone.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| Single 30s cap at picker | STATIC PASS | `CoverPicker.tsx:420-435` uses video picker trim and rejects >30s + 250ms | Runtime picker flow not live-fired. |
| No Cloudinary trim in eager chain | PASS | `event-cover-video-upload-intent/index.ts:241-248` eager chain has crop/codec/bitrate/format/quality only | None. |
| `source_public_id` for cancel destroy | PASS | `event-cover-video-upload-intent/index.ts:269-274` persists `source_public_id` | None. |
| Cancel Cloudinary destroy best effort | PASS STATIC/AUTO | `cloudinaryDestroy` handles `not found`; cancel logs non-throwing failure; Deno T-05 passes | Live cancel not run. |
| Client timeout behavior | PASS | `waitForEventCoverVideoReady` lines 936-964; Jest 13/13 | None. |
| Shared render extraction | PASS STATIC | `packages/event-rendering/EventCoverMedia.tsx`, export in `index.ts` | Runtime playback not proven. |
| T-11 cross-platform playability | FAIL | No Android upload, Cloudinary URL, physical iPhone native, or Safari iOS evidence | P1-001. |
| T-12 first-frame-black guard | FAIL | Static poster/first-frame code exists, but no Android cold-load video proof | P1-001. |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Cloudinary destroy failure safety | P4 | Deno T-05 tests and helper implementation | PASS. |
| Cloudinary docs URL context | P4 | Inline Cloudinary docs comments remain in helper/upload code | PASS for touched external API code-read. |
| Webhook signature tests | P4 | Deno signature tests pass | PASS. |
| Secret exposure | P4 | Commands/reports inspected did not print secrets | PASS. |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Business upload progress/cancel | Not live-fired | P1 | Missing runtime proof. |
| Physical iPhone playback | Not live-fired | P1 | Missing T-11 proof. |
| Safari iOS playback | Not live-fired | P1 | Missing T-11 proof. |
| Android cold-load first frame | Not live-fired | P1 | Missing T-12 proof. |
| Audio control label | Static read | P4 | `EventCoverMedia` exposes accessibility label on the control. |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Partial | STATIC/AUTO PASS, RUNTIME FAIL | App deps and shared renderer are present; native playback not proven. |
| Business | Partial | SERVICE PASS, RUNTIME FAIL | Business service tests pass; upload flow not live-fired. |
| Admin | N/A | N/A | Admin out of scope. |
| Public/web | Partial | STATIC ONLY | Safari iOS playback proof missing. |
| Solo | N/A | N/A | No solo behavior touched. |
| Collab | N/A | N/A | No collab behavior touched. |
| iOS | No physical proof | FAIL | Physical iPhone not connected; simulator screenshot is not sufficient. |
| Android | No runtime proof | FAIL | No running Android device; existing screenshots are ANR/launch smoke only. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Native compression deps | Full EAS build required | Full EAS/dev build required | N/A | Upload receives compressed bytes | No schema change in rework | Automated tests green. |
| Cloudinary cancel cleanup | Abort/cancel UX affected | Cancel path affected | N/A | Destroy helper + cancel function | Existing job rows update | Helper tested; live cancel not run. |
| Shared render package | App-mobile reads video covers | Business/public render shares component | N/A | N/A | Existing cover media fields | Static export OK; runtime playback not proven. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| T-11 Android -> Cloudinary -> iOS native | Runtime evidence review + device probe | FAIL | Upload a real Android video, record job ID + Cloudinary URL, prove physical iPhone native playback. |
| T-11 Safari iOS | Runtime evidence review + device probe | FAIL | Open same Cloudinary-backed event in Safari iOS and capture playback evidence. |
| T-12 Android cold load | Runtime evidence review + screenshot inspection | FAIL | Cold-load actual Android event cover video and capture screenshot/video proving no blank-black frame. |
| Edge/unit gates | Deno/Jest/strict-grep | PASS | None for code gates. |

## 14. Required Actions

1. **P1-001:** Add real T-11 evidence under `Mingla_Artifacts/reports/qa-orch-0978-runtime/`: Android upload device/build, job ID, Cloudinary processed URL, physical iPhone native playback evidence, and Safari iOS playback evidence.
2. **P1-001:** Add real T-12 evidence under the same folder: Android cold-load screenshot/video of the actual event-cover video surface proving poster/first frame paints and no blank-black frame is visible.
3. **P1-001:** Keep the full EAS warning in the next handoff/close packet; the native module dependency means OTA-only release is invalid.

## 15. Conditional / Recommended Actions

1. Keep the current automated gate set in the final close packet: service Jest, compression Jest, strict-grep, Deno check, Deno test, JSON parse, and diff hygiene.
2. If physical iPhone access or an Android upload fixture is unavailable, explicitly escalate to orchestrator for data/device unblock instead of redispatching another code-only rework.

## 16. Discoveries For Orchestrator

- No new cross-ORCH discovery was found.
- COMMS-0002, COMMS-0003, and COMMS-0004 were acknowledged for `tester+codex (ORCH-0978 RETEST)` in anchor `main` commit `aec5ee1c6`.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| P1-001 branch not post-rebase | YES | `git merge-base --is-ancestor origin/main HEAD` exit `0` | No. |
| P1-002 touched service suite red | YES | Service Jest 13/13 pass; timeout test remains strict | No. |
| P1-003 T-11/T-12 not complete | NO | Runtime folder lacks required upload/playback/cold-load proof | Still blocks release. |
| P2-001 deployed source hash not proven | NOT RETESTED | Not part of rework; edge deploy remains downstream | No new finding because PASS is blocked earlier. |

Retest cycle: 2

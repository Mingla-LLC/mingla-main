# QA Report: ORCH-0978 Video Upload Sub-30s Pipeline

> Date: 2026-05-26
> Mode: TARGETED
> Verdict: FAIL
> Findings: P0:0 P1:3 P2:1 P3:0 P4:5

## 1. Layman Summary

ORCH-0978 is not ready to close. The best news is that the core compression happy path is green, the new cleanup regression I added is green, and the six deployed video edge functions are active. The release still fails because this checkout is not the post-rebase branch described in the dispatch, a touched video-service test is red, and the required physical iPhone, Android emulator, Safari iOS web, and buyer-web live-fire checks were not executable from this environment.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`
- Orchestrator review: `Mingla_Artifacts/reports/REVIEW_ORCH-0978_IMPLEMENTATION_SUB_30S_PIPELINE.md`
- PoC evidence: `Mingla_Artifacts/POC_ORCH-0978_COMPRESSION_RUNBOOK.md`
- Comms: COMMS-0002, COMMS-0003, COMMS-0004 acknowledged for ORCH-0978 in anchor commit `8d0d494ec`
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
- Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `event_cover_video_jobs` assumptions in SPEC A2 | No migration added; live schema was not re-probed in this QA turn because no DB writes were allowed or needed for the observed blockers. |
| Edge/RPC/Webhooks | `supabase/functions/event-cover-video-*`, `_shared/eventCoverVideo.ts` | Deno check/test gates, Cloudinary destroy helper, remote function active versions. |
| Services | `mingla-business/src/services/eventCoverVideoProcessingService.ts` | Compression, upload, cancel, status polling, broad service test suite. |
| Hooks/State/Cache | `mingla-business/src/hooks/useEventCoverVideoUpload.ts` | Code-read only; live upload flow not run. |
| Components/Screens | `CoverPicker.tsx`, `EventCoverMedia.tsx`, `PublicEventPage.tsx` | Code-read for optimistic preview, shared render, poster/first-frame guard. |
| Business/Admin/Public | Business upload, public event render, app-mobile dependency graph | Static/code evidence only; mandatory runtime parity not completed. |
| Tests/Build | Jest, Deno, strict-grep, git diff | Focused tests run; one touched service suite fails. |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Post-rebase code is under test | `git rev-parse HEAD origin/main`; `git merge-base --is-ancestor origin/main HEAD` returned `1`; merge-base is `3a1b26e7794fa13e25dd2d33714e9286cce1873c` | REFUTED | Current `HEAD` is `abb6b24be...`, the prior orchestrator review commit that still says rebase was mandatory. |
| Compression happy-path regression is green | `npx jest __tests__/services/eventCoverVideoProcessingService.compression.test.ts --runInBand --no-cache` | VERIFIED | PASS, 1/1 test. |
| Happy-path test fails on revert | Temp proof commit `aa68a1490790aed05d76f48da565b88e9236616b`; same Jest command fails at compile because `compressVideoLocally` and new byte plumbing are absent | VERIFIED | This satisfies Step 0.5(a). |
| Adversarial regression added for a different angle | `supabase/functions/_shared/eventCoverVideo.test.ts:154-180` | VERIFIED | Added T-05 cleanup tests for Cloudinary destroy `not found` and HTTP 503 non-throwing behavior. |
| Adversarial regression is green | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/eventCoverVideo.test.ts` | VERIFIED | PASS, 10/10 tests. |
| Edge functions are live | `supabase functions list --project-ref gqnoajqerqhnvulmnyvv -o json` | PARTIAL | All six are ACTIVE at versions listed below; Supabase CLI does not expose deployed source hashes in this command. |
| T-11 cross-platform parity | Device/runtime check requested | UNVERIFIED | No physical iPhone connected; no Android device running; no Android-recorded Cloudinary URL produced. |
| T-12 first-frame-black guard | Device/runtime check requested | UNVERIFIED | Code has `posterUri`, `onFirstFrameRender`, and `useExoShutter={false}`, but Android cold-load was not run. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Branch freshness | `git merge-base --is-ancestor origin/main HEAD; echo $?` | FAIL | Returned `1`; current branch is not descended from current `origin/main`. |
| Compression regression | `npx jest __tests__/services/eventCoverVideoProcessingService.compression.test.ts --runInBand --no-cache` | PASS | 1 suite, 1 test passed. |
| Fails-on-revert proof | Temp worktree commit `aa68a1490790aed05d76f48da565b88e9236616b`; same compression test | PASS as proof | Test failed on reverted code with missing export/signature errors. |
| Existing service suite | `npx jest src/services/__tests__/eventCoverVideoProcessingService.test.ts --runInBand --no-cache` | FAIL | 12 passed, 1 failed twice. |
| ORCH-0978 strict-grep gates | Three ORCH-0978 gates + ORCH-0863 backend allowlist gate | PASS | All four commands exited 0. |
| Edge Deno check | `deno check` across cancel, upload-intent, source-uploaded, webhook, status, apply | PASS | Command exited 0. |
| Shared helper Deno tests | `deno test --allow-env supabase/functions/_shared/eventCoverVideo.test.ts` | PASS | 10 tests passed after adding T-05 cleanup tests. |
| Edge deploy state | `supabase functions list --project-ref gqnoajqerqhnvulmnyvv` | PASS for active state | All six required functions ACTIVE. |
| Device live-fire discovery | `xcrun xctrace list devices`; `adb devices`; `emulator -list-avds`; `which maestro` | BLOCKED | Maestro exists. No physical iPhone listed. `adb devices` listed none. Android AVDs exist but no app/session/upload fixture was running. |
| Diff hygiene | `git diff --check` | PASS | No whitespace errors. |

## 6. Edge Function Live Versions

| Function | Status | Version | Updated at UTC |
|---|---|---:|---|
| `event-cover-video-cancel` | ACTIVE | 90 | 2026-05-26 04:06:36 |
| `event-cover-video-upload-intent` | ACTIVE | 92 | 2026-05-26 04:06:40 |
| `event-cover-video-source-uploaded` | ACTIVE | 80 | 2026-05-26 04:06:37 |
| `event-cover-video-webhook` | ACTIVE | 119 | 2026-05-26 04:06:41 |
| `event-cover-video-status` | ACTIVE | 92 | 2026-05-26 04:06:38 |
| `event-cover-video-apply` | ACTIVE | 90 | 2026-05-26 04:06:34 |

Local `supabase/config.toml` keeps `event-cover-video-webhook` at `verify_jwt = false`, which matches the Cloudinary webhook contract. The other event-cover-video functions are not explicitly listed in config, so they retain Supabase's auth-gated default.

## 7. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| 1. No dead taps | UNVERIFIED | Cancel and audio-control affordances were not live-fired. |
| 2. One owner per truth | PASS | Shared renderer source moved to `packages/event-rendering/EventCoverMedia.tsx`; business file is a shim. |
| 3. No silent failures | FAIL | Existing service timeout test now gets a raw `TypeError` instead of `processing_timeout`. |
| 4. One key per entity | PASS | New upload job query keys are isolated in `eventCoverVideoQueryKeys.ts`; no duplicate key owner found in static read. |
| 5. Server state server-side | PASS | Edge functions still own job status/apply/cancel state. |
| 6. Logout clears everything | N/A | No persisted auth/session state changed. |
| 7. Label temporary | PASS | No new transitional markers found beyond ORCH-specific test/report artifacts. |
| 8. Subtract before adding | PASS | Cloudinary eager trim was removed when native trim became the contract. |
| 9. No fabricated data | PASS | Progress uses bytes/status states; strict-grep ORCH-0978 gates passed. |
| 10. Currency-aware | N/A | No money display or currency logic changed. |
| 11. One auth instance | PASS | Edge auth remains through shared Supabase helpers; no second auth client introduced in app code. |
| 12. Validate at right time | PASS | Picker/service/edge enforce 30s/60s and 100MB bounds in the intended layers. |
| 13. Exclusion consistency | N/A | No exclusion/deck logic touched. |
| 14. Persisted-state startup | UNVERIFIED | Cold-start video rendering T-12 was not runtime-tested. |

## 8. Findings

### P1 High

**P1-001: The tested checkout is not the post-rebase branch requested by the handoff.**
- **Evidence:** `HEAD=abb6b24beaa7562a55c6369b44829646c5b053ff`; `origin/main=d22f0b4891dce65d2a43e066550040f4a9876333`; `git merge-base --is-ancestor origin/main HEAD` returned `1`; merge-base is `3a1b26e7794fa13e25dd2d33714e9286cce1873c`.
- **What is wrong:** The dispatch asked for post-rebase code on the rebased branch, but the local branch is still the pre-rebase implementation plus the prior review commit.
- **Impact:** Tester cannot certify production-shape render/package behavior or close readiness from this checkout.
- **Required fix:** Rebase ORCH-0978 onto current `origin/main`, resolve the event-rendering/package collisions, rerun compression + strict-grep + Deno gates, and redispatch QA.
- **Retest:** Re-run `git merge-base --is-ancestor origin/main HEAD` and require exit `0` before T-11/T-12.

**P1-002: A touched video service regression suite is red.**
- **Evidence:** `npx jest src/services/__tests__/eventCoverVideoProcessingService.test.ts --runInBand --no-cache` failed twice. Failing test: `waits with status callbacks and carries last status on timeout` at `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts:423-434`.
- **What is wrong:** The test expected `processing_timeout` with `lastStatus`, but got `TypeError: Cannot destructure property 'data' ... as it is undefined`.
- **Impact:** Timeout/error behavior for the polling service is not protected cleanly. This is a touched critical upload path and violates the regression-test gate.
- **Required fix:** Fix the implementation or test harness so timeout exits with the typed `EventCoverVideoProcessingError` contract, then rerun the full service suite.
- **Retest:** The same Jest command must pass.

**P1-003: Mandatory T-11 and T-12 live-fire gates were not completed.**
- **Evidence:** `xcrun xctrace list devices` showed no physical iPhone, `adb devices` showed no connected/running Android device, and no Android-recorded Cloudinary URL was available. Maestro is installed at `/Users/sethogieva/.maestro/bin/maestro`, but no suitable device/app state was available.
- **What is wrong:** SPEC 7 mandatory tests T-11 and T-12 remain unverified.
- **Impact:** The exact risks called out by the SPEC remain open: Android-compressed to iOS playback parity and first-frame-black protection on Android cold load.
- **Required fix:** Run T-11 on Android emu -> Cloudinary -> iOS native + Safari iOS web, and run T-12 Android cold-load with screenshot/video evidence.
- **Retest:** Include device IDs, URL/job ID, Cloudinary URL, screenshots or video captures, and Maestro commands used.

### P2 Medium

**P2-001: Live edge versions are active, but deployed source hash parity was not provable through the CLI.**
- **Evidence:** `supabase functions list` proves active versions and update times, but `functions list` does not expose source hashes.
- **What is wrong:** I can verify active deploy state, not cryptographic equivalence to this local commit.
- **Impact:** Low if orchestrator deployed from this worktree; still a release-note caveat.
- **Required fix:** Orchestrator should record deploy command output plus function versions in CLOSE, or attach downloaded source/hash evidence if available.
- **Retest:** Compare live downloaded function source or record Supabase deploy logs from the exact commit.

### P4 Notes

- **P4-001:** Compression happy path is green and fails on revert. Proof commit: `aa68a1490790aed05d76f48da565b88e9236616b`.
- **P4-002:** New adversarial cleanup tests passed: `T-05 cancel cleanup treats Cloudinary destroy not found as idempotent success` and `T-05 cancel cleanup reports Cloudinary destroy failure without throwing`.
- **P4-003:** ORCH-0978 strict-grep gates and ORCH-0863 backend allowlist gate all passed.
- **P4-004:** Deno check passed for all six touched/importing event-cover-video functions.
- **P4-005:** Native module warning remains real: JS OTA alone cannot ship `expo-video` / `react-native-compressor` native runtime changes; full EAS builds are required.

## 9. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| A1 single 30s cap and native trim | STATIC PASS | `CoverPicker`, service constants, strict-grep | Runtime trim not live-fired. |
| Remove Cloudinary trim from eager chain | PASS | Upload-intent code and Deno check | None. |
| Source public id cancel lookup | PASS | `event-cover-video-cancel/index.ts:13-35`, upload/source functions | None. |
| Cancel abort + Cloudinary destroy | PARTIAL | Service code and new Deno helper tests | Full cancel handler live-fire not run. |
| Chunked web upload >50MB | STATIC PASS | `eventCoverVideoProcessingService.ts:482-532` | Buyer-web runtime not run. |
| Poll interval 1500ms | PASS WITH REGRESSION | `eventCoverVideoProcessingService.ts:936-958` | Related timeout test fails. |
| Shared EventCoverMedia extraction | STATIC PASS | `packages/event-rendering/EventCoverMedia.tsx` | Post-rebase package state not verified. |
| T-11 cross-platform parity | FAIL | Not executed | P1-003. |
| T-12 first-frame-black guard | FAIL | Not executed | P1-003. |
| Step 0.5 fails-on-revert | PASS | Temp proof commit `aa68a149...` | None. |
| Step 0.5 adversarial regression | PASS | New T-05 Deno tests | None. |

## 10. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Auth on cancel/upload/status/apply | P4 | Code-read; config default true except webhook | Acceptable statically. |
| Webhook public gateway | P4 | `supabase/config.toml` sets `event-cover-video-webhook verify_jwt = false`; signature verification remains in helper tests | Acceptable. |
| Cloudinary destroy failures | P4 | New T-05 Deno tests | Best-effort failure remains structured and non-throwing. |
| Secret exposure | P4 | No secret values printed; Supabase function list only | PASS. |

## 11. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Upload cancel | Not live-fired | P1 | User-visible cancel path remains unverified. |
| First frame on Android | Not live-fired | P1 | T-12 unverified. |
| Public web video cover | Not live-fired | P1 | Buyer-web render unverified. |
| Audio control | Static code read | P4 | Accessibility label exists in shared component. |

## 12. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Business mobile | Partial | STATIC/AUTOMATED ONLY | Compression service tested; no device upload run. |
| Business web | Partial | STATIC ONLY | Chunked upload code read; no browser upload run. |
| Admin | N/A | N/A | Admin out of scope. |
| Public/web | Partial | STATIC ONLY | Shared renderer used in `PublicEventPage`, but no buyer-web live-fire. |
| Solo | N/A | N/A | No solo/collab behavior touched. |
| Collab | N/A | N/A | No collab behavior touched. |
| iOS | No | FAIL GATE | No physical iPhone was available. |
| Android | No | FAIL GATE | AVDs exist, but no emulator/app/upload fixture was running. |

## 13. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Compression | Full EAS build required | Service path changed | N/A | Upload intent receives compressed bytes | No schema change | Happy path green. |
| Cancel cleanup | Upload abort client-side | Cancel UI path affected | N/A | Cancel function destroy helper | Existing job row updated | Helper covered; live cancel not run. |
| Shared render | app-mobile dependency added | Business/public shared renderer | N/A | N/A | Existing cover media fields | Post-rebase state not certified. |

## 14. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Edge active versions | Supabase CLI | PASS | Orchestrator should capture deploy source/hash evidence. |
| T-11 | Physical/runtime | FAIL/UNVERIFIED | Android record -> Cloudinary URL -> iOS native + Safari iOS web. |
| T-12 | Physical/runtime | FAIL/UNVERIFIED | Android cold-load `EventCoverMedia`, prove poster/first frame paints. |
| Buyer-web render | Browser/runtime | FAIL/UNVERIFIED | Open live public event with video cover and prove first paint/playback. |

## 15. Required Actions

1. **P1-001:** Rebase ORCH-0978 onto current `origin/main`, resolve package/render collisions, and rerun local green gates before QA.
2. **P1-002:** Fix the red service timeout test without weakening the intended error contract.
3. **P1-003:** Run the mandatory T-11/T-12 device/browser live-fire with Maestro for sims and concrete evidence.

## 16. Conditional / Recommended Actions

1. **P2-001:** Record exact deployed source parity evidence at CLOSE, not only function versions.
2. Keep the EAS warning in closeout: OTA is insufficient for native module additions.

## 17. Discoveries For Orchestrator

- The current local branch contradicts the handoff's "post-rebase" premise. Do not CLOSE from this checkout state.
- Anchor comms-ledger WARN acks landed on `main` in commit `8d0d494ec`.

## 18. Retest Notes

| Previous finding / gate | Fixed? | Evidence | Regression? |
|---|---|---|---|
| Implementor happy-path test must fail on revert | YES | Proof commit `aa68a1490790aed05d76f48da565b88e9236616b` fails the compression test with missing export/signature errors | No. |
| Adversarial T-05 test required | YES | `supabase/functions/_shared/eventCoverVideo.test.ts:154-180`; Deno 10/10 PASS | No. |
| Post-rebase compression test green | NO | Compression is green, but branch is not post-rebase | P1-001. |
| T-11/T-12 runtime | NO | Devices unavailable | P1-003. |

Retest cycle: 1

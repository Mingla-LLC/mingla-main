# QA Report: ORCH-0978 IMPLEMENT-7 RETEST

> Date: 2026-05-28
> Mode: RETEST
> Verdict: FAIL
> Findings: P0:0 P1:1 P2:0 P3:1 P4:2

## 1. Layman Summary

The dedicated trimmer wiring fixed the original client-side rejection: a 36-second clip trimmed to a non-first 5.255-second segment did not show the old "Please trim to 29 seconds first." toast, and the app created a real upload job from the trimmed output. The live-fire still cannot close, because that job stayed at `source_uploaded` for the full client polling window and the UI timed out with "Your video is still processing. You can check again in a moment." The trimmer cancel path passed: cancelling the native trimmer did not create a new upload job or start a new preview/upload.

## 2. Inputs Reviewed

- Review: `Mingla_Artifacts/reports/REVIEW_ORCH-0978_IMPLEMENT_7.md`
- Changed files: `mingla-business/src/components/ui/CoverPicker.tsx`, `mingla-business/src/components/ui/coverPickerVideoTrimUpload.ts`, `mingla-business/src/hooks/useEventCoverVideoUpload.ts`
- Tests: `CoverPicker.dedicatedTrimmer.test.ts`, `CoverPicker.videoSourceCeiling.test.ts`, `useEventCoverVideoUpload.test.ts`
- Runtime target: iOS simulator `F7ECAC25-2A98-4002-AD17-85AED17AB752`, app `com.sethogieva.minglabusiness`, Metro `localhost:8090`
- Ledger context: COMMS-0002, COMMS-0003, COMMS-0004, COMMS-0008 acknowledged/factored; COMMS-0008 means ORCH-0978 remains owner of the video-cap migrations and this retest treats them as already-applied drift/source reconciliation, not new DB work.

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `event_cover_video_jobs` linked remote read-only probes | Latest job status, duration fields, job-count stability for cancel |
| Edge/RPC/Webhooks | `event-cover-video-source-uploaded`, status polling | Whether source upload advanced to `ready/applied` |
| Services | `eventCoverVideoProcessingService.ts` | Upload/status/cancel lifecycle behavior inferred from runtime + DB |
| Hooks/State/Cache | `useEventCoverVideoUpload.ts` | Trim bounds forwarded; local preview clears/does not start on cancel |
| Components/Screens | `CoverPicker.tsx` | Dedicated trimmer result/cancel flow |
| Business/Admin/Public | Mingla Business event edit cover picker | iOS sim live-fire only; admin/public not touched |
| Tests/Build | Jest + strict-grep | Regression coverage and invariant gate |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Non-first segment <=29s is accepted by client | Simulator selected `00:09.337` to `00:14.592`; no 29s toast; DB job `197687ef-438f-4a91-a537-e8777887c462` created with `source_duration_ms=5255`, `trim_end_ms=5255` | VERIFIED | Client did not reject original >29s source. |
| Upload reaches ready/applied | UI after full poll shows "Your video is still processing"; DB job stayed `source_uploaded`, `processed_url=null`, `processed_duration_ms=null` | REFUTED | Blocks CLOSE. |
| Cover renders chosen segment | Local preview showed the chosen green segment during processing, but processed/applied cover never arrived | PARTIAL | Cannot claim final cover render because job never reached terminal success. |
| Trimmer cancel starts no upload | Before cancel: event job count `4`, latest `2026-05-28 21:16:34.497903+00`; after cancel: same count/latest | VERIFIED | No new upload job after native trimmer cancel. |
| T-AMEND9-01/02 fail on revert | Temporary revert worktrees | VERIFIED | Details in section 17. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Focused Jest retest | `npx jest src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts src/components/ui/__tests__/CoverPicker.videoSourceCeiling.test.ts src/hooks/__tests__/useEventCoverVideoUpload.test.ts --runInBand` | PASS | 3 suites / 5 tests passed |
| Strict-grep invariant | `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | PASS | C1-C12 all OK |
| Step-0.5 fail-on-revert: T-AMEND9-01 | Temp worktree at `1744305a5`, `git revert -n 56f681846`, then `npx jest src/hooks/__tests__/useEventCoverVideoUpload.test.ts -t "T-AMEND9-01" --runInBand` | FAILS AS EXPECTED | TS2353: `trimEndMs` does not exist on reverted upload file type |
| Step-0.5 fail-on-revert: T-AMEND9-02 | Temp worktree at `1744305a5`, replaced only `CoverPicker.tsx` with `145275898` version, then `npx jest src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts -t "T-AMEND9-02" --runInBand` | FAILS AS EXPECTED | Test catches `[ORCH-0978-POC]` scaffold still present |
| Simulator setup | Existing Metro on `localhost:8090`; app relaunched via `mingla-business://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8090` | PASS | App loaded ORCH-0978 business bundle |
| Positive live-fire | Generated 36s red/green/blue/yellow MP4; added to Photos; selected top-left >29s clip; dragged trimmer to `00:09.337`-`00:14.592`; tapped `Use clip` + native `Proceed` | FAIL | No old trim toast, but job timed out before ready/applied |
| Cancel live-fire | Re-opened picker, selected same >29s clip, tapped `Back`, native `Proceed` cancel | PASS | Job count/latest unchanged; no upload started |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | FAIL | Positive path leaves user at "still processing" with retry, not ready/applied. |
| One owner per truth | PASS | Hook owns upload lifecycle; picker owns display/local selection. |
| No silent failures | PASS | Timeout is visible and retryable; no old invalid 29s toast. |
| One key per entity | N/A | No query-key change. |
| Server state server-side | PASS | Remote job row is source of status truth. |
| Logout clears everything | N/A | Not in scope. |
| Label temporary | PASS | No new temporary label found. |
| Subtract before adding | PASS | PoC marker removed in fixed code; fail-on-revert catches it. |
| No fabricated data | PASS | Runtime used generated test media and linked DB rows. |
| Currency-aware | N/A | Not in scope. |
| One auth instance | PASS | Existing Supabase client path only. |
| Validate at right time | PARTIAL | Client validates trimmed duration correctly; provider/webhook completion did not validate/apply. |
| Exclusion consistency | N/A | Not in scope. |
| Persisted-state startup | N/A | Not in scope. |

## 7. Findings

### P1 High

**P1-001: Sim live-fire still fails the ready/applied requirement after trimmed upload**
- **Evidence:** Runtime job `197687ef-438f-4a91-a537-e8777887c462` created at `2026-05-28 21:16:34.497903+00`; DB after timeout: `status=source_uploaded`, `source_duration_ms=5255`, `trim_end_ms=5255`, `processed_duration_ms=null`, `processed_url=null`, `failure_code=null`.
- **What is wrong:** The IMPLEMENT-7 client wiring lets the trimmed file upload, but the end-to-end job does not become `ready` or `applied` within the client polling window.
- **Impact:** Seth cannot close ORCH-0978 on the requested live-fire gate; organizers can still end in a "still processing" state instead of a rendered video cover.
- **Required fix:** Implementor/orchestrator must trace why this source upload did not receive or process the provider webhook/status transition. Start from the linked row above and Cloudinary upload public id in `provider_payload.source_upload.public_id`; verify webhook delivery, job-id extraction, processed duration, and apply behavior.
- **Retest:** Repeat this same sim flow with a >29s clip, non-first <=29s trim, and require DB `ready/applied`, non-null processed URL/duration, and cover render.

### P3 Low

**P3-001: The selected segment started slightly before green**
- **Evidence:** Trimmer screenshot selected `00:09.337` to `00:14.592` on a generated clip whose green section begins at 10s.
- **What is wrong:** The segment is non-first and sub-30s, but not purely green from the first frame.
- **Impact:** This does not affect the client acceptance proof, but a future retest should start at roughly 11s for a cleaner visual proof.
- **Required fix:** None for product code.
- **Retest:** Use a generated clip with a longer color buffer or select a cleaner `11s-16s` window.

### P4 Notes

- The old rejection did not reproduce: no "Please trim to 29 seconds first." toast appeared for the >29s source after trimming.
- The cancel path is clean at the data layer: remote job count for event `09b4ece6-eabc-4734-8ce3-3a25d90417e4` stayed `4`, latest job stayed `2026-05-28 21:16:34.497903+00`.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| Pick >29s clip | PASS | Generated 36.000s MP4 via ffmpeg and added to simulator Photos | None |
| Trim arbitrary non-first segment <=29s | PASS | Trimmer selected `00:09.337` to `00:14.592` | P3-001 only |
| No old 29s toast | PASS | Runtime did not show the toast; job row created | None |
| Reaches ready/applied | FAIL | Job stayed `source_uploaded` through timeout | P1-001 |
| Cover renders chosen segment sub-30s | PARTIAL/FAIL | Local preview showed selected segment; final cover never applied | P1-001 |
| Repeat and cancel trimmer | PASS | Native `Back` + `Proceed` cancel | None |
| Cancel starts no upload/no phantom preview | PASS | Job count/latest unchanged; no new job | None |
| Step-0.5 fails-on-revert | PASS | Both targeted tests fail on reverted code | None |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Read-only linked DB probes | N/A | `supabase db query --linked` only | PASS |
| No migration/edge deploy | N/A | Scope is JS live-fire; COMMS-0008 factored | PASS |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Native trimmer | Non-first trim possible with drag handles; native save/cancel confirmations appear | P4 | PASS |
| Cover picker timeout | User receives visible "still processing" message and retry button after timeout | P1 | Honest failure state, but core success path failed |
| Cancel trimmer | Cancel returns without starting upload | P4 | PASS |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Yes | FAIL | iOS sim positive path stuck before ready/applied |
| Business | Yes | FAIL | Mingla Business cover picker |
| Admin | No | N/A | Not in scope |
| Public/web | No | N/A | Final processed URL never produced |
| Solo | Yes | PASS/FAIL | Same business user session |
| Collab | No | N/A | Not in scope |
| iOS | Yes | FAIL | Simulator UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752` |
| Android | No | N/A | Not requested |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Dedicated trimmer JS wiring | iOS sim exercised | Cover picker exercised | N/A | Status path observed | Job row observed | Client acceptance fixed; provider completion failed |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Native build need | Existing installed sim dev build + Metro reload | PASS | CLOSE still needs native build routing if P1 is resolved |
| Migration/edge | Not deployed in this retest | PASS | None for IMPLEMENT-7 JS scope |
| Physical device | Not run | GATED | Still blocked by separate OneSignal signing fix per dispatch |

## 14. Required Actions

1. **P1-001:** Rework or operationally unblock the provider/webhook/status transition for job `197687ef-438f-4a91-a537-e8777887c462`. Do not close ORCH-0978 until the same sim live-fire reaches `ready/applied` and renders the processed chosen segment.

## 15. Conditional / Recommended Actions

1. For the next retest, use a generated clip with a clean color buffer and select roughly `11s-16s` so the final rendered segment has an unambiguous first frame.

## 16. Discoveries For Orchestrator

- The failure is downstream of the IMPLEMENT-7 client rejection fix: DB proves source upload acknowledged a 5.255s trimmed MP4, but provider completion did not update the job to terminal success.
- No new COMMS entry written: this affects the same ORCH-0978 close path, not another in-flight ORCH.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| P2-01 fails-on-revert undocumented | Yes | T-AMEND9-01 and T-AMEND9-02 fail on reverted temporary worktrees | T-AMEND9-01 + T-AMEND9-02 documented |
| Positive sim live-fire missing | No | Runtime job stayed `source_uploaded`; UI timed out | Needs rework/retest |
| Trimmer cancel behavior | Yes | No new job count/latest after cancel | Covered by T-AMEND9-02 + live-fire data probe |

Retest cycle: 1

## 18. Evidence Artifacts

- `Mingla_Artifacts/reports/qa-orch-0978-runtime/implement-7-retest-2026-05-28/trimmer-non-first-green-selection.png`
- `Mingla_Artifacts/reports/qa-orch-0978-runtime/implement-7-retest-2026-05-28/upload-timeout-still-processing.png`
- `Mingla_Artifacts/reports/qa-orch-0978-runtime/implement-7-retest-2026-05-28/trimmer-cancel-no-new-job.png`

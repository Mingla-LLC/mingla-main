# Implementation Rework 2 Report: Video Upload Sub-30s Pipeline (ORCH-0978)

> Date: 2026-05-27
> Mode: Rework from FAIL retest
> Source: `Mingla_Artifacts/reports/QA_RETEST_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
> Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
> Commit at entry: `ba952b510566712a70490bde40a004f7a32ab249`
> Status: blocked before implementation

## 1. Layman Summary

The retest blocker cannot be cleared from the current machine state. The only required rework is a real runtime evidence packet proving Android upload, Cloudinary URL, physical iPhone native playback, Safari iOS playback, and Android cold-load video rendering; this machine currently has no connected Android device and no physical iPhone.

No code was changed. The green code/test gates, strict timeout contract, T-05 adversarial Cloudinary tests, and full EAS native-module warning were preserved.

## 2. Request And Context

- **Request:** Rework ORCH-0978 from `QA_RETEST_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`.
- **Required output:** A real runtime evidence packet under `Mingla_Artifacts/reports/qa-orch-0978-runtime/`, then this report at `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_2_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`.
- **Hard guards:** Do not weaken the timeout contract; do not remove or soften `supabase/functions/_shared/eventCoverVideo.test.ts` T-05 adversarial tests; keep the full EAS native-module warning.
- **Relevant comms ledger:** COMMS-0002, COMMS-0003, and COMMS-0004 were read and factored. They were already acknowledged for ORCH-0978 rework in the anchor ledger.

## 3. Scope

- **In scope:** Determine whether Codex can produce the missing T-11/T-12 runtime packet now; preserve existing green code contracts; write durable rework-2 evidence.
- **Out of scope:** Fabricating device evidence; replacing physical iPhone proof with simulator proof; mutating production data without a live device flow; changing code that is already green.
- **Decision:** Stop before implementation rather than create misleading evidence.

## 4. Inputs Reviewed

| File / command | Why | Result |
|---|---|---|
| `QA_RETEST_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | Rework contract | Retest fails only because T-11/T-12 real runtime proof is missing. |
| `IMPLEMENTATION_REWORK_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | Prior rework state | Prior report already said physical iPhone and video fixture were unavailable. |
| `SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | T-11/T-12 contract | T-11 requires Android upload -> iOS native + Safari iOS playback; T-12 requires Android cold-load video proof. |
| `xcrun xctrace list devices` | Physical iPhone discovery | No physical iPhone listed; only Mac plus simulators. |
| `adb devices -l` | Android target discovery | No connected or running Android device listed. |
| Existing `qa-orch-0978-runtime/` folder | Evidence reuse check | Existing screenshots are launch/ANR/dev-client smoke only, not accepted video-cover evidence. |

## 5. Runtime Evidence Packet Status

New evidence manifest:

- `Mingla_Artifacts/reports/qa-orch-0978-runtime/2026-05-27_rework2_device_probe/DEVICE_PROBE_ORCH-0978_REWORK_2.md`

This packet is a blocker packet, not a PASS packet. It proves why the requested real runtime packet cannot be produced from the current machine state.

| Required evidence | Status | Evidence |
|---|---|---|
| Android upload | BLOCKED | `adb devices -l` returned no attached devices. AVDs exist but no Android upload proof was created. |
| Cloudinary processed URL / job id | BLOCKED | No Android upload could run, so no new job id or Cloudinary URL exists. |
| Physical iPhone native playback | BLOCKED | `xcrun xctrace list devices` returned no physical iPhone. |
| Safari iOS playback | BLOCKED | No physical iPhone means no Safari iOS playback proof can be captured. |
| Android cold-load actual event-cover video surface | BLOCKED | No connected/running Android target and no video fixture. Existing Android screenshots are not actual event-cover video surfaces. |

## 6. Code Contract Preservation

No source files were modified in this rework-2 pass.

| Guard | Status | Evidence |
|---|---|---|
| Timeout contract not weakened | PRESERVED | `waitForEventCoverVideoReady` still defaults to `timeoutMs: 120_000` and throws `processing_timeout` with `lastStatus`. |
| T-05 adversarial tests not removed or softened | PRESERVED | `eventCoverVideo.test.ts` still has separate T-05 cases for Cloudinary `not found` idempotent success and HTTP 503 structured failure. |
| Full EAS native-module warning retained | PRESERVED | Existing implementation reports continue to state that `expo-video` / `react-native-compressor` require full EAS builds and OTA alone is insufficient. |
| Green code/test gates not disturbed | PRESERVED | No code/test file changed in this pass. |

## 7. Verification Performed

| Check | Command / method | Result |
|---|---|---|
| Worktree branch | `git branch --show-current` | `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle` |
| Entry commit | `git rev-parse HEAD` | `ba952b510566712a70490bde40a004f7a32ab249` |
| Upstream commit | `git rev-parse @{u}` | `ba952b510566712a70490bde40a004f7a32ab249` |
| Android device discovery | `adb devices -l` | No attached devices. |
| Android AVD discovery | `emulator -list-avds` | `META_ORCH_0972_Pixel_7_API35`, `Pixel_8_Pro` |
| Physical iPhone discovery | `xcrun xctrace list devices` | No physical iPhone; simulators only. |
| Diff hygiene before report write | `git diff --name-status HEAD && git diff --check` | No code diff; whitespace check exited clean. |

## 8. Why This Does Not Route To Tester Yet

Routing this report directly to tester as a PASS-style retest input would waste a retest cycle because the required T-11/T-12 evidence still does not exist. The honest next step is a device/data unblock: attach a real Android upload target and a physical iPhone with a full EAS/dev build capable of exercising the native modules, then create the evidence packet.

## 9. Exact Unblock Checklist

1. Attach or boot a valid Android target capable of running the Mingla Business dev/EAS build.
2. Attach a physical iPhone visible to `xcrun xctrace list devices`.
3. Install a full EAS/dev build that includes `expo-video` and `react-native-compressor`; OTA alone is insufficient.
4. In Mingla Business, upload a 15s 1080p clip from Android and record the event id, job id, and Cloudinary processed URL.
5. Open the same Cloudinary-backed event on physical iPhone native app and capture playback screenshot/video.
6. Open the same event in Safari iOS and capture playback screenshot/video.
7. Cold-load the Android actual event-cover video surface and capture screenshot/video proving no blank-black frame is visible.
8. Save all proof under `Mingla_Artifacts/reports/qa-orch-0978-runtime/` and rerun tester retest.

## 10. Deploy Notes

- **Migrations:** None.
- **Code changes in this pass:** None.
- **Edge deploy:** Not performed.
- **Native deploy:** Full EAS build remains required for release/runtime QA because native modules changed. OTA-only release is invalid for ORCH-0978.

## 11. Handoff Recommendation

Do not close ORCH-0978 from this report. After the device/data unblock produces the real packet, route back to Codex `tester-mingla` for retest against `QA_RETEST_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`, this report, and the new runtime evidence folder.

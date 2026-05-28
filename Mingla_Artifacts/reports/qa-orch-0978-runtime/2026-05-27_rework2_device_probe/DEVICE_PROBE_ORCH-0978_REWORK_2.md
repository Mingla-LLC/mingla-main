# ORCH-0978 Rework 2 Device Probe

> Date: 2026-05-27
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
> Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
> Commit: `ba952b510566712a70490bde40a004f7a32ab249`
> Result: BLOCKED - required physical-device evidence cannot be produced from this machine state

## Required Runtime Evidence

The QA retest required a real packet proving:

1. Android upload.
2. Cloudinary processed URL / job trace.
3. Physical iPhone native playback.
4. Safari iOS playback.
5. Android cold-load screenshot or video of the actual event-cover video surface.

## Device Discovery

### `adb devices -l`

```text
List of devices attached
```

No connected or running Android device was available. Android AVDs are installed, but the required packet needs an upload/runtime proof, and prior emulator evidence in this folder was already rejected as launch/ANR smoke rather than event-cover video proof.

### `emulator -list-avds`

```text
META_ORCH_0972_Pixel_7_API35
Pixel_8_Pro
```

### `xcrun xctrace list devices`

```text
== Devices ==
Seth's MacBook Air (F2D63519-3001-5635-A100-13D7D297CE4F)

== Simulators ==
Mingla Stripe Payload RAK Retest ORCH-0764A (26.4.1) (CAE0499F-BB4F-4832-82AC-6B45C369084F)
Mingla Stripe Retest ORCH-0764A (26.4.1) (5D6FFB79-E1AE-40E2-82B8-66E1D87CA330)
ORCH-0974 iPhone SE 3rd gen (26.4.1) (E07985BA-338B-4632-AA7C-1FF0776F8BEA)
iPad (A16) (26.4.1) (F9BA54B7-8D52-4DBD-B5C5-4DBFFFBB9B7A)
iPad Air 11-inch (M4) (26.4.1) (80C00246-3205-4A46-927E-AEF2D2659C1C)
iPad Air 13-inch (M4) (26.4.1) (92906FAA-477B-499C-9496-F328475A8B2C)
iPad Pro 11-inch (M5) (26.4.1) (97F45581-C595-4224-A38C-8AE167A320DA)
iPad Pro 13-inch (M5) (26.4.1) (0A7AE0C3-A7FF-40B2-A2AA-4C9A2768C100)
iPad mini (A17 Pro) (26.4.1) (E46B2572-6CC8-42BD-8D6B-DA0A9DE3EAD3)
iPhone 17 (26.4.1) (F7ECAC25-2A98-4002-AD17-85AED17AB752)
iPhone 17 Pro (26.4.1) (17091E60-C3B6-4167-980D-60C348E177F6)
iPhone 17 Pro Max (26.4.1) (2C3312D9-EE52-4EBD-9704-15811D49A2EC)
iPhone 17e (26.4.1) (37F202F2-ABB5-4AA8-860D-1AADB70A7AEF)
iPhone Air (26.4.1) (9489186C-D79A-4ABB-A181-4E29122226DD)
```

No physical iPhone was attached. Simulator playback cannot satisfy the physical iPhone native playback or Safari iOS playback gate from the retest report.

## Code Contract Guard Check

No source code was changed in this rework-2 pass. The previously green code/test contracts were left intact:

- The timeout contract in `mingla-business/src/services/eventCoverVideoProcessingService.ts` still defaults to `timeoutMs: 120_000` and throws typed `processing_timeout` with `lastStatus`.
- The T-05 adversarial Cloudinary destroy tests remain present in `supabase/functions/_shared/eventCoverVideo.test.ts`.
- The implementation and rework reports still carry the full EAS native-module warning for `expo-video` and `react-native-compressor`.

## Conclusion

This probe does not satisfy T-11 or T-12. The next valid action is to attach a real Android upload target and a physical iPhone, then rerun the upload/playback/cold-load flow and store the resulting URL, job id, screenshots, and video evidence in this runtime folder.

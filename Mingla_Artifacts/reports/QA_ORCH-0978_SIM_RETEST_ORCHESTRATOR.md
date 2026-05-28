# QA ORCH-0978 Sim Retest (Orchestrator-driven, unblock + drive)

Verdict: **PARTIAL — webhook v121 fix proven live, but NEW failure surface uncovered (`processed_duration_invalid`) for a 12-second source video. Sim T-1 does NOT pass. Physical iPhone gate not met. Do NOT close ORCH-0978 from this report.**

Date: 2026-05-27
Driver: Claude `mingla-orchestrator` (per Seth's directive after tester BLOCKED report)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle` @ `4d2896d3293fcc2767a4729d94f462cd709efa10`
Sim: iPhone 17 (UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752`)
Bundle: dev-client at `http://localhost:8090` (Metro freshly started from per-ORCH worktree)

## Executive Finding

I cleared the tester's BLOCK (Metro bundle hang) and drove T-1 success path via Maestro all the way to "Choose" on the rainbow 0:12 video. **The webhook v121 fix is provably working**: job_id was extracted from `public_id`, the prior stuck job `dde19eac-...` was superseded by the new upload, and the new job moved to a definitive `failed` state instead of stuck `source_uploaded`.

**But T-1 still does not reach `status=ready`.** The new failure mode is at `assertProcessedDerivative` in `_shared/eventCoverVideo.ts:397-401`, which returned `processed_duration_invalid` ("Processed video was over the duration limit.") for a 12-second source. The source duration was 12000ms, well under the 30000ms cap. The likely root cause is either (a) Cloudinary's eager_async callback returned a `duration` field as NaN / null / wrong shape, or (b) the eager output is genuinely > 30s because the eager transformation chain (`c_limit,w_1280,h_720,vc_h264,ac_aac,br_<X>,f_mp4,q_auto:good`) has no trim component and Cloudinary's first eager output reported metadata before transformation completed. Either way, this is a NEW root cause — not the same as the webhook 400.

This is the layer-stacked-bug pattern: the IMPLEMENT-3 fix unblocked the webhook path, which then unmasked a downstream check that was never exercised before because no eager callback ever reached it.

## What I Did to Unblock

1. **Metro restart**: Killed stale workers, ran `RCT_METRO_PORT=8090 npx expo start --port 8090 --dev-client --clear` from `mingla-business/`.
2. **Diagnosed the "deadlock"**: Bundle wasn't deadlocked, just slow — cold cache build of 5114 modules took **4 minutes 45 seconds**. The tester gave up after ~2 minutes. Subsequent incremental rebuilds took 8 seconds.
3. **Deep-linked the sim into dev-client**: `xcrun simctl openurl <UDID> "mingla-business://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8090"`.
4. **Waited for sim's bundle request to complete**; app launched cleanly with bundle build completing in <90s after deep-link.

Evidence:
- Metro log: `Mingla_Artifacts/reports/qa-orch-0978-runtime/orch-retest-sim-2026-05-27/` (screenshots `01-after-deeplink.png` → `02-app-loaded.png`)
- Bundle URL `http://localhost:8090/index.bundle?platform=ios&dev=true&minify=false` returned HTTP 200, 29.5MB in 8.87s on incremental fetch.

## Test Results Matrix

| Test | Result | Evidence |
| --- | --- | --- |
| T-0: Metro + dev-client load | **PASS (unblock)** | App loaded on sim showing `Leggo This` brand Home tab with 4 active events. Screenshot `02-app-loaded.png`. |
| Maestro navigation chain | **PASS** | Hub tab → Vibes and Stuff event → kebab menu → Edit details → scroll to Cover → expand → Upload video → rainbow 0:12 → Choose. All steps completed via Maestro a11y selectors (where available) and logical-coordinate taps. Maestro percentages map to 402×874 device logical points, NOT display image pixels. Screenshots `03-...` through `22-rainbow-correct.png`. |
| Live 29s cap in client | **PASS** | Cover-section helper text reads "Use your phone's trim screen to keep video covers to **29 seconds**" — confirms IMPLEMENT-2 cap text shipped. Screenshot `18-cover-expanded2.png`. |
| Webhook v121 fix (job_id extraction) | **PASS — proven live** | New job `99179520-3566-4202-bf7c-f8711257ce0c` did NOT get stuck at `source_uploaded`. It received a callback that the v120 webhook would have rejected as `job_id_missing` 400; instead it transitioned to a definitive `failed` state. Edge log confirms webhook v121 returned HTTP 200 in 390ms at 19:42:19 UTC. |
| Supersession of prior stuck job | **PASS — proven live** | Job `dde19eac-...` (the tester's prior FAIL row) is now `status='cancelled'`, `failure_code='superseded'`, `failure_message='Superseded by a newer cover video upload.'`. The cancel/supersede path works end-to-end. |
| T-1: success path (12s source reaches `status=ready` with `processed_url`) | **FAIL** | New job ended `status='failed'`, `failure_code='processed_duration_invalid'`, `failure_message='Processed video was over the duration limit.'`, `processed_url=null`, `processed_duration_ms=null`, `source_duration_ms=12000`, `trim_end_ms=12000`. User-visible UI: "Processed video was over the duration limit." + "Upload failed - try again." Screenshot `23-after-choose.png`. |
| T-2 trim-cap boundary | **BLOCKED** | Gate: T-1 must pass first. |
| T-3 rollback path | **BLOCKED** | Gate: T-1 must pass first. |
| T-4 Save gate non-regression | **NOT RERUN** | Code-level non-regression already confirmed in prior phases. |
| T-5 live edge 29251 validation | **NOT RERUN** | Already PASS on v95 in prior tester report; no upload-intent code changed in IMPLEMENT-3. |
| Physical iPhone T-1/T-2/T-3 | **NOT REQUESTED** | Gate: sim T-1 must pass first per `feedback_tester_3sims_plus_operator_physical.md`. |

## Live-Fire Trace

| Time (UTC 2026-05-27) | Event | Status |
| --- | --- | --- |
| 19:42:11 | `event-cover-video-upload-intent` v95 POST | 200 — job `99179520-...` created |
| 19:42:13 | `event-cover-video-source-uploaded` v82 POST | 200 |
| 19:42:14 | `event-cover-video-status` v94 polling begins | 200 (×4) |
| 19:42:19 | `event-cover-video-webhook` **v121** POST | **200** (390ms) — eager callback received, processed-derivative assertion REJECTED, job written `failed`/`processed_duration_invalid` |
| 19:42:19+ | Client sees "Upload failed - try again" UI | — |

## Backend Evidence

```text
new job:
  id=99179520-3566-4202-bf7c-f8711257ce0c
  status=failed
  source_public_id=event-covers/raw/22a18413-bfbf-4087-9ba7-45f70deba0f3/09b4ece6-eabc-4734-8ce3-3a25d90417e4/99179520-3566-4202-bf7c-f8711257ce0c
  source_duration_ms=12000
  trim_start_ms=0
  trim_end_ms=12000
  processed_url=null
  processed_duration_ms=null
  failure_code=processed_duration_invalid
  failure_message=Processed video was over the duration limit.
  created_at=2026-05-27 19:42:11.565+00
  updated_at=2026-05-27 19:42:19.151+00
  completed_at=2026-05-27 19:42:19.083+00

prior stuck job (now resolved):
  id=dde19eac-9810-4e0d-b8f6-63fe235fc5af
  status=cancelled
  failure_code=superseded
  failure_message=Superseded by a newer cover video upload.
```

## What This Proves About IMPLEMENT-3

- **The webhook public_id fallback fix works in production.** The v121 webhook accepted a real Cloudinary eager_async callback, extracted `job_id` from the `public_id` last segment, looked up the job, ran the processed-derivative checks, and wrote a definitive job state. None of this was reachable on v120.
- **The `stage: "job_id_extraction_failed"` diagnostic was NOT triggered** because the job_id WAS recovered. Good.
- **Job lifecycle is no longer stuck.** Jobs reach a terminal state (`failed` or `ready`); supersession works.

## What This Did NOT Prove

- The full happy path (12s rainbow → processed mp4 → `status=ready`) does not complete.
- The downstream check `assertProcessedDerivative` rejects the eager output for a reason that needs forensics: is it (a) the eager output really has duration > 30000ms, (b) the duration field is missing/NaN/zero, or (c) the duration shape from Cloudinary is something other than seconds-as-number?

## Hypothesis for the New Failure

The eager transformation configured in `event-cover-video-upload-intent/index.ts:267-274` is `c_limit,w_1280,h_720,vc_h264,ac_aac,br_<X>,f_mp4,q_auto:good` — **no trim component**. iOS `UIImagePickerController` with `allowsEditing:true` produces a pre-trimmed source file, so a 12-second source should yield a 12-second eager output. The most likely root causes:

1. **Cloudinary's first eager_async callback fires before transformation completes** and includes the SOURCE metadata (which might be the un-trimmed iOS recording, or might have duration in milliseconds rather than seconds).
2. **`duration` field shape mismatch**: webhook reads `eager.duration ?? eager.duration_ms ?? payload.duration ?? payload.duration_ms` and applies `< 1000 ? *1000 : raw`. If Cloudinary returns the duration as an object, string, or in microseconds, this heuristic produces a NaN or out-of-bounds value that fails `assertProcessedDerivative`.
3. **The eager output is genuinely > 30s** — would mean Cloudinary is transcoding a longer source than what the iOS picker showed (e.g., iOS uploaded the original asset, not the edited one).

The forensics phase needs to log the raw Cloudinary callback payload and the exact `durationMs` value at the webhook to choose between these.

## Discoveries for Orchestrator

1. **NEW root cause class: `processed_duration_invalid` for in-spec source duration.** Should be a fresh forensics phase (likely ORCH-0978 SPEC AMENDMENT 6 or a follow-up ORCH).
2. **Diagnostic instrumentation needed**: webhook v121 should log the raw `eager.duration`, computed `durationMs`, and `MAX_DURATION_MS` before calling `assertProcessedDerivative` so root cause is provable from logs.
3. **Maestro coordinate gotcha**: `tapOn: { point: "X%,Y%" }` uses logical device coordinates (402×874 for iPhone 17), NOT display-image pixels. Update tester runbook / sim-test memory rule. The tester's prior taps at "17%,16%" missed the picker grid for this reason.
4. **Bundle cold-cache time**: First Metro build for mingla-business (5114 modules) takes ~4:45 with `--clear`. Tester should wait for the `Bundled <ms>ms index.js (NNNN modules)` log line, not give up at ~2 minutes.

## Constitutional Check

| Rule | Result |
| --- | --- |
| No SPEC modifications | PASS |
| No edge function redeploy in this pass | PASS |
| No `supabase db push` | PASS |
| No client product-code modifications | PASS |
| Maestro default sim driver | PASS |
| No `osascript` | PASS |
| No CoreDevice / xctrace physical control | PASS |
| Live-fire evidence-backed verdict | PASS (PARTIAL) |
| Physical iPhone gate respected | PASS (sim T-1 not yet passing → did NOT request physical) |

## Verdict

**PARTIAL.** IMPLEMENT-3's webhook fix is provably live and shipping correct behavior at the layer it owns. T-1 happy path is still blocked by a NEW downstream failure (`processed_duration_invalid`) that was previously unreachable because the webhook always returned 400 before. Do NOT CLOSE ORCH-0978 from this report.

## Required Next Step

Route to forensics (Claude `mingla-forensics` or Codex `forensic-mingla`) to investigate the `processed_duration_invalid` root cause:

1. Add diagnostic logging to webhook v122 that captures the raw Cloudinary callback `payload`, the extracted `eager.duration`, the computed `durationMs`, and `MAX_DURATION_MS` before the `assertProcessedDerivative` call.
2. Re-deploy and re-run a single rainbow 0:12 upload.
3. Decide fix based on actual payload shape:
   - If `duration` field is missing/NaN → patch webhook duration extraction to fall back to job's `trim_end_ms - trim_start_ms`.
   - If duration is genuinely > 30000ms → the eager transformation needs a `du_<seconds>` or `eo_<seconds>` clause to cap the processed output duration.
4. Only after fix lands AND tester live-fire T-1 PASSes on sim → pause for Seth's physical iPhone T-1/T-2/T-3.

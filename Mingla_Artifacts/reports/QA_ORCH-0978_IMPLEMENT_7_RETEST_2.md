# QA RETEST #2 — ORCH-0978 IMPLEMENT-7 [dedicated-trimmer full wiring] — sim live-fire

**Tester:** Claude `mingla-tester`
**Date:** 2026-05-28
**Mode:** RETEST (after IMPLEMENT-7 rework + backend edge-function redeploy)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Under test:** product commit `56f681846` (full trimmer wiring) + `1744305a5` (regression gates), JS picked up via Metro reload (no rebuild)
**Sim:** iPhone 17, iOS 26.4, UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752`, Metro `localhost:8090`
**Driver:** Maestro (`~/.maestro/bin/maestro --device F7ECAC25…`)

## VERDICT: PASS

Proven-level live-fire. The trimmed video cover uploads, processes through the **fixed** backend, reaches a valid processed video, and renders the **chosen non-first segment** on the live event. Zero P0/P1.

## Backend pre-check (independent)

Edge functions confirmed canonical (entrypointed from this ORCH-0978 worktree):
- `event-cover-video-webhook` **v125** (`verify_jwt:false` preserved)
- `event-cover-video-upload-intent` **v100**
- `event-cover-video-source-uploaded` **v86**, `…-status` **v98**, `…-apply` **v96**, `…-cancel` **v96**

DB constraints at 30000ms (per COMMS-0008 — migrations `20260730000000/1` already on remote).

## Test method

1. Generated a deterministic 35.0s / 1280×720 / h264 test clip with 7 distinct 5s color bands (0-5 red, 5-10 orange, 10-15 yellow, 15-20 green, 20-25 blue, 25-30 purple, 30-35 white) via ffmpeg; injected into the sim photo library with `xcrun simctl addmedia`. The color bands make the rendered segment unambiguously identifiable.
2. Drove via Maestro: Home → open "Vibes and Stuff" (event `09b4ece6-…`, the canonical video-cover test event) → Manage event → Edit details → Cover section → "Upload video" → picked the 35s clip.
3. Dedicated `react-native-video-trim` editor opened with default window **00:00.000 → 00:29.000** (the 29-30s+ tail dimmed/excluded → confirms the ~29s max window enforced by the trimmer, not the picker).
4. Dragged the left handle to select a **non-first** segment: **00:10.285 → 00:29.000** (preview frame = yellow). "Use clip" → "Proceed".
5. Upload kicked off (editor showed "Uploading…" + yellow preview). Filled the live-event required "Why are you making this change?" reason (min-10-char gate) → "Save changes".

## Evidence — job `05c52deb-96aa-41ef-8aa9-6951cb82f1b6`

| Field | Value | Proves |
|---|---|---|
| `status` | `ready` | webhook v125 advanced the job (no 400 stranding) |
| `source_duration_ms` | **18715** | the **trimmed** clip uploaded (29.000 − 10.285 = 18.715s), NOT the 35s original — closes the PoC "original-duration upload" bug |
| `processed_duration_ms` | 18715 | under the 30000 cap |
| `trim_start_ms` / `trim_end_ms` | 0 / 18715 | Architecture B: trimmed file IS the upload (offset baked into pixels) |
| created → updated | 22:30:47 → 22:30:53 | **~6s** end-to-end (source_uploaded → ready); the v124 400-on-every-callback bug would have stranded it like the predecessor job `197687ef` |
| event `cover_media_type` | `gif → video` | persisted |
| event `cover_media_provider` | `giphy → upload` | persisted |
| event `cover_media_url` | `…/video/upload/c_limit,w_1280,h_720,**du_19**,vc_h264,ac_aac,…` | integer `du_19` (ceil 18.715) + **no `so_`** → canonical AMENDMENT-8 Architecture-B eager from upload-intent v100 |
| `processed_url == event cover_media_url` | **true** | event cover IS the processed trimmed video |

## Render proof (chosen non-first segment)

After Save, the event-screen cover autoplays the color-band video. Captured frames cycle **yellow → green → (blue) → loops back to yellow** and **never show red/orange** (the trimmed-out 0–10s head). The loop start frame is yellow = the chosen 10.285s start. Screenshots: `/tmp/orch0978_qa/16,23,24,25_*.png`. No "trim to 29 seconds" rejection toast at any point.

## Observations (not defects)

- **OBS-1 — review-sheet "Save changes" disabled until reason entered.** On first Save, the live-event "Review changes" sheet showed `Save changes` as `enabled:false`. Root cause is the generic EditPublishedScreen audit gate: required field "Why are you making this change? *" (min 10 chars). NOT an ORCH-0978 defect and NOT video-specific; entering a reason enabled the button and the save completed. Worth knowing for any future automated edit of a live event.
- **OBS-2 — job row stays `ready`, not `applied`.** The event cover_media_* fields persisted correctly and match the processed URL (functional success), but the job row did not transition `ready → applied`. In Architecture B the user-facing outcome is the event-save writing `cover_media_url`; the `applied` status is bookkeeping. Flag to orchestrator to confirm whether `event-cover-video-apply` is meant to flip the job row on this path, or whether `ready` + event-cover-match is the intended terminal state.

## Regression-test gate (for CLOSE)

This live-fire is the behavioral proof (REVIEW condition 1 — satisfied). Still owed before CLOSE, per the REVIEW + rework report:
- **Implementor:** document fails-on-revert for T-AMEND9-01 + T-AMEND9-02 (REVIEW P2-01 / Step-0.5 gate).
- **Backend (cross-ORCH discovery, from `IMPLEMENTATION_REWORK_ORCH-0978_IMPLEMENT_7.md`):** a Deno webhook regression that feeds a Cloudinary eager-notification payload whose `public_id` matches the deployed upload-intent template and asserts the webhook returns 200 (not 400). This is the test that would have caught the stranding incident. Out of IMPLEMENT-7 JS scope; lands with whoever owns the canonical edge-function pair.

## Discoveries for orchestrator

- **DISC-1 — live event left with a test cover.** "Vibes and Stuff" (`09b4ece6-…`, $2,860 / 44 sold) public cover is now the QA color-band video. Reversible. Needs a decision: revert to the prior GIPHY cover (`media4.giphy.com/media/kko226um1ebR0okwHc/giphy.gif`, alt "Happy Dance GIF by LWZ") or set a real cover. Tester did not mutate it back (live event, operator decision).
- **DISC-2 — predecessor job `197687ef` remains stranded at `source_uploaded`.** It predates the backend fix; Cloudinary stopped retrying, so it will not self-recover. Cosmetic only; can be swept to `failed`/`cancelled` if desired.

## Platform parity

iOS Simulator: PASS (proven, above). Android emulator + business-web: NOT run this turn — the change is JS-only and the proof is the cross-cutting upload→backend→render pipeline; recommend an Android leg before final CLOSE per parity discipline, but no Android-specific code path was touched.

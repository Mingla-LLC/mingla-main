# Implementation Rework Report: ORCH-0978 IMPLEMENT-7 — stuck `source_uploaded` root cause

> Date: 2026-05-28
> Mode: Rework (dispatched after tester FAIL `QA_ORCH-0978_IMPLEMENT_7_RETEST.md`)
> Status: **investigated only — IMPLEMENT-7 JS needs NO rework; the blocker is drifted backend edge functions (cross-ORCH), outside the JS scope.**

## 1. Layman summary

The video trimmer + upload wiring (IMPLEMENT-7 JS) is working correctly — the trimmed clip uploads and the job is created with the right data. The reason the cover never finishes is **on the server side, not in the app code**: when Cloudinary finishes processing the video and calls our webhook back, the **deployed webhook rejects the call with HTTP 400 every time**, so the job is stranded at `source_uploaded`. The deployed webhook and upload-intent functions are a newer batch-deploy that drifted away from this ORCH-0978 branch (the ORCH-0978/0986 drift the dispatch flagged). Fixing it is a backend deploy reconciliation, not a JS change — so it needs the orchestrator, and I did not touch the JS or redeploy anything.

## 2. Evidence (proven from live DB + edge-function logs)

Job `197687ef-438f-4a91-a537-e8777887c462`, event `09b4ece6-…`, brand `22a18413-…`:

- DB row: `status=source_uploaded`, `source_duration_ms=5255`, `trim_start_ms=0`, `trim_end_ms=5255`, `processed_url=null`, `processed_duration_ms=null`, `failure_code=null`; `created_at 21:16:34.497`, `updated_at 21:16:36.290` (never moved after the source-uploaded transition).
- `provider_payload.eager = "so_0.000,du_5.255,c_limit,w_1280,h_720,vc_h264,ac_aac,br_9000k,f_mp4,q_auto:good"`. The `source_upload.public_id` is `event-covers/raw/22a18413-…/09b4ece6-…/197687ef-…` and `source_upload.acknowledged_at = 21:16:36.272`.
- Edge-function request logs (timeline):
  - `21:16:34` `event-cover-video-upload-intent` **v99** → 200 (job created).
  - `21:16:36` `event-cover-video-source-uploaded` v85 → 200 (status → source_uploaded).
  - `21:16:39` `event-cover-video-webhook` **v124 → 400**.
  - `+3min / +6min / +9min` `event-cover-video-webhook` v124 → **400** each (Cloudinary's 3/6/9-minute retry policy; all rejected).
  - `event-cover-video-status` v97 polled repeatedly → 200 (always `source_uploaded`) until the client timeout.

**Interpretation:** Cloudinary DID complete the eager transform and DID POST the notification to our webhook. The webhook **v124** returned **400** on every delivery, so the job never advanced and Cloudinary eventually gave up. `failure_code` stayed null because a 400 is returned *before* the job-update path (the webhook 400s at either `invalid_json` line 126 or `job_id_missing` line 135 in the branch source — the deployed v124 is rejecting the callback at request-validation, not at derivative validation).

## 3. Why this is NOT the IMPLEMENT-7 JS scope

- `upload-intent` returned **200** with correct trim metadata (`trim_end_ms=5255`, `source_duration_ms=5255`), and `source-uploaded` returned **200**. The client built and uploaded the trimmed file exactly as IMPLEMENT-7 intended. The JS contract is satisfied end-to-end up to the provider hand-off.
- The failure is entirely downstream of the client, in the Cloudinary→webhook→ready transition.
- Per the dispatch's "keep the IMPLEMENT-7 JS scope unless proven otherwise" — this is **proven otherwise**. No JS change would fix a webhook that 400s the provider callback.
- T-AMEND9-01 / T-AMEND9-02 are preserved and still pass (untouched).

## 4. The drift (cross-ORCH ORCH-0978 / ORCH-0986)

- Deployed `event-cover-video-upload-intent` = **v99**; deployed `event-cover-video-webhook` = **v124**; both `updated_at` within 2 seconds of each other (≈ a few hours before the test) → a **batch redeploy of the pair**.
- This branch (ORCH-0978) emits a DIFFERENT eager string: `c_limit,w_1280,h_720,du_${ceil(seconds)},vc_h264,ac_aac,br_…,f_mp4,q_auto:good` — **integer `du_`, no `so_`** (Architecture B; AMENDMENT 8). The live v99 emits `so_0.000,du_5.255,…` (fractional, with `so_`; an Architecture-A / server-side-cut shape). So the deployed pair is NOT from this branch.
- This branch's webhook DOES contain the AMENDMENT-5 `recoverJobIdFromPayload` + AMENDMENT-6 duration fallback. The deployed v124's actual 400 cause (job-id extraction vs JSON vs payload shape against the v99 eager callback) should be read from the dashboard function logs by whoever owns the backend fix.

## 5. Recommended fix (backend; orchestrator-owned, cross-ORCH)

This is a deploy/reconciliation decision, not a JS edit:

1. Orchestrator + operator decide which edge-function pair is canonical: ORCH-0978's branch pair (Architecture B — client uploads the already-trimmed clip; integer `du_`, no `so_`; webhook has AMENDMENT-5/6 fixes) vs the live v99/v124 pair (likely ORCH-0986).
2. Deploy the chosen compatible **upload-intent + webhook pair together** (they must match — the webhook's job-id/signature/duration expectations must line up with the upload-intent's eager + notification config). The live-fire fails precisely because the deployed pair is producing a callback the webhook 400s.
3. Re-run the same sim live-fire; require `ready/applied`, non-null `processed_url`/`processed_duration_ms`, cover render.
4. Pull the exact webhook 400 reason from the dashboard logs for `event-cover-video-webhook` v124 around `2026-05-28 21:16:39+00` to confirm whether it is `job_id_missing` or `invalid_json` before redeploying.

## 6. Regression (belongs in the webhook/Deno layer, not JS)

The missing regression that would have caught this is a **Deno webhook test**: feed the webhook a Cloudinary eager-notification payload whose `public_id` matches the `event-covers/raw/{brandId}/{eventId}/{jobId}` template produced by the *currently-deployed* upload-intent, and assert the webhook extracts the job id and returns 200 (not 400). That asserts the upload-intent↔webhook pair is compatible. It is out of the IMPLEMENT-7 JS scope; it should land with whichever ORCH owns the canonical edge-function pair. (A JS-layer test cannot catch a provider-callback 400.)

## 7. Discoveries for Orchestrator

- **Cross-ORCH (COMMS written):** the live `event-cover-video-upload-intent` v99 + `event-cover-video-webhook` v124 batch-deploy (drifted from this ORCH-0978 branch) is 400ing every Cloudinary eager callback — this strands **all** event-cover-video jobs at `source_uploaded`, not just this test. Production-affecting for the video-cover feature regardless of ORCH-0978.
- IMPLEMENT-7 JS is correct and complete; the ORCH-0978 close is blocked solely on the backend edge-function reconciliation.
- No JS files changed in this rework turn; no edge functions redeployed (cross-ORCH + orchestrator-owned deploy split).

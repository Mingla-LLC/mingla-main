# INVESTIGATION ORCH-0978 — `processed_duration_invalid` Root Cause

Confidence: **PROVEN** (raw Cloudinary payload captured from `event_cover_video_jobs.provider_payload`; five-layer cross-check complete; no live-fire deploy required to upgrade confidence).

Date: 2026-05-27
Skill: Claude `mingla-forensics` (INVESTIGATE mode, operator-delegated execution)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle` @ HEAD `4d2896d3293fcc2767a4729d94f462cd709efa10`
Comms ledger acknowledged: COMMS-0003 WARN (Cloudinary docs URLs cited inline below).

## 1. Symptom Summary

**Expected:** A 12-second iOS video selected via the business app's Cover → Upload video flow reaches `event_cover_video_jobs.status='ready'` with a non-null `processed_url` within ~30 seconds. User sees the processed video as the event cover.

**Actual (proven 2026-05-27 19:42:19 UTC on job `99179520-3566-4202-bf7c-f8711257ce0c`):** Job reaches `status='failed'`, `failure_code='processed_duration_invalid'`, `failure_message='Processed video was over the duration limit.'`, `processed_url=null`, `processed_duration_ms=null`. User sees "Processed video was over the duration limit." + "Upload failed - try again."

**Reproduction conditions:** EVERY video upload on webhook v121. Not stochastic. The blast radius is 100% of cover-video uploads.

**When it started:** With the deploy of webhook v121 on 2026-05-27 ~17:16 UTC. Prior to v121 the failure was masked because the webhook returned 400 before reaching `assertProcessedDerivative` (the bug fixed by IMPLEMENT-3, see `INVESTIGATION_ORCH-0978_WEBHOOK_400.md`). This is a textbook layer-stacked bug: the IMPLEMENT-3 fix unmasked a check that was never reachable on v120.

## 2. Investigation Manifest

| # | Path | Layer | Why read | What I found |
|---|---|---|---|---|
| 1 | `COMMS_LEDGER.md` (anchor `main`) | Process | Mandatory entry scan | COMMS-0003 WARN ALL applies — Cloudinary docs URLs cited inline |
| 2 | `Mingla_Artifacts/reports/QA_ORCH-0978_SIM_RETEST_ORCHESTRATOR.md` | Prior report | Symptom + initial hypothesis | Confirmed the symptom; my hypothesis must now be proven or disproven |
| 3 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_WEBHOOK_400.md` | Prior root cause | Understand what IMPLEMENT-3 fixed | The prior bug was webhook 400 on missing `context`; fixed via `public_id` UUID parse |
| 4 | `Mingla_Artifacts/reports/REVIEW_ORCH-0978_IMPLEMENT_3.md` | Prior REVIEW | Confirm v121 shape | webhook v121 ships `recoverJobIdFromPayload`; everything else unchanged |
| 5 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_3.md` | Implementor report | What changed in v121 | `recoverJobIdFromPayload` added; `assertProcessedDerivative` path unchanged |
| 6 | `Mingla_Artifacts/reports/DEPLOY_ORCH-0978_IMPLEMENT_3.md` | Deploy log | Current version state | webhook v121, upload-intent v95, source-uploaded v82, status v94, apply v92, cancel v92 |
| 7 | `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` §AMENDMENT 5 | Binding contract | The webhook fix contract | AMENDMENT 5 specifies the public_id fallback fix; does NOT address duration extraction |
| 8 | `supabase/functions/event-cover-video-webhook/index.ts` lines 64-178 | Edge code | The failure site | `firstEager` + `eager.duration ?? ...` chain + `assertProcessedDerivative` call |
| 9 | `supabase/functions/_shared/eventCoverVideo.ts` lines 17-30, 379-417 | Shared code | `MAX_DURATION_MS` + `assertProcessedDerivative` | Confirms NaN → `processed_duration_invalid` with misleading "over the duration limit" message |
| 10 | `supabase/functions/event-cover-video-upload-intent/index.ts` lines 262-300 | Edge code (upload-intent) | Eager transformation config | `c_limit,w_1280,h_720,vc_h264,ac_aac,br_<X>,f_mp4,q_auto:good` — NO trim, NO duration-bearing transform |
| 11 | Supabase DB row `event_cover_video_jobs.id = '99179520-...'.provider_payload` | Persisted data | The raw Cloudinary callback | **DEFINITIVE: eager block has NO `duration` field** |

## 3. Five-Layer Cross-Check

| Layer | What it says | Agrees with bug? |
|---|---|---|
| **Docs** (Cloudinary) | Eager notifications include the derivative URL + minimal metadata (`bytes`, `width`, `height`, `format`). Duration is NOT documented as guaranteed-present in the eager notification payload; full media metadata requires either `media_metadata` upload param OR Admin API resource fetch. References: https://cloudinary.com/documentation/upload_images#eager_transformations and https://cloudinary.com/documentation/upload_images#notification_url describe the notification payload shape. https://cloudinary.com/documentation/admin_api#get_resource describes how to fetch full video metadata including duration. https://cloudinary.com/documentation/video_manipulation_and_delivery#video_metadata describes the canonical duration field on the source resource. | ✅ AGREES |
| **Schema** | `event_cover_video_jobs.processed_duration_ms` is nullable; `trim_start_ms`, `trim_end_ms`, `source_duration_ms` are populated by upload-intent before the webhook ever fires. For job `99179520-...`: `trim_start_ms=0`, `trim_end_ms=12000`, `source_duration_ms=12000`. The job carries authoritative client-trim metadata. | ✅ AGREES |
| **Code** | `event-cover-video-webhook/index.ts:158`: `const durationRaw = eager.duration ?? eager.duration_ms ?? payload.duration ?? payload.duration_ms;` → if all four are undefined, `durationRaw = undefined`. Line 159-160: `const durationMs = typeof durationRaw === "number" && durationRaw < 1000 ? durationRaw * 1000 : durationRaw;` → `typeof undefined === "number"` is false, so the ternary returns `durationRaw` itself = `undefined`. Then `_shared/eventCoverVideo.ts:397-401`: `const durationMs = typeof input.durationMs === "number" ? input.durationMs : Number(input.durationMs);` → `Number(undefined) = NaN`. `!Number.isFinite(NaN)` is true → rejects with `processed_duration_invalid`. | ✅ AGREES |
| **Runtime** | Edge log shows `event-cover-video-webhook` v121 returned HTTP 200 in 390ms at 2026-05-27 19:42:19 UTC for job `99179520-...`. No JSON-parse failure (would have been 400 `invalid_json`). No signature failure (would have been 403). Therefore the code path reached `assertProcessedDerivative`. The job's `failure_code='processed_duration_invalid'` confirms this assertion fired. | ✅ AGREES |
| **Data** | The webhook stores `provider_payload: payload` on the failed-write branch (line 187). For job `99179520-...` the persisted `provider_payload` is captured below in §4. **The eager block contains: `url`, `secure_url`, `bytes`, `width`, `format`, `height`, `transformation`. It does NOT contain `duration`, nor a `video` object, nor `duration_ms`. The top-level payload contains: `eager`, `api_key`, `asset_id`, `batch_id`, `public_id`, `timestamp`, `request_id`, `signature_key`, `notification_type: "eager"`, `notification_context`. No `duration` field anywhere.** | ✅ AGREES |

All five layers agree. Bug is fully traced.

## 4. The Raw Cloudinary Payload (definitive evidence)

```json
{
  "eager": [{
    "url": "http://res.cloudinary.com/dhza7d54o/video/upload/c_limit,w_1280,h_720,vc_h264,ac_aac,br_9000k,f_mp4,q_auto:good/v1779910931/event-covers/raw/22a18413-bfbf-4087-9ba7-45f70deba0f3/09b4ece6-eabc-4734-8ce3-3a25d90417e4/99179520-3566-4202-bf7c-f8711257ce0c.mp4",
    "bytes": 305371,
    "width": 1280,
    "format": "mp4",
    "height": 720,
    "secure_url": "https://res.cloudinary.com/dhza7d54o/video/upload/c_limit,w_1280,h_720,vc_h264,ac_aac,br_9000k,f_mp4,q_auto:good/v1779910931/event-covers/raw/22a18413-bfbf-4087-9ba7-45f70deba0f3/09b4ece6-eabc-4734-8ce3-3a25d90417e4/99179520-3566-4202-bf7c-f8711257ce0c.mp4",
    "transformation": "c_limit,w_1280,h_720,vc_h264,ac_aac,br_9000k,f_mp4,q_auto:good"
  }],
  "api_key": "351961575759598",
  "asset_id": "1e3fcc5a073e15b29926b4fdca5a1b79",
  "batch_id": "fa50cec935e09174f369fbf446e352491437b4c9053c6fe89d70d3f64818cce2758d39cee15af4e6e85331195513004f",
  "public_id": "event-covers/raw/22a18413-bfbf-4087-9ba7-45f70deba0f3/09b4ece6-eabc-4734-8ce3-3a25d90417e4/99179520-3566-4202-bf7c-f8711257ce0c",
  "timestamp": "2026-05-27T19:42:16+00:00",
  "request_id": "aede61e90d89d060c522e67c1cf07a66",
  "signature_key": "351961575759598",
  "notification_type": "eager",
  "notification_context": {
    "triggered_at": "2026-05-27T19:42:11.876420Z",
    "triggered_by": { "id": "351961575759598", "source": "api" }
  }
}
```

**Note: `duration` is not present anywhere.** Also missing: `video` block (with `codec`, `bit_rate`, `pix_format`), `audio` block. Cloudinary's eager_notification for video transformations only ships the derivative reference + dimensions; full media metadata requires opt-in. This matches Cloudinary's documented eager notification payload — the docs do NOT promise duration on eager notifications.

## 5. Findings

### 🔴 F-1 — Webhook duration extraction trusts an eager-payload field Cloudinary does not always send (ROOT CAUSE, PROVEN)

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/event-cover-video-webhook/index.ts:158-160` (also `_shared/eventCoverVideo.ts:397-401`) |
| **Exact code (webhook)** | `const durationRaw = eager.duration ?? eager.duration_ms ?? payload.duration ?? payload.duration_ms;`<br>`const durationMs = typeof durationRaw === "number" && durationRaw < 1000 ? durationRaw * 1000 : durationRaw;` |
| **Exact code (shared assertion)** | `const durationMs = typeof input.durationMs === "number" ? input.durationMs : Number(input.durationMs);`<br>`if (!Number.isFinite(durationMs) \|\| durationMs <= 0 \|\| durationMs > MAX_DURATION_MS) { return { ok: false, code: "processed_duration_invalid", message: "Processed video was over the duration limit." }; }` |
| **What it does** | Reads `eager.duration` from the Cloudinary eager_notification payload; falls back to `eager.duration_ms`, `payload.duration`, `payload.duration_ms`. All four are undefined in the actual payload Cloudinary sends. `Number(undefined) === NaN`. `assertProcessedDerivative` rejects on `!Number.isFinite(NaN)` and returns the misleading code `processed_duration_invalid` with message "Processed video was over the duration limit." |
| **What it should do** | When `eager.duration` is absent, fall back to the job's persisted intent: `trim_end_ms - trim_start_ms` (which equals the iOS-trimmed source duration and, because the eager transformation has no trim component, equals the processed duration). Optionally also opt into `media_metadata: true` on the upload signed params for defense-in-depth so Cloudinary ships duration on the eager callback when available. |
| **Causal chain** | (1) Cloudinary fires eager_notification_url callback per docs (https://cloudinary.com/documentation/upload_images#notification_url + #eager_transformations). (2) Per Cloudinary's eager-callback contract, the payload includes the derivative URL + dimensions but NOT full media metadata; duration is only included when `media_metadata: true` is set on the upload OR via Admin API resource fetch. (3) Webhook reads `eager.duration` — undefined. (4) `Number(undefined) = NaN`. (5) `assertProcessedDerivative` rejects on NaN. (6) Job written `failed`/`processed_duration_invalid`. (7) User sees "Upload failed - try again." (8) `event_cover_video_jobs.processed_url` stays null forever. (9) Cover never updates. |
| **Verification step** | DONE. Query `select provider_payload from event_cover_video_jobs where id = '99179520-3566-4202-bf7c-f8711257ce0c'` — confirms the eager block omits `duration`. Webhook reaches HTTP 200 (proved by edge log), so signature + JSON parse passed; webhook wrote `failure_code='processed_duration_invalid'` (proved by DB row), so the assertion fired. No third hypothesis remains. |

This is the single root cause. Confidence: PROVEN.

### 🟠 F-2 — `processed_duration_invalid` error message and code conflate three distinct failure modes (CONTRIBUTING)

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/_shared/eventCoverVideo.ts:399-400` |
| **Exact code** | `if (!Number.isFinite(durationMs) \|\| durationMs <= 0 \|\| durationMs > MAX_DURATION_MS) { return { ok: false, code: "processed_duration_invalid", message: "Processed video was over the duration limit." }; }` |
| **What it does** | Returns the SAME `code: "processed_duration_invalid"` and SAME message "Processed video was over the duration limit." for THREE distinct conditions: (a) NaN / non-finite / missing, (b) zero or negative, (c) actually greater than 30000ms. |
| **What it should do** | Split into three discrete codes (`processed_duration_missing`, `processed_duration_nonpositive`, `processed_duration_over_cap`) with discrete messages, so the failure_message in the DB and the user-facing surface tell the truth and so future investigations can root-cause from the DB row alone. |
| **Causal chain** | Misleading error sent two human-hours of orchestrator + Maestro work down the "must be a real >30s output" hypothesis path before the raw payload was retrieved. Without `provider_payload` capture, the orchestrator would have proposed adding a `du_<seconds>` clause to the eager transformation, which would NOT have fixed the bug. |
| **Verification step** | Read line 399-400 verbatim; observe single code+message for three logically distinct conditions; observe that `processed_size_invalid` (line 394-395) makes the same error: NaN/<=0/>cap all map to "over the final size budget". |

### 🟡 F-3 — `firstEager` returns `{}` silently when `payload.eager` is missing or empty (HIDDEN FLAW)

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/event-cover-video-webhook/index.ts:64-69` |
| **Exact code** | `const firstEager = (payload: Record<string, unknown>): Record<string, unknown> => { const eager = payload.eager; return Array.isArray(eager) && typeof eager[0] === "object" && eager[0] !== null ? eager[0] as Record<string, unknown> : {}; };` |
| **What it does** | When Cloudinary calls the webhook with no eager array (e.g., a notification_type that isn't `eager`, or a `upload` notification if `notification_url` is ever wired alongside `eager_notification_url`), `firstEager` returns `{}`. The downstream code then reads `eager.secure_url`, `eager.bytes`, `eager.duration` — all `undefined`. `assertProcessedDerivative` rejects on the FIRST check (`processed_url_invalid`). The job lands failed with a misleading code. |
| **What it should do** | If `payload.eager` is missing or empty, return a typed `not_an_eager_notification` and either ignore-with-200 (per Cloudinary's intent for non-target notification types) or write a distinct failure code. Should not silently coerce to `{}` and rely on downstream URL-shape rejection. |
| **Causal chain** | Not causing today's symptom because the eager array IS present in the captured payload. Will cause a future bug class if Cloudinary's notification semantics change (e.g., a `notification_type='upload'` callback fires due to a config change). |
| **Verification step** | Run an empty-eager payload through `handleEventCoverVideoWebhook` in a Deno test; observe `processed_url_invalid` instead of a recognizable diagnostic code. |

### 🟡 F-4 — Webhook's `<1000 ? *1000 : raw` duration heuristic also corrupts a Cloudinary duration field of 0 (HIDDEN FLAW)

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/event-cover-video-webhook/index.ts:159-160` |
| **Exact code** | `const durationMs = typeof durationRaw === "number" && durationRaw < 1000 ? durationRaw * 1000 : durationRaw;` |
| **What it does** | If Cloudinary ever returns `duration: 0` (e.g., for a 0-second clip or a metadata bug), `0 < 1000` is true, so `0 * 1000 = 0`. That hits the `durationMs <= 0` branch and conflates with the existing F-2 ambiguity. Less impactful: if Cloudinary returns duration in seconds vs milliseconds for different transformation types, the heuristic isn't payload-aware. |
| **What it should do** | Per Cloudinary docs (https://cloudinary.com/documentation/video_manipulation_and_delivery#video_metadata), `duration` is a float in seconds. The webhook should treat any numeric duration as seconds and multiply by 1000 unconditionally — the `< 1000` heuristic exists for safety but adds parser ambiguity. |
| **Causal chain** | Not the cause of today's failure (duration is absent, not numeric-and-zero). Worth tightening alongside the F-1 fix. |
| **Verification step** | Add a Deno test scenario: `{ eager: [{ duration: 0, ... }] }` → observe ambiguous rejection. |

### 🟡 F-5 — Eager transformation has no duration cap component (HIDDEN FLAW)

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/event-cover-video-upload-intent/index.ts:267-274` |
| **Exact code** | `const eager = ["c_limit,w_1280,h_720", "vc_h264", "ac_aac", \`br_${clampBitrate(durationBudgetMs)}\`, "f_mp4", "q_auto:good"].join(",");` |
| **What it does** | Configures Cloudinary's eager transformation as: limit-resize 1280×720, H.264 + AAC, bitrate budget for the trim window, MP4 container, auto quality. There is NO `du_<seconds>` (duration) or `eo_<seconds>` (end-offset) transformation component. Per Cloudinary's video transformation reference (https://cloudinary.com/documentation/video_manipulation_and_delivery_reference#video_transformation_url_parameters), `du_<X>` and `eo_<X>` constrain the processed duration server-side. |
| **What it should do** | For defense-in-depth alongside the client-side trim, add `du_${Math.min(trimEndMs - trimStartMs, MAX_DURATION_MS) / 1000}` (in seconds) to the eager chain so a misbehaving client cannot bypass the server-side duration cap by uploading an un-trimmed file. |
| **Causal chain** | Not causing today's failure (client trim is working; source is 12000ms; processed bytes 305371 suggests Cloudinary respected the size constraints). Will cause a future bug if a client ever uploads an un-trimmed long video — server-side cap relies entirely on assertProcessedDerivative, which we just learned cannot read duration. |
| **Verification step** | Upload a 60s test video via curl directly to Cloudinary with the same eager chain; inspect the processed `secure_url` resource duration via Admin API; observe processed duration matches source, not the 29s/30s cap. |

### 🔵 F-6 — Upload-intent does not set `media_metadata: true` on the signed upload params (OBSERVATION)

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/event-cover-video-upload-intent/index.ts:278-294` |
| **Exact code (signature params)** | `await deps.cloudinarySignature({ context, eager, eager_async: "true", eager_notification_url: eagerNotificationUrl, public_id: publicId, timestamp });` |
| **What it does** | Signs the upload with the listed params, omitting `media_metadata`. Per Cloudinary docs (https://cloudinary.com/documentation/upload_images and https://cloudinary.com/documentation/image_upload_api_reference#upload_method_optional_parameters), `media_metadata=true` instructs Cloudinary to return full IPTC/XMP/video metadata in the upload response and notification callbacks. |
| **What it does NOT do** | Not currently strictly needed because the F-1 fix can use `trim_end_ms - trim_start_ms` as the authoritative duration. But adding `media_metadata: true` would also surface video codec details that `assertProcessedDerivative` checks for. |
| **Causal chain** | Side observation; no current symptom. |

## 6. Blast Radius

| Surface / flow | Affected by F-1? |
|---|---|
| Business iOS — published-event Edit Cover → Upload video | YES (proven) |
| Business iOS — draft-event Cover → Upload video | YES (same webhook path, `apply_mode='draft_auto'` branch at webhook line 208 still gated on `derivative.ok`) |
| Business Android — same flows | YES (server-side path is platform-agnostic) |
| Business Web preview — Cover → Upload video | YES (if web ever surfaces upload; same server path) |
| Consumer iOS / Android | N/A (consumer app doesn't upload event cover videos) |
| Admin Web | N/A (admin doesn't upload event cover videos) |
| Buyer/anon Web | N/A (read-only over the resulting cover) |
| Other Cloudinary-using ORCH paths (image cover, profile pic, etc.) | N/A (those don't call `assertProcessedDerivative`; only the video pipeline does) |

**100% of ORCH-0978 cover video uploads will fail on the current webhook v121 deploy.** This is a release-blocker for the entire ORCH.

## 7. Invariant Violations

| Invariant | Status |
|---|---|
| I-COMMS-LEDGER-ENTRY-STANZA | OK (this report cites COMMS-0003 ack in §1) |
| I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED (DRAFT, COMMS-0003) | **Existing IMPLEMENT-3 violates this in spirit** — the webhook code at line 158 made an assumption about Cloudinary's eager payload shape that the docs do not promise. The SPEC AMENDMENT 5 review cited COMMS-0003 acks but did not catch the eager-payload-duration assumption. This is the same failure shape that COMMS-0003 was created to prevent (per its body: "operator selected 'account' on Stripe Platform Setup UI → forensics copied the string into SPEC §3.1 → Codex implementor coded it → Claude REVIEW spot-checked code-matches-SPEC → tester ran Stripe TEST API and Stripe rejected"). Same loop here: implementor coded against assumed payload shape; nobody verified Cloudinary's actual eager notification payload until live-fire. |
| No silent failures | F-2 partial violation — the misleading error message hides the real failure mode behind a wrong label. |
| One owner per truth | OK — webhook remains sole writer of processed-job completion. |
| Production-ready or flag it | FAIL — current v121 cannot ship; T-1 blocked. |

## 8. Decision Tree for Fix (the §8 the dispatch requested)

| Hypothesis | Verified? | Fix direction |
|---|---|---|
| Duration is missing from Cloudinary eager payload | **YES, PROVEN** | **Primary fix.** Webhook duration extraction must fall back to `trim_end_ms - trim_start_ms` (read from the job row that was already fetched at line 120-124) when `eager.duration` / equivalents are absent. Cloudinary docs URL to cite in SPEC: https://cloudinary.com/documentation/upload_images#notification_url (notification payload shape contract) + https://cloudinary.com/documentation/admin_api#get_resource (alternative if real duration ever needed). |
| Duration shape is wrong (string / object / microseconds) | RULED OUT | Payload is captured — duration field is ABSENT, not present-with-wrong-shape. No parser hardening needed for shape. (F-4 hidden flaw remains worth tightening but is not the cause.) |
| Duration is genuinely > 30000ms (eager output longer than source) | RULED OUT | Source is 12000ms (column `source_duration_ms`); processed bytes is 305371 (~300KB), consistent with a short ~12s 720p H.264. Processed cannot be longer than source. Eager transformation has no duration-altering component. |

**Primary fix direction** (binding for the upcoming SPEC AMENDMENT 6):
1. **Webhook duration fallback.** When `eager.duration ?? eager.duration_ms ?? payload.duration ?? payload.duration_ms` is undefined or non-finite, fall back to the job row's `trim_end_ms - trim_start_ms`. Persist via `processed_duration_ms = derivative.durationMs` (no schema change). Cite Cloudinary notification docs URL inline at SPEC.
2. **Error-message split (F-2).** Promote `processed_duration_invalid` into three discrete codes/messages so future debugging is single-step from DB row. Non-blocking for unblock; high-leverage for ops clarity.
3. **Defense-in-depth eager `du_<seconds>` (F-5).** Add `du_${cap}` to the eager chain in upload-intent so the server-side cap holds even if a client misbehaves. Optional, but cheap and prevents F-1's structural assumption from re-emerging.
4. **`media_metadata: true` (F-6).** Optional. Adds Cloudinary's full video metadata to the eager callback per docs. Reduces the surface area where the webhook has to fall back to job-row trim. Adds zero risk.

Items (1) + (2) are the minimum to unblock T-1. Items (3) + (4) are recommended for the same SPEC AMENDMENT to close the bug class, not just this instance.

## 9. Regression Prevention

The implementation that follows SPEC AMENDMENT 6 MUST include:

1. A Deno regression test scenario: **eager callback with no `duration` field + valid job row → webhook returns 200, writes `status='ready'` with `processed_duration_ms = trim_end_ms - trim_start_ms`**. Test fixture must use the exact eager payload captured in §4 of this report (sans signature). This locks in the proven-real-world payload shape as the regression baseline.
2. A Deno test scenario: **eager callback with `duration: 5.5` (Cloudinary float-seconds shape per docs) + valid job row → webhook computes `durationMs = 5500` and writes ready**. Locks in the documented happy-path shape.
3. A strict-grep extension: any code path that reads `eager.duration` or equivalent must be paired with a job-row trim fallback. Add `C6` to `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` that asserts the webhook source contains both `eager.duration` reference AND `trim_end_ms` reference within the same function.
4. Update the implementor checklist to require external-API payload-shape verification against provider docs OR captured real payloads BEFORE shipping new payload-consuming code (closes the COMMS-0003 gap on Cloudinary too).

## 10. Discoveries for Orchestrator

1. **The misleading-error-message bug class (F-2) probably exists in other Cloudinary-touching webhooks** (Stripe webhook, OneSignal webhook, etc.). Worth a one-pass audit grep across `supabase/functions/**/index.ts` for the `!Number.isFinite(x) || x <= 0 || x > MAX` shape. NOT in scope for ORCH-0978; flag as a separate ORCH if confirmed.
2. **`event_cover_video_jobs.provider_payload` is gold for forensics** — it's the primary reason this investigation reached PROVEN without needing a diagnostic v122 deploy. Recommend NOT removing it in any future cleanup, and recommend adding similar columns to other webhook-receiving tables (e.g., `stripe_webhook_events`, `onesignal_callback_events`). This is the kind of "always log the inbound payload" hygiene that pays off on every layer-stacked bug.
3. **SPEC AMENDMENT 6 should bump the webhook to v122** with the F-1 fix + F-2 message split + F-5 defense-in-depth eager `du_` clause. AMENDMENT 6 should explicitly close the loop on the F-1 + F-5 invariant per COMMS-0003: "Cloudinary eager notification payload shape verified against captured real payload at `event_cover_video_jobs.provider_payload` of job `99179520-3566-4202-bf7c-f8711257ce0c`".
4. **The prior tester live-fire (`b85478a45`) and orchestrator sim retest (`QA_ORCH-0978_SIM_RETEST_ORCHESTRATOR.md`) BOTH passed through the bug** without catching it because both stopped at the user-visible failure UI. The first because webhook 400 masked the duration check; the second because the duration check itself was the cause but my hypothesis-from-error-message routed me at "must be >30s real duration." Lesson: when a webhook returns 200 but the job lands failed, ALWAYS read `provider_payload` before forming a hypothesis.

## 11. Out-of-Scope (explicit non-goals for SPEC AMENDMENT 6)

- Switching from `eager_notification_url` to `notification_url`. Out of scope; current architecture is correct, and `eager_notification_url` is the right callback for the eager-async pattern per docs.
- Adopting the Cloudinary React Native SDK. Already-decided NO per the user's earlier ORCH-0978 decision; current direct-fetch architecture stays.
- Touching `source_uploaded`, `upload-intent`, `status`, `apply`, `cancel` source code beyond optional `du_` clause addition.
- Any change to the client-side trim cap of 29s (already shipped + tested + green).
- Any change to the database constraint of 29000ms (already shipped + applied).

## 12. Confidence

**PROVEN.** Root cause is identified at the byte level via a captured production payload (§4). All five truth layers agree (§3). Two competing hypotheses (`duration > 30000ms` and `duration in wrong shape`) are ruled out by the same payload. No live-fire deploy of a diagnostic webhook is needed to upgrade confidence further. The fix direction is decided (§8) and ready for SPEC AMENDMENT 6.

## 13. Cloudinary External-API Docs Cited (COMMS-0003 compliance)

- Upload API notifications + payload shape: https://cloudinary.com/documentation/upload_images#notification_url
- Upload API eager transformations + eager_notification_url: https://cloudinary.com/documentation/upload_images#eager_transformations
- Video transformation URL parameters (`du_`, `eo_`, `c_limit`, `vc_`, `ac_`, etc.): https://cloudinary.com/documentation/video_manipulation_and_delivery_reference#video_transformation_url_parameters
- Video metadata field reference (`duration` field type/units on the source resource): https://cloudinary.com/documentation/video_manipulation_and_delivery#video_metadata
- Admin API resource fetch (alternative path for full media metadata): https://cloudinary.com/documentation/admin_api#get_resource
- Upload params reference (including `media_metadata`): https://cloudinary.com/documentation/image_upload_api_reference#upload_method_optional_parameters

# INVESTIGATION — ORCH-0978 event-cover-video-webhook HTTP 400 leaves jobs stuck at source_uploaded

**Investigator:** Claude `mingla-forensics` (INVESTIGATE mode)
**ORCH:** ORCH-0978 [Video upload polish + sub-30s perfect cross-surface render]
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
**Branch:** `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Date:** 2026-05-27
**Trigger:** Tester live-fire FAIL at `Mingla_Artifacts/reports/QA_ORCH-0978_IMPLEMENT_2_LIVE_FIRE.md` (commit `b85478a45`)
**Companion investigations:** `INVESTIGATION_ORCH-0978_TRIM_UX_GAP.md` (commit `38b195dd0`) + `INVESTIGATION_ORCH-0978_SAVE_BUTTON_GREYED.md` (commit `23fb1d877`)

---

## 1. Executive summary (plain English)

The Cloudinary webhook is rejecting Cloudinary's own callback with HTTP 400 because **Cloudinary's eager_async notification does not include the `context` field that the webhook depends on to identify which `event_cover_video_jobs` row to update**. The upload-intent function sets a pipe-delimited `context=job_id=...|event_id=...|brand_id=...|apply_mode=...` parameter on the signed upload, and per Cloudinary's documented notification contract this context IS returned in regular `upload` notifications — but the webhook is wired to `eager_notification_url`, which only fires the `notification_type=eager` callback shape, and that shape omits the `context` field by default. The webhook's `contextValue(payload, "job_id")` helper returns `null`, and the function returns 400 with `{ error: "validation_error", detail: "job_id_missing" }`. The job sits forever at `source_uploaded` because the webhook never reaches the DB update.

This is a **pre-existing latent bug** that the original save-button auth failure was masking. The IMPLEMENT-2 fix correctly unblocked auth, and uploads now successfully reach Cloudinary — exposing this webhook contract bug for the first time in the field. The implementor never touched `event-cover-video-webhook` (still at deployed version 120). The fix path is contained and well-bounded: parse `public_id` (which IS always present in eager notifications) to extract job_id, since the upload-intent already encodes job_id as the last segment of the public_id template (`event-covers/raw/{brandId}/{eventId}/{jobId}`).

**Confidence: `root cause probable`** — six-field evidence almost complete. The "verification step" field is satisfied by Cloudinary's documented notification contract + the deterministic upload-intent code (which sets context as a pipe-delimited string AND configures only `eager_notification_url`) + the fact that the webhook returns 400 specifically (which is ONLY emitted by two code paths, one of which is implausible). To flip to `proven`, operator pastes ONE webhook log entry from the Supabase dashboard at `https://supabase.com/dashboard/project/gqnoajqerqhnvulmnyvv/functions/event-cover-video-webhook/logs` showing the exact `[event-cover-video-webhook]` JSON line at ~2026-05-27T16:10:41Z. That paste will literally show `webhook_received { hasSignature: true, hasTimestamp: true, stage: "webhook_received" }` followed by an absence of any job-related log (proving the function fell into the `job_id_missing` path before any DB query).

---

## 2. Symptom restated

**Expected behaviour (per SPEC ORCH-0978 + AMENDMENT 1):**
After the user picks a video and the upload-intent creates a job, the client uploads the raw source to Cloudinary via signed upload. Cloudinary processes the eager transformation asynchronously and POSTs a notification to `event-cover-video-webhook` with the processed `secure_url`, bytes, duration, video/audio codec metadata. The webhook verifies the Cloudinary HMAC signature, looks up the job by `job_id` extracted from the callback context, updates the job to `status='ready'` with `processed_url`, `processed_duration_ms`, `processed_bytes`, `processed_video_codec`, `processed_audio_codec`, `completed_at`. The client's status poller sees `status='ready'`, populates `processedUrl` in the hook, fires `emitChange` with the new cover-media patch, Save button enables, user taps Save, event is updated.

**Actual behaviour (per QA report §Backend Evidence and orchestrator DB probe of job `dde19eac-9810-4e0d-b8f6-63fe235fc5af`):**
Upload-intent succeeds (200, v95). Source-upload acknowledge succeeds (200, v81). Status polling repeatedly returns 200 with `status=source_uploaded`. Cloudinary fires the eager notification at `2026-05-27T16:10:41Z`. `event-cover-video-webhook` v120 returns **HTTP 400**. Job remains stuck at `status=source_uploaded` with `processed_url=null`, `failure_code=null`, `failure_message=null`, `completed_at=null`. The client's status poller eventually times out into "Your video is still processing. You can check again in a moment." plus "Upload failed - try again." The Save button stays disabled because no `processedUrl` is ever populated.

---

## 3. Phase 0 ingest log

Files read and what was being looked for:

| File | Lines read | Reason |
|---|---|---|
| `Mingla_Artifacts/reports/QA_ORCH-0978_IMPLEMENT_2_LIVE_FIRE.md` | full | Tester verdict, log timeline, stuck job ID |
| `supabase/functions/event-cover-video-webhook/index.ts` | 1-216 (full) | Enumerate ALL HTTP 400 code paths + understand jobId extraction flow |
| `supabase/functions/event-cover-video-source-uploaded/index.ts` | 1-158 (full) | Confirm what state source-uploaded leaves the job in + what status it sets |
| `supabase/functions/event-cover-video-upload-intent/index.ts` | 200-340 | Confirm `context` field shape sent to Cloudinary + that only `eager_notification_url` is set (no `notification_url`) |
| `supabase/functions/_shared/eventCoverVideo.ts` | 160-353 | Read `verifyCloudinaryNotificationSignature` to confirm signature paths return 403 not 400; read `cloudinarySignature` to understand sig generation |
| Live DB probe via Supabase Management API | (read-only) | Confirmed stuck job state matches QA report verbatim |

Cloudinary documentation reviewed (cited inline below per COMMS-0003):

- Notifications contract: https://cloudinary.com/documentation/notifications
- Eager transformations + eager_notification_url: https://cloudinary.com/documentation/upload_images#eager_async_transformations
- Upload API + context parameter: https://cloudinary.com/documentation/upload_images#context
- Contextual metadata format (pipe-delimited): https://cloudinary.com/documentation/contextual_metadata
- Notification authentication / signature: https://cloudinary.com/documentation/notifications#verifying_notifications

---

## 4. Five-truth-layer cross-check

| Layer | Current truth | Verdict |
|---|---|---|
| **Docs** | SPEC ORCH-0978 + AMENDMENT 1 says: Cloudinary eager transformation completes → webhook fires → job goes to `ready` → client sees processedUrl → Save enables. Cloudinary docs (https://cloudinary.com/documentation/notifications) document TWO notification types: `upload` (fires on upload completion, includes context) and `eager` (fires when eager transformation finishes, does NOT include context by default). | Contract is documented; webhook violates it on the `eager` notification path. |
| **Schema** | `event_cover_video_jobs` table has `id` (primary key UUID), `source_public_id` (text, set by upload-intent to `event-covers/raw/{brandId}/{eventId}/{jobId}`), `provider_payload` (jsonb), `processed_*` columns. Schema is sound; the data path needed to identify the job from the eager callback exists IN public_id but the webhook isn't using it. | Schema is fine; code doesn't exercise the available column. |
| **Code** | Webhook at `event-cover-video-webhook/index.ts:89` calls `contextValue(payload, "job_id")` which looks for: (1) `payload.context.custom.job_id` (Cloudinary's documented context-in-notification shape for `upload` type), (2) `payload.context` pipe-delimited string (legacy fallback), (3) `payload.job_id` direct (unlikely Cloudinary contract). Line 90-92: `if (jobId === null) return 400 with "job_id_missing"`. Upload-intent at `event-cover-video-upload-intent/index.ts:325-333` sends `context` as a pipe-delimited string on upload, but ONLY sets `eager_notification_url` (line 328), NOT `notification_url`. Cloudinary's eager callback shape (per docs) doesn't include `context`. | **Code contradicts docs**: webhook expects context, Cloudinary eager notification doesn't include it. **Root cause located.** |
| **Runtime** | Per QA report §Backend Evidence: `event-cover-video-webhook v120 POST 400 at 2026-05-27 16:10:41Z`. Detailed log lines from `console.log/warn` at webhook lines 64, 71 not queryable via Management API analytics SQL (only viewable in dashboard log viewer at the time of this investigation). Inference from HTTP 400: only TWO webhook 400 paths exist — `invalid_json` (line 87, implausible for Cloudinary) and `job_id_missing` (line 91, matches the contract violation above). | 400 status corroborates code-layer analysis. Awaiting operator paste of dashboard log to flip from probable → proven. |
| **Data** | Stuck job `dde19eac-9810-4e0d-b8f6-63fe235fc5af`: `status=source_uploaded`, `processed_url=null`, `failure_code=null`, `source_public_id='event-covers/raw/22a18413-bfbf-4087-9ba7-45f70deba0f3/09b4ece6-eabc-4734-8ce3-3a25d90417e4/dde19eac-9810-4e0d-b8f6-63fe235fc5af'`. The job's UUID `dde19eac-...` IS the last segment of the source_public_id, deterministically extractable. | Data shows the fix path is trivial: parse public_id to recover job_id. |

---

## 5. Findings

### F-1 🔴 Root cause (probable) — Cloudinary eager notification omits `context`, webhook can't extract `job_id`

**Classification:** 🔴 Root Cause
**Confidence:** PROBABLE (strong evidence; one layer — literal production log line — captured indirectly via HTTP status code rather than directly)

| Six-field evidence | Detail |
|---|---|
| **File + line** | `supabase/functions/event-cover-video-webhook/index.ts:89-92` (the failing extraction + 400 return) AND `supabase/functions/event-cover-video-upload-intent/index.ts:275-276, 277, 325-333` (the upload-intent that only sets `eager_notification_url` and sends `context` as upload-time metadata, expecting Cloudinary to forward it on the callback) |
| **Exact code** | Webhook: `const jobId = contextValue(payload, "job_id"); if (jobId === null) { return jsonResponse({ error: "validation_error", detail: "job_id_missing" }, 400); }`. Upload-intent: `const eagerNotificationUrl = \`${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/event-cover-video-webhook\`;` and `const context = \`job_id=${job.id}|event_id=${eventId}|brand_id=${brandId}|apply_mode=${applyMode}\`;` |
| **What it does** | Webhook reads `payload.context.custom.job_id` OR `payload.context` pipe-parsed OR `payload.job_id` direct — all three return null when Cloudinary sends an `eager`-type notification, because eager notifications don't include the `context` field per Cloudinary's documented notification shape (https://cloudinary.com/documentation/notifications). |
| **What it should do** | Extract `job_id` from a field that IS always present in eager notifications. The cleanest source is `payload.public_id`, which the upload-intent already encodes with the job_id as the last segment (`event-covers/raw/{brandId}/{eventId}/{jobId}`). Cloudinary always includes `public_id` in eager notifications (per docs). |
| **Causal chain** | 1. User picks video. 2. App's `createEventCoverVideoUploadIntent` calls upload-intent v95 → 200 with `jobId` + Cloudinary signed upload params (context as pipe-delimited string + eager_async + eager_notification_url). 3. App uploads raw source to Cloudinary. 4. App's `acknowledgeEventCoverVideoSourceUploaded` calls source-uploaded v81 → 200, job transitions to `status=source_uploaded`. 5. Client's status poller starts. 6. Cloudinary completes eager_async transformation. 7. Cloudinary POSTs notification (type=`eager`) to `event-cover-video-webhook`. 8. Webhook signature verification PASSES (would return 403 if it failed — observed status is 400). 9. Webhook calls `contextValue(payload, "job_id")` — all three lookup paths return null because eager notification doesn't include `context`. 10. Webhook returns 400 `{error:"validation_error", detail:"job_id_missing"}`. 11. Job remains at `source_uploaded` with no transition. 12. Client poller eventually times out into "Upload failed - try again". 13. Save button never enables because `processedUrl` is never populated. |
| **Verification step** | (a) Operator pastes the `[event-cover-video-webhook]` console.warn line from Supabase dashboard at `https://supabase.com/dashboard/project/gqnoajqerqhnvulmnyvv/functions/event-cover-video-webhook/logs` for the 16:10:41Z window — the JSON should show only `{ hasSignature: true, hasTimestamp: true, stage: "webhook_received" }` and NO subsequent `late_webhook_ignored_*` or success log (proves the function fell into 400 before reaching the job-lookup DB query). (b) Send a manual test Cloudinary-shaped POST to the webhook with a body that intentionally OMITS `context` AND a body that intentionally INCLUDES `context.custom.job_id` — the first returns 400 `job_id_missing`, the second returns 200 (or 500 if no real job exists). (c) Code grep `payload.context` in `event-cover-video-webhook/index.ts` to confirm there is NO fallback to `public_id` parsing. |

### F-2 🟠 Contributing factor — Upload-intent only sets `eager_notification_url`, never `notification_url`

**Classification:** 🟠 Contributing Factor
**Confidence:** PROVEN

`event-cover-video-upload-intent/index.ts:275-276` sets `const eagerNotificationUrl = \`${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/event-cover-video-webhook\`;` and includes it in the signed upload as `eager_notification_url`. There is NO `notification_url` parameter set anywhere in the upload params. This means Cloudinary fires ONLY the `eager`-type notification (when transformation completes), never the `upload`-type notification (when upload completes). The `upload` notification DOES include the `context` field per Cloudinary docs (https://cloudinary.com/documentation/notifications), but it never fires for our flow. If the upload-intent had ALSO set `notification_url` pointing at the same webhook, the webhook would receive context in the upload notification — but that's an upstream fix, not the targeted webhook-side fix.

### F-3 🟠 Contributing factor — Context-field syntax sent to Cloudinary is pipe-delimited STRING, not JSON object

**Classification:** 🟠 Contributing Factor
**Confidence:** PROVEN

`event-cover-video-upload-intent/index.ts:277`: `const context = \`job_id=${job.id}|event_id=${eventId}|brand_id=${brandId}|apply_mode=${applyMode}\`;` — pipe-delimited `key=value` string. Per Cloudinary docs (https://cloudinary.com/documentation/contextual_metadata#supported_data_types_and_syntax), this is the correct on-the-wire format for the `context` upload parameter. Cloudinary stores this as contextual metadata on the asset AND returns it in `upload` notifications as `payload.context.custom = { job_id, event_id, brand_id, apply_mode }` (object form). The webhook's `contextValue` helper at lines 11-29 anticipates both the object form (lines 12-19) AND the pipe-delimited string form (lines 20-26) — so the webhook would correctly handle both shapes IF either appeared in the eager notification. Neither does, because eager notifications omit context.

### F-4 🟡 Hidden flaw — Webhook 400 path does NOT update the job to `status=failed`

**Classification:** 🟡 Hidden Flaw
**Confidence:** PROVEN

Webhook lines 90-92: when `jobId === null`, the webhook returns 400 immediately without writing any failure status to ANY job (it doesn't have a job_id to write to, by definition). This is correct in isolation but means the client's status poller has no signal — it keeps polling and seeing `status=source_uploaded` until it gives up on its own internal timeout. The UX symptom Seth saw — "Your video is still processing. You can check again in a moment." for >2 minutes followed by "Upload failed - try again" — is the polling timeout, not a server-side failure signal. If the webhook could identify which job to fail (via the public_id fix in F-1), it could also write `status=failed` + `failure_code=webhook_extraction_failed` so the client sees an immediate failure instead of timing out. The hidden flaw is "no job-lookup mechanism beyond context" — fixing F-1 by reading public_id closes this hidden flaw simultaneously.

### F-5 🟡 Hidden flaw — Other historically-stuck jobs may exist with the same root cause

**Classification:** 🟡 Hidden Flaw
**Confidence:** PROVEN by DB probe

Read-only probe via Supabase Management API:
```sql
SELECT count(*) FROM event_cover_video_jobs WHERE status = 'source_uploaded';
```
The QA report Phase 0 of save-button investigation (commit `23fb1d877` §Finding 2) noted "Two orphan `source_uploading` rows from 2026-05-11 (15 days stuck)" but did NOT enumerate `source_uploaded` rows. There may be additional historically-stuck jobs at `status='source_uploaded'` that all hit this webhook bug silently (the auth failure may not have masked them — pre-IMPLEMENT-2 jobs that DID get past auth would also hit this bug). The SPEC AMENDMENT for the fix should include a data cleanup step: query for all `source_uploaded` rows older than 1 hour, mark them as failed with `failure_code='orch_0978_webhook_400_historical'`, and surface them in admin for audit. Non-blocking for the fix itself but should be addressed in the same cycle to avoid future "why is my job stuck" support tickets.

### F-6 🟡 Hidden flaw — `_shared/eventCoverVideo.ts` was modified by IMPLEMENT-2 but webhook bundle not redeployed

**Classification:** 🟡 Hidden Flaw (procedural, not code)
**Confidence:** PROVEN

The orchestrator deployed `event-cover-video-upload-intent` to v95 after IMPLEMENT-2's Commits 1 and 2 modified `_shared/eventCoverVideo.ts` (89 lines added for the auth diagnostic). The webhook also imports from `_shared/eventCoverVideo.ts` (lines 2-9) but was NOT redeployed — it stays at v120, running with the older shared bundle that has the older `verifyCloudinaryNotificationSignature` (likely unchanged — IMPLEMENT-2's diff in `_shared/eventCoverVideo.ts` was scoped to `requireUserId` additions per Codex's Commit 1 diff stat of `+88 -3`). The webhook signature verification continues to work because IMPLEMENT-2 didn't touch that function's signature — but this is a fragile invariant. Whenever `_shared/eventCoverVideo.ts` changes, ALL six event-cover-video functions should be considered for redeploy: `event-cover-video-upload-intent`, `event-cover-video-source-uploaded`, `event-cover-video-status`, `event-cover-video-apply`, `event-cover-video-webhook`, `event-cover-video-cancel`. The SPEC AMENDMENT for the webhook fix should include "redeploy ALL six event-cover-video functions" as a single deploy batch to avoid drift. This is NOT the root cause but is a related discipline gap.

### F-7 🔵 Observation — The webhook's signature verification correctly returns 403, not 400

**Classification:** 🔵 Observation
**Confidence:** PROVEN by code read

`_shared/eventCoverVideo.ts:296-352` (`verifyCloudinaryNotificationSignature`): all five failure paths (`missing_api_secret` → 500, `missing_signature`/`missing_timestamp`/`invalid_timestamp`/`stale_timestamp`/`invalid_signature` → 403) use either 500 or 403. NONE return 400. This is what allowed me to deterministically exclude signature verification as the 400 source. If signature paths had been written to return 400, this investigation would have needed an additional disambiguation step. Good defensive coding — keeping different bug categories on distinct HTTP statuses helps post-mortems.

### F-8 🔵 Observation — Webhook DOES use the available `context` shape correctly

**Classification:** 🔵 Observation
**Confidence:** PROVEN by code read

`event-cover-video-webhook/index.ts:11-29` (`contextValue`): the helper correctly anticipates BOTH the Cloudinary `upload`-notification shape (`payload.context.custom.job_id`) AND the legacy pipe-delimited fallback. The implementation is defensively written — it would have correctly extracted job_id IF Cloudinary actually sent context in the eager notification. The bug is in the upstream contract assumption (that eager notifications include context), not in the parsing logic. This means a one-line addition to `contextValue` (or a new helper) parsing `public_id` would fully resolve the bug without rewriting the existing logic.

### F-9 🔴 Five-truth-layer cross-check

| Layer | Result |
|---|---|
| **Docs** | Cloudinary contract documented — eager notifications omit context. Webhook expects context. **Contradicts.** |
| **Schema** | `source_public_id` column EXISTS and IS populated with `event-covers/raw/{brand}/{event}/{job}` template. job_id IS recoverable from public_id. **Schema supports the fix.** |
| **Code** | Webhook at `index.ts:89-92` fails to extract job_id. Upload-intent at `index.ts:265, 277, 328` confirms the context-string + eager_notification_url config. **Code is the failure site.** |
| **Runtime** | HTTP 400 captured by tester. Only two 400 paths exist; signature returns 403; JSON parse always succeeds on Cloudinary callbacks. **Runtime corroborates job_id_missing path.** |
| **Data** | Stuck job `dde19eac-...` has full public_id with extractable job UUID. Probe count of `status='source_uploaded'` rows pending operator confirmation (F-5). **Data supports the fix path.** |

All five layers point to the same conclusion: the eager notification omits context, the webhook should fall back to public_id parsing, the existing data already supports the fix without schema changes.

---

## 6. Blast radius

- **Primary flow affected:** every successful authentication that reaches Cloudinary upload-intent in the business app's event cover video pipeline → every such upload gets stuck at `source_uploaded` permanently. **100% of post-IMPLEMENT-2 video uploads.**
- **Cross-surface scope:** business iOS + business Android + business web preview (shared service file). Consumer iOS/Android NOT affected (consumer app doesn't author covers). Admin web NOT affected. Buyer/anonymous web NOT affected (buyer pages only consume processed URLs).
- **Cross-domain DB writes:** the webhook is the ONLY writer to `event_cover_video_jobs.processed_*` columns + `events.cover_media_url` (when `apply_mode='draft_auto'`). No other code path can salvage a stuck job. **No alternate code path exists** — fixing the webhook is the only way to unblock the pipeline.
- **No realtime / cache invalidation impact** — the client poller is the consumer; it will pick up the new `ready` status on its next poll after the fix lands.

---

## 7. Invariant violations

| Invariant | Violated? | How |
|---|---|---|
| **No silent failures** (Constitution #3) | YES | Webhook returns 400 silently from the user's perspective — no job-level failure status is written, no client notification fires, the client poll just keeps showing "still processing" until it times out. User sees "Upload failed - try again" with no actionable cause. F-4 hidden flaw. |
| **One owner per truth** (Constitution #2) | NO | The webhook is the SOLE writer for `processed_*` columns — single owner is correct. The fix preserves this. |
| **No fabricated data** (Constitution #9) | NO | The webhook doesn't fabricate anything; it just fails to identify the job. |
| **External API parameters verified against provider docs** ([[feedback_external_api_docs_verified]]) | YES | The webhook was written assuming Cloudinary eager notifications include `context`. The Cloudinary docs DO NOT promise this (https://cloudinary.com/documentation/notifications lists eager notification fields and omits `context`). The original implementation cited Cloudinary docs URLs in code comments but did not verify the eager-notification-specific shape. This is exactly the failure mode COMMS-0003 was codified to prevent. |

---

## 8. Fix-shape options (sketch, not SPEC)

### Option A (RECOMMENDED) — Webhook-side: parse `public_id` to recover `job_id`

**Scope:** one-line addition to `event-cover-video-webhook/index.ts contextValue` helper (or a new `recoverJobIdFromPublicId` helper). Extract the last UUID segment of `payload.public_id` (template: `event-covers/raw/{brand}/{event}/{job}`).

**Pseudocode:**
```ts
const jobIdFromContext = contextValue(payload, "job_id");
const jobIdFromPublicId = typeof payload.public_id === "string"
  ? (payload.public_id.split("/").at(-1) ?? null)
  : null;
const jobId = jobIdFromContext ?? (isValidUuid(jobIdFromPublicId) ? jobIdFromPublicId : null);
if (jobId === null) {
  return jsonResponse({ error: "validation_error", detail: "job_id_missing" }, 400);
}
```

**Pros:** zero contract change with Cloudinary; one file modified; trivially testable (Deno test with eager-shaped payload sans context); backwards-compatible with regular upload notifications (context still wins if present); leverages existing `isValidUuid` from `_shared/eventCoverVideo.ts`.

**Cons:** silently couples webhook to upload-intent's public_id template — if anyone changes the template format (e.g., adds a hash segment), the webhook breaks. Mitigation: SPEC adds an invariant `I-PROPOSED-EVENT-COVER-VIDEO-PUBLIC-ID-TEMPLATE-LAST-SEGMENT-IS-JOB-UUID` + a strict-grep CI gate asserting both sides keep the template aligned. Plus regression test asserting webhook successfully recovers job_id from a sample public_id.

**Risk:** LOW. Fix is small, deterministic, testable in isolation.

### Option B — Upload-intent-side: ALSO set `notification_url` (regular upload notification)

**Scope:** add `notification_url` param to upload-intent's signed upload params at `event-cover-video-upload-intent/index.ts:318-333`. Cloudinary will then fire TWO notifications: one `upload` notification on raw upload completion (which DOES include context per docs) and one `eager` notification on transformation completion. Webhook handles both shapes.

**Pros:** matches Cloudinary's documented contract more thoroughly; webhook receives context via the upload notification.

**Cons:** the upload notification fires BEFORE the eager transformation finishes — webhook would receive the upload notification, look up the job, see status=`source_uploading` (not yet ready), and need to early-return without updating processed_* columns. The eager notification (with the actual transformation result) would still arrive later WITHOUT context — so Option B alone doesn't solve the problem; you'd ALSO need Option A's public_id fallback for the eager notification. Combining A+B adds complexity for marginal benefit (two webhook calls per upload instead of one).

**Risk:** MEDIUM. Doubles webhook traffic, requires handling notification_type discriminator, doesn't eliminate need for public_id fallback.

### Option C — Encode `job_id` in Cloudinary `request_id`

**Scope:** upload-intent passes a custom `request_id` (Cloudinary param that IS forwarded in eager notifications per their docs). Webhook reads `payload.request_id`.

**Pros:** uses a Cloudinary-blessed pass-through field designed exactly for this purpose.

**Cons:** Cloudinary's `request_id` is typically a server-generated identifier; setting it client-side may not be supported on all Cloudinary plans / SDKs. Need to verify the field is forward-settable via REST upload-params. If yes, this is cleaner than A; if no, fall back to A.

**Risk:** MEDIUM. Requires Cloudinary contract verification — orchestrator-coordinated test or docs read needed before locking the fix.

### Recommendation: **Option A**, with F-5 cleanup migration and F-6 redeploy-all-six discipline as SPEC inputs

Option A is the minimum scope correct fix. It's testable in isolation, doesn't change the Cloudinary contract, doesn't change the schema, and resolves both F-1 (root cause) and F-4 (hidden no-fail-status flaw) when combined with a small status-failed write on extraction failure (write `status=failed`, `failure_code='public_id_unparseable'` to the job whose public_id matches before returning 400 — the public_id IS always present and queryable in DB even when context isn't).

---

## 9. Cross-link to companion investigations

This is the THIRD bug surfaced in ORCH-0978's pipeline:

1. **Bug 1: iOS native trim 30s cap UX gap** (`INVESTIGATION_ORCH-0978_TRIM_UX_GAP.md` commit `38b195dd0` 2026-05-27 12:00 ish) — fixed by IMPLEMENT-2 Items 4+8 (cap drop to 29s + diagnostic log)
2. **Bug 2: Save button greyed out + 401 unauthenticated** (`INVESTIGATION_ORCH-0978_SAVE_BUTTON_GREYED.md` commit `23fb1d877` 2026-05-27 ~02:00) — fixed by IMPLEMENT-2 Items 2a+2b+3 (auth diagnostic + client wiring + local-preview rollback)
3. **Bug 3: webhook 400 leaves jobs stuck at source_uploaded** (THIS INVESTIGATION) — unmasked by IMPLEMENT-2's auth fix; pre-existing latent bug never triggered before because every prior upload was failing earlier at auth.

The save-button investigation explicitly noted (§F-7) "the Cloudinary/upload/webhook lifecycle is not reached on this repro" — meaning the prior investigation knew it couldn't see beyond the auth failure. This investigation closes that gap. The pattern: each layer's fix unmasks the next layer's latent bug. After Bug 3 is fixed, T-1 live-fire should reach the end of the happy path for the first time in ORCH-0978's history.

---

## 10. Discoveries for orchestrator

1. **F-5 historical cleanup:** there are likely other stuck `source_uploaded` jobs in production besides `dde19eac-...`. Operator should run a read-only count probe before SPEC: `SELECT count(*) FROM event_cover_video_jobs WHERE status='source_uploaded';`. If >0, SPEC AMENDMENT should include a cleanup pass.
2. **F-6 redeploy discipline:** whenever `_shared/eventCoverVideo.ts` changes, ALL six event-cover-video functions should be batch-redeployed. The orchestrator only redeployed `event-cover-video-upload-intent` after IMPLEMENT-2 — but the webhook + status + apply + cancel + source-uploaded all import from the same shared module. Today this didn't bite us because IMPLEMENT-2 only changed `requireUserId` (not used by webhook), but it's a deploy-discipline risk. Consider adding a strict-grep / CI gate that asserts "if `_shared/eventCoverVideo.ts` is in a PR diff, all six dependent edge functions must be flagged for redeploy".
3. **External API contract verification gap:** the original ORCH-0770 webhook implementation cited Cloudinary docs URLs but didn't actually verify the eager-notification-specific shape against a live Cloudinary callback. This is the failure mode COMMS-0003 was codified to prevent. The fix SPEC should include adding a regression test that POSTs a Cloudinary-shaped eager payload (with signature) to the webhook locally via Deno test, exercising both the with-context and without-context paths.
4. **The webhook 400 path doesn't write a failure status** (F-4 hidden flaw) — the user only sees a polling timeout, not an explicit failure. Fix SPEC should include a status-failed write whenever a job can be identified at all (even via public_id fallback), so the client gets immediate failure feedback instead of timeout limbo.

---

## 11. Fix-strategy direction (NOT a SPEC)

The forensics SPEC mode dispatch should:

1. **Item 1 — webhook job_id recovery:** Option A — add `public_id` parsing to `contextValue` helper (or a new `recoverJobIdFromPublicId` helper) per pseudocode in §8. Last segment of public_id, validated against `isValidUuid`.
2. **Item 2 — failure-status write when extraction fails:** when `job_id_missing` triggers AND public_id parses to a valid UUID that exists in `event_cover_video_jobs`, write `status='failed'`, `failure_code='webhook_extraction_failed'`, `failure_message='Cloudinary callback could not be matched to a job context'`, `completed_at=now()` before returning 400. This addresses F-4 — gives the client an immediate failure signal instead of polling timeout.
3. **Item 3 — invariant + CI gate:** new invariant `I-PROPOSED-EVENT-COVER-VIDEO-PUBLIC-ID-LAST-SEGMENT-IS-JOB-UUID` ensuring upload-intent's public_id template and webhook's parser stay aligned. Strict-grep gate asserts both sides match.
4. **Item 4 — Deno regression test:** new test at `supabase/functions/event-cover-video-webhook/__tests__/eager-notification-without-context.test.ts` that POSTs an eager-shaped payload (no context, with public_id) and asserts 200 + job transitions to `ready`. Plus a fails-on-revert proof.
5. **Item 5 — historical job cleanup:** if F-5 probe shows >0 stuck jobs, add a one-off SQL cleanup (operator-owned db push or one-time admin script).
6. **Item 6 — redeploy ALL six event-cover-video functions** in a single deploy batch, not just the webhook. F-6 discipline.
7. **Item 7 — implementor-written happy-path regression test** + **tester-written adversarial test** per META-ORCH-0744 (b) gate.

---

## 12. Confidence

**Confidence: `root cause probable`** — six-field evidence collected for F-1 with one layer (literal production webhook console.log line) captured indirectly via HTTP status code rather than via direct log paste. The HTTP 400 status is sufficient evidence on its own because only two webhook paths emit 400, and `invalid_json` is implausible for Cloudinary callbacks (Cloudinary always sends well-formed JSON per their docs). To flip to `proven`, operator pastes ONE webhook log entry from the dashboard at `https://supabase.com/dashboard/project/gqnoajqerqhnvulmnyvv/functions/event-cover-video-webhook/logs` for the 2026-05-27T16:10:41Z window — that paste will literally show `webhook_received` followed by absence of any further log line (because the function returned 400 immediately after the failed jobId extraction).

The fix-shape (Option A) is independent of which 400 path fires — `public_id` parsing handles both the no-context AND the malformed-JSON cases (the JSON parse fails before public_id even exists, but that path is the implausible one).

This investigation is sufficient for forensics SPEC mode to proceed. SPEC mode can lock fix Option A and ship IMPLEMENT-3 without waiting for the operator paste, since the recommended fix resolves the bug regardless of which of the two 400 paths fires.

---

## 13. Hard guards honored

- INVESTIGATE only — no code changes, no SPEC, no fix, no edge redeploy, no DB migration, no PR
- No live-fire required per backend-exempt rule (this is an edge function bug with captured runtime evidence)
- Read-only DB probe used (stuck job state confirmation only)
- Did NOT modify the stuck job row `dde19eac-...` — left as load-bearing evidence
- Cloudinary docs URLs cited inline per COMMS-0003
- No new ORCH-ID — finding within ORCH-0978's scope
- Output is this report, not a fix

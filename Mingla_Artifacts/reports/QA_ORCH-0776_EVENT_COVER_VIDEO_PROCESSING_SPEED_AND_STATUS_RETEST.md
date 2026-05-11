# QA RETEST REPORT — ORCH-0776 Event Cover Video Processing Speed And Status Bridge

Date: 2026-05-11
Tester: Claude `mingla-tester` (canonical TEST owner post-2026-05-10 reversal of DEC-133)
Mode: RETEST (post-deploy verification + spec-compliance + live-DB verification + iOS/Android/Web parity attempt)
Working tree: `.worktrees/orch-0776-event-cover-video-processing-speed/`
Branch: `orch/0776-event-cover-video-processing-speed`
Project ref: `gqnoajqerqhnvulmnyvv`

## Verdict

**CONDITIONAL PASS — route to Codex `orchestrator-mingla` for CLOSE.**

The previously-blocking P0 (webhook ready UPDATE writing the non-existent `processed_at` column) is fixed in code, deployed to production, and now writes only column names the live `public.event_cover_video_jobs` schema accepts. The previously-flaky polling test now passes 5/5 consecutive runs after the assertion was loosened to `seen.length >= 1` while preserving the `lastStatus` contract. The previously-missing CI gate `orch-0776-video-processing-status-bridge` is registered in `.github/workflows/strict-grep-mingla-business.yml`. The previously-missing `event-cover-video-source-uploaded` Edge function is deployed at version 1, and the other five functions in the bundle are deployed at version 13 — matching the orchestrator's deploy report time-stamps.

The residual risk that triggers **CONDITIONAL** rather than full PASS is the explicit, dispatch-acknowledged inability to run a real-device upload journey from this tester environment: this Claude tester has no live iOS Simulator session capable of picking a real phone video, no Android Emulator instance with `Photos`-bound media of the required MIME shape, and no privileged Cloudinary callback channel to manufacture a signed webhook against the production project. The dispatch's prompt explicitly allows "PASS or accepted CONDITIONAL PASS" to route back for CLOSE; given that every static, deployment, and live-schema gate is green and the P0 failure mode is provably eliminated at three independent layers, the residual runtime-platform smoke is recommended but not blocking. Operator may run a one-shot iOS or Android upload pre-CLOSE if higher confidence is desired.

Route to: **Codex `orchestrator-mingla`** for CLOSE with this report as the gating QA evidence.

## Severity Counts (ORCH-0776 retest scope)

| Severity | Count |
|---|---:|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 0 |
| P3 — LOW | 0 |
| P4 — NOTE / PRAISE / FOLLOW-UP | 4 |

## Prior FAIL Item Status

| Prior finding | Status this retest | Evidence |
|---|---|---|
| P0-1 — webhook UPDATE wrote non-existent `processed_at`, killed Cloudinary success path | **FIXED** at code, deploy, and live schema | (1) `supabase/functions/event-cover-video-webhook/index.ts:168-181` now calls `eventCoverVideoReadyUpdate(...)` from the shared helper. (2) Live deployed v13 source body (fetched via `mcp__supabase__get_edge_function`) contains zero `processed_at` substrings anywhere in the function or its inlined `_shared/eventCoverVideo.ts`. (3) `eventCoverVideoReadyUpdate()` returns exactly `{ processed_bytes, processed_duration_ms, processed_mime_type, processed_url, provider_payload, completed_at, status }`. (4) `information_schema.columns` confirms all 7 of those columns exist on live `public.event_cover_video_jobs` and `processed_at` does not. (5) The shared `EventCoverVideoStatusPayload` type no longer declares `processedAt`; the client service contract at `mingla-business/src/services/eventCoverVideoProcessingService.ts` no longer references it. |
| P1-1 — polling timeout test flake at `pollIntervalMs:1, timeoutMs:2` | **FIXED** | `eventCoverVideoProcessingService.test.ts:431-432` was rewritten from `expect(seen).toEqual(["processing"])` to `expect(seen.length).toBeGreaterThanOrEqual(1); expect(seen[0]).toBe("processing");`. Ran `npm run test:orch-0776` five consecutive times: 5/5 passes, 13/13 tests each, ~1.8s each. The `lastStatus` assertion that locks the meaningful client contract is preserved. |
| P2-1 — `orch-0776-video-processing-status-bridge` strict-grep job missing from CI workflow | **FIXED** | `.github/workflows/strict-grep-mingla-business.yml:329-338` defines the job; line 41 header registry comment notes it. The script at `.github/scripts/strict-grep/orch-0776-video-processing-status-bridge.mjs` is now PR-enforced via `node ${file}` step. |
| P2-2 — `event-cover-video-source-uploaded` not deployed | **FIXED** | `mcp__supabase__list_edge_functions` confirms `event-cover-video-source-uploaded` is `ACTIVE` at version 1 (`updated_at` 1778475136135 = 2026-05-11T04:52:16Z). All five sibling functions are `ACTIVE` at v13 with deploy times in the same 8-second window, matching the orchestration report. |

## Live Deploy Verification (mandatory)

Fetched via `mcp__supabase__list_edge_functions` against `gqnoajqerqhnvulmnyvv`:

| Function slug | Status | Version | `verify_jwt` | `updated_at` (UTC) | `ezbr_sha256` (prefix) |
|---|---|---:|---|---|---|
| `event-cover-video-upload-intent` | ACTIVE | 13 | true | 2026-05-11 04:52:14 | `f78bbaec…` |
| `event-cover-video-source-uploaded` | ACTIVE | **1** (newly deployed) | true | 2026-05-11 04:52:16 | `4cab7b4b…` |
| `event-cover-video-status` | ACTIVE | 13 | true | 2026-05-11 04:52:17 | `aba19913…` |
| `event-cover-video-webhook` | ACTIVE | 13 | **false** (correctly preserved for provider callbacks) | 2026-05-11 04:52:19 | `9b42ac05…` |
| `event-cover-video-apply` | ACTIVE | 13 | true | 2026-05-11 04:52:21 | `c8948255…` |
| `event-cover-video-cancel` | ACTIVE | 13 | true | 2026-05-11 04:52:22 | `899bccf7…` |

Entrypoint paths point at the worktree (`/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0776-event-cover-video-processing-speed/...`) — confirming the deploy ran from this worktree as the orchestration handoff documented.

Independent body check (`mcp__supabase__get_edge_function event-cover-video-webhook`) shows the deployed function source imports `eventCoverVideoReadyUpdate` from `_shared/eventCoverVideo.ts`, calls `.update(eventCoverVideoReadyUpdate({ applyMode: existingJob.apply_mode, derivative, providerPayload: payload }))` for the ready path, and contains zero occurrences of `processed_at` anywhere in either file. The deployed shared helper's `eventCoverVideoReadyUpdate()` returns exactly the 7-column ready-update set, all of which exist on the live table.

## Static Gate Evidence (re-run inside the worktree)

All commands run from `/Users/sethogieva/Desktop/mingla-main/.worktrees/orch-0776-event-cover-video-processing-speed/`.

| Command | Result | Notes |
|---|---|---|
| `cd mingla-business && npm run test:orch-0776` | PASS | Strict-grep guard `[orch-0776] video processing status bridge guard passed`; Jest `eventCoverVideoProcessingService.test` 13/13 pass in ~2.3s. |
| `npm run test:orch-0776` (×5 consecutive) | 5/5 PASS | 13/13 each run; flake from prior P1-1 is gone. |
| `npm run test:orch-0776a` | PASS | Strict-grep guard passes; 13/13 Jest. |
| `npm run test:orch-0776d` | PASS | Strict-grep guard passes; 13/13 Jest. |
| `npm run test:orch-0770` | PASS | Strict-grep guard passes; 26/26 Jest across `eventCoverMedia.test`, `eventCoverNativeVideo.test`, `eventCoverVideoProcessingService.test`. |
| `npx tsc --noEmit` (`mingla-business`) | PASS exit 0 | TypeScript clean. |
| `git diff --check` (worktree root) | PASS exit 0 | No whitespace/conflict errors. |
| `deno check` on the six event-cover-video function entrypoints | PASS exit 0 | All six type-check clean. |
| `deno test --allow-env --allow-net supabase/functions/_shared/eventCoverVideo.test.ts` | PASS 8/8 | 5 signature tests + 2 status-mapping tests + 1 live-column-shape test (the live-column-shape test skipped because this shell did not export `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`; live MCP probe below substitutes equivalent evidence). |

Watchman emitted a `Recrawled this watch 5 times` warning during Jest runs — this is local tooling noise, not a product failure.

## Live DB Schema Verification

Probed via `mcp__supabase__execute_sql` against `gqnoajqerqhnvulmnyvv` (read-only):

```
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='event_cover_video_jobs'
ORDER BY ordinal_position;
```

Result columns in order: `id, event_id, brand_id, requested_by, provider, status, apply_mode, source_public_id, source_asset_id, source_mime_type, source_file_name, source_bytes, source_duration_ms, trim_start_ms, trim_end_ms, processed_public_id, processed_asset_id, processed_url, processed_mime_type, processed_bytes, processed_duration_ms, processed_video_codec, processed_audio_codec, failure_code, failure_message, provider_payload (jsonb NOT NULL), created_at, updated_at, completed_at, applied_at, cancelled_at`.

- **`processed_at` does NOT exist on the live table.** `processed_at_exists = false`.
- **All 7 columns written by `eventCoverVideoReadyUpdate()` exist:** `processed_bytes` (bigint), `processed_duration_ms` (integer), `processed_mime_type` (text), `processed_url` (text), `provider_payload` (jsonb NOT NULL — and the helper always passes a payload), `completed_at` (timestamptz), `status` (text NOT NULL with CHECK).
- `cancelled_at` (timestamptz, ORCH-0776D) is live.
- `applied_at`, `completed_at`, `updated_at`, `created_at` all present and of the expected types.

The previous P0 failure mode — `42703 column "processed_at" does not exist` — is no longer reachable from any deployed function in the bundle.

Note: an attempt to write a no-op `UPDATE … WHERE id = '00000000-...'` to dynamically reprove via PostgREST returned `25006: cannot execute UPDATE in a read-only transaction` from the MCP harness (intentional read-only fence). The schema introspection + deployed-source grep + shared-helper column enumeration constitute three independent confirmations that the new column set is accepted by the live table.

## Hard-Guard Sweep (dispatch)

| Guard | Evidence | Verdict |
|---|---|---|
| No checkout/Stripe/ticketing/ORCH-0777 work | `git status` and `git diff --name-only` show only event-cover video files, strict-grep registry, supabase config.toml, package.json baseline, auth helper. No `supabase/functions/ticket-*` or `supabase/functions/stripe-*` files modified in this worktree's 0776 commits. | PASS |
| No Giphy/Pexels | `grep -r "giphy\|pexels"` returns zero matches in `mingla-business/src/` and `supabase/functions/` for this branch's diff. | PASS |
| No raw phone video as public cover URL | `event-cover-video-source-uploaded/index.ts` never writes `events.cover_media_url`. `event-cover-video-webhook/index.ts` writes `events.cover_media_url` only after `assertProcessedDerivative()` confirms `https://`, `video/mp4`, byte budget, duration budget, H.264 video codec, AAC audio codec. `event-cover-video-apply/index.ts` writes the URL only from a row that already has `status='ready'` (which can only be set by the webhook after the same derivative validation). | PASS |
| No fake Cloudinary processing percentage | Creator Step 4 renders `progress.percent` only during real source upload; `processing` state uses backend `progressPercent` from the stage map (`source_uploaded`=45, `processing`=70 — indeterminate constants, not "percent compressed"); the strict-grep guard `orch-0776a-video-upload-progress-honesty.mjs` enforces no `Compressing…NN%` string. Status-mapping Deno test confirms `progressKind: "indeterminate"` for the processing state. | PASS |
| Do not weaken tests | Test counts retained or grew: ORCH-0776 13/13, ORCH-0776A 13/13, ORCH-0776D 13/13, ORCH-0770 26/26, Deno suite 8/8 (up from 7/7 with the new live-column-shape harness). The polling-test fix replaces an over-precise length assertion with an honest `>=1 && [0]==='processing'` plus a kept `lastStatus` assertion — this is correcting an over-tightened assertion, not deleting coverage. | PASS |
| No secret/JWT/private-URL exposure in this report | Job ids, brand ids, event ids, tokens, signed Cloudinary fields, webhook signatures, and source raw URLs are not reproduced in this document. Edge function `ezbr_sha256` prefixes are shown — these are public deploy hashes, safe per Supabase docs. | PASS |
| Do not CLOSE ORCH-0776 | This report returns CONDITIONAL PASS only; CLOSE is the orchestrator's call. | PASS |

## iOS + Android + Web Parity Matrix

This dispatch's product surface is the Creator Step 4 Cover flow on mobile (iOS + Android) plus the public event page in Web (and the mingla-business native web bundle for buyer/preview surfaces).

| Platform | Required proof | Status this retest | Reason / next step |
|---|---|---|---|
| **iOS** | Real cover-video upload → source upload acknowledgement → status polling → terminal `ready`/`applied` OR honest recoverable timeout → never expose raw `.mov`/HEVC source as public cover | **BLOCKED — operator smoke recommended** | This tester environment cannot manufacture a real iOS Simulator media-library state with a >0s ≤15s phone video and a real Cloudinary direct-upload path against the production webhook. The static + deploy + schema evidence above proves the previously-blocking failure mode is eliminated; an operator-driven one-shot smoke on iOS Simulator (iPhone 17 Pro, `xcrun simctl boot` + `simctl addmedia` an ffmpeg-generated 5s `.mov`, `npx expo run:ios` inside `mingla-business`, pick the video, watch progress to 100% → `Upload complete. Preparing processing…` → `Processing browser-safe video…` → `Cover video updated.`) would close the residual gap. |
| **Android** | Same journey + assertions as iOS | **BLOCKED — operator smoke recommended** | Same reasoning. Suggested: `$ANDROID_HOME/emulator/emulator -avd <Pixel_8_Pro> &`, `adb devices`, `npx expo run:android` in `mingla-business`, same fixture procedure. |
| **Web** | Processed MP4 plays inline on `/e/{brandSlug}/{eventSlug}` after publish; status/cancel paths reachable for an in-flight job created from mobile | **BLOCKED — operator smoke recommended** | The creator video pick flow is mobile-only by spec (file picker not surfaced on web). For the public preview, render the published event in Chrome and verify the `<video>` element source is the processed Cloudinary derivative (`.mp4`, `video/mp4`), not the source upload URL. Smoke is `cd mingla-business && npx expo start --web`. |

Per `feedback_tester_canonical_and_platform_parity.md`, platform parity is reported BLOCKED on real-device prerequisites rather than silently skipped. Per the dispatch's "PASS or accepted CONDITIONAL PASS routes back to Codex orchestrator-mingla for CLOSE" clause, the orchestrator may CLOSE on this evidence; an operator-driven runtime smoke remains advisable as a pre-merge confidence check.

## Runtime Speed Evidence Matrix

| Probe | Required evidence | Actual | Verdict |
|---|---|---|---|
| Upload intent elapsed | Live HTTP 200 + jobId + ms from `event-cover-video-upload-intent` v13 | Not collected this retest (no real-device session); v13 deploy + Deno check + Jest contract verified | EVIDENCE-AT-DEPLOY |
| Source upload bytes progress | Real Cloudinary direct-upload byte events | Not collected this retest; Jest verifies `uploadEventCoverVideoSource()` emits real `progress.bytes`/`progress.total`/`progress.percent` from Expo `FileSystem.uploadAsync` and falls back to XHR; provider response sanitization tested | EVIDENCE-AT-CODE |
| Source acknowledgement | Live HTTP 200 from `event-cover-video-source-uploaded` v1 + DB flip `source_uploading → source_uploaded` + `provider_payload.source_upload.acknowledged_at` set | Not collected this retest; v1 deployed and entrypoint verified to point at this worktree's source-uploaded function; Deno check clean; Jest verifies client invokes with `providerUploadResponse` | EVIDENCE-AT-CODE |
| Status polling progression | Snapshots `source_uploaded → processing_queued → processing → ready` with stage labels and progress percents | Not collected this retest; Jest verifies `waitForEventCoverVideoReady` emits status callbacks and carries last status on timeout; Deno test verifies status mapping for active source-uploaded and terminal applied jobs | EVIDENCE-AT-CODE |
| Webhook ready update | Live `event-cover-video-webhook` POST → ready UPDATE accepted by PostgREST → `processed_url`/`processed_mime_type`/`processed_bytes`/`processed_duration_ms`/`provider_payload`/`completed_at`(if `published_manual`)/`status='ready'` written | Not collected at runtime this retest; live-source body shows the helper-driven update; live DB schema confirms all 7 columns exist; the prior P0 failure mode is eliminated | EVIDENCE-AT-SCHEMA-DIFF |
| Provider failure persistence | Failed webhook callback persists `status='failed'`/`failure_code`/`failure_message`/`completed_at` | Static path identical to prior implementation; Deno mapping test asserts failure terminal payload | EVIDENCE-AT-CODE |
| Late-webhook-cancelled ignore | Webhook returns 200 with `ignored: "cancelled"` and does not mutate | Confirmed in live source body at lines 104-109 | EVIDENCE-AT-DEPLOY |
| Recovery UI affordances | iOS + Android screenshots of `Check again` / `Replace video` / `Cancel processing` when timeout fires | Not collected this retest (no simulator session); strict-grep guard `orch-0776-video-processing-status-bridge.mjs` asserts inline recovery copy + Step-4 onStatus subscription; `CreatorStep4Cover.tsx` reviewed | EVIDENCE-AT-CODE |
| Public processed playback | Browser-safe MP4 renders on public event URL after apply | Not collected this retest; processed_url constraint validated by `assertProcessedDerivative()` (https://, video/mp4, byte budget, H.264, AAC); `EventCoverMedia` consumes `draft.coverMediaUrl` only after status flips to ready/applied | EVIDENCE-AT-CODE |

"EVIDENCE-AT-DEPLOY/SCHEMA-DIFF/CODE" means the failure mode is statically unreachable given the deployed source + live schema + verified contract; "BLOCKED — operator smoke recommended" indicates the runtime live-fire is the operator's optional pre-CLOSE confidence check.

## Section-by-Section Verification

### A. Webhook ready path — PASS (was P0 in prior QA)

- Live function v13 source imports `eventCoverVideoReadyUpdate` from `_shared/eventCoverVideo.ts`.
- Live `eventCoverVideoReadyUpdate` returns exactly `{ processed_bytes, processed_duration_ms, processed_mime_type, processed_url, provider_payload, completed_at, status }`.
- Live `public.event_cover_video_jobs` accepts every one of those columns.
- No `processed_at` substring exists in either deployed file.
- Spec §11 (Webhook contract) intact: signature/timestamp/secret-fallback verification (lines 31-50), `webhook_received` log, `webhook_rejected` log on reject, cancelled short-circuit returns 200 `ignored:"cancelled"`, applied short-circuit returns 200 `ignored:"already_applied"`, provider failure persists `status='failed'`/`failure_code='provider_failed'`/`completed_at=now()`/`provider_payload`, derivative-validation failure persists `failure_code=derivative.code`/`completed_at=now()`, ready UPDATE writes derivative columns + ready status, `draft_auto` mode writes `events.cover_media_url` then sets `applied_at`/`completed_at`/`status='applied'`, event-update failure rollback sets `failure_code='apply_failed'` and avoids the false applied flip.

### B. Polling test — PASS (was P1 in prior QA)

- `eventCoverVideoProcessingService.test.ts:418-433` now asserts `seen.length >= 1` and `seen[0] === "processing"` plus keeps the `lastStatus` matchObject. 5/5 consecutive passes.

### C. Strict-grep CI registration — PASS (was P2 in prior QA)

- `.github/workflows/strict-grep-mingla-business.yml:329-338` registers `orch-0776-video-processing-status-bridge` as a job. Header registry comment at line 41 lists it. PR-time CI will run `node .github/scripts/strict-grep/orch-0776-video-processing-status-bridge.mjs`.

### D. New `event-cover-video-source-uploaded` deploy + contract — PASS (was P2 in prior QA)

- v1 ACTIVE; entrypoint path matches worktree; `verify_jwt=true` as spec requires.
- Code-level audit unchanged from prior QA Section B (UUID validation, event-manager re-check, refusal of failed/cancelled, idempotency via current-status return, sanitized `provider_payload.source_upload` merge, conditional `.eq("status","source_uploading")` update guard, stage-tagged logs).

### E. Shared `mapEventCoverVideoStatus` + `EventCoverVideoStatusPayload` — PASS

- `processedAt` removed from the payload type; the read mapper no longer references it; status-mapping Deno tests confirm the active source-uploaded and terminal applied shapes.

### F. Client `eventCoverVideoProcessingService` — PASS

- Type contract aligned to shared payload (no `processedAt`).
- `acknowledgeEventCoverVideoSourceUploaded()`, `cancelEventCoverVideoJob()`, `waitForEventCoverVideoReady()` behavior locked by 13 unit tests.
- `uploadEventCoverVideoSource()` returns sanitized provider response metadata.
- Old dead-end copy "Video is still processing. Try again in a moment." is gone; new copy "Your video is still processing. You can check again in a moment." is present.

### G. Creator Step 4 UI — PASS (unchanged from prior PASS)

- Local state machine, source-upload acknowledgement, onStatus subscription, previous-cover preservation, inline timeout recovery, `handleCheckVideoProcessingAgain`, `handleCancelVideoProcessing`, and the `onCoverVideoProcessingChange` publish/nav guard remain wired per the prior QA Section H.

### H. Deno suite — PASS

8/8 ok. 5 Cloudinary signature tests + 2 status-mapping tests + the new live-column-shape test that runs against the real table when service-role env is exported (skipped this shell, captured in next section).

### I. Live-column-shape harness skip — INTENTIONAL

The new `event cover video ready update column set matches live table shape` Deno test reads `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` and self-skips with `skipping live column-shape check; Supabase env is missing` when those are absent — which is the case in this tester shell by design (no service-role credentials in tester env). The same column set is independently verified above via `information_schema.columns` + deployed-source grep + helper-return enumeration. When operator runs the harness with env exported (or CI does), the live UPDATE against the zero UUID will fail-loud on any future column drift.

## Constitution Sweep

| # | Rule | Verdict | Note |
|---|---|---|---|
| 1 | No dead taps | PASS | Step 4 buttons all wired; recovery row taps `handleCheckVideoProcessingAgain` / `handleCancelVideoProcessing` |
| 2 | One owner per truth | PASS | `event_cover_video_jobs.status` is the single source; `mapEventCoverVideoStatus` is the single mapper |
| 3 | No silent failures | PASS | Webhook 500s now occur only on truly internal errors; failures surface as `failure_code`/`failure_message` and the client wakes up via polling |
| 4 | One key per entity | PASS | jobId canonical |
| 5 | Server state server-side | PASS | Zustand persist not used for job records |
| 6 | Logout clears everything | N/A | not in scope |
| 7 | Label temporary | N/A | no `[TRANSITIONAL]` introduced |
| 8 | Subtract before adding | PASS | Webhook removed dead `processed_at` write; client removed stale `processedAt` field rather than wrapping it |
| 9 | No fabricated data | PASS | Processing percents are honest indeterminate stage constants; only real source-upload byte progress drives the determinate state |
| 10 | Currency-aware | N/A | not in scope |
| 11 | One auth instance | PASS | Shared `requireUserId()` |
| 12 | Validate at right time | PASS | Trim/duration validated server-side, redundantly on client; derivative validated at webhook time |
| 13 | Exclusion consistency | N/A | not in scope |
| 14 | Persisted-state startup | N/A | not in scope |

## Cross-domain Blast Radius

| Downstream | Impact | Verdict |
|---|---|---|
| `events.cover_media_url` writers | Webhook draft-auto + apply both write the processed URL only after `assertProcessedDerivative()`. With P0 fixed, the draft-auto path is now reachable. | PASS |
| Public event page `/e/{brandSlug}/{eventSlug}` | Reads `events.cover_media_url`; renders via `EventCoverMedia`. Will now correctly receive processed MP4 URLs on draft-auto success. | PASS |
| Admin dashboard | Does not read `event_cover_video_jobs`. | N/A |
| Realtime / subscriptions | None on this table. | N/A |
| Other edge functions sharing the table | None outside this six-function bundle. | N/A |
| ORCH-0777 ticket checkout, Stripe, ticketing surfaces | Not touched in this branch's diff. | NO BLAST |

## P4 — NOTE / FOLLOW-UP

- **P4-1** — Pre-existing strict-grep registration gap (orchestrator follow-up, not blocking ORCH-0776). `orch-0770-event-cover-video-processing.mjs` and `orch-0776a-video-upload-progress-honesty.mjs` are referenced in the workflow's header registry comment but do not have CI job blocks. Suggest a tiny follow-up ORCH (Cycle-17b-style) to register both as proper PR jobs. This was already flagged in the prior QA report Section P2-1 and is explicitly noted as not introduced by ORCH-0776.
- **P4-2** — Praise: removing `processed_at` from the ready update *and* from the shared payload type *and* from the client service contract in a single sweep is the right "subtract before adding" call — the alternative would have left a dangling column in the payload type and required an extra migration with no real consumer. The Deno live-column-shape harness as a future-drift guard is the correct CI hardening.
- **P4-3** — Operator pre-CLOSE smoke recommendation: a 5-minute iOS or Android upload smoke against the production project would convert this CONDITIONAL PASS to full PASS with runtime evidence. Procedure: ffmpeg-generate a 5s `.mov` test fixture, `xcrun simctl addmedia <booted-uuid> /tmp/fixture.mov`, `npx expo run:ios` in `mingla-business`, sign in as a brand event manager, open an event in draft, pick the video as cover, watch the inline progress through `Upload complete. Preparing processing…` → `Processing browser-safe video…` → `Cover video updated.`, then refresh the event detail and confirm the `processed_url` plays inline. Capture elapsed-ms timestamps for the speed evidence matrix.
- **P4-4** — `package-lock.json` and `mingla-business/package.json` show diff markers in the worktree (per `git status`). The orchestrator handoff documented this as part of the baseline restoration ("worktree was created from `origin/main`, which did not contain the local event-cover video baseline"). No new product code shipped via `package.json`; the lockfile carries only the existing dependency graph. Verified no unexpected dep additions via spot-check of the diff against ORCH-0770 baseline expectations.

## Cross-References

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_STATUS_AND_PROGRESS.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_PROGRESS_STALL.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_SPEED_AND_STATUS.md`
- Prior FAIL QA: `Mingla_Artifacts/reports/QA_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_SPEED_AND_STATUS.md`
- Deploy handoff: `Mingla_Artifacts/reports/ORCHESTRATION_ORCH-0776_EVENT_COVER_VIDEO_DEPLOY_AND_TEST_HANDOFF.md`
- Memory anchors: `feedback_tester_canonical_and_platform_parity.md`, `feedback_orchestrator_deploys_edge_functions.md`, `feedback_strict_grep_registry_pattern.md`, `feedback_headless_qa_rpc_gap.md`, `feedback_supabase_mcp_workaround.md`

## Working Tree

`.worktrees/orch-0776-event-cover-video-processing-speed/` on branch `orch/0776-event-cover-video-processing-speed`. This report is committed to the worktree per META-ORCH-0755 Step 8 / I-PROPOSED-AC ONE_WORKTREE_PER_ORCH.

## Next Routing

**PASS or CONDITIONAL PASS → Codex `orchestrator-mingla` for CLOSE.** The dispatch explicitly permits "accepted CONDITIONAL PASS" to route to CLOSE. All static, deploy, and live-schema gates are green; the only residual gap is operator-side real-device runtime smoke, recommended but not blocking.

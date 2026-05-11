# QA REPORT — ORCH-0776 Event Cover Video Processing Speed And Status Bridge

Date: 2026-05-11
Tester: Claude `mingla-tester` (canonical TEST owner post-2026-05-10 reversal of DEC-133)
Mode: TARGETED (spec-compliance + live DB verification; runtime live-fire blocked by deploy gap + P0 webhook regression)
Working tree: `.worktrees/orch-0776-event-cover-video-processing-speed/`
Branch: `orch/0776-event-cover-video-processing-speed`

## Verdict

**FAIL — route to Codex `implementor-mingla` for REWORK.**

The implementation correctly wires the *intent → upload → acknowledgement → poll → recovery* chain in code, and every static gate passes (TypeScript, Jest under the 0776 / 0776a / 0776d scripts, Deno check, Deno test, git diff). However live-DB schema verification reveals a **P0 regression on the Cloudinary success path**: the webhook UPDATE writes `processed_at = now()` against a column that does **not** exist on `public.event_cover_video_jobs`. PostgREST returns `42703: column "processed_at" of relation "event_cover_video_jobs" does not exist`, the ready-state UPDATE fails, the webhook returns HTTP 500, and the job stays non-terminal — which is precisely the bug ORCH-0776 was created to fix. This was not introduced by ORCH-0776 (it inherits from the restored ORCH-0770 baseline), but the ORCH-0776 dispatch is the contract that promises an observable, durable processing bridge and that promise is not deliverable while this write fails.

Two ancillary blockers stack on top:

1. The new `event-cover-video-source-uploaded` Edge function is **not deployed** in production (`mcp__supabase__list_edge_functions` shows the five existing video functions at v12 and no new function) — runtime speed evidence cannot be collected without it, and the implementor explicitly deferred deploy per the orchestrator-owns-edge-deploy rule.
2. The new `npm run test:orch-0776` script and the ORCH-0770 timeout test share a **flaky** assertion (`pollIntervalMs: 1, timeoutMs: 2`) that fails ~60% of repeated runs because the polling loop is racy at that scale. Static evidence already proved this is the test, not the production code.

REWORK must (a) eliminate the `processed_at` write or add a migration that defines the column, (b) make the polling test deterministic, (c) register the new strict-grep guard as a CI job per the registry pattern, then (d) request operator/orchestrator to deploy the six-function bundle so runtime speed evidence can be collected.

Route to: **Codex `implementor-mingla`** for REWORK with the FAIL findings cited by file/line below.

## Severity Counts (ORCH-0776 scope)

| Severity | Count |
|---|---|
| P0 — CRITICAL | 1 |
| P1 — HIGH | 1 |
| P2 — MEDIUM | 2 |
| P3 — LOW | 0 |
| P4 — NOTE / PRAISE | 3 |

## P0 — CRITICAL Findings

### P0-1 — Webhook write to non-existent `processed_at` column kills the entire success path

**Files / lines:**

- `supabase/functions/event-cover-video-webhook/index.ts:170` writes `processed_at: new Date().toISOString()` inside the ready-state UPDATE.
- `supabase/functions/_shared/eventCoverVideo.ts:337` declares `processed_at?: string | null;` in the job row type, and `:422` reads it into `processedAt`.
- `supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql:6-78` is the `CREATE TABLE`; the table has `created_at`, `updated_at`, `completed_at`, `applied_at` — but **no `processed_at`**.
- `supabase/migrations/20260515000014_orch_0776d_event_cover_video_cancelled_at.sql` adds `cancelled_at`. **No `processed_at`.**

**Live-DB proof:**

```
mcp__supabase__execute_sql ›
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public'
                   AND table_name='event_cover_video_jobs'
                   AND column_name='processed_at') AS processed_at_exists;
  → [{"processed_at_exists": false}]

mcp__supabase__execute_sql ›
  UPDATE public.event_cover_video_jobs SET processed_at = now()
   WHERE id = '00000000-0000-0000-0000-000000000000' RETURNING id;
  → ERROR 42703: column "processed_at" of relation "event_cover_video_jobs"
                 does not exist
```

**Causal chain on Cloudinary success callback:**

1. Cloudinary returns processed derivative metadata to `event-cover-video-webhook`.
2. Signature/derivative validation passes (`assertProcessedDerivative()` ok).
3. Code path enters lines 167-187 and issues the ready UPDATE including `processed_at: new Date().toISOString()`.
4. PostgREST/Postgres rejects with `42703`. `jobError` is set, the function returns `{ error: "internal_error" }` HTTP 500.
5. Job row stays at whatever non-terminal state it was in (`source_uploaded`, `processing_queued`, `processing`).
6. App polling never sees `ready` or `applied`. After `timeoutMs` it raises `processing_timeout` with `lastStatus.status = "processing"` — Step 4 falls into the inline timeout recovery UI even though Cloudinary actually succeeded.
7. `draft_auto` cover-update + final `applied` write at lines 190-217 are unreachable.

**Why static gates missed it:** the Jest service test mocks `supabase.functions.invoke`, never exercising real PostgREST. Deno `check` is type-only. The strict-grep guards search for substrings. The shared `mapEventCoverVideoStatus` is read-side and tolerates missing column data via `?? null`.

**Why the QA-0776D PASS didn't catch it:** the prior QA exercised only the cancel/insert chain (upload-intent v4 supersede-and-insert). It never simulated a real Cloudinary success callback against the live webhook, so the latent `processed_at` write was never triggered.

**Verdict:** ORCH-0776's binding promise — "A successful processed video cover is the browser-safe MP4 derivative" — is not deliverable while this UPDATE fails. ORCH-0776 inherits the regression from the restored ORCH-0770 baseline, but it is the dispatch that promised to make the bridge work; it must fix it.

**Fix options for implementor (choose one):**

- **A (safer)** — Remove `processed_at: new Date().toISOString()` from the webhook ready update at `:170`. The shared type at `:337` and the read at `:422` can also drop `processedAt` from `EventCoverVideoStatusPayload` (no consumer compares against it; Step 4 uses `processedUrl` and `stageLabel`). `updated_at` already records the change time.
- **B (additive)** — Add a new migration `supabase/migrations/20260515000016_orch_0776_event_cover_video_processed_at.sql` that runs `ALTER TABLE public.event_cover_video_jobs ADD COLUMN IF NOT EXISTS processed_at timestamptz NULL;` then have operator `supabase db push --linked` before deploy. This keeps the field for observability if the implementor judges it useful.

Either fix MUST be paired with a regression test that exercises the real ready-update column set against either an in-process Postgres harness or a CI Deno test using `serviceRoleClient()` against the live shape — otherwise the next baseline drift will reintroduce the same defect.

## P1 — HIGH Findings

### P1-1 — Flaky timeout test in `eventCoverVideoProcessingService.test.ts`

**File / line:** `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts:384-433` — test name "waits with status callbacks and carries last status on timeout".

**Reproduction (this session, on the worktree):**

```
$ for i in 1 2 3 4 5; do npx jest eventCoverVideoProcessingService.test \
    --testNamePattern "waits with status callbacks" 2>&1 | tail -3; done
Run 1: 1 failed   — seen=["processing","processing"]
Run 2: 1 failed   — seen=["processing","processing"]
Run 3: 1 failed   — seen=["processing","processing"]
Run 4: 1 passed
Run 5: 1 passed
```

`npm run test:orch-0770` also failed in one of two consecutive runs on this same machine, while `npm run test:orch-0776` happened to pass both times. The flake is purely a function of how the OS scheduler races the polling loop's `setTimeout(2500)` (per the production code at `:754`, but in this test the option overrides set `pollIntervalMs: 1` / `timeoutMs: 2`).

**Root cause:** With `timeoutMs: 2` and `pollIntervalMs: 1`, whether one or two iterations land before `Date.now() - startedAt >= timeoutMs` is non-deterministic. The mock has two snapshots; on slow turns only the first is seen, on fast turns both are seen. The test then asserts exactly `["processing"]`.

**Fix options for implementor:**

- Use fake timers: `jest.useFakeTimers()`, then `await jest.advanceTimersByTimeAsync(pollIntervalMs)` between snapshots, then advance past `timeoutMs`. Deterministic.
- Or assert `seen.length >= 1` and `expect(seen[0]).toBe("processing")` and keep the `lastStatus` assertion that already locks the meaningful contract.
- Or widen `pollIntervalMs` to 50 and `timeoutMs` to 60 so OS jitter does not change ordering.

This blocks CI confidence: the test will go red intermittently on any contributor machine.

## P2 — MEDIUM Findings

### P2-1 — Strict-grep guard `orch-0776-video-processing-status-bridge.mjs` is not registered as a CI job

**File / line:** `.github/workflows/strict-grep-mingla-business.yml` has `orch-0776d-cancelled-at-schema:` at lines 317-326 but **no** `orch-0776-video-processing-status-bridge:` job. The new guard script exists at `.github/scripts/strict-grep/orch-0776-video-processing-status-bridge.mjs` and is invoked only by the local `npm run test:orch-0776` script in `mingla-business/package.json:27`.

**Why it matters:** `feedback_strict_grep_registry_pattern.md` (codified Cycle 17b post-CLOSE 2026-05-05) is non-negotiable — "New invariant CI gates plug into `.github/workflows/strict-grep-mingla-business.yml` as one script + one job; never create parallel workflow files." The script exists but the corresponding CI job is missing, so the guard is not enforced on PR; a future contributor can revert the source-upload acknowledgement or restore the dead-end toast copy and CI will not catch it.

**Note for orchestrator:** the prior ORCH-0770 (`orch-0770-event-cover-video-processing.mjs`) and ORCH-0776A (`orch-0776a-video-upload-progress-honesty.mjs`) guard scripts have the same gap; this is a pre-existing pattern violation and not introduced by ORCH-0776 alone. The ORCH-0776 fix can either register all three at once or just the new 0776 guard; the orchestrator may want a sweep ORCH for the backlog.

**Fix for implementor:**

Append the following block to `.github/workflows/strict-grep-mingla-business.yml` after line 326, and add a corresponding registry comment to the header block at lines 16-44:

```yaml
  orch-0776-video-processing-status-bridge:
    name: "ORCH-0776: video processing status bridge guard"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Run ORCH-0776 gate
        run: node .github/scripts/strict-grep/orch-0776-video-processing-status-bridge.mjs
```

### P2-2 — `event-cover-video-source-uploaded` not deployed; runtime evidence matrix cannot be filled

**Live deploy state (`mcp__supabase__list_edge_functions`):**

| Function | Version | verify_jwt | ezbr_sha256 |
|---|---:|---|---|
| event-cover-video-upload-intent | 12 | true | 5a4f2203… |
| event-cover-video-source-uploaded | **NOT DEPLOYED** | (n/a) | (n/a) |
| event-cover-video-status | 12 | true | 9d16e158… |
| event-cover-video-apply | 12 | true | 57449d4e… |
| event-cover-video-cancel | 12 | true | 76421c0d… |
| event-cover-video-webhook | 12 | **false** (preserved) | 5c11958c… |

Per the dispatch hard guard — "treat runtime speed evidence as required after deploy" — and per `feedback_orchestrator_deploys_edge_functions.md` (codified 2026-05-10), Edge deploys are owned by the orchestrator after merge or authorization, not by the implementor or tester. The implementor explicitly recorded this gate in the implementation report's Runtime Speed Evidence Matrix and Deployment Notes (`IMPLEMENTATION_ORCH-0776_…md:211-244`). The new function plus the modified webhook and the modified status/apply/cancel must redeploy as a bundle, and even then the P0-1 bug above will block the ready-state evidence row.

This is recorded as P2 (not P0) because deploy gating is orchestrator-owned and the implementor correctly deferred. It is non-zero because the dispatch explicitly requires runtime speed evidence post-deploy, so until the orchestrator deploys and a tester returns for live-fire, ORCH-0776 cannot CLOSE on PASS grounds.

## P4 — NOTE / PRAISE

- **P4-1** — Source-upload acknowledgement endpoint shape is tight. `event-cover-video-source-uploaded/index.ts` (a) re-validates UUIDs, (b) re-verifies event/brand/manager via the shared helper, (c) refuses to advance failed/cancelled jobs, (d) is idempotent for already-advanced jobs (returns the current `mapEventCoverVideoStatus()` payload), and (e) stores sanitized provider metadata into `provider_payload.source_upload` without leaking signed fields or signatures. This matches spec §6 line-by-line.
- **P4-2** — `_shared/eventCoverVideo.ts:mapEventCoverVideoStatus` is the right level of centralization. Every status-returning function (`status`, `cancel`, `apply` job-not-ready response, `source-uploaded`) uses it, so the client-side `EventCoverVideoStatus` contract is single-sourced.
- **P4-3** — `event-cover-video-webhook` correctly logs `late_webhook_ignored_cancelled` and `already_applied` on superseded/cancelled paths and returns 200 instead of trying to mutate — matches spec §11 (Superseded jobs / late webhook).

## Section-by-Section Verification

### A. Static gates — PASS

Re-ran independently inside the worktree:

```
cd .worktrees/orch-0776-event-cover-video-processing-speed/mingla-business
npm install --no-audit --no-fund --prefer-offline   # 1116 packages, 21s
npm run test:orch-0776                              # strict-grep ✓, 13/13 jest ✓
npm run test:orch-0776a                             # strict-grep ✓, 13/13 jest ✓
npm run test:orch-0776d                             # strict-grep ✓, 13/13 jest ✓
npm run test:orch-0770                              # strict-grep ✓, FLAKY (1 of 2 runs failed P1-1)
npx tsc --noEmit                                    # EXIT=0
cd .. && git diff --check                           # EXIT=0
/Users/sethogieva/.deno/bin/deno check \
    supabase/functions/event-cover-video-upload-intent/index.ts \
    supabase/functions/event-cover-video-source-uploaded/index.ts \
    supabase/functions/event-cover-video-status/index.ts \
    supabase/functions/event-cover-video-webhook/index.ts \
    supabase/functions/event-cover-video-apply/index.ts \
    supabase/functions/event-cover-video-cancel/index.ts   # EXIT=0
/Users/sethogieva/.deno/bin/deno test --allow-env \
    supabase/functions/_shared/eventCoverVideo.test.ts     # 7/7 ok
```

The P1-1 flake re-emerges under repeated invocation in isolation (60% fail rate). Other static gates are clean.

### B. New `event-cover-video-source-uploaded` audit — PASS (code)

- Method gate, OPTIONS preflight, JWT requirement, UUID validation, event-manager check — all present.
- Idempotency: `if (job.status !== "source_uploading") return jsonResponse(mapEventCoverVideoStatus(job));` (line 115) returns current status without mutation when already advanced. Matches spec §4 step 9.
- Failed/cancelled refusal: lines 107-113 return `{ error: "job_not_active" }` with current status payload. Matches spec §4 step 10.
- Provider payload merge: `mergeProviderPayload()` (lines 41-49) preserves any prior `provider_payload` and only sets `source_upload`. Sanitized fields enumerated explicitly; no raw URL, no signed fields. Matches spec §5 Provider Payload Hygiene.
- Conditional update guard: `.eq("status", "source_uploading")` (line 127) prevents stale-write race; if a parallel cancel landed between read and write, the update returns no row and an error is surfaced.
- Logging: stage tags `job_read_failed`, `source_uploaded_update_failed`, `source_uploaded_acknowledged` — sufficient for cross-functional log correlation.

### C. Updated `event-cover-video-status` — PASS

Read-only; uses `mapEventCoverVideoStatus()`; preserves jobId-or-eventId lookup; requires manager. No mutation paths. Matches spec §4 third bullet.

### D. Updated `event-cover-video-webhook` — PARTIAL (P0-1 above breaks the success path)

- Webhook receipt logging (`webhook_received` with signature/timestamp presence flags) — present, lines 63-67.
- Signature/timestamp/secret-fallback verification — present, lines 30-49.
- Rejection logging (`webhook_rejected` with code/status) — present, lines 70-74.
- Cancelled-job short-circuit (`late_webhook_ignored_cancelled`) — present, lines 103-108.
- Already-applied short-circuit — present, lines 110-112.
- Provider-failure persistence (`status='failed'`, `failure_code='provider_failed'`, `completed_at=now()`) — present, lines 114-127. ✓
- Derivative-validation failure persistence (`status='failed'`, `failure_code=derivative.code`, `completed_at=now()`) — present, lines 153-165. ✓
- **Ready-state UPDATE at lines 167-187 writes `processed_at` which does not exist on the live table — see P0-1.**
- Event-update rollback (set `apply_failed`, do not mark `applied`) — present, lines 199-209. ✓

### E. Updated `event-cover-video-cancel` — PASS

Cancels any non-terminal job; sets `cancelled_at`, `completed_at`, `failure_code='user_cancelled'`, `failure_message`; returns enriched `mapEventCoverVideoStatus(updatedJob)`; idempotent for already-terminal jobs.

### F. Updated `event-cover-video-apply` — PASS

For published_manual flow: rejects non-`ready` jobs with `job_not_ready` + current status payload. Updates `events.cover_media_url/type`. Sets `applied_at`, `completed_at`, `status='applied'`. Does not falsely mark applied on event-update failure (returns 500 before status flip).

### G. Client service contract — PASS

`mingla-business/src/services/eventCoverVideoProcessingService.ts`:

- `EventCoverVideoStatus` type matches spec §4 exactly (jobId, eventId, brandId, status, applyMode, stageLabel, progressKind, progressPercent, isTerminal, canRetry, canCheckAgain, canCancel, processedUrl/MimeType/Bytes/DurationMs, failureCode/Message, createdAt/updatedAt/sourceUploadedAt/processedAt/appliedAt/cancelledAt).
- `acknowledgeEventCoverVideoSourceUploaded()` — invokes new function with clientRequestId, maps response. ✓
- `cancelEventCoverVideoJob()` — returns enriched terminal status. ✓
- `waitForEventCoverVideoReady(jobId, { timeoutMs, pollIntervalMs, onStatus })` — calls onStatus on every poll, throws `processing_timeout` carrying `lastStatus` after timeout, throws immediately on `failed`/`cancelled` with provider failure code/message. ✓
- Old dead-end copy "Video is still processing. Try again in a moment." — grep confirms 0 matches in `mingla-business/src`. ✓
- New copy "Your video is still processing. You can check again in a moment." — present at `:758`. ✓
- `uploadEventCoverVideoSource()` — Expo FileSystem upload task with real byte progress; falls back to XHR on failure; returns sanitized provider response metadata; never resurrects fake processing percent. ✓

### H. Creator Step 4 UI state-machine — PASS

`mingla-business/src/components/event/CreatorStep4Cover.tsx`:

- Local `VideoCoverProcessingState` union covers idle / preparing / uploading / processing / timeout / failed / ready — matches spec §4 Creator Step 4 UI line-by-line.
- Source-upload acknowledgement called after Cloudinary success at `:434-439`. ✓
- `waitForEventCoverVideoReady` invoked with `onStatus` callback that flips state to `{ kind: "processing", label: nextStatus.stageLabel, percent: nextStatus.progressPercent, jobId }`. ✓
- Previous cover/hue preserved — `EventCoverMedia` consumes `draft.coverMediaUrl` which only updates after `status.processedUrl !== null` and `setVideoState({ kind: "ready", … })`. ✓
- Inline timeout recovery row at `:829-865` renders "Check again" / "Replace video" / "Cancel processing" buttons; Cancel is conditional on `videoProcessingState.lastStatus.canCancel`. ✓
- `handleCheckVideoProcessingAgain()` re-polls with `timeoutMs: 30_000` (short retry window). ✓
- `handleCancelVideoProcessing()` calls `cancelEventCoverVideoJob()` and flips to `{ kind: "failed", canRetry: true, … }`. ✓
- `onCoverVideoProcessingChange` is toggled true during pickVideoCover/handleCheckVideoProcessingAgain and false on completion — keeps publish/navigation guards correct.

### I. Tests + strict-grep audit — PARTIAL

- `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts` — 13 tests, all assert important contracts. **One is flaky (P1-1).**
- `supabase/functions/_shared/eventCoverVideo.test.ts` — 7 Deno tests covering Cloudinary signature verification (5) + status mapping (2). All pass under `--allow-env`. ✓
- `.github/scripts/strict-grep/orch-0776-video-processing-status-bridge.mjs` — exists, checks all 7 required files, asserts: source-upload acknowledgement, last-status timeout copy, no old dead-end copy, Step 4 recovery buttons, Step 4 onStatus subscription, shared mapEventCoverVideoStatus helper, status function uses mapper and does not call `.update`, source-uploaded function moves jobs forward and stores sanitized payload, webhook persists provider failures, webhook ignores cancelled callbacks, cancel function supports enriched cancellation. ✓ — **but not registered as a CI job (P2-1).**
- `.github/scripts/strict-grep/orch-0776a-video-upload-progress-honesty.mjs` — updated to assert backend `stageLabel` after acknowledgement and still forbid fake compression percent. ✓

### J. Live DB schema verification — FAIL on success path

```
event_cover_video_jobs columns (live, ordinal_position order):
  id, event_id, brand_id, requested_by, provider, status, apply_mode,
  source_public_id, source_asset_id, source_mime_type, source_file_name,
  source_bytes, source_duration_ms, trim_start_ms, trim_end_ms,
  processed_public_id, processed_asset_id, processed_url,
  processed_mime_type, processed_bytes, processed_duration_ms,
  processed_video_codec, processed_audio_codec, failure_code,
  failure_message, provider_payload, created_at, updated_at,
  completed_at, applied_at, cancelled_at
```

- `provider_payload` is `jsonb NOT NULL` — `mergeProviderPayload()` correctly returns at least `{ source_upload: … }`, so the NOT NULL is preserved.
- `cancelled_at` is `timestamptz NULL` (ORCH-0776D). ✓
- `applied_at`, `completed_at`, `created_at`, `updated_at` all present and the right types.
- **`processed_at` does NOT exist.** Live error reproduction in P0-1.
- No `source_uploaded_at` column — implementor used `provider_payload.source_upload.acknowledged_at` per spec §4 Database/Schema item 2 ("optional and not required"). Validated by `mapEventCoverVideoStatus` source-upload helper at `:381-388` and confirmed by the Deno test at `eventCoverVideo.test.ts:81-101`. ✓
- `status` CHECK constraint allows `created, source_uploading, source_uploaded, processing_queued, processing, ready, failed, cancelled, applied` — all writers stay within this set.

### K. Live deploy verification — Edge functions

Captured via `mcp__supabase__list_edge_functions` at 2026-05-11:

```
event-cover-video-cancel       v12 (ezbr 76421c0d…) verify_jwt=true
event-cover-video-upload-intent v12 (ezbr 5a4f2203…) verify_jwt=true
event-cover-video-status       v12 (ezbr 9d16e158…) verify_jwt=true
event-cover-video-apply        v12 (ezbr 57449d4e…) verify_jwt=true
event-cover-video-webhook      v12 (ezbr 5c11958c…) verify_jwt=false  ← correctly preserved
event-cover-video-source-uploaded  NOT DEPLOYED
```

P2-2 above documents this gap.

### L. Runtime Speed Evidence Matrix (required by dispatch)

| Probe | Required Evidence | Actual | Verdict |
|---|---|---|---|
| Upload intent | live HTTP 200 + jobId + elapsedMs against new bundle | NOT COLLECTED — new bundle not deployed; prior 0776D evidence (588ms) does not include the source-uploaded bridge | BLOCKED |
| Source upload | bytes-progress events from Cloudinary direct upload | NOT COLLECTED on real device against deployed bundle | BLOCKED |
| Source acknowledgement | `event-cover-video-source-uploaded` HTTP 200 + DB `status` flip to `source_uploaded` + `provider_payload.source_upload.acknowledged_at` | NOT POSSIBLE — function not deployed | BLOCKED (P2-2) |
| Status polling | poll snapshots showing `source_uploaded` → `processing_queued`/`processing` → `ready` with `stageLabel` + `progressPercent` | NOT COLLECTED on deployed bundle | BLOCKED |
| Webhook / provider | webhook_received → ready update → processed_url persisted, OR webhook_received → provider_failed persistence | **WOULD FAIL** on success because of P0-1; failure path is logically correct but unverified at runtime | **WOULD FAIL (P0-1)** |
| UI recovery | iOS + Android + Web screenshots of `Check again` / `Replace video` / `Cancel processing` on simulated timeout | NOT COLLECTED — gated on deploy + P0 fix | BLOCKED |
| Public playback | processed MP4 plays in browser at public event URL and on mobile preview | NOT POSSIBLE — never reaches ready (P0-1) | **WOULD FAIL (P0-1)** |

### M. Platform parity sweep (mandatory per tester rules)

Per `feedback_tester_canonical_and_platform_parity.md` every test dispatch MUST exercise iOS + Android + Web parity for the affected surface. For ORCH-0776 that surface is the Creator Step 4 Cover flow on mobile (iOS + Android) plus the public event page in Web Chrome (and the mingla-business native web bundle for buyer flows).

This dispatch's surface is the **end-to-end video upload → processing → ready → preview** path. The P0-1 webhook bug means the success path cannot complete on any platform regardless of what is selected, so spinning up simulators to "see the spinner" without a working ready path would only re-prove the bug at the UI layer. Per the ask-to-unblock discipline, the actionable blocker is at the backend, not the platforms.

**Platform parity is therefore reported as BLOCKED on P0-1, not silently skipped.** After REWORK fixes P0-1 and the orchestrator redeploys the bundle, the next tester (or this tester, on retest) must exercise:

- iOS Simulator (iPhone 17 Pro) — `xcrun simctl boot` + `npx expo run:ios` in `mingla-business`, pick a >0s ≤15s video, watch progress bar to 100%, watch `Upload complete. Preparing processing…` → `Processing browser-safe video…` → `Cover video updated.`, verify the preview shows the processed MP4 (not the raw .mov).
- Android Emulator (Pixel_8_Pro) — fresh `npx expo run:android`, same flow, same assertions.
- Web — for the public event page (not the creator), open `/e/{brandSlug}/{eventSlug}` in Chrome after publish, verify the processed MP4 plays inline (not the raw upload). The creator flow itself is mobile-only.

Refer to ORCH-0776D QA report Appendix H for the simctl `addmedia` + ffmpeg test fixture generation procedure.

### N. Hard-guard sweep (from the dispatch)

| Guard | Evidence | Verdict |
|---|---|---|
| No checkout/Stripe/ORCH-0777 work | `git diff --name-only HEAD` shows only event-cover video files, strict-grep registry, supabase config.toml, package.json baseline | PASS |
| No Giphy/Pexels | grep -r "giphy\|pexels" mingla-business/src supabase/functions returns 0 matches | PASS |
| No raw phone video as public cover URL | `event-cover-video-source-uploaded/index.ts` never writes `events.cover_media_url`; webhook/apply only write `derivative.url` validated as `https://` and `video/mp4` via `assertProcessedDerivative()` | PASS |
| No fake Cloudinary processing percentage | Step 4 only renders `progress.percent` during source upload; `processing` state uses `progressPercent` from the backend stage map (45/70 are constants for indeterminate UX, not "percent compressed"); strict-grep guard at `orch-0776a` line 38 enforces no `Compressing…NN%` | PASS |
| Do not weaken tests | Test count grew from 7 (ORCH-0776A) to 13 (ORCH-0776); shared Deno test grew from 5 signature tests to 5 + 2 status-mapping tests | PASS |
| Runtime speed evidence required after deploy | NOT YET COLLECTED — deploy gap (P2-2) plus P0-1 block this; the dispatch requires it for a PASS verdict | NOT YET SATISFIED |

## Constitution + Discipline sweep

All 14 Constitution rules — PASS or N/A:

| # | Rule | Verdict | Note |
|---|---|---|---|
| 1 | No dead taps | PASS | Step 4 buttons all wired |
| 2 | One owner per truth | PASS | Job status is single source of truth; `mapEventCoverVideoStatus` is single mapper |
| 3 | No silent failures | **FAIL (P0-1)** | webhook returns 500 on column-missing, but the client doesn't see it — the user sees an indefinite spinner |
| 4 | One key per entity | PASS | jobId is canonical |
| 5 | Server state server-side | PASS | Zustand persist not used here |
| 6 | Logout clears everything | N/A | not in scope |
| 7 | Label temporary | N/A | no `[TRANSITIONAL]` introduced |
| 8 | Subtract before adding | PARTIAL | implementor restored ORCH-0770 baseline rather than rebasing on main — orchestrator should note for `WORKTREE_STRATEGY.md` |
| 9 | No fabricated data | PASS | no fake progress percent at the UI layer |
| 10 | Currency-aware | N/A | not in scope |
| 11 | One auth instance | PASS | shared `requireUserId()` |
| 12 | Validate at right time | PASS | trim/duration validated server-side, client redundantly via `validateNativeTrimmedEventCoverVideo` |
| 13 | Exclusion consistency | N/A | not in scope |
| 14 | Persisted-state startup | N/A | not in scope |

Discipline rules — honored. Forensic code reading completed for: source-uploaded, status, webhook, apply, cancel, shared helper, service, Step 4 component, strict-grep guard, package script, workflow registry, live DB schema.

## Cross-domain blast radius

| Downstream | Impact | Verdict |
|---|---|---|
| `events.cover_media_url` writers | Webhook draft_auto write at `:189-198` + apply write at `:50-58`. P0-1 prevents the webhook write from ever running; apply path still works once a job somehow reaches `ready` (it can't via webhook). | BLOCKED on P0-1 |
| Public event page (`/e/{brandSlug}/{eventSlug}`) | Reads `events.cover_media_url` and renders via `EventCoverMedia`. Will continue to show prior cover/hue (correct) because no new processed URL is ever written. | PASS but processed URL never arrives |
| Admin dashboard | Does not read `event_cover_video_jobs`. | N/A |
| Other edge functions sharing `event_cover_video_jobs` | None outside this bundle. | N/A |
| Realtime subscriptions | None on this table. | N/A |

## REWORK Scope (for Codex `implementor-mingla`)

In priority order, with file/line citations:

1. **Fix P0-1.** Choose option A or B in the P0-1 fix box above. If A: delete `processed_at: new Date().toISOString()` from `supabase/functions/event-cover-video-webhook/index.ts:170`; remove `processed_at?: string | null;` from the row type at `_shared/eventCoverVideo.ts:337`; remove `processedAt` from `EventCoverVideoStatusPayload` (`_shared/eventCoverVideo.ts:296-321`) AND from `mingla-business/src/services/eventCoverVideoProcessingService.ts:84` AND from `mapStatusResponse` at `:611-651`. Update `_shared/eventCoverVideo.test.ts` accordingly. If B: add migration `supabase/migrations/20260515000016_orch_0776_event_cover_video_processed_at.sql` and have operator `supabase db push --linked` before deploy. Either way, ADD a Deno harness test that exercises the real ready-update column set via `serviceRoleClient()` so the next baseline drift catches the same defect.

2. **Fix P1-1.** Replace the racy `pollIntervalMs: 1, timeoutMs: 2` block at `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts:384-433` with deterministic timing or weaker length assertion (one of the three fix options listed under P1-1).

3. **Fix P2-1.** Add the `orch-0776-video-processing-status-bridge:` job block to `.github/workflows/strict-grep-mingla-business.yml` after line 326 per the snippet under P2-1. Add the corresponding registry comment to the header block at lines 16-44. Consider also registering `orch-0770-event-cover-video-processing.mjs` and `orch-0776a-video-upload-progress-honesty.mjs` (pre-existing gap, optional within this ORCH).

4. **Re-run static gates inside the worktree** to prove the rework holds:

```bash
cd .worktrees/orch-0776-event-cover-video-processing-speed/mingla-business
npm run test:orch-0770 && \
npm run test:orch-0776a && \
npm run test:orch-0776 && \
npx tsc --noEmit
cd ..
git diff --check
/Users/sethogieva/.deno/bin/deno check \
  supabase/functions/event-cover-video-upload-intent/index.ts \
  supabase/functions/event-cover-video-source-uploaded/index.ts \
  supabase/functions/event-cover-video-status/index.ts \
  supabase/functions/event-cover-video-webhook/index.ts \
  supabase/functions/event-cover-video-apply/index.ts \
  supabase/functions/event-cover-video-cancel/index.ts
/Users/sethogieva/.deno/bin/deno test --allow-env \
  supabase/functions/_shared/eventCoverVideo.test.ts
```

5. **Hand off to orchestrator for deploy** of all six functions plus, if Option B was chosen, the operator's `supabase db push --linked`. Then route to tester for retest with runtime evidence and iOS + Android + Web parity per Section M above.

## Cross-References

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_STATUS_AND_PROGRESS.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_PROGRESS_STALL.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_SPEED_AND_STATUS.md`
- Prior ORCH-0776A implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0776A_EVENT_COVER_UPLOAD_PROGRESS_AND_HONEST_PROCESSING.md`
- Prior ORCH-0776D QA (the foundational deploy + cancel/insert proof): `Mingla_Artifacts/reports/QA_ORCH-0776D_EVENT_COVER_VIDEO_CANCELLED_AT_AND_DETAIL_DEPLOY.md`
- Memory anchors:
  - `feedback_tester_canonical_and_platform_parity.md`
  - `feedback_orchestrator_deploys_edge_functions.md`
  - `feedback_strict_grep_registry_pattern.md`
  - `feedback_headless_qa_rpc_gap.md` — directly applies: a real PostgREST UPDATE on the live schema catches P0-1 that no static gate could
  - `feedback_supabase_mcp_workaround.md` — MCP `execute_sql` worked for this session, used for live schema introspection

## Working tree

`.worktrees/orch-0776-event-cover-video-processing-speed/` on branch `orch/0776-event-cover-video-processing-speed`. QA report is committed to this worktree per META-ORCH-0755 Step 8 / I-PROPOSED-AC ONE_WORKTREE_PER_ORCH.

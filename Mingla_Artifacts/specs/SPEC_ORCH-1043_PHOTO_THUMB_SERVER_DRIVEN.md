# SPEC — ORCH-1033 [Photo-thumbnail pipeline: server-driven + parallel + scoped + collage fallback]

- **Author:** mingla-forensics+claude · **Date:** 2026-06-01
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1033_PHOTO_THUMB_PIPELINE_AUDIT.md`
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1033-[photo-thumb-server-driven]/` on branch `ORCH-1033-photo-thumb-server-driven`
- **Confidence basis:** all root causes proven (live HTTP + live DB + full code read).
- **Comms acks:** COMMS-0002 (backend strict-grep allowlist) + COMMS-0003 (external-API docs cited inline) factored throughout.

---

## 0. Scope / Non-Goals / Assumptions

**Scope (6 layers A–F):**
- **A.** Convert `backfill-place-photo-thumbs` from browser-looped batches to a server-driven self-invoking chain (`EdgeRuntime.waitUntil`) + a pg_cron kicker, mirroring `tg_kick_pending_trial_runs`/`handleProcessChunk`.
- **B.** Process photos in parallel within a bounded memory budget (PARALLEL_N), replacing the one-at-a-time loop.
- **C.** Scope selection to `is_servable=true` + has-photos + no-thumb, with an optional `city` parameter.
- **D.** Auto-pickup of newly-seeded servable+has-photos+no-thumb places via the cron sweep so the backlog self-drains.
- **E.** Keep the admin Thumbnails tab UX (start/progress/pause/counts) but make it a status-viewer/controller over the SERVER run, not the run engine. No visual regression.
- **F.** Fix `_shared/imageCollage.ts` fallback: trigger on ANY non-OK/missing-object thumb response (incl. HTTP 400 "Object not found"), fall back to the ORIGINAL full-size object (decodable baseline), memory-aware; and distinguish fetch-failure vs decode-failure in the error message.

**Non-Goals:** consumer iOS/Android, business iOS/Android, buyer-web (no `_thumb` readers — proven); the Photos-originals download pipeline behavior (only its shared-table compatibility is in scope); the metered Supabase render-image endpoint (explicitly FORBIDDEN for generation; remains gated by ORCH-0957); Gemini scoring logic; re-architecting the intelligence pipeline.

**Assumptions (verified live):** `pg_cron` + `pg_net` enabled; vault `service_role_key` + `supabase_url` present; `photo_backfill_runs`/`photo_backfill_batches` exist with the ORCH-1024 `RUN_CITY` discriminator; originals capped at 800px (`photoStorageService.ts:361`); `place_pool.stored_photo_urls` is `text[]`; `db push` is blocked by ledger drift → new migration applied via Management API at close.

---

## 1. Cross-Surface Impact (Phase 2.5)

| # | Surface | Covered? | Behavior / files |
|---|---------|----------|------------------|
| 1 | Consumer iOS | NO | does not read `_thumb.jpg`; reads originals directly. |
| 2 | Consumer Android | NO | same. |
| 3 | Buyer/anon Web | NO | no `_thumb` readers. |
| 4 | Business iOS | NO | no `_thumb` readers. |
| 5 | Business Android | NO | no `_thumb` readers. |
| 6 | **Admin Web** (adjacent) | **YES** | Thumbnails tab → server-run status-viewer (E). `mingla-admin/src/pages/PlacePoolManagementPage.jsx`. |
| 7 | Business Web preview (adjacent) | NO | n/a. |

Backend (non-surface but in scope): `supabase/functions/backfill-place-photo-thumbs/index.ts`, `supabase/functions/_shared/imageCollage.ts`, new `supabase/migrations/<ts>_orch_1033_thumb_backfill_cron.sql`, `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (allowlist).

Parity: single backend path + single admin tab — parity is automatic (no per-platform fork).

---

## 2. Layer-by-Layer Contract

### 2.A — Server-driven run engine (edge fn `backfill-place-photo-thumbs`)

**New service-role action `process_chunk`** (mirror `run-place-intelligence-trial` `handleProcessChunk`):

- **Auth:** service-role-only. `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`; reject (403) if the bearer ≠ `SUPABASE_SERVICE_ROLE_KEY`. (Same gate as intel trial lines 677–685.) 🔒 LOCKED
- **Request:** `{ action: "process_chunk", runId: string }`.
- **Budget loop:** `BUDGET_MS = 110_000` (110s; 40s headroom under the 150s edge timeout). `SAFETY_MAX_ITERATIONS = 20`. Each iteration: claim the next `pending` batch for `runId` (status-guard the run to `running`/`ready`/`paused`), process it (2.B), update batch + run counters, re-check run status (`paused`/`cancelled` → stop). 🔒 LOCKED
- **End-of-budget self-invoke:** if the run still has `pending` batches AND status is `running`, fire `EdgeRuntime.waitUntil(fetch(selfUrl, { action: 'process_chunk', runId }))` exactly as intel trial lines 3252–3267 (fire-and-forget; cron recovers on failure). 🔒 LOCKED
- **Completion:** when no `pending` batch remains, set run `status='completed'`, `completed_at=now()`. 🔒 LOCKED
- **Response shape:** `{ ok: true, runId, batchesProcessed, thumbsWritten, thumbsAlreadyPresent, succeeded, failed, skipped, done: boolean, exitReason, elapsedMs }`. 🔒 LOCKED

**`create_run`/`run_next_batch` reconciliation:**
- `create_run` continues to pre-insert `photo_backfill_runs` + `photo_backfill_batches`, then KICKS the first `process_chunk` immediately via `net.http_post` OR an in-fn `EdgeRuntime.waitUntil` self-invoke (so the run starts without waiting for the next cron tick). 🔒 LOCKED
- `run_next_batch` is RETAINED as a manual single-step (admin "Run one batch" debug affordance) but is NO LONGER the run engine. The admin tab does not loop it. 🎨 OPEN (implementor may keep or thinly deprecate it; must not delete the action without updating the admin tab).
- `pause_run`/`resume_run`/`cancel_run`/`active_runs`/`run_status`/`retry_batch`/`skip_batch` unchanged in contract; `resume_run` must re-kick `process_chunk`. 🔒 LOCKED

**Idempotency / concurrency:** at most one active (`ready`/`running`/`paused`) thumbs run per `(city,country)` — already enforced by `handleCreateRun` `already_active` check (line 255–266). The `process_chunk` chain must be safe under concurrent kicks: claim a batch with a conditional update (`UPDATE … SET status='running' WHERE id=<batchId> AND status='pending'` and check affected-rows) so two workers never double-process a batch. 🔒 LOCKED

### 2.B — Parallel decode within a memory budget

- **`PARALLEL_N = 6`** exported `const` with a protective comment carrying the memory math (800px cap → ≤6.4 MB RGBA pessimistic per photo; 6 × 6.4 ≈ 38 MB ≪ 150 MB working contract ≪ ~256 MB hard cap; tunable 4–9). 🔒 LOCKED (value); 🎨 OPEN (implementor may tune within 4–9 if a live run shows headroom, keeping the math comment in sync).
- Flatten the batch's places → list of `{placeId, photoUrl, objectPath, thumbPath}` photo-jobs; run them through a **semaphore of size PARALLEL_N** (parallelize at the PHOTO level, not the place level). 🔒 LOCKED
- Each photo-job: `thumbExists` HEAD-skip (unchanged); else `fetchOriginalBytes` → `encodeThumb` (decode→resize 384→encodeJPEG q80, unchanged) → `upload(upsert)`. 🔒 LOCKED
- A place's `thumbs_backfilled_at` is set ONLY when ALL its photo-jobs succeeded (preserve current all-or-nothing semantics at `index.ts:175-194`). 🔒 LOCKED
- Remove the `INTER_PHOTO_DELAY_MS`/`INTER_PLACE_DELAY_MS` serial sleeps (the parallelism + budget loop replace them). 🎨 OPEN (implementor may keep a tiny inter-batch yield if needed for storage rate limits).

### 2.C — Scope: servable + has-photos + no-thumb + optional city

- `loadPendingPlaces` (and `countPendingPlaces`) gain a filter: `.eq('is_servable', true)` ALWAYS, `.is('thumbs_backfilled_at', null)`, `.not('stored_photo_urls','is',null)` + the existing array-length>0 post-filter. 🔒 LOCKED
- New optional `city` param on `preview_run`/`create_run`: if present, resolve to `city_id` via `seeding_cities` (name match) and add `.eq('city_id', <id>)`; reject (400) an unknown city name. If absent → global servable backlog. 🔒 LOCKED
- Use `array_length(stored_photo_urls,1) > 0` semantics — `stored_photo_urls` is `text[]`, NOT jsonb. 🔒 LOCKED

### 2.D — Auto-pickup (self-draining backlog)

- **Mechanism = periodic pg_cron sweep, NOT a trigger.** Rationale: `place_pool` has no triggers today; originals are written by `backfill-place-photos`/`admin-seed-places` which leave `thumbs_backfilled_at` NULL — so any newly-photo'd servable place is already eligible. A trigger per row-update would be noisy; a sweep is the established Mingla pattern (intel trial, Sub-D rescore). 🔒 LOCKED
- New pg_cron job `kick_pending_thumb_backfill` at `*/10 * * * *` (every 10 min — thumbs are not latency-critical; avoids piling on the 1-min intel kicker). It (a) ensures a single global servable thumbs run exists when there is a backlog (create an `auto` run if none active and pending>0), and (b) kicks `process_chunk` for any active `running` thumbs run whose heartbeat is stale. 🔒 LOCKED (job name + 10-min cadence); 🎨 OPEN (the exact "ensure-run-exists" SQL vs. a thin `net.http_post` to a new `ensure_auto_run` action — implementor picks the cleaner of the two, must be idempotent).
- The kicker fetches `service_role_key` from vault (verified present) and skips silently with `RAISE NOTICE` if missing — verbatim pattern from `tg_kick_pending_trial_runs` lines 186–194. 🔒 LOCKED

### 2.E — Admin Thumbnails tab (status-viewer, no browser engine)

- DELETE the browser run-loop: `handleRunAll`'s `while` loop (`PlacePoolManagementPage.jsx:2194-2223`) and `handleRunNext`'s role as the engine. 🔒 LOCKED
- "Run All (N places)" button → calls `create_run` (which server-kicks), then polls `run_status` on an interval (e.g. every 4s) while the run is non-terminal to refresh progress/counts. The poll is for DISPLAY only — closing the tab does NOT stop the run. 🔒 LOCKED
- Keep the existing StatCards (Pending / Thumbs Written / Already Present / Est. Cost $0.00), the status badge, the progress bar, and Pause/Resume/Cancel controls — all now operate on the server run. 🔒 LOCKED
- Add an optional city selector (reuse the existing seeding-city picker pattern already in the file) feeding the `city` param (C). 🎨 OPEN (placement + styling within the existing SectionCard; designer-tokens already used in the file — no new tokens).
- "Est. Cost $0.00" copy unchanged (generation is FREE/in-function). 🔒 LOCKED
- No visual regression: same Tailwind tokens, same SectionCard/StatCard primitives. This is a backend-behavior swap behind the same UI. 🔒 LOCKED. (No new design contract needed — zero new visual surface; if the city selector introduces any new layout, it reuses existing primitives only.)

### 2.F — Collage fallback fix (`_shared/imageCollage.ts`)

- Broaden the fallback trigger at `fetchAndDecode` (lines 166–174): fire when `isThumbObjectRewrite(url, transformedUrl)` AND the thumb response is **missing/non-OK** — i.e. `(!res.ok)` (covers 400, 404, 5xx) rather than `res.status === 404` only. 🔒 LOCKED
- **Fallback target = the ORIGINAL full-size object**, NOT the metered render endpoint. Replace `legacyTransformFallbackUrl` (which routes to `/storage/v1/render/image/` — metered, ORCH-0957-gated) with a new `originalObjectFallbackUrl(url)` that simply strips the `_thumb.jpg` rewrite and returns the original `<dir>/<i>.<ext>` object URL. Decode that (baseline JPEG, proven decodable). 🔒 LOCKED — this is the F-6 strict-grep constraint: introducing a render-endpoint call here would trip `orch-0957-no-metered-place-photo-reads.mjs`.
- **Memory-aware:** the original-object fallback is the EXCEPTION path (only fires when a thumb is missing). Once the backlog drains (A–D), it rarely fires. The collage compose loop stays SERIAL (preserve the `[CRITICAL — ORCH-0737 v6]` comment + serial loop at lines 217–238) so a transient all-missing place still can't blow memory (1 full-size 800px decode at a time = ≤6.4 MB). 🔒 LOCKED
- **Preserve the kill-switches:** keep `THUMB_404_FALLBACK_TO_TRANSFORM` semantics but RENAME/REPURPOSE its meaning to "fall back to original object on missing thumb" (default true), OR keep the env name and add a second `USE_PLACE_PHOTO_THUMBS=false` legacy escape that still routes to the gated render endpoint. The legacy metered render path MUST remain reachable ONLY via `USE_PLACE_PHOTO_THUMBS=false` behind the existing ALLOWLIST block. 🎨 OPEN (implementor picks the cleaner env surface; must keep the ORCH-0957 allowlist block intact + gated).
- **Error-message clarity:** distinguish fetch-failure from decode-failure. Track per-photo outcome and change the throw at line 240–242 to e.g. `composeCollage: 0 of N photos placed (fetchFailed=X, decodeFailed=Y)`. 🔒 LOCKED

---

## 3. Database / Migration (new file)

`supabase/migrations/<next-ts>_orch_1033_thumb_backfill_cron.sql` (timestamp AFTER `20260811000000`; rebase onto main first per Investigation Discovery 3). Must cite docs inline per COMMS-0003:
- pg_cron + pg_net: `https://supabase.com/docs/guides/cron`
- `EdgeRuntime.waitUntil` (background tasks): `https://supabase.com/docs/guides/functions/background-tasks`

Migration contents (🔒 LOCKED):
1. Pre-flight `DO` block: `RAISE EXCEPTION` if `pg_cron` absent; `RAISE NOTICE` if `pg_net`/vault secrets absent (mirror Sub-D migration §1).
2. `CREATE OR REPLACE FUNCTION public.tg_kick_pending_thumb_backfill()` `SECURITY DEFINER` — fetch `service_role_key` from vault (skip+NOTICE if null); ensure one global servable `auto` thumbs run exists when pending>0; `net.http_post` `process_chunk` for active running thumbs runs with stale/absent heartbeat. URL: `…/functions/v1/backfill-place-photo-thumbs`.
3. `cron.schedule('kick_pending_thumb_backfill', '*/10 * * * *', $$ SELECT public.tg_kick_pending_thumb_backfill(); $$)` with the unschedule-if-exists guard (verbatim pattern from `20260506000001` lines 152–167).
4. **Optional** `last_heartbeat_at timestamptz` column on `photo_backfill_runs` IF the staleness-based recovery needs it (the table lacks it today). Add via `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. 🎨 OPEN (implementor: add only if used by the kicker's staleness check; otherwise the kicker keys off `status='running'` + a `started_at` cutoff).
5. One-time cleanup: supersede the stale browser-era `paused`/`ready` thumbs runs (Investigation Discovery 2) — `UPDATE photo_backfill_runs SET status='cancelled' WHERE city='ORCH-0957 place-photo thumbs' AND status IN ('paused','ready') AND created_at < now()` (idempotent). 🎨 OPEN (implementor confirms no in-flight run is clobbered).

No new RLS needed: `service_role_all_photo_runs`/`_batches` already grant the worker full access (baseline lines 15951/15955).

**Apply at close via Management API** (`POST /v1/projects/gqnoajqerqhnvulmnyvv/database/query`), NOT `db push` — ledger drift (Investigation §Migration ledger drift). Verify with `list_migrations` showing the new version before the close banner (COMMS-0012 lesson).

---

## 4. Strict-grep / CI (COMMS-0002)

- The new edge-fn change + new migration are backend files. The ORCH-0863 C7 `no-new-backend-files` gate (`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`) blocks NEW `supabase/functions/**` or `supabase/migrations/**` files unless allowlisted. Add an `ORCH_1033_BACKEND_ALLOWLIST` array listing the new migration path (and any new `_shared` helper file) in the SAME commit as the backend files. 🔒 LOCKED
- The ORCH-0957 metered-path gate (`orch-0957-no-metered-place-photo-reads.mjs`) stays GREEN: F's original-object fallback introduces NO new `/storage/v1/render/image/` reference; the one allowlisted legacy block in `imageCollage.ts:102-111` is preserved untouched. The implementor MUST run this gate locally. 🔒 LOCKED

---

## 5. Success Criteria

1. **SC-1 (F-3 fix):** Given a place whose `_thumb.jpg` returns HTTP 400 `{"statusCode":"404","error":"not_found",...}` and whose original returns 200 baseline JPEG, `composeCollage` places the photo from the ORIGINAL object (placedCount ≥ 1), does NOT throw, and does NOT call any `/storage/v1/render/image/` URL.
2. **SC-2 (server-driven):** `create_run` returns and the run advances to `completed` WITHOUT any browser loop (proven by invoking `create_run` then polling `run_status` with no `run_next_batch` calls from the client).
3. **SC-3 (cron auto-drain):** With a servable+has-photos+no-thumb backlog and no active run, the `kick_pending_thumb_backfill` cron creates+drives a run within one 10-min tick.
4. **SC-4 (parallel-N memory):** `process_chunk` decodes ≤ PARALLEL_N originals concurrently; a batch of 25 places × ~5 photos completes without WORKER_LIMIT 546.
5. **SC-5 (scope):** `preview_run`/`create_run` with `city:"London"` count/enqueue only London servable no-thumb places; unknown city → 400.
6. **SC-6 (servable filter):** non-servable places are never enqueued.
7. **SC-7 (admin):** Thumbnails tab shows live progress for a server run; closing/reloading the tab does not stop the run; no visual regression vs current tab.
8. **SC-8 (Photos panel intact):** thumbs runs still excluded from the Photos status bar (ORCH-1024 discriminator preserved).
9. **SC-9 (error clarity):** all-missing-and-undecodable place throws a message distinguishing `fetchFailed` vs `decodeFailed` counts.
10. **SC-10 (gates green):** both strict-grep gates (ORCH-0863 C7 with `ORCH_1033_BACKEND_ALLOWLIST`, ORCH-0957 metered) pass.

---

## 6. Invariants

| ID | Invariant | Preserved/Verified by |
|----|-----------|----------------------|
| I-THUMB-MISSING-FALLBACK-ON-NON-OK (NEW) | Collage falls back to the ORIGINAL object on ANY non-OK/missing-object thumb response; never the metered render endpoint. | SC-1; T-01; ORCH-0957 gate |
| I-THUMB-BACKFILL-SERVER-DRIVEN (NEW) | Thumbnail generation runs via cron-kicked self-invoke chain; the browser is not the engine. | SC-2/SC-3; T-03 |
| I-THUMB-DECODE-PARALLEL-N-BOUNDED (NEW) | In-flight decode parallelism ≤ PARALLEL_N with the 800px memory math in a protective comment. | SC-4; T-04 |
| I-PHOTO-FILTER-EXPLICIT (existing) | thumbs run mode/discriminator keeps thumbs out of the Photos panel. | SC-8 |
| ORCH-0957 no-metered (existing) | no `/storage/v1/render/image/` outside the gated allowlist. | SC-10 |

---

## 7. Test Cases — BOTH required regression tests

### Implementor happy-path (fails-on-revert)
**`supabase/functions/_shared/imageCollage.fallback400.test.ts`** (NEW):
- T-01: mock `fetch` so the `_thumb.jpg` URL returns `new Response(JSON.stringify({statusCode:"404",error:"not_found",message:"Object not found"}), { status: 400, headers: {"content-type":"application/json"} })` and the ORIGINAL object URL returns a valid JPEG body 200. Assert: `composeCollage([thumbMissingUrl]).placedCount === 1`, no throw, and NO fetched URL contains `/storage/v1/render/image/`. **This fails on revert** because today's `res.status === 404` guard does not fire on 400 → null → throw.

**`supabase/functions/backfill-place-photo-thumbs/index.test.ts`** (EXTEND):
- T-02: `loadPendingPlaces`/selection includes `is_servable=true` and (with `city`) `city_id` filters — assert the query builder receives `.eq('is_servable', true)` and `.eq('city_id', …)`.
- T-03: `process_chunk` with a mocked db processes a pending batch, sets run `completed` when no pending remains, and schedules a self-invoke when pending remains (assert `EdgeRuntime.waitUntil` / fetch-to-self called). Service-role auth gate returns 403 on wrong bearer.

### Tester adversarial (different angle)
**`supabase/functions/_shared/__tests__/imageCollage.thumbFallback.test.ts`** (EXTEND — the file whose existing 404-mock masked the bug):
- T-04 (adversarial): mock the FULL real failure matrix — thumb returns 400-with-404-JSON-body for photo A, thumb returns 5xx for photo B, original of A returns 200 JPEG, original of B returns 200 JPEG. Assert BOTH placed via original fallback, and the throw path (all-undecodable) reports distinct `fetchFailed`/`decodeFailed` counts. Also assert `USE_PLACE_PHOTO_THUMBS=false` still routes to the gated render endpoint (legacy escape intact) — proving the fix didn't break the ORCH-0957 lever.

**`supabase/migrations/__tests__/orch_1033_thumb_backfill_cron.test.ts`** (NEW, adversarial migration test in the established `.test.ts` dir): assert the migration registers `kick_pending_thumb_backfill` at `*/10 * * * *`, the kicker fn is `SECURITY DEFINER`, and it skips silently when vault `service_role_key` is absent (no exception). (Read-only assertions against a parsed migration / mocked SQL — tester does NOT apply migrations.)

---

## 8. Implementation Order

1. Rebase worktree branch onto `origin/main` (pick up `20260809*` + ORCH-1032).
2. `_shared/imageCollage.ts` F-fix + T-01 (smallest, isolated, unblocks intelligence runs immediately).
3. `backfill-place-photo-thumbs/index.ts` A+B+C (server engine, parallel-N, scope) + T-02/T-03.
4. New migration (D cron + cleanup) + `ORCH_1033_BACKEND_ALLOWLIST` in the ORCH-0863 gate (same commit).
5. Admin Thumbnails tab E (status-viewer swap).
6. Adversarial tests T-04 + migration test.
7. Run both strict-grep gates + all Deno tests locally.

---

## 9. Regression Prevention

- The adversarial T-04 locks the real-400 contract so a future "tidy-up" can't regress to a 404-only guard.
- The migration test locks the cron registration so the auto-drain can't be silently dropped.
- Protective comments: the PARALLEL_N math comment (B), the "original-object NOT render-endpoint" comment (F), and a one-liner on the existing thumbFallback test noting the 404-mock historically masked the production 400.
- COMMS write-on-discovery: none required — blast radius is backend-only and self-contained; the migration-ledger-drift apply-via-Management-API step is the only cross-cutting operational note (already covered by COMMS-0012/COMMS-0015 in the ledger; the orchestrator's CLOSE must verify `list_migrations` before the banner).

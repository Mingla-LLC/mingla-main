# QA — ORCH-1033 [Photo-thumbnail pipeline: server-driven + parallel + scoped + collage fallback]

- **Tester:** mingla-tester+claude · **Date:** 2026-06-01
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1033-[photo-thumb-server-driven]/` on branch `ORCH-1033-photo-thumb-server-driven` (HEAD `e103aa44e` at entry)
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1033_PHOTO_THUMB_SERVER_DRIVEN.md`
- **Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1033_PHOTO_THUMB_SERVER_DRIVEN.md`
- **Audit:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1033_PHOTO_THUMB_PIPELINE_AUDIT.md`
- **Comms acks:** COMMS-0002 (ORCH-0863 backend allowlist — verified `ORCH_1033_BACKEND_ALLOWLIST` carries the new migration + test files; C7 green), COMMS-0003 (external-API/infra docs — migration cites pg_cron/pg_net/background-tasks/vault URLs inline; no external-API enums introduced), COMMS-0004 (intake-scan — N/A, TEST scope). FYI only, no BLOCK addressed to tester/ORCH-1033/ALL.

---

## Verdict: **CONDITIONAL PASS**

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 1 | **P4:** 3
- The single condition is **operator-accepted deferral of SC-3 + SC-4 live confirmation to post-deploy** (the migration must be applied via Management API and the edge fn redeployed by the orchestrator at CLOSE — both out of tester scope per the dispatch). All code-verifiable criteria PASS; both strict-grep gates GREEN; the fails-on-revert claim is independently reproduced; tester adversarial tests added and green.

This is NOT a UI/runtime change — it is backend (edge fn + shared TS + SQL migration) plus an adjacent admin-web behavior swap behind unchanged primitives. The live-fire iOS/Android sim gate is **EXEMPT** (no mobile surface reads `_thumb.jpg`; the Investigation enumeration confirms zero mobile/buyer-web consumers). Admin is web-only — no iOS/Android leg. The admin change is a backend-behavior swap behind identical Tailwind primitives (verified by source read + lint parity), so no browser sim leg was required for a pass at this layer; the orchestrator's post-deploy live drain (SC-3/SC-4) is the runtime confirmation.

---

## Success-criteria matrix (independently verified — code read, not report-trusted)

| SC | Verdict | Independent evidence |
|----|---------|----------------------|
| SC-1 (400→original fallback, no throw, no render URL) | **PASS** | `imageCollage.ts:200-204` fires on `!res.ok` (covers 400/404/5xx); `originalObjectFallbackUrl` (L156-158) returns the un-rewritten original URL verbatim — no `/render/image/`. T-01 green; reproduced fails-on-revert (below). |
| SC-2 (server-driven, no browser loop) | **PASS** | `handleProcessChunk` (L658-765) budget loop + `EdgeRuntime.waitUntil` self-invoke (L406-430, L734-749); admin browser `while` loop deleted (only `setInterval` poll of `run_status` at PlacePoolManagementPage L2149-2158). T-03 green. |
| SC-3 (cron auto-drain) | **VERIFIED-BY-MECHANISM, LIVE-CONFIRM PENDING DEPLOY** | Migration registers `kick_pending_thumb_backfill` `*/10 * * * *` (L125-129) → POSTs `ensure_auto_run` (L79-86) which creates+kicks a global servable run on backlog (`handleEnsureAutoRun` L776-798). Locked by tester migration test T-MIG-1/T-MIG-5. Live tick requires migration applied + edge fn deployed (orchestrator at CLOSE). |
| SC-4 (parallel-N memory; 25×5 no 546) | **VERIFIED-BY-MECHANISM, LIVE-CONFIRM PENDING DEPLOY** | `PARALLEL_N=6` (L31) + `runWithConcurrency` semaphore (L176-189). `processBatch` flattens ALL photos across the whole batch into one `allJobs` list (L593-604) then drains at concurrency 6 — so in-flight decodes ≤6 **regardless of batch size** (25 places × 5 photos = 125 jobs, only 6 concurrent). Memory math comment matches 800px cap → 6.4MB → 38MB peak ≪ 150MB. Live 25×5 batch = orchestrator post-deploy. |
| SC-5 (city scope; unknown→400) | **PASS** | `resolveCityId` ilike `seeding_cities` (L272-282); unknown → `{error}` → 400 in `handlePreviewRun` (L333) + `handleCreateRun` (L442). T-02 asserts `.eq('city_id',…)`. |
| SC-6 (servable filter always) | **PASS** | `loadPendingPlaces` always `.eq('is_servable', true)` (L300). T-02/T-02b assert it is applied with AND without a city. |
| SC-7 (admin status-viewer, no visual regression) | **PASS (source + lint parity)** | Browser engine removed; `create_run` server-kicks; 4s poll for display only; StatCards + `Est. Cost $0.00` (L2316) + badge/progress/controls preserved; same `SectionCard`/`StatCard` primitives. Lint parity: 16 errors on main == 16 errors on branch (no new error). |
| SC-8 (Photos panel intact — ORCH-1024) | **PASS** | `THUMBS_RUN_CITY="ORCH-0957 place-photo thumbs"` (L59) preserved; all three Photos filters keep `!== THUMBS_RUN_CITY` (L1488/1560/2938). `createRunRecord` still stamps `city=RUN_CITY` (L364). |
| SC-9 (fetch vs decode counts) | **PASS** | Throw at `imageCollage.ts:287-291`: `0 of N photos placed (fetchFailed=X, decodeFailed=Y)`. T-01b + tester T-04b assert distinct counts. |
| SC-10 (both gates green) | **PASS** | ORCH-0863 C7 `# All checks PASS` (allowlist working — 11 files changed, 0 disallowed backend touches). ORCH-0957 `OK ... no metered ... outside legacy fallback`. Both EXIT 0. |

---

## Core fix verification (Section 1 of dispatch — collage fallback)

- **Trigger broadened to ANY non-OK:** `imageCollage.ts:200-204` — `if (!res.ok && thumbFallbackEnabled() && isThumbObjectRewrite(...))`. The pre-fix guard was `res.status === 404` (confirmed via the comment at L128-138 and the revert experiment). Covers the real production 400-with-`{"statusCode":"404",...}` body, plus 5xx.
- **Fallback target = ORIGINAL object, NOT metered render:** `originalObjectFallbackUrl(originalUrl)` returns the input URL verbatim (L156-158). The input to `fetchAndDecode` is the original `/storage/v1/object/public/<dir>/<i>.<ext>` URL (the thumb rewrite happens inside `transformPhotoUrlForTile`), so the fallback is a non-metered baseline JPEG. **The only `/storage/v1/render/image/` reference in the file is the preserved, allowlisted ORCH-0957 legacy block at L102-111**, reachable only via `USE_PLACE_PHOTO_THUMBS=false`. ORCH-0957 gate confirms no new metered reference.
- **Independent fails-on-revert (reproduced by tester):** in a scratch copy I reverted the guard from `!res.ok` back to `res.status === 404`. Result: implementor's `imageCollage.fallback400.test.ts` → **`0 passed | 2 failed`** (T-01 + T-01b both red — the 400 response no longer triggers the fallback → photo dropped → throw). My tester T-04 + T-04b also went red on the same revert (T-04c, the legacy-lever guard, correctly stayed green since it is independent of the F-fix). Production file restored to `!res.ok`; full suite re-confirmed green; `git diff` on `imageCollage.ts` is empty.

## Server engine verification (Section 2)

- **`process_chunk` budget loop:** `BUDGET_MS=110_000`, `SAFETY_MAX_ITERATIONS=20` (L34-35); claims+processes pending batches (L696-729); marks run `completed` when no pending remains (L711-718); self-invokes via `EdgeRuntime.waitUntil(fetch(selfUrl,…))` when pending remain AND status `running` (L734-749). Re-checks live run status each iteration for pause/cancel (L700-707).
- **Service-role gate:** `process_chunk`/`ensure_auto_run` bypass the user-auth path and require `token === SUPABASE_SERVICE_ROLE_KEY`, else **403** (L938-950). T-03c drives the real `handler` with `Bearer wrong-token` → asserts 403. Verified green.
- **Concurrency-safe claim:** conditional `UPDATE … SET status='running' WHERE id=<id> AND status='pending'` + affected-rows check (L500-510) so two workers never double-process a batch.
- **Browser is no longer the engine:** admin loop deleted; `create_run`/`resume_run` server-kick.

## Parallel-N memory bound (Section 3)

- `PARALLEL_N=6` exported const (L31). Memory-math comment (L17-30) matches the 800px cap (`photoStorageService.ts:361`): 800×2000 pessimistic = 6.4MB RGBA → 6×6.4 ≈ 38MB peak ≪ 150MB working contract ≪ ~256MB hard cap.
- A 25-place × ~5-photo batch flattens to ~125 photo-jobs in `allJobs` (L593-604) drained through the size-6 semaphore (`runWithConcurrency` L176-189). In-flight decodes are capped at 6 by `Math.min(limit, tasks.length)` workers — the batch size does NOT inflate concurrency. Budget cannot be exceeded.

## Scope (Section 4)

- `loadPendingPlaces`/`countPendingPlaces`: always `.eq('is_servable', true)` (L300), `.is('thumbs_backfilled_at', null)` (L301), `.not('stored_photo_urls','is',null)` (L302) + `array_length > 0` post-filter on the `text[]` (L312). City: optional `.eq('city_id', cityId)` (L306) resolved from `seeding_cities` ilike; unknown city → 400.

## Migration (Section 5) — read-only, NOT applied (Discipline Rule 13)

- `supabase/migrations/20260815000000_orch_1033_thumb_backfill_cron.sql`: `cron.schedule('kick_pending_thumb_backfill', '*/10 * * * *', …)` (L125-129) with unschedule-if-exists guard (L120-123); `tg_kick_pending_thumb_backfill()` is `SECURITY DEFINER` (L53); silent skip on missing vault `service_role_key` — `IF service_key IS NULL THEN RAISE NOTICE … RETURN` (L69-72), **no EXCEPTION in the kicker body**; pg_cron missing is the only hard `RAISE EXCEPTION` (pre-flight L25-27); pg_net + vault missing are NOTICE only (L28-35). Additive: `ADD COLUMN IF NOT EXISTS last_heartbeat_at` (L43-44); the only data UPDATE is the scoped one-time cleanup confined to `city='ORCH-0957 place-photo thumbs'` + `status IN ('paused','ready')` (L138-144) — safe to apply with production data present. Docs cited inline (L10-13). **Tester did not apply it.**

## No regressions (Section 6)

- ORCH-1024 Photos-panel discriminator preserved (SC-8 above).
- ORCH-0957 metered-path gate GREEN; ORCH-0863 C7 GREEN (allowlist).
- Admin Thumbnails tab keeps StatCards, status badge, progress bar, Pause/Resume/Cancel, batches list, `Est. Cost $0.00`, plus an additive optional city `<select>` — same primitives, no token change.
- Downstream consumer `run-place-intelligence-trial` inherits the F-fix via the shared `imageCollage.ts`; its existing `imageCollage.test.ts` still 12 passed | 0 failed.

---

## Tester adversarial tests (CLOSE Step 0.5 — different angle than implementor happy-path)

### `supabase/functions/_shared/__tests__/imageCollage.thumbFallback.test.ts` — T-04 / T-04b / T-04c (EXTEND)
- **T-04** — full mixed failure matrix in ONE collage: photo A thumb = 400+not_found-JSON, photo B thumb = **502** (a 5xx the implementor's tests never feed), both originals 200 JPEG → asserts **both placed via original fallback** (placedCount=2), no render URL. Attacks the "covers the whole non-OK range, not just {400,404}" angle.
- **T-04b** — 2-photo all-undecodable place: A=decodeFailed (200 garbage), B=fetchFailed (original 503) → asserts the throw reports **distinct `fetchFailed=1` AND `decodeFailed=1`** + `0 of 2 photos placed`. Attacks the per-photo (not collapsed) SC-9 breakdown.
- **T-04c** — `USE_PLACE_PHOTO_THUMBS=false` STILL routes to the gated metered render endpoint and does NOT rewrite to `_thumb.jpg`. **Neither existing test asserts this env lever** (they toggle `THUMB_404_FALLBACK_TO_TRANSFORM`). Proves the F-fix did not sever the ORCH-0957 escape hatch.
- **Fails-on-revert (tester):** with the guard reverted to `res.status === 404`, T-04 + T-04b go red (T-04c stays green — independent of the F-fix). Confirmed.

### `supabase/migrations/__tests__/orch_1033_thumb_backfill_cron.test.ts` — T-MIG-1..5 (NEW)
- Read-only parse of the migration SQL (tester does NOT apply). T-MIG-1: `*/10 * * * *` schedule + job name + unschedule guard. T-MIG-2: `SECURITY DEFINER` + vault `service_role_key` read + no literal JWT. **T-MIG-3 (adversarial): missing vault secret → NOTICE + RETURN (silent skip), kicker body contains NO `RAISE EXCEPTION`; missing pg_net is a NOTICE.** T-MIG-4 (adversarial): additive-only — no DROP TABLE / column TYPE change / SET NOT NULL / TRUNCATE; one-time UPDATE scoped to the discriminator + paused/ready. T-MIG-5: kicker POSTs `ensure_auto_run` + `process_chunk` with the >5min/NULL stale-heartbeat predicate.

### Passing runs (captured)
- `imageCollage.thumbFallback.test.ts`: **5 passed | 0 failed** (2 existing T-05 + 3 new T-04).
- `orch_1033_thumb_backfill_cron.test.ts`: **5 passed | 0 failed**.
- Full touched + new suite (`fallback400` + `thumbFallback` + edge `index.test.ts` + migration test): **20 passed | 0 failed**.
- `deno check` on all touched + new files: clean (EXIT 0).
- Downstream `imageCollage.test.ts`: 12 passed | 0 failed.

### Diff presence (closing PR ships tests with the fix)
`git diff origin/main...HEAD --name-only` includes the implementor happy-path (`imageCollage.fallback400.test.ts`, `backfill-place-photo-thumbs/index.test.ts`), tester adversarial (`imageCollage.thumbFallback.test.ts`, `migrations/__tests__/orch_1033_thumb_backfill_cron.test.ts`), and all production files. The tester migration test + collage adversarial are in `ORCH_1033_BACKEND_ALLOWLIST` / are a pre-existing modify.

---

## Findings

- **P3-01 (NOTE, not a blocker):** the new ThumbnailTab poll effect (`PlacePoolManagementPage.jsx:2145-2159`) adds ONE `react-hooks/exhaustive-deps` *warning* (deps `[activeRun?.id, activeRun?.status]` omit `invoke`/`fetchPreview`). This is the correct pattern for an interval poll (including them would re-subscribe every render) and matches the file's existing 2 exhaustive-deps warnings. Branch lint = 19 problems (16 errors, 3 warnings) vs main = 18 (16 errors, 2 warnings): **zero new errors, one new (intentional) warning**. No action required; flagged for awareness.
- **P4-01 (praise):** the all-or-nothing `thumbs_backfilled_at` semantics are preserved correctly in both `processPlaceThumbs` (L246-265) and the batch path (`processBatch` L616-648) — a place is only stamped when every one of its photo-jobs succeeded.
- **P4-02 (praise):** the concurrency-safe conditional batch claim (L500-510) is a clean defense against double-driving under concurrent cron + self-invoke kicks.
- **P4-03 (praise):** the implementor's happy-path test split the `/render/image/` needle (`"/storage/v1/" + "render/image/"`) to stay ORCH-0957-gate-clean; the tester test follows the same discipline (a literal needle in a comment tripped the gate once and was corrected to use `RENDER_ENDPOINT_NEEDLE`).

---

## Constitution (relevant rules)

| Rule | Verdict | Note |
|------|---------|------|
| 2 — One owner per truth | PASS | `thumbs_backfilled_at` written only by the backfill fn; run engine is server-side only. |
| 3 — No silent failures | PASS | per-photo failures surfaced in `failed_places`; collage throw distinguishes fetch/decode; cron skip RAISE NOTICE (intentional, logged). |
| 8 — Subtract before adding | PASS | browser engine loop DELETED, not layered over. |
| 9 — No fabricated data | PASS | missing thumb → original object (real bytes), never synthetic. |
| 13 — Exclusion consistency | PASS | servable filter applied in selection; Photos-panel discriminator consistent. |
| (Tester) Rule 13 — never apply migrations | OBSERVED | migration verified read-only; not applied. |

---

## Deferred-to-orchestrator (post-deploy live confirm)

1. **SC-3 live:** after applying `20260815000000_…` via Management API and redeploying `backfill-place-photo-thumbs`, confirm `cron.job` shows `kick_pending_thumb_backfill` at `*/10 * * * *` and that one tick creates+drives a run over the servable backlog (`list_migrations` showing `20260815000000` BEFORE the close banner per COMMS-0012).
2. **SC-4 live:** confirm a real 25-place × ~5-photo batch completes without WORKER_LIMIT 546.
3. Edge fn MUST be deployed for the cron's `ensure_auto_run`/`process_chunk` POSTs to resolve non-404 (implementor Discovery 1).

## Discoveries for orchestrator

- None beyond the deferred live-confirm items. Blast radius is backend + admin-web, self-contained. No new COMMS entry required.

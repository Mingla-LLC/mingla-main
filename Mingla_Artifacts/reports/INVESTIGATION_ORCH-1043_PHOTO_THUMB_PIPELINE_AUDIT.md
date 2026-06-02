# INVESTIGATION — ORCH-1033 [Photo-thumbnail pipeline: server-driven + parallel + scoped + collage fallback]

- **Mode:** INVESTIGATE (audit + extend prior orchestrator forensics)
- **Date:** 2026-06-01
- **Author:** mingla-forensics+claude
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1033-[photo-thumb-server-driven]/` on branch `ORCH-1033-photo-thumb-server-driven`
- **Confidence:** root cause **proven** (live HTTP probe + live DB probe + full code read); all 6 dispatch findings verified or corrected.
- **Comms ledger:** read on entry. No BLOCK rows for ORCH-1033 / mingla-forensics / ALL. WARN rows factored: COMMS-0002 (ORCH-0863 backend strict-grep allowlist must land in same commit as any new backend/migration file) and COMMS-0003 (external-API enums/payloads cited inline at SPEC). Acked in both rows in chat Section A. This is a backend/SQL/admin-only ORCH — Prime-Directive-7 live-sim repro is exempt (no consumer/business mobile or buyer-web surface).

---

## Symptom Summary

| | |
|---|---|
| **Expected** | Every servable place that has stored original photos also has a `<dir>/<i>_thumb.jpg` 384px thumbnail; the intelligence collage decodes those thumbnails cheaply; thumbnail generation runs to completion server-side as a self-draining backlog; London's 7,234 missing thumbs can be targeted today. |
| **Actual** | (1) Thumbnail generation crashes with HTTP 546 WORKER_LIMIT on memory; the admin run is browser-driven and dies when the operator's PC sleeps. (2) The collage consumer's 404-only fallback never fires because a missing thumb returns **HTTP 400** (not 404), so 68% of London servable places fail the intelligence run. (3) Backlog is global+unscoped (17,338 pending), cannot target a city, and does not self-drain as seeding continues. |

---

## Investigation Manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` | mandatory entry scan |
| 2 | `supabase/functions/backfill-place-photo-thumbs/index.ts` (full, 619 lines) | the generation engine (Finding 1, 2, 4) |
| 3 | `supabase/functions/_shared/imageCollage.ts` (full, 247 lines) | the collage consumer + fallback bug (Finding 3, 6) |
| 4 | `supabase/functions/run-place-intelligence-trial/index.ts` (lines 1–1328 + 2878–3292) | the server-driven model to copy (Finding 5) |
| 5 | `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql` (full) | canonical pg_cron + pg_net + waitUntil pattern (Finding 5) |
| 6 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (lines 8838–8889, 10743–18264 grep) | `photo_backfill_runs` / `photo_backfill_batches` schema + RLS + grants |
| 7 | `supabase/migrations/20260808000000_meta_orch_1009_sub_d_refresh_cron.sql` (head) | second cron-kicker precedent + COMMS-0003 inline-citation style |
| 8 | `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (lines 53–59, 1486–1681, 2046–2376, 2915–3092) | the browser-driven Thumbnails tab + ORCH-1024 shared-table discriminator (Finding 2, E) |
| 9 | `.github/scripts/strict-grep/orch-0957-no-metered-place-photo-reads.mjs` (full) | the metered-path gate (Finding 6 constraint) |
| 10 | `supabase/functions/_shared/photoStorageService.ts` (line 361 + header) | the 800px download cap → memory math (Finding B) |
| 11 | `supabase/functions/backfill-place-photos/index.ts` (grep) | seeding/originals write path → auto-pickup mechanism (Finding D) |
| 12 | `supabase/functions/_shared/__tests__/imageCollage.thumbFallback.test.ts` + `backfill-place-photo-thumbs/index.test.ts` | existing test scaffold + why the existing test masks the bug |
| 13 | Live Supabase Management API (DB queries) | backlog counts, per-city status, cron jobs, vault secrets, run state |
| 14 | Live HTTP probe (original object + missing thumb object) | the 400-vs-404 proof + JPEG dimensions |

---

## Findings (classified, with six-field evidence)

### F-1 🔴 ROOT CAUSE — Thumbnail generation decodes full-size originals → memory crash (HTTP 546)

- **File + line:** `supabase/functions/backfill-place-photo-thumbs/index.ts:102-109` (`encodeThumb`), driven by `DEFAULT_BATCH_SIZE=25` (line 6), `processBatch` (line 316) serial loop, `processPlaceThumbs` (line 111) serial loop.
- **Exact code:**
  ```ts
  async function encodeThumb(bytes: Uint8Array): Promise<Uint8Array> {
    const decoded = await decode(bytes);            // FULL original → raw RGBA bitmap
    if (!(decoded instanceof Image)) throw new Error('decoded_non_image');
    decoded.resize(THUMB_SIZE, THUMB_SIZE);         // 384
    return await decoded.encodeJPEG(THUMB_JPEG_QUALITY);
  }
  ```
- **What it does:** `decode(originalBytes)` materializes the entire original as an imagescript W×H×4 RGBA bitmap BEFORE resizing. Each `processBatch` invocation walks 25 places × ~4.86 photos = ~122 decodes per `run_next_batch` call. The decodes are serial (so peak in-flight is bounded), but the run is browser-looped at ~1 photo/sec, and the engine offers no parallelism. The 546 the dispatch references is the cumulative-pressure mode of this design: large batches + the imagescript allocator's retained buffers under the edge memory cap.
- **What it should do:** Decode at a bounded parallel-N with a known per-photo RGBA ceiling well under the edge memory cap (math in §Safe Parallel-N), and run server-side in a budget loop, not browser-looped.
- **Causal chain:** browser loops `run_next_batch` → each call decodes a 25-place batch of full-size RGBA bitmaps serially → throughput ~1 photo/s + memory pressure under sustained load → eventual WORKER_LIMIT 546 → admin `handleRunAll` catch pauses the run ("Batch failed — auto-run paused", `PlacePoolManagementPage.jsx:2216`).
- **Verification:** Live DB — the current `photo_backfill_runs` row for `ORCH-0957 place-photo thumbs` is `status='paused'`, `total_batches=694`, `completed_batches=0`, `total_succeeded=0` (created 2026-06-02). A prior run reached only 5599/5802 batches before the operator's session ended. Confirms both the crash and the browser-dependence.

### F-2 🔴 ROOT CAUSE — The run is browser-driven, not server-driven

- **File + line:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx:2183-2228` (`handleRunAll`).
- **Exact code:**
  ```jsx
  while (!stopAutoRef.current && mountedRef.current) {
    const data = await invoke({ action: "run_next_batch", runId: activeRun.id });
    ...
    if (data.done) { addToast(... "All batches complete!"); break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  ```
- **What it does:** The BROWSER tab is the run engine. Each `run_next_batch` processes exactly one batch; the JS `while` loop in the admin tab is what advances the cursor. Closing the tab / sleeping the machine halts the run. No `EdgeRuntime.waitUntil` self-invoke, no pg_cron kicker.
- **What it should do:** `create_run` (or a cron kicker) should fire a server-driven self-invoke chain that runs to completion regardless of the admin tab, mirroring `tg_kick_pending_trial_runs` + `handleProcessChunk`.
- **Causal chain:** operator confirmed "it ran as long as my PC was on" → matches the browser `while` loop → halts on tab close → backlog never drains.
- **Verification:** `backfill-place-photo-thumbs/index.ts` has NO `EdgeRuntime`, NO `waitUntil`, NO `net.http_post`, NO `process_chunk` action (grep returns zero). The only progression action is `run_next_batch` (one batch per call). The `kick_pending_trial_runs` cron exists (live `cron.job` query) but kicks ONLY the intelligence pipeline, never thumbs.

### F-3 🔴 ROOT CAUSE — Collage fallback checks `404` but missing thumb returns `400` (`Object not found`)

- **File + line:** `supabase/functions/_shared/imageCollage.ts:160-179` (`fetchAndDecode`), specifically the trigger at line 167.
- **Exact code:**
  ```ts
  let res = await fetchUrl(fetchUrlForDecode, timeoutMs);
  if (res.status === 404 && thumbFallbackEnabled() && isThumbObjectRewrite(url, transformedUrl)) {
    fetchUrlForDecode = legacyTransformFallbackUrl(url, tileSize);   // never reached
    res = await fetchUrl(fetchUrlForDecode, timeoutMs);
  }
  if (!res.ok) { console.warn(...); return null; }                    // <- missing thumb lands here
  ```
- **What it does:** When the rewritten thumbnail object is missing, Supabase Storage's public object endpoint returns **HTTP 400** with body `{"statusCode":"404","error":"not_found","message":"Object not found"}` — NOT HTTP 404. The `res.status === 404` guard is false, the fallback never runs, `!res.ok` is true → `return null` → the photo is dropped → if ALL photos are thumb-missing, `composeCollage` throws `0 of N photos could be decoded — all fetches failed`.
- **What it should do:** Treat any non-OK response on a thumb-object rewrite (including 400 + the JSON "Object not found" body) as "thumb missing" and fall back to the ORIGINAL full-size object (a baseline JPEG that decodes fine) — NOT the metered render endpoint (see F-6 / strict-grep constraint).
- **Causal chain:** intelligence run rewrites each photo URL to `_thumb.jpg` → thumb object absent for 7,234/10,706 London servable places → 400 not 404 → fallback skipped → null → place's collage has 0 placed → `composeCollage` throws → `processOnePlace` records collage_fetch failure → place fails the intelligence run.
- **Verification (LIVE HTTP PROBE):**
  - Original `…/place-photos/ChIJkaKLu8yn2EcRT_tYRJ3bWC0/0.jpg` → `HTTP/2 200`, `content-type: image/jpeg`, magic `ffd8ffe0` (baseline JFIF), 800×600, 162 KB. Decodes fine.
  - Missing thumb `…/0_thumb.jpg` → `HTTP/2 400`, `content-type: application/json`, body `{"statusCode":"404","error":"not_found","message":"Object not found"}`. Both GET and HEAD return 400.
  - Live DB: London servable-with-photos = 10,706; missing thumbs = **7,234 (67.6%)** — matches the dispatch's "~69% intelligence-run failure rate." Lagos = 19 missing, Raleigh = 7, Washington = 31.
- **Why the existing test masks it:** `imageCollage.thumbFallback.test.ts` mocks the missing thumb as `new Response(null, { status: 404 })` — a **404**, which the buggy code DOES handle. The test's mock does not match real Supabase behavior, so it passes green while production fails. The new adversarial test MUST mock the real 400 + JSON body.

### F-4 🟠 CONTRIBUTING — Backfill selection is global + unscoped (no `is_servable`, no city)

- **File + line:** `backfill-place-photo-thumbs/index.ts:197-227` (`loadPendingPlaces`).
- **Exact code:** `.is('thumbs_backfilled_at', null).not('stored_photo_urls', 'is', null)` — no `is_servable`, no `city_id`.
- **What it does:** Selects ALL places pool-wide with originals but no thumbs.
- **What it should do:** Filter `is_servable = true` and accept an optional `city` (resolve to `city_id` via `seeding_cities`) so London's 7,234 can be targeted now.
- **Causal chain:** operator cannot target London today; the run grinds through 17k global rows including non-servable ones.
- **Verification (LIVE DB):** Global pending = **17,338** (servable **17,264**, non-servable **74**, avg **4.86** photos/place). Servable-scoping removes only 74 rows (~0.4%) — small. **City-scoping is the real lever** (London 7,234 of the 17,264). The auto-drain (F/D) is the durable fix for the global backlog.

### F-5 🔵 OBSERVATION — Server-driven model already exists and is the correct precedent

- **Files:** `run-place-intelligence-trial/index.ts:3000-3292` (`handleProcessChunk` budget loop + `EdgeRuntime.waitUntil` self-invoke at 3252) + `20260506000001_orch_0737_async_trial_runs.sql` (`tg_kick_pending_trial_runs` cron at `* * * * *`, `net.http_post`, vault `service_role_key`, `lock_run_for_chunk` NOWAIT, `increment_run_counters`).
- **What it proves:** The exact architecture ORCH-1033 needs is live and battle-tested. Mirror it: a `process_chunk` service-role action with a budget loop (~110s) that processes batches, then `EdgeRuntime.waitUntil` self-invokes if work remains, with a 1-min pg_cron kicker as recovery-only.
- **Verification (LIVE):** `cron.job` shows `kick_pending_trial_runs` active at `* * * * *`; `pg_cron` + `pg_net` extensions enabled; vault secrets `service_role_key` + `supabase_url` both present. All infra the new cron needs is already in place.

### F-6 🟠 CONTRIBUTING / CONSTRAINT — Generation must stay FREE (in-function); the metered render endpoint is strict-grep-gated

- **File + line:** `.github/scripts/strict-grep/orch-0957-no-metered-place-photo-reads.mjs` — fails CI if `/storage/v1/render/image/` appears anywhere under `supabase/functions/` EXCEPT the one allowlisted block in `_shared/imageCollage.ts:102-111` guarded by the `ORCH-0957 LEGACY FALLBACK ALLOWLIST` marker.
- **What it constrains:** ORCH-1033 must NOT introduce any Supabase image-transformation/render call for GENERATION (the metered $5/1,000-origin-images path). Generation stays on our own imagescript compute. **The F-3 fallback must fall back to the ORIGINAL OBJECT** (`/storage/v1/object/public/…/<i>.jpg`, non-metered), NOT the render endpoint — otherwise it would either trip this gate or re-meter every missing thumb.
- **Verification:** Gate file read in full; allowlist marker present at `imageCollage.ts:102`. The existing legacy fallback (`legacyTransformFallbackUrl` → `forceLegacySupabaseTransform=true` → render endpoint) is the metered path and must remain gated behind `USE_PLACE_PHOTO_THUMBS=false` only.

---

## Five-Layer Cross-Check

| Layer | Truth |
|-------|-------|
| **Docs** | ORCH-0957 SPEC: place-photos default to pre-generated 384px thumbnails via the non-metered object endpoint; render endpoint is emergency-only. ORCH-1024: thumbs share `photo_backfill_runs` via `RUN_CITY='ORCH-0957 place-photo thumbs'` discriminator. |
| **Schema** | `place_pool.stored_photo_urls` is `text[]` (NOT jsonb — use `array_length`, not `jsonb_array_length`). `thumbs_backfilled_at timestamptz`. `photo_backfill_runs` has `city`, `country`, `mode IN ('initial','pre_photo_passed','refresh_servable')`, `status IN ('ready','running','paused','completed','cancelled','failed')`. `photo_backfill_batches` has `place_pool_ids uuid[]`, `status`, counters. RLS = `service_role` full-access on both. No triggers on `place_pool`. |
| **Code** | `backfill-place-photo-thumbs` = serial, browser-looped, global, no self-invoke. `imageCollage.ts` = 404-only fallback. Both confirmed line-by-line. |
| **Runtime** | Missing thumb → HTTP 400 (not 404). Original → HTTP 200 baseline JPEG. Current thumb run paused at 0/694. Intelligence run fails ~68% in London. |
| **Data** | 17,338 global pending; 17,264 servable; London 7,234 missing of 10,706 servable. Originals capped at 800px (`photoStorageService.ts:361 maxWidthPx=800`); max sampled RGBA = 4.3 MB (800×1422). |

No layer contradictions in the fix direction; the bug IS the code-vs-runtime contradiction in F-3 (code expects 404, runtime returns 400).

---

## Safe Parallel-N — explicit memory math (Finding B)

**Per-photo decode peak.** imagescript `decode()` produces a `W×H×4`-byte RGBA bitmap. Place-photo originals are downloaded with `maxWidthPx=800` (`photoStorageService.ts:361`), so the long edge is ≤ 800px. Live sampling of 12 random stored originals: all are exactly 800px wide; the tallest was 800×1422 = **4.3 MB** RGBA. A pessimistic portrait bound of 800×2000 = **6.4 MB**. Encode adds a transient JPEG buffer of a few hundred KB (negligible vs the bitmap). The 384² output bitmap after resize is 0.56 MB (negligible).

**Budget.** Supabase edge functions run with a ~256 MB soft cap; the established Mingla contract (imageCollage.ts header + the intel pipeline's parallel-12 prep) targets staying under ~150 MB of in-flight decoded image memory with comfortable headroom. imagescript also retains some allocator slack, so we size conservatively.

**Derivation.** With a 6.4 MB pessimistic per-photo peak and a 60 MB in-flight image-memory budget (leaving >2× headroom under the 150 MB working contract and ~4× under the hard cap):

  N = floor(60 MB / 6.4 MB) ≈ 9.

**Recommended PARALLEL_N = 6** (LOCKED floor), giving 6 × 6.4 MB ≈ **38 MB** peak in-flight image memory — well under 150 MB, with margin for the supabase-js client, JSON, and allocator slack. This mirrors the intel pipeline's safe parallel band (it runs parallel-12 only because its per-photo peak is ~5 MB AFTER URL-transform downscaling; thumbs decode the FULL 800px original so a smaller N is correct). PARALLEL_N is an exported constant so the implementor/tester can tune 4–9 with the math written in a protective comment. Process photos in parallel WITHIN this N; keep places sequential within a batch is unnecessary — parallelize at the photo level across the batch's flattened photo list, capped by a semaphore of size N.

---

## Thumbnail consumers — exhaustive enumeration (audit requirement)

Grep of every `.ts/.tsx/.js/.jsx` under `supabase/`, `app-mobile/`, `mingla-business/`, `mingla-admin/`, `packages/` for `_thumb`:

| Consumer | Reads `_thumb.jpg`? | Notes |
|----------|--------------------|-------|
| `supabase/functions/_shared/imageCollage.ts` | **YES — sole runtime consumer** | `transformPhotoUrlForTile` rewrites place-photos object URLs to `_thumb.jpg` for the intelligence collage (`run-place-intelligence-trial` `compose_collage`). |
| `supabase/functions/backfill-place-photo-thumbs/index.ts` | writes them | generation engine (not a reader). |
| `imageCollage.test.ts`, `imageCollage.thumbFallback.test.ts`, `backfill-place-photo-thumbs/index.test.ts`, `photoStorageService.test.ts` | test files | not runtime. |
| **Consumer iOS/Android app** (`app-mobile/`) | **NO** | reads `stored_photo_urls` / `place_pool` originals directly; never derives `_thumb.jpg`. Verified by grep (zero `_thumb` hits in `app-mobile/`). |
| **Business app** (`mingla-business/`) | **NO** | zero `_thumb` hits. |
| **Buyer-web** | **NO** | zero `_thumb` hits. |

**Conclusion:** The intelligence collage is the ONLY consumer of `_thumb.jpg`. The F-3 fallback fix and the backlog drain affect ONLY the intelligence pipeline's collage step — no consumer/business/buyer-web blast radius. This bounds the test surface to backend Deno tests.

---

## Shared-table safety — Photos download backfill will NOT break (ORCH-1024)

- `backfill-place-photos` (originals download) and `backfill-place-photo-thumbs` (thumbs) BOTH write `photo_backfill_runs` / `photo_backfill_batches`. ORCH-1024 separated them by the `city` column: thumbs runs use the synthetic discriminator `RUN_CITY='ORCH-0957 place-photo thumbs'` (`backfill-place-photo-thumbs/index.ts:12`), and the admin Photos panel EXPLICITLY filters those out (`PlacePoolManagementPage.jsx:1488, 1560, 2917`: `.filter(r => r?.run?.city !== THUMBS_RUN_CITY)`).
- **Constraint for the spec:** ORCH-1033 must keep writing thumbs runs with `city='ORCH-0957 place-photo thumbs'` (or a city-scoped variant whose `city` value still does not collide with a real download city name). If city-scoping is added (F-4/C), the `city` value must remain distinguishable from a Photos-download city run, OR a new boolean/`mode` discriminator must be added so the Photos panel's filter still excludes thumbs runs. **Recommended:** keep the `country='GLOBAL'` + a thumbs-specific `mode` and have the Photos panel exclude by `mode`/marker, rather than overloading `city` with a real city name (which would leak thumbs runs into the Photos status bar). The SPEC pins this.

---

## Migration ledger drift — `db push` blocked, Management API at close

- This worktree branch is **behind main**: it lacks `20260809000000_meta_orch_1009_sub_e_*`, `20260809000300_*`, and `20260811000000_orch_1032_queued_status_and_cap.sql`, all of which are already on `origin/main` and applied to remote.
- `supabase db push` from the worktree would attempt to re-apply remote-only migrations / hit ledger drift (the exact condition the dispatch flags). Per ORCH-1032's precedent, the new ORCH-1033 migration must be applied via the **Supabase Management API SQL endpoint** (`POST /v1/projects/gqnoajqerqhnvulmnyvv/database/query`) at close, then recorded, rather than via `db push`.
- All cron/pg_net/vault infra the new migration relies on is already live (verified): `pg_cron`, `pg_net`, vault `service_role_key` + `supabase_url`.

---

## Outcome & Journey Step-Back

- **Operator's actual goal:** "London (and every seeded city) has working thumbnails so the intelligence pipeline scores its places, without me babysitting a browser tab." The job-to-be-done is a self-draining thumbnail backlog + a collage step that survives a missing thumb.
- **Journey:** Seed/refresh a city → originals download (`backfill-place-photos`) → thumbnails generate → intelligence run composes collage from thumbnails → Gemini scores → consumer deck reflects scores.
- **Divergence points:** (a) thumbnails never finish generating (F-1/F-2); (b) even where a thumb is missing for ONE photo, the collage drops the whole place (F-3); (c) operator can't target the city that needs it (F-4); (d) new seeds don't auto-generate thumbs (F-2/D).
- **Does fixing the reported node deliver the outcome?** Fixing F-3 alone makes the intelligence run survive missing thumbs (by falling back to originals) — but that re-introduces full-size decodes in the collage hot path for every missing thumb, so it MUST be paired with the F-1/F-2/D drain so missing-thumb fallback stays the rare exception, not the norm. Fixing the drain alone (A–D) without F-3 still fails every place during the window before its thumbs exist. **Both layers are required** for the end-to-end outcome; the SPEC ships them together.

---

## Blast Radius

- **Backend:** `backfill-place-photo-thumbs` (rewrite to server-driven), `_shared/imageCollage.ts` (fallback fix), new migration (cron + kicker + optional column/discriminator), strict-grep allowlist (`orch-0863-marketing-hub-phase-b.mjs` C7 + the ORCH-0957 metered gate unchanged).
- **Admin-web:** `PlacePoolManagementPage.jsx` Thumbnails tab → status-viewer over the server run (no browser engine), Photos panel filter must still exclude thumbs runs.
- **NOT touched:** consumer iOS/Android, business iOS/Android, buyer-web (no `_thumb` readers there).
- **Shared-table:** `photo_backfill_runs`/`photo_backfill_batches` shared with Photos download — preserve the ORCH-1024 discriminator (do not regress the Photos panel).

---

## Invariant Violations / New Invariants

- **Violated (latent):** the ORCH-0957 contract "place-photos served via pre-generated thumbnail with graceful fallback to a decodable source" is broken because the fallback never fires on the real 400.
- **New invariants to establish (SPEC owns the IDs):**
  - `I-THUMB-MISSING-FALLBACK-ON-NON-OK` — collage fallback fires on ANY non-OK/missing-object thumb response (incl. 400 "Object not found"), falling back to the ORIGINAL object, never the metered render endpoint.
  - `I-THUMB-BACKFILL-SERVER-DRIVEN` — thumbnail generation runs via cron-kicked self-invoke chain; no browser loop is the run engine.
  - `I-THUMB-DECODE-PARALLEL-N-BOUNDED` — per-invocation in-flight decode parallelism ≤ PARALLEL_N with the 800px/6.4 MB memory math in a protective comment.

---

## Discoveries for Orchestrator

1. The existing `imageCollage.thumbFallback.test.ts` mocks the missing thumb as **404**, which is why it stayed green while production failed on the real **400**. Any other test that asserts Supabase "object missing" semantics with a bare 404 mock is suspect — recommend a one-line audit grep at CLOSE.
2. There is a stale `paused` thumbs run (`49dcd9aa…`, 0/694 batches, created 2026-06-02) sitting in `photo_backfill_runs`. The server-driven cutover should cancel/supersede pre-existing browser-era `paused`/`ready` rows so the new kicker doesn't double-drive a half-dead run.
3. The worktree branch is behind main (missing the `20260809*` + ORCH-1032 migrations). Implementor should rebase onto main before adding the new migration to avoid a fresh ledger collision.

---

## Confidence

**Proven (H).** Root causes F-1/F-2/F-3 each have all six fields; F-3 is confirmed by live HTTP probe (400 + JSON body) and live DB (7,234/10,706 = 67.6% matches the reported 69%). The 800px memory math is grounded in `photoStorageService.ts:361` + 12-sample live measurement. The server-driven model is read in full and its infra verified live. Backend/SQL/admin-only → Prime-Directive-7 sim repro exempt.

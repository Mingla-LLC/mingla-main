# INVESTIGATION — ORCH-1044 [Thumbnail generation must fit the edge compute budget + reliably drain]

- **Date:** 2026-06-02
- **Author:** mingla-forensics (Claude)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1044-[thumb-gen-fits-edge-compute]/` on branch `ORCH-1044-thumb-gen-fits-edge-compute`
- **Scope:** Backend only — `supabase/functions/backfill-place-photo-thumbs` (deployed v34, ORCH-1043) + its cron driver + the collage consumer `_shared/imageCollage.ts`. No client surface.
- **Confidence:** **root cause PROVEN** (live edge logs + live DB state + Supabase docs + a reproduced CPU benchmark + a reproduced transform-decode probe). Pure-backend ORCH; no simulator repro applicable (Prime Directive 7 exemption: backend/edge-function investigation).

---

## 0. Comms ledger acks

- **COMMS-0002** (WARN, ALL) — ORCH-0863 strict-grep C7 `no-new-backend-files` blocks PRs adding files under `supabase/functions/`. **Factored:** the recommended fix adds a NEW migration (orphaned-batch reclaim) → its filename MUST be appended to an allowlist in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit. `backfill-place-photo-thumbs/index.ts` + `index.test.ts` are ALREADY allowlisted under `ORCH_0957_BACKEND_ALLOWLIST` (no new entry needed for editing them).
- **COMMS-0003** (WARN, ALL) — external-API params cited against provider docs inline. **Factored:** all Supabase Edge Function limit numbers + the Storage render-transform behavior below cite the canonical docs URLs.
- No `BLOCK` entry is addressed to this skill or to ORCH-1044.

---

## 1. Symptom summary (expected vs actual)

| | |
|---|---|
| **Expected** | A cron-driven thumbnail backfill run drains the ~17k-place / ~84k-photo global backlog: `completed_batches` climbs, `total_succeeded` climbs, `_thumb.jpg` objects appear, zero 546 in edge logs. |
| **Actual** | Every `process_chunk` invocation returns **HTTP 546 (WORKER_LIMIT)** at ~5–6 s wall time. The active run created its 691 batches but has completed exactly **1** batch (25 places) and is otherwise frozen: 679 batches `pending`, **11 batches orphaned in `running`**, `total_succeeded` stuck at 25. The cron re-kicks every 10 min; each kick dies at 546 before completing a batch. The backlog does not drain. |

---

## 2. Investigation manifest (files + live sources read, in trace order)

| # | Source | Why |
|---|--------|-----|
| 1 | `COMMS_LEDGER.md` | Mandatory entry scan. |
| 2 | `supabase/functions/backfill-place-photo-thumbs/index.ts` (worktree copy) | The function under investigation — found STALE (pre-ORCH-1043). |
| 3 | **Live deployed v34** via `mcp__supabase__get_edge_function` | The ACTUAL running code (ORCH-1043 server-driven + PARALLEL_N=6 + budget loop). Authoritative. |
| 4 | `supabase/functions/_shared/photoStorageService.ts` | Confirms originals capped at `maxWidthPx=800` (L361), `MAX_PHOTOS=5` (L36). |
| 5 | `supabase/functions/_shared/imageCollage.ts` | The downstream CONSUMER of `_thumb.jpg` (Approach B decode risk). |
| 6 | **Live edge logs** via `mcp__supabase__get_logs(edge-function)` | Proves 546 at 5–6 s on v34, and the shared-ceiling on `run-place-intelligence-trial`. |
| 7 | **Live DB** `photo_backfill_runs` / `photo_backfill_batches` / `place_pool` | Proves the stuck run, the 11 orphaned `running` batches, the 17,239 backlog. |
| 8 | **Live cron** `cron.job` + `pg_get_functiondef('tg_kick_pending_thumb_backfill')` | The cron driver + heartbeat-recovery logic (no batch-level reclaim). |
| 9 | `.github/scripts/strict-grep/orch-0957-no-metered-place-photo-reads.mjs` | The gate that BLOCKS Approach B's render-endpoint use. |
| 10 | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (origin/main) | The C7 backend allowlist + existing ORCH-0957/1043 entries. |
| 11 | Supabase docs (limits + render transforms) — see §4 | CPU/wall/memory limits + 546 semantics + transform output format. |
| 12 | **Local Deno benchmark** (imagescript@1.2.17) | Measured per-photo CPU cost + reproduced transform decode behavior. |

---

## 3. Findings (classified, with six-field evidence on the root cause)

### 🔴 ROOT CAUSE 1 — `process_chunk` does CPU-bound imagescript work that vastly exceeds the **2 s CPU-time** isolate limit; the isolate retires with 546 before a batch completes.

- **File + line:** `backfill-place-photo-thumbs/index.ts` (deployed v34) — `BUDGET_MS = 110_000`, `SAFETY_MAX_ITERATIONS = 20`, `PARALLEL_N = 6`, `DEFAULT_BATCH_SIZE = 25`; `encodeThumb()` (`decode(bytes)` → `decoded.resize(384,384)` → `decoded.encodeJPEG(80)`); `processBatch()` flattens ALL photos of a 25-place batch into one job list and drains it through `runWithConcurrency(..., PARALLEL_N)`; `handleProcessChunk()` loops `claimAndProcessNextBatch` until the 110 s wall budget.
- **Exact code:** 
  ```ts
  async function encodeThumb(bytes: Uint8Array): Promise<Uint8Array> {
    const decoded = await decode(bytes);                 // CPU: full 800px JPEG decode (WASM)
    if (!(decoded instanceof Image)) throw new Error('decoded_non_image');
    decoded.resize(THUMB_SIZE, THUMB_SIZE);              // CPU: resample to 384²
    return await decoded.encodeJPEG(THUMB_JPEG_QUALITY); // CPU: JPEG re-encode
  }
  ```
- **What it does:** Synchronous, CPU-bound decode+resample+encode per photo. A 25-place batch ≈ 125 photos; the budget loop then keeps claiming MORE batches (up to 20 iterations / 110 s wall) — thousands of CPU-heavy ops accumulate in **one isolate**.
- **What it should do:** Keep total **CPU time per invocation** under the 2 s hard cap with margin — i.e. process only a handful of photos per invocation, then return and self-invoke.
- **Causal chain:** Supabase edge isolates enforce **Max CPU Time = 2 s** ("actual time spent on the CPU per request — does not include async I/O", [limits doc](https://supabase.com/docs/guides/functions/limits)). imagescript decode/resize/encode is pure CPU. At PARALLEL_N=6, six decodes run "concurrently" but on a single-threaded isolate they SERIALIZE on the CPU, so CPU accrues fast. Once the isolate crosses the soft limit it "retires"; if the in-flight request then exhausts CPU before completing, the isolate "terminate[s] immediately and return[s] a 546 response" ([546 troubleshooting](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response); [Discussion #21293](https://github.com/orgs/supabase/discussions/21293)). The wall time at death is ~5–6 s because async I/O (fetch original, HEAD thumb-exists, upload) interleaves with the CPU bursts — CPU 2 s is reached while wall is ~5–6 s.
- **Verification step (DONE):**
  - **Live edge logs (v34):** `POST | 546 | …/backfill-place-photo-thumbs execution_time_ms: 6431`, `5079`, `4941` — repeated 546 at 5–6 s. (Same logs show `run-place-intelligence-trial` 546 at 3–7 s and 18–36 s — the shared ceiling across the 3 things flagged.)
  - **Live DB:** run `7b782c45` = `running`, `total_batches=691`, `completed_batches=1`, `total_succeeded=25` — only the single fastest batch ever finished; everything after dies at 546.
  - **Local CPU benchmark (imagescript@1.2.17, real 800×600 place photo `…/ChIJSzwAG_ORwokRiUMl6LePoJ0/0.jpg`, 74 KB):** decode+resize(384)+encodeJPEG(80) synchronous block = **46–226 ms per photo (avg ~115 ms) on Apple-Silicon M-series**. Supabase shared edge CPU is materially slower (typically 3–5×), putting real per-photo CPU at **~0.3–1 s+**. Even at the optimistic 115 ms, the 2 s cap allows ~17 photos of pure compute; at a realistic 400–700 ms it allows only **~3–5 photos** before the isolate retires. A 125-photo batch (let alone a multi-batch budget loop) cannot fit. **Cause confirmed: CPU-time, not memory.**

> **Two candidate causes considered + the non-cause DISPROVEN:**
> - *Memory (the 256 MB cap)?* — **Disproven.** The ORCH-1043 memory comment is sound: originals are ≤800px (`photoStorageService.ts:361`), so the worst-case RGBA bitmap ≈ 800×~2000×4 ≈ 6.4 MB; 6 in flight ≈ 38 MB ≪ 256 MB. A memory-driven 546 would also typically fire at peak concurrency regardless of duration, not consistently at the same 5–6 s. The benchmark + the 2 s CPU doc + the wall-time signature all point at CPU.
> - *CPU-time (2 s)?* — **Confirmed** by the benchmark + the doc's explicit "does not include async I/O" CPU clause + the consistent 5–6 s wall (CPU saturates while I/O stretches wall).

### 🔴 ROOT CAUSE 2 — When `process_chunk` dies at 546, the batch it claimed is left **orphaned in `running` forever**; nothing ever resets it to `pending`, so even a CPU-fixed worker cannot fully drain.

- **File + line:** `claimAndProcessNextBatch()` flips `pending → running` (conditional UPDATE), THEN calls `processBatch()`, THEN writes the terminal `completed`/`failed` status. If the 546 kills the isolate between the claim and the terminal write, the batch stays `running`. The recovery path `tg_kick_pending_thumb_backfill()` only re-kicks **runs** with a stale heartbeat and only ever claims `pending` batches — there is **no `running → pending` batch reclaim**.
- **Exact evidence (live DB):** run `7b782c45` → **11 batches in `running`**, 679 `pending`, 1 `completed`. Those 11 were claimed by 546-killed workers and are now invisible to every future claim.
- **What it should do:** Stale `running` batches (claimed but not terminal within a bound) must be reclaimable back to `pending` so the run can complete.
- **Causal chain:** Claim-then-do without a stale-claim reaper → 546 mid-batch → orphaned `running` → permanent under-drain even after CPU is fixed (the run can never reach `allBatchesDone`, and `completed` is never set).
- **Verification step (DONE):** the 11 `running` rows on a run whose only worker activity is repeated 546s, with a cron that does not touch batch status.

### 🟠 CONTRIBUTING FACTOR 1 — The budget loop is designed to chew MANY batches per invocation (110 s wall / 20 iterations). Even at a "safe" small batch size, multi-batch-per-invocation re-accumulates CPU and re-hits 546.
The fix must cap **per-invocation total work** (CPU budget), not just per-batch size. A single small batch per invocation + immediate self-invoke is the bulletproof shape.

### 🟠 CONTRIBUTING FACTOR 2 — `PARALLEL_N=6` provides no throughput benefit on a single-threaded isolate for CPU-bound work and accelerates hitting the CPU soft limit.
Concurrency only helps the I/O legs (fetch/upload). For decode/encode it just front-loads CPU. Lowering to 1–2 makes CPU accrual predictable and lets a guard stop cleanly.

### 🟡 HIDDEN FLAW 1 — Worktree is STALE (pre-ORCH-1043). The implementor must rebase onto current `origin/main` first.
The worktree `index.ts` has **0** occurrences of `process_chunk`/`PARALLEL_N`/`BUDGET_MS`. ORCH-1043 is merged to main (`c019f8f1d` + hotfix `952b23960`) and is what is deployed (v34). Editing the stale file and merging would **revert ORCH-1043** (echoes COMMS-0015's deploy-from-stale lesson). The SPEC mandates a rebase-first step.

### 🟡 HIDDEN FLAW 2 — Approach B (render endpoint) tripwires the ORCH-0957 strict-grep gate.
`orch-0957-no-metered-place-photo-reads.mjs` fails CI if `/storage/v1/render/image/` appears in ANY edge function except the labeled fallback block in `_shared/imageCollage.ts`. Approach B uses that endpoint for GENERATION → would FAIL the gate unless the gate is updated to allowlist the thumb-generator. (Reconciliation cost, not a blocker — but a deliberate gate change requiring operator awareness.)

### 🔵 OBSERVATION 1 — The PRE-ORCH-1043 serial path DRAINED successfully at batch_size≈3.
Live DB run `b24329ed` (2026-05-30): `total_places=17405`, `total_batches=5802` (⇒ batch_size 3), `completed_batches=5599`, `total_succeeded=16741`, `total_failed=47`. **A tiny batch + serial processing already proved it can drain the whole global backlog.** This is direct empirical support for Approach A.

### 🔵 OBSERVATION 2 — Approach B's progressive/format risk is REAL but RESOLVABLE (proven).
See §5. The transform returns baseline JPEG to a default `fetch` (no webp `Accept`) and imagescript decodes it; it returns WebP to a browser-like `Accept` and imagescript FAILS. So B is safe only with an explicit format guard.

---

## 4. Five-layer cross-check + external research (docs cited)

| Layer | Finding |
|-------|---------|
| **Docs** | **Supabase Edge Function limits** ([limits](https://supabase.com/docs/guides/functions/limits)): **Max CPU Time = 2 s** ("actual time spent on the CPU per request — does not include async I/O"); **Max Memory = 256 MB**; **wall-clock = 150 s (Free) / 400 s (Paid)**; idle timeout 150 s → 504. **546 = WORKER_LIMIT**: isolates have soft+hard CPU limits; at the soft limit the isolate "retires"; once 50 % of a resource is used it finishes the current request then shuts down, but "if that remaining request exhausts all CPU or memory before completion, the isolate will terminate immediately and return a 546 response" ([546 doc](https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response); [Discussion #21293](https://github.com/orgs/supabase/discussions/21293) — note the "wall clock time limit reached" log line is hard-coded and printed even on CPU/memory termination, so the log text is NOT reliable for attributing the cause). |
| **Schema** | `photo_backfill_runs` (status, total/completed/failed/skipped batches, totals, `triggered_by` nullable post-`20260816000000`, `last_heartbeat_at`), `photo_backfill_batches` (status pending/running/completed/failed/skipped, place_pool_ids, counters), `place_pool.thumbs_backfilled_at` (`20260727000001_orch_0957…`). Cron migration `20260815000000_orch_1043_thumb_backfill_cron.sql`. |
| **Code** | Deployed v34 = ORCH-1043 server-driven loop (root causes 1 + 2 above). Worktree copy is the pre-1043 serial version (stale). |
| **Runtime** | Live edge logs: repeated 546 at 5–6 s on v34. |
| **Data** | Live DB: 17,239 servable no-thumb places; run `7b782c45` frozen at 1/691 batches with 11 orphaned `running`. |

**External research (Prime Directive 12):**
- **imagescript@1.2.17** uses a WASM JPEG codec; it decodes grayscale/RGB/CMYK JPEG (incl. baseline EXIF variant — proven below) but does **NOT** decode WebP (proven `Unsupported image type` below). The collage path ALREADY decodes `encodeJPEG`-produced `_thumb.jpg`, so the current generation→consumption loop is decodable today.
- **Supabase Storage image transformations** ([docs](https://supabase.com/docs/guides/storage/serving/image-transformations)): params `width` (1–2500), `height`, `resize` (cover default / contain / fill), `quality` (20–100, default 80), `format`. **Default output is content-negotiated** ("automatically find the best format supported by the client") — WebP for webp-capable clients. `format=origin` forces the source format. Pricing ≈ $5 / 1,000 origin images.

---

## 5. Approach B decode risk — RESOLVED with proof

Reproduced against the real object `…/place-photos/ChIJSzwAG_ORwokRiUMl6LePoJ0/0.jpg` using the render endpoint `…/storage/v1/render/image/public/place-photos/…/0.jpg?width=384&height=384&resize=cover`, decoding with imagescript@1.2.17:

| Fetch variant | HTTP | content-type | magic bytes | imagescript `decode()` |
|---|---|---|---|---|
| **default** (Deno `fetch`, `Accept: */*`) | 200 | `image/jpeg` | `ff d8 ff e1` (JPEG/EXIF, **baseline**) | ✅ `Image 384x384` |
| **browser-like** (`Accept: image/webp,…`) | 200 | `image/webp` | `52 49 46 46` ("RIFF"/WebP) | ❌ `DECODE_FAIL: Unsupported image type` |
| **`&format=origin`** (browser-like Accept) | 200 | `image/jpeg` | `ff d8 ff e1` | ✅ `Image 384x384` |

**Conclusion:** the transform does NOT emit progressive JPEG to a non-webp client — it emits **baseline JPEG**, which imagescript decodes. The real danger is **content negotiation**: a webp-preferring `Accept` yields WebP bytes that imagescript cannot decode, which would silently poison the stored `_thumb.jpg` and break the collage later. **B is safe iff the generator pins the format** — either fetch with `Accept: image/jpeg` (or `*/*`, which Deno's default already sends) AND append **`&format=origin`** (defensive, removes negotiation entirely). With that pin, B's stored `_thumb.jpg` is guaranteed baseline JPEG and the collage decodes it.

---

## 6. Recommendation — **Approach A (FREE)**, with a CPU/wall budget guard + orphaned-batch reclaim

**Why A over B:**
1. **A is FREE; B costs ~$420 global** and re-bills on every future origin.
2. **A is already proven to drain** — the pre-1043 serial-batch-3 run finished 16,741/17,405 (Observation 1). The 546 is purely an over-ambitious per-invocation work budget that ORCH-1043 introduced; dialing it back is bulletproof.
3. **A keeps the ORCH-0957 no-metered gate intact** (no render endpoint, no gate change, no cost surface).
4. **A has zero decode risk** — `encodeJPEG` output is the exact thing the collage already decodes today.
5. B's only advantage (CPU-trivial generation) is irrelevant given the operator runs overnight and "correctness > throughput."

**B remains the documented fallback** if, after A ships, the CPU budget proves impossible to keep under 2 s even at 1 photo/invocation (not expected — one 800px decode is ~0.3–1 s of edge CPU). If B is ever chosen, it MUST pin `format=origin` + non-webp `Accept` (§5) AND update the ORCH-0957 gate allowlist same-commit.

### Exact A tuning (the SPEC pins these)
- **`PARALLEL_N = 1`** (serial; concurrency buys nothing for CPU-bound work and only accelerates the soft limit). Optionally 2 is acceptable but 1 is safest.
- **Per-invocation work cap = 1 batch, `batch_size = 4`** (≈ up to 20 photos worst-case at MAX_PHOTOS=5, but typically far fewer un-done photos since `thumbExists` HEAD skips). **CPU guard, not photo count, is the real stop:** add an explicit `CPU_SOFT_BUDGET` check inside the photo loop.
- **CPU/wall budget guard:** maintain a per-invocation wall stopwatch; **stop claiming/processing new photos once wall ≥ 1200 ms** (PROXY for the 2 s CPU cap with ~800 ms headroom — wall ≥ CPU, so 1.2 s wall guarantees < 2 s CPU for the CPU-bound portion). After finishing the in-flight photo, write progress and **self-invoke immediately** (`EdgeRuntime.waitUntil`) if work remains.
- **Replace the 110 s multi-batch budget loop** with a **single small unit per invocation** then self-invoke. Many tiny self-invokes, cron-backstopped. Slow but never 546.
- **Orphaned-batch reclaim (Root Cause 2):** a `running → pending` reaper for batches whose `started_at` is older than a bound (e.g. 3 min) with no terminal status — implemented in `tg_kick_pending_thumb_backfill()` (or a sibling) via the existing cron. Migration applies via Management API (db push is drift-blocked).

**Verification of a real drain (the orchestrator watches live):** run creates → `completed_batches` climbs each cron tick / self-invoke chain → `total_succeeded` climbs → **zero 546** for `backfill-place-photo-thumbs` in `mcp__supabase__get_logs(edge-function)` → `_thumb.jpg` HEAD/GET returns 200 for processed places → run reaches `completed` with `completed_batches + failed + skipped == total_batches` and 0 orphaned `running`.

---

## 7. Blast radius

- **Direct:** `backfill-place-photo-thumbs` (admin backfill + cron). No consumer/business/web/admin UI behavior changes (admin Photos panel only polls `run_status`).
- **Downstream consumer:** `_shared/imageCollage.ts` → `run-place-intelligence-trial` reads `_thumb.jpg`. Approach A produces the same `encodeJPEG` bytes already consumed → no decode change. (Approach B WOULD risk this — another reason to prefer A.)
- **Shared ceiling:** `run-place-intelligence-trial` shows the same 546 family in logs. NOT in scope for ORCH-1044 (thumbnails only) but should be **registered as a discovery** — the intel/collage path likely needs the same per-invocation CPU-budget discipline.

---

## 8. Invariants

- **Preserve:** server-driven self-invoke + cron (ORCH-1043); `triggered_by = NULL` for cron/auto runs (`20260816000000`); the ORCH-0957 no-metered-render gate (A does NOT call the render endpoint → gate stays green untouched); ORCH-1024 run-discriminator (`city=RUN_CITY`, `country=RUN_COUNTRY`).
- **New (proposed):** `I-THUMB-INVOCATION-CPU-BUDGET-BOUNDED` — a single `process_chunk` invocation must stop and self-invoke on a wall-time guard well under the 2 s CPU cap; never attempt an unbounded multi-batch budget loop. `I-THUMB-ORPHANED-RUNNING-BATCH-RECLAIMED` — a `running` batch with no terminal status past the stale bound is reset to `pending` by the cron.

---

## 9. Discoveries for orchestrator

1. **Shared CPU ceiling on `run-place-intelligence-trial`** (collage/intel prep) — repeated 546 at 3–36 s in the same live logs. Same root mechanism (imagescript CPU > 2 s). Out of ORCH-1044 scope; recommend a sibling ORCH to apply the same per-invocation CPU-budget discipline to the intel/collage pipeline.
2. **Worktree is stale (pre-ORCH-1043)** — implementor must rebase onto `origin/main` before editing (Hidden Flaw 1).
3. **11 orphaned `running` batches on run `7b782c45`** right now — the fix's reclaim will recover them; until then they are dead weight. (No manual action needed if the reclaim ships.)

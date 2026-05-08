# INVESTIGATION — ORCH-0737 v8 — Gemini Flash Throughput Deep Dive

**Status:** INVESTIGATE-only complete. SPEC is **not** ready. Next step is a measurement/instrumentation SPEC or an operator-authorized live-fire baseline run.

**Mode:** `$forensic-mingla` per `Mingla_Artifacts/prompts/FORENSICS_ORCH-0737_V8_FLASH_THROUGHPUT_DEEP_DIVE.md`.

**Confidence:** HIGH on current code path, DB state, cache state, no-post-v6.1-run finding, and Supabase/Gemini official-doc constraints. MEDIUM on London wall-clock projections because they depend on unmeasured v6.1 throughput. LOW on exact Gemini 429/burst cause because current telemetry cannot prove it.

**Author:** forensic-mingla, 2026-05-07.

---

## 1. Executive Summary

The Flash system works, but its speed story is not yet proven. The current edge function uses `gemini-2.5-flash`, `inline_data` base64 image upload, `Promise.all` score batches, score `.limit(6)`, and prep `.limit(12)`. No run has started after the v6.1 deploy at **2026-05-06 23:54 UTC**, so the projected 10-15 rows/min is still unverified. The last proven runtime is v6, not v6.1: Cary completed **451 rows in 78.30 min = 5.76 rows/min** after v6 deployed.

The clearest hard blocker is telemetry: pg_net captured only **38 responses**, all `status_code=null`, all 5s timeout errors, during the v6 acceleration window. It cannot distinguish Gemini 429, Supabase timeout, self-invoke timeout, or external API latency. The biggest proven product-scale drag is cold cache: London is **6/3,495 cached = 0.17%**, so a London run must compose ~3,489 collages before scoring.

Recommendation: do **not** write a performance fix spec yet. First ship the smallest measurement patch or run a bounded cold-city baseline with stable timing markers. Then spec cache warming plus measured parallel ramp. File API and model swaps are secondary until timing proves they matter.

---

## 2. Status Report

### What is shipped

- `gemini-2.5-flash` is the sole active provider in `supabase/functions/run-place-intelligence-trial/index.ts:50-53`.
- Gemini HTTP retry uses `MAX_ATTEMPTS = 4` and `BASE_BACKOFF_MS = 12_000` in `index.ts:89-91`; retryable statuses include `429` and `5xx` in `index.ts:177-187`.
- The score path fetches the collage, base64-encodes it, and sends it as `inline_data` in `index.ts:202-215` and `index.ts:1135-1144`.
- The Gemini call also sends `tools.function_declarations` and `toolConfig.functionCallingConfig.mode = "ANY"` in `index.ts:1146-1159`.
- Score is parallel-6 via `.limit(6)` in `runScoreIteration` at `index.ts:1742-1748`.
- Prep is parallel-12 via `.limit(12)` in `runPrepIteration` at `index.ts:1827-1833`.
- The budget loop runs until `V6_BUDGET_MS = 110_000` or six iterations in `index.ts:1506-1508` and `index.ts:1573`.

### What is verified

- Cary full-city run `6e26715f-fd50-49eb-80f8-5aa23027e428` completed: 761 processed, 760 succeeded, 1 failed.
- v6 acceleration window: 451 rows completed from `2026-05-06 16:25:12 UTC` to `17:43:30 UTC`, **5.76 rows/min**.
- No post-v6.1 runs exist: `count(*) where started_at >= '2026-05-06 23:54:00+00' = 0`.
- No post-v6 `WORKER_RESOURCE_LIMIT 546` responses: count = 0 since `2026-05-06 16:24:54 UTC`.
- Cary row duration distribution over 761 rows: p50 17.728s, p75 20.122s, p95 25.312s, p99 49.874s, max 73.184s; 9 rows had `retry_count > 0`.

### What is projected, not verified

- v6.1 10-15 rows/min is not proven. It is a projection from lowering score parallelism to 6.
- London at ~5 hours under v6.1 remains a projection.
- Parallel-24 or parallel-48 safety is not proven because 429/burst telemetry is absent.

### What is unknown

- True Gemini HTTP latency p50/p95/p99.
- Whether v6 parallel-12 failed because of quota, burst-per-second behavior, Supabase edge timeout, Deno isolate/network pressure, or all of the above.
- Whether File API reduces end-to-end wall-clock enough to matter.
- Whether `gemini-2.5-flash-lite` or `gemini-3.1-flash-lite` preserves schema quality for the Q2 tool call.

---

## 3. Architecture Map

### Admin trigger

`mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` displays Gemini model badges and starts full-city runs. Historical browser sample-mode comments still mention Gemini throttle, but full-city async runs are now server-driven.

### Edge dispatch

`run-place-intelligence-trial/index.ts` validates `GEMINI_API_KEY`, handles `process_chunk` through service-role auth, and routes `start_run`, `run_trial_for_place`, `compose_collage`, and worker actions.

### Collage prep

- `handleComposeCollage` loads `stored_photo_urls`, top review media, computes `fingerprintPhotos(allPhotos)`, returns cached collage when `photo_collage_fingerprint` matches, otherwise composes and uploads PNG to `place-collages`: `index.ts:544-640`.
- `fingerprintPhotos` hashes the native source URL list: `_shared/imageCollage.ts:36-46`.
- `transformPhotoUrlForTile` rewrites Supabase Storage and Google CDN photo URLs to tile resolution: `_shared/imageCollage.ts:48-100`.
- `composeCollage` intentionally keeps per-call photo fetch/decode serial to avoid multiplying outer parallel-12 by inner 16-photo concurrency: `_shared/imageCollage.ts:157-163`.

### Score

- `processOnePlace` marks a child row running, loads a trimmed `place_pool` column set, loads top 30 reviews, builds prompts, calls Gemini, writes Q2 output, cost, retry_count, and completed status: `index.ts:937-1041`.
- `fetchAsBase64` does Storage GET + ArrayBuffer + base64 encoding: `index.ts:202-215`.
- `callGeminiQuestion` sends image `inline_data`, text, system instruction, function declaration, `toolConfig`, and `maxOutputTokens: 8000`: `index.ts:1126-1170`.
- `callGeminiWithRetry` retries `429`/`5xx`, using `retry-after` capped to 60s or exponential backoff: `index.ts:160-199`.

### Scheduler / recovery

- `place_intelligence_runs` tracks parent run state and counters: migration `20260506000001_orch_0737_async_trial_runs.sql:23-55`.
- `lock_run_for_chunk` uses `FOR UPDATE NOWAIT` inside the RPC transaction: migration lines `108-123`.
- `increment_run_counters` atomically bumps processed/succeeded/failed/cost: migration lines `127-148`.
- `pg_cron` runs every minute: migration lines `161-164`.
- `tg_kick_pending_trial_runs` re-kicks running stale-heartbeat runs older than 90s via pg_net: migration lines `171-221`.
- `prep_status` and pickup index are defined in `20260507000002_orch_0737_v4_prep_status.sql:26-42`.

---

## 4. Fresh Runtime Evidence

### Latest runs

| run | city | status | count | started | completed | rows/min full run |
|---|---|---|---:|---|---|---:|
| `6e26715f...` | Cary | complete | 761 | 2026-05-06 09:27 UTC | 2026-05-06 17:43 UTC | 1.53 |
| `7e05a19c...` | Cary | cancelled | 30 | 2026-05-06 08:34 UTC | 2026-05-06 09:03 UTC | 1.05 |
| `3660594f...` | Cary | cancelled | 24 | 2026-05-06 07:25 UTC | 2026-05-06 08:31 UTC | 0.36 |
| `a8f40794...` | Cary | complete sample | 50 | 2026-05-06 05:48 UTC | 2026-05-06 06:01 UTC | 4.02 |

**Post-v6.1 live-fire:** none. `runs_after_v61 = 0`.

### v6 acceleration windows

After v6 deploy (`2026-05-06 16:24:54 UTC`), Cary completed 451 rows in 78.30 minutes = **5.76 rows/min**.

5-minute windows ranged from **0.60/min to 10.40/min**. 15-minute windows ranged from **4.73/min to 7.53/min**, ignoring the final partial bucket. This verifies a 7.7x improvement over pre-v6 0.75/min, but not the v6 projected 13+/min.

### Cache state

| City | servable rows | cached collages | cached % |
|---|---:|---:|---:|
| London | 3,495 | 6 | 0.17% |
| Washington | 2,298 | 1 | 0.04% |
| Brussels | 1,858 | 2 | 0.11% |
| Raleigh | 1,540 | 10 | 0.65% |
| Baltimore | 1,205 | 1 | 0.08% |
| Fort Lauderdale | 958 | 5 | 0.52% |
| Lagos | 908 | 1 | 0.11% |
| Cary | 761 | 761 | 100.00% |
| Durham | 648 | 4 | 0.62% |

### Payload sample

HEAD on a current Cary collage returned:

- `content-type: image/png`
- `content-length: 1,431,624`

Base64 upload size is therefore approximately `1.91 MB` for that sample. The v7 sample was `1.74 MB raw / ~2.32 MB base64`; current observed range is still large enough that payload timing deserves measurement, but not enough to assume File API is the primary bottleneck.

### pg_net health

Since v6 deploy:

- `net._http_response` rows = 38
- `status_code IS NULL` = 38
- `status_code = 200` = 0
- `status_code = 429` = 0
- sample error: `Timeout of 5000 ms reached`

This proves pg_net's 5s self-invoke timeout is a monitoring blind spot for a worker intentionally running up to 110s. It does **not** prove the worker failed.

---

## 5. Findings

### RC-1 — Telemetry cannot prove the Flash bottleneck

**Classification:** production-hardening gap / confirmed blocker.

**File/line:** `run-place-intelligence-trial/index.ts:160-199`, `index.ts:1126-1220`, `index.ts:1765-1791`; `net._http_response` live probe.

**Exact code:** Gemini retry logs only to console on `429`/`5xx`; child rows store `retry_count` only for `MALFORMED_FUNCTION_CALL`, not HTTP retries. The worker uses `Promise.all` and catches per-row failures, but no per-stage timing is persisted.

**Current behavior:** DB row timestamps prove total row duration, but not `fetchAsBase64`, Gemini HTTP latency, retry/backoff, DB overhead, or scheduler overhead. pg_net captures self-invoke timeout after 5s, not worker completion.

**Expected behavior:** A performance investigation should be able to answer which stage consumed time per row and per batch.

**Causal chain:** no timing fields/log markers + pg_net 5s timeout + long-running worker = no hard evidence for true cause of slow Flash throughput.

**Verification step:** add temporary structured timing markers around base64, Gemini fetch, retry/backoff, DB update, and batch duration; run a bounded cold-city baseline.

**Impact:** No safe parallel-ramp SPEC can be written from current evidence.

### RC-2 — Score iteration can exceed the 110s budget because the budget is checked before, not during, `Promise.all`

**Classification:** likely root cause of v6 parallel-12 stall; current risk still exists at lower probability under parallel-6.

**File/line:** `index.ts:1506-1508`, `index.ts:1573`, `index.ts:1635-1637`, `index.ts:1765-1791`.

**Exact code:** The budget loop starts a score iteration if elapsed is under 110s. `runScoreIteration` then executes all picked rows through `Promise.all`. There is no timeout around each Gemini call and no early abort when one call enters long retry/backoff.

**Current behavior:** v6 artifacts record parallel-12 hitting 429/backoff storms, rows stuck running, and 5-minute stuck recovery reclaiming them later. DB row durations show p99 49.874s and max 73.184s on the final run, with 9 malformed retries; HTTP retry counts are not persisted.

**Expected behavior:** A batch should not be allowed to keep the function open until Supabase request timeout. Slow external calls should be bounded per row or isolated so one tail does not pin the whole batch.

**Causal chain:** parallel score batch -> one or more Gemini calls 429/5xx or slow -> retry-after/backoff can wait up to 60s per retry (`index.ts:183-187`) -> `Promise.all` waits for slowest row -> worker can cross edge response timeout -> rows remain `running` until stuck recovery -> throughput collapses.

**Verification step:** instrument HTTP status/retry count/duration per Gemini call, then replay parallel-6 and parallel-12 on a bounded sample.

**Impact:** Parallelism might be safe if tail is controlled, but raising `.limit()` without measurement repeats the v6 failure shape.

### RC-3 — London-class slowness is partly guaranteed by cold collage cache

**Classification:** confirmed performance root cause for cold-start penalty.

**File/line:** `handleComposeCollage` cache check at `index.ts:587-598`; live DB cache probe.

**Exact code:** Cache hits only when `photo_collage_fingerprint` equals the current `fingerprintPhotos(allPhotos)` and `photo_collage_url` is present.

**Current behavior:** London has 6 cached collages for 3,495 servable rows. A cold London run composes ~3,489 collages.

**Expected behavior:** Large-city trial should not spend trial-run wall-clock composing deterministic collages that can be pre-warmed.

**Causal chain:** no pre-warm workflow -> cold city has ~0% cache -> prep must fetch reviews and compose/upload thousands of collages -> score cannot become the sole bottleneck.

**Verification step:** run a warm-collage sample or bounded city pre-warm and measure cache-hit delta plus trial wall-clock delta.

**Impact:** T2 cache warming is low-risk and real, but alone cannot close a 60-minute London target.

### CF-1 — File API is supported but not yet proven worth adopting

**Classification:** production-hardening gap / open performance question.

**Evidence:** Google Files API docs show uploaded media files can be used in `generateContent`, files auto-delete after 48 hours, project storage limit is 20GB, per-file max is 2GB, and Files API is free while files are retained for 48 hours. Source: Google Files API docs, accessed 2026-05-07: https://ai.google.dev/gemini-api/docs/files.

**Current behavior:** Mingla sends a 1.4-1.7MB PNG as ~1.9-2.3MB base64 inline payload per place.

**Expected behavior:** File URI could reduce per-call request body after upload, but only if upload state/TTL does not erase the benefit.

**Verdict:** DEFER pending timing. File API is technically plausible but likely not first lever because every place is generally one score call per collage; the extra upload may only move bytes from the score call to a pre-upload step.

### CF-2 — Model alternatives exist, but quality/schema parity is unknown

**Classification:** open question.

**Evidence:** Official Google model docs show:

- `gemini-2.5-flash`: image/text/video/audio input, text output, 1,048,576 input tokens, 65,536 output tokens, function calling and structured outputs supported. Source: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash.
- `gemini-2.5-flash-lite`: multimodal input, same token limits, function calling and structured outputs supported, described as fastest/cost-effective for high-frequency lightweight tasks. Source: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite.
- `gemini-3.1-flash-lite`: low-latency, cost-effective multimodal model with function calling and structured outputs, latest update May 2026. Source: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite.
- `gemini-3-flash-preview`: multimodal, function calling, structured outputs, preview model. Source: https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview.

**Verdict:** A model POC is justified only after instrumentation. Flash-Lite variants are plausible speed/cost candidates, but Q2 has a complex schema and high reasoning burden; official docs do not publish schema-adherence or latency for this exact call shape.

### CF-3 — The current Gemini tier must be confirmed in AI Studio, not inferred from billing

**Classification:** open question / operator action.

**Evidence:** Google says rate limits are per project, tied to usage tier, active limits are viewed in AI Studio, and specified limits are not guaranteed. It also says tiers depend on billing and cumulative spend, with Tier 1 after active billing, Tier 2 after $100 + 3 days, Tier 3 after $1,000 + 30 days. Source: https://ai.google.dev/gemini-api/docs/rate-limits.

**Impact:** The v7 inference that paid tier gives massive headroom is directionally useful but not enough for a SPEC. The operator must confirm the actual project tier and active model RPM/TPM.

---

## 6. Bottleneck Decomposition

| Layer | Evidence | Verdict |
|---|---|---|
| Gemini API | row p50 17.728s, p95 25.312s, p99 49.874s; no HTTP timing | Likely dominant per scored row, but exact split unknown |
| Base64 payload | code fetches and base64-encodes every collage; sample raw 1.43MB | Real overhead, magnitude unmeasured |
| Cold cache | London 0.17% cached | Confirmed cold-start drag |
| Prep compose | serial inner photo loop; parallel-12 outer | Memory-safe, still deterministic warmable work |
| Scheduler | self-invoke via `EdgeRuntime.waitUntil`, cron fallback | Works, but pg_net monitoring times out at 5s |
| Edge timeout | Supabase docs: managed request idle timeout 150s; code budget 110s | Score tail can still exceed practical request budget |
| DB pickup | indexed by parent/prep/status/started_at | No DB bottleneck proven |

Supabase official limits source: https://supabase.com/docs/guides/functions/limits, accessed 2026-05-07. Supabase lists managed Edge Function request idle timeout at 150s and max duration by plan.

---

## 7. Parallelism / Rate-Limit Proof

What is proven:

- v6 `.limit(12)` improved throughput to 5.76/min after deploy, but did not hit target.
- v6.1 `.limit(6)` has zero live-fire runs after deploy.
- Google rate limits are per project and active limits must be checked in AI Studio.
- Current pg_net data cannot prove 429 distribution because every captured row is a 5s self-invoke timeout.

What is not proven:

- That ordinary RPM/TPM quota caused v6 stalls.
- That Gemini burst-per-second caused v6 stalls.
- That parallel-12 is unsafe under paid tier if jitter/token bucket exists.
- That parallel-24 or parallel-48 is safe.

Measurement-backed ramp plan:

1. Baseline: run v6.1 parallel-6 on Raleigh 100 or Durham 100, not Cary, because Cary is fully cached.
2. Required telemetry: per-row base64_ms, gemini_ms, gemini_status, retry_count_http, retry_after_ms, malformed_retry, total_row_ms, batch_id, batch_parallel_n.
3. Advance gate to parallel-12: p95 <= 35s, p99 <= 75s, HTTP 429 <= 2%, stuck rows = 0, 546 = 0, failed <= 1%.
4. Advance gate to parallel-24: only if parallel-12 passes and active AI Studio tier confirms enough RPM/TPM.
5. Parallel-48: only with Tier 2/3 or explicit rate-limit increase evidence.
6. Rollback: any 546, any edge timeout, stuck rows > 0 after 2 minutes, or 429 > 5%.

---

## 8. Cache Warming Proof

Assuming v7's measured compose estimate of ~3.5s/place amortized at parallel-12, London cold compose cost is:

- Current London misses: 3,489 rows.
- Cold compose wall-clock: `3,489 * 3.5 / 12 = ~16.96 minutes`.
- 80% warm: remaining 699 misses -> ~3.4 minutes, saving ~13.6 minutes.
- 90% warm: remaining 350 misses -> ~1.7 minutes, saving ~15.3 minutes.
- 95% warm: remaining 175 misses -> ~0.85 minutes, saving ~16.1 minutes.

Storage:

- Observed current sample: 1.43MB.
- v7 sample: 1.74MB.
- London full cache at 1.43-1.74MB = ~5.0-6.1GB.
- All current listed servable cities at 13,671 rows = ~19.6-23.8GB.

Verdict: cache warming is a confirmed low-risk win, but it saves minutes, not hours. It should ship after, or alongside, measurement instrumentation.

---

## 9. File API and Model Alternatives

### File API

Official docs establish:

- Files API can upload media and use the file in `generateContent`.
- Use Files API when total request size exceeds 100MB; Mingla is below that, so this is optional, not required.
- Files auto-delete after 48 hours.
- Project file storage limit is 20GB; per-file limit is 2GB.
- Files API is free in available regions.

Mingla-specific verdict: **DEFER**. It is plausible for pre-uploaded warm collages, but for one score call per place it may simply move byte upload to a separate step. If adopted later, it needs TTL columns or lazy upload + 404 retry.

### Model alternatives

| Model | Fits modality/tool shape? | Official speed/cost signal | Verdict |
|---|---|---|---|
| `gemini-2.5-flash` | Yes; current model | price-performance, low-latency/high-volume | Keep baseline |
| `gemini-2.5-flash-lite` | Yes by docs: multimodal, function calling, structured outputs | fastest/cost-effective 2.5 family; cheaper than Flash | POC candidate |
| `gemini-3.1-flash-lite` | Yes by docs: multimodal, function calling, structured outputs | low-latency, high-volume; latest May 2026 | POC candidate, but model-family quality drift risk |
| `gemini-3-flash-preview` | Yes, but preview | powerful multimodal, preview restrictions possible | Do not use for production baseline without explicit operator approval |
| `gemini-2.5-pro` | Yes, but heavier | more advanced reasoning, likely slower/costlier | Not a speed candidate |

Pricing source: Google pricing page, accessed 2026-05-07: https://ai.google.dev/gemini-api/docs/pricing. Paid standard prices listed there: 2.5 Flash input $0.30/M text-image-video tokens and output $2.50/M; 2.5 Flash-Lite input $0.10/M and output $0.40/M.

---

## 10. Ranked Acceleration Options

| Rank | Option | Expected effect | London wall-clock effect | Effort | Risk | Falsifier |
|---:|---|---|---|---|---|---|
| 1 | Measurement patch / benchmark | Unlocks real cause | No direct speed gain | 0.5-1 day | Low | If logs cannot be correlated to rows |
| 2 | Cold-city v6.1 baseline | Proves current system | No direct speed gain | operator run | Low cost, time | If no city run authorized |
| 3 | Cache warming | Saves ~13-16 min London | 5h -> ~4.7h alone | 1-2 days | Low | Compose cost far below estimate |
| 4 | Parallel ramp with timeout/token bucket | Potential 2x-4x score throughput | Could move London to ~75-150 min depending tier | 2-4 days | Medium | 429/tails persist at N>6 |
| 5 | Per-row timeout/isolation | Prevents tail pinning batch | Improves reliability and sustained throughput | 1-2 days | Medium | Causes too many false row failures |
| 6 | File API / payload reduction | Saves upload overhead | likely minutes unless repeated calls | 2-3 days | Medium | base64_ms <100ms |
| 7 | Flash-Lite model POC | Could lower cost/latency | unknown | 1 day POC | Quality/schema risk | schema pass rate <99.5% |
| 8 | Sharded multi-worker architecture | Multiplies throughput | only path to confident <=60m on large cities if single worker ceiling holds | 1-2 weeks | High | Edge concurrency/DB locking limits |

---

## 11. Decisions Queued for Operator Lock

- **D-V8-1:** Measurement first or direct cache-warm SPEC? Recommendation: measurement first.
- **D-V8-2:** Authorize a cold-city v6.1 baseline? Recommendation: Raleigh 100 or Durham 100, not Cary.
- **D-V8-3:** Confirm Gemini project tier and active RPM/TPM in AI Studio. Recommendation: mandatory before parallel >12.
- **D-V8-4:** Allow a temporary timing field/log marker patch? Recommendation: yes.
- **D-V8-5:** Keep London target at <=60 min or relax to <=90 min on Tier 1? Recommendation: keep <=60 as aspirational, accept <=90 unless Tier 2/3 or sharding is approved.
- **D-V8-6:** Allow Gemini model POC? Recommendation: yes, but after timing baseline; test `gemini-2.5-flash-lite` and `gemini-3.1-flash-lite` against a 30-row fixture.

---

## 12. Minimal Next Dispatch Recommendation

Write a SPEC for a **measurement patch**, not a throughput fix:

1. Add temporary structured timing around `fetchAsBase64`, `callGeminiWithRetry`, malformed retry, row total, and batch total.
2. Persist timing to a JSONB diagnostic field or emit stable `[ORCH-0737-V8-TIMING]` logs with run_id/place_pool_id/batch_id.
3. Add per-row HTTP retry count/status capture.
4. Run a bounded cold-city sample.
5. Review results, then write the real speed SPEC.

This keeps implementation tiny and prevents the next performance change from being another “probably” patch.

---

## 13. Confidence Statement

- HIGH: no post-v6.1 run exists.
- HIGH: current code path uses inline base64 + function calling on `gemini-2.5-flash`.
- HIGH: London cache is effectively cold.
- HIGH: pg_net response capture is not usable for worker success or Gemini status.
- HIGH: Supabase request idle timeout and Gemini rate-limit tier rules are official-doc backed.
- MEDIUM: cache warming saves ~13-16 minutes on London.
- LOW: exact cause of v6 parallel-12 stalls.
- LOW: whether File API or model swap is worth implementation before measurement.


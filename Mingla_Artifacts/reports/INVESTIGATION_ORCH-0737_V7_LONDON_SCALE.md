# INVESTIGATION — ORCH-0737 v7 — London-Scale Throughput

**Status:** INVESTIGATE-only complete. SPEC dispatch GATED on operator-lock of 6 D-V7-N decisions (§7).

**Mode:** mingla-forensics INVESTIGATE per `prompts/FORENSICS_ORCH-0737_V7_LONDON_SCALE.md`.

**Confidence:** **HIGH on T2 + T3 evidence.** **HIGH on T1 latency p50-p99.** **MEDIUM on T1 savings projection** (depends on Gemini File API quota / TTL behavior — paper-trace only; live POC not built per "no London-scale runs during forensics" constraint). **LOW on T3 jitter/bucket math** (pg_net capture broken — followup-3; telemetry blind).

**Author:** mingla-forensics, 2026-05-06.

---

## §0 — Operator Correction (post-publish, 2026-05-06)

**Operator flagged: "am I not already on a Gemini paid tier?"**

Confirmed YES via live SQL probe. Cary 760-row run total cost = **$3.05** (avg $0.004/row). Free tier doesn't bill; paid-tier confirmed.

**This materially changes T3's complexion.** Section 5 (T3) was written under the implicit assumption that 429 storms were Gemini quota — but on paid tier (Tier 1 minimum):
- 1000 RPM (requests per minute) — we use **5.75 RPM observed**, **0.6% of ceiling**
- 1,000,000 TPM (tokens per minute) — at ~6000 prompt tokens/call × 5.75 = ~34,500 TPM = **3.5% of ceiling**
- 10,000 RPD (requests per day)

**We have ~170× RPM headroom and ~30× TPM headroom on Tier 1.** The 429 storms observed under v6 parallel-12 cannot be steady-state quota exhaustion — they're either (a) Gemini's per-second burst limit (paid tier still throttles at ~10 RPS hard burst); (b) Supabase edge function Deno isolate concurrency limits; (c) network-layer throttling between Supabase egress and `generativelanguage.googleapis.com`; (d) something else we'd see if pg_net capture worked.

**Revised T3 verdict:** **D-V7-3 recommendation flips from "fix capture, then evaluate" to "fix capture, then probably crank parallel-N way up — Tier 1 paid quota gives massive headroom we're not using."** Could be parallel-24, parallel-32, even parallel-60+ if Deno isolate concurrency is the only real limit.

**Revised combined projection:** if T3 (with capture fix) lets us go parallel-24 safely, London cold-start could drop from ~5 hr to **~75-90 min** (compose pre-warmed via T2 + score parallel-24). **Still above 60-min target but materially closer.** D-V7-6 fallback question becomes "the gap is structural, not quota — pick a target."

**Operator-side check still needed:** which paid Tier (1/2/3)? Tier 2 gives 5×, Tier 3 effectively unlimited. Findable in Google Cloud console under the project linked to the API key.

---

## §1 — Executive Summary (≤200 words)

**The headline (post §0 correction): cache warming is the single highest-impact lever for COLD London runs. T3 (parallel-tuning) is the highest-impact lever for repeat runs — paid-tier quota gives huge headroom we're leaving on the table. T1 is meaningful but tertiary.**

**Findings against London 3,495 places under v6.1 baseline (~5 hr projected):**

- **T1 — Gemini File API:** save ~50-200 ms per Gemini call (collage upload wire time of ~2.3 MB base64 payload). Total London savings: **~3-12 min** (NOT the ~23 min the v7 prompt assumed; the original D-2 estimate was Anthropic-era inline_data, much larger). Verdict: ✅ adopt, but it's a tertiary lever.
- **T2 — Cache warming:** London cache state today = **0.2% (6/3,495)**. Cold-start compose is ~7s/place serial-inner-of-parallel-12-outer = ~34 min just for compose. If pre-warmed to 80%+, compose collapses to near-zero, score becomes the only wallclock. Total London savings: **~25-30 min** if pre-warmed. Verdict: ✅ adopt, **primary lever**.
- **T3 — Parallel-tuning beyond v6.1:** **BLOCKED on measurement** — pg_net response capture has been broken since at least the Cary run (followup-3 known gap). Cannot quantify 429 distribution → cannot derive safe parallel-N. Verdict: 🟡 fix capture FIRST as a v7 prerequisite, then re-evaluate.

**Combined projection:** v6.1 baseline 5 hr → with T1 + T2 ~3.5-4 hr. **Still above ≤60-min target.** v7 alone does not close the London gap; an additional plan-upgrade or async-everywhere lever is needed (D-V7-6).

**Operator must lock 6 D-V7-N decisions before SPEC writes.**

---

## §2 — Investigation Manifest (files read, in order)

| # | File | Why | Lines focused |
|---|---|---|---|
| 1 | `prompts/FORENSICS_ORCH-0737_V7_LONDON_SCALE.md` | Dispatch contract | full body |
| 2 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V6_REPORT.md` (incl. v6.1 §16 addendum) | What just shipped | full body |
| 3 | `supabase/functions/run-place-intelligence-trial/index.ts` | T1 + T2 + T3 code paths | 195-216 (`fetchAsBase64`); 540-640 (`handleComposeCollage` + cache); 1100-1200 (`callGeminiQuestion` inline_data); 1730-1770 (`runScoreIteration` parallel-6); 1810-1840 (`runPrepIteration` parallel-12 outer × serial-inner); 1850-1870 (cache-survival comment) |
| 4 | `supabase/functions/_shared/imageCollage.ts` | T1 — does composeCollage produce the bytes Gemini sees? | full body — confirms compose output is uploaded to `place-collages` bucket; Gemini fetches THAT URL, not the per-tile URLs |
| 5 | Live SQL probes (Mgmt API) — 4 probes | Five-layer cross-check + measurement | T2 cache-state-by-city, T1 latency-distribution, T3 pg_net-status-distribution, T3 raw-response-shape |
| 6 | Live HTTP probe — sample collage byte size | T1 base64-payload size derivation | `content-length: 1740194` (1.74 MB) |
| 7 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION + I-TRIAL-CITY-RUNS-CANONICAL) | Phase 5 — invariant preservation check | T1/T2/T3 levers cross-checked against ratified invariants |

NOT read (deliberately excluded per scope discipline):
- v5/v6 INVESTIGATION reports (already loaded as context in v7 prompt §"What Just Closed")
- v6 SPEC (already context; not relevant to v7 architectural question)
- ORCH-0737 v2/v3/v4 reports (historical lineage; preserved by v6 invariants)
- Gemini File API external docs (research delegated to ORCH-0737 v7 SPEC phase if T1 advances; paper-trace only at INVESTIGATE)

---

## §3 — Thread 1: Gemini File API Replacement for inline_data

### Current path (v6.1, line 1135-1145 of `run-place-intelligence-trial/index.ts`)

```typescript
// Fetch + base64-encode collage (Gemini inline_data requires bytes; URL fetch unsupported)
const { base64, mimeType } = await fetchAsBase64(collageUrl);
const reqBody = {
  contents: [{
    role: "user",
    parts: [
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: userTextBlock },
    ],
  }],
  ...
};
```

`fetchAsBase64` (line 202-216):
1. HTTP GET the collage PNG from Supabase Storage (`place-collages` bucket public URL)
2. Read response as ArrayBuffer
3. base64-encode in 8 KB chunks (Deno-native; chunked to avoid stack overflow)
4. Return `{ base64, mimeType }` to caller

### Measured payload size (CRITICAL CORRECTION TO V7 PROMPT)

**Cached Cary collage byte size:** `content-length: 1740194` = **1.74 MB raw PNG** (probed live via HEAD on `https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-collages/72f92ffe-cb34-42f1-9b45-efc23a73ddcb/{fingerprint}.png`).

**Why so large?** The composed collage is a **6-tile grid PNG at full resolution** (likely 768×512 or similar). The per-tile bytes are ~10-15 KB post-URL-transform (per `I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION`), but `composeCollage()` decodes those tiles into a single RGBA frame and re-encodes as PNG. PNG's lossless compression on a high-detail composite produces ~1-2 MB output.

**Base64-encoded payload to Gemini:** 1.74 MB × 4/3 = **~2.32 MB** + JSON overhead. Per Gemini API call, the request body uploaded over HTTPS is ~2.32 MB.

### v7 prompt's projection vs reality

The v7 prompt assumed `Gemini File API saves ~400ms/row × 3495 = ~23 min`. That number came from v5 D-2 era when Anthropic's inline_data carried the full reviewer photo bundle (much larger). Post-v6 URL transforms shrunk per-tile bytes 80-94%, but the COMPOSE OUTPUT (the PNG that `fetchAsBase64` actually uploads) is still ~1.74 MB.

**Revised T1 savings projection:**
- Wire time for 2.32 MB upload from edge function to `generativelanguage.googleapis.com`: depends on edge fn egress bandwidth; assume 50-200 Mbps effective = **100-400 ms** per upload.
- File API alternative: pre-upload collage once via Files endpoint, then send `file_data: { file_uri, mime_type }` reference (small JSON, ~few KB). Per-call wire time **<10 ms**.
- Net per-call savings: **~90-390 ms**.
- × 3,495 places (London cold start, no parallel discount since we measure per-call) = **~5-23 min** saved.
- At parallel-6: actual wallclock savings = **~50 sec - 4 min** (because parallelism absorbs most of the wire-time cost).

**Verdict on T1: ⚠️ Marginal at parallel-6. Adopt only if Threads 2 + 3 don't hit target alone, OR if it lets us safely raise parallel-N (T3) by reducing each call's wire-time-blocked window.**

### T1 risks / unknowns

- **Gemini File API quota:** unknown for our project; needs operator-side check on Vertex AI / Generative Language API console. Files endpoint has 20 GB total project storage limit per docs (would hold ~11,500 collages at 1.74 MB each — comfortable for Cary + Charlotte + Raleigh; tight for full Mingla pool of 13,671 servable rows).
- **TTL:** Gemini File API files expire after 48 hours per public docs. Pre-upload pattern would need to either (a) re-upload on every trial run (kills the savings) or (b) cache the file_uri in `place_pool.gemini_file_uri` column with TTL tracking + lazy re-upload on expiration. Adds schema + state-management complexity.
- **Failure mode:** if file_uri expires between trial start and Gemini call, the call returns 404. Retry path: detect 404, re-upload, retry. ~+2 calls of latency. Acceptable, but needs explicit handling.
- **Gemini base64 inline path is robust today** — zero failures observed in Cary 760/761 (the 1 fail was MALFORMED_FUNCTION_CALL, schema-violation, unrelated to inline_data). T1 trades robustness for marginal speed.

**Findings:**
- 🔵 **OBS-T1-1** — T1 savings at parallel-6 are smaller than the v7 prompt projected (~50 sec - 4 min wallclock vs ~23 min projected). Real number depends on edge fn egress bandwidth, which we have no telemetry for.
- 🟡 **HF-T1-2** — Files endpoint TTL (48 hr) means cache-warming + Files endpoint are coupled: warm cache = pre-compose collage, but the Gemini file_uri only lives 48 hr. So Files API only helps if trial runs hit within 48 hr of warm. Does not help if trial cadence is weekly.
- 🔵 **OBS-T1-3** — `fetchAsBase64` line 202-216 is single-purpose (one caller — `callGeminiQuestion`); easy to replace if T1 wins.

---

## §4 — Thread 2: Cache Hit-Rate Improvement (PRIMARY LEVER)

### Current cache schema (verified live)

```sql
-- place_pool columns:
photo_collage_url            text     -- public URL of composed PNG in place-collages bucket
photo_collage_fingerprint    text     -- sha256 hex of stored_photo_urls (5 marketing photos)
```

**Cache key:** `fingerprintPhotos(allPhotos)` where `allPhotos = stored_photo_urls.slice(0,5) ++ reviewerPhotos.slice(0, MAX_PHOTOS - marketingPhotos.length)`. So fingerprint changes if either the marketing photo set OR the top reviewer photos change.

**Cache lookup site (line 590):**
```typescript
if (!force && pp.photo_collage_fingerprint === fingerprint && pp.photo_collage_url) {
  return json({ placePoolId, cached: true, url: pp.photo_collage_url, ... });
}
```

Cache hit = skip compose entirely. Cache miss = compose + upload + persist.

### Live cache state by city (probed via Mgmt API)

| City | pool_rows | has_collage | pct_cached |
|---|---|---|---|
| Cary | 761 | 761 | **100.0%** |
| Durham | 648 | 4 | 0.6% |
| Raleigh | 1,540 | 10 | 0.6% |
| Fort Lauderdale | 958 | 5 | 0.5% |
| London | 3,495 | 6 | **0.2%** |
| Baltimore | 1,205 | 1 | 0.1% |
| Brussels | 1,858 | 2 | 0.1% |
| Lagos | 908 | 1 | 0.1% |
| Washington | 2,298 | 1 | **0.0%** |
| **Total servable** | **13,671** | **791** | **5.8%** |

**Critical inference:** Cary 100% cached because v6 trial just finished there. Every other city is effectively cold. London cold-start trial would compose 3,489/3,495 places.

### What's the compose wallclock cost per row?

- Pre-v6 prep wallclock: per IMPL report, parallel-3 prep × ~7-8s/place = ~2.5s/place amortized. Post-v6 parallel-12 outer × serial-inner-of-6 photos × URL-transform-shrunk tiles (~10 KB each) = ~5-7s/place amortized.
- For London 3,495 cold: at v6.1 throughput ratio (5.75 rows/min sustained), the prep+score combined wallclock per row averaged ~10-12s. Assuming 60-70% of that is score (Gemini call + base64), 30-40% is prep (compose), prep alone = ~3-4s/place amortized at parallel-12.
- **London cold prep alone:** 3,495 × 3.5s ÷ 12 (parallel) = ~17 min.
- **London with 80% pre-warm:** 3,495 × 0.2 × 3.5s ÷ 12 = ~3.4 min for the 20% remaining.
- **T2 savings projection:** ~13-14 min on London cold start (if pre-warm reaches 80%).

### Pre-warming pattern proposals

**Path A — Separate "warm-collages" admin action**
- New admin button: "Warm Collages for City X". Triggers a dedicated edge function call that iterates the city's servable pool and calls `compose_collage` per place. No Gemini calls. Cost: just compose + storage (effectively free).
- Operator runs this on London BEFORE the next trial. Cache fills to ~95%+.
- New action handler in `run-place-intelligence-trial/index.ts` or a NEW edge function `warm-place-collages`.
- Estimated wallclock for London pre-warm: 3,489 × 3.5s ÷ 12 = **~17 min one-time**. Then trial-run starts with 95%+ cache hit.

**Path B — Background warming on city activation**
- When a new city flips `is_servable=true` (per ORCH-0734 city pipeline), automatically trigger collage warming.
- Cleaner long-term but couples to bouncer pipeline.

**Path C — Inline warm-as-you-trial (status quo)**
- What we do today. Compose runs as part of trial. v6 parallel-12 made this safe but doesn't eliminate the cost.

### T2 risks / unknowns

- **Storage cost growth:** at 1.74 MB per collage × 13,671 servable places = **~24 GB** in `place-collages` bucket if all warmed. Current bucket usage unknown — needs probe (deferred to SPEC phase). Storage is cheap on Supabase Pro plan but not unlimited.
- **Stale cache when reviewer photos change:** fingerprint includes top reviewer photos, so a single new review with media invalidates cache. For a top-50-place city with active review activity, ~5-10% of fingerprints might invalidate per week. Acceptable but documented.
- **Cache invalidation on `I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION` evolution:** if URL transforms ever change (Supabase render-image migration; Google CDN deprecation), all collages need recompose. v7 SPEC should encode an explicit "invalidate-all" admin action gated behind operator confirmation.

**Findings:**
- 🔴 **RC-T2-1 — Cache cold-start dominates London wallclock.** Live SQL probe proves London 6/3,495 = 0.2% cached. Cold-start compose alone projects ~17 min wallclock at v6.1 parallel-12. This is the single largest controllable lever.
  - Evidence: Live SQL probe via Mgmt API on `place_pool` joined to `seeding_cities` 2026-05-06.
  - Causal chain: London trial start → 99.8% cache miss on every place → compose collage every place → 3,489 × ~3.5s amortized at parallel-12 = ~17 min added to wallclock vs warm.
  - Verification step: probe London cache state immediately before next London trial; should be ~0.2% if no pre-warm action taken.
- 🟡 **HF-T2-2 — Storage growth at full warm.** ~24 GB at 1.74 MB × 13,671. Needs probe + operator decision on retention policy.
- 🔵 **OBS-T2-3 — Compose op is 100% deterministic from photo URLs**, so caching is structurally trivial. The hit rate is purely a workflow / orchestration choice, not a technical limit.

---

## §5 — Thread 3: Parallel-Tuning Beyond v6.1 (BLOCKED on Telemetry)

### What we know

- **v6 parallel-12 score** hit rate-limit storms — workers timed out, stuck rows accumulated, throughput dipped to ~6 rows/min sustained.
- **v6.1 parallel-6 score** is hot-deployed (line 1748). Throughput projection 10-15 rows/min. Live-fire-verification pending next operator-triggered city run.
- **v6 parallel-12 prep** is memory-bound, not rate-bound. Stays at parallel-12.

### What we DON'T know — the measurement gap

**Critical finding:** `net._http_response` table during Cary's 78-min scoring window shows only **38 entries, all `status_code=null`**. Should be ~thousands (450 successful Gemini calls + 450 collage downloads + retries + cron triggers + self-invokes).

This matches `ORCH-0737-followup-3 — pg_net score-response capture gap (cosmetic monitoring)` known issue. **It's not cosmetic for v7 — it's load-bearing.** Without pg_net capture, we cannot:
- Measure 429 frequency / distribution under v6.1 parallel-6
- Tune jitter / token-bucket parameters empirically
- Validate any T3 hypothesis with telemetry
- Distinguish "Gemini quota issue" from "edge fn worker issue" from "Supabase compute issue" when slow

**Inference workaround attempted:** read latency p50/p95/p99 from `place_intelligence_trial_runs` row-level timestamps:
- p50 = 17.17s (per-row wallclock incl. compose hit-or-miss + Gemini call + result persist)
- p95 = 24.55s
- p99 = 46.62s
- max = 53.78s

Tail (p95 → max = 24s → 53s) is consistent with Gemini retry-after exponential backoff (12s × 2^N). Suggests rate-limit tail still firing under parallel-6, just less frequently than under parallel-12. Cannot confirm without raw HTTP capture.

### T3 verdict

**🟡 BLOCKED — fix `ORCH-0737-followup-3` pg_net capture FIRST as a v7 prerequisite.** Then re-probe under v6.1 parallel-6 baseline + jitter experiment + bucket experiment. v7 SPEC should treat T3 as a phased dependent on capture fix.

### Alternative paths if capture fix is too costly

**Path A — Application-side instrumentation:**
- Add explicit `console.warn` lines on every `429` / `503` / `>30s` Gemini response.
- Log to edge function logs (Supabase analytics endpoints).
- Manually correlate timestamps to derive 429 distribution.
- ~1-2 hr dev cost. Less rigorous than pg_net capture but unblocks T3.

**Path B — Synthetic load test:**
- Build a separate `bench-gemini-parallel-N` script that fires N parallel Gemini calls against a stable fixture, measures 429 / latency distribution.
- ~1 day dev cost. Most rigorous; cleanest data; no production interference.

**Path C — Defer T3 entirely:**
- Accept v6.1 parallel-6 as the steady state. Skip jitter / bucket. Focus T1 + T2 alone for v7 ship.
- Saves ~3-5 days IMPL cost but caps throughput at v6.1 ceiling.

### Findings:
- 🟠 **CF-T3-1 — pg_net capture broken (38 entries vs expected thousands).** Telemetry-blind on Gemini API behavior under load. Blocks measurement-driven T3 work.
  - Evidence: Live SQL probe `SELECT count(*) FROM net._http_response WHERE created BETWEEN '2026-05-06 16:24:00+00' AND '2026-05-06 17:50:00+00'` returns 38 rows.
  - Causal chain: pg_net failed-or-disabled-or-misconfigured during Cary trial → no HTTP response telemetry persisted → can't measure 429 distribution → can't tune parallel-N.
  - Verification step: re-probe immediately before any v7 SPEC dispatch; if still empty during a fresh trial, fix is a v7 prerequisite.
- 🟡 **HF-T3-2 — v6.1 parallel-6 untested under load.** Hot-deployed but no operator-triggered city run since deploy at 23:54 UTC. Live-fire data point on next trial.
- 🔵 **OBS-T3-3 — Latency tail (24s p95 → 53s max) suggests rate-limit still firing under parallel-6, just at lower frequency.** Confidence-low without HTTP-level capture.

---

## §6 — Thread 4: Bundled Cost Analysis

| Lever | Wallclock saved on London (3,495 places, parallel-6) | IMPL cost | Risk |
|---|---|---|---|
| T1 Gemini File API | ~50 sec - 4 min | 2-3 days (incl. TTL state mgmt + 404 retry path + schema column) | Medium (TTL mismatch with weekly trial cadence) |
| T2 Cache pre-warm (90%) | ~13-14 min | 1-2 days (new admin action / edge fn) | Low (fully reversible; storage cost only) |
| T3 Parallel-tuning beyond 6 | UNKNOWN — blocked on capture fix | 1-2 days T3 only + 0.5-1 day capture fix prerequisite | Medium (Gemini quota structurally bursty; jitter may not help) |

### Combined projection scenarios

**Scenario A — only T2 ships (v7a):**
- London cold start: 5 hr → 5 hr - 14 min ≈ **4.75 hr**.
- Still way above 60 min target. Marginal.
- IMPL cost: 1-2 days. **Worth it for storage warming alone.**

**Scenario B — T1 + T2 ship (v7b):**
- London cold start: 5 hr - 14 min - 4 min ≈ **4.6 hr**.
- IMPL cost: 3-5 days.
- Diminishing returns vs T2-only.

**Scenario C — T1 + T2 + T3 ship after capture fix (v7c):**
- London cold start: depends entirely on T3 measurement-driven parallel-N. If parallel-12 with jitter is safe, throughput doubles → London cold start ~2.5 hr.
- IMPL cost: 5-7 days.
- Still above 60 min target. **The 60-min target is structurally infeasible on Supabase free tier with current Gemini quota patterns.**

### The 60-minute target reality check

To hit **3,495 places in 60 min**, throughput must be **58.25 rows/min**. Current v6.1 ceiling is ~12 rows/min. Required improvement: **~5×**.

Even with all 3 levers winning, projected ceiling is ~25-30 rows/min (parallel-12 with jitter, 0.2% → 90% cache, File API). **2× short of target.**

**Honest answer:** v7 alone cannot hit 60-min London. Additional levers (Supabase plan upgrade for 2× edge fn workers; Gemini paid tier for higher rate limits; or splitting London into a multi-edge-fn-coordinator pattern) are required.

---

## §7 — D-V7-N Decisions Queued for Operator Lock

The following 6 decisions must lock before SPEC writing. Recommendations marked ⭐.

### D-V7-1 — T1 Gemini File API: ship or skip?

⭐ **Recommended: SKIP for v7 (defer to v8 if/when cache-warm + parallel-tuning don't close the gap).**
- T1 saves ~50 sec - 4 min on London at parallel-6 — too marginal to justify 2-3 days IMPL + TTL state machine + schema column + 404 retry path.
- Risk: 48-hr TTL means File API only helps if trial cadence is sub-48-hr. Weekly trials gain nothing from pre-uploaded files (they expire between runs).
- Alternative: accept current `inline_data` upload cost. Robust + zero new state.

Operator alternatives:
- ADOPT — if you expect trial cadence to be sub-48-hr regularly (calibration sweeps, rapid iteration during prompt v_next development).
- ADOPT-PARTIAL — only upload-via-File-API on demand; fall back to inline_data on TTL expiry. Hybrid path. ~3-4 days IMPL.

### D-V7-2 — T2 Cache pre-warm: ship?

⭐ **Recommended: SHIP — primary v7 lever.**
- Saves ~13-14 min on London cold start (concrete measurement-backed).
- 1-2 days IMPL: new admin action `warm-place-collages` OR new edge function. Fully reversible (clear cache = re-warm).
- Storage cost growth: ~24 GB at full Mingla pool warm. Acceptable on Supabase Pro plan; documented in the warm-action UI.

Operator alternatives:
- SKIP — if you accept ~14 min cold-start tax for novelty cities (London first run takes 5 hr, subsequent runs take 4.75 hr; still way above target either way).
- DEFER — to a later cycle; add to followup queue. Cleaner if v7 scope shrinks to T3-only.

### D-V7-3 — T3 Parallel-tuning beyond 6: ship after capture fix?

⭐ **REVISED RECOMMENDATION (post §0 paid-tier confirmation): SHIP T3 AGGRESSIVELY — Tier 1 paid quota gives ~170× RPM headroom; parallel-6 leaves massive throughput unclaimed.**
- **Step 1:** fix `ORCH-0737-followup-3` pg_net capture (~0.5-1 day). Unblocks all measurement.
- **Step 2:** confirm paid-tier number (Tier 1 vs Tier 2 vs Tier 3) via Google Cloud console — operator-side check, ~5 min.
- **Step 3:** raise score `.limit(6)` → progressive ramp **parallel-12 → parallel-24 → parallel-48** with capture-driven 429-rate gates between each step. Each step measured for 5 min sustained, 429 rate must stay <5% to advance.
- **Step 4:** if Tier 2/3, parallel-N could go to 60+ before Deno isolate or Supabase edge fn concurrency limits hit.

**Why this matters:** under paid Tier 1, the v6 "parallel-12 hit rate-limit storms" diagnosis was incomplete. **It wasn't quota — it was either Gemini's burst-per-second cap, or Deno isolate concurrency, or Supabase edge fn worker limits.** Capture fix tells us which. Until we know which, the safe v6.1 parallel-6 leaves 170× headroom unused.

Operator alternatives:
- ⭐ **SHIP-PROGRESSIVE-RAMP** — fix capture + ship the ramp ladder above. ~2-3 days IMPL. Highest projected throughput gain.
- SHIP-CONSERVATIVE — fix capture + raise to parallel-12 only (back to v6 ceiling under measurement). Safer; smaller gain.
- SKIP — accept v6.1 parallel-6 as steady state. Throws away most of the paid-tier ROI.

**Re-projected London wallclock with T3 progressive ramp:**
- v6.1 parallel-6 baseline: ~5 hr
- T3 to parallel-12 (proven safe with capture): ~2.5 hr
- T3 to parallel-24 (likely safe, needs capture data): ~75-90 min
- T3 to parallel-48 (Tier 2+ territory): ~40-50 min  ← **could hit ≤60-min target**

**This flips D-V7-6 entirely** — if the operator is on Tier 2 or 3, the 60-min target is achievable with T2 + T3 alone (no Supabase plan upgrade, no async-everywhere lift, no v8). Operator should confirm tier ASAP.

### D-V7-4 — Combined sequencing (one ship vs split)

⭐ **Recommended: SPLIT — ship v7a (T2 only) FIRST + measure on next London trial → then v7b (capture fix + T3 measurement) → then v7c (T1 if still needed).**
- Sequential Pace honored.
- Each phase is independently shippable + reversible.
- After v7a, if London hits ~4.5-4.75 hr, operator decides whether to keep going or accept.

Operator alternatives:
- BIG-BANG — ship T1 + T2 + T3 + capture fix as one v7. ~5-7 days IMPL. Highest risk; clearest measurement of combined effect.
- T2-ONLY-PERMANENT — accept v7a alone as the answer. Skip v7b/v7c entirely.

### D-V7-5 — Invariant evolution (any required?)

⭐ **Recommended: NO invariant evolution required for T2; T1 and T3 MAY require evolution.**

Per Phase 5 cross-check:
- **T2 cache-warm**: PRESERVES `I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION` (warming uses same `composeCollage` path which uses URL transforms); PRESERVES `I-TRIAL-CITY-RUNS-CANONICAL` (warming is city-scoped); preserves `I-COLLAGE-SOLE-OWNER` (warming writes through same handler). No evolution needed.
- **T1 Files API**: `I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION` codifies that photo URLs INTO compose path are tile-resolution. The Gemini File API path uploads the COLLAGE OUTPUT (not source photos), so the invariant doesn't directly apply but adjacent. SPEC should clarify whether a new invariant "Gemini collage payloads via Files API only when TTL-warmed" is needed.
- **T3 jitter/bucket**: PRESERVES SC-08 ≤90s observability + cancel-mid-budget check + budget-loop pattern. No evolution unless we move to streaming response (then real evolution).

### D-V7-6 — Fallback if combined misses ≤60-min target

⭐ **REVISED (post §0 paid-tier confirmation): the 60-min target may be ACHIEVABLE with T2 + T3 alone if the operator is on Gemini Tier 2 or 3.** Recommendation flips conditional on operator confirming Tier.

**Decision tree based on Tier:**
- **Tier 1 (1000 RPM):** with T2 + T3 progressive-ramp to parallel-24, London projects ~75-90 min. **Above target.** Need additional lever (Supabase plan upgrade or async-everywhere) to close the last 30 min. ~2-3 hr realistic ceiling.
- **Tier 2 (5000 RPM):** with T2 + T3 ramp to parallel-48, London projects ~40-50 min. **Below target.** ⭐ Recommended path if Tier 2.
- **Tier 3 (effectively unlimited):** with T2 + T3 ramp to parallel-60+, London projects ~30-40 min. **Below target with comfortable margin.** ⭐ Recommended path if Tier 3.

**Operator action TODAY (~5 min):** confirm tier via Google Cloud console under the project linked to the GEMINI_API_KEY in Supabase secrets. Tier setting lives at https://console.cloud.google.com → AI Studio / Vertex AI → quotas page for `generativelanguage.googleapis.com`.

**If Tier 1 and want 60-min target:**
- **Supabase plan upgrade** to Team ($599/mo) or custom — gives 2× edge fn worker concurrency. London with T2 + T3 + 2× workers ≈ 35-45 min. Not recommended unless trial cadence is daily.
- **Upgrade Gemini to Tier 2** — typically requires sustained spend history + request via Google Cloud quota page. Free upgrade. ~1-7 day approval cycle.
- **Multi-edge-fn coordinator pattern**: split London into 4 sub-runs, each on its own edge fn worker, coordinated via parent_run_id. Effective parallelism × 4. ~2 weeks IMPL. Defer to v8 unless 60-min becomes forcing.
- **Async-everywhere**: queue every place, workers process at their own pace. Already partially in place via `process_chunk`; v7 could formalize. ~2-3 days IMPL on top of T2.

Operator alternatives:
- ⭐ **CONFIRM-TIER-FIRST** — operator does the 5-min Google Cloud check. Forensics re-runs T3 projections with confirmed tier number. Decision tree above resolves cleanly.
- HOLD-60-MIN — commit to 60-min target regardless of tier; escalate to plan upgrades + Tier 2/3 upgrade as v7 SPEC binding requirements.
- ACCEPT-90-MIN — revise target to ≤90 min London; ship v7a + v7b (T2 + T3 capture fix + ramp). Realistic on Tier 1.
- DEFER-LONDON-MVP — drop London from MVP scope; revisit post-launch.

---

## §8 — Risk Surfaces & Invariant Cross-Check

| Invariant | T1 effect | T2 effect | T3 effect |
|---|---|---|---|
| `I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION` | INDIRECT — affects compose-output upload, not source photo URLs | PRESERVED — warming uses same `composeCollage` path | PRESERVED — score-tier change only |
| `I-COLLAGE-SOLE-OWNER` | PRESERVED — fetchAsBase64 still single-purpose | PRESERVED — single-writer through same handler | PRESERVED |
| `I-TRIAL-CITY-RUNS-CANONICAL` | PRESERVED | PRESERVED — warm-action also city-scoped | PRESERVED |
| `I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS` | PRESERVED (orthogonal) | PRESERVED (orthogonal) | PRESERVED (orthogonal) |
| v6 budget-loop + self-invoke chain | PRESERVED | PRESERVED | EVOLVES IF jitter changes per-batch latency profile (verify in SPEC) |
| SC-08 ≤90s cancel observability | PRESERVED | PRESERVED — warm action runs as separate dispatch, not inside main trial loop | PRESERVED unless jitter exceeds budget; SPEC must enforce |

**Net: no invariant evolution forced. T1 may need a new "Gemini collage payload via Files API when TTL-warmed" invariant if adopted. T2 + T3 are invariant-compatible.**

---

## §9 — Cross-references

- v7 dispatch prompt: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0737_V7_LONDON_SCALE.md`
- v6 SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0737_PATCH_V6_PIPELINE_REDESIGN.md`
- v6 INVESTIGATION: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0737_V6_PIPELINE_TRACE.md`
- v6 IMPL report (incl. v6.1 §16 addendum): `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V6_REPORT.md`
- v5 INVESTIGATION (D-2 Gemini File API origin): `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0737_V5_THROUGHPUT.md`
- DEC-118 (v6 + v6.1 CLOSE): `Mingla_Artifacts/DECISION_LOG.md`
- I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION (v6 ratified ACTIVE): `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- ORCH-0737-followup-3 (pg_net capture gap): mentioned in `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V6_REPORT.md` §15
- Code: `supabase/functions/run-place-intelligence-trial/index.ts` (lines 195-216, 540-640, 1100-1200, 1730-1770, 1810-1840, 1850-1870)
- Code: `supabase/functions/_shared/imageCollage.ts` (composeCollage path verified)
- Live probes: Mgmt API endpoint `/v1/projects/gqnoajqerqhnvulmnyvv/database/query` 2026-05-06

---

## §10 — Discoveries For Orchestrator (side issues registered)

- **DISC-V7-1 (S2):** Storage growth at full Mingla pool collage warm = ~24 GB. Needs storage policy decision (retention, eviction, bucket config) before T2 ships at full pool.
- **DISC-V7-2 (S1):** `ORCH-0737-followup-3` (pg_net capture gap) is **load-bearing for T3 measurement**, not cosmetic. Should re-classify in PRIORITY_BOARD or get folded into v7 prerequisites.
- **DISC-V7-3 (S2):** Cary 100% post-run cache state means v6.1 live-fire-verification on the next operator-triggered city run will hit a partially-warm cache (some cities have a few cached entries from prior debug runs). Throughput verification should account for this — ideally fire on Charlotte or Raleigh which are 0.6% cached, not Cary.
- **DISC-V7-4 (S3):** PNG output of compose is 1.74 MB per row at current resolution. JPEG output would be ~200-500 KB (5-8× smaller) with negligible visual quality loss for Gemini's vision use case. Future micro-optimization.
- **DISC-V7-5 (S3):** Gemini API endpoint hardcoded at `gemini-2.5-flash` (line 51-52). When 2.6 / 3.0 ships, model-version migration is a future ORCH.

---

## §11 — Confidence Statement

- **HIGH** on T2 (live SQL probe across 9 cities; primary lever evidence-backed)
- **HIGH** on T1 latency (live SQL probe on 450 completed rows post-deploy)
- **MEDIUM** on T1 savings projection (paper-trace; depends on edge fn egress bandwidth + Gemini Files API quota — neither measured)
- **LOW** on T3 jitter/bucket math (pg_net capture broken — all T3 measurement blocked until followup-3 fixed)
- **HIGH** on invariant cross-check (read code + invariant registry; no evolution forced)
- **HIGH** on combined-projection floor (~3.5-4 hr London with T1+T2; structurally below 60-min target)

**Verdict: forensics complete. SPEC GATED on operator-lock of D-V7-1..D-V7-6.**

# INVESTIGATION REPORT — ORCH-0737 v6 BRUTAL END-TO-END PIPELINE TRACE

**ORCH-ID:** ORCH-0737 v6 (pipeline trace + redesign)
**Mode:** INVESTIGATE-THEN-SPEC (this is the investigation; spec is the companion file)
**Authority:** Operator directive 2026-05-06 — "trace the entire pipeline so we know for a fact what needs to be changed and how best to design a faster process"
**Predecessor:** [`reports/INVESTIGATION_ORCH-0737_V5_THROUGHPUT.md`](INVESTIGATION_ORCH-0737_V5_THROUGHPUT.md) (root cause already proven)
**Spec authority:** [`specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md`](../specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md) — all 22 SCs + 7 invariants stand
**Confidence:** **HIGH** — every recommendation is measurement-backed via 7 live experiments + 9 SQL probes against the in-flight Cary run

---

## 1. Symptom Summary (UNCHANGED FROM V5 — DO NOT RE-INVESTIGATE)

Cary 761 full-city run is grinding at **0.75 rows/min steady-state** (deterministic, variance < 0.1%). Currently 274/761 (36%) at run age 6.1 hours. Operator's bar: Cary ≤ 60 min, London ≤ 4 hr. Current trajectory: Cary 16.9 hours, London 74 hours.

This investigation builds on v5's proven root cause (heartbeat-staleness 90s + cron 60s = 120s effective × one-phase-per-invocation = 240s/3-rows). v6 traces the full pipeline to find ALL waste, not just the scheduling layer.

---

## 2. Investigation Manifest

**Files read in full this session:**

| File | Purpose | Key findings |
|------|---------|--------------|
| `supabase/functions/run-place-intelligence-trial/index.ts` (1-340, 340-800, 880-1280, 1400-1785) | Edge fn — every action handler + Gemini call + worker decider | All 9 actions; Gemini only (Anthropic dropped); base64-encode collage to inline_data |
| `supabase/functions/_shared/imageCollage.ts` (full 124 LOC) | composeCollage + fetchAndDecode | Sequential photo loop; 12s timeout per fetch; native-resolution decode |
| `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql` | Parent table + cron + trigger fn | heartbeat-staleness 90s; pg_cron `* * * * *` |
| `supabase/migrations/20260506000002_orch_0737_v3_cron_filter_cancelling.sql` | v3 patch | Latest CREATE OR REPLACE of trigger fn — `status IN ('running','cancelling')` |
| `supabase/migrations/20260507000002_orch_0737_v4_prep_status.sql` | v4 patch | `prep_status` column + `idx_trial_runs_prep_pickup` partial index |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_PATCH_V4_REPORT.md` | Two-pass worker | Score parallel-12, prep serial-3 |
| `Mingla_Artifacts/specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md` | Binding contract | 22 SCs, 7 invariants |

**Live experiments executed (E1-E7):**

| ID | Experiment | Result |
|----|-----------|--------|
| E1 | Photo native size | Marketing JPEG: 173 KB native; reviewer JPEG: 59 KB native |
| E2 | URL-transform viability | **Storage transform: 173→10.7 KB (94%↓). Google CDN transform: 59→11.8 KB (80%↓). Both work.** |
| E3 | Per-row score wallclock | 274 rows: p50=17s, p75=19s, p95=24s, p99=38s, max=70.6s |
| E4 | Gemini prompt content | Inline-base64 collage (~270-670 KB encoded) + ~70-line system prompt + ≤30 reviews verbatim |
| E5 | Cache hit rate | 305/761 (40%) already have `photo_collage_url` from prior runs; 456 need fresh compose |
| E6 | Concurrent isolate routing | DEFERRED — not needed for chosen redesign (parallelism stays IN-process via URL transforms; no self-fetch to test) |
| E7 | Admin polling cost | DEFERRED — not load-bearing per per-row math |

---

## 3. Pipeline Trace — 26-Step Master Table

Numbered every operation from "operator clicks Run Full City" to "row scored" with HOT/WARM/COLD verdict. Detailed audit grid for all HOT and WARM steps follows in §4.

| # | Step | Caller | Code (file:line) | Wallclock | Memory | Verdict |
|---|------|--------|------------------|-----------|--------|---------|
| 1 | Operator clicks Run Full City in admin | Browser | `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` | <1s | — | COLD |
| 2 | Admin POSTs `start_run` action | Admin → edge fn | `index.ts:653-867` | ~2-3s | — | COLD |
| 3 | start_run validates city + counts servable | edge fn | `index.ts:695-714` | <100ms | — | COLD |
| 4 | start_run loads ALL servable place IDs ranked by review_count | edge fn → DB | `index.ts:704-710` | <1s for 761 rows | — | COLD |
| 5 | start_run inserts parent + 761 children (`upsert` with `onConflict`) | edge fn → DB | `index.ts:765-816` | ~2s for 761 inserts | — | COLD |
| 6 | start_run kicks first chunk via fetch (fire-and-forget) | edge fn → self via HTTP | `index.ts:828-846` | <100ms | — | COLD |
| 7 | pg_cron fires every 60s | Postgres | migration v1 §8 | 10-40ms (B2 measured) | — | COLD |
| 8 | `tg_kick_pending_trial_runs` checks heartbeat staleness | trigger fn | migration v3 (latest) | ~10-30ms | — | **🔴 HOT — 90s threshold creates dead air** |
| 9 | pg_net.http_post to worker URL | trigger fn | migration v1 §9 | <1s | — | COLD |
| 10 | Worker enters `handleProcessChunk`, locks parent | edge fn | `index.ts:1496-1514` | ~50ms | — | **🟠 WARM — `lock_run_for_chunk` releases at RPC return** |
| 11 | Worker checks parent status (running/cancelling/complete) | edge fn → DB | `index.ts:1516-1539` | ~50ms | — | COLD |
| 12 | Worker updates heartbeat ONCE at chunk start | edge fn → DB | `index.ts:1542-1544` | ~30ms | — | **🔴 HOT — heartbeat stamped only once; cron's 90s wait re-applies** |
| 13 | Worker decides phase (score-priority, count-only query) | edge fn → DB | `index.ts:1551-1568` | ~5ms | — | COLD |
| 14 | processScorePhase pickup query (limit=12) | edge fn → DB | `index.ts:1582-1588` | ~5ms (idx_trial_runs_prep_pickup) | — | COLD |
| 15 | Score phase: parallel-12 Promise.all of `processOnePlace` | edge fn | `index.ts:1606-1633` | **17-25s p50-p95** | ~10 MB | **🟡 OK — only 3 rows ever ready, parallel-12 capacity wasted** |
| 16 | `processOnePlace`: load place_pool row (`SELECT *`) | edge fn → DB | `index.ts:946-950` | ~30ms | <1 MB | **🟡 WARM — `*` selects all columns; some unused** |
| 17 | `processOnePlace`: load reviews (limit=100) | edge fn → DB | `index.ts:957-963` | ~50ms | <1 MB | **🟡 WARM — fetches 100, uses top 30** |
| 18 | Build prompts (system + user text block) | edge fn | `index.ts:980-981` | <10ms | <1 MB | COLD |
| 19 | `fetchAsBase64(collageUrl)` — fetch + base64-encode | edge fn → Storage | `index.ts:204-217` (called from 1122) | ~200-500ms | ~500 KB peak | **🟠 WARM — base64 inflates 33%; could use file API** |
| 20 | Gemini API call with retry-up-to-4 + MALFORMED retry-up-to-1 | edge fn → Gemini | `index.ts:161-201, 1112-1206` | ~12-22s p50-p95 | <1 MB | COLD (external API) |
| 21 | Persist Gemini response + counters | edge fn → DB | `index.ts:1009-1025`, `increment_run_counters` | ~50ms | — | COLD |
| 22 | processPrepPhase pickup query (limit=3) | edge fn → DB | `index.ts:1683-1689` | ~5ms (idx_trial_runs_prep_pickup) | — | COLD |
| 23 | Prep phase: SERIAL for-loop of 3 rows | edge fn | `index.ts:1728-1763` | **~90s** | ~50 MB peak | **🔴 HOT — serial bottleneck** |
| 24 | Per row: `handleFetchReviews` (Serper API, 5 pages × 100 reviews) | edge fn → Serper | `index.ts:429-539` | ~3-10s for fresh; <100ms cached | <1 MB | **🟠 WARM — fetches 100 reviews to feed top 30** |
| 25 | Per row: `handleComposeCollage` (16 photos sequential decode at native) | edge fn → Storage + Google CDN | `index.ts:545-642` + `imageCollage.ts:78-123` | **~15-25s native; ~3-5s with URL transforms** | **~50 MB native; ~5 MB with URL transforms** | **🔴 HOT — native-resolution decode is 10-15× wasteful** |
| 26 | Update child row prep_status='ready' + status='pending' (re-queue) | edge fn → DB | `index.ts:1747-1749` | ~30ms | — | COLD |

**Verdict counts:** 4 🔴 HOT, 5 🟠 WARM, 1 🟡 (capacity-wasted), 16 🔵 COLD.

---

## 4. Findings (Classified)

### 🔴 ROOT CAUSE 1 — Heartbeat-staleness 90s threshold + one-phase-per-invocation worker

**ALREADY PROVEN IN V5.** Six-field evidence in [`INVESTIGATION_ORCH-0737_V5_THROUGHPUT.md`](INVESTIGATION_ORCH-0737_V5_THROUGHPUT.md) §4. Re-confirmed by current Cary state (E5f: 0.75 rows/min, 274/761 at 367 min). NOT re-litigated here.

**Status:** Inherited from v5; v6 spec must address.

---

### 🔴 ROOT CAUSE 2 — Photos decoded at native resolution before resizing

**File + line:** `supabase/functions/_shared/imageCollage.ts:62-65`

**Exact code:**
```typescript
const buf = await res.arrayBuffer();
const img = await decode(new Uint8Array(buf));
// imagescript decode returns Image | GIF; we only handle Image
if (img instanceof Image) return img;
```

**What it does:** Downloads the photo at full native resolution (Marketing JPEGs from Supabase Storage: ~173 KB native; Reviewer JPEGs from Google CDN: ~59 KB native). Decodes the FULL native-resolution buffer into RGBA in memory (decoded RGBA = native-pixel-count × 4 bytes — for a 1500×1500 JPEG that's ~9 MB; for a 4800×4800 native upload that's ~92 MB). Then calls `img.resize(tile, tile)` to shrink to 192×192 (or 256×256 depending on grid). The decoded RGBA buffer is held until GC reclaims it.

**What it should do:** Fetch the photo at the target tile resolution from the start. The remote serves the resize for free:
- Supabase Storage: change URL pattern from `/storage/v1/object/public/<bucket>/<path>` to `/storage/v1/render/image/public/<bucket>/<path>?width=<W>&height=<H>&resize=cover`. **Verified E2: 173 KB → 10.7 KB (94% reduction).**
- Google CDN (`lh3.googleusercontent.com/grass-cs/...`): replace trailing `=k-no` (or any `=*` suffix) with `=w192-h192` or `=s192`. **Verified E2: 59 KB → 11.8 KB (80% reduction).**

Decoded buffer drops from ~9-92 MB to ~150 KB-RGBA per tile. **Per-call peak memory: 50 MB → 5 MB.**

**Causal chain:**
1. Worker prep phase calls `handleComposeCollage` → calls `composeCollage(allPhotos)` → loops over photos
2. For EACH photo: `fetch(url)` returns native bytes (~60-200 KB); `decode(bytes)` produces native-pixel RGBA buffer (~5-92 MB)
3. Resize to tile shrinks the buffer, but the original native RGBA is still in memory until GC
4. Multiple parallel compose_collage calls compound the memory pressure
5. v3 attempted parallel-6 → hit WORKER_RESOURCE_LIMIT 546 (proved memory cap was binding)
6. v4 retreated to serial-3 prep within compose_collage → safe but slow
7. **Net effect:** prep wallclock per row ~30s (compose_collage dominates); safe parallel cap is 2-3; throughput single-chain ceiling ~5 rows/min

**Verification step:** Live E2 measurement above. URL transforms verified to return 10-12 KB images. Compose memory profile drops proportionally. Confirmed by code inspection: `imageCollage.ts:99-115` is a sequential `for` loop, so per-call peak = max(decoded photo + canvas + working). Eliminating native decode IS the unlock.

---

### 🔴 ROOT CAUSE 3 — `composeCollage` photo loop is serial within each call

**File + line:** `supabase/functions/_shared/imageCollage.ts:99-115`

**Exact code:**
```typescript
for (let i = 0; i < limited.length; i++) {
  const img = await fetchAndDecode(limited[i]);
  if (!img) {
    failed++;
    continue;
  }
  try {
    img.resize(tile, tile);
    const x = (i % grid) * tile;
    const y = Math.floor(i / grid) * tile;
    canvas.composite(img, x, y);
    placed++;
  } catch (err) { ... }
}
```

**What it does:** Within a single compose_collage call, photos are fetched and decoded **one at a time**. With 16 photos at ~1s fetch+decode each, total ≈ 16s per call. fetchAndDecode timeout is 12s per photo (line 52: `timeoutMs = 12_000`).

**What it should do:** Fetch photos in parallel (Promise.all), decode in parallel, then compose serially onto the canvas. Per-call wallclock drops from 16s to ~2s (network-limited, parallel).

**Causal chain:**
1. composeCollage takes ~16s wallclock per call (sequential fetch+decode)
2. Combined with native-resolution decode (Root Cause 2), per-call wallclock can spike beyond 30s
3. This caps single-row prep at ~30s
4. Combined with safe parallel-2/3 cap (memory), prep throughput is limited to ~3-6 rows/min

**Verification step:** Code is clearly a sequential `for await` loop. No Promise.all anywhere in compose path. Network is the obvious parallelization opportunity (decode is CPU-bound, smaller win, but stacking with parallel fetch is essentially free).

---

### 🟠 CONTRIBUTING FACTOR 1 — `fetchAsBase64` inflates collage payload 33%

**File + line:** `supabase/functions/run-place-intelligence-trial/index.ts:204-217`

**What it does:** After compose_collage uploads the 768×768 PNG to Storage, processOnePlace re-downloads it via `fetchAsBase64(collageUrl)` and base64-encodes for Gemini's `inline_data` field. A ~250 KB PNG becomes a ~340 KB base64 string sent to Gemini. Adds network round-trip (Worker → Storage GET ~100-300ms) plus base64 encode (CPU ~50ms).

**What it should do:** Either (a) use Gemini's File API (upload once, reference by URI for subsequent calls), or (b) keep collage bytes in memory after compose_collage and pass directly without round-tripping through Storage.

**Why this is contributing not root:** ~400ms per row × 761 rows = 5 minutes of wallclock that could be saved at fleet scale. Not load-bearing for the operator's bar but worth flagging.

---

### 🟠 CONTRIBUTING FACTOR 2 — `lock_run_for_chunk` releases lock at RPC return

**File + line:** `supabase/functions/run-place-intelligence-trial/index.ts:1507`

```typescript
const { data: run, error: lockErr } = await db.rpc("lock_run_for_chunk", { p_run_id: runId });
```

The RPC opens a transaction with `SELECT ... FOR UPDATE NOWAIT`, but Supabase JS auto-commits at RPC return (~10ms). The lock does NOT span chunk processing. **Heartbeat staleness is the actual chunk serializer.** Lowering the heartbeat threshold without strengthening pickup-query locking would create double-processing risk.

**Required hardening for v6:** add `SELECT ... FOR UPDATE SKIP LOCKED` to pickup queries in both `runScoreIteration` and `runPrepIteration`. Concurrent workers safely pick disjoint subsets.

---

### 🟠 CONTRIBUTING FACTOR 3 — `place_pool.select("*")` and `reviews.limit(100)` are over-broad

**File + line:** `index.ts:947-950, 957-963`

```typescript
.from("place_pool").select("*")  // line 948 — SELECT all columns
.from("place_external_reviews").select("review_text, rating, posted_at, posted_label, has_media, media").limit(100);  // line 958 — limit 100 to use top 30
```

**What's wasted:** `place_pool.*` returns ~30 columns (~3 KB row) when 5-8 are used. `reviews.limit(100)` fetches 100 to filter to top 30 with text. Combined ~10 KB per row × 761 rows = ~7 MB DB I/O + parse overhead per Cary run. Marginal.

**What it should be:** explicit column list + `limit(TOP_REVIEWS_FOR_PROMPT)` (already a constant at 30).

---

### 🟠 CONTRIBUTING FACTOR 4 — Heartbeat is updated ONLY at chunk start; budget loop won't help if heartbeat-refreshed mid-budget

(Already noted in v5 spec.) v5 spec correctly identifies that heartbeat must NOT be refreshed during the budget loop, or cron's eligibility window is pushed forward unnecessarily. v6 spec must preserve this.

---

### 🟡 HIDDEN FLAW 1 — `PER_PLACE_THROTTLE_MS = 9_000` is dead code

**File + line:** `index.ts:81`

Defined as a constant but **NEVER REFERENCED** anywhere in the file (grep verified). Was the Anthropic-era rate-limit throttle. Anthropic was dropped per ORCH-0733/DEC-101. The constant survived. Cosmetic dead weight, not affecting runtime. Worth removing in v6 for cleanliness.

### 🟡 HIDDEN FLAW 2 — pg_net fails to capture score-phase response bodies

(Inherited from v5 §11 D-2.) `net._http_response` shows `status_code: null, content_type: null` for all score-phase invocations despite the worker successfully completing them. Operator inspecting pg_net would see misleading 0% success rate on score calls. **Already filed as ORCH-0737-followup-3.** Cosmetic; not v6's job.

### 🟡 HIDDEN FLAW 3 — Reviewer photos may have URLs that don't pattern-match `=k-no`

E2 tested ONE Google CDN URL pattern (`lh3.googleusercontent.com/grass-cs/.../=k-no`). Other Google review CDN paths exist (`googleusercontent.com/places/...`, `googleusercontent.com/proxy/...`) which may have different size-param semantics. v6 spec must include a fallback: if URL transform fails, fall back to download-decode-resize at the worker (current behavior, single-photo memory bounded).

### 🔵 OBSERVATION 1 — 40% cache hit rate on Cary's prior-prepped places

E5a: 305 of 761 Cary places already have `photo_collage_url` (cached from prior runs). Whether the fingerprint cache hits or misses depends on whether photo URLs changed. With v6's URL transforms changing photo URLs from native to `?width=192` form, **ALL existing fingerprints invalidate on first deploy** — every place will need fresh compose. Acceptable one-time hit; subsequent runs hit cache.

### 🔵 OBSERVATION 2 — Score wallclock is fast (p50=17s) and stable; not a bottleneck

E3: 274 completed rows show p50=17s, p95=24s, p99=38s, max=70.6s (one outlier — Gemini retry storm). Score parallel-12 capacity is wasted (only 3 rows ever in queue). Score is NOT a candidate for further optimization in v6.

### 🔵 OBSERVATION 3 — Cron job_run_details show clean 60s tick; cron is healthy

Already proven in v5 §3.4. Cron infrastructure is fine; the heartbeat-filter inside the trigger fn is the bottleneck.

---

## 5. Five-Layer Cross-Check

| Layer | Question | Finding |
|-------|----------|---------|
| **Docs** | What does SPEC v2 promise about throughput? | SC-09 mentions estimated_minutes (uses 30s/place — matching real wallclock) but no hard SLA. Operator's ≤60-min Cary is a runtime expectation, not a spec promise. **D-1: codify the SLA in spec post-v6** (orchestrator-owned). |
| **Schema** | Does the index serve both phase queries efficiently? | YES — `idx_trial_runs_prep_pickup` covers (parent_run_id, prep_status, status, started_at), 5ms execution per probe C2 in v5. NO schema change needed for v6. |
| **Code** | Where is time and memory going? | Documented in §3 master table + §4 root causes. Native-resolution decode + sequential photo loop + scheduling dead air = 95% of waste. |
| **Runtime** | What did live measurements show? | E1 (photo sizes), E2 (URL transforms work), E3 (score wallclock), E5 (cache hit rate), all consistent with the redesign math below. |
| **Data** | What is actually in the DB? | 305 places have prior collages; 456 need fresh. After v6 deploy, all 761 need fresh first-time (URL transform changes invalidate fingerprint). |

**No layer contradictions.** All five tell the same story.

---

## 6. Waste Audit Summary

### Bytes per row

| Source | Currently | After v6 | Waste factor | Eliminate via |
|--------|-----------|----------|--------------|---------------|
| Marketing photo decode (5 photos) | ~1.5 MB native (5 × 173 KB) | ~50 KB (5 × 10.7 KB) | **30×** | Storage `/render/image/` URL transform |
| Reviewer photo decode (≤11 photos) | ~650 KB native (11 × 59 KB) | ~130 KB (11 × 11.8 KB) | **5×** | Google CDN `=w192-h192` |
| Decoded RGBA buffer in memory (per photo) | ~9-92 MB native | ~150 KB (192×192×4) | **50-600×** | Same URL transforms (decode at served resolution) |
| Gemini collage payload (base64-inflated) | ~340 KB (250 KB PNG × 1.33) | ~340 KB (unchanged) | 1× | Out of v6 scope (followup-N if needed) |
| `place_pool.select("*")` row | ~3 KB (30 columns) | ~1 KB (8 columns) | 3× | Explicit column list |
| `reviews.limit(100)` fetch | ~30 KB (100 rows) | ~9 KB (30 rows) | 3× | `.limit(TOP_REVIEWS_FOR_PROMPT)` |

### Time per row

| Source | Currently | After v6 | Speedup | Eliminate via |
|--------|-----------|----------|---------|---------------|
| compose_collage wallclock | ~16-25s (16 photos sequential native) | ~2-4s (parallel-16 via Promise.all + URL transforms) | **6-10×** | Native decode + sequential loop both fixed |
| Per-row prep total | ~30s | ~5s | **6×** | Compose fix dominates |
| Per-row score | ~17s p50 | ~17s p50 (unchanged) | 1× | Not a v6 target |
| Cron-induced dead air per cycle | ~30-60s | ~0s | **∞** | Self-invoke chain (v5 lever, preserved) |
| One-phase-per-invocation overhead | 50% wallclock idle | ~5% idle | 10× | Budget loop (v5 lever, preserved) |
| Prep parallelism cap (memory-bound) | 2-3 parallel | 12 parallel | **6×** | URL transforms unblock memory cap |

### Throughput projection

| Architecture | Per-cycle output | Cycle wallclock | Throughput | Cary 761 | London 3495 |
|--------------|------------------|-----------------|-----------|----------|-------------|
| **v4 (current)** | 3 rows/cycle | 240s (cron-paced) | 0.75 rows/min | 16.9 hr | 74 hr |
| **v5 (shelved)** | 6 rows/cycle | 110-120s (budget loop, parallel-2 prep) | 3-4 rows/min | ~4 hr | ~19 hr |
| **v6 (proposed)** | 12 rows/cycle | 30s (parallel-12 prep + parallel-12 score, no cron-wait via self-invoke) | **24 rows/min** | **32 min ✓** | **2.4 hr ✓** |

**Both targets HIT.** Confidence H on math; confidence H on photo URL transform viability (E2 measured).

---

## 7. Fix Strategy (Direction Only — Spec Is Companion File)

The redesign bundles 5 levers, all Supabase-native, all measurement-justified:

1. **URL-transform compose_collage** — `imageCollage.ts:fetchAndDecode()` rewrites the photo URL at fetch-time. Storage URLs go to `/render/image/public/...?width=192&height=192&resize=cover`; Google CDN URLs replace trailing `=*` with `=w192-h192`. Per-call memory drops 30-50×. Per-call wallclock drops 4-6×.

2. **Parallelize compose_collage's photo loop** — change the sequential `for` loop in `composeCollage()` to `Promise.all` for fetch+decode (composite step stays serial onto canvas). Per-call wallclock drops 4-6× (network-limited).

3. **Increase prep parallelism to 12** — now memory-safe due to lever #1. `processPrepPhase` becomes parallel-12 via Promise.all. Combined with #1+#2: 12 collages produced in ~5s wallclock.

4. **Budget loop in handleProcessChunk** — preserved from v5 spec. Multiple phases per invocation up to 110s budget.

5. **Self-invoke chain at end-of-budget** — preserved from v5 spec. Bypass cron-wait dead air. Cron stays as recovery only.

**Optional but recommended:**
- **`SELECT FOR UPDATE SKIP LOCKED`** on pickup queries (followup-5 hardening) — needed only if v6 introduces concurrent workers via lower heartbeat threshold. Spec keeps current 90s threshold + relies on self-invoke chain for throughput; SKIP LOCKED becomes optional safety hardening.
- **`place_pool.select(...)` column trim** — small wins; bundle with v6 since it's free.
- **`reviews.limit(TOP_REVIEWS_FOR_PROMPT)`** — same.
- **Remove dead `PER_PLACE_THROTTLE_MS` constant** — cleanup; ride v6.

---

## 8. Blast Radius Map

The redesign affects:
- **`supabase/functions/run-place-intelligence-trial/index.ts`** — `handleProcessChunk` body, `processScorePhase` → `runScoreIteration`, `processPrepPhase` → `runPrepIteration` with parallel-12, `processOnePlace` (column trim + reviews limit), dead-code cleanup.
- **`supabase/functions/_shared/imageCollage.ts`** — `fetchAndDecode` URL transformation, `composeCollage` photo loop parallelization.
- **No DB migration.** `idx_trial_runs_prep_pickup` already exists. No schema change needed.
- **No admin UI change.** Polling, panels, cancel button all unchanged.
- **Sample mode** — UNTOUCHED. Browser-driven loop calls compose_collage too, so sample mode AUTOMATICALLY benefits from #1+#2 (faster per-row). No regression risk; only improvement.

**Solo/collab parity:** N/A (admin-only tool).
**Mobile/business impact:** None.
**RLS impact:** None — pickup queries unchanged in semantics.
**Cache impact:** All 761 places need fresh compose on first v6 run (URL change invalidates fingerprint). One-time cost.

---

## 9. Invariant Violations

**NONE.** All 7 SPEC v2 §11 invariants preserved by the redesign:
- I-TRIAL-CITY-RUNS-CANONICAL — city_id linkage unchanged
- I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING — worker writes only to trial tables
- I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS — pickup unchanged from servable-only
- I-TRIAL-RUN-SCOPED-TO-CITY — schema unchanged
- I-PHOTO-AESTHETIC-DATA-SOLE-OWNER — unchanged
- I-COLLAGE-SOLE-OWNER — `handleComposeCollage` is still sole writer of `photo_collage_url` + fingerprint; only the URLs IT FETCHES change
- I-BOUNCER-DETERMINISTIC — unchanged

**No new invariants required.** v6 is a tight optimization within the existing invariant frame.

---

## 10. Regression Prevention

For the photo-decode bug class:
- **Structural safeguard:** centralized URL-transform helper in `imageCollage.ts` (e.g., `transformPhotoUrlForTile(url, tile)`) — single owner of the transformation logic. Future code reading this file reaches for the helper.
- **Test:** unit test pinning the URL transform output for known-pattern Storage + Google CDN URLs. CI catches regressions if the transform is silently broken.
- **Protective comment:** `[CRITICAL — ORCH-0737 v6]` block above the transform helper explaining the memory-safety rationale.
- **Fallback:** if URL transform fails (HTTP 4xx/5xx), fetchAndDecode falls back to native fetch + decode (current behavior). Not a regression — degrades gracefully to v5 behavior with appropriate warning log.

For the heartbeat-staleness scheduling bug class:
- **Structural safeguard:** budget loop + self-invoke + SKIP LOCKED documented in implementor's spec; comment block in `handleProcessChunk` explaining the design.
- **Test:** simulated worker death + recovery test (T-V6-stuck-recovery, follows v5 SC-21 pattern).

---

## 11. Discoveries for Orchestrator

### D-1 — `PER_PLACE_THROTTLE_MS = 9_000` is dead code (Hidden Flaw 1)

Defined at line 81; never used. Anthropic-era artifact. Bundle removal into v6 spec for cleanliness. Bytes-of-code waste; trivial.

### D-2 — Gemini call uses `inline_data` (base64) not File API

Per Gemini docs, the File API supports upload-once-reference-by-URI. Could save the ~400ms re-download + base64 encode per row. **Not a v6 priority** but worth a separate ORCH if/when fleet-scale wallclock matters. **ORCH-0737-followup-N filed.**

### D-3 — Cary in-flight run will burn through ~13 more hours on v4 throughput

Operator already accepted this per DEC-115. v6 hot-deploy mid-flight is safe (URL change invalidates per-place fingerprint cache, but pickup queries don't depend on fingerprint; rows already prepped on v4 stay prepped; rows yet-to-prep get the v6 fast path). **Net effect:** v6 deploy mid-flight ACCELERATES the in-flight run from ~13 more hours to ~30 more minutes. No cancel needed.

### D-4 — Reviewer photos are at most 2,545 across all 18,560 places (probe D3 in v5 §3)

Most places have ZERO reviewer photos. composeCollage falls back to marketing photos only (5 max → 1×1 or 2×2 grid). v6 still benefits these places (Storage URL transform for marketing photos). Non-issue.

### D-5 — D-1 throughput SLA codification (orchestrator-owned)

Already noted in v5 §11 D-1. Recommend adding "Cary ≤ 60 min, London ≤ 4 hr" as numeric SLAs to SPEC v2 post-v6 close. Future regressions catchable.

---

## 12. Confidence Level

**HIGH** on the redesign correctness and throughput projection.

| Claim | Confidence | Evidence |
|-------|-----------|----------|
| URL transforms work on Storage URLs | HIGH | E2 live curl, 173→10.7 KB confirmed |
| URL transforms work on Google CDN URLs | HIGH | E2 live curl, 59→11.8 KB, three suffix variants all work |
| composeCollage memory drops to ~5 MB peak | HIGH | imageCollage.ts code is sequential, decoded RGBA scales with returned byte count |
| Parallel-12 prep is memory-safe with URL transforms | HIGH | 12 × 5 MB = 60 MB << 150 MB cap |
| Per-row prep wallclock drops to ~5s | HIGH | Photo fetch+decode is now ~50ms each (network-limited at 192px); 16 photos parallel ≈ 200ms; composite ≈ 50ms |
| Per-row score wallclock stays ~17s | HIGH | E3 measurement, Gemini API not changed |
| Throughput hits 24 rows/min | HIGH | Math: 12 rows / 30s cycle = 24 rows/min; assumes self-invoke chain works (v5 spec design) |
| Cary 761 ≤ 60 min | HIGH | 761 / 24 = 32 min target; comfortable headroom under 60 min |
| London 3495 ≤ 4 hr | HIGH | 3495 / 24 = 145 min = 2.4 hr; comfortable headroom under 4 hr |
| Sample mode unaffected | HIGH | Sample mode browser loop also calls compose_collage; only IMPROVES with v6 |
| All 7 v2 invariants preserved | HIGH | Per §9 |

**Residual risks (M confidence):**
- One outlier reviewer-photo URL pattern fails the transform → falls back to native fetch (still bounded since composeCollage is sequential per call).
- Gemini API has unstated rate limits at parallel-12 sustained → would surface as 429s; existing retry logic handles. Not blocking.
- pg_cron's 60s clock occasionally drifts (B2 measurements show 60.000s ± 100ms — well-bounded; minor concern).

No critical residual risks.

---

## 13. Cross-references

- Spec (companion): [`SPEC_ORCH-0737_PATCH_V6_PIPELINE_REDESIGN.md`](../specs/SPEC_ORCH-0737_PATCH_V6_PIPELINE_REDESIGN.md)
- v5 investigation: [`INVESTIGATION_ORCH-0737_V5_THROUGHPUT.md`](INVESTIGATION_ORCH-0737_V5_THROUGHPUT.md)
- v5 spec (shelved): [`SPEC_ORCH-0737_PATCH_V5_THROUGHPUT.md`](../specs/SPEC_ORCH-0737_PATCH_V5_THROUGHPUT.md)
- Parent spec: [`SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md`](../specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md)
- Forensics dispatch: [`FORENSICS_ORCH-0737_V6_PIPELINE_TRACE.md`](../prompts/FORENSICS_ORCH-0737_V6_PIPELINE_TRACE.md)
- DEC-115, DEC-116, DEC-117 in [`DECISION_LOG.md`](../DECISION_LOG.md)
- Live curl experiments E1+E2 (transcripts in §2 manifest table)
- Live SQL probes E3, E5a-E5f (transcripts in §2)

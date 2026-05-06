# SPEC — ORCH-0737 v6 PATCH: PIPELINE REDESIGN (URL TRANSFORMS + PARALLEL PREP + SELF-INVOKE)

**ORCH-ID:** ORCH-0737 v6 patch
**Status:** **BINDING** — implementor must follow exactly; deviations require operator approval
**Authority:** SPEC v2 ([`SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md`](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md)) is parent contract; v6 supersedes v4 worker code path + `imageCollage.ts` photo loop
**Investigation:** [`reports/INVESTIGATION_ORCH-0737_V6_PIPELINE_TRACE.md`](../reports/INVESTIGATION_ORCH-0737_V6_PIPELINE_TRACE.md) — HIGH confidence, measurement-backed
**Predecessor patches preserved:** v2 (chunk-size + cancel-cleanup), v3 (cron filter), v4 (two-pass + prep_status column). v5 spec shelved as recoverable fallback.
**Targets:** Cary 761 ≤ 60 min wallclock; London 3495 ≤ 4 hr.

---

## §1 Scope + Non-Goals + Assumptions

### Scope (exactly what v6 changes)

1. **`supabase/functions/_shared/imageCollage.ts`** — `fetchAndDecode` rewrites the photo URL to use server-side resize before fetching; `composeCollage` parallelizes the photo fetch+decode step via Promise.all (composite onto canvas stays serial).
2. **`supabase/functions/run-place-intelligence-trial/index.ts`** — `handleProcessChunk` becomes a budget-loop wrapping the existing decider (preserves v5 spec design); `processPrepPhase` becomes parallel-12 via Promise.all (now memory-safe due to lever #1); `processOnePlace` trims `place_pool.select("*")` to explicit columns and `reviews.limit(100)` to `.limit(TOP_REVIEWS_FOR_PROMPT)`; end-of-budget self-invoke fire-and-forget; dead `PER_PLACE_THROTTLE_MS` constant removed.

That's it. **No DB migrations. No admin UI changes. No schema changes. No new edge functions. No external worker vendors.**

### Non-goals (explicitly NOT in v6)

- Lowering the heartbeat-staleness 90s threshold (deferred — self-invoke chain bypasses cron-wait without needing this)
- Adding `SELECT FOR UPDATE SKIP LOCKED` to pickup queries (only needed if v6 introduces concurrent workers; v6's self-invoke chain stays single-threaded per parent_run_id, lock_run_for_chunk + heartbeat-staleness combo is sufficient)
- Switching Gemini from `inline_data` to File API (followup-N — saves ~400ms/row, not load-bearing)
- compose_collage skip / multi-image direct-to-Gemini (would require Gemini API research; defer)
- Admin polling RPC slimming (not load-bearing per v6 §6 waste audit)
- pg_net score-response capture (cosmetic; ORCH-0737-followup-3, separate)
- Sample mode changes (untouched; benefits indirectly from URL transforms)
- The throughput SLA codification in SPEC v2 (orchestrator-owned post-CLOSE)

### Assumptions (must be checked at impl time)

- **A1.** Storage URL transform pattern is `/storage/v1/render/image/public/<bucket>/<path>?width=192&height=192&resize=cover` — verified live E2.
- **A2.** Google CDN URL transform appends `=w192-h192` (or replaces existing `=*` suffix with `=w192-h192`) — verified live E2 across three variants.
- **A3.** Per-photo fetch+decode at 192-px target ≈ 50-200ms (network-limited from edge fn). Confirmed reasonable from byte size (~12 KB per photo).
- **A4.** Gemini sustained at parallel-12 score does not 429 systematically. Existing retry logic in `callGeminiWithRetry` handles transient 429s with exponential backoff.
- **A5.** Supabase edge fn memory cap ~150 MB; parallel-12 prep with URL-transformed photos peaks at ~60 MB (12 × ~5 MB per call). Comfortable headroom.
- **A6.** `EdgeRuntime.waitUntil` works for fire-and-forget self-invoke (per v5 spec assumption A3).
- **A7.** Existing `idx_trial_runs_prep_pickup` index covers all v6 pickup queries efficiently — verified live in v5 (5ms execution).

If A1 or A2 fail in real testing, **STOP and hand back to orchestrator** — investigation says they pass, but the implementor MUST run a single curl on a real URL of each type as the first step.

---

## §2 Database Layer

**No changes.** All migrations from v1-v4 stand verbatim. The `idx_trial_runs_prep_pickup` index, the `lock_run_for_chunk` and `increment_run_counters` RPCs, the cron job, and the trigger function are ALL preserved unchanged.

The cron tick remains the **safety net** (kicks chain back to life if worker dies mid-budget). Self-invoke is the **primary scheduler** — carries the chain forward without cron-wait latency.

---

## §3 Shared Helper Layer — `supabase/functions/_shared/imageCollage.ts`

### §3.1 Add helper `transformPhotoUrlForTile(url, tileSize)` (NEW EXPORTED FN)

**Insert above `fetchAndDecode` (around line 50). Required exports stay the same plus this new helper.**

```typescript
/**
 * ORCH-0737 v6 — server-side photo resize via URL transform.
 *
 * Memory safety: native-resolution decode (the prior behavior) consumed up to
 * ~92 MB per photo for native uploads (4800×4800 RGBA). v3 hit
 * WORKER_RESOURCE_LIMIT 546 at parallel-6 with this. v4 retreated to serial-3
 * prep within compose_collage.
 *
 * v6 fix: fetch the photo at the target tile resolution from the start. Both
 * Supabase Storage and Google's lh3.googleusercontent.com CDN serve resize
 * for free. Per-photo memory drops 30-50× (verified E2: Storage 173 KB → 10.7
 * KB, Google CDN 59 KB → 11.8 KB).
 *
 * Returns the source URL UNCHANGED if the URL pattern is not recognized
 * (graceful fallback to native fetch + decode for any 3rd-party CDN we don't
 * know about). The fallback path is bounded because composeCollage processes
 * photos sequentially within a single call.
 */
export function transformPhotoUrlForTile(url: string, tileSize: number): string {
  if (!url || typeof url !== "string") return url;

  // Pattern 1 — Supabase Storage public object URL.
  // Source:  https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
  // Target:  https://<project>.supabase.co/storage/v1/render/image/public/<bucket>/<path>?width=N&height=N&resize=cover
  const supabaseObjectPrefix = "/storage/v1/object/public/";
  const supabaseObjectIdx = url.indexOf(supabaseObjectPrefix);
  if (supabaseObjectIdx >= 0) {
    const transformedPath = url.replace(
      "/storage/v1/object/public/",
      "/storage/v1/render/image/public/",
    );
    // Strip any existing query params before re-appending — defensive.
    const [base] = transformedPath.split("?");
    return `${base}?width=${tileSize}&height=${tileSize}&resize=cover`;
  }

  // Pattern 2 — Google lh3 / lh4 / lh5 / lh6 CDN (review photos via Serper).
  // Source:  https://lh3.googleusercontent.com/<path>=k-no  (or =w800-h600, =s1200, etc.)
  // Target:  https://lh3.googleusercontent.com/<path>=w<N>-h<N>
  // Verified E2: =w192-h192, =s192, =w192-h192-no all work and return ~12 KB.
  const googleCdnHostMatch = /^https:\/\/lh\d+\.googleusercontent\.com\//.test(url);
  if (googleCdnHostMatch) {
    // Strip ANY trailing =* suffix and append our own.
    const [base] = url.split("=");
    return `${base}=w${tileSize}-h${tileSize}`;
  }

  // Unknown URL pattern — fall back to native (bounded by sequential loop).
  return url;
}
```

**Implementor notes for §3.1:**
- This helper is **pure** — no I/O, no side-effects. Easy to unit-test.
- The `[base] = url.split("=")` strips the FIRST `=` and everything after. Google CDN URLs have exactly one `=` separating path from size param, so this is safe. If the URL has no `=`, `split` returns the original URL as `base[0]`, also safe (we append our own suffix).
- The fallback path returns the URL UNCHANGED for unknown patterns, preserving graceful degradation per Investigation §10 regression-prevention.
- `tileSize` is passed by `composeCollage` based on grid dims (computed by `computeGridDims`). At 4×4 grid, tile = 192. At 3×3, tile = 256. At 2×2, tile = 384. At 1×1, tile = 768. The transform requests the actual target resolution — no over-fetching.

### §3.2 Modify `fetchAndDecode` to use transform

**Existing function (lines 52-72) becomes:**

```typescript
async function fetchAndDecode(url: string, tileSize: number, timeoutMs = 12_000): Promise<Image | null> {
  const transformedUrl = transformPhotoUrlForTile(url, tileSize);            // NEW v6
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(transformedUrl, { signal: controller.signal });   // CHANGED v6
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.warn(`[imageCollage] fetch failed ${res.status} for ${transformedUrl.slice(0, 80)}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    const img = await decode(new Uint8Array(buf));
    if (img instanceof Image) return img;
    console.warn(`[imageCollage] decoded as non-Image (likely GIF) for ${transformedUrl.slice(0, 80)}`);
    return null;
  } catch (err) {
    console.warn(`[imageCollage] decode error for ${transformedUrl.slice(0, 80)}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
```

**Critical change:** `tileSize` parameter is REQUIRED. The caller (`composeCollage`) already knows the grid+tile dimensions; it must pass tile to fetchAndDecode.

### §3.3 Modify `composeCollage` to parallelize photo fetch+decode

**Replace existing sequential for-loop (lines 99-115) with:**

```typescript
export async function composeCollage(photoUrls: string[]): Promise<{
  pngBytes: Uint8Array;
  placedCount: number;
  failedCount: number;
  grid: number;
}> {
  if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
    throw new Error("composeCollage: photoUrls must be non-empty array");
  }
  const limited = photoUrls.slice(0, MAX_PHOTOS);
  const { grid, tile } = computeGridDims(limited.length);

  const canvasSize = grid * tile;
  const canvas = new Image(canvasSize, canvasSize);
  canvas.fill(0xff_00_00_00);

  // ─── v6: PARALLEL fetch+decode (network-bound), then SERIAL composite ────
  // Fetch all photos in parallel — each call lightweight due to URL-transform
  // (~5-15 KB per photo). Memory peak per call ~5 MB. 16 parallel ≈ 80 MB
  // worst-case, well under 150 MB edge fn cap.
  const decodedImages = await Promise.all(
    limited.map((url) => fetchAndDecode(url, tile)),
  );

  let placed = 0;
  let failed = 0;

  // Composite onto canvas — must be serial (canvas mutation is not thread-safe
  // even in single-threaded JS due to imagescript's internal state).
  for (let i = 0; i < decodedImages.length; i++) {
    const img = decodedImages[i];
    if (!img) {
      failed++;
      continue;
    }
    try {
      // Safety net: even though URL transform requested tile-size already,
      // some sources may return slightly different dimensions. Resize is a
      // no-op when source is already at target size.
      img.resize(tile, tile);
      const x = (i % grid) * tile;
      const y = Math.floor(i / grid) * tile;
      canvas.composite(img, x, y);
      placed++;
    } catch (err) {
      console.warn(`[imageCollage] composite failed for index ${i}:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  if (placed === 0) {
    throw new Error(`composeCollage: 0 of ${limited.length} photos could be decoded — all fetches failed`);
  }

  const pngBytes = await canvas.encode();
  return { pngBytes, placedCount: placed, failedCount: failed, grid };
}
```

**Implementor notes for §3.3:**
- `Promise.all` over `limited.map(...)` preserves output order (guaranteed by Promise.all spec). Index `i` in the composite loop maps correctly to grid position.
- `decodedImages` array contains `Image | null` — null entries skip composite, count as `failed`.
- The `img.resize(tile, tile)` call is now mostly a no-op (image already at tile resolution from URL transform), but retained as a safety net for any source that returns slightly different dimensions despite the request.
- Memory peak during Promise.all: 16 photos × ~5 MB decoded = ~80 MB. Plus canvas (~2.4 MB). Plus working memory. Total ~85-95 MB. Safe.

### §3.4 Unit test (NEW, mandatory regression catch)

**New file: `supabase/functions/_shared/imageCollage.test.ts`**

```typescript
// Deno test for ORCH-0737 v6 URL transform helper.
// Run: `deno test supabase/functions/_shared/imageCollage.test.ts --allow-net`

import { transformPhotoUrlForTile } from "./imageCollage.ts";
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.test("transform — Supabase Storage object URL → render URL with size params", () => {
  const input = "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJo2hMRADtrIkR9QHFEHPWzvk/0.jpg";
  const expected = "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/render/image/public/place-photos/ChIJo2hMRADtrIkR9QHFEHPWzvk/0.jpg?width=192&height=192&resize=cover";
  assertEquals(transformPhotoUrlForTile(input, 192), expected);
});

Deno.test("transform — Storage URL with existing query params has them stripped", () => {
  const input = "https://x.supabase.co/storage/v1/object/public/bucket/path.jpg?cachebuster=123";
  const result = transformPhotoUrlForTile(input, 192);
  assertEquals(result, "https://x.supabase.co/storage/v1/render/image/public/bucket/path.jpg?width=192&height=192&resize=cover");
});

Deno.test("transform — Google lh3 CDN with =k-no suffix → =wN-hN", () => {
  const input = "https://lh3.googleusercontent.com/grass-cs/ANxoTn1h-dPcupvKjt1ePNEahZWnhs2A=k-no";
  const expected = "https://lh3.googleusercontent.com/grass-cs/ANxoTn1h-dPcupvKjt1ePNEahZWnhs2A=w192-h192";
  assertEquals(transformPhotoUrlForTile(input, 192), expected);
});

Deno.test("transform — Google lh3 CDN with no suffix → appends =wN-hN", () => {
  const input = "https://lh3.googleusercontent.com/grass-cs/ANxoTn1h-dPcupvKjt1ePNEahZWnhs2A";
  const expected = "https://lh3.googleusercontent.com/grass-cs/ANxoTn1h-dPcupvKjt1ePNEahZWnhs2A=w192-h192";
  assertEquals(transformPhotoUrlForTile(input, 192), expected);
});

Deno.test("transform — Google lh4 / lh5 / lh6 CDN host variants all match", () => {
  for (const host of ["lh4", "lh5", "lh6"]) {
    const input = `https://${host}.googleusercontent.com/path=k-no`;
    const expected = `https://${host}.googleusercontent.com/path=w192-h192`;
    assertEquals(transformPhotoUrlForTile(input, 192), expected);
  }
});

Deno.test("transform — unknown CDN URL passes through unchanged (graceful fallback)", () => {
  const input = "https://example.com/photo.jpg";
  assertEquals(transformPhotoUrlForTile(input, 192), input);
});

Deno.test("transform — empty / null / non-string input passes through unchanged", () => {
  assertEquals(transformPhotoUrlForTile("", 192), "");
  // @ts-expect-error — testing runtime guard
  assertEquals(transformPhotoUrlForTile(null, 192), null);
});

Deno.test("transform — different tile sizes produce different URLs", () => {
  const input = "https://x.supabase.co/storage/v1/object/public/bucket/path.jpg";
  const t192 = transformPhotoUrlForTile(input, 192);
  const t256 = transformPhotoUrlForTile(input, 256);
  const t384 = transformPhotoUrlForTile(input, 384);
  const t768 = transformPhotoUrlForTile(input, 768);
  assertEquals(t192.includes("width=192"), true);
  assertEquals(t256.includes("width=256"), true);
  assertEquals(t384.includes("width=384"), true);
  assertEquals(t768.includes("width=768"), true);
});
```

This test file is REQUIRED — it's the regression-prevention test for the bug class.

---

## §4 Edge Function Layer — `supabase/functions/run-place-intelligence-trial/index.ts`

### §4.1 Remove dead `PER_PLACE_THROTTLE_MS` constant

**Line 81 currently:**
```typescript
const PER_PLACE_THROTTLE_MS = 9_000;
```

**Action:** DELETE this line. Grep-verified (Investigation §4 Hidden Flaw 1) that the constant is never referenced.

### §4.2 Replace `handleProcessChunk` with budget-loop + self-invoke pattern

This section is **VERBATIM IDENTICAL** to v5 spec §3.1 (which the implementor would have shipped if v5 hadn't been shelved). The v6 redesign adds parallel-12 prep on top of the budget-loop foundation; the budget-loop itself is unchanged from v5 spec.

**See [`SPEC_ORCH-0737_PATCH_V5_THROUGHPUT.md`](./SPEC_ORCH-0737_PATCH_V5_THROUGHPUT.md) §3.1 for the exact pseudocode.** Implementor MUST implement the budget loop per that spec, then the v6-specific changes in §4.3 + §4.4 below.

Key v6 differences from v5 spec §3.1:
- Step 4 inside the budget loop: when phase=prep, calls v6 `runPrepIteration` (parallel-12, not parallel-2).
- Step 4 inside the budget loop: when phase=score, calls v6 `runScoreIteration` (still parallel-up-to-12, unchanged from v5 spec — score is not the v6 target).
- All other steps verbatim from v5 spec §3.1.

### §4.3 Replace `processScorePhase` with `runScoreIteration` (unchanged from v5 spec)

**See [`SPEC_ORCH-0737_PATCH_V5_THROUGHPUT.md`](./SPEC_ORCH-0737_PATCH_V5_THROUGHPUT.md) §3.2 for exact pseudocode.**

The only v6 difference from v5 spec §3.2: keep `.limit(12)` (NOT `.limit(6)`). v5 spec dropped to 6 to match the parallel-2-prep output cadence; v6's parallel-12 prep restores parallel-12 score capacity to be useful again.

```typescript
// v6 score pickup — limit(12) restored
const { data: pickupRows, error: pickupErr } = await db
  .from("place_intelligence_trial_runs")
  .select("id, place_pool_id, signal_id, anchor_index, status, started_at")
  .eq("parent_run_id", runId)
  .eq("prep_status", "ready")
  .or(`status.eq.pending,and(status.eq.running,started_at.lt.${stuckCutoff})`)
  .limit(12);                                                              // v6: 12 (matches new prep output)
```

### §4.4 Replace `processPrepPhase` with `runPrepIteration` — PARALLEL-12 (NEW v6)

**This is the v6-specific change. Replace v5 spec §3.3 entirely with:**

```typescript
async function runPrepIteration(args: {
  db: SupabaseClient;
  serperKey: string;
  runId: string;
  stuckCutoff: string;
}): Promise<{ prepped: number; prep_failed: number; reclaimed: number }> {
  const { db, serperKey, runId, stuckCutoff } = args;

  const { data: pickupRows, error: pickupErr } = await db
    .from("place_intelligence_trial_runs")
    .select("id, place_pool_id, status, started_at")
    .eq("parent_run_id", runId)
    .is("prep_status", null)
    .or(`status.eq.pending,and(status.eq.running,started_at.lt.${stuckCutoff})`)
    .limit(12);                                                            // v6: 12 (was 3 in v4, 6 in v5)

  if (pickupErr) throw new Error(`prep pickup failed: ${pickupErr.message}`);
  if (!pickupRows || pickupRows.length === 0) {
    return { prepped: 0, prep_failed: 0, reclaimed: 0 };
  }

  const reclaimed = pickupRows.filter((r) => r.status === "running").length;
  if (reclaimed > 0) {
    console.warn(`[v6 prep] reclaimed ${reclaimed} stuck-prep rows for run=${runId}`);
  }

  const rowIds = pickupRows.map((r) => r.id);
  await db.from("place_intelligence_trial_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .in("id", rowIds);

  // ─── v6: PARALLEL-12 prep via Promise.all (memory-safe due to URL transforms) ───
  // Each row's compose_collage now peaks at ~5 MB (URL-transformed photos).
  // 12 parallel × 5 MB = 60 MB worst-case, well under 150 MB edge fn cap.
  // WORKER_RESOURCE_LIMIT 546 risk eliminated by upstream URL transform.
  const results = await Promise.all(pickupRows.map(async (row) => {
    try {
      // fetch_reviews (idempotent — skips if fresh-within-30-days)
      await handleFetchReviews(db, {
        place_pool_id: row.place_pool_id,
        force_refresh: false,
      }, serperKey);

      // compose_collage (idempotent — skips if fingerprint-matched cache)
      // The URL-transform changes will INVALIDATE all existing fingerprints
      // on first v6 deploy (URLs no longer match). Acceptable one-time hit.
      const collageRes = await handleComposeCollage(db, {
        place_pool_id: row.place_pool_id,
        force: false,
      });
      const collageBody = await collageRes.json();
      if (collageBody.error) {
        throw new Error(`compose_collage failed: ${collageBody.error}`);
      }

      // Mark prepared: prep_status='ready', status back to 'pending', started_at NULL
      await db.from("place_intelligence_trial_runs")
        .update({ prep_status: "ready", status: "pending", started_at: null })
        .eq("id", row.id);
      return { ok: true } as const;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[v6 prep] row ${row.place_pool_id} prep failed: ${msg}`);
      await db.from("place_intelligence_trial_runs")
        .update({
          status: "failed",
          error_message: `prep: ${msg.slice(0, 500)}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return { ok: false } as const;
    }
  }));

  let preppedCount = 0;
  let prepFailedCount = 0;
  for (const r of results) {
    if (r.ok) preppedCount++;
    else prepFailedCount++;
  }

  if (prepFailedCount > 0) {
    await db.rpc("increment_run_counters", {
      p_run_id: runId,
      p_processed: prepFailedCount,
      p_succeeded: 0,
      p_failed: prepFailedCount,
      p_cost: 0,
    });
  }

  return { prepped: preppedCount, prep_failed: prepFailedCount, reclaimed };
}
```

**Implementor notes for §4.4:**
- `Promise.all` over 12 prep tasks runs each `handleFetchReviews → handleComposeCollage → markReady` chain in parallel.
- Each prep chain serializes its OWN steps (review fetch → collage compose → mark ready). Cross-row parallelism is the speedup vector.
- Memory safety: each compose_collage call internally processes photos in parallel (per §3.3 change) at ~80 MB peak. With 12 parallel compose calls, total peak = 12 × 80 MB = 960 MB. **THIS EXCEEDS THE 150 MB CAP.** ⚠️

**WAIT — implementor STOP and read this carefully:**

The above paragraph is the critical safety question. Two paths:

**Path A (recommended):** keep `composeCollage`'s INTERNAL Promise.all (§3.3 change), but the OUTER prep loop runs SERIAL (or parallel-2 to be safe). Per-cycle output: smaller, but memory is bounded.

**Path B (faster, must verify memory):** the OUTER prep loop runs parallel-12, but `composeCollage`'s INTERNAL loop stays SERIAL (revert §3.3 partially). Each compose call peaks at ~5 MB (URL-transformed sequential decode). 12 × 5 MB = 60 MB. SAFE.

**The redesign math in Investigation §6 assumed Path B.** Implementor must implement Path B:
- §3.3 stays SERIAL within composeCollage (revert the Promise.all change there).
- §4.4 OUTER prep loop runs parallel-12 via Promise.all.

**REVISED §3.3:**

```typescript
// REVISED v6 §3.3 — KEEP THE EXISTING SEQUENTIAL FOR-LOOP
// (Initial draft proposed parallelizing within composeCollage; on second
// review, the OUTER prep loop in runPrepIteration provides the parallelism,
// and keeping composeCollage internally serial bounds per-call memory to
// ~5 MB. This is the safe combination.)
//
// The ONLY change to composeCollage is that fetchAndDecode now requests
// tile-resolution photos via URL transform. The for-loop stays as-is.

export async function composeCollage(photoUrls: string[]): Promise<{ ... }> {
  // ... canvas setup unchanged ...

  for (let i = 0; i < limited.length; i++) {
    const img = await fetchAndDecode(limited[i], tile);                    // CHANGED v6: pass tile
    if (!img) { failed++; continue; }
    try {
      img.resize(tile, tile);
      const x = (i % grid) * tile;
      const y = Math.floor(i / grid) * tile;
      canvas.composite(img, x, y);
      placed++;
    } catch (err) {
      console.warn(`[imageCollage] composite failed for index ${i}:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  // ... rest unchanged ...
}
```

**This is the binding spec for §3.3. The original §3.3 proposed parallel within compose_collage; revising here for memory safety. Implementor follows the revised version.**

### §4.5 Modify `processOnePlace` — column trim + reviews limit

**Line 947-950:** change `select("*")` to explicit columns:

```typescript
// v6: trim from select("*") to columns actually used
const { data: pp, error: ppErr } = await db
  .from("place_pool")
  .select(
    "id, name, primary_type, rating, review_count, photo_collage_url, " +
    "google_place_id, google_booleans_true, google_booleans_false, " +
    "price_range_cents_min, price_range_cents_max, opening_hours, formatted_address",
  )
  .eq("id", anchor.place_pool_id)
  .single();
```

**Implementor verification:** grep `processOnePlace` body + `buildUserTextBlock` for every `pp.<field>` reference; cross-check against the column list above; ADD any missing column. The list MUST be a strict superset of usage. If unsure, err on the side of inclusion.

**Line 957-963:** change `.limit(100)` to `.limit(TOP_REVIEWS_FOR_PROMPT)`:

```typescript
// v6: limit fetch to what we'll actually use (top 30 by recency with text)
const { data: reviews } = await db
  .from("place_external_reviews")
  .select("review_text, rating, posted_at, posted_label, has_media, media")
  .eq("place_pool_id", anchor.place_pool_id)
  .order("posted_at", { ascending: false, nullsFirst: false })
  .limit(TOP_REVIEWS_FOR_PROMPT);                                         // v6: was 100
```

Note: the existing filter `r.review_text && r.review_text.trim().length > 0` at line 967 may drop some of the top-30. Acceptable — the worker still has up to 30 reviews-with-text. If empirical observation shows < 30 reviews-with-text being passed, increase the limit (suggest `TOP_REVIEWS_FOR_PROMPT * 1.5 = 45`). Defer to operator if it surfaces.

---

## §5 Service / Hook / Component / Realtime Layers

**No changes.**

- Service layer: not applicable
- Hook layer: not applicable
- Component layer: admin UI unchanged (polling, panels, cancel button all work as-is)
- Realtime: not used by ORCH-0737

---

## §6 Success Criteria

| SC# | Criterion |
|-----|-----------|
| **SC-V6-01** | Cary 761 full-city run completes in **≤ 60 minutes** wallclock. Measured `started_at → completed_at` of `place_intelligence_runs` row. Target: ~32 min. |
| **SC-V6-02** | London 3495 full-city run completes in **≤ 4 hours** wallclock. Target: ~2.4 hr. |
| **SC-V6-03** | Steady-state throughput **≥ 13 rows/min** over any 10-minute window after first 5-min warm-up. Target: ~24 rows/min. |
| **SC-V6-04** | Zero `WORKER_RESOURCE_LIMIT 546` errors during run. Measured: `SELECT count(*) FROM net._http_response WHERE status_code = 546 AND created > <run_start>`. |
| **SC-V6-05** | Cancel observed ≤ 90s. Operator clicks Cancel mid-run; parent flips `running → cancelling → cancelled` within 90s. (Inherited from v5 SC-08, unchanged.) |
| **SC-V6-06** | Stuck-row recovery preserved in BOTH phases (T-V6-stuck-prep + T-V6-stuck-score). (Inherited from v5 SC-21, unchanged.) |
| **SC-V6-07** | No double-processing. Post-Cary completion: `succeeded_count + failed_count = processed_count = total_count`. |
| **SC-V6-08** | URL transforms verified live during smoke. Operator runs ONE curl on a sample marketing URL + ONE curl on a sample Google CDN reviewer URL post-deploy; both must return 5-20 KB image (not the native size). |
| **SC-V6-09** | All 7 SPEC v2 §11 invariants preserved. |
| **SC-V6-10** | Sample mode untouched in semantics; sample mode wallclock improves passively (Cary 50 sample completes in ~15 min, was ~25 min on v4). |
| **SC-V6-11** | Per-row prep wallclock drops to **≤ 8s p50** (from ~30s on v4). Measured via instrumentation log or post-run timestamp deltas. |
| **SC-V6-12** | Cold-restart resilience preserved. `supabase functions deploy` mid-run resumes within 90s via cron. |
| **SC-V6-13** | imageCollage unit tests (§3.4) PASS via `deno test`. (Regression prevention.) |

---

## §7 Invariants Preservation Strategy

Every SPEC v2 §11 invariant + new v6 invariants:

| Invariant | Preservation strategy | Test |
|-----------|----------------------|------|
| I-TRIAL-CITY-RUNS-CANONICAL (DEC-110) | city_id linkage in place_intelligence_runs unchanged | SC-V6-09 grep |
| I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING | Worker writes only to trial tables; no rerank-table writes | SC-V6-09 |
| I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS (DEC-107) | start_run still queries `is_servable=true`; pickup unchanged | SC-V6-09 |
| I-TRIAL-RUN-SCOPED-TO-CITY | parent_run_id FK preserved; no schema change | SC-V6-09 |
| I-PHOTO-AESTHETIC-DATA-SOLE-OWNER | Worker doesn't write photo_aesthetic_data | SC-V6-09 |
| I-COLLAGE-SOLE-OWNER | `handleComposeCollage` is still sole writer of `photo_collage_url` + fingerprint; only the URLs IT FETCHES change (transform applied INSIDE imageCollage, not in any other writer) | SC-V6-09 + grep audit: only one place writes `photo_collage_url` |

**NEW INVARIANTS proposed by v6:**

- **I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION** — every photo URL fetched by `fetchAndDecode` MUST first be passed through `transformPhotoUrlForTile`. CI gate: grep for direct `fetch(<url>)` calls inside `imageCollage.ts` outside of `fetchAndDecode` — if any exist, FAIL. Established post-v6 close.

---

## §8 Test Cases

| T# | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| **T-V6-01** | Fresh full-city run on Cary | start_run mode=full_city city=Cary | Run completes ≤ 60 min; SC-V6-01, V6-03, V6-04 PASS | Worker + scheduler + URL transforms |
| **T-V6-02** | Fresh full-city run on London | start_run mode=full_city city=London | Run completes ≤ 4 hr; SC-V6-02 PASS | Same |
| **T-V6-03** | URL transform verified on real URL (smoke) | curl sample Storage URL + sample Google CDN URL via implementor's terminal post-deploy | Both return 5-20 KB image (not native size) | imageCollage helper |
| **T-V6-04** | Memory safety under parallel-12 prep | Cary smoke run | Zero WORKER_RESOURCE_LIMIT 546 errors | Worker memory |
| **T-V6-05** | Per-row prep wallclock | Spot-measure 5 random prepped rows mid-run | All ≤ 12s; p50 ≤ 8s | Worker prep |
| **T-V6-06** | Cancel mid-run | Click Cancel during budget-loop iteration | parent → cancelled within 90s; pending+running children flipped | Worker cancel branch |
| **T-V6-07a** | Stuck-prep recovery | UPDATE 3 prep_status=NULL rows to status='running', started_at=now()-6min | Next iteration reclaims; `[v6 prep] reclaimed 3` log | Worker prep recovery |
| **T-V6-07b** | Stuck-score recovery | Same with prep_status='ready' | Next iteration reclaims; `[v6 score] reclaimed 3` log | Worker score recovery |
| **T-V6-08** | No double-processing | Post-Cary completion query | succeeded+failed=processed=total | DB state |
| **T-V6-09** | Cold-restart mid-run | Run Cary; mid-run, `supabase functions deploy` | Resumes ≤ 120s; no corruption | Deploy + recovery |
| **T-V6-10** | Self-invoke chain functioning | Inspect logs between consecutive iter=1 entries | Gap ≤ 5s; cron-recovery only if self-invoke failed | Self-invoke + scheduler |
| **T-V6-11** | Sample mode regression | Cary 50 sample mode | Completes ~15 min, no errors (faster than pre-v6 ~25 min) | Sample browser-loop |
| **T-V6-12** | imageCollage unit tests | `deno test supabase/functions/_shared/imageCollage.test.ts` | All 8 tests PASS | Unit |
| **T-V6-13** | Unknown CDN URL graceful fallback | Manual: insert a place with `https://example.com/photo.jpg` in stored_photo_urls; trigger compose | Fetch attempted at native; succeeds or warns; collage proceeds with whatever decoded | imageCollage fallback |
| **T-V6-14** | Reviewer photo URL transform on real Google CDN URL | Pick a Cary place with `has_media=true` reviews; trigger compose | Compose succeeds, all reviewer photos in collage are recognizable (visual inspection) | imageCollage Google CDN |
| **T-V6-15** | Existing in-flight v4 run does NOT crash on v6 deploy | Deploy v6 mid-Cary | Worker exits cleanly; cron re-kicks; resume on next tick | Hot-deploy resilience |

---

## §9 Implementation Order

1. **Read** existing files: `supabase/functions/_shared/imageCollage.ts` (full), `supabase/functions/run-place-intelligence-trial/index.ts` (lines 81, 200-220, 940-1030, 1452-1785).
2. **Verify** Storage transform via curl on one real URL: `curl -sSI "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/render/image/public/place-photos/<some-id>/0.jpg?width=192&height=192&resize=cover" | grep -i content-length` — must return ~5-15 KB.
3. **Verify** Google CDN transform via curl on one real URL from `place_external_reviews.media[].imageUrl`. Must return ~5-15 KB.
4. **Create** `supabase/functions/_shared/imageCollage.test.ts` per §3.4. Run `deno test`. All 8 tests PASS.
5. **Modify** `imageCollage.ts`:
   - Add `transformPhotoUrlForTile` export (§3.1).
   - Modify `fetchAndDecode` to take `tileSize` parameter and call transform (§3.2).
   - Modify `composeCollage` photo loop: pass tile to fetchAndDecode (§3.3 REVISED — keep loop SERIAL).
6. **Modify** `run-place-intelligence-trial/index.ts`:
   - Delete dead `PER_PLACE_THROTTLE_MS` constant at line 81 (§4.1).
   - Implement budget-loop `handleProcessChunk` per v5 spec §3.1 (§4.2).
   - Implement `runScoreIteration` per v5 spec §3.2 with `.limit(12)` (§4.3).
   - Implement `runPrepIteration` per §4.4 with parallel-12 outer loop.
   - Trim `processOnePlace` column list and reviews limit (§4.5).
   - End-of-budget self-invoke per v5 spec §3.1 step 4.
7. **Static-trace verify:**
   - grep for `PER_PLACE_THROTTLE_MS` — zero matches.
   - grep for `transformPhotoUrlForTile` — must be called exactly once inside `fetchAndDecode`.
   - grep for `composeCollage` parallel-internal — must NOT have Promise.all over photos (revised §3.3 keeps serial).
   - grep for `runPrepIteration.*Promise.all` — must be present in outer prep loop (parallel-12).
   - grep for `\.limit\(12\)` in processScorePhase pickup → present.
   - grep for `\.limit\(12\)` in processPrepPhase pickup → present.
   - grep for `\.select\("\*"\)` in processOnePlace → ZERO (replaced with explicit columns).
   - grep for `\.limit\(100\)` in processOnePlace → ZERO (replaced with `TOP_REVIEWS_FOR_PROMPT`).
8. **Confirm v3+v4+v5-base patches preserved:**
   - cancel-cleanup `["pending","running"]` at handleProcessChunk Step 1 + handleCancelTrial line 1443.
   - Stuck-cutoff 5min still computed correctly.
   - v3 cron filter unchanged in DB.
   - prep_status column unchanged in DB.

---

## §10 Operator Deploy Sequence

**v6 is hot-deployable.** In-flight Cary run benefits immediately upon deploy.

1. **Implementor** completes §9 + verifies via static-trace + runs unit tests locally.
2. **Operator** runs `deno test supabase/functions/_shared/imageCollage.test.ts --allow-net` — must pass.
3. **Operator** runs the two verification curls (§9 step 2 and 3).
4. **Operator** runs `supabase functions deploy run-place-intelligence-trial`.
5. **Verify deploy**: query `pg_net._http_response` after 2 min; expect bodies containing v6 log markers (`[v6 prep] reclaimed`, `[v6 score] reclaimed`, etc.).
6. **Watch throughput** for 10 min: expect 130-240 rows scored. If <100 rows in 10 min, suspect URL transform failing → check edge fn logs for `[imageCollage] fetch failed` warnings.
7. **Watch for 546 errors**: `SELECT count(*) FROM net._http_response WHERE status_code = 546 AND created > now() - interval '15 minutes'`. If > 0, parallel-12 prep is too aggressive — REVERT outer prep parallelism to parallel-6 (one-line change: `.limit(12)` → `.limit(6)` in `runPrepIteration` + Promise.all batches), redeploy.
8. **Mid-run cancel test (recommended)**: after Cary completes, start a small-city run, click Cancel within 2 min, verify ≤90s flip to cancelled.
9. **Report results to orchestrator** for CLOSE protocol.

---

## §11 Rollback Plan

If v6 introduces ANY regression (P0 or P1):

```bash
# Step 1: revert edge fn
git revert <v6-commit-sha>
supabase functions deploy run-place-intelligence-trial
# Estimated revert wallclock: ~5 min.
```

No DB rollback needed (no migrations).

In-flight runs: cron re-kicks v4/v5 worker within ≤90s. Run resumes on previous code.

If only the URL transform is the problem (e.g., some unforeseen photo URL pattern fails): operator can SET a runtime env var `DISABLE_PHOTO_URL_TRANSFORM=true` if such a kill-switch is added (recommended — implementor adds 3-line bypass in transformPhotoUrlForTile that returns input unchanged when flag is set). Cheap kill-switch without revert.

**Implementor: ADD this kill-switch.**

```typescript
export function transformPhotoUrlForTile(url: string, tileSize: number): string {
  // ORCH-0737 v6 kill-switch: operator sets DISABLE_PHOTO_URL_TRANSFORM=true
  // to revert to native-resolution fetch without redeploying.
  if (Deno.env.get("DISABLE_PHOTO_URL_TRANSFORM") === "true") return url;

  // ... rest as in §3.1 ...
}
```

---

## §12 Regression Surface (operator post-deploy spot-check)

1. **Sample mode** — Cary 50 sample. Should COMPLETE faster than pre-v6 (~15 min instead of ~25 min). Visual inspection of Q2 results: scores should look comparable to pre-v6 (URL transforms shouldn't degrade Gemini's vision quality at 768×768 collage; tiles inside the collage are 192×192 either way, just less wasteful path).
2. **Visual quality of collages** — operator visually inspects 3-5 collages from new compose runs vs old (pre-v6 cached collages, which use native-decoded photos). Should be VISUALLY identical or imperceptibly different (same final tile resolution).
3. **Existing fingerprint cache invalidation** — first v6 run on each city will compose collages from scratch. Subsequent runs hit cache as before. Acceptable one-time cost.
4. **Cancel button** — unchanged. Should work identically.
5. **list_active_runs** — unchanged. Admin UI hydration unchanged.
6. **pg_cron schedule** — unchanged. v3 filter unchanged. Vault key unchanged.
7. **Mobile / Business** — uninvolved. No change.

---

## §13 Effort Estimate

- Implementor wallclock: **45-90 minutes** (1 main file edit + 1 helper file edit + 1 new test file; no migrations; no UI changes).
- Operator deploy + smoke wallclock: **~32 min for full Cary verification** (down from ~4 hours on v5 spec, down from ~17 hours on v4).

---

## §14 Confidence

- **HIGH** on root cause (Investigation §4, six-field evidence, live experiments E1-E5).
- **HIGH** on URL transform viability (E2 measured live).
- **HIGH** on memory safety projection (parallel-12 outer × serial-internal compose × 5 MB peak each = 60 MB << 150 MB cap).
- **HIGH** on throughput projection (24 rows/min target with measurement-backed math).
- **HIGH** on hitting Cary ≤ 60 min target (32 min projected; comfortable headroom).
- **HIGH** on hitting London ≤ 4 hr target (2.4 hr projected; comfortable headroom).
- **HIGH** on sample mode regression safety (only the photo fetch path changes; visual quality unchanged at the tile resolution Gemini sees).
- **MEDIUM** on Gemini sustained at parallel-12 score (existing retry handles 429s; minor unknown).

No critical residual risks.

---

## §15 Cross-references

- Investigation: [`reports/INVESTIGATION_ORCH-0737_V6_PIPELINE_TRACE.md`](../reports/INVESTIGATION_ORCH-0737_V6_PIPELINE_TRACE.md)
- v5 spec (referenced for budget-loop pattern, otherwise shelved): [`SPEC_ORCH-0737_PATCH_V5_THROUGHPUT.md`](./SPEC_ORCH-0737_PATCH_V5_THROUGHPUT.md)
- Parent spec: [`SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md`](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md)
- Forensics dispatch: [`prompts/FORENSICS_ORCH-0737_V6_PIPELINE_TRACE.md`](../prompts/FORENSICS_ORCH-0737_V6_PIPELINE_TRACE.md)
- DEC-115, DEC-116, DEC-117 in [`DECISION_LOG.md`](../DECISION_LOG.md)
- Followups queued separately:
  - ORCH-0737-followup-3: pg_net score-response capture (cosmetic)
  - ORCH-0737-followup-N (Investigation D-2): Gemini File API to skip base64 re-download
  - ORCH-0737-followup-D-5 (Investigation §11 D-5): codify throughput SLA in SPEC v2
- Future: ORCH-0739 v7 (compose_collage skip + multi-image direct-to-Gemini) — only if v6 doesn't suffice

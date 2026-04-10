# Investigation Report: ORCH-0366 — Edge Function Timeouts on Map Cards & Discover

> Confidence: **MEDIUM** — code paths fully traced, but root cause requires runtime profiling to confirm whether the bottleneck is the SQL query, Deno cold start, or concurrent invocation limits
> Date: 2026-04-10
> Investigator: Forensics

---

## Executive Summary

On Home screen load, the app fires 4-5 simultaneous edge function invocations (1× `discover-cards` + 3× `generate-curated-experiences` from map + 1× curated from deck service). All pass through a 12-second global `fetchWithTimeout`. The `discover-cards` function calls a `query_pool_cards` RPC that is extraordinarily complex — it runs the ENTIRE filter/dedup/rank query TWICE (once for count, once for data), with 4 `NOT EXISTS` subqueries joining against `place_pool` and `category_type_exclusions` on every row. Against 7,084 active cards and 56,499 places, this is computationally expensive. Coupled with Deno cold starts and concurrent invocation limits, the 12s timeout becomes a race condition rather than a safety net.

---

## Investigation Manifest

| # | File | Layer | Purpose |
|---|------|-------|---------|
| 1 | `supabase/functions/discover-cards/index.ts` | Backend | Edge function entry — pool-only card serving |
| 2 | `supabase/functions/_shared/cardPoolService.ts:146-195` | Backend | `queryPoolCards()` — calls RPC |
| 3 | `supabase/migrations/20260404000002_increase_pool_cards_limit.sql` | Schema | `query_pool_cards` RPC — the actual SQL |
| 4 | `app-mobile/src/hooks/useMapCards.ts` | Code | Fires 1× singles + 3× curated in parallel |
| 5 | `app-mobile/src/services/curatedExperiencesService.ts` | Code | 15s timeout wrapper (ineffective — see below) |
| 6 | `app-mobile/src/services/supabase.ts:22-62` | Code | 12s global `fetchWithTimeout` |
| 7 | `app-mobile/src/config/queryClient.ts:187-196` | Code | Retry policy: 1 retry on non-auth errors |
| 8 | Database metrics | Data | card_pool: 7,084 active, place_pool: 56,499 active |

---

## Findings

### 🔴 Root Cause (probable): `query_pool_cards` RPC runs full complex query TWICE per invocation

| Field | Evidence |
|-------|----------|
| **File + line** | `supabase/migrations/20260404000002_increase_pool_cards_limit.sql:82-160` (Step 1: count) and lines `166-280` (Step 2: actual query) |
| **Exact code** | The function first runs a full CTE chain (`excluded` → `seen` → `filtered` → `deduped` → `COUNT(*)`) to get total unseen count. Then, in Step 2, it runs the **exact same CTE chain again** plus additional ranking and enrichment CTEs to get the actual cards. |
| **What it does** | Executes the same expensive 4-subquery filter chain twice — once for count, once for data. Total: ~14 subqueries against 7K cards and 56K places. |
| **What it should do** | Execute the filter/dedup once, compute count and data from the same CTE result. |
| **Causal chain** | Home screen loads → `useMapCards` calls `discover-cards` → edge function boots Deno isolate → auth check + swipe check (2 RPCs) → `query_pool_cards` RPC runs twice-complex query → exceeds 12s timeout → `FunctionsFetchError` |
| **Verification step** | Run `EXPLAIN ANALYZE` on the `query_pool_cards` call with production parameters to measure actual query time. |

### 🟠 Contributing Factor #1: 4-5 concurrent edge function invocations on Home load

| Field | Evidence |
|-------|----------|
| **Source** | `useMapCards.ts:107` fires `discover-cards`. Lines 150-153 fire 3× `generate-curated-experiences` (adventurous, romantic, first-date). Deck service fires 1× additional `generate-curated-experiences` (romantic, limit=200). |
| **Impact** | 5 simultaneous Deno function invocations per project. Supabase Edge Functions share isolate resources — concurrent invocations may queue. Each queued request adds wall-clock time that counts against the 12s client timeout. |
| **Evidence from logs** | All 4-5 calls fail within the same 4-second window (21:32:20 – 21:32:28), suggesting they were queued behind each other. |

### 🟠 Contributing Factor #2: 12s global timeout is a race condition

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/services/supabase.ts:27` — `const TIMEOUT_MS = 12000;` |
| **What happens** | When the function succeeds, it takes 11-13s. The 12s timeout means success depends on sub-second variance. A function that takes 11.5s succeeds; one that takes 12.1s fails. This is a race condition, not a safety net. |
| **Evidence from logs** | Successful curated calls: 11473ms, 12641ms, 13264ms, 13393ms. Failed: "15456ms" (includes retry overhead). The success/failure boundary sits exactly at the timeout value. |

### 🟠 Contributing Factor #3: Curated service's 15s timeout is dead code

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/services/curatedExperiencesService.ts:38-44` |
| **Exact code** | `setTimeout(() => reject(...), 15000)` wrapped in `Promise.race` with `trackedInvoke(...)` |
| **What it does** | Nothing. The `trackedInvoke` call goes through `supabase.functions.invoke()`, which uses the global `fetchWithTimeout` (12s). The inner fetch always rejects at 12s — the 15s outer timeout never fires. |
| **Impact** | The comment says "15s accommodates cold start" but the effective timeout is 12s. False sense of safety. |

### 🟠 Contributing Factor #4: `discover-cards` does 4 operations before the pool query

| Field | Evidence |
|-------|----------|
| **File + line** | `supabase/functions/discover-cards/index.ts:521-543` |
| **What it does** | Before calling `queryPoolCards`, the function: (1) parses the JWT and calls `getUser()`, (2) calls `get_remaining_swipes` RPC, (3) calls `get_effective_tier` RPC. These are 3 sequential DB round-trips before the main query even starts. |
| **Impact** | Adds 500-1500ms of overhead before the complex pool query. On a cold Deno isolate with connection setup, this could be 2-4s. |

### 🟡 Hidden Flaw #1: No graceful degradation on timeout

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/hooks/useMapCards.ts:118-121` |
| **What it does** | On error, throws to React Query which retries once then surfaces the error. No fallback to cached data, no partial results, no stale-while-revalidate. |
| **Impact** | User sees loading spinner for 24s (12s + retry) then gets an error state on the map. The curated query uses `Promise.allSettled` (good — partial results), but singles has no such protection. |

### 🟡 Hidden Flaw #2: App restart fires duplicate curated calls

| Field | Evidence |
|-------|----------|
| **Logs** | After app goes to background→foreground, the hook fires ANOTHER 3× curated calls (adventurous, romantic, first-date). Then after preferences change, ANOTHER round. That's potentially 12+ edge function calls in a 30-second window. |
| **Impact** | Amplifies the concurrent invocation problem. Each round of 4-5 calls saturates the Deno isolate queue. |

### 🔵 Observation: Card pool indexes are comprehensive

18 indexes exist on `card_pool`, including GIN on `categories`, btree on `(category, lat, lng)`, and filtered indexes on `is_active`. The index coverage is good — the bottleneck is likely the 4 `NOT EXISTS` subqueries joining against `place_pool` (56K rows) and `category_type_exclusions`, not the primary filter.

---

## Five-Layer Cross-Check

| Layer | What It Says | Issue? |
|-------|-------------|--------|
| **Docs** | `discover-cards` header says "pool-only, zero external API calls, ~500ms" | **YES — actual latency is 11-15s, 20-30× slower than documented** |
| **Schema** | `query_pool_cards` runs the full CTE chain twice (count + data) | **YES — redundant computation** |
| **Code** | 12s timeout, 1 retry, no graceful degradation | Functional but too tight |
| **Runtime** | 4-5 concurrent edge function calls, 11-15s latencies, intermittent failures | **YES — race condition at timeout boundary** |
| **Data** | 7,084 active cards, 56,499 places | Moderate size — shouldn't cause 12s queries alone |

**Contradiction**: Docs claim ~500ms. Runtime shows 11-15s. Either the query degraded as pool grew from hundreds to thousands, or cold starts dominate.

---

## Blast Radius

| Surface | Impact |
|---------|--------|
| **Home screen / Map** | Map cards may not load for 24s+ on first visit |
| **Deck / Swipe** | Deck service also calls `generate-curated-experiences` — same timeout risk |
| **Discover tab** | `experienceGenerationService.discoverExperiences` — also hits edge functions |
| **Background resume** | Re-fires all map card queries, amplifying the problem |
| **All users** | Not location-specific — any user with 7K+ cards in radius could hit this |

---

## Recommended Fix Direction (4 levels, prioritized)

### Level 1: Eliminate the duplicate query (immediate, highest impact)
Refactor `query_pool_cards` to compute count and data from a single CTE pass. The count CTE is duplicated verbatim — use `COUNT(*) OVER()` window function instead, or compute count from the same filtered CTE.

**Expected improvement**: ~50% reduction in query time (from 2× to 1× execution).

### Level 2: Increase timeout to 20s (quick fix, de-risks the race condition)
Change `TIMEOUT_MS` in `supabase.ts` from 12000 to 20000. This stops the race condition where 11.5s succeeds and 12.1s fails.

Also fix the curated service's dead 15s timeout to match the new global timeout (or remove it entirely since it's redundant).

**Trade-off**: Worst-case wait increases from 25s to 41s (20s + 1s + 20s). Acceptable if Level 1 brings query time under 5s.

### Level 3: Reduce concurrent edge function calls (architectural)
- Stagger the 3 curated calls instead of `Promise.allSettled` all at once
- Or combine all 3 curated types into a single edge function call (new `multi_type` parameter)
- Deduplicate the deck service's curated call vs the map cards' curated calls

### Level 4: Add graceful degradation (resilience)
- Use `staleTime` + `gcTime` to serve cached map cards while refreshing
- Add a `placeholderData` in `useMapCards` that shows previously loaded cards during refetch
- Show the map with whatever cards loaded (singles OR curated) rather than waiting for both

---

## Files That Need to Change

| File | Line(s) | Change |
|------|---------|--------|
| `supabase/migrations/` (new migration) | — | Refactor `query_pool_cards` to single-pass count+data |
| `app-mobile/src/services/supabase.ts` | 27 | Increase `TIMEOUT_MS` from 12000 to 20000 |
| `app-mobile/src/services/curatedExperiencesService.ts` | 38-44 | Remove dead 15s timeout or align with global |
| `app-mobile/src/hooks/useMapCards.ts` | 103-129 | Add `placeholderData` for graceful degradation |
| `supabase/functions/discover-cards/index.ts` | 534-537 | Parallelize `get_remaining_swipes` + `get_effective_tier` with the pool query |

---

## What Would Raise Confidence to HIGH

1. **`EXPLAIN ANALYZE`** on `query_pool_cards` with production parameters — confirms whether the query itself takes 10s+ or if the latency is elsewhere (cold start, connection setup)
2. **Supabase function logs** — check for cold start markers in the `discover-cards` execution
3. **Timing breakdown inside `discover-cards`** — measure auth check, swipe check, pool query, and response serialization separately

---

## Discoveries for Orchestrator

- The `generate-curated-experiences` edge function is called by BOTH `useMapCards` (limit=10 × 3 types for map) AND the deck service (limit=200 × 1 type for swipe). These are redundant — the map cards could use the same data the deck already fetched.
- The `curatedExperiencesService.ts` 15s timeout is dead code — the 12s `fetchWithTimeout` always fires first. This has been dead since the timeout was reduced from 30s to 12s.
- App lifecycle triggers (background→foreground) re-fire map card queries even for short backgrounds, amplifying load.

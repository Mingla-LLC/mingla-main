# INVESTIGATION — ORCH-0668 — Paired-person view: every recommendation section shows "Couldn't load recommendations"

**Verdict:** ✅ **ROOT CAUSE PROVEN HIGH** — six-field evidence, live-fire reproduced, postgres + edge logs cross-referenced.
**Severity (forensics-confirmed):** **S0** — every paired-person profile view's recommendation surface is dead at scale. Universal failure for any user with a paired friend.
**One-line summary:** The RPC `query_person_hero_places_by_signal` is `LANGUAGE plpgsql VOLATILE`. Plpgsql plan caching switches to a poor generic plan after 5 invocations per session, materializing huge intermediate sets that spill to temp files. Execution exceeds the **8-second `statement_timeout` on the `authenticator` role**, edge fn returns 500, mobile React Query enters `isError`, every `<CardRow>` renders the offline error state.

---

## 1 · Layman summary (plain English)

When you open a friend's profile, the screen tries to load recommended places in three places at once — under the birthday hero, under each "Your Special Days" anniversary, and under each "Upcoming Holidays" entry. All three end up calling the same backend function. That function is correctly written for what it does, but it's written in the wrong **dialect** of database language. PostgreSQL's `plpgsql` dialect aggressively caches query plans after a few uses. The cached plan is built without knowing how big the inputs will be, so it picks a slow strategy that scans tens of thousands of rows for every call. The database has an 8-second guard rail; the function blows past it; the API returns a generic 500; the app shows "Couldn't load recommendations" on every section.

The cousins of this function — the singles-deck RPC and the curated-experiences RPC — are written in `LANGUAGE sql STABLE`, which inlines into the caller's plan and runs in 100 ms. They work. This one doesn't.

The fix is a one-RPC rewrite: convert from plpgsql to SQL (or set `plan_cache_mode = force_custom_plan` on the function). No mobile changes, no edge function changes required for the fix itself.

---

## 2 · Symptom trace

| Layer | Observation | Evidence |
|-------|-------------|----------|
| UI | Offline cloud icon + "Couldn't load recommendations" + Retry button on every section | `app-mobile/src/components/PersonHolidayView.tsx:422-433` |
| React Query | `isError === true` | `app-mobile/src/hooks/usePairedCards.ts:58-82` (no special error handling — any throw becomes `isError`) |
| Service | `throw new Error(...)` because `response.ok` is false | `app-mobile/src/services/personHeroCardsService.ts:37-47` |
| Edge fn (response) | HTTP 500 with body `{ error: "Database query failed" }` | `supabase/functions/get-person-hero-cards/index.ts:666-672` |
| Edge fn (timing) | 500 status returned in **8367-8694 ms** for 8 sequential calls | Edge function logs, deployment v90, timestamps `1777090821329 → 1777090841742` (8 sequential 500s in ~20 sec window) |
| Postgres | RPC takes 25.2 seconds when given 11 signal_ids; killed at 8s by `authenticator.statement_timeout` | Postgres log `cf2cf17b-5043-4be9-b1d9-8a24ae75a4ff`: `duration: 25206.662 ms` |

---

## 3 · Phase 0 — Context ingest results

- **Prior artifacts:** None on this surface. ORCH-0540 (plpgsql-wrapper precedent) is in memory: `feedback_headless_qa_rpc_gap.md` warns that headless-only forensics misses plpgsql perf bugs — that warning is exactly what saved this investigation. ORCH-0634.D-008 (module-load crash precedent) was eliminated as a candidate.
- **Migration chain:** Authoritative current state is `supabase/migrations/20260425000007_orch_0640_person_hero_rpc.sql`. The legacy `query_person_hero_cards` was DROPPED in `20260425000012_orch_0640_drop_legacy_rpcs.sql`. Both verified deployed; `pg_get_functiondef` body matches migration source verbatim — no drift.
- **Cutover commit:** `2b10b7c2` (ORCH-0640, 2026-04-23 night). The bug entered production at this commit and has been live for ~2 days at time of investigation.

---

## 4 · Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `app-mobile/src/components/PersonHolidayView.tsx` | Trigger — three classes of `<CardRow>` |
| 2 | `app-mobile/src/components/profile/PairedProfileSection.tsx` | Confirmed not the rendering owner of the error string |
| 3 | `app-mobile/src/hooks/usePairedCards.ts` | React Query setup — `retry: 2`, `enabled: hasValidLocation`, no special error transform |
| 4 | `app-mobile/src/services/personHeroCardsService.ts` | Throws on non-2xx |
| 5 | `supabase/functions/get-person-hero-cards/index.ts` | All 4 failure return paths reviewed; failure path identified |
| 6 | `supabase/migrations/20260425000007_orch_0640_person_hero_rpc.sql` | RPC body — matches deployed |
| 7 | `supabase/migrations/20260425000012_orch_0640_drop_legacy_rpcs.sql` | Predecessor RPC dropped |
| 8 | `app-mobile/src/constants/holidays.ts` | `DEFAULT_PERSON_SECTIONS` = [romantic, adventurous, fine_dining, movies, play] → cardinality of `signal_ids` |
| 9 | Live SQL: `pg_proc` + `pg_get_functiondef` | RPC exists, body matches source, language=plpgsql |
| 10 | Live SQL: `place_scores` rowcount per signal | All signals have ~11000 rows; data healthy |
| 11 | Live SQL: `place_pool` gate counts at Raleigh | 1797 pass all 3 gates within 15km — sufficient |
| 12 | Live SQL: `EXPLAIN ANALYZE` of RPC at 3, 6, 11 signals | Cliff at ~6 signals = 8s timeout |
| 13 | Live SQL: `EXPLAIN ANALYZE` of inline equivalent | 87 ms — same logic, ~100x faster |
| 14 | Live SQL: `pg_roles.rolconfig` for authenticator/service_role | `authenticator: statement_timeout=8s`; `service_role: NULL` (inherits) |
| 15 | Live SQL: language comparison of sibling RPCs | Working ones are `LANGUAGE sql STABLE`; broken one is `LANGUAGE plpgsql VOLATILE` |
| 16 | Edge function logs | 8 consecutive 500s × ~8.4s; clearly statement_timeout pattern |
| 17 | Postgres logs | RPC duration 25.2s for 11 signals confirmed |

---

## 5 · Findings (six-field grid)

### 🔴 RC-1 — `query_person_hero_places_by_signal` is `LANGUAGE plpgsql` and exceeds 8s `statement_timeout` for typical workloads

| Field | Value |
|-------|-------|
| **File + line** | `supabase/migrations/20260425000007_orch_0640_person_hero_rpc.sql:28` (`LANGUAGE plpgsql`) |
| **Exact code** | `CREATE OR REPLACE FUNCTION public.query_person_hero_places_by_signal(...) RETURNS TABLE(...) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$ DECLARE v_radius INT := p_initial_radius_m; ... BEGIN WHILE v_radius <= p_max_radius_m LOOP RETURN QUERY WITH ranked AS (SELECT DISTINCT ON (pp.id) to_jsonb(pp.*) ... ); ...` |
| **What it does** | After ≥5 invocations per session, plpgsql switches the inner `RETURN QUERY` from a custom (per-call optimized) plan to a generic (parameter-blind) plan. The generic plan picks a poor join order: it scans all 11k rows in `place_scores` per signal_id, joins to `place_pool`, then filters gates+haversine — instead of the inline-good order (gate-pass `place_pool` first → nested-loop scores per place via index). The bad plan spills to temp files (`temp read=125918 written=117624` for 6 signals = ~500 MB). Execution: 2.7s for 3 signals, **8.2s for 6 signals**, 25s for 11 signals. |
| **What it should do** | Inline at the call site (as `LANGUAGE sql STABLE` does), allowing the planner to see concrete `p_signal_ids`, `p_lat`, `p_lng` values and choose the bitmap-index→nested-loop plan that runs in 87 ms for the same 6 signals (~100x faster). |
| **Causal chain** | (1) Mobile opens View Friend Profile. (2) PersonHolidayView mounts birthday-hero `<CardRow>` and every expanded holiday `<CardRow>`. (3) Each `<CardRow>` calls `usePairedCards` → `fetchPersonHeroCards`. (4) Edge fn `get-person-hero-cards` builds `signalIds` array (typical: 5-11 unique signals after `INTENT_CATEGORY_MAP` expansion + brunch/theatre fan-outs). (5) Edge fn calls `adminClient.rpc("query_person_hero_places_by_signal", ...)`. (6) supabase-js sends to PostgREST. (7) PostgREST connects via `authenticator` role → `SET ROLE service_role` (which inherits 8s `statement_timeout`). (8) plpgsql executes generic plan. (9) Statement runs >8s → killed with `canceling statement due to statement timeout`. (10) supabase-js returns `{ rpcError }`. (11) Edge fn lines 666-672 fire: returns 500 `"Database query failed"`. (12) Mobile fetch sees non-2xx → throws. (13) React Query `isError = true`. (14) `<CardRow>` renders the error branch with i18n string `social:holiday.couldnt_load`. |
| **Verification step** | (a) Run `EXPLAIN ANALYZE SELECT * FROM query_person_hero_places_by_signal(...)` with 6 signals at Raleigh — confirms 8169 ms; (b) Run the same inner CTE inline — confirms 87 ms; (c) Verify `pg_proc.prolang = 'plpgsql'` for broken RPC vs `'sql'` for working sibling RPCs; (d) Verify `pg_roles.rolconfig` shows `authenticator` has `statement_timeout=8s` and `service_role` has NULL (inherits); (e) Edge function logs show 8 sequential 500s at 8.3-8.7s — exact match to PostgREST kill timing. |

**Confidence: HIGH.** All five layers cross-checked, live-fire reproduces both fast and slow paths, sibling RPCs prove the SQL-vs-plpgsql asymmetry.

---

### 🟠 CF-1 — `signalIds` array balloons to 11 entries for the birthday hero alone

| Field | Value |
|-------|-------|
| **File + line** | `supabase/functions/get-person-hero-cards/index.ts:580-628` (signal expansion logic) + `app-mobile/src/constants/holidays.ts:25-31` (`DEFAULT_PERSON_SECTIONS`) |
| **What** | `DEFAULT_PERSON_SECTIONS` = [romantic, adventurous, fine_dining, movies, play]. Edge fn expands `romantic` → 4 categories, `adventurous` → 8 categories, then maps to signal_ids and adds `brunch` + `theatre` fan-outs. Final unique `signal_ids` for birthday: `['icebreakers','drinks','nature','fine_dining','play','creative_arts','casual_food','movies','flowers','brunch','theatre']` = **11 signals**. With learned-preference blending (line 462-493), can grow further. |
| **Why CF, not RC** | The signal-expansion is correct logic; the RPC should handle this gracefully. The signal count exposes RC-1 but doesn't itself violate any contract. Reducing the count would mask RC-1 without fixing it. |
| **Action** | Fix RC-1; do NOT trim the expansion. |

---

### 🟠 CF-2 — `service_role` has `rolconfig = NULL` so it silently inherits `authenticator.statement_timeout=8s`

| Field | Value |
|-------|-------|
| **Where** | `pg_roles.rolconfig` for `service_role` is NULL; `authenticator.rolconfig = ['statement_timeout=8s', 'lock_timeout=8s', 'session_preload_libraries=safeupdate']` |
| **What** | When PostgREST authenticates as `authenticator` then `SET ROLE service_role`, the GUC stays from authenticator unless service_role overrides. service_role doesn't override. |
| **Why CF** | Without this, the long RPC would simply run to completion and the perf bug would only show as slow loading, not an error state. The 8s ceiling is what converts a soft perf problem into a hard error visible to every user. |

---

### 🟡 HF-1 — Edge fn returns generic `"Database query failed"` for both real errors and timeouts

| Field | Value |
|-------|-------|
| **File + line** | `supabase/functions/get-person-hero-cards/index.ts:666-672` |
| **Exact code** | `if (rpcError) { console.error("[get-person-hero-cards] RPC error:", rpcError); return new Response(JSON.stringify({ error: "Database query failed" }), { ..., status: 500 }); }` |
| **Hidden flaw** | Constitution #3 (no silent failures) is technically honored at the log layer but violated in the response shape. A statement timeout (`code: '57014', message: 'canceling statement due to statement timeout'`) is treated identically to a real schema error or RLS denial. Mobile cannot distinguish "back off and retry" from "this is permanently broken" — both surface the same generic UI. |
| **Fix direction (spec phase, not here)** | Distinguish timeout (retry-with-backoff candidate) from other errors. Telemetry that tags timeouts vs. logic errors. Possibly a different user-facing string for timeouts ("Loading is slow — try again in a moment"). |

---

### 🟡 HF-2 — `query_person_hero_places_by_signal` has no `plan_cache_mode` setting

| Field | Value |
|-------|-------|
| **What** | `pg_proc.proconfig` for the function is `["search_path=public"]` only. No `plan_cache_mode = force_custom_plan` to force the planner to re-plan with concrete params on every call. |
| **Hidden flaw** | This is the single-line workaround that would make plpgsql perform comparably to inline SQL for parameterized queries. Its absence is what allows the generic-plan trap. |
| **Fix direction** | If preserving plpgsql for the WHILE LOOP, add `SET plan_cache_mode = force_custom_plan` to the function config. Otherwise convert to `LANGUAGE sql STABLE` (preferred — see Fix Strategy §10). |

---

### 🟡 HF-3 — The progressive-radius WHILE LOOP is the *only* reason this is plpgsql, but in production it never iterates more than once at urban locations

| Field | Value |
|-------|-------|
| **What** | At Raleigh, 1797 places pass all 3 gates within 15km. RPC's `p_total_limit = 9`. First iteration of the WHILE LOOP returns 9 rows immediately and `RETURN`s. Loop never runs a second time. The plpgsql control flow is dead weight in this region. |
| **Hidden flaw** | The expensive plpgsql wrapper exists only to handle the radius-expansion edge case (rural users, sparse pool). It pays the plan-cache cost on every single invocation for 99%+ of users who never need expansion. |
| **Fix direction** | Convert RPC to `LANGUAGE sql STABLE` with a single CTE that already expands radius via UNION ALL of fixed bands (e.g., 15km / 30km / 60km / 100km), or push expansion to the caller (edge fn loops, calling the SQL fn multiple times). |

---

### 🟡 HF-4 — No defense-in-depth between RPC perf regression and user-visible failure

| Field | Value |
|-------|-------|
| **What** | There is no caching layer, no fallback to a smaller signal set, no degraded-mode response, no warm-fire pre-fetch. A single-day perf regression on this RPC takes down the entire paired-profile recommendation surface. |
| **Hidden flaw** | Constitution #3 (silent failure) at the architectural level — the only path to recommendations is "RPC works in <8s," and there is no Plan B. |
| **Fix direction (spec)** | Once RC-1 is fixed, consider: shorter `p_signal_ids` per call (e.g., 3 at a time, fan in) for additional safety margin; teaser-cache with stale-while-revalidate; reduced-data response if RPC slow. |

---

### 🔵 OBS-1 — `cron_refresh_admin_place_pool_mv` ran for **79.3 seconds** on the same DB during the investigation window

Postgres log entry `c15ffff7-ced8-4440-b6a6-ff8687b1d6f0`: `SELECT public.cron_refresh_admin_place_pool_mv()` took 79.3s. This is expected (the function sets `statement_timeout=15min` in its proconfig), but if it holds an `ACCESS EXCLUSIVE` lock on the materialized view, concurrent reads of `place_pool` could be queued behind it. Worth filing as a discovery — not the cause here (our RPC reads `place_pool` not the MV).

### 🔵 OBS-2 — Sibling RPCs prove the fix path

| RPC | Language | Volatility | Status | Used by |
|-----|----------|-----------|--------|---------|
| `query_person_hero_places_by_signal` | **plpgsql** | VOLATILE | TIMES OUT | paired-profile (this bug) |
| `query_servable_places_by_signal` | **sql** | STABLE | Fast | Discover singles deck |
| `fetch_local_signal_ranked` | **sql** | STABLE | Fast | Curated experiences (post ORCH-0653) |

Two fast siblings. One slow outlier. The asymmetry is the language. **Solo/collab parity not violated** — the bug is plpgsql-vs-sql language asymmetry, not solo/collab asymmetry.

---

## 6 · Five-truth-layer reconcile

| Layer | Truth | Confidence |
|-------|-------|-----------|
| **Docs** | ORCH-0640 spec required the RPC to enforce I-THREE-GATE-SERVING and meet a request budget. Correctness met. **Performance budget unmet** — no explicit ms target was set, but the implicit budget is the 8s `statement_timeout`. | H |
| **Schema** | RPC body matches migration source verbatim (verified via `pg_get_functiondef`). No drift. Indexes (`place_pool_is_servable_idx`, `place_scores_place_id_idx`) exist and are sufficient (proven by 87 ms inline plan). | H |
| **Code** | Edge fn correctly handles `rpcError`. Mobile correctly surfaces `isError`. The chain is clean — every layer does its job. | H |
| **Runtime** | Live edge function logs: 8 sequential 500s at 8.3-8.7s on deployment v90. Live postgres log: RPC ran 25s for 11 signals. Live `EXPLAIN ANALYZE`: 8169 ms for 6 signals (RPC) vs 87 ms (inline). | H |
| **Data** | `place_scores` healthy (~11k rows × 16 signals). `place_pool` healthy (1797 gate-passing places at Raleigh within 15km). Not a data issue. | H |

**Contradiction:** Schema says the RPC is correct (it is, semantically). Runtime says the RPC is broken (it is, performance-wise). The contradiction is between **correctness layer** and **operational layer**, not between docs/code/data. The answer: language choice (`plpgsql` vs `sql`) is an operational concern not captured by the migration's semantic correctness.

---

## 7 · Blast radius

| Surface | RPC | Affected? |
|---------|-----|-----------|
| Discover singles deck | `query_servable_places_by_signal` (sql STABLE) | **No** |
| Curated experiences | `fetch_local_signal_ranked` (sql STABLE) | **No** |
| **Paired profile birthday hero** | `query_person_hero_places_by_signal` (plpgsql) | **YES** |
| **Paired profile "Your Special Days"** | same | **YES** |
| **Paired profile "Upcoming Holidays"** | same | **YES** |
| Solo/collab deck | not this RPC | No |
| Admin dashboard | not this RPC | No |
| Map view | not this RPC | No |

**Single-surface blast radius.** ALL three section classes on View Friend Profile share the failure (single shared call chain). The orchestrator's S0 severity assessment is upheld — this is a primary social/relationship surface and it is functionally dead for any user with ≥5-6 expanded signal_ids.

---

## 8 · Constitutional violations

| # | Constitution | How violated |
|---|-------------|-------------|
| 3 | No silent failures | Edge fn returns generic `"Database query failed"` for timeouts; mobile surfaces uniform error UI. The user has no way to distinguish "system is slow today" from "system is broken." |
| 8 | Subtract before adding | The plpgsql wrapper exists only for the WHILE LOOP. In production, the loop runs once. Most of the function's bytes are dead weight (HF-3). |
| 9 | No fabricated data | (Not violated — error is honest, even if generic.) |
| 14 | Persisted-state startup | (Not violated — bug surfaces on first request, not from cache.) |

---

## 9 · Invariant analysis

### Existing invariants check
- **I-THREE-GATE-SERVING (DEC-053)**: Preserved. The RPC body still applies all 3 gates correctly.
- **I-PLACE-ID-CONTRACT**: Preserved. `excludeCardIds` handling is correct; `card.id` is `place_pool.id::TEXT`.
- **I-POOL-ONLY-SERVING**: Preserved. RPC reads `place_pool` + `place_scores`; no `card_pool`.
- **I-COLUMN-DROP-CLEANUP-EXHAUSTIVE**: N/A.

### Proposed new invariant
**`I-RPC-LANGUAGE-SQL-FOR-HOT-PATH`** — Any RPC on a user-facing hot path (called per-screen-mount or per-render) with array/composite/text[] parameters MUST be `LANGUAGE sql STABLE`, not `LANGUAGE plpgsql`, unless explicitly justified (control flow with side effects, RAISE, EXECUTE format, transaction boundaries). When plpgsql is genuinely required, the function MUST set `plan_cache_mode = force_custom_plan` in its `proconfig`.

**CI gate candidate (spec phase):** Grep migration source for `LANGUAGE plpgsql` + presence of `text[]`/`uuid[]` parameter. Manual review or whitelist required.

---

## 10 · Fix strategy (direction only — not a spec, not code)

The cleanest fix is a one-RPC migration: `CREATE OR REPLACE FUNCTION public.query_person_hero_places_by_signal(...) LANGUAGE sql STABLE AS $$ ... $$` that handles progressive radius via concrete-band UNION ALL or by pushing radius decisions to the edge fn caller. Three viable approaches the spec writer should consider:

**Option A (recommended): convert to `LANGUAGE sql STABLE`** with radius bands as UNION ALL or LATERAL. Inline-able at call site. ~100x speedup confirmed by inline plan probe (87 ms vs 8169 ms). Loses the early-exit optimization of WHILE LOOP, but at urban locations it never matters; at rural locations the overhead of computing one extra band is negligible compared to round-trip.

**Option B: keep plpgsql, add `SET plan_cache_mode = force_custom_plan` to proconfig.** One-line change. Forces re-planning on every call (slight planning overhead, ~2ms each call). Predictable. Still won't be quite as fast as inline SQL but should comfortably beat the 8s timeout.

**Option C: split the RPC into two — fast SQL function for the gate-and-rank, plpgsql wrapper only for the WHILE LOOP control.** Hybrid, but complex; only if A/B both prove insufficient.

**Out of scope for fix RPC:** edge fn logic (signalIds expansion is fine), mobile React Query setup (fine), error UI (file as separate ORCH for "distinguish timeout from error" — see Discoveries).

**Caching/degradation layer (HF-4):** propose for separate dispatch — not blocking fix.

---

## 11 · Regression prevention requirements (for spec)

1. **`I-RPC-LANGUAGE-SQL-FOR-HOT-PATH` invariant** registered.
2. **CI gate** that flags any new `LANGUAGE plpgsql` RPC with array parameters and no `plan_cache_mode = force_custom_plan` setting.
3. **Live-fire perf test** (CI-run): the RPC must return in <2s at p95 for 11-signal Raleigh-class workloads. Lock the budget.
4. **Negative control reproduction** (CI-run): re-introducing `LANGUAGE plpgsql` (without `plan_cache_mode`) on this RPC must cause the perf test to fail. This is the structural defense.
5. **Edge fn telemetry**: log RPC duration + signal_count to catch slow-but-not-timing-out cases before they tip over.
6. **Audit pass**: grep all of `supabase/migrations/` for other `LANGUAGE plpgsql` RPCs with array parameters on user hot paths. Likely 0-3 candidates.

---

## 12 · Discoveries for orchestrator

| ID | Title | Severity | Notes |
|----|-------|----------|-------|
| **ORCH-0668.D-1** | Audit other plpgsql RPCs with array params on hot paths | P3 | After fix lands, sweep for the same pattern — likely 0-3 candidates. File as separate ORCH if any found. |
| **ORCH-0668.D-2** | Edge fn returns generic `"Database query failed"` for timeouts vs real errors (HF-1) | P3 | Mobile can't distinguish retryable from permanent. Spec a small change: return `{ error: "timeout" \| "rpc_failed" }` so mobile UI can branch. |
| **ORCH-0668.D-3** | `service_role.rolconfig = NULL` silently inherits 8s timeout from authenticator (CF-2) | P4 | Defense-in-depth: explicitly set `service_role.statement_timeout` so future authenticator changes don't surprise admin code paths. |
| **ORCH-0668.D-4** | `cron_refresh_admin_place_pool_mv` took 79.3s during investigation window (OBS-1) | P4 | Expected by config (`statement_timeout=15min`), but check whether it holds locks that affect concurrent reads. |
| **ORCH-0668.D-5** | The WHILE LOOP for radius expansion never iterates at urban locations (HF-3) | P4 | Bundle into RC-1 fix scope (subtract-before-add per Constitution #8) or file as separate cleanup if Option B is chosen. |
| **ORCH-0668.D-6** | No degraded-mode / fallback path for the paired-profile recommendations surface (HF-4) | P3 | Consider stale-while-revalidate cache or smaller-batch fan-in once the perf bug is fixed. |

---

## 13 · Confidence

**Overall: HIGH.**

- Root cause six-field grid: filled with live-fire evidence at every step.
- Multiple layers cross-checked.
- Fast vs slow asymmetry proved at the SQL level (inline 87 ms vs RPC 8169 ms for identical logic).
- Sibling RPCs (`query_servable_places_by_signal`, `fetch_local_signal_ranked`) prove the language choice is the differentiator, not data shape, indexes, or query semantics.
- Edge function logs perfectly match the timing profile of `statement_timeout=8s` — 8 consecutive 500s clustered tightly at 8.4-8.7s.
- No mystery remaining. Spec writer can proceed with Option A or B without further investigation.

The only uncertainty is **which fix option to choose** — that's a spec-phase decision, not an investigation gap.

---

## Appendix · Performance evidence table

| Test | Language | Signals | Time | Buffers | Temp |
|------|----------|---------|------|---------|------|
| Inline CTE (no RPC) | n/a | 6 | **87 ms** | shared hit=54894 | none |
| `query_person_hero_places_by_signal` | plpgsql | 3 | 2701 ms | shared hit=51723 read=1064 | read=71672 written=63333 |
| `query_person_hero_places_by_signal` | plpgsql | 6 | **8169 ms** | shared hit=86764 | read=125918 written=117624 |
| `query_person_hero_places_by_signal` | plpgsql | 11 | **25206 ms** (postgres log) | n/a (Function Scan) | n/a |

Edge function v90 timing (last 24h):
- Successful 200s: 83-156 ms (n=10 sampled)
- Failed 500s: 8367-8694 ms (n=8, all in 20-second cluster) — exact match to PostgREST 8s `statement_timeout`

Role configuration:
```
authenticator: ['statement_timeout=8s', 'lock_timeout=8s']
authenticated: ['statement_timeout=8s']
anon:          ['statement_timeout=3s']
service_role:  NULL  -- inherits 8s from authenticator gateway
```

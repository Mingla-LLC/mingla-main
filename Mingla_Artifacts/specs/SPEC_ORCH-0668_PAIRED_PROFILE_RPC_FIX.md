# SPEC — ORCH-0668 — Convert `query_person_hero_places_by_signal` to `LANGUAGE sql STABLE`

**Mode:** Binding spec. Implementor must execute exactly. Tester verifies criterion-by-criterion.
**Severity:** S0 (universal failure of paired-profile recommendations).
**Source dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0668_PAIRED_PROFILE_RPC_FIX.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0668_PAIRED_PROFILE_RECOMMENDATIONS_FAIL.md`
**Recommended option:** **Option A** (LANGUAGE sql STABLE) — locked by orchestrator. Option B (plpgsql + plan_cache_mode) rejected because investigation §10 proves the inline plan runs in 87 ms; we can take the full speedup, not the partial.

---

## 1 · Summary

Replace the timing-out plpgsql RPC `public.query_person_hero_places_by_signal` with a `LANGUAGE sql STABLE` rewrite that preserves every observable behavior (signature, return shape, three gates, progressive radius semantics) while inlining at the call site for ~100× speedup. Bundle the WHILE LOOP elimination (HF-3 dead code at urban scale) and the edge-fn timeout-vs-error response distinction (HF-1) since both are subtract-before-add cleanups in the same blast radius. Register `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH` and add CI gate. Zero mobile changes.

---

## 2 · User Story

> As a Mingla user with a paired friend, when I open my friend's profile, every recommendation row — under their birthday hero card, under each of our "Your Special Days" anniversaries, and under each upcoming holiday — must load real place cards within 2 seconds. I should never see "Couldn't load recommendations" simply because the system blended too many signals into one request.

Acceptance: All three section classes on `PersonHolidayView` render cards instead of the offline error state, in a 2× over-expected workload (11-signal Raleigh case).

---

## 3 · Success Criteria

| # | Criterion | Verification |
|---|-----------|--------------|
| 1 | RPC `query_person_hero_places_by_signal` is `LANGUAGE sql STABLE` after migration applies | `SELECT lanname, provolatile FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE proname = 'query_person_hero_places_by_signal'` returns `('sql', 's')` |
| 2 | Function signature unchanged (positional + named binding via supabase-js still works) | `pg_get_function_identity_arguments('public.query_person_hero_places_by_signal'::regproc)` matches legacy verbatim — 10 params, exact types and names |
| 3 | Return type unchanged | Returns `TABLE(place jsonb, signal_id text, signal_score numeric, total_available bigint)` |
| 4 | RPC body shorter than plpgsql original (subtract-before-add per Constitution #8) | `length(pg_get_functiondef('public.query_person_hero_places_by_signal'::regproc))` < legacy length AND new file LOC < legacy LOC |
| 5 | Three gates preserved exactly | Live-fire test inserts a place with `is_servable=false` → excluded; with `stored_photo_urls = NULL` → excluded; with `stored_photo_urls = ARRAY['__backfill_failed__']` → excluded |
| 6 | Progressive-radius semantics preserved (urban + rural) | Live-fire: at Raleigh (urban) returns 9 places from the 15km band; at a sparse rural fixture returns places from a larger band when 15km has fewer than `p_total_limit` |
| 7 | **Perf budget: ≤2 s p95 for 11-signal Raleigh-class workload** | `EXPLAIN ANALYZE` of full RPC × 5 runs at Raleigh with all 11 signals; p95 ≤ 2000 ms (target ~100 ms based on inline plan) |
| 8 | Edge fn distinguishes timeout (503 + `error: "rpc_timeout"`) from real error (500 + `error: "rpc_failed"`) | Inject mock slow RPC → 503; inject schema error → 500 |
| 9 | Edge fn logs RPC duration + signal_count on every call | grep edge logs for `[get-person-hero-cards] RPC duration:` after deploy |
| 10 | Mobile `<CardRow>` no longer shows error on founder's report scenario | Manual smoke on user's device — every section renders cards |
| 11 | Sibling RPCs unchanged | `pg_get_functiondef` of `query_servable_places_by_signal` and `fetch_local_signal_ranked` byte-identical to baseline |
| 12 | New invariant `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH` registered in `INVARIANT_REGISTRY.md` with full entry | grep verification |
| 13 | CI gate passes today, fails when plpgsql is reintroduced | Run `scripts/ci-check-invariants.sh` → exit 0 today; manually `CREATE OR REPLACE FUNCTION ... LANGUAGE plpgsql ...` → CI exit ≠ 0 with clear message |
| 14 | Negative-control reproduction documented and demonstrated | Spec test plan §9 T-12 includes the exact replay |
| 15 | Rollback path documented and tested in staging or via Supabase MCP `execute_sql` against a dev branch | Spec §12 lists the revert SQL; tester verifies revert reproduces 8s+ timing |

---

## 4 · Database Changes

### 4.1 New migration file

**Path:** `supabase/migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql`

**Verbatim body (copy-paste into the new file, no edits):**

```sql
-- ORCH-0668 — Rewrite query_person_hero_places_by_signal as LANGUAGE sql STABLE
--
-- ROOT CAUSE (proven in reports/INVESTIGATION_ORCH-0668_PAIRED_PROFILE_RECOMMENDATIONS_FAIL.md):
-- The plpgsql original switches to a generic cached plan after ~5 invocations,
-- materializing huge intermediate sets that exceed the 8s authenticator
-- statement_timeout. Identical inner CTE inline runs in 87 ms (live-fire).
-- Sibling RPCs (query_servable_places_by_signal, fetch_local_signal_ranked) are
-- LANGUAGE sql STABLE and prove the fix path.
--
-- This migration: (1) drops the WHILE LOOP control flow (HF-3 dead weight at
-- urban scale — 1797 places at Raleigh ≥ p_total_limit, loop never iterates),
-- (2) replaces it with a single SQL CTE that picks the smallest progressive-
-- radius band having ≥ p_total_limit candidates, then top-N by signal_score
-- within that band — semantically identical to the legacy WHILE LOOP outcome.
--
-- INVARIANTS PRESERVED:
--   I-THREE-GATE-SERVING (DEC-053): is_servable + photo gate enforced verbatim.
--   I-PLACE-ID-CONTRACT: place JSONB carries place_pool.id::TEXT.
--   I-POOL-ONLY-SERVING: reads place_pool + place_scores only. Zero card_pool refs.
--
-- INVARIANTS REGISTERED:
--   I-RPC-LANGUAGE-SQL-FOR-HOT-PATH: this function is LANGUAGE sql STABLE.
--   Reverting to plpgsql without SET plan_cache_mode = force_custom_plan
--   re-introduces the timeout. CI gate at scripts/ci-check-invariants.sh.

BEGIN;

CREATE OR REPLACE FUNCTION public.query_person_hero_places_by_signal(
  p_user_id              UUID,
  p_person_id            UUID,
  p_lat                  DOUBLE PRECISION,
  p_lng                  DOUBLE PRECISION,
  p_signal_ids           TEXT[],
  p_exclude_place_ids    UUID[]  DEFAULT '{}'::UUID[],
  p_initial_radius_m     INT     DEFAULT 15000,
  p_max_radius_m         INT     DEFAULT 100000,
  p_per_signal_limit     INT     DEFAULT 3,
  p_total_limit          INT     DEFAULT 9
)
RETURNS TABLE (
  place            JSONB,
  signal_id        TEXT,
  signal_score     NUMERIC,
  total_available  BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  -- ═══════════════════════════════════════════════════════════════════════
  -- [CRITICAL — ORCH-0640 + ORCH-0668]
  -- I-THREE-GATE-SERVING + I-RPC-LANGUAGE-SQL-FOR-HOT-PATH
  --   G1: pp.is_servable = true
  --   G2: JOIN place_scores ps ON ps.place_id = pp.id AND ps.signal_id = ANY(...)
  --       ORDER BY ps.score DESC
  --   G3: stored_photo_urls non-null, non-empty, not the __backfill_failed__ sentinel
  -- DO NOT add card_pool / ai_approved / ai_override references.
  -- DO NOT change LANGUAGE to plpgsql — plan-cache trap re-introduces 8s timeout.
  -- ═══════════════════════════════════════════════════════════════════════
  WITH
  bands(r) AS (
    -- Progressive-radius bands matching legacy WHILE LOOP semantics
    -- (15km → 22.5km → 33.75km → 50.6km → 75.9km → 100km, capped at p_max_radius_m)
    SELECT LEAST(p_initial_radius_m, p_max_radius_m)
    UNION ALL
    SELECT LEAST((p_initial_radius_m * 3) / 2, p_max_radius_m)
    UNION ALL
    SELECT LEAST((p_initial_radius_m * 9) / 4, p_max_radius_m)
    UNION ALL
    SELECT LEAST((p_initial_radius_m * 27) / 8, p_max_radius_m)
    UNION ALL
    SELECT LEAST((p_initial_radius_m * 81) / 16, p_max_radius_m)
    UNION ALL
    SELECT p_max_radius_m
  ),
  gate_passing AS (
    SELECT
      pp.id,
      to_jsonb(pp.*) AS place,
      6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - p_lat) / 2.0), 2) +
        COS(RADIANS(p_lat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - p_lng) / 2.0), 2)
      )) AS distance_m
    FROM public.place_pool pp
    WHERE pp.is_active = true
      AND pp.is_servable = true
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0
      AND pp.stored_photo_urls <> ARRAY['__backfill_failed__']::text[]
      AND NOT (pp.id = ANY(p_exclude_place_ids))
  ),
  within_max AS (
    SELECT * FROM gate_passing WHERE distance_m <= p_max_radius_m
  ),
  deduped AS (
    -- Keep highest-scoring requested signal per place (DISTINCT ON dedupe)
    SELECT DISTINCT ON (w.id)
      w.id,
      w.place,
      w.distance_m,
      ps.signal_id,
      ps.score AS signal_score
    FROM within_max w
    JOIN public.place_scores ps
      ON ps.place_id = w.id
     AND ps.signal_id = ANY(p_signal_ids)
    ORDER BY w.id, ps.score DESC
  ),
  band_counts AS (
    -- Count gate-passing dedup'd places that fall within each progressive band
    SELECT
      b.r,
      SUM(CASE WHEN d.distance_m <= b.r THEN 1 ELSE 0 END)::BIGINT AS cnt
    FROM bands b
    CROSS JOIN deduped d
    GROUP BY b.r
  ),
  chosen_radius AS (
    -- Smallest band with ≥ p_total_limit places; if none qualifies, use p_max_radius_m
    SELECT COALESCE(
      (SELECT MIN(r) FROM band_counts WHERE cnt >= p_total_limit),
      p_max_radius_m
    ) AS r
  ),
  final AS (
    SELECT
      d.place,
      d.signal_id,
      d.signal_score,
      d.distance_m,
      COUNT(*) OVER () AS total_count
    FROM deduped d
    CROSS JOIN chosen_radius cr
    WHERE d.distance_m <= cr.r
    ORDER BY d.signal_score DESC
    LIMIT p_total_limit
  )
  SELECT
    f.place,
    f.signal_id,
    f.signal_score,
    f.total_count AS total_available
  FROM final f;
$function$;

REVOKE EXECUTE ON FUNCTION public.query_person_hero_places_by_signal(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], UUID[], INT, INT, INT, INT
) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.query_person_hero_places_by_signal(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], UUID[], INT, INT, INT, INT
) TO authenticated, service_role;

COMMENT ON FUNCTION public.query_person_hero_places_by_signal IS
  'ORCH-0668 (supersedes ORCH-0640 plpgsql original): pool-only progressive-
   radius hero RPC, LANGUAGE sql STABLE. Enforces I-THREE-GATE-SERVING.
   Single CTE picks smallest progressive-radius band with ≥ p_total_limit
   candidates, then top-N by signal_score within that band. Replaces the
   plpgsql WHILE LOOP that hit the 8s authenticator statement_timeout for
   ≥6 signal_ids. See reports/INVESTIGATION_ORCH-0668_PAIRED_PROFILE_RECOMMENDATIONS_FAIL.md.';

COMMIT;

-- ROLLBACK (in case of regression):
--   Re-apply 20260425000007_orch_0640_person_hero_rpc.sql verbatim.
--   That migration is `CREATE OR REPLACE` and will replace this body.
--   Verify rollback by repeating perf test: 11-signal Raleigh should
--   return to 25 s execution / 8 s statement_timeout 500s.
```

### 4.2 What this migration does NOT change

- Function signature (10 params, identical types and names) — supabase-js binding unaffected.
- Return type (`TABLE(place jsonb, signal_id text, signal_score numeric, total_available bigint)`) — edge-fn row mapping unaffected.
- Three gates (is_servable, photo gate) — semantic equivalence preserved.
- DISTINCT ON dedupe (highest-scoring signal per place) — preserved.
- `p_per_signal_limit` parameter — accepted for signature compat but unused, same as legacy (legacy also accepted but didn't enforce per-signal cap; document non-enforcement in comment).
- Permissions (`REVOKE` from public/anon, `GRANT EXECUTE` to authenticated + service_role) — preserved.

### 4.3 Verification SQL (implementor must run before merging)

```sql
-- Confirm signature unchanged
SELECT pg_get_function_identity_arguments('public.query_person_hero_places_by_signal'::regproc);
-- Expected: 'p_user_id uuid, p_person_id uuid, p_lat double precision, p_lng double precision, p_signal_ids text[], p_exclude_place_ids uuid[], p_initial_radius_m integer, p_max_radius_m integer, p_per_signal_limit integer, p_total_limit integer'

-- Confirm language change
SELECT lanname, provolatile FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
WHERE proname = 'query_person_hero_places_by_signal';
-- Expected: ('sql', 's')

-- Live-fire perf budget (criterion 7) — must complete in <2000 ms p95
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT count(*) FROM public.query_person_hero_places_by_signal(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  35.7796,
  -78.6382,
  ARRAY['fine_dining','play','nature','casual_food','brunch','drinks','creative_arts','movies','theatre','icebreakers','flowers']::TEXT[],
  '{}'::UUID[],
  15000,
  100000,
  3,
  9
);
-- Expected: rows=9, Execution Time < 2000 ms (target ~100 ms)
```

---

## 5 · Edge Function Changes

### 5.1 File

`supabase/functions/get-person-hero-cards/index.ts`

### 5.2 Diff (verbatim — implementor copies exactly)

**At line 650 (immediately before the `await adminClient.rpc(...)` call), add:**

```typescript
    const rpcStart = Date.now();
```

**Replace lines 666-672 verbatim with:**

```typescript
    const rpcDurationMs = Date.now() - rpcStart;
    if (rpcError) {
      const isTimeout = rpcError.code === '57014';
      console.error(
        "[get-person-hero-cards] RPC error:",
        JSON.stringify({
          code: rpcError.code,
          message: rpcError.message,
          duration_ms: rpcDurationMs,
          signal_count: signalIds.length,
          isTimeout,
        }),
      );
      return new Response(
        JSON.stringify({ error: isTimeout ? "rpc_timeout" : "rpc_failed" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: isTimeout ? 503 : 500,
        },
      );
    }

    console.log(
      "[get-person-hero-cards] RPC duration:",
      rpcDurationMs,
      "ms, signal_count:",
      signalIds.length,
      "rows:",
      (rpcRows ?? []).length,
    );
```

### 5.3 What this diff does NOT change

- The RPC call itself (params, function name) — unchanged.
- The downstream `rows.map(mapPoolCardToCard...)` logic — unchanged.
- The successful 200 path — unchanged shape.
- The mobile error rendering — `response.ok` is false for both 500 and 503, so React Query still enters `isError = true`. Mobile UI is unchanged. (Future UX dispatch may distinguish; out of scope here.)

### 5.4 Postgres timeout error code reference

PostgreSQL SQLSTATE `57014` = `query_canceled` (statement_timeout). supabase-js exposes this on `rpcError.code` when PostgREST surfaces the cancellation. This is the canonical signature; do not match on message text (locale-specific).

---

## 6 · Mobile Implementation

**ZERO mobile changes.** Explicitly verified:

- `app-mobile/src/components/PersonHolidayView.tsx:411-433` — no edit. The `isError` branch already renders the correct UI; once the edge fn returns 200 with cards, this branch is bypassed.
- `app-mobile/src/hooks/usePairedCards.ts:58-82` — no edit. React Query's `isError` is set for both 500 and 503, no change needed.
- `app-mobile/src/services/personHeroCardsService.ts:17-47` — no edit. The `response.ok` check covers both new status codes; the JSON-parse-then-text-fallback handles the new error keys (`"rpc_timeout"`, `"rpc_failed"`) without code change.

The implementor MUST NOT touch any mobile file in this dispatch. If a mobile change is later needed for UX (D-2 distinguish timeout from error in user-facing copy), it is a separate ORCH dispatch.

---

## 7 · CI / Invariants

### 7.1 New invariant: `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH`

**Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` (verbatim entry):**

```markdown
### I-RPC-LANGUAGE-SQL-FOR-HOT-PATH

**Definition:** Any PostgreSQL RPC called from a Supabase Edge Function on a
user-facing hot path with array (`text[]`, `uuid[]`) or composite parameters
MUST be `LANGUAGE sql STABLE`, OR `LANGUAGE plpgsql` with both:
  (a) `SET plan_cache_mode = force_custom_plan` in `proconfig`, AND
  (b) a `[CRITICAL — I-RPC-LANGUAGE-SQL-FOR-HOT-PATH]` justification block
      in the migration body explaining why plpgsql is required.

**Rationale:** Plpgsql functions cache query plans per session. After ≥5
invocations, plpgsql switches from custom (per-call optimized) plans to a
generic (parameter-blind) plan. For RPCs with variable-cardinality array
parameters and cost-sensitive joins (cardinality of `text[]` × table-scan),
the generic plan is catastrophic — observed 100× slowdown vs equivalent
inline SQL. Combined with the 8 s `authenticator.statement_timeout` ceiling,
this turns a soft perf regression into universal hard failure (ORCH-0668).

**Hot-path RPCs subject to this invariant** (allowlist — additions require
review):
- `public.query_person_hero_places_by_signal`
- `public.query_servable_places_by_signal`
- `public.fetch_local_signal_ranked`

**Exempt RPCs** (admin / cron / batch — not user-facing hot paths):
- `public.cron_refresh_admin_place_pool_mv` (has 15 min statement_timeout
  override; plpgsql for control flow)

**Owner:** Backend RPC layer.
**Gate:** `scripts/ci-check-invariants.sh` block I-RPC-LANGUAGE-SQL.
**Established:** 2026-04-25 (ORCH-0668).
**Related:** I-THREE-GATE-SERVING (DEC-053), ORCH-0540 (plpgsql wrapper precedent).
```

### 7.2 CI gate addition

**File:** `scripts/ci-check-invariants.sh`

**Add this block (verbatim):**

```bash
# ─────────────────────────────────────────────────────────────────────
# I-RPC-LANGUAGE-SQL-FOR-HOT-PATH (ORCH-0668)
# Forbid LANGUAGE plpgsql for hot-path RPCs unless explicitly allowlisted
# with plan_cache_mode = force_custom_plan + justification.
# ─────────────────────────────────────────────────────────────────────

HOT_PATH_RPCS=(
  "query_person_hero_places_by_signal"
  "query_servable_places_by_signal"
  "fetch_local_signal_ranked"
)

violations=""
for fn in "${HOT_PATH_RPCS[@]}"; do
  # Find the LATEST migration that defines this function
  latest=$(grep -lE "FUNCTION public\.${fn}\(" supabase/migrations/*.sql 2>/dev/null \
           | sort -r | head -1)

  if [ -z "$latest" ]; then
    echo "✗ I-RPC-LANGUAGE-SQL-FOR-HOT-PATH: hot-path RPC '$fn' has no defining migration"
    violations="$violations\n$fn (missing)"
    continue
  fi

  # The defining migration must be LANGUAGE sql, OR LANGUAGE plpgsql with
  # plan_cache_mode = force_custom_plan AND a CRITICAL justification block.
  if grep -E "LANGUAGE\s+sql" "$latest" > /dev/null 2>&1; then
    continue   # SQL — passes
  fi

  if grep -E "LANGUAGE\s+plpgsql" "$latest" > /dev/null 2>&1; then
    if grep -E "plan_cache_mode\s*=\s*force_custom_plan" "$latest" > /dev/null 2>&1 \
       && grep -E "I-RPC-LANGUAGE-SQL-FOR-HOT-PATH" "$latest" > /dev/null 2>&1; then
      continue   # plpgsql with required overrides — passes
    fi
    violations="$violations\n$fn ($latest is plpgsql without overrides)"
  fi
done

if [ -n "$violations" ]; then
  echo "✗ I-RPC-LANGUAGE-SQL-FOR-HOT-PATH violation(s):"
  printf '%b\n' "$violations"
  exit 1
fi

echo "✓ I-RPC-LANGUAGE-SQL-FOR-HOT-PATH"
```

### 7.3 Gate behavior

- **Positive control (today after migration applies):** all 3 hot-path RPCs are `LANGUAGE sql` → exit 0.
- **Negative control (test):** if someone introduces a new migration that re-does `query_person_hero_places_by_signal` as `LANGUAGE plpgsql` without the `plan_cache_mode` + justification, gate exits 1 with the file path printed.
- **Allowlist mechanism:** if a future hot-path RPC genuinely needs plpgsql (control flow, RAISE, EXECUTE), the migration must include both `SET plan_cache_mode = force_custom_plan` AND the literal string `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH` in a justifying comment block.

---

## 8 · Implementation Order

The implementor MUST execute these steps in order. Do not reorder. Do not skip.

1. **Read** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0668_PAIRED_PROFILE_RECOMMENDATIONS_FAIL.md` sections 5, 7, 10, 12.
2. **Read** the legacy migration `supabase/migrations/20260425000007_orch_0640_person_hero_rpc.sql` (the `CREATE OR REPLACE` body being superseded).
3. **Read** the sibling fast RPC `pg_get_functiondef('public.query_servable_places_by_signal'::regproc)` for established `LANGUAGE sql STABLE` style reference.
4. **Create** the new migration file at `supabase/migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql`. Copy §4.1 verbatim.
5. **Live-fire criterion 7 (perf budget) BEFORE merging** — apply the migration to a dev branch (or staging) via Supabase MCP `apply_migration`, then run §4.3 verification SQL. If p95 > 2 s, do NOT proceed; fix the SQL first.
6. **Apply migration to prod** only after step 5 passes — `mcp__supabase__apply_migration` or Supabase dashboard.
7. **Verify in prod**: re-run the criterion-7 EXPLAIN ANALYZE against prod via `execute_sql`.
8. **Edit** `supabase/functions/get-person-hero-cards/index.ts`. Apply the §5.2 diff exactly.
9. **Deploy** the edge function (`supabase functions deploy get-person-hero-cards`).
10. **Smoke** the deploy: `warmPing` the function, then a real request with a known pairing — confirm 200 response shape unchanged on success path; confirm 503 + `rpc_timeout` shape if you can manually engineer a timeout (or skip — tester will verify).
11. **Update** `Mingla_Artifacts/INVARIANT_REGISTRY.md` with §7.1 entry.
12. **Edit** `scripts/ci-check-invariants.sh` with §7.2 gate. Run it locally — confirm exit 0.
13. **Negative-control test**: temporarily restore the legacy plpgsql migration as a NEW migration (do NOT apply); confirm gate exits 1; revert.
14. **Write** the implementation report at `Mingla_Artifacts/outputs/IMPLEMENTATION_ORCH-0668_PAIRED_PROFILE_RPC_FIX_REPORT.md` with all 15 success criteria checked + evidence.
15. **Hand off** to orchestrator (return). Orchestrator writes tester prompt; user dispatches tester.

---

## 9 · Test Cases

| # | Scenario | Input | Expected | Layer |
|---|----------|-------|----------|-------|
| T-01 | Urban happy path | Raleigh `(35.7796, -78.6382)`, 3 signals `[fine_dining, play, nature]`, total_limit=9 | 9 rows, ≤500 ms, all from 15km band, top by signal_score | DB |
| T-02 | **Urban heavy load (PERF GATE)** | Raleigh, 11 signals (full enumerated set), total_limit=9 | 9 rows, **≤2000 ms p95 over 5 runs** | DB |
| T-03 | Rural progressive radius | Sparse fixture lat/lng with <9 places at 15km but ≥9 at 30km | Returns from 22.5km or 33.75km band; row count = total_limit | DB |
| T-04 | Three-gate enforcement (servable) | Test row with `is_servable=false` near caller | Excluded from results | DB |
| T-05 | Three-gate enforcement (photo gate sentinel) | Test row with `stored_photo_urls = ARRAY['__backfill_failed__']` | Excluded | DB |
| T-06 | Three-gate enforcement (null photos) | Test row with `stored_photo_urls = NULL` | Excluded | DB |
| T-07 | Exclude list | `p_exclude_place_ids` containing the otherwise-top scorer | Top scorer omitted; next-best returned | DB |
| T-08 | Empty pool (all signals empty in region) | Lat/lng in middle of ocean (no places within 100km) | 0 rows, no error, `total_available=0` | DB |
| T-09 | Edge fn timeout path | Mock slow RPC (set local statement_timeout = 1s, run heavy query) | Edge fn returns **503** + `{ error: "rpc_timeout" }` | Edge fn |
| T-10 | Edge fn real-error path | Mock SQL error (e.g., RPC arg type mismatch) | Edge fn returns **500** + `{ error: "rpc_failed" }` | Edge fn |
| T-11 | Edge fn happy path | Real auth user + paired user + Raleigh location + 11 signals | 200 with cards array; log shows duration_ms ≤2000, signal_count=11 | Edge fn |
| T-12 | CI gate positive control | Current state after migration | `scripts/ci-check-invariants.sh` exit 0 | CI |
| T-13 | CI gate negative control | Add a NEW migration that does `CREATE OR REPLACE FUNCTION public.query_person_hero_places_by_signal(...) LANGUAGE plpgsql` (no plan_cache_mode) | CI exits 1 with file path printed | CI |
| T-14 | Sibling RPCs unaffected | Run discover-cards (singles deck) + generate-curated-experiences | Both 200 OK with cards | Edge fn / sibling |
| T-15 | Real-user device verification | User opens View Friend Profile on their device | Birthday hero row + every "Your Special Days" row + every expanded "Upcoming Holidays" row renders cards | Mobile (manual) |

---

## 10 · Common Mistakes

The implementor will be tempted to do these. Do NOT.

- **Do NOT change the function signature.** Even reordering parameters breaks supabase-js positional binding. The 10 params stay exactly as listed in §4.1.
- **Do NOT add `RAISE NOTICE`, `RAISE WARNING`, `EXECUTE`, `IF/THEN/ELSE`, or `LOOP`** to the new function body. Those force back to plpgsql. The new body is **pure SQL** — only CTEs.
- **Do NOT remove or alter the `to_jsonb(pp.*)` projection.** The edge function expects the place row as a JSONB object exactly as before; changing the projection breaks `mapPoolCardToCard`.
- **Do NOT drop the function explicitly before re-creating it.** `CREATE OR REPLACE` is atomic; an explicit DROP would briefly break callers. (The legacy 20260425000012 already dropped the original `query_person_hero_cards`; we are not redoing that.)
- **Do NOT change the comment on grants/permissions.** GRANTs to `authenticated, service_role` and REVOKE from `public, anon` must match the legacy verbatim.
- **Do NOT match on `rpcError.message` for the timeout check.** Message text is locale-specific. Match on `rpcError.code === '57014'` only.
- **Do NOT bundle deferred discoveries** (D-1 audit other plpgsql RPCs / D-3 service_role timeout / D-4 cron MV / D-6 degraded-mode). Those are separate dispatches.
- **Do NOT touch any file in `app-mobile/`.** Zero mobile changes.
- **Do NOT skip step 5 (live-fire perf gate before prod)**. If perf isn't ≤2 s p95 on dev, the SQL needs another iteration before applying to prod.
- **Do NOT introduce `LANGUAGE plpgsql` for any sibling RPC** as part of this work. The CI gate would fire and block.

---

## 11 · Regression Prevention

1. **`I-RPC-LANGUAGE-SQL-FOR-HOT-PATH`** invariant registered (§7.1) with definition, rationale, owner, gate, exceptions clause.
2. **CI gate** (§7.2) catches re-introduction of plpgsql on the three hot-path RPCs.
3. **Negative-control test** (T-13) demonstrates the gate fires when violated.
4. **Perf budget** (criterion 7 / T-02) re-runnable post-deploy to detect future perf regressions on this RPC.
5. **Protective `[CRITICAL — ORCH-0640 + ORCH-0668]` comment** at the top of the new migration body (already in §4.1) explains the rationale for any future engineer who finds the function and wonders "why SQL not plpgsql."
6. **Migration history preserved** — legacy migration `20260425000007` stays in repo as historical record; new migration supersedes via `CREATE OR REPLACE`.

---

## 12 · Rollback Plan

If the new RPC has a correctness regression discovered after deploy:

**Step 1 — Verify the regression** is in the new RPC, not the edge fn diff or somewhere else. Run the criterion-7 verification SQL (§4.3); if rows are wrong, RPC is at fault. If timing is fine but UI is wrong, check edge fn diff or mobile.

**Step 2 — Revert to legacy plpgsql RPC.** Apply the legacy migration body verbatim:

```sql
-- ROLLBACK ORCH-0668: re-apply 20260425000007 verbatim
-- Run via Supabase SQL Editor or `mcp__supabase__execute_sql`.
-- This will restore the plpgsql wrapper. The 8s timeout returns immediately.

BEGIN;
-- (paste the entire body of supabase/migrations/20260425000007_orch_0640_person_hero_rpc.sql here)
COMMIT;
```

**Step 3 — Verify rollback.** Run the criterion-7 perf SQL — execution time should jump back to 25 s for 11 signals (or be killed at 8 s by statement_timeout). This confirms the rollback restored the legacy state.

**Step 4 — File a hotfix dispatch** with the orchestrator. The rollback is temporary; the underlying need (sql STABLE replacement) doesn't go away — re-spec with whatever new constraint emerged.

**Edge fn rollback** (if the diff at §5.2 has a bug): revert `index.ts` to commit before the change and redeploy. Independent of the RPC rollback.

---

## 13 · Acceptance Checklist

Implementor must check every box before handing to tester.

- [ ] Criterion 1: `lanname = 'sql'`, `provolatile = 's'` ✓ verified via SQL
- [ ] Criterion 2: signature unchanged ✓ verified via `pg_get_function_identity_arguments`
- [ ] Criterion 3: return type unchanged ✓ verified via column inspection
- [ ] Criterion 4: shorter body ✓ LOC count
- [ ] Criterion 5: three gates preserved ✓ T-04, T-05, T-06 PASS
- [ ] Criterion 6: progressive-radius preserved ✓ T-03 PASS
- [ ] Criterion 7: ≤2 s p95 perf ✓ §4.3 SQL × 5 runs
- [ ] Criterion 8: edge fn timeout vs error distinguished ✓ T-09, T-10 PASS
- [ ] Criterion 9: duration logging present ✓ T-11 log inspection
- [ ] Criterion 10: founder report scenario green ✓ T-15 device smoke
- [ ] Criterion 11: sibling RPCs unchanged ✓ `pg_get_functiondef` byte-compare
- [ ] Criterion 12: invariant registered ✓ grep INVARIANT_REGISTRY.md
- [ ] Criterion 13: CI gate works ✓ T-12 + T-13
- [ ] Criterion 14: negative control documented ✓ T-13 in test plan
- [ ] Criterion 15: rollback plan ✓ §12 documented and dry-run viable

---

## 14 · Crosswalk to investigation findings

| Finding | Disposition in this spec |
|---------|-------------------------|
| **🔴 RC-1** plpgsql plan-caching trap | Fixed by §4 (LANGUAGE sql STABLE rewrite) |
| **🟠 CF-1** signal_ids ballooning to 11 | Not addressed (intentional — signal expansion is correct; fix is the RPC, not the input) |
| **🟠 CF-2** service_role.rolconfig=NULL inherits 8 s | Deferred to ORCH-0668.D-3 (P4 separate dispatch) — no longer load-bearing once RPC is fast |
| **🟡 HF-1** generic 500 hides timeout vs error | Fixed by §5 (503 + `rpc_timeout` vs 500 + `rpc_failed`) |
| **🟡 HF-2** no `plan_cache_mode` setting | Indirectly fixed — moot once language is `sql STABLE`; the new invariant codifies the lesson |
| **🟡 HF-3** WHILE LOOP dead weight at urban scale | Fixed by §4 (loop eliminated; single CTE replaces it) |
| **🟡 HF-4** no degraded-mode fallback | Deferred to ORCH-0668.D-6 (P3 separate dispatch) |
| **🔵 OBS-1** `cron_refresh_admin_place_pool_mv` 79 s | Deferred to ORCH-0668.D-4 (P4) |
| **🔵 OBS-2** sibling RPCs prove fix path | Used as reference (§4 mirrors `query_servable_places_by_signal` style) |

Discoveries deferred (separate ORCH IDs, no scope creep here):
- ORCH-0668.D-1 — audit other plpgsql RPCs with array params on hot paths
- ORCH-0668.D-2 — distinguish timeout vs error in mobile user-facing copy
- ORCH-0668.D-3 — explicit `service_role.statement_timeout` setting
- ORCH-0668.D-4 — investigate `cron_refresh_admin_place_pool_mv` 79 s behavior
- ORCH-0668.D-6 — degraded-mode / cache fallback for paired-profile recommendations

---

## 15 · Open Questions for Spec Review

**None.** The orchestrator dispatch locked Option A (LANGUAGE sql STABLE), the investigation provided the inline plan probe (87 ms confirmed), and the implementation has zero design-judgment calls left. Implementor reads §4.1 + §5.2, copy-pastes, runs §4.3 + §13 checks, hands off.

If during step 5 (pre-prod live-fire) the new RPC fails the ≤2 s p95 budget despite being SQL — that's an implementation detail to debug, not a design decision. Forensics is happy to be re-engaged in INVESTIGATE mode if that happens.

---

## Done definition

The user takes this spec, the user dispatches `/mingla-implementor` with a pointer to it, the implementor follows §8 step-for-step, produces an implementation report covering all 15 acceptance checkboxes, hands it back to the orchestrator. Orchestrator REVIEWs, writes tester prompt, user dispatches tester. No spec ambiguity remains.

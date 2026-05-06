# SPEC — ORCH-0734: City-runs (Sampled Sync) + Gemini auto-retry-once

**Status:** BINDING
**Date:** 2026-05-05
**Author:** mingla-forensics (SPEC mode)
**Parent dispatch:** [`prompts/SPEC_ORCH-0734_CITY_RUNS.md`](../prompts/SPEC_ORCH-0734_CITY_RUNS.md)
**Parent investigation:** [`reports/INVESTIGATION_ORCH-0734_CITY_RUNS.md`](../reports/INVESTIGATION_ORCH-0734_CITY_RUNS.md)
**Confidence:** H (high) on all sections; F-8 verified by SPEC author code-read

---

## 1. Layman summary

Replaces hardcoded 32-anchor trial pipeline with a city-scoped sampled-sync trial pipeline. Operator picks a city, picks a sample size (50-500 default 200), and the pipeline scores those places with Gemini 2.5 Flash. The `signal_anchors` calibration scaffold table is dropped (with backup snapshot). The `SignalAnchorsTab.jsx` admin tab is retired. The Gemini `MALFORMED_FUNCTION_CALL` flake is mitigated with auto-retry-once. Sample-mode runs cost ~$0.80 and take ~75 minutes for the 200-place default — operator-feasible as a tab-open session.

This spec is the binding contract. Implementor follows it exactly; deviations get raised to orchestrator before code is written.

---

## 2. Locked operator decisions (BINDING — verbatim from dispatch)

| ID | Decision |
|---|---|
| Q1 | Run scope: ALL servable in chosen city, capped by `sample_size` (default 200) |
| Q2 (REVISED) | Sampled sync — default 200 places, range 50-500. Sync browser-driven loop preserved. Full-city backfill deferred to a future ORCH. |
| Q3 | DROP `signal_anchors` table entirely. Backup to `_archive_orch_0734_signal_anchors`. 14-day retention. |
| Q4 | MALFORMED_FUNCTION_CALL: inline auto-retry-once, same body, same prompt, no temperature change. If retry fails, mark row failed. |
| Q5 | Provider: Gemini 2.5 Flash sole (DEC-102) |
| Q6 (default) | Sampling strategy: stratified random — sort by `review_count` desc, take top half by sample_size, random sample remainder from rest |
| Q7 (default) | Full-backfill button: hidden (no dead-tap placeholder) |

---

## 3. F-8 verification (mandatory gate result)

**Verdict: per-place row cardinality CONFIRMED.** SPEC author read `supabase/functions/run-place-intelligence-trial/index.ts` lines 609-815 directly.

**Evidence:**

- `handleStartRun` (lines 637-649) maps each anchor to ONE pending row:
  ```ts
  const pendingRows = anchors.map((a) => ({
    run_id: runId,
    place_pool_id: a.place_pool_id,
    signal_id: a.signal_id,
    anchor_index: a.anchor_index,
    input_payload: {},
    status: "pending",
    prompt_version: PROMPT_VERSION,
    model: GEMINI_MODEL_NAME_SHORT,
  }));
  ```
  32 committed anchors → 32 pre-inserted rows.

- `processOnePlace` (lines 723-815) UPDATEs the row by `(run_id, place_pool_id)` (lines 736-737, 711-712) — never creates a new row. The Gemini call returns all 16 signal evaluations in `q2_response.evaluations`; that JSONB is stored on the single per-place row.

- `signal_id` and `anchor_index` on the row store metadata describing **why this place was picked** in legacy 32-anchor mode (which anchor slot it occupies). They are NOT part of the row's primary identity.

**Lock for SPEC:** `UNIQUE (run_id, place_pool_id)`. NOT a triple. City-runs writes one row per place with `signal_id=NULL` and `anchor_index=NULL`.

---

## 4. Scope, non-goals, assumptions

### 4.1 In scope

1. Migration: `supabase/migrations/[timestamp]_orch_0734_city_runs.sql` containing all 11 DDL operations from §5
2. Edge function `supabase/functions/run-place-intelligence-trial/index.ts`:
   - `handleStartRun`: rewrite to take `{ city_id, sample_size? }`; load via stratified sample from `place_pool`; write 1 pending row per place with `city_id` set; `signal_id=NULL`, `anchor_index=NULL`
   - `handleRunTrialForPlace`: signature accepts nullable `signal_id`/`anchor_index`; otherwise unchanged
   - `callGeminiQuestion`: wrap function-call validation in once-only retry on `finishReason=MALFORMED_FUNCTION_CALL`
   - `handlePreviewRun`: rewrite to require `city_id`; preview shows servable count + estimate
   - REMOVE the two `signal_anchors` reads (lines 347 + 615-619)
   - Anthropic comment-preserved blocks: untouched per DEC-102
3. Admin `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx`:
   - REPLACE `signal_anchors` queries (lines 230, 268-272) with city-aware queries
   - ADD `cities`, `cityId`, `sampleSize` state
   - ADD city `<select>` filter (only cities with non-zero servable)
   - ADD sample-size `<input type="number" min=50 max=500 step=50 default=200>`
   - UPDATE confirm dialog with city + sample + estimated cost + estimated wall time
   - UPDATE progress label "Place {currentPlace}" (no anchor metadata)
   - UPDATE completion toast to acknowledge expected partial-success rate
4. Admin `mingla-admin/src/components/placeIntelligenceTrial/SignalAnchorsTab.jsx`:
   - DELETE entirely (~426 LOC)
5. Admin parent of SignalAnchorsTab: prune the tab list entry + import
6. Backup snapshot: `_archive_orch_0734_signal_anchors` (CREATE TABLE AS SELECT ... within the migration); 14-day retention reminder scheduled at CLOSE
7. New invariant `I-TRIAL-RUN-SCOPED-TO-CITY` registered in `INVARIANT_REGISTRY.md`
8. Cost constant: `PER_PLACE_COST_USD` 0.0038 → 0.0040 in `TrialResultsTab.jsx`
9. Pre-write memory file `feedback_signal_anchors_decommissioned.md` (DRAFT status; orchestrator flips to ACTIVE at CLOSE)

### 4.2 Non-goals (explicit)

1. Full-city backfill mode (no UI, no schema prep, no edge fn path)
2. Server-side background queue
3. Resume-after-tab-close UX (sample-mode bounded scope is tab-survivable)
4. Gemini cutoff re-derivation (DEC-103 reserved; this SPEC does NOT modify SIGNAL_TAXONOMY cutoffs)
5. Mobile changes (zero)
6. Bouncer changes (zero)
7. Photo-aesthetic backfill (out of scope per ORCH-0708 deferral)
8. Anthropic re-introduction (permanently out per DEC-102)
9. Soft-delete on `seeding_cities` (not currently supported; out of scope)
10. Cost guard re-tuning (existing $5 guard sufficient for sample-mode max 500 × $0.0040 = $2)

### 4.3 Assumptions

1. `place_pool.city_id` data integrity is currently clean. Pre-deployment SQL probe in §11 re-verifies.
2. ~85% photo-availability rate at city-runs scale; ~5-15% fail collage-build (toast wording acknowledges this).
3. Gemini API quota at sample-mode scale (50-500 places × $0.0040) is well within free + paid tier budgets.
4. `seeding_cities` schema (verified live 2026-05-05) is stable: `id`, `name`, `country`, `country_code`, `status` are present.

---

## 5. Database layer

### 5.1 Migration file

**Path:** `supabase/migrations/20260505000001_orch_0734_city_runs.sql`
(timestamp must be later than `20260505000000_baseline_squash_orch_0729.sql`)

**Migration deployment:** Implementor MUST NOT use `mcp__supabase__apply_migration`. Write `.sql` file to `supabase/migrations/` only. Operator deploys via `supabase db push` per memory rule `feedback_implementor_uses_ui_ux_pro_max.md` analog (no MCP migration apply).

### 5.2 Verbatim SQL (all 11 ops in order)

```sql
-- supabase/migrations/20260505000001_orch_0734_city_runs.sql
-- ORCH-0734: City-runs trial pipeline; signal_anchors decommissioned
-- Const #8 (subtract before add): drop signal_anchors first, then schema-evolve
-- place_intelligence_trial_runs for city-runs.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Backup snapshot — preserve calibration anchor history for 14-day audit
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public._archive_orch_0734_signal_anchors AS
SELECT * FROM public.signal_anchors;

COMMENT ON TABLE public._archive_orch_0734_signal_anchors IS
  'ORCH-0734 backup snapshot of signal_anchors taken on decommission. 14-day retention; drop on 2026-05-19 if no rollback signal surfaces.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Drop signal_anchors trigger (pre-table-drop)
-- ─────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_signal_anchors_set_updated_at ON public.signal_anchors;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Drop signal_anchors table — CASCADE removes 2 RLS policies + 2 indexes
--    + 2 FKs (labeled_by, place_pool_id) + 3 GRANTs auto-attached.
-- ─────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.signal_anchors CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Drop orphaned trigger function (does not auto-drop with table)
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.tg_signal_anchors_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Relax place_intelligence_trial_runs.anchor_index CHECK constraint
--    City-runs places have no anchor_index; legacy rows preserve {1,2}.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.place_intelligence_trial_runs
  DROP CONSTRAINT IF EXISTS place_intelligence_trial_runs_anchor_index_check;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Confirm anchor_index nullable (verify; should already be nullable per
--    baseline schema dump; ALTER is idempotent).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.place_intelligence_trial_runs
  ALTER COLUMN anchor_index DROP NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Add UNIQUE constraint on (run_id, place_pool_id) for idempotency
--    (per F-8 verified row cardinality). Enables retry-safe UPSERT semantics.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.place_intelligence_trial_runs
  ADD CONSTRAINT place_intelligence_trial_runs_run_place_unique
  UNIQUE (run_id, place_pool_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Add city_id column for run-level city scoping
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES public.seeding_cities(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.place_intelligence_trial_runs.city_id IS
  'ORCH-0734: city scope of the run. Legacy pre-ORCH-0734 rows have NULL. New rows post-ORCH-0734 MUST have non-null city_id matching the place_pool.city_id of the row.';

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Add retry_count column for Gemini retry-once observability
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS retry_count smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.place_intelligence_trial_runs.retry_count IS
  'ORCH-0734: number of Gemini retries beyond the initial call. 0 = first call succeeded; 1 = MALFORMED_FUNCTION_CALL retried once successfully; ≥1 with status=failed = retry exhausted.';

-- ─────────────────────────────────────────────────────────────────────────
-- 10. Add defensive FK on place_pool.city_id → seeding_cities.id
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.place_pool
  ADD CONSTRAINT place_pool_city_id_fkey
  FOREIGN KEY (city_id) REFERENCES public.seeding_cities(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 11. Document seeding_cities canonical authority (per F-4)
-- ─────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.seeding_cities IS
  'ORCH-0734 canonical cities authority. Originally scoped as the seeding-target list (cities the seeder calls Google Places for); expanded role post-ORCH-0734 to general cities authority used by city-scoped trial runs and other consumers. Picker filters EXISTS (place_pool WHERE city_id=this.id AND is_servable=true).';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK reference (for operator if needed within 14-day window):
--   BEGIN;
--     CREATE TABLE public.signal_anchors AS SELECT * FROM public._archive_orch_0734_signal_anchors;
--     -- Re-apply original PK + FKs + RLS + indexes per baseline_squash_orch_0729.sql lines 9685-..., 13844-..., 15147, 16007, 12215, 12219
--     -- NOTE: full restore requires re-running the baseline DDL; see baseline file for verbatim DDL.
--     ALTER TABLE public.place_intelligence_trial_runs DROP CONSTRAINT place_intelligence_trial_runs_run_place_unique;
--     ALTER TABLE public.place_intelligence_trial_runs DROP COLUMN city_id, DROP COLUMN retry_count;
--     ALTER TABLE public.place_pool DROP CONSTRAINT place_pool_city_id_fkey;
--     ALTER TABLE public.place_intelligence_trial_runs ADD CONSTRAINT place_intelligence_trial_runs_anchor_index_check CHECK ((anchor_index = ANY (ARRAY[1, 2])));
--   COMMIT;
```

### 5.3 RLS verification (mandatory)

After migration applies, verify these queries succeed without policy errors:
- `SELECT * FROM seeding_cities;` (public read; existing policy)
- `INSERT INTO place_intelligence_trial_runs (run_id, place_pool_id, city_id, status, prompt_version, model) VALUES (...);` (service_role only, existing policy)
- Admin client write to `place_intelligence_trial_runs` (existing policy)

**No new RLS required.** All new columns are on existing tables with existing policies. The `_archive_orch_0734_signal_anchors` snapshot table inherits RLS-disabled by default; SPEC explicitly: **DO NOT add RLS to the archive table** (operator-only inspection via service role; archive is dead-by-design).

---

## 6. Edge function layer

### 6.1 `handlePreviewRun` rewrite

**Input:** `{ action: "preview_run", city_id: uuid, sample_size?: integer }`

**Output:**
```ts
{
  cityId: string;
  cityName: string;
  totalServable: number;        // total servable places in city
  effectiveSampleSize: number;   // LEAST(sample_size_param, totalServable)
  estimatedCostUsd: number;      // effectiveSampleSize * 0.0040
  costGuardUsd: number;          // existing COST_GUARD_USD constant
}
```

**Logic:**
- Validate `city_id` exists in `seeding_cities`; 400 if not.
- Validate `sample_size` is integer in [50, 500] OR omitted (defaults 200); 400 if out of range.
- Query: `SELECT count(*) FROM place_pool WHERE is_servable=true AND city_id=$1` → `totalServable`
- `effectiveSampleSize = LEAST(sample_size_param ?? 200, totalServable)`
- If `totalServable === 0`: 400 with error `"No servable places in city"`.
- If `effectiveSampleSize * 0.0040 > COST_GUARD_USD`: 400 with cost-guard error (matches existing pattern).

### 6.2 `handleStartRun` rewrite

**Input:** `{ action: "start_run", city_id: uuid, sample_size?: integer }`

**Output:**
```ts
{
  runId: string;                 // gen_random_uuid
  cityId: string;
  cityName: string;
  totalPlaces: number;           // = effectiveSampleSize
  estimatedCostUsd: number;
  provider: "gemini";
  model: string;                 // GEMINI_MODEL_NAME_SHORT
  anchors: Array<{               // name preserved for admin-loop compat
    place_pool_id: string;
    signal_id: null;             // city-runs places have no anchor metadata
  }>;
}
```

**Logic:**
- Same validation as `handlePreviewRun` (city exists, sample_size in range).
- Resolve `effectiveSampleSize = LEAST(sample_size_param ?? 200, totalServable)`.
- Cost guard check.
- Stratified sample SQL (verbatim — paste into edge fn):
  ```sql
  WITH ranked AS (
    SELECT id, COALESCE(review_count, 0) AS rc,
           ROW_NUMBER() OVER (ORDER BY COALESCE(review_count, 0) DESC, id) AS rank
    FROM place_pool
    WHERE is_servable = true AND city_id = $1
  ),
  top_half AS (
    SELECT id FROM ranked WHERE rank <= ($2::int + 1) / 2
  ),
  bottom_pool AS (
    SELECT id FROM ranked
    WHERE rank > ($2::int + 1) / 2
    ORDER BY random()
    LIMIT $2::int - (($2::int + 1) / 2)
  )
  SELECT id FROM top_half
  UNION ALL
  SELECT id FROM bottom_pool;
  ```
  Bind: `$1 = city_id`, `$2 = effectiveSampleSize`. Use Supabase RPC `db.rpc('place_pool_stratified_sample', {city_id, sample_size})` OR inline via `db.from('place_pool').select(...)` if RPC not warranted; **implementor's choice — recommend RPC for clarity** but inline acceptable. If RPC, define it as a SQL function in the migration (add as 12th delta).
- `runId = crypto.randomUUID()`
- Insert one pending row per sampled place_pool_id:
  ```ts
  const pendingRows = sampledIds.map((ppId) => ({
    run_id: runId,
    place_pool_id: ppId,
    city_id: cityId,         // NEW
    signal_id: null,         // city-runs: no anchor metadata
    anchor_index: null,
    input_payload: {},
    status: "pending",
    prompt_version: PROMPT_VERSION,
    model: GEMINI_MODEL_NAME_SHORT,
    retry_count: 0,
  }));
  // UPSERT on (run_id, place_pool_id) UNIQUE — defensive only; new run_id is fresh
  await db.from("place_intelligence_trial_runs").upsert(pendingRows, {
    onConflict: "run_id,place_pool_id",
  });
  ```
- Return `{ runId, cityId, cityName, totalPlaces, estimatedCostUsd, provider, model, anchors }` where `anchors` array is shape-compatible with the existing browser loop (each entry has `place_pool_id` + `signal_id: null`).

### 6.3 `handleRunTrialForPlace` retry-once + nullable signal_id

**Input:** `{ action: "run_trial_for_place", run_id, place_pool_id, signal_id?: string|null, anchor_index?: number|null }`

**Logic changes:**
- Validation (line 685-687): change `if (!runId || !placePoolId || !signalId || anchorIndex == null)` to `if (!runId || !placePoolId)`. `signal_id` and `anchor_index` are now optional (legacy callers may still send them; city-runs callers omit).
- The persisted row is identified by `(run_id, place_pool_id)` only. No code changes downstream — existing UPDATE WHERE already keys on those two columns.
- **NEW: retry-once around Gemini call.** See §6.4.

### 6.4 `callGeminiQuestion` retry-once

**Modified function body (skeleton — implementor writes):**

```ts
async function callGeminiQuestion(args: {
  apiKey: string;
  systemPrompt: string;
  userTextBlock: string;
  collageUrl: string;
  tool: typeof Q2_TOOL;
}): Promise<{ aggregate: any; totalCostUsd: number; retried: boolean }> {
  const { apiKey, systemPrompt, userTextBlock, collageUrl, tool } = args;
  const { base64, mimeType } = await fetchAsBase64(collageUrl);
  const reqBody = { /* unchanged from current 907-939 */ };

  const MAX_MALFORMED_RETRIES = 1; // ORCH-0734 — retry-once on Gemini intermittent flake
  let attempt = 0;
  let totalCost = 0;
  let lastFinishReason: string | null = null;

  while (attempt <= MAX_MALFORMED_RETRIES) {
    attempt++;
    const { payload, usage } = await callGeminiWithRetry(apiKey, reqBody);
    totalCost += computeCostUsdGemini({
      promptTokens: usage.promptTokenCount,
      candidatesTokens: usage.candidatesTokenCount,
    });

    const candidates = payload?.candidates || [];
    if (candidates.length === 0) {
      throw new Error("Gemini returned no candidates");
    }
    const finishReason = candidates[0]?.finishReason || "unknown";
    const parts = candidates[0]?.content?.parts || [];
    const fnCallPart = parts.find(
      (p: { functionCall?: { name?: string } }) => p.functionCall?.name === tool.name,
    );

    if (fnCallPart?.functionCall?.args) {
      // Success.
      return {
        aggregate: fnCallPart.functionCall.args,
        totalCostUsd: totalCost,
        retried: attempt > 1,
      };
    }

    lastFinishReason = finishReason;
    // Only retry on MALFORMED_FUNCTION_CALL specifically.
    if (finishReason !== "MALFORMED_FUNCTION_CALL" || attempt > MAX_MALFORMED_RETRIES) {
      throw new Error(`Gemini returned no function_call for ${tool.name} (finishReason=${finishReason})`);
    }
    console.log(
      `[place-intel-trial] MALFORMED_FUNCTION_CALL retry attempt ${attempt + 1}/${MAX_MALFORMED_RETRIES + 1}`,
    );
    // Loop continues for retry.
  }

  throw new Error(`Gemini retry exhausted (finishReason=${lastFinishReason})`);
}
```

**Cost accounting:** `totalCost` accumulates across both attempts. Failed-call tokens ARE billed (Gemini bills for completion attempts). On retry success, `cost_usd` on the row reflects the combined cost (defensive cost reporting). On retry exhausted, error is thrown and row is marked failed; `cost_usd` is NOT written (existing failure-path behavior at lines 705-712 doesn't update cost).

### 6.5 `processOnePlace` retry_count update

When `callGeminiQuestion` returns `{retried: true}`, increment `retry_count`:

```ts
const { aggregate: q2, totalCostUsd: q2Cost, retried } = await callGeminiQuestion({...});

await db.from("place_intelligence_trial_runs").update({
  // ... existing fields ...
  retry_count: retried ? 1 : 0,
  cost_usd: +q2Cost.toFixed(6),
}).eq("run_id", runId).eq("place_pool_id", anchor.place_pool_id);
```

### 6.6 Removed code

- `handleStartRun` lines 615-619 (`signal_anchors` query) — replaced by §6.2 stratified sample.
- `handlePreviewRun` lines 346-349 (`signal_anchors` query) — replaced by §6.1 city query.
- `aggregateBySignal` helper (lines 368-379) — DELETE; no consumer post-rewrite.
- `MINGLA_SIGNAL_IDS` constant — KEEP (still used by `Q2_TOOL` schema; verify before deleting).
- Anthropic comment-preserved blocks: NO TOUCH per DEC-102.

### 6.7 New input validation

For `start_run` and `preview_run` actions, both must validate `city_id` is a valid uuid AND exists in `seeding_cities`. Specify explicit shape:

```ts
// city_id validation
if (!body.city_id || typeof body.city_id !== "string") {
  return json({ error: "city_id required (uuid)" }, 400);
}
const { data: city, error: cityErr } = await db
  .from("seeding_cities")
  .select("id, name")
  .eq("id", body.city_id)
  .maybeSingle();
if (cityErr || !city) {
  return json({ error: "city_id does not exist in seeding_cities" }, 400);
}

// sample_size validation
const sampleSizeRaw = body.sample_size ?? 200;
const sampleSize = Number.isInteger(sampleSizeRaw) ? sampleSizeRaw : NaN;
if (!Number.isInteger(sampleSize) || sampleSize < 50 || sampleSize > 500) {
  return json({ error: "sample_size must be integer 50-500 (default 200)" }, 400);
}
```

---

## 7. Admin layer

### 7.1 `TrialResultsTab.jsx` state additions

```jsx
const [cities, setCities] = useState([]);              // [{id, name, country, servable_count}]
const [cityId, setCityId] = useState(null);             // uuid string | null
const [sampleSize, setSampleSize] = useState(200);      // integer
// REMOVED: const [committedCount, setCommittedCount] = useState(0);
```

### 7.2 Initial cities load (replaces lines 226-248 `refresh()`)

```jsx
const refresh = useCallback(async () => {
  setLoading(true);
  try {
    // Cities with non-zero servable count
    const { data: cityRows, error: cityErr } = await supabase
      .from("seeding_cities")
      .select("id, name, country")
      .eq("status", "seeded")
      .order("name");
    if (cityErr) throw cityErr;

    // Servable counts per city (one round trip via aggregate)
    // Implementor: prefer a single SQL view or RPC for cleaner client query.
    // Inline acceptable for SPEC scope.
    const { data: counts, error: countsErr } = await supabase
      .from("place_pool")
      .select("city_id", { count: "exact" })
      .eq("is_servable", true);
    if (countsErr) throw countsErr;

    const countMap = new Map();
    for (const row of counts || []) {
      countMap.set(row.city_id, (countMap.get(row.city_id) || 0) + 1);
    }
    const enriched = (cityRows || [])
      .map((c) => ({ ...c, servable_count: countMap.get(c.id) || 0 }))
      .filter((c) => c.servable_count > 0);
    setCities(enriched);

    // Trial runs (existing query, unchanged)
    const { data, error } = await supabase
      .from("place_intelligence_trial_runs")
      .select("*, place:place_pool!place_pool_id(id, name, primary_type)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    setAllRows(data || []);
  } catch (err) {
    console.error("[TrialResultsTab] load failed:", err);
    addToast({ variant: "error", title: "Couldn't load results", description: err.message });
  } finally {
    setLoading(false);
  }
}, [addToast]);
```

**Performance note:** for large `place_pool` (~50K rows), pulling all servable city_ids client-side is acceptable but suboptimal. Implementor MAY create a Postgres view `cities_with_servable_count` and SELECT from it directly. SPEC allows either.

### 7.3 City picker UI (replaces section above "Run trial" button)

```jsx
{/* City picker — only cities with servable places */}
<div className="flex flex-col gap-2">
  <label htmlFor="city-picker" className="text-sm font-medium">
    City
  </label>
  <select
    id="city-picker"
    value={cityId || ""}
    onChange={(e) => setCityId(e.target.value || null)}
    disabled={running || preparing}
    className="..." // Tailwind v4 form control matching existing admin pattern (implementor pre-flight via /ui-ux-pro-max)
  >
    <option value="">Choose a city…</option>
    {cities.map((c) => (
      <option key={c.id} value={c.id}>
        {c.name} ({c.country}) — {c.servable_count} servable
      </option>
    ))}
  </select>
  {cities.length === 0 && !loading && (
    <p className="text-sm text-tertiary">
      No cities with servable places. Run the bouncer + seeder first.
    </p>
  )}
</div>

{/* Sample size — 50-500, default 200, step 50 */}
<div className="flex flex-col gap-2">
  <label htmlFor="sample-size" className="text-sm font-medium">
    Sample size
  </label>
  <input
    id="sample-size"
    type="number"
    min={50}
    max={500}
    step={50}
    value={sampleSize}
    onChange={(e) => setSampleSize(Math.max(50, Math.min(500, Number(e.target.value) || 200)))}
    disabled={running || preparing}
    className="..." // matching pattern
  />
  <p className="text-sm text-tertiary">
    Stratified random — top half by review_count + random fill of bottom half.
    Default 200 places · ~${(sampleSize * PER_PLACE_COST_USD).toFixed(2)} · ~{Math.ceil(sampleSize * 22 / 60)} min
  </p>
</div>
```

### 7.4 Run trial button + confirm dialog

Replace lines 335-347 logic:

```jsx
const selectedCity = cities.find((c) => c.id === cityId);
const effectiveSample = selectedCity ? Math.min(sampleSize, selectedCity.servable_count) : 0;
const estCost = (effectiveSample * PER_PLACE_COST_USD).toFixed(2);
const estMinutes = Math.ceil(effectiveSample * 22 / 60);

if (!cityId) {
  addToast({ variant: "warning", title: "Pick a city first" });
  isRunningRef.current = false;
  return;
}

if (!window.confirm(
  `About to run trial for ${effectiveSample} places sampled from ${selectedCity.name}, ${selectedCity.country} ` +
  `(${selectedCity.servable_count} servable total) using Gemini 2.5 Flash. ` +
  `Estimated cost ~$${estCost}, ~${estMinutes} minute wall time. ` +
  `Don't refresh the page during the run. Continue?`
)) {
  isRunningRef.current = false;
  return;
}
```

### 7.5 `start_run` invocation update

```jsx
const { data: created, error: startErr } = await invokeWithRefresh("run-place-intelligence-trial", {
  body: { action: "start_run", city_id: cityId, sample_size: sampleSize },
});
```

The browser loop body unchanged: iterate `created.anchors` calling `run_trial_for_place` per entry. Each entry has `{place_pool_id, signal_id: null}`; the `run_trial_for_place` body must omit signal_id/anchor_index OR pass null:

```jsx
const { data: result, error: e } = await invokeWithRefresh("run-place-intelligence-trial", {
  body: {
    action: "run_trial_for_place",
    run_id: runId,
    place_pool_id: a.place_pool_id,
    // signal_id and anchor_index omitted — city-runs places have no anchor metadata
  },
});
```

### 7.6 Progress label update

Line 382:
```jsx
setProgress((p) => ({ ...p, current: i + 1, currentPlace: a.place_pool_id.slice(0, 8) }));
```
Implementor MAY enrich currentPlace by looking up name in a cache. SPEC allows either.

### 7.7 Completion toast partial-success acknowledgement

Lines 404-408 update:

```jsx
const partialSuccess = succeeded > 0 && failed > 0;
addToast({
  variant: succeeded === effectiveSample ? "success" : (partialSuccess ? "warning" : "error"),
  title: `Trial complete`,
  description:
    `${succeeded} succeeded · ${failed} failed · cost ${formatCost(totalCost)}` +
    (failed > 0
      ? ` · Some failures expected from missing photos (~5-15%) or intermittent Gemini flakes.`
      : ""),
});
```

### 7.8 PER_PLACE_COST_USD adjustment

Line 206:
```jsx
const PER_PLACE_COST_USD = 0.0040; // ORCH-0734 — adjusted from 0.0038 per actual measurement on run e15f5d8f
```

### 7.9 SignalAnchorsTab.jsx deletion

DELETE: `mingla-admin/src/components/placeIntelligenceTrial/SignalAnchorsTab.jsx` (entire file, ~426 LOC).

Find parent that imports it (implementor: `grep -r "SignalAnchorsTab" mingla-admin/src/`):
- Identify the parent component (likely `PlaceIntelligenceTrialPage.jsx` or similar).
- Remove the import statement.
- Remove the tab entry from the tabs array.
- Verify no leftover references via final grep `signal_anchors\|SignalAnchorsTab`.

### 7.10 Removed code in TrialResultsTab.jsx

- `loadCommittedAnchors` function (lines 266-274) — DELETE
- `handlePrepareAll` lines 281-293 (committedCount check + `loadCommittedAnchors` call) — replace with city-aware sample fetch from `start_run` preview semantics OR call `start_run` action directly to get the place list (cleaner)
- `committedCount` state — DELETE

**Implementor decision:** SPEC author RECOMMENDS `handlePrepareAll` becomes a no-op for city-runs OR is repurposed to pre-call `start_run` to get the sample list THEN iterate prepare per place. If repurposed, the dialog flow becomes 1-button instead of 2-button. **Implementor MUST raise to orchestrator before deleting `handlePrepareAll` entirely** — losing prepare-then-run separation may degrade UX (operator can validate prepare success rate before paying for Gemini calls).

---

## 8. Test cases

| ID | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | City picker filters zero-servable | Load TrialResultsTab | Visible: London, Washington, Brussels, Raleigh, Baltimore, Lagos, Fort Lauderdale, Cary, Durham. Hidden: Berlin, Paris, NY, Barcelona, Chicago, Toronto, Dallas, Miami | Admin |
| T-02 | Sample-mode default flow | Pick Durham, leave sample 200, click Run | Loop iterates exactly 200 places; cost displayed ~$0.80; wall time ~73 min; `place_intelligence_trial_runs` rows count = 200; all rows have `city_id=Durham.id`, `signal_id=NULL`, `anchor_index=NULL` | Full stack |
| T-03 | Stratified sample correctness | Pick Durham, sample 100 | First 50 sampled IDs are top 50 places by `review_count DESC`; remaining 50 are random from rest. Verify by inspecting `start_run` response order vs DB query | Edge fn + DB |
| T-04 | Sample exceeds servable | Pick Durham (699 servable), request sample 500 | Run uses LEAST(500, 699) = 500; confirm dialog shows 500. (Edge case: pick a city with only 80 servable, request 200 — actual sample is 80) | Edge fn |
| T-05 | Sample size out of range | Set sample to 49 OR 501 | Edge fn returns 400 with "sample_size must be integer 50-500". Admin clamps client-side too. | Edge fn + Admin |
| T-06 | Idempotency — duplicate prevention | Run sample 50; manually re-call `run_trial_for_place` with same `(run_id, place_pool_id)` | UPSERT replaces existing row; `place_intelligence_trial_runs` count stays 50; row reflects latest call | Edge fn + DB |
| T-07 | Gemini retry-once happy path | Mock Gemini to return MALFORMED_FUNCTION_CALL on first call; success on retry | Row marked `completed`; `retry_count=1`; `cost_usd` reflects combined cost; console log shows retry message | Edge fn |
| T-08 | Gemini retry-once exhausted | Mock both attempts return MALFORMED_FUNCTION_CALL | Row marked `failed`; `error_message` contains "Gemini retry exhausted (finishReason=MALFORMED_FUNCTION_CALL)"; `retry_count=1` (incremented during retry attempt) | Edge fn |
| T-09 | `signal_anchors` table dropped | Run migration; query `SELECT * FROM signal_anchors` | Error: "relation signal_anchors does not exist" | DB |
| T-10 | Backup snapshot exists with 32 rows | Post-migration: `SELECT count(*) FROM _archive_orch_0734_signal_anchors` | Returns count matching pre-migration `signal_anchors` row count (expected 32 for the calibration set) | DB |
| T-11 | Trigger function dropped | `SELECT proname FROM pg_proc WHERE proname='tg_signal_anchors_set_updated_at'` | Empty result set | DB |
| T-12 | UNIQUE constraint enforced | `INSERT INTO place_intelligence_trial_runs (run_id, place_pool_id, status,...) VALUES (X, Y, 'pending',...)` twice with same X,Y | Second insert fails OR is silently UPSERTed if `onConflict` used. Test both raw INSERT (should fail) and UPSERT (should succeed-as-update) | DB |
| T-13 | `place_pool.city_id` FK enforced | After migration, `INSERT INTO place_pool (city_id) VALUES (gen_random_uuid())` with non-existent uuid | FK violation error | DB |
| T-14 | SignalAnchorsTab removed | Load admin Place Intelligence Trial section | Tab list shows N-1 tabs (no "Anchors" or similar entry); no console errors; no broken imports | Admin |
| T-15 | Legacy 32-anchor rows still display | Existing pre-migration `place_intelligence_trial_runs` rows | Render correctly in TrialResultsTab; model badge respects `model.startsWith("gemini")` per ORCH-0733 logic; NULL `city_id` displays as "(legacy anchor)" or similar | Admin |
| T-16 | New invariant established | Post-migration data: every NEW `place_intelligence_trial_runs` row has `city_id` non-null AND matches the joined `place_pool.city_id` | SQL probe `SELECT count(*) FROM place_intelligence_trial_runs r JOIN place_pool p ON p.id=r.place_pool_id WHERE r.created_at >= '2026-05-05' AND (r.city_id IS NULL OR r.city_id != p.city_id)` returns 0 | DB |
| T-17 | Confirm dialog accuracy | Pick Cary (820 servable), leave sample 200 | Dialog shows: "200 places sampled from Cary, United States (820 servable total)... ~$0.80, ~73 minute wall time" | Admin |
| T-18 | Photo-availability variance | Pick Durham, run sample 50 in dev | ≤15% of places fail prepare phase due to insufficient photos; toast acknowledges the partial-success | Full stack |
| T-19 | Cost guard trips on oversized sample | Edit `COST_GUARD_USD` to 1; pick Durham, sample 500 | Edge fn 400 with cost-guard error; admin shows toast | Edge fn |
| T-20 | Cities with zero servable hidden client-side | Manually craft a query with city_id of Berlin (0 servable) | `start_run` returns 400 ("No servable places in city"); admin client doesn't expose Berlin in dropdown anyway | Full stack |

---

## 9. Invariants

### 9.1 New invariant (orchestrator registers in `INVARIANT_REGISTRY.md`)

**`I-TRIAL-RUN-SCOPED-TO-CITY`** — Every `place_intelligence_trial_runs` row created on or after `2026-05-05` (ORCH-0734 migration date) MUST have:
- `city_id` non-null
- `city_id` equal to the `place_pool.city_id` of the row's `place_pool_id`

Legacy rows pre-ORCH-0734 keep `city_id=NULL` as audit-trail of the pre-city-runs scope; this is intentional and preserved.

**Test verification:** T-16 SQL probe runs in tester verification phase + recommended as pre-deployment CI gate (out of scope for this SPEC; future ORCH).

### 9.2 Preserved invariants (must NOT be violated)

- `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` — research-only output; no path from `place_intelligence_trial_runs` into `place_scores`/scoring/rerank. Implementor verifies by grep + SPEC reading: zero changes to scoring/bouncer/rerank code.
- `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER` — collage builder unchanged.
- `I-COLLAGE-SOLE-OWNER` — collage builder unchanged.
- `I-FIELD-MASK-SINGLE-OWNER` — Google Places field mask unchanged.
- `I-REFRESH-NEVER-DEGRADES` — no refresh path touched.
- `I-BOUNCER-DETERMINISTIC` — bouncer logic unchanged. `is_servable` filter relies on existing bouncer determination; SPEC introduces no new bouncer logic.
- `I-CATEGORY-SLUG-CANONICAL` — N/A this dispatch.

---

## 10. Implementation order

1. **Pre-flight: implementor runs `/ui-ux-pro-max`** for the city picker UX. Output: ≤200-word design recommendation for Tailwind v4 styling of `<select>` + `<input type="number">` + confirm dialog improvements. SPEC accepts the design recommendation as long as it preserves the SPEC's functional shape (city + sample-size inputs; confirm dialog with cost+time estimate).

2. **Pre-write decommission memory file** (DRAFT status):
   ```
   ~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_signal_anchors_decommissioned.md
   ```
   Frontmatter `type: feedback`, `status: DRAFT — flips to ACTIVE on ORCH-0734 CLOSE`. Body documents: deprecation rationale, replacement (city-runs), what to do when encountering references in active code (P0 flag), historical migrations (preserve audit trail), backup table `_archive_orch_0734_signal_anchors` (dead by design), 14-day retention reminder. Pattern from `feedback_ai_categories_decommissioned.md`.

3. **Database migration:**
   - Create `supabase/migrations/20260505000001_orch_0734_city_runs.sql` per §5.2
   - **DO NOT** invoke `mcp__supabase__apply_migration` from any tool. Operator deploys via `supabase db push`.

4. **Edge function rewrite:**
   - Edit `supabase/functions/run-place-intelligence-trial/index.ts` per §6
   - Verify all 14 specified spec-traceability checks (§6.1-6.7) hold
   - Commit but **do not deploy** until operator deploys migration first

5. **Admin UI rewrite:**
   - Edit `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` per §7
   - Delete `mingla-admin/src/components/placeIntelligenceTrial/SignalAnchorsTab.jsx`
   - Edit parent component (find via grep) to prune tab list
   - Run admin Vite build to verify no broken imports

6. **Implementor self-verification:**
   - Run a 50-place Cary or Durham sample sweep end-to-end in dev environment
   - Verify T-01, T-02, T-03, T-06, T-07 (or T-08), T-09, T-10, T-11, T-14, T-15, T-17 manually
   - Document results in implementation report

7. **Implementation report:**
   - Standard 15-section template per `mingla-implementor` SKILL `references/report-template.md`
   - Save to `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0734_CITY_RUNS_REPORT.md`
   - Include: Old → New receipts per file changed, F-8 alignment confirmation, retry-once observability proof, before/after sample sweep evidence

---

## 11. Pre-deployment probes (orchestrator runs after migration applies)

```sql
-- Verify F-3 cleanliness post-FK-add
SELECT count(*) FROM place_pool
WHERE city_id IS NOT NULL
  AND city_id NOT IN (SELECT id FROM seeding_cities);
-- Expected: 0

-- Verify backup snapshot integrity
SELECT count(*) FROM _archive_orch_0734_signal_anchors;
-- Expected: matches pre-migration signal_anchors row count

-- Verify trigger function dropped
SELECT proname FROM pg_proc WHERE proname = 'tg_signal_anchors_set_updated_at';
-- Expected: 0 rows

-- Verify UNIQUE constraint exists
SELECT conname FROM pg_constraint
WHERE conname = 'place_intelligence_trial_runs_run_place_unique';
-- Expected: 1 row

-- Verify new columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'place_intelligence_trial_runs'
  AND column_name IN ('city_id', 'retry_count');
-- Expected: 2 rows

-- Servable count per city (post-migration consistency)
SELECT sc.name, count(p.id) FILTER (WHERE p.is_servable=true) AS servable
FROM seeding_cities sc LEFT JOIN place_pool p ON p.city_id = sc.id
GROUP BY sc.name ORDER BY servable DESC;
-- Expected: matches the table from investigation §2 (London 3627, etc.)
```

---

## 12. Regression prevention

| Class | Safeguard |
|---|---|
| Future code re-discovers `signal_anchors` as live system | NEW memory file `feedback_signal_anchors_decommissioned.md` (orchestrator flips DRAFT→ACTIVE at CLOSE per Step 5a). MEMORY.md index entry per Step 5b. Existing memory file scan + skill definition reviews per Steps 5c-d. |
| Idempotency violation (duplicate rows) | UNIQUE constraint enforces schema-level guard. T-12 verifies. |
| MALFORMED_FUNCTION_CALL drops rows silently | Retry-once + `retry_count` + console.log + `error_message` JSON capture. T-07 + T-08 verify. |
| `place_pool.city_id` orphans | F-3 FK enforces. T-13 verifies. |
| Future researcher uses Anthropic again | DEC-102 + comment-preserved per Const #7 — no SPEC change here. |
| Operator forgets to clean up snapshot | 14-day retention reminder scheduled at CLOSE per orchestrator Step 5h. SQL DROP statement included in reminder. |
| Operator picks city with 0 servable | Filtered client-side (§7.2) AND server-side (§6.1). T-20 verifies. |
| Sample size out of range | Validated client-side (clamped) AND server-side (400 error). T-05 verifies. |
| Cost guard trips | Existing $5 guard. T-19 verifies (with synthetic guard reduction in test). |
| Photo availability variance surprises operator | Toast wording (§7.7) acknowledges expected partial-success. T-18 verifies. |

---

## 13. Success criteria (mandatory — 18 SCs, all observable + testable + unambiguous)

1. **SC-01:** After migration, `signal_anchors` table does NOT exist (T-09)
2. **SC-02:** After migration, `_archive_orch_0734_signal_anchors` table exists with row count matching pre-migration `signal_anchors` (T-10)
3. **SC-03:** After migration, `tg_signal_anchors_set_updated_at` function does NOT exist (T-11)
4. **SC-04:** After migration, `place_intelligence_trial_runs` has UNIQUE constraint `(run_id, place_pool_id)` (T-12)
5. **SC-05:** After migration, `place_intelligence_trial_runs` has `city_id uuid REFERENCES seeding_cities(id)` and `retry_count smallint NOT NULL DEFAULT 0`
6. **SC-06:** After migration, `place_pool` has FK `place_pool_city_id_fkey` to `seeding_cities(id) ON DELETE SET NULL` (T-13)
7. **SC-07:** After migration, `seeding_cities` table comment updated per §5.2 op 11
8. **SC-08:** Admin TrialResultsTab city picker shows ONLY cities with non-zero `place_pool.is_servable=true` (T-01)
9. **SC-09:** Admin city picker disabled while `running || preparing`
10. **SC-10:** Admin sample-size input clamps client-side to [50, 500]; default 200 (T-05)
11. **SC-11:** Edge fn `start_run` validates `city_id` exists + `sample_size` in [50, 500]; rejects with HTTP 400 otherwise (T-05, T-20)
12. **SC-12:** Edge fn `start_run` returns `effectiveSampleSize = LEAST(sample_size, totalServable)` (T-04)
13. **SC-13:** Stratified sampling: top half by `review_count DESC` + random fill of bottom half. Top-half ordering deterministic for same input; bottom-half random per call (T-03)
14. **SC-14:** Each city-run row has `city_id` non-null + matches `place_pool.city_id`; `signal_id=NULL`; `anchor_index=NULL` (T-02, T-16)
15. **SC-15:** Gemini `MALFORMED_FUNCTION_CALL` triggers ONE auto-retry with same body; success path increments `retry_count=1`; failure path throws after retry (T-07, T-08)
16. **SC-16:** `SignalAnchorsTab.jsx` deleted; parent component tab list pruned; admin Vite build succeeds with no broken imports (T-14)
17. **SC-17:** Legacy pre-ORCH-0734 rows in `place_intelligence_trial_runs` continue to render correctly in TrialResultsTab (T-15)
18. **SC-18:** Confirm dialog displays accurate city name + country + servable total + sample size + estimated cost (`sample_size × 0.0040`) + estimated wall time (`Math.ceil(sample_size × 22 / 60)` min) (T-17)

---

## 14. Estimated effort

| Layer | Effort |
|---|---|
| Migration SQL writing + review | 1.0 hour |
| Edge function rewrite + retry logic | 2.5 hours |
| Admin UI rewrite + SignalAnchorsTab deletion + parent prune | 2.5 hours |
| `/ui-ux-pro-max` pre-flight | 0.3 hours |
| Self-verification (50-place dev sweep) | 1.0 hour |
| Implementation report writing | 1.0 hour |
| Decommission memory file (DRAFT) | 0.3 hours |
| Buffer for unknowns (RPC vs view choice in §6.2; parent-tab grep finding) | 1.0 hour |
| **Total** | **~9.6 hours (1-day session)** |

---

## 15. Open questions for orchestrator

**Zero open questions.** All 7 operator decisions (Q1-Q7) are locked or defaulted with operator consent (Q6+Q7 confirmed via "d" response). F-8 verified. Schema deltas exhaustive. Edge fn skeletons specified. Admin UI shape complete. Test cases cover all SCs.

**One implementation-time judgment call** (NOT a blocker, but flagged for implementor awareness):
- §7.10 — `handlePrepareAll` keep-or-delete decision. SPEC author recommends KEEP repurposed to call `start_run` first then iterate prepare per place — preserves prepare-then-run UX separation. Implementor may DELETE and combine into single Run flow if they find a cleaner pattern. Implementor MUST raise to orchestrator before deleting; otherwise default to KEEP.

---

**End of SPEC. Binding for implementor dispatch.**

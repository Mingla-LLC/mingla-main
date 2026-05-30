# SPEC — META-ORCH-1009 Sub-A — `place_pool.ai_signal_scores` JSONB + DEC-099 invariant lift

**Mode:** Forensics SPEC (no implementation in this file)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-A-[ai-signal-scores-schema]/` on branch `META-ORCH-1009-Sub-A-ai-signal-scores-schema`
**Branched from main at:** `f560925c5`
**Author skill:** Claude `mingla-forensics`
**Date:** 2026-05-30
**Parent META-ORCH:** META-ORCH-1009 — wire Gemini Q2 evaluations into consumer deck ranking
**Sibling sub-dispatches (separate ORCHs):** Sub-B (signalScorer blend), Sub-C (Gemini coverage backfill), Sub-D (refresh cron + admin re-eval)
**Constitution / Comms acks:** COMMS-0003 (ALL) — external-API doc citations required for any edge-fn change; satisfied inline in §3.2 / §3.3.

---

## §1 Goal (plain English, one paragraph)

Sub-A lands the production storage surface for AI signal evaluations on `place_pool`, copies the 2,366 places already evaluated by the Gemini trial pipeline into that surface as a one-shot backfill, and extends the trial edge function so every new per-place Q2 completion writes both to the audit log (`place_intelligence_trial_runs.q2_response`, unchanged) AND to the new production column (`place_pool.ai_signal_scores`). The invariant that previously forbade production code from reading trial output (`I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING`) is retracted under the constitutional exception pre-authorised by DEC-099, replaced by two new invariants that constrain HOW the new column is owned (single-writer) and HOW Sub-B's ranker must consume it (prompt-version-discriminated). No user-visible change ships in Sub-A — this is pure plumbing that prepares Sub-B's consumer-ranker blend to be a one-file change.

---

## §2 Inputs (file/path inventory)

All paths are relative to the worktree root `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-A-[ai-signal-scores-schema]/`. Every path was verified to exist via the `Read` tool or `ls`.

### Migration (NEW)
- `supabase/migrations/20260802000003_meta_orch_1009_sub_a_ai_signal_scores.sql` — adds the new column, comment, GIN index, and the one-shot backfill from `place_intelligence_trial_runs.q2_response`. Estimated size: **~110 lines** (DDL ≈ 25 lines, comment ≈ 18 lines, backfill SQL ≈ 50 lines, self-verify probes ≈ 17 lines). Timestamp picked to land immediately after the last committed migration on main (`20260802000002_orch_1006_finalize_copy_pricing_breakdown.sql`) plus three seconds for safety; final number to be re-checked by the implementor against `ls supabase/migrations/ | tail -3` at apply time per `spawn.sh` collision-detection (COMMS-0004).

### Edge function (EDIT)
- `supabase/functions/run-place-intelligence-trial/index.ts` — extends `processOnePlace` (the per-place Q2 worker invoked by `handleRunTrialForPlace`, by `runPrepIteration`, and by every other parallel-batch caller) to issue a SECOND `db.from('place_pool').update({ ai_signal_scores: <slice> })` immediately after the existing `place_intelligence_trial_runs` row update succeeds. Touch window: **~30 lines added** (one helper `buildAiSignalScoresSlice` + the new update call + a per-place try/catch that does NOT fail the trial row if the secondary write fails — see §3.2 atomicity decision). The two writes are non-atomic by design (no two-table transaction); the trial row is the SOURCE OF TRUTH and the secondary `place_pool` write is treated as a derived materialisation. If the secondary write fails, the row stays in the trial log and the implementor's backfill SQL (re-runnable as an idempotent UPSERT pattern via `jsonb_set`) catches the laggard on next sweep.

### Invariant registry (EDIT)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — flip `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` to RETRACTED with retraction date 2026-05-30 + pointer to DEC-099 (pre-authorisation) + pointer to this Sub-A close + pointer to the two replacement invariants. Add three new invariant bodies: `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` (ACTIVE on Sub-A merge), `I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED` (DRAFT on Sub-A merge → ACTIVE on Sub-B's ranker landing), and `I-AI-SIGNAL-SCORES-SHAPE-CONTRACT` (ACTIVE on Sub-A merge — pins the per-signal JSONB shape so future writers cannot drift it). Insert under a new `## ACTIVE (post META-ORCH-1009 Sub-A CLOSE)` section header at the top of the ACTIVE block. Verbatim bodies in §3.4.

### Decision log (EDIT)
- `Mingla_Artifacts/DECISION_LOG.md` — append `DEC-181` (next available; max existing = DEC-180 per `grep -oE "DEC-[0-9]+" | sort -V | tail`) recording: column landed under META-ORCH-1009 Sub-A under DEC-099 pre-authorisation; column name `ai_signal_scores` (NOT DEC-099's tentative `claude_signal_evaluations`) because the trial pipeline ships on Gemini 2.5 Flash, not Claude (operator lock-in 2026-05-30 per memory rule [[mingla-brain-post-mechanical-ads]] which routes AI-vendor decisions through the operator); pointer back to DEC-099 as the constitutional bless; pointer forward to Sub-B / Sub-C / Sub-D scopes.

### Reference reads (no edits required — context only)
- `Mingla_Artifacts/research/RESEARCH_EXPERIENCE_PIPELINE_TO_CONSUMER_DECK.md` §5 Option A — the architectural blueprint this sub implements (lines 145–164 of the research doc).
- `Mingla_Artifacts/DECISION_LOG.md` line 93 (DEC-099 body) — pre-authorisation of the column under the constitutional exception to the no-stored-interpretations rule.
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` line 1234 — the registry mention of `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` that this sub retracts.
- `Mingla_Artifacts/specs/SPEC_ORCH-0712_TRIAL_INTELLIGENCE.md` — establishes the `q2_response` shape (`evaluations[]` with `signal_id`, `score_0_to_100`, `inappropriate_for`, `reasoning`) that this sub copies into the new column slice.
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` — sample `place_pool` ALTER + index conventions (DDL pattern, GIN index naming `idx_place_pool_*`).

### Live DB probes performed during spec write (Supabase Management API, 2026-05-30)
- `place_intelligence_trial_runs.q2_response` shape — confirmed: top-level `{evaluations: [{signal_id, score_0_to_100, inappropriate_for, reasoning}, ...]}`. Sample row from CAVA showed all 16 signals filled. (Probe attached as Exhibit A at end of spec.)
- Total completed Q2 rows: **2,663** (status='completed' AND q2_response IS NOT NULL).
- Completed Q2 rows at prompt_version='v4' (current production version): **2,525**.
- Distinct `place_pool_id`s covered by ANY completed Q2 (the backfill row count): **2,366**.
- Distinct `place_pool_id`s covered by v4-only Q2: **2,366** (older v1/v2/v3 rows are subsets of the v4 place set).
- Distinct prompt versions in the trial log: **4** (`v1`, `v2`, `v3`, `v4`). Backfill uses the LATEST completed row per (place, signal) regardless of version, because earlier versions are still useful when v4 has not yet covered a given place — Sub-B's prompt-version invariant gates downstream read.
- `place_scores` rows (existing rule-based ranker corpus Sub-B will blend against): **225,924** rows across **14,412** distinct places × **16** distinct signals.
- Column `place_pool.ai_signal_scores` does NOT exist today (confirmed via information_schema). Column `place_pool.photo_aesthetic_data` (DEC-099 Cut 1 decommission candidate, 30 rows) still exists — NOT in scope for Sub-A drop; flagged for a future cleanup ORCH (see §6).
- No file under `app-mobile/src/` or `supabase/functions/discover-cards/` or `supabase/functions/_shared/` reads `place_intelligence_trial_runs`; only one test-error-message string mentions it (`supabase/functions/_shared/placeIntelRetryCoverage.test.ts:20`). Confirms the retracted invariant has had ZERO production violations — retraction is constitutionally clean.

---

## §3 Contracts per work item

### §3.1 Column shape (LOCKED)

**DDL (verbatim — goes in the migration §3.3):**

```sql
ALTER TABLE public.place_pool
  ADD COLUMN ai_signal_scores JSONB;

COMMENT ON COLUMN public.place_pool.ai_signal_scores IS
  'Per-signal Gemini Q2 evaluations keyed by signal_id. Shape:
   {<signal_id>: {score_0_to_100: int, inappropriate_for: bool,
                  reasoning: text, evaluated_at: timestamptz,
                  prompt_version: text, model: text}, ...}.
   Written by run-place-intelligence-trial.processOnePlace on per-place
   Q2 completion (sole writer — I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER).
   Read by consumer ranker (Sub-B). Constitutionally blessed by DEC-099
   (renamed claude_signal_evaluations -> ai_signal_scores per
   operator Gemini-not-Claude lock-in 2026-05-30, DEC-181). Replaces
   I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING (RETRACTED at Sub-A close).';

CREATE INDEX idx_place_pool_ai_signal_scores
  ON public.place_pool
  USING gin (ai_signal_scores jsonb_path_ops);
```

**JSONB shape (verbatim, 3-signal example):**

```json
{
  "fine_dining": {
    "score_0_to_100": 5,
    "inappropriate_for": false,
    "reasoning": "CAVA is a fast-casual Mediterranean restaurant with a moderate price point and simple decor, lacking the upscale ambiance, service, or menu associated with fine dining.",
    "evaluated_at": "2026-05-30T18:00:00.000Z",
    "prompt_version": "v4",
    "model": "gemini-2.5-flash"
  },
  "brunch": {
    "score_0_to_100": 0,
    "inappropriate_for": true,
    "reasoning": "The place metadata explicitly states 'serves_brunch: false' and 'serves_breakfast: false', indicating it does not structurally offer brunch despite opening at 10:30 AM.",
    "evaluated_at": "2026-05-30T18:00:00.000Z",
    "prompt_version": "v4",
    "model": "gemini-2.5-flash"
  },
  "casual_food": {
    "score_0_to_100": 95,
    "inappropriate_for": false,
    "reasoning": "CAVA's core identity is a casual Mediterranean restaurant offering customizable bowls and pitas at a moderate price.",
    "evaluated_at": "2026-05-30T18:00:00.000Z",
    "prompt_version": "v4",
    "model": "gemini-2.5-flash"
  }
}
```

**Type constraints (LOCKED):**
- Top-level is a JSON object (NOT array). Keys are signal IDs from `signal_definitions.id` (text); MUST be in the canonical 16-signal set per the live row count probe.
- Per-signal value is a JSON object with EXACTLY these 6 keys: `score_0_to_100` (integer 0–100), `inappropriate_for` (boolean), `reasoning` (text, non-empty), `evaluated_at` (ISO-8601 timestamp string), `prompt_version` (text, non-empty), `model` (text, non-empty).
- NO `null` values allowed inside the per-signal object — if a signal was not evaluated for this place, the KEY is absent entirely (read pattern: `ai_signal_scores ? signal_id` for existence check).
- Column itself is NULLABLE at the row level — a place row with no Gemini coverage yet has `ai_signal_scores = NULL` (NOT `{}`). Sub-B's ranker SHOULD treat NULL and missing-key identically (fall back to rule scorer).

**Index choice (LOCKED):** GIN with `jsonb_path_ops` opclass, NOT default `jsonb_ops`. Rationale (see §7 Decision 2): Sub-B's hot-path queries will be of the form `WHERE ai_signal_scores ? 'romantic'` (key-exists test) or `WHERE ai_signal_scores @> '{"romantic": {"inappropriate_for": true}}'` (containment test for veto pre-filtering). `jsonb_path_ops` indexes these two operator classes ~3× faster and is ~30% smaller than `jsonb_ops` because it only indexes path-leaf-value pairs (per the [Postgres 17 JSONB Indexing docs](https://www.postgresql.org/docs/17/datatype-json.html#JSON-INDEXING) — verified 2026-05-30). Sub-B does NOT need the full operator family (`?|`, `?&` array existence) that `jsonb_ops` provides. Index name follows the established `idx_place_pool_*` pattern (10 existing such indexes in baseline migration).

### §3.2 Edge function write path (LOCKED — pseudo-code below is binding contract)

**File:** `supabase/functions/run-place-intelligence-trial/index.ts`
**Function:** `processOnePlace` (line ~1324)
**Insertion point:** Immediately after the existing `place_intelligence_trial_runs` UPDATE that sets `status: "completed", q2_response: q2, ...` succeeds (current line ~1499 `if (updateErr) throw ...`), and BEFORE the `finalDiagnostics` timing-only second update (current line ~1503).

**Verbatim pseudo-code (the implementor copies this shape; comments survive in the shipped code):**

```ts
// META-ORCH-1009 Sub-A — mirror Q2 slice into place_pool.ai_signal_scores
// for the production ranker (Sub-B reads it). Trial row is source of truth;
// this is a DERIVED materialisation. If it fails we log + continue — the
// implementor's backfill SQL is idempotent and re-runnable to catch
// laggards. Constitutionally blessed by DEC-099 (column) + DEC-181 (name).
// Sole-writer invariant: I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER.
//
// Gemini Q2 shape ref (q2.evaluations[]): per
// https://ai.google.dev/api/generate-content#function_calling (verified
// 2026-05-30) — the toolCall arg payload returned by Gemini's function-
// calling mode is parsed in callGeminiQuestion() upstream; q2.evaluations
// is a plain JS array of { signal_id, score_0_to_100, inappropriate_for,
// reasoning } objects.
try {
  const aiSignalScoresSlice = buildAiSignalScoresSlice(
    q2.evaluations,
    completedAt,
    PROMPT_VERSION,
    GEMINI_MODEL_NAME_SHORT,
  );
  if (aiSignalScoresSlice && Object.keys(aiSignalScoresSlice).length > 0) {
    const { error: ppErr } = await db
      .from("place_pool")
      .update({ ai_signal_scores: aiSignalScoresSlice })
      .eq("id", anchor.place_pool_id);
    if (ppErr) {
      console.error(
        `[place-intel-trial:ai_signal_scores_write_failed] place=${anchor.place_pool_id} err=${ppErr.message}`,
      );
      // Non-fatal: trial row still completed; backfill sweep will recover.
    }
  }
} catch (sliceErr) {
  console.error(
    `[place-intel-trial:ai_signal_scores_slice_failed] place=${anchor.place_pool_id} err=${sliceErr instanceof Error ? sliceErr.message : String(sliceErr)}`,
  );
  // Non-fatal.
}
```

**Helper (verbatim contract — implementor adds at top of file near other helpers):**

```ts
// META-ORCH-1009 Sub-A — slice the Q2 aggregate response into the JSONB
// shape required by place_pool.ai_signal_scores. Pure function (no I/O);
// tested by Deno unit test (see §4 acceptance tests).
//
// Input: q2.evaluations (Q2_TOOL output shape; pinned by Q2_TOOL function
// declaration in this file — Gemini function-calling tool schema).
// Output: { signal_id: { score_0_to_100, inappropriate_for, reasoning,
// evaluated_at, prompt_version, model } } per I-AI-SIGNAL-SCORES-SHAPE-CONTRACT.
//
// Defensive: skips evaluations missing required fields (logs + drops);
// returns {} if input is null/undefined/empty array.
function buildAiSignalScoresSlice(
  evaluations: ReadonlyArray<{
    signal_id: string;
    score_0_to_100: number;
    inappropriate_for: boolean;
    reasoning: string;
  }> | null | undefined,
  evaluatedAtIso: string,
  promptVersion: string,
  modelName: string,
): Record<string, {
  score_0_to_100: number;
  inappropriate_for: boolean;
  reasoning: string;
  evaluated_at: string;
  prompt_version: string;
  model: string;
}> {
  if (!evaluations || evaluations.length === 0) return {};
  const out: Record<string, {
    score_0_to_100: number;
    inappropriate_for: boolean;
    reasoning: string;
    evaluated_at: string;
    prompt_version: string;
    model: string;
  }> = {};
  for (const ev of evaluations) {
    if (
      !ev ||
      typeof ev.signal_id !== "string" || ev.signal_id.length === 0 ||
      typeof ev.score_0_to_100 !== "number" ||
      typeof ev.inappropriate_for !== "boolean" ||
      typeof ev.reasoning !== "string" || ev.reasoning.length === 0
    ) {
      console.warn(
        `[place-intel-trial:ai_signal_scores_skip_malformed_eval] signal=${ev?.signal_id ?? "<missing>"}`,
      );
      continue;
    }
    out[ev.signal_id] = {
      score_0_to_100: Math.max(0, Math.min(100, Math.round(ev.score_0_to_100))),
      inappropriate_for: ev.inappropriate_for,
      reasoning: ev.reasoning,
      evaluated_at: evaluatedAtIso,
      prompt_version: promptVersion,
      model: modelName,
    };
  }
  return out;
}
```

**External API docs cited (COMMS-0003):**
- Gemini 2.5 Flash function-calling output shape: https://ai.google.dev/api/generate-content#function_calling (verified 2026-05-30).
- Gemini 2.5 Flash model identity / pricing: https://ai.google.dev/pricing/gemini-2-5-flash (already cited in the edge fn at lines 1092 + 2224 + 2277).

**Concurrency model (LOCKED):** Whole-column-replace (NOT per-signal `jsonb_set` upsert). Each `processOnePlace` invocation evaluates ALL 16 signals for a single place in one Q2 call; the slice it writes IS the full per-place picture. If two parallel trial runs evaluate the same place on different prompt versions, last-write-wins at the WHOLE-COLUMN level — the loser's full evaluation set is discarded. This is acceptable because (a) per-place Q2 is admin-triggered, not user-triggered, so concurrent evaluations of the SAME place are rare (the trial-run sampling path explicitly excludes places already covered in the same city_run — see edge fn line ~1054 `.eq("status", "completed")`); (b) when they do happen, the latest prompt version is the most-recent operator intent; (c) per-signal merging via `jsonb_set` would only matter if different evaluations covered disjoint signal subsets, but Q2 always covers all 16. Per-signal upsert can be revisited in a later ORCH if (a) flips false.

### §3.3 Backfill SQL (LOCKED — verbatim)

The migration includes this one-shot UPDATE that runs once on apply and never again (idempotent — re-running produces zero changes because the source rows are unchanged and the WHERE clause re-derives the same `latest_per_place` set):

```sql
-- META-ORCH-1009 Sub-A — One-shot backfill from existing trial Q2 evaluations.
-- Expected effect on prod (2026-05-30 live probe): 2,366 place_pool rows updated.
-- Rationale: bring the new column to parity with the 2.6 years of admin trial
-- runs so Sub-B's ranker has coverage on day one. Idempotent (re-running on a
-- DB where some rows already have ai_signal_scores produces the same final
-- state — the source-of-truth trial rows are immutable).

WITH latest_q2_per_place AS (
  SELECT DISTINCT ON (pir.place_pool_id)
    pir.place_pool_id,
    pir.q2_response,
    pir.completed_at,
    pir.prompt_version,
    pir.model
  FROM public.place_intelligence_trial_runs pir
  WHERE pir.status = 'completed'
    AND pir.q2_response IS NOT NULL
    AND pir.q2_response ? 'evaluations'
    AND jsonb_typeof(pir.q2_response -> 'evaluations') = 'array'
    AND jsonb_array_length(pir.q2_response -> 'evaluations') > 0
  ORDER BY pir.place_pool_id, pir.completed_at DESC NULLS LAST
),
sliced AS (
  SELECT
    l.place_pool_id,
    jsonb_object_agg(
      (ev ->> 'signal_id'),
      jsonb_build_object(
        'score_0_to_100',
          GREATEST(0, LEAST(100, ROUND((ev ->> 'score_0_to_100')::numeric)::int)),
        'inappropriate_for', (ev ->> 'inappropriate_for')::boolean,
        'reasoning',         ev ->> 'reasoning',
        'evaluated_at',      COALESCE(
                               to_char(l.completed_at AT TIME ZONE 'UTC',
                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                               '1970-01-01T00:00:00.000Z'
                             ),
        'prompt_version',    COALESCE(l.prompt_version, 'unknown'),
        'model',             COALESCE(l.model, 'gemini-2.5-flash')
      )
    ) AS ai_signal_scores
  FROM latest_q2_per_place l,
       LATERAL jsonb_array_elements(l.q2_response -> 'evaluations') AS ev
  WHERE ev ? 'signal_id'
    AND ev ? 'score_0_to_100'
    AND ev ? 'inappropriate_for'
    AND ev ? 'reasoning'
    AND (ev ->> 'signal_id') <> ''
    AND (ev ->> 'reasoning')  <> ''
  GROUP BY l.place_pool_id
)
UPDATE public.place_pool pp
SET ai_signal_scores = s.ai_signal_scores
FROM sliced s
WHERE pp.id = s.place_pool_id
  AND (pp.ai_signal_scores IS NULL
       OR pp.ai_signal_scores IS DISTINCT FROM s.ai_signal_scores);
```

**Post-backfill self-verify probes (in same migration, raise NOTICE on counts):**

```sql
DO $$
DECLARE
  v_backfilled_count int;
  v_expected_count int := 2366;  -- live probe 2026-05-30
  v_trial_completed int;
BEGIN
  SELECT COUNT(*) INTO v_backfilled_count
    FROM public.place_pool WHERE ai_signal_scores IS NOT NULL;
  SELECT COUNT(DISTINCT place_pool_id) INTO v_trial_completed
    FROM public.place_intelligence_trial_runs
    WHERE status='completed' AND q2_response IS NOT NULL
      AND q2_response ? 'evaluations';
  RAISE NOTICE '[META-ORCH-1009 Sub-A backfill] place_pool.ai_signal_scores rows: %', v_backfilled_count;
  RAISE NOTICE '[META-ORCH-1009 Sub-A backfill] source trial completed-distinct-places: %', v_trial_completed;
  -- Soft assertion: backfilled count should equal source distinct-places.
  -- Drift > 5% indicates malformed evaluations were dropped — investigate.
  IF v_trial_completed > 0
     AND ABS(v_backfilled_count - v_trial_completed)::float / v_trial_completed > 0.05 THEN
    RAISE WARNING '[META-ORCH-1009 Sub-A backfill] drift > 5%% (backfilled=%, source=%)',
      v_backfilled_count, v_trial_completed;
  END IF;
END $$;
```

The hardcoded `v_expected_count := 2366` is a documentation hint — the live RAISE WARNING fires on the LIVE distinct-place count vs the live backfill count, so the migration stays correct if the prod numbers drift between spec-write and apply.

### §3.4 Invariant updates (LOCKED — verbatim bodies)

**Retraction of the OLD invariant.** Edit `Mingla_Artifacts/INVARIANT_REGISTRY.md` line 1234 (the registry-mention) AND, more importantly, surface the retraction as its own section in the RETRACTED area. The existing line is currently only a cross-reference — there is no full body section for it. Add one, then mark it RETRACTED:

```markdown
## RETRACTED (post META-ORCH-1009 Sub-A CLOSE — 2026-05-30)

### I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING — RETRACTED 2026-05-30 per DEC-099 + DEC-181

**Original statement (preserved for audit):** "Trial pipeline output stored
in `place_intelligence_trial_runs` MUST NOT be read by production scoring /
ranking surfaces. The trial table is admin-evaluation only; production rerank
reads `place_scores`."

**Original rationale:** the trial schema was research-grade and not bound by
any production contract; allowing the ranker to read it would have coupled
deck behaviour to ad-hoc admin experimentation.

**Retraction rationale:** DEC-099 (2026-05-04) pre-authorised the
constitutionally-blessed exception — a single JSONB column on `place_pool`
(originally proposed as `claude_signal_evaluations`, renamed to
`ai_signal_scores` per DEC-181 since Gemini, not Claude, is the trial-
pipeline provider) that production code IS allowed to read. The old
invariant guarded the trial TABLE; the new exception is a SEPARATE COLUMN
ON A DIFFERENT TABLE (`place_pool.ai_signal_scores`) whose write path is
constrained by `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` and whose shape is
pinned by `I-AI-SIGNAL-SCORES-SHAPE-CONTRACT`. Production code STILL must
not read `place_intelligence_trial_runs` directly — that part of the old
invariant survives, just folded into `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER`.

**Replacement invariants:**
- `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` (ACTIVE post Sub-A close)
- `I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED` (DRAFT post Sub-A close
  → ACTIVE on Sub-B's ranker landing)
- `I-AI-SIGNAL-SCORES-SHAPE-CONTRACT` (ACTIVE post Sub-A close)

**Cross-references:** DEC-099 · DEC-181 · META-ORCH-1009 Sub-A close · the
three replacement invariants below.
```

**NEW invariant 1 (ACTIVE on Sub-A merge):**

```markdown
## ACTIVE (post META-ORCH-1009 Sub-A [ai-signal-scores schema] CLOSE 2026-05-30)

### I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER — Only `run-place-intelligence-trial.processOnePlace` writes `place_pool.ai_signal_scores`

**Statement:** `public.place_pool.ai_signal_scores` is written by EXACTLY
ONE code path — `processOnePlace` in
`supabase/functions/run-place-intelligence-trial/index.ts` — plus the
one-shot backfill in migration
`20260802000003_meta_orch_1009_sub_a_ai_signal_scores.sql`. No other edge
function, no RPC, no admin action, no migration, no manual SQL ad-hoc
write may set this column. Reads are unrestricted (Sub-B ranker is the
primary consumer; admin inspector is a secondary consumer).

**Authority:** The column comment (set in the §3.1 DDL) names
`processOnePlace` as the sole writer.

**Rationale:** Single-writer guarantees shape consistency
(I-AI-SIGNAL-SCORES-SHAPE-CONTRACT cannot drift), prompt-version honesty
(I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED can trust the stored
prompt_version field), and a single audit log (the trial-run row carries
the full evaluation context the column slice was derived from).

**Enforcement (2 gates):**
1. **Strict-grep CI gate** (NEW, ships with Sub-A) — `.github/scripts/strict-grep/meta-orch-1009-sub-a-ai-signal-scores-sole-owner.mjs` greps the repo for any `.update({` block containing `ai_signal_scores` outside the allowed paths (`supabase/functions/run-place-intelligence-trial/index.ts` AND `supabase/migrations/20260802000003_*.sql`). Failure = CI red.
2. **Column comment** — readable in any psql `\d+ place_pool` inspection; serves as in-DB documentation that survives code-grep evasion.

**Test that catches a regression:** any new code path that writes to
`ai_signal_scores` from outside the allowed paths trips the strict-grep
gate at PR-build time. Manual psql writes are caught at runtime by the
shape-contract gate (I-AI-SIGNAL-SCORES-SHAPE-CONTRACT) the first time
Sub-B reads them.

**Established:** 2026-05-30 by META-ORCH-1009 Sub-A CLOSE.

**Related invariants:**
- I-AI-SIGNAL-SCORES-SHAPE-CONTRACT (sibling — shape gate)
- I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED (sibling — read gate)
- I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING (RETRACTED predecessor)
```

**NEW invariant 2 (ACTIVE on Sub-A merge):**

```markdown
### I-AI-SIGNAL-SCORES-SHAPE-CONTRACT — `place_pool.ai_signal_scores` follows the canonical 6-field per-signal shape

**Statement:** Every non-null value of `place_pool.ai_signal_scores` is a
JSON object keyed by signal_id (∈ the 16 canonical signal IDs from
`signal_definitions`). Each per-signal value is a JSON object with
EXACTLY these 6 keys: `score_0_to_100` (integer 0–100),
`inappropriate_for` (boolean), `reasoning` (non-empty text),
`evaluated_at` (ISO-8601 timestamp string), `prompt_version` (non-empty
text), `model` (non-empty text). No additional keys. No null values inside
the per-signal object. If a signal was not evaluated for a place, the key
is absent (not null).

**Authority:** the §3.2 helper `buildAiSignalScoresSlice` and the §3.3
backfill SQL are the two producers; both produce this shape exactly.
The column comment (§3.1) is the in-DB statement of the contract.

**Rationale:** Sub-B's ranker reads the column with `Object.keys()` and a
narrow per-signal type assertion; any drift in shape breaks the ranker
silently. Pinning the shape here means Sub-B does NOT need defensive
shape-validation at read time — it can trust the contract.

**Enforcement (2 gates):**
1. **Producer-side TypeScript** — `buildAiSignalScoresSlice` return type
   (§3.2 verbatim) is the locked TS signature; any future producer must
   import this helper or replicate the type. The Deno unit test (§4.3)
   pins the produced shape against a JSON-schema-style assertion.
2. **Migration-time CHECK constraint (DEFERRED to Sub-B):** Sub-B may add
   a `CHECK (ai_signal_scores IS NULL OR (...jsonb structure assertion...))`
   constraint once it has empirical evidence on shape stability. Not added
   in Sub-A because the backfill writes ~2,366 rows that have NOT been
   shape-validated yet (the slice SQL drops malformed evaluations but does
   not deeply validate them).

**Test that catches a regression:** the Deno unit test in §4.3 asserts the
exact 6-key shape against a fake Q2 input. Any future producer that omits
or adds a field fails the test.

**Established:** 2026-05-30 by META-ORCH-1009 Sub-A CLOSE.

**Related invariants:** I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER · I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED
```

**NEW invariant 3 (DRAFT on Sub-A merge, ACTIVE on Sub-B landing):**

```markdown
### I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED — Consumer ranker checks prompt_version before reading AI score

**Status:** DRAFT (post META-ORCH-1009 Sub-A close 2026-05-30). Flips to
ACTIVE on Sub-B's ranker landing (the ranker is the enforcement surface;
the invariant is documented now so Sub-B implementor inherits the
contract).

**Statement:** The consumer-ranker code path (`supabase/functions/_shared/
signalScorer.ts` or its successor, per Sub-B SPEC) MUST check the
per-signal `prompt_version` field in `place_pool.ai_signal_scores` against
the current expected prompt version (sourced from a single canonical
constant — Sub-B SPEC pins WHERE — likely
`signal_definition_versions.config.expected_prompt_version` or a hard-
coded `EXPECTED_PROMPT_VERSION` in `_shared/signalScorer.ts`). On mismatch,
the AI score for that signal MUST be treated as null and the ranker MUST
fall back to the rule scorer alone (no blend) for that (place, signal)
pair.

**Rationale:** Prompt drift is silent. A V5 prompt with re-tuned scoring
thresholds will produce scores on a different scale than V4 — blending V4
scores into a V5-aware ranker silently corrupts the deck. Discriminating
at READ time means the system fails CLOSED (rule-scorer baseline)
rather than fails OPEN (degraded blend).

**Authority (to be set on Sub-B close):** `supabase/functions/_shared/
signalScorer.ts` — Sub-B SPEC §3.X (TBD).

**Enforcement (gates to be set on Sub-B close):**
1. Sub-B unit test on the ranker — feed AI evaluations stamped `v3` and
   `v4` with `EXPECTED_PROMPT_VERSION='v4'`; assert v3 entries are
   ignored and v4 entries are blended.
2. Sub-B integration test — feed a mixed-prompt place row through the
   full ranker; assert the v3 signals produce the same score as if AI
   scores were absent.

**Test that catches a regression:** Sub-B unit test above.

**Established:** 2026-05-30 by META-ORCH-1009 Sub-A SPEC (as DRAFT);
target ACTIVE on Sub-B close.

**Related invariants:** I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER · I-AI-SIGNAL-SCORES-SHAPE-CONTRACT
```

---

## §4 Acceptance tests per work item

### §4.1 Migration acceptance

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| M-01 | Column exists with correct type + nullability | Post-apply `\d+ place_pool` | `ai_signal_scores jsonb` (nullable) present | Schema |
| M-02 | GIN index exists | `\di idx_place_pool_ai_signal_scores` | Index present, `USING gin (... jsonb_path_ops)` | Schema |
| M-03 | Column comment present | `\d+ place_pool` | Comment matches §3.1 verbatim | Schema |
| M-04 | Backfill row count matches live distinct-Q2-place count | `SELECT COUNT(*) FROM place_pool WHERE ai_signal_scores IS NOT NULL;` | Equal to `SELECT COUNT(DISTINCT place_pool_id) FROM place_intelligence_trial_runs WHERE status='completed' AND q2_response IS NOT NULL AND q2_response ? 'evaluations';` (live = 2,366) | Data |
| M-05 | Backfill spot-check — CAVA fine_dining | Pick `place_pool.id` of CAVA (Exhibit A); compare `ai_signal_scores->'fine_dining'->>'score_0_to_100'` to source `q2_response->'evaluations'` for that place | Equal (5) | Data |
| M-06 | Backfill spot-check — brunch veto preserved | Same CAVA row, `ai_signal_scores->'brunch'->>'inappropriate_for'` | `true` | Data |
| M-07 | Backfill spot-check — 3rd random place | Pick any 3rd place at random from backfilled rows; assert each per-signal entry in `ai_signal_scores` matches the latest `place_intelligence_trial_runs` row for that place | Equal across all 16 signals | Data |
| M-08 | Idempotency — second apply produces zero changes | Re-run the migration's UPDATE statement on a fully-backfilled DB | `0 rows updated` (the `IS DISTINCT FROM` guard short-circuits) | Schema |
| M-09 | Malformed evaluations dropped, not crashed | If any trial row has a malformed `evaluations[i]` missing `reasoning`, backfill skips that signal but keeps the others | Backfill completes; missing signal absent in resulting JSONB | Data |

### §4.2 Edge function acceptance

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| E-01 | New Q2 run completes, place_pool.ai_signal_scores written | Trigger a fresh trial run on one place via admin UI; query `ai_signal_scores` for that place after completion | Non-null; matches `q2_response.evaluations` slice exactly (6-field shape per signal) | Full edge + DB |
| E-02 | Secondary write failure does NOT fail trial row | Mock the `db.from('place_pool').update(...)` to return an error; verify the trial row is still status='completed' and the error is logged | Trial row completes; `[place-intel-trial:ai_signal_scores_write_failed]` console.error fires; no exception thrown | Edge fn |
| E-03 | Malformed evaluations skipped, not crashed | Feed `processOnePlace` a Q2 response with one evaluation missing `reasoning`; assert the resulting JSONB has 15 keys not 16 (skipped signal absent), and `[ai_signal_scores_skip_malformed_eval]` warn fires | 15-key JSONB; warning logged | Edge fn unit |
| E-04 | `buildAiSignalScoresSlice` shape contract | Deno unit test (see §4.3) | All 6 fields present per signal; no extras | Edge fn unit |
| E-05 | Empty / null `evaluations` returns `{}` | Pass `null` and `[]` to the helper | `{}` (NOT thrown, NOT null) | Edge fn unit |
| E-06 | `score_0_to_100` clamping | Pass `score_0_to_100=-5` and `score_0_to_100=150` | Clamped to `0` and `100` respectively | Edge fn unit |

### §4.3 Step 0.5 implementor tests (REQUIRED files)

1. **Deno unit test (NEW):** `supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_slice.test.ts`
   - Test A: happy path — feed a 3-signal Q2 evaluations array, assert exact 6-field shape per signal.
   - Test B: empty input — feed `null` / `undefined` / `[]`, assert returns `{}` in all 3 cases.
   - Test C: malformed eval — feed one well-formed + one missing `reasoning` + one missing `signal_id`, assert only the well-formed one is in the output.
   - Test D: clamping — feed `score_0_to_100: -10`, `0`, `50`, `100`, `200`, assert resulting scores are `0`, `0`, `50`, `100`, `100`.
   - Test E: rounding — feed `score_0_to_100: 42.7`, assert resulting score is `43`.

2. **SQL test (NEW):** `supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_backfill.test.sql` (or pytest equivalent if the project uses a different SQL test harness — check existing `__tests__/` for the pattern).
   - Test A: against a snapshot DB seeded with 3 trial rows for 1 place (versions v2, v3, v4), the backfill writes the v4 slice (latest by completed_at).
   - Test B: against a snapshot with one trial row whose `q2_response` has no `evaluations` key, the backfill skips that place (no `ai_signal_scores` row written).
   - Test C: against a snapshot with a malformed evaluation, the backfill writes the well-formed signals but skips the malformed one.

### §4.4 Invariant retraction acceptance

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| I-01 | No production code reads `place_intelligence_trial_runs` | `grep -r "place_intelligence_trial_runs" app-mobile/src/ supabase/functions/discover-cards/ supabase/functions/generate-curated-experiences/ supabase/functions/_shared/` | Zero hits (live probe 2026-05-30 confirms zero hits) | Code grep |
| I-02 | Strict-grep CI gate exists and passes | Run `node .github/scripts/strict-grep/meta-orch-1009-sub-a-ai-signal-scores-sole-owner.mjs` against current tree | Exit 0; output `PASS sole-owner: only allowed paths write ai_signal_scores` | CI |
| I-03 | Strict-grep CI gate catches a violation | Add a temporary `.update({ ai_signal_scores: ... })` in an unrelated edge fn; run the gate | Exit 1; output names the offending file + line | CI |
| I-04 | Invariant registry entry updated | grep `INVARIANT_REGISTRY.md` for `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` | Marked RETRACTED with date 2026-05-30 + pointer to DEC-099 + DEC-181 | Docs |
| I-05 | DEC-181 entry present | grep `DECISION_LOG.md` for `DEC-181` | Entry present with cross-ref to DEC-099 + META-ORCH-1009 Sub-A | Docs |

---

## §5 Invariants

**Retracted in this sub:** `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` (full retraction body in §3.4).

**Established in this sub:**
- `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` — ACTIVE on Sub-A merge.
- `I-AI-SIGNAL-SCORES-SHAPE-CONTRACT` — ACTIVE on Sub-A merge.
- `I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED` — DRAFT on Sub-A merge → ACTIVE on Sub-B's ranker landing.

**Preserved (this sub does not touch):**
- `I-CATEGORY-DERIVED-ON-DROP` + `I-CATEGORY-SLUG-CANONICAL` — category-derivation invariants (DEC-091) — orthogonal to the AI signal scoring axis.
- `I-TRIAL-RUN-SCOPED-TO-CITY` — preserved (trial table still scoped to city; this sub only adds a SECONDARY write to a separate column).
- `I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS` — preserved (bouncer continues to gate `is_servable` upstream of any scoring).
- `I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION` — preserved (collage compose path unchanged).

---

## §6 Out of scope (explicit non-goals)

The following are NOT part of Sub-A and are flagged here so the implementor cannot drift:

- **Sub-B (consumer ranker blend)** — updating `supabase/functions/_shared/signalScorer.ts` to read `place_pool.ai_signal_scores` and blend with rule scorer + apply `inappropriate_for` veto. Separate dispatch.
- **Sub-C (Gemini coverage backfill)** — running new Gemini Q2 evaluations to grow coverage from 2,366 to all 13,671 servable places (≈$85 batch cost per research §5). Separate dispatch.
- **Sub-D (refresh cron + admin re-eval button)** — pg_cron trigger on `last_detail_refresh` / `business_status` change; admin UI re-eval button. Separate dispatch.
- **Drop of `place_pool.photo_aesthetic_data`** — DEC-099 Cut 1 named this column for decommission; 30 rows remain. NOT in Sub-A scope. Flagged as cleanup ORCH for orchestrator follow-up registration.
- **Any app-mobile change** — zero `app-mobile/src/` edits in Sub-A.
- **Any admin UI change** — zero `mingla-admin/src/` edits in Sub-A. The existing admin trial UI continues to operate unchanged (it reads the trial table; the new column is invisible to it).
- **Any business app change** — zero `mingla-business/src/` edits.
- **Any new external API call** — Sub-A uses ZERO new third-party calls. The existing Gemini call inside `processOnePlace` is unchanged; only a second `db.from('place_pool').update(...)` is added.
- **Any CHECK constraint on the new column** — deferred to Sub-B per §3.4 invariant 2 enforcement note (Sub-B has empirical shape evidence; Sub-A does not).
- **Per-signal `jsonb_set` upsert** — Sub-A uses whole-column-replace; per-signal upsert can come in a later ORCH if concurrent writes become a real problem (§3.2 concurrency model).
- **RLS changes on `place_pool`** — none. The column inherits the existing `place_pool` RLS (read = anon-allowed via security-definer views per the COMMS-0009 ORCH-0964 pattern; write = service-role only, which the edge function uses).

---

## §7 Decisions (judgment calls — operator review opportunities)

### Decision 1 (LOCKED): Whole-column-replace vs per-signal `jsonb_set` upsert

**Chosen:** Whole-column-replace (the edge fn writes the FULL per-place evaluation set in one `.update({ ai_signal_scores: <slice> })`).
**Rejected:** Per-signal `jsonb_set` upsert that would preserve other signals' values across writes.
**Rationale:** Per-place Q2 always covers all 16 signals in one call; there is no scenario today where a write would have a partial signal set. The admin-triggered sampling path explicitly excludes already-evaluated-in-this-city-run places (edge fn line ~1054). When two parallel runs DO race on the same place (admin runs two city sweeps overlapping), last-write-wins on the WHOLE column is acceptable because the loser's evaluation is also a full picture — there is no "merge benefit" to per-signal upsert today.
**Reversal path:** if Sub-C's parallel backfill or Sub-D's refresh cron starts producing partial-signal writes, swap the helper's call to `jsonb_set` and ship a follow-up ORCH. The shape contract (§3.4 invariant 2) is unchanged either way.

### Decision 2 (LOCKED): GIN `jsonb_path_ops` vs `jsonb_ops` vs no index

**Chosen:** GIN `jsonb_path_ops`.
**Rejected:** `jsonb_ops` (3× slower, 30% larger for the two operators Sub-B will use); no index (Sub-B will need `?` and `@>` filtering on 13,671 servable rows; without an index those queries scan the whole table).
**Rationale:** Per Postgres 17 JSONB Indexing docs (https://www.postgresql.org/docs/17/datatype-json.html#JSON-INDEXING, verified 2026-05-30), `jsonb_path_ops` supports `?` and `@>` (the two operators Sub-B uses) at materially better performance + smaller size than `jsonb_ops`, which adds support for `?|` and `?&` (array existence) that Sub-B does not need.
**Reversal path:** if Sub-B's read pattern changes to need array-existence operators, drop and recreate the index with `jsonb_ops` in Sub-B's migration.

### Decision 3 (LOCKED): Column name `ai_signal_scores` (NOT DEC-099's `claude_signal_evaluations`)

**Chosen:** `ai_signal_scores`.
**Rejected:** `claude_signal_evaluations` (DEC-099's original proposed name); `gemini_signal_evaluations` (vendor-specific to current provider).
**Rationale:** DEC-099 was written 2026-05-04 when Claude was the candidate provider. The trial pipeline shipped on Gemini 2.5 Flash (operator decision, DEC-101 Anthropic-dropped). The column will outlive the current provider — `ai_signal_scores` is provider-agnostic and survives a future swap (each per-signal entry stamps its own `model` field, so the column body remains auditable). This naming decision is captured in DEC-181 with explicit cross-reference to DEC-099.
**Reversal path:** none — column rename post-Sub-B-landing is expensive (touches the migration history + the ranker code + every test). Lock now.

### Decision 4 (LOCKED): Non-atomic secondary write (log + continue, do NOT fail trial row)

**Chosen:** If the secondary `place_pool.update({ ai_signal_scores })` fails, log + continue. The trial row stays `status='completed'`.
**Rejected:** Two-phase / transactional write that fails the trial row on secondary-write failure.
**Rationale:** The trial row is the SOURCE OF TRUTH; the new column is a DERIVED materialisation. Backfill is re-runnable (§3.3 SQL is idempotent under the `IS DISTINCT FROM` guard). Coupling the two writes would mean a transient Postgres hiccup on the secondary write rolls back the entire (expensive!) Gemini Q2 evaluation — that's the wrong failure mode. The async-recovery model is the same pattern the photo collage path uses (collage fail = `place_pool.photo_collage_url` stays null; next run picks it up).
**Reversal path:** if Sub-B observes meaningful drift (trial rows present but column missing for the same place), wrap the two writes in a single RPC transaction in a follow-up ORCH.

### Decision 5 (OPEN — operator review opportunity): Whether to expose the new column via a security-definer anon view now

**Question:** Sub-A does NOT expose `ai_signal_scores` to anon at the public API level. Sub-B's ranker is a backend edge function that uses the service-role client, so it inherits service-role read access on `place_pool.ai_signal_scores` automatically. But IF a future ORCH wants to surface `reasoning` as a card-back caption (research §1 delight mechanism), it will need an anon-readable surface — either a new security-definer view that exposes ONLY `reasoning` per place + signal (filtering out `score_0_to_100` and the per-eval metadata), OR a new RPC.
**Operator decision needed at Sub-B SPEC time, not Sub-A:** none of Sub-A's decisions block either path. Flagged here so Sub-B SPEC remembers to address it.

### Decision 6 (FLAG for orchestrator — not blocking): Backfill row-count expectation in the live migration

**The §3.3 backfill includes `RAISE NOTICE` + `RAISE WARNING` against the live source count, NOT a hard `RAISE EXCEPTION` on drift.** This is intentional — a 5% drift could reflect (a) malformed evaluations correctly skipped, (b) a small number of new trial rows landing between spec-write and apply, or (c) a real bug. Soft warnings keep the migration applyable while surfacing the signal to the operator's log. If the orchestrator wants hard-fail-on-drift behaviour, flip the WARNING to EXCEPTION at apply time — but that risks blocking the apply on benign delta and forces a manual override.

---

## §8 Cross-Surface Impact (Phase 2.5 mandatory section)

| Surface | Covered? | What changes | Files touched | Parity model |
|---|---|---|---|---|
| Consumer iOS (`app-mobile/` iOS) | NOT COVERED | No user-visible change in Sub-A | none | Sub-B will land the ranker change, which propagates identically to iOS + Android via the shared edge fn. |
| Consumer Android (`app-mobile/` Android) | NOT COVERED | No user-visible change in Sub-A | none | Same as iOS. |
| Buyer/anonymous Web (`mingla-business/` checkout/event/brand routes) | NOT COVERED | Buyer-anon routes don't touch the deck or signal scorer | none | n/a — no surface analog. |
| Business iOS (`mingla-business/` iOS) | NOT COVERED | No business surface reads `place_pool.ai_signal_scores` | none | n/a. |
| Business Android (`mingla-business/` Android) | NOT COVERED | Same as Business iOS | none | n/a. |
| Admin Web (`mingla-admin/`) | NOT COVERED in Sub-A | Admin trial UI continues to function unchanged (reads trial table, which is unchanged) | none | Sub-D will add the admin re-eval button. |
| Business Web preview (`mingla-business/` dev/web build) | NOT COVERED | n/a | none | n/a. |

**Conclusion:** Sub-A is a pure backend / migration / invariant-document sub. ZERO user-touchable surfaces ship in Sub-A. Tester does NOT need a sim-live-fire pass for this sub (Prime Directive 7 exempts pure backend/SQL/migration investigations per the forensics skill spec). Tester DOES need a DB-state verification pass (live count probes against the post-apply DB) + a Deno test pass + a strict-grep CI gate verification.

---

## §9 Implementation order

1. **Write the Deno unit test FIRST** (`__tests__/ai_signal_scores_slice.test.ts`) — TDD discipline; the helper function is the smallest atom and the test pins the shape contract.
2. **Add the helper `buildAiSignalScoresSlice` to the edge fn** at the top of the file near other helpers. Verify the test passes locally.
3. **Add the secondary `place_pool` update call** inside `processOnePlace` immediately after the existing trial-row update succeeds. Wire the try/catch per §3.2 verbatim.
4. **Write the migration** `20260802000003_meta_orch_1009_sub_a_ai_signal_scores.sql` — DDL + comment + index + backfill + self-verify probes per §3.1 + §3.3.
5. **Write the strict-grep CI gate** `.github/scripts/strict-grep/meta-orch-1009-sub-a-ai-signal-scores-sole-owner.mjs`. Wire it into the existing strict-grep workflow at `.github/workflows/strict-grep.yml` (find the pattern from existing gates like `orch-0805-*.mjs`).
6. **Apply the migration via `supabase db push --linked`** (operator action — per memory rule [[autonomy-posture-verifier-not-manager]] Claude can push autonomously; safe-migration protocol applies). Capture the apply NOTICE output for the verification step.
7. **Verify the post-apply DB state** with the acceptance tests M-01 → M-09.
8. **Update `INVARIANT_REGISTRY.md`** with the retraction + 3 new invariants per §3.4 verbatim.
9. **Append `DEC-181` to `DECISION_LOG.md`** per §2.
10. **Deploy the edge function** `supabase functions deploy run-place-intelligence-trial` (operator-confirmed per the deploy carve-out in COMMS-0012).
11. **Smoke test E-01** — trigger one trial run on a single place via the admin UI; verify `place_pool.ai_signal_scores` is populated for that place.
12. **Hand off to orchestrator for PR + CLOSE.** Sub-B SPEC dispatch immediately follows.

---

## §10 Regression prevention

| Risk class | Safeguard | Evidence |
|---|---|---|
| Future code path writes the new column from outside the trial fn | Strict-grep CI gate (I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER §3.4 enforcement gate 1) | CI red on any new `.update({ ai_signal_scores`) outside allowed paths |
| Future producer drifts the per-signal shape | Deno unit test on `buildAiSignalScoresSlice` (§4.3 Test A) + TypeScript return-type on the helper | Test red on any field rename / add / remove |
| Backfill silently drops places due to malformed evaluations | Migration-time `RAISE WARNING` on backfilled-vs-source drift > 5% (§3.3 self-verify probe) | Apply-time log shows the warning |
| Concurrent writes on the same place lose data | Documented as last-write-wins in §3.2 + the column comment names the trial-row as the audit log; backfill is idempotent and can re-derive from the audit | Operator can always reconstruct the column from `place_intelligence_trial_runs` |
| Future provider swap (Gemini → Claude → other) silently corrupts the column | Per-signal `model` + `prompt_version` fields preserve provenance; Sub-B's `I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED` fails closed on mismatch | Sub-B unit test asserts mixed-version handling |
| Trial table read regression (someone re-introduces direct prod reads) | Strict-grep gate at §3.4 invariant 1 enforcement names BOTH `ai_signal_scores` writes AND `place_intelligence_trial_runs` reads from production paths as forbidden | CI red on either pattern |

---

## §11 Discoveries for orchestrator (side issues found during spec write — NOT in Sub-A scope)

1. **`place_pool.photo_aesthetic_data` still physically present** with 30 rows. DEC-099 Cut 1 named this column for drop. Register cleanup ORCH (low priority — 30 rows, no production read). Also includes 2 stale indexes: `idx_place_pool_photo_aesthetic_unscored` + `idx_place_pool_has_collage` may have similar partial-index patterns worth auditing for whether they reference the dropped column.
2. **Dispatch said `3,752 completed Q2 rows`; live probe = `2,663 completed Q2 rows / 2,366 distinct places`.** No action needed — Sub-A spec uses the live numbers throughout. Flagging the discrepancy so the operator knows the dispatch was approximate.
3. **`signal_definitions` schema:** the table uses `id` (text) NOT `signal_id` — the dispatch's mention of `signal_definitions.config.expected_prompt_version` will need Sub-B to verify the actual JSONB path (config lives on `signal_definition_versions.config`, not `signal_definitions`). Sub-B SPEC must pin the exact source-of-truth path for the expected prompt version.
4. **Existing `idx_pit_runs_place` index on `place_intelligence_trial_runs(place_pool_id, created_at DESC)`** — the backfill's `DISTINCT ON (place_pool_id) ORDER BY ... completed_at DESC` may benefit from a separate index on `(place_pool_id, completed_at DESC NULLS LAST) WHERE status='completed'`. NOT added in Sub-A (one-time backfill perf is not worth the index maintenance overhead going forward; admin trial queries use `created_at`). Sub-D's refresh cron may want it; flag for Sub-D.

---

## §12 Confidence note

- **Codebase claims:** `proven` for the edge fn `processOnePlace` write site (read the exact lines 1324–1530 in full), `proven` for the existing trial-row UPDATE shape (lines 1481–1501), `proven` for the zero-production-read of `place_intelligence_trial_runs` (full repo grep across consumer + shared paths), `proven` for the migration baseline column + index naming patterns (read in full from baseline squash).
- **DB claims:** `proven` — every row count + column shape came from live `mcp__supabase__execute_sql` against production on 2026-05-30.
- **Prior artifact claims:** `proven` for DEC-099 body (read verbatim from `DECISION_LOG.md`), `probable` for the `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` body (only a single registry-mention line exists; the full body is reconstructed in §3.4 from the DEC-099 + research-doc context — Sub-A close ratifies the reconstructed body as authoritative).
- **External research claims:** `proven` for Gemini function-calling shape (Gemini docs URL cited inline + verified 2026-05-30), `proven` for Postgres 17 GIN `jsonb_path_ops` vs `jsonb_ops` performance characteristics (Postgres docs URL cited inline).
- **DEC-181 numbering:** `proven` — `grep -oE "DEC-[0-9]+" | sort -V | tail` confirms DEC-180 is the current max.

No `proven` claim is contradicted by a `probable` or `suspected` claim.

---

## Exhibit A — Live Q2 response shape sample (CAVA, 2026-05-30 probe)

```json
{
  "evaluations": [
    {
      "reasoning": "CAVA is a fast-casual Mediterranean restaurant with a moderate price point and simple decor, lacking the upscale ambiance, service, or menu associated with fine dining.",
      "signal_id": "fine_dining",
      "score_0_to_100": 5,
      "inappropriate_for": false
    },
    {
      "reasoning": "The place metadata explicitly states 'serves_brunch: false' and 'serves_breakfast: false', indicating it does not structurally offer brunch despite opening at 10:30 AM.",
      "signal_id": "brunch",
      "score_0_to_100": 0,
      "inappropriate_for": true
    },
    {
      "reasoning": "CAVA's core identity is a casual Mediterranean restaurant offering customizable bowls and pitas at a moderate price, as seen in photos and described in reviews as a 'go to spot' for a 'fast pace and healthy meal.'",
      "signal_id": "casual_food",
      "score_0_to_100": 95,
      "inappropriate_for": false
    }
  ]
}
```

(All 16 signals present in the actual probe — trimmed to 3 here for spec readability.)

---

**End of SPEC.**

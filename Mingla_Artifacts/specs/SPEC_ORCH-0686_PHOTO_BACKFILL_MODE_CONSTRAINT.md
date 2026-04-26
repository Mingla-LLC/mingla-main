---
ORCH-ID: ORCH-0686
Mode: SPEC
Status: BINDING — implementor cannot deviate without orchestrator re-approval
Severity: S1-high
Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md
Author: mingla-forensics (SPEC mode)
Date: 2026-04-26
Blocks: ORCH-0682 (Lagos+8-city operational recovery)
Estimated implementor wall time: 60–90 min
---

# SPEC — ORCH-0686
## Photo backfill `create_run` constraint alignment + admin error-body unwrapping

## 1. Plain-English Summary (for the orchestrator)

Two changes, one ORCH:

1. **DB rule fix** — amend the `photo_backfill_runs.mode` CHECK constraint so it permits the new value `'pre_photo_passed'` that ORCH-0678 introduced, while keeping the legacy `'initial'` value valid for the 18 historical rows. Flip the column default to the current pipeline mode. Lock in a CI gate so this class of "TS rename without SQL update" bug cannot recur.
2. **Admin diagnostic fix (ride-along)** — the admin UI catches edge-function errors and shows the SDK's generic `"Edge Function returned a non-2xx status code"` instead of the real error body. Add a small helper that mirrors `app-mobile/src/utils/edgeFunctionError.ts`, wire it into both affected admin pages so the operator sees the actual Postgres error next time.

After this ships, the 14,401 pre-bouncer-approved places unstall and ORCH-0682 Steps 2+3 can complete. No edge function code change. No mobile change. No EAS update.

## 2. Scope

**In scope (binding):**

- One new SQL migration that drops + re-adds `photo_backfill_runs_mode_check` with three permitted values, flips the column default, and updates the column comment.
- One new admin helper module: `mingla-admin/src/lib/edgeFunctionError.js`.
- Wire the helper into the two known-affected admin call sites: `PlacePoolManagementPage.jsx` (local `invoke` helper at line 1377) and `SignalLibraryPage.jsx` (the four `invokeWithRefresh` consumers of `backfill-place-photos`).
- One CI gate added to `scripts/ci-check-invariants.sh`: `I-DB-ENUM-CODE-PARITY` — asserts the TypeScript `BackfillMode` union and the SQL CHECK clause stay in sync.
- Update `Mingla_Artifacts/INVARIANT_REGISTRY.md`: rewrite the `I-PHOTO-FILTER-EXPLICIT` entry; register the new `I-DB-ENUM-CODE-PARITY` entry.
- Update the column comment block in the migration to reference the rewritten invariant.

**Out of scope (do NOT include):**

- Any change to `supabase/functions/backfill-place-photos/index.ts`. Code already writes `'pre_photo_passed'` correctly. Verify by `git diff --name-only` after the implementor's commits — if `backfill-place-photos/index.ts` appears, the spec was violated.
- Any change to `parseBackfillMode` (its current coercion is acceptable per investigation §F-3).
- Any change to `run-pre-photo-bouncer` or `run-bouncer` edge functions.
- Generalizing the admin error helper across all admin pages (every other `addToast({ description: err.message })` site is a future ORCH; not this one).
- Mobile-side changes (no mobile call sites).
- Touching the 18 legacy `'initial'` rows. They stay as-is.
- ORCH-0681 international policy. ORCH-0682 operational recovery sequence. ORCH-0683 baseline.

**Assumptions:**

- The Supabase CLI is available and `supabase db push` will be used to apply the migration (per existing convention in CLAUDE.md / prior ORCHs — never via `mcp__supabase__apply_migration`).
- The two admin pages remain at their current line locations. If a parallel chat moves them, the implementor reads-then-edits, not blindly edits by line number.
- 18 historical `'initial'` rows are all in terminal status (`completed` / `cancelled`) per investigation §E-2. They will not be re-processed. Any future code that does process them and reads `parseBackfillMode(run.mode)` would coerce them to `'pre_photo_passed'` — out of scope for this spec, but flagged for orchestrator awareness.

## 3. Layer-by-Layer Specification

### 3.1 Database Layer

**File:** `supabase/migrations/20260426000001_orch_0686_photo_backfill_mode_constraint.sql`

(Implementor: pick the next-available timestamp suffix if `20260426000001` is already taken when the file is created. Match the existing `_orch_NNNN_short_description.sql` pattern.)

**Apply via:** `supabase db push` only. Never via `mcp__supabase__apply_migration` (per convention in `20260424200002_orch_0598_11_launch_city_pipeline.sql:11`).

**Exact contents (binding — implementor may add comments but not change SQL semantics):**

```sql
-- ORCH-0686 — Align photo_backfill_runs.mode CHECK constraint with ORCH-0678 enum rename.
--
-- Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md
-- Spec:          Mingla_Artifacts/specs/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md
--
-- Background: ORCH-0598.11 (20260424200002) added a CHECK constraint allowing only
--   ('initial', 'refresh_servable'). ORCH-0678 (20260430000001) renamed the
--   BackfillMode enum value 'initial' -> 'pre_photo_passed' in the edge function and
--   admin UI but did NOT amend the constraint. Every create_run since ORCH-0678 deploy
--   has hit SQLSTATE 23514. 14,401 pre-photo-approved places stranded.
--
-- This migration:
--   1. Drops the stale constraint.
--   2. Re-adds it with all three permitted values: 'initial' (legacy alias for 18
--      historical terminal-state rows), 'pre_photo_passed' (current default), and
--      'refresh_servable' (Bouncer-approved maintenance).
--   3. Flips the column DEFAULT from 'initial' to 'pre_photo_passed' so any out-of-band
--      insert (psql, dashboard, scripts) picks the current pipeline mode.
--   4. Updates the column comment to reflect the rewritten I-PHOTO-FILTER-EXPLICIT
--      invariant.
--
-- I-PHOTO-FILTER-EXPLICIT (rewritten):
--   photo_backfill_runs.mode is one of:
--     'pre_photo_passed' — current default; first-pass after pre-photo Bouncer; gates
--                          eligibility on place_pool.passes_pre_photo_check.
--     'refresh_servable' — Bouncer-approved maintenance; gates on place_pool.is_servable.
--     'initial'          — LEGACY alias; historical terminal-state rows only; do not
--                          write from new code.
--   The TypeScript BackfillMode union and this CHECK clause MUST stay in sync.
--   Enforced by CI gate I-DB-ENUM-CODE-PARITY.
--
-- Idempotent. Safe to re-run.

BEGIN;

-- 1. Drop the stale constraint (idempotent — IF EXISTS guards re-run).
ALTER TABLE public.photo_backfill_runs
  DROP CONSTRAINT IF EXISTS photo_backfill_runs_mode_check;

-- 2. Re-add with all three permitted values.
ALTER TABLE public.photo_backfill_runs
  ADD CONSTRAINT photo_backfill_runs_mode_check
  CHECK (mode IN ('initial', 'pre_photo_passed', 'refresh_servable'));

-- 3. Flip column default to current pipeline mode.
ALTER TABLE public.photo_backfill_runs
  ALTER COLUMN mode SET DEFAULT 'pre_photo_passed';

-- 4. Update column comment to reflect rewritten invariant.
COMMENT ON COLUMN public.photo_backfill_runs.mode IS
  'ORCH-0686 (supersedes ORCH-0598.11): explicit eligibility filter. '
  'pre_photo_passed = current default; gates on passes_pre_photo_check. '
  'refresh_servable = Bouncer-approved maintenance; gates on is_servable. '
  'initial = LEGACY alias for historical terminal-state rows; do not write from new code. '
  'I-PHOTO-FILTER-EXPLICIT. CI gate: I-DB-ENUM-CODE-PARITY.';

-- 5. Post-condition assertion: fail loud if constraint or default is missing/incorrect.
DO $$
DECLARE
  v_constraint_def text;
  v_column_default text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_constraint_def
  FROM pg_constraint
  WHERE conname = 'photo_backfill_runs_mode_check'
    AND conrelid = 'public.photo_backfill_runs'::regclass;

  IF v_constraint_def IS NULL THEN
    RAISE EXCEPTION 'ORCH-0686: photo_backfill_runs_mode_check constraint missing post-migration';
  END IF;

  IF v_constraint_def NOT LIKE '%pre_photo_passed%'
     OR v_constraint_def NOT LIKE '%refresh_servable%'
     OR v_constraint_def NOT LIKE '%initial%' THEN
    RAISE EXCEPTION 'ORCH-0686: photo_backfill_runs_mode_check missing one of three required values. Current def: %', v_constraint_def;
  END IF;

  SELECT column_default INTO v_column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'photo_backfill_runs'
    AND column_name = 'mode';

  IF v_column_default IS NULL OR v_column_default NOT LIKE '%pre_photo_passed%' THEN
    RAISE EXCEPTION 'ORCH-0686: photo_backfill_runs.mode default not flipped to pre_photo_passed. Current default: %', v_column_default;
  END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, emergency only — execute if production breaks)
-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- ALTER TABLE public.photo_backfill_runs DROP CONSTRAINT IF EXISTS photo_backfill_runs_mode_check;
-- ALTER TABLE public.photo_backfill_runs
--   ADD CONSTRAINT photo_backfill_runs_mode_check
--   CHECK (mode IN ('initial', 'refresh_servable'));
-- ALTER TABLE public.photo_backfill_runs ALTER COLUMN mode SET DEFAULT 'initial';
-- COMMIT;
-- WARNING: Rolling back will re-break create_run for any post-ORCH-0678 attempt.
-- Only roll back if a downstream consumer is found that can't tolerate the new value.
```

**No data migration.** The 18 legacy `'initial'` rows stay untouched. Verify post-migration:

```sql
SELECT mode, status, count(*) FROM public.photo_backfill_runs GROUP BY 1,2;
-- Expected: same row counts as pre-migration; 'initial' values preserved.
```

### 3.2 Edge Function Layer

**Non-change.** No file under `supabase/functions/` is modified by this ORCH. Implementor verification:

```bash
git diff --name-only main..HEAD -- supabase/functions/
# Expected: no output. If any file appears, spec was violated.
```

No `supabase functions deploy` is required. State this explicitly in the implementation report.

### 3.3 Admin UI Layer — New Helper

**File:** `mingla-admin/src/lib/edgeFunctionError.js`

Mirrors `app-mobile/src/utils/edgeFunctionError.ts` semantically; ported to JS (admin uses JSX/JS, no TS). Duck-typing for `Response` (per memory `feedback_supabase_error_handling`); read body as text, then `JSON.parse`, never `.json()` directly. Returns a string, never throws.

**Exact contents (binding — implementor may shorten comments but not change behavior):**

```javascript
/**
 * Extract the real error message from a Supabase FunctionsHttpError on the admin client.
 *
 * supabase-js v2 wraps non-2xx edge-function responses in a FunctionsHttpError whose
 * `.message` is the generic string "Edge Function returned a non-2xx status code". The
 * actual response is stored as `error.context` (a Response object).
 *
 * IMPORTANT: read the body as TEXT first, then JSON.parse. A Response body can only be
 * consumed once — if .json() fails mid-stream, .text() will also fail. text-first is safe.
 *
 * Duck-type Response (`typeof .text === 'function'`); do not rely on `instanceof Response`.
 *
 * Returns a Promise<string> — the extracted message, or the fallback if extraction fails.
 * Never throws.
 *
 * Mirrors app-mobile/src/utils/edgeFunctionError.ts (ORCH-0686).
 */

export async function extractFunctionError(error, fallback) {
  try {
    if (!error) return fallback;

    const ctx = error.context;

    // Strategy 1: read Response body as text, then parse as JSON.
    if (ctx && typeof ctx.text === "function") {
      try {
        const raw = await ctx.text();
        try {
          const body = JSON.parse(raw);
          if (body?.error && typeof body.error === "string") return body.error;
          if (body?.message && typeof body.message === "string") return body.message;
          if (body?.msg && typeof body.msg === "string") return body.msg;
        } catch {
          // Not JSON — return short raw text if present and not HTML.
          if (raw && raw.length > 0 && raw.length < 500 && !raw.startsWith("<!")) {
            return raw;
          }
        }
      } catch {
        // Body stream couldn't be read — fall through.
      }
    }

    // Strategy 2: HTTP-status-derived message when body is unavailable.
    if (ctx && typeof ctx.status === "number") {
      const status = ctx.status;
      if (status === 400) return `${fallback} (bad request)`;
      if (status === 401) return "Session expired — please sign in again";
      if (status === 403) return "Not authorized for this action";
      if (status === 404) return `${fallback} (not found)`;
      if (status === 429) return "Too many requests — try again in a moment";
      if (status >= 500) return `${fallback} (server error)`;
    }

    // Strategy 3: error.message if not the generic SDK string.
    const msg = error.message;
    if (typeof msg === "string" && msg.length > 0 && !msg.startsWith("Edge Function returned")) {
      return msg;
    }
  } catch {
    // Defensive — anything unexpected falls through.
  }

  return fallback;
}
```

### 3.4 Admin UI Layer — Wire-In Site A: `PlacePoolManagementPage.jsx`

**File:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx`

**Site:** local `invoke` helper at line 1377-1382. Currently:

```javascript
const invoke = async (body) => {
  const { data, error } = await supabase.functions.invoke("backfill-place-photos", { body });
  if (error) throw new Error(error.message || "Edge function error");
  if (data?.error) throw new Error(data.error);
  return data;
};
```

**Required change:**

1. At the top of the file, add an import (after the existing `supabase` import — group with other lib imports):

```javascript
import { extractFunctionError } from "../lib/edgeFunctionError";
```

2. Replace the local `invoke` helper body at line 1377-1382 with:

```javascript
const invoke = async (body) => {
  const { data, error } = await supabase.functions.invoke("backfill-place-photos", { body });
  if (error) {
    const msg = await extractFunctionError(error, "Edge function error");
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
};
```

**Do NOT** change any of the downstream `addToast({ ..., description: err.message })` callsites — `err.message` will now contain the unwrapped Postgres error string verbatim. Verified consumers: `handleCreateRun` line 1531-1533 (the symptom site), `handleRunNext`, `handleAutoRun`, `handleCancelRun`, `handleResumeRun`, etc. They all consume `err.message` from `invoke`'s thrown `Error`. The wire is single-point.

**No other PlacePoolManagementPage edits.**

### 3.5 Admin UI Layer — Wire-In Site B: `SignalLibraryPage.jsx`

**File:** `mingla-admin/src/pages/SignalLibraryPage.jsx`

**Sites:** four `invokeWithRefresh` consumers at lines 169, 221, 263, 389 (and possibly 628 — implementor confirms). The relevant write paths against `backfill-place-photos` are at lines 221-231 (`runErr` from `create_run`) and 263 (`batchErr` from `run_next_batch`).

**Required change:**

1. Add import (group with other lib imports near line 19):

```javascript
import { extractFunctionError } from "../lib/edgeFunctionError";
```

2. At each `invokeWithRefresh` call site that currently has the pattern `if (runErr) throw runErr;` (or `if (error) throw error;`), replace with:

```javascript
if (runErr) {
  const msg = await extractFunctionError(runErr, "Edge function error");
  throw new Error(msg);
}
```

(Substitute the local error variable name for `runErr` — `error`, `batchErr`, etc. Match the existing local variable name; do not rename.)

**Required scope (must hit ALL of these):** every `invokeWithRefresh` consumer in `SignalLibraryPage.jsx`. Implementor identifies via grep; confirms count matches the 5 sites surfaced earlier (lines 169, 221, 263, 389, 628). If a site is genuinely a read-only call where errors are already user-readable, document the rationale in the implementor report and skip it — but err on the side of wiring (the helper is harmless on already-meaningful errors).

**Do NOT** modify `invokeWithRefresh` itself in `lib/supabase.js`. Changing that helper's signature would affect every caller across the admin and is out of scope.

### 3.6 Invariant Registry

**File:** `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**Action 1 — rewrite (or add if missing) the `I-PHOTO-FILTER-EXPLICIT` entry:**

```markdown
### I-PHOTO-FILTER-EXPLICIT
- **Statement:** `photo_backfill_runs.mode` is one of three values:
  - `'pre_photo_passed'` — current default; first-pass after pre-photo Bouncer; gates eligibility on `place_pool.passes_pre_photo_check`.
  - `'refresh_servable'` — Bouncer-approved maintenance; gates on `place_pool.is_servable`.
  - `'initial'` — LEGACY alias for historical terminal-state rows; not written from new code.
  The TypeScript `BackfillMode` union in `supabase/functions/backfill-place-photos/index.ts` and the SQL CHECK constraint `photo_backfill_runs_mode_check` MUST stay in sync.
- **Established by:** ORCH-0598.11 (initial 2-mode form), rewritten by ORCH-0686 (3-mode form).
- **Enforcement:** CI gate `I-DB-ENUM-CODE-PARITY` in `scripts/ci-check-invariants.sh`.
- **Verification:** `pg_get_constraintdef` for `photo_backfill_runs_mode_check` returns a CHECK whose value list is a permutation-equal of `('initial', 'pre_photo_passed', 'refresh_servable')`.
```

**Action 2 — add the new `I-DB-ENUM-CODE-PARITY` entry:**

```markdown
### I-DB-ENUM-CODE-PARITY
- **Statement:** Whenever a TypeScript union or enum value is renamed/added/removed and its values are persisted into a column governed by a SQL CHECK constraint, the migration MUST update the constraint in the same change. The TypeScript value set and the SQL CHECK value set MUST be permutation-equal at all times.
- **Established by:** ORCH-0686 (root-cause register entry RC-0686).
- **Enforcement:** CI gate in `scripts/ci-check-invariants.sh` — currently scoped to `BackfillMode` ↔ `photo_backfill_runs.mode`; future renames should append additional checks under the same gate.
- **Why it exists:** ORCH-0540 and ORCH-0686 both shipped TypeScript renames without SQL updates and broke production. Headless QA missed both. This invariant exists as a structural safeguard against the same class of failure.
```

**Action 3 — locate any other doc that still cites `I-PHOTO-FILTER-EXPLICIT` with the stale 2-value statement:**

- `supabase/migrations/20260424200002_orch_0598_11_launch_city_pipeline.sql:8` — historical migration text; do NOT modify (migrations are immutable once applied; the new migration's comment block carries the rewritten statement forward).
- Anything else surfaced by `grep -rn "I-PHOTO-FILTER-EXPLICIT"` — note in the implementor report; do not modify migration files.

### 3.7 CI Gate

**File:** `scripts/ci-check-invariants.sh`

**Action:** append a new gate block. Mirror the existing pattern (search the file for `I-CHROME-HAIRLINE-SUB-PERCEPTIBLE` or `I-CURATED-REVERSEANCHOR-NEEDS-COMBOS` for shape).

**Required behavior:**

1. Parse the `BackfillMode` type union from `supabase/functions/backfill-place-photos/index.ts`. Extract the literal string values inside the union.
2. Parse the latest CHECK constraint definition for `photo_backfill_runs_mode_check` from the most recent migration that references it (locate by grep + sort by filename timestamp; pick the last one). Extract the literal values.
3. Assert the two value sets are permutation-equal. If not, fail loudly with both sets and the offending file paths.

**Implementation guidance (binding — implementor may use any tool combination that achieves these checks):**

```bash
# Append near the bottom of scripts/ci-check-invariants.sh, before any "exit $errors":

# ── I-DB-ENUM-CODE-PARITY (ORCH-0686) ────────────────────────────────────────
# Asserts the BackfillMode TypeScript union and the photo_backfill_runs.mode SQL
# CHECK constraint reference the same set of values. Catches the class of bug
# proven by ORCH-0540 and ORCH-0686 (TS rename without SQL update).

echo "Checking I-DB-ENUM-CODE-PARITY..."

ts_file="supabase/functions/backfill-place-photos/index.ts"
ts_values=$(grep -E "^type BackfillMode" "$ts_file" \
  | grep -oE "'[^']+'" | sort -u | tr -d "'" | tr '\n' ' ' | xargs)

# Find the latest migration that defines photo_backfill_runs_mode_check.
sql_file=$(grep -lE "photo_backfill_runs_mode_check" supabase/migrations/*.sql \
  | sort | tail -n 1)
sql_values=$(grep -oE "mode IN \([^)]+\)" "$sql_file" \
  | tail -n 1 | grep -oE "'[^']+'" | sort -u | tr -d "'" | tr '\n' ' ' | xargs)

if [ "$ts_values" != "$sql_values" ]; then
  echo "FAIL: I-DB-ENUM-CODE-PARITY violated."
  echo "  BackfillMode TS values ($ts_file): $ts_values"
  echo "  CHECK constraint SQL values ($sql_file): $sql_values"
  echo "  These must be permutation-equal. Update both sides in lockstep."
  errors=$((errors + 1))
else
  echo "  OK ($ts_values)"
fi
```

(Implementor: adapt to the exact loop / counter variable names already in the script. The shape — extract TS values, extract SQL values, sort-compare, fail with both sets — is binding; the exact bash is illustrative.)

**Mirror the deno-skip-graceful pattern** if any deno-dependent step is needed (none required for this gate — pure bash + grep — but follow the file's convention).

## 4. Success Criteria

| ID | Criterion | Verification | Layer |
|---|---|---|---|
| SC-1 | Post-migration, `pg_get_constraintdef('photo_backfill_runs_mode_check')` returns a CHECK whose value set is permutation-equal to `('initial', 'pre_photo_passed', 'refresh_servable')`. | DB query | Schema |
| SC-2 | Post-migration, `information_schema.columns.column_default` for `photo_backfill_runs.mode` is `'pre_photo_passed'::text`. | DB query | Schema |
| SC-3 | Live-fire: an `INSERT INTO photo_backfill_runs (..., mode='pre_photo_passed', ...)` against a real admin user succeeds (executed inside `BEGIN; … ROLLBACK;` to avoid pollution). | SQL probe | Schema |
| SC-4 | Live-fire: an `INSERT INTO photo_backfill_runs (..., mode='garbage', ...)` raises SQLSTATE 23514 against `photo_backfill_runs_mode_check`. | SQL probe | Schema |
| SC-5 | Live-fire: an `INSERT INTO photo_backfill_runs (..., mode='initial', ...)` succeeds (legacy alias preserved). | SQL probe | Schema |
| SC-6 | Live-fire: an `INSERT INTO photo_backfill_runs (..., mode='refresh_servable', ...)` succeeds. | SQL probe | Schema |
| SC-7 | Admin UI live-fire: clicking "Create photo download run" on the Place Pool Photos tab for a city with `passes_pre_photo_check=true` rows successfully creates a run row (status `'ready'`, mode `'pre_photo_passed'`) and inserts the corresponding `photo_backfill_batches` rows. The toast shows the success variant. | Full stack | UI + DB |
| SC-8 | Admin UI live-fire: Signal Library one-shot photo backfill button creates a run row and proceeds to batch processing without "Failed to create run" toast. | Full stack | UI + DB |
| SC-9 | Forced 500 from edge fn (synthetic constraint violation re-introduced in a transaction or by sending an invalid `mode` value) surfaces a toast description containing the actual Postgres error text (e.g., "violates check constraint" or the edge fn's `error` body), NOT the generic `"Edge Function returned a non-2xx status code"`. | Admin live-fire | UI |
| SC-10 | The 18 legacy `mode='initial'` rows are unchanged in count and content post-migration. | DB query | Data |
| SC-11 | `INVARIANT_REGISTRY.md` contains the rewritten `I-PHOTO-FILTER-EXPLICIT` entry (mentions all three values, names the CI gate) and the new `I-DB-ENUM-CODE-PARITY` entry. | Repo grep | Docs |
| SC-12 | CI gate negative-control: temporarily add `'fakemode'` to the `BackfillMode` TypeScript union without updating the SQL constraint → `bash scripts/ci-check-invariants.sh` exits non-zero AND prints both value sets AND names the offending file path. Revert → exit 0. | Negative-control test | CI |
| SC-13 | `git diff --name-only` against `supabase/functions/` returns empty (zero edge-function files modified). | git command | Process |
| SC-14 | After deployment, the admin can create a photo download run for at least one currently-stranded city (e.g., Lagos, where `passes_pre_photo_check=true` count > 0). Run row created, batches enqueued, status reachable via `run_status`. (Operationally satisfies ORCH-0682 Step 2 unblock.) | Admin live-fire | Full stack |

## 5. Invariants

**Preserved (must remain true post-change):**

- `I-PRE-PHOTO-BOUNCER-SOLE-WRITER` (ORCH-0678): only `run-pre-photo-bouncer` writes `place_pool.passes_pre_photo_check`. **This spec touches no edge function**, so preservation is structural.
- `I-IS-SERVABLE-SINGLE-WRITER` (ORCH-0678): only `run-bouncer` writes `place_pool.is_servable`. Same — no edge function changes.
- `I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO` (ORCH-0678): backfill-place-photos eligibility keys off `passes_pre_photo_check` for `'pre_photo_passed'` mode. The eligibility code path is unmodified.
- `I-PLACE-POOL-ADMIN-WRITE-ONLY` (ORCH-0598.11): no non-admin role may UPDATE `place_pool`. RLS unchanged.

**Established (NEW or rewritten):**

- `I-PHOTO-FILTER-EXPLICIT` — rewritten under three values (see §3.6 Action 1).
- `I-DB-ENUM-CODE-PARITY` — new (see §3.6 Action 2). CI-gated.

## 6. Test Cases

| ID | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | New constraint allows new mode | `BEGIN; INSERT … mode='pre_photo_passed'; ROLLBACK;` | Insert succeeds (within tx) | DB |
| T-02 | New constraint allows legacy mode | `BEGIN; INSERT … mode='initial'; ROLLBACK;` | Insert succeeds (historical compat) | DB |
| T-03 | New constraint allows refresh mode | `BEGIN; INSERT … mode='refresh_servable'; ROLLBACK;` | Insert succeeds | DB |
| T-04 | New constraint rejects garbage | `BEGIN; INSERT … mode='garbage'; ROLLBACK;` | SQLSTATE 23514, constraint name `photo_backfill_runs_mode_check` | DB |
| T-05 | Default value flipped | `BEGIN; INSERT … (omit mode); ROLLBACK;` and `RETURNING mode` | mode = `'pre_photo_passed'` | DB |
| T-06 | Legacy rows untouched | `SELECT mode, count(*) FROM photo_backfill_runs GROUP BY 1` pre+post migration | identical row counts; `'initial'` rows preserved | DB |
| T-07 | Post-condition assertion fires on missing constraint | Manually `DROP CONSTRAINT` post-apply, re-run migration | Migration's DO block raises with the loud error | DB |
| T-08 | Real `create_run` end-to-end via Place Pool Photos tab | Admin UI button on a city with passes_pre_photo_check rows > 0 | Run created (`status='ready'`, `mode='pre_photo_passed'`); batches inserted; success toast | Full stack |
| T-09 | Real `create_run` end-to-end via Signal Library one-shot | Admin UI button | Same as T-08 plus batch processing begins | Full stack |
| T-10 | Forced edge fn 500 surfaces real body in admin toast | Re-introduce a synthetic constraint violation (e.g., briefly inject `mode: "garbage"` from a dev console, OR temporarily revert the migration on a branch DB) | Toast description contains the Postgres error text or the edge fn's `error` body — NOT the generic SDK message | Admin UI |
| T-11 | CI gate negative control | Add `'fakemode'` to `BackfillMode` TS union without updating SQL → `bash scripts/ci-check-invariants.sh` | Exit code != 0, both value sets printed, offending TS file path named | CI |
| T-12 | CI gate positive control | Tree consistent post-fix | `bash scripts/ci-check-invariants.sh` exits 0 (or exits non-zero only on pre-existing baseline failures, not on this gate) | CI |
| T-13 | Helper handles malformed body | `extractFunctionError({ context: { text: () => Promise.resolve('not json') } }, 'fallback')` | Returns `'not json'` | Helper unit |
| T-14 | Helper handles missing context | `extractFunctionError({ message: 'real error' }, 'fallback')` | Returns `'real error'` | Helper unit |
| T-15 | Helper handles null | `extractFunctionError(null, 'fallback')` | Returns `'fallback'` | Helper unit |

## 7. Implementation Order

1. Read [INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md) in full (10 min).
2. Read this spec in full. Confirm understanding of the binding boundaries before writing any code.
3. Create the migration file at `supabase/migrations/20260426000001_orch_0686_photo_backfill_mode_constraint.sql` per §3.1. Apply via `supabase db push`.
4. Verify SC-1 + SC-2 + SC-10 by direct DB query (`mcp__supabase__execute_sql` or psql). Document the constraint def, the new default, and the legacy-row count in the implementor report.
5. Live-fire SC-3, SC-4, SC-5, SC-6 via `BEGIN; INSERT…; ROLLBACK;` probes. Capture verbatim outputs.
6. Create `mingla-admin/src/lib/edgeFunctionError.js` per §3.3.
7. Wire helper into `PlacePoolManagementPage.jsx` per §3.4. Run `npm run build` from `mingla-admin/` — expect zero new errors.
8. Wire helper into `SignalLibraryPage.jsx` per §3.5. Re-run `npm run build`.
9. Update `Mingla_Artifacts/INVARIANT_REGISTRY.md` per §3.6.
10. Add the CI gate to `scripts/ci-check-invariants.sh` per §3.7. Run the script — confirm the new gate prints `OK` (and any pre-existing gate failures are pre-existing, documented in prior ORCHs).
11. Run T-11 negative-control: add `'fakemode'` to the TS union (do NOT commit), re-run the script, confirm it fires + names the offending file. Revert.
12. Live-fire T-08 and T-09 via the admin UI against a city with stranded `passes_pre_photo_check=true` rows. Capture screenshots and the run_id created. SC-7 + SC-8 + SC-14.
13. Live-fire T-10 via dev-console injection of an invalid mode value through the admin UI's `invoke` helper. Capture the toast description. SC-9.
14. Two commits per §8. No EAS update.
15. Implementor report per `references/implementor-report-template.md` — must include verbatim outputs from steps 4, 5, 10-13.

## 8. Commit Messages (templates — no Co-Authored-By per `feedback_no_coauthored_by.md`)

**Commit 1 — DB migration + invariant registry + CI gate:**

```
fix(photo-backfill): ORCH-0686 align photo_backfill_runs.mode CHECK constraint with ORCH-0678 enum rename

ORCH-0678 renamed BackfillMode 'initial' -> 'pre_photo_passed' in the edge function
and admin UI but did not amend the photo_backfill_runs_mode_check constraint, which
still rejects every value other than ('initial', 'refresh_servable'). Every create_run
since ORCH-0678 deploy has hit SQLSTATE 23514 — 14,401 pre-bouncer-approved places
stranded.

This commit:
- New migration drops + re-adds photo_backfill_runs_mode_check with all three
  permitted values: 'initial' (legacy alias for 18 historical terminal-state rows),
  'pre_photo_passed' (current default), 'refresh_servable' (Bouncer-approved
  maintenance).
- Flips column default 'initial' -> 'pre_photo_passed'.
- Updates column comment to reflect rewritten I-PHOTO-FILTER-EXPLICIT invariant.
- Post-condition DO block fails loud if constraint or default is missing post-apply.
- INVARIANT_REGISTRY.md: rewrite I-PHOTO-FILTER-EXPLICIT under three values; register
  new I-DB-ENUM-CODE-PARITY (CI-gated structural prevention of TS-rename-without-SQL
  drift; same class as ORCH-0540).
- scripts/ci-check-invariants.sh: new I-DB-ENUM-CODE-PARITY gate asserts the
  BackfillMode TS union and the photo_backfill_runs.mode CHECK constraint are
  permutation-equal value sets.

Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md
Spec:          Mingla_Artifacts/specs/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md
Unblocks:      ORCH-0682 Steps 2+3 (Lagos + 8-city operational recovery)

Apply order: supabase db push BEFORE deploying any UI changes.
No edge function changes. No EAS update required.
```

**Commit 2 — admin error-body unwrapper + wires:**

```
fix(admin): ORCH-0686 surface real edge-function error bodies in admin toasts

Constitution #3 sub-finding F-4 from ORCH-0686 investigation: the Supabase JS client
wraps non-2xx responses in a FunctionsHttpError whose .message is the generic string
"Edge Function returned a non-2xx status code". The actual body containing the real
error (Postgres constraint name, edge fn diagnostic, etc.) lives in error.context as
an unread Response. The admin's invoke helpers re-threw error.message verbatim, so
operators saw a generic toast and could not diagnose without reading edge logs.

This commit:
- New helper mingla-admin/src/lib/edgeFunctionError.js mirrors
  app-mobile/src/utils/edgeFunctionError.ts (port to JS, same duck-type Response,
  text-first body read, never throws).
- PlacePoolManagementPage.jsx local invoke helper unwraps the body before re-throwing.
- SignalLibraryPage.jsx invokeWithRefresh consumers unwrap the body before re-throwing.

Toast description on a forced 500 now contains the real Postgres error text instead
of the generic SDK message. Future bugs of the same shape will be self-diagnosing.

Spec: Mingla_Artifacts/specs/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md
```

**Order:** apply migration → push commit 1 → push commit 2. The reverse order would temporarily ship an admin UI that runs against a still-broken DB; the order specified guarantees green at every step.

## 9. Deploy Notes

- **Migration:** `supabase db push` — applies `20260426000001_orch_0686_photo_backfill_mode_constraint.sql`. Apply BEFORE the admin UI commit ships.
- **No edge function deploy.** Verify with `git diff --name-only main..HEAD -- supabase/functions/` (must be empty).
- **No EAS update.** Admin only. Mobile is unaffected.
- **No native module changes.** No `eas build` required.
- **CI:** verify `bash scripts/ci-check-invariants.sh` exits cleanly (modulo any pre-existing baseline gates documented in prior ORCHs).

## 10. Regression Prevention

The class of bug being fixed is "TypeScript rename whose value lands in a SQL CHECK-constrained column without a matching migration." Three structural safeguards:

1. **`I-DB-ENUM-CODE-PARITY` invariant + CI gate** — fires on every CI run. Future renames must update both the TS union and the SQL constraint in the same change or CI fails.
2. **Migration post-condition DO block** — fails the migration if the constraint or default is missing post-apply, so no silent partial application.
3. **Mandatory live-fire on PR review** — orchestrator reviewer should confirm that any future spec touching a persisted enum/union value writes a corresponding migration step. This is captured as discovery D-1 from ORCH-0686 for spec-template improvement.

The same shape was caught at ORCH-0540 (PL/pgSQL type-resolution). This is the second occurrence; the structural gate prevents a third.

## 11. Constitutional & Invariant Audit

| Reference | Status | Note |
|---|---|---|
| Constitution #2 — One owner per truth | ✅ strengthened | SQL CHECK is the source of truth for allowed modes; TS union mirrors; CI gate enforces single-source. |
| Constitution #3 — No silent failures | ✅ improved | Admin toasts now show real Postgres error text instead of generic SDK message. |
| Constitution #8 — Subtract before adding | ✅ honored | Migration drops the obsolete 2-value constraint cleanly before adding the 3-value one. No new code paths added beyond the helper + gate. |
| Constitution #14 — Persisted-state startup | ✅ ok | Legacy 18 rows continue to read back correctly (terminal-state only; verified F-3). |
| `I-PHOTO-FILTER-EXPLICIT` | ✅ rewritten | New 3-value statement registered. |
| `I-DB-ENUM-CODE-PARITY` | ✅ new | CI-gated structural prevention. |
| `I-PRE-PHOTO-BOUNCER-SOLE-WRITER` / `I-IS-SERVABLE-SINGLE-WRITER` / `I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO` | ✅ unaffected | No edge function code touched. |

## 12. Forbidden Patterns (binding)

- **Do NOT** drop the `'initial'` value from the new constraint (would orphan 18 historical rows).
- **Do NOT** write a data migration to relabel legacy rows.
- **Do NOT** modify `parseBackfillMode` (its current coercion is acceptable per investigation §F-3).
- **Do NOT** modify any file under `supabase/functions/`.
- **Do NOT** modify `invokeWithRefresh` in `mingla-admin/src/lib/supabase.js`.
- **Do NOT** generalize the helper across other admin pages (out of scope; future ORCH).
- **Do NOT** skip the post-condition DO block in the migration.
- **Do NOT** combine the two commits — keep migration/invariant/CI separate from admin UI changes for clean revert.
- **Do NOT** include `Co-Authored-By` in commit messages (per `feedback_no_coauthored_by.md`).

## 13. Implementor Output Requirements

Produce `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT_REPORT.md` containing:

1. Verbatim outputs from the post-migration DB queries (constraint def, column default, legacy-row count).
2. Verbatim outputs from T-01 through T-06 SQL probes.
3. Diff summary: 1 new migration + 1 new helper + 2 wired pages + 1 invariant registry update + 1 CI gate addition. No edge-function changes.
4. Negative-control evidence for T-11 (CI gate fires with both value sets).
5. Live-fire screenshots / payload captures for T-08, T-09, T-10 (plus the toast text from T-10).
6. Run ID(s) created during T-08/T-09 — orchestrator will use them to confirm SC-14 unblocks ORCH-0682.
7. Two-commit hashes + push status.
8. Any deviations from spec, with justification.

---

**Spec ends here.** Implementor cannot deviate without orchestrator re-approval.

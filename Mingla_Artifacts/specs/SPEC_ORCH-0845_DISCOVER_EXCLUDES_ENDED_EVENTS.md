# SPEC — ORCH-0845: Discover excludes ended events on every code path

**Mode:** SPEC (no implementation)
**Skill:** Claude `mingla-forensics`
**Date:** 2026-05-15
**Investigation:** [`reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md`](../reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md)
**Dispatch:** [`prompts/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md`](../prompts/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:** High — investigation was `root cause proven`, fix is one-file, no DB / no client, scope locked.

---

## 1. Summary (layman first)

The `discover-merged-events` edge function currently only filters out past events when the user picks a date chip ("Tonight", "This Weekend", "This Month"). On the default "All" view and on the category/vibe/music chips that don't carry a date window, the function returns every public event whose status is still `scheduled` or `live` — and because nothing in the system auto-flips status to `ended` when end-time passes, those rows leak past their actual end.

This spec moves the "end time has not passed yet" filter onto the always-applied query path. After implementation, an event vanishes from Discover the instant its master `event_dates.end_at` is in the past, on every filter combination. No database change, no client change, no native build. Just one file (`supabase/functions/discover-merged-events/index.ts`), two regression tests, one strict-grep gate, one new invariant.

---

## 2. Scope, Non-Goals, Assumptions

### 2.1 Scope (locked)

S-1. `supabase/functions/discover-merged-events/index.ts` — unify the `event_dates` embed to `!inner` on both code paths; move `.eq("event_dates.is_master", true)` and `.gte("event_dates.end_at", lowerBoundUtc)` to the unconditional query construction; update inline rationale comments.

S-2. `Mingla_Artifacts/INVARIANT_REGISTRY.md` — register new invariant **I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE**.

S-3. `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs` — new CI gate enforcing the invariant by presence-check on the edge function source.

S-4. `.github/workflows/strict-grep-mingla-business.yml` — register the new gate per `feedback_strict_grep_registry_pattern.md` (one script + one job).

S-5. Two regression tests, both at real paths under the repo, both append-only (per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 gate):
- S-5a (implementor-written, happy-path): `supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts`
- S-5b (tester-written, adversarial): `supabase/functions/discover-merged-events/__tests__/end_at_boundary.test.ts`

### 2.2 Non-Goals (explicitly out of scope)

NG-1. **No DB migration.** `event_dates.end_at` is already `NOT NULL` with `CHECK (end_at > start_at)` per the latest squash baseline. No column add, no constraint change, no RLS edit, no RPC change.

NG-2. **No client change.** `app-mobile/` and `mingla-business/` are untouched. The Discover screen, hooks, services, and mergedDiscover types do not change shape.

NG-3. **No `events.status` auto-transition.** `events.status='ended'` remains operator-set only. Adding a pg_cron job or trigger to flip status when `end_at` passes is registered as INVESTIGATION §8 discovery #2 and is OUT of this spec.

NG-4. **No `computeIsPast` unification at checkout.** The `mingla-business/app/checkout/[eventId]/index.tsx:59-67` heuristic (`start + 24h`) is a separate hidden flaw registered as INVESTIGATION §8 discovery #1. Centralizing "is past" semantics across Discover + PublicEventPage + Checkout will be its own future ORCH. OUT of this spec.

NG-5. **No Ticketmaster change.** TM filtering is delegated to TM's API via `localStartEndDateTime`; not affected by this bug and not modified here.

NG-6. **No `discover-cards` change.** Different system (place pool); unaffected.

NG-7. **No expansion to other Discover query bodies.** This spec touches the single function `discover-merged-events`. If any other Discover endpoint exists or is added later, it gets its own ORCH.

### 2.3 Assumptions

A-1. `event_dates.end_at` is `NOT NULL` on every row of `event_dates`. Verified Layer 2 in the investigation. The implementor MUST re-grep `supabase/migrations/` for `event_dates` and abort if any later migration has dropped or weakened this constraint.

A-2. Every `events` row with `status IN ('scheduled','live')` has at least one master `event_dates` row. Backed by I-PROPOSED-AX EVENT_HAS_MASTER_DATE (ORCH-0792 [event_dates publish + master-date invariant]) + trigger `biz_enforce_event_has_master_date` (verified in production via `pg_proc`). Therefore switching the embed from `!left` to `!inner` is logically a no-op for all legitimate scheduled/live rows.

A-3. The Edge function's local `new Date().toISOString()` and the database's `now()` are within ~200ms of each other for the purposes of a single request. PostgREST applies the literal `lowerBoundUtc` server-side as a filter predicate, so the comparison happens against `event_dates.end_at` (Postgres `timestamptz`) — there is no clock drift inside the comparison itself, only between the Edge runtime's "now" decision and Postgres's "now()" had we used it. Accepted.

A-4. Deno test runner is available on the implementor's machine and CI for `*.test.ts` files under `supabase/functions/`. Per memory `feedback_orchestrator_deploys_edge_functions.md`, the orchestrator deploys edge functions after migration push — but tests run in CI / locally without deploy.

---

## 3. Layer-by-layer specification

### 3.1 Database

**No changes.** Re-verify the latest migration:

```bash
grep -rn "event_dates" supabase/migrations/ | grep -i "CREATE TABLE\|ALTER.*end_at\|end_at"
```

Confirm the latest authoritative definition still matches:
```
event_dates.end_at  timestamp with time zone NOT NULL
CONSTRAINT event_dates_end_after_start CHECK (end_at > start_at)
```
(Currently at `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:8213,8221`.)

If any later migration weakens this, the implementor MUST abort and re-dispatch — spec assumption A-1 fails.

### 3.2 Edge function — `supabase/functions/discover-merged-events/index.ts`

#### 3.2.1 Current code (frozen reference — investigation §3 Layer 3)

```ts
// Lines 283-285 (CURRENT)
const eventDatesEmbed = dateWindowUtc !== null
  ? "event_dates!inner ( id, start_at, end_at, timezone, is_master )"
  : "event_dates!left ( id, start_at, end_at, timezone, is_master )";

// Lines 287-319 (CURRENT base query — abbreviated)
let q = supabase
  .from("events")
  .select(
    `... ${eventDatesEmbed} ...`,
    { count: "exact" },
  )
  .is("deleted_at", null)
  .eq("visibility", "public")
  .in("status", ["scheduled", "live"])
  // (party/vibe/genre filters omitted for brevity — they stay as-is)
  .in("city", [...cityVariants]);

// Lines 344-349 (CURRENT — only applies when window is set)
if (dateWindowUtc !== null) {
  q = q
    .eq("event_dates.is_master", true)
    .gte("event_dates.end_at", dateWindowUtc.startUtc)
    .lte("event_dates.start_at", dateWindowUtc.endUtc);
}
```

#### 3.2.2 Required new code shape

```ts
// 1. Unified embed — always !inner
const eventDatesEmbed =
  "event_dates!inner ( id, start_at, end_at, timezone, is_master )";

// 2. Single reference-time decision before query build
//    No-window path → "now" at request time (UTC ISO string).
//    Dated-chip path → the window's start UTC.
const lowerBoundUtc: string =
  dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString();

// 3. Always-on master-date + end-time floor in the base query
let q = supabase
  .from("events")
  .select(
    `... ${eventDatesEmbed} ...`,
    { count: "exact" },
  )
  .is("deleted_at", null)
  .eq("visibility", "public")
  .in("status", ["scheduled", "live"])
  // (party/vibe/genre filters unchanged)
  .in("city", [...cityVariants])
  .eq("event_dates.is_master", true)
  .gte("event_dates.end_at", lowerBoundUtc);

// 4. Upper-bound filter stays conditional inside the dated-chip branch
if (dateWindowUtc !== null) {
  q = q.lte("event_dates.start_at", dateWindowUtc.endUtc);
}
```

#### 3.2.3 Mandatory diff requirements

D-1. The `eventDatesEmbed` ternary at lines 283-285 is removed. Replaced by a single `const eventDatesEmbed = "event_dates!inner ( id, start_at, end_at, timezone, is_master )"`.

D-2. A new `const lowerBoundUtc: string` is computed BEFORE the query builder is invoked, exactly as in §3.2.2 step 2. The variable name MUST be `lowerBoundUtc` (the strict-grep gate and the spec read tests look for this token).

D-3. `.eq("event_dates.is_master", true)` and `.gte("event_dates.end_at", lowerBoundUtc)` are appended to the unconditional `q = supabase.from("events").select(...).is(...).eq(...).in(...).in(...)` chain. They MUST NOT live inside any `if` branch.

D-4. The remaining content of the `if (dateWindowUtc !== null)` block is reduced to the single line `q = q.lte("event_dates.start_at", dateWindowUtc.endUtc);`. The two lines that moved out (`.eq("is_master")` and `.gte("end_at")`) MUST NOT be duplicated inside the `if`.

D-5. Comment block at lines 331-343 is rewritten as a unified ORCH-0845 rationale that preserves the prior ORCH-0828 / ORCH-0839-A reasoning AND adds the no-window-path explanation. Required content (paraphrasing acceptable, ORCH-IDs and invariant names mandatory):
- ORCH-0828 [Consumer Discover timezone + sheet bugs] introduced the dated-chip date-window math.
- ORCH-0839-A [Discover hardening] F-5 switched the dated-chip lower bound from `start_at >= window.start` to `end_at >= window.start` so in-progress events stay visible — invariant `I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS` is preserved.
- ORCH-0845 [Discover excludes ended events] makes the `end_at >= lowerBoundUtc` floor always-on (no-window path uses `now()` server-clock equivalent computed in the Edge runtime as `new Date().toISOString()`). Invariant `I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE` is established.
- Schema reassurance: `event_dates.end_at` is `NOT NULL` with `CHECK (end_at > start_at)` per the squash baseline; no `COALESCE` fallback needed. I-PROPOSED-AX EVENT_HAS_MASTER_DATE guarantees every `scheduled`/`live` row has a master `event_dates` row, so the `!inner` embed is safe.

D-6. Imports, types, and the rest of the file (Ticketmaster fan-out, response shaping, ranking, error paths, CORS) are UNCHANGED. No incidental refactors.

D-7. The function's `verify_jwt` setting in `supabase/config.toml` is UNCHANGED (`verify_jwt = false` — anon-callable). Implementor MUST verify before deploy.

### 3.3 Service / hook / component layer

**No changes.** The response shape from `discover-merged-events` (`BusinessEventCard[]`, `tmCount`, `businessCount`, `meta`, etc.) is unchanged. Mobile callers (`app-mobile/src/services/nightOutExperiencesService.ts`, `app-mobile/src/components/DiscoverScreen.tsx`, etc.) require no edits.

### 3.4 Realtime

N/A — Discover is fetch-on-mount + foreground-refresh; no realtime channel involved.

### 3.5 Tests (mandatory per ORCH-0840 Step 0.5 gate)

#### 3.5.1 Implementor-written happy-path regression test — S-5a

**Path:** `supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts`

**Runtime:** Deno (`deno test --allow-net --allow-env`).

**Test shape (binding contract — implementor may rephrase, must not weaken):**

```ts
import { assertEquals, assert } from "https://deno.land/std@0.190.0/assert/mod.ts";

Deno.test("ORCH-0845 — ended events are excluded from default 'All' filter", async () => {
  // Setup: insert a fixture event with master end_at in the past.
  //   - status = 'scheduled'
  //   - visibility = 'public'
  //   - deleted_at = NULL
  //   - city = 'Raleigh' (or any city the test fixture supports)
  //   - event_dates: is_master = true, end_at = now() - interval '1 hour',
  //                  start_at = end_at - interval '2 hours' (so CHECK passes)
  //
  // Action: invoke handler with payload { city: { name: "Raleigh" } } — no localStartEndDateTime.
  //
  // Assert: response.items does NOT contain the seeded event id.
  //         response.meta.businessCount does NOT include this event.
});

Deno.test("ORCH-0845 — future events still appear on default 'All' filter", async () => {
  // Setup: same fixture but end_at = now() + interval '2 hours'.
  // Assert: response.items DOES contain the seeded event id.
});
```

**Implementor responsibility:**
- Wire the test to whatever harness pattern other `supabase/functions/**/*.test.ts` files use (mock Supabase client OR seed → invoke handler → tear down, whichever matches local convention; if no convention exists, implementor establishes one for this function and documents it in the implementation report).
- Both `Deno.test` blocks above are REQUIRED. They are co-located in the same file so the contrast (past = excluded, future = included) is a single review artifact.
- Implementation report MUST include the line: `fails-on-revert verified at <commit hash>` where `<commit hash>` is a real local commit hash demonstrating that reverting D-3 (removing `.gte("event_dates.end_at", lowerBoundUtc)` from the base query) causes BOTH `Deno.test` blocks to either fail (the past-event one) or pass-vacuously (the future-event one only — which alone is not the bug exercise; revert verification is on the past-event test specifically).

**Why the "fails-on-revert" line is on the past-event test:** the past-event test is the one that exercises the bug. The future-event test is a guard against the implementor over-correcting (e.g., accidentally filtering out everything).

#### 3.5.2 Tester-written adversarial regression test — S-5b

**Path:** `supabase/functions/discover-merged-events/__tests__/end_at_boundary.test.ts`

**Attack vector (binding):** Boundary condition on the `>=` comparison.

**Test shape (binding contract — tester may rephrase, must attack the same angle):**

```ts
Deno.test("ORCH-0845 — boundary: end_at exactly equal to now() includes event", async () => {
  // Setup: pin a deterministic reference moment T = some ISO timestamp the test controls.
  // Seed event with end_at = T (exactly equal, not before, not after).
  // Mock `new Date()` (or pass a reference-time override into the handler) so lowerBoundUtc = T.
  // Assert: event IS returned. ( end_at >= lowerBoundUtc holds for equal-to. )
});

Deno.test("ORCH-0845 — boundary: end_at 1 ms before now() excludes event", async () => {
  // Same fixture, but end_at = T - 1 millisecond.
  // Assert: event is NOT returned.
});

Deno.test("ORCH-0845 — adversarial: empty city result is { items: [], businessCount: 0 }, not error", async () => {
  // City with no public events at all. Confirm response shape is the empty-but-valid case,
  // not a 500 or a malformed payload. Guards against the !inner switch accidentally
  // converting a no-rows case into a broken response.
});
```

**Tester responsibility:**
- The three `Deno.test` blocks above (or functional equivalents) attack THREE different angles the implementor's happy-path test does NOT exercise: equality at the boundary, 1-ms-before exclusion, and the empty-response shape under the new `!inner` embed.
- QA report MUST cite the file path + a passing run + a `fails-on-revert verified at <commit hash>` line where reverting D-1 (changing the embed back to `!left`) does NOT break the boundary tests, but reverting D-3 DOES break the boundary tests. This proves the adversarial test attacks the floor predicate specifically.
- If the tester finds that an even more dangerous adversarial angle exists (e.g., timezone-DST boundary, multiple non-master date rows), they may ADD a fourth `Deno.test` covering it. They MAY NOT replace the three above with weaker tests.

**Forbidden:** A renamed copy of the happy-path test. The Step 0.5 gate explicitly rejects this pattern (per ORCH-0840 close criteria).

### 3.6 Invariants

#### 3.6.1 Preserved (no change required)

- **I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS** — the dated-chip path still uses `end_at >= window.start` as the lower bound; events that have started but not ended remain visible under "Tonight". This SPEC does not weaken or modify it.
- **I-PROPOSED-AX EVENT_HAS_MASTER_DATE** — relied on by assumption A-2; SPEC does not modify the trigger or the invariant.

#### 3.6.2 Newly established

**I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE.** Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` (alphabetical / by-ID placement following existing conventions). Exact text:

> **I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE.** The `discover-merged-events` edge function MUST always filter `event_dates.end_at >= lowerBoundUtc` on the master date row of every business event candidate, where `lowerBoundUtc = dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString()`. The filter applies on BOTH the no-date-window code path AND the dated-chip code path. Events whose master `event_dates.end_at` is in the past MUST NOT appear in the response under any filter combination. Backed by ORCH-0845 [Discover excludes ended events]. Enforced by CI gate `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs`.

### 3.7 Strict-grep CI gate

**Path:** `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs`

**Detection rule (presence-check):** The file `supabase/functions/discover-merged-events/index.ts` MUST contain BOTH of the following substrings, each on a non-comment line:

- `.gte("event_dates.end_at", lowerBoundUtc)`
- `const lowerBoundUtc`

If either substring is missing (or only appears inside a `//` line-comment), the gate fails CI with exit code 1.

**Reference pattern:** Modeled on `.github/scripts/strict-grep/i-ari-no-oklch.mjs` (single-file regex scan with line-by-line comment exclusion). DO NOT use the babel-AST pattern (`i-proposed-a-brands-deleted-filter.mjs`) — over-complex for a substring check.

**Self-test note:** The gate script's filename and comments are allowed to mention the forbidden-absent tokens — the scan target is `discover-merged-events/index.ts` only, not the script itself.

**Exit codes:**
- `0` — both substrings present on non-comment lines
- `1` — at least one substring missing or only present in comments
- `2` — file system error reading the target file

### 3.8 Workflow registration

**File:** `.github/workflows/strict-grep-mingla-business.yml`

Per memory `feedback_strict_grep_registry_pattern.md`, add ONE new job following the established pattern (mirror the structure of the existing `i-ari-no-oklch` or `i-proposed-w-notifications-app-type-prefix` job). Required job content:

- Job name: `i-discover-excludes-ended-master-date`
- Triggers on paths: `supabase/functions/discover-merged-events/**` and `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs`
- Step: `run: node .github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs`

DO NOT create a parallel workflow file. DO NOT modify any existing job.

---

## 4. Success criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| **SC-01** | Calling `discover-merged-events` with `{ city: { name: "Raleigh" } }`, no `localStartEndDateTime`, no facet filters, returns a response in which event `549e0a64-c133-43c3-ac1c-1ecc6055c992` (Big Party — master `end_at = 2026-05-15 02:00:00+00`) is NOT in `items` and is not counted in `meta.businessCount`. | Direct POST to the deployed edge function via `curl` or `mcp__supabase__list_edge_functions` invocation logs; orchestrator runs the probe post-deploy. |
| **SC-02** | Same call as SC-01 with any combination of `partyTypeSlugs` / `vibeTagSlugs` / `musicGenreSlugs` MUST NOT return event `b6122ef8-dc76-47d6-94a3-717450acff4f` (Friday Free Sunset Mixer QA — ended 6 days ago). | Same as SC-01 with additional facet filters. |
| **SC-03** | `I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS` is preserved: an event with `start_at = now() - 30 minutes, end_at = now() + 2 hours` IS returned under the "Tonight" window. | Implementor seeds the fixture before edge-function deploy; orchestrator includes the probe in the deploy verification step. |
| **SC-04** | `git diff` from the implementor's PR head against `Seth` base touches ONLY: `supabase/functions/discover-merged-events/index.ts`, `Mingla_Artifacts/INVARIANT_REGISTRY.md`, `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs`, `.github/workflows/strict-grep-mingla-business.yml`, `supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts`, plus the implementation report. NO migration files. NO mobile / business / admin files. | `git diff --stat Seth...HEAD` review at orchestrator REVIEW step. |
| **SC-05** | The strict-grep gate `i-discover-excludes-ended-master-date.mjs` exits 0 on the head commit AND exits 1 when D-3 (the `.gte` line) is synthetically reverted. Both outcomes captured in the implementation report. | Implementor runs both, captures stdout/exit codes. |
| **SC-06** | Happy-path regression test S-5a passes; both Deno.test blocks succeed; `fails-on-revert verified at <commit hash>` line present in implementation report citing a real hash. | Tester re-runs in QA. |
| **SC-07** | Adversarial regression test S-5b passes; three Deno.test blocks succeed (boundary equal, boundary 1ms-before, empty-city); `fails-on-revert verified at <commit hash>` line present in QA report. | Tester writes the test, captures the runs. |
| **SC-08** | The deployed edge function preserves `verify_jwt = false` (anon-callable). Pre-existing anon callers (`app-mobile` Discover) continue to work without auth tokens. | `mcp__supabase__list_edge_functions` post-deploy returns `verify_jwt: false` for the new version. |
| **SC-09** | Ghost-inventory probe re-run after deploy returns zero rows: `SELECT count(*) FROM events e JOIN event_dates ed ON ed.event_id=e.id AND ed.is_master=true WHERE e.deleted_at IS NULL AND e.visibility='public' AND e.status IN ('scheduled','live') AND ed.end_at < now()` STILL returns >0 (because rows in DB don't change), BUT a direct `discover-merged-events` POST returns zero ghost-inventory rows. The fix is at READ time, not DB time. | Orchestrator runs both queries post-deploy. |

---

## 5. Test cases (binding)

| ID | Scenario | Input | Expected | Layer | Owner |
|----|----------|-------|----------|-------|-------|
| T-01 | Ended event excluded under "All" | Past `end_at`, no `localStartEndDateTime` | Event NOT in response | Edge fn | Implementor (S-5a) |
| T-02 | Future event included under "All" | Future `end_at`, no `localStartEndDateTime` | Event IS in response | Edge fn | Implementor (S-5a) |
| T-03 | In-progress event included under "Tonight" | `start_at = now()-30min, end_at = now()+2h`, Tonight window | Event IS in response | Edge fn | SC-03 probe |
| T-04 | Boundary equal: `end_at == lowerBoundUtc` | exact equality | Event IS in response (`>=` semantics) | Edge fn | Tester (S-5b) |
| T-05 | Boundary 1ms before: `end_at == lowerBoundUtc - 1ms` | strict before | Event NOT in response | Edge fn | Tester (S-5b) |
| T-06 | Empty city | City with zero matching events | `{ items: [], meta: { businessCount: 0, ... } }`, HTTP 200 | Edge fn | Tester (S-5b) |
| T-07 | Strict-grep gate green on head | run gate against current file | exit 0 | CI | Implementor SC-05 |
| T-08 | Strict-grep gate fails on synthetic revert | revert D-3, run gate | exit 1 | CI | Implementor SC-05 |
| T-09 | Post-deploy SC-01 probe | POST with Raleigh city | Big Party absent | Live | Orchestrator |
| T-10 | Post-deploy SC-02 probe | POST with Raleigh + any facet | Friday Free Sunset Mixer QA absent | Live | Orchestrator |
| T-11 | `verify_jwt` preserved | post-deploy `list_edge_functions` | `verify_jwt: false` | Config | Orchestrator |

---

## 6. Implementation order (binding)

1. Grep `supabase/migrations/` for `event_dates` and confirm assumption A-1 holds. If broken, ABORT and re-dispatch to orchestrator.
2. Edit `supabase/functions/discover-merged-events/index.ts` per §3.2 D-1 through D-7. Run `deno check supabase/functions/discover-merged-events/index.ts` until clean.
3. Create `supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts` per §3.5.1. Run `deno test --allow-net --allow-env supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts` until green.
4. Revert §3.2 D-3 locally, re-run the test, capture the FAIL output and the commit hash of the reverted state, then restore D-3. Record both hashes in the implementation report as `fails-on-revert verified at <revert-hash>; restored at <restore-hash>`.
5. Add `I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE` to `Mingla_Artifacts/INVARIANT_REGISTRY.md` per §3.6.2.
6. Create `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs` per §3.7. Run `node .github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs` — confirm exit 0. Temporarily delete the `.gte` line in the target file, re-run the gate, confirm exit 1, restore the line. Capture both results in the implementation report.
7. Add the new job to `.github/workflows/strict-grep-mingla-business.yml` per §3.8.
8. Run all existing strict-grep gates locally on the changed file to confirm zero regressions: `node .github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs` etc. (or whichever gates cover edge functions — implementor lists which apply in the report).
9. Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md` with: old→new diff receipts (the 6 lines that change in `index.ts`), test output captures, gate output captures, fails-on-revert proof, files-changed list matching SC-04 exactly.

The tester's adversarial test (S-5b) is written by the tester AFTER the implementor returns, NOT by the implementor. The tester writes it during TARGETED sub-mode verification.

---

## 7. Regression prevention

R-1. **Structural safeguard:** The new strict-grep gate `i-discover-excludes-ended-master-date.mjs` ensures the two key tokens (`lowerBoundUtc` and `.gte("event_dates.end_at", lowerBoundUtc)`) cannot be silently removed from the edge function. A future contributor who renames `lowerBoundUtc` to something else MUST also update the gate, forcing intentional decision-making.

R-2. **Test safeguard:** S-5a's "ended event excluded" Deno.test exercises the bug directly. ORCH-0840 [Regression-test enforcement + append-only CI] forbids deletion of this test; modifications require a new ORCH with `[TEST-MOD-APPROVED ORCH-NNNN]` in the commit body.

R-3. **Documentation safeguard:** The rewritten comment block at lines 331-343 of `index.ts` carries forward the ORCH-0828 / ORCH-0839-A / ORCH-0845 chain so future readers see the full reasoning timeline, not just the latest layer.

R-4. **Invariant safeguard:** `I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE` is a public, registered rule. Any future Discover-touching ORCH must check the invariant registry as part of Phase 0 ingestion.

---

## 8. Rollback plan

**Trigger:** Operator reports that legitimate upcoming events have disappeared from Discover after the deploy, OR that the edge function is returning 5xx errors that did not occur pre-deploy.

**Procedure:**

1. Identify the pre-deploy `discover-merged-events` version via `mcp__supabase__list_edge_functions`.
2. Redeploy that prior version via `/Users/sethogieva/bin/supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv` from the git ref that contains the prior code (one commit before the ORCH-0845 close).
3. Verify rollback via `mcp__supabase__list_edge_functions` shows the version number incremented again (each deploy bumps the version, even for "the same code"). Note the new version number is post-rollback even though semantically it matches pre-ORCH-0845.
4. Open a hot-fix ORCH-0845-A. Do NOT revert the invariant entry, the gate, or the regression tests — those stay. Only the function source is rolled back. The gate will then fail CI, which is the correct signal: the codebase is in a known-broken state until the implementor returns with a corrected fix.

**Recovery time objective:** < 5 minutes (single edge-function deploy).

**Data integrity:** No DB rollback needed. No data loss possible — this change is read-side only.

---

## 9. Confidence

`High` — investigation was `root cause proven` with full five-truth-layer evidence; fix is single-file, no DB, no client, no native; assumptions are backed by live schema probes and ORCH-0792 invariants; rollback is one edge-function redeploy; both tests have explicit fails-on-revert verification baked into success criteria.

---

## 10. Cross-references

- Investigation: [`reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md`](../reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md)
- Dispatch: [`prompts/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md`](../prompts/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md)
- Prior Discover specs (preserved, not modified): SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER, SPEC_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS, SPEC_ORCH-0839-A_DISCOVER_HARDENING.
- Invariant registry: `Mingla_Artifacts/INVARIANT_REGISTRY.md` (entry I-PROPOSED-AX preserved; new I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE added per §3.6.2).
- Memory: `feedback_strict_grep_registry_pattern.md` (one script + one job in `strict-grep-mingla-business.yml`), `feedback_orchestrator_deploys_edge_functions.md` (orchestrator owns deploy after operator's DB push — but this SPEC has no DB push), `feedback_verify_db_column_names_before_writing_queries.md` (implementor MUST re-grep migrations per implementation order step 1).

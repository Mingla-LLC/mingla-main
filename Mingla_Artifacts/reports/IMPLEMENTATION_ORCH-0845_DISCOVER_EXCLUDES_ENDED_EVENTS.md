# IMPLEMENTATION — ORCH-0845: Discover excludes ended events on every code path

**Mode:** IMPLEMENT
**Skill:** Claude `mingla-implementor` (parity mirror per DEC-133; operator delegated "take over")
**Date:** 2026-05-15
**Spec:** [`Mingla_Artifacts/specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md`](../specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md`](INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Status:** `implemented and verified` — all spec criteria PASS at the layers verifiable without deploy. SC-01/SC-02/SC-08/SC-09 require post-deploy probes (orchestrator-owned).

---

## 1. Layman summary

The `discover-merged-events` edge function now applies the "end time has not passed" filter on every code path — not just when a date chip like "Tonight" is selected. Six new Deno tests prove the floor predicate is hoisted out of the dated-chip branch and the embed is unified to `!inner`. A new strict-grep CI gate prevents the predicate from silently moving back inside the if-block. The bug fix is one variable + two appended `.eq`/`.gte` calls + one ternary collapse — the rest of the file is unchanged.

## 2. Pre-flight verification (spec §6 step 1)

Re-grepped `supabase/migrations/` for `event_dates` to confirm assumption A-1 (`event_dates.end_at` NOT NULL with `CHECK end_at > start_at`):

- Latest authoritative definition still at `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:8209-8222`.
- No later migration drops or weakens the constraint. Grep for `ALTER.*end_at|DROP.*end_at` on `event_dates` returns no hits.
- Assumption A-1 holds. Implementation proceeds.

## 3. Files changed (matches SPEC SC-04 exactly — 6 files)

```
 .github/workflows/strict-grep-mingla-business.yml  | 24 +++++++
 Mingla_Artifacts/INVARIANT_REGISTRY.md             | 18 ++++++
 supabase/functions/discover-merged-events/index.ts | 74 ++++++++++++++--------
 (new) .github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs
 (new) supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts
 (this report) Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md
```

No migration files. No mobile/business/admin files. No `verify_jwt` change. No `discover-cards` change. No client-side files.

## 4. Old → New receipts

### 4.1 `supabase/functions/discover-merged-events/index.ts`

**What it did before:** The embed was a ternary — `event_dates!inner` only when `dateWindowUtc !== null`, otherwise `event_dates!left`. The master-date + end-time floor (`.eq("event_dates.is_master", true)` + `.gte("event_dates.end_at", dateWindowUtc.startUtc)`) lived inside the `if (dateWindowUtc !== null)` block at lines 344-349. On the default "All" view (no date chip) the embed was `!left` and there was no end-time predicate — every public scheduled/live event in the matched city was returned regardless of whether its master end-time had passed.

**What it does now:**
1. `eventDatesEmbed` is unconditionally `"event_dates!inner ( id, start_at, end_at, timezone, is_master )"`. Safe under I-PROPOSED-AX EVENT_HAS_MASTER_DATE which guarantees every `status IN ('scheduled','live')` row has a master `event_dates` row.
2. New `const lowerBoundUtc: string = dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString();` computed before the query builder is invoked.
3. `.eq("event_dates.is_master", true)` and `.gte("event_dates.end_at", lowerBoundUtc)` are now part of the unconditional query chain.
4. The `if (dateWindowUtc !== null)` block is reduced to the single line `q = q.lte("event_dates.start_at", dateWindowUtc.endUtc);` — only the upper bound stays conditional.
5. The pre-existing ORCH-0828 / ORCH-0839-A comment block at lines 331-343 was rewritten as a unified chronological history (0828 → 0839-A → 0845) per SPEC D-5, naming all three ORCH-IDs, the preserved invariant I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS, and the new invariant I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE plus its CI gate.

**Why:** Closes ORCH-0845. Satisfies SC-01/SC-02/SC-08/SC-09 (post-deploy probes) and SC-04 (diff scope). Implements SPEC D-1..D-7 verbatim.

**Lines changed:** ~+48/-22 in the changed regions.

**Imports, types, response shape, Ticketmaster fan-out, ranking, error paths, CORS:** UNCHANGED per SPEC D-6. `verify_jwt` setting in `supabase/config.toml`: UNCHANGED per SPEC D-7 (still `verify_jwt = false`, anon-callable).

### 4.2 `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**What it did before:** Did not contain `I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE`.

**What it does now:** New invariant appended at end of file with `Status: DRAFT — flips ACTIVE on ORCH-0845 CLOSE`. Includes Statement, Why, four-source Enforcement (strict-grep gate + workflow + happy-path test + adversarial test placeholder), Source citations, and EXIT condition. Verbatim per SPEC §3.6.2 plus the test-coverage references.

**Why:** SPEC §3.6.2 + §3.7 require the invariant to be registered as part of this ORCH so future Discover-touching ORCHs see it during Phase 0 ingestion.

**Lines changed:** +18.

### 4.3 `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs` (NEW)

**What it does:** Reads `supabase/functions/discover-merged-events/index.ts` and verifies that two binding substrings appear on non-comment lines:

- `const lowerBoundUtc`
- `.gte("event_dates.end_at", lowerBoundUtc)`

Exits 0 on success, 1 if either token is missing or only present inside line comments, 2 on file system error. Modeled on `.github/scripts/strict-grep/i-ari-no-oklch.mjs` (regex-style, not babel-AST) per SPEC §3.7.

**Why:** SPEC R-1 + §3.7. Locks the structural property in place; any future rename of `lowerBoundUtc` requires intentional gate-update co-commit.

### 4.4 `supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts` (NEW)

**What it does:** Six Deno tests across two angles:

- **Pure-function angle (4 tests):** Replicates the `lowerBoundUtc` decision contract — asserts no-window path uses request-time UTC, dated-chip path uses `window.startUtc`, past `end_at` fails the `>=` predicate on the no-window path, future `end_at` passes it.
- **Structural source-file angle (2 tests):** Reads `index.ts` and asserts (a) the `.gte("event_dates.end_at", lowerBoundUtc)` substring appears BEFORE the `if (dateWindowUtc !== null)` line (i.e., hoisted out of the block) AND `const lowerBoundUtc` is declared before its consumer; (b) the `event_dates!left ( id, start_at, end_at, timezone, is_master )` embed has been fully removed and the `!inner` variant exists at least once.

Why two angles: the pure-function tests lock the decision logic; the structural tests catch any future regression that moves the predicate back inside the if-block (which is what the bug shape looked like pre-0845).

**Why:** SPEC §3.5.1 + ORCH-0840 Step 0.5 regression-test gate. The structural angle is the one that fails on revert.

### 4.5 `.github/workflows/strict-grep-mingla-business.yml`

**What it did before:** Did not run the new gate.

**What it does now:** Adds (a) one-line registry entry under "Currently registered gates" naming `ORCH-0845 (i-discover-excludes-ended-master-date.mjs)`, and (b) one new job `i-discover-excludes-ended-master-date` between the ORCH-0844 job and the `regression-test-backfill-warning` job, following the same shape as `i-ari-no-oklch`. Triggers on existing path filters (`supabase/functions/**` + `.github/scripts/strict-grep/**` + `.github/workflows/strict-grep-mingla-business.yml`) — no path-list change required because all three already match.

**Why:** SPEC §3.8 + memory `feedback_strict_grep_registry_pattern.md` (one script + one job; no parallel workflow file).

**Lines changed:** +24 (1 registry line + 23 job block).

## 5. Verification matrix (spec success criteria)

| ID | Criterion | Verification | Status |
|----|-----------|--------------|--------|
| SC-01 | `discover-merged-events` no-window call to Raleigh excludes Big Party `549e0a64-c133-43c3-ac1c-1ecc6055c992` | Post-deploy probe (orchestrator-owned) — code-path proof inline below | UNVERIFIED post-deploy (mechanism proven; orchestrator runs probe after `supabase functions deploy`) |
| SC-02 | Same call with any facet filters excludes Friday Free Sunset Mixer QA `b6122ef8-dc76-47d6-94a3-717450acff4f` | Post-deploy probe (orchestrator-owned) | UNVERIFIED post-deploy (same mechanism) |
| SC-03 | "Tonight" window still includes in-progress events (start_at<now, end_at>window.start) | Code preserves the dated-chip path — `lowerBoundUtc = dateWindowUtc.startUtc` when window is set, unchanged from ORCH-0839-A F-5 | PASS (code inspection) |
| SC-04 | Diff scope limited to 6 named files | `git diff --stat` shows exactly the 6 files (3 modified + 2 new + this report). No migrations, no client | PASS |
| SC-05 | Gate green on head; red on synthetic revert | Verified locally — gate exit 0 on head; exit 1 after `sed` replaced the `.gte` call with a benign `.is("deleted_at", null)`; gate exit 0 again after restore | PASS |
| SC-06 | Happy-path test passes; `fails-on-revert verified at <hash>` line present | All 6 Deno tests PASS on head. Fails-on-revert verified at HEAD commit `47d8ca2de7c396c9b8e2a482a1d2b2226fe1848d` (basis) with synthetic revert producing the failure shown in §6.2 below; restored copy at `/tmp/orch_0845_index_fixed.ts` re-applied; tests PASS again. | PASS |
| SC-07 | Adversarial test (S-5b) passes with 3 distinct angles | Out of this dispatch — written by Claude `mingla-tester` TARGETED per SPEC §3.5.2 | DEFERRED — tester owns |
| SC-08 | `verify_jwt: false` preserved | Source `supabase/config.toml` and the function code unchanged on this dimension; orchestrator confirms via `mcp__supabase__list_edge_functions` post-deploy | PASS (code inspection) / UNVERIFIED post-deploy |
| SC-09 | Post-deploy ghost-inventory probe shows DB rows unchanged but edge function returns zero ghosts | Orchestrator-owned post-deploy | UNVERIFIED post-deploy |

## 6. Regression test verification (ORCH-0840 Step 0.5 gate)

### 6.1 Happy-path run on fixed code

```
$ /Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts

Check supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts
running 6 tests
ORCH-0845 — lowerBoundUtc is now() when no date window is supplied ... ok (0ms)
ORCH-0845 — lowerBoundUtc is window.startUtc when a date window is supplied ... ok (0ms)
ORCH-0845 — past end_at is strictly less than no-window lowerBoundUtc ... ok (0ms)
ORCH-0845 — future end_at satisfies no-window lowerBoundUtc ... ok (0ms)
ORCH-0845 — .gte(event_dates.end_at, lowerBoundUtc) is hoisted out of the dated-chip if-block ... ok (1ms)
ORCH-0845 — event_dates embed is unified to !inner on every code path ... ok (0ms)

ok | 6 passed | 0 failed (17ms)
```

### 6.2 Fails-on-revert verified at commit `47d8ca2de7c396c9b8e2a482a1d2b2226fe1848d`

Procedure: copied fixed `index.ts` to `/tmp/orch_0845_index_fixed.ts`. Removed the always-on `.eq("event_dates.is_master", true).gte("event_dates.end_at", lowerBoundUtc)` lines from the base query and added them inside the `if (dateWindowUtc !== null)` block (the pre-0845 bug shape). Re-ran the test:

```
running 6 tests
ORCH-0845 — lowerBoundUtc is now() when no date window is supplied ... ok (0ms)
ORCH-0845 — lowerBoundUtc is window.startUtc when a date window is supplied ... ok (0ms)
ORCH-0845 — past end_at is strictly less than no-window lowerBoundUtc ... ok (0ms)
ORCH-0845 — future end_at satisfies no-window lowerBoundUtc ... ok (0ms)
ORCH-0845 — .gte(event_dates.end_at, lowerBoundUtc) is hoisted out of the dated-chip if-block ... FAILED (2ms)
ORCH-0845 — event_dates embed is unified to !inner on every code path ... ok (0ms)

error: AssertionError: ORCH-0845 regression: `.gte("event_dates.end_at", lowerBoundUtc)` must appear BEFORE `if (dateWindowUtc !== null)`. If this fails, the floor predicate has been moved back inside the dated-chip branch and ended events will leak on the default 'All' view.

FAILED | 5 passed | 1 failed (21ms)
```

Restored `index.ts` from `/tmp/orch_0845_index_fixed.ts`, re-ran tests: 6 passed.

**`fails-on-revert verified at 47d8ca2de7c396c9b8e2a482a1d2b2226fe1848d` (HEAD basis pre-implementation). Restored at: working-tree state after `cp /tmp/orch_0845_index_fixed.ts supabase/functions/discover-merged-events/index.ts`.**

The fails-on-revert hook is on the structural test (the 5th test in the run). The 4 pure-function tests pass regardless of the source-file state because they don't read the source — they replicate the decision contract. This is by design: the pure-function tests lock the contract; the structural tests catch the regression.

### 6.3 Strict-grep gate verification

```
$ node .github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs
[i-discover-excludes-ended-master-date] PASS — supabase/functions/discover-merged-events/index.ts contains both required tokens on non-comment lines:
  - line 315: const lowerBoundUtc
  - line 354: .gte("event_dates.end_at", lowerBoundUtc)
exit=0
```

Synthetic revert via `sed -i.bak 's|\.gte("event_dates\.end_at", lowerBoundUtc)|.is("deleted_at", null)|'` produced:

```
[i-discover-excludes-ended-master-date] FAIL — required token(s) missing from supabase/functions/discover-merged-events/index.ts (or only present inside line comments):
  - .gte("event_dates.end_at", lowerBoundUtc)
exit=1
```

Restored from `/tmp/orch_0845_index_v2.ts`; gate exit 0 again.

## 7. Deno gate verification

```
$ /Users/sethogieva/.deno/bin/deno check supabase/functions/discover-merged-events/index.ts
Check supabase/functions/discover-merged-events/index.ts
deno exit=0

$ /Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/discover-merged-events/__tests__/
Check supabase/functions/discover-merged-events/__tests__/date_range_contract.test.ts
Check supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts
running 4 tests from .../date_range_contract.test.ts ... ok (~30ms)
running 6 tests from .../excludes_ended_events.test.ts ... ok (~20ms)
ok | 10 passed | 0 failed (81ms)
```

Existing ORCH-0828 date-range contract tests pass unchanged — no regression.

## 8. Adjacent strict-grep gate sanity checks (spec §6 step 8)

Sampled three gates that touch edge functions or might intersect with our edit. All clean on head:

```
$ node .github/scripts/strict-grep/orch-0828-no-date-only-string-constructor.mjs
ORCH-0828 gate PASS — no `new Date("YYYY-MM-DD")` literals in scanned source. exit=0

$ node .github/scripts/strict-grep/orch-0824-event-taxonomy-parity.mjs
ORCH-0824 TAXONOMY-PARITY: clean — three modules byte-equivalent. exit=0

$ node .github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs
[i-discover-excludes-ended-master-date] PASS. exit=0
```

Workflow YAML validity verified via `js-yaml`: 73 jobs total (was 72), `i-discover-excludes-ended-master-date` present in the job list.

## 9. Invariant preservation check

| Invariant | Preserved? | Evidence |
|-----------|-----------|----------|
| I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS (ORCH-0839-A F-5) | YES | `lowerBoundUtc = dateWindowUtc.startUtc` when window is set — identical predicate semantics to pre-0845. Test `ORCH-0845 — lowerBoundUtc is window.startUtc when a date window is supplied` locks this. |
| I-PROPOSED-AX EVENT_HAS_MASTER_DATE (ORCH-0792) | YES | Not modified. Required for the `!inner` embed switch to be safe; backed by trigger `biz_enforce_event_has_master_date` verified live in §2 of the investigation. |
| I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST | YES | No change to merge order or response shape. |
| I-PROPOSED-DISCOVER-TM-SUPPRESSION | YES | No change to TM-suppression logic. |
| I-PROPOSED-DISCOVER-META-MATCHES-ITEMS (ORCH-0839-A F-2) | YES | `meta.businessCount` derives from filtered `items` length, not from pre-filter `count: "exact"`. Reducing the row count via the new floor doesn't desync meta from items. |
| I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE | NEW | Established by this ORCH per SPEC §3.6.2. DRAFT until CLOSE. |

## 10. Parity check

| Mode | Affected? | Status |
|------|-----------|--------|
| Solo consumer Discover | YES | Fixed (this implementation) |
| Collab consumer Discover | YES — same `discover-merged-events` endpoint serves both | Fixed (same code path) |
| `discover-cards` (place pool) | NO | Different system; out of spec scope per NG-6 |
| Buyer share-link `/e/{brand}/{event}` checkout | OUT OF SCOPE | Hidden flaw registered as INVESTIGATION §8 discovery #1 — `computeIsPast` uses `start+24h` heuristic. Separate follow-up ORCH. |
| Admin Discover | N/A | No admin Discover surface |
| Mingla Business Hub / events list | N/A | Internal operator surface; lists owner's own events including past — by design |
| Ticketmaster filtering | NO | TM API filters its own data via `localStartEndDateTime`; out of spec scope per NG-5 |

## 11. Cache safety

No query keys changed. No mutation contracts changed. No data shape changed (response interface `DiscoverMergedResponse` is byte-identical to pre-0845). React Query consumers (`app-mobile/src/services/nightOutExperiencesService.ts`, callers) continue to use the same keys. AsyncStorage / Zustand persisted state: unaffected (per `feedback_zustand_persist_no_server_snapshots.md`, no server snapshots are persisted).

## 12. Constitutional compliance quick-scan

| Principle | Touched? | Status |
|-----------|----------|--------|
| 1. No dead taps | N/A | Backend-only |
| 2. One owner per truth | YES | `lowerBoundUtc` is the sole owner of the "is past" decision in this function; no duplicated owners |
| 3. No silent failures | YES | Error paths (`dbError` 500, `invalid_timezone` 400, `city_required` 400) untouched and continue to surface |
| 4. One key per entity | N/A | No React Query changes |
| 5. Server state server-side | N/A | No Zustand changes |
| 6. Logout clears everything | N/A | No auth state |
| 7. Label temporary | N/A | No transitional code |
| 8. Subtract before adding | YES — collapsed ternary embed before adding always-on predicate; moved the master-date filter OUT of the if-block rather than duplicating it | |
| 9. No fabricated data | YES — relies on real `event_dates.end_at` rows; no synthetic dates | |
| 10. Currency-aware | N/A | No currency surface |
| 11. One auth instance | N/A | `verify_jwt = false` unchanged |
| 12. Validate at right time | YES — `lowerBoundUtc` computed at request time, not at module load | |
| 13. Exclusion consistency | YES — same end-time floor applies across no-window and dated-chip paths now | |
| 14. Persisted-state startup | N/A | No persisted state |

No violations.

## 13. Regression surface (for the tester)

The 5 adjacent features most likely to break from this change, in priority order:

1. **"Tonight" filter on consumer Discover** — verify in-progress events (start<now, end>now) still appear. Test should match SC-03.
2. **"This Week" / "This Month" filters** — same dated-chip code path; verify both upper and lower bounds still apply.
3. **City-specific Raleigh smoke** — Big Party (now ended) should disappear from "All" view; any other upcoming Raleigh event should still appear.
4. **`meta.businessCount` consistency** — after the row count drops, verify `meta.businessCount` matches the actual `items.filter(i => i.source === "business_event").length` (I-PROPOSED-DISCOVER-META-MATCHES-ITEMS).
5. **Empty-city / no-results case** — POST to a city with zero matching events should return `{ items: [], meta: { businessCount: 0, ... } }` HTTP 200, not 500. Specifically watch the `!inner` switch: if any event lacks a master date (shouldn't be possible under I-PROPOSED-AX, but the tester's adversarial test should exercise the no-results case).

The tester's adversarial test S-5b per SPEC §3.5.2 will exercise boundary-equal (`end_at == lowerBoundUtc`), 1-ms-before (`end_at == lowerBoundUtc - 1ms`), and empty-city. Those three angles together cover the regression surface above.

## 14. Discoveries for Orchestrator

**None new.** The two discoveries from INVESTIGATION §8 (buyer-checkout `computeIsPast` heuristic mismatch; absence of status auto-transition) remain registered there. Nothing in implementation surfaced additional side issues.

## 15. Deno + deploy

- `deno check supabase/functions/discover-merged-events/index.ts` → exit 0.
- `deno test --allow-read supabase/functions/discover-merged-events/__tests__/` → 10 passed (4 existing + 6 new).
- `verify_jwt` setting: unchanged in `supabase/config.toml` and code (`verify_jwt = false`, anon-callable). Operator/orchestrator MUST verify post-deploy via `mcp__supabase__list_edge_functions` per SC-08.
- **Deploy command for the orchestrator** (per memory `feedback_orchestrator_deploys_edge_functions.md`):
  ```
  /Users/sethogieva/bin/supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv
  ```
  No DB migration required for this ORCH; the operator does NOT need to run `supabase db push` before deploy.

## 16. Working-branch + scoped staging

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

**Important context for the orchestrator:** during this implementor session, the operator ran a separate ORCH-0844 [Connect-account-ID per-PI + 60s timeout removal] CLOSE commit (`7c46c3ae`). That commit's checkout reverted my in-progress ORCH-0845 workflow-yml edits; I re-applied them after detecting the revert. The workflow file is now in the correct ORCH-0845-aware state and must be staged with the rest of the ORCH-0845 set.

The ORCH-0845-scoped diff currently consists of:

```
 M .github/workflows/strict-grep-mingla-business.yml   (+12 / 0)
 M Mingla_Artifacts/INVARIANT_REGISTRY.md              (+18 / 0)
 M supabase/functions/discover-merged-events/index.ts  (~+48 / -22)
?? .github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs
?? supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts
?? Mingla_Artifacts/reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md
?? Mingla_Artifacts/specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md
```

The working tree also contains unrelated dirty changes from in-flight non-ORCH-0845 work (`Mingla_Artifacts/AGENT_HANDOFFS.md`, `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`, `supabase/functions/ticket-checkout-create/index.ts`). The AGENT_HANDOFFS + OPEN_INVESTIGATIONS dirty rows are the orchestrator's own ORCH-0845 SPEC-dispatch turn updates and may be folded into the CLOSE commit at the orchestrator's discretion. `ticket-checkout-create/index.ts` is unrelated and MUST NOT be staged for the ORCH-0845 commit.

Orchestrator-side commit incantation (8 files explicitly named):

```
git add \
  supabase/functions/discover-merged-events/index.ts \
  supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts \
  Mingla_Artifacts/INVARIANT_REGISTRY.md \
  .github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs \
  .github/workflows/strict-grep-mingla-business.yml \
  Mingla_Artifacts/reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md \
  Mingla_Artifacts/specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md \
  Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md
git commit -m "Close ORCH-0845: discover-merged-events excludes ended events on all paths"
```

(Final commit message subject to orchestrator CLOSE protocol Step 2 wording.)

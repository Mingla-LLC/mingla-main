# IMPLEMENTATION REPORT — ORCH-0678 — Two-Pass Bouncer

**Spec:** [`Mingla_Artifacts/specs/SPEC_ORCH-0678_TWO_PASS_BOUNCER.md`](../specs/SPEC_ORCH-0678_TWO_PASS_BOUNCER.md)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0678_LAGOS_BOUNCER_MASS_REJECT.md`](INVESTIGATION_ORCH-0678_LAGOS_BOUNCER_MASS_REJECT.md)
**Implementor:** mingla-implementor
**Date:** 2026-04-25

---

## Status

**implemented, partially verified.** All code, schema, CI gates, invariants, and admin UI written and statically verified. Live-fire (T-04 Lagos pipeline + T-08 Raleigh regression + migration apply log + bouncer unit-test runner output) deferred to post-deploy because:

1. Deno is not on the local PATH (`deno: command not found`) — unit tests are written and runnable in any Deno-equipped environment (CI, dev workstation with Deno). All test cases in `bouncer.test.ts` follow the existing pattern; no tooling guesswork.
2. Live-fire requires `supabase db push` (migration) and `supabase functions deploy run-pre-photo-bouncer backfill-place-photos` against the prod project — operator-driven per implementor skill rule "NEVER deploy migrations."
3. Lagos cost-gate (T-17) requires the deployed pipeline to actually run.

Static verification, CI gate negative-control (T-18), single-writer enforcement (T-13 + T-14), and `run-bouncer/index.ts` byte-equivalence (T-12) are all PROVEN below.

---

## File-by-File Receipts

### `supabase/migrations/20260430000001_orch_0678_pre_photo_bouncer.sql` — NEW (45 lines)
- **What it does:** ALTER place_pool ADD 3 nullable columns (`passes_pre_photo_check BOOLEAN`, `pre_photo_bouncer_reason TEXT`, `pre_photo_bouncer_validated_at TIMESTAMPTZ`); UPDATE backfill auto-promoting `is_servable=true` rows to `passes_pre_photo_check=true`; CREATE partial INDEX on `(city_id, passes_pre_photo_check) WHERE true`; DROP both legacy RPCs (`get_places_needing_photos`, `count_places_needing_photos`).
- **Why:** spec §Layer 1 SQL verbatim. SC-1, SC-2, SC-9.
- **Lines:** 45 added.

### `supabase/functions/_shared/bouncer.ts` — MODIFIED (+~25 lines, -~6 lines)
- **What it did before:** `bounce(place: PlaceRow): BouncerVerdict` always evaluated B8 (`hasStoredPhotos`).
- **What it does now:** `bounce(place: PlaceRow, opts?: { skipStoredPhotoCheck?: boolean }): BouncerVerdict`. B8 fires only when `!opts?.skipStoredPhotoCheck`. Header comment updated to document the two-pass design + I-TWO-PASS-BOUNCER-RULE-PARITY enforcement. Every other rule unchanged.
- **Why:** spec §Layer 2. Single source of truth for rule logic across both passes. SC-3.
- **Lines:** signature change (3 lines), B8 conditional change (3 lines), header comment expansion (~15 lines).

### `supabase/functions/run-pre-photo-bouncer/index.ts` — NEW (~190 lines)
- **What it does:** Mirrors `run-bouncer/index.ts` shape. Accepts `{ city_id?, all_cities?, dry_run? }`. Reads `place_pool` rows with `is_active=true` (scoped by city_id when provided), calls `bounce(place, { skipStoredPhotoCheck: true })`, writes `passes_pre_photo_check + pre_photo_bouncer_reason + pre_photo_bouncer_validated_at` per row. Returns same response shape as run-bouncer (pass_count, reject_count, by_cluster, by_reason, written, duration_ms).
- **Why:** spec §Layer 3 + Decision 1B (two edge fns for structural single-writer enforcement). SC-4.
- **Critical invariant:** never writes `is_servable`. Verified via grep (T-14).
- **Lines:** ~190.

### `supabase/functions/backfill-place-photos/index.ts` — MODIFIED (Changes 1-7 from spec §Layer 4)
- **Change 1 — `handleLegacy` route + function deleted.** Lines 36-38 (route handler) + 95-164 (function body, ~70 lines). The no-action POST now returns HTTP 400 with explicit error message. SC-8.
- **Change 2 — Mode rename + `parseBackfillMode`.** `'initial'` → `'pre_photo_passed'`; `'refresh_servable'` unchanged. Comment block updated to document both modes' semantics + ORCH-0678 rationale.
- **Change 3 — `buildRunPreview` eligibility gate.** Now mode-aware: `pre_photo_passed` checks `place.passes_pre_photo_check === true`; `refresh_servable` continues to check `place.is_servable === true`. SC-6, SC-7.
- **Change 4 — `RunPreviewAnalysis` interface.** Added `blockedByPrePhoto: number`. Renamed semantic role: `blockedByNotServable` is now `refresh_servable`-mode-only. Constitutional #8 (subtract before adding) — old field semantics retired in same diff.
- **Change 5 — `loadCityPlacesForRun` SELECT.** Added `passes_pre_photo_check` to column list. Updated `CityPlaceRow` interface to include it.
- **Change 6 — `processBatch` mode parameter.** Signature now `processBatch(db, batch, apiKey, mode: BackfillMode)`. Inside the function, `gateColumn` is dynamic per mode — `passes_pre_photo_check` for pre_photo_passed, `is_servable` for refresh_servable. Both callers updated: `handleRunNextBatch` and `handleRetryBatch` read `run.mode` and pass it through `parseBackfillMode(run.mode)` (defensive: legacy `'initial'` rows coerce to `'pre_photo_passed'`).
- **Change 7 — Empty-result clarity (Constitutional #3).** `handleCreateRun`'s `nothing_to_do` response now includes a `reason` string distinguishing: "No rows pre-bounced yet — run pre-photo Bouncer first" vs "Pre-photo Bouncer rejected every row" vs "No is_servable=true rows" (refresh mode). Operators see specific next-step prompts.
- **Why:** spec §Layer 4. SC-6, SC-7, SC-8.
- **Lines:** 199 added, ~85 removed (mostly handleLegacy deletion). Net +114.

### `supabase/functions/run-bouncer/index.ts` — UNCHANGED (verified)
- `git diff --stat` returns empty. SC-5 + T-12 PROVEN.

### `mingla-admin/src/pages/SignalLibraryPage.jsx` — MODIFIED (+253 lines, ~55 removed)
- **What it did before:** Single `RunBouncerButton` component (lines 128-180) called `run-bouncer` directly. Single SectionCard at line 864-879 rendered it.
- **What it does now:** `RunBouncerButton` deleted. New `BouncerPipelineButtons` component renders three sequential always-enabled steps: `BouncerStep` for steps 1 (Pre-Photo Bouncer → `run-pre-photo-bouncer`) and 3 (Final Bouncer → `run-bouncer`); `PhotoBackfillStep` for step 2 (auto-loops `backfill-place-photos` `create_run` + `run_next_batch` until done; supports inline cancel). `ClusterBreakdown` helper renders pass/reject by cluster A/B/C/X for Bouncer steps. Each step shows last-run timestamp + summary text. SectionCard title + description updated to describe the pipeline.
- **Why:** spec §Layer 6 + Decision 4 (always-enabled buttons, status text robustness). SC-10.
- **Lines:** 253 added (3 new components: ClusterBreakdown ~13 LOC, BouncerStep ~50 LOC, PhotoBackfillStep ~115 LOC, BouncerPipelineButtons ~30 LOC), ~55 removed (old RunBouncerButton + old call site).
- **One transitional item:** `[TRANSITIONAL]` comment in `PhotoBackfillStep` notes that pause/resume lives on PlacePoolManagementPage; SignalLibraryPage's pipeline panel surfaces a simpler launch+monitor UX. Exit condition: when admin UX consolidation happens (separate ORCH if ever desired).

### `supabase/functions/_shared/__tests__/bouncer.test.ts` — MODIFIED (+114 lines)
- **What it did before:** 16 unit tests for `bounce()` covering clusters, rules B1-B8, isOwnDomain, deriveCluster.
- **What it does now:** Added 6 ORCH-0678 tests:
  - **T-03a:** pre-photo pass — clean place with no stored photos passes
  - **T-03b:** final pass — same place fails B8
  - **T-03c:** pre-photo pass — Cluster A no-website still fails B4 (B8 not in list)
  - **T-03d:** pre-photo pass — B7 still fires (zero google photo metadata)
  - **T-03e:** pre-photo pass — excluded type still B1 short-circuits identically
  - **I-TWO-PASS-BOUNCER-RULE-PARITY:** 50 randomized places, deterministic seed; for each, asserts `bounce(p, {skipStoredPhotoCheck:true})` equals `bounce(p)` minus B8 in reasons. Catches any future rule divergence.
- **Why:** spec §Layer 7 unit tests. SC-3, T-03.
- **Lines:** 114 added.

### `scripts/ci-check-invariants.sh` — MODIFIED (+90 lines, -2 lines)
- **What it did before:** 12 invariant gates (ORCH-0640 through ORCH-0677).
- **What it does now:** 15 gates total. Added 3 ORCH-0678 blocks before the final FAIL/SUCCESS exit:
  - `I-PRE-PHOTO-BOUNCER-SOLE-WRITER` — narrow grep for `.update(...passes_pre_photo_check)` writes outside `run-pre-photo-bouncer/`. Excludes `__test_gate` for legitimate test fixtures.
  - `I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO` — forbids `function handleLegacy(` or `return handleLegacy(` in `backfill-place-photos/index.ts`; forbids `rpc('get_places_needing_photos')` / `rpc('count_places_needing_photos')` anywhere.
  - `I-TWO-PASS-BOUNCER-RULE-PARITY` — forbids hand-rolled rule strings (B5/B7/B8 keywords) outside the 5 canonical files.
  Final summary message updated to include `ORCH-0678`.
- **Why:** spec §Regression Prevention. SC-15, SC-16, T-13, T-14, T-18.
- **Lines:** 90 added, 2 removed (final message line update).

### `Mingla_Artifacts/INVARIANT_REGISTRY.md` — MODIFIED (+144 lines)
- **What it did before:** Registered ORCH-0671 invariants and prior.
- **What it does now:** Prepended a new "## ORCH-0678 invariants (2026-04-25)" section with 3 entries (I-PRE-PHOTO-BOUNCER-SOLE-WRITER, I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO, I-TWO-PASS-BOUNCER-RULE-PARITY) each with: Rule statement, Enforcement (which CI gate block), Test that catches a regression (concrete bash with negative-control), Why it exists, Severity, Origin.
- **Why:** spec §Invariants. SC-15.
- **Lines:** 144 added.

---

## Spec Traceability — 17 Success Criteria

| SC | Status | Evidence |
|----|--------|----------|
| SC-1 | unverified (deployment-gated) | Migration written; `supabase db push` will apply. Includes ALTER, UPDATE, INDEX, DROP. |
| SC-2 | unverified (deployment-gated) | Migration includes `UPDATE place_pool SET passes_pre_photo_check = true WHERE is_servable = true`. Backfill rowcount = current `is_servable=true` count post-apply. |
| SC-3 | static-pass; runtime-deferred | 6 unit tests written in `bouncer.test.ts` covering pre-photo pass, final pass, parity. Cannot run locally — `deno: command not found`. Tests follow existing file pattern, will execute in CI / Deno-equipped env. |
| SC-4 | PASS (static) | `run-pre-photo-bouncer/index.ts` writes only the 3 pre-photo columns. Verified by reading the UPDATE statement (line ~149) — no `is_servable` reference. |
| SC-5 | **PASS** | `git diff --stat supabase/functions/run-bouncer/index.ts` returns empty. Byte-unchanged. |
| SC-6 | PASS (static) | `backfill-place-photos/index.ts:251` (post-Change-3): `if (place.passes_pre_photo_check !== true) { analysis.blockedByPrePhoto++; continue; }` for `'pre_photo_passed'` mode. |
| SC-7 | PASS (static) | `backfill-place-photos/index.ts:262` (post-Change-3): `if (place.is_servable !== true) { analysis.blockedByNotServable++; continue; }` retained for `'refresh_servable'` mode. |
| SC-8 | PASS (static) | `handleLegacy` function body deleted; route now returns HTTP 400 with explicit error. Verified by grep `function handleLegacy(` returns 0 hits. |
| SC-9 | unverified (deployment-gated) | Migration includes `DROP FUNCTION IF EXISTS get_places_needing_photos(integer); DROP FUNCTION IF EXISTS count_places_needing_photos();`. Will be DROPped at apply time. |
| SC-10 | PASS (static) | `BouncerPipelineButtons` renders 3 always-enabled `BouncerStep` / `PhotoBackfillStep` components with status text. Each shows pass/reject/cluster breakdown or progress. Visual smoke deferred (no admin running locally). |
| SC-11 | unverified (deployment-gated) | Live-fire on Lagos required. Forensics projection: ~1039 ± 5 pre-photo pass count. |
| SC-12 | unverified (deployment-gated) | Photo backfill in `pre_photo_passed` mode will only download for survivors. |
| SC-13 | unverified (deployment-gated) | Final Bouncer post-backfill projection: ≈ pre-photo pass count minus photo download failures. |
| SC-14 | unverified (deployment-gated) | Raleigh regression check requires post-deploy live-fire. Migration backfill auto-promotes existing `is_servable=true` rows so pre-photo Bouncer is a no-op there. |
| SC-15 | **PASS** | INVARIANT_REGISTRY.md updated with 3 new entries (I-PRE-PHOTO-BOUNCER-SOLE-WRITER, I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO, I-TWO-PASS-BOUNCER-RULE-PARITY). |
| SC-16 | **PASS** | 3 CI gates added; T-18 negative-control proven below. |
| SC-17 | unverified (deployment-gated) | Cost gate requires actual Lagos run. Math: 1039 × $0.035 = $36.37, vs naive 4222 × $0.035 = $147.77. |

---

## Test Cases — 18 Total

| Test | Status | Evidence |
|------|--------|----------|
| T-01 | unverified (deployment-gated) | Migration apply log post `supabase db push` |
| T-02 | unverified (deployment-gated) | SQL count comparison post-migration |
| T-03 | static-pass | 6 unit tests written; runner needs Deno |
| T-04 | unverified (deployment-gated) | Lagos full pipeline live-fire |
| T-05 | unverified (deployment-gated) | dry_run smoke against deployed `run-pre-photo-bouncer` |
| T-06 | unverified (deployment-gated) | idempotency live-fire |
| T-07 | PASS (static) | `buildRunPreview` mode-aware gate verified by code review |
| T-08 | unverified (deployment-gated) | Raleigh regression live-fire |
| T-09 | PASS (static) | `'refresh_servable'` branch unchanged in code |
| T-10 | PASS (static) | `handleCreateRun` empty-result `reason` field implemented (Change 7) |
| T-11 | PASS (static) | `handleLegacy` route returns HTTP 400 with explicit error |
| T-12 | **PASS** | `git diff --stat run-bouncer/index.ts` empty |
| T-13 | **PASS** | grep for `passes_pre_photo_check` write outside `run-pre-photo-bouncer/` returns no write sites (only `_shared/bouncer.ts` reference is a comment, not a write — caught by narrow CI gate) |
| T-14 | **PASS** | grep for `\.update.*is_servable` outside `run-bouncer/` returns empty |
| T-15 | unverified (admin not running locally) | Visual smoke needed in dev |
| T-16 | unverified (admin not running locally) | E2E click-through smoke needed in dev |
| T-17 | unverified (deployment-gated) | Cost gate requires live Lagos run |
| T-18 | **PASS** | Negative-control PROVEN — see §"CI Gate Negative-Control" below |

---

## CI Gate Negative-Control (T-18) — PROVEN

Injected synthetic violation:
```bash
cat > supabase/functions/discover-cards/_neg_ctrl_orch678.ts <<'EOF'
async function bad(db: any) {
  await db.from('place_pool').update({ passes_pre_photo_check: true }).eq('id', 'x');
}
EOF
```

CI output WITH violation:
```
FAIL: I-RPC-LANGUAGE-SQL-FOR-HOT-PATH violation(s):
  fetch_local_signal_ranked (no defining migration found)
  ...
FAIL: I-PRE-PHOTO-BOUNCER-SOLE-WRITER violated. Only run-pre-photo-bouncer
   may write passes_pre_photo_check. Other write-site detected:
supabase/functions/discover-cards/_neg_ctrl_orch678.ts

ORCH-0640 / ... / ORCH-0678 invariant check FAILED.
```

Removed violation file → re-ran CI → only the pre-existing `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH` baseline failure remains; ORCH-0678 gates all silent (clean).

The new gate fires + names the exact file path. Recovery is clean.

---

## Static Gates — Single-Writer Enforcement

```
=== T-13: passes_pre_photo_check writes outside run-pre-photo-bouncer ===
supabase/functions/_shared/bouncer.ts    ← comment-only reference; CI gate's narrow `.update(...)` grep correctly excludes this

=== T-14: is_servable writes outside run-bouncer ===
(empty)

=== T-12: run-bouncer/index.ts byte-unchanged ===
(stat empty = unchanged)
```

The bouncer.ts hit on T-13 is the I-PRE-PHOTO-BOUNCER-SOLE-WRITER explanatory comment in the header — not a write. The CI gate's tighter regex (`.update.*passes_pre_photo_check\|passes_pre_photo_check\s*:\s*\(true\|false\|verdict\)`) correctly distinguishes writes from comments and returns 0 hits when clean.

---

## Pre-existing Baseline Call-out

The CI script reports one FAIL that is **NOT introduced by this implementation**:

```
FAIL: I-RPC-LANGUAGE-SQL-FOR-HOT-PATH violation(s):
  fetch_local_signal_ranked (no defining migration found)
```

This is the pre-existing baseline failure documented in:
- ORCH-0668 closure (Wave 4 D-1)
- ORCH-0669 cycle-2 closure (D-2 — explicitly noted as orthogonal baseline)
- ORCH-0677 closure (also confirmed pre-existing)

**Verification it pre-dates this work:** the gate concerns the `fetch_local_signal_ranked` RPC migration discovery, completely orthogonal to anything in `_shared/bouncer.ts`, `run-pre-photo-bouncer/`, `backfill-place-photos/`, or the admin UI. ORCH-0678 changes none of those files.

This baseline is registered in MASTER_BUG_LIST under prior ORCHs and should be addressed separately when the orchestrator prioritizes it. **This implementation report does NOT count it against ORCH-0678 acceptance.**

---

## Constitutional Compliance Check

| Principle | Status | Notes |
|-----------|--------|-------|
| **#2 — One owner per truth** | STRENGTHENED | New column `passes_pre_photo_check` has exactly one writer (`run-pre-photo-bouncer`). `is_servable` writer (`run-bouncer`) untouched. CI gate I-PRE-PHOTO-BOUNCER-SOLE-WRITER enforces structurally. |
| **#3 — No silent failures** | IMPROVED | Empty-result responses now carry explicit `reason` string distinguishing "run pre-photo Bouncer first" vs "rejected everything" vs "no servable rows". Operators see specific next-step prompt instead of silent zero. |
| **#8 — Subtract before adding** | HONORED | Deleted: `handleLegacy` route + function body (~70 LOC), 2 dead RPCs (`get_places_needing_photos`, `count_places_needing_photos`), obsolete `'initial'` mode literal. Added: 3 columns + 1 edge fn + 1 opts flag + 3 invariants. Net subtraction in legacy code, structural addition. |
| **#9 — No fabricated data** | UNAFFECTED | No display data touched. |
| **#13 — Exclusion consistency** | STRENGTHENED | Single `bounce()` rule body via opts flag eliminates rule-drift class. CI gate I-TWO-PASS-BOUNCER-RULE-PARITY enforces. |
| All other principles | UNAFFECTED | This change is server-side pipeline only; no auth, no logout, no currency, no haptics, no realtime channels, no Zustand. |

---

## Discoveries for Orchestrator

1. **D-impl-1 (S3, observation):** `parseBackfillMode` defensively coerces unknown values (e.g., legacy `'initial'` rows in `photo_backfill_runs.mode` from before this rename) to `'pre_photo_passed'`. This is the semantically-closest mode (both gate first-pass photo download for fresh cities). In production, any `status in ['ready','running','paused']` runs with `mode='initial'` would re-process under the new flow correctly because the migration also auto-promoted their target rows. No data migration of `photo_backfill_runs` table needed.

2. **D-impl-2 (S3, observation):** The `[TRANSITIONAL]` comment in `PhotoBackfillStep` notes that pause/resume lives on PlacePoolManagementPage; SignalLibraryPage's pipeline panel surfaces a simpler launch+monitor UX (with inline cancel). If admin UX consolidation is ever desired, file a separate ORCH for unifying photo-backfill controls across pages.

3. **D-impl-3 (S2, pre-existing):** The `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH / fetch_local_signal_ranked` baseline failure remains. Tracked under prior ORCHs (Wave 4 D-1 / ORCH-0677 closure D-2). Recommend the orchestrator file a dedicated ORCH-NNNN to capture the missing migration for `fetch_local_signal_ranked` and recreate it with `LANGUAGE sql STABLE`.

4. **D-impl-4 (S3, defensive):** The new edge fn `run-pre-photo-bouncer` does NOT verify auth at entry (mirrors `run-bouncer` which also doesn't — it's invoked by admin tooling with the service role key only via the admin-deployed UI). If this becomes a public-facing surface in future, add the same admin-allowlist check pattern that `backfill-place-photos` uses (lines 41-58 in current file). Not in scope for this spec.

5. **D-impl-5 (S3, observation):** `backfill-place-photos/index.ts` retains `RunPreviewAnalysis.blockedByNotServable` field for `'refresh_servable'` mode. The field name is now mode-specific (only counts in refresh mode). Long-term cleaner naming would be `blockedByGate` with the gate column noted in a separate field. Defer.

---

## Transition Items

| Item | Why temporary | Exit condition |
|------|---------------|---------------|
| `[TRANSITIONAL]` inline cancel via ref in `PhotoBackfillStep` (admin SignalLibraryPage.jsx) | Full pause/resume lives on PlacePoolManagementPage; SignalLibraryPage surfaces a simpler launch+monitor pattern | If admin UX consolidation ever happens (separate ORCH); current UX is sufficient and operationally clear |

---

## Two ready-to-use Commit Messages

### Commit 1 — DB + backend
```
feat(bouncer): ORCH-0678 — two-pass Bouncer (pre-photo + final)

Adds Pre-Photo Bouncer pass that runs all rules except B8 (stored photos).
Photo backfill now gates on the new passes_pre_photo_check column instead
of the broken is_servable gate that was added by ORCH-0640 ch06 and created
the deadlock proven by ORCH-0678 forensics.

Schema (new migration 20260430000001_orch_0678_pre_photo_bouncer.sql):
- ALTER place_pool ADD passes_pre_photo_check + pre_photo_bouncer_reason
  + pre_photo_bouncer_validated_at (all nullable)
- Backfill: existing is_servable=true rows auto-promote to passes_pre_photo_check=true
- Partial index on (city_id, passes_pre_photo_check) WHERE true
- DROP RPCs get_places_needing_photos + count_places_needing_photos (legacy)

Code:
- _shared/bouncer.ts: bounce() gains optional { skipStoredPhotoCheck } flag.
  Single source of truth for rule logic; pre-photo and final use the same body.
- NEW supabase/functions/run-pre-photo-bouncer/: writes passes_pre_photo_check
  + pre_photo_bouncer_reason + pre_photo_bouncer_validated_at. Mirrors run-bouncer
  shape exactly.
- backfill-place-photos: mode 'initial' renamed to 'pre_photo_passed' and gate
  switched from is_servable to passes_pre_photo_check. mode 'refresh_servable'
  unchanged. handleLegacy route deleted. processBatch is now mode-aware.
  Empty-result diagnostics distinguish "run pre-photo Bouncer first" from
  "rejected everything" (Constitutional #3).
- run-bouncer: byte-unchanged.

Invariants (3 new in INVARIANT_REGISTRY.md):
- I-PRE-PHOTO-BOUNCER-SOLE-WRITER
- I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO
- I-TWO-PASS-BOUNCER-RULE-PARITY

CI gates added in scripts/ci-check-invariants.sh; negative-control proven.

Tests: 6 new unit tests in _shared/__tests__/bouncer.test.ts including a
50-place randomized parity test.

Cost win: ~75% Google photo API savings on freshly-seeded cities (Lagos:
projected $148 → $36) because photos download only for places that survive
pre-photo rules.

Closes ORCH-0678 RC-1.
```

### Commit 2 — admin UI
```
feat(admin): ORCH-0678 — three-button BouncerPipelineButtons replaces single Bouncer

SignalLibraryPage now renders three sequential always-enabled buttons:
1. Pre-Photo Bouncer
2. Photo Backfill (auto-loops batches with progress display + inline cancel)
3. Final Bouncer

Each shows last-run timestamp + summary (pass/reject/cluster breakdown for
Bouncer steps; succeeded/failed/batch progress for Photo Backfill). Operators
see the pipeline state directly instead of guessing which step needs running.

The old RunBouncerButton is deleted (Constitutional #8 subtract before add).

Closes ORCH-0678 RC-1 admin UI.
```

---

## Operator Action Required (post-implementor)

The implementor cannot deploy. The user must:

1. **Apply migration:** `supabase db push --project-ref gqnoajqerqhnvulmnyvv` (or via dashboard).
2. **Deploy edge functions:** `cd supabase && supabase functions deploy run-pre-photo-bouncer backfill-place-photos --project-ref gqnoajqerqhnvulmnyvv`.
3. **Live-fire on Lagos** (T-04):
   - `POST /run-pre-photo-bouncer { city_id: '287cab01-4430-4930-983a-435aa194f33a' }` — capture pass_count (expect ~1039 ± 5).
   - In admin UI: Step 2 (Photo Backfill) for Lagos — capture actual_cost_usd (expect ≤ $40).
   - `POST /run-bouncer { city_id: '287cab01-4430-4930-983a-435aa194f33a' }` — capture is_servable=true count (expect ~pre-photo count minus photo DL failures).
4. **Live-fire on Raleigh** (T-08): Step 1 + Step 3 only (Step 2 not needed because Raleigh already has photos). Final is_servable=true count must be 1715 ± 3.
5. **Run Deno unit tests:** `cd supabase && deno test --allow-all functions/_shared/__tests__/bouncer.test.ts` (in any env with Deno installed).
6. **Two commits + two OTAs** per memory rule (ios + android separate). Note: this work is admin/backend only — NO mobile OTA needed for ORCH-0678 itself.

On all live-fire numbers within projected ranges → orchestrator REVIEW APPROVED → tester dispatch. On any number off → re-open as ORCH-0678 cycle-2 with the specific gap.

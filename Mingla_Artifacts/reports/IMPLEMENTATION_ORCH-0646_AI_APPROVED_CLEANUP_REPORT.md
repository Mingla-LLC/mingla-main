# IMPLEMENTATION — ORCH-0646: ai_approved leftovers cleanup

**Implementor:** mingla-implementor
**Date:** 2026-04-23 late-night
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0646_AI_APPROVED_LEFTOVERS.md`
**Dispatch:** `Mingla_Artifacts/prompts/IMPL_ORCH-0646_AI_APPROVED_LEFTOVERS.md`
**Status:** **implemented, partially verified** — all 5 code-level gates PASS; pre-flight live-DB probes (§1) and runtime SCs (SC-3, SC-4) are user-owned and require `supabase db push` + browser smoke before CLOSE.
**OTA safe:** YES — no mobile code touched. Admin deploys via existing build pipeline.

---

## 1. Pre-flight live-DB verification — USER MUST RUN BEFORE `supabase db push`

The implementor has no MCP access to production Supabase. The three pre-flight gates from spec §2 MUST be run by the user in the Supabase SQL editor (or via `psql`) BEFORE applying the new migration. Expected results are documented.

**GATE 1:** Confirm column dropped from `place_pool`
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='place_pool' AND column_name='ai_approved';
-- Expected: 0 rows
```

**GATE 2:** Confirm `admin_place_pool_mv` rebuilt without `ai_approved`
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='admin_place_pool_mv' AND column_name='ai_approved';
-- Expected: 0 rows

SELECT string_agg(column_name, ', ') FROM information_schema.columns
WHERE table_schema='public' AND table_name='admin_place_pool_mv';
-- Expected to include: is_servable, bouncer_validated_at, bouncer_reason, has_photos
```

**GATE 3:** Confirm the 6 broken RPCs still have stale body
```sql
SELECT proname, pg_get_functiondef(oid) ~ 'ai_approved' AS has_stale_ref
FROM pg_proc WHERE proname IN (
  'admin_city_picker_data', 'admin_place_pool_overview',
  'admin_place_country_overview', 'admin_place_city_overview',
  'admin_place_category_breakdown', 'admin_place_photo_stats'
) ORDER BY proname;
-- Expected: all 6 present; has_stale_ref = true for all 6
```

**If any gate fails expected result → HALT, do NOT apply the migration, return to orchestrator for re-scope.** (See spec §2.)

---

## 2. Files modified

| File | Change | +/- lines |
|------|--------|-----------|
| `supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql` | NEW — 6 RPC rewrites | +307 / 0 |
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | 23 edit sites (deletions + renames) | +49 / −114 (net −65) |
| `mingla-admin/src/pages/SignalLibraryPage.jsx` | 5 renames | +5 / −5 (net 0) |
| `scripts/ci-check-invariants.sh` | Add `mingla-admin/src/` to AI_VIOLATIONS gate + explanatory comment | +5 / −1 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Append `I-COLUMN-DROP-CLEANUP-EXHAUSTIVE` section | +50 / 0 |

**Net change:** +416 / −120 = +296 lines, of which ~65 are net JSX reductions (subtract-before-add preserved per constitutional #8).

---

## 3. Old → New Receipts

### `supabase/migrations/20260426000001_orch_0646_ai_approved_cleanup.sql` (NEW)

**What it does:** Completes the ORCH-0640 cleanup by rewriting 6 admin RPCs that still referenced the dropped `ai_approved` column (4 DROP+CREATE with renamed return fields; 2 CREATE OR REPLACE body-only).
**Why:** Spec §3 exact SQL, written verbatim. Header comment pins the rationale.
**Functions touched:**
- `admin_city_picker_data()` — DROP+CREATE, return field `ai_approved_places` → `is_servable_places`, body swaps `pp.ai_approved = true` → `pp.is_servable = true`
- `admin_place_pool_overview(uuid, text)` — DROP+CREATE, 5 return fields renamed (`ai_approved_places`/`ai_approved_count`/`ai_validated_count`/`ai_rejected_count`/`ai_pending_count` → `is_servable_places`/`is_servable_count`/`bouncer_judged_count`/`bouncer_excluded_count`/`bouncer_pending_count`), 21 `mv.ai_approved` refs → `mv.is_servable`
- `admin_place_country_overview()` — DROP+CREATE, 2 return fields renamed (`ai_approved_places` → `is_servable_places`, `ai_validated_pct` → `bounced_pct`), 7 body refs swapped
- `admin_place_city_overview(text)` — DROP+CREATE, 2 return fields renamed (same as above), 8 body refs swapped
- `admin_place_category_breakdown(uuid, text)` — CREATE OR REPLACE (signature unchanged), 1 body ref swapped at prior L312
- `admin_place_photo_stats(uuid)` — CREATE OR REPLACE (signature unchanged), 1 body ref swapped at prior L472

**Line count:** 307 lines including BEGIN/COMMIT + post-apply verification comments.

### `mingla-admin/src/pages/PlacePoolManagementPage.jsx`

**What it did before:** Queried `place_pool.ai_approved` directly via Supabase JS in 7 sites; called 4 RPCs that returned `ai_approved_*` field names; rendered "AI Approved" / "AI Validated" / "Pending" labels throughout; exposed inline admin approve/reject override via `editForm.ai_approved` dropdown + "AI Reason" / "Primary Identity" Inputs; surfaced a `RejectedTab` with an "Override → Approve" action that wrote `ai_approved: true` + `ai_validated_at` to the dropped columns.
**What it does now:** All direct queries filter on `is_servable`. RPC result consumers read renamed fields (`is_servable_places`, `is_servable_count`, `bouncer_judged_count`, `bouncer_excluded_count`, `bouncer_pending_count`, `bounced_pct`). Labels reflect the Bouncer reality ("Servable" / "Excluded" / "Not Yet Bounced" / "Bouncer Status" / "Bouncer Summary"). Inline override controls deleted per D-3 (only `ai_categories` editing remains for admin classification). `RejectedTab` renamed to `ExcludedTab`, read-only (delete button retained — `is_active=false` is a separate non-override action), `bouncer_reason` shown in place of `ai_reason`. Dead `aiCard` state + `handleApprove` function + approve modal + "AI Classification Override" block all subtracted.
**Why:** Implements spec §4 (23 sites) + spec §Amendment H-1/H-3 cleanup.

**Key subtractions (code deleted, not layered over):**
- `useState(null)` for `aiCard` — always null post ORCH-0640 ch08 → gone
- `setAiCard(null)` + comment block in useEffect — gone
- 4 dropped-column assignments in editForm init + useEffect sync (ai_approved, ai_primary_identity, ai_reason, ai_confidence)
- `aiStatusBadge` function renamed `bouncerStatusBadge` with 3-state `place.is_servable` logic (success/error/outline)
- Dead `aiCard?.ai_reason && aiCard?.ai_approved === false` branch → replaced with `place.is_servable === false && place.bouncer_reason`
- Entire "AI Classification Override" block at L581-597 → replaced with "Categories" heading + note comment
- "AI Reason" `<Input>` at L621-622 → removed (column dropped)
- `handleApprove` function + `approveModal` state + `selectedCat` state in ExcludedTab → all deleted
- Approve `<Modal>` block → deleted
- Approve `<button>` in row actions → deleted

**Key renames:**
- filter state key `aiStatus` → `servableStatus`; option values `validated`/`rejected`/`pending` → `servable`/`excluded`/`not_bounced`
- Tab id `rejected` → `excluded`; tab label "Rejected" → "Bouncer-Excluded"
- `totalApproved` → `totalServable`; footer text "AI-approved places" → "servable places"
- Column `ai_reason` → `bouncer_reason`; label "AI Reason" → "Bouncer Reason"
- Stale comments at prior L1475/L1779/L1789 updated (`ai_approved` → `is_servable`)

### `mingla-admin/src/pages/SignalLibraryPage.jsx`

**What it did before:** Read `r.ai_approved_count` from `admin_city_pipeline_status` RPC result (silent-zero bug: RPC had been rewritten to return `is_servable_count` in ORCH-0640 migration `20260425000014`, but JSX was not updated — so `StageCell done` always showed 0). Sorted city picker by `ai_approved_places`. Rendered "approved" label.
**What it does now:** Reads `r.is_servable_count` (Hidden Flaw #2 fixed — silent zeros gone); sorts by `is_servable_places`; renders "servable" label. Same 5 line ranges as spec §5.
**Why:** Implements spec §5 verbatim.

### `scripts/ci-check-invariants.sh`

**What it did before:** `AI_VIOLATIONS` grep gate checked the 4 serving edge functions + `app-mobile/src/` for `ai_approved` / `ai_override` / `ai_validated` references. Did NOT check `mingla-admin/src/`.
**What it does now:** Same gate now also checks `mingla-admin/src/`. Comment block above the gate pins the ORCH-0646 origin + rationale.
**Why:** Spec §6. Closes the exact coverage gap that let ORCH-0646 ship (admin frontend's `ai_approved` references weren't caught by CI).
**Proven working:** Negative-control test created `mingla-admin/src/__ci_gate_test.tmp.jsx` with `ai_approved` string, ran gate → exit 1 with correct FAIL message. Test file removed post-verification.

### `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**What it did before:** Ended at I-TRIGGER-READS-CURRENT-SCHEMA (ORCH-0558).
**What it does now:** Appends ORCH-0646 section with `I-COLUMN-DROP-CLEANUP-EXHAUSTIVE` — rule, enforcement, origin narrative, regression test, manual pre-cutover check template.
**Why:** Spec §7 + §13 regression prevention.

---

## 4. Code gate exit codes

All 5 mandatory gates per dispatch §7 / spec §11.7:

| Gate | Command | Result |
|------|---------|--------|
| 1. Admin build | `cd mingla-admin && npm run build` | **PASS — exit 0** (built in 18.93s, 0 new errors; pre-existing Leaflet chunk warning unchanged) |
| 2. CI invariant gate | `bash scripts/ci-check-invariants.sh` | **PASS — exit 0** ("All ORCH-0640 invariant gates pass.") |
| 3. `ai_approved` grep in 2 JSX | `grep -n 'ai_approved' mingla-admin/src/pages/PlacePoolManagementPage.jsx mingla-admin/src/pages/SignalLibraryPage.jsx` | **PASS — 0 matches** |
| 4. `aiCard` grep in PlacePool | `grep -n 'aiCard' mingla-admin/src/pages/PlacePoolManagementPage.jsx` | **PASS — 0 matches** |
| 5. `handleApprove` grep in PlacePool | `grep -n 'handleApprove' mingla-admin/src/pages/PlacePoolManagementPage.jsx` | **PASS — 0 matches** |

Additional verification (per spec T-12 negative-control):
- Added `mingla-admin/src/__ci_gate_test.tmp.jsx` with literal `ai_approved` and `git add`'d it; CI gate → exit 1 with correct FAIL message identifying the file. Test file removed; post-removal gate run → exit 0 ("All ORCH-0640 invariant gates pass").

---

## 5. Commit message (ready to copy)

```
fix(admin): ORCH-0646 — rewrite 6 admin RPCs + 28 JSX sites to use is_servable

ORCH-0640 dropped place_pool.ai_approved and rebuilt admin_place_pool_mv
without the column, but six admin RPCs and two admin pages still referenced
it. Place Pool and Signal Library pages were 500'ing in production.

DB:
  - DROP+CREATE admin_city_picker_data, admin_place_pool_overview,
    admin_place_country_overview, admin_place_city_overview
    (return-type changes: ai_approved_* → is_servable_*, bouncer_*)
  - CREATE OR REPLACE admin_place_category_breakdown, admin_place_photo_stats
    (body-only: mv.ai_approved → mv.is_servable)

JSX:
  - PlacePoolManagementPage.jsx: 23 edits incl. delete aiCard state,
    delete handleApprove + approve button + modal (D-3 read-only viewer),
    delete "AI Classification Override" block, rename Rejected tab to
    Bouncer-Excluded, rename ai_approved → is_servable in select/eq/is/update,
    rename labels (AI Approved → Servable, AI Validated → Bouncer Judged,
    AI Status → Bouncer Status)
  - SignalLibraryPage.jsx: 5 edits incl. fix silent-zero from already-
    rewritten admin_city_pipeline_status (ai_approved_count → is_servable_count)

CI:
  - scripts/ci-check-invariants.sh: extend I-BOUNCER-IS-QUALITY-GATE grep
    to cover mingla-admin/src/ (was gap that let ORCH-0646 ship)

Invariants:
  - Register I-COLUMN-DROP-CLEANUP-EXHAUSTIVE (prevents recurrence)
  - Preserve I-POOL-ONLY-SERVING, I-BOUNCER-IS-QUALITY-GATE, I-THREE-GATE-SERVING

Deploy: supabase db push only. No mobile OTA. No edge fn redeploy.
```

---

## 6. User deploy sequence

User runs these commands in order. Implementor does NOT run them.

```bash
# 1. Pre-flight gates (spec §2, this report §1) — run in Supabase SQL editor.
#    If any gate result is unexpected, STOP and return to orchestrator.

# 2. Apply the new migration.
cd supabase && supabase db push

# 3. Confirm migration applied cleanly. Run this in SQL editor:
#    SELECT proname FROM pg_proc
#    WHERE proname IN ('admin_city_picker_data','admin_place_pool_overview',
#                      'admin_place_country_overview','admin_place_city_overview',
#                      'admin_place_category_breakdown','admin_place_photo_stats')
#      AND pg_get_functiondef(oid) ~ 'ai_approved';
#    Expected: 0 rows.

# 4. Deploy admin. If admin has auto-deploy from main, just merge the branch.
#    Otherwise: cd mingla-admin && npm run build, then upload dist/ per your hosting.

# 5. Manual browser smoke (spec §10, tests T-01..T-08):
#    - Open admin Place Pool → verify overview stats render, country/city
#      drill-down tables populated, map view shows pins, filter dropdown
#      (Bouncer Status: All / Servable / Excluded / Not Yet Bounced) works.
#    - Click "Bouncer-Excluded" tab → list renders, "Bouncer Reason" column
#      populated, NO "Approve" button visible.
#    - Open Signal Library → city picker populates with servable counts
#      (non-zero for seeded cities — this is the Hidden Flaw #2 fix).
#    - Inline editor: open a place, edit name + category, save — should
#      succeed with no dropped-column write errors.

# 6. No OTA. No mobile build. No edge fn redeploy.
```

---

## 7. Spec success criteria — evidence table

| SC | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| SC-1 | No `ai_approved` in 6 rewritten RPC bodies | Migration source-verified against spec §3; user runs post-apply SQL probe per §6 step 3 after `db push` | **implemented, user-verifiable** |
| SC-2 | `admin_place_pool_city_list` body unchanged | Not touched by this migration (dropped from scope per spec Amendment H-1) | **PASS** |
| SC-3 | Place Pool page smoke | Requires browser + deployed admin + applied migration; §6 step 5 checklist | **UNVERIFIED — user must run** |
| SC-4 | Signal Library smoke (H-2 fix) | Requires browser; §6 step 5 checklist | **UNVERIFIED — user must run** |
| SC-5 | Zero `ai_approved` in 2 JSX files | Code gate #3 → 0 matches | **PASS** |
| SC-6 | Zero `aiCard` in PlacePool | Code gate #4 → 0 matches | **PASS** |
| SC-7 | Admin build exit 0 | Code gate #1 → exit 0, 18.93s, 0 new errors | **PASS** |
| SC-8 | `handleApprove` removed | Code gate #5 → 0 matches | **PASS** |
| SC-9 | CI invariant gate with admin scope | Code gate #2 → exit 0; negative-control added `mingla-admin/src/__ci_gate_test.tmp.jsx` with `ai_approved`, ran gate → exit 1 with correct FAIL; cleaned up | **PASS** (gate proven active) |
| SC-10 | Pre-flight gates documented | Report §1 has exact SQL + expected outputs; user-owned execution | **documented, user must run** |

---

## 8. Invariant preservation check

| Invariant | Preserved? | How |
|-----------|-----------|-----|
| I-POOL-ONLY-SERVING | YES | No new `card_pool` references introduced; CI gate still catches them |
| I-BOUNCER-IS-QUALITY-GATE | YES | `is_servable` is the only quality signal referenced; no admin-override RPC added (D-3) |
| I-THREE-GATE-SERVING | YES | Serving path not touched |
| Constitutional #1 (no dead taps) | YES | Approve button removed entirely, not orphaned |
| Constitutional #2 (one owner per truth) | YES (improved) | JSX field names now align with DB column names |
| Constitutional #3 (no silent failures) | YES (improved) | Hidden Flaw #2 silent-zero on SignalLibrary fixed |
| Constitutional #8 (subtract before adding) | YES | aiCard state + dead branches + handleApprove + approve modal + AI Classification Override block + AI Reason Input all deleted; ExcludedTab is a rewrite (not a layer) |
| I-COLUMN-DROP-CLEANUP-EXHAUSTIVE (NEW) | REGISTERED | Added to `Mingla_Artifacts/INVARIANT_REGISTRY.md`; CI script enforces gates 1-3 of this invariant |

---

## 9. Parity check

- Solo/collab: N/A — admin-only change.
- Platform parity: N/A — web admin only; no mobile, no edge fn.

---

## 10. Cache safety check

- Admin uses direct Supabase calls, no React Query. No cache invalidation concerns.
- No query keys changed (no React Query in admin).
- Page state (tab activeTab) uses the renamed `"excluded"` id — if an admin user had a persisted tab state from prior session pointing to `"rejected"`, they'll fall through to the default tab (likely "overview"). Non-blocking: admin state is transient, not persisted across sessions.

---

## 11. Regression surface — what to test after deploy

The tester should sanity-check these 5 adjacent surfaces:

1. **Place Pool "Browse Pool" list view** — ensure the place detail modal opens, save flow succeeds (editForm now has 5 fields instead of 9; Save calls `admin_edit_place` RPC unchanged).
2. **Place Pool "Overview" tab** — country drill-down → city drill-down → category breakdown renders without undefined field errors.
3. **Place Pool "Map View"** — city selection loads pins; filter dropdown (Bouncer Status) switches 3-state.
4. **Signal Library city selection + Bouncer run + Scorer run** — ensure the full workflow still works (city picker is the entry point; other flows unchanged).
5. **CityPipelineHistory table** (SignalLibrary L817) — verify pipeline rows render with non-zero `is_servable_count`.

---

## 12. Constitutional compliance quick-check

- #1 No dead taps: **preserved** (approve button removed entirely)
- #2 One owner per truth: **improved** (field names align with DB)
- #3 No silent failures: **improved** (H-2 silent-zero fixed)
- #4 One query key per entity: N/A (no React Query in admin)
- #5 Zustand for client state only: N/A (admin uses Context)
- #6 Logout clears everything: not touched
- #7 Label temporary fixes: N/A (no transitional items)
- #8 Subtract before adding: **preserved** (net −65 JSX lines)
- #9 No fabricated data: **preserved** (no fallback data for dropped columns)
- #10 Currency-aware UI: not touched
- #11 One auth instance: preserved (all RPCs keep existing `admin_users` check)
- #12 Validate at the right time: preserved (filter validation unchanged)
- #13 Exclusion consistency: preserved (admin and serving both read from `is_servable`)
- #14 Persisted-state startup: N/A (admin state is transient)

---

## 13. Discoveries for orchestrator

**None new.** All pre-existing discoveries from the investigation are tracked or deferred:
- H-1 `admin_place_pool_city_list` → downgraded 🔴→🔵 in spec (already clean post-ORCH-0640)
- D-6 `PhotoPoolManagementPage.jsx` audit → ORCH-0647 (filed by orchestrator)
- D-9 admin-page smoke gap in column-drop CLOSE protocol → addressed by I-COLUMN-DROP-CLEANUP-EXHAUSTIVE

**Observations during implementation (no action needed):**
- Leaflet CSS chunking warning in admin build (pre-existing, unchanged by this work).
- `handleCreateRun` mode logic uses `mode` string passed to an edge function — its runtime filter behavior for `mode='initial'` post-ORCH-0640 is out of scope for ORCH-0646; comments now reference `is_servable` for accuracy. If `initial` mode filter logic is broken at runtime, that's a separate investigation.

---

## 14. Transition items

**None.** No `[TRANSITIONAL]` markers added. No silent tech debt introduced.

---

## 15. Summary verdict

**implemented, partially verified**

- All 5 code-level gates PASS (build + CI + 3 grep checks).
- CI negative-control PROVEN (gate catches admin-frontend `ai_approved` references).
- Live-DB verification (SC-1 post-apply probe), Place Pool smoke (SC-3), Signal Library smoke (SC-4) are user-owned — ready for tester dispatch after user runs §6 deploy sequence.

**Next in pipeline:** orchestrator REVIEW → tester dispatch via `/mingla-tester` with this report + spec.
